// Сезонные очки и польза токена.
//
// Очки сезона — БЕЗ ДЕНЕЖНОЙ СТОИМОСТИ. Пока нет сервера, считаются в браузере игрока (P2P) и подделываются —
// поэтому никаких выплат за очки; при переходе на сервер (Cloudflare) их станет считать сервер.
//
// Кошелёк Solana: привязка подписью сообщения в Phantom (ключи не уходят), баланс токена — по адресу его
// ассоциированного счёта (ATA) через публичный RPC (индексные методы там закрыты, getAccountInfo — открыт).
// Уровень держателя даёт только косметику и «золотой ключ» (+1 к редкости одного сундука за раунд).

const SEASON = 'S1';
export const TOKEN_MINT = '';                 // адрес токена проекта — вписать, когда появится; пусто = польза выключена
export const TOKEN_SYMBOL = '$PR';           // тикер токена в интерфейсе лобби — поменять на настоящий
export const TIERS = [                        // минимальный баланс токена для уровня
  { name: 'Holder', min: 1, color: '#c0c7d1' },
  { name: 'Silver', min: 100_000, color: '#dfe6ee' },
  { name: 'Gold', min: 1_000_000, color: '#ffc83d' },
];
const POINTS = { kill: 100, chest: 10, survive: 5, top3: 50, top2: 100, win: 500 };
const LABELS = { kill: 'Elimination', chest: 'Chest', survive: 'Survived 1 min', top3: 'Top 3', top2: 'Top 2', win: 'Last one standing' };
const RPCS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

const KEY = `pr:season:${SEASON}`;
const WKEY = 'pr:wallet';

export function createSeason(ctx) {
  let st = { points: 0, kills: 0, wins: 0, rounds: 0, chests: 0 };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* пусто */ }
  let wallet = null;            // { pubkey, balance, tier, checkedAt }
  try { wallet = JSON.parse(localStorage.getItem(WKEY) || 'null'); } catch (e) { /* пусто */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* квота */ } };

  function add(kind) {
    const n = POINTS[kind] || 0;
    st.points += n;
    if (kind === 'kill') st.kills++;
    if (kind === 'win') st.wins++;
    if (kind === 'chest') st.chests++;
    save();
    ctx.pointsToast(`+${n} ${LABELS[kind]}`);
    ctx.onSeason();
  }

  const tierOf = (balance) => {
    let t = -1;
    TIERS.forEach((x, i) => { if (balance >= x.min) t = i; });
    return t;
  };

  async function rpc(body) {
    let err;
    for (const url of RPCS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }) });
        const j = await res.json();
        if (j.error) throw new Error(j.error.message);
        return j.result;
      } catch (e) { err = e; }
    }
    throw err;
  }

  // Баланс токена кошелька: ATA для классического SPL и для Token-2022.
  async function balanceOf(owner) {
    if (!TOKEN_MINT) return 0;
    const { PublicKey } = await import('https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.0/+esm');
    let total = 0;
    for (const prog of TOKEN_PROGRAMS) {
      const [ata] = PublicKey.findProgramAddressSync(
        [new PublicKey(owner).toBuffer(), new PublicKey(prog).toBuffer(), new PublicKey(TOKEN_MINT).toBuffer()], new PublicKey(ATA_PROGRAM));
      const r = await rpc({ method: 'getAccountInfo', params: [ata.toBase58(), { encoding: 'jsonParsed' }] });
      total += r?.value?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    }
    return total;
  }

  async function refresh() {
    if (!wallet?.pubkey) return;
    try {
      wallet.balance = await balanceOf(wallet.pubkey);
      wallet.tier = tierOf(wallet.balance);
      wallet.checkedAt = Date.now();
      localStorage.setItem(WKEY, JSON.stringify(wallet));
    } catch (e) {
      ctx.toast(`Balance check failed: ${e.message}`);
    }
    ctx.onSeason();
  }

  return {
    get stats() { return st; },
    get wallet() { return wallet; },
    // Плюшки держателя — только для кошелька, подпись которого проверил сервер (а не вписанного в localStorage).
    get tier() { return wallet && ctx.walletVerified?.(wallet.pubkey) ? wallet.tier ?? -1 : -1; },
    tierInfo: (t) => TIERS[t] || null,
    add,

    // Привязка Phantom: подпись одноразового сообщения от сервера доказывает, что кошелёк твой (проверяет сервер,
    // ctx.linkWallet). Тот же кошелёк на другом устройстве — тот же аккаунт с RP и покупками. Ключи и деньги не трогаем.
    async connect() {
      const p = window.phantom?.solana || window.solana;
      if (!p?.isPhantom) { ctx.toast('Phantom wallet not found — install it or open in a browser with Phantom'); return; }
      try {
        const { publicKey } = await p.connect();
        const pubkey = publicKey.toBase58();
        await ctx.linkWallet(p, pubkey);
        wallet = { pubkey, balance: 0, tier: -1, linkedAt: Date.now() };
        localStorage.setItem(WKEY, JSON.stringify(wallet));
        ctx.toast(TOKEN_MINT ? 'Wallet linked — checking holder perks…' : 'Wallet linked ✓ — your RP and items now follow this wallet');
        await refresh();
      } catch (e) {
        ctx.toast(`Wallet: ${e.message || 'cancelled'}`);
      }
    },
    disconnect() { wallet = null; localStorage.removeItem(WKEY); ctx.onSeason(); },
    refresh,

    // Начало раунда — счётчик раундов; конец — бонус за место.
    roundStarted() { st.rounds++; save(); ctx.onSeason(); },
    placed(place) { if (place === 2) add('top2'); else if (place === 3) add('top3'); },
  };
}
