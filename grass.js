// Трава пучками вокруг игрока: один InstancedMesh, ~5000 пучков в радиусе RADIUS. Пересобирается, когда игрок
// отходит на REBUILD метров. Растёт только на траве (не песок, не скалы, не дороги и площади, не вода).
// Качание на ветру — в вершинном шейдере (верх травинки гнётся сильнее низа), процессор не тратится.

import * as THREE from 'three';
import { toonGradient } from './art.js';

const RADIUS = 30, STEP = 0.65, REBUILD = 8;
const MAX = Math.ceil((Math.PI * RADIUS * RADIUS) / (STEP * STEP)) + 200;

// Пучок: 5 узких треугольников веером, низ тёмный, кончики светлые.
function tuftGeometry() {
  const pos = [], col = [];
  const base = new THREE.Color(0x3f9a2c), tip = new THREE.Color(0xa6ec6a);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI + (i % 2) * 0.3;
    const h = 0.38 + (i % 3) * 0.1, w = 0.05;
    const lean = (i - 2) * 0.06;
    const cx = Math.cos(a) * w, cz = Math.sin(a) * w;
    pos.push(-cx, 0, -cz, cx, 0, cz, lean * Math.cos(a + 1.57), h, lean * Math.sin(a + 1.57));
    for (const c of [base, base, tip]) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // нормали вверх — трава освещается как земля, без тёмных изнанок
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

const hash = (x, z) => { let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function createGrass(scene) {
  const time = { value: 0 };
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float sway = sin(uTime * 1.8 + ip.x * 0.35 + ip.z * 0.25) + 0.5 * sin(uTime * 3.1 + ip.x * 0.9);
        transformed.x += sway * 0.09 * position.y * position.y * 4.0;
        transformed.z += cos(uTime * 1.5 + ip.z * 0.3) * 0.05 * position.y * position.y * 4.0;`);
  };
  const mesh = new THREE.InstancedMesh(tuftGeometry(), mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);

  let map = null, cx = Infinity, cz = Infinity;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  // Трава ли здесь: высота, уклон, не дорога и не площадь локации.
  function grassy(x, z) {
    const h = map.height(x, z);
    if (h < 2.8 || h > 28) return false;
    if (map.slope(x, z) > 0.7) return false;
    if (map.poiAt(x, z, 2)) return false;
    return map.roadDist(x, z) > 3.2;
  }

  function rebuild(x0, z0) {
    cx = x0; cz = z0;
    let n = 0;
    const r2 = RADIUS * RADIUS;
    const gx0 = Math.floor((x0 - RADIUS) / STEP), gx1 = Math.ceil((x0 + RADIUS) / STEP);
    const gz0 = Math.floor((z0 - RADIUS) / STEP), gz1 = Math.ceil((z0 + RADIUS) / STEP);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const r = hash(gx, gz);
      if (r < 0.18) continue;                              // проплешины
      const x = (gx + hash(gz, gx) ) * STEP, z = (gz + r) * STEP;
      if ((x - x0) ** 2 + (z - z0) ** 2 > r2 || !grassy(x, z)) continue;
      const s = 0.7 + hash(gx * 7, gz * 3) * 0.8;
      P.set(x, map.height(x, z) - 0.03, z);
      Q.setFromAxisAngle(UP, r * 6.283);
      S.set(s, s * (0.8 + r * 0.6), s);
      mesh.setMatrixAt(n++, M.compose(P, Q, S));
      if (n >= MAX) break;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    setMap(m) { map = m; cx = cz = Infinity; mesh.count = 0; },
    set visible(v) { mesh.visible = v; },
    get count() { return mesh.count; },
    update(pos, t) {
      time.value = t;
      if (!map || !mesh.visible) return;
      if (Math.hypot(pos.x - cx, pos.z - cz) > REBUILD) rebuild(pos.x, pos.z);
    },
  };
}
