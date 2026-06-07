const fs = require('fs');
const path = require('path');

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

const memoryLearning = globalThis.__gamefightCpuLearning || (globalThis.__gamefightCpuLearning = new Map());
const CPU_LEARNING_PATH = path.join(process.cwd(), '.cpu-learning.json');
const CPU_LEARNING_BACKUP_PATH = `${CPU_LEARNING_PATH}.bak`;

function now() {
  return Date.now();
}

function sanitizeFighterId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function learningKey(cpuId, opponentId) {
  return `cpu-learning:${cpuId}:${opponentId}`;
}

function json(res, statusCode, payload) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.status(statusCode).json(payload);
}

function redisEnabled() {
  return Boolean(redis);
}

function safeNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return n > 0 ? n : 0;
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

async function loadLearning(cpuId, opponentId) {
  const key = learningKey(cpuId, opponentId);
  if (redisEnabled()) {
    return (await redis.get(key)) || null;
  }
  try {
    const raw = fs.readFileSync(CPU_LEARNING_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const store = parsed && typeof parsed === 'object' ? parsed : {};
    return store[key] || null;
  } catch {
    try {
      const backupRaw = fs.readFileSync(CPU_LEARNING_BACKUP_PATH, 'utf8');
      const backupParsed = JSON.parse(backupRaw);
      const backupStore = backupParsed && typeof backupParsed === 'object' ? backupParsed : {};
      return backupStore[key] || null;
    } catch {
      // Continue to in-memory fallback.
    }
  }
  return memoryLearning.get(key) || null;
}

async function saveLearning(cpuId, opponentId, learning) {
  const key = learningKey(cpuId, opponentId);
  if (redisEnabled()) {
    await redis.set(key, learning);
    return;
  }
  try {
    let store = {};
    try {
      const raw = fs.readFileSync(CPU_LEARNING_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      store = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      store = {};
    }
    store[key] = learning;
    const serialized = JSON.stringify(store, null, 2);
    const tmpPath = `${CPU_LEARNING_PATH}.tmp`;
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    fs.renameSync(tmpPath, CPU_LEARNING_PATH);
    fs.writeFileSync(CPU_LEARNING_BACKUP_PATH, serialized, 'utf8');
    return;
  } catch {
    // Fallback to in-memory storage when file system is unavailable.
  }
  memoryLearning.set(key, learning);
}

function mergeLearning(current, incoming) {
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

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const cpuId = sanitizeFighterId(req.query.cpuId);
    const opponentId = sanitizeFighterId(req.query.opponentId);
    if (!cpuId || !opponentId) {
      return json(res, 400, { ok: false, error: 'cpuId e opponentId sao obrigatorios.' });
    }
    const learning = (await loadLearning(cpuId, opponentId)) || buildEmptyLearning(cpuId, opponentId);
    return json(res, 200, { ok: true, learning });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Metodo nao suportado.' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
  }
  const cpuId = sanitizeFighterId(body.cpuId);
  const opponentId = sanitizeFighterId(body.opponentId);
  if (!cpuId || !opponentId) {
    return json(res, 400, { ok: false, error: 'cpuId e opponentId sao obrigatorios.' });
  }
  const current = (await loadLearning(cpuId, opponentId)) || buildEmptyLearning(cpuId, opponentId);
  const merged = mergeLearning(current, {
    cpuId,
    opponentId,
    attacks: body.attacks || {},
    responses: body.responses || {},
    sequences: body.sequences || {},
    won: body.won
  });
  await saveLearning(cpuId, opponentId, merged);
  return json(res, 200, { ok: true, learning: merged });
};
