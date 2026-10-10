// Детальные модели оружия от первого лица (у других игроков — простые, viewmodel.js → weaponModel).
// Та же система координат, что у простых: ствол вдоль −Z, начало — у рукояти; базовые цвета те же (DARK, METAL,
// WOOD, OLIVE), поэтому обвесы Gunsmith и скины из кейсов ложатся так же. Подвижные части — отдельные группы
// (магазин, затвор, цевьё, рукоять затвора, ракета), руки — с пальцами и рукавом цвета скина.
// buildFP(...) → { g, parts: { mag, slide, bolt, pump, charge, tip, lhand }, muzzle, eject, shell }.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toonGradient, outlineGroup } from './art.js';
import { RARITY } from './combat.js';
import { applyFinish } from './wskins.js';
import { addMods, FIN_BASE, DARK, METAL, WOOD, OLIVE } from './viewmodel.js';

const POLY = 0x1e2126, STEEL = 0x8c939e, BRASS = 0xd9a441, RUBBER = 0x15161a, GLASS = 0x7fd0ff;

const mat = (c, e = 0) => new THREE.MeshToonMaterial({ color: c, emissive: e, gradientMap: toonGradient() });
// Коробка со скруглёнными рёбрами — на рёбрах ловит свет, модель не выглядит «из кубиков».
function rb(w, h, d, c, x = 0, y = 0, z = 0, o = {}) {
  const r = Math.min(o.r ?? 0.008, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.max(r, 1e-4)), mat(c, o.e || 0));
  m.position.set(x, y, z);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  return m;
}
// Цилиндр вдоль −Z (axis z), X или Y; r — у задней стороны, r2 — у передней (сужение ствола, раструб).
function cyl(r, len, c, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r2 ?? r, r, len, o.seg || 18), mat(c, o.e || 0));
  if ((o.axis || 'z') === 'z') m.rotation.x = -Math.PI / 2;
  else if (o.axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
// Планка Пикатинни: основание и зубцы.
function rail(z0, z1, y, w = 0.034, c = POLY) {
  const g = new THREE.Group();
  const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
  g.add(rb(w, 0.012, len, c, 0, y, zc, { r: 0.003 }));
  for (let z = Math.min(z0, z1) + 0.008; z < Math.max(z0, z1) - 0.004; z += 0.018) g.add(rb(w + 0.006, 0.01, 0.009, c, 0, y + 0.01, z, { r: 0.002 }));
  return g;
}
// Спусковая скоба и крючок под ствольной коробкой.
function trigger(y, z, c = POLY) {
  const g = new THREE.Group();
  g.add(rb(0.014, 0.012, 0.085, c, 0, y - 0.05, z - 0.01, { r: 0.004 }), rb(0.014, 0.05, 0.012, c, 0, y - 0.026, z - 0.05, { r: 0.004 }));
  g.add(rb(0.008, 0.035, 0.01, STEEL, 0, y - 0.02, z - 0.012, { r: 0.003, rx: -0.35 }));
  return g;
}

// ---------- Руки ----------
// Правая — на рукояти: ладонь сзади, четыре пальца обхватывают спереди, большой — слева. Предплечье уходит назад-вниз.
function rightHand(sk, sleeve) {
  const g = new THREE.Group();
  g.add(rb(0.07, 0.085, 0.045, sk, 0.004, -0.005, 0.042, { r: 0.018 }));
  for (let i = 0; i < 4; i++) g.add(rb(0.072, 0.019, 0.024, sk, 0.004, 0.022 - i * 0.022, -0.034, { r: 0.009 }));
  g.add(rb(0.02, 0.022, 0.06, sk, -0.038, 0.03, 0.005, { r: 0.009, ry: 0.25 }));
  const arm = new THREE.Group();
  arm.add(cyl(0.042, 0.42, sleeve, 0, 0, 0.21, { seg: 14 }), cyl(0.046, 0.05, sleeve, 0, 0, 0.02, { seg: 14 }));
  arm.add(cyl(0.036, 0.05, sk, 0, 0, -0.02, { seg: 12 }));
  arm.position.set(0.012, -0.02, 0.06);
  arm.rotation.set(0.55, 0.3, 0);                 // назад-вниз-вправо, за край кадра
  g.add(arm);
  return g;
}
// Левая — снизу под цевьём: ладонь, большой палец сбоку (виден), кончики пальцев — из-за дальней стороны.
function leftHand(sk, sleeve, width = 0.075) {
  const g = new THREE.Group();
  g.add(rb(0.075, 0.03, 0.09, sk, 0.0, -0.002, 0, { r: 0.012 }));
  g.add(rb(0.022, 0.05, 0.07, sk, -width / 2 - 0.008, 0.028, -0.005, { r: 0.01 }));
  for (let i = 0; i < 4; i++) g.add(rb(0.02, 0.05, 0.019, sk, width / 2 + 0.006, 0.03, 0.03 - i * 0.021, { r: 0.008 }));
  const arm = new THREE.Group();
  arm.add(cyl(0.04, 0.45, sleeve, 0, 0, 0.225, { seg: 14 }), cyl(0.044, 0.05, sleeve, 0, 0, 0.02, { seg: 14 }), cyl(0.034, 0.05, sk, 0, 0, -0.02, { seg: 12 }));
  arm.position.set(-0.02, -0.03, 0.04);
  arm.rotation.set(0.75, -0.42, 0);               // назад-вниз-влево
  g.add(arm);
  return g;
}

// Прицелы Gunsmith от первого лица: ACOG (AR), коллиматор (SMG, пистолет), голографический (дробовик).
function optic(type) {
  const g = new THREE.Group();
  const lens = (r, color, x, y, z, back = false) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color })); m.position.set(x, y, z); if (back) m.rotation.y = Math.PI; return m; };
  if (type === 'ar') {
    const y = 0.135, z = -0.2;
    g.add(rb(0.03, 0.03, 0.12, POLY, 0, 0.1, z, { r: 0.004 }));                                   // крепление на планку
    g.add(cyl(0.024, 0.2, DARK, 0, y, z, { seg: 20 }), cyl(0.026, 0.05, DARK, 0, y, z - 0.12, { r2: 0.032, seg: 20 }), cyl(0.028, 0.04, DARK, 0, y, z + 0.11, { seg: 20 }));
    g.add(rb(0.018, 0.014, 0.03, POLY, 0, y + 0.028, z - 0.02, { r: 0.004 }));                    // волоконный световод
    g.add(lens(0.03, 0xff9a3a, 0, y, z - 0.146, true), lens(0.022, 0x14202c, 0, y, z + 0.131));
  } else if (type === 'shotgun') {
    const y = 0.13, z = -0.08;
    g.add(rb(0.07, 0.016, 0.09, POLY, 0, 0.088, z, { r: 0.005 }));
    for (const sx of [-1, 1]) g.add(rb(0.012, 0.07, 0.08, DARK, sx * 0.034, y, z, { r: 0.004 }));
    g.add(rb(0.08, 0.012, 0.08, DARK, 0, y + 0.038, z, { r: 0.004 }));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.056), new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.45 }));
    glass.position.set(0, y, z - 0.03);
    g.add(glass, lens(0.006, 0xff3a3a, 0, y, z - 0.029));
  } else if (type === 'smg' || type === 'pistol') {
    const y = type === 'pistol' ? 0.1 : 0.11, z = type === 'pistol' ? -0.05 : -0.1;
    g.add(rb(0.046, 0.016, 0.06, POLY, 0, y - 0.03, z, { r: 0.004 }), rb(0.05, 0.046, 0.05, DARK, 0, y, z, { r: 0.012 }));
    g.add(lens(0.017, 0x3a0a0a, 0, y + 0.002, z - 0.026, true), lens(0.004, 0xff2a2a, 0, y + 0.002, z - 0.027, true));
  }
  return g;
}

// ---------- Оружие ----------

export function buildFP(type, rarity = 0, mods = '', fin = null, arms = {}) {
  const sk = arms.skin ?? 0xffd2a8, sleeve = arms.sleeve ?? 0x8b5cff;
  const g = new THREE.Group();
  const parts = { mag: new THREE.Group(), slide: null, bolt: null, pump: null, charge: null, tip: null, lhand: null };
  const rc = new THREE.Color(RARITY[rarity]?.color || '#b0b6bf');
  const acc = (w, h, d, x, y, z, o = {}) => rb(w, h, d, rc, x, y, z, { ...o, e: rc.clone().multiplyScalar(0.45) });
  let muzzle = new THREE.Vector3(0, 0.03, -0.3), eject = new THREE.Vector3(0.04, 0.04, -0.05), shell = BRASS, leftAt = null, rightAt = new THREE.Vector3(0, -0.07, 0.03);
  g.add(parts.mag);

  switch (type) {
    case 'pistol': {
      g.add(rb(0.058, 0.045, 0.25, DARK, 0, -0.005, -0.085, { r: 0.008 }));                 // рамка
      g.add(rb(0.03, 0.012, 0.06, POLY, 0, -0.032, -0.17, { r: 0.004 }));                  // планка под фонарь
      const grip = rb(0.056, 0.15, 0.072, DARK, 0, -0.095, 0.03, { r: 0.012, rx: -0.2 });
      g.add(grip);
      for (let i = 0; i < 5; i++) g.add(rb(0.058, 0.006, 0.05, POLY, 0, -0.06 - i * 0.022, 0.04 + i * 0.004, { r: 0.002, rx: -0.2 }));
      g.add(trigger(-0.01, 0.0));
      // затвор-кожух (ходит назад при выстреле)
      const slide = new THREE.Group();
      slide.add(rb(0.064, 0.052, 0.3, METAL, 0, 0.043, -0.085, { r: 0.008 }));
      for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) slide.add(rb(0.004, 0.036, 0.005, POLY, sx * 0.032, 0.043, 0.035 + i * -0.009, { r: 0.001 }));
      slide.add(rb(0.012, 0.012, 0.012, POLY, 0, 0.074, -0.222, { r: 0.003 }), rb(0.03, 0.014, 0.014, POLY, 0, 0.074, 0.05, { r: 0.003 }));
      slide.add(rb(0.004, 0.022, 0.06, POLY, 0.033, 0.055, -0.04, { r: 0.002 }));        // окно выброса
      slide.add(acc(0.066, 0.008, 0.16, 0, 0.022, -0.1, { r: 0.003 }));
      g.add(slide);
      g.add(cyl(0.012, 0.03, STEEL, 0, 0.045, -0.23, { seg: 12 }));
      parts.slide = slide;
      parts.mag.add(rb(0.05, 0.02, 0.068, POLY, 0, -0.178, 0.045, { r: 0.006, rx: -0.2 }), rb(0.042, 0.12, 0.05, METAL, 0, -0.11, 0.035, { r: 0.004, rx: -0.2 }));
      muzzle.set(0, 0.045, -0.25); eject.set(0.04, 0.06, -0.04);
      leftAt = new THREE.Vector3(-0.02, -0.12, 0.0);
      break;
    }
    case 'smg': {
      g.add(rb(0.068, 0.085, 0.34, DARK, 0, 0.02, -0.12, { r: 0.01 }));
      g.add(rail(0.04, -0.26, 0.068));
      g.add(cyl(0.026, 0.11, METAL, 0, 0.025, -0.335), cyl(0.012, 0.08, STEEL, 0, 0.025, -0.42, { seg: 12 }), cyl(0.02, 0.04, POLY, 0, 0.025, -0.455, { seg: 12 }));
      for (let i = 0; i < 4; i++) g.add(rb(0.054, 0.008, 0.014, POLY, 0, 0.025, -0.3 - i * 0.022, { r: 0.002 }));
      g.add(rb(0.05, 0.12, 0.062, DARK, 0, -0.085, 0.03, { r: 0.012, rx: -0.25 }), trigger(-0.025, -0.02));
      g.add(rb(0.06, 0.05, 0.075, POLY, 0, -0.035, -0.12, { r: 0.006 }));                 // приёмник магазина
      g.add(cyl(0.007, 0.09, STEEL, 0.024, 0.035, 0.1, { seg: 8 }), cyl(0.007, 0.09, STEEL, -0.024, 0.035, 0.1, { seg: 8 }), rb(0.06, 0.08, 0.022, POLY, 0, 0.0, 0.15, { r: 0.008 }));
      g.add(rb(0.012, 0.03, 0.012, POLY, 0, 0.09, -0.24, { r: 0.003 }), rb(0.03, 0.022, 0.014, POLY, 0, 0.09, 0.02, { r: 0.003 }));
      g.add(acc(0.07, 0.014, 0.2, 0, 0.0, -0.15, { r: 0.004 }));
      const ch = rb(0.022, 0.014, 0.03, STEEL, -0.04, 0.045, -0.06, { r: 0.004 });
      g.add(ch); parts.charge = ch;
      parts.mag.add(rb(0.04, 0.17, 0.052, METAL, 0, -0.13, -0.125, { r: 0.006, rx: 0.12 }), rb(0.046, 0.016, 0.058, POLY, 0, -0.218, -0.135, { r: 0.004, rx: 0.12 }));
      muzzle.set(0, 0.025, -0.48); eject.set(0.04, 0.04, -0.07);
      leftAt = new THREE.Vector3(0, -0.035, -0.27);
      break;
    }
    case 'ar': {
      g.add(rb(0.068, 0.06, 0.3, DARK, 0, 0.045, -0.08, { r: 0.008 }), rb(0.064, 0.065, 0.24, DARK, 0, -0.012, -0.1, { r: 0.008 }));
      g.add(rb(0.076, 0.078, 0.3, DARK, 0, 0.03, -0.39, { r: 0.012 }));                    // цевьё
      for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) g.add(rb(0.004, 0.022, 0.03, POLY, sx * 0.039, 0.03, -0.27 - i * 0.042, { r: 0.002 }));
      g.add(rail(0.06, -0.52, 0.08));
      g.add(cyl(0.014, 0.2, STEEL, 0, 0.03, -0.63, { seg: 14 }), rb(0.034, 0.034, 0.04, POLY, 0, 0.035, -0.56, { r: 0.005 }));
      g.add(rb(0.014, 0.06, 0.014, POLY, 0, 0.075, -0.565, { r: 0.004 }));                  // мушка
      const brake = cyl(0.022, 0.065, POLY, 0, 0.03, -0.745, { seg: 14 });
      g.add(brake);
      for (const sx of [-1, 1]) g.add(rb(0.004, 0.012, 0.04, RUBBER, sx * 0.021, 0.03, -0.745, { r: 0.001 }));
      g.add(rb(0.05, 0.13, 0.064, DARK, 0, -0.09, 0.03, { r: 0.012, rx: -0.25 }), trigger(-0.035, -0.03));
      g.add(rb(0.068, 0.06, 0.09, POLY, 0, -0.06, -0.2, { r: 0.006 }));                     // приёмник магазина
      g.add(cyl(0.02, 0.09, POLY, 0, 0.03, 0.1), rb(0.058, 0.095, 0.11, DARK, 0, -0.005, 0.19, { r: 0.014 }), rb(0.062, 0.1, 0.02, RUBBER, 0, -0.005, 0.25, { r: 0.006 }));   // приклад укорочен — в кадре не мешает
      g.add(rb(0.03, 0.03, 0.03, POLY, 0, 0.098, 0.04, { r: 0.004 }));                      // целик
      g.add(rb(0.004, 0.03, 0.08, POLY, 0.035, 0.045, -0.06, { r: 0.002 }));                // окно выброса
      g.add(acc(0.078, 0.016, 0.24, 0, 0.0, -0.4, { r: 0.004 }), acc(0.062, 0.026, 0.04, 0, 0.04, 0.19, { r: 0.006 }));
      const ch = rb(0.05, 0.014, 0.03, STEEL, 0, 0.075, 0.075, { r: 0.004 });
      g.add(ch); parts.charge = ch;
      // изогнутый магазин из двух частей
      parts.mag.add(rb(0.044, 0.12, 0.068, METAL, 0, -0.12, -0.2, { r: 0.006, rx: 0.12 }), rb(0.044, 0.1, 0.066, METAL, 0, -0.215, -0.225, { r: 0.006, rx: 0.32 }), rb(0.05, 0.016, 0.07, POLY, 0, -0.268, -0.244, { r: 0.004, rx: 0.32 }));
      muzzle.set(0, 0.03, -0.79); eject.set(0.045, 0.05, -0.06);
      leftAt = new THREE.Vector3(0, -0.02, -0.4);
      break;
    }
    case 'shotgun': {
      g.add(rb(0.072, 0.1, 0.22, DARK, 0, 0.0, -0.05, { r: 0.012 }));
      g.add(rb(0.004, 0.035, 0.09, POLY, -0.037, -0.02, -0.06, { r: 0.002 }), rb(0.004, 0.03, 0.07, POLY, 0.037, 0.02, -0.05, { r: 0.002 }));
      g.add(cyl(0.022, 0.56, METAL, 0, 0.05, -0.44, { seg: 18 }), cyl(0.018, 0.48, STEEL, 0, 0.0, -0.4, { seg: 16 }));
      g.add(rb(0.05, 0.08, 0.025, POLY, 0, 0.026, -0.64, { r: 0.006 }), new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mat(BRASS)).translateY(0.077).translateZ(-0.7));
      g.add(rb(0.05, 0.12, 0.062, DARK, 0, -0.09, 0.05, { r: 0.012, rx: -0.3 }), trigger(-0.04, 0.0));
      g.add(rb(0.068, 0.095, 0.12, WOOD, 0, -0.02, 0.15, { r: 0.016, rx: 0.12 }), rb(0.072, 0.12, 0.1, WOOD, 0, -0.04, 0.245, { r: 0.018, rx: 0.12 }), rb(0.076, 0.13, 0.022, RUBBER, 0, -0.048, 0.302, { r: 0.006, rx: 0.12 }));
      g.add(acc(0.074, 0.018, 0.16, 0, -0.035, -0.05, { r: 0.004 }));
      // цевьё помпы: ходит назад-вперёд
      const pump = new THREE.Group();
      pump.add(rb(0.07, 0.06, 0.2, WOOD, 0, -0.005, -0.4, { r: 0.016 }));
      for (let i = 0; i < 5; i++) pump.add(rb(0.072, 0.062, 0.007, 0x5a3a22, 0, -0.005, -0.33 - i * 0.034, { r: 0.004 }));
      g.add(pump); parts.pump = pump;
      muzzle.set(0, 0.05, -0.73); eject.set(0.045, 0.02, -0.06); shell = 0xd23b2a;
      leftAt = new THREE.Vector3(0, -0.04, -0.4);
      break;
    }
    case 'sniper': {
      g.add(rb(0.068, 0.085, 0.62, DARK, 0, 0.0, -0.21, { r: 0.012 }));
      g.add(cyl(0.03, 0.27, METAL, 0, 0.045, -0.08, { seg: 18 }));                          // ствольная коробка
      g.add(cyl(0.02, 0.56, STEEL, 0, 0.04, -0.78, { r2: 0.015, seg: 16 }), rb(0.042, 0.042, 0.07, POLY, 0, 0.04, -1.08, { r: 0.008 }));
      for (const sx of [-1, 1]) g.add(rb(0.004, 0.018, 0.05, RUBBER, sx * 0.021, 0.04, -1.08, { r: 0.001 }));
      // оптика: труба, раструб, окуляр, барабанчики, кольца, стёкла
      g.add(cyl(0.024, 0.3, DARK, 0, 0.135, -0.18), cyl(0.026, 0.07, DARK, 0, 0.135, -0.37, { r2: 0.038 }), cyl(0.031, 0.06, DARK, 0, 0.135, -0.02, { r2: 0.026 }));
      g.add(cyl(0.016, 0.03, POLY, 0, 0.17, -0.18, { axis: 'y', seg: 12 }), cyl(0.016, 0.03, POLY, 0.034, 0.135, -0.18, { axis: 'x', seg: 12 }));
      g.add(rb(0.03, 0.06, 0.02, METAL, 0, 0.1, -0.1, { r: 0.004 }), rb(0.03, 0.06, 0.02, METAL, 0, 0.1, -0.27, { r: 0.004 }));
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.034, 20), new THREE.MeshBasicMaterial({ color: GLASS }));
      lens.position.set(0, 0.135, -0.406); lens.rotation.y = Math.PI;
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.024, 18), new THREE.MeshBasicMaterial({ color: 0x0c1a2a }));
      eye.position.set(0, 0.135, 0.011);
      g.add(lens, eye);
      g.add(rb(0.05, 0.13, 0.064, DARK, 0, -0.09, 0.03, { r: 0.012, rx: -0.25 }), trigger(-0.04, -0.03));
      g.add(rb(0.062, 0.1, 0.2, DARK, 0, -0.02, 0.2, { r: 0.016 }), rb(0.048, 0.028, 0.1, POLY, 0, 0.05, 0.19, { r: 0.008 }), rb(0.066, 0.11, 0.02, RUBBER, 0, -0.02, 0.31, { r: 0.006 }));
      for (const sx of [-1, 1]) g.add(cyl(0.007, 0.2, POLY, sx * 0.02, -0.05, -0.38, { seg: 8 }));   // сложенные сошки
      g.add(acc(0.07, 0.016, 0.34, 0, -0.03, -0.3, { r: 0.004 }));
      // рукоять затвора: поворачивается вверх и ходит назад после выстрела
      const bolt = new THREE.Group();
      bolt.position.set(0.03, 0.045, 0.02);
      bolt.add(cyl(0.007, 0.07, STEEL, 0.035, 0, 0, { axis: 'x', seg: 8 }), new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), mat(STEEL)).translateX(0.07));
      g.add(bolt); parts.bolt = bolt;
      parts.mag.add(rb(0.05, 0.09, 0.1, METAL, 0, -0.08, -0.12, { r: 0.006 }));
      muzzle.set(0, 0.04, -1.12); eject.set(0.045, 0.06, -0.05);
      leftAt = new THREE.Vector3(0, -0.06, -0.42);
      break;
    }
    case 'bazooka': {
      g.add(cyl(0.095, 1.1, OLIVE, 0, 0.05, -0.22, { seg: 24 }));
      g.add(cyl(0.11, 0.07, DARK, 0, 0.05, -0.76, { seg: 24 }), cyl(0.105, 0.05, DARK, 0, 0.05, -0.2, { seg: 24 }), cyl(0.1, 0.14, DARK, 0, 0.05, 0.38, { r2: 0.13, seg: 24 }));
      g.add(rb(0.05, 0.12, 0.065, DARK, 0, -0.09, -0.05, { r: 0.012, rx: -0.2 }), trigger(-0.04, -0.08));
      g.add(rb(0.05, 0.11, 0.06, DARK, 0, -0.085, -0.38, { r: 0.012, rx: -0.1 }));
      g.add(rb(0.012, 0.09, 0.012, POLY, -0.04, 0.18, -0.3, { r: 0.003 }), rb(0.012, 0.09, 0.012, POLY, 0.04, 0.18, -0.3, { r: 0.003 }), rb(0.092, 0.012, 0.012, POLY, 0, 0.22, -0.3, { r: 0.003 }));
      g.add(rb(0.03, 0.05, 0.03, POLY, 0, 0.16, 0.0, { r: 0.004 }));
      g.add(acc(0.2, 0.06, 0.1, 0, 0.05, -0.56, { r: 0.02 }));
      const tip = new THREE.Group();
      tip.add(cyl(0.07, 0.1, 0x5b6b3a, 0, 0.05, -0.81, { seg: 18 }), cyl(0.07, 0.12, 0xd23b2a, 0, 0.05, -0.92, { r2: 0.012, seg: 18 }));
      g.add(tip); parts.tip = tip;
      muzzle.set(0, 0.05, -0.86);
      leftAt = new THREE.Vector3(0, -0.13, -0.38);
      rightAt.set(0, -0.08, -0.04);
      break;
    }
    case 'pickaxe': {
      // рукоять с обмоткой, кованое навершие с двумя клювами, светящиеся кромки
      g.add(cyl(0.022, 0.62, WOOD, 0, 0, -0.24, { r2: 0.019, seg: 14 }));
      for (let i = 0; i < 6; i++) g.add(cyl(0.025, 0.018, RUBBER, 0, 0, 0.0 - i * 0.03, { seg: 14 }));
      g.add(cyl(0.03, 0.04, METAL, 0, 0, 0.08, { seg: 14 }));
      g.add(rb(0.07, 0.09, 0.11, METAL, 0, 0, -0.53, { r: 0.012 }), rb(0.075, 0.03, 0.115, 0x8a5cff, 0, 0.035, -0.53, { r: 0.008, e: 0x2a1060 }));
      for (const sy of [-1, 1]) {
        g.add(rb(0.05, 0.16, 0.06, 0x8a5cff, 0, sy * 0.12, -0.545, { r: 0.014, rx: sy * 0.18, e: 0x2a1060 }));
        g.add(new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11, 8), mat(0xd8c8ff, 0x3a2a80)).translateY(sy * 0.245).translateZ(-0.57).rotateX(sy > 0 ? 0.2 : Math.PI - 0.2));
      }
      muzzle.set(0, 0, -0.55);
      rightAt.set(0, 0, 0.02);
      break;
    }
    case 'medkit': {
      // аптечка: белый кейс с красным крестом, ручка, защёлки
      g.add(rb(0.2, 0.15, 0.07, 0xf4f6fa, 0, 0, -0.05, { r: 0.016 }));
      g.add(rb(0.07, 0.022, 0.074, 0xe63946, 0, 0, -0.05, { r: 0.004, e: 0x3a0a0a }), rb(0.022, 0.07, 0.074, 0xe63946, 0, 0, -0.05, { r: 0.004, e: 0x3a0a0a }));
      g.add(rb(0.08, 0.018, 0.02, POLY, 0, 0.088, -0.05, { r: 0.006 }), rb(0.016, 0.03, 0.02, POLY, -0.04, 0.078, -0.05, { r: 0.004 }), rb(0.016, 0.03, 0.02, POLY, 0.04, 0.078, -0.05, { r: 0.004 }));
      for (const sx of [-1, 1]) g.add(rb(0.02, 0.03, 0.076, 0xc0c6d0, sx * 0.07, 0.03, -0.05, { r: 0.004 }));
      muzzle.set(0, 0, -0.1);
      rightAt.set(0.07, -0.06, -0.02);
      leftAt = new THREE.Vector3(-0.07, -0.06, -0.06);
      break;
    }
  }

  if (mods && type !== 'pickaxe' && type !== 'medkit') {
    addMods(g, type, mods.replace('o', ''), parts.mag);     // магазин, рукоятка, муфта — как у простых
    if (mods.includes('o')) g.add(optic(type));              // прицелы — детальные
  }
  if (fin) applyFinish(g, fin, FIN_BASE);
  outlineGroup(g, 0.0045);

  // руки — после скина и контура: свой цвет, свой контур
  const rh = rightHand(sk, sleeve);
  rh.position.copy(rightAt);
  if (type === 'pickaxe') rh.rotation.x = -Math.PI / 2;
  if (type === 'medkit') rh.rotation.set(0, 0, -0.3);
  outlineGroup(rh, 0.004);
  g.add(rh);
  if (leftAt) {
    const lh = leftHand(sk, sleeve, type === 'shotgun' ? 0.07 : 0.075);
    lh.position.copy(leftAt);
    lh.userData.rest = leftAt.clone();
    if (type === 'pistol') lh.rotation.set(0.2, 0.3, 0.3);
    if (type === 'medkit') lh.rotation.set(0, 0, 0.3);
    outlineGroup(lh, 0.004);
    g.add(lh);
    parts.lhand = lh;
  }
  for (const k of ['slide', 'bolt', 'pump', 'charge', 'tip', 'mag']) if (parts[k]) parts[k].userData.rest = { p: parts[k].position.clone(), r: parts[k].rotation.clone() };
  return { g, parts, muzzle, eject, shell };
}
