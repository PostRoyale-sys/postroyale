// Воксельный мир: хранение блоков, генерация из сида, отрисовка видимых блоков, луч от камеры.
// Мир маленький и целиком в памяти (96×48×96 ≈ 440 тыс. ячеек) — без чанков, перестройка меша за миллисекунды.

import * as THREE from 'three';

export const SX = 96, SY = 48, SZ = 96;
export const WATER_Y = 11;

// id блока → название, цвет текстуры, крапинки, прозрачность.
export const BLOCKS = [
  null,                                                                         // 0 — воздух
  { name: 'Grass', base: [95, 160, 70], spot: 'rgb(125,185,85)' },              // 1
  { name: 'Dirt', base: [120, 85, 60] },                                        // 2
  { name: 'Stone', base: [125, 125, 130], spot: 'rgb(95,95,100)' },             // 3
  { name: 'Sand', base: [215, 200, 140] },                                      // 4
  { name: 'Wood', base: [110, 80, 50], stripes: true },                         // 5
  { name: 'Leaves', base: [55, 130, 55], spot: 'rgb(35,95,35)', alpha: 0.92 },  // 6
  { name: 'Planks', base: [180, 140, 85], planks: true },                       // 7
  { name: 'Brick', base: [165, 70, 60], bricks: true },                         // 8
  { name: 'Gold', base: [240, 200, 60], spot: 'rgb(255,240,150)', glow: 0x332200 }, // 9
  { name: 'Glass', base: [200, 230, 245], alpha: 0.35 },                        // 10
  { name: 'Emerald', base: [40, 200, 110], spot: 'rgb(150,255,190)' },          // 11
  { name: 'Candle', base: [244, 33, 46], spot: 'rgb(255,120,120)' },            // 12
];
export const HOTBAR = [1, 2, 3, 4, 7, 8, 10, 9, 11, 12, 5, 6];

// ---------- Текстуры ----------

function texture(b) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let k = 1 + (Math.random() - 0.5) * 0.3;
      if (b.stripes && x % 4 === 0) k *= 0.8;
      if (b.planks && y % 4 === 3) k *= 0.7;
      if (b.bricks && (y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 4) % 8 === 0)) k = 1.45;
      g.fillStyle = `rgb(${b.base.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  if (b.spot) {
    g.fillStyle = b.spot;
    for (let i = 0; i < 7; i++) g.fillRect(Math.floor(Math.random() * 15), Math.floor(Math.random() * 15), 2, 2);
  }
  if (b.alpha && b.alpha < 0.5) { g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeRect(0.5, 0.5, 15, 15); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeMaterials() {
  return BLOCKS.map((b) => b && new THREE.MeshLambertMaterial({
    map: texture(b),
    transparent: !!b.alpha,
    opacity: b.alpha || 1,
    emissive: b.glow || 0x000000,
    depthWrite: !b.alpha || b.alpha > 0.5,
  }));
}

// Иконка блока для хотбара (data URL).
export function iconUrl(mat) {
  return mat.map.image.toDataURL();
}

// ---------- Генерация ----------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seedOf = (id) => [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

// Сглаженный value-noise на решётке.
function noise2(rand, cell) {
  const n = Math.ceil(SX / cell) + 2;
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
    if (y < 0) return true;                                   // дно мира
    if (x < 0 || z < 0 || x >= SX || z >= SZ) return y < WATER_Y; // за краем — «стена воды» не держит, но дно есть
    return this.get(x, y, z) !== 0;
  }

  generate(seed) {
    const rand = rng(seed);
    const big = noise2(rand, 32), mid = noise2(rand, 12), small = noise2(rand, 5);
    const heights = new Int16Array(SX * SZ);
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        // Остров: к краям мир уходит под воду.
        const dx = (x - SX / 2) / (SX / 2), dz = (z - SZ / 2) / (SZ / 2);
        const island = 1 - Math.min(1, Math.hypot(dx, dz)) ** 2.2;
        const h = Math.round(6 + island * (8 + big(x, z) * 14 + mid(x, z) * 5) + small(x, z) * 2);
        heights[z * SX + x] = h;
        for (let y = 0; y <= h; y++) {
          const depth = h - y;
          let b = depth === 0 ? 1 : depth <= 3 ? 2 : 3;
          if (h <= WATER_Y + 1 && depth <= 3) b = 4;      // пляж и дно
          this.set(x, y, z, b);
        }
      }
    }
    // Деревья на траве.
    for (let i = 0; i < 70; i++) {
      const x = 3 + Math.floor(rand() * (SX - 6)), z = 3 + Math.floor(rand() * (SZ - 6));
      const h = heights[z * SX + x];
      if (this.get(x, h, z) !== 1 || h <= WATER_Y + 1) continue;
      const trunk = 4 + Math.floor(rand() * 2);
      for (let y = 1; y <= trunk; y++) this.set(x, h + y, z, 5);
      for (let y = trunk - 1; y <= trunk + 1; y++) {
        const r = y === trunk + 1 ? 1 : 2;
        for (let ax = -r; ax <= r; ax++) for (let az = -r; az <= r; az++) {
          if (Math.abs(ax) === r && Math.abs(az) === r && rand() < 0.6) continue;
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

// ---------- Меш ----------
// По InstancedMesh на тип блока; рисуем только блоки, у которых есть открытая грань.

const GEO = new THREE.BoxGeometry(1, 1, 1);
const M = new THREE.Matrix4();

export function buildMeshes(world, mats) {
  const buckets = BLOCKS.map(() => []);
  const { cells } = world;
  const open = (x, y, z) => {
    const b = world.get(x, y, z);
    return b === 0 || BLOCKS[b].alpha;                       // прозрачный сосед — грань видна
  };
  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const b = cells[(y * SZ + z) * SX + x];
        if (!b) continue;
        if (y > 0 && !open(x + 1, y, z) && !open(x - 1, y, z) && !open(x, y + 1, z) && !open(x, y - 1, z) &&
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
    mesh.frustumCulled = false;
    meshes.push(mesh);
  });
  return meshes;
}

// ---------- Луч ----------
// DDA по сетке: первый непустой блок в пределах maxDist и нормаль грани, через которую вошли.

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
