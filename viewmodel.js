// Модели оружия: у других игроков — простые (weaponModel), от первого лица — детальные (fpguns.js) с анимациями.
// От первого лица оружие рисуется отдельной сценой поверх мира (с очисткой глубины) — не проваливается в стены.

import * as THREE from 'three';
import { RARITY } from './combat.js';
import { toonGradient } from './art.js';
import { applyFinish } from './wskins.js';
import { buildFP } from './fpguns.js';

const lam = (color, emissive = 0x000000) => new THREE.MeshToonMaterial({ color, emissive, gradientMap: toonGradient() });
function box(w, h, d, color, x, y, z, emissive) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color, emissive));
  m.position.set(x, y, z);
  return m;
}

export const DARK = 0x2a2d33, METAL = 0x5b616b, WOOD = 0x7a5232, OLIVE = 0x56663a;

// Обвесы из Gunsmith на модели: mods — строка букв: o — прицел, m — двойной магазин, g — рукоятка/чок,
// s — быстрая перезарядка (неоновая муфта на магазине). Видны и от первого лица, и на оружии у других.
// Где магазин у каждого оружия: [x, y, z, ширина, высота, глубина].
const MAG_AT = { pistol: [0, -0.08, 0.02, 0.06, 0.15, 0.07], smg: [0, -0.12, -0.12, 0.05, 0.17, 0.06], ar: [0, -0.13, -0.2, 0.055, 0.19, 0.08], sniper: [0, -0.06, -0.12, 0.05, 0.1, 0.1], shotgun: [0, -0.03, -0.42, 0.085, 0.07, 0.22] };
// magGroup — куда класть магазинные обвесы (у детальной модели от первого лица магазин ходит при перезарядке).
export function addMods(g, type, mods, magGroup = g) {
  const has = (c) => mods.includes(c);
  const lens = (color) => new THREE.MeshBasicMaterial({ color });
  const glass = (w, h, color, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lens(color)); m.position.set(x, y, z); return m; };
  if (has('o')) {
    if (type === 'ar') {
      // ACOG 3x: длинная труба с оранжевым передним стеклом
      g.add(box(0.065, 0.07, 0.2, DARK, 0, 0.165, -0.2), box(0.08, 0.08, 0.03, METAL, 0, 0.165, -0.31), box(0.08, 0.08, 0.03, METAL, 0, 0.165, -0.09),
        box(0.03, 0.04, 0.06, METAL, 0, 0.115, -0.2), glass(0.055, 0.055, 0xff9a3a, 0, 0.165, -0.326));
      g.add(glass(0.05, 0.05, 0x1a2a3a, 0, 0.165, -0.074)).children.at(-1).rotation.y = Math.PI;
    } else if (type === 'shotgun') {
      // голографический прицел: рамка и голубое стекло
      g.add(box(0.075, 0.015, 0.09, DARK, 0, 0.095, -0.08), box(0.012, 0.07, 0.09, DARK, -0.035, 0.13, -0.08), box(0.012, 0.07, 0.09, DARK, 0.035, 0.13, -0.08),
        box(0.075, 0.012, 0.09, DARK, 0, 0.167, -0.08), glass(0.058, 0.058, 0x7fe0ff, 0, 0.13, -0.12));
    } else if (type === 'smg' || type === 'pistol') {
      // коллиматор: короткая трубка с красной точкой
      const y = type === 'pistol' ? 0.1 : 0.115, z = type === 'pistol' ? -0.06 : -0.1;
      g.add(box(0.05, 0.05, 0.07, DARK, 0, y, z), box(0.025, 0.02, 0.05, METAL, 0, y - 0.033, z), glass(0.034, 0.034, 0x3a0a0a, 0, y, z - 0.036), glass(0.01, 0.01, 0xff2a2a, 0, y, z - 0.037));
    }
  }
  const mg = MAG_AT[type];
  if (has('m') && mg) {
    const [x, y, z, w, h, d] = mg;
    if (type === 'ar' || type === 'smg') {
      // барабанный магазин
      const r = type === 'ar' ? 0.1 : 0.085;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.07, 18), lam(DARK));
      drum.rotation.z = Math.PI / 2; drum.position.set(x, y - h / 2 - r * 0.6, z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.075, 14), lam(METAL));
      cap.rotation.z = Math.PI / 2; cap.position.copy(drum.position);
      magGroup.add(drum, cap);
    } else if (type === 'pistol') magGroup.add(box(w * 0.95, 0.1, d * 0.95, DARK, x, y - h / 2 - 0.04, z), box(w * 1.1, 0.025, d * 1.15, 0xffc928, x, y - h / 2 - 0.095, z));
    else if (type === 'sniper') magGroup.add(box(w, 0.12, d, DARK, x, y - h / 2 - 0.05, z));
    else if (type === 'shotgun') for (let i = 0; i < 5; i++) g.add(box(0.025, 0.045, 0.025, 0xd23b2a, 0.05, 0.0, -0.08 - i * 0.035), box(0.026, 0.012, 0.026, 0xffc928, 0.05, -0.025, -0.08 - i * 0.035));
  }
  if (has('g')) {
    if (type === 'shotgun') g.add(box(0.09, 0.09, 0.07, METAL, 0, 0.05, -0.7));                     // чок на конце ствола
    else if (type === 'pistol') g.add(box(0.04, 0.035, 0.08, DARK, 0, -0.035, -0.17), glass(0.025, 0.025, 0xfff6c0, 0, -0.035, -0.211));   // фонарик
    else g.add(box(0.035, 0.12, 0.045, DARK, 0, -0.08, type === 'ar' ? -0.42 : -0.3));              // вертикальная рукоятка
  }
  if (has('s') && mg) {
    const [x, y, z, w, , d] = mg;
    magGroup.add(box(w * 1.25, 0.03, d * 1.25, 0x5dff9a, x, y, z, 0x1a6a3a));                               // неоновая муфта быстрой перезарядки
  }
}

// Модель оружия: ствол вдоль −Z, начало координат — у рукояти. userData.muzzle — точка вспышки.
// fin — раскраска скина из кейса (wskins.js): корпус/дерево → цвет «a», металл → «b».
export const FIN_BASE = { a: [DARK, WOOD, OLIVE], b: [METAL, 0x8a5cff] };
export function weaponModel(type, rarity = 0, mods = '', fin = null) {
  const g = new THREE.Group();
  if (type === 'pickaxe') { const p = pickaxeModel(); if (fin) applyFinish(p, fin, FIN_BASE); return p; }
  const rc = new THREE.Color(RARITY[rarity].color);
  const accent = (w, h, d, x, y, z) => box(w, h, d, rc, x, y, z, rc.clone().multiplyScalar(0.35));
  let muzzle = -0.3;
  switch (type) {
    case 'pistol':
      g.add(box(0.07, 0.09, 0.3, METAL, 0, 0.02, -0.08), box(0.06, 0.15, 0.07, DARK, 0, -0.08, 0.02), accent(0.074, 0.02, 0.22, 0, 0.075, -0.08));
      muzzle = -0.24;
      break;
    case 'smg':
      g.add(box(0.08, 0.1, 0.36, DARK, 0, 0.02, -0.12), box(0.05, 0.17, 0.06, METAL, 0, -0.12, -0.12), box(0.035, 0.035, 0.14, METAL, 0, 0.03, -0.36),
        box(0.06, 0.13, 0.07, DARK, 0, -0.08, 0.02), box(0.05, 0.06, 0.14, DARK, 0, 0.0, 0.12), accent(0.082, 0.02, 0.3, 0, 0.08, -0.12));
      muzzle = -0.44;
      break;
    case 'ar':
      g.add(box(0.08, 0.11, 0.55, DARK, 0, 0.02, -0.2), box(0.035, 0.035, 0.26, METAL, 0, 0.03, -0.6), box(0.055, 0.19, 0.08, METAL, 0, -0.13, -0.2),
        box(0.06, 0.14, 0.07, DARK, 0, -0.08, 0.02), box(0.07, 0.11, 0.24, DARK, 0, 0.0, 0.18), box(0.03, 0.05, 0.12, METAL, 0, 0.1, -0.2),
        accent(0.084, 0.025, 0.4, 0, 0.085, -0.22));
      muzzle = -0.74;
      break;
    case 'shotgun':
      g.add(box(0.065, 0.065, 0.75, METAL, 0, 0.05, -0.32), box(0.085, 0.07, 0.22, WOOD, 0, -0.03, -0.42), box(0.08, 0.1, 0.2, DARK, 0, 0.0, -0.05),
        box(0.06, 0.14, 0.07, DARK, 0, -0.09, 0.03), box(0.07, 0.12, 0.3, WOOD, 0, -0.01, 0.22), accent(0.09, 0.02, 0.18, 0, 0.0, -0.2));
      muzzle = -0.7;
      break;
    case 'sniper':
      g.add(box(0.07, 0.09, 0.6, DARK, 0, 0.02, -0.2), box(0.03, 0.03, 0.5, METAL, 0, 0.03, -0.72), box(0.065, 0.065, 0.28, DARK, 0, 0.12, -0.18),
        box(0.05, 0.05, 0.01, 0x88ccff, 0, 0.12, -0.33), box(0.06, 0.14, 0.07, DARK, 0, -0.08, 0.02), box(0.07, 0.12, 0.32, DARK, 0, 0.0, 0.25),
        accent(0.074, 0.02, 0.4, 0, -0.03, -0.25));
      muzzle = -0.98;
      break;
    case 'bazooka': {
      g.add(box(0.19, 0.19, 1.15, OLIVE, 0, 0.05, -0.2), box(0.23, 0.23, 0.07, DARK, 0, 0.05, -0.78), box(0.23, 0.23, 0.07, DARK, 0, 0.05, 0.38),
        box(0.06, 0.15, 0.07, DARK, 0, -0.1, -0.05), box(0.06, 0.13, 0.07, DARK, 0, -0.09, -0.35), box(0.03, 0.09, 0.03, METAL, 0, 0.19, -0.3),
        accent(0.195, 0.05, 0.12, 0, 0.05, -0.55));
      const tip = box(0.12, 0.12, 0.14, 0xd23b2a, 0, 0.05, -0.82);
      g.add(tip);
      g.userData.tip = tip;               // боеголовка торчит, пока базука заряжена
      muzzle = -0.86;
      break;
    }
  }
  if (mods) addMods(g, type, mods);
  if (fin) applyFinish(g, fin, FIN_BASE);
  g.userData.muzzle = new THREE.Vector3(0, 0.03, muzzle);
  return g;
}

// Кирка: рукоять вдоль −Z (вверх по экрану), фиолетовое двустороннее навершие.
function pickaxeModel() {
  const g = new THREE.Group();
  g.add(box(0.06, 0.06, 0.62, WOOD, 0, 0, -0.22), box(0.08, 0.08, 0.1, DARK, 0, 0, 0.05),
    box(0.1, 0.1, 0.12, METAL, 0, 0, -0.52), box(0.07, 0.42, 0.07, 0x8a5cff, 0, 0, -0.55, 0x2a1060),
    box(0.05, 0.08, 0.05, 0xd8c8ff, 0, 0.24, -0.55), box(0.05, 0.08, 0.05, 0xd8c8ff, 0, -0.24, -0.55));
  g.userData.muzzle = new THREE.Vector3(0, 0, -0.55);
  return g;
}

// ---------- От первого лица ----------
// Детальная модель (fpguns.js) в своей сцене поверх мира. Анимации: доставание, дыхание, покачивание при ходьбе
// и беге, инерция от поворота мышью, отдача пружиной (назад, вверх, чуть вбок), затвор пистолета, помпа дробовика
// и затвор снайперки после выстрела, гильзы, вспышка с подсветкой оружия, перезарядка по фазам (магазин выпадает,
// левая рука вставляет новый, взвод), патроны в дробовик по одному, ракета в базуку, удар киркой, лечение аптечкой.

const ease = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const bump = (p, a, b) => Math.sin(seg(p, a, b) * Math.PI);
// положение оружия в кадре (x вправо, y вверх, z от камеры)
const POSE = { pistol: [0.17, -0.17, -0.42], smg: [0.19, -0.18, -0.48], ar: [0.2, -0.18, -0.52], shotgun: [0.2, -0.18, -0.52], sniper: [0.2, -0.17, -0.55],
  bazooka: [0.34, -0.27, -0.95], pickaxe: [0.3, -0.36, -0.62], medkit: [0.06, -0.15, -0.4] };
// отдача: импульс назад (z), вверх (rx), разброс вбок (roll)
const KICK = { pistol: [2.8, 10, 4], smg: [1.4, 3.5, 3], ar: [1.8, 4.5, 2.5], shotgun: [5, 16, 5], sniper: [5.5, 16, 4], bazooka: [4.5, 11, 2.5] };

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,214,120,.95)'); gr.addColorStop(0.6, 'rgba(255,140,40,.35)'); gr.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 12 : 31; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
  g.fill();
  return new THREE.CanvasTexture(c);
}

export function createViewmodel(renderer, camera, modsOf = () => '', finOf = () => null, armsOf = () => ({})) {
  const vscene = new THREE.Scene();
  vscene.add(new THREE.HemisphereLight(0xffffff, 0x5a5a6a, 1.25));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.25); key.position.set(-1, 2, 1.2); vscene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd0ff, 0.7); rim.position.set(1.5, 0.6, -2); vscene.add(rim);
  const muzzleLight = new THREE.PointLight(0xffb85a, 0, 1.6, 2);     // всегда в сцене (иначе перекомпиляция шейдеров), гасим интенсивностью
  vscene.add(muzzleLight);
  const vcam = new THREE.PerspectiveCamera(62, camera.aspect, 0.01, 10);
  const holder = new THREE.Group();
  holder.scale.setScalar(0.66);
  vscene.add(holder);

  let fp = null, curKey = '', type = null;
  let equip = 1, bobT = 0, idleT = 0, swing = 1, shotT = 9, cycleT = 9, flashLeft = 0;
  let reloadTotal = 0, healTotal = 0;
  const sp = { z: 0, vz: 0, rx: 0, vrx: 0, rz: 0, vrz: 0 };
  const sway = { x: 0, y: 0 };
  let lastYaw = null, lastPitch = 0;
  const E = new THREE.Euler();

  // вспышка: три скрещённые плоскости со «звездой» (аддитивно)
  const flash = new THREE.Group();
  const fmat = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (const [rx, ry] of [[0, 0], [0, Math.PI / 2], [Math.PI / 2, 0]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, rx ? 0.16 : 0.26), fmat);
    m.rotation.set(rx, ry, 0);
    if (!rx) m.position.z = -0.06;
    flash.add(m);
  }
  flash.visible = false;

  // гильзы: пул, летят вправо-вверх-назад, крутятся, падают
  const shells = [];
  const shellGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 8);
  const shellMats = new Map();
  function ejectShell() {
    if (!fp || !fp.eject) return;
    const color = fp.shell;
    if (!shellMats.has(color)) shellMats.set(color, new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() }));
    let s = shells.find((x) => !x.m.visible);
    if (!s) { if (shells.length >= 14) s = shells[0]; else { s = { m: new THREE.Mesh(shellGeo, shellMats.get(color)) }; vscene.add(s.m); shells.push(s); } }
    s.m.material = shellMats.get(color);
    s.m.scale.setScalar(color === BRASS_C ? 1 : 1.9);
    fp.g.updateWorldMatrix(true, false);
    s.m.position.copy(fp.g.localToWorld(fp.eject.clone()));
    s.v = new THREE.Vector3(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.4, 0.15 + Math.random() * 0.2);
    s.spin = new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    s.age = 0;
    s.m.visible = true;
  }
  const BRASS_C = 0xd9a441;

  function set(weapon) {
    const mods = weapon && weapon.type !== 'pickaxe' && weapon.type !== 'medkit' ? modsOf(weapon.type) : '';
    const fin = weapon && weapon.type !== 'medkit' ? finOf(weapon.type) : null;
    const arms = armsOf() || {};
    const k = weapon ? `${weapon.type}:${weapon.rarity}:${mods}:${fin}:${arms.sleeve}:${arms.skin}` : '';
    if (k === curKey) return;
    curKey = k;
    if (fp) holder.remove(fp.g);
    fp = null; type = weapon?.type || null;
    if (!weapon) return;
    fp = buildFP(weapon.type, weapon.rarity, mods, fin, arms);
    if (type === 'pickaxe') fp.g.rotation.set(0.85, 0, -0.45);  // рукоять вверх и от себя, навершие — вверху справа
    flash.position.copy(fp.muzzle);
    fp.g.add(flash);
    flash.visible = false;
    holder.add(fp.g);
    equip = 0; shotT = 9; cycleT = 9; swing = 1;
  }

  function stepSpring(dt) {
    const K = 190, C = 19;
    for (const [x, v] of [['z', 'vz'], ['rx', 'vrx'], ['rz', 'vrz']]) {
      sp[v] += (-K * sp[x] - C * sp[v]) * dt;
      sp[x] += sp[v] * dt;
    }
  }

  // Части по их «покою» + смещение
  const at = (part, dp = [0, 0, 0], dr = [0, 0, 0]) => {
    if (!part) return;
    const r = part.userData.rest;
    part.position.set(r.p.x + dp[0], r.p.y + dp[1], r.p.z + dp[2]);
    part.rotation.set(r.r.x + dr[0], r.r.y + dr[1], r.r.z + dr[2]);
  };

  return {
    set,
    get debug() { return { fp, type, holder, equip }; },
    // Выстрел/удар: отдача, вспышка, гильза, цикл затвора/помпы.
    kick(t) {
      if (t === 'pickaxe') { swing = 0; return; }
      const k = KICK[t] || KICK.ar;
      sp.vz += k[0]; sp.vrx += k[1]; sp.vrz += (Math.random() - 0.5) * k[2];
      flashLeft = t === 'bazooka' ? 0.08 : 0.05;
      flash.scale.setScalar(t === 'shotgun' ? 1.5 : t === 'bazooka' ? 2.2 : t === 'pistol' ? 0.8 : 1 + Math.random() * 0.3);
      flash.rotation.z = Math.random() * Math.PI;
      shotT = 0;
      if (t === 'shotgun' || t === 'sniper') cycleT = 0; else if (t !== 'bazooka') ejectShell();
    },
    render(dt, o) {
      dt = Math.max(0, Math.min(dt, 0.1));
      const { moving, running, reload, heal, scoped, loaded } = o;
      // гильзы летят и когда оружие скрыто (оптика)
      for (const s of shells) {
        if (!s.m.visible) continue;
        s.age += dt;
        s.v.y -= 7 * dt;
        s.m.position.addScaledVector(s.v, dt);
        s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt; s.m.rotation.z += s.spin.z * dt;
        if (s.age > 0.8) s.m.visible = false;
      }
      if (!fp) return;
      const g = fp.g, P = fp.parts;
      // инерция от поворота камеры
      E.setFromQuaternion(camera.quaternion, 'YXZ');
      if (lastYaw === null) { lastYaw = E.y; lastPitch = E.x; }
      let dy = E.y - lastYaw; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      const dp = E.x - lastPitch;
      lastYaw = E.y; lastPitch = E.x;
      const kd = Math.min(1, dt * 10);
      sway.x += (THREE.MathUtils.clamp(-dy * 1.6, -0.06, 0.06) - sway.x) * kd;
      sway.y += (THREE.MathUtils.clamp(-dp * 1.6, -0.05, 0.05) - sway.y) * kd;

      stepSpring(Math.min(dt, 0.033));
      equip = Math.min(1, equip + dt * 3.6);
      shotT += dt; cycleT += dt; idleT += dt;
      flashLeft = Math.max(0, flashLeft - dt);
      flash.visible = flashLeft > 0 && !scoped;
      muzzleLight.intensity = flashLeft > 0 ? 6 : 0;
      if (flash.visible) { flash.updateWorldMatrix(true, false); muzzleLight.position.setFromMatrixPosition(flash.matrixWorld); }
      if (scoped) return;

      // ходьба / бег / дыхание
      bobT += dt * (moving ? (running ? 13 : 9) : 0);
      const amp = moving ? (running ? 0.02 : 0.011) : 0;
      const bx = Math.sin(bobT) * amp, by = -Math.abs(Math.cos(bobT)) * amp;
      const breath = Math.sin(idleT * 1.7) * 0.003;
      const run = running && moving && !reload ? 1 : 0;
      this._run = (this._run || 0) + (run - (this._run || 0)) * Math.min(1, dt * 8);
      const rn = this._run;

      const base = POSE[type] || POSE.ar;
      const ee = ease(equip);
      const pos = new THREE.Vector3(base[0] + bx + sway.x * 0.6, base[1] + by + breath + sway.y * 0.5 - (1 - ee) * 0.3 - rn * 0.03, base[2] + sp.z * 0.6);
      const rot = new THREE.Euler(sp.rx * 0.35 - (1 - ee) * 0.9 + sway.y * 0.8 - rn * 0.25, 0.05 + sway.x * 1.2 + rn * 0.5, sp.rz * 0.2 + (1 - ee) * 0.3 + bx * 1.5 + rn * 0.15);

      // ---- перезарядка ----
      if (reload && reload.left > 0) { if (!reloadTotal || reload.left > reloadTotal) reloadTotal = reload.left + dt; } else reloadTotal = 0;
      const rp = reloadTotal ? 1 - reload.left / reloadTotal : -1;
      at(P.mag); at(P.slide); at(P.charge); at(P.pump); at(P.bolt); at(P.tip);
      if (P.tip) P.tip.visible = loaded;
      if (P.lhand) { P.lhand.position.copy(P.lhand.userData.rest); }
      if (P.slide && !loaded && !reload) at(P.slide, [0, 0, 0.05]);                // пустой — затвор на задержке
      if (rp >= 0) {
        const env = ease(seg(rp, 0, 0.12)) * (1 - ease(seg(rp, 0.86, 1)));
        if (type === 'shotgun') {
          // по одному патрону в окно снизу: 4 движения левой рукой, в конце — помпа
          rot.z += 0.5 * env; rot.x += 0.12 * env; pos.y -= 0.03 * env;
          const k = seg(rp, 0.12, 0.82) * 4, f = k % 1, n = Math.floor(k);
          if (P.lhand && rp > 0.08 && rp < 0.86 && n < 4) {
            const r = P.lhand.userData.rest;
            const to = new THREE.Vector3(0, -0.11, -0.07);
            const t = f < 0.5 ? ease(f / 0.5) : 1 - ease((f - 0.5) / 0.5);
            P.lhand.position.set(r.x + (to.x - r.x) * t, r.y + (to.y - r.y) * t - 0.08 * Math.sin(t * Math.PI), r.z + (to.z - r.z) * t);
          }
          if (P.pump) at(P.pump, [0, 0, 0.09 * bump(rp, 0.86, 0.98)]);
        } else if (type === 'bazooka') {
          rot.x += 0.25 * env; pos.y -= 0.08 * env;
          if (P.tip) { P.tip.visible = rp > 0.55; at(P.tip, [0, 0, -0.35 * (1 - ease(seg(rp, 0.55, 0.78)))]); }
          if (P.lhand) { const r = P.lhand.userData.rest; const t = bump(rp, 0.3, 0.85); P.lhand.position.set(r.x, r.y + 0.1 * t, r.z - 0.4 * t); }
        } else {
          // магазинное: наклон, магазин вниз, новый снизу, взвод
          rot.z += -0.45 * env; rot.x += 0.25 * env; pos.y -= 0.035 * env;
          const out = ease(seg(rp, 0.14, 0.32)), inn = ease(seg(rp, 0.42, 0.66));
          const magY = rp < 0.42 ? -0.4 * out : -0.4 * (1 - inn);
          if (P.mag) { at(P.mag, [0, magY, 0]); P.mag.visible = !(rp > 0.3 && rp < 0.44); }
          if (P.lhand) {
            const r = P.lhand.userData.rest;
            const grab = new THREE.Vector3(0, -0.2, type === 'pistol' ? 0.03 : type === 'smg' ? -0.13 : type === 'sniper' ? -0.12 : -0.21);
            // где левая рука взводит: затворная задержка AR сбоку у магазина, рукоять SMG слева, затвор пистолета, рукоять затвора снайперки
            const ch = type === 'ar' ? new THREE.Vector3(-0.06, 0.0, -0.12) : type === 'smg' ? new THREE.Vector3(-0.07, 0.05, -0.04) : type === 'pistol' ? new THREE.Vector3(-0.01, 0.08, 0.03) : new THREE.Vector3(0.09, 0.05, 0.04);
            let lp;
            if (rp < 0.14) lp = r.clone().lerp(grab, ease(seg(rp, 0.05, 0.14)));
            else if (rp < 0.42) lp = grab.clone().add(new THREE.Vector3(0, -0.4 * ease(seg(rp, 0.14, 0.36)), 0));
            else if (rp < 0.68) lp = grab.clone().add(new THREE.Vector3(0, magY, 0));
            else if (rp < 0.86) lp = grab.clone().lerp(ch, ease(seg(rp, 0.68, 0.74))).add(new THREE.Vector3(0, 0, 0.06 * bump(rp, 0.74, 0.86)));
            else lp = ch.clone().lerp(r, ease(seg(rp, 0.86, 0.98)));
            P.lhand.position.copy(lp);
          }
          const pull = bump(rp, 0.74, 0.86);
          if (P.charge) at(P.charge, [0, 0, 0.06 * pull]);
          if (P.slide) at(P.slide, [0, 0, 0.05 * pull]);
          if (P.bolt) {
            const open = ease(seg(rp, 0.04, 0.12)) * (1 - ease(seg(rp, 0.78, 0.86)));
            const back = ease(seg(rp, 0.08, 0.14)) * (1 - ease(seg(rp, 0.74, 0.8)));
            at(P.bolt, [0, 0, 0.08 * back], [0, 0, 1.1 * open]);
          }
        }
      }

      // ---- после выстрела: затвор пистолета, помпа, затвор снайперки ----
      if (P.slide && shotT < 0.12 && rp < 0) at(P.slide, [0, 0, 0.05 * bump(shotT, 0, 0.1)]);
      if (type === 'shotgun' && cycleT < 0.7 && rp < 0) {
        const pb = bump(cycleT, 0.18, 0.55);
        at(P.pump, [0, 0, 0.1 * pb]);
        if (P.lhand) P.lhand.position.z = P.lhand.userData.rest.z + 0.1 * pb;
        rot.z += 0.08 * pb; pos.y -= 0.01 * pb;
        if (cycleT - dt < 0.36 && cycleT >= 0.36) ejectShell();
      }
      if (type === 'sniper' && cycleT < 1.0 && rp < 0) {
        const up = ease(seg(cycleT, 0.25, 0.38)) * (1 - ease(seg(cycleT, 0.72, 0.85)));
        const back = ease(seg(cycleT, 0.36, 0.5)) * (1 - ease(seg(cycleT, 0.56, 0.7)));
        at(P.bolt, [0, 0, 0.08 * back], [0, 0, 1.1 * up]);
        rot.z += -0.12 * up; rot.x += 0.04 * up;
        if (cycleT - dt < 0.5 && cycleT >= 0.5) ejectShell();
      }

      // ---- кирка: замах — удар — возврат ----
      if (type === 'pickaxe') {
        swing = Math.min(1, swing + dt / 0.42);
        const wind = ease(seg(swing, 0, 0.28)), hit = ease(seg(swing, 0.28, 0.5)), back = ease(seg(swing, 0.55, 1));
        const k = swing >= 1 ? 0 : 1;
        rot.x += k * (0.55 * wind - 1.75 * hit) * (1 - back);
        rot.y += k * (0.15 * wind + 0.45 * hit) * (1 - back);
        rot.z += k * (0.25 * wind - 0.6 * hit) * (1 - back);
        pos.x += k * (0.05 * wind - 0.12 * hit) * (1 - back);
        pos.y += k * (0.06 * wind - 0.05 * hit) * (1 - back);
      }

      // ---- аптечка: к центру, «прикладывает», обратно ----
      if (type === 'medkit') {
        if (heal && heal.left > 0) { if (!healTotal || heal.left > healTotal) healTotal = heal.left + dt; } else healTotal = 0;
        const hp = healTotal ? 1 - heal.left / healTotal : -1;
        if (hp >= 0) {
          const up = ease(seg(hp, 0, 0.15)) * (1 - ease(seg(hp, 0.9, 1)));
          pos.y += 0.06 * up; pos.z += 0.08 * up; rot.x += 0.5 * up;
          rot.z += Math.sin(hp * 40) * 0.05 * up; pos.y += Math.abs(Math.sin(hp * 20)) * 0.01 * up;
        }
      }

      holder.position.copy(pos);
      holder.rotation.copy(rot);

      vcam.aspect = camera.aspect;
      vcam.updateProjectionMatrix();
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(vscene, vcam);
      renderer.autoClear = true;
    },
  };
}
