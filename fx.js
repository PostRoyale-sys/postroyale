// Эффекты без нагрузки на сеть: числа урона над целью, частицы (щепки, искры, обломки, пыль), следы от пуль.
// Частицы — один InstancedMesh на всё (одна отрисовка), следы — второй; числа урона — DOM-слой поверх кадра.

import * as THREE from 'three';
import { toon } from './art.js';

const PCAP = 600;                  // частиц одновременно
const DCAP = 80;                   // следов от пуль
const NCAP = 24;                   // чисел урона

export function createFx(scene, camera) {
  // ---------- Частицы ----------
  const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), PCAP);
  pMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PCAP * 3), 3);
  pMesh.frustumCulled = false;
  pMesh.count = 0;
  scene.add(pMesh);
  // Пыль и дым — отдельно: мягкие многогранники с cel-затенением (как облака), а не плоские кубики.
  const puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), toon(0xffffff), PCAP / 2);
  puffMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PCAP / 2 * 3), 3);
  puffMesh.frustumCulled = false;
  puffMesh.count = 0;
  scene.add(puffMesh);
  const parts = [];                // { p, v, life, age, size, grow, g, drag, spin, rot }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();

  function emit(p, o) {
    if (parts.length >= PCAP) parts.shift();
    parts.push({
      p: p.clone(), v: o.v || new THREE.Vector3(), life: o.life ?? 0.6, age: 0, size: o.size ?? 0.12, grow: o.grow ?? 0,
      g: o.g ?? 20, drag: o.drag ?? 0, color: new THREE.Color(o.color ?? 0xffffff), rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0),
      spin: o.spin ?? 6, flat: o.flat || 0,
    });
  }
  const rand = (a) => (Math.random() - 0.5) * 2 * a;

  // Щепки, крошка, искры: материал удара — wood | brick | metal | rock | dirt.
  const CHIP = { wood: [0xb07a45, 0x8a5a2b], brick: [0xc0604a, 0x9aa3ad], metal: [0xc0c8d4, 0x8a94a6], rock: [0x9aa3ad, 0x6f7782], dirt: [0x9c8560, 0x6f8f3a] };
  function chips(p, kind, n = 7) {
    const cols = CHIP[kind] || CHIP.wood;
    for (let i = 0; i < n; i++) {
      emit(p, { v: new THREE.Vector3(rand(3), Math.random() * 4 + 2, rand(3)), life: 0.5 + Math.random() * 0.3, size: 0.07 + Math.random() * 0.08, color: cols[i % cols.length] });
    }
    if (kind === 'metal' || kind === 'brick') sparks(p, kind === 'metal' ? 6 : 3);
  }
  function sparks(p, n = 6) {
    for (let i = 0; i < n; i++) {
      emit(p, { v: new THREE.Vector3(rand(6), Math.random() * 5 + 1, rand(6)), life: 0.18 + Math.random() * 0.15, size: 0.04, color: i % 2 ? 0xfff2a0 : 0xffb23a, g: 12, spin: 0 });
    }
  }
  // Обломки разрушенной детали/объекта: куски вдоль коробки, разлетаются и падают.
  function debris(box, kind, n = 14) {
    const cols = CHIP[kind] || CHIP.wood;
    const size = box.getSize(new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(box.min.x + Math.random() * size.x, box.min.y + Math.random() * size.y, box.min.z + Math.random() * size.z);
      emit(p, { v: new THREE.Vector3(rand(4), Math.random() * 5 + 1, rand(4)), life: 0.9 + Math.random() * 0.5, size: 0.18 + Math.random() * 0.22, color: cols[i % cols.length], g: 18 });
    }
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Vector3(box.min.x + Math.random() * size.x, box.min.y + Math.random() * size.y * 0.5, box.min.z + Math.random() * size.z);
      emit(p, { v: new THREE.Vector3(rand(1), 1 + Math.random(), rand(1)), life: 0.9, size: 0.35, grow: 1.1, g: 0, drag: 2, color: 0xd8d0c0, spin: 1 });
    }
  }
  // Облачко пыли (бег, попадание в землю): растёт и тает (уменьшается к концу).
  function dust(p, color = 0xcbb894, big = 1) {
    emit(p, { v: new THREE.Vector3(rand(0.6), 0.5 + Math.random() * 0.4, rand(0.6)), life: 0.6, size: 0.1 * big, grow: 0.45 * big, g: 0, drag: 3, color, spin: 1.5 });
  }

  // Лечение: зелёные искорки поднимаются вокруг персонажа.
  function heal(p) {
    emit(p.clone().add(new THREE.Vector3(rand(0.4), rand(0.3), rand(0.4))), { v: new THREE.Vector3(rand(0.2), 1.2 + Math.random() * 0.6, rand(0.2)), life: 0.8, size: 0.07, g: 0, color: Math.random() < 0.5 ? 0x5dff9a : 0xc8ffd8, spin: 3 });
  }

  // Убийство: персонаж «лопается» — вспышка-облачко, конфетти цветов скина и монетки PR веером вверх.
  const COIN = [0xffd21a, 0xffb020, 0xfff1a0];
  function pop(p, colors = [0xffffff]) {
    for (let i = 0; i < 6; i++) emit(p.clone().add(new THREE.Vector3(rand(0.4), rand(0.6), rand(0.4))), { v: new THREE.Vector3(rand(2), 1 + Math.random() * 2, rand(2)), life: 0.55, size: 0.25, grow: 1.4, g: 0, drag: 4, color: i % 2 ? 0xffffff : 0xfff3c4, spin: 2 });
    for (let i = 0; i < 26; i++) {
      emit(p, { v: new THREE.Vector3(rand(5), 3 + Math.random() * 6, rand(5)), life: 0.9 + Math.random() * 0.6, size: 0.09 + Math.random() * 0.08, color: colors[i % colors.length], g: 14, drag: 0.6, spin: 10, flat: 0.35 });
    }
    for (let i = 0; i < 16; i++) {
      emit(p, { v: new THREE.Vector3(rand(4), 5 + Math.random() * 6, rand(4)), life: 1.3 + Math.random() * 0.5, size: 0.2, color: COIN[i % COIN.length], g: 16, drag: 0.4, spin: 12, flat: 0.22 });
    }
    sparks(p, 10);
  }
  // Конфетти дождём сверху (победа): вокруг точки, медленно планирует.
  function confetti(p, n = 60, colors = [0xffd21a, 0xff4d8d, 0x5cc4ff, 0x6dffa8, 0xb45cff, 0xffffff]) {
    for (let i = 0; i < n; i++) {
      emit(p.clone().add(new THREE.Vector3(rand(7), 6 + Math.random() * 6, rand(7))), { v: new THREE.Vector3(rand(1.2), -1 - Math.random(), rand(1.2)), life: 3 + Math.random() * 1.5, size: 0.12 + Math.random() * 0.06, color: colors[i % colors.length], g: 0.6, drag: 0.3, spin: 7, flat: i % 3 ? 0.15 : 0.6 });
    }
  }

  function updateParts(dt) {
    let n = 0, np = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const f = parts[i];
      f.age += dt;
      if (f.age >= f.life) { parts.splice(i, 1); continue; }
    }
    for (const f of parts) {
      f.v.y -= f.g * dt;
      if (f.drag) f.v.multiplyScalar(Math.max(0, 1 - f.drag * dt));
      f.p.addScaledVector(f.v, dt);
      f.rot.x += f.spin * dt; f.rot.y += f.spin * 0.7 * dt;
      const k = f.age / f.life;
      // обычные — к концу уменьшаются; пыль (grow) — растёт, потом сходит на нет
      const s = f.grow ? (f.size + f.grow * k) * (k > 0.6 ? (1 - k) / 0.4 : 1) : f.size * (k > 0.7 ? (1 - k) / 0.3 : 1);
      M.compose(f.p, Q.setFromEuler(E.set(f.rot.x, f.rot.y, 0)), S.set(s, s * (f.grow ? 0.8 : f.flat || 1), s));
      if (f.grow) {
        if (np >= PCAP / 2) continue;
        puffMesh.setMatrixAt(np, M); puffMesh.setColorAt(np, f.color); np++;
      } else { pMesh.setMatrixAt(n, M); pMesh.setColorAt(n, f.color); n++; }
    }
    pMesh.count = n;
    puffMesh.count = np;
    if (n) { pMesh.instanceMatrix.needsUpdate = true; pMesh.instanceColor.needsUpdate = true; }
    if (np) { puffMesh.instanceMatrix.needsUpdate = true; puffMesh.instanceColor.needsUpdate = true; }
  }

  // ---------- Следы от пуль ----------
  const holeTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(10,10,12,1)'); gr.addColorStop(0.35, 'rgba(25,22,20,.95)'); gr.addColorStop(0.6, 'rgba(60,50,40,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const dMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), DCAP);
  dMesh.frustumCulled = false;
  dMesh.count = DCAP;
  dMesh.renderOrder = 1;
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < DCAP; i++) dMesh.setMatrixAt(i, ZERO);
  scene.add(dMesh);
  const decals = new Array(DCAP).fill(null);    // ключ детали под следом (чтобы убрать, когда её сломали)
  let dNext = 0;
  const Z = new THREE.Vector3(0, 0, 1);
  function hole(p, normal, key = null) {
    const i = dNext; dNext = (dNext + 1) % DCAP;
    Q.setFromUnitVectors(Z, normal);
    const s = 0.16 + Math.random() * 0.06;
    M.compose(p.clone().addScaledVector(normal, 0.01), Q, S.set(s, s, 1));
    dMesh.setMatrixAt(i, M);
    dMesh.instanceMatrix.needsUpdate = true;
    decals[i] = key;
  }
  function clearHoles(key) {
    let any = false;
    for (let i = 0; i < DCAP; i++) {
      if (key !== undefined && decals[i] !== key) continue;
      dMesh.setMatrixAt(i, ZERO); decals[i] = null; any = true;
    }
    if (any) dMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- Числа урона ----------
  const layer = document.createElement('div');
  layer.id = 'dmgnums';
  document.body.appendChild(layer);
  const nums = [];
  const V = new THREE.Vector3();
  function number(p, value, kind = 'hp') {
    if (nums.length >= NCAP) { nums[0].el.remove(); nums.shift(); }
    const el = document.createElement('b');
    el.className = `dn ${kind}${value >= 50 ? ' big' : ''}`;
    el.dataset.pop = /head/.test(kind) ? 2.2 : value >= 50 ? 1.9 : 1.6;
    el.textContent = value;
    layer.appendChild(el);
    nums.push({ el, p: p.clone().add(new THREE.Vector3(rand(0.5), 0.2 + Math.random() * 0.4, rand(0.5))), age: 0, dx: rand(40) });
  }
  function updateNums(dt) {
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i];
      n.age += dt;
      if (n.age > 1.05) { n.el.remove(); nums.splice(i, 1); continue; }
      V.copy(n.p).project(camera);
      if (V.z > 1) { n.el.style.opacity = 0; continue; }
      // вылет: резко крупно → «отскок» до нормального, потом всплывает вверх и тает
      const rise = 1 - (1 - Math.min(1, n.age / 0.9)) ** 2;
      const x = (V.x * 0.5 + 0.5) * innerWidth + n.dx * rise, y = (-V.y * 0.5 + 0.5) * innerHeight - 70 * rise;
      const big = +n.el.dataset.pop, k = Math.min(1, n.age / 0.14);
      const pop = n.age < 0.14 ? big - (big - 0.9) * k * k : n.age < 0.22 ? 0.9 + (n.age - 0.14) / 0.08 * 0.1 : 1 - Math.max(0, n.age - 0.75) * 0.6;
      n.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      n.el.style.opacity = n.age > 0.75 ? ((1.05 - n.age) / 0.3).toFixed(2) : 1;
    }
  }

  return {
    chips, sparks, debris, dust, heal, hole, clearHoles, number, pop, confetti,
    update(dt) { updateParts(dt); updateNums(dt); },
    reset() { parts.length = 0; pMesh.count = 0; puffMesh.count = 0; clearHoles(); for (const n of nums) n.el.remove(); nums.length = 0; },
  };
}
