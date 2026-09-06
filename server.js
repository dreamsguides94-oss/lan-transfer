const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const qrcode = require('qrcode');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// needed so req.ip / x-forwarded-for reflect the real visitor when this
// runs behind a hosting provider's proxy (Render, Railway, Fly.io, etc.)
app.set('trust proxy', true);

app.use(express.static('public'));

function getLanAddress(port) {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return `http://${net.address}:${port}`;
      }
    }
  }
  return `http://localhost:${port}`;
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? `start "" "${url}"`
    : platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {}); // best-effort; ignore failures (e.g. headless servers)
}

// Works two ways:
//  - run locally (e.g. via the .bat launcher): returns this machine's LAN
//    IP, so a QR/link on the page opens correctly on another device on
//    the same Wi-Fi.
//  - deployed publicly (Render/Railway/etc.): returns the public URL the
//    visitor actually used, from the request itself.
app.get('/api/network-info', async (req, res) => {
  const isLocalHost = /^(localhost|127\.0\.0\.1|::1)/.test(req.hostname);
  const url = isLocalHost ? getLanAddress(PORT) : `${req.protocol}://${req.get('host')}`;
  try {
    const qrDataUrl = await qrcode.toDataURL(url, { margin: 1, width: 220 });
    res.json({ url, qrDataUrl });
  } catch (e) {
    res.json({ url, qrDataUrl: null });
  }
});

// simple pool of friendly device names
const ADJ = ['Swift', 'Silent', 'Bright', 'Calm', 'Rapid', 'Quiet', 'Bold', 'Clever'];
const ANIMAL = ['Falcon', 'Tiger', 'Panda', 'Eagle', 'Wolf', 'Otter', 'Hawk', 'Fox'];
function randomName() {
  return ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + ANIMAL[Math.floor(Math.random() * ANIMAL.length)];
}

// Anyone can open this site — but for privacy, devices are only grouped
// with others on the SAME network (same public IP), exactly like
// Snapdrop. A stranger elsewhere on the internet never sees your devices.
function networkKeyFor(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const ip = (forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address) || 'local';
  return 'net-' + ip;
}

const rooms = {}; // roomKey -> { socketId -> { id, name } }

io.on('connection', (socket) => {
  const room = networkKeyFor(socket);
  const name = randomName();
  rooms[room] = rooms[room] || {};
  rooms[room][socket.id] = { id: socket.id, name };
  socket.join(room);
  socket.data.room = room;

  // tell the new peer who's already here (on their network only)
  socket.emit('welcome', { id: socket.id, name });
  socket.emit('peers', Object.values(rooms[room]).filter((p) => p.id !== socket.id));

  // tell everyone else on the same network about the new peer
  socket.to(room).emit('peer-joined', rooms[room][socket.id]);

  // relay WebRTC signaling messages (offer/answer/ICE candidates) between
  // two specific peers — the server never sees file contents, only this
  // handshake metadata.
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // relay a "hey I want to send you a file" request before the WebRTC
  // handshake starts, so the receiver can show an accept/decline prompt
  socket.on('transfer-request', ({ to, meta }) => {
    io.to(to).emit('transfer-request', { from: socket.id, meta });
  });
  socket.on('transfer-response', ({ to, accepted }) => {
    io.to(to).emit('transfer-response', { from: socket.id, accepted });
  });

  socket.on('disconnect', () => {
    const r = socket.data.room;
    if (rooms[r]) {
      delete rooms[r][socket.id];
      if (Object.keys(rooms[r]).length === 0) delete rooms[r];
    }
    socket.to(r).emit('peer-left', { id: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const lanUrl = getLanAddress(PORT);
  console.log(`\nLAN Transfer running.\n`);
  console.log(`This device:      http://localhost:${PORT}`);
  console.log(`Other devices:    ${lanUrl}\n`);
  console.log(`Opening your browser now...\n`);
  openBrowser(`http://localhost:${PORT}`);
});
