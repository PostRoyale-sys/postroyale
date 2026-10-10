// Online-матчи через сервер (server/mm.py): очередь с подмешиванием ботов, затем то же соединение — канал матча.
// Снаружи канал выглядит как net.js (pose, shot, hit, … — всем или одному игроку), поэтому остальная игра
// не знает, P2P у неё или сервер.
//
// Адрес сервера: ?mm=<ws-адрес> → он; локальная разработка (127.0.0.1/localhost) → ws://127.0.0.1:8770; иначе — MM_URLS
// по очереди (не открылся первый — пробуем следующий).

// sslip.io — наш VPS напрямую (работает всегда); mm.postroyale.xyz — когда в DNS будет A-запись mm → 193.233.233.118
const MM_URLS = ['wss://postroyale-mm.193-233-233-118.sslip.io', 'wss://mm.postroyale.xyz'];
const ACTIONS = ['pose', 'edit', 'sync', 'chat', 'shot', 'hit', 'dead', 'chest', 'loot', 'take', 'win', 'bots', 'bothit', 'abil', 'match', 'duel'];

export function mmUrls() {
  const q = new URLSearchParams(location.search).get('mm');
  if (q) return [q];
  if (/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname)) return ['ws://127.0.0.1:8770'];
  return MM_URLS;
}

// Встать в очередь. on.status({ h, b, cap, s, wait }) — состояние лобби; on.go(match) — матч найден;
// on.fail(reason) — сервер недоступен или соединение оборвалось до старта. Возвращает { cancel }.
export function findMatch(nick, on) {
  let ws, self = null, done = false, ping = 0, opened = false;
  const urls = mmUrls();
  const buffer = [];                       // события матча, пришедшие до подключения игры (connectServer)
  let sink = null;
  const send = (o) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };
  function open(i) {
    try { ws = new WebSocket(urls[i]); } catch (e) { if (i + 1 < urls.length) open(i + 1); else setTimeout(() => on.fail?.('offline'), 0); return; }
    const sock = ws;
    setTimeout(() => { if (!opened && sock.readyState === 0) sock.close(); }, 4000);   // повис на подключении — дальше
    ws.onopen = () => { opened = true; send({ t: 'q', n: nick }); ping = setInterval(() => send({ t: 'p' }), 15e3); };
    ws.onmessage = onMessage;
    ws.onclose = () => {
      clearInterval(ping);
      if (!opened && !done && i + 1 < urls.length) { open(i + 1); return; }   // этот адрес не открылся — следующий
      if (!done) on.fail?.(self ? 'closed' : 'offline'); else sink?.({ t: 'closed' });
    };
  }
  function onMessage(ev) {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'hi') self = m.id;
    else if (m.t === 'w') on.status?.(m);
    else if (m.t === 'go') {
      done = true;
      const offset = Date.now() - m.now;                     // часы сервера → наши (задержку сети не учитываем)
      on.go?.({ w: m.w, epoch: m.e + offset, bots: m.b, ids: m.ids, self,
        // подключить игру к каналу матча: события, пришедшие раньше, отдадим сразу после
        connect: (handlers) => connectServer(handlers) });
    } else if (done) (sink ? sink(m) : buffer.push(m));
  }
  open(0);

  function connectServer(on2) {
    const api = { selfId: self, leave: () => ws?.close() };
    for (const name of ACTIONS) api[name] = (d, target) => send(target ? { t: 'a', a: name, d, to: target } : { t: 'a', a: name, d });
    sink = (m) => {
      if (m.t === 'j') on2.join?.(m.p);
      else if (m.t === 'l') on2.leave?.(m.p);
      else if (m.t === 'a') on2[m.a]?.(m.f, m.d);
      else if (m.t === 'closed') on2.closed?.();
    };
    setTimeout(() => { for (const m of buffer.splice(0)) sink(m); }, 0);   // после того как игра закончит старт раунда
    return api;
  }

  return { cancel() { done = true; clearInterval(ping); try { send({ t: 'x' }); ws?.close(); } catch (e) { /* уже закрыт */ } } };
}
