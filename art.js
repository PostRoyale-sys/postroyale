// Графика: мультяшные (cel) материалы, текстуры стройматериалов, модели деревьев, камней, кустов и машин.
// Модели собираются из простых фигур в одну геометрию с цветами вершин — каждый вид рисуется одним InstancedMesh.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Ступенчатый свет для cel-затенения: 4 тона.
let ramp = null;
export function toonGradient() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 175, 175, 175, 255, 225, 225, 225, 255, 255, 255, 255, 255]), 4, 1);
    ramp.magFilter = ramp.minFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return ramp;
}
export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });

// ---------- Текстуры стройматериалов (светлые — цвет задаёт тон экземпляра) ----------

let seedT = 1;
const r = () => { seedT = (seedT * 16807) % 2147483647; return seedT / 2147483647; };
const S = 64;

function canvasTex(seed, fn) {
  seedT = seed;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  fn(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function frame(g, k = 1) {
  g.strokeStyle = `rgba(0,0,0,${0.22 * k})`; g.lineWidth = 4; g.strokeRect(2, 2, S - 4, S - 4);
  g.strokeStyle = `rgba(255,255,255,${0.35 * k})`; g.lineWidth = 2; g.strokeRect(5, 5, S - 10, S - 10);
}

const PAINT = {
  wood: (g) => {
    for (let i = 0; i < 4; i++) {
      const c = 236 - r() * 18;
      g.fillStyle = `rgb(${c},${c - 14},${c - 34})`; g.fillRect(0, i * 16, S, 16);
      g.fillStyle = 'rgba(120,80,40,.35)'; g.fillRect(0, i * 16 + 14, S, 2);
      g.strokeStyle = 'rgba(150,100,50,.18)'; g.lineWidth = 1;
      for (let k = 0; k < 3; k++) { const y = i * 16 + 3 + r() * 9; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(20, y + 2, 40, y - 2, S, y + 1); g.stroke(); }
      g.fillStyle = 'rgba(110,70,35,.45)'; g.beginPath(); g.arc(8 + r() * 48, i * 16 + 7, 1.6, 0, Math.PI * 2); g.fill();
    }
    frame(g);
  },
  brick: (g) => {
    g.fillStyle = '#d9d4cc'; g.fillRect(0, 0, S, S);
    for (let row = 0; row < 5; row++) for (let col = -1; col < 4; col++) {
      const x = col * 22 + (row % 2) * 11, y = row * 13, c = 238 + r() * 17;
      g.fillStyle = `rgb(${c},${c - 4},${c - 10})`; g.beginPath(); g.roundRect(x + 1.5, y + 1.5, 19, 10, 3); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 3, y + 2.5, 15, 2);
    }
    frame(g, 0.8);
  },
  metal: (g) => {
    const gr = g.createLinearGradient(0, 0, S, 0);
    for (let i = 0; i <= 8; i++) gr.addColorStop(i / 8, i % 2 ? '#f4f7fa' : '#cfd8e2');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(70,85,100,.4)'; g.fillRect(0, 30, S, 3);
    g.fillStyle = 'rgba(60,70,85,.55)';
    for (const [x, y] of [[8, 8], [56, 8], [8, 56], [56, 56], [8, 24], [56, 40]]) { g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); }
    frame(g, 1.2);
  },
};

const texCache = new Map();
export function buildTexture(kind) {
  if (!texCache.has(kind)) texCache.set(kind, canvasTex([...kind].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 2147483646 + 1, PAINT[kind]));
  return texCache.get(kind);
}

// ---------- Модели из фигур с цветами вершин ----------

function part(geo, color, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const merged = (parts) => { const g = mergeGeometries(parts); g.computeBoundingSphere(); return g; };
export const vcMaterial = () => toon(0xffffff, { vertexColors: true });

const TRUNK = 0x8a5a33, LEAF = 0x5cc63c, LEAF2 = 0x49b035, PINE = 0x2f9a58;

// Лиственное дерево: ствол + три пухлых шара кроны. Высота ~6.5.
export function oakGeometry() {
  const ball = new THREE.IcosahedronGeometry(1, 1);
  return merged([
    part(new THREE.CylinderGeometry(0.32, 0.45, 3.6, 8), TRUNK, { y: 1.8 }),
    part(ball, LEAF, { y: 4.6, sx: 2.2, sy: 1.9, sz: 2.2 }),
    part(ball, LEAF2, { x: 1.2, y: 4.0, z: 0.5, sx: 1.5, sy: 1.4, sz: 1.5 }),
    part(ball, LEAF, { x: -1.0, y: 5.4, z: -0.6, sx: 1.4, sy: 1.3, sz: 1.4 }),
  ]);
}
// Ёлка: ствол + три конуса.
export function pineGeometry() {
  return merged([
    part(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 8), TRUNK, { y: 1.2 }),
    part(new THREE.ConeGeometry(2.3, 3, 9), PINE, { y: 3.4 }),
    part(new THREE.ConeGeometry(1.8, 2.6, 9), 0x37ad62, { y: 5.0 }),
    part(new THREE.ConeGeometry(1.2, 2.2, 9), 0x41bd6c, { y: 6.5 }),
  ]);
}
// Камень: гранёный, слегка неправильный. Масштаб экземпляра — размер.
export function rockGeometry() {
  // Сдвиг вершины зависит от её позиции — у совпадающих вершин соседних граней одинаковый, без щелей.
  const jitter = (geo) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1;
      p.setXYZ(i, x * (0.85 + h * 0.3), y * (0.75 + h * 0.2), z * (0.9 + h * 0.2));
    }
    geo.computeVertexNormals();
    return geo;
  };
  return merged([
    part(jitter(new THREE.IcosahedronGeometry(1, 0)), 0x9aa3ad, { y: 0.55 }),
    part(jitter(new THREE.IcosahedronGeometry(0.55, 0)), 0xb4bcc6, { x: 0.8, y: 0.35, z: 0.4 }),
  ]);
}
export function bushGeometry() {
  const ball = new THREE.IcosahedronGeometry(1, 1);
  return merged([
    part(ball, 0x4fbf3a, { y: 0.5, sx: 0.9, sy: 0.75, sz: 0.9 }),
    part(ball, 0x62cf46, { x: 0.6, y: 0.45, z: 0.2, sx: 0.65, sy: 0.6, sz: 0.65 }),
    part(ball, 0x45ad33, { x: -0.5, y: 0.4, z: -0.3, sx: 0.6, sy: 0.55, sz: 0.6 }),
  ]);
}
// Машина вдоль оси X: длина 4.2, ширина 2, высота ~1.8.
export function carGeometry(body) {
  const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
  const parts = [
    part(new THREE.BoxGeometry(4.2, 0.9, 2), body, { y: 0.85 }),
    part(new THREE.BoxGeometry(2.3, 0.75, 1.8), body, { x: -0.3, y: 1.65 }),
    part(new THREE.BoxGeometry(2.36, 0.5, 1.84), 0x9fdcff, { x: -0.3, y: 1.68 }),
    part(new THREE.BoxGeometry(0.15, 0.3, 1.6), 0xfff3b0, { x: 2.1, y: 0.95 }),
    part(new THREE.BoxGeometry(4.25, 0.2, 2.05), 0x3a3f4a, { y: 0.45 }),
  ];
  for (const [x, z] of [[1.35, 1], [1.35, -1], [-1.35, 1], [-1.35, -1]]) parts.push(part(wheel, 0x23262d, { x, y: 0.42, z, rx: Math.PI / 2 }));
  return merged(parts);
}

// ---------- Ветер и мультяшный контур ----------
// Ветер: время в общем uniform; качается то, что выше `from` по высоте модели (кроны, верх кустов).
export const windUniform = { value: 0 };
const swayChunk = (from) => `
  {
    vec3 wp = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
    float hh = max(0.0, position.y - ${from.toFixed(2)});
    transformed.x += sin(uWind * 1.3 + wp.x * 0.15 + wp.z * 0.1) * 0.07 * hh;
    transformed.z += cos(uWind * 1.1 + wp.z * 0.15 + wp.x * 0.05) * 0.05 * hh;
  }`;

function patch(mat, key, body) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// Материал с качанием (только для InstancedMesh — берёт позицию экземпляра).
export const swayMaterial = (mat, from = 2) => patch(mat, `sway${from}`, swayChunk(from));

// Контровой свет (rim) для персонажей: светлая кромка по силуэту — враг читается на фоне травы и стен.
// Цвет и сила общие (rimUniform) — их меняет время суток раунда.
export const rimUniform = { color: { value: new THREE.Color(0xfff2d8) }, power: { value: 0.45 } };
export function rimMaterial(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = rimUniform.color;
    sh.uniforms.uRim = rimUniform.power;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRim;')
      .replace('#include <opaque_fragment>', `{
        float rf = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        outgoingLight += uRimColor * pow(rf, 3.0) * uRim;
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'rim';
  return mat;
}

// Контур «обратной оболочкой»: задние грани, раздутые наружу, тёмно-фиолетовым.
// box — раздуваем по знаку координаты (у коробок без щелей на рёбрах), иначе — по нормали.
const OUTLINE = 0x1d1438;
export function outlineMaterial({ thick = 0.05, box = false, sway = null, instanced = true } = {}) {
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
  const grow = box ? `transformed += sign(position) * ${thick.toFixed(3)};` : `transformed += normalize(normal) * ${thick.toFixed(3)};`;
  return patch(m, `ol${thick}${box}${sway}${instanced}`, grow + (sway != null && instanced ? swayChunk(sway) : ''));
}

// Контур для InstancedMesh: тот же набор экземпляров (общий instanceMatrix), рисуется вторым проходом.
export function instancedOutline(mesh, opts) {
  const o = new THREE.InstancedMesh(mesh.geometry, outlineMaterial(opts), mesh.instanceMatrix.count);
  o.instanceMatrix = mesh.instanceMatrix;
  o.count = mesh.count;
  o.frustumCulled = false;
  o.castShadow = false;
  o.receiveShadow = false;
  return o;
}

// Контур для обычной группы (персонажи, вертолёт): каждому непрозрачному мешу — оболочка дочерним объектом.
export function outlineGroup(group, thick = 0.035) {
  const mat = outlineMaterial({ thick, instanced: false });
  const list = [];
  group.traverse((m) => { if (m.isMesh && !m.isInstancedMesh && !m.material.transparent && m.geometry.attributes.normal) list.push(m); });
  for (const m of list) {
    const o = new THREE.Mesh(m.geometry, mat);
    o.userData.outline = true;
    m.add(o);
  }
  return group;
}
