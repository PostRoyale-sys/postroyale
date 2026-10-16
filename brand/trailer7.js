// Ролик «ROADSTER — IT FLIES» (~25 с, со звуком, быстрый монтаж): холодное открытие «THEY SAID 2028», белый Roadster,
// разгон 0–100, колёса складываются в турбины и взлёт, полёт над островом, бочка, бреющий над водой с форсажем,
// таран с неба, кикфлип, вертикальный взлёт; финальная карточка. Склейки — со вспышкой, ударом зума, свистом.
// Открыть: /?w=car7&shot=160,160,40,0,-0.3&rec=1 и в консоли import('./brand/trailer7.js').then((m) => m.record())
// Как trailer6.js: виртуальное время, pc.mainLoop покадрово, H.264 + AAC (WebCodecs + mp4-muxer) → POST на 127.0.0.1:8767.

const W = 1280, H = 720, FPS = 30;
const DISPLAY = '"Lilita One", "Arial Black", sans-serif';
const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';
const URL_TEXT = 'postroyale.xyz';

// [начало, конец, id, крупно, мелко]
const SHOTS = [
  [0.0, 1.5, 'cold', null, null],
  [1.5, 3.4, 'reveal', 'THE ROADSTER', null],
  [3.4, 5.5, 'launch', '0–100', 'in under a second'],
  [5.5, 7.6, 'fold', 'WHEELS → JETS', null],
  [7.6, 10.4, 'fly', 'IT FLIES', null],
  [10.4, 12.2, 'roll', 'BARREL ROLL', null],
  [12.2, 14.4, 'skim', 'AFTERBURNER', null],
  [14.4, 17.0, 'bomb', 'DEATH FROM ABOVE', null],
  [17.0, 18.8, 'flip', 'KICKFLIP', null],
  [18.8, 21.0, 'climb', 'NO RUNWAY NEEDED', null],
];
const END_AT = 21.0, TOTAL = 25.0;
const MUSIC = [[0, 0.0], [1.3, 0.0], [1.5, 0.6], [END_AT, 0.6], [END_AT + 0.4, 0.9], [TOTAL - 0.5, 0.9], [TOTAL, 0]];

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
  for (const id of ['cross', 'pause', 'banner', 'prompt', 'minimap', 'fpv', 'dmgnums', 'carhud', 'killfeed']) { const e = document.getElementById(id); if (e) e.hidden = true; }

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
  const st = () => pc.carSt;
  const awayBots = () => { for (const b of pc.bots.list.values()) if (b !== S.bot) b.pos.set(9999, 0, 9999); };
  // посадить в машину и поставить её: x, y, z, курс; fly — сразу в полёте (колёса уже турбины)
  function put(x, y, z, yaw, fly = false, speed = 0) {
    const c = car();
    if (!pc.myCar) { pc.cut(); pc.tp(c.pos.x + 2, c.pos.z); pc.enterCar(c); }
    setSec(22);
    c.pos.set(x, y, z); c.yaw = yaw; c.pitch = 0; c.roll = 0; c.fold = fly ? 1 : 0; c.jet = fly ? 0.5 : 0;
    Object.assign(st(), { speed, vy: 0, ground: !fly, fuel: 15, flip: 0, hopCd: 0, fly, spaceWas: false, fWas: false });
  }
  // пляж: от центра острова к морю, первая суша высотой 0.5–1.6 м
  function beach() {
    for (const ang of [0.2, 0.9, 1.6, 2.3, 3.0, 3.7, 4.4, 5.1, 5.8]) {
      const dx = Math.cos(ang), dz = Math.sin(ang);
      for (let r = 175; r > 40; r -= 1) {
        const x = 160 + dx * r, z = 160 + dz * r, h = ground(x, z);
        if (h < 0.5) continue;
        if (h > 1.6) break;
        if (pc.structures.objects.some((o) => o.hp > 0 && Math.hypot(o.x - x, o.z - z) < 6)) break;
        return { x, z, dx, dz };
      }
    }
    return { x: 30, z: 8, dx: 0, dz: -1 };
  }
  // держать высоту h над рельефом впереди (Space — вверх, Alt — вниз)
  function holdAlt(h, extra = []) {
    const c = car(), f = V(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    let top = Math.max(ground(c.pos.x, c.pos.z), 0);
    for (const d of [8, 16, 24, 32]) top = Math.max(top, ground(c.pos.x + f.x * d, c.pos.z + f.z * d));
    const want = top + h, k = [...extra];
    if (c.pos.y < want - 1) k.push('Space'); else if (c.pos.y > want + 1.5) k.push('AltLeft');
    keys(...k);
  }
  const yawTo = (x, z) => { const c = car(); return Math.atan2(-(x - c.pos.x), -(z - c.pos.z)); };
  S.beach = beach();
  const sea = { x: 30, z: -18 };

  const SCENES = {
    cold: { start() { pc.setMood('golden'); awayBots(); put(sea.x, -0.15, sea.z, 0.6); S.hit = false; }, tick(s) { keys(); look(car().yaw + 2.6, -0.1); if (!S.hit && s > 0.15) { S.hit = true; pc.audio.play('thunder', null, { vol: 0.9 }); } } },
    reveal: {
      start() { pc.setMood('golden'); put(sea.x, -0.15, sea.z, 0.6); S.y0 = 0.6 + 2.6; },
      tick(s) { keys(); look(S.y0 + s * 1.1, -0.06 - s * 0.03); },
    },
    launch: {
      start() { pc.setMood('game'); put(sea.x, -0.15, sea.z, -Math.PI / 2); S.launchT = null; },
      tick(s) {
        keys(...(s > 0.25 ? ['KeyW', 'ShiftLeft'] : []));
        look(car().yaw + 0.3 - s * 0.1, -0.1);
        if (s > 0.25 && S.launchT === null && st().speed >= 27.78) S.launchT = s - 0.25;
      },
    },
    fold: {
      start() { pc.setMood('golden'); put(sea.x + 40, -0.15, sea.z, -Math.PI / 2, false, 6); },
      tick(s) {
        const k = [];
        if (s > 0.35 && s < 0.4) k.push('KeyF');
        if (s > 0.6) k.push('Space');
        if (s > 1.3) k.push('KeyW');
        keys(...k); look(car().yaw + 1.45 - s * 0.25, -0.05 - s * 0.05);
      },
    },
    fly: {
      start() {
        pc.setMood('game');
        // с моря через центр острова на высоте ~16 м над рельефом
        const B = S.beach, x = 160 + B.dx * 150, z = 160 + B.dz * 150;
        put(x, 22, z, Math.atan2(B.dx, B.dz), true, 60);
      },
      tick(s) { holdAlt(16, ['KeyW', 'ShiftLeft']); look(car().yaw + 0.35 + Math.sin(s * 1.5) * 0.15, -0.22); },
    },
    roll: {
      start() { put(sea.x, 18, sea.z + 30, -Math.PI / 2, true, 50); },
      tick(s) {
        const k = ['KeyW'];
        if (s > 0.3 && s < 0.36) k.push('Space', 'KeyA');
        if (s > 1.1 && s < 1.16) k.push('Space', 'KeyD');
        keys(...k); look(car().yaw - 1.2, -0.08);
      },
    },
    skim: {
      start() { pc.setMood('golden'); put(sea.x - 20, 1.6, sea.z - 10, -Math.PI / 2, true, 70); },
      tick(s) { const c = car(); keys('KeyW', 'ShiftLeft', ...(c.pos.y > 1.8 ? ['AltLeft'] : c.pos.y < 1.2 ? ['Space'] : [])); look(c.yaw + 0.25, -0.06); },
    },
    bomb: {
      start() {
        pc.setMood('game');
        const b = [...pc.bots.list.values()][0]; S.bot = b; awayBots();
        const B = S.beach, bx = B.x - B.dx * 2, bz = B.z - B.dz * 2;
        Object.assign(b, { riding: false, gliding: false, chute: false, onGround: true, gun: 'ar', hp: 100, alive: true });
        b.pos.set(bx, ground(bx, bz), bz); b.hold = b.pos.clone();
        put(B.x + B.dx * 45, 26, B.z + B.dz * 45, Math.atan2(B.dx, B.dz), true, 40);
        S.kills = []; S.ks = 0;
      },
      tick(s) {
        const b = S.bot, c = car();
        if (b.alive) { b.pos.copy(b.hold); b.target = null; b.victim = null; b.vel?.set(0, 0, 0); }
        else if (!S.kills.length) S.kills.push({ b, t: s, n: 1 });
        S.ks = s;
        if (b.alive) {
          c.yaw = yawTo(b.pos.x, b.pos.z);
          const d = Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z), want = b.pos.y + 0.4 + d * 0.55;
          keys('KeyW', ...(c.pos.y > want ? ['AltLeft'] : []));
        } else keys('KeyW', 'Space');
        look(c.yaw + 0.45, -0.3);
      },
    },
    flip: {
      start() { pc.setMood('golden'); put(sea.x, -0.15, sea.z + 15, -Math.PI / 2, false, 36); },
      tick(s) {
        const k = ['KeyW'];
        if (s > 0.25 && s < 0.31) k.push('Space', 'KeyA');
        keys(...k); look(car().yaw - 1.35, -0.1);
      },
    },
    climb: {
      start() { pc.setMood('golden'); const B = S.beach; put(160 + B.dx * 115, 6, 160 + B.dz * 115, Math.atan2(B.dx, B.dz), true, 10); },
      tick(s) { keys('Space', 'KeyW'); look(car().yaw + 0.5 + s * 0.4, 0.15 - s * 0.32); },
    },
  };

  // ---------- кадр ----------
  let cur = -1, cutAt = 0;
  const shotAt = (t) => SHOTS.findIndex(([a, b]) => t >= a && t < b);
  function frame() {
    const t = T();
    if (t >= TOTAL) return finish();
    if (t < END_AT) {
      const i = shotAt(t);
      const [a, b, id, big, small] = SHOTS[i];
      if (i !== cur) {
        cur = i; cutAt = t; pc.keys.clear(); SCENES[id].start();
        if (i > 1) pc.audio.play('boost', null, { vol: 0.7 });          // свист на склейке
      }
      SCENES[id].tick(t - a);
      if (id === 'cold') { coldOpen(t - a); return; }
      // удар зума на склейке + медленный наезд + тряска от скорости
      const since = t - cutAt, punchZ = since < 0.25 ? 0.12 * (1 - since / 0.25) ** 2 : 0;
      const sp = Math.abs(st().speed), shake = Math.min(1, sp / 60) * 3 + (since < 0.2 ? 6 * (1 - since / 0.2) : 0);
      const z = 1 + ((t - a) / (b - a)) * 0.06 + punchZ;
      const sw = src.width, sh = src.height, k = Math.max(W / sw, H / sh) * z;
      const dw = sw * k, dh = sh * k;
      const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
      g.drawImage(src, (W - dw) / 2 + jx, (H - dh) / 2 + jy, dw, dh);
      if (sp > 35) speedLines(Math.min(1, (sp - 35) / 35));
      vignette();
      bars();
      speedo();
      if (id === 'launch' && S.launchT !== null) launchCard(t - a - 0.25 - S.launchT);
      if (id === 'bomb') ramOverlay();
      watermark();
      if (big) slam(big, small, t - a, b - t);
      flash(since);
    } else { if (cur !== -2) { cur = -2; pc.keys.clear(); pc.audio.play('jetOn', null, { vol: 0.8 }); } endCard(t - END_AT); }
  }
  // холодное открытие: чёрный экран, «THEY SAID 2028.» — удар, потом «WE SAID:»
  function coldOpen(s) {
    g.fillStyle = '#05040c'; g.fillRect(0, 0, W, H);
    const txt = s < 0.9 ? 'THEY SAID 2028.' : 'WE SAID: TODAY.';
    const k = s < 0.9 ? s : s - 0.9, e = 1 - (1 - Math.min(1, k / 0.12)) ** 3;
    const sh = k < 0.2 ? (1 - k / 0.2) * 10 : 0;
    g.save(); g.translate(W / 2 + (Math.random() - 0.5) * sh, H / 2 + (Math.random() - 0.5) * sh); g.scale(1.6 - 0.6 * e, 1.6 - 0.6 * e);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `italic 400 110px ${DISPLAY}`;
    g.fillStyle = s < 0.9 ? '#ffffff' : '#ffc928'; g.fillText(txt, 0, 0);
    g.restore();
    if (k < 0.08) { g.fillStyle = `rgba(255,255,255,${0.5 * (1 - k / 0.08)})`; g.fillRect(0, 0, W, H); }
  }
  // кинорамки сверху и снизу
  function bars() { g.fillStyle = '#000'; g.fillRect(0, 0, W, 46); g.fillRect(0, H - 46, W, 46); }
  // полосы скорости от центра к краям
  function speedLines(a) {
    g.save(); g.translate(W / 2, H / 2); g.strokeStyle = `rgba(255,255,255,${0.35 * a})`; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * Math.PI * 2, r0 = 260 + Math.random() * 220, len = 80 + Math.random() * 200 * a;
      g.lineWidth = 1 + Math.random() * 2.5;
      g.beginPath(); g.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0 * 0.6); g.lineTo(Math.cos(ang) * (r0 + len), Math.sin(ang) * (r0 + len) * 0.6); g.stroke();
    }
    g.restore();
  }
  // заголовок сцены: влетает крупно с наклоном, дрожит, уходит
  function slam(big, small, since, until) {
    const pin = Math.min(1, since / 0.12), e = 1 - (1 - pin) ** 4;
    const out = Math.min(1, until / 0.15);
    g.save();
    g.globalAlpha = Math.max(0, out);
    const jit = since < 0.25 ? (1 - since / 0.25) * 4 : 0;
    g.translate(W / 2 + (Math.random() - 0.5) * jit, H - 150 + (Math.random() - 0.5) * jit);
    g.rotate((-4 * Math.PI) / 180);
    const sc = 2.4 - 1.4 * e;
    g.scale(sc, sc);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `italic 400 92px ${DISPLAY}`;
    g.lineWidth = 15; g.strokeStyle = 'rgba(8,10,30,.95)'; g.lineJoin = 'round';
    g.strokeText(big, 0, 0);
    const gr = g.createLinearGradient(0, -70, 0, 10); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#bff8ff');
    g.fillStyle = gr; g.fillText(big, 0, 0);
    if (small && since > 0.15) {
      g.font = `800 28px ${SANS}`; g.lineWidth = 7; g.strokeText(small, 0, 44);
      g.fillStyle = '#7ff3ff'; g.fillText(small, 0, 44);
    }
    g.restore();
  }
  // спидометр и высота
  function speedo() {
    const kmh = Math.round(Math.abs(st().speed) * 3.6), fly = st().fly, c = car();
    const alt = Math.max(0, Math.round(c.pos.y - Math.max(ground(c.pos.x, c.pos.z), 0)));
    g.save(); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.font = `italic 400 84px ${DISPLAY}`; g.lineWidth = 12; g.strokeStyle = 'rgba(8,10,30,.9)'; g.lineJoin = 'round';
    g.strokeText(String(kmh), W - 120, H - 66);
    g.shadowColor = '#40e8ff'; g.shadowBlur = c.boost > 0.5 || fly ? 22 : 0;
    g.fillStyle = c.boost > 0.5 ? '#8ff3ff' : '#ffffff'; g.fillText(String(kmh), W - 120, H - 66);
    g.shadowBlur = 0; g.font = `800 22px ${SANS}`; g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.fillText('km/h', W - 112, H - 70);
    if (fly) { g.textAlign = 'right'; g.font = `800 20px ${SANS}`; g.fillStyle = '#7ff3ff'; g.fillText(`✈ ALT ${alt} m`, W - 40, H - 140); }
    g.restore();
  }
  function launchCard(k) {
    if (k < 0) return;
    const pop = Math.min(1, k / 0.14), e = 1 - (1 - pop) ** 3;
    g.save(); g.translate(W / 2, H * 0.36); g.rotate(-0.05); g.scale(2.1 - 1.1 * e, 2.1 - 1.1 * e);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `italic 400 140px ${DISPLAY}`; g.lineWidth = 18; g.strokeStyle = '#0b2b3a'; g.lineJoin = 'round';
    const txt = `${S.launchT.toFixed(2)} s`;
    g.strokeText(txt, 0, 0);
    const gr = g.createLinearGradient(0, -60, 0, 60); gr.addColorStop(0, '#e9ffff'); gr.addColorStop(0.5, '#6ff7ff'); gr.addColorStop(1, '#1aa8d8');
    g.fillStyle = gr; g.fillText(txt, 0, 0);
    g.restore();
    if (k < 0.1) { g.fillStyle = `rgba(160,250,255,${0.4 * (1 - k / 0.1)})`; g.fillRect(0, 0, W, H); }
  }
  function ramOverlay() {
    const last = S.kills?.[0];
    if (!last) return;
    const k = S.ks - last.t;
    if (k > 1.6) return;
    const pop = Math.min(1, k / 0.12), sc = 1.7 - 0.7 * (1 - (1 - pop) ** 3);
    g.save(); g.globalAlpha = k > 1.3 ? (1.6 - k) / 0.3 : 1; g.translate(W / 2, H * 0.28); g.scale(sc, sc);
    g.font = `400 42px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = `ELIMINATED ${last.b.name.toUpperCase()}`, w = g.measureText(txt).width + 120;
    const gr = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    gr.addColorStop(0, 'rgba(255,45,61,0)'); gr.addColorStop(0.15, 'rgba(255,45,61,.9)'); gr.addColorStop(0.85, 'rgba(255,45,61,.9)'); gr.addColorStop(1, 'rgba(255,45,61,0)');
    g.fillStyle = gr; g.fillRect(-w / 2, -32, w, 64);
    g.fillStyle = '#fff'; g.fillText(txt, 0, 2);
    g.restore();
    if (k < 0.12) { g.fillStyle = `rgba(255,255,255,${0.6 * (1 - k / 0.12)})`; g.fillRect(0, 0, W, H); }
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
  function watermark() { g.globalAlpha = 0.9; logo(30, 86, 26); g.globalAlpha = 1; }
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
    g.strokeText('IT FLIES.', 0, 0);
    g.fillStyle = '#ffc928'; g.fillText('IT FLIES.', 0, 0);
    g.restore();
    g.textAlign = 'center';
    g.globalAlpha = f(0.6); g.font = `700 26px ${SANS}`; g.fillStyle = '#e8e4ff';
    g.fillText('The Roadster · 0–100 in 0.8 s · wheels turn into jets · free in your browser', W / 2, H * 0.55);
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
  const name = 'postroyale-roadster-flies.mp4';
  const res = await fetch(`http://127.0.0.1:8767/upload?name=${name}`, { method: 'POST', body: blob });
  window.__trailer = { done: true, name, size: blob.size, ok: res.ok, aac: useAac, peak: window.__trailer.peak, rawPeak: window.__trailer.rawPeak };
}
