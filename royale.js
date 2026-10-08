// PostRoyale — королевская битва без сервера: раунды идут по часам (Date.now()), поэтому у всех игроков мира
// один и тот же раунд, одна и та же зона-шторм и её центр — без единого сообщения по сети.
//
// Раунд ROUND_MS: первые DROP_MS — высадка (шторма нет), дальше зона сужается по фазам, урон снаружи растёт.
// Умер — выбыл до конца раунда (наблюдатель). Последний живой из тех, кто играл раунд, — победитель.
// Зашёл в середине раунда — высаживаешься сразу; только в последние LATE_CUTOFF мс (зона почти схлопнулась) — ждёшь следующей высадки.

import * as THREE from 'three';
import { MAP, WATER_Y, rng, seedOf } from './map.js';

const SX = MAP, SZ = MAP;

export const ROUND_MS = 8 * 60e3;
export const DROP_MS = 30e3;
const LATE_CUTOFF = 90e3;

// [начало, конец (с), радиус от → до, урон/с снаружи]
const R0 = Math.hypot(SX, SZ) / 2;
// Фазы рассчитаны на остров 320 м: первая зона сразу ужимается до 120.
const PHASES = [
  [0, 30, R0, R0, 0],
  [30, 90, R0, 120, 1],
  [90, 150, 120, 120, 1],
  [150, 210, 120, 70, 2],
  [210, 260, 70, 70, 2],
  [260, 310, 70, 35, 4],
  [310, 350, 35, 35, 5],
  [350, 400, 35, 14, 8],
  [400, 440, 14, 4, 10],
  [440, 480, 4, 0, 15],
];

export function createRoyale(ctx) {
  const { scene } = ctx;
  let round = -1, roundStart = 0, center = { x: SX / 2, z: SZ / 2 };
  let alive = false, maxAliveSeen = 0, won = false, place = 0;
  let surviveAcc = 0, stormAcc = 0;

  // Стена шторма: открытый цилиндр.
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 160, 96, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9b4dff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  scene.add(wall);

  const roundOf = (now) => Math.floor(now / ROUND_MS);

  // Центр зоны раунда — из id мира и номера раунда: на суше и не у самого края.
  function pickCenter(r) {
    const w = ctx.world();
    const rand = rng(seedOf(w.id) ^ (r * 2654435761));
    for (let i = 0; i < 300; i++) {
      const x = SX * (0.3 + rand() * 0.4), z = SZ * (0.3 + rand() * 0.4);
      if (w.surfaceY(Math.floor(x), Math.floor(z)) > WATER_Y + 1) return { x, z };
    }
    return { x: SX / 2, z: SZ / 2 };
  }

  function storm(t) {
    const s = t / 1000;
    const ph = PHASES.find((p) => s >= p[0] && s < p[1]) || PHASES[PHASES.length - 1];
    const k = Math.min(1, Math.max(0, (s - ph[0]) / (ph[1] - ph[0])));
    return { r: ph[2] + (ph[3] - ph[2]) * k, dps: ph[4], shrinking: ph[2] !== ph[3], left: ph[1] - s, idx: PHASES.indexOf(ph) };
  }

  function aliveOthers() {
    let n = 0;
    for (const o of ctx.others.values()) if (o.target?.a && o.target.rr === round) n++;
    return n;
  }

  return {
    get round() { return round; },
    get roundStart() { return roundStart; },
    get alive() { return alive; },
    get won() { return won; },
    aliveCount: () => aliveOthers() + (alive ? 1 : 0),

    // Первый вход в мир: играем сразу, если до конца раунда больше LATE_CUTOFF; иначе ждём следующего.
    init(now = Date.now()) {
      round = roundOf(now);
      roundStart = round * ROUND_MS;
      center = pickCenter(round);
      alive = now - roundStart < ROUND_MS - LATE_CUTOFF;
      ctx.onRoundStart(round, alive);
    },

    // Точка высадки — внутри зоны, в которую шторм сжимается сейчас (чтобы не умереть сразу после приземления).
    dropPoint() {
      const w = ctx.world();
      const s = storm(Date.now() - roundStart);
      const ph = PHASES[s.idx];
      const r = Math.max(4, Math.min(s.r, ph[3]) * 0.8);
      for (let i = 0; i < 300; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
        if (x > 8 && z > 8 && x < SX - 8 && z < SZ - 8 && w.surfaceY(x, z) > WATER_Y + 3) return { x, z };
      }
      return { x: center.x, z: center.z };
    },

    // Смерть: выбыл до конца раунда.
    eliminate(by) {
      if (!alive) return;
      place = aliveOthers() + 1;
      alive = false;
      ctx.onEliminated(place, by);
    },

    // Соперник погиб в этом раунде — значит, живых было как минимум двое (даже если кадры стояли в фоне).
    onPeerDead() { if (alive) maxAliveSeen = Math.max(maxAliveSeen, 2); },

    onWin(peerId, d) { if (d.r === round) ctx.onWinner(d.n, false); },

    update(dt) {
      const now = Date.now();
      const r = roundOf(now);
      if (r !== round) {
        round = r;
        roundStart = r * ROUND_MS;
        center = pickCenter(r);
        alive = true;                     // новая высадка — все в игре
        won = false;
        maxAliveSeen = 0;
        place = 0;
        ctx.onRoundStart(round, true);
      }
      const t = now - roundStart;
      const s = storm(t);

      wall.position.set(center.x, 60, center.z);
      wall.scale.set(Math.max(0.01, s.r), 1, Math.max(0.01, s.r));
      wall.visible = s.r < R0 - 1;

      const feet = ctx.feet();
      const outside = Math.hypot(feet.x - center.x, feet.z - center.z) > s.r;
      ctx.stormHud({ t, storm: s, alive: this.aliveCount(), outside: outside && alive, round, spectating: !alive, drop: t < DROP_MS });

      if (!alive) return;
      // Урон шторма копим и снимаем целыми единицами.
      if (outside && s.dps) {
        stormAcc += s.dps * dt;
        if (stormAcc >= 1) { const d = Math.floor(stormAcc); stormAcc -= d; ctx.stormDamage(d); }
      } else stormAcc = 0;
      if (!alive) return;               // мог умереть от шторма

      // Очки за выживание — каждые 60 с после высадки.
      if (t > DROP_MS) {
        surviveAcc += dt;
        if (surviveAcc >= 60) { surviveAcc -= 60; ctx.points('survive'); }
      }

      // Победа: в раунде было ≥2 живых, остался один я.
      const n = this.aliveCount();
      maxAliveSeen = Math.max(maxAliveSeen, n);
      if (!won && t > DROP_MS && maxAliveSeen >= 2 && n === 1) {
        won = true;
        ctx.net()?.win({ n: ctx.nick(), r: round });
        ctx.onWinner(ctx.nick(), true);
      }
    },
  };
}
