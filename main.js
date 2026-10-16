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
import { toonGradient, toon, windUniform, outlineGroup, rimUniform } from './art.js';
import { createStructures, MATS, MAT_INFO, BUILD_COST, MAT_MAX, PICK_DMG } from './structures.js';
import { connect } from './net.js';
import { findMatch } from './mm.js';
import { createCombat, WEAPONS, RARITY, AMMO, MAX_SHIELD, MED, weaponLabel, rayBox } from './combat.js';
import { createLoot, itemLabel } from './loot.js';
import { createViewmodel, weaponModel } from './viewmodel.js';
import { createRoyale, ROUND_MS, DROP_MS } from './royale.js';
import { createSeason, TIERS, TOKEN_MINT, TOKEN_SYMBOL } from './season.js';
import { SKINS, skinById, unlocked, lockLabel, buildCharacter, animateCharacter, SKIN_MOODS } from './skins.js';
import { createWater } from './water.js';
import { createBots } from './bots.js';
import { createLobbyScene } from './lobby.js';
import { createAbilities, ABILITIES } from './abilities.js';
import { createLoadout, CHARGE_PRICE, COIN } from './loadout.js';
import { createGunsmith, GUN_MODS, GUN_ORDER, modInfo } from './gunsmith.js';
import { createMinimap } from './minimap.js';
import { createWeaponSkins, CASES, WS_RARITY, WS_GUNS, GUN_NAME, ALL_SKINS, skinInfo, FINISHES } from './wskins.js';
import { createRanked, SHOP, rankedWorld, isRankedWorld } from './ranked.js';
import { createGrass } from './grass.js';
import { buildHeli, buildParachute, buildCabin, CHUTES, chuteById } from './heli.js';
import { createFx } from './fx.js';
import { AOPass, SunRaysPass } from './post.js';
import { createAudio } from './audio.js';
import { createEvents, PUMP_MULT } from './events.js';
import { createPads, PAD_VY, PAD_PUSH } from './pads.js';
import { createWeather } from './weather.js';
import { createRoadsters, CAR } from './roadster.js';

const NAME = 'PostRoyale';                     // название — менять здесь (и в <title> index.html)
const EYE = 1.62, HEIGHT = 1.8, HALF = 0.3, CROUCH_H = 1.25, CROUCH_EYE = 1.08, PRONE_H = 0.62, PRONE_EYE = 0.42;
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

// ---------- Турнир 1v1: тикер против тикера ----------
// Мир дуэли: duel-<тикерA>-<тикерB>-<код>. Сторона — параметр s: a — кто создал (бьётся за первый тикер),
// b — кто открыл ссылку-вызов. Пока соперника нет — ждёшь в круге без урона; как только он зашёл, хост
// шлёт «duel» { go } — у обоих отсчёт 3-2-1 и бой с готовым набором (оружие, щит, материалы), без ботов.
const isDuelWorld = (id) => /^duel-[a-z0-9]{1,10}-[a-z0-9]{1,10}-[a-z0-9]{3,8}$/.test(id || '');
const duelTickers = (id) => { const [, a, b] = id.split('-'); return { a: `$${a.toUpperCase()}`, b: `$${b.toUpperCase()}` }; };
// Online-матч с сервера (mm.js): мир mm-<код>; mmMatch — найденный матч, mmSearch — идёт поиск.
const isOnlineWorld = (id) => /^mm-[a-f0-9]{6}$/.test(id || '');
let mmMatch = null, mmSearch = null;
const cleanTicker = (v) => v.trim().replace(/^\$+/, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
const linkDuel = isDuelWorld(params.get('w')) ? params.get('w') : null;     // пришли по ссылке-вызову
let duelSide = 'a', duelGoAt = 0;
const myTicker = () => duelTickers(worldId)[duelSide];
const oppTicker = () => duelTickers(worldId)[duelSide === 'a' ? 'b' : 'a'];
const COLORS = ['#1d9bf0', '#16c784', '#f4212e', '#ffad1f', '#a970ff', '#ff6bd6', '#00d4d4', '#ff7a1a'];
const colorOf = (s) => COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const ANIMALS = ['Frog', 'Cat', 'Ape', 'Bull', 'Bear', 'Whale', 'Pepe', 'Doge', 'Shrimp', 'Degen'];
let nick = localStorage.getItem('pc:nick') || `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}${Math.floor(Math.random() * 900 + 100)}`;
$('nick').value = nick;


// ---------- Сцена ----------

// Мультяшный стиль: cel-затенение (MeshToonMaterial), мягкие тени от солнца, градиентное небо, облака, бирюзовое море.
// ?rec — запись промо-видео (brand/trailer.js): кадр должен оставаться в буфере, чтобы его скопировать.
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('rec') });
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

const fx = createFx(scene, camera);
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
// В буфере кадра — ещё и текстура глубины: по ней считается мягкое затенение (AOPass, post.js).
const frameRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType });
frameRT.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight);
const composer = new EffectComposer(renderer, frameRT);
composer.addPass(new RenderPass(scene, camera));
const aoPass = new AOPass(camera);
composer.addPass(aoPass);
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
const rays = new SunRaysPass();
composer.addPass(rays);
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
const pads = createPads(scene);
const weather = createWeather(scene);
const roadsters = createRoadsters(scene);
// Своя машина (roadster.js): myCar — в какой сидишь; carSt — её физика; launch — замер 0–100 км/ч.
let myCar = null, carBanner = -1;
const carSt = { speed: 0, vy: 0, ground: true, fuel: CAR.FUEL, flip: 0, flipDir: 1, hopCd: 0, spaceWas: false, fWas: false, fly: false };
let launch = null;
const rammed = new Map();

// ---------- Физика игрока ----------

const vel = new THREE.Vector3();
let onGround = false, moving = false, gliding = false, crouching = false;
let prone = false;                             // лёжа (P): совсем низко, медленно, точнее всего
// Скольжение: Alt на бегу — рывок вперёд в приседе, скорость гаснет за SLIDE с (направление — куда бежал).
const SLIDE = 0.9, SLIDE_BOOST = 1.75, SLIDE_CD = 0.5;
let slideT = 0, slideReady = 0, altWas = false, camRoll = 0, padCd = 0;
const slideDir = new THREE.Vector3();
let chute = false;                             // gliding && !chute — свободное падение; chute — под куполом
let eyeH = EYE;                                // высота глаз: плавно опускается при приседании
const bodyH = () => (prone ? PRONE_H : crouching ? CROUCH_H : HEIGHT);   // полёта нет: только ходьба, прыжок и планирование при высадке
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
  camera.rotation.set(-0.25, Math.atan2(-dir.x, -dir.z), 0, 'YXZ');
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
  audio.play('jumpOut');
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
  // салон (вид от первого лица) сейчас не используется — камера снаружи
  cabin.visible = false;
  const d = flown();
  if (riding) {
    if (d >= flight.w1) jumpOut(true);
    else {
      feet.copy(V_HELI);
      // камера от третьего лица на орбите вокруг вертолёта: направление — от мыши
      camera.getWorldDirection(V_LOOK);
      player.position.copy(V_HELI).addScaledVector(V_LOOK, -26).add(new THREE.Vector3(0, 6, 0));
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
  if (prone && (gliding || !royale.alive)) prone = false;
  eyeH += ((prone ? PRONE_EYE : crouching ? CROUCH_EYE : EYE) - eyeH) * Math.min(1, dt * 10);
  const speed = gliding ? (chute ? GLIDE : 11) : prone ? WALK * 0.25 : crouching ? WALK * 0.45 : (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !scoped ? RUN : scoped ? WALK * 0.5 : WALK;
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
  // скольжение: нажал Alt, когда бежал вперёд по земле
  const sprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !scoped;
  const nowS = performance.now() / 1000;
  if (wantCrouch && !altWas && sprint && onGround && move.lengthSq() && !prone && nowS > slideReady) {
    slideT = SLIDE; slideDir.copy(move).normalize(); slideReady = nowS + SLIDE + SLIDE_CD;
    audio.play('slide');
  }
  altWas = wantCrouch;
  if (slideT > 0 && (!wantCrouch || prone)) slideT = 0;
  if (slideT > 0) {
    slideT -= dt;
    const k = Math.max(0, slideT / SLIDE);
    // чуть подруливаем мышью/клавишами, но в основном — по инерции
    if (move.lengthSq()) slideDir.lerp(move.clone().normalize(), Math.min(1, dt * 2)).normalize();
    move.copy(slideDir).multiplyScalar((WALK * 0.45 + (RUN * SLIDE_BOOST - WALK * 0.45) * Math.sqrt(k)) * dt);
    if (onGround && Math.random() < dt * 25) fx.dust(feet.clone().addScaledVector(slideDir, 0.5).add(new THREE.Vector3(0, 0.15, 0)), 0xcbb894, 0.9);
  } else if (move.lengthSq()) move.normalize().multiplyScalar(speed * dt);
  // наклон камеры в скольжении
  const roll = slideT > 0 ? 0.06 : 0;
  camera.rotation.z += (roll - camera.rotation.z) * Math.min(1, dt * 10);

  // батут: подкинуло вверх и чуть вперёд (по взгляду); дальше можно раскрыть парашют
  padCd -= dt;
  const pad = padCd <= 0 && !gliding ? pads.under(feet) : null;
  if (pad && vel.y <= 0.5) {
    vel.y = PAD_VY; onGround = false; padCd = 0.5; slideT = 0;
    knockVel.addScaledVector(fwd, PAD_PUSH);
    pads.bounce(pad);
    audio.play('bounce', new THREE.Vector3(pad.x, pad.y + 1, pad.z));
    fx.dust(new THREE.Vector3(pad.x, pad.y + 0.8, pad.z), 0xc8a8ff, 2);
  }

  // Отброс от взрыва гасится за полсекунды.
  move.addScaledVector(knockVel, dt);
  knockVel.multiplyScalar(Math.max(0, 1 - 4 * dt));

  {
    moveAxis('x', move.x);
    moveAxis('z', move.z);
    if (keys.has('Space') && onGround && !prone) { vel.y = JUMP; onGround = false; audio.play('jump'); }
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
      if (!onGround && vel.y < -5 && playing && royale.alive) audio.land(-vel.y, surfaceUnder());
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

// ---------- Roadster: сесть, ехать, выйти ----------

function enterCar(c) {
  if (myCar || !playing || !royale.alive || riding || gliding) return;
  if (buildType) exitBuild();
  stopEmote(); combat.cancelReload(); combat.cancelHeal(); scopeHeld = false; prone = false; crouching = false;
  myCar = c; c.driver = 'me';
  Object.assign(carSt, { speed: 0, vy: 0, ground: true, fuel: CAR.FUEL, flip: 0, hopCd: 0, spaceWas: keys.has('Space'), fWas: keys.has('KeyF'), fly: false });
  launch = null;
  audio.play('carStart', c.pos);
  $('carhud').hidden = false;
  if (!localStorage.getItem('pr:carTip2')) { banner('⚡ ROADSTER', 'SHIFT launch · SPACE jump (+A/D kickflip) · F — wheels to jets: FLY', 4500); try { localStorage.setItem('pr:carTip2', '1'); } catch (e) { /* нет */ } }
}
// Выйти: рядом с машиной (слева); out=false — просто бросить (смерть, новый раунд).
function exitCar(out = true) {
  if (!myCar) return;
  const c = myCar;
  myCar = null; c.driver = null; c.thrust = 0; c.boost = 0; c.spin = 0; c.jet = 0;
  carSt.fly = false; c.fold = 0;
  $('carhud').hidden = true;
  if (!out) return;
  const side = new THREE.Vector3(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
  for (const k of [2.2, -2.2, 3.5, -3.5]) {
    const x = c.pos.x + side.x * k, z = c.pos.z + side.z * k, y = structures.ground(x, z, c.pos.y + 1.5, HALF);
    if (!structures.blocked(x, y, z, HEIGHT, HALF)) { feet.set(x, y, z); break; }
    feet.set(c.pos.x, c.pos.y + 1.4, c.pos.z);
  }
  vel.set(0, carSt.ground ? 0 : carSt.vy, 0); onGround = carSt.ground;
  knockVel.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw)).multiplyScalar(carSt.speed * 0.3);
  audio.play('gear');
}

function carStep(dt, locked) {
  const c = myCar;
  const k = (a, b) => (locked && (keys.has(a) || keys.has(b)) ? 1 : 0);
  const space = locked && keys.has('Space');
  const input = {
    thr: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
    steer: k('KeyA', 'ArrowLeft') - k('KeyD', 'ArrowRight'),
    boost: locked && (keys.has('ShiftLeft') || keys.has('ShiftRight')),
    hop: space && !carSt.spaceWas, up: space,
    down: locked && (keys.has('AltLeft') || keys.has('AltRight') || keys.has('KeyC')),
    fly: locked && keys.has('KeyF') && !carSt.fWas,
  };
  carSt.spaceWas = space; carSt.fWas = locked && keys.has('KeyF');
  const before = carSt.speed;
  const ev = roadsters.drive(c, dt, input, carSt);
  // 0–100 км/ч: с места до 27.8 м/с — время на экран (как на презентации)
  if (input.thr > 0 && Math.abs(before) < 1 && carSt.ground && !launch) launch = { t: 0, boost: input.boost };
  if (launch) {
    launch.t += dt;
    if (input.thr <= 0) launch = null;
    else if (carSt.speed >= 27.78) { banner(`0–100 km/h: ${launch.t.toFixed(2)} s`, launch.boost ? '⚡ LAUNCH MODE' : 'hold SHIFT for launch mode', 2600); audio.play('boost'); shakeAmt = Math.max(shakeAmt, 0.15); launch = null; }
  }
  if (ev.hop) { audio.play('thrust', c.pos); for (let i = 0; i < 6; i++) fx.dust(c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.2, (Math.random() - 0.5) * 3)), 0xbff8ff, 2.2); }
  if (ev.flip) toast(carSt.fly ? '🌀 BARREL ROLL' : '🛹 KICKFLIP');
  if (ev.flyOn) { audio.play('jetOn', c.pos); shakeAmt = Math.max(shakeAmt, 0.2); for (let i = 0; i < 10; i++) fx.dust(c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0.2, (Math.random() - 0.5) * 4)), 0xbff8ff, 2.6); }
  if (ev.flyOff) audio.play('gear');
  if (ev.flameout) { toast('⛽ Jets out of fuel'); audio.play('carCrash', c.pos, { vol: 0.4 }); }
  // турбины низко над землёй/водой: брызги или пыль из-под колёс
  if (ev.low && Math.random() < dt * 30) {
    const wy = Math.max(world.height(c.pos.x, c.pos.z), WATER_Y);
    fx.dust(new THREE.Vector3(c.pos.x + (Math.random() - 0.5) * 3, wy + 0.2, c.pos.z + (Math.random() - 0.5) * 4), wy <= WATER_Y + 0.01 ? 0xd8f2ff : 0xcbb894, 2);
  }
  if (ev.crash) { shakeAmt = Math.max(shakeAmt, Math.min(0.5, ev.crash / 60)); audio.play('carCrash', c.pos, { vol: Math.min(1, ev.crash / 30) }); fx.dust(c.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0x9a9a9a, 1.6); }
  if (ev.land) { shakeAmt = Math.max(shakeAmt, Math.min(0.35, ev.land / 60)); audio.play('land', null, { vol: 0.8 }); }
  if (ev.water && Math.abs(carSt.speed) > 6 && Math.random() < dt * 30) fx.dust(c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.3, 2.2)), 0xd8f2ff, 1.8);
  else if (carSt.ground && Math.abs(carSt.speed) > 20 && Math.random() < dt * 12) fx.dust(c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.15, 0)), 0xcbb894, 1.2);
  if (c.thrust > 0.5 && Math.random() < dt * 20) fx.dust(c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, -0.2, (Math.random() - 0.5) * 3)), 0x9ff4ff, 1.4);
  // таран: на скорости сбиваешь игроков и ботов
  const sp = Math.abs(carSt.speed), now = performance.now();
  if (sp > 10) for (const [id, o] of others) {
    if (!o.group.visible || o.target.a === false || Array.isArray(o.target.cv)) continue;
    const p = o.group.position;
    if (Math.hypot(p.x - c.pos.x, p.z - c.pos.z) > 2.6 || Math.abs(p.y - c.pos.y) > 2.2 || (rammed.get(id) || 0) > now) continue;
    rammed.set(id, now + 1000);
    sendHit(id, { dmg: sp >= 28 ? 100 : Math.round(sp * 2.6), by: nick, w: 'car' });     // от 100 км/ч — насмерть
    hitmarker(sp > 35 ? 'head' : '');
    audio.play('carCrash', p, { vol: 0.9 }); shakeAmt = Math.max(shakeAmt, 0.25);
    fx.dust(p.clone().add(new THREE.Vector3(0, 1, 0)), 0xffffff, 1.5);
    carSt.speed *= 0.85;
  }
  // ты — там, где машина (шторм, зона, позиция для других); камера сзади-сверху, крутится мышью
  feet.copy(c.pos); vel.set(0, carSt.vy, 0); onGround = carSt.ground; gliding = false; moving = sp > 1;
  const back = camera.getWorldDirection(new THREE.Vector3()).negate();
  const head = c.pos.clone().add(new THREE.Vector3(0, 2.2 + c.fold * 0.8, 0)), dist = 8 + c.fold * 3;   // в полёте — дальше и выше
  const hit = structures.raycast(head, back, dist);
  player.position.copy(head).addScaledVector(back, hit ? Math.max(1.2, hit.t - 0.4) : dist);
  player.position.y = Math.max(player.position.y, world.height(player.position.x, player.position.z) + 0.6, WATER_Y + 0.6);
  // HUD: спидометр и топливо двигателей
  $('carspd').textContent = Math.round(sp * 3.6);
  $('carfuel').style.width = `${(carSt.fuel / CAR.FUEL) * 100}%`;
  $('carhud').classList.toggle('boost', c.boost > 0.5);
  $('carhud').classList.toggle('fly', carSt.fly);
  $('carmode').textContent = carSt.fly ? `✈ FLYING · ALT ${Math.max(0, Math.round(c.pos.y - Math.max(world.height(c.pos.x, c.pos.z), WATER_Y)))} m` : 'F — FLY';
}

// Чужие машины — из поз водителей; свою занял кто-то с меньшим id — уступаем. Объявление в начале раунда.
function updateCars(dt) {
  const drivers = new Map();
  for (const [id, o] of others) if (Array.isArray(o.target.cv) && o.target.a !== false && performance.now() - (o.seen ?? 0) < 3000) drivers.set(id, o.target.cv);
  const taken = roadsters.sync(drivers, myCar);
  if (myCar && taken.has(myCar.id) && net && taken.get(myCar.id)[0] < net.selfId) { exitCar(true); toast('Someone else took this Roadster'); }
  if (myCar && !royale.alive) exitCar(false);
  roadsters.update(dt);
  if (royale.round >= 0 && carBanner !== royale.round && roadsters.list.length && Date.now() - royale.roundStart > 34000 && royale.alive && !royale.duel) {
    carBanner = royale.round;
    banner('⚡ ROADSTERS ON THE ISLAND', '0–100 in under a second · thrusters · kickflips — follow the cyan beams', 4000);
  }
}
function carsJetLevel() {
  let best = 0;
  for (const c of roadsters.list) if (c.driver && c.driver !== 'me' && c.fold > 0.5) best = Math.max(best, Math.max(0, 1 - c.pos.distanceTo(player.position) / 90) * c.jet);
  return best;
}
// Гул чужих машин рядом (своя — громче, её считает envSound).
function carsNearLevel() {
  let best = 0;
  for (const c of roadsters.list) if (c.driver && c.driver !== 'me') best = Math.max(best, Math.max(0, 1 - c.pos.distanceTo(player.position) / 60) * 0.7);
  return best;
}

// ---------- Парашют и вид от третьего лица в полёте ----------

// Падаешь с большой высоты (с горы, с постройки, после Moon Jump) — можно раскрыть парашют снова.
const REDEPLOY_H = 9;
function canRedeploy() {
  return playing && royale.alive && !riding && !gliding && !onGround && vel.y < -3
    && feet.y - structures.ground(feet.x, feet.z, feet.y) > REDEPLOY_H;
}

function openChute() {
  if (!gliding || chute) return;
  chute = true;
  audio.play('chuteOpen');
}

// Своя фигурка (видна только в падении/под куполом — камера в это время сзади-сверху).
let selfFig = null, selfFigKey = '';
let selfChute = buildParachute();

// ---------- Скин парашюта (Locker, за монеты) ----------
const CHUTE_KEY = 'pr:chutes';
let chuteSt = { owned: ['classic'], on: 'classic' };
try { Object.assign(chuteSt, JSON.parse(localStorage.getItem(CHUTE_KEY) || '{}')); } catch (e) { /* по умолчанию */ }
const myChute = () => (chuteSt.owned.includes(chuteSt.on) ? chuteById(chuteSt.on).id : 'classic');
const saveChutes = () => { try { localStorage.setItem(CHUTE_KEY, JSON.stringify(chuteSt)); } catch (e) { /* без сохранения */ } };

// ---------- Эмоции (J — меню, 1–4 — выбрать) ----------
// Пока танцуешь — камера от третьего лица спереди, мышь крутит её вокруг; любое движение, прыжок, клик — конец.
// Другим уходит pose.em — видят тот же танец.
const EMOTES = [
  { id: 'dance', name: 'Dance', icon: '🕺' },
  { id: 'floss', name: 'Floss', icon: '🙌' },
  { id: 'wave', name: 'GM', icon: '👋' },
  { id: 'moon', name: 'To the Moon', icon: '🚀' },
];
const EMOTE_IDS = EMOTES.map((e) => e.id);
let emote = null, emotePick = false;
function toggleEmotes(on = !emotePick) {
  emotePick = on && playing && royale.alive && !riding;
  $('emotes').hidden = !emotePick;
}
function startEmote(id) {
  toggleEmotes(false);
  if (!playing || !royale.alive || riding || gliding || !onGround || abilities.drone) return;
  if (buildType) exitBuild();
  scopeHeld = false;
  combat.cancelReload(); combat.cancelHeal();
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  emote = { id, yaw };
  camera.rotation.set(-0.15, yaw + Math.PI, 0, 'YXZ');      // камера разворачивается — видно лицо
}
function stopEmote() {
  if (!emote) return;
  camera.rotation.set(0, emote.yaw, 0, 'YXZ');
  emote = null;
}

// ---------- Кино-камера: победа, килкам, зритель ----------
// Перед рендером камеру ставим «как в кино», после — возвращаем: мышь всё время крутит настоящую камеру
// (у зрителя ею и вращаешь вид вокруг игрока).
// win — облёт вокруг победителя (ты танцуешь, сверху конфетти); killcam — 3 с из-за плеча убийцы на место
// твоей гибели; spec — от третьего лица за живым игроком (ЛКМ/ПКМ — следующий/предыдущий, V — свободная камера).
let cine = null;
const camSave = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
const CINE_V = new THREE.Vector3(), CINE_L = new THREE.Vector3();
let cineCam = null;                                  // сглаженная позиция кино-камеры
const aliveOthers = () => [...others.entries()].filter(([, o]) => o.target?.a && o.target.rr === royale.round && performance.now() - (o.seen ?? 0) < 6000);
function startWinCam() {
  if (cine?.mode === 'win') return;
  cine = { mode: 'win', t0: performance.now() / 1000, burst: 0 };
  cineCam = null;
  $('spec').hidden = true;
  if (!emote && onGround && !riding) startEmote(Math.random() < 0.5 ? 'dance' : 'floss');
}
function startKillcam(killerName, at, w) {
  const k = [...others.entries()].find(([, o]) => sameNick(o.name, killerName));
  if (!k) { startSpectate(); return; }
  cine = { mode: 'killcam', id: k[0], at: at.clone(), until: performance.now() / 1000 + 3.2 };
  cineCam = null;
  $('spec').hidden = false;
  $('spec').className = 'kc';
  $('spec').innerHTML = '';
  const b = document.createElement('b'); b.textContent = 'Killcam';
  const sp = document.createElement('span'); sp.textContent = `Eliminated by ${killerName}${w && KILL_ICON[w] ? ` ${KILL_ICON[w]}` : ''}`;
  $('spec').append(b, sp);
}
function startSpectate(id) {
  const list = aliveOthers();
  if (!list.length) { stopCine(); return false; }
  const pickId = id && others.has(id) ? id : list[0][0];
  cine = { mode: 'spec', id: pickId };
  cineCam = null;
  renderSpec();
  return true;
}
function renderSpec() {
  const o = others.get(cine?.id);
  if (!o) return;
  $('spec').hidden = false;
  $('spec').className = '';
  $('spec').innerHTML = '';
  const b = document.createElement('b'); b.textContent = `👁 ${o.name}`;
  const sp = document.createElement('span'); sp.textContent = `${aliveOthers().length} alive · LMB / RMB — next / previous · V — free camera`;
  $('spec').append(b, sp);
}
// ЛКМ/ПКМ у выбывшего: следующий/предыдущий живой игрок.
function specNext(dir) {
  if (!playing || royale.alive || royale.ended) return false;
  if (cine?.mode === 'killcam') { startSpectate(cine.id); return true; }
  const list = aliveOthers();
  if (!list.length) return false;
  const i = list.findIndex(([k]) => k === cine?.id);
  return startSpectate(list[(i + dir + list.length) % list.length][0]);
}
function stopCine() { cine = null; cineCam = null; $('spec').hidden = true; $('letterbox').classList.remove('on'); }
// Ставит кино-камеру на этот кадр; true — включена (после рендера вернуть настоящую).
function applyCine(dt, t) {
  if (!cine || !playing) return false;
  const now = performance.now() / 1000;
  $('letterbox').classList.toggle('on', cine.mode !== 'spec');
  let pos, look;
  if (cine.mode === 'win') {
    const k = now - cine.t0;
    const ang = (cine.yaw ??= new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y + Math.PI) + k * 0.45;
    const r = Math.max(3.2, 5.2 - k * 0.6), h = 0.8 + Math.max(0, 1.6 - k * 0.4);
    look = feet.clone().add(new THREE.Vector3(0, 1.1, 0));
    pos = look.clone().add(new THREE.Vector3(Math.sin(ang) * r, h, Math.cos(ang) * r));
    if (k < 6 && now > cine.burst) { cine.burst = now + 0.5; fx.confetti(feet, 70); }
  } else {
    const o = others.get(cine.id);
    if (!o || (cine.mode === 'spec' && !(o.target?.a && o.target.rr === royale.round))) {
      if (cine.mode === 'spec' && startSpectate()) return applyCine(dt, t);
      stopCine(); return false;
    }
    if (cine.mode === 'killcam') {
      if (now > cine.until) { if (!startSpectate(cine.id)) { stopCine(); return false; } return applyCine(dt, t); }
      const head = o.group.position.clone().add(new THREE.Vector3(0, 1.6, 0));
      const dir = cine.at.clone().sub(head); dir.y = 0;
      if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
      dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      pos = head.clone().addScaledVector(dir, -3.4).addScaledVector(side, 1.1).add(new THREE.Vector3(0, 0.8, 0));
      look = cine.at.clone().add(new THREE.Vector3(0, 0.8, 0));
    } else {
      // за спиной у игрока; мышь вращает вид вокруг него; камера не уходит сквозь постройки
      look = o.group.position.clone().add(new THREE.Vector3(0, 1.6, 0));
      const back = camSave.q ? new THREE.Vector3(0, 0, 1).applyQuaternion(camSave.q) : new THREE.Vector3(0, 0, 1);
      const hit = structures.raycast(look, back, 4.5);
      pos = look.clone().addScaledVector(back, hit ? Math.max(0.8, hit.t - 0.3) : 4.5);
    }
  }
  pos.y = Math.max(pos.y, world.height(pos.x, pos.z) + 0.7, WATER_Y + 0.5);       // не под землю и не под воду
  if (!cineCam || cineCam.distanceTo(pos) > 30) cineCam = pos.clone();
  else cineCam.lerp(pos, Math.min(1, dt * (cine.mode === 'win' ? 4 : 8)));
  camera.position.copy(cineCam);
  camera.lookAt(look);
  return true;
}

function updateSelfFigure(t) {
  const fpv = !!abilities.drone;
  if (emote && (!royale.alive || !onGround || gliding || riding)) stopEmote();
  const winCam = cine?.mode === 'win';
  const show = playing && (gliding || fpv || !!emote || winCam || !!myCar) && !riding && (royale.alive || winCam);
  if (selfChute.userData.skin !== myChute()) {
    selfFig?.remove(selfChute);
    selfChute = buildParachute(myChute());
    selfFig?.add(selfChute);
  }
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
  if (emote) {
    selfFig.rotation.set(0, emote.yaw, 0, 'YXZ'); selfChute.visible = false;
    animateCharacter(selfFig, t, emote.id);
    // камера на 4.2 м от головы, но не сквозь стены: упирается в первую постройку на пути
    const back = camera.getWorldDirection(new THREE.Vector3()).negate();
    const head = feet.clone().add(new THREE.Vector3(0, 1.4, 0));
    const hit = structures.raycast(head, back, 4.2);
    player.position.copy(head).addScaledVector(back, hit ? Math.max(0.6, hit.t - 0.3) : 4.2);
    return;
  }
  if (myCar) {
    selfFig.position.set(myCar.pos.x, myCar.pos.y - 0.25, myCar.pos.z);
    selfFig.rotation.set(myCar.pitch, myCar.yaw, myCar.roll, 'YXZ'); selfChute.visible = false;
    animateCharacter(selfFig, t, 'idle', 0, false);
    return;
  }
  if (winCam && !gliding) {
    selfFig.rotation.set(0, selfFig.rotation.y, 0, 'YXZ'); selfChute.visible = false;
    animateCharacter(selfFig, t, 'dance');
    return;
  }
  if (fpv) {
    selfFig.position.copy(feet); selfFig.rotation.set(0, selfFig.rotation.y, 0, 'YXZ'); selfChute.visible = false;
    animateCharacter(selfFig, t, 'idle', 0, true);                   // стоит с пультом в руках
    return;
  }
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

// ---------- Хотбар: кирка + 3 слота оружия + аптечки; режим стройки ----------
// 1 — кирка, 2–4 — оружие, 5 — аптечки (ЛКМ — лечиться), колесо — по кругу. Z стена, X пол, C рампа, V — материал, ЛКМ — поставить (можно зажать).

const ENTRIES = [{ pick: true }, { weapon: 0 }, { weapon: 1 }, { weapon: 2 }, { med: true }];
const PICKAXE = { type: 'pickaxe', rarity: 0 };
let slot = 0;
let buildType = null, buildMat = 0;
const mats = Object.fromEntries(MATS.map((m) => [m, 0]));
const PIECE_NAMES = { w: 'Wall', f: 'Floor', r: 'Ramp' };

const currentWeapon = () => { const e = ENTRIES[slot]; return !buildType && e.weapon !== undefined ? combat.slots[e.weapon] : null; };
const holding = () => (buildType ? null : ENTRIES[slot].pick ? PICKAXE : currentWeapon());
let scopeHeld = false;
// Прицеливание (ПКМ): снайперка — оптика с затемнением; оружие с обвесом-прицелом из Gunsmith — ADS с зумом.
const canAim = (type) => !!WEAPONS[type].scope || !!gunsmith.stats(type).optic;
const isScoped = () => scopeHeld && !!currentWeapon() && canAim(currentWeapon().type);
const opticOf = () => { const w = currentWeapon(); return w && !WEAPONS[w.type].scope ? gunsmith.stats(w.type).optic : null; };
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
    if (t < PICK_REACH) { sendHit(peerId, { dmg: 20, by: nick, w: 'pickaxe' }); hitmarker(); dmgNumber(o.clone().addScaledVector(d, t), 20, p.target); combat.sfx('chop'); return; }
  }
  const hit = structures.raycast(o, d, PICK_REACH);
  if (hit?.e) {
    combat.sfx('chop');
    chips(hit.point, hit.e);
    damageStructure(hit.e.k, PICK_DMG, true);
  }
}
// Урон постройке: локально + всем. harvest — удар киркой: материалы себе.
// Машины: от выстрелов и взрывов получают ×3 урона и, разбитые, взрываются (как ракета, чуть сильнее) —
// урон наносит тот, кто взорвал; у остальных — только эффект (edit.cb). Киркой — обычная добыча металла.
const objType = (k) => (k.startsWith('o:') ? structures.objects[+k.slice(2)]?.type : null);
const isCarKey = (k) => objType(k) === 'car';
// Машина — большой взрыв; бочка — поменьше, но рвётся от всего (и от кирки) и поджигает соседние бочки.
function carBoom(e, own) {
  const barrel = e.type === 'barrel';
  const p = new THREE.Vector3(e.x, (e.y ?? world.height(e.x, e.z)) + (barrel ? 0.6 : 0.9), e.z);
  if (barrel) { audio.play('barrel', p); shakeIfNear(p, 25, 0.35); }
  // бочки рядом детонируют чуть позже — цепочка
  setTimeout(() => combat.explodeAt(p, own, barrel ? 1.05 : 1.25), barrel && own ? 60 : 0);
  shadowDirty = true;
}
function damageStructure(k, dmg, harvest) {
  const type = objType(k);
  const car = !harvest && type === 'car';
  if (car) dmg *= 3;
  const res = structures.damage(k, dmg);
  if (!res) return;
  if (res.destroyed) { shadowDirty = true; onDestroyed(res.e); }
  const boom = (car || type === 'barrel') && res.destroyed;
  net?.edit({ k, x: dmg, rr: royale.round, ...(boom ? { cb: 1 } : {}) });
  if (boom) carBoom(res.e, true);
  if (harvest) {
    const { mat, n } = structures.harvestOf(res.e, res.destroyed);
    const before = mats[mat];
    mats[mat] = Math.min(MAT_MAX, mats[mat] + n);
    if (mats[mat] > before) pointsToast(`+${mats[mat] - before} ${MAT_INFO[mat].name}`);
    renderMats();
  }
}

// Эффекты попаданий (fx.js): материал детали/объекта — для щепок, искр и обломков.
const fxKind = (e) => (!e ? 'dirt' : e.kind === 'piece' ? e.m : e.type === 'rock' ? 'rock' : e.type === 'car' || e.type === 'barrel' ? 'metal' : 'wood');
function chips(p, e) { fx.chips(p, fxKind(e)); }
function entryBox(e) {
  const b = new THREE.Box3();
  for (const x of [...(e.boxes || []), ...(e.soft || [])]) b.union(new THREE.Box3(x.min, x.max));
  if (e.ramp) b.union(new THREE.Box3(new THREE.Vector3(e.ramp.ix * 4, e.ramp.iy * 4, e.ramp.iz * 4), new THREE.Vector3(e.ramp.ix * 4 + 4, e.ramp.iy * 4 + 4, e.ramp.iz * 4 + 4)));
  return b;
}
// Разрушили деталь/объект (у себя или пришло по сети): обломки и пыль, следы от пуль на ней — убрать.
function onDestroyed(e) {
  const tree = e.type === 'oak' || e.type === 'pine';
  if (tree) {
    // дерево падает от тебя (если рубил/стрелял не ты — всё равно в сторону от камеры)
    structures.fell(e, new THREE.Vector3(e.x - feet.x, 0, e.z - feet.z));
    audio.play('treeFall', new THREE.Vector3(e.x, e.y + 1, e.z));
    fx.debris(new THREE.Box3(new THREE.Vector3(e.x - 0.6, e.y, e.z - 0.6), new THREE.Vector3(e.x + 0.6, e.y + 1.2, e.z + 0.6)), 'wood', 6);
    fx.clearHoles(e.k);
    return;
  }
  if (e.kind === 'piece' || (e.type !== 'car' && e.type !== 'barrel')) fx.debris(entryBox(e), fxKind(e), e.kind === 'piece' ? 14 : 10);
  fx.clearHoles(e.k);
  const k = fxKind(e);
  audio.play(k === 'wood' || k === 'metal' ? `break_${k}` : 'break_brick', entryBox(e).getCenter(new THREE.Vector3()));
}
// Нормаль поверхности в точке попадания: рельеф — по высотам, коробка — по ближайшей грани.
function surfaceNormal(p, e, dir) {
  if (!e) {
    const h = (x, z) => world.height(x, z);
    return new THREE.Vector3(h(p.x - 0.5, p.z) - h(p.x + 0.5, p.z), 1, h(p.x, p.z - 0.5) - h(p.x, p.z + 0.5)).normalize();
  }
  let best = Infinity; const n = dir.clone().negate();
  for (const b of e.boxes || []) {
    for (const [ax, v] of [['x', 1], ['y', 1], ['z', 1]]) {
      for (const side of [-1, 1]) {
        const d = Math.abs(p[ax] - (side < 0 ? b.min[ax] : b.max[ax]));
        if (d < best) { best = d; n.set(0, 0, 0); n[ax] = side * v; }
      }
    }
  }
  return n;
}
// Пыль из-под ног у бегущих рядом (других игроков и ботов; своя в первом лице не видна).
let dustT = 0;
function runDust(dt) {
  if ((dustT += dt) < 0.09) return;
  dustT = 0;
  for (const o of others.values()) {
    if (!o.group.visible || !o.near || (o.spd || 0) < 4 || o.target.st || o.target.pr) continue;
    const p = o.group.position;
    if (p.y < WATER_Y + 0.2) continue;
    fx.dust(new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.4, p.y + 0.08, p.z + (Math.random() - 0.5) * 0.4), p.y < WATER_Y + 3 ? 0xe2cf9c : 0xb7a57c);
  }
}
// Попадание пули в постройку/объект/землю (своё): след на поверхности, крошка, искры по металлу.
function impact(p, e, dir) {
  if (!world || p.distanceToSquared(feet) > 120 * 120) return;
  const kind = fxKind(e);
  const tree = e && (e.type === 'oak' || e.type === 'pine');
  if (!tree && !e?.ramp) fx.hole(p, surfaceNormal(p, e, dir), e ? e.k : null);
  if (!e) fx.dust(p, 0xb9a77f, 0.8);
  else fx.chips(p, kind, 3);
  audio.play(`impact_${kind}`, p);
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
  audio.play(`build_${m}`);
  net?.edit({ a: 1, k, t, ix, iy, iz, o, m, rr: royale.round });
  renderMats();
}

function enterBuild(t) {
  if (!royale.alive) return;
  if (buildType === t) { exitBuild(); return; }
  buildType = t;
  scopeHeld = false;
  combat.cancelReload();
  combat.cancelHeal();
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
  if (!royale.alive) { if (!specNext(e.button === 2 ? -1 : 1)) spectatorNotice(); return; }
  if (riding) { if (e.button === 0) jumpOut(); return; }
  if (myCar) return;                                   // за рулём не стреляем
  if (abilities.drone) { if (e.button === 0) abilities.detonate(); return; }
  if (emote) { stopEmote(); return; }
  if (emotePick) toggleEmotes(false);
  const w = currentWeapon();
  if (e.button === 2 && w && canAim(w.type)) { scopeHeld = true; return; }
  if (e.button === 2 && buildType) { exitBuild(); return; }
  if (e.button !== 0) return;
  mouseDown = true;
  const now = performance.now() / 1000;
  if (buildType) { updatePlan(); placePiece(now); return; }      // план — на момент клика, не ждём кадра
  if (ENTRIES[slot].pick) { swingPickaxe(now); return; }
  if (ENTRIES[slot].med) { healTry(); return; }
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
    } else if (entry.med) {
      d.classList.add('med');
      if (!combat.meds) d.classList.add('zero');
      d.innerHTML = `<b>✚</b><small>${combat.meds}/${MED.max}</small>`;
      d.title = `Medkit — hold the slot, click to heal +${MED.heal} HP (${MED.time}s)`;
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
  combat.cancelHeal();
  if (buildType) { buildType = null; structures.ghost(null); }
  slot = (i + ENTRIES.length) % ENTRIES.length;
  renderHotbar();
  const entry = ENTRIES[slot];
  const w = currentWeapon();
  if (entry.med) { showName(`Medkit ×${combat.meds}`, '#ff5a6a'); return; }
  showName(entry.pick ? 'Pickaxe' : w ? weaponLabel(w) : 'Empty slot', w ? RARITY[w.rarity].color : '');
}

// Лечение аптечкой из слота 5 (почему не начали — подсказкой).
function healTry() {
  if (combat.healing) return;
  if (!combat.meds) toast('✚ No medkits — loot chests');
  else if (combat.hp >= 100) toast('✚ Health is full');
  else combat.startHeal();
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

// В комнате по коду могут оказаться два матча (кто-то ещё доигрывает старый, а ты начал новый): позы с чужой
// точкой отсчёта (ep) не показываем и не считаем живыми, такие игроки не годятся в хосты ботов.
const sepMatches = () => !isRankedWorld(worldId) && !isDuelWorld(worldId) && !mmMatch;
const myEp = () => Math.round(royale.epoch / 1000);
const foreign = new Set();
function upsertOther(peerId, d) {
  if (sepMatches() && d.ep !== undefined && d.ep !== myEp()) {
    foreign.add(peerId);
    const old = others.get(peerId);
    if (old && old.target?.ep !== myEp()) { scene.remove(old.group); others.delete(peerId); }
    return;
  }
  foreign.delete(peerId);
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
  o.seen = performance.now();
  o.group.visible = d.a !== false && !d.rd;     // наблюдателей и сидящих в вертолёте не видно
  // Что в руках: тип g и редкость q из pose.
  const ws = typeof d.ws === 'string' && FINISHES[d.ws] ? d.ws : null;
  const gk = d.g ? `${d.g}:${d.q}:${d.wm || ''}:${ws}` : '';
  if (o.gunKey !== gk) {
    if (o.gun) o.group.remove(o.gun);
    o.gun = null;
    o.gunKey = gk;
    if (d.g) {
      o.gun = weaponModel(d.g, d.q || 0, typeof d.wm === 'string' ? d.wm.slice(0, 4) : '', ws);
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

const KILL_ICON = { pistol: '🔫', smg: '🔫', ar: '🔫', shotgun: '💥', sniper: '🎯', bazooka: '🚀', rocket: '🚀', storm: '🌪', pickaxe: '⛏', car: '🏎' };
// В дуэли в позе ник с тикером («$BONK nick»), а в ленте убийств — просто ник.
const sameNick = (poseName, nickName) => poseName === nickName || (!!royale.duel && poseName.endsWith(` ${nickName}`));
// Где сейчас персонаж с таким ником (для эффекта убийства): ты сам или кто-то из others.
function bodyOf(name) {
  if (name === nick) return { pos: feet.clone().add(new THREE.Vector3(0, 1, 0)), self: true };
  for (const o of others.values()) if (sameNick(o.name, name)) return { pos: o.group.position.clone().add(new THREE.Vector3(0, 1, 0)), o };
  return null;
}
const hexNum = (c) => parseInt(c.slice(1), 16);
// Серия: убийства, каждое не позже STREAK_GAP после предыдущего (как мультикилл), и счёт за жизнь.
const STREAK_GAP = 9;
const STREAK = { 2: ['Double', 'kill'], 3: ['Triple', 'kill'], 4: ['Quad', 'kill'], 5: ['Rampage', '5 in a row'], 6: ['Unstoppable', ''], 8: ['Godlike', ''] };
let lastDeathW = '';
let multi = 0, multiAt = 0, lifeKills = 0, matchKills = 0, slowUntil = 0;
function onMyKill(victim) {
  const now = performance.now() / 1000;
  multi = now - multiAt < STREAK_GAP ? multi + 1 : 1;
  multiAt = now;
  lifeKills++; matchKills++;
  hitmarker('kill');
  shakeAmt = Math.max(shakeAmt, 0.06);
  // «ELIMINATED ник» с номером убийства в матче
  const e = document.createElement('div'); e.className = 'e';
  const i = document.createElement('i'); i.textContent = matchKills;
  const b = document.createElement('b'); b.textContent = victim;
  e.append(i, 'Eliminated ', b);
  $('elim').replaceChildren(e);
  // мультикилл (или веха серии за жизнь: 5, 10)
  const tier = STREAK[Math.min(multi, 8)] || (multi > 8 ? STREAK[8] : null);
  const life = lifeKills >= 5 && lifeKills % 5 === 0 && multi < 2 ? [`${lifeKills} streak`, 'kills without dying'] : null;
  const show = multi >= 2 ? tier : life;
  if (show) {
    const s = document.createElement('b'); s.textContent = show[0];
    const sp = document.createElement('span'); sp.textContent = show[1] || `${multi} kills`;
    $('streak').replaceChildren(s, sp);
    audio.play('streak', null, { at: 0.12 });
  }
  // последний соперник: короткое замедление времени (кадр «как в кино»)
  if (royale.alive && !royale.duel && royale.aliveCount() <= 2) {
    slowUntil = now + 1.3;
    $('slowmo').classList.add('on');
  }
}
function killfeed(by, victim, w) {
  if (victim === nick && playing) audio.play('death');
  else if (by === nick) audio.play('kill', null, { at: 0.05 });
  if (victim === nick) { multi = 0; lifeKills = 0; lastDeathW = w; }
  // персонаж «лопается»: вспышка, конфетти его цвета, монетки PR
  const body = playing && w !== 'storm' ? bodyOf(victim) : null;
  if (body && body.pos.distanceTo(feet) < 160) {
    const col = hexNum(colorOf(victim));
    fx.pop(body.pos, [col, 0xffffff, col, 0xffd21a]);
    audio.play('coins', body.self ? null : body.pos);
  }
  if (by === nick && victim !== nick && playing) onMyKill(victim);
  const line = document.createElement('div');
  line.className = `kill${by === nick && victim !== nick ? ' mine' : victim === nick ? ' me' : ''}`;
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
// Хитмаркер: белый — попадание, жёлтый — в голову, красный и крупнее — убийство (его не перебивает следующий хит).
let killMarkUntil = 0;
function hitmarker(kind = '') {
  const now = performance.now();
  if (kind === 'kill') killMarkUntil = now + 450;
  else if (now < killMarkUntil) return;
  const h = $('hitmark'); h.className = ''; void h.offsetWidth; h.className = `${kind} on`;
}
// Число урона над целью: синее — у цели был щит (поле sd в позе), крупное жёлтое — 50 и больше, в голову — оранжево-жёлтое с «!».
function dmgNumber(p, dmg, target, head = false) {
  if (dmg <= 0) return;
  fx.number(p, dmg, `${target?.sd ? 'sh' : 'hp'}${head ? ' head' : ''}`);
  audio.play(head ? 'hitHead' : target?.sd ? 'hitShield' : dmg >= 50 ? 'hitBig' : 'hit');
}
// Отдача камеры: прицел подбрасывает вверх и он сам возвращается (у снайперки и дробовика — сильнее, с тряской).
const PUNCH = { pistol: 0.014, smg: 0.006, ar: 0.01, shotgun: 0.038, sniper: 0.055, bazooka: 0.045, pickaxe: 0 };
let camPunch = 0;
function punch(type) {
  const v = (PUNCH[type] ?? 0.01) * (isScoped() ? 0.6 : 1);
  if (!v) return;
  const before = camera.rotation.x;
  camera.rotation.x = Math.min(Math.PI / 2 - 0.01, before + v);
  camPunch += camera.rotation.x - before;         // упёрлись в «зенит» — возвращать только то, что реально подбросило
  if (type === 'shotgun' || type === 'sniper' || type === 'bazooka') shakeAmt = Math.max(shakeAmt, 0.05);
}

// ---------- Бой, лут, раунды ----------

let shakeAmt = 0;
let swapCandidate = null;

const audio = createAudio({ camera, volume: () => settings.vol, music: () => settings.music });
const ctx = {
  scene, camera, audio,
  world: () => world,
  structures: () => structures,
  feet: () => feet,
  others,
  net: () => net,
  selfId: () => net?.selfId || 'me',
  nick: () => nick,
  toast, killfeed,
  scoped: () => isScoped(),
  mods: (type) => gunsmith.stats(type),
  moving: () => moving,
  canPlay: () => royale.alive && !royale.ended,
  inMatch: () => playing,
  sendHit: (id, d) => sendHit(id, d),
  // боты (bots.js)
  royale: () => royale, combat: () => combat, loot: () => loot,
  me: () => ({ alive: royale.alive, riding, nick, feet, prone }),
  upsert: (k, d) => upsertOther(k, d),
  removeBots, isHost, hostId,
  botCount: () => mmMatch?.bots,
  isDuel: () => isDuelWorld(worldId),
  onBotKilled: (by) => { if (by === nick && royale.alive) { season.add('kill'); abilities.earn('botkill'); loadout.earn('botkill'); } },
  blocksSight: (a, b) => abilities.blocksSight(a, b),
  route: () => sharedRoute(),
  isRanked: () => isRankedWorld(worldId),
  crouched: () => crouching || prone,
  prone: () => prone,
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
  linkWallet: (p, pubkey) => ranked.linkWallet(p, pubkey),
  walletVerified: (pubkey) => { try { return ranked.wallet === pubkey; } catch (e) { return false; } },   // ranked ещё не создан — нет
  volume: () => settings.vol,
  onInventory: () => renderStatus(),
  flash: (kind) => { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = kind === 'shield' ? 'shield' : 'on'; },
  hitmarker,
  dmgNumber: (p, dmg, id, head) => dmgNumber(p, dmg, others.get(id)?.target, head),
  impact,
  shake: (a) => { shakeAmt = Math.max(shakeAmt, a); },
  knock: (v) => { knockVel.add(v); vel.y = Math.max(vel.y, v.y + 4); onGround = false; },
  dropItems: (pos, items) => loot.drop(pos, items),
  recoil: (type) => { vm.kick(type); punch(type); },
  // события раунда: аирдропы (loot.js) и Pump-зона (events.js)
  dmgMult: () => (events.inPump(feet) ? PUMP_MULT : 1),
  dropSmoke: (p) => fx.dust(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 1, (Math.random() - 0.5) * 0.8)), 0xb08cff, 2.2),
  onDrop: (what, c) => {
    if (!playing || royale.ended) return;
    if (what === 'incoming') { banner('📦 SUPPLY DROP', 'Epic+ loot is falling — follow the purple beam', 3500); audio.play('dropIncoming'); }
    else if (what === 'landed') { audio.play('dropLand', c.pos); shakeIfNear(c.pos, 40, 0.25); for (let i = 0; i < 6; i++) fx.dust(c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.3, (Math.random() - 0.5) * 3)), 0xcbb894, 2.5); }
    else if (what === 'open') audio.play('dropOpen', c.pos);
  },
  onPump: (what) => {
    if (!playing || royale.ended || !royale.alive) return;
    if (what === 'start') { banner('📈 PUMP ZONE', `Green circle on the map — +${Math.round((PUMP_MULT - 1) * 100)}% damage inside for 35s`, 3500); audio.play('pump'); }
    else toast('📉 Pump zone is over');
  },
};
function shakeIfNear(p, r, a) { const d = p.distanceTo(feet); if (d < r) shakeAmt = Math.max(shakeAmt, a * (1 - d / r)); }
const combat = createCombat(ctx);
const loot = createLoot(ctx);
const royale = createRoyale(ctx);
const events = createEvents(ctx);
const season = createSeason(ctx);
const ranked = createRanked({ toast: (t) => pointsToast(t), onChange: () => { renderRanked(); renderSeason(); } });
let rankedMatch = false;           // этот матч — рейтинговый (через сервер матчей; RP считает сервер)

// Очки за событие: сезонные, монеты. RP в рейтинговом матче начисляет сервер ({t:'rp'} → ranked.onServer).
function award(kind) {
  season.add(kind);
  abilities.earn(kind);
  loadout.earn(kind);
}
const minimap = createMinimap({
  world: () => world, royale: () => royale, feet: () => feet,
  yaw: () => new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y,
  flight: () => flight,
  heliPos: () => (flight ? heliPos(new THREE.Vector3()) : null),
  mapMarks: () => (playing ? [...pads.list.map((p) => ({ kind: 'pad', x: p.x, z: p.z })), ...events.marks(), ...roadsters.marks(), ...loot.drops().filter((d) => d.state === 1 || d.state === 2).map((d) => ({ kind: 'drop', ...d }))] : []),
});
minimap.setWorld(world);
// руки от первого лица — в цветах скина (рукав — тело скина, кисти — его кожа)
const vm = createViewmodel(renderer, camera, (t) => gunsmith.key(t), (t) => wskins.finishOf(t),
  () => { const s = skinById(mySkin); return { sleeve: s.body ?? colorOf(nick), skin: s.skin ?? 0xffd2a8 }; });
const bots = createBots(ctx);
const loadout = createLoadout({ onChange: () => { renderLoadout(); renderGunsmith(); } });
const gunsmith = createGunsmith({ spend: (n) => loadout.spend(n), onChange: () => renderGunsmith() });
const wskins = createWeaponSkins({
  pay: (cur, n, caseId) => (cur === 'rp' ? ranked.spend(caseId) : loadout.spend(n)),
  refund: (n) => loadout.give(n),
  onChange: () => { renderCases(); makeHero(); },
});
const abilities = createAbilities({
  scene, camera, others,
  world: () => world, structures: () => structures, combat: () => combat, net: () => net, feet: () => feet,
  toast: (t) => pointsToast(t), onChange: () => renderAbilities(),
  canUse: () => playing && royale.alive && !riding,
  moveDir,
  dash: (d) => { knockVel.copy(d).multiplyScalar(36); vel.y = Math.max(vel.y, 3); onGround = false; audio.play('dash'); },
  launch: (vy) => { vel.y = vy; onGround = false; audio.play('launch'); },
  canFly: () => playing && royale.alive && !royale.ended,
  key: (code) => keys.has(code),
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
// Хост ботов — игрок с наименьшим сетевым id среди тех, у кого вкладка открыта (свёрнутая вкладка не крутит кадры —
// боты бы замерли у всех); все свернули — просто наименьший id. Оффлайн — ты.
function hostId() {
  if (!net) return 'me';
  const all = [net.selfId, ...[...peers].filter((id) => !foreign.has(id))];
  // молчит 6 с — не хост; в комнате по коду ещё не приславший позу (может быть из чужого матча) — тоже
  const fresh = (id) => { const o = others.get(id); return o ? performance.now() - (o.seen ?? 0) < 6000 : !sepMatches(); };
  const awake = all.filter((id) => (id === net.selfId ? !document.hidden : !others.get(id)?.target?.hd && fresh(id)));
  return (awake.length ? awake : all).sort()[0];
}
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
  audio.play('chest', chest.pos);
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

// Время суток раунда — от сида мира и номера раунда (у всех одинаковое): день чаще, утро и закат — по четверти.
function roundMood(r) {
  if (isDuelWorld(worldId)) return 'game';
  const x = rng(seedOf(worldId || 'x') ^ Math.imul((r | 0) + 11, 2246822519))();
  return x < 0.4 ? 'game' : x < 0.58 ? 'morning' : x < 0.74 ? 'golden' : x < 0.87 ? 'night' : 'rain';
}

function onRoundStart(r, alive) {
  if (playing) setMood(roundMood(r));
  stopCine();
  stopEmote(); toggleEmotes(false);
  structures.reset();             // дома и деревья — заново, постройки игроков исчезают
  shadowDirty = true;
  exitCar(false);
  if (world && !isDuelWorld(worldId)) roadsters.place(world, structures, r); else roadsters.clear();
  bots.roundStart(r);
  loadout.giveBack(abilities.slots);          // раунд перезапустился (дуэль, синхронизация) — заряды прошлого раунда вернуть на склад
  abilities.reset();
  if (alive) { loadout.equip(abilities.slots); renderAbilities(); }
  loot.resetRound(r, royale.roundStart);
  events.resetRound(r);
  stormWarn = -1; aliveMark = 99; $('stormwarn').className = '';
  fx.reset();
  combat.resetAll();
  for (const m of MATS) mats[m] = 0;
  buildType = null;
  goldenKeyRound = -1;
  multi = 0; lifeKills = 0; matchKills = 0;
  renderHotbar();
  if (alive && royale.duel) duelSpawn();
  else if (alive) {
    startRide(Date.now() - royale.roundStart > 20e3);
    season.roundStarted();
    const late = Date.now() - royale.roundStart > 20e3;
    audio.play('roundStart');
    banner('DROP!', late ? 'Match in progress — press SPACE to jump out, loot fast, watch the storm' : 'Press SPACE to jump out of the chopper — the storm starts closing in 90s');
  } else {
    gliding = false;
    const left = Math.ceil((ROUND_MS - (Date.now() - royale.roundStart)) / 1000);
    banner('Match in progress', `You're spectating — next drop in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · fly around as a ghost (Space up, C down)`, 5000);
  }
}

// Дуэль: стоишь на своей стороне круга лицом к сопернику (22 м от центра); в бою — готовый набор.
function duelSpawn() {
  const c = royale.center, sx = duelSide === 'a' ? -1 : 1;
  const x = c.x + sx * 22, z = c.z;
  riding = false; flight = null; heli.visible = false; gliding = false; chute = false;
  feet.set(x, structures.ground(x, z, 999) + 0.05, z);
  vel.set(0, 0, 0);
  camera.rotation.set(0, sx < 0 ? -Math.PI / 2 : Math.PI / 2, 0, 'YXZ');
  if (royale.duel === 'fight') {
    for (const it of [{ k: 'weapon', w: 'ar', r: 2 }, { k: 'weapon', w: 'shotgun', r: 2 }, { k: 'ammo', w: 'medium', a: 150 }, { k: 'ammo', w: 'shells', a: 25 }, { k: 'armor', a: 50 }]) combat.give(it);
    mats.wood = 300; mats.brick = 200; mats.metal = 100;
    renderMats(); renderHotbar();
    banner('FIGHT!', `${myTicker()} vs ${oppTicker()} · last one standing wins`, 2500);
  } else {
    banner(`🥊 ${myTicker()} vs ${oppTicker()}`, 'Waiting for your opponent — the duel starts the moment they join your link', 9000);
  }
}

// Хост, увидев соперника, объявляет старт боя; у обоих — отсчёт и бой с одной точки отсчёта.
function duelTick() {
  if (!playing || royale.duel !== 'wait' || duelGoAt || !net) return;
  const opp = [...others.keys()].some((k) => !k.startsWith('bot:'));
  if (opp && isHost()) {
    const at = Date.now() + 4000;
    net.duel({ go: at });
    duelCountdown(at);
  }
}
setInterval(duelTick, 500);          // по таймеру, а не в кадре: старт не зависит от того, свёрнута ли вкладка у хоста
function duelCountdown(at) {
  if (duelGoAt) return;
  duelGoAt = at;
  let shown = -1;
  const step = () => {
    if (!playing) return;
    const left = Math.ceil((at - Date.now()) / 1000);
    if (left > 0) {
      if (left !== shown) { shown = left; banner(String(left), `${myTicker()} vs ${oppTicker()} · get ready`, 950); audio.play('beep'); }
      setTimeout(step, 100);
      return;
    }
    audio.play('beepGo');
    royale.setDuel('fight');
    royale.init(Date.now(), at);
  };
  step();
}

function onEliminated(place, by) {
  slideT = 0; camera.rotation.z = 0;              // умер в скольжении — без наклона камеры
  stormWarn = -1; $('stormwarn').className = '';
  // килкам (если убил игрок/бот), потом — зритель за живыми
  if (playing && by && by !== 'Storm' && by !== nick) startKillcam(by, feet, lastDeathW);
  else if (playing) setTimeout(() => { if (!royale.alive && !cine) startSpectate(); }, 1500);
  gliding = false;
  buildType = null;
  structures.ghost(null);
  vel.set(0, 0, 0);
  feet.y += 3;                                    // призрак поднимается над местом гибели
  season.placed(place);
  audio.play('lose', null, { at: 1.2 });
  if (place === 2 || place === 3) loadout.earn(place === 2 ? 'top2' : 'top3');
  banner(place > 1 ? `#${place}` : 'Eliminated', by === 'Storm' ? 'Caught in the storm · spectating until next drop' : by === nick ? 'You blew yourself up' : `Eliminated by ${by} · spectating until next drop`, 5000);
}

function onWinner(name, me) {
  stormWarn = -1; $('stormwarn').className = '';
  if (me) { award('win'); audio.play('victory'); startWinCam(); }
  if (royale.duel) {
    const w = me ? myTicker() : oppTicker(), l = me ? oppTicker() : myTicker();
    banner(`🏆 ${w} WINS`, `${w} beat ${l} 1v1`, 6000);
    say('🥊', ` ${w} beat ${l}`);
    return;
  }
  banner(me ? '🏆 VICTORY ROYALE' : `🏆 ${name} wins`, me ? 'Last one standing!' : 'Last one standing', 6000);
  say('🏆', ` ${name} won the round`);
}

// Конец раунда (досрочно — последний живой, или по таймеру — все, кто дожил): итоги и возврат в лобби.
const LOBBY_DELAY = 7;
function onRoundEnd({ me, winners, early }) {
  loadout.giveBack(abilities.slots);
  if (!early) {
    const others = winners.filter((n) => n !== nick);
    if (me) startWinCam();
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
      if (royale.duel) {
        q.set('s', duelSide);
        q.set('dr', winners.length !== 1 ? 'draw' : me ? `${myTicker()}>${oppTicker()}` : `${oppTicker()}>${myTicker()}`);
      }
      location.href = `${location.pathname}?${q}`;
      return;
    }
    setTimeout(tick, 1000);
  };
  tick();
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
let lastStorm = '', stormWarn = -1, aliveMark = 99;
function stormHud({ t, storm, alive, outside, spectating, drop, duel }) {
  const left = storm.left;
  if (duel === 'wait') { const txt = `🥊 ${myTicker()} vs ${oppTicker()} · waiting for opponent…`; if (txt !== lastStorm) { $('storm').textContent = txt; lastStorm = txt; } return; }
  const what = storm.idx === 0 ? 'Storm in' : storm.moving && storm.final ? 'Final circle moving · round ends in' : storm.moving ? 'Storm closing · zone moving' : storm.final ? 'Final circle · round ends in' : storm.shrinking ? 'Storm closing' : 'Storm shrinks in';
  // предупреждение: за 10 с до сжатия — сирена и отсчёт по центру, последние 3 — с писком
  if (playing && alive && !duel && !spectating && storm.warn <= 10) {
    const n = Math.ceil(storm.warn);
    if (n !== stormWarn) {
      stormWarn = n;
      $('stormwarn').innerHTML = `<b>⚠ Storm shrinking in ${n}</b>`;
      $('stormwarn').className = 'on';
      if (n === 10) audio.play('siren');
      else if (n <= 3) audio.play('beep');
    }
  } else if (stormWarn >= 0 && stormWarn <= 1) {
    stormWarn = -1;
    $('stormwarn').innerHTML = '<b>🌪 The storm is closing!</b>';
    $('stormwarn').className = 'on go';
    setTimeout(() => { $('stormwarn').className = ''; }, 2200);
  } else if (stormWarn > 1 && storm.warn > 10) { stormWarn = -1; $('stormwarn').className = ''; }
  // вехи: осталось 10 / 5 / 3 (если ты ещё жив)
  if (playing && !spectating && !duel && !drop && t / 1000 > 40) {
    for (const m of [10, 5, 3]) if (alive <= m && aliveMark > m) { aliveMark = m; if (alive > 1) { $('streak').replaceChildren(Object.assign(document.createElement('b'), { textContent: `Top ${m}` }), Object.assign(document.createElement('span'), { textContent: `${alive} players left` })); audio.play('beepGo'); } }
  }
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
  note.textContent = 'Points have no cash value yet — the $PR token launch is in the works and player rewards are coming. Keep playing and stacking RP. Holders get cosmetics + a golden key (+1 rarity on one chest per match).';
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
  else if (d.x) {
    const res = structures.damage(d.k, d.x);
    if (res?.destroyed) onDestroyed(res.e);
    if (d.cb && res?.destroyed) carBoom(res.e, false);
  }
}

let startNet = function () {
  try {
    const H = {
      join(peerId) {
        peers.add(peerId);
        if (sepMatches()) net.match({ e: royale.epoch, ...(royale.ended ? { x: 1 } : {}) }, peerId);
        net.sync({ s: structures.syncList(), rr: royale.round }, peerId);
        net.pose(poseData(), peerId);
        loot.syncTo(peerId);
        updateCount();
      },
      leave(peerId) {
        peers.delete(peerId);
        foreign.delete(peerId);
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
      match(peerId, d) { if (sepMatches() && !d.x && !royale.ended && royale.adoptEpoch(d.e)) { foreign.clear(); toast('Synced with the match in progress'); } },
      duel(peerId, d) { if (d && d.go > 0 && royale.duel === 'wait') duelCountdown(Math.min(d.go, Date.now() + 6000)); },
      chest(peerId, d) { loot.onChest(peerId, d); },
      loot(peerId, d) { loot.onLoot(peerId, d); },
      take(peerId, d) { loot.onTake(peerId, d); },
      closed() { toast('Lost connection to the match server'); },
    };
    // Комната по коду: игровые сообщения помечены точкой отсчёта матча (ep) — из чужого матча (кто-то доигрывает старый)
    // не принимаем: его победа, сундуки, лут, постройки и убийства не попадают в твой матч.
    const TAGGED = ['shot', 'hit', 'dead', 'chest', 'loot', 'take', 'win', 'bots', 'bothit', 'abil', 'edit', 'sync'];
    for (const a of TAGGED) {
      const h = H[a];
      if (h) H[a] = (peerId, d) => { if (sepMatches() && d && d.ep !== undefined && d.ep !== myEp()) return; h(peerId, d); };
    }
    net = (mmMatch ? mmMatch.connect : (h) => connect(worldId, h))(H);
    if (sepMatches()) for (const a of TAGGED) {
      const send = net[a];
      if (send) net[a] = (d, to) => send(d && typeof d === 'object' && !Array.isArray(d) ? { ...d, ep: myEp() } : d, to);
    }
    updateCount();
  } catch (e) {
    console.warn(`[${NAME}] P2P недоступен:`, e);
    net = null;
    updateCount();
  }
};

function poseData() {
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  const d = { x: +feet.x.toFixed(2), y: +feet.y.toFixed(2), z: +feet.z.toFixed(2), r: +yaw.toFixed(2), n: royale.duel ? `${myTicker()} ${nick}`.slice(0, 28) : nick, a: royale.alive, rr: royale.round, ep: myEp() };
  const w = holding();
  if (w) { d.g = w.type; d.q = w.rarity; const mk = gunsmith.key(w.type); if (mk) d.wm = mk; const fin = wskins.finishOf(w.type); if (fin) d.ws = fin; }
  if (season.tier >= 0) d.h = season.tier;
  if (mySkin !== 'default') d.k = mySkin;
  if (riding) d.rd = 1;
  if (document.hidden) d.hd = 1;          // вкладка свёрнута — не годимся в хосты ботов
  if (prone) d.pr = 1; else if (crouching) d.cr = 1;
  if (myCar) { const c = myCar; d.cv = [+c.pos.x.toFixed(2), +c.pos.y.toFixed(2), +c.pos.z.toFixed(2), +c.yaw.toFixed(3), +c.pitch.toFixed(3), +c.roll.toFixed(3), c.id, +c.thrust.toFixed(2), +c.boost.toFixed(2), +c.fold.toFixed(2), +c.jet.toFixed(2)]; delete d.cr; delete d.pr; }
  if (combat.shield > 0) d.sd = 1;           // у цели щит — числа урона у стрелка синие
  if (combat.healing) d.hl = 1;              // лечится — другим видна поза и зелёные искры
  if (combat.reloading) d.rl = 1;            // перезаряжается — оружие опущено
  if (emote) d.em = emote.id;
  if (myChute() !== 'classic') d.ch = myChute();
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
document.addEventListener('visibilitychange', () => { if (net && world) net.pose(poseData()); });

// ---------- Клавиши и пауза ----------

addEventListener('keydown', (e) => {
  if (document.activeElement?.tagName === 'INPUT') return;
  if (buyOpen && (e.code === 'KeyB' || e.code === 'Escape')) { e.preventDefault(); closeBuy(); return; }
  if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();     // не уводить фокус в меню браузера
  keys.add(e.code);
  if (!playing || !controls.isLocked) return;
  if (e.code === 'KeyT') { e.preventDefault(); openChat(); }
  if (riding) { if (e.code === 'Space') jumpOut(); return; }
  if (myCar) {                                         // за рулём: E — выйти, M — карта, остальное — управление машиной
    if (e.code === 'KeyE') exitCar(true);
    if (e.code === 'KeyM') minimap.toggle();
    return;
  }
  // P — лечь / встать; Space лёжа — встать (а не прыжок). Встать нельзя, если над тобой постройка.
  if ((e.code === 'KeyP' || (prone && e.code === 'Space')) && playing && royale.alive && !gliding) {
    if (prone) { if (!structures.blocked(feet.x, feet.y, feet.z, CROUCH_H, HALF)) { prone = false; keys.delete('Space'); } }
    else if (onGround) { prone = true; crouching = false; }
    return;
  }
  if (e.code === 'KeyM' && playing) { minimap.toggle(); return; }
  if (e.code === 'KeyJ') { toggleEmotes(); return; }
  if (emotePick) {
    const k = e.code.match(/^Digit([1-4])$/);
    if (k) { startEmote(EMOTES[+k[1] - 1].id); return; }
  }
  if (emote && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyZ', 'KeyX', 'KeyC', 'KeyE', 'KeyR', 'KeyP', 'KeyF', 'KeyQ', 'AltLeft', 'AltRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) stopEmote();
  if (gliding && !chute && e.code === 'Space') openChute();
  else if (e.code === 'Space' && canRedeploy()) { gliding = true; chute = false; openChute(); }
  if (e.code === 'KeyB') { openBuy(); return; }
  if (!royale.alive && playing && e.code === 'KeyV') { if (cine) stopCine(); else if (!startSpectate()) spectatorNotice(); return; }
  if (!royale.alive && ['KeyE', 'KeyZ', 'KeyX', 'KeyC', 'KeyQ', 'KeyG'].includes(e.code)) spectatorNotice();
  if (e.code === 'KeyE' && royale.alive) {
    const chest = loot.chestNear(eye(), look());
    const car = !chest && !riding && !gliding ? roadsters.near(feet) : null;
    if (chest) openChest(chest);
    else if (car) enterCar(car);
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
  const n = e.code.match(/^Digit([1-5])$/);
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
  pads.load(world, structures);
  grass.setMap(world);
  try { minimap.setWorld(world); } catch (e) { /* миникарта ещё не создана — подложку сделает при создании */ }
  water.setHeights(world.heightTexture(), MAP);
  shadowDirty = true;
}

function start() {
  if (playing) return;
  nick = ($('nick').value.trim() || nick).slice(0, 16);
  localStorage.setItem('pc:nick', nick);
  worldId = lobbyId();
  rankedMatch = isRankedWorld(worldId) && !!mmMatch;
  duelSide = isDuelWorld(worldId) && worldId === linkDuel && params.get('s') === 'b' ? 'b' : 'a';
  duelGoAt = 0;
  history.replaceState(null, '', `?w=${worldId}${isDuelWorld(worldId) ? `&s=${duelSide}` : ''}`);
  $('status').textContent = 'Generating the island…';
  $('go').disabled = true;
  setTimeout(() => {
    loadWorld(worldId);
    if (hero) { scene.remove(hero); hero = null; }
    lobbyScene.visible = false;
    setMood(roundMood(royale.round));
    playing = true;
    camera.rotation.set(0, 0, 0, 'YXZ');
    spawn(false);
    // Casual — матч с нуля: раунд начинается сейчас (друзья по ссылке подстроятся под самый ранний старт);
    // Ranked — общие часы (у всех рейтинговых игроков один раунд на острове дня).
    if (isDuelWorld(worldId)) { royale.setDuel('wait'); royale.init(Date.now(), Date.now() - 500); }
    else if (mmMatch) {
      // Online: игроки матча известны сразу — хост ботов определён до старта раунда; ботов столько, сколько дал сервер
      royale.setDuel(null);
      for (const id of mmMatch.ids) if (id !== mmMatch.self) peers.add(id);
      startNet();
      royale.init(Date.now(), Math.min(mmMatch.epoch, Date.now()));
    }
    else { royale.setDuel(null); royale.init(Date.now(), rankedMatch || isRankedWorld(worldId) ? 0 : Date.now() - 500); }
    pick(0);
    $('wname').textContent = rankedMatch ? `🏆 Ranked · ${mmMatch.ids.length + mmMatch.bots} players` : mmMatch ? `🌐 Online · ${mmMatch.ids.length + mmMatch.bots} players` : rankedMatch ? `🏆 Ranked · ${worldId.slice(7)}` : isDuelWorld(worldId) ? `🥊 ${myTicker()} vs ${oppTicker()}` : `🌍 ${worldId}`;
    $('lobby').hidden = true;
    for (const id of ['top', 'hotbar', 'hint', 'bars', 'ammo', 'storm', 'mats', 'abil', 'credits']) $(id).hidden = false;
    renderAbilities();
    renderSeason();
    $('pause').hidden = controls.isLocked;          // мышь захвачена кликом по PLAY — сразу в игру, без паузы
    $('cross').hidden = !controls.isLocked;
    document.title = `${worldId} — ${NAME}`;
    if (!net) startNet();
  }, 20);
}
// PLAY: вспышка и «вылет» из лобби, затем матч.
$('go').addEventListener('click', () => {
  if (playing || $('go').disabled) return;
  // Online: Play — встать в очередь, ещё раз — отменить поиск; матч найден — старт (findMatch → go)
  if (gameMode === 'casual' && mode === 'online' && !mmMatch) { if (mmSearch) stopSearch('Search cancelled'); else beginSearch(); return; }
  if (gameMode === 'ranked' && !mmMatch) {
    if (mmSearch) { stopSearch('Search cancelled'); return; }
    if (!ranked.hasAccess()) {
      $('rk-msg').className = 'sub err';
      $('rk-msg').textContent = 'Unlock Ranked first: post on X and paste the link';
      $('rk-url').focus();
      return;
    }
    beginSearch(true);            // Ranked — только через сервер матчей: он и считает RP
    return;
  }
  $('go').disabled = true;
  // захват мыши — прямо в обработчике клика (нужен жест пользователя); не дали — после старта откроется пауза
  try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch (e) { /* без захвата */ }
  $('flashout').classList.add('on');
  $('lobby').classList.add('leaving');
  setTimeout(start, 480);
});

$('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('go').click(); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('go').click(); });

// ---------- Online: поиск матча ----------
// Очередь на сервере: сразу 13 ботов, дальше по одному каждые 3 с до полного лобби (живые занимают их места).
// В интерфейсе онлайна ботов не упоминаем — показываем общее число игроков. Сервер недоступен — предлагаем Private.
const setGoLabel = (t) => { $('go').lastChild.textContent = t; };
function beginSearch(rk = false) {
  nick = ($('nick').value.trim() || nick).slice(0, 16);
  localStorage.setItem('pc:nick', nick);
  $('go').classList.add('searching');
  setGoLabel('Cancel');
  $('status').classList.remove('result');
  $('status').textContent = '🔎 Connecting to the match server…';
  mmSearch = findMatch(nick, {
    status(s) {
      const filled = s.h + s.b;
      $('tring').style.strokeDashoffset = (125.66 * (1 - filled / s.cap)).toFixed(1);
      $('roundinfo').innerHTML = `<b class="live">● Searching ${mmss(s.s)}</b>👥 ${filled}/${s.cap} players`;
      $('status').textContent = filled < s.cap ? '🔎 Finding players…' : '✓ Lobby full — starting';
    },
    rp: (m) => ranked.onServer(m),
    go(m) {
      mmSearch = null;
      mmMatch = m;
      if (m.nick) nick = m.nick;                   // рейтинг: ник, под которым тебя знает сервер (уникальный в матче)
      $('go').classList.remove('searching');
      setGoLabel('Play');
      $('status').textContent = `✓ Match found — ${m.ids.length + m.bots} players`;
      document.title = `Match found — ${NAME}`;
      $('go').disabled = true;
      $('flashout').classList.add('on');
      $('lobby').classList.add('leaving');
      setTimeout(start, 480);
    },
    fail(why) {
      mmSearch = null;
      $('go').classList.remove('searching');
      setGoLabel('Play');
      if (rk) {
        if (why === 'access') ranked.load();
        $('status').textContent = why === 'access' ? '⚠ Ranked access is gone (post deleted or expired) — post again to unlock'
          : why === 'busy' ? '⚠ You are already in a Ranked match in another tab'
          : why === 'auth' ? '⚠ Session expired — reload the page'
          : '⚠ Ranked servers are unavailable right now — try again in a minute';
        updateRoundInfo();
        return;
      }
      if (why === 'offline') setMode('new');      // сервер недоступен — следующий Play сразу запустит матч с ботами
      $('status').textContent = why === 'offline' ? '⚠ Online servers are unavailable right now — switched to Private: hit Play to fight bots' : '⚠ Lost connection to the match server — hit Play to search again';
      updateRoundInfo();
    },
  }, rk ? { ranked: true, tok: ranked.tok } : {});
}
function stopSearch(msg) {
  if (!mmSearch) return;
  mmSearch.cancel();
  mmSearch = null;
  $('go').classList.remove('searching');
  setGoLabel('Play');
  $('status').textContent = msg || '';
  updateRoundInfo();
}

// ---------- Лобби ----------
// Фон — живой остров матча (камера облетает), по центру — твой персонаж с киркой. Вкладки: игра, сезон, правила, настройки.

const lobbyNewId = randId();
let mode = worldId && !isOnlineWorld(worldId) ? 'join' : 'online';
const cleanCode = (v) => v.trim().toLowerCase().replace(/^.*[?&]w=/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 24);
let gameMode = isRankedWorld(worldId) ? 'ranked' : isDuelWorld(worldId) ? 'duel' : 'casual';
// Дуэль: тикеры из полей; те же, что в ссылке-вызове, — тот же мир, иначе новый вызов.
function duelId() {
  const a = cleanTicker($('du-a').value) || 'pepe', b = cleanTicker($('du-b').value) || 'doge';
  if (linkDuel) { const t = duelTickers(linkDuel); if (t.a === `$${a.toUpperCase()}` && t.b === `$${b.toUpperCase()}`) return linkDuel; }
  return `duel-${a}-${b}-${lobbyNewId.slice(0, 6).replace(/[^a-z0-9]/g, 'x')}`;
}
const lobbyId = () => (mmMatch ? mmMatch.w : gameMode === 'ranked' ? rankedWorld() : gameMode === 'duel' ? duelId() : mode === 'join' ? cleanCode($('code').value) || lobbyNewId : lobbyNewId);
// Итог прошлого раунда (возврат из матча): ?r=win|end&ws=имена.
if (params.get('dr')) {
  const dr = params.get('dr'), [w, l] = dr.split('>');
  $('status').innerHTML = dr === 'draw' ? '🥊 Duel ended in a draw — both survived the storm' : `🥊 <b>${(w || '').replace(/[^$A-Z0-9]/g, '')}</b> beat <b>${(l || '').replace(/[^$A-Z0-9]/g, '')}</b> 1v1 — hit Play for a rematch`;
  $('status').classList.add('result');
  history.replaceState(null, '', `?w=${params.get('w')}&s=${params.get('s') === 'b' ? 'b' : 'a'}`);
} else if (params.get('r')) {
  const ws = (params.get('ws') || '').split(',').filter(Boolean);
  $('status').textContent = params.get('r') === 'win' ? '🏆 Victory Royale — you won the last round!' : ws.length ? `Last round: 🏆 ${ws.join(', ')}` : 'Last round: no survivors';
  $('status').classList.add('result');
  history.replaceState(null, '', `?w=${params.get('w')}`);
}
if (isDuelWorld(worldId)) {
  if (!params.get('dr')) $('status').textContent = params.get('s') === 'b' ? `🥊 You've been challenged: ${duelTickers(worldId).b} vs ${duelTickers(worldId).a} — hit Play` : `🥊 Your duel ${duelTickers(worldId).a} vs ${duelTickers(worldId).b} — hit Play`;
} else if (worldId && !isRankedWorld(worldId) && !isOnlineWorld(worldId)) {
  $('code').value = worldId;
  $('status').textContent = `Invited to match “${worldId}” — hit Play to drop in with everyone on the link`;
}

function setMode(m) {
  if (m !== mode) stopSearch();
  mode = m;
  $('m-online').classList.toggle('on', m === 'online');
  $('seg').classList.toggle('priv', m === 'new');
  $('m-new').classList.toggle('on', m === 'new');
  $('m-join').classList.toggle('on', m === 'join');
  $('seg').classList.toggle('join', m === 'join');
  $('code').hidden = m !== 'join';
  if (m === 'join') $('code').focus();
  $('copyinv').parentElement.hidden = gameMode === 'ranked' || (gameMode === 'casual' && m === 'online');
  previewSoon();
  updateRoundInfo();
}
$('m-online').addEventListener('click', () => setMode('online'));
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
    $('lobby').classList.toggle('paneled', !['play', 'locker', 'shop', 'abilities', 'gunsmith', 'cases'].includes(b.dataset.tab));
    $('lobby').classList.toggle('lockered', ['locker', 'shop', 'abilities', 'gunsmith', 'cases'].includes(b.dataset.tab));
    if (b.dataset.tab === 'locker') renderLocker();
    if (b.dataset.tab === 'shop') renderShop();
    if (b.dataset.tab === 'abilities') renderLoadout();
    if (b.dataset.tab === 'gunsmith') renderGunsmith();
    if (b.dataset.tab === 'cases') renderCases();
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
  const pk = weaponModel('pickaxe', 0, '', wskins.finishOf('pickaxe'));
  pk.rotation.x = 1.15;                                  // кирка в правой руке, навершие вверх-вперёд
  hero.userData.rig.grip.add(pk);
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
  game: { top: 0x2f8fff, bottom: 0xbfe9ff, sun: 0xfff0d8, sunI: 1.9, sky: 0xd8efff, ground: 0x7a6a48, hemiI: 1.25, dir: [-0.45, 1, 0.35], near: 140, far: 420, rim: 0xfff2d8 },
  // время суток раунда (roundMood): утро — низкое тёплое солнце с востока, закат — золотой свет и длинные тени
  morning: { top: 0x5f9cff, bottom: 0xffe4c8, sun: 0xffe2bc, sunI: 1.75, sky: 0xe6eeff, ground: 0x7a6a58, hemiI: 1.15, dir: [0.75, 0.5, -0.35], near: 130, far: 400, rim: 0xffe8cc },
  golden: { top: 0x4656d0, bottom: 0xffb47e, sun: 0xffa95e, sunI: 2.05, sky: 0xffd6b4, ground: 0x6a4a3a, hemiI: 1.0, dir: [-0.8, 0.32, 0.45], near: 120, far: 380, rim: 0xffb070 },
  // ночь: лунный голубой свет, тёмно-синее небо — неоновые лучи лута, аирдропов и батутов видно издалека
  night: { top: 0x070d33, bottom: 0x27346e, sun: 0x9fb2ff, sunI: 1.0, sky: 0x5b6cc0, ground: 0x1c2036, hemiI: 0.95, dir: [0.35, 0.85, -0.4], near: 80, far: 300, rim: 0x9fb4ff },
  // дождь: серое небо, близкий туман, мягкий свет; струи и гроза — weather.js
  rain: { top: 0x56607a, bottom: 0x99a3b3, sun: 0xd8dde6, sunI: 0.95, sky: 0xbac3d2, ground: 0x4a4f58, hemiI: 1.15, dir: [-0.3, 1, 0.25], near: 55, far: 230, rim: 0xd0d8e8 },
  lobby: { top: 0x3b2a9e, bottom: 0xffb08a, sun: 0xffc08a, sunI: 2.2, sky: 0xcdbbff, ground: 0x8a5a48, hemiI: 1.15, dir: [0.55, 0.42, -0.72], near: 180, far: 950 },
};
// Звёзды (ночь): точки на большой сфере вокруг камеры, едут вместе с небом.
const stars = (() => {
  const n = 900, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    p.set([Math.cos(a) * r * 700, Math.abs(u) * 700 + 40, Math.sin(a) * r * 700], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.visible = false; pts.frustumCulled = false; pts.renderOrder = -1;
  scene.add(pts);
  return pts;
})();
const rimLight = new THREE.PointLight(0xff9a5a, 40, 14, 1.6);      // тёплый контур сзади
const fillLight = new THREE.PointLight(0x8b6bff, 18, 12, 1.6);     // фиолетовая подсветка спереди-слева
scene.add(rimLight, fillLight);
// Атмосфера лобби одна для всех скинов (небо, солнце, туман, подсветка героя — как у Default);
// цвета плавно перетекают (moodTarget → moodNow в lobbyFrame).
const MOOD_COLORS = ['top', 'bottom', 'sun', 'sky', 'rim', 'fill'];
let moodTarget = null;
const moodNow = {};
function skinMood() {
  return { ...MOODS.lobby, ...SKIN_MOODS.default };
}
function applyColors(c) {
  sky.material.uniforms.top.value.copy(c.top);
  sky.material.uniforms.bottom.value.copy(c.bottom);
  scene.fog.color.copy(c.bottom);
  scene.background.copy(c.bottom);
  sun.color.copy(c.sun);
  hemi.color.copy(c.sky);
  hemi.groundColor.copy(c.bottom).multiplyScalar(0.45);
  rimLight.color.copy(c.rim);
  fillLight.color.copy(c.fill);
  // градиент и виньетка интерфейса лобби — в тон небу
  const rgb = (col, k) => [col.r, col.g, col.b].map((v) => Math.round(Math.min(1, v * k) * 255)).join(',');
  const lb = document.getElementById('lobby').style;
  lb.setProperty('--gtop', rgb(c.top, 0.8));
  lb.setProperty('--gbot', rgb(V_COL2.copy(c.top).lerp(c.fill, 0.35), 0.75));
  lb.setProperty('--gvig', rgb(c.top, 0.3));
}
const V_COL2 = new THREE.Color();
function stepMood(dt) {
  if (!moodTarget) return;
  const k = Math.min(1, dt * 2.5);
  for (const key of MOOD_COLORS) moodNow[key].lerp(V_COL.set(moodTarget[key]), k);
  applyColors(moodNow);
}
const V_COL = new THREE.Color();
function setMood(name) {
  if (name === 'lobby') {
    moodTarget = skinMood();
    if (!moodNow.top) for (const key of MOOD_COLORS) moodNow[key] = new THREE.Color(moodTarget[key]);
  } else moodTarget = null;
  const m = name === 'lobby' ? moodTarget : MOODS[name];
  sky.material.uniforms.top.value.set(m.top);
  sky.material.uniforms.bottom.value.set(m.bottom);
  scene.fog.color.set(m.bottom);
  scene.fog.near = m.near; scene.fog.far = m.far;
  scene.background.set(m.bottom);
  sun.color.set(m.sun); sun.intensity = m.sunI;
  hemi.color.set(m.sky); hemi.groundColor.set(m.ground); hemi.intensity = m.hemiI;
  SUN_DIR.set(...m.dir).normalize();
  rimUniform.color.value.set(m.rim ?? 0xfff2d8);
  rays.mat.uniforms.uTint.value.set(m.sun).lerp(new THREE.Color(1, 1, 1), 0.35);
  rimLight.visible = fillLight.visible = name === 'lobby';
  weather.set(name === 'rain' ? 'rain' : 'clear');
  stars.visible = name === 'night';
  if (name === 'lobby') applyColors(moodNow);
}

const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
// Звуки интерфейса лобби: наведение и нажатие на кнопки, вкладки, карточки.
const UI_SEL = 'button, [data-tab], .skin, .gsmod, .slot';
let uiHover = null;
addEventListener('click', (e) => { if (!controls.isLocked && e.target.closest?.(UI_SEL)) audio.play('uiClick'); }, true);
addEventListener('pointerover', (e) => {
  const b = !controls.isLocked && e.target.closest?.(UI_SEL);
  if (b && b !== uiHover) audio.play('uiHover');
  uiHover = b || null;
}, true);
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
  stepMood(dt);
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
  renderChutes();
}

// Парашюты в Locker: покупка за монеты 🪙 один раз, затем — выбрать.
function renderChutes() {
  $('lchutes').innerHTML = '';
  for (const c of CHUTES) {
    const own = chuteSt.owned.includes(c.id);
    const b = document.createElement('button');
    b.className = `skin chute r${Math.min(4, Math.round(c.price / 100))}${c.id === myChute() ? ' on' : ''}`;
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
    b.style.setProperty('--sc', hex(c.a));
    b.innerHTML = `<i class="cdome" style="--ca:${hex(c.a)};--cb:${hex(c.b)}"></i><b>${c.name}</b><small>${own ? (c.id === myChute() ? 'Equipped' : 'Owned') : `🪙 ${c.price}`}</small>`;
    b.addEventListener('click', () => {
      if (!own) {
        if (!loadout.spend(c.price)) { $('lockerhint').textContent = `Need 🪙 ${c.price} — coins drop in every match`; return; }
        chuteSt.owned.push(c.id);
        $('lockerhint').textContent = `Unlocked parachute: ${c.name}`;
      } else $('lockerhint').textContent = `Parachute equipped: ${c.name}`;
      chuteSt.on = c.id;
      saveChutes();
      renderChutes();
    });
    $('lchutes').appendChild(b);
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

// Вкладка Gunsmith: по оружию — карточки обвесов; купил — навсегда стоит на этом оружии.
const GUN_ICON = { ar: '🔫', smg: '💨', shotgun: '💥', pistol: '🔹', sniper: '🎯' };
function renderGunsmith() {
  if (!$('gslist')) return;
  $('gscoins').textContent = loadout.coins.toLocaleString('en');
  $('gslist').innerHTML = '';
  for (const gun of GUN_ORDER) {
    const row = document.createElement('div');
    row.className = 'gsrow';
    row.innerHTML = `<div class="gsgun"><i>${GUN_ICON[gun]}</i><b>${WEAPONS[gun].name}</b></div>`;
    for (const id of Object.keys(GUN_MODS[gun])) {
      const mi = modInfo(gun, id), own = gunsmith.has(gun, id);
      const c = document.createElement('button');
      c.className = `gsmod${own ? ' own' : loadout.coins < mi.price ? ' cant' : ''}`;
      c.innerHTML = `<i>${mi.icon}</i><b>${mi.name}</b><small>${mi.desc}</small><em>${own ? '✓ Equipped' : `🪙${mi.price}`}</em>`;
      c.addEventListener('click', () => {
        if (own) return;
        $('gshint').textContent = gunsmith.buy(gun, id) ? `✓ ${mi.name} is now on your ${WEAPONS[gun].name}` : `Need ${mi.price - loadout.coins} more 🪙 — earn coins in any match`;
      });
      row.appendChild(c);
    }
    $('gslist').appendChild(row);
  }
}

// ---------- Кейсы и инвентарь скинов на оружие ----------

let casesView = 'cases', invGun = 'all', opening = false;
const RCOL = (r) => WS_RARITY[r].color;
// Карточка скина: иконка-полоса цвета раскраски, имя, редкость.
function skinCard(id, extra = '') {
  const s = skinInfo(id), f = s.f;
  const sw = `linear-gradient(135deg, #${f.a.toString(16).padStart(6, '0')} 0 55%, #${f.b.toString(16).padStart(6, '0')} 55%)`;
  return `<div class="wsc${extra}" style="--rc:${RCOL(s.rarity)}"><span class="sw" style="background:${sw}"></span><b>${FINISHES[s.fin].name}</b><small>${GUN_NAME[s.gun]} · ${WS_RARITY[s.rarity].name}</small></div>`;
}

function renderCases() {
  if (!$('cslist') || opening) return;
  $('cscoins').textContent = loadout.coins.toLocaleString('en');
  $('csrp').textContent = ranked.rp.toLocaleString('en');
  for (const b of document.querySelectorAll('#csseg button')) b.classList.toggle('on', b.dataset.v === casesView);
  $('cslist').hidden = casesView !== 'cases';
  $('csinv').hidden = casesView !== 'inv';
  if (casesView === 'cases') {
    $('cslist').innerHTML = '';
    for (const [cid, c] of Object.entries(CASES)) {
      const have = c.cur === 'rp' ? ranked.rp : loadout.coins;
      const el = document.createElement('div');
      el.className = `case ${cid}`;
      el.style.setProperty('--cc', c.color);
      const odds = c.odds.map((p, r) => (p ? `<span style="color:${RCOL(r)}">${WS_RARITY[r].name} ${Math.round(p * 100)}%</span>` : '')).join('');
      el.innerHTML = `<div class="cbox"><i>${c.icon}</i></div><b>${c.name}</b><div class="odds">${odds}</div>
        <button class="cbuy${have < c.price ? ' cant' : ''}">Open · ${c.cur === 'rp' ? `${c.price} RP` : `🪙${c.price}`}</button>`;
      el.querySelector('button').addEventListener('click', () => openCase(cid));
      $('cslist').appendChild(el);
    }
  } else {
    $('invgun').innerHTML = ['all', ...WS_GUNS].map((g) => `<button data-g="${g}" class="${invGun === g ? 'on' : ''}">${g === 'all' ? 'All' : GUN_NAME[g]}</button>`).join('');
    for (const b of $('invgun').querySelectorAll('button')) b.addEventListener('click', () => { invGun = b.dataset.g; renderCases(); });
    const ids = wskins.owned().filter((id) => invGun === 'all' || skinInfo(id).gun === invGun)
      .sort((p, q) => skinInfo(q).rarity - skinInfo(p).rarity || p.localeCompare(q));
    $('invgrid').innerHTML = ids.length ? '' : '<p class="empty">No skins yet — open a case.</p>';
    for (const id of ids) {
      const s = skinInfo(id), on = wskins.equipped(s.gun) === id;
      const d = document.createElement('button');
      d.className = 'invb';
      d.innerHTML = skinCard(id, on ? ' on' : '') + (wskins.count(id) > 1 ? `<em class="cnt">×${wskins.count(id)}</em>` : '') + (on ? '<em class="eq">Equipped</em>' : '');
      d.addEventListener('click', () => { wskins.equip(id); $('cshint').textContent = wskins.equipped(s.gun) === id ? `✓ ${s.name} equipped` : `${s.name} removed`; });
      $('invgrid').appendChild(d);
    }
    $('invcount').textContent = `${wskins.owned().length}/${ALL_SKINS.length}`;
  }
}
for (const b of document.querySelectorAll('#csseg button')) b.addEventListener('click', () => { casesView = b.dataset.v; renderCases(); });

// Открытие: лента карточек прокручивается и тормозит на выпавшем скине (как в CS).
async function openCase(cid) {
  if (opening) return;
  const c = CASES[cid];
  opening = true;
  const res = await wskins.open(cid);
  opening = false;
  if (!res) { $('cshint').textContent = c.cur === 'rp' ? `Need ${c.price - ranked.rp} more RP — play Ranked` : `Need ${c.price - loadout.coins} more 🪙 — coins drop in every match`; return; }
  opening = true;
  const WIN = 34, N = 40;
  const strip = Array(N).fill(res.id);
  // наполнитель — по шансам этого кейса
  for (let i = 0; i < N; i++) if (i !== WIN) { const r = Math.random(); const rar = r < c.odds[0] ? 0 : r < c.odds[0] + c.odds[1] ? 1 : r < 1 - c.odds[3] ? 2 : 3; const pool = ALL_SKINS.filter((id) => skinInfo(id).rarity === rar); strip[i] = pool[Math.floor(Math.random() * pool.length)]; }
  $('csopen').hidden = false;
  $('csres').hidden = true;
  const tr = $('cstrack');
  tr.style.transition = 'none';
  tr.style.transform = 'translateX(0)';
  tr.innerHTML = strip.map((id) => skinCard(id)).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const cw = 132, view = $('csroll').clientWidth;
    const x = WIN * cw + cw / 2 - view / 2 + (Math.random() - 0.5) * cw * 0.6;
    tr.style.transition = 'transform 5.2s cubic-bezier(.12,.75,.12,1)';
    tr.style.transform = `translateX(${-x}px)`;
  }));
  for (let t = 0, d = 0.045; t < 5; t += d, d *= 1.075) audio.play('caseTick', null, { at: t, vol: 1 - t / 7 });
  setTimeout(() => {
    const s = skinInfo(res.id);
    $('csres').hidden = false;
    $('csres').innerHTML = `${skinCard(res.id, ' big')}<p>${res.dup ? `Duplicate — +🪙${res.refund}` : `New skin for your ${GUN_NAME[s.gun]}!`}</p>
      <div class="rbtn"><button id="cseq">Equip</button><button id="csok">OK</button></div>`;
    $('cseq').addEventListener('click', () => { if (wskins.equipped(s.gun) !== res.id) wskins.equip(res.id); closeOpen(); $('cshint').textContent = `✓ ${s.name} equipped`; });
    $('csok').addEventListener('click', closeOpen);
    audio.play(s.rarity >= 2 ? 'victory' : 'healDone');
  }, 5400);
}
function closeOpen() { $('csopen').hidden = true; opening = false; renderCases(); }

// ---------- Режимы: Casual / Ranked, допуск через пост в X, магазин за RP ----------

function setGameMode(m) {
  if (m !== gameMode) stopSearch();
  gameMode = m;
  setTimeout(updateRoundInfo, 0);
  $('modeseg').classList.toggle('ranked', m === 'ranked');
  $('modeseg').classList.toggle('duel', m === 'duel');
  $('md-casual').classList.toggle('on', m === 'casual');
  $('md-ranked').classList.toggle('on', m === 'ranked');
  $('md-duel').classList.toggle('on', m === 'duel');
  renderRanked();
  previewSoon();
}
$('md-casual').addEventListener('click', () => setGameMode('casual'));
$('md-ranked').addEventListener('click', () => setGameMode('ranked'));
$('md-duel').addEventListener('click', () => setGameMode('duel'));
// Поля тикеров: из ссылки-вызова — её тикеры; ввод — только буквы/цифры, со знаком $.
if (linkDuel) { const t = duelTickers(linkDuel); $('du-a').value = t.a; $('du-b').value = t.b; }
for (const id of ['du-a', 'du-b']) {
  $(id).addEventListener('input', () => { renderDuelSide(); previewSoon(); updateRoundInfo(); });
  $(id).addEventListener('blur', () => { const v = cleanTicker($(id).value); $(id).value = v ? `$${v.toUpperCase()}` : ''; });
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
}
function renderDuelSide() {
  const id = duelId(), t = duelTickers(id);
  const side = id === linkDuel && params.get('s') === 'b' ? 'b' : 'a';
  $('du-side').innerHTML = id === linkDuel && side === 'b'
    ? `You were challenged — you fight for <b>${t.b}</b> against <b>${t.a}</b>`
    : `You fight for <b>${t.a}</b>. Send the link — your opponent fights for <b>${t.b}</b>`;
}
renderDuelSide();

function renderRanked() {
  const rk = gameMode === 'ranked';
  const du = gameMode === 'duel';
  $('rankbox').hidden = !rk;
  $('duelbox').hidden = !du;
  $('seg').hidden = rk || du;
  $('code').hidden = rk || du || mode !== 'join';
  $('pois').hidden = du;
  document.querySelector('.launch .hot').hidden = du;           // «горячая точка» высадки — не для дуэли
  $('copyinv').parentElement.hidden = rk || (gameMode === 'casual' && mode === 'online');
  const a = ranked.access;
  $('rk-locked').hidden = !!a;
  $('rk-ok').hidden = !a;
  $('rk-code').textContent = ranked.code || '…';
  if (a) {
    const d = ranked.today;
    $('rk-today').textContent = d ? `Today: ${d.earned}/${d.cap} RP` : '';
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
    c.addEventListener('click', async () => {
      if (own) {
        if (it.kind === 'pad') { await ranked.setPad(equipped ? null : it.id); makeHero(); }
        $('shophint').textContent = it.kind === 'skin' ? 'Equip it in the Locker' : equipped ? 'Pad removed' : `${it.name} equipped`;
      } else if (await ranked.buy(it.id)) {
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
const inviteLink = () => {
  const id = lobbyId();
  if (!isDuelWorld(id)) return `${location.origin}${location.pathname}?w=${id}`;
  const mine = id === linkDuel && params.get('s') === 'b' ? 'b' : 'a';
  return `${location.origin}${location.pathname}?w=${id}&s=${mine === 'a' ? 'b' : 'a'}`;   // соперник — за другой тикер
};
$('copyinv').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(inviteLink()); $('status').textContent = '✓ Invite link copied — send it to friends'; } catch (e) { $('status').textContent = inviteLink(); }
});
$('shareinv').addEventListener('click', () => {
  const id = lobbyId();
  const t = isDuelWorld(id) ? duelTickers(id) : null;
  const mine = t && id === linkDuel && params.get('s') === 'b' ? t.b : t?.a, theirs = t && (mine === t.a ? t.b : t.a);
  const text = t
    ? `🥊 ${mine} vs ${theirs} — 1v1 in ${NAME}. I'm fighting for ${mine}. You take ${theirs}. Loser's bag goes to zero 😤`
    : `Drop into my ${NAME} match 🪂⛏🌪 — loot, build, outrun the storm. Last one standing wins. Open and play, no install`;
  open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(inviteLink())}`, '_blank', 'noopener');
});

// Состояние раунда в лобби: можно ли высадиться прямо сейчас.
function updateRoundInfo() {
  if (playing || mmSearch) return;
  if (gameMode === 'duel') {
    $('tring').style.strokeDashoffset = '0';
    const t = duelTickers(duelId());
    $('roundinfo').innerHTML = `<b class="live">● 1v1 Duel</b>${t.a} vs ${t.b} · starts when your opponent joins`;
    return;
  }
  if (gameMode === 'casual') {
    $('tring').style.strokeDashoffset = '0';
    $('roundinfo').innerHTML = mode === 'online'
      ? `<b class="live">● Online</b>${ROUND_MS / 60e3} min · starts in ≤20 s`
      : mode === 'join'
      ? `<b class="live">● Friend's match</b>Drop in with everyone on the link`
      : `<b class="live">● Fresh match</b>Starts the moment you hit Play · ${ROUND_MS / 60e3} min`;
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
const settings = { sens: 1, fov: 80, vol: 0.8, music: 0.5, shadows: true, hq: true, bloom: true, grass: true, fps: true, ao: true, rays: true, auto: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* по умолчанию */ }

// Автокачество: держится FPS < 45 — по ступеньке снижаем (1: разрешение ×1, 2: без AO и лучей, 3: без травы и bloom).
// Только на эту сессию, настройки игрока не трогаем. autoLevel — текущая ступенька.
let autoLevel = 0;
const fxOn = {
  get hq() { return settings.hq && autoLevel < 1; },
  get ao() { return settings.ao && settings.hq && autoLevel < 2; },
  get rays() { return settings.rays && settings.hq && autoLevel < 2; },
  get grass() { return settings.grass && autoLevel < 3; },
  get bloom() { return settings.bloom && autoLevel < 3; },
};
let autoAcc = 0, autoN = 0, autoT = 0, autoWarm = true;
function autoQuality(dt, now) {
  if (!settings.auto || !playing || document.hidden || dt <= 0 || dt > 0.25 || autoLevel >= 3) { autoAcc = autoN = 0; autoT = now; autoWarm = true; return; }
  autoAcc += dt; autoN++;
  if (now - autoT < 3000) return;
  const fps = autoN / autoAcc;
  autoAcc = autoN = 0; autoT = now;
  if (autoWarm) { autoWarm = false; return; }        // первые 3 с матча — компиляция шейдеров, не в счёт
  if (fps >= 45) return;
  autoLevel++;
  applySettings(false);
  toast(`⚙ Auto quality: ${['', 'resolution', 'shadows & rays', 'grass & glow'][autoLevel]} lowered (${Math.round(fps)} FPS)`);
}

function applySettings(save = true) {
  controls.pointerSpeed = settings.sens;
  FOV = settings.fov;
  if (!isScoped()) { camera.fov = FOV; camera.updateProjectionMatrix(); }
  sun.castShadow = settings.shadows;
  renderer.setPixelRatio(fxOn.hq ? Math.min(devicePixelRatio, 2) : 1);
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(fxOn.hq ? Math.min(devicePixelRatio, 2) : 1);
  composer.setSize(innerWidth, innerHeight);
  fitFxaa();
  grass.visible = fxOn.grass;
  bloom.enabled = fxOn.bloom;
  aoPass.enabled = fxOn.ao;
  $('fps').hidden = !settings.fps;
  if (save) try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* без сохранения */ }
}

const SLIDERS = [
  { key: 'sens', label: 'Mouse sensitivity', min: 0.2, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'fov', label: 'Field of view', min: 60, max: 110, step: 1, fmt: (v) => `${v}°` },
  { key: 'vol', label: 'Volume', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'music', label: 'Lobby music', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];
const TOGGLES = [
  { key: 'shadows', label: 'Shadows', on: 'On', off: 'Off' },
  { key: 'hq', label: 'Graphics quality', on: 'High', off: 'Fast' },
  { key: 'bloom', label: 'Bloom (glow)', on: 'On', off: 'Off' },
  { key: 'grass', label: 'Grass', on: 'On', off: 'Off' },
  { key: 'ao', label: 'Ambient occlusion', on: 'On', off: 'Off' },
  { key: 'rays', label: 'Sun rays & flare', on: 'On', off: 'Off' },
  { key: 'auto', label: 'Auto quality', on: 'On', off: 'Off' },
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

// ---------- Звук: шаги, перезарядка, лечение, прицел, окружение (audio.js) ----------

const V_SND = new THREE.Vector3(), V_DOWN = new THREE.Vector3(0, -1, 0), prevFeet = new THREE.Vector3();
let stepAcc = 0, stepSide = 0, lastReload = null, lastHeal = null, wasScoped = false, heldKey = '';
// Поверхность под ногами: вода, песок у берега, трава; на постройке/объекте — его материал.
function surfaceUnder(p = feet) {
  if (p.y < WATER_Y + 0.15) return 'water';
  const hit = structures.raycast(V_SND.set(p.x, p.y + 0.3, p.z), V_DOWN, 0.9);
  if (hit?.e) return fxKind(hit.e);
  return p.y < WATER_Y + 2.5 ? 'sand' : 'grass';
}
function selfSound(dt) {
  // шаги: по пройденному пути (бег — шире шаг, громче и звякает снаряжение; присел — тихо)
  const h = Math.hypot(feet.x - prevFeet.x, feet.z - prevFeet.z);
  prevFeet.copy(feet);
  if (onGround && royale.alive && !riding && !abilities.drone && h < 1) {
    const run = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !isScoped();
    const quiet = crouching || prone;
    stepAcc += h;
    if (stepAcc >= (quiet ? 1.1 : run ? 2.2 : 1.65)) {
      stepAcc = 0;
      audio.step(surfaceUnder(), null, quiet ? 0.35 : run ? 1.2 : 0.8);
      if (run && (stepSide ^= 1)) audio.play('gear', null, { vol: 0.8 });
    }
  } else if (!onGround) stepAcc = 1.3;                        // первый шаг после приземления — сразу
  // перезарядка и лечение: по фазам анимации; прервали — звук обрывается
  const rl = combat.reloading, hl = combat.healing;
  if (rl && (!lastReload || rl.slot !== lastReload.slot || rl.left > lastReload.left + 0.05)) audio.reload(combat.slots[rl.slot]?.type, rl.left);
  else if (!rl && lastReload && lastReload.left > 0.1) audio.stop();
  lastReload = rl ? { slot: rl.slot, left: rl.left } : null;
  if (hl && (!lastHeal || hl.left > lastHeal.left + 0.05)) audio.heal(hl.left);
  else if (!hl && lastHeal && lastHeal.left > 0.1) audio.stop();
  lastHeal = hl ? { left: hl.left } : null;
  const sc = isScoped() && !!holding();
  if (sc !== wasScoped) { audio.play(sc ? 'adsIn' : 'adsOut'); wasScoped = sc; }
}
// Другие игроки и боты рядом: шаги, перезарядка, аптечка — слышно, откуда идут.
function othersSound(o, dt) {
  if (!o.near || o.target.a === false) return;
  const p = o.group.position;
  if (o.spd > 1.2 && !o.target.st && !o.target.pr) {
    o.stepAcc = (o.stepAcc || 0) + o.spd * dt;
    const run = o.spd > 6.5;
    if (o.stepAcc > (run ? 2.2 : 1.65)) { o.stepAcc = 0; audio.step(surfaceUnder(p), p, run ? 1.3 : 0.8); }
  }
  if (o.target.rl && !o.rlWas) { audio.play('magOut', p); audio.play('magIn', p, { at: 0.8 }); audio.play('chargeFwd', p, { at: 1.2 }); }
  if (o.target.hl && !o.hlWas) audio.play('medOpen', p);
  o.rlWas = !!o.target.rl; o.hlWas = !!o.target.hl;
}
// Окружение: ветер в падении, купол, вертолёт, шторм рядом/снаружи; музыка — в лобби.
// Лейт: чем меньше живых (с 10) и ближе финал — тем громче пульсирующая «напряжёнка».
function tensionLevel() {
  if (!royale.alive || royale.ended || royale.duel || royale.round < 0) return 0;
  const n = royale.aliveCount(), s = royale.stormNow();
  if (n > 10 && !s.final) return 0;
  return Math.min(1, 0.25 + Math.max(0, 10 - n) / 10 * 0.55 + (s.final ? 0.2 : 0));
}
function envSound() {
  if (!playing) return { lobby: world && !params.has('shot') && !params.has('rec') };
  let storm = 0;
  if (royale.round >= 0 && !royale.ended) {
    const s = royale.stormNow(), c = royale.center;
    const d = s.r - Math.hypot(player.position.x - c.x, player.position.z - c.z);
    storm = d < 0 ? 1 : Math.max(0, 1 - d / 35) * 0.45;
  }
  const air = gliding && feet.y > WATER_Y + 0.5;                 // в воде парашют уже не шумит
  const hd = heli.visible ? heli.getWorldPosition(V_SND).distanceTo(player.position) : 1e9;
  return {
    fall: air && !chute, chute: air && chute, speed: Math.abs(vel.y), riding,
    heli: riding ? 1 : Math.max(0, 1 - hd / 260) * 0.8,
    storm, hp: royale.alive ? combat.hp : 100,
    tension: tensionLevel(),
    rain: weather.kind === 'rain' ? 1 : 0,
    motor: myCar ? 0.35 + Math.min(1, Math.abs(carSt.speed) / CAR.MAX) * 0.65 : carsNearLevel(),
    motorRate: myCar ? 0.6 + Math.min(1.6, Math.abs(carSt.speed) / CAR.MAX * 1.4) : 1,
    jet: myCar ? myCar.jet : carsJetLevel(),
  };
}

// ---------- Цикл ----------

let last = performance.now();
// Главный цикл кадра. Вынесен в функцию: запись промо-видео (brand/trailer.js) вызывает его сама, покадрово.
const mainLoop = (now) => {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // последнее убийство: ~1.3 с замедления (плавно возвращается к обычной скорости)
  if (slowUntil) {
    const left = slowUntil - now / 1000;
    if (left <= 0) { slowUntil = 0; $('slowmo').classList.remove('on'); }
    else dt *= left > 0.4 ? 0.3 : 0.3 + (0.4 - left) / 0.4 * 0.7;
  }
  const t = now / 1000;
  if (!playing && world) lobbyFrame(dt, t);
  if (playing) {
    updateHeli(t);
    if (riding) { /* камеру ставит updateHeli */ }
    else if (abilities.drone) {
      // FPV: камера в дроне; тело без управления (клавиши — дрону), но гравитация действует
      const held = new Set(keys); keys.clear();
      if (controls.isLocked) step(dt);
      for (const k of held) keys.add(k);
      player.position.copy(abilities.drone.pos);
    }
    else if (myCar) carStep(dt, controls.isLocked);
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
    if (royale.round >= 0) events.update(dt, (Date.now() - royale.roundStart) / 1000);
    pads.update(dt, t);
    updateCars(dt);
    for (const p of structures.updateFalling(dt)) {               // дерево ударилось о землю: пыль, листья, тряска рядом
      for (let i = 0; i < 5; i++) fx.dust(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0.3, (Math.random() - 0.5) * 4)), 0xa8c070, 2.2);
      shakeIfNear(p, 20, 0.18);
      shadowDirty = true;
    }
    minimap.update(dt, playing);
    fx.update(dt);
    runDust(dt);
    updatePlan();
    updatePoi();

    // Подбор лута и подсказки.
    swapCandidate = royale.alive && !riding ? loot.pickupNear(feet, combat, dt) : null;
    const chest = controls.isLocked && royale.alive ? loot.chestNear(eye(), look()) : null;
    const carNear = !myCar && royale.alive && !riding && !gliding ? roadsters.near(feet) : null;
    const prompt = royale.ended ? $('prompt').textContent : abilities.drone ? '' : riding ? ridePrompt() : myCar ? (carSt.fly ? 'SPACE up · ALT down · W/S thrust · SHIFT afterburner · F land mode · E exit' : 'SHIFT launch · SPACE jump (+A/D kickflip) · F fly · E exit') : chest ? 'E — open chest' : carNear ? 'E — drive the Roadster ⚡' : swapCandidate ? `G — swap for ${itemLabel(swapCandidate)}` : gliding ? (chute ? 'Parachute — steer with WASD' : 'SPACE — open parachute') : canRedeploy() ? 'SPACE — open parachute' : '';
    if ($('prompt').textContent !== prompt) { $('prompt').textContent = prompt; $('prompt').hidden = !prompt; }
    $('prompt').classList.toggle('ride', riding && inJumpZone());
    $('prompt').classList.toggle('wait', riding && !inJumpZone());
    const rl = combat.reloading, hl = combat.healing;
    const rtext = hl ? `✚ Healing… ${Math.max(0, hl.left).toFixed(1)}s` : rl ? `Reloading… ${Math.max(0, rl.left).toFixed(1)}s` : '';
    if ($('reload').textContent !== rtext) $('reload').textContent = rtext;

    // Прицел снайперки.
    const opt = isScoped() ? opticOf() : null;
    const fov = isScoped() ? (opt ? opt.fov : SCOPE_FOV) : FOV + (myCar ? Math.min(1, Math.abs(carSt.speed) / CAR.BOOST_MAX) * 22 : 0);
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
    $('scope').hidden = !isScoped() || !!opt;
    $('ads').hidden = !opt;
    // FPV-оверлей дрона: REC, заряд батареи, помехи к концу
    const dr = abilities.drone;
    $('fpv').hidden = !dr;
    if (dr) {
      $('fpvbat').style.width = `${(dr.left / dr.life) * 100}%`;
      $('fpvt').textContent = dr.left.toFixed(1);
      $('fpv').classList.toggle('low', dr.left < 3);
      $('fpvdist').textContent = `${Math.round(dr.pos.distanceTo(feet))} m`;
    }
    if (opt) $('ads').dataset.dot = opt.dot;

    if (camPunch > 1e-4) { const r = camPunch * Math.min(1, dt * 9); camera.rotation.x -= r; camPunch -= r; }
    if (shakeAmt > 0.001) {
      player.position.add(new THREE.Vector3((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt));
      shakeAmt *= Math.max(0, 1 - 6 * dt);
    }
    for (const o of others.values()) {
      // убитых, наблюдателей, сидящих в вертолёте и замолчавших (ушёл без «leave») не показываем
      o.group.visible = o.target.a !== false && !o.target.rd && performance.now() - (o.seen ?? 0) < 6000;
      const prev = o.group.position.clone();
      o.group.position.lerp(new THREE.Vector3(o.target.x, o.target.y + (o.target.pr ? 0.32 : 0), o.target.z), 0.25);
      o.group.rotation.y = o.target.r;
      o.group.scale.y += ((o.target.cr ? 0.72 : 1) - o.group.scale.y) * 0.3;       // присел — ниже
      // дальше 40 м — без контура и теней (20 ботов: вдвое меньше отрисовок)
      const near = o.group.position.distanceToSquared(feet) < 1600;
      if (o.near !== near) { o.near = near; o.group.traverse((x) => { if (x.userData.outline) x.visible = near; else if (x.isMesh) x.castShadow = near; }); }
      // поза по движению: планирует / в воздухе / бежит / стоит
      const sp = Math.hypot(o.group.position.x - prev.x, o.group.position.z - prev.z) / Math.max(dt, 1e-3);
      o.spd = (o.spd || 0) * 0.85 + sp * 0.15;
      othersSound(o, dt);
      const em = EMOTE_IDS.includes(o.target.em) ? o.target.em : null;
      const st = o.target.st === 'g' ? 'chute' : o.target.st === 'f' ? 'glide' : o.target.st === 'a' ? 'air' : o.spd > 0.8 ? 'run' : em || (o.target.hl ? 'heal' : 'idle');
      // лечится — зелёные искорки; эмоция/лечение — оружие убрано; перезарядка — оружие опущено
      if (o.target.hl && o.near && Math.random() < dt * 5) fx.heal(o.group.position.clone().add(new THREE.Vector3(0, 1.3, 0)));
      if (o.gun) {
        o.gun.visible = !em && !o.target.hl;
        o.gun.rotation.z += ((o.target.rl ? 0.8 : 0) - o.gun.rotation.z) * 0.2;
      }
      // купол над тем, кто под парашютом; в свободном падении — животом вниз
      const chSkin = typeof o.target.ch === 'string' ? chuteById(o.target.ch).id : 'classic';
      if (o.target.pc && (!o.chute || o.chute.userData.skin !== chSkin)) { if (o.chute) o.group.remove(o.chute); o.chute = buildParachute(chSkin); o.group.add(o.chute); }
      if (o.chute) o.chute.visible = !!o.target.pc;
      o.group.rotation.x += ((o.target.st === 'f' ? -1.1 : o.target.pr ? -1.5 : 0) - o.group.rotation.x) * 0.2;   // падение / лёжа
      const cv = Array.isArray(o.target.cv) ? o.target.cv : null;
      if (cv) {                                       // за рулём: сидит в машине (торс над бортом), повёрнут как машина
        o.group.position.set(cv[0], cv[1] - 0.25, cv[2]);
        o.group.rotation.set(cv[4], cv[3], cv[5], 'YXZ');
        if (o.gun) o.gun.visible = false;
        animateCharacter(o.group, t, 'idle', 0, false);
        continue;
      }
      animateCharacter(o.group, t, st, Math.min(1, o.spd / RUN), !!o.target.g && o.target.g !== 'pickaxe' && st !== 'heal' && !em);
    }
    sendPose(now);
    updateCrosshair(w, en);
    selfSound(dt);
  }
  camSave.p.copy(camera.position); camSave.q.copy(camera.quaternion);
  const cineOn = applyCine(dt, t);
  audio.frame(dt, envSound());                    // слушатель — там же, где кадр (у зрителя — у того, за кем смотришь)
  // Солнце с тенью ездит за игроком (тени — только вокруг); небо — за камерой.
  const c = player.position;
  sun.target.position.set(Math.round(c.x), Math.round(c.y), Math.round(c.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 180);
  sky.position.copy(c);
  stars.position.copy(c);
  // дождь и гроза: молния — белая вспышка неба и света, раскат с задержкой «как от далёкой тучи»
  if (playing && weather.update(dt, c) === 'bolt') {
    const f = $('lightning'); f.className = ''; void f.offsetWidth; f.className = 'on';
    hemi.intensity *= 2.2; setTimeout(() => { hemi.intensity = MOODS.rain.hemiI; }, 160);
    audio.play('thunder', null, { at: 0.6 + Math.random() * 1.2 });
  }
  for (const cl of clouds.children) { cl.position.x += dt * 1.5; if (cl.position.x > MAP / 2 + 420) cl.position.x -= 840; }
  structures.lod(renderer, c);                    // дальние деревья — карточками
  if (playing) grass.update(cineOn ? camera.position : feet, t);             // в лобби камера высоко — траву не видно, не считаем
  windUniform.value = t;
  water.update(t);
  // Тени: при сдвиге на 1.5 м, после правок построек и не реже 10 раз в секунду (движутся другие игроки)
  if (shadowDirty || c.distanceTo(shadowAt) > 1.5 || t - shadowT > (playing ? 0.1 : 0.05)) {
    renderer.shadowMap.needsUpdate = true;
    shadowAt.copy(c); shadowT = t; shadowDirty = false;
  }
  // через composer — если включён хоть один эффект кадра; иначе напрямую (дешевле, сглаживание браузера)
  if (fxOn.rays) rays.aim(camera, SUN_DIR, innerWidth, innerHeight); else rays.enabled = false;
  if (fxOn.bloom || fxOn.ao || rays.enabled) composer.render(); else renderer.render(scene, camera);
  if (cineOn) { camera.position.copy(camSave.p); camera.quaternion.copy(camSave.q); }
  autoQuality(dt, now);
  countFps(now);
  if (playing && !cineOn && !riding && !myCar && !gliding && !emote && !abilities.drone && (controls.isLocked || debugView)) {
    const h = holding();
    const inHand = h || (ENTRIES[slot].med && !buildType && combat.meds ? { type: 'medkit', rarity: 0 } : null);   // слот 5 — аптечка в руке
    const run = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && moving && onGround;
    vm.set(inHand);
    const hk = inHand ? `${slot}:${inHand.type}` : '';
    if (hk !== heldKey) { if (inHand) audio.play(inHand.type === 'pickaxe' ? 'equipPick' : inHand.type === 'medkit' ? 'equipMed' : 'equip'); heldKey = hk; }
    vm.render(dt, { moving: moving && onGround, running: run, reload: combat.reloading, heal: combat.healing, scoped: isScoped(), loaded: !!inHand && (inHand.mag === undefined || inHand.mag > 0) });
  }
  window.__frameHook?.(dt, t);                   // запись промо-видео: кадр готов
};
renderer.setAnimationLoop(mainLoop);

// Режим съёмки для промо (?shot=x,z,высота,yaw,pitch): старт без экрана входа, без интерфейса и сети,
// камера в заданной точке. Используется для шапки/аватарки в X: headless Chrome делает скриншот.
// ?clean — без счётчика FPS (скриншоты для README). Вкладка лобби из адреса (#locker, #cases, #gunsmith …).
if (params.has('clean')) document.body.classList.add('shotclean');
if (location.hash.length > 1 && !params.has('shot')) setTimeout(() => document.querySelector(`#tabs [data-tab="${location.hash.slice(1)}"]`)?.click(), 300);

if (params.has('shot')) {
  const [x = 80, z = 80, up = 20, yaw = -2.3, pitch = -0.3] = params.get('shot').split(',').map(Number);
  const hud = params.has('hud');                        // &hud=1 — кадр «как в игре»: интерфейс, миникарта, автомат в руках
  document.body.classList.add(hud ? 'shothud' : 'shot');
  startNet = () => {};
  $('nick').value = 'Demo';
  start();
  setTimeout(() => {
    for (const id of hud ? ['banner', 'pause'] : ['top', 'hotbar', 'hint', 'bars', 'ammo', 'storm', 'banner', 'pause', 'cross', 'mats', 'abil', 'credits']) $(id).hidden = true;
    if (hud) {
      debugView = true; $('cross').hidden = false;
      for (const it of [{ k: 'weapon', w: 'ar', r: 3 }, { k: 'weapon', w: 'shotgun', r: 2 }, { k: 'ammo', w: 'medium', a: 120 }, { k: 'armor', a: 50 }]) combat.give(it);
      mats.wood = 240; mats.brick = 120; mats.metal = 60; renderMats();
      pick(1);
      if (params.has('map')) setTimeout(() => minimap.toggle(true), 400);   // &map=1 — с открытой большой картой
    }
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
  c.dataset.mode = abilities.drone ? 'off' : !w ? 'dot' : isScoped() ? 'off' : w.type === 'shotgun' ? 'ring' : w.type === 'bazooka' ? 'bazooka' : 'lines';
}

// Для отладки и тестов.
window.__pc = {
  get world() { return world; }, get net() { return net; }, get others() { return others; }, peers,
  combat, loot, pick, royale, fx, vm, audio, killfeed, events, pads, roadsters, enterCar: (c) => enterCar(c), exitCar: () => exitCar(true), get myCar() { return myCar; }, carSt, winCam: () => startWinCam(), setMood: (n) => setMood(n), emote: (id) => startEmote(id), get emoting() { return emote; }, season, structures, mats, bots, sendHit, abilities, openBuy, closeBuy, damageStructure, get crouching() { return crouching; }, get eyeH() { return eyeH; }, get vel() { return vel; }, scene, camera, renderer, composer, grass, settings,
  build: (t) => enterBuild(t), place: () => { updatePlan(); nextBuild = 0; placePiece(performance.now() / 1000); }, swing: () => { nextSwing = 0; swingPickaxe(performance.now() / 1000); },
  get plan() { return plan; },
  get feet() { return feet; }, step: (dt) => step(dt), keys, controls, ride: () => startRide(true), get riding() { return riding; }, heliTick: () => updateHeli(performance.now() / 1000), ridePrompt: () => flight && ridePrompt(), jump: (forced) => jumpOut(forced),
  mainLoop,
  // съёмка ролика: «чистый» кадр между сценами — не в вертолёте, не в полёте, без стройки и дрона
  cut() { riding = false; flight = null; heli.visible = false; gliding = false; chute = false; prone = false; exitBuild(); vel.set(0, 0, 0); },
  exitBuild: () => exitBuild(),
  vec: (x, y, z) => new THREE.Vector3(x, y, z),
  flightDir: () => flight?.dir || new THREE.Vector3(0, 0, -1),
  camYaw: () => new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y,
  set debugView(v) { debugView = v; $('cross').hidden = !v; $('pause').hidden = v; },
  tp(x, z, up = 0, y = 999) { feet.set(x, structures.ground(x, z, y) + 0.01 + up, z); gliding = false; player.position.set(feet.x, feet.y + EYE, feet.z); },
  look(yaw, pitch = 0) { camera.rotation.set(pitch, yaw, 0, 'YXZ'); },
};
