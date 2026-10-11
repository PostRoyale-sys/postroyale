// Способности (как в Valorant): покупаются за кредиты матча в меню B и кладутся в два слота — F и Q.
// Кредиты: на старте раунда START, дальше — за убийства, ботов, сундуки и выживание (CREDITS).
//
//   Pump Dash        — рывок на 9 м туда, куда идёшь (или смотришь);
//   Moon Jump        — подброс вверх на 12 м (дальше — обычное падение/планирование не нужно);
//   Diamond Shield   — мгновенно +50 щита;
//   Rug Pull Smoke   — облако дыма в точке прицела (до 30 м) на 12 с; видно всем (net abil), боты сквозь него не видят;
//   Laser Recon      — 5 с подсвечивает врагов в 40 м сквозь стены (метки над головой);
//   Liquidation Nade — граната с отскоком, взрыв через 1.5 с как у ракеты (урон, постройки ломает); видна всем;
//   FPV Drone        — дрон-камикадзе: камера переходит в дрон, летит туда, куда смотришь (W — быстрее, S — тише),
//                      ЛКМ — подрыв, сам взрывается при касании стены/земли/врага или через DRONE_LIFE с;
//                      тело игрока в это время стоит на месте и уязвимо. Дрон и взрыв видят все (net abil).

import * as THREE from 'three';

export const ABILITIES = {
  dash: { name: 'Pump Dash', icon: '💨', price: 200, max: 2, desc: 'Dash 9 m where you move' },
  jump: { name: 'Moon Jump', icon: '🚀', price: 150, max: 2, desc: 'Launch 12 m straight up' },
  shield: { name: 'Diamond Shield', icon: '💎', price: 300, max: 1, desc: '+50 shield instantly' },
  smoke: { name: 'Rug Pull Smoke', icon: '🟣', price: 250, max: 2, desc: 'Smoke cloud where you aim, 12 s' },
  recon: { name: 'Laser Recon', icon: '🛰', price: 200, max: 1, desc: 'Reveal enemies within 40 m, 5 s' },
  nade: { name: 'Liquidation Nade', icon: '💥', price: 350, max: 1, desc: 'Bouncing grenade, rocket-sized blast' },
  drone: { name: 'FPV Drone', icon: '🛸', price: 450, max: 1, desc: 'Fly a kamikaze FPV drone, LMB to blow up' },
};
export const CREDITS = { start: 400, kill: 300, botkill: 150, chest: 75, survive: 50 };
const SMOKE_R = 5.5, SMOKE_LIFE = 12, RECON_R = 40, RECON_LIFE = 5, NADE_FUSE = 1.5;
const DRONE_LIFE = 10, DRONE_SPEED = 20;

export function createAbilities(ctx) {
  const { scene, camera } = ctx;
  let credits = 0;
  const slots = [null, null];          // { id, n }
  const smokes = [];                   // { pos, born, mesh }
  const nades = [];                    // { pos, vel, born, own, mesh }
  let reconUntil = 0;
  const marks = new Map();             // key others → sprite
  let drone = null;                    // свой дрон: { pos, vel, born, mesh, sent }
  const foreign = new Map();           // чужие дроны: peerId → { mesh, seen }

  // ---------- Кредиты и покупка ----------

  function earn(kind) {
    const n = CREDITS[kind] || 0;
    if (!n) return;
    credits += n;
    ctx.toast?.(`+${n} 💰`);
    ctx.onChange?.();
  }

  function buy(id) {
    const a = ABILITIES[id];
    if (!a) return 'unknown';
    if (credits < a.price) return `Need ${a.price - credits} more 💰`;
    let s = slots.findIndex((x) => x && x.id === id);
    if (s >= 0 && slots[s].n >= a.max) return `${a.name}: max ${a.max} charges`;
    if (s < 0) s = slots.findIndex((x) => !x);
    if (s < 0) s = 1;                                  // оба слота заняты другими — заменяем второй
    if (!slots[s] || slots[s].id !== id) slots[s] = { id, n: 0 };
    slots[s].n++;
    credits -= a.price;
    ctx.onChange?.();
    return null;
  }

  // ---------- Применение ----------

  const eye = () => camera.getWorldPosition(new THREE.Vector3());
  const look = () => camera.getWorldDirection(new THREE.Vector3());

  function use(i) {
    const s = slots[i];
    if (!s || s.n <= 0 || !ctx.canUse()) return false;
    const id = s.id;
    switch (id) {
      case 'dash': {
        const d = ctx.moveDir();
        ctx.dash(d.lengthSq() ? d : (() => { const f = look(); f.y = 0; return f.normalize(); })());
        break;
      }
      case 'jump': ctx.launch(26.5); break;               // ≈12 м вверх при g = 30
      case 'shield':
        if (!ctx.combat().give({ k: 'armor', a: 50 })) { ctx.toast?.('Shield is already full'); return false; }
        break;
      case 'smoke': {
        const hit = ctx.structures().raycast(eye(), look(), 30);
        const p = hit ? hit.point : eye().addScaledVector(look(), 30);
        p.y = Math.max(p.y, ctx.world().height(p.x, p.z)) + 1.5;
        addSmoke(p, Date.now());
        ctx.net()?.abil({ k: 'smoke', p: p.toArray().map((v) => +v.toFixed(2)), t: Date.now() });
        break;
      }
      case 'drone': {
        if (drone) return false;
        const p = eye().addScaledVector(look(), 1.2);
        drone = { pos: p, vel: look().multiplyScalar(DRONE_SPEED * 0.5), born: performance.now() / 1000, mesh: droneMesh(), sent: 0 };
        drone.mesh.visible = false;                    // своего не видно — смотрим из него
        scene.add(drone.mesh);
        ctx.combat().sfx('dash');
        break;
      }
      case 'recon': reconUntil = performance.now() / 1000 + RECON_LIFE; ctx.combat().sfx('beepGo'); break;
      case 'nade': {
        const o = eye().addScaledVector(look(), 0.8);
        const v = look().multiplyScalar(19).add(new THREE.Vector3(0, 5, 0));
        addNade(o, v, true);
        ctx.net()?.abil({ k: 'nade', o: o.toArray().map((x) => +x.toFixed(2)), v: v.toArray().map((x) => +x.toFixed(2)) });
        break;
      }
    }
    s.n--;
    if (s.n <= 0) slots[i] = null;
    ctx.onChange?.();
    return true;
  }

  // ---------- Дым ----------

  const smokeMat = new THREE.MeshToonMaterial({ color: 0x9b6bff, transparent: true, opacity: 0.88, depthWrite: false });
  function addSmoke(p, born) {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), smokeMat);
      const a = (i / 9) * Math.PI * 2;
      const r = i === 0 ? 0 : SMOKE_R * 0.45;
      m.position.set(Math.cos(a) * r, i === 0 ? 0.6 : (i % 2) * 1.2 - 0.4, Math.sin(a) * r);
      m.scale.setScalar(i === 0 ? SMOKE_R * 0.75 : SMOKE_R * 0.55);
      g.add(m);
    }
    g.position.copy(p);
    g.scale.setScalar(0.2);
    scene.add(g);
    smokes.push({ pos: p.clone(), born, mesh: g });
  }

  // Отрезок a→b проходит сквозь дым? (для ботов: не видят цель)
  function blocksSight(a, b) {
    const d = b.clone().sub(a), len = d.length();
    d.divideScalar(len || 1);
    for (const s of smokes) {
      const t = Math.max(0, Math.min(len, s.pos.clone().sub(a).dot(d)));
      if (a.clone().addScaledVector(d, t).distanceTo(s.pos) < SMOKE_R * 0.9) return true;
    }
    return false;
  }

  // ---------- Граната ----------

  const nadeGeo = new THREE.IcosahedronGeometry(0.22, 1);
  const nadeMat = new THREE.MeshToonMaterial({ color: 0xff5a2a, emissive: 0x401000 });
  function addNade(o, v, own) {
    const mesh = new THREE.Mesh(nadeGeo, nadeMat);
    mesh.position.copy(o);
    scene.add(mesh);
    nades.push({ pos: o.clone(), vel: v.clone(), born: performance.now() / 1000, own, mesh });
  }

  // ---------- FPV-дрон ----------

  function droneMesh() {
    const g = new THREE.Group();
    const dark = new THREE.MeshToonMaterial({ color: 0x23262d }), gold = new THREE.MeshToonMaterial({ color: 0xffc928 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), dark));
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.34), dark);
      arm.position.set(x * 0.15, 0, z * 0.15); arm.rotation.y = Math.atan2(x, z); g.add(arm);
      const rot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.01, 12), new THREE.MeshBasicMaterial({ color: 0x9aa0aa, transparent: true, opacity: 0.45 }));
      rot.position.set(x * 0.26, 0.07, z * 0.26); g.add(rot);
    }
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), gold);   // камера FPV спереди
    cam.position.set(0, 0.07, -0.12); g.add(cam);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    led.position.set(0, 0, -0.18); g.add(led);
    g.userData.led = led;
    return g;
  }

  function detonate() {
    if (!drone) return;
    const p = drone.pos.clone();
    scene.remove(drone.mesh);
    drone = null;
    ctx.combat().explodeAt(p, true);
    ctx.net()?.abil({ k: 'boom', p: p.toArray().map((v) => +v.toFixed(2)) });
  }

  function updateDrone(dt, t) {
    if (!drone) return;
    if (!ctx.canFly()) { scene.remove(drone.mesh); drone = null; return; }   // погиб/раунд кончился — связь потеряна
    const want = look().multiplyScalar(DRONE_SPEED * (ctx.key('KeyW') ? 1.5 : ctx.key('KeyS') ? 0.5 : 1));
    drone.vel.lerp(want, Math.min(1, dt * 3));
    const st = ctx.structures(), w = ctx.world();
    const steps = Math.max(1, Math.ceil((drone.vel.length() * dt) / 0.4));
    for (let i = 0; i < steps; i++) {
      drone.pos.addScaledVector(drone.vel, dt / steps);
      let hit = st.solidAt(drone.pos) || drone.pos.y < Math.max(w.height(drone.pos.x, drone.pos.z), 0) + 0.3;
      for (const [, o] of ctx.others) if (!hit && o.group.visible && o.group.position.clone().add(new THREE.Vector3(0, 1, 0)).distanceTo(drone.pos) < 1.4) hit = true;
      if (hit || t - drone.born > DRONE_LIFE) { detonate(); return; }
    }
    drone.mesh.position.copy(drone.pos);
    drone.mesh.lookAt(drone.pos.clone().add(drone.vel));
    if ((drone.sent -= dt) <= 0) {
      drone.sent = 0.1;
      ctx.net()?.abil({ k: 'drone', p: drone.pos.toArray().map((v) => +v.toFixed(2)), v: drone.vel.toArray().map((v) => +v.toFixed(1)) });
    }
  }

  // ---------- Recon: метки над врагами ----------

  function markSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ff3b5a'; g.strokeStyle = '#fff'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32); g.closePath(); g.fill(); g.stroke();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(0.9, 0.9, 1);
    s.renderOrder = 10;
    return s;
  }

  return {
    get credits() { return credits; },
    slots,
    // Новый раунд: стартовые кредиты, пустые слоты, без дыма.
    reset() {
      credits = CREDITS.start;
      slots[0] = slots[1] = null;
      for (const s of smokes) scene.remove(s.mesh);
      smokes.length = 0;
      reconUntil = 0;
      if (drone) { scene.remove(drone.mesh); drone = null; }
      ctx.onChange?.();
    },
    earn, buy, use, blocksSight, detonate,
    // Свой дрон в полёте (камера — в нём): { pos, left } или null.
    get drone() { return drone ? { pos: drone.pos, left: Math.max(0, DRONE_LIFE - (performance.now() / 1000 - drone.born)), life: DRONE_LIFE } : null; },
    onNet(peerId, d) {
      if (d.k === 'smoke') addSmoke(new THREE.Vector3(...d.p), d.t || Date.now());
      if (d.k === 'nade') addNade(new THREE.Vector3(...d.o), new THREE.Vector3(...d.v), false);
      if (d.k === 'drone' && Array.isArray(d.p)) {
        let f = foreign.get(peerId);
        if (!f) { f = { mesh: droneMesh() }; scene.add(f.mesh); foreign.set(peerId, f); }
        f.seen = performance.now() / 1000;
        f.mesh.position.set(...d.p);
        if (Array.isArray(d.v)) f.mesh.lookAt(f.mesh.position.clone().add(new THREE.Vector3(...d.v)));
      }
      if (d.k === 'boom' && Array.isArray(d.p)) {
        const f = foreign.get(peerId);
        if (f) { scene.remove(f.mesh); foreign.delete(peerId); }
        ctx.combat().explodeAt(new THREE.Vector3(...d.p), false);
      }
    },
    update(dt) {
      const now = Date.now(), t = performance.now() / 1000;
      updateDrone(dt, t);
      for (const [k, f] of foreign) {
        f.mesh.userData.led.visible = Math.sin(t * 12) > 0;
        if (t - f.seen > 1) { scene.remove(f.mesh); foreign.delete(k); }
      }
      // дым: раздувается, держится, тает
      for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i], age = (now - s.born) / 1000;
        s.mesh.scale.setScalar(Math.min(1, 0.2 + age * 1.6));
        s.mesh.rotation.y += dt * 0.15;
        smokeMat.opacity = 0.88;
        if (age > SMOKE_LIFE - 1.5) s.mesh.traverse((m) => { if (m.isMesh) m.visible = Math.random() > (age - (SMOKE_LIFE - 1.5)) / 1.5; });
        if (age > SMOKE_LIFE) { scene.remove(s.mesh); smokes.splice(i, 1); }
      }
      // гранаты: полёт с гравитацией, отскок от земли/построек, взрыв по таймеру
      const st = ctx.structures();
      for (let i = nades.length - 1; i >= 0; i--) {
        const n = nades[i];
        n.vel.y -= 26 * dt;
        const next = n.pos.clone().addScaledVector(n.vel, dt);
        if (st.solidAt(next)) {
          const g = st.ground(next.x, next.z, n.pos.y + 0.5);
          if (next.y <= g + 0.2) { n.vel.y = Math.abs(n.vel.y) * 0.45; n.vel.x *= 0.7; n.vel.z *= 0.7; next.y = g + 0.22; }
          else { n.vel.x *= -0.4; n.vel.z *= -0.4; next.copy(n.pos); }
        }
        n.pos.copy(next);
        n.mesh.position.copy(n.pos);
        n.mesh.rotation.x += dt * 8;
        if (t - n.born > NADE_FUSE) {
          scene.remove(n.mesh);
          nades.splice(i, 1);
          ctx.combat().explodeAt(n.pos, n.own);
        }
      }
      // recon: метки над живыми врагами в радиусе
      const on = t < reconUntil;
      const me = ctx.feet();
      for (const [k, o] of ctx.others) {
        const show = on && o.target?.a !== false && !o.target?.rd && o.group.position.distanceTo(me) < RECON_R;
        let m = marks.get(k);
        if (show && !m) { m = markSprite(); marks.set(k, m); scene.add(m); }
        if (m) { m.visible = show; if (show) m.position.copy(o.group.position).add(new THREE.Vector3(0, 2.9 + Math.sin(t * 6) * 0.1, 0)); }
      }
      for (const [k, m] of marks) if (!ctx.others.has(k)) { scene.remove(m); marks.delete(k); }
    },
  };
}
