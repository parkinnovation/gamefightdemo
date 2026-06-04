const GAME_WIDTH = 1200;
const GAME_HEIGHT = 620;
const GROUND_Y = 530;
const GRAVITY = 0.95;
const ROUND_TIME = 60;
const MAX_ROUNDS = 2;
const ASSET_ROOT_CANDIDATES = ['/AssetsGame', 'AssetsGame'];
const FRAME_COUNT = 12;
const ONLINE_CONNECTION_TIMEOUT_MS = 10000;
const ONLINE_POLL_INTERVAL_MS = 80;
const ONLINE_STATE_PUSH_INTERVAL_MS = 80;
const ONLINE_API_PATH = '/api/rooms';

const characters = [
  { id: 'fighter', name: 'Fighter', folder: 'Fighter', folderCandidates: ['Fighter', 'fighter', 'character1'], color: '#38bdf8' },
  { id: 'samurai', name: 'Samurai', folder: 'Samurai', folderCandidates: ['Samurai', 'samurai', 'character2'], color: '#fb7185' },
  { id: 'shinobi', name: 'Shinobi', folder: 'Shinobi', folderCandidates: ['Shinobi', 'shinobi', 'character3'], color: '#facc15' }
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
  playerChoice: null,
  cpuChoice: null,
  online: {
    roomId: '',
    role: null,
    sessionId: '',
    connectionTimeoutId: null,
    pollIntervalId: null,
    connected: false,
    localChoice: null,
    remoteChoice: null,
    latestSnapshot: null,
    localControls: null,
    remoteControls: null,
    lastCommandId: 0,
    lastStatePushAt: 0
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
  }
};

const dom = {
  selectScreen: document.getElementById('character-select'),
  fightScreen: document.getElementById('fight-screen'),
  modeCpuBtn: document.getElementById('mode-cpu'),
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
  canvas: document.getElementById('game-canvas')
};

const ctx = dom.canvas.getContext('2d');
let player;
let cpu;
let timerInterval;

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

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
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
  return window.location.protocol !== 'file:' && typeof window.fetch === 'function';
}

async function onlineApiRequest(body) {
  const response = await fetch(ONLINE_API_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let message = 'Falha na comunicacao com o servidor.';
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      // Ignore JSON parsing errors.
    }
    throw new Error(message);
  }
  return response.json();
}

async function pollOnlineSync() {
  if (!state.online.roomId || !state.online.role) return;
  const params = new URLSearchParams({
    roomId: state.online.roomId,
    role: state.online.role
  });
  if (state.online.role === 'host') {
    params.set('since', String(state.online.lastCommandId));
  }
  const response = await fetch(`${ONLINE_API_PATH}?${params.toString()}`);
  if (!response.ok) return;
  const payload = await response.json();
  if (!payload?.ok || !payload.room) return;
  const room = payload.room;
  if (room.closed) {
    throw new Error('A sala foi encerrada.');
  }
  if (state.online.role === 'host') {
    if (!state.online.connected && room.guestChoice) {
      state.online.remoteChoice = room.guestChoice;
      state.cpuChoice = { ...room.guestChoice };
      state.online.connected = true;
      if (state.online.connectionTimeoutId) {
        clearTimeout(state.online.connectionTimeoutId);
        state.online.connectionTimeoutId = null;
      }
      setRoomStatus(`Oponente conectado: ${room.guestChoice.name}. Iniciando partida...`);
      state.overlayMessage = 'OPONENTE CONECTADO';
      startOnlineMatch();
    }
    if (room.guestControls?.pressed) {
      state.online.remoteControls.pressed = room.guestControls.pressed;
    }
    if (Array.isArray(room.newCommands)) {
      for (const command of room.newCommands) {
        if (command.command === 'jump') state.online.remoteControls.jumpQueued = true;
        if (command.command === 'attack1') state.online.remoteControls.attack1Queued = true;
        if (command.command === 'attack2') state.online.remoteControls.attack2Queued = true;
        state.online.lastCommandId = Math.max(state.online.lastCommandId, command.id || 0);
      }
    }
    return;
  }
  if (room.hostChoice && !state.playerChoice) {
    state.playerChoice = { ...room.hostChoice };
    state.cpuChoice = state.cpuChoice || { ...state.online.localChoice };
  }
  if (room.matchStarted && !state.online.connected) {
    state.online.connected = true;
    if (state.online.connectionTimeoutId) {
      clearTimeout(state.online.connectionTimeoutId);
      state.online.connectionTimeoutId = null;
    }
  }
  if (room.latestSnapshot) {
    state.online.latestSnapshot = room.latestSnapshot;
    if (!state.running && room.matchStarted) {
      startOnlineMatch(room.latestSnapshot);
    }
  }
}

function startOnlinePolling() {
  if (state.online.pollIntervalId) {
    clearInterval(state.online.pollIntervalId);
  }
  state.online.pollIntervalId = window.setInterval(() => {
    pollOnlineSync().catch(() => {});
  }, ONLINE_POLL_INTERVAL_MS);
  pollOnlineSync().catch(() => {});
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

function sendLocalInput() {
  if (state.mode !== 'online' || state.online.role !== 'guest') return;
  onlineApiRequest({
    action: 'input',
    roomId: state.online.roomId,
    sessionId: state.online.sessionId,
    controls: {
      pressed: { ...state.online.localControls.pressed }
    }
  }).catch(() => {});
}

function getAssetCandidates(folder, fileName) {
  return ASSET_ROOT_CANDIDATES.map((root) => `${root}/${folder}/${fileName}`);
}

function getCharacterCandidates(character) {
  return character.folderCandidates || [character.folder];
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
  return ACTION_ASSET_CANDIDATES[action] || [action];
}

function getActionFileNameCandidates(name) {
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  return capitalized === name ? [`${name}.png`] : [`${name}.png`, `${capitalized}.png`];
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
      dom.characterGrid.querySelectorAll('.character-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedCharacterId = card.dataset.charId;
      dom.startFightBtn.disabled = false;
    });
  });
}

function refreshModeUi() {
  const onlineMode = state.mode === 'online';
  dom.modeCpuBtn.classList.toggle('active', !onlineMode);
  dom.modeOnlineBtn.classList.toggle('active', onlineMode);
  dom.onlinePanel.classList.toggle('hidden', !onlineMode);
  dom.startFightBtn.textContent = onlineMode ? 'Criar sala' : 'Iniciar Luta';
  dom.joinRoomBtn.disabled = !onlineMode;
  dom.copyRoomCodeBtn.disabled = !state.online.roomId;
  if (!state.online.roomId) {
    dom.roomCode.textContent = '-';
    dom.roomCodeInput.value = '';
  }
  if (!onlineMode) {
    setRoomStatus('Escolha um lutador e crie uma sala, ou entre em uma sala existente.');
    dom.copyRoomCodeBtn.disabled = true;
  }
}

function setMode(mode) {
  if (state.mode === mode) return;
  closeOnlineTransport();
  state.mode = mode;
  state.selectedCharacterId = null;
  dom.characterGrid.querySelectorAll('.character-card').forEach((card) => card.classList.remove('selected'));
  dom.startFightBtn.disabled = true;
  refreshModeUi();
  if (mode === 'online') {
    setRoomStatus('Escolha um lutador e crie uma sala, ou entre em uma sala existente.');
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

function setupOnlineSession(roomId, role, sessionId) {
  closeOnlineTransport();
  state.online.roomId = roomId;
  state.online.role = role;
  state.online.sessionId = sessionId;
  state.online.connected = false;
  state.online.localControls = createControlState();
  state.online.remoteControls = createControlState();
  state.online.latestSnapshot = null;
  state.online.lastCommandId = 0;
  state.online.lastStatePushAt = 0;
  state.online.connectionTimeoutId = window.setTimeout(() => {
    if (state.online.roomId !== roomId || state.online.role !== role || state.online.connected) return;
    closeOnlineTransport();
    refreshModeUi();
    dom.startFightBtn.disabled = !state.selectedCharacterId;
    setRoomStatus(
      role === 'host'
        ? `Nenhum jogador entrou na sala ${roomId} em tempo.`
        : `Nao recebi resposta da sala ${roomId} em tempo.`
    );
  }, ONLINE_CONNECTION_TIMEOUT_MS);
  startOnlinePolling();
}

function closeOnlineTransport() {
  if (state.online.connectionTimeoutId) {
    clearTimeout(state.online.connectionTimeoutId);
  }
  if (state.online.pollIntervalId) {
    clearInterval(state.online.pollIntervalId);
  }
  state.online.sessionId = '';
  state.online.connectionTimeoutId = null;
  state.online.pollIntervalId = null;
  state.online.roomId = '';
  state.online.role = null;
  state.online.connected = false;
  state.online.localChoice = null;
  state.online.remoteChoice = null;
  state.online.latestSnapshot = null;
  state.online.localControls = null;
  state.online.remoteControls = null;
  state.online.lastCommandId = 0;
  state.online.lastStatePushAt = 0;
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

function broadcastMatchState(force = false) {
  if (state.mode !== 'online' || state.online.role !== 'host' || !state.online.roomId) return;
  const now = Date.now();
  if (!force && now - state.online.lastStatePushAt < ONLINE_STATE_PUSH_INTERVAL_MS) return;
  state.online.lastStatePushAt = now;
  onlineApiRequest({
    action: 'state',
    roomId: state.online.roomId,
    sessionId: state.online.sessionId,
    snapshot: buildMatchSnapshot()
  }).catch(() => {});
}

function applyMatchSnapshot(snapshot) {
  if (!snapshot) return;
  applyFighterSnapshot(player, snapshot.player);
  applyFighterSnapshot(cpu, snapshot.cpu);
  state.round = snapshot.round;
  state.timer = snapshot.timer;
  state.playerRoundWins = snapshot.playerRoundWins;
  state.cpuRoundWins = snapshot.cpuRoundWins;
  state.roundOver = snapshot.roundOver;
  state.gameOver = snapshot.gameOver;
  state.overlayMessage = snapshot.overlayMessage;
  dom.playerName.textContent = snapshot.playerName || dom.playerName.textContent;
  dom.enemyName.textContent = snapshot.enemyName || dom.enemyName.textContent;
}

function startOnlineMatch(snapshot) {
  state.running = true;
  state.roundOver = false;
  state.gameOver = false;
  if (!snapshot) {
    state.playerChoice = state.playerChoice || { ...state.online.localChoice };
    state.cpuChoice = state.cpuChoice || { ...state.online.remoteChoice };
    if (!state.playerChoice || !state.cpuChoice) return;
    startRound(true);
    const snapshotPayload = buildMatchSnapshot();
    onlineApiRequest({
      action: 'match-start',
      roomId: state.online.roomId,
      sessionId: state.online.sessionId,
      hostChoice: state.playerChoice,
      guestChoice: state.cpuChoice,
      snapshot: snapshotPayload
    }).catch(() => {});
    broadcastMatchState(true);
  } else {
    state.playerChoice = state.playerChoice || snapshot.playerChoice || { ...state.online.localChoice };
    state.cpuChoice = state.cpuChoice || snapshot.cpuChoice || { ...state.online.remoteChoice };
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
  applyControlStateToFighter(player, state.localControls);
}

function cpuAI() {
  if (state.mode === 'online') return;
  if (!state.running || state.roundOver || state.gameOver || cpu.ko) return;
  const dist = player.x - cpu.x;
  const absDist = Math.abs(dist);
  if (cpu.canAct()) {
    if (absDist > 130) cpu.vx = dist > 0 ? cpu.speed * 0.75 : -cpu.speed * 0.75;
    else cpu.vx = (Math.random() > 0.5 ? 1 : -1) * cpu.speed * 0.35;
    if (absDist < 150 && Math.random() < 0.05) cpu.attack('attack1');
    if (absDist < 130 && Math.random() < 0.03) cpu.attack('attack2');
    if (Math.random() < 0.008) cpu.jump();
  } else {
    cpu.vx = 0;
  }
}

function resolveAttacks() {
  if (state.mode === 'online' && state.online.role === 'guest') return;
  const pAtk = player.attackBox();
  const cAtk = cpu.attackBox();
  if (pAtk && player.attackTime >= 10 && intersects(pAtk, cpu.hitbox) && cpu.hurtTime <= 0) {
    const damage = player.attackKind === 'attack2' ? 12 : 8;
    cpu.damage(damage);
    cpu.vx += player.faceRight ? 6 : -6;
  }
  if (cAtk && cpu.attackTime >= 10 && intersects(cAtk, player.hitbox) && player.hurtTime <= 0) {
    const damage = cpu.attackKind === 'attack2' ? 12 : 8;
    player.damage(damage);
    player.vx += cpu.faceRight ? 6 : -6;
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
      state.overlayMessage = state.playerRoundWins > state.cpuRoundWins ? 'VITORIA!' : 'DERROTA!';
      clearInterval(timerInterval);
      const snapshotPayload = buildMatchSnapshot();
      onlineApiRequest({
        action: 'match-end',
        roomId: state.online.roomId,
        sessionId: state.online.sessionId,
        snapshot: snapshotPayload
      }).catch(() => {});
      broadcastMatchState(true);
      return;
    }
    state.overlayMessage = winner === 'draw' ? 'EMPATE' : winner === 'player' ? 'ROUND DO PLAYER' : 'ROUND DA CPU';
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
    drawArena();
    if (state.online.latestSnapshot) {
      applyMatchSnapshot(state.online.latestSnapshot);
    }
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
  dom.enemyName.textContent = state.mode === 'cpu' ? `${state.cpuChoice.name} (CPU)` : state.cpuChoice.name;
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
  if (state.mode === 'cpu' || state.online.role === 'host') {
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
    setRoomStatus('Multiplayer exige HTTP/HTTPS e backend ativo. Nao funciona em file://.');
    return;
  }
  state.online.localChoice = { ...selected };
  try {
    const payload = await onlineApiRequest({
      action: 'create',
      choice: state.online.localChoice
    });
    const roomId = payload.roomId || makeRoomCode();
    setupOnlineSession(roomId, 'host', payload.sessionId || createClientId());
    state.playerChoice = { ...selected };
    state.playerRoundWins = 0;
    state.cpuRoundWins = 0;
    state.round = 1;
    state.gameOver = false;
    state.running = false;
    dom.roomCode.textContent = roomId;
    dom.copyRoomCodeBtn.disabled = false;
    setRoomStatus(`Sala ${roomId} criada. Aguardando outro jogador...`);
    dom.startFightBtn.disabled = true;
    dom.joinRoomBtn.disabled = true;
    dom.roomCodeInput.value = '';
    copyText(roomId);
  } catch (error) {
    setRoomStatus(error?.message || 'Nao foi possivel criar a sala online.');
  }
}

function resetToSelect() {
  if (state.mode === 'online' && state.online.role === 'host' && state.online.roomId) {
    onlineApiRequest({
      action: 'close',
      roomId: state.online.roomId,
      sessionId: state.online.sessionId
    }).catch(() => {});
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
  state.overlayMessage = '';
  closeOnlineTransport();
  refreshModeUi();
  dom.fightScreen.classList.remove('active');
  dom.selectScreen.classList.add('active');
  dom.startFightBtn.disabled = !state.selectedCharacterId;
}

async function joinOnlineRoom() {
  const roomId = dom.roomCodeInput.value.trim().toUpperCase();
  const selected = characters.find((c) => c.id === state.selectedCharacterId);
  if (!roomId || !selected || state.mode !== 'online' || state.running || state.online.roomId || state.online.role) return;
  if (!canUseOnlineTransport()) {
    setRoomStatus('Multiplayer exige HTTP/HTTPS e backend ativo. Nao funciona em file://.');
    return;
  }
  state.online.localChoice = { ...selected };
  try {
    const payload = await onlineApiRequest({
      action: 'join',
      roomId,
      choice: state.online.localChoice
    });
    setupOnlineSession(roomId, 'guest', payload.sessionId || createClientId());
    setRoomStatus(`Conectando na sala ${roomId}...`);
    dom.roomCode.textContent = roomId;
    dom.copyRoomCodeBtn.disabled = false;
    dom.startFightBtn.disabled = true;
    dom.joinRoomBtn.disabled = true;
  } catch (error) {
    setRoomStatus(error?.message || `Nao foi possivel entrar na sala ${roomId}.`);
  }
}

window.addEventListener('keydown', (event) => {
  if (!state.running || state.roundOver || state.gameOver) return;
  if (state.mode === 'online' && state.online.role === 'guest') {
    updateControlState(state.online.localControls, event.code, true);
    if (event.code === 'KeyW' || event.code === 'KeyJ' || event.code === 'KeyK') event.preventDefault();
    if (event.code === 'KeyW' || event.code === 'KeyJ' || event.code === 'KeyK') {
      const command = event.code === 'KeyW' ? 'jump' : event.code === 'KeyJ' ? 'attack1' : 'attack2';
      onlineApiRequest({
        action: 'command',
        roomId: state.online.roomId,
        sessionId: state.online.sessionId,
        command
      }).catch(() => {});
    }
    sendLocalInput();
    return;
  }
  updateControlState(state.localControls, event.code, true);
  if (event.code === 'KeyW' || event.code === 'KeyJ' || event.code === 'KeyK') event.preventDefault();
});

window.addEventListener('keyup', (event) => {
  updateControlState(state.mode === 'online' && state.online.role === 'guest' ? state.online.localControls : state.localControls, event.code, false);
  if (state.mode === 'online' && state.online.role === 'guest') {
    sendLocalInput();
  }
});

dom.modeCpuBtn.addEventListener('click', () => setMode('cpu'));
dom.modeOnlineBtn.addEventListener('click', () => setMode('online'));
dom.startFightBtn.addEventListener('click', beginFight);
dom.joinRoomBtn.addEventListener('click', joinOnlineRoom);
dom.backSelectBtn.addEventListener('click', resetToSelect);
dom.copyRoomCodeBtn.addEventListener('click', () => {
  if (dom.roomCode.textContent && dom.roomCode.textContent !== '-') {
    copyText(dom.roomCode.textContent);
  }
});

buildCharacterSelect();
refreshModeUi();
