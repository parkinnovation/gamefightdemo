const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOM_TTL_MS = 1000 * 60 * 60 * 2;
const WS_HEARTBEAT_INTERVAL_MS = 25000;
const CPU_LEARNING_PATH = path.join(process.cwd(), '.cpu-learning.json');
const rooms = new Map();
let cpuLearningCache = null;

function now() {
  return Date.now();
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeSessionId() {
  return `${now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function sanitizeRoomId(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function touchRoom(room) {
  room.updatedAt = now();
  room.expiresAt = room.updatedAt + ROOM_TTL_MS;
}

function send(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function closeRoom(roomId, reason = 'A sala foi encerrada.') {
  const room = rooms.get(roomId);
  if (!room) return;
  send(room.hostSocket, { type: 'room-closed', reason });
  send(room.guestSocket, { type: 'room-closed', reason });
  if (room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) room.hostSocket.close();
  if (room.guestSocket && room.guestSocket.readyState === WebSocket.OPEN) room.guestSocket.close();
  rooms.delete(roomId);
}

function requireRoom(roomId, ws) {
  const room = rooms.get(roomId);
  if (!room) {
    send(ws, { type: 'error', error: 'Sala nao encontrada.' });
    return null;
  }
  if (room.expiresAt < now()) {
    closeRoom(roomId, 'Sala expirada.');
    send(ws, { type: 'error', error: 'Sala expirada.' });
    return null;
  }
  return room;
}

function validateSession(room, ws, role, sessionId) {
  if (role === 'host') return room.hostSocket === ws && room.hostSessionId === sessionId;
  if (role === 'guest') return room.guestSocket === ws && room.guestSessionId === sessionId;
  return false;
}

function findWaitingRoom(excludeSocket) {
  for (const room of rooms.values()) {
    const hostReady = room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN;
    const guestMissing = !room.guestSocket || room.guestSocket.readyState !== WebSocket.OPEN;
    if (hostReady && guestMissing && !room.matchStarted && room.hostSocket !== excludeSocket && room.expiresAt >= now()) {
      return room;
    }
  }
  return null;
}

function isStaticSafe(filePath) {
  return filePath.startsWith(process.cwd());
}

function resolveAssetPath(urlPath) {
  const raw = urlPath === '/' ? '/index.html' : urlPath;
  const cleanPath = raw.split('?')[0].replace(/\\/g, '/');
  const fullPath = path.join(process.cwd(), cleanPath);
  if (!isStaticSafe(path.resolve(fullPath))) return null;
  return fullPath;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function sanitizeFighterId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function learningKey(cpuId, opponentId) {
  return `${cpuId}::${opponentId}`;
}

function buildEmptyLearning(cpuId, opponentId) {
  return {
    version: 1,
    cpuId,
    opponentId,
    matches: 0,
    wins: 0,
    losses: 0,
    attacks: {
      attack1: { attempts: 0, hits: 0, totalDamage: 0 },
      attack2: { attempts: 0, hits: 0, totalDamage: 0 }
    },
    responses: {},
    sequences: {},
    lastUpdatedAt: now()
  };
}

function safeNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return n > 0 ? n : 0;
}

function loadCpuLearningStore() {
  if (cpuLearningCache) return cpuLearningCache;
  try {
    const raw = fs.readFileSync(CPU_LEARNING_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cpuLearningCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cpuLearningCache = {};
  }
  return cpuLearningCache;
}

function saveCpuLearningStore(store) {
  cpuLearningCache = store;
  fs.writeFileSync(CPU_LEARNING_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function mergeCpuLearning(current, incoming) {
  const next = current || buildEmptyLearning(incoming.cpuId, incoming.opponentId);
  const attackKinds = ['attack1', 'attack2'];
  const responses = incoming.responses || {};
  const sequences = incoming.sequences || {};
  for (const attackKind of attackKinds) {
    if (!next.attacks[attackKind]) {
      next.attacks[attackKind] = { attempts: 0, hits: 0, totalDamage: 0 };
    }
    const payload = incoming.attacks?.[attackKind] || {};
    next.attacks[attackKind].attempts += safeNumber(payload.attempts);
    next.attacks[attackKind].hits += safeNumber(payload.hits);
    next.attacks[attackKind].totalDamage += safeNumber(payload.totalDamage);
  }

  for (const [enemyAction, actionStats] of Object.entries(responses)) {
    if (!next.responses[enemyAction]) next.responses[enemyAction] = {};
    for (const [responseAction, metrics] of Object.entries(actionStats || {})) {
      if (!next.responses[enemyAction][responseAction]) {
        next.responses[enemyAction][responseAction] = { count: 0, success: 0 };
      }
      next.responses[enemyAction][responseAction].count += safeNumber(metrics.count);
      next.responses[enemyAction][responseAction].success += safeNumber(metrics.success);
    }
  }

  for (const [sequenceKey, metrics] of Object.entries(sequences)) {
    if (!next.sequences[sequenceKey]) {
      next.sequences[sequenceKey] = { count: 0, success: 0, totalDamage: 0 };
    }
    next.sequences[sequenceKey].count += safeNumber(metrics.count);
    next.sequences[sequenceKey].success += safeNumber(metrics.success);
    next.sequences[sequenceKey].totalDamage += safeNumber(metrics.totalDamage);
  }

  next.matches += 1;
  if (incoming.won === true) next.wins += 1;
  if (incoming.won === false) next.losses += 1;
  next.lastUpdatedAt = now();
  return next;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk || '');
      if (raw.length > 1024 * 1024) {
        raw = '';
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname === '/api/cpu-learning') {
    const cpuId = sanitizeFighterId(requestUrl.searchParams.get('cpuId'));
    const opponentId = sanitizeFighterId(requestUrl.searchParams.get('opponentId'));
    if (req.method === 'GET') {
      if (!cpuId || !opponentId) {
        sendJson(res, 400, { ok: false, error: 'cpuId e opponentId sao obrigatorios.' });
        return;
      }
      const store = loadCpuLearningStore();
      const key = learningKey(cpuId, opponentId);
      const learning = store[key] || buildEmptyLearning(cpuId, opponentId);
      sendJson(res, 200, { ok: true, learning });
      return;
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const bodyCpuId = sanitizeFighterId(body.cpuId);
      const bodyOpponentId = sanitizeFighterId(body.opponentId);
      if (!bodyCpuId || !bodyOpponentId) {
        sendJson(res, 400, { ok: false, error: 'cpuId e opponentId sao obrigatorios.' });
        return;
      }
      const store = loadCpuLearningStore();
      const key = learningKey(bodyCpuId, bodyOpponentId);
      const current = store[key] || buildEmptyLearning(bodyCpuId, bodyOpponentId);
      const merged = mergeCpuLearning(current, {
        cpuId: bodyCpuId,
        opponentId: bodyOpponentId,
        attacks: body.attacks || {},
        responses: body.responses || {},
        sequences: body.sequences || {},
        won: body.won
      });
      store[key] = merged;
      saveCpuLearningStore(store);
      sendJson(res, 200, { ok: true, learning: merged });
      return;
    }
    sendJson(res, 405, { ok: false, error: 'Metodo nao suportado.' });
    return;
  }

  const filePath = resolveAssetPath(requestUrl.pathname || '/');
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  if (ws?._socket && typeof ws._socket.setNoDelay === 'function') {
    ws._socket.setNoDelay(true);
  }
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send(ws, { type: 'error', error: 'Mensagem invalida.' });
      return;
    }

    const type = String(message?.type || '');

    if (type === 'play') {
      const waitingRoom = findWaitingRoom(ws);
      if (!waitingRoom) {
        let roomId = makeRoomId();
        while (rooms.has(roomId)) roomId = makeRoomId();
        const sessionId = makeSessionId();
        const room = {
          id: roomId,
          createdAt: now(),
          updatedAt: now(),
          expiresAt: now() + ROOM_TTL_MS,
          hostSocket: ws,
          guestSocket: null,
          hostSessionId: sessionId,
          guestSessionId: null,
          hostChoice: message.choice || null,
          guestChoice: null,
          matchStarted: false,
          latestSnapshot: null
        };
        rooms.set(roomId, room);
        ws._roomId = roomId;
        ws._role = 'host';
        ws._sessionId = sessionId;
        send(ws, { type: 'created', roomId, sessionId });
        return;
      }

      const roomId = waitingRoom.id;
      const sessionId = makeSessionId();
      waitingRoom.guestSocket = ws;
      waitingRoom.guestSessionId = sessionId;
      waitingRoom.guestChoice = message.choice || null;
      touchRoom(waitingRoom);
      ws._roomId = roomId;
      ws._role = 'guest';
      ws._sessionId = sessionId;
      send(ws, {
        type: 'joined',
        roomId,
        sessionId,
        hostChoice: waitingRoom.hostChoice || null
      });
      send(waitingRoom.hostSocket, {
        type: 'peer-joined',
        guestChoice: waitingRoom.guestChoice || null,
        roomId
      });
      return;
    }

    if (type === 'create') {
      let roomId = makeRoomId();
      while (rooms.has(roomId)) roomId = makeRoomId();
      const sessionId = makeSessionId();
      const room = {
        id: roomId,
        createdAt: now(),
        updatedAt: now(),
        expiresAt: now() + ROOM_TTL_MS,
        hostSocket: ws,
        guestSocket: null,
        hostSessionId: sessionId,
        guestSessionId: null,
        hostChoice: message.choice || null,
        guestChoice: null,
        matchStarted: false,
        latestSnapshot: null
      };
      rooms.set(roomId, room);
      ws._roomId = roomId;
      ws._role = 'host';
      ws._sessionId = sessionId;
      send(ws, { type: 'created', roomId, sessionId });
      return;
    }

    if (type === 'join') {
      const roomId = sanitizeRoomId(message.roomId);
      const room = requireRoom(roomId, ws);
      if (!room) return;
      if (room.guestSocket && room.guestSocket.readyState === WebSocket.OPEN) {
        send(ws, { type: 'error', error: 'Sala cheia.' });
        return;
      }
      const sessionId = makeSessionId();
      room.guestSocket = ws;
      room.guestSessionId = sessionId;
      room.guestChoice = message.choice || null;
      touchRoom(room);
      ws._roomId = roomId;
      ws._role = 'guest';
      ws._sessionId = sessionId;
      send(ws, {
        type: 'joined',
        roomId,
        sessionId,
        hostChoice: room.hostChoice || null
      });
      if (room.matchStarted) {
        send(ws, {
          type: 'match-start',
          roomId,
          hostChoice: room.hostChoice || null,
          guestChoice: room.guestChoice || null,
          snapshot: room.latestSnapshot || null
        });
      }
      send(room.hostSocket, {
        type: 'peer-joined',
        guestChoice: room.guestChoice || null,
        roomId
      });
      return;
    }

    const roomId = sanitizeRoomId(message.roomId || ws._roomId);
    const room = requireRoom(roomId, ws);
    if (!room) return;

    const role = String(message.role || ws._role || '');
    const sessionId = String(message.sessionId || ws._sessionId || '');
    if (!validateSession(room, ws, role, sessionId)) {
      send(ws, { type: 'error', error: 'Sessao invalida.' });
      return;
    }

    touchRoom(room);

    if (type === 'input' && role === 'guest') {
      send(room.hostSocket, {
        type: 'guest-input',
        pressed: message.pressed || {}
      });
      return;
    }

    if (type === 'command' && role === 'guest') {
      send(room.hostSocket, {
        type: 'guest-command',
        command: message.command
      });
      return;
    }

    if (type === 'state' && role === 'host') {
      send(room.guestSocket, {
        type: 'state',
        snapshot: message.snapshot || null
      });
      return;
    }

    if (type === 'match-start' && role === 'host') {
      room.matchStarted = true;
      room.hostChoice = message.hostChoice || room.hostChoice || null;
      room.guestChoice = message.guestChoice || room.guestChoice || null;
      room.latestSnapshot = message.snapshot || room.latestSnapshot || null;
      send(room.guestSocket, {
        type: 'match-start',
        hostChoice: room.hostChoice,
        guestChoice: room.guestChoice,
        snapshot: message.snapshot || null
      });
      return;
    }

    if (type === 'match-end' && role === 'host') {
      room.latestSnapshot = message.snapshot || room.latestSnapshot || null;
      send(room.guestSocket, {
        type: 'match-end',
        snapshot: message.snapshot || null
      });
      return;
    }

    if (type === 'close' && role === 'host') {
      closeRoom(roomId);
      return;
    }

    send(ws, { type: 'error', error: 'Acao invalida.' });
  });

  ws.on('close', () => {
    const roomId = ws._roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.hostSocket === ws) {
      closeRoom(roomId);
      return;
    }

    if (room.guestSocket === ws) {
      room.guestSocket = null;
      room.guestSessionId = null;
      room.guestChoice = null;
      touchRoom(room);
      send(room.hostSocket, { type: 'peer-left', roomId });
    }
  });
});

const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, WS_HEARTBEAT_INTERVAL_MS);

heartbeatInterval.unref?.();
wss.on('close', () => clearInterval(heartbeatInterval));

setInterval(() => {
  const time = now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.expiresAt < time) {
      closeRoom(roomId, 'Sala expirada.');
    }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
