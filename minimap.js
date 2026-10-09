// Миникарта (правый верхний угол) и большая карта (M).
// Подложка рисуется один раз на мир: вода по глубине, песок, трава по высоте, дороги, дома (детали построек),
// деревья и камни точками. Поверх — шторм: текущий круг (фиолетовый) и следующий безопасный (белый),
// ты — стрелка по направлению взгляда, маршрут вертолёта и зона прыжка, пока летишь. Врагов на карте нет.
// Миникарта — север вверху, вокруг тебя VIEW м; большая — весь остров с названиями городов и сеткой A–H / 1–8.

import { MAP, G } from './map.js';

const PX = 2;                 // пикселей подложки на метр
const VIEW = 70;              // радиус миникарты, м
const MINI = 176;             // размер миникарты, px (CSS)

export function createMinimap(ctx) {
  const base = document.createElement('canvas');
  base.width = base.height = MAP * PX;
  const mini = document.getElementById('minimap');
  const big = document.getElementById('bigmap');
  const bigCv = big.querySelector('canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  mini.width = mini.height = MINI * dpr;
  let open = false, worldKey = null, acc = 0;

  // ---------- Подложка острова ----------
  function build(world) {
    const g = base.getContext('2d');
    const img = g.createImageData(base.width, base.height);
    const d = img.data;
    for (let py = 0; py < base.height; py++) {
      for (let px = 0; px < base.width; px++) {
        const x = (px + 0.5) / PX, z = (py + 0.5) / PX, h = world.height(x, z);
        let r, gg, b;
        if (h < 0) { const k = Math.max(0, Math.min(1, -h / 8)); r = 70 - 40 * k; gg = 170 - 70 * k; b = 230 - 50 * k; }
        else if (h < 1.3) { r = 238; gg = 214; b = 150; }
        else { const k = Math.min(1, (h - 1.3) / 22); r = 110 - 40 * k; gg = 196 - 50 * k; b = 72 - 20 * k; }
        const i = (py * base.width + px) * 4;
        d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // дороги
    g.strokeStyle = 'rgba(214,190,140,.95)';
    g.lineWidth = 3.2 * PX;
    g.lineCap = 'round';
    for (const [a, b] of world.roads || []) { g.beginPath(); g.moveTo(a.x * PX, a.z * PX); g.lineTo(b.x * PX, b.z * PX); g.stroke(); }
    // деревья и камни
    for (const o of world.objects || []) {
      g.fillStyle = o.kind === 'rock' ? 'rgba(150,150,160,.9)' : o.kind === 'car' ? '#e6463f' : 'rgba(40,110,40,.85)';
      g.beginPath(); g.arc(o.x * PX, o.z * PX, (o.kind === 'car' ? 1.2 : 1.6) * PX, 0, 7); g.fill();
    }
    // дома: клетки сетки построек, где есть стены/пол
    const cells = new Set();
    for (const p of world.pieces || []) cells.add(`${p.ix},${p.iz}`);
    g.fillStyle = 'rgba(120,108,100,.95)';
    for (const c of cells) { const [ix, iz] = c.split(',').map(Number); g.fillRect(ix * G * PX, iz * G * PX, G * PX, G * PX); }
    g.strokeStyle = 'rgba(60,50,45,.6)'; g.lineWidth = 1;
    for (const c of cells) { const [ix, iz] = c.split(',').map(Number); g.strokeRect(ix * G * PX + 0.5, iz * G * PX + 0.5, G * PX - 1, G * PX - 1); }
  }

  // ---------- Оверлей: шторм, маршрут, игрок ----------
  // tr: мировые метры → пиксели холста; k — пикселей на метр
  function overlay(g, tr, k, s) {
    const rs = ctx.royale(), c = rs.center, st = rs.stormNow?.();
    if (st) {
      const [cx, cy] = tr(c.x, c.z);
      // затемнение снаружи текущего круга
      g.save();
      g.beginPath(); g.rect(-10, -10, g.canvas.width + 20, g.canvas.height + 20); g.arc(cx, cy, st.r * k, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(110,40,200,.28)'; g.fill();
      g.restore();
      g.lineWidth = 2.2 * s; g.strokeStyle = '#b06bff';
      g.beginPath(); g.arc(cx, cy, st.r * k, 0, 7); g.stroke();
      const safe = rs.safeRadius();
      if (safe < st.r - 0.5) { g.setLineDash([6 * s, 5 * s]); g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, safe * k, 0, 7); g.stroke(); g.setLineDash([]); }
    }
    // маршрут вертолёта и зона прыжка
    const fl = ctx.flight?.();
    if (fl) {
      const a = fl.a, dir = fl.dir;
      const p0 = tr(a.x, a.z), p1 = tr(a.x + dir.x * fl.len, a.z + dir.z * fl.len);
      const j0 = tr(a.x + dir.x * fl.w0, a.z + dir.z * fl.w0), j1 = tr(a.x + dir.x * fl.w1, a.z + dir.z * fl.w1);
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2 * s; g.setLineDash([4 * s, 4 * s]);
      g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#ffd21a'; g.lineWidth = 4 * s;
      g.beginPath(); g.moveTo(...j0); g.lineTo(...j1); g.stroke();
      const h = ctx.heliPos?.();
      if (h) { const [hx, hy] = tr(h.x, h.z); g.fillStyle = '#ffd21a'; g.beginPath(); g.arc(hx, hy, 5 * s, 0, 7); g.fill(); g.strokeStyle = '#2a1a00'; g.lineWidth = 1.5 * s; g.stroke(); }
    }
    // ты — стрелка
    const f = ctx.feet(), yaw = ctx.yaw();
    const [px, py] = tr(f.x, f.z);
    g.save();
    g.translate(px, py);
    g.rotate(-yaw);                        // yaw 0 = взгляд на −Z = вверх карты
    g.beginPath(); g.moveTo(0, -9 * s); g.lineTo(6.5 * s, 7 * s); g.lineTo(0, 3.5 * s); g.lineTo(-6.5 * s, 7 * s); g.closePath();
    g.fillStyle = '#ffd21a'; g.fill(); g.lineWidth = 1.6 * s; g.strokeStyle = '#1b1450'; g.stroke();
    g.restore();
  }

  function drawMini() {
    const g = mini.getContext('2d'), W = mini.width, k = (W / 2) / VIEW;      // пикселей на метр
    const f = ctx.feet();
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 1, 0, 7); g.clip();
    g.fillStyle = '#2c6fb0'; g.fillRect(0, 0, W, W);
    // кусок подложки вокруг игрока
    const sx = (f.x - VIEW) * PX, sz = (f.z - VIEW) * PX;
    g.imageSmoothingEnabled = true;
    g.drawImage(base, sx, sz, VIEW * 2 * PX, VIEW * 2 * PX, 0, 0, W, W);
    const tr = (x, z) => [W / 2 + (x - f.x) * k, W / 2 + (z - f.z) * k];
    overlay(g, tr, k, dpr);
    g.restore();
    // рамка и «N»
    g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(255,255,255,.85)';
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2 * dpr, 0, 7); g.stroke();
    g.font = `800 ${11 * dpr}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#1b1450'; g.beginPath(); g.arc(W / 2, 9 * dpr, 8 * dpr, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.fillText('N', W / 2, 9.5 * dpr);
  }

  function drawBig() {
    const css = Math.min(innerWidth, innerHeight) * 0.86;
    const W = Math.round(css * dpr);
    if (bigCv.width !== W) { bigCv.width = bigCv.height = W; bigCv.style.width = bigCv.style.height = `${css}px`; }
    const g = bigCv.getContext('2d'), k = W / MAP, s = dpr * Math.max(1, css / 700);
    g.fillStyle = '#2c6fb0'; g.fillRect(0, 0, W, W);
    g.imageSmoothingEnabled = true;
    g.drawImage(base, 0, 0, W, W);
    // сетка A–H / 1–8
    const N = 8, cell = W / N;
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
    g.font = `800 ${12 * s}px Inter, sans-serif`; g.fillStyle = 'rgba(255,255,255,.7)'; g.textBaseline = 'top';
    for (let i = 0; i < N; i++) {
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, W); g.moveTo(0, i * cell); g.lineTo(W, i * cell); g.stroke();
      g.textAlign = 'left'; g.fillText('ABCDEFGH'[i], i * cell + 5 * s, 5 * s);
      if (i) g.fillText(String(i + 1), 5 * s, i * cell + 5 * s);
    }
    const tr = (x, z) => [x * k, z * k];
    overlay(g, tr, k, s * 1.3);
    // города
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of ctx.world().pois || []) {
      const [x, y] = tr(p.x, p.z);
      g.font = `900 ${15 * s}px Inter, sans-serif`;
      g.lineWidth = 4 * s; g.strokeStyle = 'rgba(20,14,50,.85)'; g.strokeText(p.name.toUpperCase(), x, y);
      g.fillStyle = '#fff'; g.fillText(p.name.toUpperCase(), x, y);
    }
  }

  return {
    get open() { return open; },
    // Новый мир — новая подложка.
    setWorld(world) {
      if (!world || worldKey === world.id) return;
      worldKey = world.id;
      build(world);
    },
    toggle(v = !open) {
      open = v;
      big.hidden = !open;
      if (open) drawBig();
    },
    update(dt, show) {
      mini.hidden = !show;
      if (!show) { if (open) this.toggle(false); return; }
      acc += dt;
      if (acc < 1 / 15) return;           // 15 кадров в секунду хватает
      acc = 0;
      drawMini();
      if (open) drawBig();
    },
  };
}
