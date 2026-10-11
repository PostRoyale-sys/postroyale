// Батуты: грибы-подкидыши у городов и по острову. Наступил — подбрасывает на ~17 м и чуть вперёд;
// в верхней точке можно раскрыть парашют (canRedeploy в main.js) и улететь далеко. Места — от сида мира
// (у всех одинаковые), только на открытой ровной земле вне построек.

import * as THREE from 'three';
import { MAP, WATER_Y, rng, seedOf } from './map.js';
import { toon, outlineGroup } from './art.js';

export const PAD_R = 1.25, PAD_VY = 32, PAD_PUSH = 7;
const PER_POI = 2, EXTRA = 6;

// Гриб: ножка, мягкая шляпка в полоску (фиолетовая с жёлтым кольцом), светящаяся стрелка вверх.
function padModel() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.5, 16), toon(0x3a2f5c));
  stem.position.y = 0.25;
  const cap = new THREE.Group();
  cap.position.y = 0.5;
  const top = new THREE.Mesh(new THREE.SphereGeometry(PAD_R, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x9b5cff, { emissive: 0x2a0f5c }));
  top.scale.y = 0.38;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PAD_R * 0.98, 0.11, 8, 32), toon(0xffd21a, { emissive: 0x5a3a00 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.04;
  cap.add(top, rim);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.55, 4), new THREE.MeshBasicMaterial({ color: 0x6dffa8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  arrow.position.y = 1.3;
  g.add(stem, cap, arrow);
  outlineGroup(g);
  g.userData = { cap, arrow };
  return g;
}

export function createPads(scene) {
  const list = [];             // { x, y, z, group, squash }
  const root = new THREE.Group();
  scene.add(root);

  return {
    get list() { return list; },
    // Новый мир: расставить заново (нужны карта и постройки — проверка «чисто ли вокруг»).
    load(world, structures) {
      for (const p of list) root.remove(p.group);
      list.length = 0;
      const rand = rng(seedOf(world.id) ^ 0x7ad5);
      const ok = (x, z) => {
        if (x < 12 || z < 12 || x > MAP - 12 || z > MAP - 12) return null;
        const h = world.height(x, z);
        if (h < WATER_Y + 1.5) return null;
        if (Math.abs(world.height(x + 1.5, z) - h) + Math.abs(world.height(x, z + 1.5) - h) > 0.9) return null;   // ровно
        const g = structures.ground(x, z, h + 30);
        if (Math.abs(g - h) > 0.2 || structures.blocked(x, h + 0.1, z, 2, 1.5)) return null;               // не на крыше и не в стене/дереве
        if (list.some((p) => Math.hypot(p.x - x, p.z - z) < 14)) return null;
        return h;
      };
      const tryPlace = (cx, cz, r0, r1, n) => {
        for (let i = 0, got = 0; i < 80 && got < n; i++) {
          const a = rand() * Math.PI * 2, d = r0 + rand() * (r1 - r0);
          const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = ok(x, z);
          if (y === null) continue;
          const group = padModel();
          group.position.set(x, y, z);
          root.add(group);
          list.push({ x, y, z, group, squash: 0 });
          got++;
        }
      };
      for (const p of world.pois || []) tryPlace(p.x, p.z, 14, 34, PER_POI);
      tryPlace(MAP / 2, MAP / 2, 10, MAP * 0.42, EXTRA);
    },
    // Батут под ногами (стоишь на шляпке).
    under(feet) {
      for (const p of list) if (Math.hypot(feet.x - p.x, feet.z - p.z) < PAD_R + 0.15 && feet.y - p.y > -0.3 && feet.y - p.y < 1.4) return p;
      return null;
    },
    // Высота шляпки (на неё можно встать).
    top: (p) => p.y + 0.95,
    bounce(p) { p.squash = 1; },
    update(dt, t) {
      for (const p of list) {
        const u = p.group.userData;
        // «пружина» после прыжка: сплющилась → подскочила → успокоилась
        if (p.squash > 0) p.squash = Math.max(0, p.squash - dt * 2.2);
        const k = p.squash, s = 1 - Math.sin(k * Math.PI * 3) * k * 0.35;
        u.cap.scale.set(1 + (1 - s) * 0.6, s, 1 + (1 - s) * 0.6);
        u.arrow.position.y = 1.3 + Math.sin(t * 3 + p.x) * 0.15;
        u.arrow.rotation.y = t * 1.5;
      }
    },
  };
}
