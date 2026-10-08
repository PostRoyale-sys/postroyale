// Бой: оружие разной редкости, патроны, магазин и перезарядка, здоровье и щит (броня), взрывы, эффекты, звуки.
// Оружие не выдаётся — его находят в сундуках (loot.js). У игрока 3 слота под оружие и запас патронов по типам.
// Кто стрелял, тот и считает попадания и разрушения: шлёт hit тому, в кого попал, и урон постройкам всем.

import * as THREE from 'three';

// ---------- Справочники ----------

export const RARITY = [
  { name: 'Common', color: '#b0b6bf', mult: 1.0 },
  { name: 'Uncommon', color: '#3fc85a', mult: 1.1 },
  { name: 'Rare', color: '#3d9bff', mult: 1.2 },
  { name: 'Epic', color: '#b45cff', mult: 1.32 },
  { name: 'Legendary', color: '#ffb020', mult: 1.45 },
];

// dmg — за пулю/дробину (до множителя редкости); rate — секунд между выстрелами; spread — разброс (радианы).
export const WEAPONS = {
  pistol: { name: 'Pistol', tag: 'PST', ammo: 'light', dmg: 22, pellets: 1, mag: 12, rate: 0.2, reload: 1.2, spread: 0.012, range: 70 },
  smg: { name: 'SMG', tag: 'SMG', ammo: 'light', dmg: 13, pellets: 1, mag: 30, rate: 0.075, reload: 1.8, spread: 0.04, range: 50, auto: true },
  ar: { name: 'Assault Rifle', tag: 'AR', ammo: 'medium', dmg: 27, pellets: 1, mag: 25, rate: 0.13, reload: 2.0, spread: 0.02, range: 90, auto: true },
  shotgun: { name: 'Shotgun', tag: 'SG', ammo: 'shells', dmg: 10, pellets: 9, mag: 5, rate: 0.85, reload: 2.4, spread: 0.09, range: 25 },
  sniper: { name: 'Sniper', tag: 'SNP', ammo: 'heavy', dmg: 95, pellets: 1, mag: 1, rate: 1.4, reload: 2.2, spread: 0, range: 200, scope: true },
  bazooka: { name: 'Bazooka', tag: 'BZK', ammo: 'rockets', mag: 1, rate: 1.0, reload: 2.4, rocket: true, minRarity: 1 },
};

export const AMMO = {
  light: { name: 'Light ammo', color: '#d9d9d9', pack: 30 },
  medium: { name: 'Medium ammo', color: '#7fc4ff', pack: 30 },
  shells: { name: 'Shells', color: '#f4212e', pack: 10 },
  heavy: { name: 'Heavy ammo', color: '#4a4a4a', pack: 6 },
  rockets: { name: 'Rockets', color: '#ff7a1a', pack: 4 },
};

export const MAX_SHIELD = 100;
const ROCKET = { speed: 34, gravity: 3, life: 5 };
const EXPLODE_R = 4, BUILD_DMG = 250, BLAST_R = 5.5, BLAST_DMG = 100;     // базука: радиус и урон по постройкам, по игрокам

export const weaponLabel = (w) => `${RARITY[w.rarity].name} ${WEAPONS[w.type].name}`;

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
  let hp = 100, shield = 0;
  const slots = [null, null, null];           // { type, rarity, mag }
  const ammo = Object.fromEntries(Object.keys(AMMO).map((k) => [k, 0]));
  let nextShot = 0, reloadUntil = 0, reloadSlot = -1;
  const fx = [];
  const rockets = [];

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
  const volAt = (p) => Math.max(0, 1 - camera.getWorldPosition(new THREE.Vector3()).distanceTo(p) / 70);
  const SOUNDS = {
    pistol: (v) => noise(0.12, 2500, 0.35 * v, 'highpass'),
    smg: (v) => noise(0.07, 3200, 0.25 * v, 'highpass'),
    ar: (v) => noise(0.11, 1800, 0.35 * v, 'highpass'),
    shotgun: (v) => noise(0.3, 900, 0.6 * v),
    sniper: (v) => noise(0.45, 1200, 0.7 * v),
    bazooka: (v) => noise(0.45, 500, 0.45 * v),
    boom: (v) => noise(0.9, 400, 0.9 * v),
    pickup: (v) => noise(0.05, 5000, 0.15 * v, 'highpass'),
    chop: (v) => noise(0.09, 1400, 0.4 * v),
    build: (v) => noise(0.06, 2600, 0.25 * v),
    swing: (v) => noise(0.08, 3800, 0.12 * v, 'highpass'),
  };
  const sound = (kind, p) => SOUNDS[kind]?.((p ? volAt(p) : 1) * (ctx.volume?.() ?? 1));

  // ---------- Эффекты ----------

  function addFx(obj, life, tick) {
    scene.add(obj);
    fx.push({ obj, age: 0, life, tick });
  }

  function tracer(a, b, color = 0xffe066) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, transparent: true }));
    addFx(line, 0.12, (k) => { line.material.opacity = 1 - k; });
  }

  function explosionFx(p) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true }));
    ball.position.copy(p);
    addFx(ball, 0.5, (k) => { ball.scale.setScalar(0.5 + k * BLAST_R); ball.material.opacity = 1 - k; });
    for (let i = 0; i < 14; i++) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshLambertMaterial({ color: i % 2 ? 0x6b5a45 : 0x8a8a90 }));
      cube.position.copy(p);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).multiplyScalar(14);
      addFx(cube, 0.9, (k, dt) => { v.y -= 30 * dt; cube.position.addScaledVector(v, dt); cube.rotation.x += dt * 8; });
    }
    sound('boom', p);
    const d = camera.getWorldPosition(new THREE.Vector3()).distanceTo(p);
    if (d < 14) ctx.shake(0.5 * (1 - d / 14));
  }

  // ---------- Здоровье, щит, смерть ----------

  const changed = () => ctx.onInventory();

  function takeDamage(dmg, by, w) {
    if (hp <= 0 || !ctx.canPlay()) return;               // наблюдателя не бьют
    const toShield = Math.min(shield, dmg);
    shield -= toShield;
    hp = Math.max(0, hp - (dmg - toShield));
    ctx.flash(toShield > 0 && hp > 0 ? 'shield' : 'hp');
    if (hp <= 0) die(by, w);
    changed();
  }

  // Смерть: всё оружие и патроны падают на землю; дальше решает раунд (royale.js) — выбыл до конца раунда.
  function die(by, w) {
    ctx.net()?.dead({ n: ctx.nick(), by, w });
    ctx.killfeed(by, ctx.nick(), w);
    const items = [];
    slots.forEach((s, i) => { if (s) items.push({ k: 'weapon', w: s.type, r: s.rarity, a: s.mag }); slots[i] = null; });
    for (const [k, n] of Object.entries(ammo)) if (n > 0) { items.push({ k: 'ammo', w: k, a: n }); ammo[k] = 0; }
    ctx.dropItems(ctx.feet().clone(), items);
    hp = 100;
    shield = 0;
    reloadUntil = 0;
    ctx.died(by, w);
    changed();
  }

  // ---------- Цели ----------

  function targets() {
    const list = [];
    for (const [peerId, o] of ctx.others) {
      if (o.target?.a === false) continue;               // наблюдатель — не цель
      const p = o.group.position;
      const top = o.target?.cr ? 1.35 : 1.95;              // присевший — ниже
      list.push({ kind: 'player', id: peerId, min: new THREE.Vector3(p.x - 0.4, p.y, p.z - 0.4), max: new THREE.Vector3(p.x + 0.4, p.y + top, p.z + 0.4) });
    }
    return list;
  }

  // Ближайшее препятствие на луче: постройка/объект (её и бьём) или рельеф.
  function obstacle(o, d, range) {
    return ctx.structures().raycast(o, d, range) || { t: range, e: null };
  }

  // ---------- Стрельба ----------

  function hitscan(w, spec) {
    const mult = RARITY[w.rarity].mult;
    const o = camera.getWorldPosition(new THREE.Vector3());
    const base = camera.getWorldDirection(new THREE.Vector3());
    const scoped = spec.scope && ctx.scoped();
    const spread = scoped ? 0 : spec.spread * (ctx.moving() ? 1.6 : 1) * (ctx.crouched?.() ? 0.6 : 1);
    const muzzle = o.clone().addScaledVector(base, 0.6).add(new THREE.Vector3(0, -0.15, 0));
    const ends = [];
    const dmgBy = new Map();     // цель → суммарный урон (дробовик: все дробины одним пакетом)
    const dmgBuild = new Map();  // постройка → урон
    const tlist = targets();
    for (let i = 0; i < spec.pellets; i++) {
      const d = base.clone();
      if (spread) d.add(new THREE.Vector3((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread)).normalize();
      const ob = obstacle(o, d, spec.range);
      let tBest = ob.t, best = null;
      for (const t of tlist) {
        const tt = rayBox(o, d, t.min, t.max);
        if (tt < tBest) { tBest = tt; best = t; }
      }
      if (!best && ob.e) dmgBuild.set(ob.e.k, (dmgBuild.get(ob.e.k) || 0) + spec.dmg * mult);
      const end = o.clone().addScaledVector(d, Math.min(tBest, spec.range));
      ends.push(end);
      tracer(muzzle, end, spec.pellets > 1 ? 0xffd38a : 0xffe066);
      if (best) dmgBy.set(best, (dmgBy.get(best) || 0) + spec.dmg * mult);
    }
    sound(w.type, null);
    const r2 = (v) => v.toArray().map((x) => +x.toFixed(2));
    ctx.net()?.shot({ w: w.type, o: r2(muzzle), e: ends.map(r2) });
    for (const [t, dmg] of dmgBy) {
      ctx.sendHit(t.id, { dmg: Math.round(dmg), by: ctx.nick(), w: w.type });
      ctx.hitmarker();
    }
    for (const [k, dmg] of dmgBuild) ctx.damageStructure(k, Math.round(dmg), false);
    ctx.recoil(w.type);
  }

  function rocketModel() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.75), new THREE.MeshLambertMaterial({ color: 0x5b6b3a }));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.2), new THREE.MeshLambertMaterial({ color: 0xd23b2a }));
    tip.position.z = 0.45;
    const fins = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.16), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    fins.position.z = -0.33;
    const fins2 = fins.clone();
    fins2.rotation.z = Math.PI / 2;
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.3), new THREE.MeshBasicMaterial({ color: 0xffb23a }));
    flame.position.z = -0.55;
    g.add(body, tip, fins, fins2, flame);
    return g;
  }

  // Дымный след: серые кубики, растут и тают.
  function smoke(p) {
    const puff = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.6 }));
    puff.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15));
    addFx(puff, 0.9, (k, dt) => { puff.scale.setScalar(1 + k * 2.5); puff.material.opacity = 0.6 * (1 - k); puff.position.y += dt * 0.6; });
  }

  function spawnRocket(o, v, own) {
    const mesh = rocketModel();
    mesh.position.copy(o);
    mesh.lookAt(o.clone().add(v));
    scene.add(mesh);
    rockets.push({ mesh, pos: o.clone(), vel: v.clone(), own, age: 0, puff: 0 });
    sound('bazooka', o);
  }

  function fireRocket(w) {
    const o = camera.getWorldPosition(new THREE.Vector3());
    const d = camera.getWorldDirection(new THREE.Vector3());
    const start = o.clone().addScaledVector(d, 0.9);
    const v = d.clone().multiplyScalar(ROCKET.speed);
    spawnRocket(start, v, true);
    rockets[rockets.length - 1].mult = RARITY[w.rarity].mult;
    ctx.net()?.shot({ w: 'bazooka', o: start.toArray().map((x) => +x.toFixed(2)), v: v.toArray().map((x) => +x.toFixed(2)) });
    ctx.recoil('bazooka');
  }

  function explode(p, own, mult = 1) {
    explosionFx(p);
    if (!own) return;
    for (const [k, dmg] of ctx.structures().blast(p, EXPLODE_R, BUILD_DMG * mult)) ctx.damageStructure(k, dmg, false);
    for (const t of targets()) {
      const c = t.min.clone().add(t.max).multiplyScalar(0.5);
      const d = c.distanceTo(p);
      if (d > BLAST_R) continue;
      const dmg = Math.round(BLAST_DMG * mult * (1 - d / BLAST_R));
      ctx.sendHit(t.id, { dmg, by: ctx.nick(), w: 'bazooka' });
      ctx.hitmarker();
    }
    const me = ctx.feet().clone().add(new THREE.Vector3(0, 0.9, 0));
    const dm = me.distanceTo(p);
    if (dm < BLAST_R) {
      takeDamage(Math.round(BLAST_DMG * 0.6 * (1 - dm / BLAST_R)), ctx.nick(), 'bazooka');
      ctx.knock(me.clone().sub(p).normalize().multiplyScalar(12 * (1 - dm / BLAST_R)));
    }
  }

  function updateRockets(dt) {
    const st = ctx.structures();
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.age += dt;
      r.vel.y -= ROCKET.gravity * dt;
      const n = Math.max(1, Math.ceil((r.vel.length() * dt) / 0.4));
      let boom = r.age > ROCKET.life;
      for (let k = 0; k < n && !boom; k++) {
        r.pos.addScaledVector(r.vel, dt / n);
        if (st.solidAt(r.pos)) boom = true;
        else if (r.own && r.age > 0.08) {
          for (const t of targets()) {
            if (r.pos.x > t.min.x - 0.2 && r.pos.x < t.max.x + 0.2 && r.pos.y > t.min.y - 0.2 && r.pos.y < t.max.y + 0.2 &&
                r.pos.z > t.min.z - 0.2 && r.pos.z < t.max.z + 0.2) { boom = true; break; }
          }
        }
      }
      r.mesh.position.copy(r.pos);
      r.mesh.lookAt(r.pos.clone().add(r.vel));
      r.puff += dt;
      if (r.puff > 0.03) { r.puff = 0; smoke(r.pos.clone().addScaledVector(r.vel.clone().normalize(), -0.6)); }
      if (boom) {
        scene.remove(r.mesh);
        rockets.splice(i, 1);
        explode(r.pos.clone(), r.own, r.mult || 1);
      }
    }
  }

  // ---------- Перезарядка ----------

  function startReload(i) {
    const w = slots[i];
    if (!w) return false;
    const spec = WEAPONS[w.type];
    if (w.mag >= spec.mag || ammo[spec.ammo] <= 0 || reloadUntil) return false;
    reloadSlot = i;
    reloadUntil = performance.now() / 1000 + spec.reload;
    changed();
    return true;
  }

  function finishReload() {
    const w = slots[reloadSlot];
    reloadUntil = 0;
    if (!w) return;
    const spec = WEAPONS[w.type];
    const take = Math.min(spec.mag - w.mag, ammo[spec.ammo]);
    w.mag += take;
    ammo[spec.ammo] -= take;
    changed();
  }

  // ---------- Публичное ----------

  return {
    get hp() { return hp; },
    sfx: (kind, p) => sound(kind, p),
    get shield() { return shield; },
    slots, ammo,
    // Текущий разброс оружия в слоте i (для прицела): радианы.
    spreadOf(i) {
      const w = slots[i];
      if (!w) return 0;
      const spec = WEAPONS[w.type];
      return (spec.spread || 0) * (ctx.moving() ? 1.6 : 1) * (ctx.crouched?.() ? 0.6 : 1);
    },
    get reloading() { return reloadUntil ? { slot: reloadSlot, left: reloadUntil - performance.now() / 1000 } : null; },

    // Новый раунд: пустые руки, ни патронов, ни щита.
    resetAll() {
      slots.fill(null);
      for (const k of Object.keys(ammo)) ammo[k] = 0;
      hp = 100; shield = 0; reloadUntil = 0; nextShot = 0;
      changed();
    },

    // Выстрел из слота i. Возвращает true, если выстрелил.
    fire(i, now) {
      const w = slots[i];
      if (!w || now < nextShot || !ctx.canPlay()) return false;
      if (reloadUntil) return false;
      const spec = WEAPONS[w.type];
      if (w.mag <= 0) { startReload(i); return false; }
      w.mag--;
      nextShot = now + spec.rate;
      if (spec.rocket) fireRocket(w); else hitscan(w, spec);
      if (w.mag <= 0) startReload(i);
      changed();
      return true;
    },
    reload(i) { return startReload(i); },
    cancelReload() { if (reloadUntil) { reloadUntil = 0; changed(); } },

    // Подобрать предмет. Возвращает true, если взяли (иначе он остаётся лежать).
    give(item, slotHint) {
      if (item.k === 'ammo') { ammo[item.w] += item.a; sound('pickup'); changed(); return true; }
      if (item.k === 'armor') {
        if (shield >= MAX_SHIELD) return false;
        shield = Math.min(MAX_SHIELD, shield + item.a);
        sound('pickup'); changed(); return true;
      }
      if (item.k === 'med') {
        if (hp >= 100) return false;
        hp = Math.min(100, hp + item.a);
        sound('pickup'); changed(); return true;
      }
      if (item.k === 'weapon') {
        const free = slotHint ?? slots.findIndex((s) => !s);
        if (free < 0) return false;
        slots[free] = { type: item.w, rarity: item.r, mag: item.a ?? WEAPONS[item.w].mag };
        sound('pickup'); changed(); return true;
      }
      return false;
    },
    // Вынуть оружие из слота (для выброса/замены).
    take(i) {
      const w = slots[i];
      slots[i] = null;
      if (reloadSlot === i) reloadUntil = 0;
      changed();
      return w;
    },

    takeDamage,
    explodeAt(p, own) { explode(p, own); },

    onShot(peerId, d) {
      if (d.w === 'bazooka' || d.w === 'rocket') {
        spawnRocket(new THREE.Vector3(...d.o), new THREE.Vector3(...d.v), false);
        return;
      }
      const a = new THREE.Vector3(...d.o);
      for (const e of d.e || []) tracer(a, new THREE.Vector3(...e), (d.e.length > 1) ? 0xffd38a : 0xffe066);
      sound(d.w, a);
    },
    onHit(peerId, d) { takeDamage(d.dmg, d.by, d.w); },
    onDead(peerId, d) { ctx.killfeed(d.by, d.n, d.w); },

    update(dt) {
      if (reloadUntil && performance.now() / 1000 >= reloadUntil) finishReload();
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
