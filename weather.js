// Погода раунда: дождь — косые струи вокруг камеры (одна отрисовка, LineSegments), изредка гроза
// (вспышка и раскат — их делает main.js по событию из update). Сам выбор погоды — в roundMood (main.js).

import * as THREE from 'three';

const N = 1800, BOX = 44, H = 30, SPEED = 24, LEN = 0.9;
const WIND = new THREE.Vector3(2.5, 0, 1.2);         // снос струй ветром (м/с)

export function createWeather(scene) {
  const pos = new Float32Array(N * 6);
  const drops = new Float32Array(N * 3);             // мировые x, y, z; коробка BOX×H×BOX переносится за камерой
  let seeded = false;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xdde5f5, transparent: true, opacity: 0.5, depthWrite: false }));
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);
  const dir = WIND.clone().add(new THREE.Vector3(0, -SPEED, 0)).normalize().multiplyScalar(LEN);
  let kind = 'clear', nextBolt = 0;

  return {
    get kind() { return kind; },
    set(k) { kind = k; rain.visible = k === 'rain'; seeded = false; nextBolt = performance.now() / 1000 + 8 + Math.random() * 10; },
    // Возвращает 'bolt', когда пора ударить молнии.
    update(dt, cam) {
      if (kind !== 'rain') return null;
      const fall = SPEED * dt, lo = cam.y - H * 0.45;
      if (!seeded) {
        seeded = true;
        for (let i = 0; i < N; i++) { drops[i * 3] = cam.x + (Math.random() - 0.5) * BOX; drops[i * 3 + 1] = lo + Math.random() * H; drops[i * 3 + 2] = cam.z + (Math.random() - 0.5) * BOX; }
      }
      for (let i = 0; i < N; i++) {
        let x = drops[i * 3] + WIND.x * dt, y = drops[i * 3 + 1] - fall, z = drops[i * 3 + 2] + WIND.z * dt;
        // вышла из коробки вокруг камеры — переносим на другую сторону (капли стоят в мире, а не едут с тобой)
        if (x - cam.x > BOX / 2) x -= BOX; else if (cam.x - x > BOX / 2) x += BOX;
        if (z - cam.z > BOX / 2) z -= BOX; else if (cam.z - z > BOX / 2) z += BOX;
        if (y < lo) y += H; else if (y > lo + H) y -= H;
        drops[i * 3] = x; drops[i * 3 + 1] = y; drops[i * 3 + 2] = z;
        const j = i * 6;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z; pos[j + 3] = x - dir.x; pos[j + 4] = y - dir.y; pos[j + 5] = z - dir.z;
      }
      geo.attributes.position.needsUpdate = true;
      const now = performance.now() / 1000;
      if (now > nextBolt) { nextBolt = now + 14 + Math.random() * 18; return 'bolt'; }
      return null;
    },
  };
}
