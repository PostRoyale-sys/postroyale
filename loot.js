// Лут как в Fortnite: золотые сундуки по острову → случайное оружие разной редкости, патроны к нему, броня, аптечки.
// Места сундуков — из id мира и номера раунда (у всех одинаковые, каждый раунд новые). Открытый сундук пропадает у всех
// до конца раунда. Предметы на земле — общие: кто первый подошёл, тот и забрал (take — у всех исчезает).
// Новый раунд (royale.js) — всё заново: сундуки закрыты, предметы с земли убраны, пакеты прошлого раунда игнорируются.

import * as THREE from 'three';
import { MAP, WATER_Y, rng, seedOf } from './map.js';
import { WEAPONS, AMMO, RARITY, weaponLabel } from './combat.js';

const CHESTS = 90;                     // не больше стольких сундуков за раунд
const CHEST_CHANCE = 0.95;             // доля мест, где в раунде есть сундук
const OPEN_RANGE = 4;
const PICK_RANGE = 2.4;
const MAGNET = 6, MAGNET_SPEED = 14;     // то, что игрок может взять, в радиусе MAGNET само летит к нему
// Аирдропы: ящик на парашюте приземляется в зоне в эти секунды раунда (место — от сида и раунда, у всех одно).
// За WARN с до начала падения — луч-маяк в небо и объявление; падает FALL с с высоты DROP_H.
const DROPS = [72, 132, 188];
const FALL = 14, WARN = 10, DROP_H = 95;

// Таблица выпадения.
const RARITY_WEIGHTS = [40, 28, 18, 10, 4];       // обычное → легендарное
const WEAPON_WEIGHTS = { pistol: 20, smg: 18, ar: 20, shotgun: 17, sniper: 11, bazooka: 14 };

function weighted(table, rand = Math.random) {
  const entries = Object.entries(table);
  let r = rand() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((r -= w) <= 0) return k; }
  return entries[0][0];
}

// bonus — +к редкости (золотой ключ держателя токена).
function rollChest(bonus = 0) {
  let type = weighted(WEAPON_WEIGHTS);
  let rarity = Math.min(RARITY.length - 1, +weighted(Object.fromEntries(RARITY_WEIGHTS.map((w, i) => [i, w]))) + bonus);
  const min = WEAPONS[type].minRarity || 0;
  if (rarity < min) rarity = min;
  const spec = WEAPONS[type];
  const items = [
    { k: 'weapon', w: type, r: rarity, a: spec.mag },
    { k: 'ammo', w: spec.ammo, a: AMMO[spec.ammo].pack },
    { k: 'ammo', w: spec.ammo, a: AMMO[spec.ammo].pack },
  ];
  if (Math.random() < 0.55) items.push(Math.random() < 0.75 ? { k: 'armor', w: 'light', a: 50 } : { k: 'armor', w: 'heavy', a: 100 });
  if (Math.random() < 0.35) items.push({ k: 'med', w: 'med', a: 40 });
  if (Math.random() < 0.3) { const t = weighted({ light: 3, medium: 3, shells: 2, heavy: 1 }); items.push({ k: 'ammo', w: t, a: AMMO[t].pack }); }
  return items;
}

export const itemLabel = (it) => {
  if (it.k === 'weapon') return weaponLabel({ type: it.w, rarity: it.r });
  if (it.k === 'ammo') return `${AMMO[it.w].name} ×${it.a}`;
  if (it.k === 'armor') return it.w === 'heavy' ? 'Heavy armor +100' : 'Light armor +50';
  return 'Medkit +40';
};

// Аирдроп: эпическое+ оружие и полный «набор выживания».
function rollDrop() {
  const items = rollChest(2);
  items.push({ k: 'armor', w: 'heavy', a: 100 }, { k: 'med', w: 'med', a: 40 }, { k: 'med', w: 'med', a: 40 });
  const t = weighted({ light: 3, medium: 3, shells: 2, heavy: 1 });
  items.push({ k: 'ammo', w: t, a: AMMO[t].pack * 2 });
  return items;
}

// ---------- Модели ----------

function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1);
  return s;
}

function chestModel() {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
  const gold = new THREE.MeshLambertMaterial({ color: 0xffc83d, emissive: 0x4a3200 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), wood);
  base.position.y = 0.25;
  // крышка на петле у задней кромки (+Z): при открытии откидывается назад
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.5, 0.31);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.62), gold);
  lid.position.set(0, 0.1, -0.31);
  hinge.add(lid);
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), gold);
  latch.position.set(0, 0.45, -0.32);
  const glow = glowSprite('rgba(255,200,60,0.55)', 2.4);
  glow.position.y = 0.5;
  // вспышка при открытии
  const burst = glowSprite('rgba(255,230,140,0.9)', 1);
  burst.position.y = 0.7;
  burst.visible = false;
  g.add(base, hinge, latch, glow, burst);
  g.userData.glow = glow;
  g.userData.hinge = hinge;
  g.userData.burst = burst;
  return g;
}

// Ящик аирдропа: фиолетовый с золотыми рёбрами и эмблемой, купол парашюта со стропами, луч-маяк в небо.
// userData — как у сундука (hinge/burst/glow), плюс body (едет вниз), chute и beam.
function dropModel() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const purple = new THREE.MeshLambertMaterial({ color: 0x7a3cff, emissive: 0x24104a });
  const gold = new THREE.MeshLambertMaterial({ color: 0xffc83d, emissive: 0x5a3a00 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.3), purple);
  base.position.y = 0.4;
  body.add(base);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {        // вертикальные рёбра
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.12, 0.12), gold);
    e.position.set(sx * 0.62, 0.56, sz * 0.62);
    body.add(e);
  }
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.14, 1.36), gold);
  band.position.y = 0.42;
  body.add(band);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.8, 0.66);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.3, 1.36), purple);
  lid.position.set(0, 0.15, -0.66);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), gold);
  star.position.set(0, 0.36, -0.66);
  hinge.add(lid, star);
  body.add(hinge);
  // купол: полусфера в полоску + стропы к углам ящика
  const chute = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5cc4ff, emissive: 0x0a2a44, side: THREE.DoubleSide }));
  dome.scale.y = 0.6;
  dome.position.y = 4.2;
  const lines = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lines.push(new THREE.Vector3(sx * 0.6, 1.1, sz * 0.6), new THREE.Vector3(sx * 1.9, 4.3, sz * 1.9));
  chute.add(dome, new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: 0x23262d })));
  body.add(chute);
  const glow = glowSprite('rgba(170,110,255,0.6)', 3.2);
  glow.position.y = 0.6;
  body.add(glow);
  const burst = glowSprite('rgba(220,190,255,0.95)', 1);
  burst.position.y = 0.9;
  burst.visible = false;
  body.add(burst);
  // маяк: высокий светящийся столб над точкой посадки
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 160, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xa070ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.y = 80;
  g.add(body, beam);
  g.userData = { glow, hinge, burst, body, chute, beam };
  return g;
}

function itemModel(it) {
  const g = new THREE.Group();
  let color;
  if (it.k === 'weapon') {
    color = RARITY[it.r].color;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.18, 0.16), new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.25) }));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.14), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    grip.position.set(-0.18, -0.16, 0);
    g.add(body, grip);
    // Луч редкости в небо — видно лут издалека.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6, 0.08), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    beam.position.y = 3;
    g.add(beam);
  } else if (it.k === 'ammo') {
    color = AMMO[it.w].color;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.24), new THREE.MeshLambertMaterial({ color })));
  } else if (it.k === 'armor') {
    color = it.w === 'heavy' ? '#3d6bff' : '#5ab4ff';
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.16), new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.3) }));
    g.add(plate);
  } else {
    color = '#ffffff';
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.26, 0.26), new THREE.MeshLambertMaterial({ color: 0xffffff })));
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.27), new THREE.MeshBasicMaterial({ color: 0xf4212e }));
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.27), new THREE.MeshBasicMaterial({ color: 0xf4212e }));
    g.add(cross, cross2);
  }
  const glow = glowSprite(`${color}88`, 1.2);
  g.add(glow);
  g.userData.glow = glow;
  g.userData.rare = it.k === 'weapon' ? it.r : -1;
  return g;
}

// ---------- Модуль ----------

export function createLoot(ctx) {
  const { scene } = ctx;
  const chests = [];                // { i, pos, group, openedAt }
  const items = new Map();          // id → { ...item, id, pos, group }
  let seq = 0, round = 0, roundStart = 0;

  // Сундуки — на местах из карты (этажи домов, под деревьями): каждый раунд появляется случайная часть мест
  // (одинаково у всех — от сида мира и номера раунда), как в Fortnite.
  function placeChests() {
    for (const c of chests) scene.remove(c.group);
    chests.length = 0;
    const w = ctx.world();
    const addDrops = () => {
      if (ctx.isDuel?.()) return;
      const rs = ctx.royale(), st = ctx.structures();
      const rand = rng(seedOf(w.id) ^ 0xd409 ^ Math.imul(round + 3, 2654435761));
      for (const T of DROPS) {
        const z0 = rs.zoneAt(T);
        let x = z0.x, z = z0.z;
        for (let i = 0; i < 60; i++) {
          const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * z0.r * 0.75;
          const px = z0.x + Math.cos(a) * d, pz = z0.z + Math.sin(a) * d;
          if (px > 6 && pz > 6 && px < MAP - 6 && pz < MAP - 6 && w.surfaceY(Math.floor(px), Math.floor(pz)) > WATER_Y + 1.5) { x = px; z = pz; break; }
        }
        const pos = new THREE.Vector3(x, st.ground(x, z, 999), z);
        const group = dropModel();
        group.position.copy(pos);
        group.visible = false;
        scene.add(group);
        chests.push({ i: chests.length, pos, group, openedAt: 0, drop: { T, state: 0 } });
      }
    };
    const rand = rng(seedOf(w.id) ^ 0x51ed ^ Math.imul(round + 1, 2246822519));
    for (const s of w.chestSpots) {
      if (rand() > CHEST_CHANCE || chests.length >= CHESTS) continue;
      const group = chestModel();
      const pos = new THREE.Vector3(s.x, s.y, s.z);
      group.position.copy(pos);
      group.rotation.y = s.rot;
      scene.add(group);
      chests.push({ i: chests.length, pos, group, openedAt: 0 });
    }
    addDrops();
  }
  // Секунда раунда сейчас; аирдроп уже на земле (можно открыть).
  const sec = () => (Date.now() - roundStart) / 1000;
  const ready = (c) => !c.drop || sec() >= c.drop.T;

  const isOpen = (c) => c.openedAt >= roundStart && c.openedAt > 0;

  // Открытие: крышка откидывается, вспышка, через ~1.2 с сундук исчезает (у всех, кто видит).
  const OPEN_ANIM = 1.2;
  function setOpened(i, t) {
    const c = chests[i];
    if (!c || (c.openedAt && c.openedAt >= t)) return;
    c.openedAt = t;
    c.anim = isOpen(c) && Date.now() - t < 3000 ? performance.now() : 0;
    c.group.visible = !isOpen(c) || !!c.anim;
  }

  function spawn(it, from) {
    if (items.has(it.id) || (it.rr !== undefined && it.rr !== round)) return;   // предмет из прошлого раунда
    const group = itemModel(it);
    const pos = new THREE.Vector3(it.x, it.y, it.z);
    group.position.copy(pos);
    scene.add(group);
    items.set(it.id, { ...it, pos, group, born: performance.now(), from });
  }

  function remove(id) {
    const it = items.get(id);
    if (!it) return;
    scene.remove(it.group);
    items.delete(id);
  }

  // Разложить предметы веером вокруг точки (и разослать всем).
  function drop(center, list) {
    const out = [];
    list.forEach((it, k) => {
      const ang = (k / list.length) * Math.PI * 2 + Math.random() * 0.5;
      const r = 0.8 + Math.random() * 0.7;
      const x = Math.max(1, Math.min(MAP - 1, center.x + Math.cos(ang) * r));
      const z = Math.max(1, Math.min(MAP - 1, center.z + Math.sin(ang) * r));
      const y = ctx.structures().ground(x, z, center.y + 0.5) + 0.45;
      const full = { ...it, id: `${ctx.selfId()}:${seq++}`, rr: round, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) };
      spawn(full);
      out.push(full);
    });
    if (out.length) ctx.net()?.loot({ items: out.map(({ pos, group, ...rest }) => rest) });
  }

  const pub = (it) => { const { pos, group, born, from, ...rest } = it; return rest; };

  return {
    // Новый раунд: сундуки на новых местах и закрыты, предметы с земли убраны.
    resetRound(r, start) {
      round = r;
      roundStart = start;
      for (const it of [...items.values()]) remove(it.id);
      placeChests();
    },
    get chests() { return chests; },        // для отладки/тестов
    get items() { return items; },

    // Сундук под прицелом/рядом (для подсказки «E — open»).
    chestNear(eye, dir) {
      let best = null, bd = OPEN_RANGE;
      for (const c of chests) {
        if (isOpen(c) || !ready(c)) continue;
        const to = c.pos.clone().add(new THREE.Vector3(0, 0.4, 0)).sub(eye);
        const d = to.length();
        if (d > bd) continue;
        if (to.normalize().dot(dir) < 0.85 && d > 1.8) continue;       // смотрим примерно на него или стоим вплотную
        bd = d; best = c;
      }
      return best;
    },

    open(c, bonus = 0) {
      if (!c || isOpen(c) || !ready(c)) return false;
      const t = Date.now();
      setOpened(c.i, t);
      ctx.net()?.chest({ list: [[c.i, t]], rr: round });
      drop(c.pos, c.drop ? rollDrop() : rollChest(bonus));
      if (c.drop) ctx.onDrop?.('open', c);
      return true;
    },

    drop,

    // Предметы рядом с игроком: расходники берутся сами, оружие — если есть свободный слот (иначе подсказка G).
    pickupNear(feet, combat, dt = 0) {
      let swap = null;
      for (const it of items.values()) {
        if (it.from === undefined && performance.now() - it.born < 1500) continue;   // своё выброшенное — не подбираем 1.5 с
        let dx = it.pos.x - feet.x, dz = it.pos.z - feet.z, dy = it.pos.y - feet.y;
        // магнит: подтягиваем к ногам то, что можно взять
        const d = Math.hypot(dx, dz);
        if (dt && d < MAGNET && d > 0.3 && dy > -1.5 && dy < 2.5 && combat.canGive(pub(it))) {
          const k = Math.min(1, (MAGNET_SPEED * dt) / d);
          it.pos.x -= dx * k; it.pos.z -= dz * k; it.pos.y += (feet.y + 0.3 - it.pos.y) * Math.min(1, dt * 8);
          it.group.position.x = it.pos.x; it.group.position.z = it.pos.z;
          dx = it.pos.x - feet.x; dz = it.pos.z - feet.z; dy = it.pos.y - feet.y;
        }
        if (dx * dx + dz * dz > PICK_RANGE * PICK_RANGE || dy < -1 || dy > 2.2) continue;
        if (combat.give(pub(it))) {
          remove(it.id);
          ctx.net()?.take({ id: it.id });
        } else if (it.k === 'weapon' && !swap) swap = it;
      }
      return swap;
    },

    // Для ботов: открыт ли сундук; забрать предмет с земли (у всех исчезает).
    isOpen, ready,
    // Аирдропы раунда (для миникарты): где и в каком состоянии — 0 ещё нет, 1 маяк/падает, 2 на земле, 3 открыт.
    drops: () => chests.filter((c) => c.drop).map((c) => ({ x: c.pos.x, z: c.pos.z, state: isOpen(c) ? 3 : c.drop.state })),
    takeItem(id) {
      const it = items.get(id);
      if (!it) return null;
      const out = pub(it);
      remove(id);
      ctx.net()?.take({ id });
      return out;
    },

    // G: забрать оружие с земли вместо того, что в руках.
    swap(it, slotIndex, combat) {
      if (!items.has(it.id)) return;
      const old = combat.take(slotIndex);
      combat.give(pub(it), slotIndex);
      remove(it.id);
      ctx.net()?.take({ id: it.id });
      if (old) drop(ctx.feet(), [{ k: 'weapon', w: old.type, r: old.rarity, a: old.mag }]);
    },

    // Новичку — открытые сундуки и всё, что лежит на земле.
    syncTo(peerId) {
      const opened = chests.filter(isOpen).map((c) => [c.i, c.openedAt]);
      if (opened.length) ctx.net()?.chest({ list: opened, rr: round }, peerId);
      if (items.size) ctx.net()?.loot({ items: [...items.values()].map(pub) }, peerId);
    },

    onChest(peerId, d) { if (d.rr !== undefined && d.rr !== round) return; for (const [i, t] of d.list || []) setOpened(i, t); },
    onLoot(peerId, d) { for (const it of d.items || []) spawn(it, peerId); },
    onTake(peerId, d) { remove(d.id); },

    update(dt, now) {
      const s = sec();
      for (const c of chests) {
        const open = isOpen(c);
        const u = c.group.userData;
        if (c.drop && !open) {
          // маяк за WARN с до падения → падение на парашюте → на земле (купол сдувается)
          const T = c.drop.T, st = s < T - FALL - WARN ? 0 : s < T ? 1 : 2;
          if (st !== c.drop.state) { const was = c.drop.state; c.drop.state = st; if (st === 1 || (st === 2 && was === 1)) ctx.onDrop?.(st === 1 ? 'incoming' : 'landed', c); else if (st === 2) ctx.onDrop?.('landed-quiet', c); }
          c.group.visible = st > 0;
          if (!st) continue;
          const left = Math.max(0, T - s), k = Math.min(1, left / FALL);
          u.body.position.y = k * DROP_H;
          u.body.position.x = Math.sin(s * 0.9 + c.i) * 0.6 * k;
          u.body.rotation.z = Math.sin(s * 1.3 + c.i) * 0.08 * k;
          u.body.rotation.y += dt * 0.25 * k;
          u.chute.visible = left > 0 || s - T < 1.2;
          u.chute.scale.setScalar(left > 0 ? 1 : Math.max(0.01, 1 - (s - T) / 1.2));
          u.beam.material.opacity = (st === 2 ? 0.2 : 0.3) + Math.sin(now / 250) * 0.06;
          u.glow.material.opacity = 0.6 + Math.sin(now / 300 + c.i) * 0.3;
          if (st === 2 && Math.random() < dt * 3) ctx.dropSmoke?.(c.pos);
          continue;
        }
        if (c.drop && open && !c.anim) { c.group.visible = false; continue; }
        if (open && c.anim) {
          const k = (performance.now() - c.anim) / 1000 / OPEN_ANIM;
          if (k >= 1) { c.anim = 0; c.group.visible = false; u.burst.visible = false; continue; }
          c.group.visible = true;
          u.hinge.rotation.x = -Math.min(1, k * 4) * 1.9;                   // крышка откинулась
          u.burst.visible = true;
          u.burst.scale.setScalar(0.5 + Math.min(1, k * 3) * 3.2);
          u.burst.material.opacity = Math.max(0, 1 - k * 1.2);
          const sh = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;                 // в конце сундук «сдувается»
          c.group.scale.setScalar(Math.max(0.01, sh));
          continue;
        }
        if (c.group.visible === open) { c.group.visible = !open; c.group.scale.setScalar(1); u.hinge.rotation.x = 0; }
        if (!open) u.glow.material.opacity = 0.6 + Math.sin(now / 300 + c.i) * 0.3;
      }
      for (const it of items.values()) {
        it.group.rotation.y += dt * 1.6;
        // выпал только что — подпрыгивает из сундука и «надувается»; оружие пульсирует цветом редкости
        const age = (performance.now() - it.born) / 1000;
        const hop = age < 0.55 ? Math.sin((age / 0.55) * Math.PI) * 1.1 : 0;
        it.group.scale.setScalar(age < 0.25 ? 0.3 + (age / 0.25) * 0.7 : 1);
        it.group.position.y = it.pos.y + hop + Math.sin(now / 400 + it.pos.x) * 0.08;
        const u = it.group.userData;
        if (u.rare >= 0 && u.glow) u.glow.scale.setScalar(1.2 + (0.25 + u.rare * 0.12) * (1 + Math.sin(now / 260 + it.pos.z)));
      }
    },
  };
}
