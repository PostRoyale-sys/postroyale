// Ролик «ROADSTER» (~24 с, со звуком): показ машины, разгон 0–100 с таймером, прыжок на двигателях, кикфлип,
// зависание, таран, езда по воде; финальная карточка.
// Открыть: /?w=car7&shot=160,160,40,0,-0.3&rec=1 и в консоли import('./brand/trailer6.js').then((m) => m.record())
// Как trailer5.js: виртуальное время, pc.mainLoop покадрово, H.264 + AAC (WebCodecs + mp4-muxer) → POST на 127.0.0.1:8767.

const W = 1280, H = 720, FPS = 30;
const DISPLAY = '"Lilita One", "Arial Black", sans-serif';
const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';
const URL_TEXT = 'postroyale.xyz';

// [начало, конец, id, крупно, мелко]
const SHOTS = [
  [0.0, 3.6, 'reveal', 'THE ROADSTER', 'now in PostRoyale'],
  [3.6, 6.8, 'launch', '0–100 KM/H', 'in under a second'],
  [6.8, 9.0, 'hop', 'THRUSTERS', 'jump anything'],
  [9.0, 11.4, 'flip', 'KICKFLIP', 'space + A/D'],
  [11.4, 14.0, 'hover', 'HOVER MODE', 'hold space'],
  [14.0, 17.0, 'ram', 'RAMMING SPEED', 'run them over'],
  [17.0, 19.8, 'sea', 'DRIVES ON WATER', 'why not'],
];
const END_AT = 19.8, TOTAL = 23.8;
const MUSIC = [[0, 0.12], [END_AT - 0.4, 0.12], [END_AT + 0.6, 0.85], [TOTAL - 0.6, 0.85], [TOTAL, 0]];

export async function record() {
  const pc = window.__pc;
  const src = pc.renderer.domElement;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  await document.fonts.load(`40px ${DISPLAY}`).catch(() => {});

  // в ролике игрока не убивают (бот в сцене с числами урона отстреливается); урон — только для сцены аптечки
  Object.assign(pc.settings, { fov: 80, vol: 0.8, music: 0.5 });     // ролик — с настройками по умолчанию
  pc.camera.fov = 80; pc.camera.updateProjectionMatrix();
  const realDamage = pc.combat.takeDamage;
  pc.combat.takeDamage = () => {};
  let locked = true;
  Object.defineProperty(pc.controls, 'isLocked', { get: () => locked, configurable: true });
  for (const id of ['cross', 'pause', 'banner', 'prompt', 'minimap', 'fpv', 'dmgnums', 'carhud']) { const e = document.getElementById(id); if (e) e.hidden = true; }

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
  // секунда раунда «сейчас» = sec (сдвиг часов игры вперёд/назад)
  const setSec = (sec) => { skew += (pc.royale.roundStart + sec * 1000) - Date.now(); };
  const keyDown = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code }));
  const keyUp = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, key: code === 'Space' ? ' ' : code }));

  // ---------- помощники ----------
  const look = (yaw, pitch) => pc.look(yaw, pitch);
  const keys = (...ks) => { pc.keys.clear(); for (const k of ks) pc.keys.add(k); };
  const car = () => pc.roadsters.list[0];
  // открытая вода у берега: машина едет вдоль острова (остров — сбоку в кадре)
  function seaStart(yaw) {
    const c = car();
    if (!pc.myCar) { pc.cut(); pc.tp(c.pos.x + 2, c.pos.z); pc.enterCar(c); }
    setSec(22);                       // до шторма: в море нет фиолетовой стены
    c.pos.set(S.sea.x, 0, S.sea.z); c.yaw = yaw; c.pitch = 0; c.roll = 0;
    Object.assign(pc.carSt, { speed: 0, vy: 0, ground: true, fuel: 2.4, flip: 0, hopCd: 0, spaceWas: false });
  }
  // пляж: идём от моря к центру острова, первая суша высотой 0.5–1.6 м; оттуда же — направление «с моря»
  function beach() {
    for (const ang of [0.2, 0.9, 1.6, 2.3, 3.0, 3.7, 4.4, 5.1, 5.8]) {
      const dx = Math.cos(ang), dz = Math.sin(ang);
      for (let r = 175; r > 40; r -= 1) {
        const x = 160 + dx * r, z = 160 + dz * r, h = ground(x, z);
        if (h < 0.5) continue;
        if (h > 1.6) break;
        if (pc.structures.objects.some((o) => o.hp > 0 && Math.hypot(o.x - x, o.z - z) < 6)) break;
        return { x, z, dx, dz };                    // (dx, dz) — от центра к морю
      }
    }
    return null;
  }
  const awayBots = () => { for (const b of pc.bots.list.values()) if (b !== S.bot) b.pos.set(9999, 0, 9999); };
  S.sea = { x: 30, z: -18 };
  S.beach = beach() || { x: 30, z: 8, dx: 0, dz: -1 };

  const SCENES = {
    reveal: {
      start() { pc.setMood('golden'); awayBots(); seaStart(0.6); S.y0 = 0.6 + 2.6; },
      tick(s) { keys(); look(S.y0 + s * 0.5, -0.1 - s * 0.015); },
    },
    launch: {
      start() { pc.setMood('game'); seaStart(-Math.PI / 2); S.launchT = null; },
      tick(s) {
        keys(...(s > 0.35 ? ['KeyW', 'ShiftLeft'] : []));
        look(car().yaw + 0.25, -0.12);
        if (s > 0.35 && S.launchT === null && pc.carSt.speed >= 27.78) S.launchT = s - 0.35;
      },
    },
    hop: {
      start() { seaStart(-Math.PI / 2); pc.carSt.speed = 38; S.hops = 0; },
      tick(s) {
        const k = ['KeyW']; if ((s > 0.3 && s < 0.36) || (s > 1.3 && s < 1.36)) k.push('Space');
        keys(...k); look(car().yaw + 1.2, -0.18);
      },
    },
    flip: {
      start() { seaStart(-Math.PI / 2); pc.carSt.speed = 36; },
      tick(s) {
        const k = ['KeyW']; if (s > 0.4 && s < 0.46) k.push('Space', 'KeyA'); if (s > 1.6 && s < 1.66) k.push('Space', 'KeyD');
        keys(...k); look(car().yaw - 1.35, -0.12);
      },
    },
    hover: {
      start() { seaStart(-Math.PI / 2); pc.carSt.speed = 22; },
      tick(s) {
        const k = ['KeyW']; if (s > 0.25) k.push('Space');
        keys(...k); look(car().yaw + 2.1 - s * 0.3, -0.05);
      },
    },
    ram: {
      start() {
        pc.setMood('game'); setSec(22);
        const b = [...pc.bots.list.values()][0]; S.bot = b; awayBots();
        const B = S.beach, yaw = Math.atan2(B.dx, B.dz);          // машина едет к острову: вперёд = −(dx, dz)
        const bx = B.x - B.dx * 2, bz = B.z - B.dz * 2;
        Object.assign(b, { riding: false, gliding: false, chute: false, onGround: true, gun: 'ar', hp: 100, alive: true });
        b.pos.set(bx, ground(bx, bz), bz); b.hold = b.pos.clone();
        const c = car(); if (!pc.myCar) pc.enterCar(c);
        const cx = B.x + B.dx * 30, cz = B.z + B.dz * 30;
        c.pos.set(cx, Math.max(0, ground(cx, cz)) - 0.15, cz); c.yaw = yaw; c.pitch = 0; c.roll = 0;
        Object.assign(pc.carSt, { speed: 0, vy: 0, ground: true });
        S.kills = []; S.ks = 0;
      },
      tick(s) {
        const b = S.bot;
        if (b.alive) { b.pos.copy(b.hold); b.target = null; b.victim = null; b.vel?.set(0, 0, 0); }
        else if (!S.kills.length) S.kills.push({ b, t: s, n: 1 });
        S.ks = s;
        keys(...(s > 0.2 && s < 2.0 ? ['KeyW', 'ShiftLeft'] : []));
        look(car().yaw + 0.5, -0.14);
      },
    },
    sea: {
      start() { pc.setMood('golden'); seaStart(-Math.PI / 2); pc.carSt.speed = 50; },
      tick(s) { keys('KeyW', 'ShiftLeft', ...(s > 1.0 && s < 1.6 ? ['KeyA'] : [])); look(car().yaw + 0.9 - s * 0.25, -0.1); },
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
      vignette();
      if (id !== 'reveal') speedo();
      if (id === 'launch' && S.launchT !== null) launchCard(t - a - 0.35 - S.launchT);
      if (id === 'ram') ramOverlay();
      watermark();
      badge(t);
      punch(big, small, t - a, b - t);
      flash(t - a);
    } else { if (cur !== -2) { cur = -2; pc.keys.clear(); } endCard(t - END_AT); }
  }
  // спидометр (DOM в ролик не попадает — рисуем сами)
  function speedo() {
    const kmh = Math.round(Math.abs(pc.carSt.speed) * 3.6), boost = (pc.myCar?.boost || 0) > 0.5;
    g.save(); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.font = `italic 400 92px ${DISPLAY}`; g.lineWidth = 12; g.strokeStyle = 'rgba(20,12,60,.9)'; g.lineJoin = 'round';
    g.strokeText(String(kmh), W - 120, H - 48);
    if (boost) { g.shadowColor = '#40e8ff'; g.shadowBlur = 24; }
    g.fillStyle = boost ? '#8ff3ff' : '#ffffff'; g.fillText(String(kmh), W - 120, H - 48);
    g.shadowBlur = 0; g.font = `800 24px ${SANS}`; g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.fillText('km/h', W - 110, H - 52);
    const f = (pc.carSt.fuel || 0) / 2.4;
    g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.roundRect(W - 330, H - 36, 290, 9, 5); g.fill();
    g.fillStyle = '#40e8ff'; g.beginPath(); g.roundRect(W - 330, H - 36, 290 * f, 9, 5); g.fill();
    g.restore();
  }
  // «0–100 KM/H 0.83 s» — как табло на презентации
  function launchCard(k) {
    if (k < 0) return;
    const pop = Math.min(1, k / 0.16), e = 1 - (1 - pop) ** 3;
    g.save(); g.translate(W / 2, H * 0.36); g.rotate(-0.04); g.scale(1.9 - 0.9 * e, 1.9 - 0.9 * e);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `italic 400 132px ${DISPLAY}`; g.lineWidth = 18; g.strokeStyle = '#0b2b3a'; g.lineJoin = 'round';
    const txt = `${S.launchT.toFixed(2)} s`;
    g.strokeText(txt, 0, 0);
    const gr = g.createLinearGradient(0, -60, 0, 60); gr.addColorStop(0, '#e9ffff'); gr.addColorStop(0.5, '#6ff7ff'); gr.addColorStop(1, '#1aa8d8');
    g.fillStyle = gr; g.fillText(txt, 0, 0);
    g.restore();
  }
  // «ELIMINATED» + иконка машины
  function ramOverlay() {
    const last = S.kills?.[0];
    if (!last) return;
    const k = S.ks - last.t;
    if (k > 1.8) return;
    const pop = Math.min(1, k / 0.15), sc = 1.5 - 0.5 * (1 - (1 - pop) ** 3);
    g.save(); g.globalAlpha = k > 1.5 ? (1.8 - k) / 0.3 : 1; g.translate(W / 2, H * 0.3); g.scale(sc, sc);
    g.font = `400 40px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = `🏎 ELIMINATED ${last.b.name.toUpperCase()}`, w = g.measureText(txt).width + 120;
    const gr = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    gr.addColorStop(0, 'rgba(255,45,61,0)'); gr.addColorStop(0.15, 'rgba(255,45,61,.85)'); gr.addColorStop(0.85, 'rgba(255,45,61,.85)'); gr.addColorStop(1, 'rgba(255,45,61,0)');
    g.fillStyle = gr; g.fillRect(-w / 2, -32, w, 64);
    g.fillStyle = '#fff'; g.fillText(txt, 0, 2);
    g.restore();
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
  // плашка «NEW CAR» справа сверху
  function badge(t) {
    g.save();
    const w = 170, h = 40, x = W - w - 28, y = 22;
    g.fillStyle = '#ffc928'; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill();
    g.fillStyle = '#1b1450'; g.font = `italic 400 24px ${DISPLAY}`; g.textAlign = 'center';
    g.fillText(Math.floor(t * 2) % 2 ? '⚡ NEW CAR' : '🏎 NEW CAR', x + w / 2, y + 29);
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
    g.strokeText('THE ROADSTER', 0, 0);
    g.fillStyle = '#ffc928'; g.fillText('THE ROADSTER', 0, 0);
    g.restore();
    g.textAlign = 'center';
    g.globalAlpha = f(0.6); g.font = `700 26px ${SANS}`; g.fillStyle = '#e8e4ff';
    g.fillText('0–100 in 0.8 s · thrusters · kickflips · drives on water · free in your browser', W / 2, H * 0.55);
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
  const name = 'postroyale-roadster.mp4';
  const res = await fetch(`http://127.0.0.1:8767/upload?name=${name}`, { method: 'POST', body: blob });
  window.__trailer = { done: true, name, size: blob.size, ok: res.ok, aac: useAac, peak: window.__trailer.peak, rawPeak: window.__trailer.rawPeak };
}
