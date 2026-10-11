// Скины: цвета куртки и штанов, головной убор и аксессуары поверх стилизованного персонажа (см. «Модель персонажа»).
// Выбор хранится в localStorage (pr:skin) и уходит другим игрокам в pose (поле k) — они видят твой скин.
// Часть скинов открывается уровнем сезона (500 очков на уровень), Gold Holder — только держателям токена.

import * as THREE from 'three';
import { toon, outlineGroup, rimMaterial } from './art.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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

// ---------- Модель персонажа ----------
// Стилизованный герой (как в Fortnite): широкие плечи, узкая талия, крупные кисти и ботинки, выразительное лицо
// (белки, радужки с бликом, брови, нос, улыбка), куртка с воротником и молнией, ремень с пряжкой, наплечники,
// манжеты, ботинки с подошвой, причёски. Скелет: таз → корпус → голова; плечо → локоть → кисть; бедро → колено → голень.
// Детали одного сегмента сливаются в одну геометрию с цветами вершин, материал общий у всех — ~12 отрисовок на персонажа.
// Лицо смотрит в −Z. Рост ~1.95 м, глаза на ~1.75 м.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
// Деталь: геометрия → без индекса и uv, перенос/поворот/масштаб, цвет вершин.
function part(geo, color, p = [0, 0, 0], sc = [1, 1, 1], rot = [0, 0, 0]) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  if (g.attributes.uv2) g.deleteAttribute('uv2');
  M4.compose(V(...p), Q.setFromEuler(E.set(rot[0], rot[1], rot[2])), V(...sc));
  g.applyMatrix4(M4);
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const SPH = (r, w = 16, h = 12, t0 = 0, tl = Math.PI) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, t0, tl);
const CAP = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 4, seg);
const CYL = (r1, r2, h, seg = 14, open = false) => new THREE.CylinderGeometry(r1, r2, h, seg, 1, open);
const TOR = (R, r, arc = Math.PI * 2, seg = 24) => new THREE.TorusGeometry(R, r, 8, seg, arc);
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// Тело вращения по профилю [радиус, высота] — торс, таз, бёдра, голени.
// Профиль — снизу вверх (иначе нормали смотрят внутрь); задан сверху вниз — разворачиваем.
const LATHE = (pts, seg = 18, p0 = 0, pl = Math.PI * 2) => {
  const v = pts.map(([r, y]) => new THREE.Vector2(r, y));
  if (v[0].y > v[v.length - 1].y) v.reverse();
  return new THREE.LatheGeometry(v, seg, p0, pl);
};

let charMat = null;
function material() {
  if (!charMat) { charMat = toon(0xffffff, { vertexColors: true }); rimMaterial(charMat); }
  return charMat;
}
function mesh(parts) {
  const m = new THREE.Mesh(mergeGeometries(parts.filter(Boolean)), material());
  m.castShadow = true;
  return m;
}
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const mix = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

// Причёски (для скинов без закрытого головного убора). Голова: центр (0, HC, 0), радиус HR.
const HR = 0.2, HC = 0.2, HEAD_K = 1.13;          // голова чуть крупнее «реальной»
const HAIR_COLORS = [0x2b1d14, 0x5a3420, 0xc98a3a, 0xe8c66a, 0x1a1a22, 0xb5462e, 0x7a4fd6, 0x2f8cff];
function hairParts(style, col) {
  const out = [];
  const cap = (k = 1.07, from = 0, len = 0.56, tilt = 0.32) => part(SPH(HR * k, 22, 12, from, Math.PI * len), col, [0, HC + 0.005, 0.01], [1, 1.02, 1.04], [tilt, 0, 0]);
  if (style === 'none') return out;
  if (style === 'buzz') { out.push(cap(1.035, 0, 0.5, 0.25)); return out; }
  out.push(cap());
  if (style === 'quiff') {
    // чуб над лбом: три вытянутые капли, загнутые вверх-назад
    out.push(part(SPH(0.09, 12, 8), col, [0.03, HC + 0.17, -0.12], [1.5, 0.8, 1.2], [0.5, 0, -0.2]));
    out.push(part(SPH(0.08, 12, 8), col, [-0.07, HC + 0.15, -0.1], [1.3, 0.75, 1.1], [0.4, 0, 0.3]));
    out.push(part(SPH(0.07, 12, 8), col, [0.1, HC + 0.12, -0.13], [1.1, 0.7, 1.0], [0.6, 0, -0.5]));
  } else if (style === 'spiky') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, rr = i % 2 ? 0.1 : 0.06;
      out.push(part(new THREE.ConeGeometry(0.055, 0.17, 8), col, [Math.cos(a) * rr, HC + 0.2, Math.sin(a) * rr + 0.02], [1, 1, 1], [Math.sin(a) * 0.9 + 0.2, 0, -Math.cos(a) * 0.9]));
    }
    out.push(part(new THREE.ConeGeometry(0.06, 0.2, 8), col, [0, HC + 0.24, -0.02], [1, 1, 1], [-0.2, 0, 0]));
  } else if (style === 'messy') {
    for (let i = 0; i < 7; i++) { const a = i * 2.4; out.push(part(SPH(0.075, 10, 8), col, [Math.cos(a) * 0.11, HC + 0.17 + (i % 3) * 0.015, Math.sin(a) * 0.1 + 0.01], [1.2, 0.8, 1.2])); }
  } else if (style === 'slick') {
    out.push(part(SPH(0.11, 12, 8), col, [0, HC + 0.16, -0.06], [1.6, 0.6, 1.4], [0.35, 0, 0]));
  } else if (style === 'long') {
    out.push(part(SPH(0.2, 16, 10), col, [0, HC - 0.06, 0.07], [1.1, 1.25, 0.8]));
  }
  return out;
}

// Скин → внешность: акцент (молния, манжеты, подошвы, пряжка), перчатки, причёска.
function look(s, fallbackColor) {
  const body = s.body ?? fallbackColor;
  const h = Math.abs(Math.round(new THREE.Color(body).getHSL({}).h * 997 + new THREE.Color(body).r * 131)) || 0;
  const accent = SKIN_MOODS[s.id]?.rim ?? [0xffc928, 0x5dff9a, 0xff4fd8, 0x4fd1ff][h % 4];
  const covered = ['cap', 'beanie', 'helmet', 'knight'].includes(s.hat);
  const animal = ['pepe', 'shrimp', 'ape', 'bear', 'whale', 'candle'].includes(s.id);
  const HAIR = { laser: ['slick', 0x15151c], bull: ['spiky', 0x3a2416], diamond: ['spiky', 0xe8fbff], gold: ['quiff', 0xffe08a], champ: ['quiff', 0x5a3420], moon: ['buzz', 0x5a3420] };
  let hair = HAIR[s.id] || (s.id === 'default' ? [['quiff', 'spiky', 'messy', 'slick'][h % 4], HAIR_COLORS[(h >> 2) % HAIR_COLORS.length]] : ['quiff', 0x2b1d14]);
  if (covered || animal) hair = ['none', 0];
  if (s.hat === 'cap' || s.hat === 'beanie') hair = ['buzz', HAIR_COLORS[h % 4]];
  const glove = s.id === 'knight' ? 0xc9d1dc : s.id === 'moon' ? 0xf2f4f8 : null;
  return { body, legs: s.legs, skin: s.skin ?? 0xffd2a8, accent, hair, glove, dark: shade(s.legs, 0.55) };
}

// Персонаж в скине. fallbackColor — цвет тела у Default (по нику).
export function buildCharacter(skinId, fallbackColor) {
  const s = skinById(skinId);
  const L = look(s, fallbackColor);
  const g = new THREE.Group();
  const grp = (x = 0, y = 0, z = 0) => { const o = new THREE.Group(); o.position.set(x, y, z); return o; };

  // ---- таз (бёдра поворачиваются от него) ----
  const hips = grp(0, 0.93, 0);
  hips.add(mesh([
    part(LATHE([[0.0, -0.13], [0.15, -0.12], [0.18, -0.05], [0.185, 0.03], [0.175, 0.08], [0.0, 0.08]]), L.legs, [0, 0, 0], [1.12, 1, 0.82]),
    part(CYL(0.19, 0.19, 0.055, 20), L.dark, [0, 0.045, 0], [1.1, 1, 0.84]),                                // ремень
    part(BOX(0.07, 0.05, 0.02), L.accent, [0, 0.045, -0.16]),                                               // пряжка
    part(BOX(0.05, 0.08, 0.02), shade(L.legs, 0.8), [-0.11, -0.02, -0.14], [1, 1, 1], [0, 0.35, 0]),          // карманы
    part(BOX(0.05, 0.08, 0.02), shade(L.legs, 0.8), [0.11, -0.02, -0.14], [1, 1, 1], [0, -0.35, 0]),
  ]));
  // ---- ноги: бедро → колено → голень с ботинком ----
  const leg = (sx) => {
    const hip = grp(sx * 0.105, -0.04, 0);
    hip.add(mesh([
      part(LATHE([[0.0, 0.02], [0.095, 0.0], [0.1, -0.12], [0.085, -0.36], [0.075, -0.43], [0.0, -0.44]], 14), L.legs),
      part(SPH(0.085, 12, 8), shade(L.legs, 0.85), [0, -0.33, -0.045], [1, 0.9, 0.6]),                     // наколенник
      part(BOX(0.02, 0.36, 0.035), L.accent, [sx * 0.093, -0.18, 0], [1, 1, 1], [0, 0, sx * 0.03]),           // лампас
    ]));
    const knee = grp(0, -0.42, 0);
    const boot = L.glove ?? shade(L.legs, 0.5);
    knee.add(mesh([
      part(LATHE([[0.0, 0.0], [0.076, -0.02], [0.07, -0.18], [0.06, -0.3], [0.0, -0.32]], 14), L.legs),
      part(CYL(0.078, 0.084, 0.13, 14), boot, [0, -0.33, 0.005]),                                         // голенище
      part(TOR(0.08, 0.013, Math.PI * 2, 18), L.accent, [0, -0.27, 0.005], [1, 1, 1], [Math.PI / 2, 0, 0]),  // кант
      part(SPH(0.085, 14, 10), boot, [0, -0.42, -0.045], [1, 0.72, 1.6]),                                  // носок
      part(BOX(0.17, 0.035, 0.29), shade(L.accent, 0.75), [0, -0.475, -0.04]),                           // подошва
    ]));
    hip.add(knee);
    hips.add(hip);
    return { hip, knee };
  };
  const LL = leg(-1), LR = leg(1);

  // ---- корпус: куртка, воротник, молния, наплечники ----
  const spine = grp(0, 0.06, 0);
  hips.add(spine);
  const jacket = L.body, trim = mix(L.body, 0xffffff, 0.35);
  const torsoParts = [
    part(LATHE([[0.0, -0.02], [0.17, -0.02], [0.19, 0.1], [0.245, 0.3], [0.255, 0.4], [0.2, 0.5], [0.08, 0.54], [0.0, 0.54]], 22), jacket, [0, 0, 0], [1.18, 1, 0.74]),
    part(TOR(0.1, 0.035, Math.PI * 2, 20), trim, [0, 0.53, 0.0], [1.1, 1, 0.9], [Math.PI / 2, 0, 0]),        // воротник
    part(BOX(0.025, 0.46, 0.02), L.accent, [0, 0.27, -0.188]),                                             // молния
    part(BOX(0.035, 0.035, 0.02), mix(L.accent, 0xffffff, 0.4), [0, 0.46, -0.19]),                          // бегунок
    part(CYL(0.035, 0.035, 0.02, 16), L.accent, [-0.11, 0.38, -0.178], [1, 1, 1], [Math.PI / 2 - 0.25, 0, 0]),   // эмблема на груди
    part(CYL(0.022, 0.022, 0.022, 12), mix(L.accent, 0xffffff, 0.55), [-0.11, 0.38, -0.183], [1, 1, 1], [Math.PI / 2 - 0.25, 0, 0]),
    part(BOX(0.11, 0.05, 0.02), shade(jacket, 0.82), [-0.12, 0.13, -0.165], [1, 1, 1], [0, 0.3, 0]),        // карманы
    part(BOX(0.11, 0.05, 0.02), shade(jacket, 0.82), [0.12, 0.13, -0.165], [1, 1, 1], [0, -0.3, 0]),
  ];
  // ---- аксессуары на спине ----
  if (s.extra === 'backpack') {
    const bp = s.id === 'moon' ? 0xc9d1dc : 0x2a2e38;
    torsoParts.push(part(new RoundedBoxGeometry(0.36, 0.42, 0.18, 3, 0.06), bp, [0, 0.27, 0.22]),
      part(BOX(0.28, 0.12, 0.05), shade(bp, 1.25), [0, 0.15, 0.32]),
      part(BOX(0.04, 0.42, 0.03), L.accent, [-0.13, 0.3, -0.17], [1, 1, 1], [0.1, 0, 0]), part(BOX(0.04, 0.42, 0.03), L.accent, [0.13, 0.3, -0.17], [1, 1, 1], [0.1, 0, 0]));
  }
  if (s.extra === 'cape' || s.extra === 'rug') {
    const cc = s.extra === 'rug' ? 0xc0392b : s.capeColor;
    // плащ — половина тела вращения сзади (+Z), расширяется книзу
    const cape = LATHE([[0.2, 0.5], [0.25, 0.3], [0.3, -0.1], [0.34, -0.45]], 16, -Math.PI * 0.42, Math.PI * 0.84);
    torsoParts.push(part(cape, cc, [0, 0, 0.02], [1.15, 1, 0.85]));
    torsoParts.push(part(SPH(0.04, 10, 8), 0xffd21a, [-0.15, 0.47, -0.13]), part(SPH(0.04, 10, 8), 0xffd21a, [0.15, 0.47, -0.13]));
    if (s.extra === 'rug') for (let i = 0; i < 3; i++) torsoParts.push(part(TOR(0.275 + i * 0.022, 0.013, Math.PI * 0.84, 20).rotateZ(Math.PI * 0.08), 0xf2c14e, [0, 0.12 - i * 0.17, 0.02], [1.15, 1, 0.85], [Math.PI / 2, 0, 0]));
  }
  spine.add(mesh(torsoParts));

  // ---- голова ----
  const head = grp(0, 0.5, 0);
  spine.add(head);
  const eyeW = 0xffffff, iris = s.extra === 'laser' ? 0xff2020 : 0x2a1d18, brow = L.hair[0] !== 'none' ? shade(L.hair[1], 0.8) : shade(L.skin, 0.45);
  const headParts = [
    part(CYL(0.065, 0.075, 0.12, 12), L.skin, [0, 0.03, 0]),                                                // шея
    part(SPH(HR, 24, 18), L.skin, [0, HC, 0], [1, 1.06, 1]),
    part(SPH(0.15, 18, 12), L.skin, [0, HC - 0.075, -0.045], [1, 0.85, 1]),                                  // челюсть
    part(SPH(0.045, 10, 8), L.skin, [-0.2, HC - 0.01, 0.01], [0.45, 0.85, 0.7]),                             // уши
    part(SPH(0.045, 10, 8), L.skin, [0.2, HC - 0.01, 0.01], [0.45, 0.85, 0.7]),
    part(SPH(0.03, 10, 8), shade(L.skin, 0.93), [0, HC - 0.03, -0.198], [1, 0.9, 0.8]),                       // нос
  ];
  const mascot = s.id === 'pepe';                                        // у Пепе — глаза-«бусины» на макушке вместо обычных
  for (const sx of mascot ? [] : [-1, 1]) {
    headParts.push(
      part(SPH(0.05, 14, 10), eyeW, [sx * 0.074, HC + 0.03, -0.165], [0.85, 1.15, 0.55]),                   // белок
      part(SPH(0.028, 12, 8), iris, [sx * 0.072, HC + 0.025, -0.19], [1, 1.12, 0.5]),                       // радужка
      part(SPH(0.009, 6, 5), 0xffffff, [sx * 0.064, HC + 0.042, -0.203]),                                   // блик
      part(BOX(0.072, 0.017, 0.02), brow, [sx * 0.078, HC + 0.098, -0.178], [1, 1, 1], [0.15, 0, sx * -0.18]), // бровь
    );
  }
  headParts.push(part(TOR(0.032, 0.008, Math.PI, 12), 0x7a2a2a, [0, HC - 0.083, -0.182], [1, 1, 1], [0, 0, Math.PI]));   // улыбка
  headParts.push(...hairParts(L.hair[0], L.hair[1]));
  // головные уборы
  const hc = s.hatColor ?? s.body ?? fallbackColor;
  switch (s.hat) {
    case 'cap':
      // купол до бровей (сзади ниже), козырёк над глазами
      headParts.push(part(SPH(HR * 1.08, 22, 10, 0, Math.PI * 0.42), hc, [0, HC + 0.03, 0.01], [1, 1.05, 1.05], [0.3, 0, 0]),
        part(CYL(0.1, 0.1, 0.02, 20, false), shade(hc, 0.85), [0, HC + 0.125, -0.2], [1, 1, 0.85], [-0.3, 0, 0]),
        part(SPH(0.025, 8, 6), L.accent, [0, HC + 0.25, 0.02]));
      break;
    case 'beanie':
      // шапка до бровей, отворот, помпон; сзади ниже
      headParts.push(part(SPH(HR * 1.1, 22, 12, 0, Math.PI * 0.4), hc, [0, HC + 0.04, 0.01], [1, 1.15, 1.02], [0.28, 0, 0]),
        part(TOR(0.198, 0.032, Math.PI * 2, 24), shade(hc, 0.85), [0, HC + 0.11, 0.035], [1, 1, 1.02], [Math.PI / 2 + 0.28, 0, 0]),
        part(SPH(0.065, 12, 10), 0xffffff, [0, HC + 0.32, 0.04]));
      break;
    case 'horns': for (const sx of [-1, 1]) {
      headParts.push(part(new THREE.ConeGeometry(0.05, 0.22, 10), 0xf4ead2, [sx * 0.22, HC + 0.14, 0], [1, 1, 1], [0, 0, -sx * 0.95]),
        part(new THREE.ConeGeometry(0.035, 0.12, 10), 0xf4ead2, [sx * 0.31, HC + 0.25, 0], [1, 1, 1], [0, 0, -sx * 0.2]));
    } break;
    case 'ears': for (const sx of [-1, 1]) headParts.push(part(SPH(0.075, 12, 10), s.body, [sx * 0.15, HC + 0.18, 0.02]), part(SPH(0.04, 10, 8), mix(L.skin, 0xffc0c0, 0.3), [sx * 0.15, HC + 0.18, -0.03], [1, 1, 0.5])); break;
    case 'fin': headParts.push(part(new THREE.ConeGeometry(0.11, 0.26, 4), s.body, [0, HC + 0.3, 0.04], [1, 1, 0.35])); break;
    case 'antenna': for (const sx of [-1, 1]) headParts.push(part(CYL(0.01, 0.012, 0.36, 6), 0xff6f8a, [sx * 0.08, HC + 0.33, -0.04], [1, 1, 1], [0.2, 0, -sx * 0.35]), part(SPH(0.03, 8, 6), 0xff3b6a, [sx * 0.15, HC + 0.5, -0.08])); break;
    case 'helmet': headParts.push(part(TOR(0.15, 0.04, Math.PI * 2, 20), 0xd8dde6, [0, 0.0, 0], [1, 1, 1], [Math.PI / 2, 0, 0])); break;
    case 'crown': {
      headParts.push(part(CYL(0.17, 0.16, 0.1, 12, true), 0xffd21a, [0, HC + 0.21, 0]));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; headParts.push(part(new THREE.ConeGeometry(0.035, 0.1, 6), 0xffd21a, [Math.cos(a) * 0.16, HC + 0.3, Math.sin(a) * 0.16]), part(SPH(0.018, 6, 5), 0xffe88a, [Math.cos(a) * 0.16, HC + 0.36, Math.sin(a) * 0.16])); }
      headParts.push(part(SPH(0.032, 8, 6), 0xff3b5a, [0, HC + 0.21, -0.17]));
      break;
    }
    case 'knight':
      headParts.push(part(SPH(HR * 1.15, 22, 16), 0xc9d1dc, [0, HC, 0], [1, 1.08, 1.02]),
        part(BOX(0.3, 0.035, 0.05), 0x15151a, [0, HC + 0.02, -0.215]), part(BOX(0.03, 0.12, 0.05), 0x15151a, [0, HC - 0.06, -0.222]),
        part(TOR(0.23, 0.014, Math.PI * 2, 22), 0x9aa3b4, [0, HC - 0.1, 0], [1, 1, 1], [Math.PI / 2, 0, 0]));
      for (let i = 0; i < 5; i++) headParts.push(part(SPH(0.05, 10, 8), 0xd23b3b, [0, HC + 0.26 + i * 0.012, -0.08 + i * 0.05], [0.6, 1, 1.2]));
      break;
    case 'wick': headParts.push(part(CYL(0.012, 0.012, 0.14, 6), 0x222222, [0, HC + 0.27, 0])); break;
  }
  if (s.extra === 'lips') headParts.push(part(SPH(0.06, 12, 8), 0xc0392b, [0, HC - 0.075, -0.17], [1.5, 0.55, 0.6]));
  if (mascot) for (const sx of [-1, 1]) headParts.push(part(SPH(0.065, 14, 10), eyeW, [sx * 0.085, HC + 0.13, -0.12]), part(SPH(0.034, 10, 8), 0x111111, [sx * 0.085, HC + 0.14, -0.178]), part(SPH(0.01, 6, 5), 0xffffff, [sx * 0.075, HC + 0.155, -0.205]));
  head.add(mesh(headParts));
  head.scale.setScalar(HEAD_K);
  // прозрачные и светящиеся детали — отдельными мешами
  if (s.hat === 'helmet') { const gl = new THREE.Mesh(SPH(0.31, 24, 18), new THREE.MeshToonMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.3 })); gl.position.y = HC; head.add(gl); }
  if (s.hat === 'wick') { const fl = new THREE.Mesh(SPH(0.07, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffb23a })); fl.position.y = HC + 0.4; fl.scale.set(1, 1.7, 1); head.add(fl); }
  if (s.hat === 'crystal') { const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), toon(0xbff4ff, { emissive: 0x2a8ab0 })); c.position.y = HC + 0.42; c.scale.y = 1.4; head.add(c); }
  if (s.extra === 'laser') {
    const beam = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.75 });
    for (const sx of [-1, 1]) { const b = new THREE.Mesh(BOX(0.025, 0.025, 0.7), beam); b.position.set(sx * 0.072, HC + 0.025, -0.55); head.add(b); }
  }

  // ---- руки: плечо → локоть → кисть ----
  const arm = (sx) => {
    const sh = grp(sx * 0.29, 0.45, 0);
    sh.add(mesh([
      part(SPH(0.088, 14, 10), shade(jacket, 1.05), [sx * 0.005, 0.0, 0], [1.0, 0.85, 0.95]),               // наплечник
      part(LATHE([[0.0, 0.02], [0.075, 0.0], [0.072, -0.14], [0.064, -0.27], [0.0, -0.29]], 12), jacket),
    ]));
    const el = grp(0, -0.28, 0);
    const hand = L.glove ?? L.skin;
    el.add(mesh([
      part(LATHE([[0.0, 0.0], [0.064, -0.01], [0.058, -0.2], [0.0, -0.22]], 12), jacket),
      part(TOR(0.058, 0.016, Math.PI * 2, 16), L.accent, [0, -0.2, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),     // манжета
      part(SPH(0.058, 14, 10), hand, [0, -0.28, -0.005], [0.9, 1.15, 0.75]),                               // кисть
      part(SPH(0.026, 8, 6), hand, [-sx * 0.045, -0.255, -0.03], [1, 1.4, 1], [0, 0, sx * 0.5]),            // большой палец
    ]));
    const grip = grp(0, -0.29, 0);
    el.add(grip);
    sh.add(el);
    spine.add(sh);
    return { sh, el, grip };
  };
  const AL = arm(-1), AR = arm(1);
  AL.sh.rotation.z = -0.12; AR.sh.rotation.z = 0.12;

  g.add(hips);
  g.userData.rig = { l1: LL.hip, l2: LR.hip, k1: LL.knee, k2: LR.knee, a1: AL.sh, a2: AR.sh, e1: AL.el, e2: AR.el, grip: AR.grip, gripL: AL.grip, hips, body: spine, head, hands: [AL.grip, AR.grip] };
  outlineGroup(g, 0.022);
  return g;
}

// ---------- Анимация ----------
// state: 'idle' | 'run' | 'air' | 'glide' | 'chute' | 'sit' | 'heal' | эмоции 'dance' 'floss' 'wave' 'moon'.
// speed — 0…1 (доля бега); armed — держит оружие (руки к оружию, корпус чуть развёрнут).
// Углы: «вперёд» для бедра/плеча — положительный (конечность уходит в −Z); колено/локоть — сгиб ≥ 0.
const lerpTo = (o, key, v, k) => { o[key] += (v - o[key]) * k; };
export function animateCharacter(g, t, state, speed = 1, armed = false) {
  const r = g.userData.rig;
  if (!r) return;
  const P = { hl: 0, hr: 0, kl: 0.05, kr: 0.05, sl: 0, sr: 0, zl: -0.12, zr: 0.12, el: 0.15, er: 0.15, lean: 0, twist: 0, bob: 0, sway: 0, roll: 0, hp: 0, hy: 0 };
  if (state === 'run') {
    const ph = t * 11.5, sn = Math.sin(ph), sp = speed;
    P.hl = 0.8 * sn * sp; P.hr = -P.hl;
    P.kl = 0.15 + 1.1 * Math.max(0, Math.sin(ph - 1.4)) * sp; P.kr = 0.15 + 1.1 * Math.max(0, Math.sin(ph + Math.PI - 1.4)) * sp;
    P.sl = -0.75 * sn * sp; P.sr = 0.75 * sn * sp;
    P.el = 0.5 + 0.7 * sp + 0.25 * Math.max(0, -sn); P.er = 0.5 + 0.7 * sp + 0.25 * Math.max(0, sn);
    P.lean = 0.2 * sp; P.twist = 0.16 * sn * sp; P.bob = (Math.abs(Math.cos(ph)) - 0.6) * 0.06 * sp; P.hy = -0.1 * sn * sp;
    P.zl = -0.18; P.zr = 0.18;
  } else if (state === 'air') {
    P.hl = 0.6; P.hr = -0.15; P.kl = 1.0; P.kr = 0.5; P.sl = 0.3; P.sr = -0.2; P.zl = -0.8; P.zr = 0.8; P.el = 0.6; P.er = 0.6; P.lean = -0.05;
  } else if (state === 'sit') {
    P.hl = P.hr = 1.5; P.kl = P.kr = 1.5; P.sl = P.sr = 0.55 + Math.sin(t * 1.7) * 0.04; P.el = P.er = 0.7; P.lean = 0.12; P.bob = -0.42;
  } else if (state === 'chute') {
    P.hl = 0.25 + Math.sin(t * 2) * 0.1; P.hr = 0.1 - Math.sin(t * 2) * 0.1; P.kl = 0.5; P.kr = 0.35;
    P.zl = -2.6 + Math.sin(t * 2) * 0.05; P.zr = 2.6 - Math.sin(t * 2) * 0.05; P.el = P.er = 0.35; P.sl = P.sr = 0.15; P.hp = -0.2;
  } else if (state === 'heal') {
    P.sl = P.sr = 0.95; P.zl = 0.35 + Math.sin(t * 9) * 0.05; P.zr = -0.35 - Math.sin(t * 9) * 0.05; P.el = P.er = 1.25; P.hp = 0.35; P.lean = 0.1; P.kl = P.kr = 0.15;
  } else if (state === 'dance') {
    const b = Math.sin(t * 8), up = Math.max(0, b);
    P.kl = P.kr = 0.25 + up * 0.45; P.bob = -up * 0.08; P.hl = P.hr = 0.12 + up * 0.25;
    P.zl = -1.3 - b * 1.0; P.zr = 1.3 - b * 1.0; P.el = P.er = 1.1 + b * 0.3; P.sl = P.sr = 0.3;
    P.twist = Math.sin(t * 4) * 0.25; P.roll = b * 0.06; P.hy = Math.sin(t * 4) * 0.3;
  } else if (state === 'floss') {
    const b = Math.sin(t * 9);
    P.zl = -0.3 + b * 0.5; P.zr = 0.3 + b * 0.5; P.sl = b > 0 ? 0.45 : -0.45; P.sr = -P.sl; P.el = P.er = 0.05;
    P.sway = -b * 0.06; P.roll = -b * 0.12; P.kl = P.kr = 0.2;
  } else if (state === 'wave') {
    P.zr = 2.4; P.sr = 0.25; P.er = 0.5 + Math.sin(t * 10) * 0.45; P.hy = 0.15; P.roll = 0.05;
  } else if (state === 'moon') {
    const b = Math.sin(t * 6), up = Math.max(0, b);
    P.zl = -2.8 + b * 0.12; P.zr = 2.8 - b * 0.12; P.el = P.er = 0.2; P.bob = up * 0.12 - 0.03; P.kl = P.kr = 0.35 - up * 0.3; P.hp = -0.3; P.hl = P.hr = 0.15;
  } else if (state === 'glide') {
    P.hl = -0.25 + Math.sin(t * 6) * 0.08; P.hr = -0.15 - Math.sin(t * 6) * 0.08; P.kl = 0.6; P.kr = 0.45;
    P.zl = -1.4 + Math.sin(t * 3) * 0.08; P.zr = 1.4 - Math.sin(t * 3) * 0.08; P.el = P.er = 0.35; P.sl = P.sr = -0.15; P.hp = -0.5;
  } else {
    // покой: дыхание, лёгкое покачивание, расслабленные руки
    const br = Math.sin(t * 2.2);
    P.zl = -0.14 - br * 0.03; P.zr = 0.14 + br * 0.03; P.el = 0.22 + br * 0.04; P.er = 0.22 - br * 0.04;
    P.bob = br * 0.008; P.sway = Math.sin(t * 0.9) * 0.012; P.hy = Math.sin(t * 0.7) * 0.12; P.kl = 0.06; P.kr = 0.1;
  }
  if (armed && !['glide', 'chute', 'heal', 'dance', 'floss', 'wave', 'moon', 'sit'].includes(state)) {
    // держит оружие: правая рука у рукояти, левая под цевьём; корпус развёрнут правым плечом назад
    P.sr = 0.85; P.er = 0.35; P.zr = 0.08;
    P.sl = 1.05; P.el = 0.5; P.zl = 0.6;
    P.twist = (P.twist || 0) * 0.3 - 0.12; P.hy = 0.12; P.hp = 0.05;
  }
  const k = 0.25;
  lerpTo(r.l1.rotation, 'x', P.hl, k); lerpTo(r.l2.rotation, 'x', P.hr, k);
  lerpTo(r.k1.rotation, 'x', -P.kl, k); lerpTo(r.k2.rotation, 'x', -P.kr, k);
  lerpTo(r.a1.rotation, 'x', P.sl, k); lerpTo(r.a2.rotation, 'x', P.sr, k);
  lerpTo(r.a1.rotation, 'z', P.zl, k); lerpTo(r.a2.rotation, 'z', P.zr, k);
  lerpTo(r.e1.rotation, 'x', P.el, k); lerpTo(r.e2.rotation, 'x', P.er, k);
  lerpTo(r.body.rotation, 'x', -P.lean, k); lerpTo(r.body.rotation, 'y', P.twist, k); lerpTo(r.body.rotation, 'z', P.roll, k);
  lerpTo(r.hips.position, 'y', 0.93 + P.bob, k); lerpTo(r.hips.position, 'x', P.sway, k);
  lerpTo(r.head.rotation, 'x', -P.hp, k); lerpTo(r.head.rotation, 'y', P.hy, k);
}
