# PostRoyale — сервер матчмейкинга и ретранслятор матча (WebSocket). Только стандартная библиотека Python 3.10+.
#
# Очередь одна: игроки нажимают Play («Online») и попадают в общее лобби на CAP мест.
#   - первые WAIT с ожидания (от первого в очереди) — боты подмешиваются понемногу: +1 каждые WAIT/6 с;
#   - после WAIT — добиваем ботами до полного лобби по нарастающей (всё быстрее) и запускаем матч;
#   - набралось CAP живых игроков — старт сразу.
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
#   GET /health → {"ok":true, "queue":…, "matches":…, "players":…}
#
# Запуск: python3 mm.py  (переменные: PORT=8770, HOST=127.0.0.1, MM_WAIT=60, MM_CAP=20)

import asyncio, base64, hashlib, json, os, secrets, struct, time

HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', '8770'))
WAIT = float(os.environ.get('MM_WAIT', '60'))     # с — после этого добиваем ботами
CAP = int(os.environ.get('MM_CAP', '20'))         # мест в матче (люди + боты)
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
    def __init__(self, players, bots):
        self.id = 'mm-' + secrets.token_hex(3)
        self.players = {c.id: c for c in players}
        self.bots = bots
        self.born = time.monotonic()


lobby = Lobby()
matches = {}


def broadcast_lobby():
    st = lobby.status()
    for c in lobby.players: c.send(st)


def start_match():
    global lobby
    m = Match(lobby.players, lobby.bots)
    lobby = Lobby()
    matches[m.id] = m
    now = int(time.time() * 1000)
    ids = list(m.players)
    for c in m.players.values():
        c.match = m
        c.send({'t': 'go', 'w': m.id, 'e': now, 'now': now, 'b': m.bots, 'ids': ids})
    # знакомим всех со всеми — клиент на join шлёт новичку позу, постройки, лут
    for c in m.players.values():
        for o in ids:
            if o != c.id: c.send({'t': 'j', 'p': o})
    print(f'[mm] start {m.id}: {len(ids)} players + {m.bots} bots', flush=True)


async def ticker():
    """10 раз в секунду: подмешать ботов, при полном лобби — старт; раз в секунду — статус очереди; чистка старых матчей."""
    last_status = 0.0
    while True:
        await asyncio.sleep(0.1)
        now = time.monotonic()
        for mid in [k for k, m in matches.items() if not m.players or now - m.born > MATCH_TTL]:
            for c in matches[mid].players.values(): c.match = None
            del matches[mid]
        if not lobby.players: continue
        e = now - lobby.t0
        room = CAP - len(lobby.players)
        before = lobby.bots
        if e < WAIT:
            want = int(e / (WAIT / 6))                          # до порога — по одному боту каждые WAIT/6
        else:
            x = e - WAIT                                         # после — всё быстрее: 6 + 0.6x + 0.25x²
            want = int(6 + 0.6 * x + 0.25 * x * x)
        lobby.bots = max(0, min(room, max(lobby.bots, want)))
        if len(lobby.players) + lobby.bots >= CAP:
            broadcast_lobby()
            start_match()
            continue
        if lobby.bots != before or now - last_status > 1:
            last_status = now
            broadcast_lobby()


def leave(c):
    global lobby
    if c in lobby.players:
        lobby.players.remove(c)
        if not lobby.players: lobby = Lobby()
        else: broadcast_lobby()
    m = c.match
    if m and c.id in m.players:
        del m.players[c.id]
        for o in m.players.values(): o.send({'t': 'l', 'p': c.id})
        if not m.players: matches.pop(m.id, None)
    c.match = None


def on_message(c, msg):
    t = msg.get('t')
    if t == 'q' and not c.match and c not in lobby.players:
        c.nick = str(msg.get('n') or 'Player')[:16]
        if not lobby.players: lobby.t0 = time.monotonic()
        lobby.players.append(c)
        # живой игрок занимает место бота, если лобби уже почти полное
        lobby.bots = min(lobby.bots, CAP - len(lobby.players))
        broadcast_lobby()
        if len(lobby.players) >= CAP: start_match()
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
        if path.startswith('/health'):
            body = json.dumps({'ok': True, 'queue': len(lobby.players), 'bots': lobby.bots, 'matches': len(matches),
                               'players': sum(len(m.players) for m in matches.values()) + len(lobby.players)}).encode()
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: '
                         + str(len(body)).encode() + b'\r\nConnection: close\r\n\r\n' + body)
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
