// Ролик обновления (~25 с): новое оружие от первого лица, перезарядка, помпа и гильзы, числа урона, аптечки,
// анимация сундука, закат с лучами солнца, новый шторм, эмоция, финальная карточка «UPDATE IS LIVE».
// Открыть: /?w=update1&shot=160,160,40,0,-0.3&rec=1 и в консоли import('./brand/trailer3.js').then((m) => m.record())
// Как trailer2.js: виртуальное время, pc.mainLoop покадрово, H.264 (WebCodecs + mp4-muxer) → POST на 127.0.0.1:8767.

const W = 1280, H = 720, FPS = 30;
const DISPLAY = '"Lilita One", "Arial Black", sans-serif';
const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';
const URL_TEXT = 'postroyale.xyz';

// [начало, конец, id, крупно, мелко]
const SHOTS = [
  [0.0, 2.8, 'guns', 'NEW GUNS', 'hand-crafted first-person models'],
  [2.8, 5.3, 'reload', 'REAL RELOADS', 'mag out · mag in · charge'],
  [5.3, 7.5, 'pump', 'PUMP · RACK · SHELLS', null],
  [7.5, 9.9, 'hits', 'DAMAGE NUMBERS', 'blue = shield'],
  [9.9, 13.5, 'medkit', 'MEDKITS', 'slot 5 · +40 HP'],
  [13.5, 15.5, 'chest', 'LOOT POPS', null],
  [15.5, 18.3, 'golden', 'GOLDEN HOUR', 'day · morning · sunset'],
  [18.3, 20.3, 'storm', 'NEW STORM', null],
  [20.3, 22.3, 'emote', 'EMOTES', 'press J'],
];
const END_AT = 22.3, TOTAL = 26.3;

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
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 10e6, framerate: FPS });
  window.__trailer = { done: false, frame: 0 };

  const t0 = vt;
  const T = () => (vt - t0) / 1000;
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

  const SCENES = {
    guns: {
      start() {
        pc.setMood('game');
        pc.combat.resetAll();
        give({ k: 'weapon', w: 'ar', r: 4 }, { k: 'weapon', w: 'shotgun', r: 3 }, { k: 'weapon', w: 'sniper', r: 4 }, { k: 'ammo', w: 'medium', a: 300 }, { k: 'ammo', w: 'shells', a: 60 }, { k: 'ammo', w: 'heavy', a: 30 });
        const sp = clearing(); standAt(sp.x, sp.z);
        awayBots();
        S.yaw = 0.6; pc.pick(1); S.sw = [1.0, 1.9];
      },
      tick(s) {
        // смена оружия: AR → снайперка → AR, камера медленно ведётся
        if (S.sw[0] && s > S.sw[0]) { pc.pick(3); S.sw[0] = 0; }
        if (S.sw[1] && s > S.sw[1]) { pc.pick(1); S.sw[1] = 0; }
        look(S.yaw + Math.sin(s * 1.4) * 0.35, 0.02 + Math.sin(s * 2.1) * 0.05);
      },
    },
    reload: {
      start() { const w = pc.combat.slots[0]; w.mag = 3; pc.pick(1); pc.combat.reload(0); },
      tick(s) { look(S.yaw + 0.35 + s * 0.08, 0.0); },
    },
    pump: {
      start() {
        pc.pick(2);
        // стреляем в стену дома: видно помпу, гильзы и следы дроби
        const poi = nearCenter(pc.world.pois)[0];
        const sp = openSpot({ x: poi.x, z: poi.z }, 14, false);
        standAt(sp.x, sp.z); awayBots();
        S.poi = poi; S.next = 0.3;
      },
      tick(s) {
        aimAt({ x: S.poi.x, z: S.poi.z }, 1.2);
        if (s > S.next) { pc.combat.fire(1, performance.now() / 1000); S.next = s + 0.95; }
      },
    },
    hits: {
      start() {
        const poi = nearCenter(pc.world.pois)[0];
        S.bot = [...pc.bots.list.values()].find((b) => b.alive);
        const sp = openSpot({ x: poi.x, z: poi.z }, 4, false);
        standAt(sp.x, sp.z);
        const bp = openSpot({ x: sp.x, z: sp.z, y: ground(sp.x, sp.z) }, 7);
        Object.assign(S.bot, { riding: false, gliding: false, chute: false, onGround: true, gun: 'ar', hp: 400, alive: true });
        S.bot.pos.set(bp.x, ground(bp.x, bp.z), bp.z);
        awayBots();
        document.getElementById('dmgnums').hidden = false;
        pc.pick(1); S.next = 0.3;
      },
      tick(s) {
        aimAt(S.bot.pos, 1.0);
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
        if (!S.healed && s > 0.1) { S.healed = pc.combat.startHeal(); }
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
        if (!S.opened && s > 0.3) { S.opened = true; pc.loot.open(S.chest, 2); }
        aimAt(S.chest.pos, 0.25 + s * 0.2);
      },
    },
    golden: {
      start() {
        pc.setMood('golden');
        // панорама с высоты лицом к низкому солнцу: длинные тени, лучи, блик
        const sd = pc.scene.children.find((o) => o.isMesh && o.material?.uniforms?.sunDir).material.uniforms.sunDir.value.clone();
        const h = Math.hypot(sd.x, sd.z), c = center();
        pc.cut(); locked = false;
        S.sd = sd; S.p0 = { x: c.x - (sd.x / h) * 70, z: c.z - (sd.z / h) * 70 };
      },
      tick(s) {
        const x = S.p0.x + s * 4, z = S.p0.z;
        pc.feet.set(x, Math.max(ground(x, z), 0) + 24 - s * 2, z);
        look(Math.atan2(-S.sd.x, -S.sd.z) - 0.2 + s * 0.12, Math.asin(S.sd.y) - 0.3);
      },
    },
    storm: {
      start() {
        pc.setMood('game');
        skew = 150e3;
        pc.cut(); locked = false;
        const c = center(), r = pc.royale.stormNow().r;
        // точка на суше в 14 м снаружи стены: стена — во весь кадр, видно клубы и полосы
        let a = 0;
        for (let k = 0; k < 36; k++) { const aa = (k / 36) * Math.PI * 2, x = c.x + Math.cos(aa) * (r + 14), z = c.z + Math.sin(aa) * (r + 14); if (ground(x, z) > 2) { a = aa; break; } }
        S.c = c; S.a = a;
      },
      tick(s) {
        const c = S.c, a = S.a + s * 0.04, r = pc.royale.stormNow().r + 14;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        pc.feet.set(x, Math.max(ground(x, z), 0) + 3, z);
        const dx = c.x - x, dz = c.z - z;
        look(Math.atan2(-dx, -dz) + 0.55, 0.08);
      },
    },
    emote: {
      start() {
        skew = 0;
        const sp = clearing(); standAt(sp.x, sp.z); locked = true;
        S.em = false; S.yaw3 = 1.2; look(S.yaw3, 0);
      },
      tick(s) {
        if (!S.em && s > 0.1) { pc.emote('dance'); S.em = !!pc.emoting; }
        if (S.em) look(S.yaw3 + Math.PI - 0.15 + s * 0.35, -0.12);
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
      if (i !== cur) { cur = i; SCENES[id].start(); }
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
    } else endCard(t - END_AT);
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
    g.fillText(Math.floor(t * 2) % 2 ? '● UPDATE' : '○ UPDATE', x + w / 2, y + 29);
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
    g.fillText('New guns · Medkits · Damage numbers · Golden hour · Emotes', W / 2, H * 0.55);
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
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  performance.now = realPerf; Date.now = realDate;
  pc.combat.takeDamage = realDamage;
  pc.renderer.setAnimationLoop(pc.mainLoop);
  const name = 'postroyale-update-guns-medkits.mp4';
  const res = await fetch(`http://127.0.0.1:8767/upload?name=${name}`, { method: 'POST', body: blob });
  window.__trailer = { done: true, name, size: blob.size, ok: res.ok };
}
