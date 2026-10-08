// PostCraft — общий воксельный мир по ссылке. Создал мир → ссылка ?w=<id> → кинул в X → все, кто открыл, строят вместе.
// Мир генерируется из id (у всех одинаковый), поверх — правки игроков: синхронизация по P2P (net.js),
// у каждого копия правок в localStorage — мир не пропадает, пока его хранит хоть кто-то из игроков.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { World, SX, SY, SZ, WATER_Y, BLOCKS, HOTBAR, makeMaterials, buildMeshes, raycast, iconUrl } from './voxel.js';
import { connect } from './net.js';

const NAME = 'PostCraft';                     // рабочее название — менять здесь (и в <title> index.html)
const EYE = 1.62, HEIGHT = 1.8, HALF = 0.3;
const GRAVITY = 30, JUMP = 8.6, WALK = 4.6, RUN = 7.5, FLY = 11, REACH = 6;
const POSE_HZ = 10;

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
  $('go').textContent = 'Join world';
  $('introsub').textContent = `You were invited to world “${worldId}”. Pick a name and jump in — everyone here builds together.`;
}

// ---------- Сцена ----------

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = 0x8fc3ff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 50, 140);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a4a3a, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(-40, 100, 30);
scene.add(sun);

const water = new THREE.Mesh(new THREE.PlaneGeometry(SX * 6, SZ * 6).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x2a6fd6, transparent: true, opacity: 0.6 }));
water.position.set(SX / 2, WATER_Y + 0.85, SZ / 2);
scene.add(water);

const controls = new PointerLockControls(camera, renderer.domElement);
const player = controls.object ?? controls.getObject();
scene.add(player);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Подсветка блока под прицелом.
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
outline.visible = false;
scene.add(outline);

// ---------- Мир и правки ----------

let world = null, mats = null, meshes = [], dirty = false;
const edits = new Map();             // idx → { b, t } — правки поверх сгенерированного мира
const storeKey = () => `pc:edits:${worldId}`;

function applyEdit(idx, b, t) {
  const cur = edits.get(idx);
  if (cur && cur.t >= t) return false;          // уже есть более новая правка
  edits.set(idx, { b, t });
  world.cells[idx] = b;
  dirty = true;
  return true;
}

let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(storeKey(), JSON.stringify([...edits].map(([i, e]) => [i, e.b, e.t]))); } catch (e) { /* квота */ }
  }, 800);
}

function rebuild() {
  for (const m of meshes) { scene.remove(m); m.dispose(); }
  meshes = buildMeshes(world, mats);
  for (const m of meshes) scene.add(m);
  dirty = false;
}

// ---------- Физика (AABB игрока против сетки) ----------

const vel = new THREE.Vector3();
let onGround = false, flying = false;
const keys = new Set();

function collides(px, py, pz) {
  for (let x = Math.floor(px - HALF); x <= Math.floor(px + HALF); x++) {
    for (let y = Math.floor(py); y <= Math.floor(py + HEIGHT - 0.01); y++) {
      for (let z = Math.floor(pz - HALF); z <= Math.floor(pz + HALF); z++) {
        if (world.solid(x, y, z)) return true;
      }
    }
  }
  return false;
}

// feet — позиция ног; камера — на высоте глаз.
const feet = new THREE.Vector3();

function moveAxis(axis, d) {
  if (!d) return false;
  const steps = Math.ceil(Math.abs(d) / 0.25);
  const s = d / steps;
  for (let i = 0; i < steps; i++) {
    feet[axis] += s;
    if (collides(feet.x, feet.y, feet.z)) { feet[axis] -= s; return true; }
  }
  return false;
}

function spawn() {
  const x = SX / 2 + 0.5, z = SZ / 2 + 0.5;
  feet.set(x, world.surfaceY(Math.floor(x), Math.floor(z)) + 0.01, z);
  vel.set(0, 0, 0);
}

function step(dt) {
  const speed = flying ? FLY : keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK;
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
  if (move.lengthSq()) move.normalize().multiplyScalar(speed * dt);

  moveAxis('x', move.x);
  moveAxis('z', move.z);
  if (flying) {
    const dy = (keys.has('Space') ? FLY : 0) - (keys.has('KeyC') ? FLY : 0);
    moveAxis('y', dy * dt);
  } else {
    if (keys.has('Space') && onGround) { vel.y = JUMP; onGround = false; }
    vel.y = Math.max(vel.y - GRAVITY * dt, -40);
    const hit = moveAxis('y', vel.y * dt);
    if (hit) { if (vel.y < 0) onGround = true; vel.y = 0; } else onGround = false;
    // В воде — медленнее падаем и можно всплыть.
    if (feet.y < WATER_Y + 1) { vel.y = Math.max(vel.y, -2.5); if (keys.has('Space')) vel.y = 3.5; }
  }
  if (feet.y < -20) spawn();
  player.position.set(feet.x, feet.y + EYE, feet.z);
}

// ---------- Ломать / ставить ----------

let slot = 0;
const lookDir = new THREE.Vector3();

function target() {
  camera.getWorldDirection(lookDir);
  return raycast(world, camera.getWorldPosition(new THREE.Vector3()), lookDir, REACH);
}

function edit(x, y, z, b) {
  if (!world.inside(x, y, z)) return;
  const idx = world.idx(x, y, z);
  const t = Date.now();
  if (applyEdit(idx, b, t)) {
    net?.edit({ i: idx, b, t });
    saveSoon();
  }
}

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!controls.isLocked || !world) return;
  const hit = target();
  if (!hit) return;
  if (e.button === 0) {
    if (hit.y > 0) edit(hit.x, hit.y, hit.z, 0);                 // бедрок (y=0) не ломаем
  } else if (e.button === 2) {
    const x = hit.x + hit.normal[0], y = hit.y + hit.normal[1], z = hit.z + hit.normal[2];
    if (world.get(x, y, z) || y >= SY) return;
    world.set(x, y, z, 1);                                       // проверка: не ставим блок в себя
    const inside = collides(feet.x, feet.y, feet.z);
    world.set(x, y, z, 0);
    if (!inside) edit(x, y, z, HOTBAR[slot]);
  }
});
addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Хотбар ----------

function renderHotbar() {
  const bar = $('hotbar');
  bar.textContent = '';
  HOTBAR.forEach((b, i) => {
    const d = document.createElement('div');
    d.className = i === slot ? 'on' : '';
    const img = document.createElement('img');
    img.src = iconUrl(mats[b]);
    d.appendChild(img);
    if (i < 9) { const s = document.createElement('span'); s.textContent = i + 1; d.appendChild(s); }
    d.addEventListener('click', () => pick(i));
    bar.appendChild(d);
  });
}
let nameTimer = 0;
function pick(i) {
  slot = (i + HOTBAR.length) % HOTBAR.length;
  [...$('hotbar').children].forEach((d, j) => d.classList.toggle('on', j === slot));
  $('blockname').textContent = BLOCKS[HOTBAR[slot]].name;
  $('blockname').style.opacity = 1;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => { $('blockname').style.opacity = 0; }, 1200);
}
addEventListener('wheel', (e) => { if (controls.isLocked) pick(slot + Math.sign(e.deltaY)); }, { passive: true });

// ---------- Другие игроки ----------

const others = new Map();     // peerId → { group, target: {x,y,z,r}, name }

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
  s.position.y = 2.25;
  return s;
}

function avatar(name) {
  const color = colorOf(name);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.35), new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: 0xf2c9a0 }));
  head.position.y = 1.75;
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  eyes.position.set(0, 1.8, -0.26);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), new THREE.MeshLambertMaterial({ color: 0x2b3140 }));
  legs.position.y = 0.2;
  g.add(body, head, eyes, legs, nameSprite(name, color));
  return g;
}

function upsertOther(peerId, d) {
  let o = others.get(peerId);
  if (!o || o.name !== d.n) {
    if (o) scene.remove(o.group);
    o = { group: avatar(d.n), name: d.n, target: d };
    o.group.position.set(d.x, d.y, d.z);
    scene.add(o.group);
    others.set(peerId, o);
    updateCount();
  }
  o.target = d;
}

const peers = new Set();       // подключённые игроки (по onPeerJoin), даже если их позиция ещё не пришла

function updateCount() {
  const n = peers.size + 1;
  $('net').textContent = net ? `${n} online` : 'offline';
  $('net').className = `pill ${net ? 'on' : 'off'}`;
}

// ---------- Сеть ----------

let net = null;
let lastPose = 0, lastSent = '';

function startNet() {
  try {
    net = connect(worldId, {
      join(peerId) {
        peers.add(peerId);
        // Новичку — все правки мира и где мы стоим (сразу, не дожидаясь кадра).
        if (edits.size) net.sync({ e: [...edits].map(([i, e]) => [i, e.b, e.t]) }, peerId);
        net.pose(poseData(), peerId);
        updateCount();
      },
      leave(peerId) {
        peers.delete(peerId);
        const o = others.get(peerId);
        if (o) { scene.remove(o.group); others.delete(peerId); }
        updateCount();
      },
      pose(peerId, d) { upsertOther(peerId, d); },
      edit(peerId, d) { if (applyEdit(d.i, d.b, d.t)) saveSoon(); },
      sync(peerId, d) {
        let changed = false;
        for (const [i, b, t] of d.e || []) changed = applyEdit(i, b, t) || changed;
        if (changed) saveSoon();
      },
      chat(peerId, d) { say(d.n, d.t); },
    });
    updateCount();
  } catch (e) {
    console.warn(`[${NAME}] P2P недоступен:`, e);
    net = null;
    updateCount();
  }
}

function poseData() {
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  return { x: +feet.x.toFixed(2), y: +feet.y.toFixed(2), z: +feet.z.toFixed(2), r: +yaw.toFixed(2), n: nick };
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

// Пульс раз в 1.5 с — таймер работает и в фоновой вкладке (кадровый цикл там на паузе),
// чтобы стоящий на месте или свернувший вкладку игрок не «пропадал» у других.
setInterval(() => { if (net && world) net.pose(poseData()); }, 1500);

// ---------- Чат ----------

function say(name, text) {
  const line = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = name;
  b.style.color = colorOf(name);
  line.append(b, text);
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

// ---------- Клавиши и пауза ----------

addEventListener('keydown', (e) => {
  if (document.activeElement?.tagName === 'INPUT') return;
  keys.add(e.code);
  if (!world) return;
  if (e.code === 'KeyF') { flying = !flying; vel.y = 0; toast(flying ? 'Fly on' : 'Fly off'); }
  if (e.code === 'KeyT' && controls.isLocked) { e.preventDefault(); openChat(); }
  const n = e.code.match(/^Digit([1-9])$/);
  if (n) pick(+n[1] - 1);
});
addEventListener('keyup', (e) => keys.delete(e.code));

controls.addEventListener('lock', () => { $('pause').hidden = true; $('cross').hidden = false; });
controls.addEventListener('unlock', () => { keys.clear(); if ($('chatbox').hidden) $('pause').hidden = false; $('cross').hidden = true; });
$('resume').addEventListener('click', () => controls.lock());
renderer.domElement.addEventListener('click', () => { if (world && !controls.isLocked) controls.lock(); });

let toastTimer = 0;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 1600);
}

// ---------- Поделиться ----------

const link = () => `${location.origin}${location.pathname}?w=${worldId}`;
$('share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(link()); toast('Link copied'); } catch (e) { /* без буфера — просто откроем X */ }
  const text = `Come build in my ${NAME} world 🧱 — open and play, no install`;
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
  $('status').textContent = 'Generating the world…';
  setTimeout(() => {
    world = new World(worldId);
    mats = makeMaterials();
    try {
      for (const [i, b, t] of JSON.parse(localStorage.getItem(storeKey()) || '[]')) applyEdit(i, b, t);
    } catch (e) { /* битое сохранение — начнём с чистого мира */ }
    rebuild();
    spawn();
    renderHotbar();
    pick(0);
    $('wname').textContent = `🌍 ${worldId}`;
    $('intro').hidden = true;
    $('top').hidden = $('hotbar').hidden = $('hint').hidden = false;
    $('pause').hidden = false;
    document.title = `${worldId} — ${NAME}`;
    startNet();
  }, 20);
}
$('go').addEventListener('click', start);
$('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

// ---------- Цикл ----------

let last = performance.now(), lastRebuild = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (world) {
    if (controls.isLocked) step(dt);
    else player.position.set(feet.x, feet.y + EYE, feet.z);
    if (dirty && now - lastRebuild > 80) { lastRebuild = now; rebuild(); }
    const hit = controls.isLocked ? target() : null;
    outline.visible = !!hit;
    if (hit) outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    for (const o of others.values()) {
      o.group.position.lerp(new THREE.Vector3(o.target.x, o.target.y, o.target.z), 0.25);
      o.group.rotation.y = o.target.r;
    }
    sendPose(now);
  }
  renderer.render(scene, camera);
});

// Для отладки: window.__pc.world, .edits, .net
window.__pc = {
  get world() { return world; }, edits, get net() { return net; }, get others() { return others; }, peers, edit,
  tp(x, z, up = 0) { feet.set(x, world.surfaceY(Math.floor(x), Math.floor(z)) + 0.01 + up, z); player.position.set(feet.x, feet.y + EYE, feet.z); },
  look(yaw, pitch = 0) { camera.rotation.set(pitch, yaw, 0, 'YXZ'); },
};
