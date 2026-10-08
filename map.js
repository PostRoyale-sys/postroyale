// Карта матча: гладкий остров (рельеф не ломается), 6 именованных локаций с домами, дороги между ними,
// деревья, камни, кусты, машины и места для сундуков. Всё генерируется из id мира — у всех игроков одинаковое.
//
// Дома собраны из тех же деталей, что строят игроки (пол, стена, окно, рампа на сетке G×G) — их можно сломать
// и разобрать на материалы (structures.js).

import * as THREE from 'three';
import { toon } from './art.js';

export const MAP = 320;               // сторона острова (м)
export const G = 4;                   // шаг сетки построек: стена G×G
export const WATER_Y = 0;
const RES = 2;                        // шаг сетки рельефа
const N = MAP / RES + 1;
const POI_R = 22, POI_BLEND = 36;     // радиус площадки локации и зона сглаживания вокруг

// Названия локаций — сюда же добавлять свои приколы.
export const POI_NAMES = ['Rug Row', 'Pump Park', 'Moon Mansions', 'Degen Docks', 'Whale Watch', 'Ratio Ridge', 'Gas Fee Gardens', 'Diamond Hands Depot'];

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

// Гладкий шум: значения в узлах решётки + плавная интерполяция, несколько октав.
function hash2(x, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s), c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, s, oct = 4) {
  let f = 0, amp = 0.5, fr = 1, norm = 0;
  for (let i = 0; i < oct; i++) { f += amp * vnoise(x * fr, z * fr, s + i * 17); norm += amp; amp *= 0.5; fr *= 2; }
  return f / norm;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function segDist(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

const WALL_TINTS = [0xf6f1e7, 0xa9dcf5, 0xf7d07a, 0xf4a6a0, 0xb4e6a8, 0xd9c6f2];
const BRICK_TINTS = [0xe07a5a, 0xe8dccb, 0xc9c3bb];
const ROOF_TINTS = [0xe0534f, 0x3f7fd9, 0x37b08f, 0x6c6f80, 0xf08a3c];
const CAR_COLORS = [0xe6463f, 0x2f8cff, 0xffc928, 0x2fbf71, 0xf2f2f2];

export class GameMap {
  constructor(id) {
    this.id = id;
    const seed = seedOf(id);
    const rand = rng(seed ^ 0x9e3779b9);
    this.seed = seed;

    // Гора — в случайном месте острова.
    const mx = MAP * (0.25 + rand() * 0.5), mz = MAP * (0.25 + rand() * 0.5);
    const raw = (x, z) => {
      const d = Math.hypot(x - MAP / 2, z - MAP / 2) / (MAP / 2);
      const wob = (fbm(x / 60, z / 60, seed + 1) - 0.5) * 0.35;
      const land = 1 - smooth(0.6, 0.95, d + wob);
      const hills = fbm(x / 45, z / 45, seed + 2) * 16;
      const mtn = 26 * Math.exp(-((x - mx) ** 2 + (z - mz) ** 2) / (2 * 26 * 26));
      return -7 + land * (9 + hills + mtn);
    };

    // Локации: на суше, не в горах, далеко друг от друга. Площадка — на уровне сетки построек.
    const names = [...POI_NAMES];
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    this.pois = [];
    for (let t = 0; t < 400 && this.pois.length < 6; t++) {
      const x = 50 + rand() * (MAP - 100), z = 50 + rand() * (MAP - 100);
      const h = raw(x, z);
      if (h < 3 || h > 20) continue;
      if (this.pois.some((p) => Math.hypot(p.x - x, p.z - z) < 78)) continue;
      // центр — на узле сетки, чтобы дома ровно стояли на площадке
      const cx = Math.round(x / G) * G, cz = Math.round(z / G) * G;
      this.pois.push({ name: names[this.pois.length], x: cx, z: cz, y: Math.max(G, Math.round(h / G) * G) });
    }

    // Рельеф: сглаживаем вокруг локаций до уровня площадки.
    this.h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i * RES, z = j * RES;
      let h = raw(x, z);
      for (const p of this.pois) {
        const d = Math.hypot(x - p.x, z - p.z);
        const w = 1 - smooth(POI_R, POI_BLEND, d);
        if (w > 0) h = h * (1 - w) + p.y * w;
      }
      this.h[j * N + i] = h;
    }

    // Дороги: каждая локация — к ближайшей и ко второй ближайшей.
    this.roads = [];
    const seen = new Set();
    for (const a of this.pois) {
      const near = this.pois.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z)).slice(0, 2);
      for (const b of near) {
        const k = [a.name, b.name].sort().join('|');
        if (!seen.has(k)) { seen.add(k); this.roads.push([a, b]); }
      }
    }

    this.pieces = [];      // детали домов: { k, t, ix, iy, iz, o, m, tint, v }
    this.objects = [];     // { kind, x, y, z, s, rot, color }
    this.decor = [];       // кусты — без столкновений
    this.chestSpots = [];  // { x, y, z, rot }
    const occupied = new Set();      // занятые клетки сетки (дома, машины)
    for (const p of this.pois) this.buildTown(p, rand, occupied);
    this.scatter(rand, occupied);
  }

  // ---------- Рельеф ----------

  height(x, z) {
    const fx = x / RES, fz = z / RES;
    if (fx < 0 || fz < 0 || fx > N - 1 || fz > N - 1) return -8;
    const i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fz));
    const u = fx - i, v = fz - j;
    const a = this.h[j * N + i], b = this.h[j * N + i + 1], c = this.h[(j + 1) * N + i], d = this.h[(j + 1) * N + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  surfaceY(x, z) { return this.height(x, z); }
  slope(x, z) { return Math.hypot(this.height(x + 1, z) - this.height(x - 1, z), this.height(x, z + 1) - this.height(x, z - 1)) / 2; }
  roadDist(x, z) { let d = Infinity; for (const [a, b] of this.roads) d = Math.min(d, segDist(x, z, a, b)); return d; }
  poiAt(x, z, pad = 0) { return this.pois.find((p) => Math.hypot(p.x - x, p.z - z) < POI_R + pad) || null; }

  // Меш рельефа: цвета вершин — песок, трава (два тона), скалы на крутых склонах и вершинах, дороги, площади.
  mesh() {
    const geo = new THREE.PlaneGeometry(MAP, MAP, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(MAP / 2, 0, MAP / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const SAND = new THREE.Color(0xf5dc8f), GRASS = new THREE.Color(0x6fd13f), GRASS2 = new THREE.Color(0x58bb35),
      ROCK = new THREE.Color(0xa7a9b4), ROAD = new THREE.Color(0xc9a46c), PLAZA = new THREE.Color(0xd8d2c4), SNOW = new THREE.Color(0xf4f8ff);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      const h = this.height(x, z);
      pos.setY(k, h);
      const sl = this.slope(x, z);
      c.copy(GRASS).lerp(GRASS2, fbm(x / 14, z / 14, this.seed + 5));
      if (h < 2.2) c.copy(SAND);
      else if (h < 3) c.lerp(SAND, 1 - (h - 2.2) / 0.8);
      if (sl > 0.75) c.lerp(ROCK, smooth(0.75, 1.1, sl));
      if (h > 30) c.lerp(SNOW, smooth(30, 34, h));
      const rd = this.roadDist(x, z);
      if (h > 2.2 && rd < 3) c.lerp(ROAD, 1 - smooth(1.8, 3, rd));
      for (const p of this.pois) { const d = Math.hypot(x - p.x, z - p.z); if (d < POI_R) c.lerp(PLAZA, 1 - smooth(POI_R - 5, POI_R, d)); }
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    m.receiveShadow = true;
    return m;
  }

  // ---------- Город ----------

  buildTown(poi, rand, occupied) {
    const L0 = poi.y / G;
    const c0x = poi.x / G, c0z = poi.z / G;
    const houses = [];
    const want = 4 + Math.floor(rand() * 3);
    for (let t = 0; t < 80 && houses.length < want; t++) {
      const w = 2 + (rand() < 0.4 ? 1 : 0), d = 2 + (rand() < 0.4 ? 1 : 0);
      const hx = c0x - 5 + Math.floor(rand() * (10 - w)), hz = c0z - 5 + Math.floor(rand() * (10 - d));
      // целиком на площадке и с промежутком в клетку от соседей
      const corners = [[hx, hz], [hx + w, hz], [hx, hz + d], [hx + w, hz + d]];
      if (corners.some(([x, z]) => Math.hypot(x * G - poi.x, z * G - poi.z) > POI_R - 2)) continue;
      let free = true;
      for (let x = hx - 1; x <= hx + w && free; x++) for (let z = hz - 1; z <= hz + d; z++) if (occupied.has(`${x},${z}`)) { free = false; break; }
      if (!free) continue;
      for (let x = hx; x < hx + w; x++) for (let z = hz; z < hz + d; z++) occupied.add(`${x},${z}`);
      const levels = houses.length === 0 ? 3 : rand() < 0.45 ? 2 : 1;
      const mr = rand();
      const m = mr < 0.6 ? 'wood' : mr < 0.9 ? 'brick' : 'metal';
      const tint = m === 'wood' ? WALL_TINTS[Math.floor(rand() * WALL_TINTS.length)] : m === 'brick' ? BRICK_TINTS[Math.floor(rand() * BRICK_TINTS.length)] : 0xdfe6ee;
      const roof = ROOF_TINTS[Math.floor(rand() * ROOF_TINTS.length)];
      houses.push({ hx, hz, w, d });
      this.house(hx, hz, w, d, L0, levels, m, tint, roof, rand);
    }
    // Машины на площади — в свободных клетках.
    for (let t = 0, cars = 0; t < 40 && cars < 3; t++) {
      const cx = c0x - 5 + Math.floor(rand() * 10), cz = c0z - 5 + Math.floor(rand() * 10);
      const along = rand() < 0.5;
      const cells = along ? [[cx, cz], [cx + 1, cz]] : [[cx, cz], [cx, cz + 1]];
      if (cells.some(([x, z]) => occupied.has(`${x},${z}`) || Math.hypot(x * G - poi.x, z * G - poi.z) > POI_R - 3)) continue;
      for (const [x, z] of cells) occupied.add(`${x},${z}`);
      const x = along ? (cx + 1) * G : (cx + 0.5) * G, z = along ? (cz + 0.5) * G : (cz + 1) * G;
      this.objects.push({ kind: 'car', x, y: poi.y, z, s: 1, rot: along ? 0 : Math.PI / 2, color: Math.floor(rand() * CAR_COLORS.length) });
      cars++;
    }
  }

  // Дом из деталей: пол на каждом этаже, стены по периметру (дверь, окна), рампа-лестница, плоская крыша.
  house(hx, hz, w, d, L0, levels, m, tint, roof, rand) {
    const P = this.pieces;
    const add = (p) => P.push({ m, tint, ...p });
    const door = Math.floor(rand() * (2 * (w + d)));
    const stairs = [];
    for (let l = 0; l < levels - 1; l++) {
      // рампы чередуются по углам: снизу у западной стены вверх на восток, выше — наоборот
      stairs.push(l % 2 === 0 ? { ix: hx, iz: hz + d - 1, dir: 'px' } : { ix: hx + w - 1, iz: hz, dir: 'nx' });
    }
    for (let l = 0; l <= levels; l++) {
      const iy = L0 + l;
      for (let x = hx; x < hx + w; x++) for (let z = hz; z < hz + d; z++) {
        const st = stairs[l - 1];
        if (l > 0 && l < levels && st && st.ix === x && st.iz === z) continue;      // над лестницей — проём
        add({ t: 'f', ix: x, iy, iz: z, tint: l === levels ? roof : l === 0 ? 0xe7dccb : tint });
      }
      if (l === levels) break;
      let e = 0;
      const wall = (o, ix, iz) => {
        const isDoor = l === 0 && e === door;
        e++;
        if (isDoor) return;
        add({ t: 'w', o, ix, iy, iz, v: l > 0 || rand() < 0.4 ? (rand() < 0.55 ? 'win' : undefined) : undefined });
      };
      for (let x = hx; x < hx + w; x++) { wall('x', x, hz); wall('x', x, hz + d); }
      for (let z = hz; z < hz + d; z++) { wall('z', hx, z); wall('z', hx + w, z); }
      if (stairs[l]) add({ t: 'r', ix: stairs[l].ix, iy, iz: stairs[l].iz, o: stairs[l].dir });
      // сундук на этаже (не на лестнице)
      if (rand() < 0.6) {
        const cx = hx + Math.floor(rand() * w), cz = hz + Math.floor(rand() * d);
        if (!stairs[l] || stairs[l].ix !== cx || stairs[l].iz !== cz) {
          this.chestSpots.push({ x: (cx + 0.5) * G, y: iy * G + 0.05, z: (cz + 0.5) * G, rot: Math.floor(rand() * 4) * Math.PI / 2 });
        }
      }
    }
    for (const p of P) if (!p.k) p.k = pieceKey(p);
  }

  // ---------- Природа ----------

  scatter(rand, occupied) {
    const ok = (x, z, minH, maxSlope, pad) => {
      const h = this.height(x, z);
      if (h < minH || this.slope(x, z) > maxSlope) return false;
      if (this.poiAt(x, z, pad)) return false;
      if (occupied.has(`${Math.floor(x / G)},${Math.floor(z / G)}`)) return false;
      return this.roadDist(x, z) > 3.5;
    };
    for (let t = 0; t < 3000 && this.objects.filter((o) => o.kind === 'oak' || o.kind === 'pine').length < 340; t++) {
      const x = 6 + rand() * (MAP - 12), z = 6 + rand() * (MAP - 12);
      if (!ok(x, z, 2.6, 0.8, 4)) continue;
      // кучкуем: в лесистых местах (по шуму) деревья гуще
      if (fbm(x / 40, z / 40, this.seed + 9) < 0.42 && rand() < 0.75) continue;
      const h = this.height(x, z);
      this.objects.push({ kind: h > 16 || rand() < 0.22 ? 'pine' : 'oak', x, y: h - 0.1, z, s: 0.85 + rand() * 0.4, rot: rand() * Math.PI * 2 });
    }
    for (let t = 0; t < 1500 && this.objects.filter((o) => o.kind === 'rock').length < 110; t++) {
      const x = 6 + rand() * (MAP - 12), z = 6 + rand() * (MAP - 12);
      if (!ok(x, z, 0.5, 1.4, 2)) continue;
      this.objects.push({ kind: 'rock', x, y: this.height(x, z) - 0.25, z, s: 0.9 + rand() * 1.1, rot: rand() * Math.PI * 2 });
    }
    for (let t = 0; t < 1500 && this.decor.length < 220; t++) {
      const x = 6 + rand() * (MAP - 12), z = 6 + rand() * (MAP - 12);
      if (!ok(x, z, 2.4, 0.9, 0)) continue;
      this.decor.push({ kind: 'bush', x, y: this.height(x, z) - 0.15, z, s: 0.7 + rand() * 0.7, rot: rand() * Math.PI * 2 });
    }
    // Сундуки и на природе: под деревьями и у камней.
    for (let t = 0, n = 0; t < 400 && n < 12; t++) {
      const x = 10 + rand() * (MAP - 20), z = 10 + rand() * (MAP - 20);
      if (!ok(x, z, 3, 0.5, 6)) continue;
      this.chestSpots.push({ x, y: this.height(x, z), z, rot: rand() * Math.PI * 2 });
      n++;
    }
  }
}

export const CAR_COLOR_LIST = CAR_COLORS;

// Ключ детали: тип + клетка (+ ориентация у стен). Один ключ — одна деталь.
export function pieceKey(p) {
  return p.t === 'w' ? `w:${p.o}:${p.ix}:${p.iy}:${p.iz}` : `${p.t}:${p.ix}:${p.iy}:${p.iz}`;
}
