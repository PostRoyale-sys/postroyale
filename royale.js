// PostRoyale — королевская битва без сервера: раунды идут по часам (Date.now()), поэтому у всех игроков мира
// один и тот же раунд, одна и та же зона-шторм и её центр — без единого сообщения по сети.
//
// Раунд ROUND_MS: первые DROP_MS — высадка (шторма нет), дальше зона сужается по фазам, урон снаружи растёт.
// Финальный круг не схлопывается: держится радиусом FINAL_R до конца раунда.
// Умер — выбыл до конца раунда (наблюдатель). Конец раунда: последний живой — досрочно, иначе по таймеру —
// все, кто дожил, победители; после итогов игра возвращает в лобби (ctx.onRoundEnd).
// Зашёл в середине раунда — высаживаешься сразу; только в последние LATE_CUTOFF мс (зона почти схлопнулась) — ждёшь следующей высадки.

import * as THREE from 'three';
import { MAP, WATER_Y, rng, seedOf } from './map.js';

const SX = MAP, SZ = MAP;

export const ROUND_MS = 4 * 60e3;
export const DROP_MS = 30e3;
export const FINAL_R = 8;
const LATE_CUTOFF = 45e3;

// Фазы шторма: [начало, конец (с), радиус от → до, урон/с снаружи]. COVER — первый круг, накрывающий
// весь остров от центра этого раунда (считается в cover()), поэтому в начале раунда безопасна вся суша.
// Сужение начинается уже через 10 с, круг сжимается до FINAL_R к 3:16 и держится до конца раунда.
const COVER = -1;
const PHASE_TABLE = [
  [0, 10, COVER, COVER, 0],
  [10, 50, COVER, 100, 1],
  [50, 66, 100, 100, 2],
  [66, 94, 100, 60, 3],
  [94, 110, 60, 60, 4],
  [110, 136, 60, 32, 5],
  [136, 152, 32, 32, 6],
  [152, 176, 32, 14, 8],
  [176, 196, 14, FINAL_R, 10],
  [196, 240, FINAL_R, FINAL_R, 12],
];

export function createRoyale(ctx) {
  const { scene } = ctx;
  let round = -1, roundStart = 0, center = { x: SX / 2, z: SZ / 2 };
  let PHASES = PHASE_TABLE, R0 = Math.hypot(SX, SZ);
  let alive = false, maxAliveSeen = 0, won = false, place = 0, ended = false;
  let surviveAcc = 0, stormAcc = 0;

  // Стена шторма: открытый цилиндр.
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 160, 96, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9b4dff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  wall.visible = false;
  scene.add(wall);

  // Точка отсчёта матча: 0 — общие часы (Ranked: у всех один раунд); в Casual — момент старта матча,
  // чтобы всё начиналось с нуля; зашедшие по ссылке подхватывают более раннюю точку (adoptEpoch).
  let epoch = 0;
  const roundOf = (now) => Math.floor((now - epoch) / ROUND_MS);

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

  // Первый круг: до самой дальней точки суши от центра + запас — весь остров внутри.
  function setCenter(r) {
    center = pickCenter(r);
    const w = ctx.world();
    let far = 0;
    for (let x = 0; x <= SX; x += 8) for (let z = 0; z <= SZ; z += 8) {
      if (w.surfaceY(x, z) > WATER_Y) far = Math.max(far, Math.hypot(x - center.x, z - center.z));
    }
    R0 = far + 15;
    PHASES = PHASE_TABLE.map((p) => p.map((v, i) => (v === COVER && (i === 2 || i === 3) ? R0 : v)));
  }

  function storm(t) {
    const s = t / 1000;
    const ph = PHASES.find((p) => s >= p[0] && s < p[1]) || PHASES[PHASES.length - 1];
    const k = Math.min(1, Math.max(0, (s - ph[0]) / (ph[1] - ph[0])));
    return { r: ph[2] + (ph[3] - ph[2]) * k, dps: ph[4], shrinking: ph[2] !== ph[3], left: ph[1] - s, idx: PHASES.indexOf(ph), final: ph === PHASES[PHASES.length - 1] };
  }

  function aliveOthers() {
    let n = 0;
    for (const o of ctx.others.values()) if (o.target?.a && o.target.rr === round) n++;
    return n;
  }
  const survivorNames = () => [...ctx.others.values()].filter((o) => o.target?.a && o.target.rr === round).map((o) => o.name);

  return {
    get round() { return round; },
    get center() { return center; },
    get roundStart() { return roundStart; },
    get alive() { return alive; },
    get won() { return won; },
    aliveCount: () => aliveOthers() + (alive ? 1 : 0),

    // Первый вход в мир: играем сразу, если до конца раунда больше LATE_CUTOFF; иначе ждём следующего.
    get epoch() { return epoch; },
    init(now = Date.now(), ep = epoch) {
      epoch = ep;
      ended = false; won = false; maxAliveSeen = 0; place = 0;
      round = roundOf(now);
      roundStart = epoch + round * ROUND_MS;
      setCenter(round);
      alive = now - roundStart < ROUND_MS - LATE_CUTOFF;
      ctx.onRoundStart(round, alive);
    },

    // Друг начал этот матч раньше — переходим на его отсчёт (раунд начинается заново под его время).
    adoptEpoch(e) {
      if (!(e > 0) || e >= epoch - 1000) return false;
      this.init(Date.now(), e);
      return true;
    },

    // Шторм прямо сейчас: текущий радиус r и урон в секунду снаружи dps (для ботов).
    stormNow() { return storm(Date.now() - roundStart); },

    // Радиус, внутри которого безопасно сейчас и после текущего сжатия.
    safeRadius() {
      const s = storm(Date.now() - roundStart);
      return Math.min(s.r, PHASES[s.idx][3]);
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

    onWin(peerId, d) {
      if (d.r !== round || ended) return;
      ended = true;
      ctx.onWinner(d.n, false);
      ctx.onRoundEnd({ me: false, winners: [d.n], early: true });
    },

    get ended() { return ended; },

    update(dt) {
      if (ended) return;                  // итоги показаны — ждём возврата в лобби
      const now = Date.now();
      const r = roundOf(now);
      // Таймер вышел: все живые — победители, затем лобби. Новый раунд в матче не начинается.
      if (r !== round && round >= 0 && ctx.inMatch?.()) {
        ended = true;
        const winners = [...(alive ? [ctx.nick()] : []), ...survivorNames()];
        if (alive) ctx.points('win');
        ctx.onRoundEnd({ me: alive, winners, early: false });
        return;
      }
      if (r !== round) {
        round = r;
        roundStart = epoch + r * ROUND_MS;
        setCenter(r);
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
      if (outside && s.dps && !ctx.riding?.()) {
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
        ended = true;
        ctx.net()?.win({ n: ctx.nick(), r: round });
        ctx.onWinner(ctx.nick(), true);
        ctx.onRoundEnd({ me: true, winners: [ctx.nick()], early: true });
      }
    },
  };
}
