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
// 256×256, рисуются один раз: доски с волокнами, сучками и гвоздями; кирпич с раствором, сколами и зерном;
// профнастил с рёбрами, заклёпками и царапинами. Рисуем в координатах 64×64 (как раньше), мелочь — поверх.

let seedT = 1;
const r = () => { seedT = (seedT * 16807) % 2147483647; return seedT / 2147483647; };
const S = 64, RES = 256, K = RES / S;

function canvasTex(seed, fn) {
  seedT = seed;
  const c = document.createElement('canvas');
  c.width = c.height = RES;
  const g = c.getContext('2d');
  g.scale(K, K);
  fn(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function frame(g, k = 1) {
  g.strokeStyle = `rgba(0,0,0,${0.22 * k})`; g.lineWidth = 3; g.strokeRect(1.5, 1.5, S - 3, S - 3);
  g.strokeStyle = `rgba(255,255,255,${0.3 * k})`; g.lineWidth = 1.2; g.strokeRect(4, 4, S - 8, S - 8);
}
// мелкое зерно по всей текстуре (точки в 1/4 «пикселя»)
function grain(g, n, dark, light) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${dark * r()})` : `rgba(255,255,255,${light * r()})`;
    g.fillRect(r() * S, r() * S, 0.25 + r() * 0.5, 0.25 + r() * 0.5);
  }
}

const PAINT = {
  wood: (g) => {
    const rows = 4, hgt = S / rows;
    for (let i = 0; i < rows; i++) {
      const y0 = i * hgt, c = 238 - r() * 22;
      const gr = g.createLinearGradient(0, y0, 0, y0 + hgt);
      gr.addColorStop(0, `rgb(${c + 8},${c - 6},${c - 26})`); gr.addColorStop(0.5, `rgb(${c},${c - 14},${c - 34})`); gr.addColorStop(1, `rgb(${c - 14},${c - 30},${c - 50})`);
      g.fillStyle = gr; g.fillRect(0, y0, S, hgt);
      // волокна: длинные волнистые линии
      for (let k = 0; k < 9; k++) {
        const y = y0 + 1.5 + r() * (hgt - 3), amp = 0.4 + r() * 0.9, ph = r() * 6;
        g.strokeStyle = `rgba(${120 + r() * 40},${75 + r() * 30},35,${0.12 + r() * 0.16})`; g.lineWidth = 0.25 + r() * 0.35;
        g.beginPath();
        for (let x = 0; x <= S; x += 2) { const yy = y + Math.sin(x / (6 + r() * 0.2) + ph) * amp * 0.5; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
        g.stroke();
      }
      // сучок с кольцами
      if (r() < 0.8) {
        const kx = 8 + r() * 48, ky = y0 + 4 + r() * (hgt - 8);
        for (let q = 3; q >= 1; q--) { g.strokeStyle = `rgba(110,65,30,${0.18 + 0.1 * (3 - q)})`; g.lineWidth = 0.35; g.beginPath(); g.ellipse(kx, ky, q * 1.4, q * 0.7, 0, 0, Math.PI * 2); g.stroke(); }
        g.fillStyle = 'rgba(95,55,25,.55)'; g.beginPath(); g.ellipse(kx, ky, 1.1, 0.6, 0, 0, Math.PI * 2); g.fill();
      }
      // стык досок: тень снизу, блик сверху; гвозди на концах
      g.fillStyle = 'rgba(90,55,25,.5)'; g.fillRect(0, y0 + hgt - 1.1, S, 1.1);
      g.fillStyle = 'rgba(255,240,215,.35)'; g.fillRect(0, y0, S, 0.6);
      for (const nx of [4.5, S - 4.5]) {
        g.fillStyle = 'rgba(60,60,66,.75)'; g.beginPath(); g.arc(nx, y0 + hgt / 2, 0.75, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(nx - 0.25, y0 + hgt / 2 - 0.25, 0.28, 0, Math.PI * 2); g.fill();
      }
    }
    grain(g, 900, 0.12, 0.1);
    frame(g);
  },
  brick: (g) => {
    g.fillStyle = '#b9b1a6'; g.fillRect(0, 0, S, S);
    grain(g, 700, 0.22, 0.1);                                   // раствор — шершавый
    const rowH = 64 / 5;
    for (let row = 0; row < 5; row++) for (let col = -1; col < 4; col++) {
      const x = col * 22 + (row % 2) * 11, y = row * rowH, c = 236 + r() * 19, w = 19.4, h = rowH - 2.6;
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, `rgb(${c},${c - 3},${c - 8})`); gr.addColorStop(1, `rgb(${c - 16},${c - 22},${c - 30})`);
      g.fillStyle = gr; g.beginPath(); g.roundRect(x + 1.3, y + 1.3, w, h, 2.2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(x + 2.6, y + 1.9, w - 2.6, 0.9);      // фаска сверху
      g.fillStyle = 'rgba(70,50,40,.35)'; g.fillRect(x + 2, y + h + 0.3, w - 1.4, 0.9);       // тень снизу
      // пятна обжига и поры
      for (let k = 0; k < 7; k++) { g.fillStyle = `rgba(${r() < 0.6 ? '110,80,60' : '255,255,255'},${0.1 + r() * 0.14})`; g.beginPath(); g.arc(x + 2 + r() * (w - 2), y + 2 + r() * (h - 2), 0.2 + r() * 0.45, 0, Math.PI * 2); g.fill(); }
      // скол на углу
      if (r() < 0.35) { g.fillStyle = '#b9b1a6'; g.beginPath(); const cx = r() < 0.5 ? x + 1.3 : x + 1.3 + w, cy = r() < 0.5 ? y + 1.3 : y + 1.3 + h; g.arc(cx, cy, 1.4 + r() * 1.2, 0, Math.PI * 2); g.fill(); }
    }
    frame(g, 0.8);
  },
  metal: (g) => {
    // профнастил: вертикальные рёбра со светом и тенью
    const gr = g.createLinearGradient(0, 0, S, 0);
    for (let i = 0; i <= 16; i++) gr.addColorStop(i / 16, ['#f6f9fb', '#dfe6ee', '#c6d0db', '#e4ebf2'][i % 4]);
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    // горизонтальная планка посередине
    g.fillStyle = 'rgba(70,85,100,.35)'; g.fillRect(0, 29.5, S, 4);
    g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(0, 29.5, S, 0.8);
    // царапины и потёртости
    for (let i = 0; i < 26; i++) {
      const x = r() * S, y = r() * S, l = 2 + r() * 7, a = (r() - 0.5) * 0.8;
      g.strokeStyle = `rgba(${r() < 0.6 ? '255,255,255' : '60,70,85'},${0.15 + r() * 0.2})`; g.lineWidth = 0.2 + r() * 0.25;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // подтёки снизу (светлые, чтобы оттенок задавал экземпляр)
    for (let i = 0; i < 5; i++) {
      const x = 4 + r() * 56, y = 40 + r() * 6, h = 8 + r() * 14;
      const sg = g.createLinearGradient(0, y, 0, y + h); sg.addColorStop(0, 'rgba(150,110,80,.2)'); sg.addColorStop(1, 'rgba(150,110,80,0)');
      g.fillStyle = sg; g.fillRect(x, y, 1 + r() * 1.5, h);
    }
    // заклёпки с бликом
    for (const [x, y] of [[6, 6], [32, 6], [58, 6], [6, 58], [32, 58], [58, 58], [6, 31.5], [58, 31.5]]) {
      g.fillStyle = 'rgba(50,60,75,.55)'; g.beginPath(); g.arc(x + 0.3, y + 0.4, 1.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e9eef3'; g.beginPath(); g.arc(x, y, 1.45, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x - 0.45, y - 0.45, 0.5, 0, Math.PI * 2); g.fill();
    }
    grain(g, 500, 0.1, 0.12);
    frame(g, 1.2);
  },
};

const texCache = new Map();
export function buildTexture(kind) {
  if (!texCache.has(kind)) texCache.set(kind, canvasTex([...kind].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 2147483646 + 1, PAINT[kind]));
  return texCache.get(kind);
}

// ---------- Деталь рельефа ----------
// Одна бесшовная RGBA-текстура 256×256, в каждом канале — свой узор (128 = без изменений):
// R — трава (пучки и травинки), G — песок/снег (зерно и рябь), B — скалы (трещины и слои), A — дорога (гравий и колеи).
// В шейдере земли (terrainMaterial) смешивается по весам поверхности в вершинах — две выборки на пиксель.
let detailTex = null;
function terrainDetail() {
  if (detailTex) return detailTex;
  const N = 256, data = new Uint8Array(N * N * 4);
  seedT = 4242;
  // периодический value-noise (решётка per × per, обёрнутая по краям)
  const lattice = (per) => { const v = new Float32Array(per * per); for (let i = 0; i < v.length; i++) v[i] = r(); return v; };
  const noise = (lat, per, x, y) => {
    const fx = x * per / N, fy = y * per / N, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i, j) => lat[((j + per) % per) * per + ((i + per) % per)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const L4 = lattice(4), L8 = lattice(8), L16 = lattice(16), L32 = lattice(32), L64 = lattice(64);
  const fbm = (x, y) => noise(L8, 8, x, y) * 0.45 + noise(L16, 16, x, y) * 0.3 + noise(L32, 32, x, y) * 0.17 + noise(L64, 64, x, y) * 0.08;
  // трещины скал: расстояние до границы ячеек Вороного (точки на периодической сетке 6×6)
  const CP = 7, pts = [];
  for (let j = 0; j < CP; j++) for (let i = 0; i < CP; i++) pts.push([(i + r()) * N / CP, (j + r()) * N / CP]);
  const crack = (x, y) => {
    let d1 = 1e9, d2 = 1e9;
    for (const [px, py] of pts) for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const d = Math.hypot(x - px - ox, y - py - oy);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return d2 - d1;                                     // 0 — на трещине
  };
  const R = new Float32Array(N * N), Gs = new Float32Array(N * N), B = new Float32Array(N * N), A = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, f = fbm(x, y);
    R[i] = 0.5 + (f - 0.5) * 1.3 + (noise(L64, 64, x, y) - 0.5) * 0.35;
    Gs[i] = 0.5 + (noise(L32, 32, x, y) - 0.5) * 0.35 + Math.sin((x + y * 0.35 + noise(L4, 4, x, y) * 60) * PI2 / 32) * 0.08 + (r() - 0.5) * 0.28;
    // трещины: координаты искажены шумом (края волнистые), видна только часть границ, толщина плавает
    const wx = x + (noise(L16, 16, x, y) - 0.5) * 34, wy = y + (noise(L16, 16, y + 97, x + 31) - 0.5) * 34;
    const cd = crack(((wx % N) + N) % N, ((wy % N) + N) % N), on = Math.max(0, (noise(L8, 8, x + 50, y) - 0.42) * 4), wdt = 0.8 + noise(L32, 32, x, y) * 1.6;
    B[i] = 0.55 + (f - 0.5) * 0.9 + Math.sin((y + noise(L8, 8, x, y) * 50) * PI2 / 18) * 0.07 - Math.min(1, on) * Math.max(0, 1 - cd / wdt) * 0.4 + Math.min(1, on) * Math.max(0, 1 - Math.abs(cd - wdt - 1) / 1.2) * 0.07;
    A[i] = 0.5 + (noise(L32, 32, x, y) - 0.5) * 0.4 + (r() - 0.5) * 0.2;
  }
  // травинки: короткие тёмные и светлые штрихи (по диагонали, как пучки)
  for (let k = 0; k < 2600; k++) {
    let x = r() * N, y = r() * N; const len = 3 + r() * 6, dx = (r() - 0.5) * 0.8, dark = r() < 0.55, v = dark ? -0.42 : 0.34;
    for (let t = 0; t < len; t++, x += dx, y -= 1) {
      const k2 = v * (1 - t / len);
      R[(((y | 0) + N) % N) * N + (((x | 0) + N) % N)] += k2;
      R[(((y | 0) + N) % N) * N + (((x | 0) + 1 + N) % N)] += k2 * 0.5;
    }
  }
  // гравий: светлые и тёмные камушки 1–2 px
  for (let k = 0; k < 1800; k++) {
    const x = (r() * N) | 0, y = (r() * N) | 0, v = r() < 0.5 ? -0.3 : 0.25, sz = r() < 0.3 ? 2 : 1;
    for (let a = 0; a < sz; a++) for (let b = 0; b < sz; b++) A[((y + b) % N) * N + ((x + a) % N)] += v;
  }
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.max(0, Math.min(255, R[i] * 255));
    data[i * 4 + 1] = Math.max(0, Math.min(255, Gs[i] * 255));
    data[i * 4 + 2] = Math.max(0, Math.min(255, B[i] * 255));
    data[i * 4 + 3] = Math.max(0, Math.min(255, A[i] * 255));
  }
  detailTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.magFilter = THREE.LinearFilter;
  detailTex.minFilter = THREE.LinearMipmapLinearFilter;
  detailTex.generateMipmaps = true;
  detailTex.anisotropy = 8;
  detailTex.needsUpdate = true;
  return detailTex;
}
const PI2 = Math.PI * 2;

// Материал земли: цвет вершин × деталь по типу поверхности (атрибут surf: трава, песок, скала, дорога).
// Деталь в двух масштабах (6 м и 23 м — без заметного повтора), дальше 70–170 м сходит на нет.
export function terrainMaterial() {
  const mat = toon(0xffffff, { vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: terrainDetail() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 surf;\nvarying vec4 vSurf;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying vec4 vSurf;\nvarying vec3 vWPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec4 d = texture2D(uDetail, vWPos.xz / 6.0) * 0.62 + texture2D(uDetail, vWPos.zx / 23.0 + 0.37) * 0.38;
          vec4 w = vSurf / max(dot(vSurf, vec4(1.0)), 1e-3);
          vec3 kG = mix(vec3(0.74, 0.82, 0.8), vec3(1.26, 1.18, 0.96), d.r);   // трава: тёмные пучки ↔ светлая подсохшая
          vec3 kS = vec3(0.8 + 0.4 * d.g);
          vec3 kR = vec3(0.6 + 0.8 * d.b);
          vec3 kD = vec3(0.7 + 0.6 * d.a);
          vec3 k = kG * w.x + kS * w.y + kR * w.z + kD * w.w;
          float fade = 1.0 - smoothstep(70.0, 170.0, length(vWPos - cameraPosition));
          diffuseColor.rgb *= mix(vec3(1.0), k, fade);
        }`);
  };
  mat.customProgramCacheKey = () => 'terrain-detail';
  return mat;
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
