// Оружие, здоровье, взрывы, эффекты и звуки.
//   Пистолет — мгновенный выстрел (hitscan) с трассером, 25 урона, блоки не ломает.
//   Ракетница — летящая ракета; взрыв радиусом EXPLODE_R выносит блоки и бьёт всех рядом (и тебя тоже).
// Кто стрелял, тот и считает попадания и разрушения: шлёт hit тому, в кого попал, и пачку правок блоков всем.
// Остальные по сообщению shot рисуют трассер/ракету и слышат звук.

import * as THREE from 'three';
import { SY, WATER_Y, raycast } from './voxel.js';

export const TOOLS = [
  { id: 'pistol', name: 'Pistol', icon: '🔫' },
  { id: 'rocket', name: 'Rocket launcher', icon: '🚀' },
  { id: 'car', name: 'Car (right click to place, E to drive)', icon: '🚗' },
];

const PISTOL = { dmg: 25, cooldown: 0.22, range: 70 };
const ROCKET = { speed: 32, gravity: 5, cooldown: 1.0, life: 4 };
const EXPLODE_R = 2.6;        // радиус разрушения блоков
const BLAST_R = 4.5;          // радиус урона
const BLAST_DMG = 80;

export function toolIcon(t) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3140';
  g.fillRect(0, 0, 64, 64);
  g.font = '40px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(t.icon, 32, 36);
  return c.toDataURL();
}

// Пересечение луча с AABB: расстояние или Infinity.
export function rayBox(o, d, min, max) {
  let t0 = 0, t1 = Infinity;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < min[a] || o[a] > max[a]) return Infinity; continue; }
    let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

export function createCombat(ctx) {
  const { scene, camera } = ctx;
  let hp = 100, cooldownUntil = 0;
  const fx = [];          // { obj, age, life, tick(k) }
  const rockets = [];     // { mesh, pos, vel, own, age }

  // ---------- Звук (синтез, без файлов) ----------

  let ac = null;
  function audio() {
    if (!ac) try { ac = new AudioContext(); } catch (e) { return null; }
    return ac;
  }
  function noise(dur, freq, vol, type = 'lowpass') {
    const a = audio();
    if (!a || vol <= 0.01) return;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const gain = a.createGain();
    gain.gain.value = vol;
    src.connect(f).connect(gain).connect(a.destination);
    src.start();
  }
  const volAt = (p) => Math.max(0, 1 - camera.getWorldPosition(new THREE.Vector3()).distanceTo(p) / 60);
  const sound = {
    pistol: (p) => noise(0.12, 2500, 0.35 * volAt(p), 'highpass'),
    rocket: (p) => noise(0.35, 600, 0.3 * volAt(p)),
    boom: (p) => noise(0.9, 400, 0.9 * volAt(p)),
  };

  // ---------- Эффекты ----------

  function addFx(obj, life, tick) {
    scene.add(obj);
    fx.push({ obj, age: 0, life, tick });
  }

  function tracer(a, b, color = 0xffe066) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
    addFx(line, 0.14, (k) => { line.material.opacity = 1 - k; });
  }

  function explosionFx(p) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true }));
    ball.position.copy(p);
    addFx(ball, 0.5, (k) => { ball.scale.setScalar(0.5 + k * BLAST_R); ball.material.opacity = 1 - k; });
    // Обломки-кубики.
    for (let i = 0; i < 14; i++) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25),
        new THREE.MeshLambertMaterial({ color: i % 2 ? 0x6b5a45 : 0x8a8a90 }));
      cube.position.copy(p);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).multiplyScalar(14);
      addFx(cube, 0.9, (k, dt) => { v.y -= 30 * dt; cube.position.addScaledVector(v, dt); cube.rotation.x += dt * 8; });
    }
    sound.boom(p);
    const d = camera.getWorldPosition(new THREE.Vector3()).distanceTo(p);
    if (d < 14) ctx.shake(0.5 * (1 - d / 14));
  }

  // ---------- Здоровье ----------

  function renderHp() {
    ctx.hpBar(hp);
  }

  function takeDamage(dmg, by, w) {
    if (hp <= 0) return;
    hp = Math.max(0, hp - dmg);
    ctx.flash();
    if (hp <= 0) {
      ctx.net()?.dead({ n: ctx.nick(), by, w });
      ctx.killfeed(by, ctx.nick(), w);
      hp = 100;
      ctx.respawn();
    }
    renderHp();
  }

  // ---------- Цели ----------

  // Боксы других игроков и машин: [{ kind, id, min, max }].
  function targets() {
    const list = [];
    for (const [peerId, o] of ctx.others) {
      if (o.target?.v) continue;           // сидит в машине — бьём машину
      const p = o.group.position;
      list.push({ kind: 'player', id: peerId, min: new THREE.Vector3(p.x - 0.4, p.y, p.z - 0.4), max: new THREE.Vector3(p.x + 0.4, p.y + 1.95, p.z + 0.4) });
    }
    for (const b of ctx.cars.boxes()) list.push({ kind: 'car', ...b });
    return list;
  }

  function blockDistance(o, d, range) {
    const hit = raycast(ctx.world(), o, d, range);
    if (!hit) return range;
    return rayBox(o, d, new THREE.Vector3(hit.x, hit.y, hit.z), new THREE.Vector3(hit.x + 1, hit.y + 1, hit.z + 1));
  }

  // ---------- Пистолет ----------

  function shootPistol() {
    const o = camera.getWorldPosition(new THREE.Vector3());
    const d = camera.getWorldDirection(new THREE.Vector3());
    let tBest = blockDistance(o, d, PISTOL.range), best = null;
    for (const t of targets()) {
      if (ctx.cars.driving()?.id === t.id) continue;   // не стреляем в свою машину изнутри
      const tt = rayBox(o, d, t.min, t.max);
      if (tt < tBest) { tBest = tt; best = t; }
    }
    const muzzle = o.clone().addScaledVector(d, 0.6).add(new THREE.Vector3(0, -0.15, 0));
    const end = o.clone().addScaledVector(d, Math.min(tBest, PISTOL.range));
    tracer(muzzle, end);
    sound.pistol(o);
    ctx.net()?.shot({ w: 'pistol', o: muzzle.toArray().map((v) => +v.toFixed(2)), e: end.toArray().map((v) => +v.toFixed(2)) });
    if (best?.kind === 'player') ctx.net()?.hit({ dmg: PISTOL.dmg, by: ctx.nick(), w: 'pistol' }, best.id);
    if (best?.kind === 'car') ctx.cars.damage(best.id, 10);
  }

  // ---------- Ракеты ----------

  function spawnRocket(o, v, own) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.7), new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0x552200 }));
    mesh.position.copy(o);
    mesh.lookAt(o.clone().add(v));
    scene.add(mesh);
    rockets.push({ mesh, pos: o.clone(), vel: v.clone(), own, age: 0 });
    sound.rocket(o);
  }

  function fireRocket() {
    const o = camera.getWorldPosition(new THREE.Vector3());
    const d = camera.getWorldDirection(new THREE.Vector3());
    const start = o.clone().addScaledVector(d, 0.9);
    const v = d.clone().multiplyScalar(ROCKET.speed);
    spawnRocket(start, v, true);
    ctx.net()?.shot({ w: 'rocket', o: start.toArray().map((x) => +x.toFixed(2)), v: v.toArray().map((x) => +x.toFixed(2)) });
  }

  function explode(p, own) {
    explosionFx(p);
    if (!own) return;                      // разрушения и урон считает только стрелявший
    const w = ctx.world();
    const list = [];
    const r = Math.ceil(EXPLODE_R);
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      if (x * x + y * y + z * z > EXPLODE_R * EXPLODE_R) continue;
      const bx = Math.floor(p.x) + x, by = Math.floor(p.y) + y, bz = Math.floor(p.z) + z;
      if (by <= 0 || by >= SY || !w.get(bx, by, bz)) continue;
      list.push([bx, by, bz]);
    }
    ctx.destroyBlocks(list);
    // Урон игрокам (по центру тела) и себе — да, ракетный прыжок больно.
    for (const t of targets()) {
      const c = t.min.clone().add(t.max).multiplyScalar(0.5);
      const d = c.distanceTo(p);
      if (d > BLAST_R) continue;
      const dmg = Math.round(BLAST_DMG * (1 - d / BLAST_R));
      if (t.kind === 'player') ctx.net()?.hit({ dmg, by: ctx.nick(), w: 'rocket' }, t.id);
      else ctx.cars.damage(t.id, dmg * 1.5);
    }
    const me = ctx.feet().clone().add(new THREE.Vector3(0, 0.9, 0));
    const dm = me.distanceTo(p);
    if (dm < BLAST_R && !ctx.cars.driving()) {
      takeDamage(Math.round(BLAST_DMG * 0.6 * (1 - dm / BLAST_R)), ctx.nick(), 'rocket');
      ctx.knock(me.clone().sub(p).normalize().multiplyScalar(12 * (1 - dm / BLAST_R)));
    }
  }

  function updateRockets(dt) {
    const w = ctx.world();
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.age += dt;
      r.vel.y -= ROCKET.gravity * dt;
      const stepLen = r.vel.length() * dt;
      const n = Math.max(1, Math.ceil(stepLen / 0.4));
      let boom = r.age > ROCKET.life;
      for (let k = 0; k < n && !boom; k++) {
        r.pos.addScaledVector(r.vel, dt / n);
        if (w.solid(Math.floor(r.pos.x), Math.floor(r.pos.y), Math.floor(r.pos.z)) || r.pos.y < WATER_Y + 0.85) boom = true;
        else if (r.own && r.age > 0.08) {
          for (const t of targets()) {
            if (r.pos.x > t.min.x - 0.2 && r.pos.x < t.max.x + 0.2 && r.pos.y > t.min.y - 0.2 && r.pos.y < t.max.y + 0.2 &&
                r.pos.z > t.min.z - 0.2 && r.pos.z < t.max.z + 0.2 && ctx.cars.driving()?.id !== t.id) { boom = true; break; }
          }
        }
      }
      r.mesh.position.copy(r.pos);
      r.mesh.lookAt(r.pos.clone().add(r.vel));
      if (boom) {
        scene.remove(r.mesh);
        rockets.splice(i, 1);
        explode(r.pos.clone(), r.own);
      }
    }
  }

  // ---------- Публичное ----------

  return {
    get hp() { return hp; },
    reset() { hp = 100; renderHp(); },
    use(tool, now) {
      if (now < cooldownUntil) return false;
      if (tool === 'pistol') { shootPistol(); cooldownUntil = now + PISTOL.cooldown; return true; }
      if (tool === 'rocket') { fireRocket(); cooldownUntil = now + ROCKET.cooldown; return true; }
      return false;
    },
    takeDamage,
    explodeAt(p, own) { explode(p, own); },
    onShot(peerId, d) {
      if (d.w === 'pistol') {
        const a = new THREE.Vector3(...d.o), b = new THREE.Vector3(...d.e);
        tracer(a, b);
        sound.pistol(a);
      } else if (d.w === 'rocket') {
        spawnRocket(new THREE.Vector3(...d.o), new THREE.Vector3(...d.v), false);
      }
    },
    onHit(peerId, d) { if (!ctx.cars.driving()) takeDamage(d.dmg, d.by, d.w); else ctx.cars.damageMine(d.dmg); },
    onDead(peerId, d) { ctx.killfeed(d.by, d.n, d.w); },
    update(dt) {
      updateRockets(dt);
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        f.age += dt;
        const k = Math.min(1, f.age / f.life);
        f.tick?.(k, dt);
        if (k >= 1) { scene.remove(f.obj); f.obj.geometry?.dispose(); fx.splice(i, 1); }
      }
    },
  };
}
