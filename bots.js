// Боты: несколько противников в каждом матче. Ими управляет один игрок — «хост» (у кого меньше сетевой id;
// оффлайн — ты сам): он считает движение, стрельбу и урон и рассылает позиции ботов всем (действие bots).
// Остальные видят ботов как обычных игроков (в others под ключом bot:N); их попадания по ботам уходят хосту
// (bothit). Если хост вышел, ботов подхватывает следующий — с последних известных позиций.
//
// Поведение: высадка планированием внутри зоны → бродят по точкам внутри безопасного круга, уходят от шторма,
// перепрыгивают препятствия → замечают живого игрока или другого бота в SIGHT м без стен между ними и стреляют
// (точность падает с расстоянием) → погибая, роняют оружие и патроны.

import * as THREE from 'three';
import { WEAPONS } from './combat.js';
import { SKINS } from './skins.js';

const COUNT = 5, SIGHT = 50, SPEED = 4.6, GRAVITY = 30, JUMP = 9;

// Ники ботов — случайные из крипто-дегенского сленга (свои приколы — сюда).
const NICK_A = ['Ape', 'Rug', 'Moon', 'Gas', 'Pump', 'Dump', 'Wagmi', 'Ngmi', 'Fomo', 'Rekt', 'Shill', 'Bag', 'Diamond', 'Paper', 'Degen', 'Whale', 'Shrimp', 'Lambo', 'Hodl', 'Copium', 'Alpha', 'Exit', 'Floor', 'Mint', 'Airdrop'];
const NICK_B = ['Lord', 'Goblin', 'Chad', 'Boi', 'Wizard', 'Maxi', 'Holder', 'Hunter', 'Farmer', 'Sniper', 'Andy', 'King', 'Gremlin', 'Ninja', 'Pilled', 'Enjoyer', 'Liquidated', 'Dev', 'Jeet', 'Ser'];
function degenNick(taken) {
  for (let i = 0; i < 20; i++) {
    const a = NICK_A[Math.floor(Math.random() * NICK_A.length)], b = NICK_B[Math.floor(Math.random() * NICK_B.length)];
    const style = Math.random();
    const n = style < 0.35 ? `${a}${b}` : style < 0.6 ? `${a}_${b}` : style < 0.8 ? `${a}${b}${Math.floor(Math.random() * 99) + 1}` : `0x${a}${b}`.slice(0, 14);
    if (!taken.has(n) && n.length <= 16) { taken.add(n); return n; }
  }
  return `Degen${Math.floor(Math.random() * 9000) + 1000}`;
}
const GUNS = ['pistol', 'smg', 'ar', 'shotgun'];

export function createBots(ctx) {
  const bots = new Map();             // id → состояние (только у хоста)
  let round = -1, sendT = 0, thinkT = 0, clock = 0;   // clock — игровое время ботов (для интервалов стрельбы)

  const key = (id) => `bot:${id}`;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Точка внутри безопасной зоны, на суше.
  function zonePoint(scale = 0.8) {
    const w = ctx.world(), c = ctx.royale().center, r = ctx.royale().safeRadius() * scale;
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (w.height(x, z) > 2.5) return { x, z };
    }
    return { x: c.x, z: c.z };
  }

  function spawnAll() {
    bots.clear();
    const skins = SKINS.filter((s) => !s.holder && !s.shop);
    const taken = new Set([ctx.me().nick]);
    for (let i = 0; i < COUNT; i++) {
      const p = zonePoint(0.7);
      const gun = GUNS[Math.floor(Math.random() * GUNS.length)];
      bots.set(i, {
        id: i, name: degenNick(taken), skin: skins[Math.floor(Math.random() * skins.length)].id,
        pos: new THREE.Vector3(p.x, ctx.world().height(p.x, p.z) + rnd(45, 70), p.z), vy: 0, onGround: false, gliding: true,
        hp: 100, alive: true, gun, rarity: Math.floor(rnd(0, 3)), yaw: 0,
        way: null, stuckT: 0, lastPos: new THREE.Vector3(), nextShot: clock + rnd(2, 4), target: null,
      });
    }
  }

  // Подхват ботов новым хостом — с последних известных позиций.
  function adoptFromOthers() {
    bots.clear();
    for (const [k, o] of ctx.others) {
      if (!k.startsWith('bot:') || o.target?.rr !== round) continue;
      const d = o.target;
      bots.set(+k.slice(4), { id: +k.slice(4), name: d.n, skin: d.k || 'default', pos: new THREE.Vector3(d.x, d.y, d.z), vy: 0, onGround: false, gliding: false,
        hp: 100, alive: d.a !== false, gun: d.g || 'pistol', rarity: d.q || 0, yaw: d.r || 0, way: null, stuckT: 0, lastPos: new THREE.Vector3(), nextShot: clock + 2, target: null });
    }
  }

  // ---------- Движение ----------

  function move(b, dt) {
    const st = ctx.structures(), w = ctx.world();
    const rs = ctx.royale();
    // от шторма — к центру; иначе — по своим точкам внутри круга
    const c = rs.center, outside = Math.hypot(b.pos.x - c.x, b.pos.z - c.z) > rs.safeRadius() * 0.95;
    if (!b.way || outside || Math.hypot(b.way.x - b.pos.x, b.way.z - b.pos.z) < 2) b.way = outside ? { x: c.x, z: c.z } : zonePoint();
    let dx = b.way.x - b.pos.x, dz = b.way.z - b.pos.z;
    // в бою — держим дистанцию: подходим до 18 м и кружим
    if (b.target) {
      const tx = b.target.x - b.pos.x, tz = b.target.z - b.pos.z, td = Math.hypot(tx, tz);
      if (td > 18) { dx = tx; dz = tz; } else { dx = -tz; dz = tx; }
    }
    const len = Math.hypot(dx, dz) || 1;
    const sp = (b.gliding ? 8 : SPEED) * dt;
    const nx = b.pos.x + (dx / len) * sp, nz = b.pos.z + (dz / len) * sp;
    if (!st.blocked(nx, b.pos.y, b.pos.z)) b.pos.x = nx;
    else if (b.onGround) { b.vy = JUMP; b.onGround = false; }
    if (!st.blocked(b.pos.x, b.pos.y, nz)) b.pos.z = nz;
    else if (b.onGround) { b.vy = JUMP; b.onGround = false; }
    if (!b.target) b.yaw = Math.atan2(-dx, -dz);
    // гравитация и опора
    b.vy = Math.max(b.vy - GRAVITY * dt, b.gliding ? -9 : -45);
    let ny = b.pos.y + b.vy * dt;
    const g = st.ground(b.pos.x, b.pos.z, Math.max(b.pos.y, ny));
    if (ny <= g || (b.onGround && b.vy <= 0 && b.pos.y - g < 0.6)) { ny = g; b.vy = 0; b.onGround = true; b.gliding = false; } else b.onGround = false;
    b.pos.y = ny;
    if (b.pos.y < 0) b.way = null;                     // в воде — искать сушу
    // застрял — новая точка
    b.stuckT += dt;
    if (b.stuckT > 3) { if (b.pos.distanceTo(b.lastPos) < 1) b.way = zonePoint(); b.lastPos.copy(b.pos); b.stuckT = 0; }
    void w;
  }

  // ---------- Бой ----------

  // Живые игроки-люди: я и другие (не боты, не в вертолёте, не наблюдатели).
  function humans() {
    const list = [];
    const me = ctx.me();
    if (me.alive && !me.riding) list.push({ id: null, name: me.nick, pos: me.feet });
    for (const [k, o] of ctx.others) {
      if (k.startsWith('bot:') || o.target?.a === false || o.target?.rd || o.target?.rr !== round) continue;
      list.push({ id: k, name: o.name, pos: o.group.position });
    }
    return list;
  }

  // Цели бота: живые игроки и другие живые боты (кроме себя) — ближайшая видимая.
  function targetsFor(b) {
    const list = humans();
    for (const o of bots.values()) if (o !== b && o.alive && !o.gliding) list.push({ id: key(o.id), name: o.name, pos: o.pos, bot: o });
    return list;
  }

  function think(b) {
    const st = ctx.structures();
    const eye = b.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    let best = null, bd = SIGHT;
    for (const h of targetsFor(b)) {
      const to = h.pos.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(eye);
      const d = to.length();
      if (d > bd) continue;
      const hit = st.raycast(eye, to.clone().normalize(), d);
      if (hit && hit.t < d - 0.5) continue;           // стена/дерево/холм на пути
      bd = d; best = h;
    }
    b.target = best ? best.pos.clone() : null;
    b.victim = best;
  }

  function shoot(b, now) {
    const h = b.victim;
    if (!h || now < b.nextShot) return;
    if (h.bot && !h.bot.alive) { b.victim = b.target = null; return; }
    const spec = WEAPONS[b.gun];
    b.nextShot = now + Math.max(0.3, spec.rate * 2.4) + Math.random() * 0.45;
    const eye = b.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const aim = h.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
    const d = eye.distanceTo(aim);
    b.yaw = Math.atan2(-(aim.x - eye.x), -(aim.z - eye.z));
    // меткие: вблизи почти не мажут, издалека — примерно каждый третий; друг по другу — ещё злее
    const chance = Math.min(0.95, Math.max(0.3, 0.85 - d / 110) + (h.bot ? 0.1 : 0));
    const hit = Math.random() < chance;
    const end = hit ? aim : aim.clone().add(new THREE.Vector3(rnd(-2, 2), rnd(-1, 1.5), rnd(-2, 2)));
    const shot = { w: b.gun, o: eye.toArray().map((v) => +v.toFixed(2)), e: [end.toArray().map((v) => +v.toFixed(2))] };
    ctx.combat().onShot('bot', shot);                 // трассер и звук у себя
    ctx.net()?.shot(shot);                            // и у всех
    if (!hit) return;
    const dmg = Math.round((spec.pellets > 1 ? spec.dmg * 4 : spec.dmg) * (h.bot ? 1.1 : 0.85));
    if (h.id === null) ctx.combat().takeDamage(dmg, b.name, b.gun);
    else if (h.bot) damage(h.bot.id, { dmg, by: b.name, w: b.gun });     // бот по боту — считаем здесь же
    else ctx.net()?.hit({ dmg, by: b.name, w: b.gun }, h.id);
  }

  // Урон боту (у хоста): смерть — лента убийств, лут, очки убийце.
  function damage(id, d) {
    const b = bots.get(id);
    if (!b || !b.alive) return;
    b.hp -= d.dmg;
    if (b.hp > 0) return;
    b.alive = false;
    ctx.killfeed(d.by, b.name, d.w);
    ctx.net()?.dead({ n: b.name, by: d.by, w: d.w });
    ctx.onBotKilled(d.by);
    const spec = WEAPONS[b.gun];
    ctx.loot().drop(b.pos.clone(), [{ k: 'weapon', w: b.gun, r: b.rarity, a: spec.mag }, { k: 'ammo', w: spec.ammo, a: spec.ammo === 'shells' ? 10 : 30 }]);
    publish();
  }

  // Позиции ботов — себе в others и всем по сети.
  function poseOf(b) {
    const d = { x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2), r: +b.yaw.toFixed(2), n: b.name, a: b.alive, rr: round, k: b.skin, g: b.gun, q: b.rarity };
    if (b.gliding) d.st = 'g'; else if (!b.onGround) d.st = 'a';
    return d;
  }
  function publish() {
    const list = [];
    for (const b of bots.values()) { const d = poseOf(b); list.push([b.id, d]); ctx.upsert(key(b.id), d); }
    ctx.net()?.bots({ l: list });
  }

  let wasHost = false;
  return {
    get list() { return bots; },
    // Новый раунд: у хоста — свежие боты; у остальных — убрать старых.
    roundStart(r) {
      round = r;
      ctx.removeBots();
      if (ctx.isHost()) spawnAll();
    },
    // Попадание по боту: хост применяет, остальные шлют хосту.
    hit(k, d) {
      const id = +k.slice(4);
      if (ctx.isHost()) damage(id, d);
      else ctx.net()?.bothit({ id, ...d }, ctx.hostId());
    },
    onBotHit(peerId, d) { if (ctx.isHost()) damage(d.id, d); },
    // Позиции ботов от хоста.
    onBots(peerId, d) {
      if (ctx.isHost()) return;
      for (const [id, pose] of d.l || []) if (pose.rr === round) ctx.upsert(key(id), pose);
    },
    update(dt) {
      const host = ctx.isHost();
      if (host && !wasHost && round >= 0 && !bots.size) adoptFromOthers();   // хост сменился — подхватываем
      if (!host && wasHost) bots.clear();                                       // хостом стал другой — его боты главнее
      wasHost = host;
      if (!host || round < 0 || ctx.royale().ended) return;
      clock += dt;
      const now = clock;
      thinkT -= dt;
      const doThink = thinkT <= 0;
      if (doThink) thinkT = 0.25;
      for (const b of bots.values()) {
        if (!b.alive) continue;
        move(b, dt);
        if (doThink && !b.gliding) think(b);
        if (!b.gliding) shoot(b, now);
      }
      sendT -= dt;
      if (sendT <= 0) { sendT = 0.1; publish(); }
      else for (const b of bots.values()) ctx.upsert(key(b.id), poseOf(b));
    },
  };
}
