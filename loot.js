// Лут как в Fortnite: золотые сундуки по острову → случайное оружие разной редкости, патроны к нему, броня, аптечки.
// Места сундуков — из id мира и номера раунда (у всех одинаковые, каждый раунд новые). Открытый сундук пропадает у всех
// до конца раунда. Предметы на земле — общие: кто первый подошёл, тот и забрал (take — у всех исчезает).
// Новый раунд (royale.js) — всё заново: сундуки закрыты, предметы с земли убраны, пакеты прошлого раунда игнорируются.

import * as THREE from 'three';
import { MAP, rng, seedOf } from './map.js';
import { WEAPONS, AMMO, RARITY, weaponLabel } from './combat.js';

const CHESTS = 40;                     // не больше стольких сундуков за раунд
const CHEST_CHANCE = 0.8;              // доля мест, где в раунде есть сундук
const OPEN_RANGE = 4;
const PICK_RANGE = 1.5;

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
export function rollChest(bonus = 0) {
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
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.62), gold);
  lid.position.y = 0.6;
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), gold);
  latch.position.set(0, 0.45, -0.32);
  const glow = glowSprite('rgba(255,200,60,0.55)', 2.4);
  glow.position.y = 0.5;
  g.add(base, lid, latch, glow);
  g.userData.glow = glow;
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
  }

  const isOpen = (c) => c.openedAt >= roundStart && c.openedAt > 0;

  function setOpened(i, t) {
    const c = chests[i];
    if (!c || (c.openedAt && c.openedAt >= t)) return;
    c.openedAt = t;
    c.group.visible = !isOpen(c);
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
        if (isOpen(c)) continue;
        const to = c.pos.clone().add(new THREE.Vector3(0, 0.4, 0)).sub(eye);
        const d = to.length();
        if (d > bd) continue;
        if (to.normalize().dot(dir) < 0.85 && d > 1.8) continue;       // смотрим примерно на него или стоим вплотную
        bd = d; best = c;
      }
      return best;
    },

    open(c, bonus = 0) {
      if (!c || isOpen(c)) return false;
      const t = Date.now();
      setOpened(c.i, t);
      ctx.net()?.chest({ list: [[c.i, t]], rr: round });
      drop(c.pos, rollChest(bonus));
      return true;
    },

    drop,

    // Предметы рядом с игроком: расходники берутся сами, оружие — если есть свободный слот (иначе подсказка G).
    pickupNear(feet, combat) {
      let swap = null;
      for (const it of items.values()) {
        if (it.from === undefined && performance.now() - it.born < 3000) continue;   // своё выброшенное — не подбираем 3 с
        const dx = it.pos.x - feet.x, dz = it.pos.z - feet.z, dy = it.pos.y - feet.y;
        if (dx * dx + dz * dz > PICK_RANGE * PICK_RANGE || dy < -1 || dy > 2.2) continue;
        if (combat.give(pub(it))) {
          remove(it.id);
          ctx.net()?.take({ id: it.id });
        } else if (it.k === 'weapon' && !swap) swap = it;
      }
      return swap;
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
      for (const c of chests) {
        const open = isOpen(c);
        if (c.group.visible === open) c.group.visible = !open;
        if (!open) c.group.userData.glow.material.opacity = 0.6 + Math.sin(now / 300 + c.i) * 0.3;
      }
      for (const it of items.values()) {
        it.group.rotation.y += dt * 1.6;
        it.group.position.y = it.pos.y + Math.sin(now / 400 + it.pos.x) * 0.08;
      }
    },
  };
}
