// Монеты 🪙 и набор способностей из лобби.
// Монеты копятся в любом матче (COIN). В лобби (вкладка Abilities) на них покупаются заряды способностей —
// они лежат на складе — и выбирается набор на два слота F и Q. В начале матча выбранные способности
// заряжаются со склада (не больше максимума способности); неистраченные заряды после матча возвращаются.
// Хранится в localStorage (pr:loadout). Без денежной стоимости.

import { ABILITIES } from './abilities.js';

const KEY = 'pr:loadout';
export const COIN = { kill: 25, botkill: 10, chest: 3, survive: 5, top3: 20, top2: 35, win: 100 };
export const CHARGE_PRICE = { dash: 60, jump: 40, shield: 80, smoke: 70, recon: 60, nade: 100, drone: 120 };

export function createLoadout(ctx) {
  let st = { coins: 150, stock: {}, picks: ['dash', null] };   // немного монет и рывок в наборе — для старта
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* по умолчанию */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* квота */ } };
  let loaded = null;              // что заряжено в текущий матч: [{ id, n }] — для возврата

  return {
    get coins() { return st.coins; },
    get picks() { return st.picks; },
    stock: (id) => st.stock[id] || 0,
    earn(kind) {
      const n = COIN[kind] || 0;
      if (!n) return;
      st.coins += n;
      save();
      ctx.onChange?.();
    },
    give(n) { st.coins += n; save(); ctx.onChange?.(); },
    spend(n) {
      if (st.coins < n) return false;
      st.coins -= n;
      save();
      ctx.onChange?.();
      return true;
    },
    buy(id) {
      const p = CHARGE_PRICE[id];
      if (!p || st.coins < p) return false;
      st.coins -= p;
      st.stock[id] = (st.stock[id] || 0) + 1;
      save();
      ctx.onChange?.();
      return true;
    },
    // Поставить способность в слот 0 (F) или 1 (Q); та же в другом слоте — убирается оттуда.
    pick(slot, id) {
      if (id && st.picks[1 - slot] === id) st.picks[1 - slot] = null;
      st.picks[slot] = st.picks[slot] === id ? null : id;
      save();
      ctx.onChange?.();
    },
    // Начало матча: зарядить слоты со склада.
    equip(slots) {
      loaded = [null, null];
      st.picks.forEach((id, i) => {
        if (!id) return;
        const n = Math.min(st.stock[id] || 0, ABILITIES[id].max);
        if (!n) return;
        st.stock[id] -= n;
        slots[i] = { id, n };
        loaded[i] = { id };
      });
      save();
    },
    // Конец матча/выход: вернуть неистраченные заряды на склад.
    giveBack(slots) {
      if (!loaded) return;
      slots.forEach((s, i) => { if (s && loaded[i] && s.id === loaded[i].id) st.stock[s.id] = (st.stock[s.id] || 0) + s.n; });
      loaded = null;
      save();
    },
  };
}
