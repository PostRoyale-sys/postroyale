// Roadster: электрический гиперкар на газовых двигателях. В каждом раунде на острове CARS_PER_ROUND машин (места —
// от сида мира и номера раунда, у всех одинаковые), над стоящей — маяк. E — сесть/выйти.
//   W/S — газ/тормоз, A/D — руль, Shift — буст (0–100 км/ч меньше чем за секунду — время показываем),
//   Space — прыжок на двигателях (с A/D — кикфлип), зажать Space в воздухе — зависание, пока есть топливо.
// Едет и по воде (двигатели держат над волнами). Сеть: водитель шлёт в позе cv = [x, y, z, yaw, pitch, roll, id] —
// остальные ставят машину туда; вышел — машина остаётся там, где её видели последней.

import * as THREE from 'three';
import { MAP, WATER_Y, rng, seedOf } from './map.js';
import { toon, outlineGroup } from './art.js';

export const CARS_PER_ROUND = 3;
export const CAR = {
  MAX: 44, BOOST_MAX: 62, REVERSE: 14,   // м/с (44 ≈ 160 км/ч, 62 ≈ 220 км/ч)
  ACC: 16, BOOST_ACC: 34,                 // м/с² — с бустом 0–100 км/ч ≈ 0.82 с
  BRAKE: 55, DRAG: 0.5, STEER: 2.3,
  HOP: 15, HOP_CD: 0.9, GRAV: 30, HOVER_G: 4, FUEL: 2.4, FLIP: 0.75,
  R: 1.0, H: 1.15,                        // полуширина и высота для столкновений
  ENTER: 3.4,                             // с какого расстояния можно сесть
};

// ---------- Модель ----------
// Низкий клин, красный с белой полосой, тёмное стекло, крыло; бирюзовые сопла сзади и по углам днища.
function carModel() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const red = toon(0xe8202a, { emissive: 0x2a0004 }), white = toon(0xf4f4f4), black = toon(0x16181d), glass = toon(0x0d1622, { emissive: 0x040a14 });
  // кузов — профиль сбоку (z — вдоль, y — вверх), выдавленный по ширине: низкий нос, длинный капот, покатая крыша
  const profile = (pts, width, mat, y0 = 0) => {
    const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));   // −z: после поворота нос — к −Z
    const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
    geo.rotateY(Math.PI / 2); geo.translate(-width / 2, y0, 0);
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; body.add(m); return m;
  };
  profile([[-2.25, 0.3], [-2.25, 0.55], [-1.2, 0.78], [-0.35, 0.86], [0.3, 0.92], [1.5, 0.9], [2.2, 0.82], [2.25, 0.3]], 1.96, red);
  // стеклянный «пузырь» кабины: лобовое, крыша, заднее стекло — одним куском, уже кузова
  profile([[-0.55, 0.82], [0.05, 1.22], [0.75, 1.24], [1.55, 0.9]], 1.36, glass);
  const box = (w, h, d, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = true; body.add(b); return b; };
  box(0.36, 0.03, 1.4, white, 0, 0.85, -1.0, -0.14);       // полоса по капоту
  box(0.36, 0.03, 0.7, white, 0, 0.93, 1.85, 0.08);        // и по корме
  box(2.08, 0.06, 0.42, black, 0, 1.12, 2.0);              // крыло
  box(0.07, 0.26, 0.16, black, -0.7, 0.98, 2.0); box(0.07, 0.26, 0.16, black, 0.7, 0.98, 2.0);
  box(2.04, 0.1, 0.3, black, 0, 0.32, -2.2);               // сплиттер
  box(2.0, 0.14, 0.3, black, 0, 0.36, 2.25);               // диффузор
  box(0.06, 0.16, 2.6, black, -1.02, 0.42, 0); box(0.06, 0.16, 2.6, black, 1.02, 0.42, 0);   // пороги
  // фары и стопы — светящиеся полоски
  const glow = (c) => new THREE.MeshBasicMaterial({ color: c });
  const strip = (w, c, z) => { const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.04), glow(c)); s.position.set(0, z < 0 ? 0.52 : 0.72, z); body.add(s); };
  strip(1.6, 0xeaf6ff, -2.3); strip(1.8, 0xff2a3a, 2.3);
  // колёса
  const wheels = [];
  const wGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18); wGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.36, 10); rimGeo.rotateZ(Math.PI / 2);
  const tire = toon(0x1a1a1e), rim = toon(0xcfd6e0, { emissive: 0x202830 });
  for (const [x, z] of [[-0.98, -1.4], [0.98, -1.4], [-0.98, 1.45], [0.98, 1.45]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(wGeo, tire), new THREE.Mesh(rimGeo, rim));
    w.position.set(x, 0.42, z);
    body.add(w); wheels.push(w);
  }
  outlineGroup(body, 0.03);
  // сопла двигателей и их пламя (видны при прыжке/зависании/бусте)
  const nozzle = toon(0x2a2f38), plumeMat = new THREE.MeshBasicMaterial({ color: 0x6ff7ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const plumeGeo = new THREE.ConeGeometry(0.2, 1, 10); plumeGeo.translate(0, -0.5, 0);
  const plumes = [];
  const thruster = (x, y, z, dir) => {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 10), nozzle);
    n.position.set(x, y, z);
    if (dir === 'back') n.rotation.x = Math.PI / 2;
    body.add(n);
    const p = new THREE.Mesh(plumeGeo, plumeMat);
    p.position.set(x, y, z);
    if (dir === 'back') p.rotation.x = -Math.PI / 2;   // конус «вниз» → назад
    p.visible = false;
    p.userData.dir = dir;
    body.add(p); plumes.push(p);
  };
  thruster(-0.5, 0.55, 2.36, 'back'); thruster(0.5, 0.55, 2.36, 'back');
  for (const [x, z] of [[-0.75, -1.9], [0.75, -1.9], [-0.75, 1.95], [0.75, 1.95]]) thruster(x, 0.3, z, 'down');
  // подсветка днища
  const under = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.2), new THREE.MeshBasicMaterial({ color: 0x40e8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  under.rotation.x = -Math.PI / 2; under.position.y = 0.05;
  body.add(under);
  // маяк над стоящей машиной
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x40e8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 31;
  g.add(beam);
  g.userData = { body, wheels, plumes, beam, under };
  return g;
}

// ---------- Машины раунда ----------

export function createRoadsters(scene) {
  const root = new THREE.Group();
  scene.add(root);
  let cars = [];          // { id, group, pos, yaw, pitch, roll, driver, seen, spin, thrust }
  let world = null, structures = null;

  function clear() {
    for (const c of cars) root.remove(c.group);
    cars = [];
  }

  // Новый раунд: расставить заново (ровная открытая земля у городов).
  function place(w, st, round) {
    clear();
    world = w; structures = st;
    const rand = rng(seedOf(w.id) ^ 0xca75 ^ Math.imul(round + 3, 2654435761));
    const ok = (x, z) => {
      if (x < 20 || z < 20 || x > MAP - 20 || z > MAP - 20) return null;
      const h = w.height(x, z);
      if (h < WATER_Y + 1.2) return null;
      for (const [dx, dz] of [[2.5, 0], [-2.5, 0], [0, 3], [0, -3]]) if (Math.abs(w.height(x + dx, z + dz) - h) > 0.5) return null;
      if (Math.abs(st.ground(x, z, h + 30, 1.2) - h) > 0.25 || st.blocked(x, h + 0.2, z, 1.2, 1.4)) return null;
      if (cars.some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 40)) return null;
      return h;
    };
    const pois = [...(w.pois || [])];
    for (let n = 0, tries = 0; n < CARS_PER_ROUND && tries < 400; tries++) {
      const p = pois.length ? pois[Math.floor(rand() * pois.length)] : { x: MAP / 2, z: MAP / 2 };
      const a = rand() * Math.PI * 2, d = 10 + rand() * 30;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d, y = ok(x, z);
      if (y === null) continue;
      const group = carModel();
      root.add(group);
      cars.push({ id: n, group, pos: new THREE.Vector3(x, y, z), yaw: rand() * Math.PI * 2, pitch: 0, roll: 0, driver: null, seen: 0, spin: 0, thrust: 0, boost: 0 });
      n++;
    }
    for (const c of cars) draw(c, 0);
  }

  function draw(c, dt) {
    const u = c.group.userData;
    c.group.position.copy(c.pos);
    c.group.rotation.set(0, c.yaw, 0, 'YXZ');
    u.body.rotation.set(c.pitch, 0, c.roll, 'YXZ');
    for (const w of u.wheels) w.rotation.x -= c.spin * dt / 0.42;
    for (const p of u.plumes) {
      const on = p.userData.dir === 'down' ? c.thrust : c.boost;
      p.visible = on > 0.05;
      if (p.visible) p.scale.set(1, (0.6 + Math.random() * 0.5) * (0.6 + on), 1);
    }
    u.beam.visible = !c.driver;
    u.under.material.opacity = 0.2 + c.thrust * 0.5;
  }

  return {
    get list() { return cars; },
    place, clear,
    // Свободная машина рядом (для подсказки «E — сесть»).
    near(p) {
      let best = null, bd = CAR.ENTER;
      for (const c of cars) {
        if (c.driver) continue;
        const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
        if (d < bd && Math.abs(c.pos.y - p.y) < 2.5) { bd = d; best = c; }
      }
      return best;
    },
    // Машины других водителей — из их поз (cv). drivers: Map id → cv (только свежие позы).
    sync(drivers, myCar) {
      const taken = new Map();
      for (const [pid, cv] of drivers) if (Array.isArray(cv) && cars[cv[6]]) taken.set(cv[6], [pid, cv]);
      for (const c of cars) {
        if (c === myCar) continue;
        const t = taken.get(c.id);
        if (t) {
          const [pid, cv] = t;
          c.driver = pid;
          const to = new THREE.Vector3(cv[0], cv[1], cv[2]);
          const d = c.pos.distanceTo(to);
          c.spin = c.spin * 0.8 + (d / 0.016) * 0.2;
          c.pos.lerp(to, d > 20 ? 1 : 0.35);
          c.yaw = cv[3]; c.pitch = cv[4]; c.roll = cv[5];
          c.thrust = cv[7] || 0; c.boost = cv[8] || 0;
        } else if (c.driver && c.driver !== 'me') { c.driver = null; c.spin = 0; c.thrust = 0; c.boost = 0; }
      }
      return taken;
    },
    update(dt) { for (const c of cars) draw(c, dt); },
    marks() { return cars.filter((c) => !c.driver).map((c) => ({ kind: 'car', x: c.pos.x, z: c.pos.z })); },

    // ---------- Своя машина: физика ----------
    // input: { thr: -1..1, steer: -1..1, boost, hop (нажал Space), hold (держит Space) } → события для звука/эффектов.
    drive(c, dt, input, st) {
      const ev = {};
      const fwd = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
      const air = !st.ground;
      st.hopCd = Math.max(0, (st.hopCd || 0) - dt);
      // газ, тормоз, руль
      const max = input.boost ? CAR.BOOST_MAX : CAR.MAX;
      if (!air) {
        if (input.thr > 0) st.speed += (st.speed < 0 ? CAR.BRAKE : input.boost ? CAR.BOOST_ACC : CAR.ACC) * dt;
        else if (input.thr < 0) st.speed -= (st.speed > 0 ? CAR.BRAKE : CAR.ACC * 0.6) * dt;
        else st.speed *= Math.max(0, 1 - CAR.DRAG * dt);
        if (st.speed > max) st.speed += (max - st.speed) * Math.min(1, dt * 2);
        st.speed = Math.max(-CAR.REVERSE, st.speed);
      } else st.speed *= Math.max(0, 1 - 0.08 * dt);
      const grip = air ? 0.5 : Math.min(1, Math.abs(st.speed) / 6) * (1 - 0.45 * Math.min(1, Math.abs(st.speed) / CAR.BOOST_MAX));
      c.yaw += input.steer * CAR.STEER * grip * dt * (st.speed < -0.5 ? -1 : 1);
      // прыжок на двигателях; с рулём — кикфлип
      if (input.hop && !air && st.hopCd <= 0) {
        st.vy = CAR.HOP; st.ground = false; st.hopCd = CAR.HOP_CD;
        if (input.steer) { st.flip = CAR.FLIP; st.flipDir = input.steer > 0 ? 1 : -1; ev.flip = true; }
        ev.hop = true;
      }
      // зависание: держит Space в воздухе — двигатели почти гасят гравитацию, пока есть топливо
      const hover = air && input.hold && st.fuel > 0 && st.vy < 4;
      if (hover) st.fuel = Math.max(0, st.fuel - dt);
      else if (!air) st.fuel = Math.min(CAR.FUEL, st.fuel + dt * 0.8);
      c.thrust += ((hover ? 1 : ev.hop ? 1 : 0) - c.thrust) * Math.min(1, dt * (ev.hop ? 30 : 8));
      c.boost += ((input.boost && input.thr > 0 ? 1 : 0) - c.boost) * Math.min(1, dt * 8);
      if (ev.hop) c.thrust = 1;
      // движение с проверкой стен (шагами, по осям)
      const move = fwd.clone().multiplyScalar(st.speed * dt);
      const n = Math.max(1, Math.ceil(move.length() / 0.4));
      const sx = move.x / n, sz = move.z / n;
      let hitWall = false;
      for (let i = 0; i < n; i++) {
        const bx = this.blockedAt(c.pos.x + sx, c.pos.y, c.pos.z), bz = this.blockedAt(c.pos.x, c.pos.y, c.pos.z + sz);
        if (!bx) c.pos.x += sx; if (!bz) c.pos.z += sz;
        if (bx || bz) hitWall = true;
        if (bx && bz) break;
      }
      if (hitWall && Math.abs(st.speed) > 4) { ev.crash = Math.abs(st.speed); st.speed *= -0.3; }
      c.pos.x = Math.max(-40, Math.min(MAP + 40, c.pos.x));
      c.pos.z = Math.max(-40, Math.min(MAP + 40, c.pos.z));
      // вертикаль: гравитация (или зависание), земля, вода (двигатели держат над водой)
      st.vy -= (hover ? CAR.HOVER_G : CAR.GRAV) * dt;
      let ny = c.pos.y + st.vy * dt;
      const g = Math.max(structures.ground(c.pos.x, c.pos.z, Math.max(c.pos.y, ny) + 0.3, CAR.R * 0.8), WATER_Y - 0.15);
      if (ny <= g || (st.ground && st.vy <= 0 && c.pos.y - g < 0.9)) {
        if (!st.ground && st.vy < -9) ev.land = -st.vy;
        ny = g; st.vy = 0; st.ground = true;
      } else st.ground = false;
      c.pos.y = ny;
      ev.water = st.ground && c.pos.y < WATER_Y + 0.05;          // едет по воде (двигатели держат над волнами)
      // наклон по склону и кикфлип
      if (st.ground) {
        const f = 1.6, h0 = world.height(c.pos.x + fwd.x * f, c.pos.z + fwd.z * f), h1 = world.height(c.pos.x - fwd.x * f, c.pos.z - fwd.z * f);
        const side = new THREE.Vector3(-fwd.z, 0, fwd.x), s0 = world.height(c.pos.x + side.x, c.pos.z + side.z), s1 = world.height(c.pos.x - side.x, c.pos.z - side.z);
        const tp = ev.water ? 0 : Math.atan2(h0 - h1, f * 2), tr = ev.water ? 0 : Math.atan2(s0 - s1, 2) * -1;
        c.pitch += (tp - c.pitch) * Math.min(1, dt * 10);
        c.roll += (tr - c.roll) * Math.min(1, dt * 10);
      } else c.pitch += (-st.vy * 0.012 - c.pitch) * Math.min(1, dt * 3);
      if (st.flip > 0) {
        st.flip = Math.max(0, st.flip - dt);
        const k = 1 - st.flip / CAR.FLIP, e = k * k * (3 - 2 * k);
        c.roll = st.flipDir * Math.PI * 2 * e;
        if (st.flip === 0) c.roll = 0;
      } else if (!st.ground) c.roll += (input.steer * -0.25 - c.roll) * Math.min(1, dt * 4);
      c.spin = st.ground ? st.speed : c.spin * 0.98;
      return ev;
    },
    blockedAt(x, y, z) {
      if (world.height(x, z) > y + 1.3 && world.height(x, z) > WATER_Y) return true;         // крутой склон
      return structures.blocked(x, y + 0.5, z, CAR.H - 0.5, CAR.R);
    },
  };
}
