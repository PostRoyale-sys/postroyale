// PostCraft — общий воксельный мир по ссылке. Создал мир → ссылка ?w=<id> → кинул в X → все, кто открыл, играют вместе.
// Мир генерируется из id (у всех одинаковый), поверх — правки игроков: синхронизация по P2P (net.js),
// у каждого копия правок в localStorage — постройки не пропадают, пока их хранит хоть кто-то из игроков.
// Оружие — только из сундуков (loot.js), бой — combat.js, модели оружия в руках — viewmodel.js.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { World, SX, SY, SZ, WATER_Y, BLOCKS, HOTBAR, makeMaterials, buildChunk, chunksOf, chunkKey, CHUNKS_X, CHUNKS_Z, raycast, iconUrl } from './voxel.js';
import { connect } from './net.js';
import { createCombat, WEAPONS, RARITY, AMMO, MAX_SHIELD, weaponLabel } from './combat.js';
import { createLoot, itemLabel } from './loot.js';
import { createViewmodel, weaponModel } from './viewmodel.js';

const NAME = 'PostCraft';                     // рабочее название — менять здесь (и в <title> index.html)
const EYE = 1.62, HEIGHT = 1.8, HALF = 0.3;
const GRAVITY = 30, JUMP = 8.6, WALK = 4.6, RUN = 7.5, FLY = 11, REACH = 6;
const POSE_HZ = 10;
const FOV = 75, SCOPE_FOV = 22;

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
  $('introsub').textContent = `You were invited to world “${worldId}”. Pick a name and jump in — loot chests, build, fight.`;
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
scene.fog = new THREE.Fog(SKY, 70, 200);
const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 420);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a4a3a, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(-80, 160, 60);
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

const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
outline.visible = false;
scene.add(outline);

// ---------- Мир и правки ----------

let world = null, mats = null;
const chunkMeshes = new Map();       // "cx,cz" → [InstancedMesh]
const dirtyChunks = new Set();
const edits = new Map();             // idx → { b, t } — правки поверх сгенерированного мира
const storeKey = () => `pc:edits:v2:${worldId}`;     // v2 — мир 192×192 (старые сохранения 96×96 несовместимы)

function applyEdit(idx, b, t) {
  const cur = edits.get(idx);
  if (cur && cur.t >= t) return false;          // уже есть более новая правка
  edits.set(idx, { b, t });
  world.cells[idx] = b;
  const x = idx % SX, z = Math.floor(idx / SX) % SZ;
  for (const k of chunksOf(x, z)) dirtyChunks.add(k);
  return true;
}

let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(storeKey(), JSON.stringify([...edits].map(([i, e]) => [i, e.b, e.t]))); } catch (e) { /* квота */ }
  }, 800);
}

function rebuildChunk(key) {
  for (const m of chunkMeshes.get(key) || []) { scene.remove(m); m.dispose(); }
  const [cx, cz] = key.split(',').map(Number);
  const list = buildChunk(world, mats, cx, cz);
  for (const m of list) scene.add(m);
  chunkMeshes.set(key, list);
  dirtyChunks.delete(key);
}

function rebuildAll() {
  for (let cx = 0; cx < CHUNKS_X; cx++) for (let cz = 0; cz < CHUNKS_Z; cz++) rebuildChunk(chunkKey(cx, cz));
}

// ---------- Физика (AABB игрока против сетки) ----------

const vel = new THREE.Vector3();
let onGround = false, flying = false, moving = false;
const keys = new Set();
const feet = new THREE.Vector3();          // позиция ног; камера — на высоте глаз
const knockVel = new THREE.Vector3();

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

// Первый вход — в центре; после смерти — в случайной точке суши, чтобы не «кемперили» спавн.
function spawn(random = false) {
  let x = SX / 2 + 0.5, z = SZ / 2 + 0.5;
  if (random) {
    for (let i = 0; i < 200; i++) {
      const rx = 6 + Math.random() * (SX - 12), rz = 6 + Math.random() * (SZ - 12);
      if (world.surfaceY(Math.floor(rx), Math.floor(rz)) > WATER_Y + 1) { x = rx; z = rz; break; }
    }
  }
  feet.set(x, world.surfaceY(Math.floor(x), Math.floor(z)) + 0.01, z);
  vel.set(0, 0, 0);
}

function step(dt) {
  const scoped = isScoped();
  const speed = flying ? FLY : (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !scoped ? RUN : scoped ? WALK * 0.5 : WALK;
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
    if (feet.y < WATER_Y + 1) { vel.y = Math.max(vel.y, -2.5); if (keys.has('Space')) vel.y = 3.5; }
  }
  if (feet.y < -20) spawn(true);
  player.position.set(feet.x, feet.y + EYE, feet.z);
}

// ---------- Хотбар: 3 слота оружия, блоки ----------
// Клавиши: 1–3 — оружие (пустой слот — руки: ломать блоки, открывать сундуки), 4–9 — первые блоки, колесо — всё по кругу.

const ENTRIES = [{ weapon: 0 }, { weapon: 1 }, { weapon: 2 }, ...HOTBAR.map((b) => ({ block: b }))];
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

// Взрыв: стрелявший разом убирает блоки и шлёт их всем одной пачкой.
function destroyBlocks(list) {
  const t = Date.now(), batch = [];
  for (const [x, y, z] of list) {
    const i = world.idx(x, y, z);
    if (applyEdit(i, 0, t)) batch.push([i, 0, t]);
  }
  if (batch.length) { net?.sync({ e: batch }); saveSoon(); }
}

const currentWeapon = () => { const e = ENTRIES[slot]; return e.weapon !== undefined ? combat.slots[e.weapon] : null; };
let scopeHeld = false;
const isScoped = () => scopeHeld && !!currentWeapon() && !!WEAPONS[currentWeapon().type].scope;
let mouseDown = false;

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!controls.isLocked || !world) return;
  const entry = ENTRIES[slot];
  const w = currentWeapon();
  if (e.button === 2 && w && WEAPONS[w.type].scope) { scopeHeld = true; return; }
  if (e.button === 0) mouseDown = true;
  if (w) { if (e.button === 0) combat.fire(entry.weapon, performance.now() / 1000); return; }

  // Руки/блоки: сначала сундук под прицелом, потом блоки.
  if (e.button === 0) {
    const chest = loot.chestNear(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldDirection(new THREE.Vector3()));
    if (chest) { loot.open(chest); return; }
  }
  const hit = target();
  if (!hit) return;
  if (e.button === 0) {
    if (hit.y > 0) edit(hit.x, hit.y, hit.z, 0);                 // бедрок (y=0) не ломаем
  } else if (e.button === 2 && entry.block) {
    const x = hit.x + hit.normal[0], y = hit.y + hit.normal[1], z = hit.z + hit.normal[2];
    if (world.get(x, y, z) || y >= SY) return;
    world.set(x, y, z, 1);                                       // проверка: не ставим блок в себя
    const inside = collides(feet.x, feet.y, feet.z);
    world.set(x, y, z, 0);
    if (!inside) edit(x, y, z, entry.block);
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
    d.className = (i === slot ? 'on ' : '') + (entry.weapon !== undefined ? 'wslot' : '');
    if (entry.weapon !== undefined) {
      const w = combat.slots[entry.weapon];
      if (w) {
        const spec = WEAPONS[w.type];
        d.style.setProperty('--rar', RARITY[w.rarity].color);
        d.innerHTML = `<b>${spec.tag}</b><small>${w.mag}/${combat.ammo[spec.ammo]}</small>`;
        d.title = weaponLabel(w);
      } else {
        d.innerHTML = '<b class="empty">✋</b>';
        d.title = 'Hands — break blocks, open chests';
      }
    } else {
      const img = document.createElement('img');
      img.src = iconUrl(mats[entry.block]);
      d.appendChild(img);
    }
    if (i < 9) { const s = document.createElement('span'); s.textContent = i + 1; d.appendChild(s); }
    d.addEventListener('click', () => pick(i));
    bar.appendChild(d);
  });
}

let nameTimer = 0;
function pick(i) {
  scopeHeld = false;
  combat.cancelReload();
  slot = (i + ENTRIES.length) % ENTRIES.length;
  [...$('hotbar').children].forEach((d, j) => d.classList.toggle('on', j === slot));
  const entry = ENTRIES[slot];
  const w = currentWeapon();
  $('blockname').textContent = entry.weapon !== undefined ? (w ? weaponLabel(w) : 'Hands') : BLOCKS[entry.block].name;
  $('blockname').style.color = w ? RARITY[w.rarity].color : '';
  $('blockname').style.opacity = 1;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => { $('blockname').style.opacity = 0; }, 1400);
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

// ---------- Другие игроки ----------

const others = new Map();     // peerId → { group, target: {x,y,z,r,g,q}, name, gun }

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
  }
  o.target = d;
  // Оружие в руках у игрока: тип g и редкость q из pose.
  const gk = d.g ? `${d.g}:${d.q}` : '';
  if (o.gunKey !== gk) {
    if (o.gun) o.group.remove(o.gun);
    o.gun = null;
    o.gunKey = gk;
    if (d.g) {
      o.gun = weaponModel(d.g, d.q || 0);
      o.gun.position.set(0.32, 1.12, -0.25);
      if (d.g === 'bazooka') o.gun.position.set(0.3, 1.55, 0.05);
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

const KILL_ICON = { pistol: '🔫', smg: '🔫', ar: '🔫', shotgun: '💥', sniper: '🎯', bazooka: '🚀', rocket: '🚀' };
function killfeed(by, victim, w) {
  const line = document.createElement('div');
  line.className = 'kill';
  const icon = KILL_ICON[w] || '💀';
  line.textContent = by === victim ? `${victim} ${icon} blew themselves up` : `${by} ${icon} ${victim}`;
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

// ---------- Бой, лут, машины ----------

let shakeAmt = 0;
let swapCandidate = null;

const ctx = {
  scene, camera,
  world: () => world,
  feet: () => feet,
  others,
  net: () => net,
  selfId: () => net?.selfId || 'me',
  nick: () => nick,
  toast, killfeed,
  scoped: () => isScoped(),
  moving: () => moving,
  respawn: () => spawn(true),
  onInventory: () => renderStatus(),
  flash: (kind) => { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = kind === 'shield' ? 'shield' : 'on'; },
  hitmarker: () => { const h = $('hitmark'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); },
  shake: (a) => { shakeAmt = Math.max(shakeAmt, a); },
  knock: (v) => { knockVel.add(v); vel.y = Math.max(vel.y, v.y + 4); onGround = false; },
  destroyBlocks,
  dropItems: (pos, items) => loot.drop(pos, items),
  recoil: (type) => vm.kick(type),
};
const combat = createCombat(ctx);
const loot = createLoot(ctx);
const vm = createViewmodel(renderer, camera);

// ---------- Сеть ----------

let net = null;
let lastPose = 0, lastSent = '';

function startNet() {
  try {
    net = connect(worldId, {
      join(peerId) {
        peers.add(peerId);
        if (edits.size) net.sync({ e: [...edits].map(([i, e]) => [i, e.b, e.t]) }, peerId);
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
      edit(peerId, d) { if (applyEdit(d.i, d.b, d.t)) saveSoon(); },
      sync(peerId, d) {
        let changed = false;
        for (const [i, b, t] of d.e || []) changed = applyEdit(i, b, t) || changed;
        if (changed) saveSoon();
      },
      chat(peerId, d) { say(d.n, d.t); },
      shot(peerId, d) { combat.onShot(peerId, d); },
      hit(peerId, d) { combat.onHit(peerId, d); },
      dead(peerId, d) { combat.onDead(peerId, d); },
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
}

function poseData() {
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  const d = { x: +feet.x.toFixed(2), y: +feet.y.toFixed(2), z: +feet.z.toFixed(2), r: +yaw.toFixed(2), n: nick };
  const w = currentWeapon();
  if (w) { d.g = w.type; d.q = w.rarity; }
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
  if (e.code === 'KeyF') { flying = !flying; vel.y = 0; toast(flying ? 'Fly on' : 'Fly off'); }
  if (e.code === 'KeyT') { e.preventDefault(); openChat(); }
  if (e.code === 'KeyE') {
    const chest = loot.chestNear(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldDirection(new THREE.Vector3()));
    if (chest) loot.open(chest);
  }
  if (e.code === 'KeyR') { const en = ENTRIES[slot]; if (en.weapon !== undefined) combat.reload(en.weapon); }
  if (e.code === 'KeyG' && swapCandidate) {
    const en = ENTRIES[slot];
    const into = en.weapon !== undefined ? en.weapon : 0;
    loot.swap(swapCandidate, into, combat);
    pick(into);
  }
  if (e.code === 'KeyQ') {
    const en = ENTRIES[slot];
    if (en.weapon !== undefined && combat.slots[en.weapon]) {
      const w = combat.take(en.weapon);
      loot.drop(feet.clone(), [{ k: 'weapon', w: w.type, r: w.rarity, a: w.mag }]);
    }
  }
  const n = e.code.match(/^Digit([1-9])$/);
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
  const text = `Drop into my ${NAME} world 🧱🔫 — loot chests, build, fight. Open and play, no install`;
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
    rebuildAll();
    spawn();
    loot.init();
    combat.reset();
    pick(0);
    $('wname').textContent = `🌍 ${worldId}`;
    $('intro').hidden = true;
    for (const id of ['top', 'hotbar', 'hint', 'bars', 'ammo']) $(id).hidden = false;
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

    // Автоматическое оружие стреляет, пока зажата ЛКМ.
    const en = ENTRIES[slot], w = currentWeapon();
    if (mouseDown && controls.isLocked && w && WEAPONS[w.type].auto) combat.fire(en.weapon, now / 1000);
    combat.update(dt);
    loot.update(dt, now);

    // Подбор лута и подсказки.
    swapCandidate = loot.pickupNear(feet, combat);
    const eyePos = camera.getWorldPosition(new THREE.Vector3());
    const chest = controls.isLocked ? loot.chestNear(eyePos, camera.getWorldDirection(new THREE.Vector3())) : null;
    const prompt = chest ? 'E — open chest' : swapCandidate ? `G — swap for ${itemLabel(swapCandidate)}` : '';
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
    // Перестраиваем только задетые чанки, не больше 3 за кадр.
    if (dirtyChunks.size && now - lastRebuild > 40) {
      lastRebuild = now;
      for (const k of [...dirtyChunks].slice(0, 3)) rebuildChunk(k);
    }
    const hit = controls.isLocked && !w && !chest ? target() : null;
    outline.visible = !!hit;
    if (hit) outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    for (const o of others.values()) {
      o.group.position.lerp(new THREE.Vector3(o.target.x, o.target.y, o.target.z), 0.25);
      o.group.rotation.y = o.target.r;
    }
    sendPose(now);
    updateCrosshair(w, en);
  }
  renderer.render(scene, camera);
  if (world && (controls.isLocked || debugView)) {
    const w = currentWeapon();
    vm.set(w);
    vm.render(dt, { moving, reloading: !!combat.reloading, scoped: isScoped(), loaded: !!w && w.mag > 0 });
  }
});

let debugView = false;           // для скриншотов в тестах: рисовать оружие в руках без захвата мыши

// Прицел: 4 штриха расходятся по разбросу оружия (и шире на бегу/в прыжке); у дробовика — кольцо; в оптике и с руками — точка.
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
  get world() { return world; }, edits, get net() { return net; }, get others() { return others; }, peers, edit,
  combat, loot, pick,
  set debugView(v) { debugView = v; $('cross').hidden = !v; $('pause').hidden = v; },
  tp(x, z, up = 0) { feet.set(x, world.surfaceY(Math.floor(x), Math.floor(z)) + 0.01 + up, z); player.position.set(feet.x, feet.y + EYE, feet.z); },
  look(yaw, pitch = 0) { camera.rotation.set(pitch, yaw, 0, 'YXZ'); },
};
