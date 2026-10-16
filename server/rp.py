# PostRoyale — аккаунты, допуск в Ranked и RP на сервере (раньше всё лежало в localStorage и правилось из консоли).
#
# Аккаунт создаётся сам при первом заходе (гость): клиент хранит токен сессии, сервер — только его хеш
# (сессий у аккаунта сколько угодно — по одной на устройство).
# Привязка кошелька Solana (подпись сообщения с одноразовым nonce, ed25519) делает аккаунт переносимым: тем же
# кошельком на другом устройстве получаешь тот же аккаунт, RP и покупки.
#
# Допуск в Ranked — пост в X: в тексте #PostRoyale и личный код аккаунта (code), пост не старше POST_FRESH дней,
# один X-аккаунт и один пост — на один аккаунт игры. Проверка — oEmbed X с сервера. Перед каждым рейтинговым
# матчем пост перепроверяется (не чаще RECHECK с): удалён — допуск снят.
#
# RP начисляет только сервер — по событиям рейтингового матча, которые он сам пересылает (см. RankedMatch).
# Клиент RP не присылает. Лимиты: за матч (сколько вообще можно набрать) и за сутки (RP_DAILY).

import base64, hashlib, json, os, re, secrets, sqlite3, time, urllib.parse, urllib.request
from html.parser import HTMLParser

DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'postroyale.db'))
TAG = '#postroyale'
POST_FRESH = 7 * 86400          # с — пост не старше
ACCESS = 7 * 86400              # с — допуск после проверки
RECHECK = 30 * 60               # с — перепроверка поста перед матчем не чаще
RP_DAILY = int(os.environ.get('RP_DAILY', '800'))
RP = {'kill': 10, 'botkill': 3, 'chest': 1, 'survive': 2, 'top3': 15, 'top2': 25, 'win': 60}
# Магазин (цены — только здесь; клиентская копия — для витрины). gold — золотой кейс оружейных скинов.
SHOP = {'champ': 300, 'knight': 250, 'neon': 200, 'candle': 150, 'pad-gold': 120, 'pad-neon': 90, 'pad-fire': 100}
SPEND = {'gold': 60}
LEGACY = set(SHOP)              # покупки из старого localStorage переносим (только косметика, RP — нет)

# ---------- хранилище ----------

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
db = sqlite3.connect(DB_PATH, isolation_level=None, check_same_thread=False)
db.row_factory = sqlite3.Row
db.executescript('''
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, secret TEXT NOT NULL, code TEXT UNIQUE NOT NULL, wallet TEXT UNIQUE,
  rp INTEGER NOT NULL DEFAULT 0, owned TEXT NOT NULL DEFAULT '[]', pad TEXT,
  post TEXT, handle TEXT, until REAL NOT NULL DEFAULT 0, checked REAL NOT NULL DEFAULT 0,
  created REAL NOT NULL, seen REAL NOT NULL);
CREATE TABLE IF NOT EXISTS posts (sid TEXT PRIMARY KEY, account TEXT NOT NULL, handle TEXT, at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS handles (handle TEXT PRIMARY KEY, account TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY, account TEXT NOT NULL, at REAL NOT NULL, day TEXT NOT NULL,
  kind TEXT NOT NULL, amount INTEGER NOT NULL, ref TEXT);
CREATE INDEX IF NOT EXISTS ledger_day ON ledger(account, day);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account TEXT NOT NULL, at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (account TEXT PRIMARY KEY, nonce TEXT NOT NULL, at REAL NOT NULL);
''')

day = lambda: time.strftime('%Y-%m-%d', time.gmtime())
CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'     # без похожих 0/O, 1/I


def new_code():
    while True:
        c = 'PR-' + ''.join(secrets.choice(CODE_ABC) for _ in range(6))
        if not db.execute('SELECT 1 FROM accounts WHERE code=?', (c,)).fetchone(): return c


def h(s): return hashlib.sha256(s.encode()).hexdigest()


def new_session(aid):
    tok = secrets.token_urlsafe(32)
    db.execute('INSERT INTO sessions (hash, account, at) VALUES (?,?,?)', (h(tok), aid, time.time()))
    return tok


def create_account(legacy=None):
    aid = secrets.token_hex(8)
    owned = [x for x in (legacy or []) if x in LEGACY]
    now = time.time()
    db.execute('INSERT INTO accounts (id, secret, code, owned, created, seen) VALUES (?,?,?,?,?,?)',
               (aid, '', new_code(), json.dumps(owned), now, now))
    return new_session(aid)


def auth(tok):
    """Токен сессии → строка аккаунта или None."""
    if not isinstance(tok, str) or len(tok) > 100: return None
    s = db.execute('SELECT account FROM sessions WHERE hash=?', (h(tok),)).fetchone()
    row = s and db.execute('SELECT * FROM accounts WHERE id=?', (s['account'],)).fetchone()
    if not row: return None
    db.execute('UPDATE accounts SET seen=? WHERE id=?', (time.time(), row['id']))
    return row


def get(aid): return db.execute('SELECT * FROM accounts WHERE id=?', (aid,)).fetchone()


def earned_today(aid):
    return db.execute("SELECT COALESCE(SUM(amount),0) FROM ledger WHERE account=? AND day=? AND amount>0", (aid, day())).fetchone()[0]


def has_access(row): return bool(row and row['until'] > time.time())


def profile(row, tok=None):
    p = {'id': row['id'], 'code': row['code'], 'rp': row['rp'], 'owned': json.loads(row['owned']), 'pad': row['pad'],
         'wallet': row['wallet'], 'today': earned_today(row['id']), 'cap': RP_DAILY,
         'access': {'url': row['post'], 'handle': row['handle'], 'until': int(row['until'] * 1000)} if has_access(row) else None}
    if tok: p['tok'] = tok
    return p


def credit(aid, kind, ref=None):
    """Начислить RP за событие с учётом суточного лимита. → сколько начислено (0 — лимит)."""
    n = min(RP.get(kind, 0), max(0, RP_DAILY - earned_today(aid)))
    if n <= 0: return 0
    db.execute('UPDATE accounts SET rp=rp+? WHERE id=?', (n, aid))
    db.execute('INSERT INTO ledger (account, at, day, kind, amount, ref) VALUES (?,?,?,?,?,?)', (aid, time.time(), day(), kind, n, ref))
    return n

# ---------- пост в X ----------

class _Post(HTMLParser):
    """Текст первого <p> и текст последней ссылки (дата) из html oEmbed."""
    def __init__(self):
        super().__init__(); self.text = ''; self.inp = False; self.done = False; self.ina = False; self.last_a = ''; self.cur_a = ''
    def handle_starttag(self, tag, a):
        if tag == 'p' and not self.done: self.inp = True
        if tag == 'a': self.ina = True; self.cur_a = ''
    def handle_endtag(self, tag):
        if tag == 'p' and self.inp: self.inp = False; self.done = True
        if tag == 'a': self.ina = False; self.last_a = self.cur_a
    def handle_data(self, d):
        if self.inp: self.text += d
        if self.ina: self.cur_a += d


POST_RE = re.compile(r'^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d{1,25})')


def oembed(user, sid):
    """→ dict oEmbed или None (поста нет / закрыт). Исключение — X недоступен."""
    url = 'https://publish.x.com/oembed?' + urllib.parse.urlencode({'url': f'https://x.com/{user}/status/{sid}', 'omit_script': 1, 'dnt': 1})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'PostRoyale/1.0'}), timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code in (403, 404): return None
        raise


def tweet_time(sid):
    """Время поста из его id (snowflake X): миллисекунды с 2010-11-04."""
    return ((int(sid) >> 22) + 1288834974657) / 1000


def verify_post(row, url):
    """Проверить пост и выдать допуск. → (ok, сообщение)."""
    m = POST_RE.match((url or '').strip())
    if not m: return False, 'Paste a link like https://x.com/you/status/123…'
    user, sid = m.group(1), m.group(2)
    if time.time() - tweet_time(sid) > POST_FRESH: return False, 'Post is older than 7 days — make a fresh one'
    used = db.execute('SELECT account FROM posts WHERE sid=?', (sid,)).fetchone()
    if used and used['account'] != row['id']: return False, 'This post already unlocked another player'
    try: j = oembed(user, sid)
    except Exception: return False, 'X is not responding — try again in a minute'
    if not j: return False, 'Post not found — is it public?'
    p = _Post(); p.feed(j.get('html') or '')
    text = p.text.lower()
    if TAG not in text: return False, 'The post must include #PostRoyale'
    if row['code'].lower() not in text: return False, f'The post must include your code {row["code"]}'
    handle = (j.get('author_url') or '').rstrip('/').split('/')[-1].lower() or user.lower()
    owner = db.execute('SELECT account FROM handles WHERE handle=?', (handle,)).fetchone()
    if owner and owner['account'] != row['id']: return False, f'@{handle} is already linked to another player'
    now = time.time()
    db.execute('INSERT OR IGNORE INTO handles (handle, account) VALUES (?,?)', (handle, row['id']))
    db.execute('INSERT OR REPLACE INTO posts (sid, account, handle, at) VALUES (?,?,?,?)', (sid, row['id'], handle, now))
    db.execute('UPDATE accounts SET post=?, handle=?, until=?, checked=? WHERE id=?',
               (f'https://x.com/{handle}/status/{sid}', handle, now + ACCESS, now, row['id']))
    return True, 'ok'


def recheck(aid):
    """Перед рейтинговым матчем: пост ещё на месте? Удалён — допуск снят. → есть ли допуск."""
    row = get(aid)
    if not has_access(row): return False
    if time.time() - row['checked'] < RECHECK: return True
    m = POST_RE.match(row['post'] or '')
    try: j = oembed(m.group(1), m.group(2)) if m else None
    except Exception: return True                         # X недоступен — не наказываем игрока
    if not j:
        db.execute('UPDATE accounts SET until=0 WHERE id=?', (aid,))
        print(f'[rp] access revoked {aid}: post gone {row["post"]}', flush=True)
        return False
    db.execute('UPDATE accounts SET checked=? WHERE id=?', (time.time(), aid))
    return True

# ---------- кошелёк: ed25519 (RFC 8032, проверка подписи) и base58 ----------

_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _add(a, b):
    x1, y1, z1, t1 = a; x2, y2, z2, t2 = b
    A = (y1 - x1) * (y2 - x2) % _P; B = (y1 + x1) * (y2 + x2) % _P
    C = 2 * t1 * t2 * _D % _P; Dd = 2 * z1 * z2 % _P
    E, F, G, H = B - A, Dd - C, Dd + C, B + A
    return (E * F % _P, G * H % _P, F * G % _P, E * H % _P)


def _mul(s, p):
    q = (0, 1, 1, 0)
    while s:
        if s & 1: q = _add(q, p)
        p = _add(p, p); s >>= 1
    return q


def _eq(a, b):
    return (a[0] * b[2] - b[0] * a[2]) % _P == 0 and (a[1] * b[2] - b[1] * a[2]) % _P == 0


def _recover_x(y, sign):
    if y >= _P: return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P)
    if x2 == 0: return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P: x = x * _I % _P
    if (x * x - x2) % _P: return None
    if (x & 1) != sign: x = _P - x
    return x


def _decompress(s):
    if len(s) != 32: return None
    y = int.from_bytes(s, 'little'); sign = y >> 255; y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


_G = _decompress(bytes.fromhex('5866666666666666666666666666666666666666666666666666666666666666'))


def ed25519_verify(pub, msg, sig):
    if len(pub) != 32 or len(sig) != 64: return False
    A = _decompress(pub); R = _decompress(sig[:32])
    if not A or not R: return False
    s = int.from_bytes(sig[32:], 'little')
    if s >= _L: return False
    k = int.from_bytes(hashlib.sha512(sig[:32] + pub + msg).digest(), 'little') % _L
    return _eq(_mul(s, _G), _add(R, _mul(k, A)))


B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def b58decode(s):
    n = 0
    for ch in s: n = n * 58 + B58.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    return b'\0' * (len(s) - len(s.lstrip('1'))) + raw


def wallet_message(pubkey, nonce):
    return f'PostRoyale: sign in with this wallet ({pubkey}). No transaction, no fees. Nonce: {nonce}'


def wallet_nonce(row, pubkey):
    nonce = secrets.token_hex(12)
    db.execute('INSERT OR REPLACE INTO nonces (account, nonce, at) VALUES (?,?,?)', (row['id'], nonce, time.time()))
    return wallet_message(pubkey, nonce)


def wallet_link(row, pubkey, sig_b64):
    """Проверить подпись и привязать кошелёк. Кошелёк уже у другого аккаунта — переходим в него (гостевые покупки
    переносим, RP гостя тоже — они честно заработаны на сервере; сессия этого устройства теперь ведёт в аккаунт
    кошелька). → (ok, сообщение, id аккаунта)."""
    n = db.execute('SELECT nonce, at FROM nonces WHERE account=?', (row['id'],)).fetchone()
    if not n or time.time() - n['at'] > 600: return False, 'Sign-in expired — try again', None
    try:
        pub = b58decode(pubkey); sig = base64.b64decode(sig_b64)
    except Exception: return False, 'Bad wallet data', None
    if not ed25519_verify(pub, wallet_message(pubkey, n['nonce']).encode(), sig): return False, 'Signature check failed', None
    db.execute('DELETE FROM nonces WHERE account=?', (row['id'],))
    other = db.execute('SELECT * FROM accounts WHERE wallet=?', (pubkey,)).fetchone()
    if not other:
        if row['wallet'] and row['wallet'] != pubkey: return False, 'This player is linked to another wallet', None
        db.execute('UPDATE accounts SET wallet=? WHERE id=?', (pubkey, row['id']))
        return True, 'linked', None
    if other['id'] == row['id']: return True, 'linked', None
    if row['wallet']: return False, 'This player is linked to another wallet', None
    # вход на другом устройстве: гость → аккаунт кошелька (всё гостевое переносим, гостя удаляем)
    owned = sorted(set(json.loads(other['owned'])) | set(json.loads(row['owned'])))
    db.execute('UPDATE accounts SET rp=rp+?, owned=? WHERE id=?', (row['rp'], json.dumps(owned), other['id']))
    if has_access(row) and not has_access(other):
        db.execute('UPDATE accounts SET post=?, handle=?, until=?, checked=? WHERE id=?', (row['post'], row['handle'], row['until'], row['checked'], other['id']))
    for t in ('posts', 'handles', 'ledger', 'sessions'): db.execute(f'UPDATE {t} SET account=? WHERE account=?', (other['id'], row['id']))
    db.execute('DELETE FROM accounts WHERE id=?', (row['id'],))
    return True, 'signed in', other['id']

# ---------- магазин ----------

def buy(row, item):
    price = SHOP.get(item)
    if price is None: return False, 'Unknown item'
    owned = json.loads(row['owned'])
    if item in owned: return False, 'Already owned'
    if row['rp'] < price: return False, f'Need {price - row["rp"]} more RP'
    owned.append(item)
    pad = item if item.startswith('pad-') else row['pad']
    cur = db.execute('UPDATE accounts SET rp=rp-?, owned=?, pad=? WHERE id=? AND rp>=?', (price, json.dumps(owned), pad, row['id'], price))
    if cur.rowcount != 1: return False, 'Not enough RP'
    db.execute('INSERT INTO ledger (account, at, day, kind, amount, ref) VALUES (?,?,?,?,?,?)', (row['id'], time.time(), day(), 'buy', -price, item))
    return True, 'ok'


def spend(row, what):
    price = SPEND.get(what)
    if price is None: return False, 'Unknown purchase'
    cur = db.execute('UPDATE accounts SET rp=rp-? WHERE id=? AND rp>=?', (price, row['id'], price))
    if cur.rowcount != 1: return False, f'Need {price - row["rp"]} more RP'
    db.execute('INSERT INTO ledger (account, at, day, kind, amount, ref) VALUES (?,?,?,?,?,?)', (row['id'], time.time(), day(), 'spend', -price, what))
    return True, 'ok'


def set_pad(row, pad):
    if pad and pad not in json.loads(row['owned']): return False, 'Not owned'
    db.execute('UPDATE accounts SET pad=? WHERE id=?', (pad or None, row['id']))
    return True, 'ok'

# ---------- HTTP API ----------

def api(path, body):
    """POST /api/<что> с JSON → (код, JSON). Тело — text/plain (без preflight CORS)."""
    what = path.split('?')[0].rstrip('/').split('/')[-1]
    if what == 'me':
        row = auth(body.get('tok'))
        tok = None
        if not row:
            tok = create_account(body.get('legacy'))
            row = auth(tok)
        return 200, profile(row, tok)
    row = auth(body.get('tok'))
    if not row: return 401, {'error': 'Session expired — reload the page'}
    if what == 'verify': ok, msg = verify_post(row, body.get('url'))
    elif what == 'buy': ok, msg = buy(row, body.get('id'))
    elif what == 'spend': ok, msg = spend(row, body.get('what'))
    elif what == 'pad': ok, msg = set_pad(row, body.get('id'))
    elif what == 'nonce':
        pk = str(body.get('pubkey') or '')
        if not re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}', pk): return 400, {'error': 'Bad wallet'}
        return 200, {'message': wallet_nonce(row, pk)}
    elif what == 'link':
        ok, msg, aid = wallet_link(row, str(body.get('pubkey') or ''), str(body.get('sig') or ''))
        if not ok: return 400, {'error': msg}
        return 200, profile(get(aid or row['id']))
    else: return 404, {'error': 'Unknown call'}
    if not ok: return 400, {'error': msg, **profile(get(row['id']))}
    return 200, profile(get(row['id']))

# ---------- рейтинговый матч: RP по событиям, которые пересылает сервер ----------

DROP = 30            # с — высадка (royale.js DROP_MS)
ROUND = 240          # с — раунд (ROUND_MS); дожил — победа
WIN_MIN = 90         # с — раньше победа невозможна (это подделка)
CHESTS_MAX = 12      # сундуков за матч


class RankedMatch:
    """Следит за событиями рейтингового матча и начисляет RP. Игроки — по нику (ники в матче уникальны: их выдаёт сервер)."""
    def __init__(self, players, bots):
        self.t0 = time.monotonic()
        self.ref = ''                     # id матча — в журнал начислений
        self.bots = bots
        self.dead_bots = set()
        self.ended = False
        self.p = {}                       # id клиента → состояние
        for c in players:
            self.p[c.id] = {'c': c, 'acc': c.account, 'nick': c.nick, 'alive': True, 'chests': 0, 'surv': 0, 'won': False}

    def age(self): return time.monotonic() - self.t0

    def by_nick(self, n):
        for s in self.p.values():
            if s['nick'] == n: return s
        return None

    def give(self, s, kind):
        n = credit(s['acc'], kind, self.ref)
        if s['c'] and not s['c'].closed:
            s['c'].send({'t': 'rp', 'k': kind, 'n': n, 'rp': get(s['acc'])['rp'], 'today': earned_today(s['acc']), 'cap': RP_DAILY})

    def alive_count(self):
        return sum(1 for s in self.p.values() if s['alive']) + max(0, self.bots - len(self.dead_bots))

    def die(self, s):
        if not s['alive']: return
        place = self.alive_count()
        s['alive'] = False
        if self.ended: return
        if place == 2: self.give(s, 'top2')
        elif place == 3: self.give(s, 'top3')

    def on_action(self, cid, a, d, to):
        """Действие игрока cid (уже переслано остальным)."""
        s = self.p.get(cid)
        if not s or self.ended or not isinstance(d, dict): return
        if a == 'dead':
            n, by = d.get('n'), d.get('by')
            if n == s['nick']:                                       # игрок сообщает о своей смерти
                if not s['alive']: return
                k = self.by_nick(by) if isinstance(by, str) else None
                if k and k is not s and k['alive'] and k['acc'] != s['acc']: self.give(k, 'kill')
                self.die(s)
            elif isinstance(n, str) and not self.by_nick(n) and self.age() > 10:   # бот (сообщает хост ботов)
                if n in self.dead_bots or len(self.dead_bots) >= self.bots: return
                self.dead_bots.add(n)
                k = self.by_nick(by) if isinstance(by, str) else None
                if k and k['alive']: self.give(k, 'botkill')
        elif a == 'chest' and not to and s['alive']:
            lst = d.get('list')
            if isinstance(lst, list) and len(lst) == 1 and s['chests'] < CHESTS_MAX:
                s['chests'] += 1
                self.give(s, 'chest')
        elif a == 'win' and d.get('n') == s['nick']:
            others = [o for o in self.p.values() if o is not s and o['alive']]
            # все остальные (люди и боты) мертвы — смерти ботов сообщает хост, в т.ч. от шторма
            if s['alive'] and not s['won'] and not others and len(self.dead_bots) >= self.bots and self.age() >= WIN_MIN:
                s['won'] = True
                self.give(s, 'win')
                self.ended = True

    def leave(self, cid):
        s = self.p.get(cid)
        if s:
            self.die(s)
            s['c'] = None

    def tick(self):
        """Раз в секунду: выживание (каждые 60 с после высадки) и конец раунда по таймеру — дожившие побеждают."""
        if self.ended: return
        age = self.age()
        for s in self.p.values():
            if not s['alive']: continue
            want = min(3, max(0, int((age - DROP) // 60)))
            while s['surv'] < want:
                s['surv'] += 1
                self.give(s, 'survive')
        if age >= ROUND:
            for s in self.p.values():
                if s['alive'] and not s['won']: s['won'] = True; self.give(s, 'win')
            self.ended = True
