// Воксельный мир: хранение блоков, генерация из сида, текстуры, отрисовка по чанкам, луч от камеры.
// Мир 192×64×192 (≈2.4 млн ячеек) целиком в памяти; рисуем чанками CHUNK×CHUNK по X/Z —
// после правки перестраивается только задетый чанк, а не весь мир.

import * as THREE from 'three';

export const SX = 192, SY = 64, SZ = 192;
export const WATER_Y = 14;
export const CHUNK = 32;
const SNOW_Y = 44;

// ---------- Блоки ----------
// tex — текстура всех граней, или { top, side, bottom }; see — сквозь блок видно соседей (листва, стекло).

export const BLOCKS = [
  null,                                                                    // 0 — воздух
  { name: 'Grass', tex: { top: 'grassTop', side: 'grassSide', bottom: 'dirt' } }, // 1
  { name: 'Dirt', tex: 'dirt' },                                          // 2
  { name: 'Stone', tex: 'stone' },                                        // 3
  { name: 'Sand', tex: 'sand' },                                          // 4
  { name: 'Log', tex: { top: 'logTop', side: 'logSide', bottom: 'logTop' } }, // 5
  { name: 'Leaves', tex: 'leaves', see: true, cutout: true },             // 6
  { name: 'Planks', tex: 'planks' },                                      // 7
  { name: 'Brick', tex: 'brick' },                                        // 8
  { name: 'Gold', tex: 'gold', glow: 0x2a1c00 },                          // 9
  { name: 'Glass', tex: 'glass', see: true, cutout: true },               // 10
  { name: 'Emerald', tex: 'emerald' },                                    // 11
  { name: 'Candle', tex: 'candle' },                                      // 12
  { name: 'Snow', tex: { top: 'snow', side: 'snowSide', bottom: 'dirt' } }, // 13
  { name: 'Cobble', tex: 'cobble' },                                      // 14
];
export const HOTBAR = [7, 8, 14, 10, 1, 2, 3, 4, 5, 9, 11, 12, 13, 6];

// ---------- Процедурные текстуры 32×32, мультяшный стиль ----------
// Гладкие заливки с мягкими пятнами и скруглённой фаской (свет сверху-слева, тень снизу-справа),
// сочная палитра. Шум детерминированный — у всех игроков одинаковые.

const S = 32;
let seedT = 1;
const r = () => { seedT = (seedT * 16807) % 2147483647; return seedT / 2147483647; };
const hex = (c, k = 1) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;

function paint(fn) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  fn(g);
  return c;
}
// Вертикальный градиент заливки.
function fill(g, top, bottom, y0 = 0, y1 = S) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, hex(top)); gr.addColorStop(1, hex(bottom));
  g.fillStyle = gr; g.fillRect(0, y0, S, y1 - y0);
}
// Мягкие пятна (радиальные градиенты), с переносом через край — текстура тайлится без шва.
function blobs(g, col, n, rmin, rmax, alpha = 0.5, y0 = 0, y1 = S) {
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = y0 + r() * (y1 - y0), rad = rmin + r() * (rmax - rmin);
    for (const dx of [-S, 0, S]) {
      const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
      gr.addColorStop(0, `rgba(${col.join(',')},${alpha})`); gr.addColorStop(1, `rgba(${col.join(',')},0)`);
      g.fillStyle = gr; g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
    }
  }
}
// Скруглённая фаска по краю блока: подчёркивает форму без контурных линий.
function bevel(g, k = 1) {
  const edge = (x0, y0, x1, y1, col) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); return gr; };
  g.fillStyle = edge(0, 0, 0, 4, `rgba(255,255,255,${0.32 * k})`); g.fillRect(0, 0, S, 4);
  g.fillStyle = edge(0, 0, 4, 0, `rgba(255,255,255,${0.2 * k})`); g.fillRect(0, 0, 4, S);
  g.fillStyle = edge(0, S, 0, S - 5, `rgba(0,0,0,${0.3 * k})`); g.fillRect(0, S - 5, S, 5);
  g.fillStyle = edge(S, 0, S - 4, 0, `rgba(0,0,0,${0.22 * k})`); g.fillRect(S - 4, 0, 4, S);
}
function roundRect(g, x, y, w, h, rad, col) { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, rad); g.fill(); }

const GRASS = [104, 206, 66], GRASS_HI = [160, 238, 96], DIRT = [176, 116, 72], DIRT_DK = [132, 82, 50];

const PAINTERS = {
  grassTop: (g) => { fill(g, [112, 214, 70], [94, 196, 60]); blobs(g, GRASS_HI, 7, 4, 9, 0.45); blobs(g, [70, 168, 52], 5, 3, 7, 0.35); bevel(g, 0.7); },
  grassSide: (g) => {
    fill(g, DIRT, DIRT_DK); blobs(g, [196, 140, 92], 5, 2, 5, 0.4, 12, S); blobs(g, [110, 66, 40], 4, 2, 4, 0.4, 12, S);
    // травяная «шапка» с волнистыми каплями
    g.fillStyle = hex(GRASS); g.beginPath(); g.moveTo(0, 0); g.lineTo(S, 0);
    for (let x = S; x >= 0; x -= 4) g.quadraticCurveTo(x + 2, 9 + r() * 6, x - 2, 7 + r() * 3);
    g.closePath(); g.fill();
    const gr = g.createLinearGradient(0, 0, 0, 10); gr.addColorStop(0, hex(GRASS_HI, 1)); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, 6);
    bevel(g, 0.8);
  },
  dirt: (g) => { fill(g, DIRT, DIRT_DK); blobs(g, [200, 146, 96], 6, 2, 5, 0.45); blobs(g, [110, 66, 40], 6, 2, 4, 0.45); bevel(g); },
  stone: (g) => {
    fill(g, [170, 180, 192], [140, 150, 164]); blobs(g, [200, 208, 218], 5, 4, 8, 0.4); blobs(g, [110, 118, 132], 4, 3, 7, 0.35);
    g.strokeStyle = 'rgba(90,98,112,.55)'; g.lineWidth = 1.2; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) { let x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 3; k++) { x += (r() - 0.5) * 10; y += 3 + r() * 5; g.lineTo(x, y); } g.stroke(); }
    bevel(g);
  },
  cobble: (g) => {
    fill(g, [96, 104, 118], [84, 92, 106]);
    const rows = [[0, 9], [10, 11], [22, 10]];
    rows.forEach(([y, h], ri) => { let x = ri % 2 ? -6 : 0; while (x < S) { const w = 9 + r() * 6; const c = 150 + r() * 34; roundRect(g, x + 1, y + 1, w - 2, h - 2, 4, hex([c, c + 6, c + 16])); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x + 3, y + 2, w - 7, 2); x += w; } });
    bevel(g, 0.6);
  },
  sand: (g) => {
    fill(g, [252, 226, 150], [240, 208, 128]); blobs(g, [255, 240, 186], 5, 4, 8, 0.5);
    g.strokeStyle = 'rgba(214,176,98,.45)'; g.lineWidth = 1.4;
    for (let y = 6; y < S; y += 9) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(10, y - 3, 20, y + 3, S, y); g.stroke(); }
    bevel(g, 0.6);
  },
  logSide: (g) => {
    fill(g, [150, 98, 58], [124, 78, 44]);
    for (let x = 2; x < S; x += 6 + (r() * 3 | 0)) { g.fillStyle = 'rgba(80,46,24,.45)'; g.fillRect(x, 0, 1.5, S); g.fillStyle = 'rgba(255,214,160,.18)'; g.fillRect(x + 2, 0, 1.5, S); }
    bevel(g, 0.6);
  },
  logTop: (g) => {
    fill(g, [124, 78, 44], [124, 78, 44]);
    for (let rad = 13; rad > 0; rad -= 3) { g.fillStyle = hex(rad % 2 ? [236, 190, 120] : [214, 164, 98]); g.beginPath(); g.arc(16, 16, rad, 0, Math.PI * 2); g.fill(); }
    bevel(g, 0.6);
  },
  leaves: (g) => {
    // пучки листьев-кружков; промежутки прозрачные (cutout)
    for (let i = 0; i < 26; i++) {
      const x = r() * S, y = r() * S, rad = 4 + r() * 4, k = 0.85 + r() * 0.3;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + dx - 1.5, y + dy - 1.5, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, hex([118, 214, 82], k)); gr.addColorStop(1, hex([46, 150, 52], k));
        g.fillStyle = gr; g.beginPath(); g.arc(x + dx, y + dy, rad, 0, Math.PI * 2); g.fill();
      }
    }
  },
  planks: (g) => {
    for (let i = 0; i < 4; i++) {
      const c = 0.92 + r() * 0.14;
      const gr = g.createLinearGradient(0, i * 8, 0, i * 8 + 8); gr.addColorStop(0, hex([238, 176, 104], c)); gr.addColorStop(1, hex([206, 142, 76], c));
      g.fillStyle = gr; g.fillRect(0, i * 8, S, 8);
      g.fillStyle = 'rgba(120,70,30,.6)'; g.fillRect(0, i * 8 + 7, S, 1.2);
      const sx = (i % 2 ? 9 : 23); g.fillRect(sx, i * 8, 1.2, 8);
      g.fillStyle = 'rgba(150,90,40,.5)'; g.beginPath(); g.arc(sx + (i % 2 ? 8 : -8), i * 8 + 4, 1.1, 0, Math.PI * 2); g.fill();
    }
    bevel(g, 0.7);
  },
  brick: (g) => {
    fill(g, [236, 222, 204], [216, 200, 182]);
    for (let row = 0; row < 4; row++) for (let col = -1; col < 3; col++) {
      const x = col * 16 + (row % 2) * 8, y = row * 8, c = 0.9 + r() * 0.16;
      const gr = g.createLinearGradient(0, y, 0, y + 7); gr.addColorStop(0, hex([232, 102, 72], c)); gr.addColorStop(1, hex([196, 72, 52], c));
      g.fillStyle = gr; g.beginPath(); g.roundRect(x + 1, y + 1, 14, 6, 2); g.fill();
    }
    bevel(g, 0.5);
  },
  gold: (g) => {
    fill(g, [255, 222, 74], [240, 168, 24]); blobs(g, [255, 248, 190], 3, 5, 9, 0.6);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(9, 8, 4, 2, -0.6, 0, Math.PI * 2); g.fill();
    bevel(g, 1.2);
  },
  emerald: (g) => {
    fill(g, [80, 236, 150], [24, 170, 96]);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(16, 3); g.lineTo(29, 16); g.lineTo(16, 29); g.lineTo(3, 16); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.ellipse(11, 10, 3, 1.5, -0.7, 0, Math.PI * 2); g.fill();
    bevel(g, 1.2);
  },
  candle: (g) => { fill(g, [255, 92, 96], [210, 36, 60]); blobs(g, [255, 170, 160], 3, 4, 8, 0.45); bevel(g, 1.1); },
  glass: (g) => {
    g.fillStyle = 'rgba(200,236,255,.25)'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 2.5; g.strokeRect(1.25, 1.25, S - 2.5, S - 2.5);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.save(); g.translate(10, 12); g.rotate(-0.7); g.fillRect(-6, -1.2, 12, 2.4); g.fillRect(-2, 4, 7, 1.6); g.restore();
  },
  snow: (g) => { fill(g, [252, 254, 255], [226, 238, 252]); blobs(g, [196, 220, 248], 4, 4, 8, 0.4); bevel(g, 0.6); },
  snowSide: (g) => {
    fill(g, DIRT, DIRT_DK); blobs(g, [110, 66, 40], 4, 2, 4, 0.4, 12, S);
    g.fillStyle = hex([248, 252, 255]); g.beginPath(); g.moveTo(0, 0); g.lineTo(S, 0);
    for (let x = S; x >= 0; x -= 5) g.quadraticCurveTo(x + 2, 10 + r() * 5, x - 3, 7 + r() * 3);
    g.closePath(); g.fill();
    bevel(g, 0.7);
  },
};

const texCache = new Map();
function tex(name) {
  if (!texCache.has(name)) {
    seedT = [...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 2147483646 + 1;
    const t = new THREE.CanvasTexture(paint(PAINTERS[name]));
    t.magFilter = THREE.LinearFilter;                 // мягко, а не пиксельно
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(name, t);
  }
  return texCache.get(name);
}

// Ступенчатый свет для мультяшного (cel) затенения: 4 тона.
let toonRamp = null;
export function toonGradient() {
  if (!toonRamp) {
    toonRamp = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 175, 175, 175, 255, 225, 225, 225, 255, 255, 255, 255, 255]), 4, 1);
    toonRamp.magFilter = toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}

// Материал на блок: один на все грани или массив [px, nx, py, ny, pz, nz] для BoxGeometry.
export function makeMaterials() {
  return BLOCKS.map((b) => {
    if (!b) return null;
    const mk = (name) => new THREE.MeshToonMaterial({
      map: tex(name),
      gradientMap: toonGradient(),
      transparent: !!b.glass,
      alphaTest: b.cutout ? 0.5 : 0,
      side: b.cutout ? THREE.DoubleSide : THREE.FrontSide,
      emissive: b.glow || 0x000000,
    });
    if (typeof b.tex === 'string') return mk(b.tex);
    const side = mk(b.tex.side), top = mk(b.tex.top), bottom = mk(b.tex.bottom);
    return [side, side, top, bottom, side, side];
  });
}

// Иконка блока для хотбара (data URL): боковая грань.
export function iconUrl(mat) {
  return (Array.isArray(mat) ? mat[0] : mat).map.image.toDataURL();
}

// ---------- Генерация ----------

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seedOf = (id) => [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

function noise2(rand, cell) {
  const n = Math.ceil(Math.max(SX, SZ) / cell) + 2;
  const grid = Array.from({ length: n * n }, rand);
  const s = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const gx = x / cell, gz = z / cell, ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = s(gx - ix), fz = s(gz - iz);
    const v = (a, b) => grid[(b % n) * n + (a % n)];
    return (v(ix, iz) * (1 - fx) + v(ix + 1, iz) * fx) * (1 - fz) + (v(ix, iz + 1) * (1 - fx) + v(ix + 1, iz + 1) * fx) * fz;
  };
}

export class World {
  constructor(id) {
    this.id = id;
    this.cells = new Uint8Array(SX * SY * SZ);
    this.generate(seedOf(id));
  }

  idx(x, y, z) { return (y * SZ + z) * SX + x; }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ; }
  get(x, y, z) { return this.inside(x, y, z) ? this.cells[this.idx(x, y, z)] : 0; }
  set(x, y, z, b) { if (this.inside(x, y, z)) this.cells[this.idx(x, y, z)] = b; }
  solid(x, y, z) {
    if (y < 0) return true;
    if (x < 0 || z < 0 || x >= SX || z >= SZ) return y < WATER_Y;
    return this.get(x, y, z) !== 0;
  }

  generate(seed) {
    const rand = rng(seed);
    const big = noise2(rand, 56), mid = noise2(rand, 20), small = noise2(rand, 7), peaks = noise2(rand, 36);
    const heights = new Int16Array(SX * SZ);
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        // Остров: к краям уходит под воду; горы — там, где «peaks» высокие.
        const dx = (x - SX / 2) / (SX / 2), dz = (z - SZ / 2) / (SZ / 2);
        const island = 1 - Math.min(1, Math.hypot(dx, dz)) ** 2.4;
        const mountain = Math.max(0, peaks(x, z) - 0.55) * 60;
        const h = Math.min(SY - 8, Math.round(7 + island * (9 + big(x, z) * 14 + mid(x, z) * 6 + mountain) + small(x, z) * 2));
        heights[z * SX + x] = h;
        for (let y = 0; y <= h; y++) {
          const depth = h - y;
          let b = depth === 0 ? 1 : depth <= 3 ? 2 : 3;
          if (h <= WATER_Y + 1 && depth <= 3) b = 4;                 // пляж и дно
          if (h >= SNOW_Y && depth === 0) b = 13;                     // снег на вершинах
          if (h >= SNOW_Y + 4 && depth > 0 && depth <= 3) b = 3;      // голые скалы под снегом
          this.set(x, y, z, b);
        }
      }
    }
    // Деревья на траве.
    for (let i = 0; i < 260; i++) {
      const x = 3 + Math.floor(rand() * (SX - 6)), z = 3 + Math.floor(rand() * (SZ - 6));
      const h = heights[z * SX + x];
      if (this.get(x, h, z) !== 1 || h <= WATER_Y + 1) continue;
      const trunk = 4 + Math.floor(rand() * 3);
      for (let y = 1; y <= trunk; y++) this.set(x, h + y, z, 5);
      for (let y = trunk - 1; y <= trunk + 1; y++) {
        const rad = y === trunk + 1 ? 1 : 2;
        for (let ax = -rad; ax <= rad; ax++) for (let az = -rad; az <= rad; az++) {
          if (Math.abs(ax) === rad && Math.abs(az) === rad && rand() < 0.6) continue;
          if (!this.get(x + ax, h + y, z + az)) this.set(x + ax, h + y, z + az, 6);
        }
      }
    }
    this.heights = heights;
  }

  surfaceY(x, z) {
    for (let y = SY - 1; y >= 0; y--) if (this.get(x, y, z)) return y + 1;
    return 0;
  }
}

// ---------- Меш чанка ----------
// По InstancedMesh на тип блока в чанке; рисуем только блоки, у которых есть открытая грань.

const GEO = new THREE.BoxGeometry(1, 1, 1);
const M = new THREE.Matrix4();
export const chunkKey = (cx, cz) => `${cx},${cz}`;
export const CHUNKS_X = Math.ceil(SX / CHUNK), CHUNKS_Z = Math.ceil(SZ / CHUNK);

export function buildChunk(world, mats, cx, cz) {
  const buckets = BLOCKS.map(() => []);
  const { cells } = world;
  const open = (x, y, z) => {
    if (y >= SY) return true;
    if (x < 0 || z < 0 || x >= SX || z >= SZ || y < 0) return false;
    const b = cells[(y * SZ + z) * SX + x];
    return b === 0 || BLOCKS[b].see;
  };
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(SX, x0 + CHUNK), z1 = Math.min(SZ, z0 + CHUNK);
  for (let y = 0; y < SY; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const b = cells[(y * SZ + z) * SX + x];
        if (!b) continue;
        if (!open(x + 1, y, z) && !open(x - 1, y, z) && !open(x, y + 1, z) && !open(x, y - 1, z) &&
            !open(x, y, z + 1) && !open(x, y, z - 1)) continue;
        buckets[b].push(x, y, z);
      }
    }
  }
  const meshes = [];
  buckets.forEach((pos, b) => {
    if (!b || !pos.length) return;
    const mesh = new THREE.InstancedMesh(GEO, mats[b], pos.length / 3);
    for (let j = 0; j < pos.length / 3; j++) {
      M.makeTranslation(pos[j * 3] + 0.5, pos[j * 3 + 1] + 0.5, pos[j * 3 + 2] + 0.5);
      mesh.setMatrixAt(j, M);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh.receiveShadow = true;
    meshes.push(mesh);
  });
  return meshes;
}

// Чанк(и), которые задевает правка в ячейке x,z (на границе — оба соседа: у них могла открыться грань).
export function chunksOf(x, z) {
  const out = new Set();
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, zz = z + dz;
    if (xx < 0 || zz < 0 || xx >= SX || zz >= SZ) continue;
    out.add(chunkKey(Math.floor(xx / CHUNK), Math.floor(zz / CHUNK)));
  }
  return out;
}

// ---------- Луч ----------

export function raycast(world, origin, dir, maxDist = 6) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = Math.abs(1 / dir.x), tdy = Math.abs(1 / dir.y), tdz = Math.abs(1 / dir.z);
  let tx = (sx > 0 ? x + 1 - origin.x : origin.x - x) * tdx;
  let ty = (sy > 0 ? y + 1 - origin.y : origin.y - y) * tdy;
  let tz = (sz > 0 ? z + 1 - origin.z : origin.z - z) * tdz;
  let normal = [0, 0, 0];
  for (let t = 0; t <= maxDist;) {
    if (world.get(x, y, z)) return { x, y, z, normal };
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; normal = [-sx, 0, 0]; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; normal = [0, -sy, 0]; }
    else { z += sz; t = tz; tz += tdz; normal = [0, 0, -sz]; }
  }
  return null;
}
