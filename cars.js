// Машины. ПКМ с предметом «Car» — поставить свою машину, E рядом — сесть/выйти, W/S газ/тормоз, A/D руль.
// Физику считает только водитель и рассылает состояние ~10 раз в секунду; остальные плавно догоняют.
// Стоящую машину раз в пару секунд объявляет владелец (чтобы новички её видели). Здоровье машины — у владельца:
// он принимает урон и при нуле взрывает её у всех (car { gone }).

import * as THREE from 'three';
import { SX, SZ, WATER_Y } from './voxel.js';

const MAX_SPEED = 17, MAX_BACK = 6, ACCEL = 14, BRAKE = 26, DRAG = 3.2, TURN = 2.3;
const LEN = 3.4, WID = 1.9;         // габариты кузова
const CLIMB = 1.1;                  // на сколько блоков въезжаем без прыжка
const MAX_PER_PLAYER = 3;
const RUNOVER_SPEED = 6, RUNOVER_DMG = 40;
const COLORS = [0xf4212e, 0x1d9bf0, 0xffad1f, 0x16c784, 0xa970ff, 0xffffff, 0x222222];

export function createCars(ctx) {
  const { scene } = ctx;
  const cars = new Map();      // id → car
  let mine = null;             // машина, в которой я за рулём
  let seq = 0, lastSend = 0, lastHeartbeat = 0;
  const runoverCooldown = new Map();

  // ---------- Модель ----------

  function model(color) {
    const g = new THREE.Group();
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const body = new THREE.Mesh(new THREE.BoxGeometry(WID, 0.6, LEN), lam(color));
    body.position.y = 0.65;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(WID * 0.85, 0.55, LEN * 0.45), lam(0x1a2733));
    cabin.position.set(0, 1.2, 0.15);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(WID * 0.88, 0.08, LEN * 0.48), lam(color));
    roof.position.set(0, 1.5, 0.15);
    const lights = new THREE.Mesh(new THREE.BoxGeometry(WID * 0.8, 0.18, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
    lights.position.set(0, 0.75, -LEN / 2 - 0.01);
    g.add(body, cabin, roof, lights);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.6), lam(0x111111));
      w.position.set(x * (WID / 2), 0.3, z * (LEN / 2 - 0.6));
      g.add(w);
    }
    return g;
  }

  function make(s) {
    const car = {
      id: s.id, owner: s.o, color: s.c, hp: s.hp ?? 100, driver: s.d || null,
      pos: new THREE.Vector3(s.x, s.y, s.z), yaw: s.r || 0, speed: 0, vy: 0,
      target: { x: s.x, y: s.y, z: s.z, r: s.r || 0 }, seen: performance.now(),
      group: model(s.c),
    };
    car.group.position.copy(car.pos);
    car.group.rotation.y = car.yaw;
    scene.add(car.group);
    cars.set(car.id, car);
    return car;
  }

  function remove(id, boom) {
    const car = cars.get(id);
    if (!car) return;
    if (boom) ctx.explodeFx(car.pos.clone().add(new THREE.Vector3(0, 0.8, 0)));
    scene.remove(car.group);
    cars.delete(id);
    if (mine?.id === id) { mine = null; ctx.exitCar(car.pos); }
  }

  const stateOf = (car) => ({
    id: car.id, o: car.owner, c: car.color, hp: Math.round(car.hp), d: car.driver,
    x: +car.pos.x.toFixed(2), y: +car.pos.y.toFixed(2), z: +car.pos.z.toFixed(2), r: +car.yaw.toFixed(3),
  });
  const send = (car, target) => ctx.net()?.car(stateOf(car), target);

  // ---------- Земля и стены ----------

  // Верх самого высокого твёрдого блока не выше fromY (кроны деревьев над машиной не считаются землёй).
  function groundBelow(x, z, fromY) {
    const w = ctx.world();
    for (let y = Math.floor(fromY); y >= 0; y--) if (w.solid(Math.floor(x), y, Math.floor(z))) return y + 1;
    return 0;
  }

  // Препятствие в полосе высоты кузова над будущей «землёй».
  function blocked(x, z, ground) {
    const w = ctx.world();
    for (let y = Math.floor(ground + 0.05); y <= Math.floor(ground + 1.6); y++) {
      if (w.solid(Math.floor(x), y, Math.floor(z))) return true;
    }
    return false;
  }

  // Точки корпуса: нос, зад, середина — по ним проверяем, можно ли ехать.
  function probes(pos, yaw) {
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    return [0.45, 0, -0.45].map((k) => pos.clone().addScaledVector(f, k * LEN));
  }

  // ---------- Езда ----------

  function drive(dt, keys) {
    const car = mine;
    const up = keys.has('KeyW') || keys.has('ArrowUp');
    const down = keys.has('KeyS') || keys.has('ArrowDown');
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');

    if (up) car.speed += (car.speed < 0 ? BRAKE : ACCEL) * dt;
    else if (down) car.speed -= (car.speed > 0 ? BRAKE : ACCEL) * dt;
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), DRAG * dt);
    if (car.pos.y < WATER_Y + 0.5) car.speed *= 0.96;                   // в воде вязнем
    car.speed = Math.max(-MAX_BACK, Math.min(MAX_SPEED, car.speed));

    const steer = (left ? 1 : 0) - (right ? 1 : 0);
    car.yaw += steer * TURN * dt * Math.min(1, Math.abs(car.speed) / 4) * Math.sign(car.speed || 1);

    const f = new THREE.Vector3(-Math.sin(car.yaw), 0, -Math.cos(car.yaw));
    const next = car.pos.clone().addScaledVector(f, car.speed * dt);
    next.x = Math.max(1, Math.min(SX - 1, next.x));
    next.z = Math.max(1, Math.min(SZ - 1, next.z));

    // Можно ли туда: под каждой точкой корпуса земля не выше чем на CLIMB и нет стены.
    let ok = true, ground = 0;
    for (const p of probes(next, car.yaw)) {
      const g = groundBelow(p.x, p.z, car.pos.y + CLIMB + 0.2);
      if (g - car.pos.y > CLIMB || blocked(p.x, p.z, Math.max(g, car.pos.y))) { ok = false; break; }
      ground = Math.max(ground, g);
    }
    if (ok) { car.pos.x = next.x; car.pos.z = next.z; } else { car.speed = -car.speed * 0.25; ground = groundBelow(car.pos.x, car.pos.z, car.pos.y + 0.3); }

    // Вертикаль: въезд на ступеньку сразу, вниз — гравитация.
    if (ground >= car.pos.y) { car.pos.y = ground; car.vy = 0; }
    else { car.vy -= 30 * dt; car.pos.y = Math.max(ground, car.pos.y + car.vy * dt); if (car.pos.y === ground) car.vy = 0; }
    if (car.pos.y < -10) remove(car.id, true);

    // Наезд на игроков.
    if (Math.abs(car.speed) > RUNOVER_SPEED) {
      const now = performance.now();
      for (const [peerId, o] of ctx.others) {
        if (o.target?.v) continue;
        const p = o.group.position;
        if (p.distanceTo(car.pos) < 2.1 && Math.abs(p.y - car.pos.y) < 1.5 && (runoverCooldown.get(peerId) || 0) < now) {
          runoverCooldown.set(peerId, now + 1200);
          ctx.net()?.hit({ dmg: RUNOVER_DMG, by: ctx.nick(), w: 'car' }, peerId);
        }
      }
    }
  }

  // ---------- Публичное ----------

  return {
    // Поставить свою машину перед собой.
    place(x, y, z, yaw) {
      const self = ctx.selfId();
      const own = [...cars.values()].filter((c) => c.owner === self);
      if (own.length >= MAX_PER_PLAYER) { ctx.toast(`Max ${MAX_PER_PLAYER} cars — blow one up first 🚀`); return; }
      const car = make({ id: `${self}:${seq++}`, o: self, c: COLORS[Math.floor(Math.random() * COLORS.length)], x, y, z, r: yaw });
      send(car);
      ctx.toast('Car placed — press E next to it');
    },

    // E: сесть в ближайшую свободную машину или выйти из своей.
    toggle(pos) {
      const self = ctx.selfId();
      if (mine) {
        mine.driver = null;
        mine.speed = 0;
        send(mine);
        const out = mine.pos.clone().add(new THREE.Vector3(Math.cos(mine.yaw) * 2.2, 0.2, -Math.sin(mine.yaw) * 2.2));
        mine = null;
        ctx.exitCar(out);
        return;
      }
      let best = null, bd = 3.2;
      for (const c of cars.values()) {
        const d = c.pos.distanceTo(pos);
        if (!c.driver && d < bd) { bd = d; best = c; }
      }
      if (!best) { ctx.toast('No free car nearby'); return; }
      best.driver = self;
      best.speed = 0;
      mine = best;
      send(mine);
      ctx.toast('Driving — WASD, E to get out');
    },

    driving: () => mine,

    boxes() {
      return [...cars.values()].map((c) => ({
        id: c.id,
        min: new THREE.Vector3(c.pos.x - 1.6, c.pos.y, c.pos.z - 1.6),
        max: new THREE.Vector3(c.pos.x + 1.6, c.pos.y + 1.6, c.pos.z + 1.6),
      }));
    },

    // Урон машине: владелец считает и взрывает; остальным шлём, чтобы владелец узнал.
    damage(id, dmg) {
      const car = cars.get(id);
      if (!car) return;
      if (car.owner === ctx.selfId()) {
        car.hp -= dmg;
        if (car.hp <= 0) { ctx.net()?.car({ id, gone: true }); remove(id, true); } else send(car);
      } else {
        ctx.net()?.car({ id, dmg });
      }
    },
    damageMine(dmg) { if (mine) this.damage(mine.id, dmg); },

    onCar(peerId, d) {
      const car = cars.get(d.id);
      if (d.gone) { remove(d.id, true); return; }
      if (d.dmg) { if (car && car.owner === ctx.selfId()) this.damage(d.id, d.dmg); return; }
      if (!car) { make(d); return; }
      if (mine?.id === d.id && d.d !== ctx.selfId()) return;   // за рулём я — чужие старые пакеты игнорируем
      car.driver = d.d;
      car.hp = d.hp;
      car.target = { x: d.x, y: d.y, z: d.z, r: d.r };
      car.seen = performance.now();
    },

    // Новичку — все машины, которыми я владею или управляю.
    syncTo(peerId) {
      const self = ctx.selfId();
      for (const c of cars.values()) if (c.owner === self || c.driver === self) send(c, peerId);
    },

    onLeave(peerId) {
      for (const c of [...cars.values()]) {
        if (c.owner === peerId) remove(c.id, false);
        else if (c.driver === peerId) c.driver = null;
      }
    },

    update(dt, keys, now) {
      if (mine) {
        drive(dt, keys);
        if (now - lastSend > 100) { lastSend = now; send(mine); }
      }
      // Стоящие свои машины — пульс для новичков и тех, кто пропустил пакет.
      if (now - lastHeartbeat > 2500) {
        lastHeartbeat = now;
        const self = ctx.selfId();
        for (const c of cars.values()) if (c.owner === self && !c.driver && c !== mine) send(c);
      }
      for (const c of cars.values()) {
        if (c !== mine) {
          c.pos.lerp(new THREE.Vector3(c.target.x, c.target.y, c.target.z), 0.25);
          let dy = c.target.r - c.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          c.yaw += dy * 0.25;
        }
        c.group.position.copy(c.pos);
        c.group.rotation.y = c.yaw;
      }
    },
  };
}
