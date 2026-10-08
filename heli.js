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
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), white); s1.position.set(sx * 1.0, -1.2, -0.9); s1.rotation.z = sx * 0.3;
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
