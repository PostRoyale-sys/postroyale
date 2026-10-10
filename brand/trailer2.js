// Динамичный ролик PostRoyale (~24 с): короткие сцены по ~2 с, жёсткие склейки со вспышкой, текст «с ударом»,
// лёгкий наезд камеры. Все процессы игры: вертолёт → прыжок → парашют → лут → стройка → бой → взрыв машины →
// FPV-дрон → шторм → Victory Royale → карточка «PLAY FREE NOW».
// Открыть: /?w=trailer1&shot=160,160,40,0,-0.3&rec=1 и в консоли import('./brand/trailer2.js').then((m) => m.record())
// Рендер покадровый (виртуальное время, pc.mainLoop), H.264 через WebCodecs + mp4-muxer → POST на 127.0.0.1:8767.

const W = 1280, H = 720, FPS = 30;
const DISPLAY = '"Lilita One", "Arial Black", sans-serif';
const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';
const URL_TEXT = 'postroyale-sys.github.io/postroyale';

// Сцены: [начало, конец, id, крупно, мелко]
const SHOTS = [
  [0.0, 2.1, 'heli', 'DROP IN', 'from the chopper'],
  [2.1, 3.9, 'fall', 'SKYDIVE', null],
  [3.9, 5.7, 'chute', 'PICK YOUR SPOT', null],
  [5.7, 7.7, 'loot', 'LOOT', 'chests · weapons · shields'],
  [7.7, 9.7, 'build', 'BUILD', 'walls · ramps · floors'],
  [9.7, 11.9, 'fight', 'FIGHT', '20 bots that play like people'],
  [11.9, 14.1, 'car', 'BLOW IT UP', null],
  [14.1, 16.5, 'drone', 'FPV DRONES', 'and 6 more abilities'],
  [16.5, 18.5, 'storm', 'OUTRUN THE STORM', null],
  [18.5, 20.3, 'win', 'VICTORY ROYALE', '#1 of 21'],
];
const END_AT = 20.3, TOTAL = 24.3;

// mode: 'play' — финал «PLAY FREE NOW» с адресом; 'soon' — анонс: счётчик «FARMING $PR» с «+N $PR» за действия
// и финал «COMING SOON · Farm $PR» (суммы условные — иллюстрация фарма, не обещание).
// За каждую сцену в режиме 'soon': сколько «$PR» всплывает.
const FARM = { loot: [[0.5, 15], [0.9, 10]], build: [[0.5, 5], [0.85, 5], [1.2, 5], [1.55, 5]], fight: [[1.2, 40]], car: [[0.9, 25]], drone: [[1.6, 60]], storm: [[1.0, 30]], win: [[0.4, 250]] };

export async function record({ mode = 'play' } = {}) {
  const soon = mode === 'soon';
  let farmed = 0, shown = 0;
  const pops = [];                                       // всплывающие «+N $PR»: { t, n }
  const pc = window.__pc;
  const src = pc.renderer.domElement;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  await document.fonts.load(`40px ${DISPLAY}`).catch(() => {});

  let locked = true;                                     // «мышь захвачена» → физика и вид от первого лица работают
  Object.defineProperty(pc.controls, 'isLocked', { get: () => locked, configurable: true });
  for (const id of ['cross', 'pause', 'banner', 'prompt', 'minimap', 'fpv']) { const e = document.getElementById(id); if (e) e.hidden = true; }

  // ---------- виртуальное время ----------
  const realPerf = performance.now.bind(performance), realDate = Date.now;
  let vt = realPerf(), skew = 0;                         // skew — сдвиг часов матча (сцена шторма)
  const dateBase = realDate() - vt;
  performance.now = () => vt;
  Date.now = () => Math.round(dateBase + vt + skew);
  pc.renderer.setAnimationLoop(null);

  // ---------- кодирование ----------
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 10e6, framerate: FPS });
  window.__trailer = { done: false, frame: 0 };

  const t0 = vt;
  const T = () => (vt - t0) / 1000;
  const V = (x, y, z) => pc.vec(x, y, z);
  const ground = (x, z) => pc.world.height(x, z);
  const S = {};                                          // состояние текущей сцены

  // ---------- помощники ----------
  function look(yaw, pitch) { pc.look(yaw, pitch); }
  function aimAt(p, dy = 0.8) {
    const f = pc.feet, eye = f.y + pc.eyeH;
    const dx = p.x - f.x, dz = p.z - f.z, d = Math.hypot(dx, dz);
    look(Math.atan2(-dx, -dz), Math.atan2((p.y ?? ground(p.x, p.z)) + dy - eye, d));
  }
  function standAt(x, z) { pc.cut(); locked = true; pc.tp(x, z); }
  const center = () => pc.royale.center;
  // точка на открытом месте в d м от p с прямой видимостью до неё
  function openSpot(p, d, needSight = true) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.3, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (ground(x, z) < 1.5 || pc.structures.blocked(x, ground(x, z) + 0.1, z)) continue;
      if (!needSight) return { x, z };
      const from = V(x, ground(x, z) + 1.6, z), py = (p.y ?? ground(p.x, p.z)) + 0.7;
      const dir = V(p.x - x, py - from.y, p.z - z), len = dir.length();
      const hit = pc.structures.raycast(from, dir.normalize(), len);
      if (!hit || hit.t > len - 1.2 || (p.k && hit.e?.k === p.k)) return { x, z };
    }
    return { x: p.x + d, z: p.z };
  }
  const nearCenter = (list) => [...list].sort((a, b) => Math.hypot(a.x - center().x, a.z - center().z) - Math.hypot(b.x - center().x, b.z - center().z));
  const awayBots = () => { for (const b of pc.bots.list.values()) if (b !== S.bot) b.pos.set(9999, 0, 9999); };

  // ---------- сцены: начало и каждый кадр ----------
  const SCENES = {
    heli: {
      start() { pc.cut(); pc.ride(); S.yaw0 = Math.atan2(-pc.flightDir().x, -pc.flightDir().z); },
      tick(s) { look(S.yaw0 + 1.3 - s * 1.0, -0.22); },
    },
    fall: {
      start() { pc.jump(true); },
      tick(s) { look(S.yaw0 + s * 0.9, -0.95 + s * 0.12); },
    },
    chute: {
      start() { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); },
      tick(s) { look(S.yaw0 + 1.6 + s * 0.6, -0.38); },
    },
    loot: {
      start() {
        // сундук на открытом месте: на земле и без крыши над ним (не в доме)
        const ch = nearCenter(pc.loot.chests.filter((c) => !pc.loot.isOpen(c) && ground(c.pos.x, c.pos.z) > 2
          && Math.abs(c.pos.y - ground(c.pos.x, c.pos.z)) < 0.6 && !pc.structures.blocked(c.pos.x, c.pos.y + 2.5, c.pos.z)
          && !pc.structures.blocked(c.pos.x, c.pos.y + 6, c.pos.z)));
        S.chest = ch[0];
        const p = S.chest.pos, sp = openSpot({ x: p.x, z: p.z, y: p.y }, 3.6);
        standAt(sp.x, sp.z);
        pc.pick(0);
        aimAt(p, 0.2);
        S.opened = false;
      },
      tick(s) {
        if (!S.opened && s > 0.35) { S.opened = true; pc.loot.open(S.chest, 2); }
        aimAt(S.chest.pos, 0.2 + s * 0.3);
      },
    },
    build: {
      start() {
        const c = center(), sp = openSpot({ x: c.x + 20, z: c.z + 6 }, 8, false);
        standAt(sp.x, sp.z);
        Object.assign(pc.mats, { wood: 300, brick: 200, metal: 100 });
        S.yaw = 0.4; S.step = 0; S.next = 0.25;
        look(S.yaw, -0.2);
      },
      tick(s) {
        look(S.yaw + s * 0.25, -0.25);
        if (s > S.next && S.step < 5) {
          const plan = ['w', 'w', 'r', 'f', 'w'][S.step];
          pc.exitBuild(); pc.build(plan);
          if (S.step === 1) S.yaw += 0.9;
          if (S.step === 4) S.yaw -= 1.4;
          look(S.yaw + s * 0.25, plan === 'f' ? -0.55 : -0.25);
          pc.place();
          S.step++; S.next = s + 0.32;
        }
        if (s > 1.9) pc.exitBuild();
      },
    },
    fight: {
      start() {
        pc.exitBuild();
        // площадь города: ровно, без травы и деревьев — бота хорошо видно
        const poi = nearCenter(pc.world.pois)[0];
        S.bot = [...pc.bots.list.values()].find((b) => b.alive);
        const sp = openSpot({ x: poi.x, z: poi.z }, 4, false);
        standAt(sp.x, sp.z);
        const bp = openSpot({ x: sp.x, z: sp.z, y: ground(sp.x, sp.z) }, 6.5);
        Object.assign(S.bot, { riding: false, gliding: false, chute: false, onGround: true, gun: 'ar', hp: 230, alive: true });
        S.bot.pos.set(bp.x, ground(bp.x, bp.z), bp.z);
        awayBots();
        pc.combat.resetAll();                          // в руках — только автомат (без пистолета из сундука)
        pc.combat.give({ k: 'weapon', w: 'ar', r: 3 }); pc.combat.give({ k: 'ammo', w: 'medium', a: 200 });
        pc.pick(1);
        S.next = 0.35;
      },
      tick(s) {
        const b = S.bot;
        aimAt(b.pos, 1.0);
        if (b.alive && s > S.next) { pc.combat.fire(0, performance.now() / 1000); S.next = s + 0.14; }
      },
    },
    car: {
      start() {
        const cars = nearCenter(pc.structures.objects.filter((o) => o.type === 'car' && o.hp > 0));
        S.car = cars[0];
        const sp = openSpot(S.car, 9.5);
        standAt(sp.x, sp.z);
        awayBots();
        pc.pick(1);
        S.next = 0.2;
      },
      tick(s) {
        aimAt(S.car, 0.7);
        if (pc.structures.has(S.car.k) && s > S.next) { pc.combat.fire(0, performance.now() / 1000); S.next = s + 0.14; }
      },
    },
    drone: {
      start() {
        const cars = nearCenter(pc.structures.objects.filter((o) => o.type === 'car' && o.hp > 0));
        S.target = cars[0];
        const sp = openSpot(S.target, 26);
        standAt(sp.x, sp.z);
        awayBots();
        aimAt(S.target, 2.5);
        pc.abilities.slots[0] = { id: 'drone', n: 1 };
        S.launched = false;
      },
      tick(s) {
        if (!S.launched && s > 0.25) { S.launched = pc.abilities.use(0); }
        const d = pc.abilities.drone;
        if (d) {
          const p = S.target, dx = p.x - d.pos.x, dz = p.z - d.pos.z, dist = Math.hypot(dx, dz);
          const ty = (p.y ?? ground(p.x, p.z)) + 0.6;
          look(Math.atan2(-dx, -dz), Math.atan2(ty - d.pos.y, dist) + (dist > 8 ? 0.08 : 0));
        }
      },
    },
    storm: {
      start() {
        skew = 150e3;                                  // часы матча вперёд: круг уже маленький
        pc.cut(); locked = false;
        const c = center(), r = pc.royale.stormNow().r;
        const a = 0.8, x = c.x + Math.cos(a) * (r + 30), z = c.z + Math.sin(a) * (r + 30);
        pc.feet.set(x, ground(x, z) + 28, z);
        S.c = c; S.a = a;
      },
      tick(s) {
        const c = S.c, a = S.a + s * 0.12, r = pc.royale.stormNow().r + 30 - s * 4;
        pc.feet.set(c.x + Math.cos(a) * r, Math.max(ground(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r), 0) + 26, c.z + Math.sin(a) * r);
        const dx = c.x - pc.feet.x, dz = c.z - pc.feet.z;
        look(Math.atan2(-dx, -dz), -0.32);
      },
    },
    win: {
      start() {
        skew = 0; pc.cut(); locked = false;
        const c = center();
        pc.feet.set(c.x - 10, ground(c.x, c.z) + 70, c.z + 120);
      },
      tick(s) {
        const c = center();
        pc.feet.set(c.x - 10 + s * 6, ground(c.x, c.z) + 70 - s * 6, c.z + 120 - s * 14);
        const dx = c.x - pc.feet.x, dz = c.z - pc.feet.z;
        look(Math.atan2(-dx, -dz), -0.42);
      },
    },
  };

  // ---------- кадр ----------
  let cur = -1;
  function shotAt(t) { return SHOTS.findIndex(([a, b]) => t >= a && t < b); }

  function frame() {
    const t = T();
    if (t >= TOTAL) return finish();
    if (t < END_AT) {
      const i = shotAt(t);
      const [a, b, id, big, small] = SHOTS[i];
      if (i !== cur) { cur = i; SCENES[id].start(); S.farmDone = new Set(); }
      SCENES[id].tick(t - a);
      if (soon) for (const [at, n] of FARM[id] || []) if (t - a >= at && !S.farmDone.has(at)) { S.farmDone.add(at); farmed += n; pops.push({ t, n }); }
      // игра — «cover» в 16:9 с лёгким наездом за сцену
      const z = 1 + ((t - a) / (b - a)) * 0.06;
      const sw = src.width, sh = src.height, k = Math.max(W / sw, H / sh) * z;
      const dw = sw * k, dh = sh * k;
      g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      if (id === 'drone' && pc.abilities.drone) fpvOverlay(t);
      vignette();
      watermark();
      punch(big, soon && id === 'win' ? '#1 of 21 · +250 $PR' : small, t - a, b - t, id === 'win');
      if (soon) farmHud(t);
      flash(t - a);
    } else endCard(t - END_AT);
  }

  // ---------- графика поверх ----------
  function vignette() {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,6,30,0.5)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
  function flash(s) {
    if (s > 0.16) return;
    g.fillStyle = `rgba(255,255,255,${0.75 * (1 - s / 0.16)})`;
    g.fillRect(0, 0, W, H);
  }
  function logo(x, y, size, align = 'left') {
    g.font = `italic 400 ${size}px ${DISPLAY}`;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const w1 = g.measureText('POST').width, w2 = g.measureText('ROYALE').width;
    const x0 = align === 'center' ? x - (w1 + w2) / 2 : x;
    g.lineWidth = size * 0.12; g.strokeStyle = 'rgba(20,12,60,.9)'; g.lineJoin = 'round';
    g.strokeText('POST', x0, y); g.strokeText('ROYALE', x0 + w1, y);
    g.fillStyle = '#ffffff'; g.fillText('POST', x0, y);
    g.fillStyle = '#ffc928'; g.fillText('ROYALE', x0 + w1, y);
  }
  function watermark() { g.globalAlpha = 0.9; logo(30, 52, 26); g.globalAlpha = 1; }
  // крупный текст «с ударом»: влетает с увеличения и поворота, держится, исчезает
  function punch(big, small, since, until, gold) {
    const pin = Math.min(1, since / 0.14), e = 1 - (1 - pin) ** 3;
    const a = Math.min(1, until / 0.18);
    g.save();
    g.globalAlpha = Math.max(0, a);
    g.translate(W / 2, H - 140);
    g.rotate((-2.5 * Math.PI) / 180);
    g.scale(1.5 - 0.5 * e, 1.5 - 0.5 * e);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `italic 400 ${gold ? 104 : 92}px ${DISPLAY}`;
    g.lineWidth = 14; g.strokeStyle = 'rgba(20,12,60,.95)'; g.lineJoin = 'round';
    g.strokeText(big, 0, 0);
    g.fillStyle = gold ? '#ffc928' : '#ffffff'; g.fillText(big, 0, 0);
    if (small && since > 0.12) {
      g.font = `800 28px ${SANS}`;
      g.lineWidth = 7; g.strokeText(small, 0, 44);
      g.fillStyle = '#ffd84a'; g.fillText(small, 0, 44);
    }
    g.restore();
  }
  // счётчик «FARMING $PR» справа сверху и всплывающие «+N $PR»
  function farmHud(t) {
    shown += (farmed - shown) * 0.25;
    g.save();
    const x = W - 300, y = 24, w = 270, h = 64;
    g.fillStyle = 'rgba(20,12,60,.72)'; g.beginPath(); g.roundRect(x, y, w, h, 16); g.fill();
    g.strokeStyle = 'rgba(255,201,40,.75)'; g.lineWidth = 2; g.stroke();
    g.textAlign = 'left'; g.font = `800 15px ${SANS}`; g.fillStyle = '#ffd84a';
    g.fillText(Math.floor(t * 2) % 2 ? '● FARMING $PR' : '○ FARMING $PR', x + 16, y + 24);
    g.font = `italic 400 32px ${DISPLAY}`; g.fillStyle = '#ffffff';
    g.fillText(`${Math.round(shown).toLocaleString('en')} $PR`, x + 16, y + 56);
    for (const p of pops) {
      const age = t - p.t;
      if (age > 1.1) continue;
      const a = Math.min(1, (1.1 - age) / 0.35);
      g.globalAlpha = a;
      g.font = `italic 400 44px ${DISPLAY}`;
      g.textAlign = 'center';
      const py = H * 0.42 - age * 90;
      g.lineWidth = 9; g.strokeStyle = 'rgba(20,12,60,.95)'; g.strokeText(`+${p.n} $PR`, W / 2 + 230, py);
      g.fillStyle = '#ffc928'; g.fillText(`+${p.n} $PR`, W / 2 + 230, py);
      g.globalAlpha = 1;
    }
    g.restore();
  }

  function fpvOverlay(t) {
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    g.strokeStyle = 'rgba(232,255,232,.9)'; g.lineWidth = 2;
    g.beginPath(); g.arc(W / 2, H / 2, 22, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(W / 2, H / 2, 2.5, 0, Math.PI * 2); g.fill();
    if (Math.floor(t * 2) % 2 === 0) { g.font = `800 22px ui-monospace, Menlo, monospace`; g.textAlign = 'left'; g.fillText('● REC · FPV', W - 210, 52); }
    g.restore();
  }
  function endCard(s) { return soon ? endSoon(s) : endPlay(s); }
  function endSoon(s) {
    const bg = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H / 2, W * 0.75);
    bg.addColorStop(0, '#5b3dff'); bg.addColorStop(0.55, '#2a1880'); bg.addColorStop(1, '#0e0828');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const f = (d) => Math.max(0, Math.min(1, (s - d) / 0.3));
    const pop = Math.min(1, s / 0.3), e = 1 - (1 - pop) ** 3;
    g.save(); g.globalAlpha = e; logo(W / 2, H * 0.26, 84, 'center'); g.restore();
    // COMING SOON — крупно, золотом, «удар» и лёгкая пульсация
    const k = Math.min(1, Math.max(0, (s - 0.25) / 0.18)), ek = 1 - (1 - k) ** 3;
    const pulse = 1 + Math.sin(s * 5) * 0.02;
    g.save();
    g.globalAlpha = k;
    g.translate(W / 2, H * 0.5); g.rotate((-3 * Math.PI) / 180); g.scale((1.6 - 0.6 * ek) * pulse, (1.6 - 0.6 * ek) * pulse);
    g.textAlign = 'center'; g.font = `italic 400 128px ${DISPLAY}`;
    g.lineWidth = 18; g.strokeStyle = 'rgba(20,12,60,.95)'; g.lineJoin = 'round';
    g.strokeText('COMING SOON', 0, 0);
    g.fillStyle = '#ffc928'; g.fillText('COMING SOON', 0, 0);
    g.restore();
    g.textAlign = 'center';
    g.globalAlpha = f(0.7); g.font = `italic 400 46px ${DISPLAY}`; g.fillStyle = '#ffffff';
    g.lineWidth = 8; g.strokeStyle = 'rgba(20,12,60,.9)';
    g.strokeText('PLAY. WIN. FARM $PR.', W / 2, H * 0.67); g.fillText('PLAY. WIN. FARM $PR.', W / 2, H * 0.67);
    g.globalAlpha = f(1.0); g.font = `700 24px ${SANS}`; g.fillStyle = '#d8d0ff';
    g.fillText('Season 1 · the battle royale that lives inside a post', W / 2, H * 0.67 + 50);
    g.globalAlpha = f(1.3); g.font = `800 22px ${SANS}`; g.fillStyle = '#ffd84a';
    g.fillText('Follow so you don’t miss the drop', W / 2, H * 0.67 + 88);
    g.globalAlpha = 1;
    flash(s);
  }
  function endPlay(s) {
    const bg = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H / 2, W * 0.75);
    bg.addColorStop(0, '#5b3dff'); bg.addColorStop(0.55, '#2a1880'); bg.addColorStop(1, '#0e0828');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const pop = Math.min(1, s / 0.3), e = 1 - (1 - pop) ** 3;
    g.save();
    g.translate(W / 2, H * 0.44); g.scale(1.3 - 0.3 * e, 1.3 - 0.3 * e); g.translate(-W / 2, -H * 0.44);
    g.globalAlpha = e;
    logo(W / 2, H * 0.44, 132, 'center');
    g.restore();
    const f = (d) => Math.max(0, Math.min(1, (s - d) / 0.3));
    g.textAlign = 'center';
    g.globalAlpha = f(0.3); g.font = `700 34px ${SANS}`; g.fillStyle = '#e8e4ff';
    g.fillText('The battle royale that lives inside a post', W / 2, H * 0.44 + 70);
    g.globalAlpha = f(0.6);
    const bw = 380, bh = 66, bx = W / 2 - bw / 2, by = H * 0.44 + 112;
    const pulse = 1 + Math.sin(s * 6) * 0.025;
    g.save(); g.translate(W / 2, by + bh / 2); g.scale(pulse, pulse); g.translate(-W / 2, -(by + bh / 2));
    g.fillStyle = '#ffc928'; g.beginPath(); g.roundRect(bx, by, bw, bh, 16); g.fill();
    g.fillStyle = '#1b1450'; g.font = `italic 400 36px ${DISPLAY}`; g.fillText('▶ PLAY FREE NOW', W / 2, by + 46);
    g.restore();
    g.globalAlpha = f(0.9); g.font = `700 24px ${SANS}`; g.fillStyle = '#ffffff';
    g.fillText(URL_TEXT, W / 2, by + bh + 44);
    g.globalAlpha = f(1.1); g.font = `600 20px ${SANS}`; g.fillStyle = '#b9b0ff';
    g.fillText('No install · free · P2P multiplayer · 1v1 ticker duels', W / 2, by + bh + 80);
    g.globalAlpha = 1;
    flash(s);
  }

  // ---------- покадровый прогон ----------
  let done = false;
  function finish() { done = true; }
  const yieldTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  window.__frameHook = () => frame();
  for (let i = 0; !done; i++) {
    vt += 1000 / FPS;
    pc.mainLoop(vt);
    if (done) break;
    const vf = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(vf, { keyFrame: i % FPS === 0 });
    vf.close();
    window.__trailer.frame = i;
    while (enc.encodeQueueSize > 4) await yieldTask();
    if (encErr) throw encErr;
    if (i % 5 === 0) await yieldTask();
  }
  window.__frameHook = null;
  await enc.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  performance.now = realPerf; Date.now = realDate;
  pc.renderer.setAnimationLoop(pc.mainLoop);
  const name = soon ? 'postroyale-trailer-soon.mp4' : 'postroyale-trailer-fast.mp4';
  const res = await fetch(`http://127.0.0.1:8767/upload?name=${name}`, { method: 'POST', body: blob });
  window.__trailer = { done: true, name, size: blob.size, ok: res.ok };
}
