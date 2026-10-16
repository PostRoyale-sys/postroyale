// Скины на оружие и кейсы. Скин = раскраска (finish) на конкретное оружие: «Gold AR», «Neon Pickaxe».
// Выпадают случайно из кейсов: обычный — за монеты 🪙, золотой — за RP (редкие чаще). Инвентарь
// (вкладка Cases → Inventory): что выпало и что надето на каждое оружие. Надетый скин видят все
// (поле pose.ws). Хранится в localStorage (pr:wskins). Повтор — возврат части цены монетами.

import * as THREE from 'three';

export const WS_RARITY = [
  { name: 'Common', color: '#b0b8c4' },
  { name: 'Rare', color: '#3d9bff' },
  { name: 'Epic', color: '#b05cff' },
  { name: 'Legendary', color: '#ffb21a' },
];

// a — основной цвет корпуса, b — металл/ствол; e — свечение; tex — узор (canvas) поверх корпуса.
export const FINISHES = {
  camo: { name: 'Woodland Camo', r: 0, a: 0x4f5f34, b: 0x3a3a2e, tex: 'camo' },
  desert: { name: 'Desert Storm', r: 0, a: 0xc9a46a, b: 0x8a7350, tex: 'desert' },
  arctic: { name: 'Arctic', r: 0, a: 0xe8eef4, b: 0x9aa6b4, tex: 'arctic' },
  redline: { name: 'Redline', r: 1, a: 0x1a1a1e, b: 0xd2232a, tex: 'redline' },
  candle: { name: 'Green Candle', r: 1, a: 0x1f8a50, b: 0x2fbf71, e: 0x0a3a1a },
  rug: { name: 'Rug Pull', r: 1, a: 0x5a1fa8, b: 0xf2c14e, tex: 'rug' },
  neon: { name: 'Neon Degen', r: 2, a: 0xff3fd0, b: 0x2a0a40, e: 0x6a0a5a },
  galaxy: { name: 'Galaxy', r: 2, a: 0x1a1240, b: 0x5a3fd0, e: 0x120a30, tex: 'galaxy' },
  lava: { name: 'Lava', r: 2, a: 0x2a0d08, b: 0xff5a1a, e: 0x3a0a00, tex: 'lava' },
  diamond: { name: 'Diamond', r: 3, a: 0x8fe8ff, b: 0xe8fbff, e: 0x1a6080 },
  gold: { name: 'Solid Gold', r: 3, a: 0xffc928, b: 0xffe680, e: 0x4a3000 },
};
export const WS_GUNS = ['ar', 'smg', 'shotgun', 'pistol', 'sniper', 'bazooka', 'pickaxe'];
export const GUN_NAME = { ar: 'AR', smg: 'SMG', shotgun: 'Shotgun', pistol: 'Pistol', sniper: 'Sniper', bazooka: 'Bazooka', pickaxe: 'Pickaxe' };
export const skinId = (gun, fin) => `${gun}.${fin}`;
export const skinInfo = (id) => {
  const [gun, fin] = id.split('.');
  const f = FINISHES[fin];
  return f && GUN_NAME[gun] ? { id, gun, fin, name: `${f.name} ${GUN_NAME[gun]}`, rarity: f.r, f } : null;
};
export const ALL_SKINS = WS_GUNS.flatMap((g) => Object.keys(FINISHES).map((f) => skinId(g, f)));

// Кейсы: цена и шансы по редкости (Common, Rare, Epic, Legendary).
export const CASES = {
  basic: { name: 'Degen Case', icon: '📦', cur: 'coins', price: 200, odds: [0.62, 0.27, 0.09, 0.02], color: '#5a6a8a' },
  gold: { name: 'Golden Case', icon: '👑', cur: 'rp', price: 60, odds: [0, 0.5, 0.35, 0.15], color: '#ffb21a' },
};
const REFUND = 0.25;                        // повтор — 25% цены кейса монетами (из золотого — по 3 🪙 за RP)

export function rollSkin(caseId, rand = Math.random) {
  const odds = CASES[caseId].odds;
  let x = rand(), r = 0;
  while (r < odds.length - 1 && x >= odds[r]) { x -= odds[r]; r++; }
  const pool = ALL_SKINS.filter((id) => skinInfo(id).rarity === r);
  return pool[Math.floor(rand() * pool.length)];
}

// ---------- Текстуры узоров ----------

const texCache = new Map();
function patternTex(kind, a, b) {
  if (texCache.has(kind)) return texCache.get(kind);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  const rnd = ((s) => () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ 0x9e3779b9) >>> 0) / 4294967296)(kind.length * 7919);
  g.fillStyle = hex(a); g.fillRect(0, 0, 128, 128);
  const blobs = (cols, n, rmin, rmax) => { for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); g.ellipse(rnd() * 128, rnd() * 128, rmin + rnd() * (rmax - rmin), rmin + rnd() * (rmax - rmin) * 0.6, rnd() * 3, 0, 7); g.fill(); } };
  switch (kind) {
    case 'camo': blobs(['#6d8048', '#2f3a22', '#8a7a4a'], 26, 8, 22); break;
    case 'desert': blobs(['#e8d0a0', '#a88a5a'], 24, 8, 20); break;
    case 'arctic': blobs(['#c4ccd6', '#8892a0'], 24, 8, 20); break;
    case 'redline': g.fillStyle = '#2a2a30'; for (let i = 0; i < 128; i += 16) { g.fillRect(i, 0, 6, 128); } g.fillStyle = '#ff3030'; g.fillRect(0, 56, 128, 10); break;
    case 'rug': g.fillStyle = '#ffd36a'; for (let i = 0; i < 128; i += 32) { g.fillRect(0, i, 128, 8); } g.fillStyle = '#c0392b'; for (let i = 16; i < 128; i += 32) g.fillRect(0, i, 128, 4); break;
    case 'galaxy': g.fillStyle = hex(a); g.fillRect(0, 0, 128, 128); blobs(['#7a5aff', '#ff5ad8', '#3a2aa0'], 10, 14, 30); g.fillStyle = '#ffffff'; for (let i = 0; i < 60; i++) g.fillRect(rnd() * 128, rnd() * 128, 1.5, 1.5); break;
    case 'lava': g.fillStyle = hex(a); g.fillRect(0, 0, 128, 128); g.strokeStyle = '#ff7a1a'; g.lineWidth = 3; for (let i = 0; i < 14; i++) { g.beginPath(); let x = rnd() * 128, y = rnd() * 128; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); } break;
  }
  void b;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(kind, t);
  return t;
}

// Перекрасить модель оружия (viewmodel.weaponModel) в раскраску fin. base — исходные цвета корпуса и металла.
export function applyFinish(group, fin, base) {
  const f = FINISHES[fin];
  if (!f) return;
  const mats = new Map();
  const matFor = (orig, key) => {
    if (mats.has(key)) return mats.get(key);
    const m = orig.clone();
    // с узором цвет — в самой текстуре, материал белый
    m.color = new THREE.Color(key === 'a' ? (f.tex ? 0xffffff : f.a) : f.b);
    if (f.e) m.emissive = new THREE.Color(f.e);
    if (key === 'a' && f.tex) m.map = patternTex(f.tex, f.a, f.b);
    mats.set(key, m);
    return m;
  };
  group.traverse((o) => {
    if (!o.isMesh || !o.material?.isMeshToonMaterial || o.userData.outline) return;
    const hex = o.material.color.getHex();
    if (base.a.includes(hex)) o.material = matFor(o.material, 'a');
    else if (base.b.includes(hex)) o.material = matFor(o.material, 'b');
  });
}

// ---------- Инвентарь ----------

const KEY = 'pr:wskins';
export function createWeaponSkins(ctx) {
  let st = { owned: {}, eq: {} };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* по умолчанию */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* квота */ } };

  return {
    owned: () => Object.keys(st.owned).filter((id) => skinInfo(id)),
    count: (id) => st.owned[id] || 0,
    equipped: (gun) => st.eq[gun] || null,
    // Раскраска надетого скина на этом оружии (или null).
    finishOf: (gun) => (st.eq[gun] ? st.eq[gun].split('.')[1] : null),
    equip(id) {
      const s = skinInfo(id);
      if (!s || !st.owned[id]) return;
      st.eq[s.gun] = st.eq[s.gun] === id ? null : id;      // повторный клик — снять
      save();
      ctx.onChange?.();
    },
    // Открыть кейс: списать цену (ctx.pay; RP списывает сервер), выбросить скин. → { id, dup, refund } или null (не хватает)
    async open(caseId) {
      const c = CASES[caseId];
      if (!c || !(await ctx.pay(c.cur, c.price, caseId))) return null;
      const id = rollSkin(caseId);
      const dup = !!st.owned[id];
      st.owned[id] = (st.owned[id] || 0) + 1;
      let refund = 0;
      if (dup) { refund = Math.round(c.cur === 'coins' ? c.price * REFUND : c.price * 3 * REFUND); ctx.refund?.(refund); }
      save();
      ctx.onChange?.();
      return { id, dup, refund };
    },
  };
}
