/*
 * Gaúcho Runner — edição "a cavalo"
 * ---------------------------------
 * Clone do jogo do dinossauro do Chrome: um gaúcho montado num cavalo
 * atravessa o campo pulando cactos e desviando de quero-queros.
 *
 * Canvas puro, sem dependências. O jogo ocupa a tela inteira: a "moldura"
 * do canvas some porque ele é 100% da viewport e a página tem a mesma cor
 * do céu.
 */
(() => {
  'use strict';

  // --------------------------------------------------------------- dimensões
  const DESIGN_W = 520;   // largura mínima do mundo (unidades lógicas)
  const MIN_H = 200;      // altura mínima do mundo, para caber o pulo
  const GROUND_MARGIN = 20;
  const SCALE_FACTOR = 2;  // pixels de tela por pixel de arte (inteiro)

  let W = DESIGN_W;
  let H = MIN_H;
  let GROUND_Y = H - GROUND_MARGIN;
  let UNIT_PX = 1.4; // unidades lógicas por pixel de arte

  const RUNNER_SCALE = 0.85; // personagem 15% menor
  const BODY_H = 78 * RUNNER_SCALE;      // cavalo + cavaleiro em pé
  const RUNNER_THIN_RADIUS = 2;          // afinamento do sprite (px da arte original)
  const TOUCH_BAR_CSS = 96;              // faixa inferior reservada aos controles
  const TOUCH_MODE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    || /[?&]touch=1/.test(location.search);

  let SAFE = { top: 0, right: 0, bottom: 0, left: 0 };

  // Municípios do RS em ordem alfabética (municipios.js, gerado do municipios.xlsx).
  // Cada obstáculo vencido conquista um município.
  const MUNICIPIOS = Array.isArray(window.MUNICIPIOS) && window.MUNICIPIOS.length
    ? window.MUNICIPIOS
    : ['Acegua'];
  const UI_FONT = 'Consolas, "Lucida Console", "SFMono-Regular", Menlo, "Courier New", monospace';

  const CFG = {
    gravity: 0.6,
    jumpVelocity: -10.1,
    minJumpVelocity: -5,
    startSpeed: 5.5,
    maxSpeed: 11.5,
    nightEvery: 100, // cidades conquistadas entre cada noite
    nightMs: 4500,
  };

  const PAL = {
    day:   { bg: '#F7F7F7', fg: '#1E1C18', cloud: '#D8D8D8', dim: '#1E1C18', faint: '#1E1C18', accent: '#1E1C18' },
    night: { bg: '#1E1C18', fg: '#EDE2CE', cloud: '#7D7566', dim: '#EDE2CE', faint: '#EDE2CE', accent: '#EDE2CE' },
  };

  // ------------------------------------------------------------------ helpers
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* modo privado */ }
    },
  };

  // ------------------------------------------------------------------- canvas
  const canvas = document.getElementById('game');
  const out = canvas.getContext('2d');
  const art = document.createElement('canvas'); // arte em baixa resolução
  const ctx = art.getContext('2d', { willReadFrequently: true });

  document.body.classList.toggle('touch', TOUCH_MODE);

  function readSafeArea() {
    const el = document.getElementById('safe-area-probe');
    if (!el) return;
    const cs = getComputedStyle(el);
    SAFE = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
  }

  function fitCanvas() {
    const cw = Math.max(320, window.innerWidth);
    const ch = Math.max(240, window.innerHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    // px por unidade lógica: o jogo preenche toda a viewport
    const unit = Math.min(cw / DESIGN_W, ch / MIN_H);
    W = cw / unit;
    H = ch / unit;

    const oldGround = GROUND_Y;
    const touchReserve = (TOUCH_MODE && screen === 'game')
      ? (TOUCH_BAR_CSS + SAFE.bottom) * (H / ch)
      : 0;
    GROUND_Y = H - Math.max(GROUND_MARGIN, H * 0.11) - touchReserve;

    // resolução de arte com ampliação inteira (pixels iguais e duros)
    const bw = Math.max(320, Math.round((cw * ratio) / SCALE_FACTOR) * SCALE_FACTOR);
    const bh = Math.max(240, Math.round((ch * ratio) / SCALE_FACTOR) * SCALE_FACTOR);

    canvas.width = bw;
    canvas.height = bh;
    out.imageSmoothingEnabled = false;

    art.width = bw / SCALE_FACTOR;
    art.height = bh / SCALE_FACTOR;
    const upp = W / art.width; // unidades lógicas por pixel de arte
    UNIT_PX = upp;
    ctx.setTransform(1 / upp, 0, 0, 1 / upp, 0, 0);

    if (typeof runner !== 'undefined') {
      if (runner.onGround) {
        runner.h = BODY_H;
        runner.y = GROUND_Y - runner.h;
      } else {
        runner.y += GROUND_Y - oldGround;
      }
    }

    layoutSky();
    render();
  }

  // -------------------------------------------------------------------- áudio
  let audio = null;
  let muted = store.get('gaucho.muted', '0') === '1';

  function initAudio() {
    if (!audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) { try { audio = new Ctx(); } catch { audio = null; } }
    }
    if (audio && audio.state === 'suspended') audio.resume();
  }

  function tone(freq, dur, { type = 'square', gain = 0.035, slide = null } = {}) {
    if (muted) return;
    initAudio();
    if (!audio) return;
    const t0 = audio.currentTime;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // -------------------------------------------------------------------- estado
  const game = {
    status: 'waiting', // waiting | running | crashed
    speed: CFG.startSpeed,
    distance: 0,
    record: Number(store.get('gaucho.record', '0')) || 0,
    worldX: 0,
    obstacles: [],
    gap: 760,
    nightLeft: 0,
    nextNight: CFG.nightEvery,
    crashFrames: 0,
    time: 0,
    newRecord: false,
    conquered: 0,
  };

  const runner = {
    x: 56,
    y: GROUND_Y - BODY_H,
    h: BODY_H,
    vy: 0,
    onGround: true,
    dead: false,
    legPhase: 0,
    legClock: 0,
    gait: 0,
    blinkClock: 0,
  };

  // intercalação dos obstáculos: evita repetir o mesmo tipo em sequência
  let lastSpawnType = null;
  let lastGroundType = null;

  // tela atual: menu | about | contact | game
  let screen = 'menu';
  let menuFocus = 0;
  let menuButtons = [];
  let overButton = null;
  let restartButton = null;
  let menuLayout = null;

  // céu / cenário (recalculados no resize)
  let CLOUDS = [];
  let STARS = [];
  let MARKS = [];

  function layoutSky() {
    // faixa reservada para o HUD dos municípios: nenhuma nuvem entra nela
    const perCss = H / Math.max(1, window.innerHeight);
    const cloudTop = Math.max(64, (104 + SAFE.top) * perCss + 12);
    const cloudBottom = Math.max(cloudTop + 8, GROUND_Y - 90);

    CLOUDS = Array.from({ length: 6 }, (_, i) => {
      const r = mulberry32(17 + i * 97);
      return {
        x: r() * W,
        y: cloudTop + r() * Math.max(8, cloudBottom - cloudTop),
        s: 0.4 + r() * 0.42,
      };
    });

    STARS = Array.from({ length: 42 }, (_, i) => {
      const r = mulberry32(700 + i * 31);
      return { x: r() * W, y: 8 + r() * Math.max(30, GROUND_Y * 0.6), p: r() * TAU };
    });

    MARKS = Array.from({ length: 40 }, (_, i) => {
      const r = mulberry32(400 + i * 131);
      return { x: r() * (W + 240), y: r() * 4.5, w: 2 + r() * 8, h: 0.7 + r() * 0.9 };
    });
  }

  // ------------------------------------------------------------------ controle
  function startGame() {
    screen = 'game';
    canvas.style.cursor = 'default';
    resetRun();
    game.status = 'running';
    fitCanvas();
    updateRotateHint();
    tone(520, 0.08, { slide: 760, gain: 0.03 });
  }

  function resetRun() {
    game.speed = CFG.startSpeed;
    game.distance = 0;
    game.worldX = 0;
    game.obstacles = [];
    game.gap = 760;
    game.nightLeft = 0;
    game.nextNight = CFG.nightEvery;
    game.crashFrames = 0;
    game.newRecord = false;
    game.conquered = 0;
    runner.h = BODY_H;
    runner.y = GROUND_Y - BODY_H;
    runner.vy = 0;
    runner.onGround = true;
    runner.dead = false;
    runner.legPhase = 0;
    runner.legClock = 0;
    runner.gait = 0;
    lastSpawnType = null;
    lastGroundType = null;
  }

  function jump() {
    if (!runner.onGround) return;
    runner.h = BODY_H;
    runner.y = GROUND_Y - BODY_H;
    runner.vy = CFG.jumpVelocity;
    runner.onGround = false;
    tone(430, 0.09, { slide: 720, gain: 0.03 });
  }

  function cutJump() {
    if (!runner.onGround && runner.vy < CFG.minJumpVelocity) {
      runner.vy = CFG.minJumpVelocity;
    }
  }

  function crash() {
    game.status = 'crashed';
    game.crashFrames = 0;
    runner.dead = true;
    if (game.conquered > game.record) {
      game.record = game.conquered;
      game.newRecord = true;
      store.set('gaucho.record', String(game.record));
    }
    tone(190, 0.34, { slide: 60, gain: 0.045 });
  }

  // vitória: os 497 municípios foram conquistados
  function win() {
    game.status = 'won';
    if (game.conquered > game.record) {
      game.record = game.conquered;
      game.newRecord = true;
      store.set('gaucho.record', String(game.record));
    }
    tone(880, 0.45, { slide: 1320, gain: 0.05 });
  }

  function restart() {
    resetRun();
    game.status = 'running';
    canvas.style.cursor = 'default';
    fitCanvas();
    updateRotateHint();
    tone(520, 0.08, { slide: 780, gain: 0.03 });
  }

  function pressPrimary() {
    initAudio();
    if (game.status === 'waiting') startGame();
    else if (game.status === 'running') jump();
    else if (game.crashFrames > 18) restart();
  }

  function toggleMute() {
    muted = !muted;
    store.set('gaucho.muted', muted ? '1' : '0');
    if (!muted) tone(660, 0.06, { gain: 0.03 });
  }

  // ------------------------------------------------------------------- spawns
  function makeGroundOnce(x) {
    const r = Math.random();
    if (r < 0.34) {
      // capim: 1 a 3 tufos
      const n = 1 + Math.floor(Math.random() * 3);
      const h = 26 + Math.random() * 9;
      const parts = [];
      let dx = 0;
      for (let i = 0; i < n; i++) {
        parts.push({ dx, h: h * rand(0.82, 1), seed: Math.random() });
        dx += 15 + rand(2, 7);
      }
      return { type: 'grass', x, y: GROUND_Y - h, w: dx - 2, h, parts };
    }
    if (r < 0.56) {
      const w = 22 + Math.random() * 16;
      const h = 18 + Math.random() * 10;
      return { type: 'rock', x, y: GROUND_Y - h, w, h };
    }
    if (r < 0.72) {
      const w = 30 + Math.random() * 14;
      const h = 30 + Math.random() * 16;
      return { type: 'bush', x, y: GROUND_Y - h, w, h, seed: Math.random() };
    }
    if (r < 0.84) {
      const w = 44 + Math.random() * 26;
      const h = 40 + Math.random() * 16;
      return { type: 'fence', x, y: GROUND_Y - h, w, h };
    }
    if (r < 0.93) {
      const w = 26 + Math.random() * 12;
      const h = 16 + Math.random() * 8;
      return { type: 'stump', x, y: GROUND_Y - h, w, h, seed: Math.random() };
    }
    return makePost(x);
  }

  // sorteia um tipo diferente do anterior, para nunca repetir em sequência
  function makeGround(x, avoid) {
    let o = makeGroundOnce(x);
    for (let i = 0; i < 6 && avoid && o.type === avoid; i++) o = makeGroundOnce(x);
    return o;
  }

  function makePost(x) {
    const w = 10 + Math.random() * 5;
    const h = 32 + Math.random() * 10;
    return { type: 'post', x, y: GROUND_Y - h, w, h };
  }

  function makeBird(x, bottom) {
    const h = 26;
    return { type: 'bird', x, y: GROUND_Y - bottom - h, bottom, w: 40, h, frameClock: 0, low: bottom < 34 };
  }

  // primeiros obstáculos: só pedra/capim baixos, sem cerca nem arbusto
  function makeEasyGround(x, avoid) {
    let o = makeGround(x, avoid);
    for (let i = 0; i < 12 && o.type !== 'grass' && o.type !== 'rock'; i++) o = makeGround(x, avoid);
    if (o.type !== 'grass' && o.type !== 'rock') {
      const w = 22 + Math.random() * 12;
      const h = 18 + Math.random() * 8;
      return { type: 'rock', x, y: GROUND_Y - h, w, h };
    }
    return o;
  }

  // marca o último tipo criado para intercalar a próxima onda
  function markSpawn(o) {
    lastSpawnType = o.type;
    if (o.type !== 'bird') lastGroundType = o.type;
    return o;
  }

  function nextGround(x) {
    return markSpawn(makeGround(x, lastGroundType));
  }

  function nextPost(x) {
    if (lastGroundType === 'post') return nextGround(x);
    return markSpawn(makePost(x));
  }

  function nextLowGround(x) {
    const low = ['rock', 'grass', 'stump'];
    let o = makeGround(x, lastGroundType);
    for (let i = 0; i < 8 && low.indexOf(o.type) < 0; i++) o = makeGround(x, lastGroundType);
    if (low.indexOf(o.type) < 0) o = { type: 'rock', x, y: GROUND_Y - 22, w: 27, h: 22 };
    return markSpawn(o);
  }

  function nextBird(x, bottom) {
    return markSpawn(makeBird(x, bottom));
  }

  function nextEasyGround(x) {
    return markSpawn(makeEasyGround(x, lastGroundType));
  }

  // um obstáculo vencido = uma cidade conquistada
  function conquerCity() {
    if (game.conquered >= MUNICIPIOS.length) return;
    game.conquered += 1;
    tone(780, 0.045, { gain: 0.018 });
    if (game.conquered >= MUNICIPIOS.length) {
      win();
      return;
    }
    if (game.conquered >= game.nextNight) {
      game.nightLeft = CFG.nightMs;
      game.nextNight = game.conquered + CFG.nightEvery;
    }
  }

  // ondas: isolado, dupla, pássaro-sobre-pedra, pássaro + obstáculo, trio e mourão
  function spawnWave() {
    const x = W + 40;
    const c = game.conquered;
    const r = Math.random();
    let pattern = 'single';

    const bag = [];
    if (c >= 40) bag.push('doubleClose', 'doubleClose');
    if (c >= 70) bag.push('birdRock');
    if (c >= 120) bag.push('doubleFar', 'birdGround');
    if (c >= 200) bag.push('triple', 'doubleFar');
    if (c >= 280) bag.push('postPair');
    if (c >= 360) bag.push('doubleClose', 'birdGround', 'postPair');

    const multiChance = c < 70 ? 0.22 : c < 120 ? 0.34 : c < 200 ? 0.44 : c < 280 ? 0.5 : 0.56;
    if (bag.length && r < multiChance) pattern = bag[(Math.random() * bag.length) | 0];

    const group = [];
    const jumpGap = 34 * game.speed + 170;

    if (pattern === 'doubleClose') {
      const gap = 90 + Math.random() * 40;
      group.push(nextGround(x), nextGround(x + gap));
    } else if (pattern === 'doubleFar') {
      group.push(nextGround(x), nextGround(x + jumpGap));
    } else if (pattern === 'birdRock') {
      // obstáculo baixo + pássaro mais alto: exige pulo curto (não pode subir demais)
      const ground = nextLowGround(x);
      const bird = nextBird(x + (ground.w - 40) / 2, 110);
      group.push(ground, bird);
    } else if (pattern === 'birdGround') {
      const heights = [26, 34, 40];
      const h = heights[(Math.random() * heights.length) | 0];
      const gap = 34 * game.speed + 210;
      if (lastSpawnType === 'bird') {
        group.push(nextGround(x), nextBird(x + gap, h));
      } else {
        group.push(nextBird(x, h), nextGround(x + gap));
      }
    } else if (pattern === 'postPair') {
      // mourão + obstáculo baixo: dois pulos, com alturas bem diferentes
      group.push(nextPost(x), nextGround(x + jumpGap));
    } else if (pattern === 'triple') {
      const gap = 34 * game.speed + 190;
      group.push(nextGround(x), nextGround(x + gap), nextGround(x + gap * 2));
    } else if (c < 15) {
      group.push(nextEasyGround(x));
    } else if (c >= 20 && lastSpawnType !== 'bird' && Math.random() < 0.15) {
      const heights = [26, 34, 40];
      group.push(nextBird(x, heights[(Math.random() * heights.length) | 0]));
    } else {
      group.push(nextGround(x));
    }

    for (const o of group) game.obstacles.push(o);

    // o gap conta a partir da borda direita do último obstáculo da onda
    const extent = Math.max(...group.map((o) => o.x + o.w)) - x;
    const ease = Math.max(0, 1 - c / 40);
    const baseGap = 34 * game.speed + 130 + ease * 110 + Math.random() * 150;
    game.gap = baseGap + extent;
  }

  // ------------------------------------------------------------------ colisão
  function hit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function runnerBox() {
    return {
      x: runner.x + 10 * RUNNER_SCALE,
      y: runner.y + 16 * RUNNER_SCALE,
      w: 56 * RUNNER_SCALE,
      h: 56 * RUNNER_SCALE,
    };
  }

  function obstacleBox(o) {
    if (o.type === 'bird') {
      return { x: o.x + o.w * 0.2, y: o.y + o.h * 0.3, w: o.w * 0.55, h: o.h * 0.45 };
    }
    if (o.type === 'grass') return { x: o.x + 3, y: o.y + 10, w: o.w - 6, h: o.h - 10 };
    if (o.type === 'rock') return { x: o.x + 3, y: o.y + 4, w: o.w - 7, h: o.h - 4 };
    if (o.type === 'bush') return { x: o.x + 4, y: o.y + 6, w: o.w - 8, h: o.h - 6 };
    if (o.type === 'fence') return { x: o.x + 2, y: o.y + 2, w: o.w - 4, h: o.h - 2 };
    if (o.type === 'stump') return { x: o.x + 3, y: o.y + 4, w: o.w - 6, h: o.h - 4 };
    if (o.type === 'post') return { x: o.x + 2, y: o.y + 2, w: o.w - 4, h: o.h - 2 };
    return { x: o.x + 3, y: o.y + 2, w: o.w - 6, h: o.h - 2 };
  }

  // ------------------------------------------------------------------- update
  function update() {
    game.time += 1000 / 60;

    if (game.status === 'crashed') {
      game.crashFrames++;
      return;
    }
    if (game.status !== 'running') return;

    // a dificuldade acompanha o avanço: começa leve e sobe até o 497º
    const progress = Math.min(1, game.conquered / MUNICIPIOS.length);
    game.speed = CFG.startSpeed + (CFG.maxSpeed - CFG.startSpeed) * progress;
    game.distance += game.speed;
    game.worldX += game.speed;

    if (game.nightLeft > 0) game.nightLeft -= 1000 / 60;

    if (!runner.onGround) {
      runner.vy += CFG.gravity;
      runner.y += runner.vy;
      const floor = GROUND_Y - BODY_H;
      if (runner.y >= floor) {
        runner.onGround = true;
        runner.vy = 0;
        runner.h = BODY_H;
        runner.y = GROUND_Y - runner.h;
      }
    }

    runner.legClock += 1;
    if (runner.legClock >= 4) {
      runner.legClock = 0;
      runner.legPhase = (runner.legPhase + 1) % 8;
    }
    runner.blinkClock = (runner.blinkClock + 1) % 240;

    game.gap -= game.speed;
    if (game.gap <= 0) spawnWave();

    for (const o of game.obstacles) {
      o.x -= game.speed;
      if (o.type === 'bird') o.frameClock = (o.frameClock + 1) % 28;
    }
    game.obstacles = game.obstacles.filter((o) => o.x + o.w > -40);

    const rb = runnerBox();
    for (const o of game.obstacles) {
      if (!o.passed && o.x + o.w < rb.x) {
        o.passed = true;
        conquerCity();
        if (game.status === 'won') return;
      }
    }
    for (const o of game.obstacles) {
      if (hit(rb, obstacleBox(o))) { crash(); break; }
    }
  }

  // mantém os obstáculos presos ao chão (e os pássaros na altura certa)
  function anchorObstacles() {
    for (const o of game.obstacles) {
      if (o.type === 'bird') {
        if (o.bottom === undefined) o.bottom = GROUND_Y - o.y - o.h;
        o.y = GROUND_Y - o.bottom - o.h;
      } else {
        o.y = GROUND_Y - o.h;
      }
    }
  }

  // ------------------------------------------------------------------- render
  const params = new URLSearchParams(location.search);
  const showBoxes = params.get('boxes') === '1';

  const palette = () => (game.nightLeft > 0 ? PAL.night : PAL.day);

  // -------------------------------------------------- paleta fixa (pixels duros)
  const LUTS = new Map();

  const hexRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];

  function lutFor(p) {
    const key = p.bg + p.fg + p.cloud;
    if (LUTS.has(key)) return LUTS.get(key);

    const cols = [p.bg, p.fg, p.cloud].map(hexRgb);
    const lut = new Uint8ClampedArray(32768 * 3);

    for (let r = 0; r < 32; r++) {
      for (let g = 0; g < 32; g++) {
        for (let b = 0; b < 32; b++) {
          const R = (r << 3) | 4;
          const G = (g << 3) | 4;
          const B = (b << 3) | 4;
          let best = 0;
          let bd = Infinity;
          for (let i = 0; i < cols.length; i++) {
            const dr = R - cols[i][0];
            const dg = G - cols[i][1];
            const db = B - cols[i][2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bd) { bd = d; best = i; }
          }
          const idx = ((r << 10) | (g << 5) | b) * 3;
          lut[idx] = cols[best][0];
          lut[idx + 1] = cols[best][1];
          lut[idx + 2] = cols[best][2];
        }
      }
    }
    LUTS.set(key, lut);
    return lut;
  }

  function posterize(p) {
    const img = ctx.getImageData(0, 0, art.width, art.height);
    const d = img.data;
    const lut = lutFor(p);
    for (let i = 0; i < d.length; i += 4) {
      const idx = (((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)) * 3;
      d[i] = lut[idx];
      d[i + 1] = lut[idx + 1];
      d[i + 2] = lut[idx + 2];
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function render() {
    anchorObstacles();
    const p = palette();
    const night = game.nightLeft > 0;

    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);

    if (night) {
      drawStars(p);
      drawMoon(p);
    }
    drawClouds(p);
    drawGround(p);

    if (screen === 'game') {
      for (const o of game.obstacles) {
        if (o.type === 'bird') drawBird(o, p);
        else drawObstacle(o, p);
      }
      drawRunner(p);
      if (game.status === 'waiting') drawHint(p);
      if (showBoxes) drawBoxes();
    } else {
      if (screen === 'menu') drawRunner(p);
      drawMenu(p);
    }

    // paleta limitada + ampliação nearest-neighbor = pixels duros
    posterize(p);
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, canvas.width, canvas.height);
    out.drawImage(art, 0, 0, art.width, art.height, 0, 0, canvas.width, canvas.height);

    // HUD dos municípios em fonte comum, depois do upscale
    if (screen === 'game') {
      withCssSpace((cw, ch) => {
        if (game.status === 'running') drawMunicipioHud(cw, p);
        else if (game.status === 'crashed' || game.status === 'won') drawGameOver(cw, ch, p);
      });
    } else {
      withCssSpace((cw, ch) => drawMenuText(cw, ch, p));
    }

    syncTouchUI();
  }

  function drawStars(p) {
    ctx.fillStyle = p.fg;
    for (const s of STARS) {
      ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(game.time / 620 + s.p));
      ctx.fillRect(s.x, s.y, 1.1, 1.1);
    }
    ctx.globalAlpha = 1;
  }

  function drawMoon(p) {
    const mx = W - 120;
    const my = Math.max(26, GROUND_Y * 0.16);
    ctx.fillStyle = p.fg;
    ctx.beginPath();
    ctx.arc(mx, my, 8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.bg;
    ctx.beginPath();
    ctx.arc(mx + 3.6, my - 1.6, 7, 0, TAU);
    ctx.fill();
  }

  function drawClouds(p) {
    ctx.strokeStyle = p.cloud;
    ctx.lineWidth = Math.max(0.8, UNIT_PX * 0.6);
    ctx.lineJoin = 'miter';
    for (const c of CLOUDS) {
      const span = W + 220;
      const x = ((c.x - game.worldX * 0.1) % span + span) % span - 90;
      const s = c.s;
      ctx.beginPath();
      ctx.moveTo(x - 26 * s, c.y + 4 * s);
      ctx.lineTo(x - 20 * s, c.y - 2 * s);
      ctx.lineTo(x - 12 * s, c.y - 2 * s);
      ctx.lineTo(x - 8 * s, c.y - 8 * s);
      ctx.lineTo(x + 4 * s, c.y - 8 * s);
      ctx.lineTo(x + 9 * s, c.y - 4 * s);
      ctx.lineTo(x + 15 * s, c.y - 4 * s);
      ctx.lineTo(x + 19 * s, c.y + 1 * s);
      ctx.lineTo(x + 26 * s, c.y + 1 * s);
      ctx.closePath();
      ctx.stroke();
    }
  }

  function drawGround(p) {
    ctx.fillStyle = p.fg;
    ctx.fillRect(0, GROUND_Y + 1, W, 1);
    for (const m of MARKS) {
      const span = W + 240;
      const x = ((m.x - game.worldX) % span + span) % span - 60;
      ctx.fillRect(x, GROUND_Y + 4 + m.y, m.w, m.h);
    }
  }

  function poly(points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function strokePath(points, width) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
  }

const GALOPE_FRAMES = [
  'data:image/png;base64,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',
  'data:image/png;base64,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',
  'data:image/png;base64,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',
  'data:image/png;base64,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',
  'data:image/png;base64,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',
  'data:image/png;base64,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',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAqsAAAJGCAYAAAB8wcytAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAADj5SURBVHhe7dhtjiS5kiXYWsb8GPT+dzmD93AL4RNzqck0pxr14xzgoqorQyhCKk1d0f8DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAb/d//u//6/95erJVAADupn3cPS3ZKgAAd9M+7p6WbBUAgLtpH3dPS7YKAMDdtI+7pyVbBQDgbtrH3dOSrQIAcDft4+5pyVYBALib9nH3tGSrAADcTfu4e1qyVQAA7qZ93D0t2SoAAHfTPu6elmwVAIAraB9sb06OBQCAK2gfbG9OjgUAgCtoH2xvTo4FAIAraB9sb06OBQCAK2gfbG9OjgUAgCtoH2xvTo4FAIAraB9sb06OBQCAK2gfbG9OjgUAgCtoH2xvTo4FAIAraB9sb06OBQCAK2gfbG9OjgUAgCtoH2xvTo4FAIBZ7aNK7pc8TgCAZ2kfPnK/5HECADxL+/CR+yWPEwDgWdqHj9wveZwAAM/SPnzkfsnjBAB4lvbhI/dLHicAwLO0Dx+5X/I4AQCepX34yP2SxwkA8Cztw0fulzxOAIBnaR8+cr/kcQIAPEv78JH7JY8TAIBZ7aNqRzLOKVq/o6QMAIDd2sfajmScU7R+o6QEAIAraB9sO5JxTtH6jZISAACuoH2w7UjGOUXrN0pKAAC4gvbBtiMZ5xSt3ygpAQDgCtoH245knFO0fqOkBACAK2gfbDuScU7R+o2SEgAArqB9sO1IxjlF6zdKSgAAuIL2wbYjGecUrd8oKQEA4AraB9uOZJxTtH6jpAQAgCtoH2w7knFO0fqNkhIAAK6gfbDtSMY5Res3SkoAAK6vfcxcPRl9WltjVdJiuzbbKCkBALi+9jFz9WT0aW2NVUmL7dpso6QEAOD62sfM1ZPRp7U1ViUttmuzjZISAIDrax8zV09Gn9bWWJW02K7NNkpKAACur33MXD0ZfVpbY1XSYrs22ygpAQC4vvYxc/Vk9GltjVVJi+3abKOkBADg+trHzNWT0ae1NVYlLbZrs42SEgCA62sfM1dPRp/W1liVtNiuzTZKSgAArq99zFw9GX1aW2NV0mK7NtsoKQEAuL72MXP1ZPRpbY1VSYvt2myjpAQA4Prax8zVk9GntTVWJS22a7ONkhIAgGdpHz5vT47mFK3fimR5AIDnah9Bb0yOY7nWa1XSAgDgudpH0BuT4zhF67ciWR4A4LnaR9Abk+M4Reu3IlkeAOC52kfQG5PjOEXrtyJZHgDgudpH0BuT4zhF67ciWR4A4JnaB9BbkyM5Reu3IlkeAOBZ2ofP25OjOUXrtyJZHgDgWdqHz9uTozlF67ciWR4A4Fnah8/bk6M5Reu3IlkeAOBZ2ofP25OjOUXrtyJZHgDgWdqHz9uTozlF67ciWR4A4Prax8yOZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQA4Fnah8+OZJwprf4OyfjT2hqjpAQAgDO0D7BRUnKK1m9HMg4AAFfQPthGSckpWr8dyTgAAFxB+2AbJSWnaP12JSMBALBb+1gbJSWnaP12JSMBALBb+1gbJSWnaP12JSMBALBb+1gbJSWnaP12JSMBALBb+1gbJSWnaP12JSMBALBb+1gbJSWnaP12JSMBALBb+1gbJSWnaP12JSMBALBb+1gbJSWnaP12JSMBALBb+1gbJSWnaP12JSMBAHCG9gH2M/ln/9X++ygpOU3ruSMZBwCAM7QPsFFScjttL6uSFgAAnKF9gI2Skttpe1mVtAAA4AztA2yUlNxO28uqpAUAAGdoH2CjpOR22l5WJS0AADhD+wAbJSW30/ayKmkBAMAZ2gfYKCm5nbaXVUkLAADO0D7ARknJ7bS9rEpaAABwhvYBNkpKbqftZVXSAgCAM7QPsFFScjttL6uSFgAAnKF9gI2Skttpe1mVtAAA4AztA2yUlNxO28uqpAUAADPaB9WqpMXttL2sSloAADCjfVCtSlrcTtvLqqQFAAAz2gfVqqTF7bS9rEpaAAAwo31QrUpa3E7by6qkBQAAM9oH1aqkxe20vaxKWgAAMKN9UK1KWtxO28uqpAUAADPaB9WqpMXttL2sSloAADCjfVCtSlrcTtvLqqQFAAAz2gfVqqTF7bS9rEpaAAAwo31QrUpa3E7by6qkBQAAM9oH1aqkxe20vaxKWgAAMKN9UB0lZf8/7d/+m2SZ7dpsq5IWAADMah9VR0nZlFY/SkpO0fqtSlrANu1ejpKSaW2NUVICAGu1PzpHSdmUVj9KSk7Teq5Ilodt2r0cJSXT2hqjpAQA1mp/dI6SsimtfpSUnKL1W5W0gG3avRwlJdPaGqOkBADWan90jpKyKa1+lJScovVblbSAbdq9HCUl09oao6QEANZqf3SOkrIprX6UlJyi9VuVtIBt2r0cJSXT2hqjpAQA1mp/dEZJybS2xigpOUXrtyppAdu0ezlKSqa1NUZJCQCs1f7ojJKSaW2NUVJyitZvVdICtmn3cpSUTGtrjJISAFir/dEZJSXT2hqjpOQUrd+qpAVs0+7lKCmZ1tYYJSUAsFb7ozNKSqa1NUZJySlav1VJC9im3ctRUjKtrTFKSgBgrfZHZ5SUTGtrjJKS07SeK5LlYZt2L0dJybS2xigpAYC12h+dUVIyra0xSkpO03quSJaHbdq9HCUl09oao6QEANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHANZqf3RGScm0tsYoKTlF67cqaQHbtHu5IxkHAP5Z+0MySkpO0fqNkpJTtH6rkhbwVT/v3t93clcyDgD8s/aHZJSUnKL1GyUlp2j9ViUteJl2F3YlI01p9auSFgDwz9ofklFScorWb5SUnKL1W5W04GXaXdiVjDSl1a9KWgDAP2t/SEZJySlav1FScorWb1XSgpdpd2FXMtKUVr8qaQEA/6z9IRklJado/UZJySlav1VJC16m3YVdyUhTWv2qpAUA/LP2h2SUlJyi9RslJado/VYlLXiZdhd2JSNNafWrkhYA8M/aH5JRUnKK1m+UlJyi9VuVtOBl2l3YlYw0pdWvSloAwD9rf0hGSckpWr9RUnKK1m9V0oKXaXdhVzLSlFa/KmkBAP+s/SEZJSWnaP1GSckpWr9VSQtept2FXclIU1r9qqQFAPyz9odklJScovUbJSWnaP1WJS14mXYXdiUjTWn1q5IWAPDP2h+SUVJyitZvlJScovVblbTgZdpd2JWMNKXVr0paAMA/a39IRknJKVq/UVJyitZvVdKCl2l3YVcy0pRWvyppAQD/rP0hGSUlp2j9RknJJbT5diTj8Jd2Vm9OjmW51mtl0gaAN2p/GEZJySlav1FScgltvh3JOPzQzuntydGcovVblbQA4I3aH4ZRUnKK1m+UlFxCm29HMg4/tHN6e3I0p2j9ViUtAHij9odhlJScovUbJSWX0ObbkYzDD+2c3p4czSlav1VJCwDeqP1hGCUlp2j9RknJJbT5diTj8EM7p7cnR3OK1m9V0gKAN2p/GEZJySlav1FScgltvh3JOPzQzuntydGcovVblbQA4I3aH4ZRUnKK1m+UlFxCm29HMg4/tHN6e3I0p2j9ViUtAHij9odhlJScovUbJSWX0ObbkYzDD+2c3p4czSlav1VJCwDeqP1hGCUlp2j9RknJJbT5diTj8EM7p7cnR3OK1m9V0gKAN2p/GEZJySlav1FScgltvh3JOPzQzuntydGcovVblbQA4I3aH4ZRUnKK1m+UlFxCm29HMg5/aWf15uRYTtH6rUpaAPBG7Q/Dv0mW+bWZtf7u/Xfyz76qzfHbfLru/9b953/+r7//73//9yf7z17l/5uzzuWf1v3Pf/+p/ZujpAyAN2p/GFYky5+i9TtKym6n7WVV0mK7NtvTkq2eovXblYw0pdUfJWUAvFH7w/CbZNlTtb5HSdnttL2sSlps12Z7WrLVU7R+u5KRprT6o6QMgDdqfxh+k/9d87+Ln+Tvnv+UlN1O28uqpMV2bbanJVs9Reu3KxlpSqs/SsoAeKP2h+HTZMn/rpn/9RR/9/2npOx22l5WJS22a7M9LdnqKVq/XclIU1r9UVIGwBu1PwwrkuVP0fodJWW30/ayKmmxXZvtaclWT9H67UpGmtLqj5IyAN6o/WFYkSx/itbvKCm7nbaXVUmL7dpsT0u2eorWb1cy0pRWf5SUAfBG7Q/DqqTFcq3XUVJ2O20vq5IW27XZnpZs9RSt365kpCmt/igpA+CN2h+GVUmL5Vqvo6TsdtpeViUttmuzPS3Z6ilav13JSFNa/VFSBsAbtT8Mq5IWy7VeR0nZ7bS9rEpabNdme1qy1VO0fruSkaa0+qOkDIA3an8YViUtlmu9jpKy22l7WZW02K7N9rRkq6do/XYlI01p9UdJGQBv1P4wrEpaLNd6HSVlt9P2sippsV2b7WnJVk/R+u1KRprS6o+SMgDeqP1hkHOSI7+ENt8oKZnW1rhDMv6ttH0cJWW30/YySkoAeIr2spdzkiO/hDbfKCmZ0urvkmzhVto+jpKy22l7GSUlADxFe9nLOcmRX0Kbb5SUTGn1d0m2cCttH0dJ2e20vYySEgCeor3s5ZzkyC+hzTdKSqa0+rskW7iVto+jpOx22l5GSQkAT9Fe9nJOcuSX0OYbJSVTWv1dki3cStvHUVJ2O20vo6QEgKdoL3s5JznyS2jzjZKSKa3+LskWbqXt4ygpu522l1FSAsBTtJe9nJMc+SW0+UZJyZRWf5dkC7fS9nGUlN1O28soKQHgKdrLXs5JjvwS2nyjpGRKq79DMv7ttL0cJWW30/YySkoAeIr2spdzkiO/hDbfKCmZ0urvkIx/O20vR0nZ7bS9jJISAJ6ivezlnOTIL6HNN0pKprT6OyTj307by1FSdjttL6OkBICnaC97OSc58kto842Skmltjasno99O28tRUnY7bS+jpASAb2ovZDkvP8/8vw9g4GfNbFK6VZvrLvnf+Vfv4z/r3VHby1FS9jWrZmjrjJISAL6pvZDlnOTIp7U15JzkyPmhndNRUnaK1m+UlExra4ySEgC+qb2Q5ZzkyKe1NeSc5Mj5oZ3TUVJ2itZvlJRMa2uMkhIAvqm9kOWc5MintTXknOTI+aGd01FSdorWb5SUTGtrjJISAL6pvZDlnOTIp7U15JzkyPmhndNRUnaK1m+UlExra4ySEgC+qb2Q5ZzkyKe1NeSc5Mj5oZ3TUVJ2itZvlJRMa2uMkhIAvqm9kOWc5MintTXknOTI+aGd01FSdorWb5SUTGtrjJISAL6pvZDlnOTIp7U15JzkyPmhndNRUnaK1m+UlExra4ySEgC+qb2Q5ZzkyKe1NeSc5Mj5oZ3TUVJ2itZvlJRMa2uMkhIAvqm9kOWc5MintTXknOTI+aGd01FSdorWb5SUTGtrjJISAL6pvZDlnOTIp7U15JzkyPmhndNRUnaK1m+UlExra4ySEgC+qb2Q5ZzkyKe1NeSc5Mj5oZ3TUVJ2itZvlJRMa2uMkhKAf6e9UETkmcnPng+1Mx0lJdPaGqOk5BLafCuS5QF8rIq8KfnZ84F2nkdJ2bS2xigpuYQ234pkeQAfqyJvSn72fKid6SgpmdbWGCUll9DmW5EsD+BjVeRNyc+eD7UzHSUl09oao6TkEtp8K5LlAXysirwp+dnzgXaeR0nZtLbGKCm5hDbfimR5AB+rIm9KfvZ8oJ3nUVI2ra0xSkouoc23IlkewMeqyJuSnz0faOd5lJRNa2uMkpJLaPOtSJYH8LEq8qbkZ88H2nkeJWXT2hqjpOQS2nwrkuUBfKyKvCn52fOBdp5HSdm0tsYoKbmENt+KZHkAH6sib0l+8nyonelRUjatrTFKSi6hzbciWR7Ax6rIm5KfPR9o53mUlE1ra4ySkkto861Ilgfe5u8XwN8vh39Kyj62Yo0z/b3fmaR0udZLzkuOfUqrP0rKprT6VUkL/tLO6j85+m8782/n+s+/P1PruSJZHnii9qNflbR4tLbvUVJymtZTzkmOfEqrP0rKprU1RkkJH2pnuisZaUqrP0rKtmuzjZIS4Inaj35V0uLR2r5HSclpWk85JznyKa3+KCmb1tYYJSV8qJ3prmSkKa3+KCnbrs02SkqAJ2o/+lVJi0dr+x4lJadpPeWc5MintPqjpGxaW2OUlPChdqa7kpGmtPqjpGy7NtsoKQGeqP3oVyUtHq3te5SUnKb1lHOSI5/W1hglJdPaGqOkhA+1M92VjDSl1R8lZdu12UZJCfBE7Ue/KmnxaG3fo6TkNK2nnJMc+ZRWf5SUTWtrjJISPtTOdFcy0pRWf5SUbddmGyUlwBO1H/2qpMWjtX2PkpLTtJ5yTnLkU1r9UVI2ra0xSkr4UDvTXclIU1r9UVK2XZttlJQAT9R+9KuSFo/W9j1KSk7Teso5yZFPafVHSdm0tsYoKeFD7Ux3JSNNafVHSdl2bbZRUgI8UfvRr0paPFrb9ygpOU3rKeckRz6l1R8lZdPaGqOkhA+1M92VjDSl1R8lZdu12UZJCfBE7Ue/KmnxaG3fo6TkNK2nnJMc+ZRWf5SUTWn1R0kZH2pnuisZaUqrP0rKtmuzjZIS4Inaj35V0uLR2r5HSclpWk85JznyKa3+KCmb0uqPkjI+1M50VzLSlFZ/lJRt12YbJSXAE7Uf/aqkxaO1fY+SktO0nnJOcuRTWv1RUjatrXGUlPGBdp67kpGmtPqjpGy7NtsoKQGOtB/PHZLx+VA701FScgltPplPjnFKqz9Kyk7R+h0lZUQ7ozsk409ra4ySkmltjVFSMqXVHyVl8C7tx3CHZHw+1M50lJRcQptP5pNjnNLqj5KyU7R+R0kZ0c7oDsn409oao6RkWltjlJRMafVHSRm8S/sx3CEZnw+1Mx0lJZfQ5pP55BintPqjpOwUrd9RUka0M7pDMv60tsYoKZnW1hglJVNa/VFSBu/Sfgx3SMbnQ+1MR0nJJbT5ZD45ximt/igpO0Xrd5SUEe2M7pCMP62tMUpKprU1RknJlFZ/lJTBu7Qfwx2S8flQO9NRUnIJbT6ZT45xSqs/SspO0fodJWVEO6M7JONPa2uMkpJpbY1RUjKl1R8lZfAu7cdwh2R8PtTOdJSUXEKbT+aTY5zS6o+SslO0fkdJGdHO6A7J+NPaGqOkZFpbY5SUTGn1R0kZvEv7MdwhGZ8PtTMdJSWX0OaT+eQYp7T6o6TsFK3fUVJGtDO6QzL+tLbGKCmZ1tYYJSVTWv1RUgbv0n4Md0jG50PtTEdJySW0+WQ+OcYprf4oKTtF63eUlBHtjO6QjD+trTFKSqa1NUZJyZRWf5SUwbu0H8MdkvH5UDvTUVJyCW0+mU+OcUqrP0rKTtH6HSVlRDujOyTjT2trjJKSaW2NUVIypdUfJWXwLu3HcIdkfD7UznSUlFxCm0/mk2Oc0uqPkrJTtH5HSRnRzugOyfjT2hqjpGRaW2OUlExp9UdJGbxL+zHcIRmfD7UzHSUll9Dmk/nkGKe0+qOk7BSt31FSRrQzukMy/rS2xigpmdbWGCUlU1r9UVIG19Mu7BOT7fIF7fxHScnttL28PTmaKa3+KCm7hDbfKCm5nbaXVUmL7dpsu5KRlmu9jpIyuJ52YZ+WbJUvac9glJTcUtvPm5NjmdLqj5KyS2jzjZKS22l7WZW02K7NtisZabnW6ygpg+tpF/ZpyVb5kvYMRknJLbX9vDk5limt/igpu4Q23ygpuZ22l1VJi+3abLuSkZZrvY6SMriedmGflmyVL2nPYJSU3FLbz5uTY5nS6o+Sskto842Skttpe1mVtNiuzbYrGWm51usoKYPraRf2aclW+ZL2DEZJyS21/bw5OZYprf4oKbuENt8oKbmdtpdVSYvt2my7kpGWa72OkjK4nnZhn5ZslS9pz2CUlNxS28+bk2OZ0uqPkrJLaPONkpLbaXtZlbTYrs22KxlpudbrKCmD62kX9mnJVvmS9gxGSckttf28OTmWKa3+KCm7hDbfKCm5nbaXVUmL7dpsu5KRlmu9jpIyuJ52YZ+WbJUvac9glJTcUtvPm5NjmdLqj5KyS2jzjZKS22l7WZW02K7NtisZabnW6ygpg+tpF/ZpyVb5kvYMRknJLbX9vDk5limt/igpu4Q23ygpuZ22l1VJi+3abLuSkZZrvY6SMriedmGflmyVL2nPYJSU3FLbz5uTY5nS6o+Sskto842Skttpe1mVtNiuzbYrGWm51usoKYPraRf2aclW+ZL2DEZJye20vbw9OZoprf4oKbuENt8oKbmdtpdVSYvt2my7kpGWa72OkjK4nnZhn5ZslS9pz2CUlNxS28+bk2OZ0uqPkrJLaPONkpJbaftYmbTZrs22KxlpudbrKCmDz7RL9fbkaLig9rxGScnjtb0/LdnqlFZ/lJTdTtvLKCk5Reu3KxnpdtpeViUtprT6VUkL+Ey7VG9PjoYLas9rlJQ8Xtv705KtTmn1R0nZ7bS9jJKSU7R+u5KRbqftZVXSYkqrX5W0gM+0S/X25Gi4oPa8RknJ47W9Py3Z6pRWf5SU3U7byygpOUXrtysZ6XbaXlYlLaa0+lVJC/hMu1RvT46GC2rPa5SUPF7b+9OSrU5p9UdJ2e20vYySklO0fruSkW6n7WVV0mJKq1+VtIDPtEv19uRouKD2vEZJyeO1vT8t2eqUVn+UlN1O28soKTlF67crGel22l5WJS2mtPpVSQv4TLtUb0+Ohgtqz2uUlDxe2/vTkq1OafVHSdnttL2MkpJTtH67kpFup+1lVdJiSqtflbSAz7RL9fbkaLig9rxGScnjtb0/LdnqtLbGKCm5nbaXUVJyitZvVzLS7bS9rEpaTGn1q5IW8Jl2qd6eHA0X1J7XKCl5vLb3pyVbndbWGCUlt9P2MkpKTtH67UpGup22l1VJiymtflXSAj7TLtXbk6PhgtrzGiUlj9f2/rRkq9PaGqOk5HbaXkZJySlav13JSLfT9rIqaTGl1a9KWsBn2qV6e3I0XFB7XqOk5PHa3p+WbHVaW2OUlNxO28soKTlF67crGel22l5WJS2mtPpVSQv4TLtUb0+Ohgtqz2uUlDxe2/vTkq1Oa2uMkpLbaXsZJSWnaP12JSPdTtvLqqTFlFa/KmkBf7SL8rRkq1Na/VFSxgW157UiWf6W2n6elmx1WltjlJQ8Wtv3HZLxb6ntpyX/fFpbY1cyEvx77UI9MdnutLbGKCnhgtrzWpW0uJ22l6clW53W1hglJY/W9n2HZPzbaXs5SsqmtPodyTjwmXapnphsd1pbY5SUcEHtea1KWtxO28vTkq1Oa2uMkpJHa/u+QzL+7bS9HCVlU1r9jmQc+Ey7VE9MtjutrTFKSrig9rxWJS1up+3laclWp7U1RknJo7V93yEZ/3baXo6SsimtfkcyDnymXaonJtud1tYYJSVcUHteq5IWt9P28rRkq9PaGqOk5NHavu+QjH87bS9HSdmUVr8jGQc+0y7VE5PtTmtrjJISLqg9r1VJi9tpe3lastVpbY1RUvJobd93SMa/nbaXo6RsSqvfkYwDn2mX6onJdqe1NUZJCRfUnteqpMXttL08LdnqtLbGKCl5tLbvOyTj307by1FSNqXV70jGgc+0S/XEZLvT2hqjpIQLas9rVdLidtpenpZsdVpbY5SUPFrb9x2S8W+n7eUoKZvS6nck48Bn2qV6YrLdaW2NUVLCBbXntSppcTttL09LtjqtrTFKSh6t7fsOyfi30/ZylJRNafU7knHgM+1SPTHZ7rS2xigp4YLa81qVtLidtpenJVud1tYYJSWP1vZ9h2T822l7OUrKprT6Hck48Jl2qZ6YbHdaW2OUlHBB7XmtSlrcTtvL05KtTmtrjJKSR2v7vkMy/u20vRwlZVNa/Y5kHPhMu1RPTLY7ra0xSkq4oPa8ViUtbqft5WnJVqe0+qOk7NHavu+QjH87bS+jpGRaW2NHMg6z2iEeJWW30vbx9uRoprU1RkkJN9ee7ROT7U5p9buSkaa0+lVJC35o5yTzyTHCH+2iHCVlt9L28fbkaKa1NUZJCTfXnu0Tk+1OafW7kpGmtPpVSQt+aOck88kxwh/tohwlZbfS9vH25GimtTVGSQk3157tE5PtTmn1u5KRprT6VUkLfmjnJPPJMcIf7aIcJWW30vbx9uRoprU1RkkJN9ee7ROT7U5p9buSkaa0+lVJC35o5yTzyTHCH+2iHCVlt9L28fbkaKa1NUZJCTfXnu0Tk+1OafW7kpGmtPpVSQt+aOck88kxwh/tohwlZbfS9vH25GimtTVGSQk3157tE5PtTmn1u5KRprT6VUkLfmjnJPPJMcIf7aIcJWW30vbx9uRoprU1RkkJN9ee7ROT7U5p9buSkaa0+lVJC35o5yTzyTHCH+2iHCVlt9L28fbkaKa1NUZJCTfXnu0Tk+1OafW7kpGmtPpVSQt+aOck88kxwh/tooySkttpe3l7cjTT2hqjpISba8/2icl2p7T6XclIU1r9qqQFP7RzkvnkGOGPdlFGScnttL28PTmaaW2NUVLCzbVn+8Rku1Na/a5kpCmtflXSgh/aOcl8cozwR7soo6Tkdtpe3p4czbS2xigp4ebas31ist0prX5XMtKUVr8qacEP7ZxkPjlG+KNdFLln8khP0fqNkhJ4nHbf75CMz4fame5KRoJ3aT8GuWfySE/R+o2SEnicdt/vkIzPh9qZ7kpGgndpPwa5Z/JIT9H6jZISeJx23++QjM+H2pnuSkaCd2k/Brln8khP0fqNkhJ4nHbf75CMz4fame5KRoJ3aT8GuWfySE/R+o2SEnicdt/vkIzPh9qZ7kpGgndpPwa5Z/JIT9H6jZISeJx23++QjM+H2pnuSkaCd2k/Brln8khP0fqNkhJ4nHbf75CMz4fame5KRoJ3aT8GuWfySE/R+o2SEnicdt/vkIzPh9qZ7kpGgndpPwa5Z/JIT9H6jZISeJx23++QjM+H2pnuSkaCd2k/Brln8khP0fqNkhJ4nHbf75CMz4fame5KRoJ3aT8GuWfySE/R+o2SEnicdt/vkIzPh9qZ7kpGgnc5+jGM/t9yveQRnab1PErK4FHaXb9DMj4fame6KxkJONJ+PHJOcuSX0OZbkSzPh9qZHiVl/NDOaUcyzrS2xigp4UPtTFclLYBV2g9NzkuO/RLafKuSFnygnedRUsYP7Zx2JONMa2uMkhI+1M50VdICWKX90OS85Ngvoc23IlmeD7UzPUrK+KGd045knGltjVFSwofama5KWgCrtB+anJcc+yW0+VYky/OhdqZHSRk/tHPakYwzra0xSkr4UDvTVUkLYJX2Q5PzkmO/hDbfimR5PtTO9Cgp44d2TjuScaa1NUZJCR9qZ7oqaQGs0n5ocl5y7JfQ5luRLM+H2pkeJWX80M5pRzLOtLbGKCnhQ+1MVyUtgFXaD03OS479Etp8K5Ll+VA706OkjB/aOe1IxpnW1hglJXyonemqpAWwSvuhyXnJsV9Cm29Fsjwfamd6lJTxQzunHck409oao6SED7UzXZW0AFZpPzQ5Lzn2S2jzrUiW50PtTI+SMn5o57QjGWdaW2OUlPChdqarkhbAKu2HJuclx34Jbb4VyfJ8qJ3pUVLGD+2cdiTjTGtrjJISPtTOdFXSAlil/dDkvOTYL6HNtyJZng+1Mz1KyvihndOOZJxpbY1RUsKH2pmuSloAO7QfpbzjxdT2PUpK+FA706OkjB/aOe1IxpnW1hglJXyonemqpAWwS/thvj05mkdr+x4lJXyonelRUsYP7Zx2JONMa2uMkhI+1M50VdIC2KX9MN+eHM2jtX2PkhI+1M70KCnjh3ZOO5JxprU1RkkJH2pnuippAezSfphvT47m0dq+R0kJH2pnepSU8UM7px3JONPaGqOkhA+1M12VtAB2aT/MtydH82ht36OkhA+1Mz1KyvihndOOZJxpbY1RUsKH2pmuSloAu7Qf5tuTo3m0tu9RUsKH2pkeJWX80M5pRzLOtLbGKCnhQ+1MVyUtgF3aD/PtydE8Wtv3KCnhQ+1Mj5IyfmjntCMZZ1pbY5SU8KF2pquSFsAu7Yf59uRoHq3te5SU8KF2pkdJGT+0c9qRjDOtrTFKSvhQO9NVSQtgl/bDfHtyNI/W9j1KSvhQO9OjpIwf2jntSMaZ1tYYJSV8qJ3pqqQFsEv7Yb49OZpHa/seJSV8qJ3pUVLGD+2cdiTjTGtrjJISPtTOdFXSAtil/TDfnhzNo7V9j5ISPtTO9Cgp44d2TjuScaa1NUZJCR9qZ7oyaQPs0H6UT8zsXv97KC/Q9n6UlPGBdp5HSRk/tHNalbT4R//m3/6vv3sdJSV8qJ3pqqQFcAftR3yHZHx+aOe0KmnxaG3fT0y2u12bbVXSYkqrX5W0mNbWGCUlj9b2fZSUAU/TfvB3SMbnh3ZOq5IWj9b2/cRku9u12VYlLaa0+lVJi2ltjVFS8mht30dJGfA07Qd/h2R8fmjntCpp8Wht309Mtrtdm21V0mJKq1+VtJjW1hglJY/W9n2UlAFP037wd0jG54d2TquSFo/W9v3EZLvbtdlWJS2mtPpVSYtpbY1RUvJobd9HSRnwNO0Hf4dkfH5o57QqafFobd9PTLa7XZttVdJiSqtflbSY1tYYJSWP1vZ9lJQBT9N+8HdIxueHdk6rkhaP1vb9xGS727XZViUtprT6VUmLaW2NUVLyaG3fR0kZ8DTtB3+HZHx+aOe0KmnxaG3fT0y2u12bbVXSYkqrX5W0mNbWGCUlj9b2fZSUAU/TfvB3SMbnh3ZOq5IWj9b2/cRku9u12VYlLaa0+lVJi2ltjVFS8mht30dJGfA07Qd/h2R8fmjntCpp8Wht309Mtrtdm21V0mJKq1+VtJjW1hglJY/W9n2UlAFP037wd0jG54d2TquSFo/W9v3EZLvbtdlWJS2mtPpVSYtpbY1RUvJobd9HSRnwNO0Hf4dkfH5o57QqafFobd9PS7Z6CW2+VUmLKa1+VdJiWltjlJQ8Wtv3UVIGwDe1F/KKZPnHa3uX+yWPc1pbY5SUTGtrrEpaPFrb96qkBQDf0l7Gq5IWj9f2LvdLHue0tsYoKZnW1liVtHi0tu9VSQsAvqW9jFclLR6v7V3ulzzOaW2NUVIyra2xKmnxaG3fq5IWAHxLexmvSlo8Wtu33DN5pNPaGqOkZFpbY1XS4tHavlclLQD4lvYyXpW0eLS2b7ln8kintTVGScm0tsaqpMWjtX2vSloA8C3tZbwqafFobd9yz+SRTmtrjJKSaW2NVUmLR2v7XpW0AOBb2st4VdLi0dq+5Z7JI53W1hglJdPaGquSFo/W9r0qaQHAt7SX8aqkxaO1fcs9k0c6ra0xSkqmtTVWJS0ere17VdICgG9pL+NVSYtHa/uWeyaPdFpbY5SUTGtrrEpaPFrb96qkBQDf0l7Gq5IWj9b2LfdMHum0tsYoKZnW1liVtHi0tu9VSQsAvqW9jFclLR6t7VvumTzSaW2NUVIyra2xKmnxaG3fq5IWAHxTeyGvSJa/nbYXeX7y+Ke1NVYlLf5Rq/2npPQ22h52JmMB8Lf20lyVtCDaGT0x2e5yrdcdkvGntTVWJS2mtPqjpGy7NtuOZBwAfqu9ZFclLYh2Rk9Mtrtc63WHZPxpbY1VSYsprf4oKduuzbYjGQeA32ov2VVJC6Kd0ROT7S7Xet0hGX9aW2NV0mJKqz9KyrZrs+1IxgHgt9pLdlXSgmhn9MRku8u1XndIxp/W1liVtJjS6o+Ssu3abDuScQD4rfaSXZW0INoZPTHZ7nKt1x2S8ae1NVYlLaa0+qOkbLs2245kHAB+q71kVyUtiHZGT0y2u1zrdYdk/GltjVVJiymt/igp267NtiMZB4Dfai/ZVUkLop3RE5PtLtd63SEZf1pbY1XSYkqrP0rKtmuz7UjGAeC32kt2VdKCaGf0xGS7y7Ved0jGn9bWWJW0mNLqj5Ky7dpsO5JxAPit9pJdlbQg2hk9Mdnucq3XHZLxp7U1ViUtprT6o6RsuzbbjmQcAH6rvWRXJS2IdkZPTLa7XOt1h2T8aW2NVUmLKa3+KCnbrs22IxkHgN9qL9lVSQuindETk+0u13rdIRl/WltjVdJiSqs/Ssq2a7PtSMYB4G/tpbkqafF4be9vTo7l0dq+5d8lR7ldm21V0gKA32gv2FVJi8dre39zciyP1vYt/y45yu3abKuSFgD8RnvBrkpaPF7b+5uTY3m0tm/5d8lRbtdmW5W0AOA32gt2VdLi8dre35wcy6O1fcu/S45yuzbbqqQFAL/RXrCrkhaP1/b+5uRYHq3tW/5dcpTbtdlWJS0A+I32gl2VtHi8tvc3J8fyaG3f8u+So9yuzbYqaQHAb7QX7KqkxeO1vb85OZZHa/uWf5cc5XZttlVJCwB+o71gVyUtHq/t/c3JsTxa27f8u+Qot2uzrUpaAPAb7QW7KmnxeG3vb06O5dHavuXfJUe5XZttVdICgN9oL9hVSYvHa3t/c3Isj9b2Lf8uOcrt2myrkhYA/EZ7wa5KWjxe2/ubk2N5tLZv+XfJUW7XZluVtADgN9oLVuTT5FrxEO0Z70jGOUXrtyJZHoDfai9ZkZZcGV6k3YMdyTinaP1GSQkA39ReyCItuTK8SLsHO5JxTtH6jZISAL6pvZBFWnJleJF2D3Yk45yi9RslJQB8U3shi/ydXBdept2FHck4p2j9RkkJAN/UXsgifyfXhZdpd2FHMs4pWr9RUgLAN7UXssjfyXXhZdpd2JGMc4rWb5SUAPBN7YUs8ndyXXiZdhd2JOOcovUbJSUAfFN7IYv8nVwXXqbdhR3JOKdo/UZJCQDf1F7IIn8n14WXaXdhRzLOKVq/UVICwDe1F7LI38l14WXaXdiRjHOK1m+UlADwTe2FLPJ3cl14mXYXdiTjnKL1GyUlAHxTeyHvSMa5pbafHck4sEy7ZzuScaa0+lVJCwC+qb2QdyTj3FLbz45kHFim3bMdyThTWv2qpAUA39ReyDuScW6p7WdHMg4s0+7ZjmScKa1+VdICgG9qL+QdyTi31PazIxkHlmn3bEcyzpRWvyppAcA3tRfyjmScW2r72ZGMA8u0e7YjGWdKq1+VtADgm9oLeUcyzi21/exIxoFl2j3bkYwzpdWvSloA8E3thbwjGeeW2n52JOPAMu2e7UjGmdLqVyUtAPim9kLekYxzS20/O5JxYJl2z3Yk40xp9auSFgB8U3sh70jGuaW2nx3JOLBMu2c7knGmtPpVSQsAvqm9kHck49xS28+OZBxYpt2zHck4U1r9qqQFAN/UXsg7knFuqe1nRzIOLNPu2Y5knCmtflXSAoBvai/kbyZj3Frb19WT0eFQuzs7knGmtPqjpAyAq2ov71VJC6Kd0a5kJDjU7s6OZJwprf4oKQPgqtrLe1XSgmhntCsZCQ61u7MjGWdKqz9KygC4qvbyXpW0INoZ7UpGgkPt7uxIxpnS6o+SMgCuqr28VyUtiHZGu5KR4FC7OzuScaa0+qOkDICrai/vVUkLop3RrmQkONTuzo5knCmt/igpA+Cq2st7VdKCaGe0KxkJDrW7syMZZ0qrP0rKALiq9vJelbQg2hntSkaCQ+3u7EjGmdLqj5IyAK6qvbxXJS2Idka7kpHgULs7O5JxprT6o6QMgKtqL+9VSQuindGuZCQ41O7OjmScKa3+KCkD4Kray3tV0oJoZ7QrGQkOtbuzIxlnSqs/SsoAuKr28l6VtOCHdk47knHgULs7O5JxprT6o6QMgKtqL+9VSQs+1M50VzISL9Puwo5knCmt/igpA+Cq2st7VdKCD7Uz3ZWMxMu0u7AjGWdKqz9KygC4qvbyXpW04EPtTHclI/Ey7S7sSMaZ0uqPkjIArqq9vFclLfhQO9NdyUi8TLsLO5JxprT6o6QMgKtqL+9VSQs+1M50VzISL9Puwo5knCmt/igpA+Cq2st7VdKCD7Uz3ZWMxMu0u7AjGWdKqz9KygC4qvbyXpW04EPtTHclI/Ey7S7sSMaZ0uqPkjIArqq9vFclLfhQO9NdyUi8TLsLO5JxprT6o6QMgKtqL+9VSQs+1M50VzISL9Puwo5knCmt/igpA+Cq2st7VdKCD7Uz3ZWMxMu0u7AjGWdKqz9KygC4qvbyXpW04EPtTHclI/Ey7S7sSMaZ0uqPkjIAvq29lL+djMIXtPPflYzEBbXn9fbkaAD4pvZC3pGMwxe089+VjMQFtef19uRoAPiW9jLelYzEF7Tz35WMxAW15/X25GgA+Jb2Mt6VjMQXtPPflYzEBbXn9fbkaAD4lvYy3pWMxBe089+VjMQFtef19uRoAPiW9jLelYzEF7Tz35WMxAW15/X25GgA+Jb2Mt6VjMQXtPPflYzEBbXn9fbkaAD4lvYy3pWMxBe089+VjMQFtef19uRoAPiW9jLelYzEF7Tz35WMxAW15/X25GgA+Jb2Mt6VjMQXtPPflYzEBbXn9fbkaAD4lvYy3pWMxBe089+VjMQFtef19uRoAPiW9jLelYzEl7RncPVkdL6kPYO3J0cDwN/aS/NpyVa5oPa8diUj3Urbx1FSNqXV3yEZ/x+12tVJKwB+o71gn5ZslQtqz2tXMtKttH0cJWVTWv0dkvGntPqVSRsAfqO9YJ+WbJULas9rVzLSrbR9HCVlU1r9HZLxp7T6lUkbAH6jvWCflmyVC2rPa1cy0q20fRwlZVNa/R2S8ae0+pVJGwB+o71gn5ZslQtqz2tXMtKttH0cJWVTWv0dkvGntPqVSRsAfqO9YJ+WbJULas9rVzLSrbR9HCVlU1r9HZLxp7T6lUkbAH6jvWCflmyVC2rPa1cy0q20fRwlZVNa/R2S8ae0+pVJGwB+o71gn5ZslQtqz2tXMtKttH0cJWVTWv0dkvGntPqVSRsAfqO9YJ+WbJULas9rVzLSrbR9HCVlU1r9HZLxp7T6lUkbAH6jvWCflmyVC2rPa1cy0q20fRwlZVNa/R2S8ae0+pVJGwB+o71gn5ZslQtqz2tXMtKttH0cJWVTWv0dkvGntPqVSRsAfqO9YO+QjM/LtLuwIxnnFK3f25OjWa71Wpm0AeA32gv2Dsn4vEy7CzuScU7R+r09OZrlWq+VSRsAfqO9YO+QjM/LtLuwIxnnFK3f25OjWa71Wpm0AeA32gv2Dsn4vEy7CzuScU7R+r09OZrlWq+VSRsAfqO9YO+QjM/LtLuwIxnnFK3f25OjWa71Wpm0AeA32gv2Dsn4vEy7CzuScU7R+r09OZrlWq+VSRsAfqO9YO+QjM/LtLuwIxnnFK3f25OjWa71Wpm0AeA32gv2Dsn4vEy7CzuScU7R+r09OZrlWq+VSRsAfqO9YO+QjM/LtLuwIxnnFK3f25OjWa71Wpm0AeA32gv2Dsn4vEy7CzuScU7R+r09OZrlWq+VSRsAfqO9YO+QjM/LtLuwIxnnFK3f25OjWa71Wpm0AeA32gv2Dsn4vEy7CzuScU7R+r09OZrlWq+VSRsAfqO9YFclLWCZds92JONMafVPS7Z6O20vK5M2APxGe8GuSlrAMu2e7UjGmdLqn5Zs9XbaXlYmbQD4jfaCXZW0gGXaPduRjDOl1T8t2erttL2sTNoA8BvtBbsqaQHLtHu2IxlnSqt/WrLV22l7WZm0AeA32gt2VdIClmn3bEcyzpRW/7Rkq7fT9rIyaQPAb7QX7KqkBSzT7tmOZJwprf5pyVZvp+1lZdIGgN9oL9hVSQtYot2xXclIU1r905Kt3k7by8qkDQC/0V6wq5IWsEy7ZzuScaa0+qclW72dtpeVSRsAfqO9YFclLWCJdsd2JSNNafVPS7Z6O20vK5M2APxGe8GuSlrAEu2O7UpGmtLqn5Zs9XbaXlYmbQD4jfaCXZW0gCXaHduVjDSl1T8t2erttL2sTNoA8BvtBXuUlMHltfu7Kmkx7ZOaXf7e60xSejttLyuTNgD8RnvBHiVlcHnt/q5KWnBz7dmuTNoA8BvtBXuUlMHltfu7KmnBzbVnuzJpA8BvtBfsUVIGl9fu76qkBTfXnu3KpA0Av9FesEdJGVxeu7+rkhbcXHu2K5M2APxGe8EeJWVwee3+rkpacHPt2a5M2gDwG+0Fe5SUweW1+7sqacHNtWe7MmkDwG+0F+xRUgaX1+7vqqQFN9ee7cqkDQC/0V6wR0kZXF67v6uSFtxce7YrkzYA/EZ7wR4lZXB57f6uSlpwc+3ZrkzaAPAb7QV7lJTB5bX7uyppwQO057sqaQHAb7QX7CgpgVtod3hFsjwP0J7vyqQNAAB8pn1k7kjGAQCAP9qH445kHAAA+KN9OO5IxgEAgD/ah+OOZBwAAPijfTjuSMYBAIA/2ofjjmQcAAD4o3047kjGAQCAP9qH445kHAAA+KN9OO5IxgEAgD/ah+OOZBwAAPijfTjuSMYBAIDPtI/MHck4AADwR/tw3JGMAwAAf7QPxx3JOAAA8Ef7cNyRjAMAAH+0D8cdyTgAAPBH+3DckYwDAAB/tA/HHck4AADwR/tw3JGMAwAAf7QPxx3JOAAA8Ef7cNyRjAMAAH+0D8cdyTgAAPBH+3DckYwDAAB/tA/HnclYAADg/2cVAIALax+OO5JxAADgj/bhuCMZB/i1//mf/xfhRVcqy9eVDQAAAABJRU5ErkJggg==',
  'data:image/png;base64,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',
];

  const FRAME_DAY = [];
  const FRAME_NIGHT = [];

  // afina o sprite por erosão: encolhe o contorno sem furar as áreas cheias
  function thinFrameImage(img, radius) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);

    const imgData = cx.getImageData(0, 0, c.width, c.height);
    const d = imgData.data;
    const total = c.width * c.height;
    const dist = new Int32Array(total).fill(-1);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    for (let i = 0; i < total; i++) {
      if (d[i * 4 + 3] < 128) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }

    while (head < tail) {
      const i = queue[head++];
      const nd = dist[i] + 1;
      const x = i % c.width;
      if (x > 0 && dist[i - 1] < 0) { dist[i - 1] = nd; queue[tail++] = i - 1; }
      if (x < c.width - 1 && dist[i + 1] < 0) { dist[i + 1] = nd; queue[tail++] = i + 1; }
      if (i >= c.width && dist[i - c.width] < 0) { dist[i - c.width] = nd; queue[tail++] = i - c.width; }
      if (i + c.width < total && dist[i + c.width] < 0) { dist[i + c.width] = nd; queue[tail++] = i + c.width; }
    }

    for (let i = 0; i < total; i++) {
      if (dist[i] <= radius) d[i * 4 + 3] = 0;
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  function tintFrame(img, color) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  GALOPE_FRAMES.forEach((src, i) => {
    const img = new Image();
    img.onload = () => {
      // o cavalo e o cavaleiro usam traço fino, no estilo do jogo do dinossauro
      const base = thinFrameImage(img, RUNNER_THIN_RADIUS);
      FRAME_DAY[i] = tintFrame(base, PAL.day.fg);
      FRAME_NIGHT[i] = tintFrame(base, PAL.night.fg);
    };
    img.src = src;
  });

  const FRAME_H = 75 * RUNNER_SCALE;
  const FRAME_W = Math.round(FRAME_H * (683 / 582));

const QUERO_FRAMES = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAlgAAAM0CAYAAABnJ1xJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAD62SURBVHhe7dZRjuQ6mq3ZGkY/NO78Z9mNyrsTcERsKehmklGkrQV8D1V5fomiZPT4HwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC4wv/5f/+f/+83ZQxYVPtdH5URAH6rHapnZQxYVPtdH5URAF7RDtajMgIsqv2uj8oIAK9oB+tRGQEW1X7XR2UEgFe0g/WojACLar/rozICwCvawXpURoBFtd/1URkB4BXtYD0qI8Ci2u/6qIwA8Ip2sB6VEWBR7Xd9VEYAeEU7WI/KCLCo9rs+KiMAvKIdrEdlBFhU+10flREAXtEO1qMyAiyq/a6PyggAr2gH6xXl8sCN2m/vqnILAF7RDtYryuWBG7Xf3lXlFgC8oh2sV5TLAzdqv72ryi0AeEU7WK8olwdu1H57V5VbAPCKdrBeUS4P3Kj99q4qtwDgFe1gvaJcHrhR++1dVW4BwCvawXpFuTxwo/bbu6rcAoBXtIP1inJ54Ebtt3dVuQUAr2gH6xXl8sCN2m/vqnILAF7RDtYryuWBG7Xf3lXlFgC8oh2sV5TLAzdqv72ryi0AeEU7WK8qt7hFu18r/zkso33H/1v+5/9o//vV5Va3aPc7KiMAa2kH2oyynCFt/qyMwRLaNzyjLOcW7X5HZQRgLe1Am1GWM6TNn5UxWEL7hmeU5dyi3e+ojACspR1oM8pyhrT5szIGS2jf8IyynFu0+x2VEYC1tANtRlnOkDZ/VsZgCe0bnlGWc4t2v6MyArCWdqDNKMsZ0ubPyhgsoX3DM8pybtHud1RGANbSDrQZZTlD2vxZGYMltG94RlnOLdr9jsoIwFragTajLGdImz8rY7CE9g3PKMu5RbvfURkBWEs70GaU5Qxp82dlDJbQvuEZZTm3aPc7KiMAa2kH2oyynCFt/qyMwRLaNzyjLOcW7X5HZQRgLe1Am1GWM6TNn5UxWEL7hmeU5dyi3e+ojACspR1oM8pyhrT5szIGS2jf8IyynFu0+x2VEYC1tANtRlnOkDZ/VbkFXKZ9ZyuU5Q9r17iiXB5gLe1Am1GWM6TNX1VuAZdp39kKZflD2vxV5RYAa2kH2oyynCFt/qpyC7hM+85WKMsf0uavKrcAWEs70GaU5Qxp81eVW8Bl2ne2Qln+sHaNK8rlAdbSDrQZZTlD2vxV5RZwmfadrVCWP6xd44pyeYC1tANtRlnOkDZ/VbkFXKZ9ZyuU5Q9r17iiXB5gLe1Am1GWM6TNX1VuAZdp39kKZfnD2jWuKJcHWEs70GaU5Qxp81eVW8Bl2ne2Qln+sHaNK8rlAdbSDrQZZTlD2vxV5RZwmfadrVCWP6xd44pyeYC1tANtRlnOkDZ/VbkFXKZ9ZyuU5Q9r17iiXB5gLe1Am1GWM6TNX1VuAZdp39kKZfnD2jWuKJcHWEs70GaU5Qxp81eVW8Bl2nf25P675v8sftCf17iy3AJgLe1Am1GWM6TNX1VuAb/WvqenlaUOafMzynIA1tIOtBllOUPa/FXlFvBr7Xt6WlnqkDY/oywHYC3tQJtRljOkzV9VbgG/1r6np5WlDmnzM8pyANbSDrQZZTlD2vxV5Rbwa+17elpZ6pA2P6MsB2At7UCbUZYzpM1fVW4Bv9a+p6eVpQ5p8zPKcgDW0g60GWU5Q9r8VeUW8Gvte3paWeqQNj+jLAdgLe1Am1GWM6TNX1VuAb/WvqenlaUOafMzynIA1tIOtBllOUPa/FXlFvBr7Xt6WlnqkDY/oywHYC3tQJtRljOkzV9VbgG/1r6np5WlDmnzM8pyANbRDrNZZUlD2vxV5Rbwa+17elpZ6pA2P6MsB2Ad7TCbVZY0pM1fVW4Bv9a+p6eVpQ5p8zPKcgDW0Q6zWWVJQ9r8VeUW8Gvte9L7ZXsB1tEOs1llSUPa/FXlFvBr7XvS+2V7AdbSDrQZZTlD2vxV5Rbwa+170vtlewHW0g60GWU5Q9r8VeUW8Gvte9L7ZXsB1tEOs1llSUPa/FXlFnCqfTu6p2w5wFragTajLGdIm7+q3AJOtW9H95QtB1hLO9BmlOUMafNXlVvAqfbt6J6y5QBraQfajLKcIW3+qnILONW+Hd1TthxgHe0wm1WWNKTNX1VuAafat6N7ypYDrKMdZrPKkoa0+avKLeBU+3Z0T9lygHW0w2xWWdKQNn9VuQWcat+O7ilbDrCOdpjNKksa0uavKreAQ+270e/KVgLsqR183162Zli7xlEZ4YHa+9J9ZdsB9tQOvm8vWzOsXeOojPBA7X3pvrLtAHtqB9+3l60Z1q5xVEZ4oPa+dF/ZdoA9tYPv28vWDGvXOCojPFB7X7qvbDvAntrB9+1la4a1axyVER6ovS/dV7YdYE/t4Pv2sjXD2jWOyggP1N6X7ivbDrCndvB9e9maYe0aR2WEB2rvS/eVbQfYUzv4vr1szbB2jaMywgO196X7yrYD7Ksdft9ctmVYu8ZRGeGB2vvSfWXbAfbVDr9vLtsyrF3jqIzwQO196b6y7QD7aoffN5dtGdaucVRGeKD2vnRf2XaAfbXD75vLtgxr1zgqI3xIewd6RnlFQ9r8WRkDmKsdUN9ctmVYu8ZRGeFD2jvQM8orGtLmz8oYwFztgPrmsi3D2jWOyggf0t6BnlFe0ZA2f1bGAOZqB9Q3l20Z1q5xVEb4kPYO9Izyioa0+bMyBjBXO6C+uWzLsHaNozLCh7R3oGeUVzSkzZ+VMYC52gH1zWVbhrVrHJURPqS9Az2jvKIhbf6sjAHM1Q6oby7bMqxd46iM8CHtHegZ5RUNafNnZQxgrnZAfXPZlmHtGkdlhA9p70DPKK9oSJs/K2MAc7UD6pvLtgxr1zgqI3xIewd6RnlFQ9r8WRkDmKsdUN9ctmVYu8ZRGeFD2jvQM8orGtLmz8oYwFztgPrmsi3D2jWOyggf0t6BnlFe0ZA2f1bGAOZqB5T+3St7958N5yPa/us55TX95b//25///W/6z4UAZmsHlO4pW86L2p7qGeUVDWvXuKrcAmCudkDpnrLlvKjtqZ5RXtGwdo2ryi0A5moHlO4pW86L2p7qGeUVDWvXuKrcAmCudkDpnrLlvKjtqZ5RXtGwdo2ryi0A5moHlO4pW86L2p7qGeUVDWvXuKrcAmCudkDpnrLlvKjtqZ5RXtGwdo2ryi0A5moHlO4pW86L2p7qGeUVDWvXuKrcAmCudkDpnrLlvKjtqZ5RXtGwdo2ryi0A5mmHk+4r286L2p7qGeUVDWvXuKrcAmCudkDpnrLlvKjtqZ5RXtGwdo2ryi0A5mmHk+4r286L2p7qGeUVDWnzV5bbAFyrHTh6RnlFvKjtqe4r2z6kzc8qSwK4Vjtw9IzyinhR21PdV7Z9SJufVZYEcK124OgZ5RXxoranuq9s+5A2P6ssCeBa7cDRM8or4kVtT3Vf2fYhbX5WWRLAtdqBo2eUV8SL2p7qvrLtQ9r8rLIkgGu1A0fPKK+IF7U91X1l24e0+VllSQDXageOnlFeES9qe6r7yrYPafOzypIArtUOHD2jvCJe1PZU95VtH9LmZ5UlAVyrHTh6RnlFvKjtqe4r2z6kzc8qSwK4Vjtw9IzyinhR21PdV7Z9SJufVZYEcK124OgZ5RXxoranuq9s+5A2P6ssCeBa7cDRM8orGtLmz8rYctqzSO+UTwvgWu3A0TPKKxrS5s/K2HLas0jvlE8L4FrtwNEzyisa0ubPythy2rNI75RPC+Ba7cDRM8orGtLmz8rYctqzSO+UTwvgWu3A0TPKKxrS5s/K2HLas0jvlE8L4FrtwNEzyisa0ubPythy2rNI75RPC+Ba7cDRM8orGtLmz8rYctqzSO+UTwvgWu3A0TPKKxrS5s/K2HLas0jvlE8L4FrtwNEzyisa0ubPythy2rNI75RPC+Ba7cDRM8orGtLmz8rYctqzSO+UTwvgWu3A0TPKKxrS5s/K2HLas0jvlE8L4FrtwNEzyisa0ubPythy2rNIr5bPCuB67dDRM8orGtLmz8rYctqzSD/LpwIwVzug9Izyioa0+bMytpz2LNLP8qkAzNUOKD2jvKIhbf6sjC2nPYv0s3wqAHO1A0rPKK9oSJs/K2PLac8i/SyfCsBc7YDSM8orGtLmz8rYctqzSD/LpwIwVzug9Izyioa0+bMytpz2LNLP8qkAzNUOKD2jvKIhbf6sjC2nPYv0s3wqAHO1A0rPKK9oSJs/K2PLac8i/SyfCsBc7YDSM8orGtLmz8rYctqzSD/LpwIwVzug9Izyioa0+bMytpz2LNLP8qkAzNUOKD2jvKIhbf6sjC2nPYv0s3wqAHO1A0r7l9c/XVub9E75tADmageU9i+vf7q2Numd8mkBzNUOKO1fXv90bW3SO+XTApirHVDav7z+6drapHfKpwUwVzugtH95/dO1tUnvlE8LYK52QGn/8vqna2uT3imfFsBc7YDS/uX1T9fWJr1TPi2AudoBpf3L65+urU16p3xaAHO1A0r7l9c/XVub9E75tADmageU9i+vf7q2Numd8mkBzNUOKO1fXv90bW3SO+XTApirHVDav7z+6drapHfKpwUwVzugtH95/dO1tUl/ls9lSJs/K2MA12oHjvYvr3+6tjbpz/K5DGnzZ2UM4FrtwNH+5fVP19Ym/Vk+lyFt/qyMAVyrHTjav7z+6drapD/L5zKkzZ+VMYBrtQNH+5fXP11bm/Rn+VyGtPmzMgZwrXbgaP/y+qdra5P+LJ/LkDZ/VsYArtUOHO1fXv90bW3Sn+VzGdLmz8oYwLXagaP9y+ufrq1N+rN8LkPa/FkZA7hWO3C0f3n907W1SX+Wz2VImz8rYwDXageO9i+vf7q2NunP8rkMafNnZQzgWu3A0f7l9U/X1ib9WT6XIW3+rIwBXKsdONq/vP5btPtJTy2fLcC12oGj/cvrv0W7n/TU8tkCXKsdONq/vP5btPtJTy2fLcC12oGj/cvrv0W7n/TU8tkCXKsdONq/vP5btPtJTy2fLcC12oGj/cvrv0W7n/TU8tkCXKsdONq/vP5btPtJTy2fLcC12oGj/cvrv0W7n/TU8tkCXKsdONq/vP5btPtJTy2fLcC12oGj/cvrv0W7n/TU8tkCXKsdONq/vP5btPtJTy2fLcC12oGj/cvrH9auIe1QPnGAa7UDR/uX1z+kzUu7lM8c4FrtwNH+5fUPafPSLuUzB7hWO3C0f3n9Q9q8tEv5zAGu1Q4c7V9e/5A2L+1SPnOAa7UDR/uX1z+kzUu7lM8c4FrtwNH+5fUPafPSLuUzB7hWO3C0f3n9Q9q8tEv5zAGu1Q4c7V9e/5A2L+1SPnOAa7UDR/uX1z+kzUu7lM8c4FrtwNH+5fUPafPSLuUzB7hWO3C0f3n9Q9q8tEv5zAGu1Q4c7V9e/5A2Lz21fLYAc7UDSvuX1z+kzUtPLZ8twFztgNL+5fUPafPSU8tnCzBXO6C0f3n9Q9q89NTy2QLM1Q4o7V9e/5A2Lz21fLYAc7UDSvuX1z+kzUtPLZ8twFztgNL+5fUPafPSU8tnCzBXO6C0f3n9Q9q89NTy2QLM1Q4o7V9e/5A2Lz21fLYAc7UDSvuX1z+kzUtPLZ8twFztgNL+5fUPafPSU8tnCzBXO6C0Znmlw45m2/8tPaV8lgDP1g4wrVde57B2Demp5bMFWEc7zLReeZ3D2jWkp5bPFmAd7TDTeuV1DmvXkJ5aPluAdbTDTOuV1zmsXUN6avlsAdbRDjOtV17nsHYN6anlswVYRzvMtF55ncPaNaSnls8WYB3tMNN65XUOa9eQnlo+W4B1tMNM65XXOaxdQ3pq+WwB1tEOM61XXuewdg3pqeWzBVhHO8y0Xnmdw9o1pKeWzxZgHe0w03rldQ5r15CeWj5bgHW0w0zrldc5rF1Demr5bIe0+bMyBnCtduBovfI6h7VrSE8tn+2QNn9WxgCu1Q4crVde57B2Demp5bMd0ubPyhjAtdqBo/XK6xzWriE9tXy2Q9r8WRkDuFY7cLReeZ3D2jWkp5bPdkibPytjANdqB47WK69zWLuG9NTy2Q5p82dlDOBa7cDReuV1DmvXkJ5aPtshbf6sjAFcqx04Wq+8zmHtGtJTy2c7pM2flTGAa7UDR+uV1zmsXUN6avlsh7T5szIGcK124Gi98jqHtWtITy2f7ZA2f1bGAK7VDhytV17nsHYN6anlsx3S5s/KGMC5doBozfJKh7R5Sf8uPyGAc+0A0ZrllQ5p85L+XX5CAOfaAaI1yysd0uYl/bv8hADOtQNEa5ZXOqTNS/p3+QkBnGsHiNYsr3RIm5f07/ITAjjXDhCtWV7pkDYv6d/lJwRwrh0gWrO80iFtXtK/y08I4Fw7QLRmeaVD2rykf5efEMC5doBozfJKh7R5Sf8uPyGAc+0A0ZrllQ5p85L+XX5CAOfaAaI1yysd0uYl/bv8hADOtQNEa5ZXeui//82fc5LG+8+PCeBf2gGi55TXNKTNH5WRYe0a0jeWnwTAuXaA6DnlNQ1p80dlZFi7hvSN5ScBcK4dIHpOeU1D2vxRGRnWriF9Y/lJAJxrB4ieU17TkDZ/VEaGtWtI31h+EgDn2gGi55TXNKTNH5WRYe0a0jeWnwTAuXaA6DnlNQ1p80dlZFi7hvSN5ScBcK4dIHpOeU1D2vxRGRnWriF9Y/lJAJxrB4ieU17TkDZ/VEaGtWtI31h+EgDn2gGi55TXNKTNH5WRYe0a0jeWnwTAuXaA6DnlNQ1p80dlZFi7hvSN5ScBcK4dIHpOeU1D2vxZGRvS5qVvLD8JgHPtANFzymsa0ubPytjl2r2kp5bPFuBa7cDRc8prGtLmz8rY5dq9pKeWzxbgWu3A0XPKaxrS5s/K2OXavaSnls8W4FrtwNFzymsa0ubPytjl2r2kp5bPFuBa7cDRc8prGtLmz8rY5dq9pKeWzxbgWu3A0XPKaxrS5s/K2OXavaSnls8W4FrtwNFzymsa0ubPytjl2r2kp5bPFuBa7cDRc8prGtLmz8rY5dq9pKeWzxbgWu3A0XPKaxrS5s/K2OXavaSnls8W4FrtwNFzymsa0ubPytjl2r2kp5bPFuBa7cDRc8prGtLmz8rY5dq9pKeWzxbgWu3A0XPKaxrS5o/KyC3a/aSnls8W4FrtwNF9ZduHtWsclZHltGeR3imfFsA87XDSfWXbh7VrHJWR5bRnkd4pnxbAPO1w0n1l24e1axyVkeW0Z5HeKZ8WwDztcNJ9ZduHtWsclZHltGeR3imfFsA87XDSfWXbh7VrHJWR5bRnkd4pnxbAPO1w0n1l24e1axyVkeW0Z5HeKZ8WwDztcNJ9ZduHtWsclZHltGeR3imfFsA87XDSfWXbh7VrHJWR5bRnkd4pnxbAPO1w0n1l24e1axyVkeW0Z5HeKZ8WwDztcNJ9ZduHtWsclZHltGeR3imfFsA87XDSfWXbh7VrHJWR5bRnkd4pnxbAPO1w0n1l24e1axyVkeW0Z5FeLZ8VwFztgNJ9ZduHtWsclZHltGeRfpZPBWAd7TDTfWXbh7VrHJWR5bRnkX6WTwVgHe0w031l24e1axyVkeW0Z5F+lk8FYB3tMNN9ZduHtWsclZHltGeRfpZPBWAd7TDTfWXbh7VrHJWR5bRnkX6WTwVgHe0w031l24e1axyVkeW0Z5F+lk8FYB3tMNN9ZduHtWsclZHltGeRfpZPBWAd7TDTfWXbh7VrHJWR5bRnkX6WTwVgHe0w031l24e1axyVkeW0Z5F+lk8FYB3tMNN9ZduHtWsclZHltGeRfpZPBWAd7TDTfWXbh7VrHJWR5bRnkf4snwvAGtpBpueU17S19tzSO+XTApinHU56TnlNW2vPLb1TPi2AedrhpOeU17S19tzSO+XTApinHU56TnlNW2vPLb1TPi2AedrhpOeU17S19tzSO+XTApinHU56TnlNW2vPLb1TPi2AedrhpOeU17S19tzSO+XTApinHU56TnlNW2vPLb1TPi2AedrhpOeU17S19tzSO+XTApinHU56TnlNW2vPLb1TPi2AedrhpOeU17S19tzSO+XTApinHU76XdnKIW3+rIxtrT239E75tADmaYeTfle2ckibPytjW2vPLb1TPi2AedrhpN+VrRzS5s/K2Nbac0vvlE8LYJ52OOl3ZSuHtPmzMra19tzSO+XTApinHU76XdnKIW3+rIxtrT239E75tADmaYeTfle2ckibPytjW2vPLb1TPi2AedrhpN+VrRzS5s/K2Nbac0vvlE8LYJ52OOl3ZSuHtPmzMra19tzSO+XTApinHU76XdnKIW3+rIxtrT239E75tADmaYeTfle2ckibPytjW2vPLb1TPi2AedrhpN+VrRzS5s/K2Nbac0vvlE8LYJ52OOl3ZSuHtPmzMra19tzSO+XTApinHU76XdnKIW3+rIxtrT239E75tADmaYeTfle2ckibPytjW2vPLb1TPi2AedrhpN+VrRzS5s/K2Nbac0vvlE8LYJ52OOl3ZSuHtPmzMra19tzSO+XTApinHU76XdnKIW3+rIxtrT239E75tADmaYeTfle2ckibPytjW2vPLb1TPi2AedrhpN+VrRzS5s/K2Nbac0vvlE8LYJ52OOl3ZSuHtPmzMra19tzSO+XTApinHU76XdnKIW3+rIxtrT239E75tADmaYeTfle2ckibPytjW2vPLb1TPi2AedrhpN+VrRzS5s/K2Nbac0vvlE8LYJ52OOl3ZSuHtPmzMka0PdL+5fUDrKMdZvpd2cohbf6sjPFD2yftXV49wDraYabfla0c0ubPyhjR9kj7l9cPsI52mOl3ZSuHtPmzMsYPbZ+0d3n1AOtoh5l+V7ZySJs/K2P80PZJe5dXD7COdpjpd2Urh7T5szJGtD3S/uX1A6yjHWb6XdnKIW3+rIzxQ9sn7V1ePcA62mGm35WtHNLmz8oYP7R90t7l1QOsox1m+l3ZyiFt/qyM8UPbJ+1dXj3AOtphpt+VrRzS5s/KGD+0fdLe5dUDrKMdZvpd2cohbf6sjPFD2yftXV49wDraYabfla0c0ubPyhg/tH3S3uXVA6yjHWa67x9NGeENbV+1XnmdAHtqB5/8A+vJ2r5qrfIqAfbVDj/5B9aTtX3VWuVVAuyrHX7yD6wna/uqtcqrBNhXO/zkH1hP1vZVa5VXCbCvdvjJP7CerO2r1iqvEmBf7fCTf2A9WdtXrVVeJcC+2uEn/8B6sravWqu8SoB9tcNP/oH1ZG1ftVZ5lQD7aoef/APrydq+aq3yKgH21Q4/+QfWk7V91VrlVQLsqx1+8g+sJ2v7qmeUVwRAOyTlH1hP1vZVzyivCIB2SMo/sJ6s7aueUV4RAO2QlH9gPVnbVz2jvCIA2iEp/8B6sravekZ5RQC0Q1L+gfVkbV/1jPKKAGiHpPwD68navuoZ5RUB0A5J+QfWk7V91TPKKwKgHZLyD6wna/uqZ5RXBEA7JOUfWE/W9lXPKK8IgHZIyj+wnqztq55RXhEA7ZCUf2A9WdtXPaO8IgDaISn/wHqytq9ar7xOgD21g0/+gfVkbV+1XnmdAHtqB5/8A+vJ2r5qvfI6AfbUDj75B9aTtX3VeuV1AuypHXzyD6wna/uq9crrBNhTO/jkH1hP1vZV65XXCbCndvDJP7CerO2r1iuvE2BP7eCTf2A9WdtXrVdeJ8Ce2sEn/8B6sravWq+8ToA9tYNP/oH1ZG1ftV55nQB7agef/APrydq+ar3yOgH4X+2g3LE87pA2f1RG+JD2DnRP2XIAXtEO1h3L4w5p80dlhA9p70D3lC0H4BXtYN2xPO6QNn9URviQ9g50T9lyAF7RDtYdy+MOafNHZYQPae9A95QtB+AV7WDdsTzukDZ/VEb4kPYOdE/ZcgBe0Q7WHcvjDmnzR2WED2nvQPeULQfgFe1g3bE87pA2f1RG+JD2DnRP2XIAXtEO1h3L4w5p80dlhA9p70D3lC0H4BXtYN2xPO6QNn9URviQ9g50T9lyAF7RDtYdy+MOafNHZYQPae9A95QtB+AV7WDdsTzukDZ/VEb4kPYOdE/ZcgBe0Q7WHcvjDmnzR2WED2nvQPeULQfgFe1g3bE87pA2f1RG+JD2DjRethGAu7VDeMfyuEPa/FEZ4UPaO9B42UYA7tYO4R3L4w5p80dlhA9p70DjZRsBuFs7hHcsjzukzR+VET6kvQONl20E4G7tEN6xPO6QNn9URviQ9g40XrYRgLu1Q3jH8rhD2vxRGeFD2jvQeNlGAO7WDuEdy+MOafNHZYQPae9A42UbAbhbO4R3LI87pM0flRE+pL0DjZdtBOBu7RDesTzukDZ/VEb4kPYONF62EYC7tUN4x/K4Q9r8URnhQ9o70HjZRgDu1g7hHcvjDmnzR2WED2nvQONlGwG4WzuEdyyPO6TNH5URPqS9A42XbQTgbu0Q3rE87pA2f1RG+JD2DjRethGAu7VDeMfyuEPa/FEZ4UPaO9B42UYA7tYO4R3L4w5p80dlhA9p70DjZRsBuFs7hHcsjzukzR+VET6kvQONl20E4G7tEN6xPO6QNn9URviQ9g40XrYRgLu1Q3jH8rhD2vxRGeFD2jvQeNlGAO7WDuEdy+MOafNHZYQPae9A42UbAbhbO4R3LI87pM0flRE+pL0DjZdtBOBu7RDesTzukDZ/VEb4kPYONF62EYC7tUN4x/K4Q9r8URnhQ9o70HjZRgDu1g7hHcvjDmnzR2WEN4zu4597r/9btucvf/43Z/8tABf7eQjvXB53SJs/KiO8qO2pxss2AvA07dDesTzukDZ/VEZ4UdtTjZdtBOBp2qG9Y3ncIW3+qIzworanGi/bCMDTtEN7x/K4Q9r8URnhRW1PNV62EYCnaYf2juVxh7T5ozLCi9qearxsIwBP0w7tHcvjDmnzR2WEF7U91XjZRgCeph3aO5bHHdLmj8oIL2p7qvGyjQA8TTu0dyyPO6TNH5URXtT2VONlGwF4mnZo71ged0ibPyojvKjtqcbLNgLwNO3Q3rE87pA2f1RGeFHbU42XbQTgadqhvWN53CFt/qiM8KK2pxov2wjA07RDe8fyuEPa/FEZ4UVtT7+9bA0AK2sH/I7lcYe0+aMywovann572RoAVtYO+B3L4w5p80dlhBe1Pf32sjUArKwd8DuWxx3S5o/KCC9qe/rtZWsAWFk74HcsjzukzR+VEV7U9vTby9YAsLJ2wO9YHndImz8qI7yo7em3l60BYGXtgN+xPO6QNn9URnhR29NvL1sDwMraAb9jedwhbf6ojPCitqffXrYGgJW1A37H8rhD2vxRGeFFbU+/vWwNACtrB/yO5XGHtPmjMsKL2p5+e9kaAFbWDvgdy+MOafNHZYQXtT399rI1AKysHfA7lscd0uaPyggvanv67WVrAFhZO+B3LI87pM0flRFe1Pb028vWALCydsDvWB53SJs/KiO8qO3pt5etAWBl7YDfsTzukDZ/VEZ4UdvTby9bA8DK2gG/Y3ncIW3+qIzworan3162BoCVtQN+x/K4Q9r8URnhRW1Pv71sDQArawf8juVxh7T5ozLCi9qefnvZGgBW1g74HcvjDmnzR2WEF7U9/fayNQCsrB3wO5bHHdLmj8oIL2p7+u1lawBYWTvgdyyPO6TNH5URXtT29NvL1gCwsnbA71ged0ibPyojvKjt6beXrQFgZe2A37E87pA2f1RGeFHb028vWwPAytoBv0JZ/rB2jaMywge0/f/2sjUArKwd8CuU5Q9r1zgqI3xA2/9vL1sDwMraAb9CWf6wdo2jMsIHtP3/9rI1AKysHfArlOUPa9c4KiN8QNv/by9bA8DK2gG/Qln+sHaNozLCB7T9//ayNQCsrB3wK5TlD2vXOCojfEDb/28vWwPAytoBv0JZ/rB2jaMywge0/f/2sjUArKwd8CuU5Q9r1zgqI3xA2/9vL1sDwMraAb9CWf6wdo2jMsIHtP3/9rI1AKysHfArlOUPa9c4KiN8QNv/by9bA8DK2gG/Qln+sHaNozLCB7T9//ayNQB8i/bHYFZZ0rB2jaMywge0/d+xPC4A/K394ZhVljSsXeOojPABbf93LI8LAH9rfzhmlSUNa9c4KiN8QNv/HcvjAsDf2h+OWWVJw9o1jsoIH9D2f8fyuADwt/aHY1ZZ0rB2jaMywge0/d+xPC4A/K394ZhVljSsXeOojPABbf93LI8LAH9rfzhmlSUNa9c4KiN8QNv/HcvjAsDf2h+OWWVJw9o1jsoIH9D2f8fyuADwt/aHY1ZZ0rB2jaMywge0/d+xPC4A/K394ZhVljSsXeOojPABbf93LI8LAH9rfzhmlSUNa9c4KiN8QNv/HcvjAsDf2h+OWWVJw9o1jsoIH9D2f8fyuADwt/aHY1ZZ0rB2jaMywge0/d+xPC4A/K394ZhVljSsXeOojPABbf93LI8LAH9rfzhmlSUNa9c4KiN8QNv/HcvjAsDf2h+OWWVJw9o1jsoIH9D2f8fyuADwt/aHY1ZZ0rB2jaMywge0/d+xPC4A/K394ZhVljSsXeOojPABbf93LI8LAH9rfzhmlSUNa9c4KiN8QNv/HcvjAsDf2h+OWWVJw9o1jsoIH9D2f8fyuADwt/aHY1ZZ0rB2jaMywge0/d+xPC4A/K394ZhVljSsXeOojPABbf93LI8LAH9rfzhmlSUNa9c4KiN8QNv/HcvjAsDf2h+OWWVJw9o1jsoIH9D2f8fyuADwt/aHY1ZZ0rB2jaMywovann572RoA+Fv7wzGrLGlYu8ZRGeFFbU+/vWwNAPyt/eGYVZY0rF3jqIzworan3162BgD+1v5wzCpLGtaucVRGeFHb028vWwMAf2t/OGaVJQ1r1zgqI7yo7em3l60BgL+1PxyzypKGtWsclRFe1Pb028vWAMDf2h+OWWVJw9o1jsoIL2p7+u1lawDgb+0Px6yypGHtGkdlhBe1Pf32sjUA8Lf2h2NWWdKwdo2jMsKL2p5+e9kaAPhb+8MxqyxpWLvGURnhRW1Pv71sDQD8rf3hmFWWNKxd46iM8KK2p99etgYA/tb+cMwqSxrWrnFURnhR29NvL1sDAH9rfzhmlSUNa9c4KiO8qO3pt5etAYC/tT8cs8qShrVrHJURXtT29NvL1gDA39ofjlllScPaNY7KCC9qe/rtZWsA4G/tD8essqRh7RpHZYQXtT399rI1APC39odjVlnSsHaNozLCi9qefnvZGgD4W/vDMassaVi7xlEZ4UVtT7+9bA0A/K394ZhVljSsXeOojPCitqffXrYGAP7W/nDMKksa1q5xVEZ4UdvTby9bAwB/a384ZpUlDWvXOCojvKjt6beXrQGAv7U/HLPKkoa1axyVEV7U9vTby9YAwN/aH47dyqPyhravu5VHBYD3tT80q5dH40Jtn3crjwoA72t/aFbvv8/1nwfkEn/u8Y7lUQHgfe0Pzerl0bhQ2+fdyqMCwPvaH5rVy6NxobbPu5VHBYD3tT80q5dH40Jtn3crjwoA72t/aFYvj8aF2j7vVh4VAN7X/tCsXh6NC7V93q08KgC8r/2hWb08Ghdq+7xbeVQAeF/7Q7N6eTQu1PZ5t/KoAPC+9odm9fJoXKjt827lUQHgfe0PzSrlEfiAtv+7lUcFgPe1PzRXltsMafNnZYwPaPu/W3lUAHhf+0NzZbnNkDZ/Vsb4gLb/u5VHBYD3tT80V5bbDGnzZ2WMD2j7v1t5VAB4X/tDc2W5zZA2f1bG+IC2/7uVRwWA97U/NFeW2wxp82dljA9o+79beVQAeF/7Q3Nluc2QNn9WxviAtv+7lUcFgPe1PzRXltsMafNnZYwPaPu/W3lUAHhf+0NzZbnNkDZ/Vsb4gLb/u5VHBYD3tT80V5bbDGnzZ2WMD2j7v1t5VAB4X/tDc2W5zZA2f1bG+IC2/7uVRwWA97U/NFeW2wxp82dljA9o+79beVQAeF/7Q3Nluc2QNn9WxviAtv+7lUcFYGXtgD8qI7do97uy3GZImz8rY3xA2//dyqMCsLJ2wB+VkVu0+11ZbjOkzZ+VMT6g7f9u5VEBWFk74I/KyC3a/a4stxnS5s/KGB/Q9n+38qgArKwd8Edl5BbtfleW2wxp82dljA9o+79beVQAVtYO+KMycot2vyvLbYa0+bMyxge0/d+tPCoAK2sH/FEZuUW735XlNkPa/FkZ4wPa/u9WHhWAlbUD/qiM3KLd78pymyFt/qyM8QFt/3crjwrAytoBf1RGbtHud2W5zZA2f1bG+IC2/7uVRwVgZe2APyojt2j3u7LcZkibPytjfEDb/93KowKwsnbAH5WRW7T7XVluM6TNn5UxPqDt/27lUQFYWTvgj8rILdr9riy3GdLmj8oIH9LewW7lUQF4mnZoH5WR6draZpUl8UDtfe1WHhWAp2mH9lEZma6tbVZZEg/U3tdu5VEBeJp2aB+Vkena2maVJfFA7X3tVh4VgKdph/ZRGZmurW1WWRIP1N7XbuVRAXiadmgflZHp2tpmlSXxQO197VYeFYCnaYf2URmZrq1tVlkSD9Te127lUQF4mnZoH5WR6draZpUl8UDtfe1WHhWAp2mH9lEZma6tbVZZEg/U3tdu5VEBeJp2aB+Vkena2maVJfFA7X3tVh4VgKdph/ZRGZmurW1WWRIP1N7XbuVRAXiadmgflZHp2tpmlSXxQO197VYeFYBXtIN1RlnOLdr9riq3GNLmz8oYD9Te1wpl+QDcrR3Cd5dbf0xbw1XlFkPa/FkZ44Ha+1qhLB+Au7VD+O5y649pa7iq3GJImz8rYzxQe18rlOUDcLd2CN9dbv0xbQ1XlVsMafNnZYwHau9rhbJ8AO7WDuG7y60/pq3hqnKLIW3+rIzxQO19rVCWD8Dd2iF8VbnFdG1tV5VbDGnzZ2WMB2rva4WyfADu1g7hq8otpmtru6rcYkibPytjPFB7XyuU5QNwt3YIX1VuMV1b21XlFkPa/FkZ44Ha+1qhLB+Au7VD+Kpyi+na2q4qtxjS5s/KGA/U3tcKZfkA3K0dwleVW0zX1nZVucWQNn9Wxnig9r5WKMsH4G7tEL6q3GK6traryi2GtPmzMsYDtfe1Qlk+AHdrh/BV5RbTtbVdVW4xpM2flTEeqL2vFcryAfbUDr7dyqM+QlvfVeUWQ9r8WRnjgdr7WqEsH2BP7eDbrTzqI7T1XVVuMaTNn5UxHqi9rxXK8gH21A6+3cqjPkJb31XlFkPa/FkZ44Ha+1qhLB9gT+3g26086iO09V1VbjGkzZ+VMR6ova8VyvIB9tQOvt3Koz5CW99V5RZD2vxZGeOB2vtaoSwfYE/t4NutPOojtPVdVW4xpM2flTEeqL2vFcryAfbUDr7dyqM+QlvfVeUWQ9r8WRnjgdr7WqEsH2BP7eDbrTzqI7T1XVVuMaTNn5UxHqi9rxXK8gH21A6+3cqjPkJb31XlFkPa/FkZ44Ha+1qhLB9gT+3g26086iO09V1VbjGkzZ+VMR6ova8VyvIB9tQOvt3Koz5CW99V5RZD2vxZGeOB2vtaoSwfYB3tMJtRlnOLdr+jMvIIbX0zynJ4qPbOdiuPCrCOdpjNKMu5RbvfURl5hLa+GWU5PFR7Z7uVRwVYRzvMZpTl3KLd76iMPEJb34yyHB6qvbPdyqMCrKMdZjPKcm7R7ndURh6hrW9GWQ4P1d7ZbuVRAdbRDrMZZTm3aPc7KiOP0NY3oyyHh2rvbLfyqADraIfZjLKcW7T7HZWR6draZpUl8VDtne1WHhVgHe0wm1GWc4t2v6MyMl1b26yyJB6qvbPdyqMCrKMdZjPKcm7R7ndURqZra5tVlsRDtXe2W3lUgHW0w2xGWc4t2v2OysgjtPXNKMvhodo72608KsA62mE2oyznFu1+R2XkEdr6ZpTl8FDtne1WHhVgHe0wm1GWc4t2v6My8ghtfTPKcnio9s52K48KsI52mM0oy7lFu99RGZmurW1WWRIP1d7ZbuVRAeZph9NZGeOHtk9PL0sf1q5xVEZ4qPbOdiuPCjBPO5zOyhg/tH16eln6sHaNozLCQ7V3tlt5VIB52uF0Vsb4oe3T08vSh7VrHJURHqq9s93KowLM0w6nszLGD22fnl6WPqxd46iM8FDtne1WHhVgnnY4nZUxfmj79PSy9GHtGkdlhIdq72y38qgA87TD6ayM8UPbp6eXpQ9r1zgqIzxUe2e7lUcFmKcdTmdljB/aPj29LH1Yu8ZRGeGh2jvbrTwqwDztcDorY/zQ9unpZenD2jWOyggP1d7ZbuVRAeZph9NZGeOHtk9PL0sf1q5xVEZ4qPbOdiuPCjBPO5zOyhg/tH16eln6sHaNozLCQ7V3tlt5VIB52uF0Vsb4oe3T08vSh7VrnJUxHqi9r93KowLM0w6nszI2rF3jinJ5XtT29KyM8WXat7BbeVSAa7UD56yMDWnzV5Vb8KK2p2dljC/TvoXdyqMCXKsdOGdlbEibv6rcghe1PT0rY3yZ9i3sVh4V4FrtwDkrY0Pa/FXlFryo7elZGePLtG9ht/KoANdqB85ZGRvS5q8qt+BFbU/Pyhhfpn0Lu5VHBbhWO3DOytiQNn9VuQUvant6Vsb4Mu1b2K08KsC12oFzVsaGtPmryi14UdvTszLGl2nfwm7lUQGu1Q6cszI2pM1fVW7Bi9qenpUxvkz7FnYrjwpwrXbgnJWxIW3+qnILXtT29KyM8WXat7BbeVSAa7UD56yMDWnzV5Vb8KK2p2dljC/TvoXdyqMCXKsdOGdlbEibv6rcghe1PT0rY3yZ9i3sVh4V4FrtwDkrY0Pa/FXlFryo7elZGePLtG9ht/KoAP/WDpHdyqPyoranZ2UMDrXvZoWyfIB/a4fIbuVReVHb07MyBofad7NCWT7Av7VDZLfyqLyo7elZGYND7btZoSwf4N/aIbJbeVRe1Pb0rIzBofbdrFCWD/Bv7RDZrTwqL2p7elbG4FD7blYoywf4t3aI7FYelRe1PT0rY3CofTcrlOUD/Fs7RHYrj8qL2p6elTE41L6bFcryAf6tHSK7lUflRW1Pz8oYHGrfzQpl+QD/1g6R3cqj8qK2p2dlDA6172aFsnyAf2uHyG7lUXlR29OzMgaH2nezQlk+wL+1Q2S38qi8qO3pWRmDQ+27WaEsH9hJ+7E/vSydD2nv4Oll6XxQew+6vmw38GTtx7tCWT4f0PZ/lfIIfEDbf91Xth14qvbDXaEsnw9o+79CWT4f0t6B7ivbDjxV++GuUJbPB7T9X6Esnw9p70D3lW0Hnqr9cFcoy+cD2v6vUJbPh7R3oPvKtgNP1X64K5Tl8wFt/1coy+dD2jvQfWXbgadqP9wVyvL5gLb/K5Tl8yHtHei+su3AU7Uf7gpl+XxA2/8VyvL5kPYOdF/ZduCp2g93hbJ8PqDt/wpl+XxIewe6r2w78FTth7tCWT4f0PZ/hbJ8PqS9A91Xth14qvbDXaEsnw9o+79CWT4f0t6B7ivbDjxV++GuUJbPB7T9X6U8Ah/S3oHuKVsOfFL7MX5z2RZe1PZ0x/K4LK69W91Xth2+Q/sRfHPZFl7U9nTH8rgsrr1b3Ve2Hb5D+xF8c9kWXtT2dMfyuCyuvVvdV7YdvkP7EXxz2RZe1PZ0x/K4LK69W91Xth2+Q/sRfHPZFl7U9nTH8rgsrr1b3Ve2Hb5D+xF8c9kWXtT2dMfyuCyuvVvdV7YdvkP7EXxz2RZe1PZ0x/K4LK69W91Xth2+Q/sRfHPZFl7U9nTH8rgsrr1b3Ve2Hb5D+xF8c9kWXtT2dMfyuCyuvVvdV7YdvkP7EXxz2RZe1PZ0x/K4LK69W91Xth2+Q/sRfHPZFl7U9nTH8rgsrr1b3Ve2HdhF+6HPKMtZTnsWjZdthCW0b/jby9YAf2o/mBllOctpz6Lfla2Ex2vf77eXrQH+1H4wM8pyltOeReNlG2EJ7Rv+9rI1wJ/aD2ZGWc5y2rNovGwjLKF9w99etgb4U/vBzCjLWU57Fo2XbYQltG/428vWAH9qP5gZZTnLac+i8bKNsIT2DX972RrgT+0HM6MsZzntWTRethGW0L7hby9bA/yp/WBmlOUspz2Lxss2whLaN/ztZWuAP7UfzIyynOW0Z9F42UZYQvuGv71sDfCn9oOZUZaznPYsGi/bCEto3/C3l60B/tR+MDPKcpbTnkXjZRthCe0b/vayNcCf2g9mRlnOctqz6HdlK+Hx2vf77WVr/qP9b3/+N/919P8HBvz8oc0sy7lFu5/uK9sOX639NvS7spWwpvZRzyjLuUW7n+4r2w5frf029LuylbCm9lHPKMu5Rbuf7ivbDl+t/Tb0u7KVsKb2Uc8oy7lFu5/uK9sOX639NvS7spWwpvZRzyjLuUW7n+4r2w5frf029LuylbCm9lHPKMu5Rbuf7ivbDl+t/Tb0u7KVsKb2Uc8oy7lFu5/uK9sOX639NvS7spWwpvZRzyjLuUW7n+4r2w5frf029LuylbCm9lHPKMu5Rbuf7ivbDl+t/Tb0u7KVsKb2Uc8oy7lFu5/uK9sOX639NvS7spWwpvZRzyjLuUW7n+4r2w5frf029LuylcCf2g9G+lk+FVhC+4Z1X9l24E/tByP9LJ8KLKF9w7qvbDvwp/aDkX6WTwWW0L5h3Ve2HfhT+8FIP8unAkto37DuK9sO/Kn9YKSf5VOBJbRvWPeVbQf+1H4w0s/yqcAS2jes+8q2A39qPxjpZ/lUYAntG9Z9ZduBP7UfjPSzfCqwhPYN676y7cCf2g9G+lk+FVhC+4Z1X9l24E/tByP9LJ8KLKF9w7qvbDvwp/aDkX6WTwWW0L5h3Ve2HfhT+8FIP8unAm9r35fWLa8V+LT2g9R65XXyZdq3oP3L6weerP14tV55nXyZ9i1o//L6gSdrP16tV14nX6Z9C9q/vH7gydqPV+uV18mXad+C9i+vH3iy9uPVeuV18mXat6D9y+sHnqz9eLVeeZ18mfYtaP/y+oEnaz9erVdeJ1+mfQvav7x+4Mnaj1frldfJl2nfgvYvrx94svbj1XrldfJl2reg/cvrB56s/Xi1XnmdfJn2LWj/8vqBJ2s/Xq1XXidfpn0L2r+8fuAbtUNB95Vt50VtT7+9bA0AT9IObN1Xtp0XtT399rI1ADxJO7B1X9l2XtT29NvL1gDwJO3A1n1l23lR29NvL1sDwJO0A1v3lW3nRW1Pv71sDQBP0g5s3Ve2nRe1Pf32sjUAPEk7sHVf2XZe1Pb028vWAPAk7cDWfWXbeVHb028vWwPAk7QDW/eVbedFbU+/vWwNAE/SDmzdV7adF7U9/fayNQA8STuwdV/Zdl7U9vTby9YA8DTt0Nb1Zbt5Q9vXby9bA8A3aX8QdiuPygvafq5SHmFIm1+hLB+Ap2mH9m7lUXlR29MVyvKHtPkVyvIBeJp2aO9WHpUXtT1doSx/SJtfoSwfgKdph/Zu5VF5UdvTFcryh7T5FcryAXiadmjvVh6VF7U9XaEsf0ibX6EsH4CnaYf2buVReVHb0xXK8oe0+RXK8gF4mnZo71YelRe1PV2hLH9Im1+hLB+Ap2mH9m7lUXlR29MVyvKHtPkVyvIBeJp2aO9WHpUXtT1doSx/SJtfoSwfgKdph/Zu5VF5UdvTFcryh7T5FcryAXiadmjvVh6VF7T9XKU8wpA2v0JZPgDfov0x0P7l9d+i3e+qcotbtPvNKMsBYHXtkNfe5dXfot3vqnKLW7T7zSjLAWB17ZDX3uXV36Ld76pyi1u0+80oywFgde2Q197l1d+i3e+qcotbtPvNKMsBYHXtkNfe5dXfot3vqnKLW7T7zSjLAWB17ZDX3uXV36Ld76pyi1u0+80oywFgde2Q197l1d+i3e+qcotbtPvNKMsBYHXtkNfe5dXfot3vqnKLW7T7zSjLAWB17ZDX3uXV36Ld76pyi1u0+80oywFgde2Q197l1d+i3e+qcotbtPvNKMsBYHXtkNfe5dXfot3vqnKLW7T7zSjLAQB4XftHxlkZW0Z7hlllSQDA7to/BK4qt5iurW1GWQ4AsLv2D4Gryi2ma2ubUZYDAOyu/UPgqnKL6draZpTlAAC7a/8QuKrcYrq2thllOQDA7to/BK4qt5iurW1GWQ4AsLv2D4Gryi2ma2ubUZYDAOyu/UPgqnKL6draZpTlAAC7a/8QuKrcYrq2thllOQDA7to/BK4qt5iurW1GWQ4AsLv2D4Gryi2ma2ubUZYDAOyu/UPgqnKL6draZpTlAAC8rv0j44py+Udo67uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAatof9qvKLaZra7uq3GJImz8rYwDAzto/Al4tl1xee7YZZTkAwGraH/aryi2W055lRlkOALCa9of9qnKL5bRnmVGWAwCspv1hv6rcYjntWWaU5QAAq2l/2K8qt1hOe5YZZTkAwGraH/aryi2W055lRlkOALCa9of9qnKL5bRnmVGWAwCspv1hv6rcYjntWWaU5QAAq2l/2K8qt1hOe5YZZTkAwGraH/aryi2W055lRlkOALCa9of9qnKL5bRnmVGWAwCspv1hv6rcYjntWWaU5QAAu2v/EHh6Wfot2v1WKMsHAJ6g/bF+eln6Ldr9VijLBwCeoP2xfnpZ+i3a/VYoywcAnqD9sX56Wfot2v1WKMsHAJ6g/bF+eln6Ldr9VijLBwCeoP2xfnpZ+i3a/VYoywcAnqD9sX56Wfot2v1WKMsHAJ6g/bF+eln6Ldr9VijLBwCeoP2xfnpZ+i3a/VYoywcAnqD9sX56Wfot2v1WKMsHAJ6g/bF+eln6Ldr9VijLBwB21v4RcGW5DQDA92j/KJpVlgQAsLb2D51ZZUkAAGtr/9CZVZYEALC29g+dWWVJAABra//QmVWWBACwtvYPnVllSQAAa2v/0JlVlgQAsLb2D51ZZUkAAGtr/9CZVZYEALC29g+dWWVJAADra//YmVGWAwDwXdo/jFYoywcAeJ72j5cVyvIBAJ6n/eNlhbJ8AIDnaf94WaEsHwDgedo/XlYoywcAeJ72j5cVyvIBAJ6n/eNlhbJ8AIDnaf94WaEsHwDgedo/XlYoywcAeJ72j5cVyvIBAJ6n/eNlhbJ8AAAAAAAAAAAA+If/+Z//H9CEzfbzhr5PAAAAAElFTkSuQmCC',
  'data:image/png;base64,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',
  'data:image/png;base64,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',
  'data:image/png;base64,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',
];
  const QUERO_DAY = [];
  const QUERO_NIGHT = [];
  const QUERO_H = 37;
  const QUERO_W = Math.round(QUERO_H * (600 / 820));

  QUERO_FRAMES.forEach((src, i) => {
    const img = new Image();
    img.onload = () => {
      QUERO_DAY[i] = tintFrame(img, PAL.day.fg);
      QUERO_NIGHT[i] = tintFrame(img, PAL.night.fg);
    };
    img.src = src;
  });

  function drawRunner(p) {
    const frames = game.nightLeft > 0 ? FRAME_NIGHT : FRAME_DAY;
    const f = frames[runner.legPhase % 8];
    if (!f) return;

    const dy = runner.y - (GROUND_Y - BODY_H);
    // sem suavização: mantém a tinta exata da paleta (sem cinzas nas bordas)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f, runner.x - 6 * RUNNER_SCALE, GROUND_Y - FRAME_H + dy, FRAME_W, FRAME_H);
    ctx.imageSmoothingEnabled = true;
  }

  // ---------------------------------------------------------------- obstáculos
  function drawObstacle(o, p) {
    if (o.type === 'grass') drawGrass(o, p);
    else if (o.type === 'rock') drawRock(o, p);
    else if (o.type === 'bush') drawBush(o, p);
    else if (o.type === 'fence') drawFence(o, p);
    else if (o.type === 'stump') drawStump(o, p);
    else if (o.type === 'post') drawPost(o, p);
  }

  function drawGrass(o, p) {
    ctx.strokeStyle = p.fg;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2;

    for (const part of o.parts) {
      const cx = o.x + part.dx + 7;
      const h = part.h;
      const rnd = mulberry32(Math.floor(part.seed * 10000) + 7);
      for (let i = 0; i < 5; i++) {
        const spread = (i - 2) / 2;
        const tipX = cx + spread * (9 + rnd() * 3);
        const tipY = GROUND_Y - h * (0.55 + rnd() * 0.45);
        ctx.beginPath();
        ctx.moveTo(cx + spread * 1.5, GROUND_Y);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }
    }
  }

  function drawRock(o, p) {
    const x = o.x;
    const w = o.w;
    const h = o.h;
    ctx.fillStyle = p.fg;
    poly([
      [x + w * 0.11, GROUND_Y], [x, GROUND_Y - h * 0.36], [x + w * 0.22, GROUND_Y - h * 0.82],
      [x + w * 0.59, GROUND_Y - h * 0.95], [x + w * 0.89, GROUND_Y - h * 0.64], [x + w * 0.96, GROUND_Y - h * 0.18],
      [x + w * 0.89, GROUND_Y],
    ]);
    ctx.fillStyle = p.bg;
    const d = Math.max(1, w * 0.07);
    ctx.fillRect(x + w * 0.3, GROUND_Y - h * 0.64, d, d);
    ctx.fillRect(x + w * 0.56, GROUND_Y - h * 0.55, d * 0.7, d * 0.7);
  }

  function drawStump(o, p) {
    const x = o.x;
    const w = o.w;
    const h = o.h;
    ctx.fillStyle = p.fg;
    poly([
      [x, GROUND_Y], [x, GROUND_Y - h * 0.86], [x + w * 0.16, GROUND_Y - h],
      [x + w * 0.8, GROUND_Y - h], [x + w, GROUND_Y - h * 0.9], [x + w, GROUND_Y],
    ]);
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.ellipse(
        x + w * 0.5,
        GROUND_Y - h * (0.34 + i * 0.26),
        w * (0.28 - i * 0.11),
        h * (0.13 - i * 0.04),
        0, 0, TAU,
      );
      ctx.stroke();
    }
  }

  function drawPost(o, p) {
    const x = o.x;
    const w = o.w;
    const h = o.h;
    ctx.fillStyle = p.fg;
    // mourão: tronco fino com topo levemente alargado
    ctx.fillRect(x + w * 0.22, o.y + h * 0.12, w * 0.56, h * 0.88);
    ctx.fillRect(x, o.y, w, h * 0.16);
    ctx.fillStyle = p.bg;
    ctx.fillRect(x + w * 0.42, o.y + h * 0.36, w * 0.16, h * 0.09);
  }

  function drawBush(o, p) {
    const cx = o.x + o.w / 2;
    const rnd = mulberry32(Math.floor(o.seed * 10000) + 31);

    ctx.fillStyle = p.fg;
    ctx.fillRect(o.x + 3, GROUND_Y - 2.5, o.w - 6, 2.5);

    ctx.strokeStyle = p.fg;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 11; i++) {
      const a = -Math.PI * 0.9 + (i / 10) * Math.PI * 0.8;
      const len = o.h * (0.5 + rnd() * 0.5);
      const bx = cx + (i - 5) * 2;
      ctx.beginPath();
      ctx.moveTo(bx, GROUND_Y - 2);
      ctx.lineTo(bx + Math.cos(a) * len * 0.5, GROUND_Y - 2 + Math.sin(a) * len);
      ctx.stroke();
    }
  }

  function drawFence(o, p) {
    ctx.strokeStyle = p.fg;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'miter';

    // mourões vazados
    const postW = Math.min(8, o.w * 0.16);
    ctx.strokeRect(o.x, o.y, postW, o.h);
    ctx.strokeRect(o.x + o.w - postW, o.y, postW, o.h);

    // travessas duplas, acompanhando a altura
    for (let i = 0; i < 3; i++) {
      const ry = o.y + o.h * 0.2 + i * o.h * 0.24;
      ctx.beginPath();
      ctx.moveTo(o.x + postW / 2, ry);
      ctx.lineTo(o.x + o.w - postW / 2, ry);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(o.x + postW / 2, ry + 3);
      ctx.lineTo(o.x + o.w - postW / 2, ry + 3);
      ctx.stroke();
    }
  }

  // --------------------------------------------------------------- quero-quero
  function drawBird(o, p) {
    const frames = game.nightLeft > 0 ? QUERO_NIGHT : QUERO_DAY;
    const f = frames[Math.floor(o.frameClock / 7) % 4];
    if (!f) return;
    const bx = o.x + o.w / 2;
    const by = o.y + o.h / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f, bx - QUERO_W * 0.63, by - QUERO_H * 0.85, QUERO_W, QUERO_H);
    ctx.imageSmoothingEnabled = true;
  }

  // ---------------------------------------------------------------------- HUD
  // Nomes de municípios em fonte comum do sistema (mostra acentos e ç).

  // último município já conquistado (o que fica no fim de jogo)
  const lastMunicipio = () =>
    MUNICIPIOS[Math.max(0, Math.min(MUNICIPIOS.length - 1, game.conquered - 1))];

  const cssFont = (weight, size) => `${weight} ${size}px ${UI_FONT}`;
  const clampCss = (min, value, max) => Math.max(min, Math.min(max, value));

  // desenha em pixels CSS reais, independentes da densidade da tela
  function withCssSpace(draw) {
    const r = canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    out.save();
    out.setTransform(canvas.width / r.width, 0, 0, canvas.height / r.height, 0, 0);
    draw(r.width, r.height);
    out.restore();
  }

  // fonte bitmap 5x7 dos menus — desenhada pixel a pixel
  const GLYPHS = {
    '0': ['11111', '10001', '10011', '10101', '11001', '10001', '11111'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
    '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
    '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
    ',': ['00000', '00000', '00000', '00000', '00000', '00100', '01000'],
    ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
    '@': ['01110', '10001', '10111', '10101', '10111', '10000', '01110'],
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
    '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
    "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  };

  function pixelText(text, x, y, cell, align = 'left') {
    const cw = 6 * cell;
    const total = text.length * cw - cell;
    let sx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    // alinha à grade de pixels de arte para o texto ficar nítido
    sx = Math.round(sx / UNIT_PX) * UNIT_PX;
    y = Math.round(y / UNIT_PX) * UNIT_PX;
    for (const ch of text) {
      const g = GLYPHS[ch];
      if (g) {
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 5; c++) {
            if (g[r][c] === '1') ctx.fillRect(sx + c * cell, y + r * cell, cell, cell);
          }
        }
      }
      sx += cw;
    }
  }

  // ------------------------------------------------------------------- menu
  const ABOUT_LINES = [
    'GAÚCHO RUNNER É UM CLONE DO JOGO',
    'DO DINOSSAURO DO CHROME, COM UM',
    'GAÚCHO A CAVALO NO PAMPA.',
    '',
    'CANVAS PURO, TRÊS TONS, 8 QUADROS',
    'DE GALOPE E 4 DE QUERO-QUERO.',
    '',
    'FEITO PARA APRENDER E SE DIVERTIR.',
    'A CADA OBSTÁCULO, UM MUNICÍPIO DO RS.',
  ];

  const CONTACT_LINES = [
    'FALE COM A GENTE',
    '',
    'EMAIL: CONTATO@EXEMPLO.COM',
    'SITE: EXEMPLO.COM',
    '',
    'OBRIGADO POR JOGAR!',
  ];

  function drawButton(p, r, label, focused) {
    r.label = label;
    r.focused = focused;

    ctx.fillStyle = focused ? p.fg : p.bg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = p.fg;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(r.x + 0.55, r.y + 0.55, r.w - 1.1, r.h - 1.1);
  }

  function drawMenu(p) {
    const cx = W / 2;

    if (screen === 'menu') {
      const titleCell = UNIT_PX * 2;
      const titleY = Math.max(12, H * 0.1);
      const tw = 13 * 6 * titleCell - titleCell;
      ctx.fillStyle = p.bg;
      ctx.fillRect(cx - tw / 2 - 12, titleY - 10, tw + 24, titleCell * 7 + 42);

      const bw = Math.min(200, W * 0.44);
      const bh = Math.min(28, H * 0.085);
      const gap = 8;
      const bx = cx - bw / 2;
      const by = Math.max(titleY + titleCell * 7 + 44, H * 0.36);

      const labels = ['JOGAR', 'SOBRE', 'CONTATO'];
      menuButtons = [];
      for (let i = 0; i < labels.length; i++) {
        const r = { x: bx, y: by + i * (bh + gap), w: bw, h: bh, i };
        drawButton(p, r, labels[i], i === menuFocus);
        menuButtons.push(r);
      }

      menuLayout = {
        kind: 'menu',
        titleY,
        subtitleY: titleY + titleCell * 7 + 8,
        hintY: by + 3 * (bh + gap) + 8,
      };
      return;
    }

    const isAbout = screen === 'about';
    const lines = isAbout ? ABOUT_LINES : CONTACT_LINES;
    const cell = UNIT_PX;
    const lineStep = cell * 9 + 2;
    const bh = 24;
    const pw = Math.min(W * 0.86, 430);
    const ph = Math.min(H * 0.9, 36 + lines.length * lineStep + bh + 24);
    const px = cx - pw / 2;
    const py = Math.max(10, (H - ph) / 2 - 6);

    ctx.fillStyle = p.bg;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = p.fg;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px + 0.6, py + 0.6, pw - 1.2, ph - 1.2);

    let ty = py + 12 + 24;
    const textLines = [];
    for (const line of lines) {
      textLines.push({ text: line, x: px + 16, y: ty });
      ty += lineStep;
    }

    const bw = Math.min(150, pw * 0.45);
    const r = { x: cx - bw / 2, y: py + ph - bh - 12, w: bw, h: bh, i: 0 };
    drawButton(p, r, 'VOLTAR', true);
    menuButtons = [r];

    menuLayout = {
      kind: isAbout ? 'about' : 'contact',
      title: isAbout ? 'SOBRE' : 'CONTATO',
      titleY: py + 12,
      lines: textLines,
    };
  }

  // texto da home na mesma fonte monoespaçada do jogo, nítido após o upscale
  function drawMenuText(cssW, cssH, p) {
    if (!menuLayout) return;
    const sx = cssW / W;
    const sy = cssH / H;
    const cx = cssW / 2;
    out.fillStyle = p.fg;
    out.textAlign = 'center';
    out.textBaseline = 'top';

    if (menuLayout.kind === 'menu') {
      let titleSize = clampCss(24, cssW * 0.04, 50);
      const maxTitleW = cssW * 0.86;
      out.font = cssFont(700, titleSize);
      const titleW = out.measureText('GAÚCHO RUNNER').width;
      if (titleW > maxTitleW) {
        titleSize *= maxTitleW / titleW;
        out.font = cssFont(700, titleSize);
      }
      out.fillText('GAÚCHO RUNNER', cx, menuLayout.titleY * sy);

      out.font = cssFont(500, clampCss(11, cssW * 0.012, 16));
      out.fillText('A CAVALO', cx, menuLayout.subtitleY * sy);

      const btnSize = clampCss(14, cssW * 0.018, 24);
      for (const b of menuButtons) {
        out.font = cssFont(700, btnSize);
        out.fillStyle = b.focused ? p.bg : p.fg;
        out.textAlign = 'center';
        out.textBaseline = 'middle';
        out.fillText(b.label, (b.x + b.w / 2) * sx, (b.y + b.h / 2) * sy);
      }

      out.fillStyle = p.fg;
      out.textAlign = 'center';
      out.textBaseline = 'top';
      out.font = cssFont(500, clampCss(10, cssW * 0.011, 14));
      out.fillText('SETAS + ENTER OU CLIQUE', cx, menuLayout.hintY * sy);
      return;
    }

    // SOBRE / CONTATO
    out.font = cssFont(700, clampCss(18, cssW * 0.026, 34));
    out.textAlign = 'center';
    out.textBaseline = 'top';
    out.fillText(menuLayout.title, cx, menuLayout.titleY * sy);

    out.font = cssFont(500, clampCss(11, cssW * 0.0135, 17));
    out.textAlign = 'left';
    out.textBaseline = 'top';
    for (const line of menuLayout.lines) {
      if (line.text) out.fillText(line.text, line.x * sx, line.y * sy);
    }

    const b = menuButtons[0];
    if (b) {
      out.font = cssFont(700, clampCss(11, cssW * 0.014, 18));
      out.fillStyle = b.focused ? p.bg : p.fg;
      out.textAlign = 'center';
      out.textBaseline = 'middle';
      out.fillText(b.label, (b.x + b.w / 2) * sx, (b.y + b.h / 2) * sy);
    }
  }

  function activateMenu(i) {
    if (screen === 'menu') {
      if (i === 0) { startGame(); return; }
      screen = i === 1 ? 'about' : 'contact';
      menuFocus = 0;
      canvas.style.cursor = 'default';
      fitCanvas();
      updateRotateHint();
      return;
    }
    screen = 'menu';
    menuFocus = 0;
    canvas.style.cursor = 'default';
    fitCanvas();
    updateRotateHint();
  }

  function goMenu() {
    screen = 'menu';
    menuFocus = 0;
    canvas.style.cursor = 'default';
    resetRun();
    game.status = 'waiting';
    fitCanvas();
    updateRotateHint();
  }

  function pointerLogical(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  }

  function inButton(pt, btn) {
    return !!btn &&
      pt.x >= btn.x && pt.x <= btn.x + btn.w &&
      pt.y >= btn.y && pt.y <= btn.y + btn.h;
  }

  function handleMenuPointer(e) {
    const pt = pointerLogical(e);
    for (const b of menuButtons) {
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) {
        if (screen === 'menu') {
          menuFocus = b.i;
          activateMenu(b.i);
        } else {
          screen = 'menu';
          menuFocus = 0;
        }
        return;
      }
    }
  }

  // município conquistado: só aparece depois de vencer o primeiro obstáculo
  function drawMunicipioHud(cssW, p) {
    const total = MUNICIPIOS.length;
    const done = Math.min(game.conquered, total);
    const hasCity = done > 0;
    const name = hasCity ? MUNICIPIOS[done - 1] : '';
    const margin = Math.max(12, Math.round(cssW * 0.012)) + SAFE.top;
    const labelSize = clampCss(10, cssW * 0.0105, 14);
    const baseNameSize = clampCss(17, cssW * 0.024, 32);
    const center = cssW / 2;

    out.fillStyle = p.fg;
    out.textBaseline = 'top';
    out.textAlign = 'center';

    out.font = cssFont(700, labelSize);
    out.fillText('MUNICÍPIO ' + done + '/' + total, center, margin);

    let barY = margin + labelSize * 1.55 + 7;

    if (hasCity) {
      // o nome fica centralizado e encolhe se não couber
      let nameSize = baseNameSize;
      out.font = cssFont(700, nameSize);
      const maxW = cssW * 0.9;
      const measured = out.measureText(name).width;
      if (measured > maxW) {
        nameSize = Math.max(13, nameSize * (maxW / measured));
        out.font = cssFont(700, nameSize);
      }
      const nameY = margin + labelSize * 1.55 + 3;
      out.fillText(name, center, nameY);
      barY = nameY + nameSize * 1.25 + 7;
    }

    // barra de progresso geral dos municípios
    const barW = Math.min(cssW * 0.26, 190);
    const barX = (cssW - barW) / 2;
    const barH = 4;
    const frac = done / total;

    out.fillRect(barX, barY, barW, 1);
    out.fillRect(barX, barY + barH - 1, barW, 1);
    out.fillRect(barX, barY, 1, barH);
    out.fillRect(barX + barW - 1, barY, 1, barH);

    const inner = Math.max(0, (barW - 2) * frac);
    if (inner > 0) out.fillRect(barX + 1, barY + 1, inner, barH - 2);
  }

  function drawHint(p) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = p.fg;
    ctx.globalAlpha = 1;
    ctx.font = 'bold 24px "Courier New", ui-monospace, monospace';
    ctx.fillText('GAÚCHO RUNNER', W / 2, Math.max(24, GROUND_Y - 152));

    ctx.fillStyle = p.dim;
    ctx.font = '19px "Courier New", ui-monospace, monospace';
    ctx.fillText('a cavalo — espaço ou toque para começar', W / 2, Math.max(44, GROUND_Y - 124));

    ctx.font = '16px "Courier New", ui-monospace, monospace';
    ctx.fillText('↑ pular  ·  M som', W / 2, Math.max(66, GROUND_Y - 92));
    ctx.globalAlpha = 1;
  }

  function wrapCssText(text, maxW, font) {
    out.font = font;
    const fits = (s) => out.measureText(s).width <= maxW;
    if (fits(text)) return [text];
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (fits(next)) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // fim de jogo em fonte comum: acentos e ç preservados
  function drawGameOver(cssW, cssH, p) {
    const total = MUNICIPIOS.length;
    const won = game.status === 'won';
    const failure = !won && game.conquered === 0;
    const name = failure ? 'ninguém' : lastMunicipio();

    const message1 = won
      ? 'O RS é teu!'
      : failure
        ? 'Mas bah! Não chegou a lugar nenhum! Tenta de novo, tchê!'
        : 'Tchê! Tu conquistou ' + game.conquered + ' dos ' + total + ' municípios gaúchos!';
    const message2 = won
      ? 'Parabéns por conquistar os ' + total + ' municípios gaúchos'
      : failure
        ? ''
        : 'O último conquistado foi ' + name;
    const prompt = 'Escolha uma opção abaixo';

    const messageSize = clampCss(12, cssW * 0.0135, 18);
    const nameSize = clampCss(13, cssW * 0.015, 20);
    const promptSize = clampCss(10, cssW * 0.0105, 14);
    const recordSize = clampCss(10, cssW * 0.0115, 15);

    const fontMessage = cssFont(700, messageSize);
    const fontName = cssFont(700, nameSize);
    const maxTextW = Math.min(cssW * 0.82, 560);

    const message1Lines = wrapCssText(message1, maxTextW, fontMessage);
    const message2Lines = message2 ? wrapCssText(message2, maxTextW, fontName) : [];
    const line1H = messageSize * 1.35;
    const line2H = nameSize * 1.35;
    const lines1H = message1Lines.length * line1H;
    const lines2H = message2Lines.length * line2H;
    const promptH = promptSize * 1.2;
    const recordH = game.newRecord ? recordSize * 1.2 + 8 : 0;
    const gap = message2Lines.length ? 14 : 0;
    const afterText = 22;

    const blockH = recordH + lines1H + gap + lines2H + afterText + promptH;

    const btnGap = 12;
    const btnW = Math.min(180, Math.max(140, cssW * 0.16));
    const btnH = Math.min(46, Math.max(36, cssH * 0.06));
    const totalH = blockH + 18 + btnH;

    // mede o texto para dimensionar o painel opaco (nuvens não passam por trás)
    out.font = fontMessage;
    const messageW = Math.max(0, ...message1Lines.map((line) => out.measureText(line).width));
    out.font = fontName;
    const nameW = Math.max(0, ...message2Lines.map((line) => out.measureText(line).width));
    out.font = cssFont(500, promptSize);
    const promptW = out.measureText(prompt).width;
    let recordW = 0;
    if (game.newRecord) {
      out.font = cssFont(600, recordSize);
      recordW = out.measureText('Novo recorde!').width;
    }

    const padX = Math.min(28, cssW * 0.06);
    const padY = 20;
    const buttonRowW = btnW * 2 + btnGap;
    const contentW = Math.max(messageW, nameW, promptW, recordW, buttonRowW);
    const panelW = Math.min(cssW - 12, contentW + padX * 2);
    const panelH = totalH + padY * 2;
    const panelX = (cssW - panelW) / 2;
    const availH = Math.max(100, cssH - SAFE.top - SAFE.bottom);
    const panelY = SAFE.top + Math.max(6, (availH - panelH) / 2);
    const border = 1.4;

    out.fillStyle = p.bg;
    out.fillRect(panelX, panelY, panelW, panelH);
    out.fillStyle = p.fg;
    out.fillRect(panelX, panelY, panelW, border);
    out.fillRect(panelX, panelY + panelH - border, panelW, border);
    out.fillRect(panelX, panelY, border, panelH);
    out.fillRect(panelX + panelW - border, panelY, border, panelH);

    let y = panelY + padY;
    out.textAlign = 'center';
    out.textBaseline = 'top';

    if (game.newRecord) {
      out.font = cssFont(600, recordSize);
      out.fillText('Novo recorde!', cssW / 2, y);
      y += recordH;
    }

    out.font = fontMessage;
    for (const line of message1Lines) {
      out.fillText(line, cssW / 2, y);
      y += line1H;
    }

    y += gap;
    out.font = fontName;
    for (const line of message2Lines) {
      out.fillText(line, cssW / 2, y);
      y += line2H;
    }

    y += afterText;
    out.font = cssFont(500, promptSize);
    out.fillText(prompt, cssW / 2, y);
    y += promptH + 18;

    const rowW = btnW * 2 + btnGap;
    const rowX = (cssW - rowW) / 2;
    const again = { x: rowX, y, w: btnW, h: btnH };
    const menu = { x: rowX + btnW + btnGap, y, w: btnW, h: btnH };

    let btnFont = Math.min(15, Math.max(11, btnH * 0.36));
    out.font = cssFont(700, btnFont);
    const againLabel = 'JOGAR DE NOVO';
    const againW = out.measureText(againLabel).width;
    if (againW > btnW - 16) {
      btnFont = Math.max(10, btnFont * ((btnW - 16) / againW));
      out.font = cssFont(700, btnFont);
    }

    // botão principal: jogar de novo
    out.fillStyle = p.fg;
    out.fillRect(again.x, again.y, again.w, again.h);
    out.fillStyle = p.bg;
    out.textAlign = 'center';
    out.textBaseline = 'middle';
    out.fillText(againLabel, again.x + again.w / 2, again.y + again.h / 2);

    // botão secundário: menu
    out.fillStyle = p.bg;
    out.fillRect(menu.x, menu.y, menu.w, menu.h);
    out.strokeStyle = p.fg;
    out.lineWidth = 1;
    out.strokeRect(menu.x + 0.5, menu.y + 0.5, menu.w - 1, menu.h - 1);
    out.fillStyle = p.fg;
    out.fillText('MENU', menu.x + menu.w / 2, menu.y + menu.h / 2);

    // hitboxes em unidades lógicas, para o clique continuar funcionando
    const sx = W / cssW;
    const sy = H / cssH;
    restartButton = { x: again.x * sx, y: again.y * sy, w: again.w * sx, h: again.h * sy };
    overButton = { x: menu.x * sx, y: menu.y * sy, w: menu.w * sx, h: menu.h * sy };
  }

  function drawBoxes() {
    ctx.save();
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 1;
    const rb = runnerBox();
    ctx.strokeRect(rb.x, rb.y, rb.w, rb.h);
    for (const o of game.obstacles) {
      const b = obstacleBox(o);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------- loop
  let last = 0;
  let acc = 0;
  let menuClock = 0;

  function loop(now) {
    if (!last) last = now;
    let dt = now - last;
    last = now;
    if (dt > 120) dt = 120;
    acc += dt;

    let guard = 0;
    while (acc >= 1000 / 60 && guard++ < 5) {
      if (screen === 'game') {
        update();
      } else {
        // fundo do menu: nuvens passando e cavalo galopando no lugar
        game.time += 1000 / 60;
        game.worldX += 0.6;
        menuClock += 1;
        if (menuClock >= 4) {
          menuClock = 0;
          runner.legPhase = (runner.legPhase + 1) % 8;
        }
      }
      acc -= 1000 / 60;
    }
    render();
    requestAnimationFrame(loop);
  }

  // --------------------------------------------------------------------- input
  document.addEventListener('keydown', (e) => {
    if (rotateHint && !rotateHint.hidden) return;
    if (screen !== 'game') {
      if (e.repeat) return;
      if (screen === 'menu') {
        if (e.code === 'ArrowDown' || e.code === 'KeyS') {
          e.preventDefault();
          menuFocus = (menuFocus + 1) % 3;
        } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
          e.preventDefault();
          menuFocus = (menuFocus + 2) % 3;
        } else if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          activateMenu(menuFocus);
        }
      } else if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space' || e.code === 'Backspace') {
        e.preventDefault();
        screen = 'menu';
        menuFocus = 0;
      }
      return;
    }

    switch (e.code) {
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        e.preventDefault();
        if (!e.repeat) pressPrimary();
        break;

      case 'KeyM':
        if (!e.repeat) toggleMute();
        break;
      case 'Escape':
        e.preventDefault();
        if (!e.repeat) goMenu();
        break;
      case 'Enter':
        if (game.status === 'crashed' && game.crashFrames > 18) {
          e.preventDefault();
          restart();
        }
        break;
      default:
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    if (screen !== 'game') return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') cutJump();
  });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (screen !== 'game') {
      handleMenuPointer(e);
      return;
    }
    if (game.status === 'crashed' || game.status === 'won') {
      if (game.status === 'crashed' && game.crashFrames <= 18) return;
      const pt = pointerLogical(e);
      if (inButton(pt, restartButton)) {
        restart();
        return;
      }
      if (inButton(pt, overButton)) {
        goMenu();
        return;
      }
      // clique fora dos botões não reinicia nem volta ao menu
      return;
    }
    pressPrimary();
  });

  // mãozinha só sobre elementos clicáveis (botões), nunca no resto do canvas
  canvas.addEventListener('pointermove', (e) => {
    const pt = pointerLogical(e);
    let overButtonNow = false;
    if (screen !== 'game') {
      overButtonNow = menuButtons.some((b) => inButton(pt, b));
    } else if (game.status === 'crashed' || game.status === 'won') {
      overButtonNow = inButton(pt, restartButton) || inButton(pt, overButton);
    }
    canvas.style.cursor = overButtonNow ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerleave', () => {
    canvas.style.cursor = 'default';
  });

  // ----------------------------------------------------- controles de toque
  const touchJumpBtn = document.getElementById('touch-jump');
  const rotateHint = document.getElementById('rotate-hint');
  const rotateDismiss = document.getElementById('rotate-dismiss');
  const portraitQuery = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  let touchUIActive = false;
  let rotateDismissed = /[?&]rotate=0/.test(location.search);

  function syncTouchUI() {
    if (!TOUCH_MODE) return;
    const active = screen === 'game' && game.status === 'running';
    if (active === touchUIActive) return;
    touchUIActive = active;
    document.body.classList.toggle('playing', active);
    if (!active) {
      touchJumpBtn?.classList.remove('is-active');
    }
  }

  function updateRotateHint() {
    if (!rotateHint) return;
    const show = TOUCH_MODE && !!portraitQuery?.matches && !rotateDismissed && screen === 'menu';
    rotateHint.hidden = !show;
    rotateHint.setAttribute('aria-hidden', String(!show));
  }

  function touchJumpDown(e) {
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    touchJumpBtn?.classList.add('is-active');
    if (game.status === 'running') jump();
  }

  function touchJumpUp(e) {
    if (e) e.preventDefault();
    touchJumpBtn?.classList.remove('is-active');
    cutJump();
  }

  if (touchJumpBtn) {
    touchJumpBtn.addEventListener('pointerdown', (e) => {
      try { touchJumpBtn.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
      touchJumpDown(e);
    });
    touchJumpBtn.addEventListener('pointerup', touchJumpUp);
    touchJumpBtn.addEventListener('pointercancel', touchJumpUp);
    touchJumpBtn.addEventListener('pointerleave', touchJumpUp);
  }

  if (rotateDismiss) {
    rotateDismiss.addEventListener('click', () => {
      rotateDismissed = true;
      updateRotateHint();
    });
  }
  portraitQuery?.addEventListener?.('change', updateRotateHint);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) last = 0;
  });

  window.addEventListener('resize', () => {
    readSafeArea();
    fitCanvas();
    updateRotateHint();
  });

  // ---------------------------------------------------------- hooks / depuração
  // ?debug=run|jump|dead|win | &night=1 | &boxes=1 | &cidades=40
  window.__gaucho = { game, runner, startGame, restart, jump, update, render, MUNICIPIOS, get screen() { return screen; }, get buttons() { return menuButtons; }, get restartButton() { return restartButton; }, get overButton() { return overButton; }, get world() { return { W, H }; } };

  readSafeArea();

  if (params.get('screen') === 'about' || params.get('screen') === 'contact') screen = params.get('screen');

  const debug = params.get('debug');
  if (debug) {
    screen = 'game';
    game.status = 'running';
    game.speed = 7;
    if (debug === 'jump') {
      runner.onGround = false;
      runner.y = GROUND_Y - BODY_H - 60;
    } else if (debug === 'dead') {
      game.status = 'crashed';
      runner.dead = true;
    }
    if (params.get('night') === '1') game.nightLeft = 1e6;
    if (params.get('phase') !== null) runner.legPhase = Number(params.get('phase')) % 8;
    if (params.get('cidades') !== null) {
      game.conquered = Math.max(0, Math.min(MUNICIPIOS.length, Number(params.get('cidades')) || 0));
    }
    if (debug === 'win') {
      game.conquered = MUNICIPIOS.length;
      game.status = 'won';
    }
    fitCanvas();
    game.obstacles.push({ type: 'bush', x: 320, y: GROUND_Y - 40, w: 36, h: 40, seed: 0.5 });
    game.obstacles.push({ type: 'fence', x: 250, y: GROUND_Y - 52, w: 56, h: 52 });
    game.obstacles.push({ type: 'bird', x: 430, y: GROUND_Y - 66, bottom: 40, w: 40, h: 26, frameClock: Number(params.get('bf') || 4), low: false });
    game.obstacles.push({ type: 'rock', x: 110, y: GROUND_Y - 24, w: 32, h: 24 });
    game.obstacles.push({ type: 'stump', x: 150, y: GROUND_Y - 22, w: 34, h: 22, seed: 0.5 });
    game.obstacles.push({ type: 'post', x: 195, y: GROUND_Y - 42, w: 13, h: 42 });
    render();
  } else {
    requestAnimationFrame(loop);
  }

  updateRotateHint();
  fitCanvas();
})();
