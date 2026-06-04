const GAME_WIDTH = 1200;
const GAME_HEIGHT = 620;
const GROUND_Y = 530;
const GRAVITY = 0.95;
const ROUND_TIME = 60;
const MAX_ROUNDS = 2;
const ASSET_ROOT = 'ASSETSGAME';
const FRAME_COUNT = 12;

const characters = [
  { id: 'char1', name: 'Lutador 1', folder: `${ASSET_ROOT}/character1`, color: '#38bdf8' },
  { id: 'char2', name: 'Lutador 2', folder: `${ASSET_ROOT}/character2`, color: '#fb7185' },
  { id: 'char3', name: 'Lutador 3', folder: `${ASSET_ROOT}/character3`, color: '#facc15' }
];

const ACTIONS = ['idle', 'walk', 'jump', 'attack1', 'attack2', 'hurt', 'ko'];

const state = {
  selectedCharacterId: null,
  playerChoice: null,
  cpuChoice: null,
  running: false,
  round: 1,
  timer: ROUND_TIME,
  playerRoundWins: 0,
  cpuRoundWins: 0,
  roundOver: false,
  gameOver: false,
  overlayMessage: '',
  keyState: {}
};

const dom = {
  selectScreen: document.getElementById('character-select'),
  fightScreen: document.getElementById('fight-screen'),
  characterGrid: document.getElementById('character-grid'),
  startFightBtn: document.getElementById('start-fight'),
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

function buildCharacterSelect() {
  dom.characterGrid.innerHTML = characters.map((char) => `
    <article class="character-card" data-char-id="${char.id}">
      <img src="${char.folder}/idle.png" alt="${char.name}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'character-preview',textContent:'${char.name.slice(0, 3).toUpperCase()}'}))" />
      <div class="card-title">${char.name}</div>
    </article>
  `).join('');

  dom.characterGrid.querySelectorAll('.character-card').forEach((card) => {
    card.addEventListener('click', () => {
      dom.characterGrid.querySelectorAll('.character-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedCharacterId = card.dataset.charId;
      dom.startFightBtn.disabled = false;
    });
  });
}

function createSpriteSet(folder) {
  const sprites = {};
  for (const action of ACTIONS) {
    const img = new Image();
    img.src = `${folder}/${action}.png`;
    sprites[action] = {
      image: img,
      frameCount: FRAME_COUNT,
      frameWidth: 0,
      frameHeight: 0
    };
    img.onload = () => {
      const inferredFrameCount = Math.max(1, Math.floor(img.naturalWidth / img.naturalHeight));
      sprites[action].frameCount = inferredFrameCount;
      sprites[action].frameWidth = img.naturalWidth / inferredFrameCount;
      sprites[action].frameHeight = img.naturalHeight;
    };
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
      const frameCount = this.sprites[this.currentAction]?.frameCount || FRAME_COUNT;
      this.frameIndex = (this.frameIndex + 1) % frameCount;
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
    const sprite = this.sprites[this.currentAction];
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
  let vx = 0;
  if (state.keyState.KeyA) vx -= player.speed;
  if (state.keyState.KeyD) vx += player.speed;
  player.vx = player.canAct() ? vx : 0;
  if (state.keyState.KeyW) {
    player.jump();
    state.keyState.KeyW = false;
  }
}

function cpuAI() {
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
      return;
    }
    state.overlayMessage = winner === 'draw' ? 'EMPATE' : winner === 'player' ? 'ROUND DO PLAYER' : 'ROUND DA CPU';
    clearInterval(timerInterval);
    setTimeout(() => {
      state.round += 1;
      startRound(false);
    }, 1800);
  }
}

function tick() {
  if (!state.running) return;
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
  requestAnimationFrame(tick);
}

function startTimer() {
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
  dom.enemyName.textContent = `${state.cpuChoice.name} (CPU)`;
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
  startTimer();
}

function beginFight() {
  const selected = characters.find((c) => c.id === state.selectedCharacterId);
  if (!selected) return;
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
}

function resetToSelect() {
  state.running = false;
  clearInterval(timerInterval);
  state.keyState = {};
  state.overlayMessage = '';
  dom.fightScreen.classList.remove('active');
  dom.selectScreen.classList.add('active');
}

window.addEventListener('keydown', (event) => {
  if (!state.running || state.roundOver || state.gameOver) return;
  state.keyState[event.code] = true;
  if (event.code === 'KeyJ') {
    event.preventDefault();
    player.attack('attack1');
  }
  if (event.code === 'KeyK') {
    event.preventDefault();
    player.attack('attack2');
  }
});

window.addEventListener('keyup', (event) => {
  state.keyState[event.code] = false;
});

dom.startFightBtn.addEventListener('click', beginFight);
dom.backSelectBtn.addEventListener('click', resetToSelect);

buildCharacterSelect();
