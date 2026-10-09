// Gunsmith — обвесы на оружие за монеты 🪙 (вкладка в лобби). Покупаются один раз и навсегда ставятся
// на этот тип оружия у тебя: подобрал AR — на нём уже твой прицел, магазин и т.д. Хранится в localStorage
// (pr:gunsmith). Действует только на твоё оружие (у других — их собственные обвесы).
//
//   optic — прицел: ПКМ — прицеливание с зумом и меньшим разбросом (красная точка / ACOG 3x);
//   mag   — двойной магазин (снайперка — 3 патрона вместо 1);
//   grip  — рукоятка/чок: разброс от бедра ×0.65;
//   speed — быстрая перезарядка ×0.6.

const KEY = 'pr:gunsmith';

export const MODS = {
  optic: { name: 'Optic', icon: '🔴', price: 150 },
  mag: { name: 'Double Mag', icon: '🧱', price: 200, desc: 'Magazine ×2' },
  grip: { name: 'Vertical Grip', icon: '✊', price: 120, desc: 'Hip-fire spread −35%' },
  speed: { name: 'Fast Mag', icon: '⚡', price: 120, desc: 'Reload 40% faster' },
};

// Какие обвесы есть у какого оружия и как называются.
export const GUN_MODS = {
  ar: { optic: { name: 'ACOG 3x', desc: 'RMB: aim 3x, spread −80%', fov: 32, ads: 0.2, dot: 'acog' }, mag: {}, grip: {}, speed: {} },
  smg: { optic: { name: 'Red Dot', desc: 'RMB: aim, spread −65%', fov: 58, ads: 0.35, dot: 'red' }, mag: {}, grip: {}, speed: {} },
  pistol: { optic: { name: 'Red Dot', desc: 'RMB: aim, spread −65%', fov: 58, ads: 0.35, dot: 'red' }, mag: {}, grip: {}, speed: {} },
  shotgun: { optic: { name: 'Holo Sight', desc: 'RMB: aim, pellets tighter −30%', fov: 62, ads: 0.7, dot: 'holo' }, mag: {}, grip: { name: 'Choke', desc: 'Pellet spread −35%' }, speed: { name: 'Shell Loader', desc: 'Reload 40% faster' } },
  sniper: { mag: { name: '3-Round Mag', desc: '3 shots before reload', mult: 3 }, speed: { name: 'Bolt Kit', desc: 'Reload 40% faster' } },
};
export const GUN_ORDER = ['ar', 'smg', 'shotgun', 'pistol', 'sniper'];

export const modInfo = (gun, id) => ({ ...MODS[id], ...(GUN_MODS[gun]?.[id] || {}) });

export function createGunsmith(ctx) {
  let owned = {};
  try { owned = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { /* по умолчанию */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(owned)); } catch (e) { /* квота */ } };
  const has = (gun, id) => !!owned[`${gun}:${id}`];

  return {
    has,
    buy(gun, id) {
      if (!GUN_MODS[gun]?.[id] || has(gun, id)) return false;
      if (!ctx.spend(MODS[id].price)) return false;
      owned[`${gun}:${id}`] = 1;
      save();
      ctx.onChange?.();
      return true;
    },
    // Итоговые множители для оружия этого типа.
    stats(gun) {
      const m = GUN_MODS[gun] || {};
      return {
        mag: has(gun, 'mag') ? (m.mag?.mult || 2) : 1,
        reload: has(gun, 'speed') ? 0.6 : 1,
        spread: has(gun, 'grip') ? 0.65 : 1,
        optic: has(gun, 'optic') && m.optic ? m.optic : null,
      };
    },
  };
}
