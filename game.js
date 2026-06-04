const GAME_WIDTH = 1200;
const GAME_HEIGHT = 620;
const GROUND_Y = 530;
const GRAVITY = 0.95;
const ROUND_TIME = 60;
const MAX_ROUNDS = 2;
const ASSET_ROOT_CANDIDATES = ['/AssetsGame', 'AssetsGame'];
const FRAME_COUNT = 12;

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
    channel: null,
    transportType: null,
    transportListener: null,
    transportKey: '',
    clientId: '',
    connected: false,
    localChoice: null,
    remoteChoice: null,
    latestSnapshot: null,
    localControls: null,
    remoteControls: null
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
  return window.location.protocol !== 'file:';
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
  const payload = {
    pressed: { ...state.online.localControls.pressed }
  };
  sendOnlineMessage({
    type: 'input',
    controls: payload
  });
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

function setupOnlineTransport(roomId, role) {
  closeOnlineTransport();
  state.online.roomId = roomId;
  state.online.role = role;
  state.online.clientId = createClientId();
  state.online.connected = false;
  state.online.localControls = createControlState();
  state.online.remoteControls = createControlState();
  state.online.latestSnapshot = null;

  const handleOnlineMessage = (data = {}) => {
    if (data.roomId !== state.online.roomId) return;
    if (data.type === 'join-request' && state.online.role === 'host') {
      if (!data.choice) return;
      state.online.remoteChoice = data.choice;
      state.cpuChoice = { ...data.choice };
      state.online.connected = true;
      state.online.roomId = roomId;
      setRoomStatus(`Oponente conectado: ${data.choice.name}. Iniciando partida...`);
      state.overlayMessage = 'OPONENTE CONECTADO';
      setTimeout(() => startOnlineMatch(), 900);
      return;
    }
    if (data.type === 'input' && state.online.role === 'host') {
      state.online.remoteControls.pressed = data.controls?.pressed || {};
      return;
    }
    if (data.type === 'command' && state.online.role === 'host') {
      if (data.command === 'jump') state.online.remoteControls.jumpQueued = true;
      if (data.command === 'attack1') state.online.remoteControls.attack1Queued = true;
      if (data.command === 'attack2') state.online.remoteControls.attack2Queued = true;
      return;
    }
    if (data.type === 'match-start' && state.online.role === 'guest') {
      state.playerChoice = { ...data.hostChoice };
      state.cpuChoice = { ...data.guestChoice };
      state.online.connected = true;
      state.online.latestSnapshot = data.snapshot || null;
      startOnlineMatch(data.snapshot);
      return;
    }
    if (data.type === 'state' && state.online.role === 'guest') {
      state.online.latestSnapshot = data.snapshot || null;
      return;
    }
    if (data.type === 'match-end' && state.online.role === 'guest') {
      state.online.latestSnapshot = data.snapshot || null;
    }
  };

  state.online.transportKey = `gamefight-room-${roomId}`;
  if (typeof BroadcastChannel !== 'undefined') {
    state.online.transportType = 'broadcast';
    state.online.channel = new BroadcastChannel(state.online.transportKey);
    state.online.channel.onmessage = (event) => {
      handleOnlineMessage(event.data || {});
    };
    return;
  }

  state.online.transportType = 'storage';
  state.online.transportListener = (event) => {
    if (event.key !== state.online.transportKey || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      if (payload.clientId === state.online.clientId) return;
      handleOnlineMessage(payload);
    } catch {
      // Ignore malformed cross-tab payloads.
    }
  };
  window.addEventListener('storage', state.online.transportListener);
}

function closeOnlineTransport() {
  if (state.online.channel) {
    state.online.channel.close();
  }
  if (state.online.transportListener) {
    window.removeEventListener('storage', state.online.transportListener);
  }
  state.online.channel = null;
  state.online.transportType = null;
  state.online.transportListener = null;
  state.online.transportKey = '';
  state.online.clientId = '';
  state.online.roomId = '';
  state.online.role = null;
  state.online.connected = false;
  state.online.localChoice = null;
  state.online.remoteChoice = null;
  state.online.latestSnapshot = null;
  state.online.localControls = null;
  state.online.remoteControls = null;
}

function sendOnlineMessage(message) {
  if (!state.online.roomId) return;
  const payload = {
    roomId: state.online.roomId,
    clientId: state.online.clientId,
    messageId: createClientId(),
    ...message
  };
  if (state.online.transportType === 'broadcast') {
    if (!state.online.channel) return;
    state.online.channel.postMessage(payload);
    return;
  }
  if (state.online.transportType === 'storage') {
    try {
      localStorage.setItem(state.online.transportKey, JSON.stringify(payload));
      localStorage.removeItem(state.online.transportKey);
    } catch {
      // Ignore storage transport failures silently.
    }
  }
}

function broadcastMatchState() {
  if (state.mode !== 'online' || state.online.role !== 'host') return;
  sendOnlineMessage({
    type: 'state',
    snapshot: {
      player: serializeFighter(player),
      cpu: serializeFighter(cpu),
      round: state.round,
      timer: state.timer,
      playerRoundWins: state.playerRoundWins,
      cpuRoundWins: state.cpuRoundWins,
      roundOver: state.roundOver,
      gameOver: state.gameOver,
      overlayMessage: state.overlayMessage,
      playerName: state.playerChoice?.name || 'JOGADOR 1',
      enemyName: state.cpuChoice?.name || 'JOGADOR 2'
    }
  });
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
    broadcastMatchState();
    sendOnlineMessage({
      type: 'match-start',
      hostChoice: state.playerChoice,
      guestChoice: state.cpuChoice,
      snapshot: {
        player: serializeFighter(player),
        cpu: serializeFighter(cpu),
        round: state.round,
        timer: state.timer,
        playerRoundWins: state.playerRoundWins,
        cpuRoundWins: state.cpuRoundWins,
        roundOver: state.roundOver,
        gameOver: state.gameOver,
        overlayMessage: state.overlayMessage,
        playerName: state.playerChoice?.name || 'JOGADOR 1',
        enemyName: state.cpuChoice?.name || 'JOGADOR 2'
      }
    });
  } else {
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
  const controls = state.mode === 'online' ? state.online.localControls : state.localControls;
  applyControlStateToFighter(player, controls);
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
      broadcastMatchState();
      sendOnlineMessage({
        type: 'match-end',
        snapshot: {
          player: serializeFighter(player),
          cpu: serializeFighter(cpu),
          round: state.round,
          timer: state.timer,
          playerRoundWins: state.playerRoundWins,
          cpuRoundWins: state.cpuRoundWins,
          roundOver: state.roundOver,
          gameOver: state.gameOver,
          overlayMessage: state.overlayMessage,
          playerName: state.playerChoice?.name || 'JOGADOR 1',
          enemyName: state.cpuChoice?.name || 'JOGADOR 2'
        }
      });
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

function beginFight() {
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
    setRoomStatus('Multiplayer exige HTTP/HTTPS na mesma origem dos dois jogadores. Nao funciona em file://.');
    return;
  }
  state.online.localChoice = { ...selected };
  const roomId = makeRoomCode();
  setupOnlineTransport(roomId, 'host');
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
}

function resetToSelect() {
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

function joinOnlineRoom() {
  const roomId = dom.roomCodeInput.value.trim().toUpperCase();
  const selected = characters.find((c) => c.id === state.selectedCharacterId);
  if (!roomId || !selected || state.mode !== 'online' || state.running || state.online.roomId || state.online.role) return;
  if (!canUseOnlineTransport()) {
    setRoomStatus('Multiplayer exige HTTP/HTTPS na mesma origem dos dois jogadores. Nao funciona em file://.');
    return;
  }
  state.online.localChoice = { ...selected };
  setupOnlineTransport(roomId, 'guest');
  setRoomStatus(`Conectando na sala ${roomId}...`);
  dom.roomCode.textContent = roomId;
  dom.copyRoomCodeBtn.disabled = false;
  sendOnlineMessage({
    type: 'join-request',
    choice: state.online.localChoice
  });
  dom.startFightBtn.disabled = true;
  dom.joinRoomBtn.disabled = true;
}

window.addEventListener('keydown', (event) => {
  if (!state.running || state.roundOver || state.gameOver) return;
  if (state.mode === 'online' && state.online.role === 'guest') {
    updateControlState(state.online.localControls, event.code, true);
    if (event.code === 'KeyW' || event.code === 'KeyJ' || event.code === 'KeyK') event.preventDefault();
    if (event.code === 'KeyW') sendOnlineMessage({ type: 'command', command: 'jump' });
    if (event.code === 'KeyJ') sendOnlineMessage({ type: 'command', command: 'attack1' });
    if (event.code === 'KeyK') sendOnlineMessage({ type: 'command', command: 'attack2' });
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
