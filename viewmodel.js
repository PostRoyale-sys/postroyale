// Модели оружия: в руках от первого лица (viewmodel) и у других игроков.
// От первого лица оружие рисуется отдельной сценой поверх мира (с очисткой глубины) — не проваливается в стены.
// Анимации: покачивание при ходьбе, отдача, наклон при перезарядке, подъём при смене, вспышка из ствола.

import * as THREE from 'three';
import { RARITY } from './combat.js';
import { toonGradient } from './art.js';
import { applyFinish } from './wskins.js';

const lam = (color, emissive = 0x000000) => new THREE.MeshToonMaterial({ color, emissive, gradientMap: toonGradient() });
function box(w, h, d, color, x, y, z, emissive) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color, emissive));
  m.position.set(x, y, z);
  return m;
}

const DARK = 0x2a2d33, METAL = 0x5b616b, WOOD = 0x7a5232, OLIVE = 0x56663a, SKIN = 0xe8b98f;

// Обвесы из Gunsmith на модели: mods — строка букв: o — прицел, m — двойной магазин, g — рукоятка/чок,
// s — быстрая перезарядка (неоновая муфта на магазине). Видны и от первого лица, и на оружии у других.
// Где магазин у каждого оружия: [x, y, z, ширина, высота, глубина].
const MAG_AT = { pistol: [0, -0.08, 0.02, 0.06, 0.15, 0.07], smg: [0, -0.12, -0.12, 0.05, 0.17, 0.06], ar: [0, -0.13, -0.2, 0.055, 0.19, 0.08], sniper: [0, -0.06, -0.12, 0.05, 0.1, 0.1], shotgun: [0, -0.03, -0.42, 0.085, 0.07, 0.22] };
function addMods(g, type, mods) {
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
      g.add(drum, cap);
    } else if (type === 'pistol') g.add(box(w * 0.95, 0.1, d * 0.95, DARK, x, y - h / 2 - 0.04, z), box(w * 1.1, 0.025, d * 1.15, 0xffc928, x, y - h / 2 - 0.095, z));
    else if (type === 'sniper') g.add(box(w, 0.12, d, DARK, x, y - h / 2 - 0.05, z));
    else if (type === 'shotgun') for (let i = 0; i < 5; i++) g.add(box(0.025, 0.045, 0.025, 0xd23b2a, 0.05, 0.0, -0.08 - i * 0.035), box(0.026, 0.012, 0.026, 0xffc928, 0.05, -0.025, -0.08 - i * 0.035));
  }
  if (has('g')) {
    if (type === 'shotgun') g.add(box(0.09, 0.09, 0.07, METAL, 0, 0.05, -0.7));                     // чок на конце ствола
    else if (type === 'pistol') g.add(box(0.04, 0.035, 0.08, DARK, 0, -0.035, -0.17), glass(0.025, 0.025, 0xfff6c0, 0, -0.035, -0.211));   // фонарик
    else g.add(box(0.035, 0.12, 0.045, DARK, 0, -0.08, type === 'ar' ? -0.42 : -0.3));              // вертикальная рукоятка
  }
  if (has('s') && mg) {
    const [x, y, z, w, , d] = mg;
    g.add(box(w * 1.25, 0.03, d * 1.25, 0x5dff9a, x, y, z, 0x1a6a3a));                               // неоновая муфта быстрой перезарядки
  }
}

// Модель оружия: ствол вдоль −Z, начало координат — у рукояти. userData.muzzle — точка вспышки.
// fin — раскраска скина из кейса (wskins.js): корпус/дерево → цвет «a», металл → «b».
const FIN_BASE = { a: [DARK, WOOD, OLIVE], b: [METAL, 0x8a5cff] };
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

function handsModel() {
  const g = new THREE.Group();
  g.add(box(0.11, 0.11, 0.42, SKIN, 0.02, -0.02, 0.05), box(0.13, 0.12, 0.13, SKIN, 0.02, 0.0, -0.18));
  return g;
}

// ---------- От первого лица ----------

export function createViewmodel(renderer, camera, modsOf = () => '', finOf = () => null) {
  const vscene = new THREE.Scene();
  vscene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(-1, 2, 1);
  vscene.add(sun);
  const vcam = new THREE.PerspectiveCamera(62, camera.aspect, 0.01, 10);
  const holder = new THREE.Group();
  holder.scale.setScalar(0.72);             // оружие компактнее — не закрывает пол-экрана
  vscene.add(holder);

  let model = null, key = '', type = null;
  let recoil = 0, swap = 1, bobT = 0, flashLeft = 0, swing = 0;
  const flash = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: 0xffe08a }));

  function set(weapon) {
    const mods = weapon && weapon.type !== 'pickaxe' ? modsOf(weapon.type) : '';
    const fin = weapon ? finOf(weapon.type) : null;
    const k = weapon ? `${weapon.type}:${weapon.rarity}:${mods}:${fin}` : 'hands';
    if (k === key) return;
    key = k;
    type = weapon?.type || null;
    if (model) holder.remove(model);
    model = weapon ? weaponModel(weapon.type, weapon.rarity, mods, fin) : handsModel();
    if (weapon && weapon.type === 'pickaxe') {
      model.rotation.x = 1.0;                 // рукоять вверх и от себя, навершие — вверху справа
      model.add(box(0.1, 0.1, 0.16, SKIN, 0.0, 0, 0.0));
    } else if (weapon) {
      // Кисть на рукояти.
      model.add(box(0.1, 0.1, 0.3, SKIN, 0.03, -0.14, 0.17));
      flash.position.copy(model.userData.muzzle);
      model.add(flash);
    }
    flash.visible = false;
    holder.add(model);
    swap = 0;
  }

  return {
    set,
    // Вызвать при выстреле: отдача и вспышка.
    kick(t) {
      if (t === 'pickaxe') { swing = 1; return; }
      recoil = t === 'bazooka' ? 1 : t === 'shotgun' || t === 'sniper' ? 0.8 : 0.35;
      flashLeft = t === 'bazooka' ? 0.08 : 0.05;
    },
    render(dt, { moving, reloading, scoped, loaded }) {
      if (scoped || !model) return;
      bobT += dt * (moving ? 9 : 1.6);
      const bob = Math.sin(bobT) * (moving ? 0.014 : 0.004);
      recoil = Math.max(0, recoil - dt * 6);
      swap = Math.min(1, swap + dt * 4.5);
      flashLeft = Math.max(0, flashLeft - dt);
      swing = Math.max(0, swing - dt * 3.2);
      flash.visible = flashLeft > 0;
      flash.rotation.z = Math.random() * Math.PI;
      if (model.userData.tip) model.userData.tip.visible = loaded;

      const shoulder = type === 'bazooka';
      const bx = shoulder ? 0.34 : type ? 0.2 : 0.26;
      const by = shoulder ? -0.27 : type ? -0.19 : -0.24;
      const bz = shoulder ? -0.95 : type ? -0.4 : -0.42;     // базука длинная — держим дальше, иначе труба закрывает экран
      holder.position.set(bx + bob * 0.6, by + Math.abs(bob) - (1 - swap) * 0.3 - (reloading ? 0.1 : 0), bz + recoil * 0.09);
      holder.rotation.set(recoil * 0.22 + (reloading ? 0.55 : 0), 0.05 + (type ? 0 : -0.25), reloading ? -0.25 : 0);
      if (type === 'pickaxe') {
        // удар: замах вверх и резко вниз-влево
        const k = swing > 0.7 ? (1 - swing) / 0.3 : swing / 0.7;
        holder.position.set(0.3, -0.32 + bob * 0.5 - (1 - swap) * 0.3, -0.5);
        holder.rotation.set(-k * 1.3, 0.2 + k * 0.4, -0.3 - k * 0.5);
      }

      vcam.aspect = camera.aspect;
      vcam.updateProjectionMatrix();
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(vscene, vcam);
      renderer.autoClear = true;
    },
  };
}
