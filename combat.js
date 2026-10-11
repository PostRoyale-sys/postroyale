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
  sniper: { name: 'Sniper', tag: 'SNP', ammo: 'heavy', dmg: 95, pellets: 1, mag: 1, rate: 1.4, reload: 2.2, spread: 0, range: 200, scope: true, head: 2 },
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
export const MED = { max: 3, heal: 40, time: 3 };      // аптечки: в слоте до 3, лечение 3 с, +40 HP
const ROCKET = { speed: 34, gravity: 3, life: 5 };
const EXPLODE_R = 4, BUILD_DMG = 250, BLAST_R = 5.5, BLAST_DMG = 100;     // базука: радиус и урон по постройкам, по игрокам
const HEAD = 1.5;                 // множитель урона в голову (у снайперки свой — spec.head)

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
  let meds = 0, healUntil = 0;                // аптечки в слоте и конец текущего лечения
  // обвесы из Gunsmith (только для своего оружия)
  const mods = (type) => ctx.mods?.(type) || { mag: 1, reload: 1, spread: 1, optic: null };
  const magOf = (type) => WEAPONS[type].mag * mods(type).mag;
  // разброс с учётом рукоятки и прицеливания через оптику
  const spreadFor = (type) => {
    const spec = WEAPONS[type], md = mods(type);
    if (spec.scope && ctx.scoped()) return 0;
    let s = (spec.spread || 0) * md.spread * (ctx.moving() ? 1.6 : 1) * (ctx.crouched?.() ? 0.6 : 1) * (ctx.prone?.() ? 0.65 : 1);
    if (md.optic && ctx.scoped()) s *= md.optic.ads;
    return s;
  };
  const fx = [];
  const rockets = [];

  // ---------- Звук (audio.js) ----------

  const sound = (kind, p) => ctx.audio?.play(kind, p);

  // ---------- Эффекты ----------

  function addFx(obj, life, tick) {
    scene.add(obj);
    fx.push({ obj, age: 0, life, tick });
  }

  // Трассер: светящийся след по всей длине (тает) и яркая «пуля», которая летит от дула к цели.
  // Аддитивное смешивание — на фоне неба и в тени одинаково заметно; издалека видно, где идёт перестрелка.
  const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  BOX.userData.shared = true;
  function tracer(a, b, color = 0xffe066) {
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    const add = { color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const trail = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ ...add, opacity: 0.5 }));
    trail.position.copy(a); trail.lookAt(b); trail.scale.set(0.035, 0.035, len);
    addFx(trail, 0.16, (k) => { trail.material.opacity = 0.5 * (1 - k) ** 2; trail.scale.x = trail.scale.y = 0.035 + k * 0.05; });
    const head = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ ...add, color: 0xfffbe0 }));
    const hl = Math.min(4, len * 0.5), fly = Math.min(0.12, len / 700);
    head.position.copy(a); head.lookAt(b); head.scale.set(0.07, 0.07, hl);
    const dir = b.clone().sub(a).normalize();
    addFx(head, fly + 0.02, (k) => { const d = Math.min(1, k * (fly + 0.02) / Math.max(fly, 1e-3)) * (len - hl); head.position.copy(a).addScaledVector(dir, d); });
  }

  // Вспышка у дула (чужие выстрелы: видно, откуда стреляют).
  const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,214,90,.9)'); gr.addColorStop(1, 'rgba(255,140,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  function muzzleFlash(p, size = 1.1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(p);
    s.material.rotation = Math.random() * 6;
    addFx(s, 0.07, (k) => { s.scale.setScalar(size * (0.7 + k * 0.6)); s.material.opacity = 1 - k; });
  }

  // mult > 1 (взрыв машины) — шар крупнее и дольше, плюс клубы дыма, которые поднимаются и тают.
  function explosionFx(p, mult = 1) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true }));
    ball.position.copy(p);
    addFx(ball, 0.5 * mult, (k) => { ball.scale.setScalar(0.5 + k * BLAST_R * mult); ball.material.opacity = 1 - k; });
    if (mult > 1) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true }));
      core.position.copy(p);
      addFx(core, 0.35, (k) => { core.scale.setScalar(0.6 + k * 3.2); core.material.opacity = 1 - k; });
      for (let i = 0; i < 5; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3a3a40, transparent: true, depthWrite: false }));
        const off = new THREE.Vector3((Math.random() - 0.5) * 3, 0.5 + i * 0.6, (Math.random() - 0.5) * 3);
        puff.position.copy(p).add(off);
        addFx(puff, 1.8, (k, dt) => { puff.position.y += dt * 2.2; puff.scale.setScalar(1 + k * 2.5); puff.material.opacity = 0.75 * (1 - k); });
      }
    }
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
    sound(w === 'storm' ? 'stormZap' : toShield > 0 && shield <= 0 ? 'shieldBreak' : toShield >= dmg ? 'shieldHurt' : 'hurt');
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
    for (; meds > 0; meds--) items.push({ k: 'med', w: 'med', a: MED.heal });
    healUntil = 0;
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
      const pr = !!o.target?.pr, top = pr ? 0.75 : o.target?.cr ? 1.35 : 1.95;   // присевший — ниже, лежачий — плашмя
      const w = pr ? 1.0 : 0.4;
      list.push({ kind: 'player', id: peerId, sd: !!o.target?.sd, pr, cr: !!o.target?.cr, min: new THREE.Vector3(p.x - w, p.y - (pr ? 0.32 : 0), p.z - w), max: new THREE.Vector3(p.x + w, p.y + top - (pr ? 0.32 : 0), p.z + w) });
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
    const spread = spreadFor(w.type);
    const muzzle = o.clone().addScaledVector(base, 0.6).add(new THREE.Vector3(0, -0.15, 0));
    const ends = [];
    const dmgBy = new Map();     // цель → суммарный урон (дробовик: все дробины одним пакетом)
    const hitAt = new Map();     // цель → точка первого попадания (для числа урона)
    const heads = new Set();     // цели, которым попали в голову
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
      if (!best && ob.point) ctx.impact?.(end, ob.e, d);
      if (best && !hitAt.has(best)) hitAt.set(best, end);
      ends.push(end);
      tracer(muzzle, end, spec.pellets > 1 ? 0xffc46a : 0xffd84a);
      // голова — верхние ~0.42 м стоящего/присевшего (лежачего — нет)
      const head = best && !best.pr && end.y > best.max.y - (best.cr ? 0.36 : 0.42);
      if (head) heads.add(best);
      if (best) dmgBy.set(best, (dmgBy.get(best) || 0) + spec.dmg * mult * (head ? spec.head || HEAD : 1));
    }
    ctx.audio?.shot(w.type, null);
    const r2 = (v) => v.toArray().map((x) => +x.toFixed(2));
    ctx.net()?.shot({ w: w.type, o: r2(muzzle), e: ends.map(r2) });
    for (const [t, dmg] of dmgBy) {
      ctx.sendHit(t.id, { dmg: Math.round(dmg), by: ctx.nick(), w: w.type });
      ctx.hitmarker(heads.has(t) ? 'head' : '');
      ctx.dmgNumber?.(hitAt.get(t), Math.round(dmg), t.id, heads.has(t));
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
    ctx.audio?.shot('bazooka', own ? null : o);
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
    explosionFx(p, mult);
    if (!own) return;
    for (const [k, dmg] of ctx.structures().blast(p, EXPLODE_R, BUILD_DMG * mult)) ctx.damageStructure(k, dmg, false);
    for (const t of targets()) {
      const c = t.min.clone().add(t.max).multiplyScalar(0.5);
      const d = c.distanceTo(p);
      if (d > BLAST_R) continue;
      const dmg = Math.round(BLAST_DMG * mult * (1 - d / BLAST_R));
      ctx.sendHit(t.id, { dmg, by: ctx.nick(), w: 'bazooka' });
      ctx.hitmarker();
      ctx.dmgNumber?.(c, dmg, t.id);
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
    if (w.mag >= magOf(w.type) || ammo[spec.ammo] <= 0 || reloadUntil) return false;
    reloadSlot = i;
    reloadUntil = performance.now() / 1000 + spec.reload * mods(w.type).reload;
    changed();
    return true;
  }

  function finishReload() {
    const w = slots[reloadSlot];
    reloadUntil = 0;
    if (!w) return;
    const spec = WEAPONS[w.type];
    const take = Math.min(magOf(w.type) - w.mag, ammo[spec.ammo]);
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
      return spreadFor(w.type);
    },
    get reloading() { return reloadUntil ? { slot: reloadSlot, left: reloadUntil - performance.now() / 1000 } : null; },

    // Новый раунд: пустые руки, ни патронов, ни щита.
    resetAll() {
      slots.fill(null);
      for (const k of Object.keys(ammo)) ammo[k] = 0;
      hp = 100; shield = 0; reloadUntil = 0; nextShot = 0; meds = 0; healUntil = 0;
      changed();
    },

    // Выстрел из слота i. Возвращает true, если выстрелил.
    fire(i, now) {
      const w = slots[i];
      if (!w || now < nextShot || !ctx.canPlay()) return false;
      if (reloadUntil) return false;
      const spec = WEAPONS[w.type];
      if (w.mag <= 0) { if (!startReload(i)) sound('dry'); nextShot = now + 0.25; return false; }
      w.mag--;
      nextShot = now + spec.rate;
      if (spec.rocket) fireRocket(w); else hitscan(w, spec);
      if (w.mag <= 0) startReload(i);
      changed();
      return true;
    },
    reload(i) { return startReload(i); },
    cancelReload() { if (reloadUntil) { reloadUntil = 0; changed(); } },

    // Аптечки: ЛКМ со слотом аптечек — лечение MED.time секунд, потом +MED.heal HP.
    get meds() { return meds; },
    get healing() { return healUntil ? { left: healUntil - performance.now() / 1000 } : null; },
    startHeal() {
      if (!meds || healUntil || hp >= 100 || !ctx.canPlay()) return false;
      reloadUntil = 0;
      healUntil = performance.now() / 1000 + MED.time;
      changed();
      return true;
    },
    cancelHeal() { if (healUntil) { healUntil = 0; changed(); } },

    // Подобрать предмет. Возвращает true, если взяли (иначе он остаётся лежать).
    // Возьмёт ли игрок предмет (без побочных эффектов) — для «магнита» лута.
    canGive(item) {
      if (item.k === 'ammo') return true;
      if (item.k === 'armor') return shield < MAX_SHIELD;
      if (item.k === 'med') return meds < MED.max;
      if (item.k === 'weapon') return slots.some((s) => !s);
      return false;
    },
    give(item, slotHint) {
      if (item.k === 'ammo') { ammo[item.w] += item.a; sound('pickAmmo'); changed(); return true; }
      if (item.k === 'armor') {
        if (shield >= MAX_SHIELD) return false;
        shield = Math.min(MAX_SHIELD, shield + item.a);
        sound('pickArmor'); changed(); return true;
      }
      if (item.k === 'med') {
        if (meds >= MED.max) return false;
        meds++;
        sound('pickMed'); changed(); return true;
      }
      if (item.k === 'weapon') {
        const free = slotHint ?? slots.findIndex((s) => !s);
        if (free < 0) return false;
        // полный магазин с земли — сразу полный и с твоим «двойным»
        slots[free] = { type: item.w, rarity: item.r, mag: item.a == null || item.a >= WEAPONS[item.w].mag ? magOf(item.w) : item.a };
        sound('pickWeapon'); changed(); return true;
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
    explodeAt(p, own, mult = 1) { explode(p, own, mult); },

    onShot(peerId, d) {
      if (d.w === 'bazooka' || d.w === 'rocket') {
        spawnRocket(new THREE.Vector3(...d.o), new THREE.Vector3(...d.v), false);
        return;
      }
      const a = new THREE.Vector3(...d.o);
      for (const e of d.e || []) tracer(a, new THREE.Vector3(...e), (d.e.length > 1) ? 0xffc46a : 0xffd84a);
      muzzleFlash(a, d.w === 'shotgun' || d.w === 'sniper' ? 1.5 : 1.1);
      ctx.audio?.shot(d.w, a);
      if (d.e?.length) ctx.audio?.whiz(a, new THREE.Vector3(...d.e[0]));
    },
    onHit(peerId, d) { takeDamage(d.dmg, d.by, d.w); },
    onDead(peerId, d) { ctx.killfeed(d.by, d.n, d.w); },

    update(dt) {
      if (reloadUntil && performance.now() / 1000 >= reloadUntil) finishReload();
      if (healUntil && performance.now() / 1000 >= healUntil) {
        healUntil = 0;
        if (meds > 0 && hp > 0) { meds--; hp = Math.min(100, hp + MED.heal); sound('healDone'); }
        changed();
      }
      updateRockets(dt);
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        f.age += dt;
        const k = Math.min(1, f.age / f.life);
        f.tick?.(k, dt);
        if (k >= 1) { scene.remove(f.obj); if (!f.obj.geometry?.userData.shared) f.obj.geometry?.dispose(); f.obj.material?.dispose(); fx.splice(i, 1); }
      }
    },
  };
}
