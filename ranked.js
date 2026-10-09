// Рейтинговый режим: отдельные очки RP (только в рейтинговых матчах), магазин за RP и допуск через пост в X.
//
// Допуск: игрок постит про проект (готовый текст с #PostRoyale и ссылкой) и вставляет ссылку на пост. Проверяем
// через официальный oEmbed X (publish.x.com/oembed — отвечает браузеру, без ключей): пост существует, в тексте есть
// #PostRoyale, опубликован не раньше POST_FRESH дней назад. Допуск — на ACCESS_DAYS дней.
//
// ВАЖНО: без сервера RP и допуск хранятся в браузере игрока (localStorage) и подделываются из консоли —
// RP «без денежной стоимости»; обмен на токены возможен только после переноса подсчёта на сервер.

const KEY = 'pr:ranked';
export const TAG = '#PostRoyale';
const POST_FRESH = 7, ACCESS_DAYS = 7;

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

export function createRanked(ctx) {
  let st = { rp: 0, owned: [], pad: null, access: null };      // access: { url, handle, until }
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* пусто */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* квота */ } };

  const hasAccess = () => !!st.access && st.access.until > Date.now();

  // Проверка поста: ссылка → oEmbed → текст, автор, дата.
  async function verify(url) {
    const m = url.trim().match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    if (!m) throw new Error('Paste a link like https://x.com/you/status/123…');
    const res = await fetch(`https://publish.x.com/oembed?url=${encodeURIComponent(`https://x.com/${m[1]}/status/${m[2]}`)}&omit_script=1&dnt=1`);
    if (!res.ok) throw new Error('Post not found — is it public?');
    const j = await res.json();
    const doc = new DOMParser().parseFromString(j.html || '', 'text/html');
    const text = doc.querySelector('p')?.textContent || '';
    if (!text.toLowerCase().includes(TAG.toLowerCase())) throw new Error(`The post must include ${TAG}`);
    const links = [...doc.querySelectorAll('a')];
    const date = new Date(links[links.length - 1]?.textContent || '');
    if (!isNaN(date) && Date.now() - date.getTime() > POST_FRESH * 864e5) throw new Error(`Post is older than ${POST_FRESH} days — make a fresh one`);
    const handle = (j.author_url || '').split('/').pop() || m[1];
    st.access = { url: j.url || url, handle, until: Date.now() + ACCESS_DAYS * 864e5 };
    save();
    return st.access;
  }

  return {
    get rp() { return st.rp; },
    get access() { return hasAccess() ? st.access : null; },
    get pad() { return st.pad; },
    hasAccess, verify,
    owns: (id) => st.owned.includes(id),
    // Начислить RP (вызывать только в рейтинговом матче).
    add(kind) {
      const n = RP[kind] || 0;
      if (!n) return;
      st.rp += n;
      save();
      ctx.toast?.(`+${n} RP ${LABEL[kind] || ''}`);
      ctx.onChange?.();
    },
    buy(id) {
      const it = SHOP.find((s) => s.id === id);
      if (!it || st.owned.includes(id)) return false;
      if (st.rp < it.price) return false;
      st.rp -= it.price;
      st.owned.push(id);
      if (it.kind === 'pad') st.pad = id;
      save();
      ctx.onChange?.();
      return true;
    },
    // Потратить RP (золотые кейсы).
    spend(n) {
      if (st.rp < n) return false;
      st.rp -= n;
      save();
      ctx.onChange?.();
      return true;
    },
    setPad(id) { if (!id || st.owned.includes(id)) { st.pad = id; save(); ctx.onChange?.(); } },
    postText: (link) => `I'm dropping into ${TAG} 🪂⛏🌪 — a battle royale that lives inside a post. Loot, build, last one standing wins. Play: ${link}`,
  };
}
