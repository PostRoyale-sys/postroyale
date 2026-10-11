// Ролик звукового обновления (~28 с, со звуком): вертолёт и прыжок (ветер), парашют, шаги, каждое оружие отдельно,
// перезарядка, попадания и убийство, аптечка, сундук, финальная карточка под музыку лобби.
// Открыть: /?w=sound1&shot=160,160,40,0,-0.3&rec=1 и в консоли import('./brand/trailer4.js').then((m) => m.record())
// Как trailer3.js: виртуальное время, pc.mainLoop покадрово, H.264 + AAC (WebCodecs + mp4-muxer) → POST на 127.0.0.1:8767.
// Звук пишется движком audio.js в OfflineAudioContext по тем же виртуальным часам — совпадает с кадрами.

const W = 1280, H = 720, FPS = 30;
const DISPLAY = '"Lilita One", "Arial Black", sans-serif';
const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';
const URL_TEXT = 'postroyale.xyz';

// [начало, конец, id, крупно, мелко]
const SHOTS = [
  [0.0, 3.0, 'drop', 'SOUND UPDATE', '🔊 turn your sound on'],
  [3.0, 5.0, 'chute', 'WIND · PARACHUTE', null],
  [5.0, 6.6, 'run', 'FOOTSTEPS', 'grass · sand · wood · metal'],
  [6.6, 7.8, 'pistol', 'PISTOL', 'every gun sounds different'],
  [7.8, 9.0, 'smg', 'SMG', null],
  [9.0, 10.2, 'ar', 'ASSAULT RIFLE', null],
  [10.2, 11.8, 'shotgun', 'SHOTGUN', 'pump · rack · shells'],
  [11.8, 13.4, 'sniper', 'SNIPER', 'boom + bolt'],
  [13.4, 15.0, 'bazooka', 'BAZOOKA', null],
  [15.0, 17.0, 'reload', 'RELOAD SOUNDS', 'mag out · mag in · charge'],
  [17.0, 19.2, 'hits', 'HITS · KILLS', null],
  [19.2, 22.0, 'medkit', 'MEDKITS', 'zip · bandage · spray'],
  [22.0, 23.8, 'chest', 'LOOT', null],
];
const END_AT = 23.8, TOTAL = 27.8;
// громкость музыки лобби под роликом: тихо под игрой, в полную — на финальной карточке
const MUSIC = [[0, 0.12], [END_AT - 0.4, 0.12], [END_AT + 0.6, 0.85], [TOTAL - 0.6, 0.85], [TOTAL, 0]];

export async function record() {
  const pc = window.__pc;
  const src = pc.renderer.domElement;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  await document.fonts.load(`40px ${DISPLAY}`).catch(() => {});

  // в ролике игрока не убивают (бот в сцене с числами урона отстреливается); урон — только для сцены аптечки
  const realDamage = pc.combat.takeDamage;
  pc.combat.takeDamage = () => {};
  let locked = true;
  Object.defineProperty(pc.controls, 'isLocked', { get: () => locked, configurable: true });
  for (const id of ['cross', 'pause', 'banner', 'prompt', 'minimap', 'fpv', 'dmgnums']) { const e = document.getElementById(id); if (e) e.hidden = true; }

  // ---------- виртуальное время ----------
  const realPerf = performance.now.bind(performance), realDate = Date.now;
  let vt = realPerf(), skew = 0;
  const dateBase = realDate() - vt;
  performance.now = () => vt;
  Date.now = () => Math.round(dateBase + vt + skew);
  pc.renderer.setAnimationLoop(null);

  // ---------- кодирование ----------
  const t0 = vt;
  const T = () => (vt - t0) / 1000;
  const endAudio = await pc.audio.capture(TOTAL, T, MUSIC);
  const SR = pc.audio.ctx.sampleRate;
  const aac = { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 192000 };
  const useAac = (await AudioEncoder.isConfigSupported(aac).catch(() => ({}))).supported;
  const acfg = useAac ? aac : { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, audio: { codec: useAac ? 'aac' : 'opus', numberOfChannels: 2, sampleRate: acfg.sampleRate }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 10e6, framerate: FPS });
  window.__trailer = { done: false, frame: 0 };

  const V = (x, y, z) => pc.vec(x, y, z);
  const ground = (x, z) => pc.world.height(x, z);
  const S = {};

  // ---------- помощники ----------
  const look = (yaw, pitch) => pc.look(yaw, pitch);
  function aimAt(p, dy = 0.8) {
    const f = pc.feet, eye = f.y + pc.eyeH;
    const dx = p.x - f.x, dz = p.z - f.z, d = Math.hypot(dx, dz);
    look(Math.atan2(-dx, -dz), Math.atan2((p.y ?? ground(p.x, p.z)) + dy - eye, d));
  }
  // на землю (не на крышу), если там свободно
  function standAt(x, z) { pc.cut(); locked = true; pc.tp(x, z); if (!pc.structures.blocked(x, ground(x, z) + 0.05, z)) pc.feet.y = ground(x, z) + 0.02; }
  const center = () => pc.royale.center;
  function openSpot(p, d, needSight = true) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.3, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (ground(x, z) < 1.5 || pc.structures.blocked(x, ground(x, z) + 0.1, z)) continue;
      if (!needSight) return { x, z };
      const from = V(x, ground(x, z) + 1.6, z), py = (p.y ?? ground(p.x, p.z)) + 0.7;
      const dir = V(p.x - x, py - from.y, p.z - z), len = dir.length();
      const hit = pc.structures.raycast(from, dir.normalize(), len);
      if (!hit || hit.t > len - 1.2) return { x, z };
    }
    return { x: p.x + d, z: p.z };
  }
  const nearCenter = (list) => [...list].sort((a, b) => Math.hypot(a.x - center().x, a.z - center().z) - Math.hypot(b.x - center().x, b.z - center().z));
  const awayBots = () => { for (const b of pc.bots.list.values()) if (b !== S.bot) b.pos.set(9999, 0, 9999); };
  // открытое место без деревьев рядом (чтобы оружие было видно на фоне неба/поля)
  function clearing() {
    const c = center();
    for (let k = 0; k < 60; k++) {
      const a = k * 2.399, r = 20 + k * 2.5, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (ground(x, z) < 2 || pc.structures.blocked(x, ground(x, z) + 0.1, z)) continue;
      if (pc.structures.objects.some((o) => o.hp > 0 && Math.hypot(o.x - x, o.z - z) < 7)) continue;
      if (pc.world.pieces.some((q) => Math.hypot(q.ix * 4 + 2 - x, q.iz * 4 + 2 - z) < 16)) continue;   // подальше от домов
      return { x, z };
    }
    return { x: c.x, z: c.z };
  }
  const give = (...items) => { for (const it of items) pc.combat.give(it); };

  // все выстрелы — с одной точки по стене дома (слышно попадания); оружие — в первый слот
  function gunAt() {
    if (S.spot) { standAt(S.spot.x, S.spot.z); return; }
    const poi = nearCenter(pc.world.pois)[0];
    S.poi = poi; S.spot = openSpot({ x: poi.x, z: poi.z }, 16, false);
    standAt(S.spot.x, S.spot.z);
  }
  const AMMO_OF = { pistol: 'light', smg: 'light', ar: 'medium', shotgun: 'shells', sniper: 'heavy', bazooka: 'rockets' };
  function gun(type, first, every, r = 3) {
    return {
      start() {
        pc.combat.resetAll();
        give({ k: 'weapon', w: type, r }, { k: 'ammo', w: AMMO_OF[type], a: 200 });
        gunAt(); awayBots(); pc.pick(1);
        S.next = first;
      },
      tick(s) {
        aimAt({ x: S.poi.x, z: S.poi.z }, type === 'bazooka' ? 0.6 : 1.4);
        if (s > S.next) { pc.combat.fire(0, performance.now() / 1000); S.next = every ? s + every : 1e9; }
      },
    };
  }
  const SCENES = {
    drop: {
      start() {
        pc.setMood('game');
        pc.combat.resetAll();
        awayBots();
        pc.ride(); locked = true;
        S.jumped = false;
      },
      tick(s) {
        if (!S.jumped && s > 1.1) { S.jumped = true; pc.jump(true); }
      },
    },
    chute: {
      start() { pc.feet.y = Math.max(ground(pc.feet.x, pc.feet.z), 0) + 41; },
      tick() {},
    },
    run: {
      start() {
        const sp = clearing(); standAt(sp.x, sp.z); locked = true;
        pc.combat.resetAll(); pc.pick(0);
        S.yaw = 0.6; look(S.yaw, -0.05);
        pc.keys.add('KeyW'); pc.keys.add('ShiftLeft');
      },
      tick(s) { look(S.yaw + Math.sin(s * 1.5) * 0.15, -0.05); },
    },
    pistol: gun('pistol', 0.15, 0.28),
    smg: gun('smg', 0.15, 0.01),
    ar: gun('ar', 0.15, 0.01, 4),
    shotgun: gun('shotgun', 0.15, 0.95),
    sniper: gun('sniper', 0.2, 0),
    bazooka: gun('bazooka', 0.25, 0, 4),
    reload: {
      start() {
        pc.combat.resetAll();
        give({ k: 'weapon', w: 'ar', r: 4 }, { k: 'ammo', w: 'medium', a: 200 });
        const sp = clearing(); standAt(sp.x, sp.z); awayBots();
        pc.pick(1); S.yaw = 0.6; S.rl = false;
        pc.combat.slots[0].mag = 3;
      },
      tick(s) {
        if (!S.rl && s > 0.35) S.rl = pc.combat.reload(0);
        look(S.yaw + 0.35 + s * 0.08, 0.0);
      },
    },
    hits: {
      start() {
        const poi = nearCenter(pc.world.pois)[0];
        S.bot = [...pc.bots.list.values()].find((b) => b.alive) || [...pc.bots.list.values()][0];
        const sp = openSpot({ x: poi.x, z: poi.z }, 4, false);
        standAt(sp.x, sp.z);
        const bp = openSpot({ x: sp.x, z: sp.z, y: ground(sp.x, sp.z) }, 7);
        Object.assign(S.bot, { riding: false, gliding: false, chute: false, onGround: true, gun: 'ar', hp: 330, alive: true });
        S.bot.pos.set(bp.x, ground(bp.x, bp.z), bp.z);
        awayBots();
        document.getElementById('dmgnums').hidden = false;
        pc.pick(1); S.next = 0.3;
      },
      tick(s) {
        if (S.bot.alive) aimAt(S.bot.pos, 1.0);
        if (S.bot.alive && s > S.next) { pc.combat.fire(0, performance.now() / 1000); S.next = s + 0.13; }
      },
    },
    medkit: {
      start() {
        document.getElementById('dmgnums').hidden = true;
        S.bot && S.bot.pos.set(9999, 0, 9999);
        const sp = clearing(); standAt(sp.x, sp.z);
        if (pc.combat.hp > 40) realDamage(pc.combat.hp - 35, 'Storm', 'storm');
        give({ k: 'med', w: 'med', a: 40 }, { k: 'med', w: 'med', a: 40 }, { k: 'med', w: 'med', a: 40 });
        pc.pick(4);
        S.healed = false; S.yaw2 = 2.2;
      },
      tick(s) {
        if (!S.healed && s > 0.4) { S.healed = pc.combat.startHeal(); }
        look(S.yaw2 + s * 0.06, -0.05);
      },
    },
    chest: {
      start() {
        const ch = nearCenter(pc.loot.chests.filter((c) => !pc.loot.isOpen(c) && ground(c.pos.x, c.pos.z) > 2
          && Math.abs(c.pos.y - ground(c.pos.x, c.pos.z)) < 0.6 && !pc.structures.blocked(c.pos.x, c.pos.y + 2.5, c.pos.z)
          && !pc.structures.blocked(c.pos.x, c.pos.y + 6, c.pos.z)));
        S.chest = ch[0];
        const p = S.chest.pos, sp = openSpot({ x: p.x, z: p.z, y: p.y }, 3.4);
        standAt(sp.x, sp.z); pc.pick(0);
        aimAt(p, 0.2); S.opened = false;
      },
      tick(s) {
        if (!S.opened && s > 0.3) { S.opened = true; pc.loot.open(S.chest, 2); pc.audio.play('chest', S.chest.pos); }
        aimAt(S.chest.pos, 0.25 + s * 0.2);
        if (s > 0.9) pc.keys.add('KeyW');                       // подходим — лут подбирается сам
      },
    },
  };

  // ---------- кадр ----------
  let cur = -1;
  const shotAt = (t) => SHOTS.findIndex(([a, b]) => t >= a && t < b);
  function frame() {
    const t = T();
    if (t >= TOTAL) return finish();
    if (t < END_AT) {
      const i = shotAt(t);
      const [a, b, id, big, small] = SHOTS[i];
      if (i !== cur) { cur = i; pc.keys.clear(); SCENES[id].start(); }
      SCENES[id].tick(t - a);
      const z = 1 + ((t - a) / (b - a)) * 0.05;
      const sw = src.width, sh = src.height, k = Math.max(W / sw, H / sh) * z;
      const dw = sw * k, dh = sh * k;
      g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      if (id === 'hits') numbers();
      if (id === 'medkit') hpBar(t - a);
      vignette();
      watermark();
      badge(t);
      punch(big, small, t - a, b - t);
      flash(t - a);
    } else { if (cur !== -2) { cur = -2; pc.keys.clear(); } endCard(t - END_AT); }
  }

  // ---------- графика поверх ----------
  function vignette() {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,6,30,0.5)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
  function flash(s) {
    if (s > 0.14) return;
    g.fillStyle = `rgba(255,255,255,${0.7 * (1 - s / 0.14)})`;
    g.fillRect(0, 0, W, H);
  }
  function logo(x, y, size, align = 'left') {
    g.font = `italic 400 ${size}px ${DISPLAY}`;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const w1 = g.measureText('POST').width, w2 = g.measureText('ROYALE').width;
    const x0 = align === 'center' ? x - (w1 + w2) / 2 : x;
    g.lineWidth = size * 0.12; g.strokeStyle = 'rgba(20,12,60,.9)'; g.lineJoin = 'round';
    g.strokeText('POST', x0, y); g.strokeText('ROYALE', x0 + w1, y);
    g.fillStyle = '#ffffff'; g.fillText('POST', x0, y);
    g.fillStyle = '#ffc928'; g.fillText('ROYALE', x0 + w1, y);
  }
  function watermark() { g.globalAlpha = 0.9; logo(30, 52, 26); g.globalAlpha = 1; }
  // плашка «UPDATE» справа сверху
  function badge(t) {
    g.save();
    const w = 150, h = 40, x = W - w - 28, y = 22;
    g.fillStyle = '#ffc928'; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill();
    g.fillStyle = '#1b1450'; g.font = `italic 400 24px ${DISPLAY}`; g.textAlign = 'center';
    g.fillText(Math.floor(t * 2) % 2 ? '🔊 SOUND' : '🔈 SOUND', x + w / 2, y + 29);
    g.restore();
  }
  function punch(big, small, since, until) {
    const pin = Math.min(1, since / 0.14), e = 1 - (1 - pin) ** 3;
    const a = Math.min(1, until / 0.18);
    g.save();
    g.globalAlpha = Math.max(0, a);
    g.translate(W / 2, H - 130);
    g.rotate((-2.5 * Math.PI) / 180);
    g.scale(1.5 - 0.5 * e, 1.5 - 0.5 * e);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `italic 400 84px ${DISPLAY}`;
    g.lineWidth = 13; g.strokeStyle = 'rgba(20,12,60,.95)'; g.lineJoin = 'round';
    g.strokeText(big, 0, 0);
    g.fillStyle = '#ffffff'; g.fillText(big, 0, 0);
    if (small && since > 0.12) {
      g.font = `800 27px ${SANS}`;
      g.lineWidth = 7; g.strokeText(small, 0, 42);
      g.fillStyle = '#ffd84a'; g.fillText(small, 0, 42);
    }
    g.restore();
  }
  // числа урона в игре — DOM-слой; в ролик переносим их на холст по их экранным координатам
  function numbers() {
    const sx = W / innerWidth, sy = H / innerHeight;
    for (const el of document.querySelectorAll('#dmgnums .dn')) {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\).*scale\(([\d.]+)\)/.exec(el.style.transform || '');
      if (!m) continue;
      const op = +(el.style.opacity || 1);
      const big = el.classList.contains('big'), sh = el.classList.contains('sh');
      g.save();
      g.globalAlpha = op;
      g.translate(+m[1] * sx, +m[2] * sy); g.scale(+m[3], +m[3]);
      g.font = `400 ${big ? 40 : 32}px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 7; g.strokeStyle = '#14161c'; g.lineJoin = 'round';
      g.strokeText(el.textContent, 0, 0);
      g.fillStyle = big ? (sh ? '#9ad8ff' : '#ffd21a') : sh ? '#6fc3ff' : '#ffffff';
      g.fillText(el.textContent, 0, 0);
      g.restore();
    }
  }
  // полоса здоровья в сцене аптечки (интерфейс игры в ролик не попадает)
  function hpBar(s) {
    const hp = pc.combat.hp, hl = pc.combat.healing;
    g.save();
    const x = 40, y = H - 100, w = 330, h = 26;
    g.fillStyle = 'rgba(20,12,60,.75)'; g.beginPath(); g.roundRect(x - 8, y - 38, w + 16, h + 48, 14); g.fill();
    g.fillStyle = '#ffffff'; g.font = `800 18px ${SANS}`; g.textAlign = 'left';
    g.fillText(hl ? `✚ HEALING… ${Math.max(0, hl.left).toFixed(1)}s` : '❤ HEALTH', x, y - 12);
    g.fillStyle = 'rgba(255,255,255,.15)'; g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill();
    g.fillStyle = hp < 50 ? '#ff5a6a' : '#2fbf71'; g.beginPath(); g.roundRect(x, y, (w * hp) / 100, h, 8); g.fill();
    g.fillStyle = '#ffffff'; g.font = `italic 400 22px ${DISPLAY}`; g.textAlign = 'right'; g.fillText(`${hp}`, x + w - 8, y + 21);
    g.restore();
    void s;
  }
  function endCard(s) {
    const bg = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H / 2, W * 0.75);
    bg.addColorStop(0, '#5b3dff'); bg.addColorStop(0.55, '#2a1880'); bg.addColorStop(1, '#0e0828');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const f = (d) => Math.max(0, Math.min(1, (s - d) / 0.3));
    const pop = Math.min(1, s / 0.3), e = 1 - (1 - pop) ** 3;
    g.save(); g.globalAlpha = e; logo(W / 2, H * 0.22, 76, 'center'); g.restore();
    const k = Math.min(1, Math.max(0, (s - 0.2) / 0.18)), ek = 1 - (1 - k) ** 3, pulse = 1 + Math.sin(s * 5) * 0.02;
    g.save();
    g.globalAlpha = k;
    g.translate(W / 2, H * 0.42); g.rotate((-3 * Math.PI) / 180); g.scale((1.6 - 0.6 * ek) * pulse, (1.6 - 0.6 * ek) * pulse);
    g.textAlign = 'center'; g.font = `italic 400 112px ${DISPLAY}`;
    g.lineWidth = 16; g.strokeStyle = 'rgba(20,12,60,.95)'; g.lineJoin = 'round';
    g.strokeText('UPDATE IS LIVE', 0, 0);
    g.fillStyle = '#ffc928'; g.fillText('UPDATE IS LIVE', 0, 0);
    g.restore();
    g.textAlign = 'center';
    g.globalAlpha = f(0.6); g.font = `700 26px ${SANS}`; g.fillStyle = '#e8e4ff';
    g.fillText('Every gun sounds different · Footsteps · Parachute · Lobby music', W / 2, H * 0.55);
    g.globalAlpha = f(0.9);
    const bw = 380, bh = 64, bx = W / 2 - bw / 2, by = H * 0.62;
    const p2 = 1 + Math.sin(s * 6) * 0.025;
    g.save(); g.translate(W / 2, by + bh / 2); g.scale(p2, p2); g.translate(-W / 2, -(by + bh / 2));
    g.fillStyle = '#ffc928'; g.beginPath(); g.roundRect(bx, by, bw, bh, 16); g.fill();
    g.fillStyle = '#1b1450'; g.font = `italic 400 36px ${DISPLAY}`; g.fillText('▶ PLAY FREE NOW', W / 2, by + 45);
    g.restore();
    g.globalAlpha = f(1.2); g.font = `700 26px ${SANS}`; g.fillStyle = '#ffffff';
    g.fillText(URL_TEXT, W / 2, by + bh + 46);
    g.globalAlpha = 1;
    flash(s);
  }

  // ---------- покадровый прогон ----------
  let done = false;
  function finish() { done = true; }
  const yieldTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  window.__frameHook = () => frame();
  for (let i = 0; !done; i++) {
    vt += 1000 / FPS;
    pc.mainLoop(vt);
    if (done) break;
    const vf = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(vf, { keyFrame: i % FPS === 0 });
    vf.close();
    window.__trailer.frame = i;
    while (enc.encodeQueueSize > 4) await yieldTask();
    if (encErr) throw encErr;
    if (i % 5 === 0) await yieldTask();
  }
  window.__frameHook = null;
  await enc.flush();
  // звук: дорендерить и закодировать кусками по 0.1 с
  window.__trailer.audio = 'render';
  const ab = await endAudio();
  window.__trailer.audio = 'encode';
  let aErr = null;
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { aErr = e; } });
  aenc.configure(acfg);
  const L = ab.getChannelData(0), R = ab.getChannelData(1), step = Math.round(ab.sampleRate / 10);
  // нормировка по пику обоих каналов (0.95) — без клиппинга в AAC
  let pk0 = 0;
  for (let i = 0; i < L.length; i++) pk0 = Math.max(pk0, Math.abs(L[i]), Math.abs(R[i]));
  if (pk0 > 0) for (let i = 0; i < L.length; i++) { L[i] *= 0.95 / pk0; R[i] *= 0.95 / pk0; }
  window.__trailer.rawPeak = pk0;
  for (let i = 0; i < ab.length; i += step) {
    const n = Math.min(step, ab.length - i), data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: ab.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / ab.sampleRate) * 1e6), data });
    aenc.encode(ad); ad.close();
    if (aErr) throw aErr;
  }
  await aenc.flush();
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]));
  window.__trailer.peak = peak;
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  performance.now = realPerf; Date.now = realDate;
  pc.combat.takeDamage = realDamage;
  pc.renderer.setAnimationLoop(pc.mainLoop);
  const name = 'postroyale-sound-update.mp4';
  const res = await fetch(`http://127.0.0.1:8767/upload?name=${name}`, { method: 'POST', body: blob });
  window.__trailer = { done: true, name, size: blob.size, ok: res.ok, aac: useAac, peak: window.__trailer.peak, rawPeak: window.__trailer.rawPeak };
}
