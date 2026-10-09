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

// Сложность (skill 0…1) у каждого бота своя. Сейчас все очень сильные: Casual 0.93…0.99, Ranked 0.97…1.0. Без читов: только прямая видимость (не сквозь стены и дым), точность падает
// с расстоянием и не выше ~90%, после обнаружения цели — задержка реакции.
const SKILL = { casual: [0.93, 0.99], ranked: [0.97, 1.0] };   // все боты очень сильные
const sightOf = (k) => 35 + 25 * k;                       // 42…53 м в Casual, 54…59 в Ranked
const reactOf = (k) => 1.25 - k;                          // задержка первого выстрела, с
const chanceOf = (k, d) => Math.min(0.95, Math.max(0.08 + 0.25 * k, 0.35 + 0.55 * k - d * (1.1 - k) / 90));

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
// «Небольшой ВХ»: живого игрока бот чувствует в AWARE м даже сквозь стены — идёт к нему и обходит,
// но стрелять может только при прямой видимости. Постройки на пути к цели или поперёк дороги — ломает.
const AWARE = 45, BREAK_REACH = 12, PICK_BUILD = 50;

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
    const drops = dropPlan(r);
    for (let i = 0; i < COUNT; i++) {
      const { jumpD, drop } = drops[i];
      const [lo, hi] = ctx.isRanked?.() ? SKILL.ranked : SKILL.casual;
      bots.set(i, {
        skill: rnd(lo, hi),
        id: i, name: degenNick(taken), skin: skins[Math.floor(Math.random() * skins.length)].id,
        pos: r.at(0), vy: 0, onGround: false, gliding: false, riding: true, jumpAt: r.t0 + jumpD / r.speed, drop,
        hp: 100, alive: true, gun: null, rarity: 0, yaw: 0, chest: null, nextMelee: 0,
        way: null, stuckT: 0, lastPos: new THREE.Vector3(), nextShot: clock + rnd(2, 4), target: null,
      });
    }
  }

  // План высадки: каждый бот выбирает свою точку — город (не больше 4 ботов на город) или случайное место
  // на суше в зоне, которое можно долететь от маршрута вертолёта (≤ GLIDE_REACH м вбок). Прыгает, когда
  // вертолёт ближе всего к этой точке (чуть раньше — в полёте ещё несёт вперёд), и рулит к ней в падении.
  const GLIDE_REACH = 80;
  function dropPlan(r) {
    const w = ctx.world(), rs = ctx.royale();
    const along = (p) => (p.x - r.a.x) * r.dir.x + (p.z - r.a.z) * r.dir.z;
    const side = (p) => Math.abs((p.x - r.a.x) * r.dir.z - (p.z - r.a.z) * r.dir.x);
    const inRange = (p) => { const s = along(p); return s >= r.w0 && s <= r.w1 && side(p) <= GLIDE_REACH; };
    const inZone = (p) => Math.hypot(p.x - rs.center.x, p.z - rs.center.z) < rs.safeRadius() * 0.9;
    const pois = (w.pois || []).filter((p) => inRange(p) && inZone(p));
    const used = new Map();
    const out = [];
    for (let i = 0; i < COUNT; i++) {
      let drop = null;
      const free = pois.filter((p) => (used.get(p.name) || 0) < 4);
      if (free.length && Math.random() < 0.6) {
        const p = free[Math.floor(Math.random() * free.length)];
        used.set(p.name, (used.get(p.name) || 0) + 1);
        drop = { x: p.x + rnd(-14, 14), z: p.z + rnd(-14, 14) };
      }
      for (let t = 0; !drop && t < 80; t++) {
        const s = rnd(r.w0, r.w1), off = rnd(-GLIDE_REACH, GLIDE_REACH);
        const p = { x: r.a.x + r.dir.x * s + r.dir.z * off, z: r.a.z + r.dir.z * s - r.dir.x * off };
        if (w.height(p.x, p.z) > 2.5 && inZone(p)) drop = p;
      }
      drop ||= zonePoint(0.7);
      const jumpD = Math.min(r.w1, Math.max(r.w0, along(drop) - rnd(10, 30)));
      out.push({ jumpD, drop });
    }
    return out;
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
        skill: ctx.isRanked?.() ? 0.98 : 0.96,
        hp: 100, alive: d.a !== false, gun: d.g && d.g !== 'pickaxe' ? d.g : null, rarity: d.q || 0, yaw: d.r || 0, riding: false, chest: null, nextMelee: 0, way: null, stuckT: 0, lastPos: new THREE.Vector3(), nextShot: clock + 2, target: null });
    }
  }

  // ---------- Движение ----------

  // Дистанция боя под оружие: с дробовиком — вплотную, со снайперкой — издалека.
  const RANGE = { shotgun: 7, smg: 12, pistol: 15, ar: 20, sniper: 34, bazooka: 24 };
  const DIRS = [0, 0.55, -0.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4];

  // Свободно ли идти в направлении (ux, uz): нет стены/объекта и не вода.
  function clearAhead(b, ux, uz, look) {
    const st = ctx.structures(), w = ctx.world();
    const x = b.pos.x + ux * look, z = b.pos.z + uz * look;
    if (w.height(x, z) < 0.4 && w.height(b.pos.x, b.pos.z) >= 0.4) return false;   // не лезть в воду
    return !st.blocked(x, b.pos.y, z);
  }

  function move(b, dt) {
    const st = ctx.structures();
    const rs = ctx.royale();
    b.vel ??= new THREE.Vector3();
    // от шторма — к центру; иначе — лут или свои точки внутри круга
    const c = rs.center, outside = Math.hypot(b.pos.x - c.x, b.pos.z - c.z) > rs.safeRadius() * 0.95;
    const looting = !outside && !b.gun && !b.gliding && lootStep(b);
    if (b.gliding && b.drop) b.way = b.drop;                      // в падении — к своей точке высадки
    else if (!looting && (!b.way || outside || Math.hypot(b.way.x - b.pos.x, b.way.z - b.pos.z) < 2)) b.way = outside ? { x: c.x, z: c.z } : zonePoint();
    let dx = b.way.x - b.pos.x, dz = b.way.z - b.pos.z;
    let speed = SPEED * (0.9 + 0.25 * b.skill);
    if (outside || (!b.target && Math.hypot(dx, dz) > 25)) speed *= 1.45;          // далеко или от шторма — бегом

    if (b.target && !b.gliding) {
      const tx = b.target.x - b.pos.x, tz = b.target.z - b.pos.z, td = Math.hypot(tx, tz) || 1;
      if (!b.gun) { dx = tx; dz = tz; speed *= 1.3; }                                // с киркой — вплотную, бегом
      else {
        // держим дистанцию под оружие и стрейфимся влево-вправо со случайной сменой
        const want = RANGE[b.gun] || 18;
        b.strafeT = (b.strafeT || 0) - dt;
        if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeT = 0.35 + Math.random() * (1.3 - b.skill * 0.6); }
        const ux = tx / td, uz = tz / td, px = -uz * b.strafe, pz = ux * b.strafe;
        const k = td > want + 4 ? 1 : td < want - 4 ? -0.8 : 0.15;                   // ближе / отойти / почти на месте
        dx = ux * k + px * 0.9; dz = uz * k + pz * 0.9;
        speed *= 1.05;
      }
    }
    let len = Math.hypot(dx, dz) || 1;
    let ux = dx / len, uz = dz / len;

    if (b.gliding) {
      // свободное падение → парашют: рулим к точке, к земле не быстрее купола
      speed = b.chute ? 9 : 13;
    } else {
      // постройка прямо поперёк пути (стена дома, чужая стенка) — пробить, а не тыкаться
      if (!b.victim && !b.breakKey) {
        const eye = b.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
        const hit = st.raycast(eye, new THREE.Vector3(ux, 0, uz), 1.8);
        if (hit?.e?.kind === 'piece' && (b.blockedT || 0) > 0.6) { b.breakKey = hit.e.k; b.breakAt = hit.point; }
      }
      if (b.breakKey && !b.victim) {
        // стоим у постройки и ломаем (с оружием — можно и с расстояния)
        const p = b.breakAt, d = Math.hypot(p.x - b.pos.x, p.z - b.pos.z);
        if (!b.gun && d > MELEE.reach) { ux = (p.x - b.pos.x) / d; uz = (p.z - b.pos.z) / d; }
        else { ux = 0; uz = 0; }
      } else {
        // обход препятствий: ищем свободное направление веером — сначала на дальней дистанции (сворачиваем заранее),
        // потом на ближней
        let ok = false;
        for (const look of [3.2, 1.3]) {
          for (const a of DIRS) {
            const ca = Math.cos(a), sa = Math.sin(a);
            const rx = ux * ca - uz * sa, rz = ux * sa + uz * ca;
            if (clearAhead(b, rx, rz, look) && clearAhead(b, rx, rz, look * 0.5)) { ux = rx; uz = rz; ok = true; break; }
          }
          if (ok) break;
        }
        if (!ok && b.onGround) { b.vy = JUMP; b.onGround = false; }
      }
      // сильные боты в бою подпрыгивают, сбивая прицел
      if (b.target && b.gun && b.onGround && Math.random() < dt * 0.7 * b.skill) { b.vy = JUMP; b.onGround = false; }
    }

    // плавный разгон и поворот (а не рывками)
    const acc = Math.min(1, dt * (b.gliding ? 2 : 9));
    b.vel.x += (ux * speed - b.vel.x) * acc;
    b.vel.z += (uz * speed - b.vel.z) * acc;
    const nx = b.pos.x + b.vel.x * dt, nz = b.pos.z + b.vel.z * dt;
    const bx = st.blocked(nx, b.pos.y, b.pos.z), bz = st.blocked(b.pos.x, b.pos.y, nz);
    if (!bx) b.pos.x = nx; else b.vel.x *= -0.2;
    if (!bz) b.pos.z = nz; else b.vel.z *= -0.2;
    b.blockedT = (bx || bz) ? (b.blockedT || 0) + dt : 0;
    if (!b.target && Math.hypot(b.vel.x, b.vel.z) > 0.5) {
      const want = Math.atan2(-b.vel.x, -b.vel.z);
      let d = want - b.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      b.yaw += d * Math.min(1, dt * 8);                                               // плавный поворот корпуса
    }

    // гравитация, падение, парашют, опора
    const g0 = ctx.world().height(b.pos.x, b.pos.z);
    if (b.gliding && !b.chute && b.pos.y - g0 < 40 + b.skill * 10) b.chute = true;    // раскрыть купол
    const vmin = !b.gliding ? -45 : b.chute ? -6 : -30;
    b.vy = Math.max(b.vy - GRAVITY * dt, vmin);
    if (b.gliding && b.chute && b.vy < -6) b.vy += (-6 - b.vy) * Math.min(1, dt * 3);
    let ny = b.pos.y + b.vy * dt;
    const g = st.ground(b.pos.x, b.pos.z, Math.max(b.pos.y, ny));
    if (ny <= g || (b.onGround && b.vy <= 0 && b.pos.y - g < 0.6)) { ny = g; b.vy = 0; b.onGround = true; if (b.gliding) b.drop = null; b.gliding = false; b.chute = false; } else b.onGround = false;
    b.pos.y = ny;
    if (b.pos.y < 0) b.way = null;                     // в воде — искать сушу
    // застрял — новая точка
    b.stuckT += dt;
    if (b.stuckT > 2.5) { if (b.pos.distanceTo(b.lastPos) < 1.2) { b.way = zonePoint(); b.vel.set(0, 0, 0); } b.lastPos.copy(b.pos); b.stuckT = 0; }
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
    b.breakKey = null;
    if (best || b.gliding) return;
    // никого не видно — но игрока рядом «чувствуем» сквозь стены: идём к нему; если между нами постройка — ломаем
    let near = null, nd = AWARE;
    for (const h of humans()) { const d = h.pos.distanceTo(b.pos); if (d < nd) { nd = d; near = h; } }
    if (!near) return;
    b.target = near.pos.clone();
    const to = near.pos.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(eye);
    const hit = st.raycast(eye, to.clone().normalize(), Math.min(to.length(), BREAK_REACH));
    if (hit?.e?.kind === 'piece') { b.breakKey = hit.e.k; b.breakAt = hit.point; }
  }

  // Ломать постройку: с оружием — стрелять по ней, без — бить киркой вплотную.
  function breakPiece(b, now) {
    const st = ctx.structures();
    if (!b.breakKey || !st.has(b.breakKey)) { b.breakKey = null; return false; }
    const p = b.breakAt, d = p.distanceTo(b.pos);
    b.yaw = Math.atan2(-(p.x - b.pos.x), -(p.z - b.pos.z));
    if (!b.gun) {
      if (d > MELEE.reach + 0.8 || now < b.nextMelee) return true;
      b.nextMelee = now + MELEE.rate;
      ctx.combat().sfx('chop', b.pos);
      ctx.damageStructure(b.breakKey, PICK_BUILD, false);
      return true;
    }
    if (now < b.nextShot) return true;
    const spec = WEAPONS[b.gun];
    b.nextShot = now + Math.max(0.2, spec.rate * 1.6);
    const eye = b.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const shot = { w: spec.rocket ? 'sniper' : b.gun, o: eye.toArray().map((v) => +v.toFixed(2)), e: [p.toArray().map((v) => +v.toFixed(2))] };
    ctx.combat().onShot('bot', shot);
    ctx.net()?.shot(shot);
    ctx.damageStructure(b.breakKey, spec.rocket ? 250 : spec.pellets > 1 ? spec.dmg * 6 : spec.dmg, false);
    return true;
  }

  function shoot(b, now) {
    const h = b.victim;
    if (!h) { if (b.breakKey) breakPiece(b, now); return; }
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
    if (b.gliding) { d.st = b.chute ? 'g' : 'f'; if (b.chute) d.pc = 1; } else if (!b.onGround) d.st = 'a';
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
          if (nowS >= b.jumpAt) { b.riding = false; b.gliding = true; b.chute = false; b.vy = 0; b.pos.copy(r.at(b.jumpAt)); b.pos.y -= 3.3; }
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
