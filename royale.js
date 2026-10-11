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
// Финальный круг не стоит на месте: с MOVE_FROM по MOVE_TO секунду центр плавно уезжает на MOVE_DIST метров
// (направление — от сида мира и номера раунда, у всех одинаковое; точка назначения — на суше).
const MOVE_FROM = 176, MOVE_TO = 236, MOVE_DIST = 24;

// Фазы шторма: [начало, конец (с), радиус от → до, урон/с снаружи]. COVER — первый круг, накрывающий
// весь остров от центра этого раунда (считается в cover()), поэтому в начале раунда безопасна вся суша.
// Сужение начинается уже через 10 с, круг сжимается до FINAL_R к 3:16 и держится до конца раунда.
const COVER = -1;
// Дуэль 1v1 (режим тикер против тикера): ожидание соперника — круг 45 м; бой — 15 с на подготовку
// и стройку, затем круг сжимается до 10 м к 70 с и держится. Снаружи круга урон есть всегда, в любой фазе.
const DUEL_WAIT = [[0, 1800, 45, 45, 2]];
const DUEL_FIGHT = [[0, 15, 45, 45, 2], [15, 70, 45, 10, 3], [70, 180, 10, 10, 10]];
const DUEL = { wait: { table: DUEL_WAIT, ms: 1800e3 }, fight: { table: DUEL_FIGHT, ms: 180e3 } };

const PHASE_TABLE = [
  [0, 10, COVER, COVER, 1],
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
  let round = -1, roundStart = 0, center = { x: SX / 2, z: SZ / 2 }, base = center, moveTo = center;
  let PHASES = PHASE_TABLE, R0 = Math.hypot(SX, SZ);
  let alive = false, maxAliveSeen = 0, won = false, place = 0, ended = false;
  let surviveAcc = 0, stormAcc = 0;

  // Стена шторма: открытый цилиндр (высота 160 м, низ на −20 м) со своим шейдером — фиолетовая дымка,
  // бегущие наискосок полосы, клубы, яркая кромка у земли; к верху тает. Полосы — по метрам, а не по углу,
  // поэтому их плотность не меняется, когда круг сжимается.
  const wallU = { uTime: { value: 0 }, uR: { value: 1 } };
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 160, 128, 1, true), new THREE.ShaderMaterial({
    uniforms: wallU, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: `varying vec2 vUv; varying float vDist;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uR; varying vec2 vUv; varying float vDist;
      float wave(vec2 p){ return sin(p.x) * sin(p.y * 1.3 + 1.7) * 0.5 + sin(p.x * 2.1 - p.y * 0.7 + 3.1) * 0.25; }
      void main(){
        float x = vUv.x * 6.2832 * uR, y = vUv.y * 160.0 - 20.0;       // метры по кругу и высота
        // широкие мягкие полосы наискосок; издалека (где они стали бы тонкими линиями) растворяются
        float band = fract((x + y * 0.6) / 14.0 - uTime * 0.3);
        float stripe = smoothstep(0.0, 0.25, band) * (1.0 - smoothstep(0.3, 0.6, band));
        stripe *= 1.0 - smoothstep(25.0, 70.0, vDist);
        float cloud = wave(vec2(x * 0.05 + uTime * 0.25, y * 0.06 - uTime * 0.15)) + wave(vec2(x * 0.11 - uTime * 0.4, y * 0.13));
        float fade = 1.0 - smoothstep(25.0, 120.0, y);
        float rim = exp(-max(y - 2.0, 0.0) * 0.25) * (0.7 + 0.3 * sin(uTime * 3.0 + x * 0.2));
        vec3 col = mix(vec3(0.42, 0.16, 0.85), vec3(0.68, 0.42, 1.0), clamp(cloud * 0.5 + 0.5, 0.0, 1.0));
        col += vec3(0.45, 0.32, 0.6) * stripe * 0.45 + vec3(0.7, 0.55, 0.85) * rim * 0.4;   // не ярче порога bloom
        float a = (0.24 + cloud * 0.07 + stripe * 0.1 + rim * 0.3) * fade;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.75));
#include <colorspace_fragment>
      }`,
  }));
  wall.visible = false;
  scene.add(wall);

  // Точка отсчёта матча: 0 — общие часы (Ranked: у всех один раунд); в Casual — момент старта матча,
  // чтобы всё начиналось с нуля; зашедшие по ссылке подхватывают более раннюю точку (adoptEpoch).
  let epoch = 0;
  let roundMs = ROUND_MS, dropMs = DROP_MS, duel = null;     // duel: null | 'wait' | 'fight'
  const roundOf = (now) => Math.floor((now - epoch) / roundMs);

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
    center = base = moveTo = pickCenter(r);
    const w = ctx.world();
    let far = 0;
    for (let x = 0; x <= SX; x += 8) for (let z = 0; z <= SZ; z += 8) {
      if (w.surfaceY(x, z) > WATER_Y) far = Math.max(far, Math.hypot(x - center.x, z - center.z));
    }
    R0 = far + 15;
    const rand = rng(seedOf(w.id) ^ Math.imul(r + 7, 0x2c1b3c6d));
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2, x = base.x + Math.cos(a) * MOVE_DIST, z = base.z + Math.sin(a) * MOVE_DIST;
      if (w.surfaceY(Math.floor(x), Math.floor(z)) > WATER_Y + 1) { moveTo = { x, z }; break; }
    }
    if (duel) { moveTo = base; PHASES = DUEL[duel].table; return; }
    PHASES = PHASE_TABLE.map((p) => p.map((v, i) => (v === COVER && (i === 2 || i === 3) ? R0 : v)));
  }

  // Центр зоны в момент s (с): до MOVE_FROM — на месте, потом плавно (smoothstep) едет к moveTo.
  function centerAt(s) {
    const k = Math.min(1, Math.max(0, (s - MOVE_FROM) / (MOVE_TO - MOVE_FROM))), e = k * k * (3 - 2 * k);
    return { x: base.x + (moveTo.x - base.x) * e, z: base.z + (moveTo.z - base.z) * e };
  }

  function storm(t) {
    const s = t / 1000;
    const ph = PHASES.find((p) => s >= p[0] && s < p[1]) || PHASES[PHASES.length - 1];
    const k = Math.min(1, Math.max(0, (s - ph[0]) / (ph[1] - ph[0])));
    const idx = PHASES.indexOf(ph), next = PHASES[idx + 1];
    // warn — до начала следующего сжатия (если сейчас круг стоит, а следующая фаза сжимает)
    const warn = ph[2] === ph[3] && next && next[2] !== next[3] && idx > 0 ? ph[1] - s : Infinity;
    return { r: ph[2] + (ph[3] - ph[2]) * k, dps: ph[4], shrinking: ph[2] !== ph[3], left: ph[1] - s, idx, final: ph === PHASES[PHASES.length - 1],
      warn, moving: !duel && s > MOVE_FROM && s < MOVE_TO };
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

    // Режим дуэли: null — обычный раунд; 'wait' — ждём соперника; 'fight' — бой 1v1. Вызывать перед init().
    setDuel(kind) {
      duel = kind || null;
      roundMs = duel ? DUEL[duel].ms : ROUND_MS;
      dropMs = duel ? 0 : DROP_MS;
    },
    get duel() { return duel; },
    get roundMs() { return roundMs; },

    // Первый вход в мир: играем сразу, если до конца раунда больше LATE_CUTOFF; иначе ждём следующего.
    get epoch() { return epoch; },
    init(now = Date.now(), ep = epoch) {
      epoch = ep;
      ended = false; won = false; maxAliveSeen = 0; place = 0;
      round = roundOf(now);
      roundStart = epoch + round * roundMs;
      setCenter(round);
      alive = duel ? true : now - roundStart < roundMs - LATE_CUTOFF;
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

    // Зона в момент через sec секунд после начала раунда (для аирдропов и ивентов): центр и радиус после сжатия.
    zoneAt(sec) {
      const st = storm(sec * 1000), c = centerAt(sec);
      return { x: c.x, z: c.z, r: Math.min(st.r, PHASES[st.idx][3]) };
    },
    get duelMode() { return duel; },

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
        roundStart = epoch + r * roundMs;
        setCenter(r);
        alive = true;                     // новая высадка — все в игре
        won = false;
        maxAliveSeen = 0;
        place = 0;
        ctx.onRoundStart(round, true);
      }
      const t = now - roundStart;
      const s = storm(t);
      center = duel ? base : centerAt(t / 1000);

      wall.position.set(center.x, 60, center.z);
      wall.scale.set(Math.max(0.01, s.r), 1, Math.max(0.01, s.r));
      wallU.uR.value = Math.max(0.01, s.r);
      wallU.uTime.value = now / 1000 % 1000;
      wall.visible = s.r < R0 - 1;

      const feet = ctx.feet();
      const outside = Math.hypot(feet.x - center.x, feet.z - center.z) > s.r;
      ctx.stormHud({ t, storm: s, alive: this.aliveCount(), outside: outside && alive, round, spectating: !alive, drop: t < dropMs, duel });

      if (!alive) return;
      // Урон шторма копим и снимаем целыми единицами.
      if (outside && s.dps && !ctx.riding?.()) {
        stormAcc += s.dps * dt;
        if (stormAcc >= 1) { const d = Math.floor(stormAcc); stormAcc -= d; ctx.stormDamage(d); }
      } else stormAcc = 0;
      if (!alive) return;               // мог умереть от шторма

      // Очки за выживание — каждые 60 с после высадки.
      if (t > dropMs) {
        surviveAcc += dt;
        if (surviveAcc >= 60) { surviveAcc -= 60; ctx.points('survive'); }
      }

      // Победа: в раунде было ≥2 живых, остался один я.
      const n = this.aliveCount();
      maxAliveSeen = Math.max(maxAliveSeen, n);
      if (!won && duel !== 'wait' && t > dropMs && maxAliveSeen >= 2 && n === 1) {
        won = true;
        ended = true;
        ctx.net()?.win({ n: ctx.nick(), r: round });
        ctx.onWinner(ctx.nick(), true);
        ctx.onRoundEnd({ me: true, winners: [ctx.nick()], early: true });
      }
    },
  };
}
