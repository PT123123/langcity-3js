// 街具 + 植物 + 人物 + 动物：优先用原项目现成模型（Kenney/polypizza/原版 NPC），
// 模型缺失时回退程序化几何；Blob Shadow 贴地，可交互元数据挂 userData.meta
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { M, J, JPBR, glowMat, neonMat, signTexture, blobShadowTexture, glowTexture } from './materials.js';

// ---------- 现成模型库（public/models，来自 LangCity/assets，不自绘） ----------
const PROP_FILES = {
  // Kenney city-kit：载具/电杆/路灯/长椅/盆栽/花/草/栅栏
  car_sedan: 'kenney/sedan.glb', car_taxi: 'kenney/taxi.glb', car_van: 'kenney/van.glb',
  car_truck: 'kenney/truck.glb', car_suv: 'kenney/suv.glb', car_sports: 'kenney/hatchback-sports.glb',
  pole_a: 'kenney/elec_pole.glb', pole_b: 'kenney/elec_pole_wide.glb',
  lamp_a: 'kenney/light_curved.glb', lamp_b: 'kenney/light_curved_double.glb', lamp_c: 'kenney/light_square.glb',
  bench_a: 'kenney/bench.glb', bench_b: 'kenney/bench_short.glb',
  planter_pot: 'kenney/pottedPlant.glb', planter_box: 'kenney/planter.glb',
  bush_s: 'kenney/plant_bushSmall.glb', bush_m: 'kenney/plant_bush.glb', bush_l: 'kenney/plant_bushLarge.glb',
  flower_r: 'kenney/flower_redA.glb', flower_y: 'kenney/flower_yellowA.glb', flower_p: 'kenney/flower_purpleA.glb',
  grass_a: 'kenney/grass.glb', grass_b: 'kenney/grass_large.glb',
  fence_low: 'kenney/fence_low.glb', traffic_light: 'kenney/traffic_light.glb',
  // polypizza：消防栓/自行车/麻雀（带贴图）
  hydrant: 'polypizza/fire_hydrant.glb',
  bicycle: 'polypizza/bicycle.glb',
  sparrow: 'polypizza/sparrow.glb',
  // 原版动物 + NPC（骨骼模型，含 idle 动画则自动播放）
  husky: 'animals/Husky.gltf',
  fox: 'animals/Fox.gltf',
  npc_0: 'npcs/oldwoman.glb', npc_1: 'npcs/office-worker.glb', npc_2: 'npcs/young-lady.glb',
  npc_3: 'npcs/threekid.glb', npc_4: 'npcs/chef.glb', npc_5: 'npcs/scout.glb', npc_6: 'npcs/musician.glb',
};

const propLib = new Map(); // key -> { scene, animations }
export function preloadProps() {
  const loader = new GLTFLoader();
  const jobs = Object.entries(PROP_FILES).map(([key, url]) =>
    new Promise(res => loader.load(`./models/${url}`,
      gltf => { gltf.scene.updateMatrixWorld(true); propLib.set(key, gltf); res(); },
      undefined,
      () => { console.warn('[props] 加载失败，走程序化兜底:', url); res(); })
    ));
  return Promise.all(jobs);
}

/** 实例化现成模型：底部贴地、XZ 居中、按目标高度归一；库中没有返回 null（调用方兜底） */
function prop(key, { h = 1, rotY = 0 } = {}) {
  const gltf = propLib.get(key);
  if (!gltf) return null;
  const src = gltf.animations?.length
    ? SkeletonUtils.clone(gltf.scene)
    : gltf.scene.clone(true);
  src.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 1e-4) src.scale.multiplyScalar(h / size.y);
  const box2 = new THREE.Box3().setFromObject(src);
  const c = box2.getCenter(new THREE.Vector3());
  src.position.x -= c.x;
  src.position.z -= c.z;
  src.position.y -= box2.min.y;
  if (rotY) src.rotation.y = rotY;
  const root = new THREE.Group();
  root.add(src);
  return root;
}

/** 骨骼模型的 idle 动画：找到就挂 AnimationMixer，tick 里推进 */
function attachIdle(root, key) {
  const gltf = propLib.get(key);
  const clips = gltf?.animations || [];
  if (!clips.length) return;
  const clip = clips.find(c => /idle/i.test(c.name)) || clips[0];
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  root.userData.tick = (t, dt) => mixer.update(dt);
}

function sh(m) { m.castShadow = true; m.receiveShadow = true; return m; }
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = sh(new THREE.Mesh(geo, mat));
  m.position.set(x, y, z);
  return m;
}

/** 贴地 blob shadow（小物件不投实时影，防止"浮空感"） */
export function blobShadow(radius = 0.5, y = 0.012) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = 2;
  return m;
}

function finish(g, meta) { g.userData.meta = meta; return g; }
function addGlow(g, x, y, z, scale = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  s.position.set(x, y, z);
  s.scale.setScalar(scale);
  s.userData.isGlow = true;
  g.add(s);
  return s;
}
export function collectGlows(root) {
  const out = [];
  root.traverse(o => { if (o.userData.isGlow) out.push(o); });
  return out;
}

// ---------- 街具 ----------
export function buildVendingMachine(seed = 'v') {
  const g = new THREE.Group();
  const body = J(0xc94f4f, 0.35, 0.1, seed + 'b');
  g.add(mesh(new THREE.BoxGeometry(0.92, 1.78, 0.68), body, 0, 0.89, 0));
  const panel = glowMat(0xbfe0e8, { rough: 0.2, map: texVending(), intensity: 1.0 });
  g.add(mesh(new THREE.BoxGeometry(0.78, 1.5, 0.04), panel, -0.03, 1.02, 0.35));
  g.add(mesh(new THREE.BoxGeometry(0.8, 0.16, 0.1), M(0xdad4c8, { rough: 0.5 }), -0.03, 0.18, 0.35)); // 取物口
  addGlow(g, 0, 1.2, 0.5, 1.4);
  g.add(blobShadow(0.7));
  return finish(g, { kind: 'vending', word: 'vending', ja: '自動販売機', r: 1.7 });
}
let _vendTex = null;
function texVending() {
  if (_vendTex) return _vendTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8f2f4'; ctx.fillRect(0, 0, 128, 256);
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
    ctx.fillStyle = ['#d98a6a', '#a8c0b8', '#e0c98a', '#b8a0c8'][(r * 3 + col) % 4];
    ctx.fillRect(10 + col * 38, 16 + r * 46, 30, 36);
  }
  ctx.fillStyle = '#4a4238'; ctx.fillRect(10, 170, 108, 46);
  ctx.fillStyle = '#e8f2f4'; ctx.font = '700 20px sans-serif'; ctx.fillText('ドリンク', 22, 200);
  _vendTex = new THREE.CanvasTexture(c);
  _vendTex.colorSpace = THREE.SRGBColorSpace;
  return _vendTex;
}

/** 路灯：Kenney 灯杆 + 灯头自发光（灯头位置由包围盒顶推算） */
export function buildStreetlight(seed = 'l') {
  const g = prop(['lamp_a', 'lamp_b', 'lamp_c'][Math.abs(hashCode(seed)) % 3], { h: 3.2 })
    || (() => {
      const gg = new THREE.Group();
      const poleMat = J(0x4a4e50, 0.42, 0.85, seed);
      gg.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.1, 8), poleMat, 0, 1.55, 0));
      gg.add(mesh(new THREE.BoxGeometry(0.32, 0.1, 0.2), poleMat, 0.4, 3.05, 0));
      return gg;
    })();
  // 灯头：包围盒顶 + 臂侧放自发光灯泡 + 光晕
  const box = new THREE.Box3().setFromObject(g);
  const bx = box.max.x - box.min.x > 0.3 ? (box.max.x - box.min.x) * 0.72 : 0;
  const bulb = mesh(new THREE.BoxGeometry(0.22, 0.06, 0.14), glowMat(0xffd9a0, { rough: 0.4, intensity: 1.2 }), bx, box.max.y - box.min.y - 0.06, 0);
  g.add(bulb);
  addGlow(g, bx, box.max.y - box.min.y - 0.2, 0, 1.2);
  g.add(blobShadow(0.35));
  return finish(g, { kind: 'streetlight', word: 'streetlight', ja: '街灯', r: 1.4 });
}

export function buildPole(seed = 'p') {
  const g = prop(['pole_a', 'pole_b'][Math.abs(hashCode(seed)) % 2], { h: 4.6 })
    || (() => {
      const gg = new THREE.Group();
      const mat = J(0x5a5e60, 0.42, 0.85, seed);
      gg.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 8), mat, 0, 2.3, 0));
      gg.add(mesh(new THREE.BoxGeometry(1.15, 0.07, 0.07), mat, 0, 4.05, 0));
      return gg;
    })();
  g.add(blobShadow(0.4));
  return finish(g, { kind: 'pole', word: 'pole', ja: '電柱', r: 1.2 });
}

export function buildBusStop(seed = 'bs') {
  const g = new THREE.Group();
  const mat = J(0x6a7a80, 0.5, 0.6, seed);
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8), mat, -0.5, 1.1, 0));
  g.add(mesh(new THREE.BoxGeometry(1.1, 0.06, 0.5), mat, -0.1, 2.2, 0));
  const tex = signTexture('バス停', { bg: '#e8e2d2', fg: '#4a4238' });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  face.position.set(-0.1, 1.75, 0.06);
  g.add(face);
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.05, 0.42), M(0x9a7a58, { rough: 0.76 }), -0.1, 0.95, 0));
  g.add(blobShadow(0.6));
  return finish(g, { kind: 'busstop', word: 'busstop', ja: 'バス停', r: 1.2 });
}

export function buildBench(seed = 'b') {
  const g = prop(['bench_a', 'bench_b'][Math.abs(hashCode(seed)) % 2], { h: 0.85, rotY: Math.PI / 2 })
    || (() => {
      const gg = new THREE.Group();
      const wood = J(0x9a7a58, 0.76, 0, seed);
      const legMat = M(0x4a4e50, { rough: 0.5, metal: 0.6 });
      for (const dx of [-0.62, 0.62]) gg.add(mesh(new THREE.BoxGeometry(0.07, 0.42, 0.5), legMat, dx, 0.21, 0));
      gg.add(mesh(new THREE.BoxGeometry(1.5, 0.06, 0.48), wood, 0, 0.44, 0));
      gg.add(mesh(new THREE.BoxGeometry(1.5, 0.4, 0.05), wood, 0, 0.68, -0.22));
      return gg;
    })();
  g.add(blobShadow(0.85));
  return finish(g, { kind: 'bench', word: 'bench', ja: 'ベンチ', r: 1.5 });
}

export function buildMailbox(seed = 'm') {
  const g = new THREE.Group();
  const mat = M(0xc94f4f, { rough: 0.45, metal: 0.05 });
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.55, 12), mat, 0, 0.48, 0));
  const top = sh(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat));
  top.position.y = 0.755; g.add(top);
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.03, 0.05), M(0xf0e8d8, { rough: 0.6 }), 0, 0.78, 0.16));
  g.add(blobShadow(0.3));
  return finish(g, { kind: 'mailbox', word: 'mailbox', ja: 'ポスト', r: 1.0 });
}

export function buildTrash(seed = 't') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.72, 12), JPBR('metal_iron', { rx: 2, ry: 1, rough: 0.55, metal: 0.6 }, seed), 0, 0.36, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12), M(0x4a4e50, { rough: 0.5, metal: 0.7 }), 0, 0.74, 0));
  g.add(blobShadow(0.36));
  return finish(g, { kind: 'trash', word: 'trash', ja: 'ゴミ箱', r: 1.0 });
}

const SIGN_TEXTS = ['すずめ堂', 'やま田歯科', 'たこ焼き', '理髪店', 'コインランドリー', '文房具'];
export function buildSignboard(seed = 's', opts = {}) {
  const idx = opts.idx || 0;
  const g = new THREE.Group();
  const wood = J(0x8a6a4a, 0.76, 0, seed);
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8), wood, 0, 0.85, 0));
  const board = mesh(new THREE.BoxGeometry(0.62, 1.15, 0.06), M(0xf0e8d8, { rough: 0.9 }), 0, 1.55, 0);
  g.add(board);
  const tex = signTexture(SIGN_TEXTS[idx % SIGN_TEXTS.length], { vertical: true, bg: '#f5efe2', fg: '#4a4238', accent: '#c94f4f' });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 1.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  face.position.set(0, 1.55, 0.035);
  g.add(face);
  g.add(blobShadow(0.28));
  return finish(g, { kind: 'signboard', word: 'signboard', ja: '看板', r: 1.0 });
}

export function buildPlanter(seed = 'pl') {
  const key = ['planter_pot', 'planter_box', 'bush_s'][Math.abs(hashCode(seed)) % 3];
  const g = prop(key, { h: 0.55 });
  if (!g) {
    const gg = new THREE.Group();
    gg.add(mesh(new THREE.BoxGeometry(0.9, 0.34, 0.42), J(0xb5ab9c, 0.88, 0, seed), 0, 0.17, 0));
    const cols = [0xc98a8a, 0xd9b26a, 0xc9c0e0];
    for (let i = 0; i < 5; i++) {
      const f = sh(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), M(cols[i % 3], { rough: 0.8 })));
      f.position.set(-0.32 + i * 0.16, 0.44, (i % 2 - 0.5) * 0.14);
      gg.add(f);
    }
    return finish(gg, { kind: 'planter', word: 'hachiue', ja: '鉢植え', r: 1.1 });
  }
  g.add(blobShadow(0.55));
  return finish(g, { kind: 'planter', word: 'hachiue', ja: '鉢植え', r: 1.1 });
}

export function buildFireplug(seed = 'f') {
  const g = prop('hydrant', { h: 0.72 })
    || (() => {
      const gg = new THREE.Group();
      const mat = M(0xc9564f, { rough: 0.45, metal: 0.1 });
      gg.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.55, 10), mat, 0, 0.28, 0));
      gg.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), mat, 0, 0.6, 0));
      return gg;
    })();
  g.add(blobShadow(0.24));
  return finish(g, { kind: 'fireplug', word: 'shoukasen', ja: '消火栓', r: 0.8 });
}

export function buildLaundry(seed = 'l') {
  const g = new THREE.Group();
  const mat = J(0x8a8e90, 0.5, 0.7, seed);
  for (const dx of [-1.05, 1.05]) {
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.85, 8), mat, dx, 0.93, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), mat, dx, 1.82, 0).rotateZ(Math.PI / 2));
  }
  const clothCols = [0xd9d4cb, 0xa8c0d0, 0xe0c98a, 0xd8b8c0, 0xc0d0b8];
  for (let i = 0; i < 5; i++) {
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.42),
      M(clothCols[i], { rough: 0.95, doubleSided: true })
    );
    cloth.position.set(-0.72 + i * 0.36, 1.56, 0);
    cloth.rotation.y = (i % 2 ? 0.08 : -0.06);
    g.add(cloth);
  }
  g.add(blobShadow(0.5));
  return finish(g, { kind: 'laundry', word: 'monoboshizao', ja: '物干し竿', r: 1.6 });
}

const CARS = ['car_sedan', 'car_taxi', 'car_van', 'car_truck', 'car_suv', 'car_sports'];
export function buildCar(seed = 'car') {
  const g = prop(CARS[Math.abs(hashCode(seed)) % CARS.length], { h: 1.35 })
    || (() => {
      const gg = new THREE.Group();
      const cols = [0xa8b8c0, 0xc9b8a0, 0x9aA8a0, 0xb8a0a0];
      const bodyMat = J(cols[Math.abs(hashCode(seed)) % cols.length], 0.5, 0.15, seed);
      gg.add(mesh(new THREE.BoxGeometry(1.65, 0.5, 0.78), bodyMat, 0, 0.42, 0));
      gg.add(mesh(new THREE.BoxGeometry(0.85, 0.42, 0.7), bodyMat, -0.05, 0.85, 0));
      const wheelMat = M(0x2e2c2a, { rough: 0.92 });
      for (const [wx, wz] of [[-0.55, 0.36], [0.55, 0.36], [-0.55, -0.36], [0.55, -0.36]]) {
        const w = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 12), wheelMat, wx, 0.17, wz);
        w.rotation.x = Math.PI / 2;
        gg.add(w);
      }
      return gg;
    })();
  g.add(blobShadow(1.0));
  return finish(g, { kind: 'car', word: 'car', ja: '車', r: 1.8 });
}

export function buildBicycle(seed = 'bi') {
  const g = prop('bicycle', { h: 1.0 })
    || (() => {
      const gg = new THREE.Group();
      const frameMat = J(0x8a9aa0, 0.5, 0.4, seed);
      const tireMat = M(0x2e2c2a, { rough: 0.92 });
      for (const dx of [-0.28, 0.28]) {
        const w = mesh(new THREE.TorusGeometry(0.19, 0.03, 8, 18), tireMat, dx, 0.22, 0);
        w.rotation.y = Math.PI / 2;
        gg.add(w);
      }
      return gg;
    })();
  g.add(blobShadow(0.4));
  return finish(g, { kind: 'bicycle', word: 'bicycle', ja: '自転車', r: 1.0 });
}

const NPC_KEYS = ['npc_0', 'npc_1', 'npc_2', 'npc_3', 'npc_4', 'npc_5', 'npc_6'];
/** 原版角色（骨骼 + idle 动画），缺失时回退程序化人形 */
export function buildNpc(seed = 'n', opts = {}) {
  const variant = (opts.variant || 0) % NPC_KEYS.length;
  const key = NPC_KEYS[Math.abs(hashCode(seed) + variant) % NPC_KEYS.length];
  const g = prop(key, { h: 1.62 });
  if (!g) {
    const gg = new THREE.Group();
    const shirt = [0x8a9aa8, 0xc9b8a0, 0x9aa89a, 0xc9a0a0, 0xa8a0c0][variant % 5];
    const pants = [0x5a5a60, 0x6a5a4a, 0x4a4e50][variant % 3];
    const skin = M(0xe0c0a8, { rough: 0.8 });
    gg.add(mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.72, 10), M(shirt, { rough: 0.85 }), 0, 1.06, 0));
    gg.add(mesh(new THREE.SphereGeometry(0.13, 12, 10), skin, 0, 1.55, 0));
    for (const dx of [-0.08, 0.08]) gg.add(mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.68, 8), M(pants, { rough: 0.9 }), dx, 0.34, 0));
    gg.userData.tick = (t) => { gg.rotation.z = Math.sin(t * 1.2 + hashCode(seed) % 10) * 0.02; };
    gg.add(blobShadow(0.32));
    return finish(gg, { kind: 'npc', word: null, ja: null, r: 1.0 });
  }
  attachIdle(g, key);
  g.add(blobShadow(0.32));
  return finish(g, { kind: 'npc', word: null, ja: null, r: 1.0 });
}

export function buildDog(seed = 'd') { return quadruped('husky', 'dog', '犬', 0.55, seed); }
export function buildFox(seed = 'fx') { return quadruped('fox', 'kitsune', '狐', 0.45, seed); }

function quadruped(key, word, ja, h, seed) {
  const g = prop(key, { h })
    || (() => {
      const gg = new THREE.Group();
      const fur = J(0xb08d68, 0.85, 0, seed);
      gg.add(mesh(new THREE.BoxGeometry(0.52, 0.24, 0.22), fur, 0, 0.32, 0));
      gg.add(mesh(new THREE.BoxGeometry(0.2, 0.18, 0.18), fur, 0.3, 0.44, 0));
      return gg;
    })();
  attachIdle(g, key);
  g.add(blobShadow(0.35));
  return finish(g, { kind: 'dog', word, ja, r: 1.0 });
}

export function buildBird(seed = 'bd') {
  const g = prop('sparrow', { h: 0.16 })
    || (() => {
      const gg = new THREE.Group();
      const mat = M(0x8a8478, { rough: 0.9 });
      gg.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), mat, 0, 0.1, 0));
      gg.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), mat, 0, 0.19, 0.02));
      return gg;
    })();
  g.userData.tick = (t) => { g.position.y = Math.abs(Math.sin(t * 3 + hashCode(seed) % 7)) * 0.02; };
  g.add(blobShadow(0.12));
  return finish(g, { kind: 'bird', word: 'bird', ja: '鳥', r: 0.7 });
}

export function buildBoat(seed = 'bo') {
  const g = new THREE.Group();
  const hullMat = J(0x9a7a58, 0.8, 0, seed);
  const hull = mesh(new THREE.CylinderGeometry(0.5, 0.3, 1.7, 5), hullMat, 0, 0.25, 0);
  hull.rotation.z = Math.PI / 2; hull.scale.y = 1; hull.scale.x = 0.55;
  g.add(hull);
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), hullMat, 0, 0.7, 0));
  const sail = mesh(new THREE.PlaneGeometry(0.7, 0.85), M(0xf0e8d8, { rough: 0.95, doubleSided: true }), 0.05, 1.15, 0);
  g.add(sail);
  return finish(g, { kind: 'boat', word: 'fune', ja: '船', r: 1.6 });
}

export function buildFountain(seed = 'fo') {
  const g = new THREE.Group();
  const stone = J(0xb5ab9c, 0.88, 0, seed);
  g.add(mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.4, 20), stone, 0, 0.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 20), M(0x7fb3b5, { rough: 0.2, metal: 0.1 }), 0, 0.38, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 10), stone, 0, 0.6, 0));
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xbfe0e8, roughness: 0.15, transparent: true, opacity: 0.7 }));
  jet.position.y = 1.3; jet.rotation.x = Math.PI;
  g.add(jet);
  g.add(blobShadow(1.4));
  return finish(g, { kind: 'fountain', word: 'funsui', ja: '噴水', r: 2.2 });
}

// ---------- 植物 ----------
const LEAF_A = 0x8fa876, LEAF_B = 0x7d9a6c, LEAF_C = 0x6f8b60;

export function buildTree(seed = 't', opts = {}) {
  const scale = opts.scale || 1;
  const g = new THREE.Group();
  const h = 1.4 * scale;
  g.add(mesh(new THREE.CylinderGeometry(0.09 * scale, 0.14 * scale, h, 8), J(0x7a5f48, 0.8, 0, seed + 'k'), 0, h / 2, 0));
  const leafMat = J([LEAF_A, LEAF_B, LEAF_C][Math.abs(hashCode(seed)) % 3], 0.82, 0, seed + 'l', { flatShading: true });
  let cy = h + 0.28 * scale;
  for (let i = 0; i < 3; i++) {
    const r = (0.75 - i * 0.17) * scale;
    const blob = sh(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat));
    blob.scale.y = 0.8;
    blob.position.set((Math.random() - 0.5) * 0.24 * scale, cy, (Math.random() - 0.5) * 0.24 * scale);
    g.add(blob);
    cy += r * 1.05;
  }
  g.add(blobShadow(0.8 * scale));
  return finish(g, { kind: 'tree', word: 'tree', ja: '木', r: 1.3 });
}

export function buildSakura(seed = 's', opts = {}) {
  const scale = opts.scale || 1;
  const g = new THREE.Group();
  const h = 1.5 * scale;
  const trunk = mesh(new THREE.CylinderGeometry(0.1 * scale, 0.16 * scale, h, 8), M(0x6f5545, { rough: 0.85 }), 0, h / 2, 0);
  trunk.rotation.z = 0.05;
  g.add(trunk);
  const petalMat = J(0xe8c9cf, 0.9, 0, seed + 'p', { flatShading: true });
  let cy = h + 0.3 * scale;
  for (let i = 0; i < 3; i++) {
    const r = (0.8 - i * 0.18) * scale;
    const blob = sh(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), petalMat));
    blob.scale.y = 0.72;
    blob.position.set((Math.random() - 0.5) * 0.4 * scale, cy, (Math.random() - 0.5) * 0.4 * scale);
    g.add(blob);
    cy += r * 0.9;
  }
  // 树下落樱地毯
  const carpet = new THREE.Mesh(new THREE.CircleGeometry(1.1 * scale, 18), new THREE.MeshStandardMaterial({ color: 0xe8c9cf, roughness: 0.95, transparent: true, opacity: 0.5 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.y = 0.015;
  carpet.renderOrder = 1;
  g.add(carpet);
  // 飘落花瓣（Points，春の空気感）—— 性能档:30 片/树,尺寸略补
  const N = 30;
  const pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pts[i * 3] = (Math.random() - 0.5) * 2.6 * scale;
    pts[i * 3 + 1] = Math.random() * 2.4 * scale;
    pts[i * 3 + 2] = (Math.random() - 0.5) * 2.6 * scale;
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const pmat = new THREE.PointsMaterial({ color: 0xf0d4da, size: 0.065, transparent: true, opacity: 0.8, depthWrite: false });
  const points = new THREE.Points(pgeo, pmat);
  g.add(points);
  g.userData.petals = points;
  g.userData.tick = (t, dt) => {
    const a = pgeo.attributes.position;
    for (let i = 0; i < N; i++) {
      let y = a.getY(i) - dt * 0.35;
      if (y < 0) y = 2.4 * scale;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(t + i) * dt * 0.08);
    }
    a.needsUpdate = true;
  };
  g.add(blobShadow(0.9 * scale));
  return finish(g, { kind: 'sakura', word: 'sakura', ja: '桜', r: 1.6 });
}

export function buildBush(seed = 'bu') {
  const g = prop(['bush_s', 'bush_m', 'bush_l'][Math.abs(hashCode(seed)) % 3], { h: 0.6 });
  if (g) {
    g.add(blobShadow(0.45));
    return finish(g, { kind: 'bush', word: null, ja: null, r: 0.9 });
  }
  const b = sh(new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), J(0x6f8b60, 0.88, 0, seed, { flatShading: true })));
  b.scale.y = 0.7; b.position.y = 0.25;
  const gg = new THREE.Group();
  gg.add(b);
  gg.add(blobShadow(0.45));
  return finish(gg, { kind: 'bush', word: null, ja: null, r: 0.9 });
}

const FLOWERS = ['flower_r', 'flower_y', 'flower_p'];
export function buildFlowerPatch(seed = 'fl') {
  const g = new THREE.Group();
  let used = 0;
  for (let i = 0; i < 3; i++) {
    const f = prop(FLOWERS[i], { h: 0.32 });
    if (!f) continue;
    used++;
    const a = i * 2.1;
    f.position.set(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16);
    g.add(f);
  }
  if (!used) {
    const cols = [0xc98a8a, 0xe0c98a, 0xc9c0e0, 0xd98a6a];
    for (let i = 0; i < 6; i++) {
      const f = sh(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M(cols[i % 4], { rough: 0.85 })));
      const a = i * 1.7, r = 0.15 + (i % 3) * 0.12;
      f.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
      g.add(f);
    }
  }
  return finish(g, { kind: 'flower', word: 'flower', ja: '花', r: 0.8 });
}

export function buildGrassTuft(seed = 'g') {
  const g = prop(['grass_a', 'grass_b'][Math.abs(hashCode(seed)) % 2], { h: 0.28 });
  if (g) return finish(g, { kind: 'grass', word: 'grass', ja: '草', r: 0.6 });
  const gg = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const blade = mesh(new THREE.ConeGeometry(0.03, 0.16 + Math.random() * 0.1, 4), J(0x7d9a6c, 0.9, 0, seed + i));
    blade.position.set((Math.random() - 0.5) * 0.2, 0.08, (Math.random() - 0.5) * 0.2);
    blade.rotation.z = (Math.random() - 0.5) * 0.4;
    gg.add(blade);
  }
  return finish(gg, { kind: 'grass', word: 'grass', ja: '草', r: 0.6 });
}

function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
