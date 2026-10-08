// PostRoyale — королевская битва по ссылке. Создал матч → ссылка ?w=<id> → кинул в X → все, кто открыл, играют вместе.
// Карта (map.js) генерируется из id: гладкий остров, локации с домами, лес, камни, машины — у всех одинаковая.
// Рельеф не ломается; ломаются постройки и объекты (structures.js): киркой добываешь дерево/кирпич/металл
// и строишь стены, полы, рампы. Оружие — из сундуков (loot.js), бой — combat.js, раунды и шторм — royale.js.
// Сеть — P2P (net.js), постройки живут один раунд.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GameMap, MAP, WATER_Y } from './map.js';
import { toonGradient, toon } from './art.js';
import { createStructures, MATS, MAT_INFO, BUILD_COST, MAT_MAX, PICK_DMG } from './structures.js';
import { connect } from './net.js';
import { createCombat, WEAPONS, RARITY, AMMO, MAX_SHIELD, weaponLabel, rayBox } from './combat.js';
import { createLoot, itemLabel } from './loot.js';
import { createViewmodel, weaponModel } from './viewmodel.js';
import { createRoyale, ROUND_MS, DROP_MS } from './royale.js';
import { createSeason, TIERS, TOKEN_MINT } from './season.js';

const NAME = 'PostRoyale';                     // название — менять здесь (и в <title> index.html)
const EYE = 1.62, HEIGHT = 1.8, HALF = 0.3;
const GRAVITY = 30, JUMP = 9, WALK = 5.5, RUN = 8, GLIDE = 13;
const PICK_REACH = 3.4, PICK_RATE = 0.42, BUILD_RATE = 0.12;
const POSE_HZ = 10;
const FOV = 80, SCOPE_FOV = 22;

const $ = (id) => document.getElementById(id);
document.querySelectorAll('.name').forEach((n) => { n.textContent = NAME; });

// ---------- Игрок и комната ----------

const params = new URLSearchParams(location.search);
let worldId = params.get('w');
const randId = () => Math.random().toString(36).slice(2, 10);
const COLORS = ['#1d9bf0', '#16c784', '#f4212e', '#ffad1f', '#a970ff', '#ff6bd6', '#00d4d4', '#ff7a1a'];
const colorOf = (s) => COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const ANIMALS = ['Frog', 'Cat', 'Ape', 'Bull', 'Bear', 'Whale', 'Pepe', 'Doge', 'Shrimp', 'Degen'];
let nick = localStorage.getItem('pc:nick') || `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}${Math.floor(Math.random() * 900 + 100)}`;
$('nick').value = nick;

if (worldId) {
  $('go').textContent = 'Join match';
  $('introsub').textContent = `You were invited to match “${worldId}”. Pick a name and drop in — loot chests, build, outrun the storm, be the last one standing.`;
}

// ---------- Сцена ----------

// Мультяшный стиль: cel-затенение (MeshToonMaterial), мягкие тени от солнца, градиентное небо, облака, бирюзовое море.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = 0xbfe9ff, ZENITH = 0x2f8fff;
scene.background = new THREE.Color(HORIZON);
scene.fog = new THREE.Fog(HORIZON, 140, 420);
const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 1000);
scene.add(new THREE.HemisphereLight(0xd8efff, 0x7a6a48, 1.25));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
const SUN_DIR = new THREE.Vector3(-0.45, 1, 0.35).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// Небо: купол с вертикальным градиентом и солнечным ореолом, ездит за камерой.
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(ZENITH) }, bottom: { value: new THREE.Color(HORIZON) }, sunDir: { value: SUN_DIR } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
    void main(){ float h = clamp(vDir.y * 1.6, 0.0, 1.0); vec3 c = mix(bottom, top, pow(h, 0.7));
      float s = max(dot(vDir, sunDir), 0.0); c += vec3(1.0, 0.92, 0.7) * (pow(s, 400.0) * 1.2 + pow(s, 12.0) * 0.18);
      gl_FragColor = vec4(c, 1.0);
#include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -1;
scene.add(sky);

// Облака: кучки белых сфер с cel-затенением, медленно плывут.
const clouds = new THREE.Group();
{
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), fog: false, emissive: 0x6f8fb0 });
  const geo = new THREE.IcosahedronGeometry(1, 2);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 30; i++) {
    const c = new THREE.Group();
    const n = 4 + (rnd() * 4 | 0);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(geo, mat);
      const sc = 6 + rnd() * 7;
      p.scale.set(sc * 1.3, sc * 0.8, sc);
      p.position.set((k - n / 2) * 7 + rnd() * 3, rnd() * 3, rnd() * 6 - 3);
      c.add(p);
    }
    c.position.set(MAP / 2 + (rnd() - 0.5) * 800, 130 + rnd() * 50, MAP / 2 + (rnd() - 0.5) * 800);
    clouds.add(c);
  }
  scene.add(clouds);
}

const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP * 8, MAP * 8).rotateX(-Math.PI / 2),
  toon(0x29c9e6, { transparent: true, opacity: 0.82, emissive: 0x06425a }));
water.position.set(MAP / 2, WATER_Y, MAP / 2);
water.receiveShadow = true;
scene.add(water);

const controls = new PointerLockControls(camera, renderer.domElement);
const player = controls.object ?? controls.getObject();
scene.add(player);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Карта и постройки ----------

let world = null, terrain = null;
const structures = createStructures({ scene });

// ---------- Физика игрока ----------

const vel = new THREE.Vector3();
let onGround = false, moving = false, gliding = false;   // полёта нет: только ходьба, прыжок и планирование при высадке
const keys = new Set();
const feet = new THREE.Vector3();          // позиция ног; камера — на высоте глаз
const knockVel = new THREE.Vector3();

function moveAxis(axis, d) {
  if (!d) return false;
  const steps = Math.ceil(Math.abs(d) / 0.2);
  const s = d / steps;
  for (let i = 0; i < steps; i++) {
    feet[axis] += s;
    if (structures.blocked(feet.x, feet.y, feet.z, HEIGHT, HALF)) { feet[axis] -= s; return true; }
  }
  return false;
}

const randomLand = () => {
  for (let i = 0; i < 400; i++) {
    const x = 20 + Math.random() * (MAP - 40), z = 20 + Math.random() * (MAP - 40);
    if (world.height(x, z) > 3) return { x, z };
  }
  return { x: MAP / 2, z: MAP / 2 };
};

// Высадка: с высоты над случайной точкой суши, планирование до земли.
function spawn(drop = true) {
  const { x, z } = randomLand();
  const g = world.height(x, z);
  feet.set(x, drop ? Math.max(g, 30) + 70 : g + 0.05, z);
  vel.set(0, 0, 0);
  gliding = drop;
}

function step(dt) {
  const scoped = isScoped();
  const speed = gliding ? GLIDE : (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !scoped ? RUN : scoped ? WALK * 0.5 : WALK;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const move = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
  if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
  moving = move.lengthSq() > 0 || !onGround;
  if (move.lengthSq()) move.normalize().multiplyScalar(speed * dt);

  // Отброс от взрыва гасится за полсекунды.
  move.addScaledVector(knockVel, dt);
  knockVel.multiplyScalar(Math.max(0, 1 - 4 * dt));

  {
    moveAxis('x', move.x);
    moveAxis('z', move.z);
    if (keys.has('Space') && onGround) { vel.y = JUMP; onGround = false; }
    vel.y = Math.max(vel.y - GRAVITY * dt, gliding ? -9 : -45);
    let ny = feet.y + vel.y * dt;
    if (vel.y > 0) {
      const top = structures.ceiling(feet.x, feet.y, ny, feet.z, HEIGHT, HALF);
      if (ny > top) { ny = top; vel.y = 0; }
    }
    const g = structures.ground(feet.x, feet.z, Math.max(feet.y, ny), HALF);
    // На земле прилипаем к опоре, если она чуть ниже (спуск по рампе и склону без подпрыгиваний).
    if (ny <= g || (onGround && vel.y <= 0 && feet.y - g < 0.6)) { ny = g; vel.y = 0; onGround = true; gliding = false; }
    else onGround = false;
    feet.y = ny;
    // Вода: плаваем у поверхности.
    if (feet.y < WATER_Y - 1.1) { vel.y = Math.max(vel.y, -2); if (keys.has('Space') || feet.y < WATER_Y - 1.4) vel.y = 3; }
  }
  feet.x = Math.max(-60, Math.min(MAP + 60, feet.x));
  feet.z = Math.max(-60, Math.min(MAP + 60, feet.z));
  player.position.set(feet.x, feet.y + EYE, feet.z);
}

// ---------- Хотбар: кирка + 3 слота оружия; режим стройки ----------
// 1 — кирка, 2–4 — оружие, колесо — по кругу. Z стена, X пол, C рампа, V — материал, ЛКМ — поставить (можно зажать).

const ENTRIES = [{ pick: true }, { weapon: 0 }, { weapon: 1 }, { weapon: 2 }];
const PICKAXE = { type: 'pickaxe', rarity: 0 };
let slot = 0;
let buildType = null, buildMat = 0;
const mats = Object.fromEntries(MATS.map((m) => [m, 0]));
const PIECE_NAMES = { w: 'Wall', f: 'Floor', r: 'Ramp' };

const currentWeapon = () => { const e = ENTRIES[slot]; return !buildType && e.weapon !== undefined ? combat.slots[e.weapon] : null; };
const holding = () => (buildType ? null : ENTRIES[slot].pick ? PICKAXE : currentWeapon());
let scopeHeld = false;
const isScoped = () => scopeHeld && !!currentWeapon() && !!WEAPONS[currentWeapon().type].scope;
let mouseDown = false;
const eye = () => camera.getWorldPosition(new THREE.Vector3());
const look = () => camera.getWorldDirection(new THREE.Vector3());

// Кирка: игрок рядом — 20 урона; постройка/объект — урон и материалы.
let nextSwing = 0;
function swingPickaxe(now) {
  if (now < nextSwing || !royale.alive) return;
  nextSwing = now + PICK_RATE;
  vm.kick('pickaxe');
  combat.sfx('swing');
  const o = eye(), d = look();
  const chest = loot.chestNear(o, d);
  if (chest) { openChest(chest); return; }
  for (const [peerId, p] of others) {
    if (p.target?.a === false) continue;
    const c = p.group.position;
    const t = rayBox(o, d, new THREE.Vector3(c.x - 0.45, c.y, c.z - 0.45), new THREE.Vector3(c.x + 0.45, c.y + 1.9, c.z + 0.45));
    if (t < PICK_REACH) { net?.hit({ dmg: 20, by: nick, w: 'pickaxe' }, peerId); hitmarker(); combat.sfx('chop'); return; }
  }
  const hit = structures.raycast(o, d, PICK_REACH);
  if (hit?.e) {
    combat.sfx('chop');
    chips(hit.point, hit.e);
    damageStructure(hit.e.k, PICK_DMG, true);
  }
}
// Урон постройке: локально + всем. harvest — удар киркой: материалы себе.
function damageStructure(k, dmg, harvest) {
  const res = structures.damage(k, dmg);
  if (!res) return;
  net?.edit({ k, x: dmg, rr: royale.round });
  if (harvest) {
    const { mat, n } = structures.harvestOf(res.e, res.destroyed);
    const before = mats[mat];
    mats[mat] = Math.min(MAT_MAX, mats[mat] + n);
    if (mats[mat] > before) pointsToast(`+${mats[mat] - before} ${MAT_INFO[mat].name}`);
    renderMats();
  }
}

// Щепки/осколки при ударе киркой.
const chipGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const fxList = [];
function chips(p, e) {
  const color = e.kind === 'piece' ? MAT_INFO[e.m].tint : e.type === 'rock' ? 0x9aa3ad : e.type === 'car' ? 0xc0c8d4 : 0xb07a45;
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(chipGeo, mat);
    m.position.copy(p);
    scene.add(m);
    fxList.push({ m, v: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).multiplyScalar(6), age: 0 });
  }
}
function updateFx(dt) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.age += dt;
    f.v.y -= 20 * dt;
    f.m.position.addScaledVector(f.v, dt);
    if (f.age > 0.6) { scene.remove(f.m); fxList.splice(i, 1); }
  }
}

// Стройка: деталь перед игроком за BUILD_COST материала.
let plan = null, nextBuild = 0;
function updatePlan() {
  if (!buildType || !royale.alive) { plan = null; structures.ghost(null); return; }
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  plan = structures.plan(buildType, feet, e.y, e.x, MATS[buildMat]);
  const ok = mats[plan.m] >= BUILD_COST && !structures.has(plan.k);
  structures.ghost(structures.has(plan.k) ? null : plan, ok);
}
function placePiece(now) {
  if (!plan || now < nextBuild || structures.has(plan.k)) return;
  if (mats[plan.m] < BUILD_COST) { toast(`Need ${BUILD_COST} ${MAT_INFO[plan.m].name}`); nextBuild = now + 0.5; return; }
  const { k, t, ix, iy, iz, o, m } = plan;
  if (!structures.add({ k, t, ix, iy, iz, o, m })) return;
  mats[m] -= BUILD_COST;
  nextBuild = now + BUILD_RATE;
  combat.sfx('build');
  net?.edit({ a: 1, k, t, ix, iy, iz, o, m, rr: royale.round });
  renderMats();
}

function enterBuild(t) {
  if (!royale.alive) return;
  if (buildType === t) { exitBuild(); return; }
  buildType = t;
  scopeHeld = false;
  combat.cancelReload();
  renderHotbar();
  showName(`${PIECE_NAMES[t]} · ${MAT_INFO[MATS[buildMat]].name}`, MAT_INFO[MATS[buildMat]].color);
}
function exitBuild() { buildType = null; structures.ghost(null); renderHotbar(); }

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!controls.isLocked || !world) return;
  const w = currentWeapon();
  if (e.button === 2 && w && WEAPONS[w.type].scope) { scopeHeld = true; return; }
  if (e.button === 2 && buildType) { exitBuild(); return; }
  if (e.button !== 0) return;
  mouseDown = true;
  const now = performance.now() / 1000;
  if (buildType) { updatePlan(); placePiece(now); return; }      // план — на момент клика, не ждём кадра
  if (ENTRIES[slot].pick) { swingPickaxe(now); return; }
  if (w) combat.fire(ENTRIES[slot].weapon, now);
  else {
    const chest = loot.chestNear(eye(), look());
    if (chest) openChest(chest);
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) scopeHeld = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- HUD ----------

function renderHotbar() {
  const bar = $('hotbar');
  bar.textContent = '';
  ENTRIES.forEach((entry, i) => {
    const d = document.createElement('div');
    d.className = `wslot${i === slot && !buildType ? ' on' : ''}`;
    if (entry.pick) {
      d.innerHTML = '<b>⛏</b><small>Pickaxe</small>';
      d.title = 'Pickaxe — harvest wood, brick, metal';
    } else {
      const w = combat.slots[entry.weapon];
      if (w) {
        const spec = WEAPONS[w.type];
        d.style.setProperty('--rar', RARITY[w.rarity].color);
        d.innerHTML = `<b>${spec.tag}</b><small>${w.mag}/${combat.ammo[spec.ammo]}</small>`;
        d.title = weaponLabel(w);
      } else {
        d.innerHTML = '<b class="empty">·</b>';
        d.title = 'Empty — loot chests';
      }
    }
    const s = document.createElement('span'); s.textContent = i + 1; d.appendChild(s);
    d.addEventListener('click', () => pick(i));
    bar.appendChild(d);
  });
  // Детали стройки
  for (const [t, key] of [['w', 'Z'], ['f', 'X'], ['r', 'C']]) {
    const d = document.createElement('div');
    d.className = `bslot${buildType === t ? ' on' : ''}`;
    d.innerHTML = `<i class="pc-${t}"></i><span>${key}</span>`;
    d.title = PIECE_NAMES[t];
    d.addEventListener('click', () => enterBuild(t));
    bar.appendChild(d);
  }
  renderMats();
}

function renderMats() {
  $('mats').innerHTML = MATS.map((m, i) =>
    `<div class="${i === buildMat ? 'on' : ''}${mats[m] ? '' : ' zero'}"><i style="background:${MAT_INFO[m].color}"></i>${MAT_INFO[m].name}<b>${mats[m]}</b></div>`).join('') +
    '<p>V — switch material</p>';
}

let nameTimer = 0;
function showName(text, color = '') {
  $('blockname').textContent = text;
  $('blockname').style.color = color;
  $('blockname').style.opacity = 1;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => { $('blockname').style.opacity = 0; }, 1400);
}

function pick(i) {
  scopeHeld = false;
  combat.cancelReload();
  if (buildType) { buildType = null; structures.ghost(null); }
  slot = (i + ENTRIES.length) % ENTRIES.length;
  renderHotbar();
  const entry = ENTRIES[slot];
  const w = currentWeapon();
  showName(entry.pick ? 'Pickaxe' : w ? weaponLabel(w) : 'Empty slot', w ? RARITY[w.rarity].color : '');
}
addEventListener('wheel', (e) => { if (controls.isLocked) pick(slot + Math.sign(e.deltaY)); }, { passive: true });

function renderStatus() {
  $('hpfill').style.width = `${combat.hp}%`;
  $('hpfill').className = combat.hp < 35 ? 'low' : '';
  $('hptext').textContent = combat.hp;
  $('shfill').style.width = `${(combat.shield / MAX_SHIELD) * 100}%`;
  $('shtext').textContent = combat.shield;
  $('ammo').innerHTML = Object.entries(AMMO).map(([k, a]) =>
    `<div class="${combat.ammo[k] ? '' : 'zero'}"><i style="background:${a.color}"></i>${a.name}<b>${combat.ammo[k]}</b></div>`).join('');
  if (world) renderHotbar();
}

// Название локации — при входе в неё.
let lastPoi = null;
function updatePoi() {
  const p = world.poiAt(feet.x, feet.z, 4);
  if (p === lastPoi) return;
  lastPoi = p;
  if (!p) return;
  $('poi').textContent = p.name;
  $('poi').classList.remove('on'); void $('poi').offsetWidth; $('poi').classList.add('on');
}

// ---------- Другие игроки ----------

const others = new Map();     // peerId → { group, target: {x,y,z,r,g,q,a,rr,h}, name, gun }

function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 30px -apple-system, Segoe UI, Roboto, sans-serif';
  const w = Math.min(248, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(11,13,18,.7)';
  g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 22); g.fill();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.fillText(text, 128, 43);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(2, 0.5, 1);
  s.position.y = 2.35;
  return s;
}

// Мультяшный персонаж: капсула-тело, круглая голова с глазами, ноги.
function avatar(name, tier = -1) {
  const color = colorOf(name);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.55, 6, 12), toon(color));
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), toon(0xffd2a8));
  head.position.y = 1.72;
  const eyeGeo = new THREE.SphereGeometry(0.05, 8, 6), eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const e1 = new THREE.Mesh(eyeGeo, eyeMat), e2 = new THREE.Mesh(eyeGeo, eyeMat);
  e1.position.set(-0.1, 1.76, -0.27); e2.position.set(0.1, 1.76, -0.27);
  const legGeo = new THREE.CapsuleGeometry(0.11, 0.4, 4, 8), legMat = toon(0x34406a);
  const l1 = new THREE.Mesh(legGeo, legMat), l2 = new THREE.Mesh(legGeo, legMat);
  l1.position.set(-0.14, 0.32, 0); l2.position.set(0.14, 0.32, 0);
  for (const m of [body, head, l1, l2]) m.castShadow = true;
  const t = TIERS[tier];
  g.add(body, head, e1, e2, l1, l2, nameSprite(t ? `★ ${name}` : name, t ? t.color : color));
  return g;
}

function upsertOther(peerId, d) {
  let o = others.get(peerId);
  const tier = d.h ?? -1;
  if (!o || o.name !== d.n || o.tier !== tier) {
    if (o) scene.remove(o.group);
    o = { group: avatar(d.n, tier), name: d.n, tier, target: d };
    o.group.position.set(d.x, d.y, d.z);
    scene.add(o.group);
    others.set(peerId, o);
  }
  o.target = d;
  o.group.visible = d.a !== false;              // наблюдателей не видно
  // Что в руках: тип g и редкость q из pose.
  const gk = d.g ? `${d.g}:${d.q}` : '';
  if (o.gunKey !== gk) {
    if (o.gun) o.group.remove(o.gun);
    o.gun = null;
    o.gunKey = gk;
    if (d.g) {
      o.gun = weaponModel(d.g, d.q || 0);
      o.gun.position.set(0.34, 1.12, -0.25);
      if (d.g === 'bazooka') o.gun.position.set(0.32, 1.5, 0.05);
      if (d.g === 'pickaxe') o.gun.rotation.x = 1.0;
      o.group.add(o.gun);
    }
  }
}

const peers = new Set();       // подключённые игроки (по onPeerJoin), даже если их позиция ещё не пришла

function updateCount() {
  $('net').textContent = net ? `${peers.size + 1} online` : 'offline';
  $('net').className = `pill ${net ? 'on' : 'off'}`;
}

// ---------- Чат и лента убийств ----------

function say(name, text) {
  const line = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = name;
  b.style.color = colorOf(name);
  line.append(b, text);
  $('chatlog').appendChild(line);
  while ($('chatlog').children.length > 8) $('chatlog').firstChild.remove();
}

const KILL_ICON = { pistol: '🔫', smg: '🔫', ar: '🔫', shotgun: '💥', sniper: '🎯', bazooka: '🚀', rocket: '🚀', storm: '🌪', pickaxe: '⛏' };
function killfeed(by, victim, w) {
  const line = document.createElement('div');
  line.className = 'kill';
  const icon = KILL_ICON[w] || '💀';
  line.textContent = w === 'storm' ? `${victim} ${icon} got caught in the storm` : by === victim ? `${victim} ${icon} blew themselves up` : `${by} ${icon} ${victim}`;
  $('chatlog').appendChild(line);
  while ($('chatlog').children.length > 8) $('chatlog').firstChild.remove();
}

function openChat() {
  $('chatbox').hidden = false;
  controls.unlock();
  setTimeout(() => $('chatin').focus(), 0);
}
$('chatin').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const t = $('chatin').value.trim().slice(0, 140);
    if (t) { say(nick, t); net?.chat({ n: nick, t }); }
    $('chatin').value = '';
    $('chatbox').hidden = true;
    controls.lock();
  } else if (e.key === 'Escape') {
    $('chatbox').hidden = true;
  }
});

let toastTimer = 0;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 1600);
}
function hitmarker() { const h = $('hitmark'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); }

// ---------- Бой, лут, раунды ----------

let shakeAmt = 0;
let swapCandidate = null;

const ctx = {
  scene, camera,
  world: () => world,
  structures: () => structures,
  feet: () => feet,
  others,
  net: () => net,
  selfId: () => net?.selfId || 'me',
  nick: () => nick,
  toast, killfeed,
  scoped: () => isScoped(),
  moving: () => moving,
  canPlay: () => royale.alive,
  died: (by) => royale.eliminate(by),
  damageStructure,
  // Раунд (royale.js)
  onRoundStart, onEliminated, onWinner,
  stormHud,
  stormDamage: (d) => combat.takeDamage(d, 'Storm', 'storm'),
  points: (k) => season.add(k),
  // Сезон (season.js)
  pointsToast, onSeason: renderSeason,
  onInventory: () => renderStatus(),
  flash: (kind) => { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = kind === 'shield' ? 'shield' : 'on'; },
  hitmarker,
  shake: (a) => { shakeAmt = Math.max(shakeAmt, a); },
  knock: (v) => { knockVel.add(v); vel.y = Math.max(vel.y, v.y + 4); onGround = false; },
  dropItems: (pos, items) => loot.drop(pos, items),
  recoil: (type) => vm.kick(type),
};
const combat = createCombat(ctx);
const loot = createLoot(ctx);
const royale = createRoyale(ctx);
const season = createSeason(ctx);
const vm = createViewmodel(renderer, camera);

// ---------- Раунд и сезон ----------

let goldenKeyRound = -1;         // золотой ключ держателя: +1 к редкости одного сундука за раунд
function openChest(chest) {
  if (!royale.alive) return;
  const key = season.tier >= 0 && goldenKeyRound !== royale.round;
  if (!loot.open(chest, key ? 1 : 0)) return;
  if (key) { goldenKeyRound = royale.round; toast('🔑 Golden key: +1 rarity'); }
  season.add('chest');
}

let bannerTimer = 0;
function banner(title, sub = '', ms = 3500) {
  $('banner').innerHTML = '';
  const h = document.createElement('b'); h.textContent = title;
  const p = document.createElement('span'); p.textContent = sub;
  $('banner').append(h, p);
  $('banner').hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { $('banner').hidden = true; }, ms);
}

function onRoundStart(r, alive) {
  structures.reset();             // дома и деревья — заново, постройки игроков исчезают
  loot.resetRound(r, r * ROUND_MS);
  combat.resetAll();
  for (const m of MATS) mats[m] = 0;
  buildType = null;
  goldenKeyRound = -1;
  renderHotbar();
  if (alive) {
    spawn(true);
    season.roundStarted();
    const late = Date.now() - r * ROUND_MS > DROP_MS;
    banner('DROP!', late ? 'Match in progress — glide down, loot fast, watch the storm' : 'Glide down, grab weapons from chests — the storm closes in 30s');
  } else {
    gliding = false;
    const left = Math.ceil((ROUND_MS - (Date.now() - r * ROUND_MS)) / 1000);
    banner('Match in progress', `You're spectating — next drop in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · walk around and watch`, 5000);
  }
}

function onEliminated(place, by) {
  gliding = false;
  buildType = null;
  structures.ghost(null);
  vel.set(0, 0, 0);
  season.placed(place);
  banner(place > 1 ? `#${place}` : 'Eliminated', by === 'Storm' ? 'Caught in the storm · spectating until next drop' : by === nick ? 'You blew yourself up' : `Eliminated by ${by} · spectating until next drop`, 5000);
}

function onWinner(name, me) {
  if (me) season.add('win');
  banner(me ? '🏆 VICTORY ROYALE' : `🏆 ${name} wins`, me ? 'Last one standing — share the clip!' : 'Next drop at the top of the round', 6000);
  say('🏆', ` ${name} won the round`);
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
let lastStorm = '';
function stormHud({ t, storm, alive, outside, spectating, drop }) {
  const left = drop ? (DROP_MS - t) / 1000 : storm.left;
  const what = drop ? 'Storm in' : storm.shrinking ? 'Storm closing' : 'Storm shrinks in';
  const txt = `${spectating ? '👁 Spectating · ' : ''}👥 ${alive} alive · 🌪 ${what} ${mmss(left)}`;
  if (txt !== lastStorm) { $('storm').textContent = txt; lastStorm = txt; }
  $('storm').classList.toggle('danger', outside);
  $('stormtint').classList.toggle('on', outside);
}

let ptsTimer = 0;
function pointsToast(text) {
  const d = document.createElement('div');
  d.textContent = text;
  $('pts').appendChild(d);
  while ($('pts').children.length > 4) $('pts').firstChild.remove();
  clearTimeout(ptsTimer);
  ptsTimer = setTimeout(() => { $('pts').textContent = ''; }, 2500);
}

function renderSeason() {
  const s = season.stats, w = season.wallet, t = season.tierInfo(season.tier);
  $('season').innerHTML = `<div class="sh"><b>Season 1</b><span>${s.points.toLocaleString('en')} pts</span></div>
    <div class="sg"><div><b>${s.kills}</b>kills</div><div><b>${s.wins}</b>wins</div><div><b>${s.chests}</b>chests</div><div><b>${s.rounds}</b>drops</div></div>`;
  const row = document.createElement('div');
  row.className = 'sw';
  if (w) {
    const label = document.createElement('span');
    label.textContent = `${w.pubkey.slice(0, 4)}…${w.pubkey.slice(-4)} · ${t ? `★ ${t.name}` : TOKEN_MINT ? 'no tokens' : 'linked'}`;
    if (t) label.style.color = t.color;
    const off = document.createElement('button');
    off.textContent = 'Unlink';
    off.onclick = () => season.disconnect();
    row.append(label, off);
  } else {
    const on = document.createElement('button');
    on.textContent = 'Link Solana wallet';
    on.onclick = () => season.connect(nick);
    row.append(on);
  }
  $('season').appendChild(row);
  const note = document.createElement('p');
  note.textContent = 'Points are for fun and the leaderboard — no cash value. Holders get cosmetics + a golden key (+1 rarity on one chest per match).';
  $('season').appendChild(note);
}

// ---------- Сеть ----------

let net = null;
let lastPose = 0, lastSent = '';

// Правка постройки от другого игрока: поставил деталь или нанёс урон.
function onStructEdit(d) {
  if (d.rr !== undefined && d.rr !== royale.round) return;
  if (d.a) structures.add({ k: d.k, t: d.t, ix: d.ix, iy: d.iy, iz: d.iz, o: d.o, m: d.m });
  else if (d.x) structures.damage(d.k, d.x);
}

let startNet = function () {
  try {
    net = connect(worldId, {
      join(peerId) {
        peers.add(peerId);
        net.sync({ s: structures.syncList(), rr: royale.round }, peerId);
        net.pose(poseData(), peerId);
        loot.syncTo(peerId);
        updateCount();
      },
      leave(peerId) {
        peers.delete(peerId);
        const o = others.get(peerId);
        if (o) { scene.remove(o.group); others.delete(peerId); }
        updateCount();
      },
      pose(peerId, d) { upsertOther(peerId, d); },
      edit(peerId, d) { onStructEdit(d); },
      sync(peerId, d) { if (d.rr === royale.round && d.s) structures.applySync(d.s); },
      chat(peerId, d) { say(d.n, d.t); },
      shot(peerId, d) { combat.onShot(peerId, d); },
      hit(peerId, d) { combat.onHit(peerId, d); },
      dead(peerId, d) {
        combat.onDead(peerId, d);
        royale.onPeerDead();
        if (d.by === nick && d.n !== nick && royale.alive) season.add('kill');
      },
      win(peerId, d) { royale.onWin(peerId, d); },
      chest(peerId, d) { loot.onChest(peerId, d); },
      loot(peerId, d) { loot.onLoot(peerId, d); },
      take(peerId, d) { loot.onTake(peerId, d); },
    });
    updateCount();
  } catch (e) {
    console.warn(`[${NAME}] P2P недоступен:`, e);
    net = null;
    updateCount();
  }
};

function poseData() {
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  const d = { x: +feet.x.toFixed(2), y: +feet.y.toFixed(2), z: +feet.z.toFixed(2), r: +yaw.toFixed(2), n: nick, a: royale.alive, rr: royale.round };
  const w = holding();
  if (w) { d.g = w.type; d.q = w.rarity; }
  if (season.tier >= 0) d.h = season.tier;
  return d;
}

function sendPose(now) {
  if (!net || now - lastPose < 1000 / POSE_HZ) return;
  lastPose = now;
  const d = poseData();
  const s = JSON.stringify(d);
  if (s === lastSent) return;
  lastSent = s;
  net.pose(d);
}

// Пульс раз в 1.5 с — таймер работает и в фоновой вкладке (кадровый цикл там на паузе).
setInterval(() => { if (net && world) net.pose(poseData()); }, 1500);

// ---------- Клавиши и пауза ----------

addEventListener('keydown', (e) => {
  if (document.activeElement?.tagName === 'INPUT') return;
  keys.add(e.code);
  if (!world || !controls.isLocked) return;
  if (e.code === 'KeyT') { e.preventDefault(); openChat(); }
  if (e.code === 'KeyE') {
    const chest = loot.chestNear(eye(), look());
    if (chest) openChest(chest);
  }
  if (royale.alive) {
    if (e.code === 'KeyZ') enterBuild('w');
    if (e.code === 'KeyX') enterBuild('f');
    if (e.code === 'KeyC') enterBuild('r');
    if (e.code === 'KeyV') {
      buildMat = (buildMat + 1) % MATS.length;
      renderMats();
      showName(MAT_INFO[MATS[buildMat]].name, MAT_INFO[MATS[buildMat]].color);
    }
  }
  if (e.code === 'KeyR') { const en = ENTRIES[slot]; if (en.weapon !== undefined) combat.reload(en.weapon); }
  if (e.code === 'KeyG' && swapCandidate && royale.alive) {
    const en = ENTRIES[slot];
    const into = en.weapon !== undefined ? en.weapon : 0;
    loot.swap(swapCandidate, into, combat);
    pick(into + 1);
  }
  if (e.code === 'KeyQ' && royale.alive) {
    const en = ENTRIES[slot];
    if (en.weapon !== undefined && combat.slots[en.weapon]) {
      const w = combat.take(en.weapon);
      loot.drop(feet.clone(), [{ k: 'weapon', w: w.type, r: w.rarity, a: w.mag }]);
    }
  }
  const n = e.code.match(/^Digit([1-4])$/);
  if (n) pick(+n[1] - 1);
});
addEventListener('keyup', (e) => keys.delete(e.code));

controls.addEventListener('lock', () => { $('pause').hidden = true; $('cross').hidden = false; });
controls.addEventListener('unlock', () => {
  keys.clear(); mouseDown = false; scopeHeld = false;
  if ($('chatbox').hidden) $('pause').hidden = false;
  $('cross').hidden = true;
});
$('resume').addEventListener('click', () => controls.lock());
renderer.domElement.addEventListener('click', () => { if (world && !controls.isLocked) controls.lock(); });

// ---------- Поделиться ----------

const link = () => `${location.origin}${location.pathname}?w=${worldId}`;
$('share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(link()); toast('Link copied'); } catch (e) { /* без буфера — просто откроем X */ }
  const text = `Drop into my ${NAME} match 🔫🌪 — loot chests, build, outrun the storm, last one standing wins. Open and play, no install`;
  open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link())}`, '_blank', 'noopener');
});

// ---------- Старт ----------

function start() {
  nick = ($('nick').value.trim() || nick).slice(0, 16);
  localStorage.setItem('pc:nick', nick);
  if (!worldId) {
    worldId = randId();
    history.replaceState(null, '', `?w=${worldId}`);
  }
  $('status').textContent = 'Generating the island…';
  setTimeout(() => {
    world = new GameMap(worldId);
    terrain = world.mesh();
    scene.add(terrain);
    structures.load(world);
    spawn(false);
    royale.init();              // раунд по часам: сундуки, шторм, жив/наблюдаешь
    pick(0);
    $('wname').textContent = `🌍 ${worldId}`;
    $('intro').hidden = true;
    for (const id of ['top', 'hotbar', 'hint', 'bars', 'ammo', 'storm', 'mats']) $(id).hidden = false;
    renderSeason();
    $('pause').hidden = false;
    document.title = `${worldId} — ${NAME}`;
    startNet();
  }, 20);
}
$('go').addEventListener('click', start);

// Режим съёмки для промо (?shot=x,z,высота,yaw,pitch): старт без экрана входа, без интерфейса и сети,
// камера в заданной точке. Используется для шапки/аватарки в X: headless Chrome делает скриншот.
if (params.has('shot')) {
  const [x = 80, z = 80, up = 20, yaw = -2.3, pitch = -0.3] = params.get('shot').split(',').map(Number);
  document.body.classList.add('shot');
  startNet = () => {};
  $('nick').value = 'Demo';
  start();
  setTimeout(() => {
    for (const id of ['top', 'hotbar', 'hint', 'bars', 'ammo', 'storm', 'banner', 'pause', 'cross', 'mats']) $(id).hidden = true;
    feet.set(x, world.height(x, z) + up, z);
    player.position.set(feet.x, feet.y + EYE, feet.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    gliding = false;
  }, 60);
}
$('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

// ---------- Цикл ----------

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  if (world) {
    if (controls.isLocked) step(dt);
    else player.position.set(feet.x, feet.y + EYE, feet.z);

    // Зажатая ЛКМ: автоматическое оружие стреляет, кирка машет, стройка ставит детали.
    const en = ENTRIES[slot], w = currentWeapon();
    if (mouseDown && controls.isLocked) {
      if (buildType) placePiece(t);
      else if (en.pick) swingPickaxe(t);
      else if (w && WEAPONS[w.type].auto) combat.fire(en.weapon, t);
    }
    combat.update(dt);
    loot.update(dt, now);
    royale.update(dt);
    updateFx(dt);
    updatePlan();
    updatePoi();

    // Подбор лута и подсказки.
    swapCandidate = royale.alive ? loot.pickupNear(feet, combat) : null;
    const chest = controls.isLocked && royale.alive ? loot.chestNear(eye(), look()) : null;
    const prompt = chest ? 'E — open chest' : swapCandidate ? `G — swap for ${itemLabel(swapCandidate)}` : gliding ? 'Gliding — steer with WASD' : '';
    if ($('prompt').textContent !== prompt) { $('prompt').textContent = prompt; $('prompt').hidden = !prompt; }
    const rl = combat.reloading;
    const rtext = rl ? `Reloading… ${Math.max(0, rl.left).toFixed(1)}s` : '';
    if ($('reload').textContent !== rtext) $('reload').textContent = rtext;

    // Прицел снайперки.
    const fov = isScoped() ? SCOPE_FOV : FOV;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
    $('scope').hidden = !isScoped();

    if (shakeAmt > 0.001) {
      player.position.add(new THREE.Vector3((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt));
      shakeAmt *= Math.max(0, 1 - 6 * dt);
    }
    for (const o of others.values()) {
      o.group.position.lerp(new THREE.Vector3(o.target.x, o.target.y, o.target.z), 0.25);
      o.group.rotation.y = o.target.r;
    }
    sendPose(now);
    updateCrosshair(w, en);
  }
  // Солнце с тенью ездит за игроком (тени — только вокруг); небо — за камерой.
  const c = player.position;
  sun.target.position.set(Math.round(c.x), Math.round(c.y), Math.round(c.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 180);
  sky.position.copy(c);
  for (const cl of clouds.children) { cl.position.x += dt * 1.5; if (cl.position.x > MAP / 2 + 420) cl.position.x -= 840; }
  renderer.render(scene, camera);
  if (world && (controls.isLocked || debugView)) {
    const h = holding();
    vm.set(h);
    vm.render(dt, { moving, reloading: !!combat.reloading, scoped: isScoped(), loaded: !!h && h.mag > 0 });
  }
});

let debugView = false;           // для скриншотов в тестах: рисовать оружие в руках без захвата мыши

// Прицел: 4 штриха расходятся по разбросу оружия; у дробовика — кольцо; в оптике скрыт; кирка/стройка — точка.
function updateCrosshair(w, en) {
  const c = $('cross');
  const px = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));     // радианы → пиксели
  const spread = w ? combat.spreadOf(en.weapon) : 0;
  const gap = Math.round(Math.min(90, 5 + spread * px));
  c.style.setProperty('--gap', `${gap}px`);
  c.dataset.mode = !w ? 'dot' : isScoped() ? 'off' : w.type === 'shotgun' ? 'ring' : w.type === 'bazooka' ? 'bazooka' : 'lines';
}

// Для отладки и тестов.
window.__pc = {
  get world() { return world; }, get net() { return net; }, get others() { return others; }, peers,
  combat, loot, pick, royale, season, structures, mats,
  build: (t) => enterBuild(t), place: () => { updatePlan(); nextBuild = 0; placePiece(performance.now() / 1000); }, swing: () => { nextSwing = 0; swingPickaxe(performance.now() / 1000); },
  get plan() { return plan; },
  get feet() { return feet; }, step: (dt) => step(dt), keys, controls,
  set debugView(v) { debugView = v; $('cross').hidden = !v; $('pause').hidden = v; },
  tp(x, z, up = 0, y = 999) { feet.set(x, structures.ground(x, z, y) + 0.01 + up, z); gliding = false; player.position.set(feet.x, feet.y + EYE, feet.z); },
  look(yaw, pitch = 0) { camera.rotation.set(pitch, yaw, 0, 'YXZ'); },
};
