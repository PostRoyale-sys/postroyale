// Ролик обновления «динамика и зрелищность» (~30 с, со звуком): аирдроп, хедшоты и мультикилл, скольжение, батут,
// цепочка бочек, падающее дерево, сирена шторма, Pump-зона, ночь и гроза, победный облёт; финальная карточка.
// Открыть: /?w=dyn1&shot=160,160,40,0,-0.3&rec=1 и в консоли import('./brand/trailer5.js').then((m) => m.record())
// Как trailer4.js: виртуальное время, pc.mainLoop покадрово, H.264 + AAC (WebCodecs + mp4-muxer) → POST на 127.0.0.1:8767.
// Время раунда (шторм, аирдроп, Pump) двигаем сдвигом Date.now (skew) — события раунда завязаны на часы.

const W = 1280, H = 720, FPS = 30;
const DISPLAY = '"Lilita One", "Arial Black", sans-serif';
const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';
const URL_TEXT = 'postroyale.xyz';

// [начало, конец, id, крупно, мелко]
const SHOTS = [
  [0.0, 4.2, 'drop', 'SUPPLY DROPS', 'epic+ loot from the sky'],
  [4.2, 7.4, 'kills', 'HEADSHOTS', 'big numbers · multi-kills'],
  [7.4, 9.4, 'slide', 'SLIDE', 'alt on the run'],
  [9.4, 12.4, 'pad', 'LAUNCH PADS', 'bounce · redeploy'],
  [12.4, 14.9, 'barrel', 'BOOM BARRELS', 'chain reactions'],
  [14.9, 17.4, 'tree', 'TIMBER!', 'trees fall now'],
  [17.4, 20.6, 'storm', 'STORM SIREN', 'final circle moves'],
  [20.6, 22.8, 'pump', 'PUMP ZONE', '+30% damage inside'],
  [22.8, 24.6, 'night', 'NIGHT ROUNDS', null],
  [24.6, 26.6, 'rain', 'THUNDERSTORMS', null],
  [26.6, 29.6, 'win', 'VICTORY ROYALE', 'orbit cam · confetti'],
];
const END_AT = 29.6, TOTAL = 33.6;
const MUSIC = [[0, 0.1], [END_AT - 0.4, 0.1], [END_AT + 0.6, 0.85], [TOTAL - 0.6, 0.85], [TOTAL, 0]];

export async function record() {
  const pc = window.__pc;
  const src = pc.renderer.domElement;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  await document.fonts.load(`40px ${DISPLAY}`).catch(() => {});

  // в ролике игрока не убивают (бот в сцене с числами урона отстреливается); урон — только для сцены аптечки
  Object.assign(pc.settings, { fov: 80, vol: 0.8, music: 0.5 });     // ролик — с настройками по умолчанию
  pc.camera.fov = 80; pc.camera.updateProjectionMatrix();
  const realDamage = pc.combat.takeDamage;
  pc.combat.takeDamage = () => {};
  let locked = true;
  Object.defineProperty(pc.controls, 'isLocked', { get: () => locked, configurable: true });
  for (const id of ['cross', 'pause', 'banner', 'prompt', 'minimap', 'fpv', 'dmgnums']) { const e = document.getElementById(id); if (e) e.hidden = true; }

  // ---------- виртуальное время ----------
  const realPerf = performance.now.bind(performance), realDate = Date.now;
  let vt = realPerf(), skew = 0;
  const dateBase = realDate() - vt;
  performance.now = () => vt;
  Date.now = () => Math.round(dateBase + vt + skew);
  pc.renderer.setAnimationLoop(null);

  // ---------- кодирование ----------
  const t0 = vt;
  const T = () => (vt - t0) / 1000;
  const endAudio = await pc.audio.capture(TOTAL, T, MUSIC);
  const SR = pc.audio.ctx.sampleRate;
  const aac = { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 192000 };
  const useAac = (await AudioEncoder.isConfigSupported(aac).catch(() => ({}))).supported;
  const acfg = useAac ? aac : { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, audio: { codec: useAac ? 'aac' : 'opus', numberOfChannels: 2, sampleRate: acfg.sampleRate }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 10e6, framerate: FPS });
  window.__trailer = { done: false, frame: 0 };

  const V = (x, y, z) => pc.vec(x, y, z);
  const ground = (x, z) => pc.world.height(x, z);
  const S = {};
  // секунда раунда «сейчас» = sec (сдвиг часов игры вперёд/назад)
  const setSec = (sec) => { skew += (pc.royale.roundStart + sec * 1000) - Date.now(); };
  const keyDown = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code }));
  const keyUp = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, key: code === 'Space' ? ' ' : code }));

  // ---------- помощники ----------
  const look = (yaw, pitch) => pc.look(yaw, pitch);
  function aimAt(p, dy = 0.8) {
    const f = pc.feet, eye = f.y + pc.eyeH;
    const dx = p.x - f.x, dz = p.z - f.z, d = Math.hypot(dx, dz);
    look(Math.atan2(-dx, -dz), Math.atan2((p.y ?? ground(p.x, p.z)) + dy - eye, d));
  }
  // на землю (не на крышу), если там свободно
  function standAt(x, z) { pc.cut(); locked = true; pc.tp(x, z); if (!pc.structures.blocked(x, ground(x, z) + 0.05, z)) pc.feet.y = ground(x, z) + 0.02; }
  const center = () => pc.royale.center;
  function openSpot(p, d, needSight = true) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.3, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (ground(x, z) < 1.5 || pc.structures.blocked(x, ground(x, z) + 0.1, z)) continue;
      if (!needSight) return { x, z };
      const from = V(x, ground(x, z) + 1.6, z), py = (p.y ?? ground(p.x, p.z)) + 0.7;
      const dir = V(p.x - x, py - from.y, p.z - z), len = dir.length();
      const hit = pc.structures.raycast(from, dir.normalize(), len);
      if (!hit || hit.t > len - 1.2) return { x, z };
    }
    return { x: p.x + d, z: p.z };
  }
  // свободное место на расстоянии d от p: ровно, без деревьев/камней/домов рядом, с видом на p
  function cleanSpot(p, d, py = null, clear = 4) {
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2 + 0.2, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (ground(x, z) < 1.5 || pc.structures.blocked(x, ground(x, z) + 0.1, z, 2.2, 0.8)) continue;
      if (Math.abs(pc.structures.ground(x, z, 999) - ground(x, z)) > 0.3) continue;
      if (pc.structures.objects.some((o) => o.hp > 0 && o.type !== 'barrel' && o !== p.self && Math.hypot(o.x - x, o.z - z) < clear)) continue;
      if (pc.pads.list.some((q) => Math.hypot(q.x - x, q.z - z) < 6 || Math.hypot(q.x - (x + p.x) / 2, q.z - (z + p.z) / 2) < 4)) continue;   // батут не в кадре
      const from = V(x, ground(x, z) + 1.6, z), ty = (py ?? p.y ?? ground(p.x, p.z)) + 0.8;
      const dir = V(p.x - x, ty - from.y, p.z - z), len = dir.length();
      const hit = pc.structures.raycast(from, dir.normalize(), len);
      if (!hit || hit.t > len - 1.5) return { x, z };
    }
    return openSpot(p, d);
  }
  const nearCenter = (list) => [...list].sort((a, b) => Math.hypot(a.x - center().x, a.z - center().z) - Math.hypot(b.x - center().x, b.z - center().z));
  const awayBots = () => { for (const b of pc.bots.list.values()) if (b !== S.bot) b.pos.set(9999, 0, 9999); };
  // открытое место без деревьев рядом (чтобы оружие было видно на фоне неба/поля)
  function clearing() {
    const c = center();
    for (let k = 0; k < 60; k++) {
      const a = k * 2.399, r = 20 + k * 2.5, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (ground(x, z) < 2 || pc.structures.blocked(x, ground(x, z) + 0.1, z)) continue;
      if (pc.structures.objects.some((o) => o.hp > 0 && Math.hypot(o.x - x, o.z - z) < 7)) continue;
      if (pc.world.pieces.some((q) => Math.hypot(q.ix * 4 + 2 - x, q.iz * 4 + 2 - z) < 16)) continue;   // подальше от домов
      return { x, z };
    }
    return { x: c.x, z: c.z };
  }
  const give = (...items) => { for (const it of items) pc.combat.give(it); };

  // все выстрелы — с одной точки по стене дома (слышно попадания); оружие — в первый слот
  function gunAt() {
    if (S.spot) { standAt(S.spot.x, S.spot.z); return; }
    const poi = nearCenter(pc.world.pois)[0];
    S.poi = poi; S.spot = openSpot({ x: poi.x, z: poi.z }, 16, false);
    standAt(S.spot.x, S.spot.z);
  }
  const AMMO_OF = { pistol: 'light', smg: 'light', ar: 'medium', shotgun: 'shells', sniper: 'heavy', bazooka: 'rockets' };
  function gun(type, first, every, r = 3) {
    return {
      start() {
        pc.combat.resetAll();
        give({ k: 'weapon', w: type, r }, { k: 'ammo', w: AMMO_OF[type], a: 200 });
        gunAt(); awayBots(); pc.pick(1);
        S.next = first;
      },
      tick(s) {
        aimAt({ x: S.poi.x, z: S.poi.z }, type === 'bazooka' ? 0.6 : 1.4);
        if (s > S.next) { pc.combat.fire(0, performance.now() / 1000); S.next = every ? s + every : 1e9; }
      },
    };
  }
  const AR = () => { pc.combat.resetAll(); give({ k: 'weapon', w: 'ar', r: 4 }, { k: 'ammo', w: 'medium', a: 300 }); pc.pick(1); };
  const near = (p) => Math.hypot(p.x - pc.feet.x, p.z - pc.feet.z);
  const SCENES = {
    drop: {
      start() {
        pc.setMood('game');
        setSec(70.0);
        S.drop = pc.loot.chests.find((c) => c.drop && c.drop.T === 72);
        const p = S.drop.pos, sp = cleanSpot({ x: p.x, z: p.z, y: p.y }, 8.5);
        standAt(sp.x, sp.z); awayBots(); AR(); S.opened = false;
      },
      tick(s) {
        const body = S.drop.group.userData.body.getWorldPosition(V(0, 0, 0));
        aimAt({ x: body.x, z: body.z, y: body.y }, 0.4);
        if (!S.opened && s > 2.5) { S.opened = pc.loot.open(S.drop); }
      },
    },
    kills: {
      start() {
        const sp = clearing(); standAt(sp.x, sp.z); AR();
        const bots = [...pc.bots.list.values()];
        S.k = bots.slice(0, 2);
        const yaw = 0.5; look(yaw, 0);
        S.k.forEach((b, i) => {
          const x = sp.x - Math.sin(yaw) * 9 + Math.cos(yaw) * (i ? 1.6 : -1.6), z = sp.z - Math.cos(yaw) * 9 - Math.sin(yaw) * (i ? 1.6 : -1.6);
          Object.assign(b, { riding: false, gliding: false, chute: false, onGround: true, gun: 'ar', hp: 100, alive: true });
          b.pos.set(x, ground(x, z), z);
          b.hold = b.pos.clone();
        });
        S.kills = [];
        S.bot = S.k[0];
        for (const b of pc.bots.list.values()) if (!S.k.includes(b)) b.pos.set(9999, 0, 9999);
        document.getElementById('dmgnums').hidden = false;
        S.next = 0.25; S.ti = 0;
      },
      tick(s) {
        for (const b of S.k) {
          if (b.alive) { b.pos.copy(b.hold); b.target = null; b.victim = null; b.vel?.set(0, 0, 0); }   // стоят на месте
          else if (!S.kills.some((k) => k.b === b)) S.kills.push({ b, t: s, n: S.kills.length + 1 });
        }
        S.ks = s;
        const t = S.k.find((b) => b.alive);
        if (!t) return;
        aimAt(t.pos, 1.78);
        if (s > S.next) { pc.combat.fire(0, performance.now() / 1000); S.next = s + 0.16; }
      },
    },
    slide: {
      start() {
        document.getElementById('dmgnums').hidden = true;
        const sp = clearing(); standAt(sp.x, sp.z); AR(); awayBots();
        S.yaw = 0.9; look(S.yaw, -0.08);
        pc.keys.add('KeyW'); pc.keys.add('ShiftLeft');
      },
      tick(s) {
        look(S.yaw, -0.08);
        if (s > 0.55 && !pc.keys.has('AltLeft')) pc.keys.add('AltLeft');
      },
    },
    pad: {
      start() {
        const pads = nearCenter(pc.pads.list);
        S.pad = pads[0];
        const a = 0.7, x = S.pad.x + Math.sin(a) * 2.8, z = S.pad.z + Math.cos(a) * 2.8;
        standAt(x, z); AR(); awayBots();
        look(a, -0.2);
        pc.keys.add('KeyW'); S.space = false; S.up = -1;
      },
      tick(s) {
        if (S.up < 0 && pc.vel.y > 10) S.up = s;                    // подбросило
        if (S.up >= 0 && s - S.up > 0.25) pc.keys.delete('KeyW');
        if (!S.space && S.up >= 0 && pc.vel.y < 1) { S.space = true; keyDown('Space'); keyUp('Space'); }
        const k = S.up < 0 ? 0 : Math.min(1, (s - S.up) / 0.9);
        look(0.7 + k * 0.6, -0.2 - k * 0.55);                           // наверху — вниз на остров
      },
    },
    barrel: {
      start() {
        pc.cut();
        const all = pc.structures.objects.filter((o) => o.type === 'barrel' && o.hp > 0);
        // кучка бочек (2–3 рядом), лучше у машины
        S.b = all.sort((p, q) => all.filter((o) => Math.hypot(o.x - q.x, o.z - q.z) < 4).length - all.filter((o) => Math.hypot(o.x - p.x, o.z - p.z) < 4).length)[0];
        const sp = cleanSpot({ x: S.b.x, z: S.b.z, y: S.b.y - 0.3 }, 8.5);
        standAt(sp.x, sp.z); AR(); awayBots(); S.next = 0.3;
      },
      tick(s) {
        aimAt({ x: S.b.x, z: S.b.z, y: S.b.y }, 0.55);
        if (S.b.hp > 0 && s > S.next) { pc.combat.fire(0, performance.now() / 1000); S.next = s + 0.14; }
      },
    },
    tree: {
      start() {
        const trees = pc.structures.objects.filter((o) => (o.type === 'oak' || o.type === 'pine') && o.hp > 0 && o.y > 2.5);
        // дерево на ровном или чуть выше нас — упадёт от нас и будет видно, как оно ложится
        let sp = null;
        for (const o of nearCenter(trees)) {
          if (trees.some((q) => q !== o && Math.hypot(q.x - o.x, q.z - o.z) < 8)) continue;
          const c = cleanSpot({ x: o.x, z: o.z, y: o.y, self: o }, 12, null, 7);
          const behind = ground(o.x + (o.x - c.x) * 0.5, o.z + (o.z - c.z) * 0.5);       // куда упадёт
          if (ground(c.x, c.z) < o.y + 0.5 && behind > o.y - 1.5) { S.t = o; sp = c; break; }
        }
        if (!sp) { S.t = trees[0]; sp = cleanSpot({ x: S.t.x, z: S.t.z, y: S.t.y, self: S.t }, 12, null, 7); }
        standAt(sp.x, sp.z); AR(); awayBots(); S.next = 0.25;
      },
      tick(s) {
        aimAt({ x: S.t.x, z: S.t.z, y: S.t.y }, 2.4);
        if (S.t.hp > 0 && s < 0.6 && s > S.next) { pc.combat.fire(0, performance.now() / 1000); S.next = s + 0.12; }
        // последний удар: дерево валится вбок (поперёк взгляда) — так видно, как оно ложится
        if (S.t.hp > 0 && s >= 0.6) {
          const f = pc.feet.clone(), dx = S.t.x - f.x, dz = S.t.z - f.z, d = Math.hypot(dx, dz) || 1;
          pc.feet.set(S.t.x + (dz / d) * 5, f.y, S.t.z - (dx / d) * 5);
          pc.damageStructure(S.t.k, 9999, false);
          pc.feet.copy(f);
        }
      },
    },
    storm: {
      start() {
        setSec(106.6);
        const c = center(), r = pc.royale.stormNow().r;
        // стоим у стены шторма, смотрим наружу — сирена, отсчёт, потом стена поехала
        const a = 0.4;
        let best = null;
        for (let k = 0; k < 72 && !best; k++) {
          const b = a + k * 0.087, x = c.x + Math.cos(b) * (r - 9), z = c.z + Math.sin(b) * (r - 9);
          if (ground(x, z) < 2 || pc.structures.blocked(x, ground(x, z) + 0.1, z, 2.2, 0.8)) continue;
          if (pc.structures.objects.some((o) => o.hp > 0 && Math.hypot(o.x - x, o.z - z) < 7)) continue;
          if (Math.abs(pc.structures.ground(x, z, 999) - ground(x, z)) > 0.3) continue;
          const from = V(x, ground(x, z) + 1.6, z), out = V(Math.cos(b), 0, Math.sin(b));
          const hit = pc.structures.raycast(from, out, 14);
          if (hit && hit.t < 13) continue;                          // впереди должно быть видно стену шторма
          if (ground(x + out.x * 12, z + out.z * 12) < 1) continue;     // стена над сушей, а не над морем
          if (pc.structures.objects.some((o) => o.hp > 0 && Math.hypot(o.x - (x + out.x * 8), o.z - (z + out.z * 8)) < 6)) continue;
          best = { x, z, b };
        }
        best ||= { x: c.x + Math.cos(a) * (r - 12), z: c.z + Math.sin(a) * (r - 12), b: a };
        standAt(best.x, best.z); AR(); awayBots();
        S.yaw = Math.atan2(-(Math.cos(best.b)), -(Math.sin(best.b)));
        look(S.yaw, 0.05);
        pc.audio.play('siren');
      },
      tick(s) { look(S.yaw + s * 0.05, 0.06); },
    },
    pump: {
      start() {
        setSec(113);
        const p = pc.events.pump, sp = cleanSpot({ x: p.x, z: p.z, y: p.y }, 24, p.y + 3.5, 10);
        standAt(sp.x, sp.z); AR(); awayBots();
      },
      tick(s) { const p = pc.events.pump; aimAt({ x: p.x, z: p.z, y: p.y }, 0.3 + s * 0.6); },
    },
    night: {
      start() {
        pc.setMood('night');
        const poi = nearCenter(pc.world.pois)[0], sp = openSpot({ x: poi.x, z: poi.z }, 26, false);
        standAt(sp.x, sp.z); AR(); awayBots();
        S.yaw = Math.atan2(-(poi.x - sp.x), -(poi.z - sp.z));
      },
      tick(s) { look(S.yaw + s * 0.08, 0.22); },
    },
    rain: {
      start() {
        pc.setMood('rain');
        const sp = clearing(); standAt(sp.x, sp.z); AR(); awayBots();
        S.yaw = 2.0; S.bolt = false;
      },
      tick(s) {
        look(S.yaw + s * 0.06, 0.1);
        if (!S.bolt && s > 0.7) { S.bolt = true; S.boltAt = s; pc.audio.play('thunder', null, { at: 0.35 }); }
      },
    },
    win: {
      start() {
        pc.setMood('golden');
        const sp = clearing(); standAt(sp.x, sp.z); AR(); awayBots();
        for (let i = 0; i < 6; i++) pc.step(1 / 30);       // на землю (эмоция — только стоя)
        look(1.2, 0);
        pc.audio.play('victory');
        pc.winCam();
      },
      tick() {},
    },
  };

  // ---------- кадр ----------
  let cur = -1;
  const shotAt = (t) => SHOTS.findIndex(([a, b]) => t >= a && t < b);
  function frame() {
    const t = T();
    if (t >= TOTAL) return finish();
    if (t < END_AT) {
      const i = shotAt(t);
      const [a, b, id, big, small] = SHOTS[i];
      if (i !== cur) { cur = i; pc.keys.clear(); SCENES[id].start(); }
      SCENES[id].tick(t - a);
      const z = 1 + ((t - a) / (b - a)) * 0.05;
      const sw = src.width, sh = src.height, k = Math.max(W / sw, H / sh) * z;
      const dw = sw * k, dh = sh * k;
      g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      if (id === 'kills') { numbers(); killOverlays(); }
      if (id === 'storm') stormWarn();
      if (id === 'rain' && S.boltAt !== undefined) { const k = t - a - S.boltAt; if (k >= 0 && k < 0.5) { g.fillStyle = `rgba(235,242,255,${(k < 0.08 ? 0.6 : k < 0.16 ? 0.15 : 0.45) * (1 - k / 0.5)})`; g.fillRect(0, 0, W, H); } }
      vignette();
      watermark();
      badge(t);
      punch(big, small, t - a, b - t);
      flash(t - a);
    } else { if (cur !== -2) { cur = -2; pc.keys.clear(); } endCard(t - END_AT); }
  }

  // ---------- графика поверх ----------
  function vignette() {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,6,30,0.5)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
  function flash(s) {
    if (s > 0.14) return;
    g.fillStyle = `rgba(255,255,255,${0.7 * (1 - s / 0.14)})`;
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
  // плашка «UPDATE» справа сверху
  function badge(t) {
    g.save();
    const w = 150, h = 40, x = W - w - 28, y = 22;
    g.fillStyle = '#ffc928'; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill();
    g.fillStyle = '#1b1450'; g.font = `italic 400 24px ${DISPLAY}`; g.textAlign = 'center';
    g.fillText(Math.floor(t * 2) % 2 ? '⚡ UPDATE' : '🔥 UPDATE', x + w / 2, y + 29);
    g.restore();
  }
  function punch(big, small, since, until) {
    const pin = Math.min(1, since / 0.14), e = 1 - (1 - pin) ** 3;
    const a = Math.min(1, until / 0.18);
    g.save();
    g.globalAlpha = Math.max(0, a);
    g.translate(W / 2, H - 130);
    g.rotate((-2.5 * Math.PI) / 180);
    g.scale(1.5 - 0.5 * e, 1.5 - 0.5 * e);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `italic 400 84px ${DISPLAY}`;
    g.lineWidth = 13; g.strokeStyle = 'rgba(20,12,60,.95)'; g.lineJoin = 'round';
    g.strokeText(big, 0, 0);
    g.fillStyle = '#ffffff'; g.fillText(big, 0, 0);
    if (small && since > 0.12) {
      g.font = `800 27px ${SANS}`;
      g.lineWidth = 7; g.strokeText(small, 0, 42);
      g.fillStyle = '#ffd84a'; g.fillText(small, 0, 42);
    }
    g.restore();
  }
  // числа урона в игре — DOM-слой; в ролик переносим их на холст по их экранным координатам
  function numbers() {
    const sx = W / innerWidth, sy = H / innerHeight;
    for (const el of document.querySelectorAll('#dmgnums .dn')) {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\).*scale\(([\d.]+)\)/.exec(el.style.transform || '');
      if (!m) continue;
      const op = +(el.style.opacity || 1);
      const big = el.classList.contains('big'), sh = el.classList.contains('sh'), head = el.classList.contains('head');
      g.save();
      g.globalAlpha = op;
      g.translate(+m[1] * sx, +m[2] * sy); g.scale(+m[3], +m[3]);
      const txt = el.textContent + (head ? '!' : '');
      g.font = `${head ? 'italic ' : ''}400 ${head ? (big ? 64 : 54) : big ? 48 : 38}px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = head ? 'rgba(255,140,20,.95)' : sh ? 'rgba(60,170,255,.9)' : big ? 'rgba(255,200,40,.85)' : 'rgba(255,255,255,.5)'; g.shadowBlur = 18;
      g.lineWidth = 8; g.strokeStyle = '#14161c'; g.lineJoin = 'round';
      g.strokeText(txt, 0, 0);
      g.shadowBlur = 0;
      g.fillStyle = head ? '#ffd21a' : big ? (sh ? '#8fd8ff' : '#ffe14a') : sh ? '#5cc4ff' : '#ffffff';
      g.fillText(txt, 0, 0);
      g.restore();
    }
  }
  // «ELIMINATED ник» и «DOUBLE KILL» — рисуем сами по моментам смертей (по часам ролика, не CSS)
  function killOverlays() {
    const now = S.ks ?? 0;
    const last = S.kills?.[S.kills.length - 1];
    if (!last) return;
    const k = now - last.t;
    if (k < 1.8) {
      const pop = Math.min(1, k / 0.15), sc = 1.5 - 0.5 * (1 - (1 - pop) ** 3), op = k > 1.5 ? (1.8 - k) / 0.3 : 1;
      const who = last.b.name.toUpperCase();
      g.save(); g.globalAlpha = op; g.translate(W / 2, H - 238); g.scale(sc, sc);
      g.font = `400 32px ${DISPLAY}`; g.textBaseline = 'middle';
      const w1 = g.measureText('ELIMINATED ').width, w2 = g.measureText(who).width, w = w1 + w2 + 110;
      const gr = g.createLinearGradient(-w / 2, 0, w / 2, 0);
      gr.addColorStop(0, 'rgba(255,45,61,0)'); gr.addColorStop(0.15, 'rgba(255,45,61,.8)'); gr.addColorStop(0.85, 'rgba(255,45,61,.8)'); gr.addColorStop(1, 'rgba(255,45,61,0)');
      g.fillStyle = gr; g.fillRect(-w / 2, -26, w, 52);
      const x0 = -w / 2 + 40;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x0 + 16, 0, 18, 0, 7); g.fill();
      g.fillStyle = '#d0102a'; g.textAlign = 'center'; g.font = `400 22px ${DISPLAY}`; g.fillText(String(last.n), x0 + 16, 1);
      g.textAlign = 'left'; g.font = `400 32px ${DISPLAY}`;
      g.fillStyle = '#fff'; g.fillText('ELIMINATED', x0 + 46, 2);
      g.fillStyle = '#ffe14a'; g.fillText(who, x0 + 46 + w1, 2);
      g.restore();
    }
    if (last.n >= 2 && k < 1.9) {
      const pop = Math.min(1, k / 0.18), e = 1 - (1 - pop) ** 3, sc = 2.2 - 1.2 * e + (k > 0.18 && k < 0.3 ? 0.06 : 0), op = k > 1.55 ? (1.9 - k) / 0.35 : 1;
      g.save(); g.globalAlpha = Math.max(0, op); g.translate(W / 2, H * 0.3); g.rotate(-0.05 * (1 - e) - 0.04); g.scale(sc, sc);
      g.font = `italic 400 104px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 16; g.strokeStyle = '#6a1d00'; g.lineJoin = 'round'; g.strokeText('DOUBLE KILL', 0, 0);
      const gr = g.createLinearGradient(0, -48, 0, 48); gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.55, '#ffc21a'); gr.addColorStop(1, '#ff7a1a');
      g.fillStyle = gr; g.fillText('DOUBLE KILL', 0, 0);
      g.restore();
    }
  }
  // «⚠ Storm shrinking in N» — DOM; рисуем плашку сами
  function stormWarn() {
    const el = document.getElementById('stormwarn');
    if (!el.classList.contains('on')) return;
    const txt = (el.textContent || '').toUpperCase(), go = el.classList.contains('go');
    g.save(); g.translate(W / 2, 120);
    const pulse = 1 + Math.sin(performance.now() / 160) * 0.04; g.scale(pulse, pulse);
    g.font = `400 40px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(txt).width + 60;
    const gr = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    if (go) { gr.addColorStop(0, '#d0102a'); gr.addColorStop(1, '#ff4d6a'); } else { gr.addColorStop(0, '#6a2bd9'); gr.addColorStop(1, '#b44dff'); }
    g.fillStyle = gr; g.beginPath(); g.roundRect(-w / 2, -32, w, 64, 18); g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
    g.fillStyle = '#fff'; g.fillText(txt, 0, 3);
    g.restore();
  }
  // полоса здоровья в сцене аптечки (интерфейс игры в ролик не попадает)
  function hpBar(s) {
    const hp = pc.combat.hp, hl = pc.combat.healing;
    g.save();
    const x = 40, y = H - 100, w = 330, h = 26;
    g.fillStyle = 'rgba(20,12,60,.75)'; g.beginPath(); g.roundRect(x - 8, y - 38, w + 16, h + 48, 14); g.fill();
    g.fillStyle = '#ffffff'; g.font = `800 18px ${SANS}`; g.textAlign = 'left';
    g.fillText(hl ? `✚ HEALING… ${Math.max(0, hl.left).toFixed(1)}s` : '❤ HEALTH', x, y - 12);
    g.fillStyle = 'rgba(255,255,255,.15)'; g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill();
    g.fillStyle = hp < 50 ? '#ff5a6a' : '#2fbf71'; g.beginPath(); g.roundRect(x, y, (w * hp) / 100, h, 8); g.fill();
    g.fillStyle = '#ffffff'; g.font = `italic 400 22px ${DISPLAY}`; g.textAlign = 'right'; g.fillText(`${hp}`, x + w - 8, y + 21);
    g.restore();
    void s;
  }
  function endCard(s) {
    const bg = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H / 2, W * 0.75);
    bg.addColorStop(0, '#5b3dff'); bg.addColorStop(0.55, '#2a1880'); bg.addColorStop(1, '#0e0828');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const f = (d) => Math.max(0, Math.min(1, (s - d) / 0.3));
    const pop = Math.min(1, s / 0.3), e = 1 - (1 - pop) ** 3;
    g.save(); g.globalAlpha = e; logo(W / 2, H * 0.22, 76, 'center'); g.restore();
    const k = Math.min(1, Math.max(0, (s - 0.2) / 0.18)), ek = 1 - (1 - k) ** 3, pulse = 1 + Math.sin(s * 5) * 0.02;
    g.save();
    g.globalAlpha = k;
    g.translate(W / 2, H * 0.42); g.rotate((-3 * Math.PI) / 180); g.scale((1.6 - 0.6 * ek) * pulse, (1.6 - 0.6 * ek) * pulse);
    g.textAlign = 'center'; g.font = `italic 400 112px ${DISPLAY}`;
    g.lineWidth = 16; g.strokeStyle = 'rgba(20,12,60,.95)'; g.lineJoin = 'round';
    g.strokeText('UPDATE IS LIVE', 0, 0);
    g.fillStyle = '#ffc928'; g.fillText('UPDATE IS LIVE', 0, 0);
    g.restore();
    g.textAlign = 'center';
    g.globalAlpha = f(0.6); g.font = `700 26px ${SANS}`; g.fillStyle = '#e8e4ff';
    g.fillText('Supply drops · Headshots · Slides · Launch pads · Barrels · Night & storms', W / 2, H * 0.55);
    g.globalAlpha = f(0.9);
    const bw = 380, bh = 64, bx = W / 2 - bw / 2, by = H * 0.62;
    const p2 = 1 + Math.sin(s * 6) * 0.025;
    g.save(); g.translate(W / 2, by + bh / 2); g.scale(p2, p2); g.translate(-W / 2, -(by + bh / 2));
    g.fillStyle = '#ffc928'; g.beginPath(); g.roundRect(bx, by, bw, bh, 16); g.fill();
    g.fillStyle = '#1b1450'; g.font = `italic 400 36px ${DISPLAY}`; g.fillText('▶ PLAY FREE NOW', W / 2, by + 45);
    g.restore();
    g.globalAlpha = f(1.2); g.font = `700 26px ${SANS}`; g.fillStyle = '#ffffff';
    g.fillText(URL_TEXT, W / 2, by + bh + 46);
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
  // звук: дорендерить и закодировать кусками по 0.1 с
  window.__trailer.audio = 'render';
  const ab = await endAudio();
  window.__trailer.audio = 'encode';
  let aErr = null;
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { aErr = e; } });
  aenc.configure(acfg);
  const L = ab.getChannelData(0), R = ab.getChannelData(1), step = Math.round(ab.sampleRate / 10);
  // нормировка по пику обоих каналов (0.95) — без клиппинга в AAC
  let pk0 = 0;
  for (let i = 0; i < L.length; i++) pk0 = Math.max(pk0, Math.abs(L[i]), Math.abs(R[i]));
  if (pk0 > 0) for (let i = 0; i < L.length; i++) { L[i] *= 0.95 / pk0; R[i] *= 0.95 / pk0; }
  window.__trailer.rawPeak = pk0;
  for (let i = 0; i < ab.length; i += step) {
    const n = Math.min(step, ab.length - i), data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: ab.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / ab.sampleRate) * 1e6), data });
    aenc.encode(ad); ad.close();
    if (aErr) throw aErr;
  }
  await aenc.flush();
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]));
  window.__trailer.peak = peak;
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  performance.now = realPerf; Date.now = realDate;
  pc.combat.takeDamage = realDamage;
  pc.renderer.setAnimationLoop(pc.mainLoop);
  const name = 'postroyale-dynamics-update.mp4';
  const res = await fetch(`http://127.0.0.1:8767/upload?name=${name}`, { method: 'POST', body: blob });
  window.__trailer = { done: true, name, size: blob.size, ok: res.ok, aac: useAac, peak: window.__trailer.peak, rawPeak: window.__trailer.rawPeak };
}
