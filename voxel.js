// Воксельный мир: хранение блоков, генерация из сида, текстуры, отрисовка по чанкам, луч от камеры.
// Мир 192×64×192 (≈2.4 млн ячеек) целиком в памяти; рисуем чанками CHUNK×CHUNK по X/Z —
// после правки перестраивается только задетый чанк, а не весь мир.

import * as THREE from 'three';

export const SX = 192, SY = 64, SZ = 192;
export const WATER_Y = 14;
export const CHUNK = 32;
const SNOW_Y = 38;

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

// ---------- Процедурные текстуры 16×16 ----------
// Рисуем попиксельно с детерминированным шумом: у всех игроков одинаковые.

let seedT = 1;
const r = () => { seedT = (seedT * 16807) % 2147483647; return seedT / 2147483647; };
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (c, k = 1) => `rgb(${clamp(c[0] * k)},${clamp(c[1] * k)},${clamp(c[2] * k)})`;

function paint(fn) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  fn(g, (x, y, col, a = 1) => { g.globalAlpha = a; g.fillStyle = col; g.fillRect(x, y, 1, 1); g.globalAlpha = 1; });
  return c;
}
const noiseFill = (px, base, amp) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, rgb(base, 1 + (r() - 0.5) * amp)); };
const bevel = (px, light, dark) => { for (let i = 0; i < 16; i++) { px(i, 0, light); px(0, i, light); px(i, 15, dark); px(15, i, dark); } };

const PAINTERS = {
  grassTop: (g, px) => { noiseFill(px, [92, 158, 62], 0.35); for (let i = 0; i < 26; i++) px(r() * 16 | 0, r() * 16 | 0, rgb([120, 190, 80], 1 + (r() - 0.5) * 0.2)); },
  grassSide: (g, px) => {
    noiseFill(px, [125, 88, 58], 0.3);
    for (let i = 0; i < 10; i++) px(r() * 16 | 0, 5 + (r() * 11 | 0), rgb([95, 66, 44]));
    for (let x = 0; x < 16; x++) { const h = 3 + (r() * 3 | 0); for (let y = 0; y < h; y++) px(x, y, rgb([92, 158, 62], 1 + (r() - 0.5) * 0.3)); }
  },
  dirt: (g, px) => { noiseFill(px, [125, 88, 58], 0.32); for (let i = 0; i < 14; i++) px(r() * 16 | 0, r() * 16 | 0, rgb([92, 64, 42])); },
  stone: (g, px) => {
    noiseFill(px, [128, 128, 132], 0.22);
    for (let i = 0; i < 5; i++) { let x = r() * 16 | 0, y = r() * 16 | 0; for (let k = 0; k < 4; k++) { px(x, y, rgb([92, 92, 96])); x = (x + (r() < 0.5 ? 1 : 0)) % 16; y = (y + 1) % 16; } }
  },
  cobble: (g, px) => {
    noiseFill(px, [110, 110, 114], 0.25);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + (y >> 2) * 3) % 5 === 0 || y % 4 === 0) px(x, y, rgb([70, 70, 74]));
  },
  sand: (g, px) => { noiseFill(px, [219, 205, 148], 0.12); for (let i = 0; i < 12; i++) px(r() * 16 | 0, r() * 16 | 0, rgb([196, 180, 122])); },
  logSide: (g, px) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, rgb([102, 76, 46], (x % 4 === 0 ? 0.72 : 1) * (1 + (r() - 0.5) * 0.18))); },
  logTop: (g, px) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      px(x, y, d > 6.8 ? rgb([102, 76, 46], 0.8) : rgb([176, 140, 88], (Math.floor(d) % 2 ? 0.86 : 1) * (1 + (r() - 0.5) * 0.08)));
    }
  },
  leaves: (g, px) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (r() < 0.16) continue;                       // просветы — прозрачные пиксели (cutout)
      px(x, y, rgb([52, 122, 48], 1 + (r() - 0.5) * 0.45));
    }
  },
  planks: (g, px) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const seam = y % 4 === 3 || (x === ((y >> 2) % 2 ? 4 : 11));
      px(x, y, seam ? rgb([120, 88, 50]) : rgb([182, 142, 86], 1 + (r() - 0.5) * 0.12));
    }
  },
  brick: (g, px) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const mortar = y % 4 === 3 || (x + ((y >> 2) % 2) * 4) % 8 === 7;
      px(x, y, mortar ? rgb([196, 188, 176]) : rgb([158, 66, 52], 1 + (r() - 0.5) * 0.22));
    }
  },
  gold: (g, px) => { noiseFill(px, [246, 205, 64], 0.1); bevel(px, rgb([255, 245, 170]), rgb([190, 140, 30])); px(4, 4, '#fff'); px(5, 4, '#fff8'); },
  emerald: (g, px) => { noiseFill(px, [42, 196, 108], 0.12); bevel(px, rgb([150, 255, 190]), rgb([20, 120, 60])); for (let i = 3; i < 13; i++) px(i, i, rgb([120, 240, 170])); },
  candle: (g, px) => { noiseFill(px, [226, 40, 52], 0.12); bevel(px, rgb([255, 120, 120]), rgb([140, 20, 28])); },
  glass: (g, px) => { bevel(px, rgb([235, 248, 255]), rgb([180, 210, 225])); for (let i = 0; i < 4; i++) px(3 + i, 6 - i, '#fff', 0.8); },
  snow: (g, px) => { noiseFill(px, [244, 248, 252], 0.06); for (let i = 0; i < 8; i++) px(r() * 16 | 0, r() * 16 | 0, rgb([215, 228, 240])); },
  snowSide: (g, px) => {
    noiseFill(px, [125, 88, 58], 0.3);
    for (let x = 0; x < 16; x++) { const h = 3 + (r() * 3 | 0); for (let y = 0; y < h; y++) px(x, y, rgb([244, 248, 252], 1 + (r() - 0.5) * 0.05)); }
  },
};

const texCache = new Map();
function tex(name) {
  if (!texCache.has(name)) {
    seedT = [...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 2147483646 + 1;
    const t = new THREE.CanvasTexture(paint(PAINTERS[name]));
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(name, t);
  }
  return texCache.get(name);
}

// Материал на блок: один на все грани или массив [px, nx, py, ny, pz, nz] для BoxGeometry.
export function makeMaterials() {
  return BLOCKS.map((b) => {
    if (!b) return null;
    const mk = (name) => new THREE.MeshLambertMaterial({
      map: tex(name),
      transparent: false,
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
