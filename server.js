const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const qrcode = require('qrcode');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

// exposed so the page can show the LAN address + a QR code to scan on a
// phone, instead of the user having to read it off the terminal
app.get('/api/network-info', async (req, res) => {
  const url = getLanAddress(PORT);
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

// All devices on the LAN join one shared room. Since this server only
// listens on the local network, anyone who can reach it is trusted to be
// on the same network.
const ROOM = 'lan';
const peers = {}; // socket.id -> { id, name }

io.on('connection', (socket) => {
  const name = randomName();
  peers[socket.id] = { id: socket.id, name };
  socket.join(ROOM);

  // tell the new peer who's already here
  socket.emit('welcome', { id: socket.id, name });
  socket.emit('peers', Object.values(peers).filter(p => p.id !== socket.id));

  // tell everyone else about the new peer
  socket.to(ROOM).emit('peer-joined', peers[socket.id]);

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
    delete peers[socket.id];
    socket.to(ROOM).emit('peer-left', { id: socket.id });
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
