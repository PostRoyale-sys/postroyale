// Рейтинговый режим: RP, магазин за RP и допуск через пост в X — всё на сервере (server/rp.py).
//
// Аккаунт создаётся сам (гость, токен в localStorage); привязка кошелька переносит его на другие устройства.
// Допуск: пост в X с #PostRoyale и личным кодом аккаунта — проверяет сервер (один пост и один X-аккаунт — на одного
// игрока; удалённый пост снимает допуск). Ranked идёт только через сервер матчей: RP начисляет сервер по событиям
// матча и присылает их ({t:'rp'}), клиент только показывает. Здесь — копия профиля для отрисовки лобби.

import { mmUrls } from './mm.js';

const KEY = 'pr:acct';
const OLD = 'pr:ranked';                       // старое хранилище (до сервера): переносим только купленную косметику
export const TAG = '#PostRoyale';

// RP за события рейтингового матча.
export const RP = { kill: 10, botkill: 3, chest: 1, survive: 2, top3: 15, top2: 25, win: 60 };
const LABEL = { kill: 'Elimination', botkill: 'Bot down', chest: 'Chest', survive: 'Survived 1 min', top3: 'Top 3', top2: 'Top 2', win: 'Victory' };

// Магазин: скины (id совпадает со скином в skins.js) и платформы под персонажем в лобби.
export const SHOP = [
  { id: 'champ', kind: 'skin', name: 'Ranked Champ', price: 300, icon: '🏆', rarity: 4 },
  { id: 'knight', kind: 'skin', name: 'Rugged Knight', price: 250, icon: '🛡', rarity: 3 },
  { id: 'neon', kind: 'skin', name: 'Neon Degen', price: 200, icon: '💗', rarity: 3 },
  { id: 'candle', kind: 'skin', name: 'Green Candle', price: 150, icon: '🕯', rarity: 2 },
  { id: 'pad-gold', kind: 'pad', name: 'Gold Pad', price: 120, icon: '🟡', rarity: 3, color: 0xffc928, rim: 0xffffff },
  { id: 'pad-neon', kind: 'pad', name: 'Neon Pad', price: 90, icon: '🟣', rarity: 2, color: 0xb14dff, rim: 0x5dff9a },
  { id: 'pad-fire', kind: 'pad', name: 'Fire Pad', price: 100, icon: '🔥', rarity: 2, color: 0xff6a2a, rim: 0xffd21a },
];

// Остров рейтинга — один на сутки (UTC) для всех.
export const rankedWorld = () => `ranked-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
export const isRankedWorld = (id) => /^ranked-\d{8}$/.test(id || '');

// Адрес API — тот же сервер, что и матчи: wss://host → https://host.
const apiBase = () => mmUrls()[0].replace(/^ws/, 'http');

export function createRanked(ctx) {
  let tok = null, me = null;                   // me — профиль с сервера: { rp, owned, pad, code, access, wallet, today, cap }
  try { ({ tok, me } = JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* пусто */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ tok, me })); } catch (e) { /* квота */ } };
  const set = (p) => {
    if (p.tok) tok = p.tok;
    const { tok: _t, error: _e, ...rest } = p;
    if (rest.id) { me = rest; save(); ctx.onChange?.(); }
  };

  async function call(what, body = {}) {
    let res;
    try {
      res = await fetch(`${apiBase()}/api/${what}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ tok, ...body }) });
    } catch (e) { throw new Error('Server is unreachable — try again in a minute'); }
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 && what !== 'me') { tok = null; await load(); throw new Error('Session expired — try again'); }
    set(j);
    if (!res.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  }
  // Профиль с сервера (нет токена — сервер заведёт гостевой аккаунт).
  let loading = null;
  function load() {
    if (loading) return loading;
    let legacy;
    if (!tok) try { legacy = JSON.parse(localStorage.getItem(OLD) || '{}').owned; } catch (e) { /* нет */ }
    loading = call('me', legacy ? { legacy } : {}).catch((e) => { console.warn('[ranked]', e.message); }).finally(() => { loading = null; });
    return loading;
  }
  load();
  setInterval(() => { if (!document.hidden) load(); }, 5 * 60e3);

  const hasAccess = () => !!me?.access && me.access.until > Date.now();
  return {
    get tok() { return tok; },
    get rp() { return me?.rp ?? 0; },
    get code() { return me?.code || ''; },
    get wallet() { return me?.wallet || null; },
    get today() { return me ? { earned: me.today, cap: me.cap } : null; },
    get access() { return hasAccess() ? me.access : null; },
    get pad() { return me?.pad || null; },
    ready: () => !!me,
    hasAccess, load,
    owns: (id) => !!me?.owned?.includes(id),
    async verify(url) { await call('verify', { url }); return me.access; },
    // Начисление от сервера во время рейтингового матча ({t:'rp'}).
    onServer(m) {
      if (me) { me.rp = m.rp; me.today = m.today; me.cap = m.cap; save(); }
      if (m.n > 0) ctx.toast?.(`+${m.n} RP ${LABEL[m.k] || ''}`);
      else if (m.n === 0) ctx.toast?.(`Daily RP cap reached (${m.cap})`);
      ctx.onChange?.();
    },
    async buy(id) { try { await call('buy', { id }); return true; } catch (e) { return false; } },
    // Потратить RP (золотые кейсы) — списывает сервер.
    async spend(what) { try { await call('spend', { what }); return true; } catch (e) { return false; } },
    async setPad(id) { try { await call('pad', { id }); } catch (e) { /* не наш */ } },
    // Кошелёк: сервер выдаёт сообщение с nonce, Phantom подписывает, сервер проверяет подпись.
    async linkWallet(provider, pubkey) {
      const { message } = await call('nonce', { pubkey });
      const { signature } = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
      const sig = btoa(String.fromCharCode(...signature));
      await call('link', { pubkey, sig });
      return me;
    },
    postText: (link) => `I'm dropping into ${TAG} 🪂⛏🌪 — a battle royale that lives inside a post. Loot, build, last one standing wins. My code: ${me?.code || ''} Play: ${link}`,
  };
}
