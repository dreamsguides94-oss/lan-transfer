const socket = io();

const myNameEl = document.getElementById('myName');
const lanUrlEl = document.getElementById('lanUrl');
const qrImageEl = document.getElementById('qrImage');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const peerListEl = document.getElementById('peerList');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const transferListEl = document.getElementById('transferList');
const incomingModal = document.getElementById('incomingModal');
const incomingText = document.getElementById('incomingText');
const acceptBtn = document.getElementById('acceptBtn');
const declineBtn = document.getElementById('declineBtn');

const CHUNK_SIZE = 64 * 1024;
const BUFFER_LOW_THRESHOLD = 1 * 1024 * 1024;

let myId = null;
let myName = null;
const peers = {}; // id -> name
const connections = {}; // peerId -> RTCPeerConnection
const channels = {}; // peerId -> RTCDataChannel
let pendingFiles = []; // File[] queued to send on next click
let pendingIncoming = null; // { from, meta } awaiting accept/decline
const incomingBuffers = {}; // peerId -> { name, size, mime, chunks[] }

// ---------- peer list UI ----------

function renderPeers() {
  const ids = Object.keys(peers);
  if (ids.length === 0) {
    peerListEl.innerHTML = '<p class="empty-state">Waiting for other devices to join…</p>';
    return;
  }
  peerListEl.innerHTML = '';
  ids.forEach((id) => {
    const row = document.createElement('div');
    row.className = 'peer-row';
    row.innerHTML = `
      <div class="info">
        <span class="dot"></span>
        <span class="name">${peers[id]}</span>
      </div>
      <button class="send-btn" ${pendingFiles.length ? '' : 'disabled'}>
        ${pendingFiles.length ? `Send ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''}` : 'Select files first'}
      </button>
    `;
    row.querySelector('.send-btn').addEventListener('click', () => {
      if (pendingFiles.length) sendFilesTo(id, pendingFiles);
    });
    peerListEl.appendChild(row);
  });
}

// ---------- socket events ----------

socket.on('welcome', ({ id, name }) => {
  myId = id;
  myName = name;
  myNameEl.textContent = name;
});

socket.on('peers', (list) => {
  list.forEach((p) => (peers[p.id] = p.name));
  renderPeers();
});

socket.on('peer-joined', (p) => {
  peers[p.id] = p.name;
  renderPeers();
});

socket.on('peer-left', ({ id }) => {
  delete peers[id];
  delete connections[id];
  delete channels[id];
  renderPeers();
});

socket.on('transfer-request', ({ from, meta }) => {
  pendingIncoming = { from, meta };
  const totalSize = meta.files.reduce((s, f) => s + f.size, 0);
  incomingText.textContent = `${peers[from] || 'A device'} wants to send you ${meta.files.length} file${meta.files.length > 1 ? 's' : ''} (${formatBytes(totalSize)}). Accept?`;
  incomingModal.classList.remove('hidden');
});

acceptBtn.addEventListener('click', () => {
  if (!pendingIncoming) return;
  socket.emit('transfer-response', { to: pendingIncoming.from, accepted: true });
  incomingModal.classList.add('hidden');
  pendingIncoming = null;
});

declineBtn.addEventListener('click', () => {
  if (!pendingIncoming) return;
  socket.emit('transfer-response', { to: pendingIncoming.from, accepted: false });
  incomingModal.classList.add('hidden');
  pendingIncoming = null;
});

socket.on('transfer-response', ({ from, accepted }) => {
  const waiter = window.__pendingSends && window.__pendingSends[from];
  if (!waiter) return;
  if (accepted) waiter.resolve();
  else waiter.reject(new Error('declined'));
});

socket.on('signal', async ({ from, data }) => {
  let pc = connections[from];

  if (data.type === 'offer') {
    pc = createPeerConnection(from, false);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer } });
  } else if (data.type === 'answer') {
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  } else if (data.type === 'candidate') {
    if (pc && data.candidate) {
      try { await pc.addIceCandidate(data.candidate); } catch (e) { /* ignore */ }
    }
  }
});

// ---------- WebRTC plumbing ----------

function createPeerConnection(peerId, isInitiator) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  connections[peerId] = pc;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: peerId, data: { type: 'candidate', candidate: e.candidate } });
    }
  };

  if (isInitiator) {
    const channel = pc.createDataChannel('file');
    setupChannel(channel, peerId);
  } else {
    pc.ondatachannel = (e) => setupChannel(e.channel, peerId);
  }

  return pc;
}

function setupChannel(channel, peerId) {
  channel.binaryType = 'arraybuffer';
  channels[peerId] = channel;

  channel.onopen = () => {
    if (channel._sendQueue) channel._sendQueue();
  };

  channel.onmessage = (e) => handleIncomingMessage(peerId, e.data);
}

// ---------- sending ----------

// tracks bytes-over-time to show a live "x MB/s" readout during a transfer
function createSpeedTracker() {
  let lastTime = performance.now();
  let lastBytes = 0;
  let lastLabel = '';
  return {
    sample(totalBytes) {
      const now = performance.now();
      const elapsed = now - lastTime;
      if (elapsed > 400) {
        const bytesPerSec = ((totalBytes - lastBytes) / elapsed) * 1000;
        lastLabel = `(${formatBytes(bytesPerSec)}/s)`;
        lastTime = now;
        lastBytes = totalBytes;
      }
      return lastLabel;
    },
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function sendFilesTo(peerId, files) {
  window.__pendingSends = window.__pendingSends || {};

  socket.emit('transfer-request', {
    to: peerId,
    meta: { files: files.map((f) => ({ name: f.name, size: f.size, mime: f.type })) },
  });

  const accepted = await new Promise((resolve, reject) => {
    window.__pendingSends[peerId] = { resolve, reject };
    setTimeout(() => reject(new Error('timeout')), 60000);
  }).then(() => true).catch(() => false);

  delete window.__pendingSends[peerId];

  if (!accepted) {
    addTransferRow(`Request to ${peers[peerId]}`, 'Declined or timed out', 'failed');
    return;
  }

  pendingFiles = [];
  renderPeers();

  const pc = createPeerConnection(peerId, true);
  const channel = channels[peerId];
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { to: peerId, data: { type: 'offer', sdp: offer } });

  await waitForOpen(channel);

  for (const file of files) {
    await sendOneFile(channel, file);
  }
}

function waitForOpen(channel) {
  return new Promise((resolve) => {
    if (channel.readyState === 'open') return resolve();
    channel._sendQueue = resolve;
  });
}

function sendOneFile(channel, file) {
  return new Promise((resolve, reject) => {
    const row = addTransferRow(file.name, 'Sending…', 'active');
    channel.send(JSON.stringify({ type: 'file-start', name: file.name, size: file.size, mime: file.type }));

    let offset = 0;
    const reader = new FileReader();
    const speed = createSpeedTracker();

    function sendNextChunk() {
      if (offset >= file.size) {
        channel.send(JSON.stringify({ type: 'file-end', name: file.name }));
        updateTransferRow(row, 100, 'Sent', 'done');
        resolve();
        return;
      }
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    }

    reader.onload = () => {
      channel.send(reader.result);
      offset += reader.result.byteLength;
      const pct = Math.min(100, Math.round((offset / file.size) * 100));
      updateTransferRow(row, pct, `Sending… ${speed.sample(offset)}`, 'active');

      if (channel.bufferedAmount > BUFFER_LOW_THRESHOLD) {
        channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
        channel.onbufferedamountlow = () => {
          channel.onbufferedamountlow = null;
          sendNextChunk();
        };
      } else {
        sendNextChunk();
      }
    };

    reader.onerror = () => {
      updateTransferRow(row, 0, 'Failed', 'failed');
      reject(reader.error);
    };

    sendNextChunk();
  });
}

// ---------- receiving ----------

function handleIncomingMessage(peerId, data) {
  if (typeof data === 'string') {
    const msg = JSON.parse(data);
    if (msg.type === 'file-start') {
      incomingBuffers[peerId] = {
        name: msg.name,
        size: msg.size,
        mime: msg.mime,
        received: 0,
        chunks: [],
        speed: createSpeedTracker(),
        row: addTransferRow(msg.name, 'Receiving…', 'active'),
      };
    } else if (msg.type === 'file-end') {
      const buf = incomingBuffers[peerId];
      if (!buf) return;
      const blob = new Blob(buf.chunks, { type: buf.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buf.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      updateTransferRow(buf.row, 100, 'Saved to Downloads', 'done');
      delete incomingBuffers[peerId];
    }
  } else {
    const buf = incomingBuffers[peerId];
    if (!buf) return;
    buf.chunks.push(data);
    buf.received += data.byteLength;
    const pct = Math.min(100, Math.round((buf.received / buf.size) * 100));
    updateTransferRow(buf.row, pct, `Receiving… ${buf.speed.sample(buf.received)}`, 'active');
  }
}

// ---------- transfer list UI ----------

function addTransferRow(name, statusText, statusClass) {
  if (transferListEl.querySelector('.empty-state')) transferListEl.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'transfer-row';
  row.innerHTML = `
    <div class="top-line">
      <span class="file-name">${name}</span>
      <span class="status ${statusClass}">${statusText}</span>
    </div>
    <div class="progress-track"><div class="progress-fill"></div></div>
  `;
  transferListEl.prepend(row);
  return row;
}

function updateTransferRow(row, percent, statusText, statusClass) {
  const fill = row.querySelector('.progress-fill');
  const status = row.querySelector('.status');
  fill.style.width = percent + '%';
  if (statusClass === 'done') fill.classList.add('done');
  status.textContent = statusText;
  status.className = 'status ' + statusClass;
}

// ---------- drag & drop ----------

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  addPendingFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

['dragover', 'dragenter'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);

['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);

dropzone.addEventListener('drop', (e) => {
  addPendingFiles(Array.from(e.dataTransfer.files));
});

// ---------- connect panel (LAN url + QR code) ----------

fetch('/api/network-info')
  .then((r) => r.json())
  .then(({ url, qrDataUrl }) => {
    lanUrlEl.textContent = url;
    if (qrDataUrl) qrImageEl.src = qrDataUrl;
  })
  .catch(() => {
    lanUrlEl.textContent = window.location.origin;
  });

copyUrlBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(lanUrlEl.textContent).then(() => {
    const original = copyUrlBtn.textContent;
    copyUrlBtn.textContent = 'Copied';
    setTimeout(() => (copyUrlBtn.textContent = original), 1500);
  });
});

function addPendingFiles(files) {
  if (!files.length) return;
  pendingFiles = files;
  dropzone.querySelector('p').textContent =
    `${files.length} file${files.length > 1 ? 's' : ''} ready — click a device below to send`;
  renderPeers();
}
