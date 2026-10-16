# PostRoyale — сервер матчмейкинга и ретранслятор матча (WebSocket). Только стандартная библиотека Python 3.10+.
#
# Очередь одна: игроки нажимают Play («Online») и попадают в общее лобби на CAP мест.
#   - сразу BOTS0 ботов (от первого в очереди), дальше +1 бот каждые STEP с, пока лобби не заполнится — тогда старт;
#   - живые игроки занимают места ботов; набралось CAP живых — старт сразу.
# После старта то же соединение становится каналом матча: сервер пересылает действия игры (pose, shot, hit, …)
# всем в матче или одному адресату. Игровую логику по-прежнему считают клиенты (ботов — хост, игрок с меньшим id).
#
# Протокол (JSON):
#   клиент → {t:'q', n:ник}            встать в очередь
#            {t:'a', a:действие, d:данные, to?:id}   действие в матче (to — только одному)
#   сервер → {t:'hi', id}               твой id
#            {t:'w', h, b, cap, s, wait}  очередь: живых h, ботов b, ждём s с, порог wait с
#            {t:'go', w, e, now, b, ids}  старт: id мира, точка отсчёта раунда e (часы сервера now), ботов b, игроки
#            {t:'j', p} / {t:'l', p}     игрок вошёл / вышел
#            {t:'a', a, d, f}            действие от игрока f
#            {t:'q', n, r:1, tok}       встать в рейтинговую очередь (нужен аккаунт с допуском — rp.py)
#   сервер → {t:'go', …, n}             в рейтинге ещё и ник, под которым тебя знает сервер (уникальный в матче)
#            {t:'rp', k, n, rp, today, cap}   начислено RP (k — за что, n — сколько, rp — баланс)
#            {t:'err', e}                в очередь не пустили (e: 'access' | 'busy')
#   GET /health → {"ok":true, "queue":…, "matches":…, "players":…}
#   POST /api/<me|verify|buy|spend|pad|nonce|link> — аккаунты и RP (rp.py)
#
# Запуск: python3 mm.py  (переменные: PORT=8770, HOST=127.0.0.1, MM_CAP=20, MM_BOTS0=13, MM_STEP=3)

import asyncio, base64, hashlib, json, os, secrets, struct, time
import rp

HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', '8770'))
CAP = int(os.environ.get('MM_CAP', '20'))         # мест в матче (люди + боты)
BOTS0 = int(os.environ.get('MM_BOTS0', '13'))     # ботов сразу
STEP = float(os.environ.get('MM_STEP', '3'))      # с — ещё по боту, пока лобби не полное
WAIT = max(0, CAP - 1 - BOTS0) * STEP             # самое долгое ожидание (один живой игрок) — для статуса
MAX_MSG = 1 << 20                                 # 1 МБ на сообщение (sync построек бывает большим)
MAX_QUEUE = 600                                   # исходящих сообщений в очереди клиента — больше, значит не успевает: отключаем
MATCH_TTL = 6 * 60                                # с — матч живёт не дольше (раунд 4 мин + итоги)
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'


class Client:
    def __init__(self, reader, writer):
        self.r, self.w = reader, writer
        self.id = secrets.token_hex(4)
        self.nick = 'Player'
        self.match = None
        self.account = None        # id аккаунта (только рейтинг)
        self.ranked = False
        self.out = asyncio.Queue()
        self.closed = False

    def send(self, obj):
        if self.closed: return
        if self.out.qsize() > MAX_QUEUE: self.close(); return
        self.out.put_nowait(json.dumps(obj, separators=(',', ':')))

    def close(self):
        if self.closed: return
        self.closed = True
        self.out.put_nowait(None)


class Lobby:
    """Открытое лобби: копит игроков и ботов, пока не наберёт CAP."""
    def __init__(self):
        self.players = []
        self.bots = 0
        self.t0 = 0.0          # когда встал первый
        self.ramp = 0.0        # сколько ботов «набежало» после порога (дробно)

    def status(self):
        s = time.monotonic() - self.t0 if self.players else 0
        return {'t': 'w', 'h': len(self.players), 'b': self.bots, 'cap': CAP, 's': round(s, 1), 'wait': WAIT}


class Match:
    def __init__(self, players, bots, ranked=False):
        self.id = 'mm-' + secrets.token_hex(3)
        self.players = {c.id: c for c in players}
        self.bots = bots
        self.born = time.monotonic()
        self.rm = None
        if ranked:
            # ники в рейтинговом матче уникальны — по ним сервер узнаёт убийцу в сообщениях игры
            taken = set()
            for c in players:
                base, n, i = c.nick, c.nick, 2
                while n in taken: n = f'{base[:13]}#{i}'; i += 1
                taken.add(n); c.nick = n
            self.rm = rp.RankedMatch(players, bots)
            self.rm.ref = self.id


# две очереди: обычная (Online) и рейтинговая
lobbies = {False: Lobby(), True: Lobby()}
matches = {}


def broadcast_lobby(lobby):
    st = lobby.status()
    for c in lobby.players: c.send(st)


def start_match(ranked):
    lobby = lobbies[ranked]
    m = Match(lobby.players, lobby.bots, ranked)
    lobbies[ranked] = Lobby()
    matches[m.id] = m
    now = int(time.time() * 1000)
    ids = list(m.players)
    world = time.strftime('ranked-%Y%m%d', time.gmtime()) if ranked else m.id
    for c in m.players.values():
        c.match = m
        c.send({'t': 'go', 'w': world, 'e': now, 'now': now, 'b': m.bots, 'ids': ids, **({'n': c.nick} if ranked else {})})
    # знакомим всех со всеми — клиент на join шлёт новичку позу, постройки, лут
    for c in m.players.values():
        for o in ids:
            if o != c.id: c.send({'t': 'j', 'p': o})
    print(f'[mm] start {m.id}{" ranked" if ranked else ""}: {len(ids)} players + {m.bots} bots', flush=True)


async def ticker():
    """10 раз в секунду: подмешать ботов, при полном лобби — старт; раз в секунду — статус очереди; чистка старых матчей."""
    last_status, last_rp = {False: 0.0, True: 0.0}, 0.0
    while True:
        await asyncio.sleep(0.1)
        now = time.monotonic()
        for mid in [k for k, m in matches.items() if not m.players or now - m.born > MATCH_TTL]:
            for c in matches[mid].players.values(): c.match = None
            if matches[mid].rm: matches[mid].rm.ended = True
            del matches[mid]
        if now - last_rp >= 1:
            last_rp = now
            for m in matches.values():
                if m.rm:
                    try: m.rm.tick()
                    except Exception as e: print('[rp] tick', e, flush=True)
        for ranked, lobby in list(lobbies.items()):
            if not lobby.players: continue
            e = now - lobby.t0
            room = CAP - len(lobby.players)
            before = lobby.bots
            want = BOTS0 + int(e / STEP)                            # сразу BOTS0, потом +1 каждые STEP с
            lobby.bots = max(0, min(room, max(lobby.bots, want)))
            if len(lobby.players) + lobby.bots >= CAP:
                broadcast_lobby(lobby)
                start_match(ranked)
                continue
            if lobby.bots != before or now - last_status[ranked] > 1:
                last_status[ranked] = now
                broadcast_lobby(lobby)


def leave(c):
    for ranked, lobby in lobbies.items():
        if c in lobby.players:
            lobby.players.remove(c)
            if not lobby.players: lobbies[ranked] = Lobby()
            else: broadcast_lobby(lobby)
    m = c.match
    if m and c.id in m.players:
        if m.rm:
            try: m.rm.leave(c.id)
            except Exception as e: print('[rp] leave', e, flush=True)
        del m.players[c.id]
        for o in m.players.values(): o.send({'t': 'l', 'p': c.id})
        if not m.players: matches.pop(m.id, None)
    c.match = None


def queued(c): return any(c in l.players for l in lobbies.values())


def join_queue(c, ranked):
    if c.closed or c.match or queued(c): return
    lobby = lobbies[ranked]
    c.ranked = ranked
    if not lobby.players: lobby.t0 = time.monotonic()
    lobby.players.append(c)
    # живой игрок занимает место бота, если лобби уже почти полное
    lobby.bots = min(lobby.bots, CAP - len(lobby.players))
    broadcast_lobby(lobby)
    if len(lobby.players) >= CAP: start_match(ranked)


async def join_ranked(c, tok):
    row = rp.auth(tok)
    if not row: c.send({'t': 'err', 'e': 'auth'}); return
    # один аккаунт — одно место в рейтинге (вторая вкладка не удвоит RP)
    busy = any(o.account == row['id'] for l in lobbies.values() for o in l.players) or \
        any(o.account == row['id'] for m in matches.values() if m.rm for o in m.players.values())
    if busy: c.send({'t': 'err', 'e': 'busy'}); return
    c.account = row['id']
    if not await asyncio.to_thread(rp.recheck, row['id']): c.send({'t': 'err', 'e': 'access'}); return
    join_queue(c, True)


def on_message(c, msg):
    t = msg.get('t')
    if t == 'q' and not c.match and not queued(c):
        c.nick = str(msg.get('n') or 'Player')[:16]
        if msg.get('r'): asyncio.create_task(join_ranked(c, msg.get('tok')))
        else: join_queue(c, False)
    elif t == 'x':
        leave(c)
    elif t == 'a' and c.match:
        a = msg.get('a')
        if not isinstance(a, str) or len(a) > 12: return
        out = {'t': 'a', 'a': a, 'd': msg.get('d'), 'f': c.id}
        to = msg.get('to')
        if to:
            o = c.match.players.get(to)
            if o: o.send(out)
        else:
            for o in c.match.players.values():
                if o is not c: o.send(out)
        if c.match.rm:
            try: c.match.rm.on_action(c.id, a, msg.get('d'), to)
            except Exception as e: print('[rp] action', e, flush=True)


# Простой лимит запросов к API с одного адреса: в минуту — 60 всего, 6 проверок поста, 3 новых аккаунта.
_hits = {}


def limited(ip, path):
    now = time.monotonic()
    kind = 'verify' if path.startswith('/api/verify') else 'me' if path.startswith('/api/me') else 'any'
    ok = True
    for k, cap in (('any', 60), (kind, {'verify': 6, 'me': 20, 'any': 60}[kind])):
        lst = [t for t in _hits.get((ip, k), []) if now - t < 60]
        if len(lst) >= cap: ok = False
        lst.append(now)
        _hits[(ip, k)] = lst
    if len(_hits) > 20000: _hits.clear()
    return ok


# ---------- WebSocket (RFC 6455) поверх asyncio ----------

async def read_frame(r):
    """Целое сообщение: (opcode, bytes). Склеивает фрагменты; ping/pong/close отдаёт как есть."""
    data, op0 = b'', None
    while True:
        h = await r.readexactly(2)
        fin, op = h[0] & 0x80, h[0] & 0x0f
        masked, n = h[1] & 0x80, h[1] & 0x7f
        if n == 126: n = struct.unpack('>H', await r.readexactly(2))[0]
        elif n == 127: n = struct.unpack('>Q', await r.readexactly(8))[0]
        if n > MAX_MSG or len(data) + n > MAX_MSG: raise ValueError('too big')
        key = await r.readexactly(4) if masked else b'\0\0\0\0'
        p = bytearray(await r.readexactly(n))
        for i in range(n): p[i] ^= key[i & 3]
        if op >= 8: return op, bytes(p)               # управляющие кадры не фрагментируются
        if op: op0 = op
        data += p
        if fin: return op0, data


def frame(payload: bytes, op=1):
    n = len(payload)
    head = bytes([0x80 | op])
    if n < 126: head += bytes([n])
    elif n < 65536: head += bytes([126]) + struct.pack('>H', n)
    else: head += bytes([127]) + struct.pack('>Q', n)
    return head + payload


async def sender(c):
    try:
        while True:
            s = await c.out.get()
            if s is None: break
            c.w.write(frame(s.encode()))
            await c.w.drain()
    except Exception: pass
    finally:
        try: c.w.write(frame(b'', 8)); c.w.close()
        except Exception: pass


async def handle(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
    except Exception:
        writer.close(); return
    lines = head.decode('latin-1').split('\r\n')
    path = lines[0].split(' ')[1] if len(lines[0].split(' ')) > 1 else '/'
    hdr = {k.strip().lower(): v.strip() for k, _, v in (l.partition(':') for l in lines[1:] if ':' in l)}
    if hdr.get('upgrade', '').lower() != 'websocket':
        method = lines[0].split(' ')[0]
        def reply(code, obj):
            body = json.dumps(obj).encode()
            writer.write(f'HTTP/1.1 {code} {"OK" if code == 200 else "Error"}\r\nContent-Type: application/json\r\n'
                         'Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\n'
                         f'Content-Length: {len(body)}\r\nConnection: close\r\n\r\n'.encode() + body)
        if path.startswith('/health'):
            q = sum(len(l.players) for l in lobbies.values())
            reply(200, {'ok': True, 'queue': q, 'bots': lobbies[False].bots, 'matches': len(matches),
                        'ranked': sum(1 for m in matches.values() if m.rm),
                        'players': sum(len(m.players) for m in matches.values()) + q})
        elif path.startswith('/api/') and method == 'OPTIONS':
            reply(200, {})
        elif path.startswith('/api/') and method == 'POST':
            ip = hdr.get('x-forwarded-for', '').split(',')[0].strip() or (writer.get_extra_info('peername') or ['?'])[0]
            try:
                n = int(hdr.get('content-length', '0'))
                if n > 16384: raise ValueError('too big')
                body = json.loads(await asyncio.wait_for(reader.readexactly(n), 10) or b'{}')
                if not isinstance(body, dict): raise ValueError('bad body')
                if not limited(ip, path): reply(429, {'error': 'Too many requests — wait a minute'})
                else: reply(*await asyncio.to_thread(rp.api, path, body))
            except Exception as e:
                print('[api]', path, repr(e), flush=True)
                reply(400, {'error': 'Bad request'})
        else:
            writer.write(b'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        await writer.drain(); writer.close(); return
    acc = base64.b64encode(hashlib.sha1((hdr.get('sec-websocket-key', '') + GUID).encode()).digest()).decode()
    writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                  f'Sec-WebSocket-Accept: {acc}\r\n\r\n').encode())
    await writer.drain()
    c = Client(reader, writer)
    task = asyncio.create_task(sender(c))
    c.send({'t': 'hi', 'id': c.id})
    try:
        while not c.closed:
            op, data = await asyncio.wait_for(read_frame(reader), 60)   # клиент шлёт позу хотя бы раз в 1.5 с
            if op == 8: break
            if op == 9: writer.write(frame(data, 10)); continue
            if op != 1: continue
            try: msg = json.loads(data)
            except ValueError: continue
            if isinstance(msg, dict): on_message(c, msg)
    except Exception: pass
    finally:
        leave(c)
        c.close()
        await task


async def main():
    srv = await asyncio.start_server(handle, HOST, PORT)
    asyncio.create_task(ticker())
    print(f'[mm] ws://{HOST}:{PORT}  wait={WAIT}s cap={CAP}', flush=True)
    async with srv: await srv.serve_forever()


if __name__ == '__main__':
    asyncio.run(main())
