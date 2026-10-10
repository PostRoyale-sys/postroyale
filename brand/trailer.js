// Промо-ролик PostRoyale для X: снимается прямо из игры.
// Открыть: /?w=trailer1&shot=160,160,40,0,-0.3&rec=1 (режим съёмки + буфер кадра), затем в консоли:
//   import('./brand/trailer.js').then((m) => m.record())
// Сцены: вертолёт над островом → прыжок, свободное падение, парашют → бой и взрыв машины → финальная карточка.
// Рендер покадровый: время игры (performance.now, Date.now, requestAnimationFrame) подменяется виртуальным и
// двигается ровно на 1/30 с за кадр — ролик плавный, даже если вкладка в фоне и браузер рисует 1 кадр в секунду.
// Каждый кадр игры копируется в холст 1280×720 с подписями поверх и кодируется WebCodecs (H.264) в MP4
// (mp4-muxer), готовый файл уходит на локальный приёмник 127.0.0.1:8767 → brand/video/.

const W = 1280, H = 720, FPS = 30;
const DISPLAY = '"Lilita One", "Arial Black", sans-serif';
const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';

// Подписи: [начало, конец, крупно, мелко]
const CAPTIONS = [
  [0.4, 4.6, 'THE BATTLE ROYALE', 'that lives inside a post'],
  [5.0, 8.8, 'DROP IN', 'from the chopper — jump whenever you want'],
  [9.2, 15.4, 'FREE-FALL', 'pop the parachute, pick your landing'],
  [16.0, 22.4, 'LOOT · BUILD', 'and blow things up'],
];
const END_AT = 23.2, TOTAL = 28;

// end: 'soon' — карточка «SEASON 1 · SOON»; 'play' — «PLAY FREE» и адрес игры (GitHub Pages).
export async function record({ end = 'soon' } = {}) {
  const pc = window.__pc;
  const src = pc.renderer.domElement;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  await document.fonts.load(`40px ${DISPLAY}`).catch(() => {});

  // управление «как будто мышь захвачена»: шаги физики и вид от третьего лица в полёте работают
  Object.defineProperty(pc.controls, 'isLocked', { get: () => true, configurable: true });
  for (const id of ['cross', 'pause', 'banner', 'prompt', 'minimap']) { const e = document.getElementById(id); if (e) e.hidden = true; }

  // ---------- виртуальное время ----------
  const realPerf = performance.now.bind(performance), realDate = Date.now;
  let vt = realPerf();
  const dateBase = realDate() - vt;
  performance.now = () => vt;
  Date.now = () => Math.round(dateBase + vt);
  pc.renderer.setAnimationLoop(null);                 // кадры игры теперь вызываем сами (pc.mainLoop)

  // ---------- кодирование ----------
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 9e6, framerate: FPS });
  const mime = 'video/mp4';
  window.__trailer = { done: false, frame: 0 };

  const t0 = vt;
  const T = () => (vt - t0) / 1000;
  const state = { jumped: false, chute: false, ground: false, shots: 0, nextShot: 0, car: null };

  pc.ride();                                            // вертолёт с начала маршрута
  pc.look(0, -0.32);

  // ---------- режиссура: что происходит в момент t ----------
  function direct(t, dt) {
    if (t < 9) {
      // облёт вертолёта: камера медленно кружит, взгляд чуть сверху
      const yaw0 = Math.atan2(-pc.flightDir().x, -pc.flightDir().z);
      pc.look(yaw0 + 0.5 - t * 0.17, -0.3 - Math.sin(t * 0.4) * 0.06);
    } else if (!state.jumped) {
      state.jumped = true;
      pc.jump(true);
      pc.look(pc.camYaw(), -0.55);
    } else if (t < 15.6) {
      if (!state.chute && t > 11.4) { state.chute = true; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); }
      pc.look(pc.camYaw() + dt * 0.25, state.chute ? -0.42 : -0.6);
    } else if (!state.ground) {
      // на земле у машины, с автоматом
      state.ground = true;
      // машина ближе к центру зоны, а точка в 14 м от неё — на открытом месте с прямой видимостью (взрыв не достанет)
      const cz = pc.royale.center, cars = pc.structures.objects.filter((o) => o.type === 'car' && o.hp > 0)
        .sort((p, q) => Math.hypot(p.x - cz.x, p.z - cz.z) - Math.hypot(q.x - cz.x, q.z - cz.z));
      let spot = null;
      for (const c of cars) {
        for (let k = 0; k < 16 && !spot; k++) {
          const a = (k / 16) * Math.PI * 2, x = c.x + Math.cos(a) * 11, z = c.z + Math.sin(a) * 11;
          if (pc.world.height(x, z) < 1.5 || pc.structures.blocked(x, pc.world.height(x, z) + 0.1, z)) continue;
          const from = { x, y: pc.world.height(x, z) + 1.6, z };
          const d = Math.hypot(c.x - x, c.z - z);
          const dir = pc.vec(c.x - x, (c.y ?? pc.world.height(c.x, c.z)) + 0.7 - from.y, c.z - z).normalize();
          const hit = pc.structures.raycast(pc.vec(from.x, from.y, from.z), dir, d + 2);
          if (hit?.e?.k === c.k) spot = { x, z, c };
        }
        if (spot) break;
      }
      state.car = spot ? spot.c : cars[0];
      const c = state.car;
      if (spot) pc.tp(spot.x, spot.z); else pc.tp(c.x + 11, c.z);
      for (const b of pc.bots.list.values()) b.pos.set(9999, 0, 9999);     // боты не мешают сцене
      for (const it of [{ k: 'weapon', w: 'ar', r: 3 }, { k: 'ammo', w: 'medium', a: 120 }]) pc.combat.give(it);
      pc.pick(1);
      pc.debugView = true;
      aimAt(c);
      state.nextShot = t + 2.2;
    } else if (t < END_AT) {
      aimAt(state.car);
      if (t > state.nextShot && pc.structures.has(state.car.k) && state.shots < 12) {
        pc.combat.fire(0, performance.now() / 1000);
        state.shots++;
        state.nextShot = t + 0.16;
      }
    }
  }
  function aimAt(c) {
    const f = pc.feet, eye = f.y + pc.eyeH;
    const dx = c.x - f.x, dz = c.z - f.z, d = Math.hypot(dx, dz);
    pc.look(Math.atan2(-dx, -dz), Math.atan2((c.y ?? pc.world.height(c.x, c.z)) + 0.7 - eye, d));
  }

  // ---------- кадр: игра + подписи ----------
  function frame(dt) {
    const t = T();
    if (t >= TOTAL) return finish();
    if (t < END_AT) {
      direct(t, dt);
      // игра — «cover» в 16:9
      const sw = src.width, sh = src.height, k = Math.max(W / sw, H / sh);
      const dw = sw * k, dh = sh * k;
      g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      vignette();
      watermark();
      for (const [a, b, big, small] of CAPTIONS) if (t >= a && t <= b) caption(big, small, t - a, b - t);
      if (t > END_AT - 0.5) { g.fillStyle = `rgba(14,8,40,${(t - (END_AT - 0.5)) / 0.5})`; g.fillRect(0, 0, W, H); }
    } else endCard(t - END_AT);
  }

  function vignette() {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,6,30,0.45)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
  function logo(x, y, size, align = 'left') {
    g.font = `italic 400 ${size}px ${DISPLAY}`;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const w1 = g.measureText('POST').width, w2 = g.measureText('ROYALE').width;
    let x0 = align === 'center' ? x - (w1 + w2) / 2 : x;
    g.lineWidth = size * 0.12; g.strokeStyle = 'rgba(20,12,60,.9)'; g.lineJoin = 'round';
    g.strokeText('POST', x0, y); g.strokeText('ROYALE', x0 + w1, y);
    g.fillStyle = '#ffffff'; g.fillText('POST', x0, y);
    g.fillStyle = '#ffc928'; g.fillText('ROYALE', x0 + w1, y);
  }
  function watermark() { g.globalAlpha = 0.9; logo(34, 58, 30); g.globalAlpha = 1; }
  function caption(big, small, since, until) {
    const a = Math.min(1, since / 0.35, until / 0.35);
    const slide = (1 - Math.min(1, since / 0.35)) * 30;
    g.save();
    g.globalAlpha = Math.max(0, a);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `italic 400 76px ${DISPLAY}`;
    g.lineWidth = 10; g.strokeStyle = 'rgba(20,12,60,.92)'; g.lineJoin = 'round';
    g.strokeText(big, 52 - slide, H - 104);
    g.fillStyle = '#fff'; g.fillText(big, 52 - slide, H - 104);
    g.font = `700 30px ${SANS}`;
    g.lineWidth = 6; g.strokeText(small, 56 - slide, H - 58);
    g.fillStyle = '#ffd84a'; g.fillText(small, 56 - slide, H - 58);
    g.restore();
  }
  function endCard(s) {
    const bg = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H / 2, W * 0.75);
    bg.addColorStop(0, '#5b3dff'); bg.addColorStop(0.55, '#2a1880'); bg.addColorStop(1, '#0e0828');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const pop = Math.min(1, s / 0.45), e = 1 - (1 - pop) ** 3;
    g.save();
    g.translate(W / 2, H * 0.44); g.scale(0.85 + 0.15 * e, 0.85 + 0.15 * e); g.translate(-W / 2, -H * 0.44);
    g.globalAlpha = e;
    logo(W / 2, H * 0.44, 132, 'center');
    g.restore();
    const f = (d) => Math.max(0, Math.min(1, (s - d) / 0.4));
    g.textAlign = 'center';
    g.globalAlpha = f(0.5); g.font = `700 34px ${SANS}`; g.fillStyle = '#e8e4ff';
    g.fillText('The battle royale that lives inside a post', W / 2, H * 0.44 + 70);
    g.globalAlpha = f(0.9); g.font = `600 26px ${SANS}`; g.fillStyle = '#b9b0ff';
    g.fillText('No install · play in your browser · P2P multiplayer', W / 2, H * 0.44 + 116);
    g.globalAlpha = f(1.3);
    const bw = 360, bh = 64, bx = W / 2 - bw / 2, by = H * 0.44 + 150;
    g.fillStyle = '#ffc928'; g.beginPath(); g.roundRect(bx, by, bw, bh, 16); g.fill();
    g.fillStyle = '#1b1450'; g.font = `italic 400 34px ${DISPLAY}`; g.fillText(end === 'play' ? '▶ PLAY FREE NOW' : 'SEASON 1 · SOON', W / 2, by + 44);
    if (end === 'play') {
      g.globalAlpha = f(1.7); g.font = `700 24px ${SANS}`; g.fillStyle = '#ffffff';
      g.fillText('postroyale-sys.github.io/postroyale', W / 2, by + bh + 46);
    }
    g.globalAlpha = 1;
  }

  // ---------- покадровый прогон ----------
  let done = false;
  const yieldTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  window.__frameHook = (dt) => frame(dt);
  for (let i = 0; !done; i++) {
    vt += 1000 / FPS;
    pc.mainLoop(vt);                                    // кадр игры → __frameHook рисует композицию в out
    if (done) break;
    const vf = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    window.__trailer.frame = i;
    while (enc.encodeQueueSize > 4) await yieldTask();
    if (encErr) throw encErr;
    if (i % 5 === 0) await yieldTask();
  }

  async function finish() {
    if (done) return;
    done = true;
  }
  window.__frameHook = null;
  await enc.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: mime });
  // время и кадры — обратно настоящие
  performance.now = realPerf; Date.now = realDate;
  pc.renderer.setAnimationLoop(pc.mainLoop);
  const name = end === 'play' ? 'postroyale-teaser-play.mp4' : 'postroyale-teaser.mp4';
  const res = await fetch(`http://127.0.0.1:8767/upload?name=${name}`, { method: 'POST', body: blob });
  window.__trailer = { done: true, name, size: blob.size, ok: res.ok };
}
