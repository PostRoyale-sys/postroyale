// Сцена лобби: маленький травяной островок посреди моря, на нём стоит персонаж (на земле, не в воздухе).
// Вокруг — деревья, кусты, камни, золотой сундук, сзади на площадке — вертолёт высадки. За спиной персонажа
// в дымке виден остров матча. Островок стоит в стороне от карты (в «окне» между далёкими островами).

import * as THREE from 'three';
import { toon, vcMaterial, oakGeometry, pineGeometry, bushGeometry, rockGeometry, outlineGroup } from './art.js';
import { buildHeli } from './heli.js';

export const LOBBY_ANGLE = 1.4, LOBBY_DIST = 560;      // где островок относительно центра карты
const R = 26, TOP = 3;                                 // радиус островка и высота его верха над водой

export function createLobbyScene(scene, mapCenter) {
  const c = new THREE.Vector3(mapCenter + Math.cos(LOBBY_ANGLE) * LOBBY_DIST, 0, mapCenter + Math.sin(LOBBY_ANGLE) * LOBBY_DIST);
  // «наружу» — от карты к островку: камера стоит с этой стороны и смотрит на героя, за ним — остров матча
  const out = new THREE.Vector3(Math.cos(LOBBY_ANGLE), 0, Math.sin(LOBBY_ANGLE));
  const g = new THREE.Group();
  g.position.copy(c);
  // повернуть группу так, чтобы её локальная +Z смотрела «наружу» (к камере)
  g.rotation.y = Math.atan2(out.x, out.z);

  // Островок: цилиндр с неровным травяным верхом, песчаный пояс, земляные бока.
  const geo = new THREE.CylinderGeometry(R, R + 6, TOP + 6, 64, 6);
  geo.translate(0, (TOP + 6) / 2 - 6, 0);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x7fe84a), grass2 = new THREE.Color(0x5fcf38), sand = new THREE.Color(0xf5dc8f), dirt = new THREE.Color(0xb07a48);
  const cc = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
    if (y > TOP - 0.01) {
      // верх: пологий холм к центру + мягкие волны
      const hill = (1 - Math.min(1, r / R)) * 0.6 + Math.sin(a * 5 + r * 0.3) * 0.12;
      pos.setY(i, TOP + hill);
      cc.copy(grass).lerp(grass2, 0.5 + 0.5 * Math.sin(x * 0.4 + z * 0.3));
      if (r > R - 3) cc.lerp(sand, Math.min(1, (r - (R - 3)) / 3));
    } else cc.copy(y > 0.2 ? dirt : sand);
    col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
  land.receiveShadow = true;
  g.add(land);

  // Пена вокруг берега.
  const foam = new THREE.Mesh(new THREE.RingGeometry(R + 5, R + 8.5, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
  foam.rotation.x = -Math.PI / 2;
  foam.position.y = 0.12;
  g.add(foam);

  const groundAt = (x, z) => TOP + (1 - Math.min(1, Math.hypot(x, z) / R)) * 0.6 + Math.sin(Math.atan2(z, x) * 5 + Math.hypot(x, z) * 0.3) * 0.12;

  // Деревья, кусты, камни — instanced-модели из игры (с контуром и ветром).
  const put = (geom, mat, x, z, s, ry = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, groundAt(x, z) - 0.1, z);
    m.scale.setScalar(s);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    outlineGroup(m, 0.05);
    g.add(m);
    return m;
  };
  const plain = vcMaterial();
  put(oakGeometry(), plain, -9, -6, 1.15, 0.4);
  put(oakGeometry(), plain, 8.5, -11, 1.3, 2.1);
  put(pineGeometry(), plain, -14, -13, 1.2);
  put(pineGeometry(), plain, 15, -4, 1.0, 1);
  for (const [x, z, s] of [[-5, 3.5, 0.9], [6, 2.5, 0.8], [-11, 1, 1.1], [12, -1, 0.9], [-2, -8, 0.8]]) put(bushGeometry(), plain, x, z, s, x);
  for (const [x, z, s] of [[-7, 6, 0.8], [9.5, 5, 1.1], [3, -14, 1.4]]) put(rockGeometry(), plain, x, z, s, z);

  // Золотой сундук рядом с героем.
  const chest = new THREE.Group();
  const wood = toon(0x8a5a2b), gold = toon(0xffc83d, { emissive: 0x4a3200 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), wood); b.position.y = 0.25;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.62), gold); lid.position.y = 0.6;
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), gold); latch.position.set(0, 0.45, 0.32);
  chest.add(b, lid, latch);
  chest.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  outlineGroup(chest, 0.03);
  chest.position.set(-1.6, groundAt(-1.6, 1.4), 1.4);
  chest.rotation.y = 0.5;
  g.add(chest);

  // Вертолёт на площадке сзади справа.
  const pad = new THREE.Mesh(new THREE.CircleGeometry(4.6, 40), toon(0x3a3f4a));
  pad.rotation.x = -Math.PI / 2;
  const hx = 7.5, hz = -6;
  pad.position.set(hx, groundAt(hx, hz) + 0.04, hz);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 4.2, 40), new THREE.MeshBasicMaterial({ color: 0xffd21a }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(pad.position).y += 0.02;
  g.add(pad, ring);
  const heli = outlineGroup(buildHeli(), 0.06);
  heli.scale.setScalar(0.62);
  heli.position.set(hx, pad.position.y + 1.05, hz);
  heli.rotation.y = -2.4;
  g.add(heli);

  // Самолётик с рекламным баннером: пролетает по небу за героем слева направо, по кругу.
  const ad = buildAdPlane();
  g.add(ad.group);

  scene.add(g);
  g.updateMatrixWorld(true);

  // Точка, где стоит герой (локально — чуть правее центра, ближе к камере), и камера.
  const heroLocal = new THREE.Vector3(1.4, 0, 3.2);
  heroLocal.y = groundAt(heroLocal.x, heroLocal.z);
  const tmp = new THREE.Vector3();

  return {
    group: g,
    set visible(v) { g.visible = v; },
    // Мировая позиция ног героя.
    heroPos: (out = new THREE.Vector3()) => out.copy(heroLocal).applyMatrix4(g.matrixWorld),
    // Камера: перед героем, на уровне груди; shift — сдвиг вбок (Locker/Shop), mx/my — параллакс мыши.
    cameraPose(cam, t, shift, mx, my) {
      const base = new THREE.Vector3(heroLocal.x - 1.15 - shift, heroLocal.y + 1.75 - my * 0.2, heroLocal.z + 4.6 + Math.sin(t * 0.3) * 0.1);
      base.x += mx * 0.45;
      cam.position.copy(base.applyMatrix4(g.matrixWorld));
      const look = tmp.set(heroLocal.x - 0.95 - shift * 0.85, heroLocal.y + 1.45, heroLocal.z - 4).applyMatrix4(g.matrixWorld);
      cam.lookAt(look);
    },
    tick(t) { heli.userData.tick(t * 0.35); ad.tick(t); },
  };
}

// ---------- Самолётик с баннером «ваша реклама» ----------

const AD_TEXT = 'YOUR AD COULD BE HERE · DM ME';
const AD_PERIOD = 22;                 // секунд на пролёт
const AD_X0 = -75, AD_X1 = 95, AD_Y = 21, AD_Z = -30;

function adTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 270;
  const g = c.getContext('2d');
  g.fillStyle = '#fff8e6'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffc928'; g.fillRect(0, 0, c.width, 22); g.fillRect(0, c.height - 22, c.width, 22);
  // шрифт — по ширине баннера, с полями
  let size = 150;
  g.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  const w = g.measureText(AD_TEXT).width;
  if (w > c.width * 0.92) size = Math.floor(size * (c.width * 0.92) / w);
  g.fillStyle = '#7a2fd6'; g.font = `900 ${size}px "Arial Black", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(AD_TEXT, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildAdPlane() {
  const group = new THREE.Group();
  // самолёт смотрит носом в +X
  const plane = new THREE.Group();
  const white = toon(0xf4f4f8), gold = toon(0xffc928, { emissive: 0x3a2400 }), purple = toon(0x8b5cff), dark = toon(0x23262d);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 3.2, 6, 12), white);
  body.rotation.z = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 12), gold);
  nose.rotation.z = -Math.PI / 2; nose.position.x = 2.35;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 6.4), purple);
  wing.position.set(0.4, -0.05, 0);
  const tailH = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 2.2), purple);
  tailH.position.set(-1.95, 0.15, 0);
  const tailV = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.1), gold);
  tailV.position.set(-1.95, 0.65, 0);
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), new THREE.MeshToonMaterial({ color: 0x9fe3ff, emissive: 0x0a3050 }));
  cabin.position.set(0.7, 0.45, 0); cabin.scale.set(1.4, 0.8, 0.9);
  const prop = new THREE.Group();
  prop.position.x = 2.7;
  for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.7, 0.18), dark); b.rotation.x = i * Math.PI / 2; prop.add(b); }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0x23262d, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide }));
  blur.rotation.y = Math.PI / 2; prop.add(blur);
  plane.add(body, nose, wing, tailH, tailV, cabin, prop);
  outlineGroup(plane, 0.05);
  group.add(plane);

  // трос и баннер позади самолёта
  const BW = 24, BH = 3.2, GAP = 5;
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, GAP, 4), dark);
  rope.rotation.z = Math.PI / 2; rope.position.set(-2.2 - GAP / 2, -0.2, 0);
  const bannerGeo = new THREE.PlaneGeometry(BW, BH, 24, 1);
  const tex = adTexture();
  const front = new THREE.Mesh(bannerGeo, new THREE.MeshBasicMaterial({ map: tex, color: 0xcfcfcf, side: THREE.FrontSide }));   // чуть темнее — не пересвечивается bloom
  const back = new THREE.Mesh(bannerGeo, new THREE.MeshBasicMaterial({ color: 0xe8dcc0, side: THREE.BackSide }));
  const banner = new THREE.Group();
  banner.add(front, back);
  banner.position.set(-2.2 - GAP - BW / 2, -0.4, 0);
  group.add(rope, banner);
  const base = bannerGeo.attributes.position.array.slice();

  return {
    group,
    tick(t) {
      const k = (t % AD_PERIOD) / AD_PERIOD;
      group.position.set(AD_X0 + (AD_X1 - AD_X0) * k, AD_Y + Math.sin(t * 0.8) * 0.8, AD_Z);
      plane.rotation.x = Math.sin(t * 1.3) * 0.08;           // лёгкое покачивание крыльями
      prop.rotation.x = t * 40;
      // баннер полощется: волна бежит от самолёта к хвосту баннера
      const p = bannerGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], u = (BW / 2 - x) / BW;          // 0 у троса … 1 на конце
        p.setZ(i, Math.sin(t * 6 + x * 0.45) * 0.45 * u);
      }
      p.needsUpdate = true;
    },
  };
}
