// Сеть: P2P между браузерами игроков (WebRTC) через Trystero. Знакомство — через публичные Nostr-реле,
// сервера и аккаунтов нет. Комната = id мира, поэтому все, кто открыл одну ссылку, оказываются вместе.
//
// Действия (имена короткие — у Trystero лимит на длину):
//   pose — где игрок и куда смотрит (≈10 раз в секунду);
//   edit — сломал/поставил блок;
//   sync — все правки мира целиком (отправляем новичку при входе);
//   chat — сообщение в чат.

import { joinRoom, selfId } from 'trystero';

const APP_ID = 'postcraft-v1';

export function connect(worldId, on) {
  const room = joinRoom({ appId: APP_ID }, worldId);
  const pose = room.makeAction('pose');
  const edit = room.makeAction('edit');
  const sync = room.makeAction('sync');
  const chat = room.makeAction('chat');

  room.onPeerJoin = (peerId) => on.join?.(peerId);
  room.onPeerLeave = (peerId) => on.leave?.(peerId);
  pose.onMessage = (d, { peerId }) => on.pose?.(peerId, d);
  edit.onMessage = (d, { peerId }) => on.edit?.(peerId, d);
  sync.onMessage = (d, { peerId }) => on.sync?.(peerId, d);
  chat.onMessage = (d, { peerId }) => on.chat?.(peerId, d);

  return {
    selfId,
    pose: (d, target) => pose.send(d, target ? { target } : undefined),
    edit: (d) => edit.send(d),
    sync: (d, target) => sync.send(d, { target }),
    chat: (d) => chat.send(d),
    leave: () => room.leave(),
  };
}
