// Вертолёт высадки в криптостиле: золотой корпус с эмблемой ₿, фиолетовые хвост и полосы, неоновые огни,
// крутящиеся винты и баннер «WAGMI 🚀» на тросе. Нос смотрит в −Z (как и всё в игре).

import * as THREE from 'three';
import { toon } from './art.js';

// Текстура-надпись на прозрачном фоне.
function label(draw, w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const coinTex = () => label((g, w, h) => {
  const r = w / 2 - 6;
  const grd = g.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, r);
  grd.addColorStop(0, '#fff2a8'); grd.addColorStop(0.6, '#ffc21a'); grd.addColorStop(1, '#c97a00');
  g.fillStyle = grd; g.beginPath(); g.arc(w / 2, h / 2, r, 0, 7); g.fill();
  g.lineWidth = 10; g.strokeStyle = '#8a4a00'; g.stroke();
  g.fillStyle = '#7a3a00'; g.font = '900 150px Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('₿', w / 2 + 4, h / 2 + 8);
});

const bannerTex = () => label((g, w, h) => {
  g.fillStyle = '#7a2fd6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffd21a'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14);
  g.fillStyle = '#fff'; g.font = '900 92px Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('WAGMI 🚀', w / 2, h / 2 + 4);
}, 640, 160);

export function buildHeli() {
  const g = new THREE.Group();
  const gold = toon(0xffc928, { emissive: 0x3a2400 }), purple = toon(0x8b5cff, { emissive: 0x1a0a40 }), dark = toon(0x23262d), white = toon(0xf2f2f2);
  const neon = new THREE.MeshBasicMaterial({ color: 0x5dff9a });

  // корпус и кабина
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), gold);
  body.scale.set(1.7, 1.45, 2.7);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshToonMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.7, emissive: 0x0a3050 }));
  glass.scale.set(1.35, 1.05, 1.3);
  glass.position.set(0, 0.35, -1.75);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.12, 8, 32), purple);
  stripe.rotation.y = Math.PI / 2;
  stripe.scale.set(1, 0.9, 1.65);
  g.add(body, glass, stripe);

  // эмблемы ₿ по бокам
  const coin = new THREE.MeshBasicMaterial({ map: coinTex(), transparent: true });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32), coin);
    p.position.set(sx * 1.66, 0.1, 0.2);
    p.rotation.y = sx * Math.PI / 2;
    g.add(p);
  }

  // хвост, киль, хвостовой винт
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 4.6, 12), purple);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.35, 4.4);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.6, 1.0), gold);
  fin.position.set(0, 1.1, 6.4);
  const tailHub = new THREE.Group();
  tailHub.position.set(0.25, 1.1, 6.5);
  for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.18), dark); b.rotation.x = i * Math.PI / 2; tailHub.add(b); }
  g.add(boom, fin, tailHub);

  // главный винт: втулка, лопасти, полупрозрачный «размыв»
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 10), dark);
  mast.position.y = 1.65;
  const rotor = new THREE.Group();
  rotor.position.y = 2.0;
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.06, 0.38), dark); b.rotation.y = (i / 3) * Math.PI; rotor.add(b); }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(3.8, 40), new THREE.MeshBasicMaterial({ color: 0x23262d, transparent: true, opacity: 0.12, depthWrite: false }));
  blur.rotation.x = -Math.PI / 2;
  blur.position.y = 2.0;
  g.add(mast, rotor, blur);

  // полозья
  for (const sx of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.2, 8), white);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(sx * 1.1, -1.6, 0);
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 6), white); s1.position.set(sx * 1.05, -1.35, -0.9);   // стойки — ниже пола салона s1.rotation.z = sx * 0.3;
    const s2 = s1.clone(); s2.position.z = 0.9;
    g.add(skid, s1, s2);
  }

  // неоновые огни: полоса снизу и огоньки на концах
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.6), neon);
  glow.position.set(0, -1.38, 0);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3bd0 }));
  tip.position.set(0, 1.95, 6.9);
  g.add(glow, tip);

  // трос и баннер «WAGMI 🚀»
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 4), dark);
  rope.rotation.x = Math.PI / 2 - 0.25;
  rope.position.set(0, -0.6, 8.6);
  // две плоскости спиной к спине — надпись читается правильно с обеих сторон
  const bannerGeo = new THREE.PlaneGeometry(5.6, 1.4, 12, 1), bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex() });
  const banner = new THREE.Group();
  const front = new THREE.Mesh(bannerGeo, bannerMat), back = new THREE.Mesh(bannerGeo, bannerMat);
  back.rotation.y = Math.PI;
  banner.add(front, back);
  banner.position.set(0, -1.1, 13.4);
  banner.rotation.y = Math.PI / 2;
  g.add(rope, banner);

  g.userData.shell = [body, glass, stripe];      // корпус — прячется, когда смотришь изнутри
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  const base = bannerGeo.attributes.position.array.slice();
  g.userData.tick = (t) => {
    rotor.rotation.y = t * 22;
    tailHub.rotation.x = t * 30;
    tip.visible = Math.sin(t * 6) > 0;
    // баннер колышется
    const p = bannerGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(t * 5 + base[i * 3] * 0.9) * 0.25 * ((base[i * 3] + 3.5) / 7));
    p.needsUpdate = true;
  };
  return g;
}

// Парашют в фирменных цветах: купол из золотых и фиолетовых клиньев, ₿ на макушке, стропы к плечам.
// Начало координат — ноги персонажа; купол висит над головой.
// Скины парашюта (вкладка Locker, за монеты): цвета клиньев купола. Первый — бесплатный.
export const CHUTES = [
  { id: 'classic', name: 'Degen Gold', price: 0, a: 0xffc928, b: 0x8b5cff },
  { id: 'pepe', name: 'Pepe Glide', price: 150, a: 0x4fc26a, b: 0xffe14a },
  { id: 'rug', name: 'Rug Pull', price: 200, a: 0xc0392b, b: 0xf2c14e },
  { id: 'whale', name: 'Whale Wave', price: 200, a: 0x2f7fff, b: 0xf4f8ff },
  { id: 'neon', name: 'Neon Degen', price: 300, a: 0xff4fd8, b: 0x1a1030 },
  { id: 'diamond', name: 'Diamond Hands', price: 400, a: 0x8ff0ff, b: 0xffffff, stripes: 12 },
];
export const chuteById = (id) => CHUTES.find((c) => c.id === id) || CHUTES[0];

export function buildParachute(skin = 'classic') {
  const sk = chuteById(skin);
  const g = new THREE.Group();
  const R = 2.7, H = 1.5, Y = 4.4;
  const geo = new THREE.SphereGeometry(1, 24, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).toNonIndexed();
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const gold = new THREE.Color(sk.a), purple = new THREE.Color(sk.b);
  for (let i = 0; i < pos.count; i += 3) {
    // цвет клина — по углу центра треугольника
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const k = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * (sk.stripes || 8)) % 2;
    const c = k ? gold : purple;
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.scale(R, H / Math.sin(Math.PI * 0.5), R);
  geo.computeVertexNormals();
  const canopy = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
  canopy.position.y = Y - H * 0.55;
  canopy.castShadow = true;
  const coin = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ map: coinTex(), transparent: true, side: THREE.DoubleSide }));
  coin.rotation.x = -Math.PI / 2;
  coin.position.y = Y - H * 0.55 + H + 0.02;
  // стропы: от кромки купола к плечам
  const rimY = Y - H * 0.55 + Math.cos(Math.PI * 0.42) * H;
  const rimR = R * Math.sin(Math.PI * 0.42);
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR), new THREE.Vector3(i < 4 ? 0.32 : -0.32, 1.5, 0));
  }
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x23262d }));
  g.add(canopy, coin, lines);
  g.userData.canopy = canopy;
  g.userData.skin = sk.id;
  return g;
}

// Салон для вида от первого лица (как в Call of Duty): пол с жёлто-чёрной разметкой, потолок с красной
// лампой и поручнем, открытые боковые двери, лавки, приборная панель, пилоты и пара бойцов.
// Виден только тому, кто сидит внутри (снаружи — обычный корпус). makeChar(i) → фигурка персонажа.
// Начало координат — как у вертолёта; SEAT_EYE — где глаза игрока: сидит на краю правой открытой двери
// (откуда прыгать), лицом наружу — весь остров как на ладони.
export const SEAT_EYE = new THREE.Vector3(1.12, -0.2, 0.1);
export function buildCabin(makeChar, animate, scale = 1) {
  const g = new THREE.Group();
  const metal = toon(0x3a3f4a), dark = toon(0x1e2128), seat = toon(0x5a4632), olive = toon(0x4b5240);
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  const FY = -0.95, CY = 0.95, W = 1.42;
  // пол и потолок
  box(W * 2, 0.06, 4.3, metal, 0, FY - 0.03, -0.15);
  box(W * 2, 0.05, 4.0, dark, 0, CY + 0.03, 0);
  // жёлто-чёрная разметка у дверных проёмов
  const stripeTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 16;
    const x = c.getContext('2d'); x.fillStyle = '#ffc928'; x.fillRect(0, 0, 128, 16); x.fillStyle = '#16181d';
    for (let i = -16; i < 128; i += 16) { x.beginPath(); x.moveTo(i, 16); x.lineTo(i + 8, 16); x.lineTo(i + 16, 0); x.lineTo(i + 8, 0); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.16), new THREE.MeshBasicMaterial({ map: stripeTex }));
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    m.position.set(sx * (W - 0.1), FY + 0.005, 0);
    g.add(m);
  }
  // стены: позади двери и впереди двери; над проёмом — балка
  for (const sx of [-1, 1]) {
    box(0.06, CY - FY, 1.05, olive, sx * W, 0, 1.42);
    box(0.06, CY - FY, 0.75, olive, sx * W, 0, -1.28);
    box(0.08, 0.16, 1.8, dark, sx * W, CY - 0.08, 0);
    // стойки дверного проёма
    for (const z of [-0.9, 0.9]) box(0.1, CY - FY, 0.08, dark, sx * (W - 0.02), 0, z);
  }
  box(W * 2, CY - FY, 0.06, olive, 0, 0, 1.95);                // задняя стенка
  // задняя лавка (наша) и боковые лавки впереди
  box(1.3, 0.06, 0.4, seat, 0, FY + 0.27, 1.65); box(1.3, 0.5, 0.05, seat, 0, FY + 0.6, 1.9);
  for (const sx of [-1, 1]) box(0.35, 0.06, 0.5, seat, sx * 1.18, FY + 0.27, -1.15);
  // поручень и красная лампа
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.2, 6), toon(0x9aa0aa));
  rail.rotation.x = Math.PI / 2; rail.position.set(0, CY - 0.12, 0); g.add(rail);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.12), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  lamp.position.set(0, CY - 0.02, 0.9); g.add(lamp);
  // приборная панель с экранами
  box(2.2, 0.32, 0.3, dark, 0, -0.25, -2.25);
  const screen = new THREE.MeshBasicMaterial({ color: 0x5dff9a });
  for (const x of [-0.7, -0.25, 0.25, 0.7]) { const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.17), screen); sc.position.set(x, -0.16, -2.09); sc.rotation.x = -0.35; g.add(sc); }
  // рамка лобового стекла
  for (const x of [-0.75, 0, 0.75]) box(0.05, 0.9, 0.05, dark, x, 0.4, -2.35 + Math.abs(x) * 0.35);
  // пилоты (спиной к нам) и два бойца на боковых лавках лицом друг к другу
  const people = [];
  const seatTop = FY + 0.3;
  const put = (i, x, z, yaw) => {
    const c = makeChar(i);
    c.scale.setScalar(1 / scale);                // вертолёт масштабирован — люди остаются в натуральную величину
    c.position.set(x, seatTop - 0.62 / scale, z);
    c.rotation.y = yaw;
    g.add(c); people.push(c);
  };
  put(0, -0.55, -1.75, 0); put(1, 0.55, -1.75, 0);
  box(0.4, 0.06, 0.4, seat, -0.55, FY + 0.27, -1.75); box(0.4, 0.06, 0.4, seat, 0.55, FY + 0.27, -1.75);
  put(2, -1.18, -1.15, -Math.PI / 2); put(3, -0.35, 1.65, 0);
  g.userData.tick = (t) => {
    for (let i = 0; i < people.length; i++) animate(people[i], t + i * 1.3, 'sit');
    lamp.material.color.setHex(Math.sin(t * 2.5) > -0.2 ? 0xff2a2a : 0x661010);
  };
  g.visible = false;
  return g;
}
