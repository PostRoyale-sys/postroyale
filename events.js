// События раунда без сети: «Pump»-зона — на PUMP_FROM…PUMP_TO секунде раунда в зоне шторма загорается зелёный круг,
// внутри которого твой урон ×PUMP_MULT. Место и время — от сида мира и номера раунда, поэтому у всех одинаковые.

import * as THREE from 'three';
import { MAP, WATER_Y, rng, seedOf } from './map.js';

export const PUMP_FROM = 100, PUMP_TO = 135, PUMP_R = 16, PUMP_MULT = 1.3;

export function createEvents(ctx) {
  const { scene } = ctx;
  let pump = null;              // { x, z, y }
  let state = 0;                // 0 — ещё нет, 1 — идёт, 2 — кончилась

  // Кольцо на земле, светящийся столб-«свеча» вверх и стрелки, всплывающие внутри.
  const group = new THREE.Group();
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(PUMP_R, PUMP_R, 14, 48, 1, true), new THREE.ShaderMaterial({
    ...add,
    uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT; varying vec2 vUv;
      void main(){
        float fade = pow(1.0 - vUv.y, 2.2);
        float bands = 0.55 + 0.45 * sin(vUv.y * 30.0 - uT * 4.0);
        gl_FragColor = vec4(vec3(0.1, 0.75, 0.35) * (0.55 + 0.45 * bands), fade * 0.32);
      }`,
  }));
  wall.position.y = 7;
  const ring = new THREE.Mesh(new THREE.RingGeometry(PUMP_R - 0.6, PUMP_R, 64), new THREE.MeshBasicMaterial({ ...add, color: 0x6dffa8, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  const arrowGeo = new THREE.ConeGeometry(0.5, 1.1, 4);
  const arrowMat = new THREE.MeshBasicMaterial({ ...add, color: 0x3fd47a, opacity: 0.7 });
  const arrows = [];
  for (let i = 0; i < 14; i++) {
    const a = new THREE.Mesh(arrowGeo, arrowMat);
    a.userData = { ang: Math.random() * 6.28, d: Math.sqrt(Math.random()) * (PUMP_R - 2), ph: Math.random() };
    arrows.push(a);
    group.add(a);
  }
  group.add(wall, ring);
  group.visible = false;
  scene.add(group);

  return {
    resetRound(r) {
      state = 0;
      group.visible = false;
      pump = null;
      if (ctx.isDuel?.()) return;
      const w = ctx.world(), rs = ctx.royale(), z0 = rs.zoneAt((PUMP_FROM + PUMP_TO) / 2);
      const rand = rng(seedOf(w.id) ^ 0x9a3b ^ Math.imul(r + 5, 2246822519));
      for (let i = 0; i < 60 && !pump; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * Math.max(0, z0.r - PUMP_R) * 0.8;
        const x = z0.x + Math.cos(a) * d, z = z0.z + Math.sin(a) * d;
        if (x > 10 && z > 10 && x < MAP - 10 && z < MAP - 10 && w.surfaceY(Math.floor(x), Math.floor(z)) > WATER_Y + 1) pump = { x, z, y: w.height(x, z) };
      }
      pump ||= { x: z0.x, z: z0.z, y: w.height(z0.x, z0.z) };
      group.position.set(pump.x, pump.y, pump.z);
    },
    // Сейчас идёт и точка внутри (по горизонтали).
    inPump(p) { return state === 1 && !!pump && Math.hypot(p.x - pump.x, p.z - pump.z) < PUMP_R; },
    get active() { return state === 1; },
    get pump() { return pump; },
    marks() { return pump && state === 1 ? [{ kind: 'pump', x: pump.x, z: pump.z, r: PUMP_R }] : []; },
    update(dt, sec) {
      if (!pump) return;
      const st = sec < PUMP_FROM ? 0 : sec < PUMP_TO ? 1 : 2;
      if (st !== state) { const was = state; state = st; if (st === 1 || was === 1) ctx.onPump?.(st === 1 ? 'start' : 'end'); }
      group.visible = state === 1;
      if (!group.visible) return;
      const t = performance.now() / 1000;
      wall.material.uniforms.uT.value = t;
      ring.material.opacity = 0.7 + Math.sin(t * 5) * 0.25;
      for (const a of arrows) {
        const u = a.userData, k = (t * 0.35 + u.ph) % 1;
        a.position.set(Math.cos(u.ang) * u.d, 0.5 + k * 9, Math.sin(u.ang) * u.d);
        a.scale.setScalar(k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1);
      }
    },
  };
}
