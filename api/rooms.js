const ROOM_TTL_SECONDS = 60 * 60 * 2;
const ROOM_TTL_MS = ROOM_TTL_SECONDS * 1000;
const MAX_COMMAND_BUFFER = 250;
const WAITING_ROOM_KEY = 'match:waiting-room';

let redis = null;
try {
  const { Redis } = require('@upstash/redis');
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  }
} catch {
  redis = null;
}

const memoryRooms = globalThis.__gamefightRooms || (globalThis.__gamefightRooms = new Map());

function now() {
  return Date.now();
}

function roomKey(roomId) {
  return `room:${roomId}`;
}

function makeSessionId() {
  return `${now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function sanitizeRoomId(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function waitingRoomKey() {
  return WAITING_ROOM_KEY;
}

function json(res, statusCode, payload) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.status(statusCode).json(payload);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function redisEnabled() {
  return Boolean(redis);
}

async function loadRoom(roomId) {
  if (!roomId) return null;
  if (redisEnabled()) {
    return redis.get(roomKey(roomId));
  }
  return memoryRooms.get(roomId) || null;
}

async function saveRoom(room) {
  room.updatedAt = now();
  room.expiresAt = room.updatedAt + ROOM_TTL_MS;
  if (redisEnabled()) {
    await redis.set(roomKey(room.id), room, { ex: ROOM_TTL_SECONDS });
    return;
  }
  memoryRooms.set(room.id, room);
}

async function deleteRoom(roomId) {
  if (!roomId) return;
  if (redisEnabled()) {
    await redis.del(roomKey(roomId));
    return;
  }
  memoryRooms.delete(roomId);
}

async function loadWaitingRoomId() {
  if (redisEnabled()) {
    return redis.get(waitingRoomKey());
  }
  return globalThis.__gamefightWaitingRoomId || null;
}

async function saveWaitingRoomId(roomId) {
  if (redisEnabled()) {
    await redis.set(waitingRoomKey(), roomId, { ex: ROOM_TTL_SECONDS });
    return;
  }
  globalThis.__gamefightWaitingRoomId = roomId;
}

async function clearWaitingRoomId(roomId) {
  if (redisEnabled()) {
    const current = await redis.get(waitingRoomKey());
    if (!roomId || current === roomId) {
      await redis.del(waitingRoomKey());
    }
    return;
  }
  if (!roomId || globalThis.__gamefightWaitingRoomId === roomId) {
    globalThis.__gamefightWaitingRoomId = null;
  }
}

async function requireRoom(roomId, res) {
  const room = await loadRoom(roomId);
  if (!room) {
    json(res, 404, { ok: false, error: 'Sala nao encontrada.' });
    return null;
  }
  if (room.expiresAt && room.expiresAt < now()) {
    await deleteRoom(roomId);
    json(res, 404, { ok: false, error: 'Sala expirada.' });
    return null;
  }
  return room;
}

function isHost(room, sessionId) {
  return room.hostSessionId === sessionId;
}

function isGuest(room, sessionId) {
  return room.guestSessionId === sessionId;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const roomId = sanitizeRoomId(req.query.roomId);
    const role = String(req.query.role || '');
    const since = Number(req.query.since || 0);
    const room = await loadRoom(roomId);
    if (!room) {
      return json(res, 200, { ok: true, room: null });
    }
    if (room.expiresAt && room.expiresAt < now()) {
      await deleteRoom(roomId);
      return json(res, 200, { ok: true, room: null });
    }

    if (role === 'host') {
      const newCommands = (room.commands || []).filter((entry) => entry.id > since);
      return json(res, 200, {
        ok: true,
        room: {
          guestChoice: room.guestChoice || null,
          guestControls: room.guestControls || { pressed: {} },
          newCommands,
          matchStarted: Boolean(room.matchStarted),
          closed: Boolean(room.closed)
        }
      });
    }

    return json(res, 200, {
      ok: true,
      room: {
        hostChoice: room.hostChoice || null,
        guestChoice: room.guestChoice || null,
        matchStarted: Boolean(room.matchStarted),
        matchEnded: Boolean(room.matchEnded),
        latestSnapshot: room.latestSnapshot || null,
        closed: Boolean(room.closed)
      }
    });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Metodo nao suportado.' });
  }

  const body = parseBody(req);
  const action = String(body.action || '');

  if (action === 'play') {
    const waitingRoomId = sanitizeRoomId(await loadWaitingRoomId());
    if (waitingRoomId) {
      const waitingRoom = await loadRoom(waitingRoomId);
      const waitingRoomExpired = waitingRoom?.expiresAt && waitingRoom.expiresAt < now();
      const waitingRoomOpen = waitingRoom && !waitingRoom.closed && !waitingRoom.guestSessionId && !waitingRoomExpired;
      if (waitingRoomOpen) {
        const sessionId = makeSessionId();
        waitingRoom.guestSessionId = sessionId;
        waitingRoom.guestChoice = body.choice || waitingRoom.guestChoice || null;
        await saveRoom(waitingRoom);
        await clearWaitingRoomId(waitingRoomId);
        return json(res, 200, {
          ok: true,
          role: 'guest',
          roomId: waitingRoom.id,
          sessionId,
          hostChoice: waitingRoom.hostChoice || null
        });
      }
      await clearWaitingRoomId(waitingRoomId);
      if (waitingRoomExpired) {
        await deleteRoom(waitingRoomId);
      }
    }

    const roomId = makeRoomId();
    const sessionId = makeSessionId();
    const room = {
      id: roomId,
      createdAt: now(),
      updatedAt: now(),
      expiresAt: now() + ROOM_TTL_MS,
      hostChoice: body.choice || null,
      guestChoice: null,
      hostSessionId: sessionId,
      guestSessionId: null,
      guestControls: { pressed: {} },
      commands: [],
      lastCommandId: 0,
      matchStarted: false,
      matchEnded: false,
      latestSnapshot: null,
      closed: false
    };
    await saveRoom(room);
    await saveWaitingRoomId(roomId);
    return json(res, 200, { ok: true, role: 'host', roomId, sessionId });
  }

  const roomId = sanitizeRoomId(body.roomId);
  const room = await requireRoom(roomId, res);
  if (!room) return;
  const sessionId = String(body.sessionId || '');

  if (action === 'join') {
    if (room.closed) return json(res, 409, { ok: false, error: 'Sala encerrada.' });
    if (room.guestSessionId && !isGuest(room, sessionId)) {
      return json(res, 409, { ok: false, error: 'Sala cheia.' });
    }
    const nextSessionId = room.guestSessionId || makeSessionId();
    room.guestSessionId = nextSessionId;
    room.guestChoice = body.choice || room.guestChoice || null;
    await saveRoom(room);
    await clearWaitingRoomId(room.id);
    return json(res, 200, { ok: true, sessionId: nextSessionId });
  }

  if (action === 'input') {
    if (!isGuest(room, sessionId)) return json(res, 403, { ok: false, error: 'Sessao invalida.' });
    room.guestControls = { pressed: body.controls?.pressed || {} };
    await saveRoom(room);
    return json(res, 200, { ok: true });
  }

  if (action === 'command') {
    if (!isGuest(room, sessionId)) return json(res, 403, { ok: false, error: 'Sessao invalida.' });
    room.lastCommandId += 1;
    room.commands.push({ id: room.lastCommandId, command: body.command, createdAt: now() });
    if (room.commands.length > MAX_COMMAND_BUFFER) {
      room.commands = room.commands.slice(-MAX_COMMAND_BUFFER);
    }
    await saveRoom(room);
    return json(res, 200, { ok: true, commandId: room.lastCommandId });
  }

  if (action === 'state') {
    if (!isHost(room, sessionId)) return json(res, 403, { ok: false, error: 'Sessao invalida.' });
    room.latestSnapshot = body.snapshot || null;
    await saveRoom(room);
    return json(res, 200, { ok: true });
  }

  if (action === 'match-start') {
    if (!isHost(room, sessionId)) return json(res, 403, { ok: false, error: 'Sessao invalida.' });
    room.matchStarted = true;
    room.matchEnded = false;
    room.hostChoice = body.hostChoice || room.hostChoice || null;
    room.guestChoice = body.guestChoice || room.guestChoice || null;
    room.latestSnapshot = body.snapshot || room.latestSnapshot || null;
    await saveRoom(room);
    return json(res, 200, { ok: true });
  }

  if (action === 'match-end') {
    if (!isHost(room, sessionId)) return json(res, 403, { ok: false, error: 'Sessao invalida.' });
    room.matchEnded = true;
    room.latestSnapshot = body.snapshot || room.latestSnapshot || null;
    await saveRoom(room);
    return json(res, 200, { ok: true });
  }

  if (action === 'close') {
    if (!isHost(room, sessionId)) return json(res, 403, { ok: false, error: 'Sessao invalida.' });
    room.closed = true;
    await saveRoom(room);
    await clearWaitingRoomId(room.id);
    await deleteRoom(roomId);
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { ok: false, error: 'Acao invalida.' });
};
