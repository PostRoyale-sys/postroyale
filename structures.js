// Постройки и объекты карты: детали (пол, стена, окно, рампа) из дерева/кирпича/металла и деревья, камни, машины.
// У всего есть HP: кирка и оружие ломают, кирка ещё и добывает материалы. Игроки строят из добытого.
//
// Состояние раунда: сгенерированные дома и объекты (map.js) + правки игроков. Правка по сети:
//   { a: 1, k, t, ix, iy, iz, o, m }  — поставили деталь;   { k, x: урон } — повредили (≤0 HP — исчезла).
// Новичку при входе — снимок отличий от сгенерированного (syncList / applySync).
//
// Рисуется пачками InstancedMesh (по виду детали × материалу и по виду объекта); столкновения и лучи —
// своей математикой по пространственной сетке (клетка G×G), без three.js-рейкастов.

import * as THREE from 'three';
import { G, WATER_Y, pieceKey, CAR_COLORS } from './map.js';
import { rayBox } from './combat.js';
import { toon, buildTexture, oakGeometry, pineGeometry, rockGeometry, bushGeometry, carGeometry, vcMaterial } from './art.js';

export const MATS = ['wood', 'brick', 'metal'];
export const MAT_INFO = {
  wood: { name: 'Wood', hp: 150, color: '#e3a35f', tint: 0xd99a5b },
  brick: { name: 'Brick', hp: 250, color: '#e0745a', tint: 0xc9c3bb },
  metal: { name: 'Metal', hp: 350, color: '#a9bfd6', tint: 0x9fb2c8 },
};
export const BUILD_COST = 10, MAT_MAX = 999;
export const PICK_DMG = 50;
const OBJ = {
  oak: { hp: 150, mat: 'wood', per: 10, bonus: 20 },
  pine: { hp: 120, mat: 'wood', per: 10, bonus: 15 },
  rock: { hp: 220, mat: 'brick', per: 10, bonus: 20 },
  car: { hp: 300, mat: 'metal', per: 12, bonus: 20 },
};
const PIECE_HARVEST = 5;              // материалов за удар киркой по детали
const T = 0.3;                        // толщина стен и полов
const STEP = 0.55;                    // на сколько можно «шагнуть» вверх без прыжка

// ---------- Геометрия деталей (локально) ----------
// parts — коробки в локальных координатах детали (для столкновений и пуль); у рампы — наклонная поверхность.

const WIN = [                         // стена с окном: низ, верх, два простенка
  { c: [0, -G / 2 + 0.65, 0], s: [G, 1.3, T] },
  { c: [0, G / 2 - 0.55, 0], s: [G, 1.1, T] },
  { c: [-G / 2 + 0.6, -G / 2 + 2.1, 0], s: [1.2, 1.6, T] },
  { c: [G / 2 - 0.6, -G / 2 + 2.1, 0], s: [1.2, 1.6, T] },
];
const PARTS = {
  f: [{ c: [0, 0, 0], s: [G, T, G] }],
  w: [{ c: [0, 0, 0], s: [G, G, T] }],
  win: WIN,
};
const RAMP_DIRS = { px: Math.PI / 2, nx: -Math.PI / 2, pz: 0, nz: Math.PI };

function geometryOf(kind) {
  if (kind === 'win') {
    const list = WIN.map(({ c, s }) => new THREE.BoxGeometry(...s).translate(...c));
    const pos = [], nor = [], uv = [], idx = [];
    let off = 0;
    for (const g of list) {
      pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
      idx.push(...[...g.index.array].map((i) => i + off));
      off += g.attributes.position.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  if (kind === 'r') return new THREE.BoxGeometry(G, T, G * Math.SQRT2);
  const [{ s }] = PARTS[kind];
  return new THREE.BoxGeometry(...s);
}

// Положение детали в мире: центр, поворот, коробки (AABB), поверхность рампы.
function placement(p) {
  const pos = new THREE.Vector3(), rot = new THREE.Euler(0, 0, 0, 'YXZ');
  let parts = [], ramp = null;
  if (p.t === 'f') {
    pos.set((p.ix + 0.5) * G, p.iy * G + 0.05 - T / 2, (p.iz + 0.5) * G);
    parts = PARTS.f;
  } else if (p.t === 'w') {
    if (p.o === 'x') pos.set((p.ix + 0.5) * G, p.iy * G + G / 2, p.iz * G);
    else { pos.set(p.ix * G, p.iy * G + G / 2, (p.iz + 0.5) * G); rot.y = Math.PI / 2; }
    parts = p.v === 'win' ? PARTS.win : PARTS.w;
  } else {
    pos.set((p.ix + 0.5) * G, p.iy * G + G / 2 + 0.05 - 0.21, (p.iz + 0.5) * G);
    rot.set(-Math.PI / 4, RAMP_DIRS[p.o], 0, 'YXZ');
    ramp = { ix: p.ix, iy: p.iy, iz: p.iz, dir: p.o };
  }
  const boxes = parts.map(({ c, s }) => {
    const turned = rot.y !== 0;
    const cx = turned ? c[2] : c[0], cz = turned ? -c[0] : c[2];
    const sx = turned ? s[2] : s[0], sz = turned ? s[0] : s[2];
    const ctr = new THREE.Vector3(pos.x + cx, pos.y + c[1], pos.z + cz);
    return { min: new THREE.Vector3(ctr.x - sx / 2, ctr.y - s[1] / 2, ctr.z - sz / 2), max: new THREE.Vector3(ctr.x + sx / 2, ctr.y + s[1] / 2, ctr.z + sz / 2) };
  });
  return { pos, rot, boxes, ramp };
}

// Высота рампы в точке (без обрезки по клетке).
function rampPlane(r, x, z) {
  const base = r.iy * G + 0.05;
  switch (r.dir) {
    case 'px': return base + (x - r.ix * G);
    case 'nx': return base + ((r.ix + 1) * G - x);
    case 'pz': return base + (z - r.iz * G);
    default: return base + ((r.iz + 1) * G - z);
  }
}
const inRampCell = (r, x, z, pad = 0) => x >= r.ix * G - pad && x <= (r.ix + 1) * G + pad && z >= r.iz * G - pad && z <= (r.iz + 1) * G + pad;

// Коробки объектов: ствол/камень/машина — для столкновений; крона — только для пуль.
function objectBoxes(o) {
  const b = (cx, y0, cz, hx, h, hz) => ({ min: new THREE.Vector3(cx - hx, y0, cz - hz), max: new THREE.Vector3(cx + hx, y0 + h, cz + hz) });
  const s = o.s;
  if (o.kind === 'oak') return { solid: [b(o.x, o.y, o.z, 0.45 * s, 3.4 * s, 0.45 * s)], soft: [b(o.x, o.y + 2.8 * s, o.z, 2.3 * s, 3.6 * s, 2.3 * s)] };
  if (o.kind === 'pine') return { solid: [b(o.x, o.y, o.z, 0.4 * s, 2.2 * s, 0.4 * s)], soft: [b(o.x, o.y + 1.9 * s, o.z, 1.9 * s, 5.8 * s, 1.9 * s)] };
  if (o.kind === 'rock') return { solid: [b(o.x, o.y, o.z, 1.0 * s, 1.15 * s, 1.0 * s)], soft: [] };
  const along = Math.abs(Math.sin(o.rot)) < 0.5;
  return { solid: [b(o.x, o.y, o.z, along ? 2.1 : 1.0, 1.9, along ? 1.0 : 2.1)], soft: [] };
}

export function createStructures({ scene }) {
  let map = null;
  const pieces = new Map();          // k → entry
  const objects = [];                // entry (по индексу)
  const grid = new Map();            // "cx,cz" → Set(entry)
  const batches = new Map();         // вид|материал → { mesh, free, next }
  const objMeshes = new Map();       // вид → InstancedMesh
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V1 = new THREE.Vector3(1, 1, 1), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const C = new THREE.Color();

  // ---------- Отрисовка ----------

  const mats = Object.fromEntries(MATS.map((m) => [m, toon(0xffffff, { map: buildTexture(m) })]));
  const CAP = 3000;
  function batch(kind, m) {
    const key = `${kind}|${m}`;
    if (!batches.has(key)) {
      const mesh = new THREE.InstancedMesh(geometryOf(kind), mats[m], CAP);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, C.set(0xffffff));
      scene.add(mesh);
      batches.set(key, { mesh, free: [] });
    }
    return batches.get(key);
  }
  function show(e) {
    const kind = e.t === 'r' ? 'r' : e.t === 'w' && e.v === 'win' ? 'win' : e.t;
    const b = batch(kind, e.m);
    const i = b.free.length ? b.free.pop() : b.mesh.count++;
    M.compose(e.place.pos, Q.setFromEuler(e.place.rot), V1);
    b.mesh.setMatrixAt(i, M);
    b.mesh.setColorAt(i, C.set(e.tint ?? MAT_INFO[e.m].tint));
    b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.instanceColor.needsUpdate = true;
    e.inst = { b, i };
  }
  function hide(e) {
    if (!e.inst) return;
    const { b, i } = e.inst;
    b.mesh.setMatrixAt(i, ZERO);
    b.mesh.instanceMatrix.needsUpdate = true;
    b.free.push(i);
    e.inst = null;
  }

  function objMesh(kind, count) {
    const geo = kind === 'oak' ? oakGeometry() : kind === 'pine' ? pineGeometry() : kind === 'rock' ? rockGeometry() : kind === 'bush' ? bushGeometry() : carGeometry(CAR_COLORS[+kind.slice(3)]);
    const mesh = new THREE.InstancedMesh(geo, vcMaterial(), Math.max(1, count));
    mesh.frustumCulled = false;
    mesh.castShadow = kind !== 'bush';
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
  function objMatrix(o, on) {
    if (!on) return ZERO;
    return M.compose(new THREE.Vector3(o.x, o.y, o.z), Q.setFromEuler(new THREE.Euler(0, o.rot, 0)), new THREE.Vector3(o.s, o.s, o.s));
  }

  // ---------- Пространственная сетка ----------

  function cellsOf(e) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    const all = [...(e.boxes || []), ...(e.soft || [])];
    for (const b of all) { minx = Math.min(minx, b.min.x); maxx = Math.max(maxx, b.max.x); minz = Math.min(minz, b.min.z); maxz = Math.max(maxz, b.max.z); }
    if (e.ramp) { minx = e.ramp.ix * G; maxx = minx + G; minz = e.ramp.iz * G; maxz = minz + G; }
    const out = [];
    for (let cx = Math.floor(minx / G - 0.01); cx <= Math.floor(maxx / G + 0.01); cx++) for (let cz = Math.floor(minz / G - 0.01); cz <= Math.floor(maxz / G + 0.01); cz++) out.push(`${cx},${cz}`);
    return out;
  }
  function index(e) { e.cells = cellsOf(e); for (const k of e.cells) { if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(e); } }
  function unindex(e) { for (const k of e.cells || []) grid.get(k)?.delete(e); e.cells = null; }
  function near(minx, maxx, minz, maxz) {
    const out = new Set();
    for (let cx = Math.floor(minx / G); cx <= Math.floor(maxx / G); cx++) for (let cz = Math.floor(minz / G); cz <= Math.floor(maxz / G); cz++) {
      const s = grid.get(`${cx},${cz}`);
      if (s) for (const e of s) out.add(e);
    }
    return out;
  }

  // ---------- Детали ----------

  function addPiece(spec, gen = false) {
    const k = spec.k || pieceKey(spec);
    if (pieces.has(k)) return null;
    const place = placement(spec);
    const max = MAT_INFO[spec.m].hp;
    const e = { ...spec, k, kind: 'piece', gen, hp: spec.hp ?? max, max, place, boxes: place.boxes, ramp: place.ramp };
    pieces.set(k, e);
    index(e);
    show(e);
    return e;
  }
  function removeEntry(e) {
    if (e.kind === 'piece') { hide(e); unindex(e); pieces.delete(e.k); }
    else { e.hp = 0; unindex(e); e.mesh.setMatrixAt(e.inst, ZERO); e.mesh.instanceMatrix.needsUpdate = true; }
  }
  const entryOf = (k) => (k.startsWith('o:') ? objects[+k.slice(2)] : pieces.get(k));

  // Урон по детали/объекту. Возвращает { e, destroyed } или null.
  function damage(k, dmg) {
    const e = entryOf(k);
    if (!e || e.hp <= 0) return null;
    e.hp -= dmg;
    if (e.hp <= 0) { removeEntry(e); return { e, destroyed: true }; }
    return { e, destroyed: false };
  }

  // ---------- Загрузка / раунд ----------

  function reset() {
    for (const e of [...pieces.values()]) { hide(e); unindex(e); }
    pieces.clear();
    for (const b of batches.values()) { b.mesh.count = 0; b.free.length = 0; }
    grid.clear();
    for (const p of map.pieces) addPiece(p, true);
    for (const o of objects) {
      o.hp = o.max;
      o.mesh.setMatrixAt(o.inst, objMatrix(o, true));
      o.mesh.instanceMatrix.needsUpdate = true;
      index(o);
    }
  }

  function load(m) {
    map = m;
    for (const mesh of objMeshes.values()) { scene.remove(mesh); mesh.dispose(); }
    objMeshes.clear();
    objects.length = 0;
    const kinds = new Map();
    const keyOf = (o) => (o.kind === 'car' ? `car${o.color}` : o.kind);
    for (const o of [...map.objects, ...map.decor]) kinds.set(keyOf(o), (kinds.get(keyOf(o)) || 0) + 1);
    for (const [k, n] of kinds) objMeshes.set(k, objMesh(k, n));
    const used = new Map();
    const take = (k) => { const i = used.get(k) || 0; used.set(k, i + 1); return i; };
    map.objects.forEach((o, i) => {
      const mesh = objMeshes.get(keyOf(o));
      const { solid, soft } = objectBoxes(o);
      objects.push({ ...o, k: `o:${i}`, kind: 'obj', type: o.kind, hp: OBJ[o.kind].hp, max: OBJ[o.kind].hp, boxes: solid, soft, mesh, inst: take(keyOf(o)) });
    });
    for (const d of map.decor) { const mesh = objMeshes.get('bush'); const i = take('bush'); mesh.setMatrixAt(i, objMatrix(d, true)); mesh.instanceMatrix.needsUpdate = true; }
    reset();
  }

  // ---------- Физика ----------

  // Высота опоры под точкой: рельеф, верх коробок не выше y+STEP, рампа.
  function ground(x, z, y, r = 0.3) {
    let g = Math.max(map.height(x, z), map.height(x + r, z), map.height(x - r, z), map.height(x, z + r), map.height(x, z - r));
    for (const e of near(x - r, x + r, z - r, z + r)) {
      if (e.ramp) {
        if (inRampCell(e.ramp, x, z)) { const s = rampPlane(e.ramp, x, z); if (s <= y + STEP && s > g) g = s; }
        continue;
      }
      for (const b of e.boxes) {
        if (x + r <= b.min.x || x - r >= b.max.x || z + r <= b.min.z || z - r >= b.max.z) continue;
        if (b.max.y <= y + STEP && b.max.y > g) g = b.max.y;
      }
    }
    return g;
  }

  // Упирается ли игрок (ноги в y, рост h, полуширина r) в стену/объект или крутой склон.
  function blocked(x, y, z, h = 1.8, r = 0.3) {
    if (map.height(x, z) > y + 1.1) return true;
    for (const e of near(x - r, x + r, z - r, z + r)) {
      for (const b of e.boxes) {
        if (x + r <= b.min.x || x - r >= b.max.x || z + r <= b.min.z || z - r >= b.max.z) continue;
        if (b.max.y > y + STEP && b.min.y < y + h) return true;
      }
    }
    return false;
  }

  // Потолок: самая низкая коробка над головой, в которую упрёмся, поднимаясь с y до ny.
  function ceiling(x, y, ny, z, h = 1.8, r = 0.3) {
    let top = Infinity;
    for (const e of near(x - r, x + r, z - r, z + r)) for (const b of e.boxes) {
      if (x + r <= b.min.x || x - r >= b.max.x || z + r <= b.min.z || z - r >= b.max.z) continue;
      if (b.min.y >= y + h - 0.05 && b.min.y < ny + h) top = Math.min(top, b.min.y - h);
    }
    return top;
  }

  // Точка внутри чего-то твёрдого (для ракет).
  function solidAt(p) {
    if (p.y < map.height(p.x, p.z) || p.y < WATER_Y + 0.1) return true;
    for (const e of near(p.x, p.x, p.z, p.z)) {
      if (e.ramp) { if (inRampCell(e.ramp, p.x, p.z) && Math.abs(p.y - rampPlane(e.ramp, p.x, p.z)) < 0.35) return true; continue; }
      for (const b of [...e.boxes, ...(e.soft || [])]) if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return true;
    }
    return false;
  }

  // Луч: ближайшее попадание в деталь/объект/рельеф. { t, e (или null — рельеф), point }.
  function raycast(o, d, range) {
    let best = range, hitE = null, any = false;
    const seen = new Set();
    for (let t = 0; t <= range + G; t += G / 2) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      for (const e of near(x - 0.1, x + 0.1, z - 0.1, z + 0.1)) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (e.ramp) {
          const r = e.ramp, a = r.dir;
          const k = a === 'px' ? d.x : a === 'nx' ? -d.x : a === 'pz' ? d.z : -d.z;
          const B = d.y - k, A = o.y - rampPlane(r, o.x, o.z);
          if (Math.abs(B) < 1e-6) continue;
          const tt = -A / B;
          if (tt < 0 || tt >= best) continue;
          if (inRampCell(r, o.x + d.x * tt, o.z + d.z * tt)) { best = tt; hitE = e; any = true; }
          continue;
        }
        for (const b of [...e.boxes, ...(e.soft || [])]) {
          const tt = rayBox(o, d, b.min, b.max);
          if (tt < best) { best = tt; hitE = e; any = true; }
        }
      }
      if (t > best) break;
    }
    // Рельеф: шагаем по лучу, уточняем делением пополам.
    let prev = 0;
    for (let t = 0.5; t <= best; t += 0.5) {
      const y = o.y + d.y * t;
      if (y < map.height(o.x + d.x * t, o.z + d.z * t) || y < WATER_Y - 0.5) {
        let lo = prev, hi = t;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (o.y + d.y * m < map.height(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
        return { t: hi, e: null, point: o.clone().addScaledVector(d, hi) };
      }
      prev = t;
    }
    return any ? { t: best, e: hitE, point: o.clone().addScaledVector(d, best) } : null;
  }

  // Взрыв: урон всему в радиусе (по ближайшей точке коробки). Возвращает [[k, урон]].
  function blast(p, R, dmg) {
    const out = [];
    for (const e of near(p.x - R, p.x + R, p.z - R, p.z + R)) {
      if (e.hp <= 0) continue;
      let dmin = Infinity;
      if (e.ramp) dmin = Math.hypot(p.x - (e.ramp.ix + 0.5) * G, p.y - (e.ramp.iy + 0.5) * G, p.z - (e.ramp.iz + 0.5) * G) - 1.5;
      for (const b of [...e.boxes, ...(e.soft || [])]) {
        const cx = Math.max(b.min.x, Math.min(p.x, b.max.x)), cy = Math.max(b.min.y, Math.min(p.y, b.max.y)), cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        dmin = Math.min(dmin, Math.hypot(p.x - cx, p.y - cy, p.z - cz));
      }
      if (dmin < R) out.push([e.k, Math.round(dmg * (1 - Math.max(0, dmin) / R * 0.5))]);
    }
    return out;
  }

  // ---------- Стройка: куда встанет деталь ----------

  const rampUnder = (x, y, z) => {
    for (const e of near(x, x, z, z)) if (e.ramp && inRampCell(e.ramp, x, z) && Math.abs(rampPlane(e.ramp, x, z) - y) < 0.4) return e.ramp;
    return null;
  };

  // Деталь типа t ('w' | 'f' | 'r') перед игроком: по клетке, где он стоит, и направлению взгляда.
  function plan(t, feet, yaw, pitch, m) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const alongX = Math.abs(fx) > Math.abs(fz);
    const s = alongX ? Math.sign(fx) : Math.sign(fz);
    const cx = Math.floor(feet.x / G), cz = Math.floor(feet.z / G);
    let iy = Math.floor((feet.y + 0.35) / G);
    const under = rampUnder(feet.x, feet.y, feet.z);
    const dir = alongX ? (s > 0 ? 'px' : 'nx') : (s > 0 ? 'pz' : 'nz');
    const nx = cx + (alongX ? s : 0), nz = cz + (alongX ? 0 : s);
    let spec;
    if (t === 'w') {
      if (pitch > 0.55) iy++;
      spec = alongX ? { t: 'w', o: 'z', ix: s > 0 ? cx + 1 : cx, iy, iz: cz } : { t: 'w', o: 'x', ix: cx, iy, iz: s > 0 ? cz + 1 : cz };
    } else if (t === 'f') {
      if (pitch < -0.75) spec = { t: 'f', ix: cx, iy, iz: cz };
      else if (pitch > 0.55) spec = { t: 'f', ix: cx, iy: iy + 1, iz: cz };
      else spec = { t: 'f', ix: nx, iy, iz: nz };
    } else {
      // на рампе того же направления — следующая продолжает её с верхнего края
      if (under && under.dir === dir) iy = under.iy + 1;
      spec = { t: 'r', ix: nx, iy, iz: nz, o: dir };
    }
    spec.m = m;
    spec.k = pieceKey(spec);
    return spec;
  }

  // Призрак детали: полупрозрачный синий (красный — не хватает материалов).
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x4fb4ff, transparent: true, opacity: 0.38, depthWrite: false });
  const ghosts = Object.fromEntries(['f', 'w', 'r'].map((k) => {
    const m = new THREE.Mesh(geometryOf(k), ghostMat);
    m.visible = false;
    scene.add(m);
    return [k, m];
  }));
  function ghost(spec, ok) {
    for (const g of Object.values(ghosts)) g.visible = false;
    if (!spec) return;
    const g = ghosts[spec.t];
    const p = placement(spec);
    g.position.copy(p.pos);
    g.rotation.copy(p.rot);
    g.visible = true;
    ghostMat.color.set(ok ? 0x4fb4ff : 0xff5a5a);
  }

  // ---------- Сеть ----------

  // Отличия от сгенерированного: построенное игроками, повреждённое и сломанное.
  function syncList() {
    const out = [];
    for (const e of pieces.values()) {
      if (!e.gen) out.push([e.k, e.t, e.ix, e.iy, e.iz, e.o || '', e.m, e.hp]);
      else if (e.hp < e.max) out.push([e.k, e.hp]);
    }
    for (const p of map.pieces) if (!pieces.has(p.k)) out.push([p.k, 0]);
    for (const o of objects) if (o.hp < o.max) out.push([o.k, Math.max(0, o.hp)]);
    return out;
  }
  function applySync(list) {
    for (const row of list) {
      if (row.length > 2) {
        const [k, t, ix, iy, iz, o, m, hp] = row;
        if (!pieces.has(k)) addPiece({ k, t, ix, iy, iz, o: o || undefined, m, hp });
        continue;
      }
      const [k, hp] = row;
      const e = entryOf(k);
      if (!e || e.hp <= 0) continue;
      if (hp <= 0) removeEntry(e); else e.hp = Math.min(e.hp, hp);
    }
  }

  return {
    load, reset,
    get pieces() { return pieces; },
    get objects() { return objects; },
    has: (k) => { const e = entryOf(k); return !!e && e.hp > 0; },
    add: (spec) => addPiece(spec),
    damage,
    harvestOf(e, destroyed) {
      if (e.kind === 'piece') return { mat: e.m, n: PIECE_HARVEST };
      const o = OBJ[e.type];
      return { mat: o.mat, n: o.per + (destroyed ? o.bonus : 0) };
    },
    ground, blocked, ceiling, solidAt, raycast, blast, plan, ghost,
    syncList, applySync,
  };
}
