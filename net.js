// Сеть: P2P между браузерами игроков (WebRTC) через Trystero. Знакомство — через публичные Nostr-реле,
// сервера и аккаунтов нет. Комната = id матча, поэтому все, кто открыл одну ссылку, оказываются вместе.
//
// Действия (имена короткие — у Trystero лимит на длину):
//   pose — где игрок, куда смотрит и что в руках (≈10 раз в секунду);
//   edit — постройка: поставил деталь { a: 1, … } или нанёс урон { k, x } (structures.js);
//   sync — новичку при входе: отличия построек и объектов от сгенерированной карты;
//   chat — сообщение в чат;
//   shot — выстрел (для трассера/ракеты и звука у всех);
//   hit  — попадание по конкретному игроку (шлём только ему);
//   dead — игрок погиб (лента убийств у всех);
//   chest — сундук открыт (индекс, время); loot — предметы на земле; take — предмет подобрали;
//   win — последний живой в раунде (баннер у всех);
//   bots — позиции ботов от хоста; bothit — попадание по боту (хосту);
//   abil — способность, видимая всем (дым, граната);
//   match — точка отсчёта Casual-матча (кто начал раньше — по тому и идёт раунд);
//   duel — дуэль 1v1: хост объявляет начало боя { go: время } — у обоих отсчёт 3-2-1 и бой.

import { joinRoom, selfId } from 'trystero';

const APP_ID = 'postroyale-v1';     // PostRoyale: раунды и шторм — со старыми клиентами PostCraft не смешиваемся
const ACTIONS = ['pose', 'edit', 'sync', 'chat', 'shot', 'hit', 'dead', 'chest', 'loot', 'take', 'win', 'bots', 'bothit', 'abil', 'match', 'duel'];

export function connect(worldId, on) {
  const room = joinRoom({ appId: APP_ID }, worldId);
  room.onPeerJoin = (peerId) => on.join?.(peerId);
  room.onPeerLeave = (peerId) => on.leave?.(peerId);

  const api = { selfId, leave: () => room.leave() };
  for (const name of ACTIONS) {
    const a = room.makeAction(name);
    a.onMessage = (d, { peerId }) => on[name]?.(peerId, d);
    // api.pose(d) — всем; api.pose(d, peerId) — одному игроку.
    api[name] = (d, target) => a.send(d, target ? { target } : undefined);
  }
  return api;
}
