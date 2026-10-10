// Скины: цвета тела и ног, головной убор и аксессуары поверх мультяшного персонажа (капсула + круглая голова).
// Выбор хранится в localStorage (pr:skin) и уходит другим игрокам в pose (поле k) — они видят твой скин.
// Часть скинов открывается уровнем сезона (500 очков на уровень), Gold Holder — только держателям токена.

import * as THREE from 'three';
import { toon, outlineGroup, rimMaterial } from './art.js';

// rarity — индекс в RARITY (combat.js): 0 Common … 4 Legendary.
export const SKINS = [
  { id: 'default', name: 'Default Degen', rarity: 0, body: null, legs: 0x34406a, hat: null, icon: '🙂' },
  { id: 'pepe', name: 'Pepe', rarity: 1, body: 0x5cbf3a, legs: 0x2f5fb0, skin: 0x7fd65a, hat: null, extra: 'lips', icon: '🐸' },
  { id: 'shrimp', name: 'Shrimp', rarity: 1, body: 0xff8fa3, legs: 0xff6f8a, skin: 0xffb3c0, hat: 'antenna', icon: '🦐' },
  { id: 'ape', name: 'Ape', rarity: 1, body: 0x5a3e2b, legs: 0x3a2a1e, skin: 0xb88a68, hat: 'cap', hatColor: 0xff5a3c, icon: '🦍', level: 2 },
  { id: 'laser', name: 'Laser Eyes', rarity: 2, body: 0x1d1f2b, legs: 0x111218, hat: null, extra: 'laser', icon: '👁', level: 2 },
  { id: 'bull', name: 'Bull Run', rarity: 2, body: 0x2fbf71, legs: 0x1f8a50, hat: 'horns', icon: '🐂', level: 3 },
  { id: 'bear', name: 'Bear Market', rarity: 2, body: 0x8a5a3c, legs: 0x5e3c26, skin: 0xc49a74, hat: 'ears', icon: '🐻', level: 3 },
  { id: 'whale', name: 'Whale', rarity: 3, body: 0x2f6fd6, legs: 0x1c3f86, hat: 'fin', extra: 'backpack', icon: '🐋', level: 4 },
  { id: 'moon', name: 'Moon Boy', rarity: 3, body: 0xf2f4f8, legs: 0xc9d1dc, hat: 'helmet', extra: 'backpack', icon: '🚀', level: 5 },
  { id: 'rug', name: 'Rug Puller', rarity: 3, body: 0x7a2fd6, legs: 0x3d1a70, hat: 'beanie', hatColor: 0x2a2a3a, extra: 'rug', icon: '🧶', level: 6 },
  { id: 'diamond', name: 'Diamond Hands', rarity: 4, body: 0x7fe0ff, legs: 0x3fa9d6, glow: 0x1a6080, hat: 'crystal', extra: 'cape', capeColor: 0x2f8cff, icon: '💎', level: 8 },
  { id: 'gold', name: 'Gold Holder', rarity: 4, body: 0xffc928, legs: 0xc98a00, glow: 0x4a3000, hat: 'crown', extra: 'cape', capeColor: 0xd23b3b, icon: '👑', holder: true },
  // магазин рейтинга (ranked.js, за RP)
  { id: 'champ', name: 'Ranked Champ', rarity: 4, body: 0x2f6fd6, legs: 0x1c3f86, glow: 0x0a2050, hat: 'crown', extra: 'cape', capeColor: 0xffc928, icon: '🏆', shop: true },
  { id: 'knight', name: 'Rugged Knight', rarity: 3, body: 0x8a94a6, legs: 0x5b6472, hat: 'knight', icon: '🛡', shop: true },
  { id: 'neon', name: 'Neon Degen', rarity: 3, body: 0xff4fd8, legs: 0x2a0a40, glow: 0x5a0a4a, hat: 'beanie', hatColor: 0x5dff9a, icon: '💗', shop: true },
  { id: 'candle', name: 'Green Candle', rarity: 2, body: 0x2fbf71, legs: 0x1f8a50, glow: 0x0a3a1a, hat: 'wick', icon: '🕯', shop: true },
];
export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

// Атмосфера лобби под скин: верх/низ неба, солнце, рассеянный свет, контровой (rim) и заполняющий (fill) цвет.
export const SKIN_MOODS = {
  default: { top: 0x3b2a9e, bottom: 0xffb08a, sun: 0xffc08a, sky: 0xcdbbff, rim: 0xff9a5a, fill: 0x8b6bff },
  pepe: { top: 0x1f5a3a, bottom: 0xc8f08a, sun: 0xeaffb0, sky: 0xd0ffc0, rim: 0x9aff6a, fill: 0x2fbf71 },
  shrimp: { top: 0xd04a7a, bottom: 0xffd6c8, sun: 0xffc0b0, sky: 0xffd0e0, rim: 0xff8fa3, fill: 0xff6fb0 },
  ape: { top: 0x6a3a1e, bottom: 0xffc06a, sun: 0xffb060, sky: 0xffe0b0, rim: 0xff7a3c, fill: 0x8a5a2a },
  laser: { top: 0x0a0a14, bottom: 0x6a1424, sun: 0xff5050, sky: 0x8a6a8a, rim: 0xff2a2a, fill: 0x6a1aff },
  bull: { top: 0x0f4a2a, bottom: 0x7af0a8, sun: 0xc8ffd8, sky: 0xc0ffd8, rim: 0x2fbf71, fill: 0x7affb0 },
  bear: { top: 0x4a0f14, bottom: 0xff8a7a, sun: 0xffb0a0, sky: 0xffc0b8, rim: 0xff4a4a, fill: 0x8a3a2a },
  whale: { top: 0x0a2a6a, bottom: 0x6ad0ff, sun: 0xc0eaff, sky: 0xb0e0ff, rim: 0x3fa9ff, fill: 0x1a4aff },
  moon: { top: 0x05051a, bottom: 0x2a2a6a, sun: 0xe8e8ff, sky: 0x9a9ad0, rim: 0xc0c8ff, fill: 0x6a5aff },
  rug: { top: 0x2a0a5a, bottom: 0xd06aff, sun: 0xf2c14e, sky: 0xe0b0ff, rim: 0xffc04a, fill: 0x8a2fd6 },
  diamond: { top: 0x1a6aa0, bottom: 0xd8f8ff, sun: 0xffffff, sky: 0xe0f8ff, rim: 0x7fe0ff, fill: 0x3f8cff },
  gold: { top: 0x7a4a00, bottom: 0xffe08a, sun: 0xffd060, sky: 0xfff0c0, rim: 0xffc928, fill: 0xff8a2a },
  champ: { top: 0x10205a, bottom: 0xffd68a, sun: 0xffe0a0, sky: 0xd8d8ff, rim: 0xffc928, fill: 0x2f6fd6 },
  knight: { top: 0x3a4250, bottom: 0xc8d0dc, sun: 0xe8eef4, sky: 0xd8e0ea, rim: 0xd23b3b, fill: 0x8a94a6 },
  neon: { top: 0x1a0a40, bottom: 0xff4fd8, sun: 0xff9af0, sky: 0xf0a0ff, rim: 0x5dff9a, fill: 0xff4fd8 },
  candle: { top: 0x06140c, bottom: 0x2fbf71, sun: 0xffd08a, sky: 0x90d0a0, rim: 0xffb23a, fill: 0x2fbf71 },
};

// Открыт ли скин: по уровню сезона, уровню держателя (tier ≥ 0 — держит токен) или покупке в магазине (owns).
export function unlocked(skin, level, tier, owns = () => false) {
  if (skin.shop) return owns(skin.id);
  if (skin.holder) return tier >= 0;
  return level >= (skin.level || 1);
}
export const lockLabel = (skin) => (skin.shop ? '🛒 Shop' : skin.holder ? '🔒 Holders' : `🔒 LV ${skin.level}`);

const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
const ball = (r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };

// Персонаж в скине. fallbackColor — цвет тела у Default (по нику). Лицо смотрит в −Z.
export function buildCharacter(skinId, fallbackColor) {
  const s = skinById(skinId);
  const g = new THREE.Group();
  const bodyMat = toon(s.body ?? fallbackColor, s.glow ? { emissive: s.glow } : {});
  const skinMat = toon(s.skin ?? 0xffd2a8);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.55, 6, 12), bodyMat);
  body.position.y = 1.05;
  const head = ball(0.3, skinMat, 0, 1.72, 0);
  const eyeMat = s.extra === 'laser' ? new THREE.MeshBasicMaterial({ color: 0xff2a2a }) : new THREE.MeshBasicMaterial({ color: 0x111111 });
  const e1 = ball(s.extra === 'laser' ? 0.065 : 0.05, eyeMat, -0.1, 1.76, -0.27), e2 = ball(s.extra === 'laser' ? 0.065 : 0.05, eyeMat, 0.1, 1.76, -0.27);
  // ноги и руки на шарнирах (бёдра и плечи) — для анимации бега, прыжка, планирования
  const legMat = toon(s.legs);
  const legGeo = new THREE.CapsuleGeometry(0.11, 0.4, 4, 8);
  const limb = (geo, mat, x, y, len) => { const p = new THREE.Group(); p.position.set(x, y, 0); const m = new THREE.Mesh(geo, mat); m.position.y = -len; p.add(m); return p; };
  const l1 = limb(legGeo, legMat, -0.14, 0.62, 0.3), l2 = limb(legGeo, legMat, 0.14, 0.62, 0.3);
  const armGeo = new THREE.CapsuleGeometry(0.085, 0.38, 4, 8);
  const a1 = limb(armGeo, bodyMat, -0.41, 1.42, 0.24), a2 = limb(armGeo, bodyMat, 0.41, 1.42, 0.24);
  const hands = [a1, a2].map((a) => { const h = ball(0.085, skinMat, 0, -0.5, 0); a.add(h); return h; });
  a1.rotation.z = -0.12; a2.rotation.z = 0.12;
  g.add(body, head, e1, e2, l1, l2, a1, a2);
  g.userData.rig = { l1, l2, a1, a2, body, head, hands };

  const hc = toon(s.hatColor ?? s.body ?? fallbackColor);
  switch (s.hat) {
    case 'cap': g.add(ball(0.31, hc, 0, 1.82, 0, 1, 0.55, 1), box(0.36, 0.04, 0.26, hc, 0, 1.86, -0.3)); break;
    case 'beanie': g.add(ball(0.32, hc, 0, 1.84, 0, 1, 0.7, 1), ball(0.08, toon(0xffffff), 0, 2.07, 0)); break;
    case 'horns': {
      const hm = toon(0xf4ead2);
      for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 8), hm); c.position.set(sx * 0.26, 1.98, 0); c.rotation.z = -sx * 0.9; g.add(c); }
      break;
    }
    case 'ears': for (const sx of [-1, 1]) g.add(ball(0.1, toon(s.body), sx * 0.21, 1.98, 0), ball(0.05, toon(s.skin ?? 0xffd2a8), sx * 0.21, 1.98, -0.06)); break;
    case 'fin': { const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), toon(s.body)); f.position.set(0, 2.1, 0.05); f.scale.z = 0.35; g.add(f); break; }
    case 'antenna': for (const sx of [-1, 1]) { const a = box(0.025, 0.42, 0.025, toon(0xff6f8a), sx * 0.1, 2.12, -0.05); a.rotation.z = -sx * 0.35; g.add(a); } break;
    case 'helmet': {
      g.add(ball(0.42, new THREE.MeshToonMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35 }), 0, 1.74, 0));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 8, 24), toon(0xd8dde6)); ring.position.y = 1.42; ring.rotation.x = Math.PI / 2; g.add(ring);
      break;
    }
    case 'crown': {
      const gold = toon(0xffd21a, { emissive: 0x3a2400 });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.12, 10, 1, true), gold); band.position.y = 2.0; g.add(band);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), gold); sp.position.set(Math.cos(a) * 0.2, 2.12, Math.sin(a) * 0.2); g.add(sp); }
      g.add(ball(0.04, toon(0xff3b5a, { emissive: 0x400010 }), 0, 2.0, -0.22));
      break;
    }
    case 'knight': {
      const steel = toon(0xc9d1dc), dark = new THREE.MeshBasicMaterial({ color: 0x111111 });
      g.add(ball(0.34, steel, 0, 1.76, 0, 1, 1.05, 1), box(0.5, 0.06, 0.06, dark, 0, 1.76, -0.32), box(0.04, 0.22, 0.3, toon(0xd23b3b), 0, 2.12, 0));
      break;
    }
    case 'wick': {
      g.add(box(0.04, 0.22, 0.04, toon(0x222222), 0, 2.1, 0));
      const flame = ball(0.09, new THREE.MeshBasicMaterial({ color: 0xffb23a }), 0, 2.27, 0, 1, 1.6, 1);
      g.add(flame);
      break;
    }
    case 'crystal': {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), toon(0xbff4ff, { emissive: 0x2a8ab0 })); c.position.set(0, 2.15, 0); c.scale.y = 1.4; g.add(c);
      break;
    }
  }
  switch (s.extra) {
    case 'cape': case 'rug': {
      const cape = box(0.62, 0.95, 0.04, toon(s.extra === 'rug' ? 0xc0392b : s.capeColor), 0, 1.05, 0.36);
      cape.rotation.x = 0.12;
      g.add(cape);
      if (s.extra === 'rug') for (let i = 0; i < 3; i++) g.add(box(0.62, 0.06, 0.045, toon(0xf2c14e), 0, 0.75 + i * 0.3, 0.38 - i * 0.035));
      break;
    }
    case 'backpack': g.add(box(0.42, 0.48, 0.2, toon(s.id === 'moon' ? 0xc9d1dc : 0x23262d), 0, 1.12, 0.36)); break;
    case 'laser': {
      const beam = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.75 });
      for (const sx of [-1, 1]) g.add(box(0.035, 0.035, 0.7, beam, sx * 0.1, 1.76, -0.62));
      break;
    }
    case 'lips': g.add(box(0.2, 0.05, 0.04, toon(0xc0392b), 0, 1.63, -0.28)); break;
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; if (m.material.isMeshToonMaterial && !m.material.transparent) rimMaterial(m.material); } });
  outlineGroup(g, 0.03);
  return g;
}

// Анимация персонажа: state — 'idle' | 'run' | 'air' | 'glide'; speed — 0…1 (доля бега); armed — держит оружие.
export function animateCharacter(g, t, state, speed = 1, armed = false) {
  const r = g.userData.rig;
  if (!r) return;
  let lx = 0, rx = 0, ax1 = 0, ax2 = 0, az1 = -0.12, az2 = 0.12;
  if (state === 'run') {
    const w = Math.sin(t * 11) * 0.75 * speed;
    lx = w; rx = -w; ax1 = -w * 0.8; ax2 = w * 0.8;
  } else if (state === 'air') {
    lx = -0.5; rx = 0.35; ax1 = -0.6; ax2 = -0.4; az1 = -0.5; az2 = 0.5;
  } else if (state === 'sit') {
    // сидит: бёдра вперёд, руки на коленях, чуть покачивается
    lx = rx = -1.45; ax1 = ax2 = -0.75 + Math.sin(t * 1.7) * 0.04; az1 = -0.08; az2 = 0.08;
  } else if (state === 'chute') {
    // под куполом: руки вверх держат стропы, ноги чуть вперёд
    lx = -0.35; rx = -0.25; ax1 = 0; ax2 = 0; az1 = -2.7 + Math.sin(t * 2) * 0.05; az2 = 2.7 - Math.sin(t * 2) * 0.05;
  } else if (state === 'heal') {
    // лечится: руки перед грудью, держит аптечку
    ax1 = ax2 = -1.1; az1 = 0.55 + Math.sin(t * 9) * 0.05; az2 = -0.55 - Math.sin(t * 9) * 0.05;
  } else if (state === 'dance') {
    // танец: руки вверх-вниз по очереди, шаги на месте
    const b = Math.sin(t * 8);
    lx = b * 0.35; rx = -b * 0.35; az1 = -1.2 - b * 1.1; az2 = 1.2 - b * 1.1; ax1 = ax2 = -0.2;
  } else if (state === 'floss') {
    // флосс: прямые руки качаются из стороны в сторону, бёдра — навстречу
    const b = Math.sin(t * 9);
    az1 = -0.35 + b * 0.55; az2 = 0.35 + b * 0.55; ax1 = b > 0 ? -0.4 : 0.4; ax2 = -ax1; lx = -b * 0.15; rx = b * 0.15;
  } else if (state === 'wave') {
    az2 = 2.5 + Math.sin(t * 10) * 0.35; ax2 = -0.2;
  } else if (state === 'moon') {
    // «to the moon»: обе руки вверх, покачивается
    az1 = -2.85 + Math.sin(t * 4) * 0.12; az2 = 2.85 + Math.sin(t * 4) * 0.12; lx = Math.sin(t * 4) * 0.2; rx = -lx;
  } else if (state === 'glide') {
    lx = 0.35; rx = 0.25; az1 = -1.35 + Math.sin(t * 3) * 0.08; az2 = 1.35 - Math.sin(t * 3) * 0.08; ax1 = ax2 = 0;
  } else {
    const br = Math.sin(t * 2.2);
    az1 = -0.12 - br * 0.04; az2 = 0.12 + br * 0.04;
  }
  if (armed && !['glide', 'heal', 'dance', 'floss', 'wave', 'moon'].includes(state)) { ax2 = -1.25; az2 = 0.1; ax1 = -1.0; az1 = 0.35; }  // руки вперёд — держит оружие
  const k = 0.25;                                       // плавность перехода между позами
  r.l1.rotation.x += (lx - r.l1.rotation.x) * k; r.l2.rotation.x += (rx - r.l2.rotation.x) * k;
  r.a1.rotation.x += (ax1 - r.a1.rotation.x) * k; r.a2.rotation.x += (ax2 - r.a2.rotation.x) * k;
  r.a1.rotation.z += (az1 - r.a1.rotation.z) * k; r.a2.rotation.z += (az2 - r.a2.rotation.z) * k;
}
