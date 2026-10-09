// Боты: несколько противников в каждом матче. Ими управляет один игрок — «хост» (у кого меньше сетевой id;
// оффлайн — ты сам): он считает движение, стрельбу и урон и рассылает позиции ботов всем (действие bots).
// Остальные видят ботов как обычных игроков (в others под ключом bot:N); их попадания по ботам уходят хосту
// (bothit). Если хост вышел, ботов подхватывает следующий — с последних известных позиций.
//
// Поведение (как у людей): общий вертолёт раунда и прыжок над зоной прыжка → приземлились без оружия — к ближайшему
// сундуку, открыть и взять оружие (пока без оружия — кирка вблизи) → бродят по точкам внутри безопасного круга, уходят от шторма,
// перепрыгивают препятствия → замечают живого игрока или другого бота (дальность и меткость — от skill) без стен между ними и стреляют
// (точность падает с расстоянием) → погибая, роняют оружие и патроны.

import * as THREE from 'three';
import { WEAPONS } from './combat.js';
import { SKINS } from './skins.js';

const COUNT = 20, SPEED = 4.6, GRAVITY = 30, JUMP = 9;

// Сложность (skill 0…1) у каждого бота своя. Casual — разброс 0.3…0.7 (кто-то слабее, кто-то сильнее);
// Ranked — 0.75…0.95. Без читов: только прямая видимость (не сквозь стены и дым), точность падает
// с расстоянием и не выше ~90%, после обнаружения цели — задержка реакции.
const SKILL = { casual: [0.3, 0.7], ranked: [0.75, 0.95] };
const sightOf = (k) => 35 + 25 * k;                       // 42…53 м в Casual, 54…59 в Ranked
const reactOf = (k) => 1.25 - k;                          // задержка первого выстрела, с
const chanceOf = (k, d) => Math.min(0.9, Math.max(0.08 + 0.25 * k, 0.35 + 0.55 * k - d * (1.1 - k) / 90));

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
const MELEE = { dmg: 20, rate: 0.7, reach: 2.4 };     // кирка, пока нет оружия

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

  // Как люди: все боты садятся в общий вертолёт раунда и прыгают в случайный момент над зоной прыжка,
  // приземляются без оружия и идут лутать сундуки.
  function spawnAll() {
    bots.clear();
    const skins = SKINS.filter((s) => !s.holder && !s.shop);
    const taken = new Set([ctx.me().nick]);
    const r = ctx.route();
    for (let i = 0; i < COUNT; i++) {
      const jumpD = r.w0 + rnd(0.1, 0.9) * (r.w1 - r.w0);
      const [lo, hi] = ctx.isRanked?.() ? SKILL.ranked : SKILL.casual;
      bots.set(i, {
        skill: rnd(lo, hi),
        id: i, name: degenNick(taken), skin: skins[Math.floor(Math.random() * skins.length)].id,
        pos: r.at(0), vy: 0, onGround: false, gliding: false, riding: true, jumpAt: r.t0 + jumpD / r.speed,
        hp: 100, alive: true, gun: null, rarity: 0, yaw: 0, chest: null, nextMelee: 0,
        way: null, stuckT: 0, lastPos: new THREE.Vector3(), nextShot: clock + rnd(2, 4), target: null,
      });
    }
  }

  // Ближайший неоткрытый сундук, за которым не идёт другой бот.
  function pickChest(b) {
    const loot = ctx.loot();
    let best = null, bd = 150;
    for (const c of loot.chests) {
      if (loot.isOpen(c)) continue;
      if ([...bots.values()].some((o) => o !== b && o.alive && o.chest === c)) continue;
      const d = Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // Лут: дошёл до сундука — открыть и взять выпавшее оружие (или любое оружие, лежащее рядом).
  function lootStep(b) {
    const loot = ctx.loot();
    // оружие на земле рядом (выпало из убитых) — забрать, если ближе сундука
    let near = null, nd = 45;
    for (const it of loot.items.values()) {
      if (it.k !== 'weapon') continue;
      const d = Math.hypot(it.pos.x - b.pos.x, it.pos.z - b.pos.z);
      if (d < nd) { nd = d; near = it; }
    }
    if (near && (!b.chest || nd < b.chest.pos.distanceTo(b.pos))) {
      if (nd < 2) { const got = loot.takeItem(near.id); if (got) { b.gun = got.w; b.rarity = got.r || 0; b.chest = null; b.way = null; return false; } }
      b.way = { x: near.pos.x, z: near.pos.z };
      return true;
    }
    if (!b.chest || (loot.isOpen(b.chest) && b.chest.pos.distanceTo(b.pos) > 6)) b.chest = pickChest(b);
    if (!b.chest) return false;
    if (Math.hypot(b.chest.pos.x - b.pos.x, b.chest.pos.z - b.pos.z) > 2.2) { b.way = { x: b.chest.pos.x, z: b.chest.pos.z }; return true; }
    if (!loot.isOpen(b.chest)) loot.open(b.chest);
    for (const it of loot.items.values()) {
      if (it.k !== 'weapon' || it.pos.distanceTo(b.pos) > 4.5) continue;
      const got = loot.takeItem(it.id);
      if (got) { b.gun = got.w; b.rarity = got.r || 0; b.chest = null; b.way = null; return false; }
    }
    b.chest = pickChest(b);
    return true;
  }

  // Подхват ботов новым хостом — с последних известных позиций.
  function adoptFromOthers() {
    bots.clear();
    for (const [k, o] of ctx.others) {
      if (!k.startsWith('bot:') || o.target?.rr !== round) continue;
      const d = o.target;
      bots.set(+k.slice(4), { id: +k.slice(4), name: d.n, skin: d.k || 'default', pos: new THREE.Vector3(d.x, d.y, d.z), vy: 0, onGround: false, gliding: false,
        skill: ctx.isRanked?.() ? 0.85 : 0.5,
        hp: 100, alive: d.a !== false, gun: d.g && d.g !== 'pickaxe' ? d.g : null, rarity: d.q || 0, yaw: d.r || 0, riding: false, chest: null, nextMelee: 0, way: null, stuckT: 0, lastPos: new THREE.Vector3(), nextShot: clock + 2, target: null });
    }
  }

  // ---------- Движение ----------

  function move(b, dt) {
    const st = ctx.structures(), w = ctx.world();
    const rs = ctx.royale();
    // от шторма — к центру; иначе — по своим точкам внутри круга
    const c = rs.center, outside = Math.hypot(b.pos.x - c.x, b.pos.z - c.z) > rs.safeRadius() * 0.95;
    const looting = !outside && !b.gun && !b.gliding && lootStep(b);
    if (!looting && (!b.way || outside || Math.hypot(b.way.x - b.pos.x, b.way.z - b.pos.z) < 2)) b.way = outside ? { x: c.x, z: c.z } : zonePoint();
    let dx = b.way.x - b.pos.x, dz = b.way.z - b.pos.z;
    if (b.target) {
      const tx = b.target.x - b.pos.x, tz = b.target.z - b.pos.z, td = Math.hypot(tx, tz);
      if (!b.gun) { dx = tx; dz = tz; }                       // с киркой — вплотную
      else if (td > 18) { dx = tx; dz = tz; } else { dx = -tz; dz = tx; }   // с оружием — держим дистанцию и кружим
    }
    const len = Math.hypot(dx, dz) || 1;
    const sp = (b.gliding ? 8 : SPEED * (0.9 + 0.25 * b.skill)) * dt;
    // сильные боты в бою подпрыгивают, сбивая прицел
    if (b.target && b.gun && b.onGround && b.skill > 0.65 && Math.random() < dt * 0.6 * b.skill) { b.vy = JUMP; b.onGround = false; }
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
  // Боты меж собой — как люди, которые сначала лутаются: без оружия друг друга не трогают,
  // с оружием стреляют по ботам только на ближней дистанции (по игрокам — на всю дальность).
  function targetsFor(b) {
    const list = humans();
    if (!b.gun) return list;
    for (const o of bots.values()) {
      if (o === b || !o.alive || o.gliding || o.riding) continue;
      if (o.pos.distanceTo(b.pos) > sightOf(b.skill) * 0.55) continue;
      list.push({ id: key(o.id), name: o.name, pos: o.pos, bot: o });
    }
    return list;
  }

  function think(b) {
    const st = ctx.structures();
    const eye = b.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    let best = null, bd = b.gun ? sightOf(b.skill) : 9;    // без оружия ввязываются только вблизи
    for (const h of targetsFor(b)) {
      const to = h.pos.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(eye);
      const d = to.length();
      if (d > bd) continue;
      const hit = st.raycast(eye, to.clone().normalize(), d);
      if (hit && hit.t < d - 0.5) continue;           // стена/дерево/холм на пути
      if (ctx.blocksSight?.(eye, h.pos.clone().add(new THREE.Vector3(0, 1.1, 0)))) continue;   // дым
      bd = d; best = h;
    }
    // новая цель — сначала реакция, потом выстрел
    if (best && best.id !== b.victim?.id) b.nextShot = Math.max(b.nextShot, clock + reactOf(b.skill) + Math.random() * 0.3);
    b.target = best ? best.pos.clone() : null;
    b.victim = best;
  }

  function shoot(b, now) {
    const h = b.victim;
    if (!h) return;
    if (h.bot && !h.bot.alive) { b.victim = b.target = null; return; }
    if (!b.gun) {
      // кирка: бьёт, если вплотную
      if (now < b.nextMelee || h.pos.distanceTo(b.pos) > MELEE.reach) return;
      b.nextMelee = now + MELEE.rate;
      b.yaw = Math.atan2(-(h.pos.x - b.pos.x), -(h.pos.z - b.pos.z));
      ctx.combat().sfx('chop', b.pos);
      const d = { dmg: MELEE.dmg, by: b.name, w: 'pickaxe' };
      if (h.id === null) ctx.combat().takeDamage(d.dmg, d.by, d.w);
      else if (h.bot) damage(h.bot.id, d);
      else ctx.net()?.hit(d, h.id);
      return;
    }
    if (now < b.nextShot) return;
    const spec = WEAPONS[b.gun];
    b.nextShot = now + Math.max(0.25, spec.rate * 2.4 * (1.5 - b.skill)) + Math.random() * 0.45 * (1.2 - b.skill);
    const eye = b.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const aim = h.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
    const d = eye.distanceTo(aim);
    b.yaw = Math.atan2(-(aim.x - eye.x), -(aim.z - eye.z));
    // меткие: вблизи почти не мажут, издалека — примерно каждый третий; друг по другу — ещё злее
    const chance = Math.min(0.92, chanceOf(b.skill, d) + (h.bot ? 0.05 : 0));
    const hit = Math.random() < chance;
    const end = hit ? aim : aim.clone().add(new THREE.Vector3(rnd(-2, 2), rnd(-1, 1.5), rnd(-2, 2)));
    // базука у бота — мгновенный выстрел с трассером (без ракеты), урон как у взрыва
    const shot = { w: spec.rocket ? 'sniper' : b.gun, o: eye.toArray().map((v) => +v.toFixed(2)), e: [end.toArray().map((v) => +v.toFixed(2))] };
    ctx.combat().onShot('bot', shot);                 // трассер и звук у себя
    ctx.net()?.shot(shot);                            // и у всех
    if (!hit) return;
    const base = spec.rocket ? 70 : spec.pellets > 1 ? spec.dmg * 4 : spec.dmg;
    const dmg = Math.round(base * (h.bot ? 1.1 : 0.85));
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
    if (b.gun) {
      const spec = WEAPONS[b.gun];
      ctx.loot().drop(b.pos.clone(), [{ k: 'weapon', w: b.gun, r: b.rarity, a: spec.mag }, { k: 'ammo', w: spec.ammo, a: spec.ammo === 'shells' ? 10 : 30 }]);
    }
    publish();
  }

  // Позиции ботов — себе в others и всем по сети.
  function poseOf(b) {
    const d = { x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2), r: +b.yaw.toFixed(2), n: b.name, a: b.alive, rr: round, k: b.skin, g: b.gun || 'pickaxe', q: b.rarity };
    if (b.riding) d.rd = 1;
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
      const nowS = Date.now() / 1000;
      for (const b of bots.values()) {
        if (!b.alive) continue;
        if (b.riding) {
          const r = ctx.route();
          if (nowS >= b.jumpAt) { b.riding = false; b.gliding = true; b.vy = 0; b.pos.copy(r.at(b.jumpAt)); b.pos.y -= 2.5; }
          else { b.pos.copy(r.at(nowS)); continue; }
        }
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
