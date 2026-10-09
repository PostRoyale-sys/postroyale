// PostRoyale — королевская битва по ссылке. Создал матч → ссылка ?w=<id> → кинул в X → все, кто открыл, играют вместе.
// Карта (map.js) генерируется из id: гладкий остров, локации с домами, лес, камни, машины — у всех одинаковая.
// Рельеф не ломается; ломаются постройки и объекты (structures.js): киркой добываешь дерево/кирпич/металл
// и строишь стены, полы, рампы. Оружие — из сундуков (loot.js), бой — combat.js, раунды и шторм — royale.js.
// Сеть — P2P (net.js), постройки живут один раунд.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { GameMap, MAP, WATER_Y, rng, seedOf } from './map.js';
import { toonGradient, toon, windUniform, outlineGroup } from './art.js';
import { createStructures, MATS, MAT_INFO, BUILD_COST, MAT_MAX, PICK_DMG } from './structures.js';
import { connect } from './net.js';
import { createCombat, WEAPONS, RARITY, AMMO, MAX_SHIELD, weaponLabel, rayBox } from './combat.js';
import { createLoot, itemLabel } from './loot.js';
import { createViewmodel, weaponModel } from './viewmodel.js';
import { createRoyale, ROUND_MS, DROP_MS } from './royale.js';
import { createSeason, TIERS, TOKEN_MINT, TOKEN_SYMBOL } from './season.js';
import { SKINS, skinById, unlocked, lockLabel, buildCharacter, animateCharacter } from './skins.js';
import { createWater } from './water.js';
import { createBots } from './bots.js';
import { createLobbyScene } from './lobby.js';
import { createAbilities, ABILITIES } from './abilities.js';
import { createLoadout, CHARGE_PRICE, COIN } from './loadout.js';
import { createRanked, SHOP, rankedWorld, isRankedWorld } from './ranked.js';
import { createGrass } from './grass.js';
import { buildHeli, buildParachute, buildCabin, SEAT_EYE } from './heli.js';

const NAME = 'PostRoyale';                     // название — менять здесь (и в <title> index.html)
const EYE = 1.62, HEIGHT = 1.8, HALF = 0.3, CROUCH_H = 1.25, CROUCH_EYE = 1.08;
const GRAVITY = 30, JUMP = 9, WALK = 5.5, RUN = 8, GLIDE = 13;
const PICK_REACH = 3.4, PICK_RATE = 0.42, BUILD_RATE = 0.12;
const POSE_HZ = 10;
let FOV = 80;                                  // меняется в настройках
const SCOPE_FOV = 22;

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


// ---------- Сцена ----------

// Мультяшный стиль: cel-затенение (MeshToonMaterial), мягкие тени от солнца, градиентное небо, облака, бирюзовое море.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;           // карта теней пересчитывается по необходимости (см. цикл)
let shadowDirty = true, shadowT = 0;
const shadowAt = new THREE.Vector3(1e9, 0, 0);
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = 0xbfe9ff, ZENITH = 0x2f8fff;
scene.background = new THREE.Color(HORIZON);
scene.fog = new THREE.Fog(HORIZON, 140, 420);
const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 1000);
const hemi = new THREE.HemisphereLight(0xd8efff, 0x7a6a48, 1.25);
scene.add(hemi);
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

const water = createWater(MAP * 8, MAP / 2);
scene.add(water.mesh);

// Далёкие острова на горизонте: силуэты в дымке (свой туман не нужен — цвет уже «воздушный»).
{
  // пологий купол с неровным краем — силуэт острова
  const geo = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), a = Math.atan2(z, x);
    const k = 1 + Math.sin(a * 3) * 0.12 + Math.sin(a * 7 + 1) * 0.06;
    pos.setX(i, x * k); pos.setZ(i, z * k);
    pos.setY(i, pos.getY(i) * (0.8 + Math.sin(a * 2 + 0.5) * 0.25));
  }
  geo.computeVertexNormals();
  const far = [[-0.3, 640, 140, 38], [0.9, 720, 200, 52], [1.9, 600, 110, 30], [2.7, 780, 240, 64], [3.9, 650, 160, 44], [5.0, 700, 120, 34], [5.7, 760, 180, 48]];
  for (const [ang, d, r, h] of far) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x86b4cf, fog: false }));
    m.scale.set(r, h, r * 0.8);
    m.position.set(MAP / 2 + Math.cos(ang) * d, -2, MAP / 2 + Math.sin(ang) * d);
    m.userData.farIsland = true;
    scene.add(m);
  }
}

const controls = new PointerLockControls(camera, renderer.domElement);
const player = controls.object ?? controls.getObject();
scene.add(player);

// Обработка кадра: рендер в буфер, bloom в половинном разрешении, вывод в sRGB, сглаживание FXAA.
// Замер (1920×953): без эффектов 5.8 мс; MSAA 4× в буфере — +3.6 мс и дорожает bloom, поэтому FXAA (~+0.5 мс).
// Без bloom кадр рисуется напрямую (встроенное сглаживание браузера) — так дешевле.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.45, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Цветокоррекция: чуть больше насыщенности и контраста, мягкая виньетка (в sRGB, после OutputPass).
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.14 }, uCon: { value: 1.06 }, uVig: { value: 0.22 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat); c.rgb = (c.rgb - 0.5) * uCon + 0.5;
      float v = smoothstep(0.85, 0.2, length(vUv - 0.5)); c.rgb *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = c; }`,
});
composer.addPass(grade);
const fxaa = new ShaderPass(FXAAShader);
composer.addPass(fxaa);
const fitFxaa = () => { const pr = renderer.getPixelRatio(); fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr)); };
fitFxaa();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  fitFxaa();
});

// ---------- Карта и постройки ----------

let world = null, terrain = null;
const grass = createGrass(scene);
let playing = false;                       // false — лобби (остров на фоне), true — в матче
const structures = createStructures({ scene });

// ---------- Физика игрока ----------

const vel = new THREE.Vector3();
let onGround = false, moving = false, gliding = false, crouching = false;
let chute = false;                             // gliding && !chute — свободное падение; chute — под куполом
let eyeH = EYE;                                // высота глаз: плавно опускается при приседании
const bodyH = () => (crouching ? CROUCH_H : HEIGHT);   // полёта нет: только ходьба, прыжок и планирование при высадке
const keys = new Set();
const feet = new THREE.Vector3();          // позиция ног; камера — на высоте глаз
const knockVel = new THREE.Vector3();

function moveAxis(axis, d) {
  if (!d) return false;
  const steps = Math.ceil(Math.abs(d) / 0.2);
  const s = d / steps;
  for (let i = 0; i < steps; i++) {
    feet[axis] += s;
    if (structures.blocked(feet.x, feet.y, feet.z, bodyH(), HALF)) { feet[axis] -= s; return true; }
  }
  return false;
}

// Высадка: с высоты над случайной точкой суши внутри зоны шторма, планирование до земли.
function spawn(drop = true) {
  const { x, z } = royale.dropPoint();
  const g = world.height(x, z);
  feet.set(x, drop ? Math.max(g, 30) + 70 : g + 0.05, z);
  vel.set(0, 0, 0);
  gliding = drop;
}

// ---------- Высадка с вертолёта ----------
// Вертолёт пролетает над островом через центр зоны на высоте HELI_Y. У тех, кто начал раунд вместе, маршрут
// одинаковый (от сида мира и номера раунда) — летят вместе; опоздавшему — свой маршрут через текущую зону.
// Space или клик — прыжок; в конце маршрута выбрасывает сам. Камера — вокруг вертолёта, крутится мышью.

const HELI_Y = 85, HELI_SPEED = 15;
const HELI_SCALE = 1.7;                     // крупнее — чтобы в салоне помещались люди в натуральную величину
const heli = outlineGroup(buildHeli(), 0.06);
heli.scale.setScalar(HELI_SCALE);
// Салон для вида от первого лица: пилоты и бойцы — случайные скины.
const CABIN_SKINS = SKINS.map((s) => s.id);
const cabin = buildCabin((i) => buildCharacter(CABIN_SKINS[(i * 5 + 3) % CABIN_SKINS.length], ['#e6463f', '#2f8cff', '#ffc928', '#2fbf71'][i % 4]), animateCharacter, HELI_SCALE);
heli.add(cabin);
heli.visible = false;
scene.add(heli);
let flight = null;            // { a, b, dir, t0, dur } — маршрут вертолёта (виден, пока летит)
let riding = false;           // ты внутри

// Маршрут: заход с моря (APPROACH м, прыгать нельзя) → зона прыжка (отрезок над безопасной частью острова,
// 2·JR м через центр зоны) → на краю зоны всех, кто не прыгнул, выбрасывает → вертолёт улетает дальше.
const APPROACH = 70, AFTER = 60;
// Общий маршрут раунда (у всех одинаковый — от сида мира и номера раунда; на нём летят и боты).
let routeCache = null;
function sharedRoute() {
  if (routeCache?.round === royale.round && routeCache.epoch === royale.epoch) return routeCache;
  const c = royale.center;
  const r = rng(seedOf(worldId) ^ Math.imul(royale.round + 7, 2654435761));
  const ang = r() * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
  const JR = Math.min(150, royale.safeRadius() * 0.9);
  const a = new THREE.Vector3(c.x, HELI_Y, c.z).addScaledVector(dir, -(JR + APPROACH));
  const t0 = royale.roundStart / 1000;
  routeCache = {
    round: royale.round, epoch: royale.epoch, a, dir, t0, w0: APPROACH, w1: APPROACH + 2 * JR, len: APPROACH + 2 * JR + AFTER, speed: HELI_SPEED,
    at: (sec) => a.clone().addScaledVector(dir, Math.min(APPROACH + 2 * JR + AFTER, Math.max(0, (sec - t0) * HELI_SPEED))),
  };
  return routeCache;
}

function startRide(late) {
  if (!late) {
    const r = sharedRoute();
    flight = { a: r.a, dir: r.dir, t0: r.t0, w0: r.w0, w1: r.w1, len: r.len };
  } else {
    // опоздавшему — свой короткий маршрут над безопасной частью зоны, от «сейчас»
    const c = royale.center;
    const ang = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const JR = Math.max(12, Math.min(90, royale.safeRadius() * 0.8));
    const a = new THREE.Vector3(c.x, HELI_Y, c.z).addScaledVector(dir, -(JR + 45));
    flight = { a, dir, t0: Date.now() / 1000, w0: 45, w1: 45 + 2 * JR, len: 45 + 2 * JR + AFTER };
  }
  const dir = flight.dir;
  riding = true;
  gliding = false;
  vel.set(0, 0, 0);
  heli.visible = true;
  camera.rotation.set(-0.35, Math.atan2(-dir.x, -dir.z) - Math.PI / 2, 0, 'YXZ');   // лицом из правой двери, взгляд чуть вниз
}

// Сколько метров пролетел вертолёт от начала маршрута.
const flown = () => Math.min(flight.len, Math.max(0, (Date.now() / 1000 - flight.t0) * HELI_SPEED));
const heliPos = (out) => out.copy(flight.a).addScaledVector(flight.dir, flown());
const inJumpZone = () => flight && flown() >= flight.w0;

function jumpOut(forced = false) {
  if (!riding) return;
  if (!forced && !inJumpZone()) { toast(`Jump zone in ${Math.ceil((flight.w0 - flown()) / HELI_SPEED)}s`); return; }
  riding = false;
  const p = heliPos(new THREE.Vector3());
  feet.set(p.x, p.y - 1.9 * HELI_SCALE, p.z);
  vel.set(0, 0, 0);
  knockVel.copy(flight.dir).multiplyScalar(6);
  gliding = true;
  chute = false;
  combat.sfx('swing');
  if (forced) toast('Auto-dropped at the edge of the jump zone');
}

// Подсказка в вертолёте: до зоны прыжка — сколько ждать; в зоне — сколько до автосброса.
function ridePrompt() {
  const d = flown();
  if (d < flight.w0) return `Jump zone in ${Math.ceil((flight.w0 - d) / HELI_SPEED)}s`;
  return `SPACE — jump out · auto-drop in ${Math.ceil((flight.w1 - d) / HELI_SPEED)}s`;
}

const V_HELI = new THREE.Vector3(), V_LOOK = new THREE.Vector3();
function updateHeli(t) {
  if (!flight) return;
  heliPos(V_HELI);
  heli.position.copy(V_HELI);
  heli.position.y += Math.sin(t * 1.3) * 0.4;
  heli.rotation.set(0.06, Math.atan2(-flight.dir.x, -flight.dir.z), Math.sin(t * 0.9) * 0.04);
  heli.userData.tick(t);
  // салон виден только своему пассажиру; полоса корпуса изнутри мешает обзору — прячем
  cabin.visible = riding;
  for (const m of heli.userData.shell) m.visible = !riding;
  if (riding) cabin.userData.tick(t);
  const d = flown();
  if (riding) {
    if (d >= flight.w1) jumpOut(true);
    else {
      feet.copy(V_HELI);
      // вид от первого лица из салона (как в Call of Duty): сидим на задней лавке, мышью — осмотреться;
      // лёгкая тряска от винта
      heli.updateMatrixWorld(true);
      player.position.copy(heli.localToWorld(SEAT_EYE.clone()));
      player.position.x += Math.sin(t * 31) * 0.012 + Math.sin(t * 7.3) * 0.02;
      player.position.y += Math.sin(t * 27) * 0.015 + Math.sin(t * 3.1) * 0.03;
    }
  }
  if (!riding && d >= flight.len) { flight = null; heli.visible = false; }
}

// Наблюдатель — призрак: летит куда смотрит, сквозь стены и деревья, без гравитации.
// Space — вверх, C — вниз, Shift — быстрее. Не ниже земли и не дальше края карты.
const GHOST = 14;
function ghostStep(dt) {
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
  const move = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
  if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
  if (keys.has('Space')) move.y += 1;
  if (keys.has('KeyC')) move.y -= 1;
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (move.lengthSq()) move.normalize().multiplyScalar(GHOST * (fast ? 2.2 : 1) * dt);
  feet.add(move);
  feet.x = Math.max(-60, Math.min(MAP + 60, feet.x));
  feet.z = Math.max(-60, Math.min(MAP + 60, feet.z));
  feet.y = Math.min(160, Math.max(feet.y, Math.max(world.height(feet.x, feet.z), WATER_Y) + 0.3));
  vel.set(0, 0, 0);
  gliding = false;
  moving = move.lengthSq() > 0;
  player.position.set(feet.x, feet.y + EYE, feet.z);
}

function step(dt) {
  if (!royale.alive) { ghostStep(dt); return; }
  const scoped = isScoped();
  // Присед (Alt, удерживать): ниже, медленнее, точнее. Встать нельзя, если над головой пол/рампа.
  const wantCrouch = (keys.has('AltLeft') || keys.has('AltRight')) && !gliding;
  if (wantCrouch) crouching = true;
  else if (crouching && !structures.blocked(feet.x, feet.y, feet.z, HEIGHT, HALF)) crouching = false;
  eyeH += ((crouching ? CROUCH_EYE : EYE) - eyeH) * Math.min(1, dt * 12);
  const speed = gliding ? (chute ? GLIDE : 11) : crouching ? WALK * 0.45 : (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !scoped ? RUN : scoped ? WALK * 0.5 : WALK;
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
    // свободное падение до −32 м/с; на высоте ~40 м купол раскрывается сам (или раньше — Space)
    if (gliding && !chute && feet.y - world.height(feet.x, feet.z) < 40) openChute();
    vel.y = Math.max(vel.y - GRAVITY * dt, !gliding ? -45 : chute ? -6 : -32);
    if (gliding && chute && vel.y < -6) vel.y += (-6 - vel.y) * Math.min(1, dt * 3);   // купол тормозит рывком, но плавно
    let ny = feet.y + vel.y * dt;
    if (vel.y > 0) {
      const top = structures.ceiling(feet.x, feet.y, ny, feet.z, bodyH(), HALF);
      if (ny > top) { ny = top; vel.y = 0; }
    }
    const g = structures.ground(feet.x, feet.z, Math.max(feet.y, ny), HALF);
    // На земле прилипаем к опоре, если она чуть ниже (спуск по рампе и склону без подпрыгиваний).
    if (ny <= g || (onGround && vel.y <= 0 && feet.y - g < 0.6)) {
      ny = g; vel.y = 0; onGround = true; gliding = false; chute = false;
    }
    else onGround = false;
    feet.y = ny;
    // Вода: плаваем у поверхности.
    if (feet.y < WATER_Y - 1.1) { vel.y = Math.max(vel.y, -2); if (keys.has('Space') || feet.y < WATER_Y - 1.4) vel.y = 3; }
  }
  feet.x = Math.max(-60, Math.min(MAP + 60, feet.x));
  feet.z = Math.max(-60, Math.min(MAP + 60, feet.z));
  player.position.set(feet.x, feet.y + eyeH, feet.z);
}

// ---------- Парашют и вид от третьего лица в полёте ----------

function openChute() {
  if (!gliding || chute) return;
  chute = true;
  combat.sfx('swing');
}

// Своя фигурка (видна только в падении/под куполом — камера в это время сзади-сверху).
let selfFig = null, selfFigKey = '';
const selfChute = buildParachute();
function updateSelfFigure(t) {
  const show = playing && gliding && !riding && royale.alive;
  const key = `${mySkin}|${nick}`;
  if (show && (!selfFig || selfFigKey !== key)) {
    if (selfFig) scene.remove(selfFig);
    selfFig = buildCharacter(mySkin, colorOf(nick));
    selfFig.add(selfChute);
    selfFigKey = key;
    scene.add(selfFig);
  }
  if (!selfFig) return;
  selfFig.visible = show;
  if (!show) return;
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  selfFig.position.copy(feet);
  selfFig.rotation.set(chute ? 0 : -1.1, yaw, 0, 'YXZ');            // в падении — животом вниз
  selfChute.visible = chute;
  animateCharacter(selfFig, t, chute ? 'chute' : 'glide');
  // камера сзади-сверху, крутится мышью
  const look = camera.getWorldDirection(new THREE.Vector3());
  player.position.copy(feet).add(new THREE.Vector3(0, chute ? 3.2 : 1.6, 0)).addScaledVector(look, chute ? -8 : -6);
}

// Направление ввода WASD (для рывка способностью).
function moveDir() {
  const fwd = camera.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x), d = new THREE.Vector3();
  if (keys.has('KeyW')) d.add(fwd); if (keys.has('KeyS')) d.sub(fwd);
  if (keys.has('KeyD')) d.add(right); if (keys.has('KeyA')) d.sub(right);
  return d.lengthSq() ? d.normalize() : d;
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
    if (t < PICK_REACH) { sendHit(peerId, { dmg: 20, by: nick, w: 'pickaxe' }); hitmarker(); combat.sfx('chop'); return; }
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
  if (res.destroyed) shadowDirty = true;
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
  shadowDirty = true;
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

// Наблюдатель ничего не трогает — но пусть видит почему, а не «ничего не работает».
let specToast = 0;
function spectatorNotice() {
  if (royale.alive || performance.now() - specToast < 1500) return;
  specToast = performance.now();
  const left = Math.ceil((ROUND_MS - (Date.now() - royale.roundStart)) / 1000);
  toast(`👁 You're out this round — next drop in ${mmss(left)}`);
}

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!controls.isLocked || !playing) return;
  if (!royale.alive) { spectatorNotice(); return; }
  if (riding) { if (e.button === 0) jumpOut(); return; }
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

// Мультяшный персонаж в выбранном скине (skins.js) + табличка с ником.
function avatar(name, tier = -1, skinId = 'default') {
  const color = colorOf(name);
  const g = buildCharacter(skinId, color);
  const t = TIERS[tier];
  g.add(nameSprite(t ? `★ ${name}` : name, t ? t.color : color));
  return g;
}

function upsertOther(peerId, d) {
  let o = others.get(peerId);
  const tier = d.h ?? -1, skin = d.k || 'default';
  if (!o || o.name !== d.n || o.tier !== tier || o.skin !== skin) {
    if (o) scene.remove(o.group);
    o = { group: avatar(d.n, tier, skin), name: d.n, tier, skin, target: d };
    o.group.rotation.order = 'YXZ';               // наклон в падении — вдоль своего направления
    o.group.position.set(d.x, d.y, d.z);
    scene.add(o.group);
    others.set(peerId, o);
  }
  o.target = d;
  o.group.visible = d.a !== false && !d.rd;     // наблюдателей и сидящих в вертолёте не видно
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
  canPlay: () => royale.alive && !royale.ended,
  inMatch: () => playing,
  sendHit: (id, d) => sendHit(id, d),
  // боты (bots.js)
  royale: () => royale, combat: () => combat, loot: () => loot,
  me: () => ({ alive: royale.alive, riding, nick, feet }),
  upsert: (k, d) => upsertOther(k, d),
  removeBots, isHost, hostId,
  onBotKilled: (by) => { if (by === nick && royale.alive) { season.add('kill'); abilities.earn('botkill'); loadout.earn('botkill'); if (rankedMatch) ranked.add('botkill'); } },
  blocksSight: (a, b) => abilities.blocksSight(a, b),
  route: () => sharedRoute(),
  isRanked: () => isRankedWorld(worldId),
  crouched: () => crouching,
  riding: () => riding,
  onRoundEnd,
  died: (by) => royale.eliminate(by),
  damageStructure,
  // Раунд (royale.js)
  onRoundStart, onEliminated, onWinner,
  stormHud,
  stormDamage: (d) => combat.takeDamage(d, 'Storm', 'storm'),
  points: (k) => award(k),
  // Сезон (season.js)
  pointsToast, onSeason: renderSeason,
  volume: () => settings.vol,
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
const ranked = createRanked({ toast: (t) => pointsToast(t), onChange: () => renderRanked() });
let rankedMatch = false;           // этот матч — рейтинговый (остров дня и есть допуск): начисляем RP

// Очки за событие: сезонные — всегда, RP — только в рейтинговом матче.
function award(kind) {
  season.add(kind);
  abilities.earn(kind);
  loadout.earn(kind);
  if (rankedMatch) ranked.add(kind);
}
const vm = createViewmodel(renderer, camera);
const bots = createBots(ctx);
const loadout = createLoadout({ onChange: () => renderLoadout() });
const abilities = createAbilities({
  scene, camera, others,
  world: () => world, structures: () => structures, combat: () => combat, net: () => net, feet: () => feet,
  toast: (t) => pointsToast(t), onChange: () => renderAbilities(),
  canUse: () => playing && royale.alive && !riding,
  moveDir,
  dash: (d) => { knockVel.copy(d).multiplyScalar(36); vel.y = Math.max(vel.y, 3); onGround = false; combat.sfx('swing'); },
  launch: (vy) => { vel.y = vy; onGround = false; combat.sfx('bazooka'); },
});

// HUD способностей: два слота (F, Q) и кредиты.
function renderAbilities() {
  $('credits').textContent = `💰 ${abilities.credits}`;
  $('abil').innerHTML = ['F', 'Q'].map((key, i) => {
    const s = abilities.slots[i], a = s && ABILITIES[s.id];
    return `<div class="${a ? '' : 'empty'}" title="${a ? `${a.name} — ${a.desc}` : 'Empty — buy abilities with B'}"><span>${key}</span>${a ? `<i>${a.icon}</i><b>×${s.n}</b>` : '<i>＋</i>'}</div>`;
  }).join('');
  if (buyOpen) renderBuy();
}

// Меню покупки (B): карточки способностей, цена, заряды.
let buyOpen = false;
function renderBuy() {
  $('buygrid').innerHTML = '';
  for (const [id, a] of Object.entries(ABILITIES)) {
    const have = abilities.slots.find((x) => x && x.id === id)?.n || 0;
    const c = document.createElement('button');
    c.className = `acard${abilities.credits < a.price ? ' cant' : ''}`;
    c.innerHTML = `<i>${a.icon}</i><b>${a.name}</b><small>${a.desc}</small><span>💰 ${a.price}</span><em>${have}/${a.max}</em>`;
    c.addEventListener('click', () => {
      const err = abilities.buy(id);
      $('buymsg').textContent = err || `✓ ${a.name} → slot ${abilities.slots.findIndex((x) => x && x.id === id) === 0 ? 'F' : 'Q'}`;
    });
    $('buygrid').appendChild(c);
  }
  $('buycred').textContent = abilities.credits;
}
function openBuy() {
  if (!playing || !royale.alive) return;
  buyOpen = true;
  $('buymsg').textContent = '';
  renderBuy();
  $('buy').hidden = false;
  controls.unlock();
}
function closeBuy() {
  buyOpen = false;
  $('buy').hidden = true;
  controls.lock();                     // клик/клавиша — жест пользователя, захват мыши вернётся
}
$('buyclose').addEventListener('click', closeBuy);

// Попадание: по боту — хосту ботов (или себе, если хост ты), по игроку — ему по сети.
function sendHit(id, d) {
  if (id.startsWith('bot:')) bots.hit(id, d);
  else net?.hit(d, id);
}
// Хост ботов — игрок с наименьшим сетевым id (оффлайн — ты).
function hostId() { return net ? [net.selfId, ...peers].sort()[0] : 'me'; }
function isHost() { return !net || hostId() === net.selfId; }
function removeBots() {
  for (const [k, o] of [...others]) if (k.startsWith('bot:')) { scene.remove(o.group); others.delete(k); }
}

// ---------- Раунд и сезон ----------

let goldenKeyRound = -1;         // золотой ключ держателя: +1 к редкости одного сундука за раунд
function openChest(chest) {
  if (!royale.alive) return;
  const key = season.tier >= 0 && goldenKeyRound !== royale.round;
  if (!loot.open(chest, key ? 1 : 0)) return;
  if (key) { goldenKeyRound = royale.round; toast('🔑 Golden key: +1 rarity'); }
  award('chest');
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
  shadowDirty = true;
  bots.roundStart(r);
  abilities.reset();
  if (alive) { loadout.equip(abilities.slots); renderAbilities(); }
  loot.resetRound(r, royale.roundStart);
  combat.resetAll();
  for (const m of MATS) mats[m] = 0;
  buildType = null;
  goldenKeyRound = -1;
  renderHotbar();
  if (alive) {
    startRide(Date.now() - royale.roundStart > 20e3);
    season.roundStarted();
    const late = Date.now() - royale.roundStart > 20e3;
    banner('DROP!', late ? 'Match in progress — press SPACE to jump out, loot fast, watch the storm' : 'Press SPACE to jump out of the chopper — the storm starts closing in 90s');
  } else {
    gliding = false;
    const left = Math.ceil((ROUND_MS - (Date.now() - royale.roundStart)) / 1000);
    banner('Match in progress', `You're spectating — next drop in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · fly around as a ghost (Space up, C down)`, 5000);
  }
}

function onEliminated(place, by) {
  gliding = false;
  buildType = null;
  structures.ghost(null);
  vel.set(0, 0, 0);
  feet.y += 3;                                    // призрак поднимается над местом гибели
  season.placed(place);
  if (place === 2 || place === 3) loadout.earn(place === 2 ? 'top2' : 'top3');
  if (rankedMatch && (place === 2 || place === 3)) ranked.add(place === 2 ? 'top2' : 'top3');
  banner(place > 1 ? `#${place}` : 'Eliminated', by === 'Storm' ? 'Caught in the storm · spectating until next drop' : by === nick ? 'You blew yourself up' : `Eliminated by ${by} · spectating until next drop`, 5000);
}

function onWinner(name, me) {
  if (me) award('win');
  banner(me ? '🏆 VICTORY ROYALE' : `🏆 ${name} wins`, me ? 'Last one standing!' : 'Last one standing', 6000);
  say('🏆', ` ${name} won the round`);
}

// Конец раунда (досрочно — последний живой, или по таймеру — все, кто дожил): итоги и возврат в лобби.
const LOBBY_DELAY = 7;
function onRoundEnd({ me, winners, early }) {
  loadout.giveBack(abilities.slots);
  if (!early) {
    const others = winners.filter((n) => n !== nick);
    if (me) banner('🏆 VICTORY ROYALE', others.length ? `You survived the storm — winners: ${winners.join(', ')}` : 'You survived the storm!', LOBBY_DELAY * 1000);
    else if (winners.length) banner(`🏆 ${winners.join(', ')}`, `${winners.length > 1 ? 'survived the storm and win' : 'survived the storm and wins'}`, LOBBY_DELAY * 1000);
    else banner('Round over', 'No survivors — the storm took everyone', LOBBY_DELAY * 1000);
    if (winners.length) say('🏆', ` ${winners.join(', ')} won the round`);
  }
  buildType = null;
  structures.ghost(null);
  let left = LOBBY_DELAY;
  const tick = () => {
    $('prompt').hidden = false;
    $('prompt').textContent = `Back to the lobby in ${left}…`;
    if (left-- <= 0) {
      const q = new URLSearchParams({ w: worldId, r: me ? 'win' : 'end', ws: winners.slice(0, 4).join(',') });
      location.href = `${location.pathname}?${q}`;
      return;
    }
    setTimeout(tick, 1000);
  };
  tick();
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
let lastStorm = '';
function stormHud({ t, storm, alive, outside, spectating, drop }) {
  const left = storm.left;
  const what = storm.idx === 0 ? 'Storm in' : storm.final ? 'Final circle · round ends in' : storm.shrinking ? 'Storm closing' : 'Storm shrinks in';
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

// Кошелёк в верхней панели лобби: подключить (Phantom, подпись без транзакций) / адрес и статус держателя.
function renderWallet() {
  const w = season.wallet, t = season.tierInfo(season.tier);
  const b = $('walbtn');
  b.classList.toggle('on', !!w);
  b.innerHTML = w ? `◎ ${w.pubkey.slice(0, 4)}…${w.pubkey.slice(-4)}${t ? ` · <em>★ ${t.name}</em>` : ''}` : '🔗 Connect wallet';
  if (!w) $('walmenu').hidden = true;
}
$('walbtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (season.wallet) $('walmenu').hidden = !$('walmenu').hidden;
  else season.connect(($('nick').value.trim() || nick).slice(0, 16));
});
$('walref').addEventListener('click', () => { $('walmenu').hidden = true; season.refresh(); toast('Checking holder balance…'); });
$('waloff').addEventListener('click', () => { $('walmenu').hidden = true; season.disconnect(); });
addEventListener('click', () => { $('walmenu').hidden = true; });

function renderSeason() {
  renderWallet();
  const s = season.stats, w = season.wallet, t = season.tierInfo(season.tier);
  $('lbpts').textContent = s.points.toLocaleString('en');
  try { renderEarn(); } catch (e) { /* лобби ещё не готово */ }
  if (!playing) renderPlayerCard();
  $('season').innerHTML = `<div class="sh"><b>Level ${Math.floor(s.points / 500) + 1}</b><span>${s.points.toLocaleString('en')} pts</span></div>
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
  shadowDirty = true;
  if (d.a) structures.add({ k: d.k, t: d.t, ix: d.ix, iy: d.iy, iz: d.iz, o: d.o, m: d.m });
  else if (d.x) structures.damage(d.k, d.x);
}

let startNet = function () {
  try {
    net = connect(worldId, {
      join(peerId) {
        peers.add(peerId);
        if (!isRankedWorld(worldId)) net.match({ e: royale.epoch }, peerId);
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
        if (d.by === nick && d.n !== nick && royale.alive) award('kill');
      },
      win(peerId, d) { royale.onWin(peerId, d); },
      bots(peerId, d) { bots.onBots(peerId, d); },
      bothit(peerId, d) { bots.onBotHit(peerId, d); },
      abil(peerId, d) { abilities.onNet(peerId, d); },
      // друг начал этот матч раньше — переходим на его отсчёт (раунд заново)
      match(peerId, d) { if (!isRankedWorld(worldId) && royale.adoptEpoch(d.e)) toast('Synced with the match in progress'); },
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
  if (mySkin !== 'default') d.k = mySkin;
  if (riding) d.rd = 1;
  if (crouching) d.cr = 1;
  if (gliding) { d.st = chute ? 'g' : 'f'; if (chute) d.pc = 1; } else if (!onGround) d.st = 'a';
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
  if (buyOpen && (e.code === 'KeyB' || e.code === 'Escape')) { e.preventDefault(); closeBuy(); return; }
  if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();     // не уводить фокус в меню браузера
  keys.add(e.code);
  if (!playing || !controls.isLocked) return;
  if (e.code === 'KeyT') { e.preventDefault(); openChat(); }
  if (riding) { if (e.code === 'Space') jumpOut(); return; }
  if (gliding && !chute && e.code === 'Space') openChute();
  if (e.code === 'KeyB') { openBuy(); return; }
  if (!royale.alive && ['KeyE', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyQ', 'KeyG'].includes(e.code)) spectatorNotice();
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
  if (e.code === 'KeyB') openBuy();
  if (e.code === 'KeyF' && royale.alive) abilities.use(0);
  if (e.code === 'KeyQ' && royale.alive) abilities.use(1);
  if (e.code === 'KeyH' && royale.alive) {
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

controls.addEventListener('lock', () => { $('pause').hidden = true; $('cross').hidden = !playing; });
controls.addEventListener('unlock', () => {
  keys.clear(); mouseDown = false; scopeHeld = false;
  if ($('chatbox').hidden && !buyOpen) $('pause').hidden = false;
  $('cross').hidden = true;
});
$('resume').addEventListener('click', () => controls.lock());
renderer.domElement.addEventListener('click', () => { if (playing && !controls.isLocked) controls.lock(); });

// ---------- Поделиться ----------

const link = () => `${location.origin}${location.pathname}?w=${worldId}`;
$('share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(link()); toast('Link copied'); } catch (e) { /* без буфера — просто откроем X */ }
  const text = `Drop into my ${NAME} match 🔫🌪 — loot chests, build, outrun the storm, last one standing wins. Open and play, no install`;
  open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link())}`, '_blank', 'noopener');
});

// ---------- Старт ----------

// Остров для id: генерируем, только если он ещё не тот же (лобби уже мог его построить).
function loadWorld(id) {
  if (world?.id === id) return;
  if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); }
  world = new GameMap(id);
  terrain = world.mesh();
  scene.add(terrain);
  structures.load(world);
  grass.setMap(world);
  water.setHeights(world.heightTexture(), MAP);
  shadowDirty = true;
}

function start() {
  if (playing) return;
  nick = ($('nick').value.trim() || nick).slice(0, 16);
  localStorage.setItem('pc:nick', nick);
  worldId = lobbyId();
  rankedMatch = isRankedWorld(worldId) && ranked.hasAccess();
  history.replaceState(null, '', `?w=${worldId}`);
  $('status').textContent = 'Generating the island…';
  $('go').disabled = true;
  setTimeout(() => {
    loadWorld(worldId);
    if (hero) { scene.remove(hero); hero = null; }
    lobbyScene.visible = false;
    setMood('game');
    playing = true;
    camera.rotation.set(0, 0, 0, 'YXZ');
    spawn(false);
    // Casual — матч с нуля: раунд начинается сейчас (друзья по ссылке подстроятся под самый ранний старт);
    // Ranked — общие часы (у всех рейтинговых игроков один раунд на острове дня).
    royale.init(Date.now(), rankedMatch || isRankedWorld(worldId) ? 0 : Date.now() - 500);
    pick(0);
    $('wname').textContent = rankedMatch ? `🏆 Ranked · ${worldId.slice(7)}` : `🌍 ${worldId}`;
    $('lobby').hidden = true;
    for (const id of ['top', 'hotbar', 'hint', 'bars', 'ammo', 'storm', 'mats', 'abil', 'credits']) $(id).hidden = false;
    renderAbilities();
    renderSeason();
    $('pause').hidden = controls.isLocked;          // мышь захвачена кликом по PLAY — сразу в игру, без паузы
    $('cross').hidden = !controls.isLocked;
    document.title = `${worldId} — ${NAME}`;
    startNet();
  }, 20);
}
// PLAY: вспышка и «вылет» из лобби, затем матч.
$('go').addEventListener('click', () => {
  if (playing || $('go').disabled) return;
  if (gameMode === 'ranked' && !ranked.hasAccess()) {
    $('rk-msg').className = 'sub err';
    $('rk-msg').textContent = 'Unlock Ranked first: post on X and paste the link';
    $('rk-url').focus();
    return;
  }
  $('go').disabled = true;
  // захват мыши — прямо в обработчике клика (нужен жест пользователя); не дали — после старта откроется пауза
  try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch (e) { /* без захвата */ }
  $('flashout').classList.add('on');
  $('lobby').classList.add('leaving');
  setTimeout(start, 480);
});

$('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

// ---------- Лобби ----------
// Фон — живой остров матча (камера облетает), по центру — твой персонаж с киркой. Вкладки: игра, сезон, правила, настройки.

const lobbyNewId = randId();
let mode = worldId ? 'join' : 'new';
const cleanCode = (v) => v.trim().toLowerCase().replace(/^.*[?&]w=/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 24);
let gameMode = isRankedWorld(worldId) ? 'ranked' : 'casual';
const lobbyId = () => (gameMode === 'ranked' ? rankedWorld() : mode === 'join' ? cleanCode($('code').value) || lobbyNewId : lobbyNewId);
// Итог прошлого раунда (возврат из матча): ?r=win|end&ws=имена.
if (params.get('r')) {
  const ws = (params.get('ws') || '').split(',').filter(Boolean);
  $('status').textContent = params.get('r') === 'win' ? '🏆 Victory Royale — you won the last round!' : ws.length ? `Last round: 🏆 ${ws.join(', ')}` : 'Last round: no survivors';
  $('status').classList.add('result');
  history.replaceState(null, '', `?w=${params.get('w')}`);
}
if (worldId && !isRankedWorld(worldId)) {
  $('code').value = worldId;
  $('status').textContent = `Invited to match “${worldId}” — hit Play to drop in with everyone on the link`;
}

function setMode(m) {
  mode = m;
  $('m-new').classList.toggle('on', m === 'new');
  $('m-join').classList.toggle('on', m === 'join');
  $('seg').classList.toggle('join', m === 'join');
  $('code').hidden = m !== 'join';
  if (m === 'join') $('code').focus();
  previewSoon();
  updateRoundInfo();
}
$('m-new').addEventListener('click', () => setMode('new'));
$('m-join').addEventListener('click', () => setMode('join'));

let previewTimer = 0;
function previewSoon() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { if (!playing) { loadWorld(lobbyId()); renderPois(); } }, 500);
}
$('code').addEventListener('input', previewSoon);
setMode(mode);

// Вкладки: белый «ползунок» переезжает под выбранную.
function moveTabInd() {
  const b = document.querySelector('#tabs button.on'), ind = document.querySelector('#tabs .ind');
  if (!b || !ind) return;
  ind.style.width = `${b.offsetWidth}px`;
  ind.style.transform = `translateX(${b.offsetLeft}px)`;
}
for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('on', x === b);
    for (const sec of document.querySelectorAll('#lobby .tab')) sec.classList.toggle('on', sec.id === `tab-${b.dataset.tab}`);
    $('lobby').classList.toggle('paneled', !['play', 'locker', 'shop', 'abilities'].includes(b.dataset.tab));
    $('lobby').classList.toggle('lockered', ['locker', 'shop', 'abilities'].includes(b.dataset.tab));
    if (b.dataset.tab === 'locker') renderLocker();
    if (b.dataset.tab === 'shop') renderShop();
    if (b.dataset.tab === 'abilities') renderLoadout();
    moveTabInd();
  });
}
document.fonts?.ready.then(moveTabInd);
addEventListener('resize', moveTabInd);

// Персонаж в лобби: тот же мультяшный аватар с киркой, имя — над головой.
let hero = null, heroTimer = 0;
function makeHero() {
  if (playing) return;
  if (hero) scene.remove(hero);
  hero = avatar(($('nick').value.trim() || nick).slice(0, 16), -1, mySkin);
  hero.remove(hero.children.find((c) => c.isSprite));        // ник — в карточке игрока, над головой не нужен
  const pk = weaponModel('pickaxe');
  pk.rotation.x = 1.15;                                  // кирка в правой руке, навершие вверх-вперёд
  pk.position.set(0, -0.5, 0);
  hero.userData.rig.a2.add(pk);
  // круглая платформа под ногами, как в лобби
  const ps = SHOP.find((x) => x.id === ranked.pad);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.06, 32), toon(ps ? ps.color : 0x4fb4ff, { emissive: ps ? new THREE.Color(ps.color).multiplyScalar(0.25) : 0x0b3a7a }));
  pad.position.y = 0.03;                                 // лежит на земле
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: ps ? ps.rim : 0xffd81a }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.065;
  hero.add(pad, rim);
  scene.add(hero);
}
$('nick').addEventListener('input', () => { renderPlayerCard(); clearTimeout(heroTimer); heroTimer = setTimeout(makeHero, 300); });

// ---------- Атмосфера лобби: «золотой час», контровой свет, параллакс ----------

const MOODS = {
  game: { top: 0x2f8fff, bottom: 0xbfe9ff, sun: 0xfff0d8, sunI: 1.9, sky: 0xd8efff, ground: 0x7a6a48, hemiI: 1.25, dir: [-0.45, 1, 0.35], near: 140, far: 420 },
  lobby: { top: 0x3b2a9e, bottom: 0xffb08a, sun: 0xffc08a, sunI: 2.2, sky: 0xcdbbff, ground: 0x8a5a48, hemiI: 1.15, dir: [0.55, 0.42, -0.72], near: 180, far: 950 },
};
const rimLight = new THREE.PointLight(0xff9a5a, 40, 14, 1.6);      // тёплый контур сзади
const fillLight = new THREE.PointLight(0x8b6bff, 18, 12, 1.6);     // фиолетовая подсветка спереди-слева
scene.add(rimLight, fillLight);
function setMood(name) {
  const m = MOODS[name];
  sky.material.uniforms.top.value.set(m.top);
  sky.material.uniforms.bottom.value.set(m.bottom);
  scene.fog.color.set(m.bottom);
  scene.fog.near = m.near; scene.fog.far = m.far;
  scene.background.set(m.bottom);
  sun.color.set(m.sun); sun.intensity = m.sunI;
  hemi.color.set(m.sky); hemi.groundColor.set(m.ground); hemi.intensity = m.hemiI;
  SUN_DIR.set(...m.dir).normalize();
  rimLight.visible = fillLight.visible = name === 'lobby';
}

const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('mousemove', (e) => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; });

const V_HERO = new THREE.Vector3(), V_TMP = new THREE.Vector3();
let heroShift = 0;                   // во вкладках Locker/Shop камера отъезжает, персонаж — правее сетки
// Лобби: островок-сцена (lobby.js) — герой стоит на земле, камера перед ним, за спиной остров матча.
const lobbyScene = createLobbyScene(scene, MAP / 2);
function lobbyFrame(dt, t) {
  // мягко догоняем мышь — камера чуть смещается (параллакс)
  mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 3);
  mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 3);
  heroShift += ((document.getElementById('lobby').classList.contains('lockered') ? 1.8 : 0) - heroShift) * Math.min(1, dt * 4);
  lobbyScene.cameraPose(camera, t, heroShift, mouse.sx, mouse.sy);
  camera.updateMatrixWorld();
  lobbyScene.tick(t);
  if (hero) {
    lobbyScene.heroPos(hero.position);
    const v = camera.position.clone().sub(hero.position);
    hero.rotation.y = Math.atan2(-v.x, -v.z) + Math.sin(t * 0.7) * 0.12 + mouse.sx * 0.3;
    animateCharacter(hero, t, 'idle');
    rimLight.position.copy(camera.localToWorld(V_TMP.set(1.6, 0.6, -9.5)));
    fillLight.position.copy(camera.localToWorld(V_TMP.set(-1.8, -0.2, -4.6)));
  }
  drawMotes(dt);
}

// Светящиеся пылинки поверх сцены (2D-холст, дёшево).
const motesCv = $('motes'), motesCx = motesCv.getContext('2d');
const motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2.2, v: 0.008 + Math.random() * 0.025, ph: Math.random() * 6.28, w: (Math.random() - 0.5) * 0.01 }));
function drawMotes(dt) {
  const w = motesCv.clientWidth, h = motesCv.clientHeight;
  if (motesCv.width !== w || motesCv.height !== h) { motesCv.width = w; motesCv.height = h; }
  motesCx.clearRect(0, 0, w, h);
  for (const m of motes) {
    m.y -= m.v * dt; m.x += m.w * dt; m.ph += dt * 1.5;
    if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
    const px = m.x * w + mouse.sx * 12 * m.r, py = m.y * h + mouse.sy * 8 * m.r;
    const al = 0.35 + 0.35 * Math.sin(m.ph);
    const g = motesCx.createRadialGradient(px, py, 0, px, py, m.r * 4);
    g.addColorStop(0, `rgba(255,226,170,${al})`); g.addColorStop(1, 'rgba(255,180,120,0)');
    motesCx.fillStyle = g;
    motesCx.beginPath(); motesCx.arc(px, py, m.r * 4, 0, 6.283); motesCx.fill();
  }
}

// Карточка игрока: инициал на градиенте цвета ника, уровень сезона (500 очков на уровень).
function renderPlayerCard() {
  const n = ($('nick').value.trim() || nick || '?');
  $('ava').textContent = n[0].toUpperCase();
  $('ava').style.setProperty('--c1', colorOf(n));
  const pts = season.stats.points, lvl = Math.floor(pts / 500) + 1, cur = pts % 500;
  $('lvl').textContent = lvl;
  $('lvlring').style.setProperty('--p', (cur / 5).toFixed(1));
  $('xplbl').textContent = `LV ${lvl}`;
  $('xpnum').textContent = `${cur} / 500`;
  requestAnimationFrame(() => { $('xpbar').style.width = `${cur / 5}%`; });
}

// Локации острова и «горячая точка» — меняется каждые несколько секунд.
let hotIdx = 0;
function renderPois() {
  if (!world) return;
  $('pois').innerHTML = world.pois.slice(0, 3).map((p) => `<span>📍 ${p.name}</span>`).join('') + (world.pois.length > 3 ? `<span>+${world.pois.length - 3} more</span>` : '');
  $('hotdrop').textContent = world.pois[hotIdx % world.pois.length]?.name || '—';
}
setInterval(() => {
  if (playing || !world) return;
  hotIdx++;
  $('hotdrop').style.opacity = 0;
  setTimeout(() => { $('hotdrop').textContent = world.pois[hotIdx % world.pois.length].name; $('hotdrop').style.opacity = 1; }, 300);
}, 3500);

// ---------- Шкафчик (Locker): выбор скина ----------
// Выбранный скин — на персонаже в лобби сразу; закрытые — по уровню сезона или для держателей токена.

let mySkin = 'default';
try { mySkin = localStorage.getItem('pr:skin') || 'default'; } catch (e) { /* по умолчанию */ }
const levelNow = () => Math.floor(season.stats.points / 500) + 1;
if (!unlocked(skinById(mySkin), levelNow(), season.tier, ranked.owns)) mySkin = 'default';

function renderLocker() {
  const lvl = levelNow();
  $('locker').innerHTML = '';
  for (const s of SKINS) {
    const open = unlocked(s, lvl, season.tier, ranked.owns);
    const c = document.createElement('button');
    c.className = `skin r${s.rarity}${s.id === mySkin ? ' on' : ''}${open ? '' : ' locked'}`;
    const col = `#${(s.body ?? 0x8b5cff).toString(16).padStart(6, '0')}`;
    c.style.setProperty('--sc', col);
    c.innerHTML = `<i>${s.icon}</i><b>${s.name}</b><small>${open ? RARITY[s.rarity].name : lockLabel(s)}</small>`;
    c.addEventListener('click', () => {
      if (!open) { $('lockerhint').textContent = s.shop ? 'Buy it in the Shop with RP from Ranked matches' : s.holder ? 'Hold the token and link your wallet (Season tab) to unlock' : `Reach level ${s.level} — earn points by playing`; return; }
      mySkin = s.id;
      try { localStorage.setItem('pr:skin', mySkin); } catch (e) { /* без сохранения */ }
      $('lockerhint').textContent = `Equipped: ${s.name}`;
      renderLocker();
      makeHero();
    });
    $('locker').appendChild(c);
  }
}

// ---------- Левый блок лобби: заработок и токен ----------
for (const el of document.querySelectorAll('.tk')) el.textContent = TOKEN_SYMBOL;
function renderEarn() {
  $('ecoins').textContent = loadout.coins.toLocaleString('en');
  $('erp').textContent = ranked.rp.toLocaleString('en');
  const t = season.tierInfo(season.tier), w = season.wallet;
  $('ehold').textContent = t ? `★ ${t.name}` : w ? 'Wallet linked' : 'Link wallet';
  $('eholdb').classList.toggle('on', !!t);
}
for (const b of document.querySelectorAll('.earn button')) {
  b.addEventListener('click', () => document.querySelector(`#tabs button[data-tab="${b.dataset.go}"]`)?.click());
}

// ---------- Вкладка Abilities: склад зарядов за монеты и набор на F/Q ----------

function renderLoadout() {
  $('lbcoins').textContent = loadout.coins.toLocaleString('en');
  renderEarn();
  if (!$('ablist')) return;
  $('abcoins').textContent = loadout.coins.toLocaleString('en');
  $('abslots').innerHTML = ['F', 'Q'].map((k, i) => {
    const id = loadout.picks[i], a = id && ABILITIES[id];
    return `<div class="${a ? '' : 'empty'}"><span>${k}</span>${a ? `<i>${a.icon}</i><b>${a.name}</b><small>${Math.min(loadout.stock(id), a.max)} charge${Math.min(loadout.stock(id), a.max) === 1 ? '' : 's'} ready</small>` : '<i>＋</i><b>Empty</b><small>pick below</small>'}</div>`;
  }).join('');
  $('ablist').innerHTML = '';
  for (const [id, a] of Object.entries(ABILITIES)) {
    const c = document.createElement('div');
    c.className = 'abcard';
    const p = CHARGE_PRICE[id];
    c.innerHTML = `<i>${a.icon}</i><b>${a.name}</b><small>${a.desc}</small><div class="abst">In stock: <em>${loadout.stock(id)}</em> · max ${a.max}/match</div>
      <div class="abbtn"><button class="buyb${loadout.coins < p ? ' cant' : ''}">Buy 🪙${p}</button><button class="sb${loadout.picks[0] === id ? ' on' : ''}">F</button><button class="sb${loadout.picks[1] === id ? ' on' : ''}">Q</button></div>`;
    const [bb, f, q] = c.querySelectorAll('button');
    bb.addEventListener('click', () => { $('abhint').textContent = loadout.buy(id) ? `✓ +1 ${a.name} charge` : `Need ${p - loadout.coins} more 🪙 — earn coins in any match`; });
    f.addEventListener('click', () => loadout.pick(0, id));
    q.addEventListener('click', () => loadout.pick(1, id));
    $('ablist').appendChild(c);
  }
}

// ---------- Режимы: Casual / Ranked, допуск через пост в X, магазин за RP ----------

function setGameMode(m) {
  gameMode = m;
  setTimeout(updateRoundInfo, 0);
  $('modeseg').classList.toggle('ranked', m === 'ranked');
  $('md-casual').classList.toggle('on', m === 'casual');
  $('md-ranked').classList.toggle('on', m === 'ranked');
  renderRanked();
  previewSoon();
}
$('md-casual').addEventListener('click', () => setGameMode('casual'));
$('md-ranked').addEventListener('click', () => setGameMode('ranked'));

function renderRanked() {
  const rk = gameMode === 'ranked';
  $('rankbox').hidden = !rk;
  $('seg').hidden = rk;
  $('code').hidden = rk || mode !== 'join';
  $('copyinv').parentElement.hidden = rk;
  const a = ranked.access;
  $('rk-locked').hidden = !!a;
  $('rk-ok').hidden = !a;
  if (a) {
    $('rk-handle').textContent = `@${a.handle}`;
    $('rk-left').textContent = `${Math.max(1, Math.ceil((a.until - Date.now()) / 864e5))} days left`;
    $('rk-world').textContent = rankedWorld().slice(7);
  }
  $('lbrp').textContent = ranked.rp.toLocaleString('en');
  renderEarn();
  if ($('shoprp')) $('shoprp').textContent = ranked.rp.toLocaleString('en');
}

$('rk-post').addEventListener('click', () => {
  const link = `${location.origin}${location.pathname}`;
  open(`https://x.com/intent/post?text=${encodeURIComponent(ranked.postText(link))}`, '_blank', 'noopener');
  $('rk-msg').className = 'sub';
  $('rk-msg').textContent = 'Posted? Copy the link to your post and paste it above.';
});
$('rk-verify').addEventListener('click', async () => {
  $('rk-msg').className = 'sub';
  $('rk-msg').textContent = 'Checking your post…';
  try {
    const a = await ranked.verify($('rk-url').value);
    $('rk-msg').className = 'sub ok';
    $('rk-msg').textContent = `✓ Verified @${a.handle} — Ranked unlocked`;
    renderRanked();
  } catch (e) {
    $('rk-msg').className = 'sub err';
    $('rk-msg').textContent = e.message || 'Could not check the post';
  }
});
$('rk-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('rk-verify').click(); });

function renderShop() {
  $('shop').innerHTML = '';
  for (const it of SHOP) {
    const own = ranked.owns(it.id), equipped = it.kind === 'pad' && ranked.pad === it.id;
    const c = document.createElement('button');
    c.className = `skin r${it.rarity}${equipped ? ' on' : ''}${!own && ranked.rp < it.price ? ' cant' : ''}`;
    c.style.setProperty('--sc', `#${(it.color ?? 0x8b5cff).toString(16).padStart(6, '0')}`);
    const price = own ? (it.kind === 'skin' ? 'In Locker' : equipped ? 'Equipped' : 'Equip') : `${it.price} RP`;
    c.innerHTML = `<i>${it.icon}</i><b>${it.name}</b><small>${it.kind === 'skin' ? 'Skin' : 'Lobby pad'}</small><span class="price${own ? ' own' : ''}">${price}</span>`;
    c.addEventListener('click', () => {
      if (own) {
        if (it.kind === 'pad') { ranked.setPad(equipped ? null : it.id); makeHero(); }
        $('shophint').textContent = it.kind === 'skin' ? 'Equip it in the Locker' : equipped ? 'Pad removed' : `${it.name} equipped`;
      } else if (ranked.buy(it.id)) {
        $('shophint').textContent = `✓ Bought ${it.name}${it.kind === 'skin' ? ' — equip it in the Locker' : ''}`;
        if (it.kind === 'pad') makeHero();
      } else $('shophint').textContent = `Need ${it.price - ranked.rp} more RP — play Ranked`;
      renderShop();
    });
    $('shop').appendChild(c);
  }
  renderRanked();
}

// Приглашения: ссылка на матч, который сейчас выбран в лобби.
const inviteLink = () => `${location.origin}${location.pathname}?w=${lobbyId()}`;
$('copyinv').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(inviteLink()); $('status').textContent = '✓ Invite link copied — send it to friends'; } catch (e) { $('status').textContent = inviteLink(); }
});
$('shareinv').addEventListener('click', () => {
  const text = `Drop into my ${NAME} match 🪂⛏🌪 — loot, build, outrun the storm. Last one standing wins. Open and play, no install`;
  open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(inviteLink())}`, '_blank', 'noopener');
});

// Состояние раунда в лобби: можно ли высадиться прямо сейчас.
function updateRoundInfo() {
  if (playing) return;
  if (gameMode === 'casual') {
    $('tring').style.strokeDashoffset = '0';
    $('roundinfo').innerHTML = mode === 'join'
      ? `<b class="live">● Friend's match</b>Drop in with everyone on the link`
      : `<b class="live">● Fresh match</b>Starts the moment you hit Play · 8 min`;
    return;
  }
  const into = Date.now() % ROUND_MS, left = ROUND_MS - into;
  $('tring').style.strokeDashoffset = (125.66 * into / ROUND_MS).toFixed(1);
  $('roundinfo').innerHTML = left > 90e3
    ? `<b class="live">● Match live</b>Drop in now · round ends in ${mmss(left / 1000)}`
    : `<b class="wait">Final circle</b>Next drop in ${mmss(left / 1000)}`;
}
setInterval(updateRoundInfo, 500);

// ---------- Настройки ----------

const SETTINGS_KEY = 'pr:settings';
const settings = { sens: 1, fov: 80, vol: 0.8, shadows: true, hq: true, bloom: true, grass: true, fps: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* по умолчанию */ }

function applySettings() {
  controls.pointerSpeed = settings.sens;
  FOV = settings.fov;
  if (!isScoped()) { camera.fov = FOV; camera.updateProjectionMatrix(); }
  sun.castShadow = settings.shadows;
  renderer.setPixelRatio(settings.hq ? Math.min(devicePixelRatio, 2) : 1);
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(settings.hq ? Math.min(devicePixelRatio, 2) : 1);
  composer.setSize(innerWidth, innerHeight);
  fitFxaa();
  grass.visible = settings.grass;
  $('fps').hidden = !settings.fps;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* без сохранения */ }
}

const SLIDERS = [
  { key: 'sens', label: 'Mouse sensitivity', min: 0.2, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'fov', label: 'Field of view', min: 60, max: 110, step: 1, fmt: (v) => `${v}°` },
  { key: 'vol', label: 'Volume', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];
const TOGGLES = [
  { key: 'shadows', label: 'Shadows', on: 'On', off: 'Off' },
  { key: 'hq', label: 'Graphics quality', on: 'High', off: 'Fast' },
  { key: 'bloom', label: 'Bloom (glow)', on: 'On', off: 'Off' },
  { key: 'grass', label: 'Grass', on: 'On', off: 'Off' },
  { key: 'fps', label: 'Show FPS', on: 'On', off: 'Off' },
];
// Одни и те же настройки — во вкладке лобби и в паузе; меняешь в одном месте — обновляется везде.
function renderSettings() {
  for (const box of document.querySelectorAll('[data-settings]')) {
    box.textContent = '';
    for (const s of SLIDERS) {
      const row = document.createElement('label');
      row.className = 'srow';
      const name = document.createElement('span'); name.textContent = s.label;
      const input = Object.assign(document.createElement('input'), { type: 'range', min: s.min, max: s.max, step: s.step, value: settings[s.key] });
      input.dataset.key = s.key;
      const out = document.createElement('output'); out.textContent = s.fmt(settings[s.key]);
      input.addEventListener('input', () => {
        settings[s.key] = +input.value;
        for (const i of document.querySelectorAll(`input[data-key="${s.key}"]`)) { i.value = input.value; i.nextElementSibling.textContent = s.fmt(+input.value); }
        applySettings();
      });
      row.append(name, input, out);
      box.appendChild(row);
    }
    for (const s of TOGGLES) {
      const row = document.createElement('div');
      row.className = 'srow';
      const name = document.createElement('span'); name.textContent = s.label;
      const btn = document.createElement('button');
      btn.className = `tog${settings[s.key] ? ' on' : ''}`;
      btn.textContent = settings[s.key] ? s.on : s.off;
      btn.addEventListener('click', () => { settings[s.key] = !settings[s.key]; applySettings(); renderSettings(); });
      row.append(name, btn);
      box.appendChild(row);
    }
  }
}
renderSettings();
applySettings();

// Пауза: управление и выход в лобби (та же ссылка — можно вернуться в матч).
$('howto2').addEventListener('click', () => { $('pkeys').hidden = !$('pkeys').hidden; });
$('leave').addEventListener('click', () => { loadout.giveBack(abilities.slots); location.href = `${location.pathname}?w=${worldId}`; });
addEventListener('beforeunload', () => { if (playing) loadout.giveBack(abilities.slots); });

// Остров для лобби — сразу при открытии страницы.
if (!params.has('shot')) {
  setMood('lobby');
  setTimeout(() => {
    loadWorld(lobbyId());
    makeHero(); renderSeason(); renderPlayerCard(); renderPois(); updateRoundInfo(); moveTabInd();
    setGameMode(gameMode);
    renderLoadout();
    setTimeout(() => $('splash').classList.add('done'), 350);
  }, 60);
}

// ---------- Цикл ----------

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  if (!playing && world) lobbyFrame(dt, t);
  if (playing) {
    updateHeli(t);
    if (riding) { /* камеру ставит updateHeli */ }
    else if (controls.isLocked) step(dt);
    else player.position.set(feet.x, feet.y + eyeH, feet.z);
    updateSelfFigure(t);

    // Зажатая ЛКМ: автоматическое оружие стреляет, кирка машет, стройка ставит детали.
    const en = ENTRIES[slot], w = currentWeapon();
    if (mouseDown && controls.isLocked) {
      if (buildType) placePiece(t);
      else if (en.pick) swingPickaxe(t);
      else if (w && WEAPONS[w.type].auto) combat.fire(en.weapon, t);
    }
    combat.update(dt);
    loot.update(dt, now);
    bots.update(dt);
    abilities.update(dt);
    royale.update(dt);
    updateFx(dt);
    updatePlan();
    updatePoi();

    // Подбор лута и подсказки.
    swapCandidate = royale.alive && !riding ? loot.pickupNear(feet, combat, dt) : null;
    const chest = controls.isLocked && royale.alive ? loot.chestNear(eye(), look()) : null;
    const prompt = royale.ended ? $('prompt').textContent : riding ? ridePrompt() : chest ? 'E — open chest' : swapCandidate ? `G — swap for ${itemLabel(swapCandidate)}` : gliding ? (chute ? 'Parachute — steer with WASD' : 'SPACE — open parachute') : '';
    if ($('prompt').textContent !== prompt) { $('prompt').textContent = prompt; $('prompt').hidden = !prompt; }
    $('prompt').classList.toggle('ride', riding && inJumpZone());
    $('prompt').classList.toggle('wait', riding && !inJumpZone());
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
      const prev = o.group.position.clone();
      o.group.position.lerp(new THREE.Vector3(o.target.x, o.target.y, o.target.z), 0.25);
      o.group.rotation.y = o.target.r;
      o.group.scale.y += ((o.target.cr ? 0.72 : 1) - o.group.scale.y) * 0.3;       // присел — ниже
      // дальше 40 м — без контура и теней (20 ботов: вдвое меньше отрисовок)
      const near = o.group.position.distanceToSquared(feet) < 1600;
      if (o.near !== near) { o.near = near; o.group.traverse((x) => { if (x.userData.outline) x.visible = near; else if (x.isMesh) x.castShadow = near; }); }
      // поза по движению: планирует / в воздухе / бежит / стоит
      const sp = Math.hypot(o.group.position.x - prev.x, o.group.position.z - prev.z) / Math.max(dt, 1e-3);
      o.spd = (o.spd || 0) * 0.85 + sp * 0.15;
      const st = o.target.st === 'g' ? 'chute' : o.target.st === 'f' ? 'glide' : o.target.st === 'a' ? 'air' : o.spd > 0.8 ? 'run' : 'idle';
      // купол над тем, кто под парашютом; в свободном падении — животом вниз
      if (o.target.pc && !o.chute) { o.chute = buildParachute(); o.group.add(o.chute); }
      if (o.chute) o.chute.visible = !!o.target.pc;
      o.group.rotation.x += ((o.target.st === 'f' ? -1.1 : 0) - o.group.rotation.x) * 0.2;
      animateCharacter(o.group, t, st, Math.min(1, o.spd / RUN), !!o.target.g && o.target.g !== 'pickaxe');
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
  if (playing) grass.update(feet, t);             // в лобби камера высоко — траву не видно, не считаем
  windUniform.value = t;
  water.update(t);
  // Тени: при сдвиге на 1.5 м, после правок построек и не реже 10 раз в секунду (движутся другие игроки)
  if (shadowDirty || c.distanceTo(shadowAt) > 1.5 || t - shadowT > (playing ? 0.1 : 0.05)) {
    renderer.shadowMap.needsUpdate = true;
    shadowAt.copy(c); shadowT = t; shadowDirty = false;
  }
  if (settings.bloom) composer.render(); else renderer.render(scene, camera);
  countFps(now);
  if (playing && !riding && !gliding && (controls.isLocked || debugView)) {
    const h = holding();
    vm.set(h);
    vm.render(dt, { moving, reloading: !!combat.reloading, scoped: isScoped(), loaded: !!h && h.mag > 0 });
  }
});

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
    riding = false; flight = null; heli.visible = false;     // в съёмке без вертолёта
  }, 60);
}

// Счётчик FPS: среднее за полсекунды, цвет по уровню.
let fpsFrames = 0, fpsT0 = performance.now();
function countFps(now) {
  fpsFrames++;
  if (now - fpsT0 < 500) return;
  const fps = fpsFrames * 1000 / (now - fpsT0);
  fpsFrames = 0; fpsT0 = now;
  const el = $('fps');
  el.hidden = !settings.fps;
  if (!settings.fps) return;
  el.textContent = `${Math.round(fps)} FPS · ${(1000 / fps).toFixed(1)} ms`;
  el.className = fps >= 55 ? 'good' : fps >= 35 ? 'ok' : 'bad';
}

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
  combat, loot, pick, royale, season, structures, mats, bots, sendHit, abilities, openBuy, closeBuy, get crouching() { return crouching; }, get eyeH() { return eyeH; }, get vel() { return vel; }, scene, camera, renderer, composer, grass, settings,
  build: (t) => enterBuild(t), place: () => { updatePlan(); nextBuild = 0; placePiece(performance.now() / 1000); }, swing: () => { nextSwing = 0; swingPickaxe(performance.now() / 1000); },
  get plan() { return plan; },
  get feet() { return feet; }, step: (dt) => step(dt), keys, controls, ride: () => startRide(true), get riding() { return riding; }, heliTick: () => updateHeli(performance.now() / 1000), ridePrompt: () => flight && ridePrompt(), jump: () => jumpOut(),
  set debugView(v) { debugView = v; $('cross').hidden = !v; $('pause').hidden = v; },
  tp(x, z, up = 0, y = 999) { feet.set(x, structures.ground(x, z, y) + 0.01 + up, z); gliding = false; player.position.set(feet.x, feet.y + EYE, feet.z); },
  look(yaw, pitch = 0) { camera.rotation.set(pitch, yaw, 0, 'YXZ'); },
};
