const GAME_WIDTH = 1200;
const GAME_HEIGHT = 620;
const GROUND_Y = 530;
const GRAVITY = 0.95;
const ROUND_TIME = 60;
const MAX_ROUNDS = 2;
const ASSET_ROOT_CANDIDATES = ['AssetsGame'];
const FRAME_COUNT = 12;
const ONLINE_STATE_PUSH_INTERVAL_MS = 33;
const ONLINE_API_POLL_INTERVAL_MS = 250;
const ONLINE_INPUT_PUSH_INTERVAL_MS = 16;
const ONLINE_DISCONNECT_RESET_MS = 1800;
const ONLINE_POLL_ERROR_TOLERANCE = 8;
const ONLINE_POLL_ROOM_MISS_TOLERANCE = 4;
const ONLINE_WS_PATH = '/ws';
const CPU_LEARNING_DECISION_TTL = 34;
const ONLINE_WS_LOG_PREFIX = '[online-ws]';

const characters = [
  { id: 'fighter', name: 'Fighter', folder: 'Fighter', folderCandidates: ['Fighter', 'fighter', 'character1'], color: '#38bdf8' },
  { id: 'samurai', name: 'Samurai', folder: 'Samurai', folderCandidates: ['Samurai', 'samurai', 'character2'], color: '#fb7185' },
  { id: 'shinobi', name: 'Shinobi', folder: 'Shinobi', folderCandidates: ['Shinobi', 'shinobi', 'character3'], color: '#facc15' },
  { id: 'converted-vampire', name: 'Converted Vampire', folder: 'Converted_Vampire', folderCandidates: ['Converted_Vampire'], color: '#c084fc' },
  { id: 'countess-vampire', name: 'Countess Vampire', folder: 'Countess_Vampire', folderCandidates: ['Countess_Vampire'], color: '#f472b6' },
  { id: 'gotoku', name: 'Gotoku', folder: 'Gotoku', folderCandidates: ['Gotoku'], color: '#fb923c' },
  { id: 'onre', name: 'Onre', folder: 'Onre', folderCandidates: ['Onre'], color: '#34d399' },
  { id: 'vampire-girl', name: 'Vampire Girl', folder: 'Vampire_Girl', folderCandidates: ['Vampire_Girl'], color: '#a78bfa' },
  { id: 'yurei', name: 'Yurei', folder: 'Yurei', folderCandidates: ['Yurei'], color: '#60a5fa' }
];

const ACTIONS = ['idle', 'walk', 'jump', 'attack1', 'attack2', 'hurt', 'ko'];
const ACTION_ASSET_CANDIDATES = {
  idle: ['idle'],
  walk: ['walk', 'run'],
  jump: ['jump'],
  attack1: ['attack1', 'attack_1', 'Attack_1', 'attack', 'punch'],
  attack2: ['attack2', 'attack_2', 'Attack_2', 'attack3', 'attack_3', 'Attack_3', 'attack', 'kick'],
  hurt: ['hurt', 'hit', 'damage'],
  ko: ['ko', 'dead', 'death']
};

const state = {
  mode: 'cpu',
  selectedCharacterId: null,
  selectedOpponentId: null,
  playerChoice: null,
  cpuChoice: null,
  online: {
    roomId: '',
    role: null,
    transport: null,
    apiAvailable: null,
    sessionId: '',
    socket: null,
    socketOpen: false,
    connectionTimeoutId: null,
    pollIntervalId: null,
    pollInFlight: false,
    pollErrorCount: 0,
    roomMissingCount: 0,
    connected: false,
    localChoice: null,
    remoteChoice: null,
    latestSnapshot: null,
    localControls: null,
    remoteControls: null,
    lastStatePushAt: 0,
    lastCommandId: 0,
    statePushInFlight: false,
    statePushDirty: false,
    pendingSnapshot: null,
    pendingMatchStart: null,
    lastInputPushAt: 0
  },
  running: false,
  round: 1,
  timer: ROUND_TIME,
  playerRoundWins: 0,
  cpuRoundWins: 0,
  roundOver: false,
  gameOver: false,
  overlayMessage: '',
  localControls: {
    pressed: {},
    jumpQueued: false,
    attack1Queued: false,
    attack2Queued: false
  },
  learning: {
    left: null,
    right: null
  }
};

const dom = {
  selectScreen: document.getElementById('character-select'),
  fightScreen: document.getElementById('fight-screen'),
  modeCpuBtn: document.getElementById('mode-cpu'),
  modeCpuDuelBtn: document.getElementById('mode-cpu-duel'),
  modeOnlineBtn: document.getElementById('mode-online'),
  onlinePanel: document.getElementById('online-panel'),
  characterGrid: document.getElementById('character-grid'),
  startFightBtn: document.getElementById('start-fight'),
  joinRoomBtn: document.getElementById('join-room'),
  roomCodeInput: document.getElementById('room-code-input'),
  roomStatus: document.getElementById('room-status'),
  roomCode: document.getElementById('room-code'),
  copyRoomCodeBtn: document.getElementById('copy-room-code'),
  backSelectBtn: document.getElementById('back-select'),
  playerName: document.getElementById('player-name'),
  enemyName: document.getElementById('enemy-name'),
  playerHealth: document.getElementById('player-health'),
  enemyHealth: document.getElementById('enemy-health'),
  playerRounds: document.getElementById('player-rounds'),
  enemyRounds: document.getElementById('enemy-rounds'),
  roundCount: document.getElementById('round-count'),
  timer: document.getElementById('timer'),
  overlayText: document.getElementById('overlay-text'),
  canvas: document.getElementById('game-canvas'),
  touchControls: document.getElementById('touch-controls')
};

const ctx = dom.canvas.getContext('2d');
let player;
let cpu;
let timerInterval;

function logOnlineWs(event, details = {}) {
  console.log(ONLINE_WS_LOG_PREFIX, event, details);
}

function getSocketStateLabel(socket) {
  if (!socket) return 'null';
  if (socket.readyState === WebSocket.CONNECTING) return 'CONNECTING';
  if (socket.readyState === WebSocket.OPEN) return 'OPEN';
  if (socket.readyState === WebSocket.CLOSING) return 'CLOSING';
  if (socket.readyState === WebSocket.CLOSED) return 'CLOSED';
  return `UNKNOWN(${socket.readyState})`;
}

function createControlState() {
  return {
    pressed: {},
    jumpQueued: false,
    attack1Queued: false,
    attack2Queued: false
  };
}

function clearControlState(controlState) {
  controlState.pressed = {};
  controlState.jumpQueued = false;
  controlState.attack1Queued = false;
  controlState.attack2Queued = false;
}

function applyControlStateToFighter(fighter, controlState) {
  if (!fighter || !controlState) return;
  let vx = 0;
  if (controlState.pressed.KeyA) vx -= fighter.speed;
  if (controlState.pressed.KeyD) vx += fighter.speed;
  fighter.vx = fighter.canAct() ? vx : 0;
  if (controlState.jumpQueued) {
    fighter.jump();
    controlState.jumpQueued = false;
  }
  if (controlState.attack1Queued) {
    fighter.attack('attack1');
    controlState.attack1Queued = false;
  }
  if (controlState.attack2Queued) {
    fighter.attack('attack2');
    controlState.attack2Queued = false;
  }
}

function serializeFighter(fighter) {
  return {
    x: fighter.x,
    y: fighter.y,
    vx: fighter.vx,
    vy: fighter.vy,
    hp: fighter.hp,
    attackCooldown: fighter.attackCooldown,
    attackTime: fighter.attackTime,
    attackKind: fighter.attackKind,
    hurtTime: fighter.hurtTime,
    ko: fighter.ko,
    frameTick: fighter.frameTick,
    frameIndex: fighter.frameIndex,
    currentAction: fighter.currentAction,
    faceRight: fighter.faceRight
  };
}

function applyFighterSnapshot(fighter, snapshot) {
  if (!fighter || !snapshot) return;
  Object.assign(fighter, snapshot);
}

function setRoomStatus(message) {
  if (dom.roomStatus) dom.roomStatus.textContent = message;
}

function createClientId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function canUseOnlineTransport() {
  return window.location.protocol !== 'file:';
}

function getPreferredOnlineTransport() {
  if (state.online.apiAvailable === true) return 'api';
  const candidates = getOnlineTransportCandidates();
  return candidates[0] || null;
}

function getOnlineTransportCandidates() {
  if (!canUseOnlineTransport()) return [];
  return typeof window.WebSocket === 'function' ? ['ws'] : [];
}

async function resolveOnlineTransport() {
  if (!canUseOnlineTransport()) return null;
  const apiAvailable = await probeOnlineApi();
  if (apiAvailable) return 'api';
  return getOnlineTransportCandidates()[0] || null;
}

function getOnlineApiBaseUrl() {
  const configuredBaseUrl = String(
    window.__GAMEFIGHT_API_BASE_URL__
    || document.querySelector('meta[name="gamefight-api-base"]')?.content
    || ''
  ).trim().replace(/\/+$/, '');
  return configuredBaseUrl;
}

function getOnlineSocketUrl() {
  const baseUrl = getOnlineApiBaseUrl();
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = ONLINE_WS_PATH;
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      // Fall back to the current origin when the configured base URL is invalid.
    }
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${ONLINE_WS_PATH}`;
}

function getOnlineApiUrl() {
  const baseUrl = getOnlineApiBaseUrl();
  return baseUrl ? `${baseUrl}/api/rooms` : '/api/rooms';
}

async function probeOnlineApi() {
  if (state.online.apiAvailable !== null) return state.online.apiAvailable;
  try {
    const response = await fetch(getOnlineApiUrl(), { cache: 'no-store' });
    state.online.apiAvailable = response.status !== 404;
  } catch {
    state.online.apiAvailable = false;
  }
  return state.online.apiAvailable;
}

function buildOnlineApiPayload(payload) {
  const type = String(payload?.type || '');
  if (type === 'play') return { action: 'play', choice: payload.choice || null };
  if (type === 'create') return { action: 'create', choice: payload.choice || null };
  if (type === 'join') return { action: 'join', roomId: payload.roomId, choice: payload.choice || null };
  if (type === 'input') return { action: 'input', roomId: payload.roomId, sessionId: payload.sessionId, controls: { pressed: payload.pressed || {} } };
  if (type === 'command') return { action: 'command', roomId: payload.roomId, sessionId: payload.sessionId, command: payload.command };
  if (type === 'state') return { action: 'state', roomId: payload.roomId, sessionId: payload.sessionId, snapshot: payload.snapshot || null };
  if (type === 'match-start') {
    return {
      action: 'match-start',
      roomId: payload.roomId,
      sessionId: payload.sessionId,
      hostChoice: payload.hostChoice || null,
      guestChoice: payload.guestChoice || null,
      snapshot: payload.snapshot || null
    };
  }
  if (type === 'match-end') return { action: 'match-end', roomId: payload.roomId, sessionId: payload.sessionId, snapshot: payload.snapshot || null };
  if (type === 'close') return { action: 'close', roomId: payload.roomId, sessionId: payload.sessionId };
  return null;
}

async function postOnlineAction(payload) {
  const body = buildOnlineApiPayload(payload);
  if (!body) return null;
  if (state.online.apiAvailable === false) {
    throw new Error('Online mode is not available in this deployment.');
  }
  const response = await fetch(getOnlineApiUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 404) {
    const isTransportProbe = body.action === 'play';
    if (isTransportProbe) {
      state.online.apiAvailable = false;
    }
    const error = new Error(isTransportProbe ? 'Online mode is not available in this deployment.' : 'Online room not found or expired.');
    error.code = isTransportProbe ? 'ONLINE_TRANSPORT_UNAVAILABLE' : 'ONLINE_ROOM_NOT_FOUND';
    throw error;
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Falha na comunicacao com o servidor.');
  }
  return data;
}

function getCpuLearningApiUrl() {
  const baseUrl = getOnlineApiBaseUrl();
  return baseUrl ? `${baseUrl}/api/cpu-learning` : '/api/cpu-learning';
}

function createEmptyCpuLearning(cpuId, opponentId) {
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
    lastUpdatedAt: Date.now()
  };
}

function normalizeEnemyAction(action) {
  if (action === 'attack1' || action === 'attack2' || action === 'jump') return action;
  if (action === 'walk') return 'walk';
  return 'idle';
}

function ensureResponseBucket(bucket, enemyAction, responseAction) {
  if (!bucket[enemyAction]) bucket[enemyAction] = {};
  if (!bucket[enemyAction][responseAction]) bucket[enemyAction][responseAction] = { count: 0, success: 0 };
  return bucket[enemyAction][responseAction];
}

function ensureSequenceBucket(bucket, sequenceKey) {
  if (!bucket[sequenceKey]) bucket[sequenceKey] = { count: 0, success: 0, totalDamage: 0 };
  return bucket[sequenceKey];
}

function createLearningRuntime(cpuId, opponentId, learning) {
  return {
    cpuId,
    opponentId,
    learning: learning || createEmptyCpuLearning(cpuId, opponentId),
    session: {
      attacks: {
        attack1: { attempts: 0, hits: 0, totalDamage: 0 },
        attack2: { attempts: 0, hits: 0, totalDamage: 0 }
      },
      responses: {},
      sequences: {}
    },
    pendingDecisions: [],
    lastAttack: null,
    flushed: false
  };
}

async function loadCpuLearning(cpuId, opponentId) {
  try {
    const params = new URLSearchParams({ cpuId, opponentId });
    const response = await fetch(`${getCpuLearningApiUrl()}?${params.toString()}`, { cache: 'no-store' });
    if (!response.ok) return createEmptyCpuLearning(cpuId, opponentId);
    const data = await response.json().catch(() => ({}));
    return data.learning || createEmptyCpuLearning(cpuId, opponentId);
  } catch {
    return createEmptyCpuLearning(cpuId, opponentId);
  }
}

async function initializeCpuLearningContexts() {
  state.learning.left = null;
  state.learning.right = null;
  if (state.mode === 'cpu') {
    const rightLearning = await loadCpuLearning(state.cpuChoice.id, state.playerChoice.id);
    state.learning.right = createLearningRuntime(state.cpuChoice.id, state.playerChoice.id, rightLearning);
    return;
  }
  if (state.mode === 'cpu-duel') {
    const [leftLearning, rightLearning] = await Promise.all([
      loadCpuLearning(state.playerChoice.id, state.cpuChoice.id),
      loadCpuLearning(state.cpuChoice.id, state.playerChoice.id)
    ]);
    state.learning.left = createLearningRuntime(state.playerChoice.id, state.cpuChoice.id, leftLearning);
    state.learning.right = createLearningRuntime(state.cpuChoice.id, state.playerChoice.id, rightLearning);
  }
}

function getLearningRuntimeForFighter(fighter) {
  if (state.mode === 'cpu-duel') {
    if (fighter === player) return state.learning.left;
    if (fighter === cpu) return state.learning.right;
    return null;
  }
  if (state.mode === 'cpu' && fighter === cpu) return state.learning.right;
  return null;
}

function scoreAttackFromLearning(runtime, kind) {
  const stats = runtime?.learning?.attacks?.[kind];
  if (!stats) return 1;
  const attempts = Number(stats.attempts || 0);
  if (attempts < 3) return 1;
  const hitRate = Number(stats.hits || 0) / attempts;
  const avgDamage = Number(stats.totalDamage || 0) / attempts;
  return Math.max(0.5, Math.min(1.85, 0.55 + (hitRate * 1.25) + (avgDamage / 16)));
}

function getPreferredResponseAction(runtime, enemyAction) {
  const responseStats = runtime?.learning?.responses?.[enemyAction];
  if (!responseStats) return null;
  let bestAction = null;
  let bestScore = 0;
  for (const [action, metrics] of Object.entries(responseStats)) {
    const count = Number(metrics?.count || 0);
    if (count < 3) continue;
    const successRate = Number(metrics?.success || 0) / count;
    const score = successRate * (1 + Math.min(count, 20) / 30);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }
  return bestAction;
}

function registerAiDecision(runtime, enemyAction, responseAction) {
  if (!runtime || !responseAction) return;
  const bucket = ensureResponseBucket(runtime.session.responses, enemyAction, responseAction);
  bucket.count += 1;
  runtime.pendingDecisions.push({
    enemyAction,
    responseAction,
    ttl: CPU_LEARNING_DECISION_TTL
  });
}

function processLearningPending(runtime, fighter) {
  if (!runtime || !fighter) return;
  runtime.pendingDecisions = runtime.pendingDecisions.filter((decision) => {
    if (fighter.hurtTime > 0) return false;
    const nextTtl = decision.ttl - 1;
    decision.ttl = nextTtl;
    if (nextTtl <= 0) {
      const bucket = ensureResponseBucket(runtime.session.responses, decision.enemyAction, decision.responseAction);
      bucket.success += 1;
      return false;
    }
    return true;
  });
}

function recordAttackAttempt(runtime, enemyAction, kind) {
  if (!runtime || (kind !== 'attack1' && kind !== 'attack2')) return;
  runtime.session.attacks[kind].attempts += 1;
  registerAiDecision(runtime, enemyAction, kind);
}

function recordMovementDecision(runtime, enemyAction, movement) {
  if (!runtime || !movement) return;
  registerAiDecision(runtime, enemyAction, movement);
}

function recordAttackHit(runtime, kind, damage) {
  if (!runtime || (kind !== 'attack1' && kind !== 'attack2')) return;
  runtime.session.attacks[kind].hits += 1;
  runtime.session.attacks[kind].totalDamage += damage;
  if (runtime.lastAttack) {
    const sequenceKey = `${runtime.lastAttack}>${kind}`;
    const bucket = ensureSequenceBucket(runtime.session.sequences, sequenceKey);
    bucket.count += 1;
    bucket.success += 1;
    bucket.totalDamage += damage;
  }
  runtime.lastAttack = kind;
}

function chooseBestSequenceBoost(runtime, attackKind) {
  const entries = Object.entries(runtime?.learning?.sequences || {});
  if (!entries.length) return 0;
  let best = 0;
  for (const [key, metrics] of entries) {
    if (!key.endsWith(`>${attackKind}`)) continue;
    const count = Number(metrics?.count || 0);
    if (count < 2) continue;
    const successRate = Number(metrics?.success || 0) / count;
    const avgDamage = Number(metrics?.totalDamage || 0) / count;
    const score = (successRate * 0.7) + (avgDamage / 25);
    if (score > best) best = score;
  }
  return Math.max(0, Math.min(0.35, best * 0.25));
}

async function flushCpuLearning(resultByCpuId) {
  const runtimes = [state.learning.left, state.learning.right].filter((runtime) => runtime && !runtime.flushed);
  if (!runtimes.length) return;
  await Promise.all(runtimes.map(async (runtime) => {
    runtime.flushed = true;
    const won = resultByCpuId[runtime.cpuId];
    try {
      await fetch(getCpuLearningApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cpuId: runtime.cpuId,
          opponentId: runtime.opponentId,
          attacks: runtime.session.attacks,
          responses: runtime.session.responses,
          sequences: runtime.session.sequences,
          won
        })
      });
    } catch {
      runtime.flushed = false;
    }
  }));
}

async function fetchOnlineRoomState() {
  if (!state.online.roomId || !state.online.role) return null;
  const params = new URLSearchParams({
    roomId: state.online.roomId,
    role: state.online.role
  });
  if (state.online.role === 'host') {
    params.set('since', String(state.online.lastCommandId || 0));
  }
  const response = await fetch(`${getOnlineApiUrl()}?${params.toString()}`, {
    cache: 'no-store'
  });
  if (response.status === 404) {
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Falha na comunicacao com o servidor.');
  }
  return data.room || null;
}

function sendOnlineMessage(payload) {
  if (state.online.transport === 'api') {
    if (state.online.apiAvailable === false) return false;
    void postOnlineAction(payload).catch(() => {});
    return true;
  }
  if (!state.online.socket || state.online.socket.readyState !== WebSocket.OPEN) {
    logOnlineWs('send-blocked', {
      reason: 'socket-not-open',
      payloadType: payload?.type || null,
      socketState: getSocketStateLabel(state.online.socket)
    });
    return false;
  }
  logOnlineWs('send', {
    payloadType: payload?.type || null,
    roomId: state.online.roomId || null,
    role: state.online.role || null,
    sessionId: state.online.sessionId || null
  });
  state.online.socket.send(JSON.stringify(payload));
  return true;
}

function handleOnlineDisconnect(message) {
  if (state.mode !== 'online') return;
  logOnlineWs('disconnect-handled', {
    message,
    roomId: state.online.roomId || null,
    role: state.online.role || null,
    running: state.running,
    connected: state.online.connected
  });
  const wasRunning = state.running;
  state.running = false;
  clearInterval(timerInterval);
  closeOnlineTransport();
  if (wasRunning) {
    state.roundOver = true;
    state.gameOver = true;
    state.overlayMessage = message;
    refreshHud();
    setRoomStatus(message);
    setTimeout(() => {
      if (state.mode === 'online' && !state.running) {
        resetToSelect();
      }
    }, ONLINE_DISCONNECT_RESET_MS);
    return;
  }
  refreshModeUi();
  dom.fightScreen.classList.remove('active');
  dom.selectScreen.classList.add('active');
  dom.startFightBtn.disabled = !state.selectedCharacterId;
  setRoomStatus(message);
}

function handleOnlineMessage(payload) {
  if (!payload || typeof payload !== 'object') return;
  logOnlineWs('message', {
    type: payload.type || null,
    roomId: payload.roomId || null,
    roomIdState: state.online.roomId || null,
    role: state.online.role || null,
    connected: state.online.connected
  });
  if (payload.type === 'error') {
    logOnlineWs('server-error', {
      error: payload.error || 'Falha na comunicacao com o servidor.'
    });
    setRoomStatus(payload.error || 'Falha na comunicacao com o servidor.');
    return;
  }
  if (payload.type === 'created') {
    logOnlineWs('room-created', {
      roomId: payload.roomId || null,
      sessionId: payload.sessionId || null
    });
    setupOnlineSession(payload.roomId || '', 'host', payload.sessionId || createClientId());
    state.playerRoundWins = 0;
    state.cpuRoundWins = 0;
    state.round = 1;
    state.gameOver = false;
    state.running = false;
    setRoomStatus('Searching for opponent... waiting for connection.');
    dom.startFightBtn.disabled = true;
    if (dom.joinRoomBtn) dom.joinRoomBtn.disabled = true;
    if (dom.roomCodeInput) dom.roomCodeInput.value = '';
    return;
  }
  if (payload.type === 'joined') {
    logOnlineWs('room-joined', {
      roomId: payload.roomId || null,
      sessionId: payload.sessionId || null,
      hostChoice: payload.hostChoice?.name || null
    });
    setupOnlineSession(payload.roomId || '', 'guest', payload.sessionId || createClientId());
    state.playerChoice = state.online.localChoice ? { ...state.online.localChoice } : state.playerChoice;
    state.cpuChoice = payload.hostChoice ? { ...payload.hostChoice } : state.cpuChoice;
    setRoomStatus('Opponent found. Connecting match...');
    dom.startFightBtn.disabled = true;
    if (dom.joinRoomBtn) dom.joinRoomBtn.disabled = true;
    if (state.online.pendingMatchStart) {
      const pendingMatchStart = state.online.pendingMatchStart;
      state.online.pendingMatchStart = null;
      handleOnlineMessage(pendingMatchStart);
    }
    return;
  }
  if (payload.type === 'peer-joined' && state.online.role === 'host' && !state.online.connected) {
    logOnlineWs('peer-joined', {
      roomId: state.online.roomId || null,
      guestChoice: payload.guestChoice?.name || null
    });
    state.online.remoteChoice = payload.guestChoice || null;
    state.cpuChoice = payload.guestChoice ? { ...payload.guestChoice } : state.cpuChoice;
    state.online.connected = true;
    if (state.online.connectionTimeoutId) {
      clearTimeout(state.online.connectionTimeoutId);
      state.online.connectionTimeoutId = null;
    }
    setRoomStatus(`Opponent connected: ${state.cpuChoice?.name || 'Guest'}. Starting match...`);
    state.overlayMessage = 'OPONENTE CONECTADO';
    startOnlineMatch();
    return;
  }
  if (payload.type === 'peer-left' && state.online.role === 'host') {
    logOnlineWs('peer-left', {
      roomId: state.online.roomId || null
    });
    state.online.connected = false;
    handleOnlineDisconnect('Oponente desconectou.');
    return;
  }
  if (payload.type === 'guest-input' && state.online.role === 'host' && state.online.remoteControls) {
    state.online.remoteControls.pressed = payload.pressed || {};
    return;
  }
  if (payload.type === 'guest-command' && state.online.role === 'host' && state.online.remoteControls) {
    if (payload.command === 'jump') state.online.remoteControls.jumpQueued = true;
    if (payload.command === 'attack1') state.online.remoteControls.attack1Queued = true;
    if (payload.command === 'attack2') state.online.remoteControls.attack2Queued = true;
    return;
  }
  if (payload.type === 'match-start' && state.online.role === 'guest') {
    logOnlineWs('match-start-received', {
      roomId: state.online.roomId || null,
      snapshotPresent: Boolean(payload.snapshot)
    });
    state.online.connected = true;
    if (state.online.connectionTimeoutId) {
      clearTimeout(state.online.connectionTimeoutId);
      state.online.connectionTimeoutId = null;
    }
    state.playerChoice = state.online.localChoice ? { ...state.online.localChoice } : state.playerChoice;
    state.cpuChoice = payload.hostChoice ? { ...payload.hostChoice } : state.cpuChoice;
    if (!state.running) {
      startOnlineMatch(payload.snapshot || null);
    }
    return;
  }
  if (payload.type === 'match-start') {
    logOnlineWs('match-start-pending', {
      roomId: state.online.roomId || null,
      role: state.online.role || null
    });
    state.online.pendingMatchStart = payload;
    return;
  }
  if (payload.type === 'state' && state.online.role === 'guest') {
    logOnlineWs('state-update', {
      roomId: state.online.roomId || null
    });
    state.online.latestSnapshot = payload.snapshot || null;
    return;
  }
  if (payload.type === 'match-end' && state.online.role === 'guest') {
    logOnlineWs('match-end-received', {
      roomId: state.online.roomId || null
    });
    state.online.latestSnapshot = payload.snapshot || null;
    return;
  }
  if (payload.type === 'room-closed') {
    logOnlineWs('room-closed', {
      roomId: state.online.roomId || null,
      reason: payload.reason || null
    });
    handleOnlineDisconnect(payload.reason || 'The room was closed.');
  }
}

function ensureOnlineSocket(transport = state.online.transport) {
  if (transport !== 'ws') {
    return Promise.reject(new Error('This browser does not support WebSocket for online mode.'));
  }
  if (state.online.socket && (state.online.socket.readyState === WebSocket.OPEN || state.online.socket.readyState === WebSocket.CONNECTING)) {
    logOnlineWs('reuse-socket', {
      socketState: getSocketStateLabel(state.online.socket),
      roomId: state.online.roomId || null,
      role: state.online.role || null
    });
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    try {
      const url = getOnlineSocketUrl();
      const socket = new WebSocket(url);
      state.online.socket = socket;
      state.online.socketOpen = false;
      logOnlineWs('connect-attempt', {
        url,
        roomId: state.online.roomId || null,
        role: state.online.role || null
      });
      socket.onopen = () => {
        state.online.socketOpen = true;
        logOnlineWs('open', {
          socketState: getSocketStateLabel(socket),
          roomId: state.online.roomId || null,
          role: state.online.role || null
        });
        resolve();
      };
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          logOnlineWs('raw-message', {
            type: parsed?.type || null,
            socketState: getSocketStateLabel(socket)
          });
          handleOnlineMessage(parsed);
        } catch (error) {
          logOnlineWs('parse-error', {
            message: String(error?.message || error || 'invalid payload')
          });
        }
      };
      socket.onerror = (error) => {
        logOnlineWs('error', {
          socketState: getSocketStateLabel(socket),
          roomId: state.online.roomId || null,
          role: state.online.role || null,
          error: error?.message || null
        });
        if (!state.online.socketOpen) reject(new Error('Could not connect to the WebSocket server.'));
      };
      socket.onclose = (event) => {
        logOnlineWs('close', {
          code: event.code,
          reason: event.reason || null,
          wasClean: event.wasClean,
          socketState: getSocketStateLabel(socket),
          roomId: state.online.roomId || null,
          role: state.online.role || null
        });
        if (state.online.socket !== socket) return;
        state.online.socket = null;
        state.online.socketOpen = false;
        if (state.mode === 'online' && (state.running || state.online.roomId)) {
          handleOnlineDisconnect('Connection closed by the server.');
        }
      };
    } catch {
      logOnlineWs('connect-failed', {
        roomId: state.online.roomId || null,
        role: state.online.role || null
      });
      state.online.socket = null;
      state.online.socketOpen = false;
      reject(new Error('Could not connect to the WebSocket server.'));
    }
  });
}

function sendLocalInput(force = false) {
  if (state.mode !== 'online' || state.online.role !== 'guest') return;
  const now = Date.now();
  if (!force && now - state.online.lastInputPushAt < ONLINE_INPUT_PUSH_INTERVAL_MS) return;
  state.online.lastInputPushAt = now;
  sendOnlineMessage({
    type: 'input',
    roomId: state.online.roomId,
    role: state.online.role,
    sessionId: state.online.sessionId,
    pressed: { ...state.online.localControls.pressed }
  });
}

function updateControlState(controlState, code, isDown) {
  if (!controlState) return;
  if (code === 'KeyA' || code === 'KeyD') {
    controlState.pressed[code] = isDown;
  }
  if (isDown && code === 'KeyW') {
    controlState.jumpQueued = true;
  }
  if (isDown && code === 'KeyJ') {
    controlState.attack1Queued = true;
  }
  if (isDown && code === 'KeyK') {
    controlState.attack2Queued = true;
  }
}

function isAttackControlCode(code) {
  return code === 'KeyW' || code === 'KeyJ' || code === 'KeyK';
}

function getOnlineCommandForCode(code) {
  if (code === 'KeyW') return 'jump';
  if (code === 'KeyJ') return 'attack1';
  if (code === 'KeyK') return 'attack2';
  return null;
}

function clearTouchButtonStates() {
  if (!dom.touchControls) return;
  dom.touchControls.querySelectorAll('.is-pressed').forEach((button) => {
    button.classList.remove('is-pressed');
  });
}

function handleControlChange(code, isDown) {
  if (state.mode === 'online') {
    updateControlState(state.online.localControls, code, isDown);
    if (state.online.role === 'guest') {
      const command = isDown ? getOnlineCommandForCode(code) : null;
      if (command) {
        sendOnlineMessage({
          type: 'command',
          roomId: state.online.roomId,
          role: state.online.role,
          sessionId: state.online.sessionId,
          command
        });
      }
      sendLocalInput(true);
    }
    return;
  }
  updateControlState(state.localControls, code, isDown);
}

function bindTouchControls() {
  if (!dom.touchControls) return;
  dom.touchControls.querySelectorAll('[data-code]').forEach((button) => {
    const code = button.dataset.code;
    if (!code) return;
    const pointerState = new Set();
    const setPressed = (isDown) => {
      button.classList.toggle('is-pressed', isDown);
      handleControlChange(code, isDown);
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (pointerState.has(event.pointerId)) return;
      pointerState.add(event.pointerId);
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures on browsers that do not support it reliably.
      }
      setPressed(true);
    });
    const release = (event) => {
      if (!pointerState.has(event.pointerId)) return;
      pointerState.delete(event.pointerId);
      try {
        button.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures when capture was not established.
      }
      if (pointerState.size === 0) {
        setPressed(false);
      }
    };
    button.addEventListener('pointerup', (event) => {
      event.preventDefault();
      release(event);
    });
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', (event) => {
      release(event);
    });
  });
}

function getAssetCandidates(folder, fileName) {
  return ASSET_ROOT_CANDIDATES.map((root) => `${root}/${folder}/${fileName}`);
}

function getCharacterCandidates(character) {
  return [character.folder];
}

function loadImageWithFallback(img, candidates, onFailure, onLoad) {
  let index = 0;
  const tryNext = () => {
    if (index >= candidates.length) {
      if (typeof onFailure === 'function') onFailure();
      return;
    }
    img.src = candidates[index];
    index += 1;
  };

  img.onload = () => {
    if (typeof onLoad === 'function') onLoad(img);
  };
  img.onerror = () => tryNext();
  tryNext();
}

function getActionCandidates(action) {
  return [action];
}

function getActionFileNameCandidates(name) {
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  if (name === 'attack1') return ['Attack_1.png', 'Attack1.png', `${capitalized}.png`];
  if (name === 'attack2') return ['Attack_2.png', 'Attack2.png', `${capitalized}.png`];
  if (name === 'ko') return ['Dead.png', `${capitalized}.png`];
  if (name === 'dead') return ['Dead..png', 'Dead.png', `${capitalized}.png`];
  return [`${capitalized}.png`];
}

function getActionAssetCandidates(folder, action) {
  return getActionCandidates(action).flatMap((name) => getActionFileNameCandidates(name).flatMap((fileName) => getAssetCandidates(folder, fileName)));
}

function getActionAssetCandidatesForCharacter(character, action) {
  return getCharacterCandidates(character).flatMap((folder) => getActionAssetCandidates(folder, action));
}

function getSpriteForAction(sprites, action) {
  return sprites[action] || sprites.idle;
}

function renderSpritePreview(img) {
  const frameHeight = img.naturalHeight;
  const frameCount = Math.max(1, Math.floor(img.naturalWidth / frameHeight));
  const frameWidth = img.naturalWidth / frameCount;
  const canvas = document.createElement('canvas');
  canvas.className = 'character-sprite';
  canvas.width = frameWidth;
  canvas.height = frameHeight;
  const previewCtx = canvas.getContext('2d');
  previewCtx.drawImage(img, 0, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
  img.replaceWith(canvas);
}

function buildCharacterSelect() {
  dom.characterGrid.innerHTML = characters.map((char) => `
    <article class="character-card" data-char-id="${char.id}">
      <img class="character-sprite" data-folder="${char.folder}" alt="${char.name}" />
      <div class="card-title">${char.name}</div>
    </article>
  `).join('');

  dom.characterGrid.querySelectorAll('img.character-sprite').forEach((img) => {
    const character = characters.find((char) => char.folder === img.dataset.folder);
    const fallbackLabel = img.alt.slice(0, 3).toUpperCase();
    loadImageWithFallback(img, character ? getActionAssetCandidatesForCharacter(character, 'idle') : getAssetCandidates(img.dataset.folder, 'idle.png'), () => {
      const fallback = document.createElement('div');
      fallback.className = 'character-preview';
      fallback.textContent = fallbackLabel;
      img.replaceWith(fallback);
    }, renderSpritePreview);
  });

  dom.characterGrid.querySelectorAll('.character-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (state.mode === 'online' && (state.online.roomId || state.running)) return;
      const charId = card.dataset.charId;
      if (state.mode === 'cpu-duel') {
        if (state.selectedCharacterId === charId) {
          state.selectedCharacterId = null;
        } else if (state.selectedOpponentId === charId) {
          state.selectedOpponentId = null;
        } else if (!state.selectedCharacterId) {
          state.selectedCharacterId = charId;
        } else if (!state.selectedOpponentId) {
          state.selectedOpponentId = charId;
        } else {
          state.selectedOpponentId = charId;
        }
      } else {
        state.selectedCharacterId = charId;
      }
      updateCharacterSelectionUi();
    });
  });
}

function getStartButtonLabel() {
  if (state.mode === 'online') return 'Play Online';
  if (state.mode === 'cpu-duel') return 'Start CPU vs CPU';
  return 'Start Fight';
}

function refreshSubtitle() {
  const subtitle = dom.selectScreen.querySelector('.subtitle');
  if (!subtitle) return;
  subtitle.textContent = state.mode === 'cpu-duel'
    ? 'Choose two fighters for an automated match'
    : 'Choose your fighter';
}

function updateCharacterSelectionUi() {
  const duelMode = state.mode === 'cpu-duel';
  dom.characterGrid.querySelectorAll('.character-card').forEach((card) => {
    const charId = card.dataset.charId;
    const primary = state.selectedCharacterId === charId;
    const secondary = state.selectedOpponentId === charId;
    card.classList.toggle('selected', primary || secondary);
    card.classList.toggle('selected-player', duelMode && primary);
    card.classList.toggle('selected-cpu', duelMode && secondary);
    if (!duelMode) {
      card.classList.remove('selected-player', 'selected-cpu');
    }
  });
  if (state.mode === 'cpu-duel') {
    dom.startFightBtn.disabled = !(state.selectedCharacterId && state.selectedOpponentId && state.selectedCharacterId !== state.selectedOpponentId);
  } else {
    dom.startFightBtn.disabled = !state.selectedCharacterId;
  }
}

function refreshModeUi() {
  const onlineMode = state.mode === 'online';
  dom.modeCpuBtn.classList.toggle('active', state.mode === 'cpu');
  if (dom.modeCpuDuelBtn) dom.modeCpuDuelBtn.classList.toggle('active', state.mode === 'cpu-duel');
  dom.modeOnlineBtn.classList.toggle('active', onlineMode);
  dom.onlinePanel.classList.toggle('hidden', !onlineMode);
  dom.startFightBtn.textContent = getStartButtonLabel();
  if (dom.joinRoomBtn) dom.joinRoomBtn.disabled = !onlineMode;
  if (dom.copyRoomCodeBtn) dom.copyRoomCodeBtn.disabled = true;
  if (dom.roomCode && !state.online.roomId) dom.roomCode.textContent = '-';
  if (dom.roomCodeInput && !state.online.roomId) dom.roomCodeInput.value = '';
  refreshSubtitle();
  if (!onlineMode) {
    setRoomStatus('Choose a fighter and click Play Online to enter the queue.');
    if (dom.copyRoomCodeBtn) dom.copyRoomCodeBtn.disabled = true;
  }
  updateCharacterSelectionUi();
}

function setMode(mode) {
  if (state.mode === mode) return;
  closeOnlineTransport();
  state.mode = mode;
  state.learning.left = null;
  state.learning.right = null;
  state.selectedCharacterId = null;
  state.selectedOpponentId = null;
  dom.characterGrid.querySelectorAll('.character-card').forEach((card) => card.classList.remove('selected'));
  refreshModeUi();
  if (mode === 'online') {
    setRoomStatus('Choose a fighter and click Play Online to enter the queue.');
  }
}

function createSpriteSet(folder) {
  const sprites = {};
  const character = characters.find((char) => char.folder === folder);
  for (const action of ACTIONS) {
    const img = new Image();
    sprites[action] = {
      image: img,
      frameCount: FRAME_COUNT,
      frameWidth: 0,
      frameHeight: 0
    };
    loadImageWithFallback(img, character ? getActionAssetCandidatesForCharacter(character, action) : getActionAssetCandidates(folder, action), undefined, () => {
      const inferredFrameCount = Math.max(1, Math.floor(img.naturalWidth / img.naturalHeight));
      sprites[action].frameCount = inferredFrameCount;
      sprites[action].frameWidth = img.naturalWidth / inferredFrameCount;
      sprites[action].frameHeight = img.naturalHeight;
    });
  }
  return sprites;
}

class Fighter {
  constructor(opts) {
    this.name = opts.name;
    this.x = opts.x;
    this.y = opts.y;
    this.width = 120;
    this.height = 200;
    this.color = opts.color;
    this.faceRight = opts.faceRight;
    this.speed = 6;
    this.jumpPower = -18;
    this.vx = 0;
    this.vy = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.attackCooldown = 0;
    this.attackTime = 0;
    this.attackKind = null;
    this.hurtTime = 0;
    this.ko = false;
    this.sprites = createSpriteSet(opts.folder);
    this.frameTick = 0;
    this.frameIndex = 0;
    this.currentAction = 'idle';
  }

  get hitbox() {
    return { x: this.x - this.width / 2, y: this.y - this.height, w: this.width, h: this.height };
  }

  updateAnimation() {
    const moving = Math.abs(this.vx) > 0.4;
    const nextAction = this.ko
      ? 'ko'
      : this.hurtTime > 0
        ? 'hurt'
        : this.attackTime > 0
          ? this.attackKind
          : this.vy < -2
            ? 'jump'
            : moving
              ? 'walk'
              : 'idle';

    if (nextAction !== this.currentAction) {
      this.currentAction = nextAction;
      this.frameTick = 0;
      this.frameIndex = 0;
      return;
    }

    this.frameTick += 1;
    if (this.frameTick >= 6) {
      this.frameTick = 0;
      const frameCount = getSpriteForAction(this.sprites, this.currentAction)?.frameCount || FRAME_COUNT;
      if (this.currentAction === 'ko') {
        this.frameIndex = Math.min(this.frameIndex + 1, frameCount - 1);
      } else {
        this.frameIndex = (this.frameIndex + 1) % frameCount;
      }
    }
  }

  updatePhysics() {
    if (!this.ko) {
      this.x += this.vx;
      this.vy += GRAVITY;
      this.y += this.vy;
    }
    if (this.y >= GROUND_Y) {
      this.y = GROUND_Y;
      this.vy = 0;
    }
    this.x = Math.max(60, Math.min(GAME_WIDTH - 60, this.x));
    if (this.attackCooldown > 0) this.attackCooldown -= 1;
    if (this.attackTime > 0) this.attackTime -= 1;
    if (this.hurtTime > 0) this.hurtTime -= 1;
  }

  canAct() {
    return !this.ko && this.attackTime <= 0 && this.hurtTime <= 0;
  }

  jump() {
    if (this.canAct() && this.y >= GROUND_Y) this.vy = this.jumpPower;
  }

  attack(kind) {
    if (!this.canAct() || this.attackCooldown > 0) return;
    this.attackKind = kind;
    this.attackTime = kind === 'attack2' ? 22 : 18;
    this.attackCooldown = kind === 'attack2' ? 36 : 28;
  }

  damage(amount) {
    if (this.ko) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hurtTime = 12;
    if (this.hp <= 0) {
      this.ko = true;
      this.vx = 0;
    }
  }

  draw() {
    const hb = this.hitbox;
    const sprite = getSpriteForAction(this.sprites, this.currentAction);
    ctx.save();
    if (!this.faceRight) {
      ctx.translate(this.x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-this.x, 0);
    }
    if (sprite?.image.complete && sprite.image.naturalWidth > 0 && sprite.frameWidth > 0) {
      const sx = Math.min(this.frameIndex, sprite.frameCount - 1) * sprite.frameWidth;
      ctx.drawImage(
        sprite.image,
        sx,
        0,
        sprite.frameWidth,
        sprite.frameHeight,
        hb.x - 35,
        hb.y - 30,
        hb.w + 70,
        hb.h + 30
      );
    } else {
      ctx.fillStyle = this.color;
      ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
    }
    ctx.restore();
  }

  attackBox() {
    if (this.attackTime <= 0) return null;
    const reach = this.attackKind === 'attack2' ? 95 : 70;
    const y = this.y - this.height + 45;
    const h = this.attackKind === 'attack2' ? 70 : 55;
    const x = this.faceRight ? this.x + this.width / 2 - 8 : this.x - this.width / 2 - reach + 8;
    return { x, y, w: reach, h };
  }
}

function setupOnlineSession(roomId, role, sessionId, transport = state.online.transport) {
  logOnlineWs('setup-session', {
    roomId: roomId || null,
    role,
    sessionId: sessionId || null,
    transport: transport || state.online.transport || getPreferredOnlineTransport()
  });
  if (state.online.connectionTimeoutId) {
    clearTimeout(state.online.connectionTimeoutId);
    state.online.connectionTimeoutId = null;
  }
  if (state.online.pollIntervalId) {
    clearInterval(state.online.pollIntervalId);
    state.online.pollIntervalId = null;
  }
  state.online.roomId = roomId;
  state.online.role = role;
  state.online.sessionId = sessionId;
  state.online.transport = transport || state.online.transport || getPreferredOnlineTransport();
  state.online.connected = false;
  state.online.localControls = createControlState();
  state.online.remoteControls = createControlState();
  state.online.latestSnapshot = null;
  state.online.apiAvailable = null;
  state.online.lastStatePushAt = 0;
  state.online.lastInputPushAt = 0;
  state.online.lastCommandId = 0;
  state.online.pollErrorCount = 0;
  state.online.roomMissingCount = 0;
  if (state.online.transport === 'api') {
    state.online.pollIntervalId = setInterval(() => {
      void pollOnlineRoom();
    }, ONLINE_API_POLL_INTERVAL_MS);
    void pollOnlineRoom();
  }
}

function closeOnlineTransport(closeSocket = true) {
  logOnlineWs('close-transport', {
    closeSocket,
    socketState: getSocketStateLabel(state.online.socket),
    roomId: state.online.roomId || null,
    role: state.online.role || null
  });
  if (state.online.connectionTimeoutId) {
    clearTimeout(state.online.connectionTimeoutId);
  }
  if (state.online.pollIntervalId) {
    clearInterval(state.online.pollIntervalId);
  }
  if (closeSocket && state.online.socket) {
    state.online.socket.close();
  }
  state.online.socket = closeSocket ? null : state.online.socket;
  state.online.socketOpen = closeSocket ? false : state.online.socketOpen;
  state.online.pollIntervalId = null;
  state.online.pollInFlight = false;
  state.online.pollErrorCount = 0;
  state.online.roomMissingCount = 0;
  state.online.transport = null;
  state.online.sessionId = '';
  state.online.connectionTimeoutId = null;
  state.online.roomId = '';
  state.online.role = null;
  state.online.connected = false;
  state.online.localChoice = null;
  state.online.remoteChoice = null;
  state.online.latestSnapshot = null;
  state.online.localControls = null;
  state.online.remoteControls = null;
  state.online.lastStatePushAt = 0;
  state.online.lastCommandId = 0;
  state.online.statePushInFlight = false;
  state.online.statePushDirty = false;
  state.online.pendingSnapshot = null;
  state.online.pendingMatchStart = null;
  state.online.lastInputPushAt = 0;
  state.online.apiAvailable = null;
}

async function pollOnlineRoom() {
  if (state.online.transport !== 'api' || state.online.pollInFlight || !state.online.roomId || !state.online.role) return;
  state.online.pollInFlight = true;
  try {
    const room = await fetchOnlineRoomState();
    if (!room) {
      state.online.roomMissingCount += 1;
      if (state.online.roomMissingCount < ONLINE_POLL_ROOM_MISS_TOLERANCE) return;
      handleOnlineDisconnect('Connection closed by the server.');
      return;
    }
    state.online.roomMissingCount = 0;
    state.online.pollErrorCount = 0;
    if (room.closed) {
      handleOnlineDisconnect(room.closedReason || 'The room was closed.');
      return;
    }
    if (state.online.role === 'host') {
      state.online.remoteControls.pressed = room.guestControls?.pressed || {};
      for (const command of room.newCommands || []) {
        if (command?.id > state.online.lastCommandId) {
          state.online.lastCommandId = command.id;
        }
        if (command?.command === 'jump') state.online.remoteControls.jumpQueued = true;
        if (command?.command === 'attack1') state.online.remoteControls.attack1Queued = true;
        if (command?.command === 'attack2') state.online.remoteControls.attack2Queued = true;
      }
      if (room.guestChoice && !state.online.connected) {
        state.online.remoteChoice = { ...room.guestChoice };
        state.cpuChoice = { ...room.guestChoice };
        state.online.connected = true;
        if (state.online.connectionTimeoutId) {
          clearTimeout(state.online.connectionTimeoutId);
          state.online.connectionTimeoutId = null;
        }
        setRoomStatus(`Opponent connected: ${state.cpuChoice?.name || 'Guest'}. Starting match...`);
        state.overlayMessage = 'OPONENTE CONECTADO';
        startOnlineMatch();
      }
      return;
    }
    const latestSnapshot = room.latestSnapshot || null;
    const matchStarted = Boolean(room.matchStarted);
    state.playerChoice = state.online.localChoice ? { ...state.online.localChoice } : state.playerChoice;
    if (room.hostChoice && !state.cpuChoice) {
      state.cpuChoice = { ...room.hostChoice };
    }
    if (latestSnapshot) {
      state.online.latestSnapshot = latestSnapshot;
    }
    if (!state.running && (latestSnapshot || matchStarted)) {
      const fallbackSnapshot = latestSnapshot || {
        playerChoice: room.hostChoice || state.cpuChoice || null,
        cpuChoice: room.guestChoice || state.playerChoice || null,
        round: state.round || 1,
        timer: state.timer || ROUND_TIME,
        playerRoundWins: 0,
        cpuRoundWins: 0,
        roundOver: false,
        gameOver: false,
        overlayMessage: ''
      };
      state.online.connected = true;
      startOnlineMatch(fallbackSnapshot);
      return;
    }
    if (state.running && latestSnapshot) {
      applyMatchSnapshot(latestSnapshot);
    }
  } catch (error) {
    if (state.mode === 'online') {
      state.online.pollErrorCount += 1;
      if (state.online.pollErrorCount < ONLINE_POLL_ERROR_TOLERANCE) return;
      handleOnlineDisconnect(error?.message || 'Connection closed by the server.');
    }
  } finally {
    state.online.pollInFlight = false;
  }
}

function buildMatchSnapshot() {
  return {
    player: serializeFighter(player),
    cpu: serializeFighter(cpu),
    playerChoice: state.playerChoice,
    cpuChoice: state.cpuChoice,
    round: state.round,
    timer: state.timer,
    playerRoundWins: state.playerRoundWins,
    cpuRoundWins: state.cpuRoundWins,
    roundOver: state.roundOver,
    gameOver: state.gameOver,
    overlayMessage: state.overlayMessage,
    playerName: state.playerChoice?.name || 'JOGADOR 1',
    enemyName: state.cpuChoice?.name || 'JOGADOR 2'
  };
}

function isOnlineGuestPerspective() {
  return state.mode === 'online' && state.online.role === 'guest';
}

function broadcastMatchState(force = false) {
  if (state.mode !== 'online' || state.online.role !== 'host' || !state.online.roomId) return;
  const now = Date.now();
  const statePushInterval = state.online.transport === 'api' ? 250 : ONLINE_STATE_PUSH_INTERVAL_MS;
  if (!force && now - state.online.lastStatePushAt < statePushInterval) return;
  state.online.lastStatePushAt = now;
  const snapshot = buildMatchSnapshot();
  if (state.online.transport === 'api') {
    void postOnlineAction({
      type: 'state',
      roomId: state.online.roomId,
      role: state.online.role,
      sessionId: state.online.sessionId,
      snapshot
    }).catch(() => {});
    return;
  }
  if (state.online.statePushInFlight) {
    state.online.statePushDirty = true;
    state.online.pendingSnapshot = snapshot;
    return;
  }
  state.online.statePushInFlight = true;
  const sent = sendOnlineMessage({
    type: 'state',
    roomId: state.online.roomId,
    role: state.online.role,
    sessionId: state.online.sessionId,
    snapshot
  });
  state.online.statePushInFlight = false;
  if (!sent) return;
  if (!state.online.statePushDirty || state.mode !== 'online' || state.online.role !== 'host' || !state.online.roomId) return;
  state.online.statePushDirty = false;
  const pendingSnapshot = state.online.pendingSnapshot || buildMatchSnapshot();
  state.online.pendingSnapshot = null;
  state.online.lastStatePushAt = Date.now();
  sendOnlineMessage({
    type: 'state',
    roomId: state.online.roomId,
    role: state.online.role,
    sessionId: state.online.sessionId,
    snapshot: pendingSnapshot
  });
}

function applyMatchSnapshot(snapshot) {
  if (!snapshot) return;
  const isGuest = isOnlineGuestPerspective();
  const playerSnapshot = isGuest ? snapshot.cpu : snapshot.player;
  const cpuSnapshot = isGuest ? snapshot.player : snapshot.cpu;
  applyFighterSnapshot(player, playerSnapshot);
  applyFighterSnapshot(cpu, cpuSnapshot);
  state.round = snapshot.round;
  state.timer = snapshot.timer;
  state.playerRoundWins = isGuest ? snapshot.cpuRoundWins : snapshot.playerRoundWins;
  state.cpuRoundWins = isGuest ? snapshot.playerRoundWins : snapshot.cpuRoundWins;
  state.roundOver = snapshot.roundOver;
  state.gameOver = snapshot.gameOver;
  state.overlayMessage = snapshot.overlayMessage;
  dom.playerName.textContent = isGuest ? (snapshot.enemyName || dom.playerName.textContent) : (snapshot.playerName || dom.playerName.textContent);
  dom.enemyName.textContent = isGuest ? (snapshot.playerName || dom.enemyName.textContent) : (snapshot.enemyName || dom.enemyName.textContent);
}

function startOnlineMatch(snapshot) {
  if (!snapshot) {
    state.playerChoice = state.playerChoice || { ...state.online.localChoice };
    state.cpuChoice = state.cpuChoice || (state.online.remoteChoice ? { ...state.online.remoteChoice } : null);
    if (!state.playerChoice || !state.cpuChoice) return;
    state.running = true;
    state.roundOver = false;
    state.gameOver = false;
    startRound(true);
    const snapshotPayload = buildMatchSnapshot();
    sendOnlineMessage({
      type: 'match-start',
      roomId: state.online.roomId,
      role: state.online.role,
      sessionId: state.online.sessionId,
      hostChoice: state.playerChoice,
      guestChoice: state.cpuChoice,
      snapshot: snapshotPayload
    });
    broadcastMatchState(true);
  } else {
    state.running = true;
    state.roundOver = false;
    state.gameOver = false;
    if (state.online.role === 'guest') {
      state.playerChoice = state.online.localChoice ? { ...state.online.localChoice } : (state.playerChoice || snapshot.cpuChoice);
      state.cpuChoice = state.cpuChoice || snapshot.playerChoice || (state.online.remoteChoice ? { ...state.online.remoteChoice } : null);
    } else {
      state.playerChoice = state.playerChoice || snapshot.playerChoice || { ...state.online.localChoice };
      state.cpuChoice = state.cpuChoice || snapshot.cpuChoice || (state.online.remoteChoice ? { ...state.online.remoteChoice } : null);
    }
    if (!state.playerChoice || !state.cpuChoice) return;
    startRound(false);
    applyMatchSnapshot(snapshot);
  }
  dom.selectScreen.classList.remove('active');
  dom.fightScreen.classList.add('active');
  if (state.online.role === 'host') {
    requestAnimationFrame(tick);
  } else {
    requestAnimationFrame(tick);
  }
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function getFighterRenderRect(fighter) {
  const hb = fighter.hitbox;
  return {
    x: Math.round(hb.x - 35),
    y: Math.round(hb.y - 30),
    w: Math.round(hb.w + 70),
    h: Math.round(hb.h + 30)
  };
}

function getFighterPixelMask(fighter) {
  const sprite = getSpriteForAction(fighter.sprites, fighter.currentAction);
  if (!sprite?.image.complete || sprite.image.naturalWidth <= 0 || sprite.frameWidth <= 0 || sprite.frameHeight <= 0) {
    return null;
  }

  const rect = getFighterRenderRect(fighter);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = Math.max(1, rect.w);
  maskCanvas.height = Math.max(1, rect.h);
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx) return null;

  const frameIndex = Math.min(fighter.frameIndex, sprite.frameCount - 1);
  const sx = frameIndex * sprite.frameWidth;

  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  maskCtx.save();
  if (!fighter.faceRight) {
    maskCtx.translate(maskCanvas.width, 0);
    maskCtx.scale(-1, 1);
  }
  maskCtx.drawImage(
    sprite.image,
    sx,
    0,
    sprite.frameWidth,
    sprite.frameHeight,
    0,
    0,
    maskCanvas.width,
    maskCanvas.height
  );
  maskCtx.restore();

  const pixels = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  const opaque = new Uint8Array(maskCanvas.width * maskCanvas.height);
  let hasOpaquePixels = false;
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    if (pixels[i + 3] > 16) {
      opaque[p] = 1;
      hasOpaquePixels = true;
    }
  }

  if (!hasOpaquePixels) return null;
  return { x: rect.x, y: rect.y, w: maskCanvas.width, h: maskCanvas.height, pixels: opaque };
}

function pixelMasksIntersect(a, b) {
  if (!a || !b) return false;
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (left >= right || top >= bottom) return false;

  const width = right - left;
  const height = bottom - top;
  const aOffsetX = left - a.x;
  const aOffsetY = top - a.y;
  const bOffsetX = left - b.x;
  const bOffsetY = top - b.y;

  for (let y = 0; y < height; y += 1) {
    const aRow = (aOffsetY + y) * a.w;
    const bRow = (bOffsetY + y) * b.w;
    for (let x = 0; x < width; x += 1) {
      if (a.pixels[aRow + aOffsetX + x] && b.pixels[bRow + bOffsetX + x]) {
        return true;
      }
    }
  }

  return false;
}

function drawArena() {
  const sky = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
  sky.addColorStop(0, '#334155');
  sky.addColorStop(1, '#0f172a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, GROUND_Y + 10, GAME_WIDTH, GAME_HEIGHT - GROUND_Y);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 10);
  ctx.lineTo(GAME_WIDTH, GROUND_Y + 10);
  ctx.stroke();
}

function updateFacing() {
  player.faceRight = player.x < cpu.x;
  cpu.faceRight = cpu.x < player.x;
}

function applyPlayerInput() {
  if (!state.running || state.roundOver || state.gameOver) return;
  if (state.mode === 'online') {
    applyControlStateToFighter(player, state.online.localControls);
    if (state.online.role === 'host') {
      applyControlStateToFighter(cpu, state.online.remoteControls);
    }
    return;
  }
  if (state.mode === 'cpu-duel') return;
  applyControlStateToFighter(player, state.localControls);
}

function cpuAI() {
  if (state.mode === 'online') return;
  if (!state.running || state.roundOver || state.gameOver) return;
  const runAi = (fighter, target) => {
    if (!fighter || !target) return;
    const runtime = getLearningRuntimeForFighter(fighter);
    processLearningPending(runtime, fighter);
    if (!fighter.canAct()) {
      fighter.vx = 0;
      return;
    }
    const dist = target.x - fighter.x;
    const absDist = Math.abs(dist);
    const enemyAction = normalizeEnemyAction(target.currentAction);
    const preferredResponse = getPreferredResponseAction(runtime, enemyAction);
    let responseMove = 'idle';

    if (absDist > 130 || preferredResponse === 'advance') {
      fighter.vx = dist > 0 ? fighter.speed * 0.75 : -fighter.speed * 0.75;
      responseMove = 'advance';
    } else if (preferredResponse === 'retreat') {
      fighter.vx = dist > 0 ? -fighter.speed * 0.6 : fighter.speed * 0.6;
      responseMove = 'retreat';
    } else {
      fighter.vx = (Math.random() > 0.5 ? 1 : -1) * fighter.speed * 0.35;
      responseMove = fighter.vx === 0 ? 'idle' : 'walk';
    }
    if (responseMove === 'advance' || responseMove === 'retreat') {
      recordMovementDecision(runtime, enemyAction, responseMove);
    }

    let jumpChance = 0.008;
    if (preferredResponse === 'jump') jumpChance += 0.03;
    if (Math.random() < jumpChance) {
      fighter.jump();
      registerAiDecision(runtime, enemyAction, 'jump');
    }

    const attack1Boost = scoreAttackFromLearning(runtime, 'attack1');
    const attack2Boost = scoreAttackFromLearning(runtime, 'attack2');
    let chance1 = absDist < 150 ? 0.05 : 0;
    let chance2 = absDist < 130 ? 0.03 : 0;
    chance1 *= attack1Boost;
    chance2 *= attack2Boost;
    chance1 += chooseBestSequenceBoost(runtime, 'attack1');
    chance2 += chooseBestSequenceBoost(runtime, 'attack2');
    if (preferredResponse === 'attack1') chance1 += 0.035;
    if (preferredResponse === 'attack2') chance2 += 0.035;
    chance1 = Math.min(0.32, Math.max(0, chance1));
    chance2 = Math.min(0.28, Math.max(0, chance2));

    if (chance1 > 0 && Math.random() < chance1) {
      const previousAttackTime = fighter.attackTime;
      fighter.attack('attack1');
      if (fighter.attackTime > previousAttackTime) {
        recordAttackAttempt(runtime, enemyAction, 'attack1');
      }
    }
    if (chance2 > 0 && Math.random() < chance2) {
      const previousAttackTime = fighter.attackTime;
      fighter.attack('attack2');
      if (fighter.attackTime > previousAttackTime) {
        recordAttackAttempt(runtime, enemyAction, 'attack2');
      }
    }
  };
  if (state.mode === 'cpu-duel') {
    runAi(player, cpu);
    runAi(cpu, player);
    return;
  }
  if (cpu.ko) return;
  runAi(cpu, player);
}

function resolveAttacks() {
  if (state.mode === 'online' && state.online.role === 'guest') return;
  const playerMask = getFighterPixelMask(player);
  const cpuMask = getFighterPixelMask(cpu);
  if (player.attackTime >= 10 && pixelMasksIntersect(playerMask, cpuMask) && cpu.hurtTime <= 0) {
    const damage = player.attackKind === 'attack2' ? 12 : 8;
    cpu.damage(damage);
    cpu.vx += player.faceRight ? 6 : -6;
    recordAttackHit(getLearningRuntimeForFighter(player), player.attackKind, damage);
  }
  if (cpu.attackTime >= 10 && pixelMasksIntersect(cpuMask, playerMask) && player.hurtTime <= 0) {
    const damage = cpu.attackKind === 'attack2' ? 12 : 8;
    player.damage(damage);
    player.vx += cpu.faceRight ? 6 : -6;
    recordAttackHit(getLearningRuntimeForFighter(cpu), cpu.attackKind, damage);
  }
}

function refreshHud() {
  dom.playerHealth.style.width = `${(player.hp / player.maxHp) * 100}%`;
  dom.enemyHealth.style.width = `${(cpu.hp / cpu.maxHp) * 100}%`;
  dom.roundCount.textContent = String(state.round);
  dom.timer.textContent = String(state.timer).padStart(2, '0');
  const makeRoundDots = (wins) => {
    let html = '';
    for (let i = 0; i < MAX_ROUNDS; i += 1) html += `<span class="round-dot ${i < wins ? 'win' : ''}"></span>`;
    return html;
  };
  dom.playerRounds.innerHTML = makeRoundDots(state.playerRoundWins);
  dom.enemyRounds.innerHTML = makeRoundDots(state.cpuRoundWins);
  dom.overlayText.textContent = state.overlayMessage;
}

function getRoundOverlayText(winner) {
  if (winner === 'draw') return 'DRAW';
  if (state.mode === 'cpu-duel') {
    const winningName = winner === 'player' ? state.playerChoice?.name : state.cpuChoice?.name;
    return winningName ? `${winningName.toUpperCase()} ROUND` : 'ROUND';
  }
  return winner === 'player' ? 'PLAYER ROUND' : 'CPU ROUND';
}

function getMatchEndText() {
  if (state.mode === 'cpu-duel') {
    return state.playerRoundWins > state.cpuRoundWins
      ? `${state.playerChoice?.name?.toUpperCase() || 'LEFT SIDE'} WINS!`
      : `${state.cpuChoice?.name?.toUpperCase() || 'RIGHT SIDE'} WINS!`;
  }
  return state.playerRoundWins > state.cpuRoundWins ? 'VICTORY!' : 'DEFEAT!';
}

function updateRoundState() {
  if (state.mode === 'online' && state.online.role === 'guest') return;
  if (state.roundOver || state.gameOver) return;
  if (player.hp <= 0 || cpu.hp <= 0 || state.timer <= 0) {
    state.roundOver = true;
    let winner = null;
    if (player.hp === cpu.hp) winner = 'draw';
    else if (player.hp > cpu.hp) winner = 'player';
    else winner = 'cpu';
    if (winner === 'player') state.playerRoundWins += 1;
    if (winner === 'cpu') state.cpuRoundWins += 1;
    if (state.playerRoundWins >= MAX_ROUNDS || state.cpuRoundWins >= MAX_ROUNDS) {
      state.gameOver = true;
      state.overlayMessage = getMatchEndText();
      if (state.mode === 'cpu' || state.mode === 'cpu-duel') {
        const resultByCpuId = {};
        if (state.mode === 'cpu') {
          resultByCpuId[state.cpuChoice.id] = state.cpuRoundWins > state.playerRoundWins;
        } else {
          resultByCpuId[state.playerChoice.id] = state.playerRoundWins > state.cpuRoundWins;
          resultByCpuId[state.cpuChoice.id] = state.cpuRoundWins > state.playerRoundWins;
        }
        void flushCpuLearning(resultByCpuId);
      }
      clearInterval(timerInterval);
      const snapshotPayload = buildMatchSnapshot();
      sendOnlineMessage({
        type: 'match-end',
        roomId: state.online.roomId,
        role: state.online.role,
        sessionId: state.online.sessionId,
        snapshot: snapshotPayload
      });
      broadcastMatchState(true);
      return;
    }
    state.overlayMessage = getRoundOverlayText(winner);
    clearInterval(timerInterval);
    broadcastMatchState();
    setTimeout(() => {
      state.round += 1;
      startRound(false);
    }, 1800);
  }
}

function tick() {
  if (!state.running) return;
  if (state.mode === 'online' && state.online.role === 'guest') {
    sendLocalInput();
    drawArena();
    if (state.online.latestSnapshot) {
      applyMatchSnapshot(state.online.latestSnapshot);
      state.online.latestSnapshot = null;
    }
    applyPlayerInput();
    player.updatePhysics();
    updateFacing();
    player.updateAnimation();
    cpu.updateAnimation();
    player.draw();
    cpu.draw();
    refreshHud();
    requestAnimationFrame(tick);
    return;
  }
  drawArena();
  applyPlayerInput();
  cpuAI();
  player.updatePhysics();
  cpu.updatePhysics();
  updateFacing();
  resolveAttacks();
  player.updateAnimation();
  cpu.updateAnimation();
  player.draw();
  cpu.draw();
  updateRoundState();
  refreshHud();
  if (state.mode === 'online') {
    broadcastMatchState();
  }
  requestAnimationFrame(tick);
}

function startTimer() {
  if (state.mode === 'online' && state.online.role === 'guest') return;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!state.roundOver && !state.gameOver && state.timer > 0) state.timer -= 1;
  }, 1000);
}

function startRound(showIntro = true) {
  state.roundOver = false;
  state.timer = ROUND_TIME;
  player = new Fighter({
    name: state.playerChoice.name,
    folder: state.playerChoice.folder,
    color: state.playerChoice.color,
    x: 290,
    y: GROUND_Y,
    faceRight: true
  });
  cpu = new Fighter({
    name: state.cpuChoice.name,
    folder: state.cpuChoice.folder,
    color: state.cpuChoice.color,
    x: 910,
    y: GROUND_Y,
    faceRight: false
  });
  dom.playerName.textContent = state.playerChoice.name;
  dom.enemyName.textContent = state.mode === 'online' ? state.cpuChoice.name : `${state.cpuChoice.name} (CPU)`;
  if (showIntro) {
    state.overlayMessage = 'READY?';
    setTimeout(() => {
      state.overlayMessage = 'FIGHT!';
      setTimeout(() => {
        state.overlayMessage = '';
      }, 850);
    }, 600);
  } else {
    state.overlayMessage = 'FIGHT!';
    setTimeout(() => {
      state.overlayMessage = '';
    }, 700);
  }
  if (state.mode === 'cpu' || state.mode === 'cpu-duel' || state.online.role === 'host') {
    startTimer();
  }
  if (state.mode === 'online' && state.online.role === 'host') {
    broadcastMatchState();
  }
}

async function beginFight() {
  const selected = characters.find((c) => c.id === state.selectedCharacterId);
  if (!selected) return;
  if (state.mode === 'cpu') {
    const cpuPool = characters.filter((c) => c.id !== selected.id);
    const cpuSelected = cpuPool[Math.floor(Math.random() * cpuPool.length)];
    state.playerChoice = { ...selected };
    state.cpuChoice = { ...cpuSelected };
    state.playerRoundWins = 0;
    state.cpuRoundWins = 0;
    state.round = 1;
    state.gameOver = false;
    await initializeCpuLearningContexts();
    state.running = true;
    dom.selectScreen.classList.remove('active');
    dom.fightScreen.classList.add('active');
    startRound(true);
    requestAnimationFrame(tick);
    return;
  }
  if (state.mode === 'cpu-duel') {
    const opponent = characters.find((c) => c.id === state.selectedOpponentId);
    if (!selected || !opponent || selected.id === opponent.id) return;
    state.playerChoice = { ...selected };
    state.cpuChoice = { ...opponent };
    state.playerRoundWins = 0;
    state.cpuRoundWins = 0;
    state.round = 1;
    state.gameOver = false;
    await initializeCpuLearningContexts();
    state.running = true;
    dom.selectScreen.classList.remove('active');
    dom.fightScreen.classList.add('active');
    startRound(true);
    requestAnimationFrame(tick);
    return;
  }
  if (state.running || state.online.roomId || state.online.role) {
    return;
  }
  if (!canUseOnlineTransport()) {
    setRoomStatus('Multiplayer exige HTTP/HTTPS.');
    return;
  }
  state.online.localChoice = { ...selected };
  try {
    const primaryTransport = await resolveOnlineTransport();
    if (!primaryTransport) {
      throw new Error('Could not start online mode in this browser.');
    }
    const transports = [primaryTransport, ...getOnlineTransportCandidates().filter((transport) => transport !== primaryTransport)];
    let lastError = null;
    for (const transport of transports) {
      try {
        state.online.transport = transport;
        logOnlineWs('queue-join-attempt', {
          transport,
          selectedCharacter: selected?.name || null
        });
        if (transport === 'api') {
          const response = await postOnlineAction({
            type: 'play',
            choice: state.online.localChoice
          });
          state.playerChoice = { ...selected };
          handleOnlineMessage({
            type: response.role === 'host' ? 'created' : 'joined',
            roomId: response.roomId,
            sessionId: response.sessionId,
            hostChoice: response.hostChoice || null
          });
        } else {
          await ensureOnlineSocket('ws');
          state.playerChoice = { ...selected };
          logOnlineWs('queue-join-sent', {
            transport,
            selectedCharacter: selected?.name || null
          });
          sendOnlineMessage({
            type: 'play',
            choice: state.online.localChoice
          });
          setRoomStatus('Searching for opponent...');
        }
        dom.startFightBtn.disabled = true;
        if (dom.joinRoomBtn) dom.joinRoomBtn.disabled = true;
        return;
      } catch (error) {
        lastError = error;
        if (transport === 'ws') {
          state.online.socket = null;
          state.online.socketOpen = false;
        }
      }
    }
    throw lastError || new Error('Could not join the online queue.');
  } catch (error) {
    setRoomStatus(error?.message || 'Could not join the online queue.');
  }
}

function resetToSelect() {
  logOnlineWs('reset-to-select', {
    roomId: state.online.roomId || null,
    role: state.online.role || null,
    running: state.running
  });
  if (state.mode === 'online' && state.online.role === 'host' && state.online.roomId) {
    sendOnlineMessage({
      type: 'close',
      roomId: state.online.roomId,
      role: state.online.role,
      sessionId: state.online.sessionId
    });
  }
  state.running = false;
  clearInterval(timerInterval);
  state.localControls = {
    pressed: {},
    jumpQueued: false,
    attack1Queued: false,
    attack2Queued: false
  };
  clearControlState(state.online.localControls || createControlState());
  clearControlState(state.online.remoteControls || createControlState());
  state.learning.left = null;
  state.learning.right = null;
  state.overlayMessage = '';
  clearTouchButtonStates();
  closeOnlineTransport();
  refreshModeUi();
  dom.fightScreen.classList.remove('active');
  dom.selectScreen.classList.add('active');
  updateCharacterSelectionUi();
}

window.addEventListener('keydown', (event) => {
  if (!state.running || state.roundOver || state.gameOver) return;
  handleControlChange(event.code, true);
  if (isAttackControlCode(event.code)) event.preventDefault();
});

window.addEventListener('keyup', (event) => {
  if (!state.running || state.roundOver || state.gameOver) return;
  handleControlChange(event.code, false);
});

dom.modeCpuBtn.addEventListener('click', () => setMode('cpu'));
if (dom.modeCpuDuelBtn) dom.modeCpuDuelBtn.addEventListener('click', () => setMode('cpu-duel'));
dom.modeOnlineBtn.addEventListener('click', () => setMode('online'));
dom.startFightBtn.addEventListener('click', beginFight);
dom.backSelectBtn.addEventListener('click', resetToSelect);
if (dom.joinRoomBtn) dom.joinRoomBtn.classList.add('hidden');
if (dom.roomCodeInput) dom.roomCodeInput.classList.add('hidden');
if (dom.copyRoomCodeBtn) dom.copyRoomCodeBtn.classList.add('hidden');
if (dom.roomCode) dom.roomCode.textContent = '-';

bindTouchControls();
buildCharacterSelect();
refreshModeUi();
