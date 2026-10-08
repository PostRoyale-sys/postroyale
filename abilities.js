// Способности (как в Valorant): покупаются за кредиты матча в меню B и кладутся в два слота — F и Q.
// Кредиты: на старте раунда START, дальше — за убийства, ботов, сундуки и выживание (CREDITS).
//
//   Pump Dash        — рывок на 9 м туда, куда идёшь (или смотришь);
//   Moon Jump        — подброс вверх на 12 м (дальше — обычное падение/планирование не нужно);
//   Diamond Shield   — мгновенно +50 щита;
//   Rug Pull Smoke   — облако дыма в точке прицела (до 30 м) на 12 с; видно всем (net abil), боты сквозь него не видят;
//   Laser Recon      — 5 с подсвечивает врагов в 40 м сквозь стены (метки над головой);
//   Liquidation Nade — граната с отскоком, взрыв через 1.5 с как у ракеты (урон, постройки ломает); видна всем.

import * as THREE from 'three';

export const ABILITIES = {
  dash: { name: 'Pump Dash', icon: '💨', price: 200, max: 2, desc: 'Dash 9 m where you move' },
  jump: { name: 'Moon Jump', icon: '🚀', price: 150, max: 2, desc: 'Launch 12 m straight up' },
  shield: { name: 'Diamond Shield', icon: '💎', price: 300, max: 1, desc: '+50 shield instantly' },
  smoke: { name: 'Rug Pull Smoke', icon: '🟣', price: 250, max: 2, desc: 'Smoke cloud where you aim, 12 s' },
  recon: { name: 'Laser Recon', icon: '🛰', price: 200, max: 1, desc: 'Reveal enemies within 40 m, 5 s' },
  nade: { name: 'Liquidation Nade', icon: '💥', price: 350, max: 1, desc: 'Bouncing grenade, rocket-sized blast' },
};
export const CREDITS = { start: 400, kill: 300, botkill: 150, chest: 75, survive: 50 };
const SMOKE_R = 5.5, SMOKE_LIFE = 12, RECON_R = 40, RECON_LIFE = 5, NADE_FUSE = 1.5;

export function createAbilities(ctx) {
  const { scene, camera } = ctx;
  let credits = 0;
  const slots = [null, null];          // { id, n }
  const smokes = [];                   // { pos, born, mesh }
  const nades = [];                    // { pos, vel, born, own, mesh }
  let reconUntil = 0;
  const marks = new Map();             // key others → sprite

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
      case 'recon': reconUntil = performance.now() / 1000 + RECON_LIFE; ctx.combat().sfx('pickup'); break;
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
      ctx.onChange?.();
    },
    earn, buy, use, blocksSight,
    onNet(peerId, d) {
      if (d.k === 'smoke') addSmoke(new THREE.Vector3(...d.p), d.t || Date.now());
      if (d.k === 'nade') addNade(new THREE.Vector3(...d.o), new THREE.Vector3(...d.v), false);
    },
    update(dt) {
      const now = Date.now(), t = performance.now() / 1000;
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
