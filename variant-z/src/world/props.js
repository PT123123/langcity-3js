// 街具 + 植物 + 人物 + 动物：优先用原项目现成模型（Kenney/polypizza/原版 NPC），
// 模型缺失时回退程序化几何；Blob Shadow 贴地，可交互元数据挂 userData.meta
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { M, J, JPBR, glowMat, neonMat, signTexture, windowTexture, blobShadowTexture, glowTexture } from './materials.js';
import { handTex, handRough } from './textures.js';
import { hdMaterial } from './handDrawn.js';

// ---------- 现成模型库（public/models，来自 LangCity/assets，不自绘） ----------
const PROP_FILES = {
  // Kenney city-kit：载具/电杆/路灯/长椅/盆栽/花/草/栅栏
  car_sedan: 'kenney/sedan.glb', car_taxi: 'kenney/taxi.glb', car_van: 'kenney/van.glb',
  car_truck: 'kenney/truck.glb', car_suv: 'kenney/suv.glb', car_sports: 'kenney/hatchback-sports.glb',
  // elec_pole / elec_pole_wide 不在这里：那是「两杆一档垂弧」，见 buildPole 的说明
  lamp_a: 'kenney/light_curved.glb', lamp_b: 'kenney/light_curved_double.glb', lamp_c: 'kenney/light_square.glb',
  bench_a: 'kenney/bench.glb', bench_b: 'kenney/bench_short.glb',
  planter_pot: 'kenney/pottedPlant.glb', planter_box: 'kenney/planter.glb',
  bush_s: 'kenney/plant_bushSmall.glb', bush_m: 'kenney/plant_bush.glb', bush_l: 'kenney/plant_bushLarge.glb',
  flower_r: 'kenney/flower_redA.glb', flower_y: 'kenney/flower_yellowA.glb', flower_p: 'kenney/flower_purpleA.glb',
  grass_a: 'kenney/grass.glb', grass_b: 'kenney/grass_large.glb',
  fence_low: 'kenney/fence_low.glb', traffic_light: 'kenney/traffic_light.glb',
  rocks_s: 'kenney/rocks_small.glb', rocks_m: 'kenney/rocks_medium.glb', rocks_l: 'kenney/rocks_large.glb',
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

// Kenney 植物件（盆栽/花/草）引用的 colormap 图集在仓库里是缺的，GLB 里那层叶子只剩
// baseColorFactor 的荧光青 #73eddd/#76eac8，摆在街上像一地青色纸飞机。按这两个色号认出
// 来换成手绘叶材：hdMaterial 不打 map、只挂 userData.hd，mseSwap 会按世界坐标三平面注入
// 叶纹，正好绕开那套指向丢失图集的 UV。
const KENNEY_LEAF_CYAN = new Set([0x73eddd, 0x76eac8]);
function fixLeafless(root) {
  root.traverse(o => {
    if (!o.isMesh || !o.material?.color || !KENNEY_LEAF_CYAN.has(o.material.color.getHex())) return;
    o.material = hdMaterial({ kind: 'foliage', color: 0x6f8b60, rough: 0.92 });
  });
}

// Kenney city-kit 的 GLB 只剩 baseColorFactor，而它引用的 colormap 图集不在仓库里
// （实测 23 个件里 maps 全为 0/5、0/1…），于是车、长椅、栅栏、信号灯、路灯、岩石
// 在场景里一律纯白：平涂 shader 对受光面还要加环境项，白件直接被烧成一堆塑料玩具，
// 街边停一排白车比没车还假。按 key 认领一套手绘件色，走和 fixLeafless 同一条路：
// 换材质而不是改 color —— 同一个 GLB 的所有克隆共享材质实例，改色会互相污染。
const KENNEY_PAINT = {
  car_sedan: 0x9fb4c0, car_van: 0xd8d2c4, car_suv: 0x8f9a8a,
  car_sports: 0xb5504a, car_truck: 0x6f8fa8, car_taxi: 0xe0b53c,
  bench_a: 0x9a7a58, bench_b: 0x8a6f52,
  fence_low: 0x8a9298, traffic_light: 0x3a4046,
  lamp_a: 0x6a6e70, lamp_b: 0x6a6e70, lamp_c: 0x6a6e70,
  rocks_s: 0x8d867c, rocks_m: 0x847d73, rocks_l: 0x8d867c,
  planter_box: 0xb5ab9c,
};
const KENNEY_KIND = {
  bench_a: 'paintedWood', bench_b: 'paintedWood', fence_low: 'brushedMetal',
  traffic_light: 'castIron', lamp_a: 'paintedMetal', lamp_b: 'paintedMetal', lamp_c: 'paintedMetal',
  rocks_s: 'stone', rocks_m: 'stone', rocks_l: 'stone', planter_box: 'terracotta',
};
const _paintCache = new Map();
function kennyPartMat(key, part) {
  const ck = key + '|' + part;
  if (_paintCache.has(ck)) return _paintCache.get(ck);
  const kind = KENNEY_KIND[key] || 'paintedMetal';
  const m = part === 'rubber' ? hdMaterial({ kind: 'rubber', color: 0x2e2c2a, rough: 0.95 })
    : part === 'glass' ? hdMaterial({ kind: 'glass', color: 0x37424a, rough: 0.24 })
    : hdMaterial({ kind, color: KENNEY_PAINT[key], rough: kind === 'paintedMetal' ? 0.45 : 0.8 });
  _paintCache.set(ck, m);
  return m;
}
function paintWhiteParts(root, key) {
  if (KENNEY_PAINT[key] === undefined) return;
  root.traverse(o => {
    if (!o.isMesh || !o.material?.color || o.material.color.getHex() !== 0xffffff) return;
    const n = (o.name || '').toLowerCase();
    o.material = /wheel|tire/.test(n) ? kennyPartMat(key, 'rubber')
      : /wind|glass|window/.test(n) ? kennyPartMat(key, 'glass')
      : kennyPartMat(key, 'body');
  });
}

/** 实例化现成模型：底部贴地、XZ 居中、按目标高度归一；库中没有返回 null（调用方兜底） */
function prop(key, { h = 1, rotY = 0 } = {}) {
  const gltf = propLib.get(key);
  if (!gltf) return null;
  const src = gltf.animations?.length ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true);
  src.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  fixLeafless(src);
  paintWhiteParts(src, key);
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
  const body = J(0xc94f4f, 0.35, 0.1, seed + 'b', { map: handTex('vermilion') });
  g.add(mesh(new THREE.BoxGeometry(0.92, 1.78, 0.68), body, 0, 0.89, 0));
  const panel = glowMat(0xbfe0e8, { rough: 0.2, map: texVending(), intensity: 1.0 });
  g.add(mesh(new THREE.BoxGeometry(0.78, 1.5, 0.04), panel, -0.03, 1.02, 0.35));
  g.add(mesh(new THREE.BoxGeometry(0.8, 0.16, 0.1), M(0xdad4c8, { rough: 0.5, map: handTex('plastic') }), -0.03, 0.18, 0.35)); // 取物口
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
      const poleMat = J(0x4a4e50, 0.42, 0.85, seed, { map: handTex('metal') });
      gg.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.1, 8), poleMat, 0, 1.55, 0));
      gg.add(mesh(new THREE.BoxGeometry(0.32, 0.1, 0.2), poleMat, 0.4, 3.05, 0));
      return gg;
    })();
  // 灯头：包围盒顶 + 悬臂那一端放自发光灯泡 + 光晕。悬臂可能朝 X 也可能朝 Z
  //（light_curved_double 的双臂沿 Z 伸出 1.9 m），只按 X 摆会把灯泡挂到杆子侧面悬空。
  const box = new THREE.Box3().setFromObject(g);
  const ex = box.max.x - box.min.x, ez = box.max.z - box.min.z;
  const arm = Math.max(ex, ez) > 0.3 ? Math.max(ex, ez) * 0.72 : 0;
  const [bx, bz] = ex >= ez ? [arm, 0] : [0, arm];
  const bulb = mesh(new THREE.BoxGeometry(0.22, 0.06, 0.14), glowMat(0xffd9a0, { rough: 0.4, intensity: 1.2 }), bx, box.max.y - box.min.y - 0.06, bz);
  g.add(bulb);
  addGlow(g, bx, box.max.y - box.min.y - 0.2, bz, 1.2);
  g.add(blobShadow(0.35));
  return finish(g, { kind: 'streetlight', word: 'streetlight', ja: '街灯', r: 1.4 });
}

export function buildPole(seed = 'p') {
  // Kenney 的 elec_pole / elec_pole_wide 不是「一根电线杆」，是「两根杆 + 一档垂弧」：
  // 实测包围盒 0.58×0.52 和 1.08×0.52，宽都大于高。prop() 按高度归一到 4.6 m 后，
  // 它变成 5~9 m 宽、横在街面和别人家屋顶上方的白管子，两头都不接线——
  // 全图那批「半空电线 / 巨型白杆」就是它。电杆改走程序化单杆：
  // 占地收回 meta.r=1.2 的落点半径内，横担只有 1.7 m，不会再跨到邻街。
  const gg = new THREE.Group();
  const mat = J(0x9a948a, 0.9, 0, seed, { map: handTex('concrete'), roughnessMap: handRough('concrete') });
  const steel = M(0x5a5e60, { rough: 0.55, metal: 0.5, map: handTex('metal') });
  gg.add(mesh(new THREE.CylinderGeometry(0.085, 0.115, 6.2, 10), mat, 0, 3.1, 0));
  for (const [y, w] of [[5.5, 1.7], [4.85, 1.35]]) {
    gg.add(mesh(new THREE.BoxGeometry(w, 0.075, 0.075), steel, 0, y, 0));
    for (const sx of [-1, 1]) {
      gg.add(mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.16, 8), steel, sx * (w / 2 - 0.12), y - 0.11, 0));
    }
  }
  gg.add(mesh(new THREE.BoxGeometry(0.26, 0.34, 0.2), M(0x77726a, { rough: 0.85, map: handTex('metal') }), 0.2, 3.6, 0.14));
  gg.add(blobShadow(0.4));
  return finish(gg, { kind: 'pole', word: 'pole', ja: '電柱', r: 1.2 });
}

export function buildBusStop(seed = 'bs') {
  const g = new THREE.Group();
  const mat = J(0x6a7a80, 0.5, 0.6, seed, { map: handTex('metal') });
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8), mat, -0.5, 1.1, 0));
  g.add(mesh(new THREE.BoxGeometry(1.1, 0.06, 0.5), mat, -0.1, 2.2, 0));
  const tex = signTexture('バス停', { bg: '#e8e2d2', fg: '#4a4238' });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  face.position.set(-0.1, 1.75, 0.06);
  g.add(face);
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.05, 0.42), M(0x9a7a58, { rough: 0.76, map: handTex('wood') }), -0.1, 0.95, 0));
  g.add(blobShadow(0.6));
  return finish(g, { kind: 'busstop', word: 'busstop', ja: 'バス停', r: 1.2 });
}

export function buildBench(seed = 'b') {
  const g = prop(['bench_a', 'bench_b'][Math.abs(hashCode(seed)) % 2], { h: 0.85, rotY: Math.PI / 2 })
    || (() => {
      const gg = new THREE.Group();
      const wood = J(0x9a7a58, 0.76, 0, seed, { map: handTex('wood') });
      const legMat = M(0x4a4e50, { rough: 0.5, metal: 0.6, map: handTex('metal') });
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
  const mat = M(0xc94f4f, { rough: 0.45, metal: 0.05, map: handTex('vermilion') });
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.55, 12), mat, 0, 0.48, 0));
  const top = sh(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat));
  top.position.y = 0.755; g.add(top);
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.03, 0.05), M(0xf0e8d8, { rough: 0.6, map: handTex('paper') }), 0, 0.78, 0.16));
  g.add(blobShadow(0.3));
  return finish(g, { kind: 'mailbox', word: 'mailbox', ja: 'ポスト', r: 1.0 });
}

export function buildTrash(seed = 't') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.72, 12), JPBR('metal_iron', { rx: 2, ry: 1, rough: 0.55, metal: 0.6 }, seed), 0, 0.36, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12), M(0x4a4e50, { rough: 0.5, metal: 0.7, map: handTex('metal') }), 0, 0.74, 0));
  g.add(blobShadow(0.36));
  return finish(g, { kind: 'trash', word: 'trash', ja: 'ゴミ箱', r: 1.0 });
}

const SIGN_TEXTS = ['すずめ堂', 'やま田歯科', 'たこ焼き', '理髪店', 'コインランドリー', '文房具'];
export function buildSignboard(seed = 's', opts = {}) {
  const idx = opts.idx || 0;
  const g = new THREE.Group();
  const wood = J(0x8a6a4a, 0.76, 0, seed, { map: handTex('wood') });
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8), wood, 0, 0.85, 0));
  const board = mesh(new THREE.BoxGeometry(0.62, 1.15, 0.06), M(0xf0e8d8, { rough: 0.9, map: handTex('paper') }), 0, 1.55, 0);
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
    gg.add(mesh(new THREE.BoxGeometry(0.9, 0.34, 0.42), J(0xb5ab9c, 0.88, 0, seed, { map: handTex('stone'), roughnessMap: handRough('stone') }), 0, 0.17, 0));
    const cols = [0xc98a8a, 0xd9b26a, 0xc9c0e0];
    for (let i = 0; i < 5; i++) {
      const f = sh(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), M(cols[i % 3], { rough: 0.8, map: handTex('leaf') })));
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
      const mat = M(0xc9564f, { rough: 0.45, metal: 0.1, map: handTex('vermilion') });
      gg.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.55, 10), mat, 0, 0.28, 0));
      gg.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), mat, 0, 0.6, 0));
      return gg;
    })();
  g.add(blobShadow(0.24));
  return finish(g, { kind: 'fireplug', word: 'shoukasen', ja: '消火栓', r: 0.8 });
}

// ---- 城市版（根目录 layout.js）里有、此前只有模型没有构建器的四类 ----
// 现成模型 traffic_light / fence_low 一直加载着却没人调用，这里接上。

/** 信号机：路口立杆 + 横臂 + 三面灯箱（Kenney 模型优先，缺则程序化） */
export function buildTrafficLight(seed = 'tl') {
  const g = prop('traffic_light', { h: 3.0 });
  if (g) { g.add(blobShadow(0.3)); return finish(g, { kind: 'traffic_light', word: 'traffic_light', ja: '信号', r: 0.9 }); }
  const gg = new THREE.Group();
  const steel = M(0x4a4f54, { rough: 0.7, map: handTex('metal') });
  gg.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 10), steel, 0, 1.3, 0));
  gg.add(mesh(new THREE.BoxGeometry(1.6, 0.07, 0.07), steel, 0.8, 2.6, 0));
  gg.add(mesh(new THREE.BoxGeometry(0.3, 0.8, 0.26), M(0x3a4046, { rough: 0.8, map: handTex('plastic') }), 1.5, 2.35, 0));
  const cols = [0xd85848, 0xe8c060, 0x6ab86a];
  for (let i = 0; i < 3; i++) {
    const light = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), new THREE.MeshBasicMaterial({ color: cols[i] }));
    light.position.set(1.5, 2.62 - i * 0.26, 0.14);
    gg.add(light);
  }
  gg.add(blobShadow(0.3));
  return finish(gg, { kind: 'traffic_light', word: 'traffic_light', ja: '信号', r: 0.9 });
}

/** 低栅栏：Kenney fence_low 优先，缺则横杆+立柱 */
export function buildFence(seed = 'fn') {
  const g = prop('fence_low', { h: 0.8 });
  if (g) { g.add(blobShadow(1.1)); return finish(g, { kind: 'fence', word: 'fensu', ja: 'フェンス', r: 1.3 }); }
  const gg = new THREE.Group();
  const steel = M(0x8a9298, { rough: 0.68, map: handTex('metal') });
  for (const y of [0.3, 0.72]) gg.add(mesh(new THREE.BoxGeometry(2.6, 0.05, 0.05), steel, 0, y, 0));
  for (let i = 0; i < 9; i++) gg.add(mesh(new THREE.BoxGeometry(0.04, 0.72, 0.04), steel, -1.2 + i * 0.3, 0.36, 0));
  gg.add(blobShadow(1.1));
  return finish(gg, { kind: 'fence', word: 'fensu', ja: 'フェンス', r: 1.3 });
}

/** 公共电话亭：广场边的绿亭子 */
export function buildPhoneBox(seed = 'pb') {
  const g = new THREE.Group();
  const body = J(0x4a6a58, 0.72, 0, seed, { map: handTex('plastic') });
  g.add(mesh(new THREE.BoxGeometry(0.8, 2.0, 0.6), body, 0, 1.0, 0));
  g.add(mesh(new THREE.BoxGeometry(0.86, 0.1, 0.66), J(0x3a5a48, 0.72, 0, seed + 'r', { map: handTex('plastic') }), 0, 2.02, 0));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.03),
    M(0xa8c8bc, { rough: 0.18, emissive: 0x2a3a34, emissiveIntensity: 0.5, map: windowTexture(1, 2, '#cfe8dc') }));
  glass.position.set(0, 1.1, 0.31);
  g.add(glass);
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.5, 0.12), M(0x8a4a42, { rough: 0.6, map: handTex('plastic') }), 0, 1.25, 0.19));
  g.add(blobShadow(0.5));
  return finish(g, { kind: 'phone_box', word: 'koushuudenwa', ja: '公衆電話', r: 1.0 });
}

/** 广场旗杆：站前广场的国旗杆 */
export function buildPlazaFlag(seed = 'pf') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.045, 3.4, 8), M(0xc9c4ba, { rough: 0.6, map: handTex('metal') }), 0, 1.7, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 10), M(0xb0a898, { rough: 0.9, map: handTex('concrete') }), 0, 0.06, 0));
  const flag = mesh(new THREE.BoxGeometry(0.7, 0.44, 0.02), M(0xc94f4f, { rough: 0.85, doubleSided: true, map: handTex('fabric') }), 0.38, 3.0, 0);
  flag.rotation.y = 0.15;
  g.add(flag);
  g.add(blobShadow(0.3));
  return finish(g, { kind: 'plaza_flag', word: 'hata', ja: '旗', r: 0.9 });
}

/** 停车场指示牌：蓝底 P（原 parksign 只会出一块通用看板，读不出是停车场） */
export function buildParkingSign(seed = 'ps') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.3, 8), M(0x8a9298, { rough: 0.66, map: handTex('metal') }), 0, 0.65, 0));
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.04), M(0x4a6a8a, { rough: 0.7, map: handTex('plastic') }));
  plate.position.set(0, 1.45, 0);
  plate.castShadow = true;
  g.add(plate);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44),
    new THREE.MeshBasicMaterial({ map: signTexture('P', { bg: '#4a6a8a', fg: '#f2ecdc' }) }));
  face.position.set(0, 1.45, 0.022);
  g.add(face);
  g.add(blobShadow(0.24));
  return finish(g, { kind: 'parking_sign', word: 'chuushajou', ja: '駐車場', r: 0.9 });
}

export function buildLaundry(seed = 'l') {
  const g = new THREE.Group();
  const mat = J(0x8a8e90, 0.5, 0.7, seed, { map: handTex('metal') });
  for (const dx of [-1.05, 1.05]) {
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.85, 8), mat, dx, 0.93, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), mat, dx, 1.82, 0).rotateZ(Math.PI / 2));
  }
  const clothCols = [0xd9d4cb, 0xa8c0d0, 0xe0c98a, 0xd8b8c0, 0xc0d0b8];
  for (let i = 0; i < 5; i++) {
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.42),
      M(clothCols[i], { rough: 0.95, doubleSided: true, map: handTex('fabric') })
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
      const bodyMat = J(cols[Math.abs(hashCode(seed)) % cols.length], 0.5, 0.15, seed, { map: handTex('plastic') });
      gg.add(mesh(new THREE.BoxGeometry(1.65, 0.5, 0.78), bodyMat, 0, 0.42, 0));
      gg.add(mesh(new THREE.BoxGeometry(0.85, 0.42, 0.7), bodyMat, -0.05, 0.85, 0));
      const wheelMat = M(0x2e2c2a, { rough: 0.92, map: handTex('rubber') });
      for (const [wx, wz] of [[-0.55, 0.36], [0.55, 0.36], [-0.55, -0.36], [0.55, -0.36]]) {
        const w = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 12), wheelMat, wx, 0.17, wz);
        w.rotation.x = Math.PI / 2;
        gg.add(w);
      }
      return gg;
    })();
  dressCar(g, seed); // 手绘细节：车灯/车牌/后视镜/保险杠
  g.add(blobShadow(1.0));
  return finish(g, { kind: 'car', word: 'car', ja: '車', r: 1.8 });
}

// ---------- 手绘车辆细节 ----------
let _plateTexes = null;
function plateTexture(v) {
  // 日式车牌：白底墨绿框 + 假名 + 编号（8 个变体轮换）
  if (!_plateTexes) {
    _plateTexes = [];
    const kana = ['さ', 'め', 'あ', 'す', 'や', 'へ', 'ぬ', 'そ'];
    for (let i = 0; i < 8; i++) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 72;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#f2f1e6';
      ctx.fillRect(0, 0, 256, 72);
      ctx.strokeStyle = '#3e5c4b';
      ctx.lineWidth = 9;
      ctx.strokeRect(5, 5, 246, 62);
      ctx.fillStyle = '#2e2c28';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 30px sans-serif';
      ctx.fillText(kana[i], 46, 38);
      ctx.font = '800 36px sans-serif';
      const n1 = 10 + (i * 37) % 89, n2 = 10 + (i * 53) % 89;
      ctx.fillText(`${n1}・${n2}`, 150, 39);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      _plateTexes.push(t);
    }
  }
  return _plateTexes[Math.abs(hashCode(v)) % 8];
}

function dressCar(g, seed) {
  // 车头方向：Kenney 车模自带 wheel-front-* / wheel-back-* 节点，用前后轴中点连线求朝向；
  // 兜底（程序化车）按长轴 +X
  g.updateMatrixWorld(true);
  const pf = new THREE.Vector3(), pb = new THREE.Vector3();
  let nf = 0, nb = 0;
  g.traverse(o => {
    const n = (o.name || '').toLowerCase();
    if (/wheel-front/.test(n)) { pf.add(o.getWorldPosition(new THREE.Vector3())); nf++; }
    else if (/wheel-back/.test(n)) { pb.add(o.getWorldPosition(new THREE.Vector3())); nb++; }
  });
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  let ax = 0, az = 0; // 车头水平朝向（轴向对齐）
  if (nf && nb) {
    const f = pf.multiplyScalar(1 / nf).sub(pb.multiplyScalar(1 / nb));
    f.y = 0;
    if (f.lengthSq() > 1e-6) {
      f.normalize();
      if (Math.abs(f.x) >= Math.abs(f.z)) ax = Math.sign(f.x);
      else az = Math.sign(f.z);
    }
  }
  if (!ax && !az) { ax = size.x >= size.z ? 1 : 0; az = ax ? 0 : 1; }

  const L = (ax ? size.x : size.z) / 2;    // 车长半程
  const W = (ax ? size.z : size.x) / 2;    // 车宽半程
  const yaw = Math.atan2(ax, az);          // 车头朝向的 yaw（+Z 为 0）
  const lightY = box.min.y + size.y * 0.42;
  const headMat = M(0xf7efd2, { rough: 0.3, metal: 0.1, emissive: 0x9a8448, emissiveIntensity: 0.55 });
  const tailMat = M(0xd0483a, { rough: 0.35, metal: 0.1, emissive: 0x7a1810, emissiveIntensity: 0.5 });
  const trimMat = M(0x3a3835, { rough: 0.6, metal: 0.3, map: handTex('metal') });
  const lat = Math.min(W * 0.52, W - 0.06); // 灯的横向位置
  const bumperY = box.min.y + size.y * 0.14;
  for (const end of [1, -1]) { // 1=车头 -1=车尾
    const ex = cx + ax * L * end, ez = cz + az * L * end;
    const fwd = yaw + (end === 1 ? 0 : Math.PI); // 该端朝外的方向
    for (const s of [1, -1]) {
      const lx = ex + (ax ? 0 : s * lat), lz = ez + (ax ? s * lat : 0);
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.075, 0.05), end === 1 ? headMat : tailMat, lx, lightY, lz)
        .rotateY(fwd));
    }
    // 保险杠色带
    const bw = ax ? W * 2.02 : 0.1, bd = ax ? 0.1 : W * 2.02;
    g.add(mesh(new THREE.BoxGeometry(bw, 0.09, bd), trimMat, ex - ax * 0.02 * end, bumperY, ez - az * 0.02 * end));
    // 车牌（头尾各一面，日式白牌）
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.068),
      new THREE.MeshStandardMaterial({ map: plateTexture(seed + end), roughness: 0.55 })
    );
    plate.position.set(ex + ax * 0.032 * end, lightY - size.y * 0.1, ez + az * 0.032 * end);
    plate.rotation.y = fwd;
    g.add(plate);
  }
  // 后视镜：前轴侧后方两颗小耳朵
  const mirrorY = box.min.y + size.y * 0.52;
  const mx = cx + ax * L * 0.3, mz = cz + az * L * 0.3;
  for (const s of [1, -1]) {
    const px = mx + (ax ? 0 : s * (W + 0.045)), pz = mz + (ax ? s * (W + 0.045) : 0);
    g.add(mesh(new THREE.BoxGeometry(ax ? 0.05 : 0.08, 0.055, ax ? 0.08 : 0.05), trimMat, px, mirrorY, pz));
  }
  // 半数车加天线
  if (Math.abs(hashCode(seed + 'a')) % 2) {
    const axp = mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.22, 5), trimMat, mx - ax * 0.35, box.max.y + 0.08, mz - az * 0.35);
    g.add(axp);
  }
}

export function buildBicycle(seed = 'bi') {
  const g = prop('bicycle', { h: 1.0 })
    || (() => {
      const gg = new THREE.Group();
      const frameMat = J(0x8a9aa0, 0.5, 0.4, seed, { map: handTex('metal') });
      const tireMat = M(0x2e2c2a, { rough: 0.92, map: handTex('rubber') });
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

// 随机路人只从「站着」的 6 个角色里抽；npc_0（阿婆）是绑定姿势坐着的，
// 只给原版点名的 obaasan 用，buildNpc 里会顺手给她配一条长椅。
const NPC_KEYS = ['npc_1', 'npc_2', 'npc_3', 'npc_4', 'npc_5', 'npc_6'];
// planet.json 的 npc 字段是原版角色名；本机只带了 7 个模型，其余名字回退到随机角色
export const NPC_BY_NAME = {
  oldwoman: 'npc_0', 'office-worker': 'npc_1', 'young-lady': 'npc_2',
  threekid: 'npc_3', chef: 'npc_4', scout: 'npc_5', musician: 'npc_6',
};
// oldwoman.glb 的绑定姿势本身就是坐着的：大腿水平、小腿垂直、坐面在 0.45 m。
// 直接摆到人行道上就是「坐在空气里的阿婆」。这条长椅按她的骨盆局部坐标对齐，
// 坐面顶 0.455、椅背在她身后（她的正面是局部 +Z），脚正好落在椅前地面。
function sitBench() {
  const g = new THREE.Group();
  const wood = J(0x9a7a58, 0.76, 0, 'obaasan-bench', { map: handTex('wood') });
  const legMat = M(0x4a4e50, { rough: 0.5, metal: 0.6, map: handTex('metal') });
  g.add(mesh(new THREE.BoxGeometry(0.54, 0.07, 0.5), wood, 0, 0.42, 0.05));
  g.add(mesh(new THREE.BoxGeometry(0.54, 0.44, 0.06), wood, 0, 0.67, -0.17));
  for (const dx of [-0.21, 0.21]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.42, 0.44), legMat, dx, 0.21, 0.05));
  return g;
}

/** 原版角色（骨骼模型，绑定姿势定格 + 轻摆），缺失时回退程序化人形 */
export function buildNpc(seed = 'n', opts = {}) {
  const variant = (opts.variant || 0) % NPC_KEYS.length;
  const key = (opts.key && propLib.has(opts.key) && opts.key)
    || NPC_KEYS[Math.abs(hashCode(seed) + variant) % NPC_KEYS.length];
  const g = prop(key, { h: 1.62 });
  if (!g) {
    const gg = new THREE.Group();
    const shirt = [0x8a9aa8, 0xc9b8a0, 0x9aa89a, 0xc9a0a0, 0xa8a0c0][variant % 5];
    const pants = [0x5a5a60, 0x6a5a4a, 0x4a4e50][variant % 3];
    const skin = M(0xe0c0a8, { rough: 0.8 });
    gg.add(mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.72, 10), M(shirt, { rough: 0.85, map: handTex('fabric') }), 0, 1.06, 0));
    gg.add(mesh(new THREE.SphereGeometry(0.13, 12, 10), skin, 0, 1.55, 0));
    for (const dx of [-0.08, 0.08]) gg.add(mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.68, 8), M(pants, { rough: 0.9, map: handTex('fabric') }), dx, 0.34, 0));
    gg.userData.tick = (t) => { gg.rotation.z = Math.sin(t * 1.2 + hashCode(seed) % 10) * 0.02; };
    gg.add(blobShadow(0.32));
    return finish(gg, { kind: 'npc', word: null, ja: null, r: 1.0 });
  }
  // 原版 NPC 的 GLB 把骨骼平铺成了场景的直接兄弟节点（22 根里 18 根挂在根下），
  // 而动画曲线是按真正的嵌套链写的：绑定姿势画出来是正常人，一旦推进到任意关键帧，
  // 旋转的枢轴就落到错误的关节上，袖子会被拉成 1.2~1.5 m 的尖刺。所以这里不放原动画，
  // 只保留和程序化兜底一致的重力感轻摆。
  g.userData.tick = (t) => { g.rotation.z = Math.sin(t * 1.2 + hashCode(seed) % 10) * 0.02; };
  if (key === 'npc_0') g.add(sitBench());
  g.add(blobShadow(0.32));
  return finish(g, { kind: 'npc', word: null, ja: null, r: 1.0 });
}

export function buildDog(seed = 'd') { return quadruped('husky', 'dog', '犬', 0.55, seed); }
export function buildFox(seed = 'fx') { return quadruped('fox', 'kitsune', '狐', 0.45, seed); }

function quadruped(key, word, ja, h, seed) {
  const g = prop(key, { h })
    || (() => {
      const gg = new THREE.Group();
      const fur = J(0xb08d68, 0.85, 0, seed, { map: handTex('fur') });
      gg.add(mesh(new THREE.BoxGeometry(0.52, 0.24, 0.22), fur, 0, 0.32, 0));
      gg.add(mesh(new THREE.BoxGeometry(0.2, 0.18, 0.18), fur, 0.3, 0.44, 0));
      return gg;
    })();
  attachIdle(g, key);
  g.add(blobShadow(0.35));
  return finish(g, { kind: 'dog', word, ja, r: 1.0 });
}

export function buildBird(seed = 'bd') {
  const g = new THREE.Group();
  const body = prop('sparrow', { h: 0.16 })
    || (() => {
      const gg = new THREE.Group();
      const mat = M(0x8a8478, { rough: 0.9 });
      gg.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), mat, 0, 0.1, 0));
      gg.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), mat, 0, 0.19, 0.02));
      return gg;
    })();
  g.add(body);
  // 球面场景里 g.position.y 是径向坐标的一部分，直接动它会把鸟挪出地表，
  // 啄地的小幅起伏只能作用在内层 body 上。
  g.userData.tick = (t) => { body.position.y = Math.abs(Math.sin(t * 3 + hashCode(seed) % 7)) * 0.02; };
  g.add(blobShadow(0.12));
  return finish(g, { kind: 'bird', word: 'bird', ja: '鳥', r: 0.7 });
}

export function buildBoat(seed = 'bo') {
  const g = new THREE.Group();
  const hullMat = J(0x9a7a58, 0.8, 0, seed, { map: handTex('wood') });
  const hull = mesh(new THREE.CylinderGeometry(0.5, 0.3, 1.7, 5), hullMat, 0, 0.25, 0);
  hull.rotation.z = Math.PI / 2; hull.scale.y = 1; hull.scale.x = 0.55;
  g.add(hull);
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), hullMat, 0, 0.7, 0));
  const sail = mesh(new THREE.PlaneGeometry(0.7, 0.85), M(0xf0e8d8, { rough: 0.95, doubleSided: true, map: handTex('paper') }), 0.05, 1.15, 0);
  g.add(sail);
  return finish(g, { kind: 'boat', word: 'fune', ja: '船', r: 1.6 });
}

export function buildFountain(seed = 'fo') {
  const g = new THREE.Group();
  const stone = J(0xb5ab9c, 0.88, 0, seed, { map: handTex('stone'), roughnessMap: handRough('stone') });
  g.add(mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.4, 20), stone, 0, 0.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 20), M(0x7fb3b5, { rough: 0.2, metal: 0.1, map: handTex('water') }), 0, 0.38, 0));
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
  g.add(mesh(new THREE.CylinderGeometry(0.09 * scale, 0.14 * scale, h, 8), J(0x7a5f48, 0.8, 0, seed + 'k', { map: handTex('bark') }), 0, h / 2, 0));
  const leafMat = J([LEAF_A, LEAF_B, LEAF_C][Math.abs(hashCode(seed)) % 3], 0.82, 0, seed + 'l', { flatShading: true, map: handTex('leaf') });
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
  const trunk = mesh(new THREE.CylinderGeometry(0.1 * scale, 0.16 * scale, h, 8), M(0x6f5545, { rough: 0.85, map: handTex('bark') }), 0, h / 2, 0);
  trunk.rotation.z = 0.05;
  g.add(trunk);
  const petalMat = J(0xe8c9cf, 0.9, 0, seed + 'p', { flatShading: true, map: handTex('sakuraPetal') });
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
  const b = sh(new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), J(0x6f8b60, 0.88, 0, seed, { flatShading: true, map: handTex('leaf') })));
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
      const f = sh(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M(cols[i % 4], { rough: 0.85, map: handTex('leaf') })));
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
    const blade = mesh(new THREE.ConeGeometry(0.03, 0.16 + Math.random() * 0.1, 4), J(0x7d9a6c, 0.9, 0, seed + i, { map: handTex('leaf') }));
    blade.position.set((Math.random() - 0.5) * 0.2, 0.08, (Math.random() - 0.5) * 0.2);
    blade.rotation.z = (Math.random() - 0.5) * 0.4;
    gg.add(blade);
  }
  return finish(gg, { kind: 'grass', word: 'grass', ja: '草', r: 0.6 });
}

/** 岩石堆：Kenney 三档岩石模型，缺失时程序化石头兜底（撒细节/装饰共用） */
export function buildRockPile(seed = 'rk', opts = {}) {
  const scale = opts.scale || 1;
  const key = ['rocks_s', 'rocks_m', 'rocks_l'][Math.abs(hashCode(seed)) % 3];
  const g = prop(key, { h: (0.3 + (Math.abs(hashCode(seed)) % 30) / 100) * scale });
  if (!g) {
    const gg = new THREE.Group();
    const n = 2 + Math.abs(hashCode(seed)) % 2;
    for (let i = 0; i < n; i++) {
      const r = (0.09 + (i === 0 ? 0.1 : Math.random() * 0.08)) * scale;
      const b = sh(new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), J(0x8d867c, 0.92, 0, seed + i, { flatShading: true, map: handTex('stone'), roughnessMap: handRough('stone') })));
      b.scale.y = 0.68 + Math.random() * 0.24;
      b.position.set((Math.random() - 0.5) * 0.34 * scale, r * 0.5, (Math.random() - 0.5) * 0.34 * scale);
      b.rotation.y = Math.random() * Math.PI;
      gg.add(b);
    }
    return finish(gg, { kind: 'rock', word: null, ja: null, r: 0.8 });
  }
  return finish(g, { kind: 'rock', word: null, ja: null, r: 0.9 });
}

// ---------- planet.json 里剩下的小类（教学牌/店头商品/施工杂物/室内件/小动物/门面构件） ----------
// 这些都是原版词卡物件，此前没有构建器 = 玩家永远碰不到对应的词

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

/** 带字的板面（正反都能读），贴在一个既有盒体前面 */
function addText(g, text, { w, h, y, z, bg, fg = '#3d3630' }) {
  const tex = signTexture(text, { bg, fg });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const geo = new THREE.PlaneGeometry(w, h);
  const face = new THREE.Mesh(geo, mat);
  face.position.set(0, y, z);
  const back = new THREE.Mesh(geo, mat);
  back.position.set(0, y, -z);
  back.rotation.y = Math.PI;
  g.add(face, back);
}

const PLATE_COL = {
  pinku: 0xe08ab4, orenji: 0xe09a4a, haiiro: 0x9a9a98,
  murasaki: 0x8a6ab8, shiro: 0xece7dc, kiiro: 0xe0c84a,
};
/** 色/数/时教学牌：石座 + 木柱 + 色卡 */
export function buildPlate(seed = 'pt', opts = {}) {
  const g = new THREE.Group();
  const col = PLATE_COL[opts.word] || 0xd8cfc0;
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.1, 12), J(0xb5ab9c, 0.9, 0, seed, { map: handTex('stone'), roughnessMap: handRough('stone') }), 0, 0.05, 0));
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.36, 0.06), J(0x8a6a4a, 0.8, 0, seed + 'p', { map: handTex('wood') }), 0, 0.28, 0));
  g.add(mesh(new THREE.BoxGeometry(0.58, 0.42, 0.05), J(col, 0.7, 0.05, seed + 'c', { map: handTex('plastic') }), 0, 0.66, 0));
  if (opts.text) addText(g, opts.text, { w: 0.5, h: 0.26, y: 0.66, z: 0.031, bg: hex(col) });
  g.add(blobShadow(0.3));
  return finish(g, { kind: 'plate', word: opts.word || null, r: 0.7 });
}

/** 店头商品摊（mise）：条纹雨棚 + 两层货箱 */
export function buildGoods(seed = 'gd', opts = {}) {
  const g = new THREE.Group();
  const wood = J(0x8a6a4a, 0.8, 0, seed, { map: handTex('wood') });
  for (const dx of [-0.75, 0.75]) g.add(mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), wood, dx, 0.75, -0.3));
  const awn = mesh(new THREE.BoxGeometry(1.8, 0.08, 0.9), M(0xe8e0d0, { rough: 0.85, map: handTex('stripe') }), 0, 1.5, 0.05);
  awn.rotation.x = -0.16;
  g.add(awn);
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.7, 0.7), wood, 0, 0.35, 0));
  const cols = [0xc9564f, 0xe0c84a, 0x7d9a6c, 0xe09a4a];
  for (let i = 0; i < 6; i++) {
    const c = cols[i % cols.length];
    const it = mesh(new THREE.SphereGeometry(0.11, 8, 6), J(c, 0.75, 0, seed + i, { map: handTex('plastic') }),
      -0.52 + (i % 3) * 0.52, i < 3 ? 0.82 : 0.5, i < 3 ? 0.1 : 0.24);
    it.scale.y = 0.82;
    g.add(it);
  }
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.04), M(0xf5efe2, { rough: 0.9, map: handTex('paper') }), 0, 1.12, 0.36));
  if (opts.text) addText(g, opts.text, { w: 0.46, h: 0.24, y: 1.12, z: 0.385, bg: '#f5efe2' });
  g.add(blobShadow(1.0));
  return finish(g, { kind: 'goods', word: opts.word || 'mise', r: 1.3 });
}

/** 车票售卖牌（kippu）：站前常见的小立牌 */
export function buildTicketSign(seed = 'tk', opts = {}) {
  const g = new THREE.Group();
  const metal = J(0x6f7a80, 0.5, 0.6, seed, { map: handTex('metal') });
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8), metal, 0, 0.75, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 12), metal, 0, 0.03, 0));
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.5, 0.07), M(0xf0e2c8, { rough: 0.8, map: handTex('paper') }), 0, 1.35, 0));
  if (opts.text) addText(g, opts.text, { w: 0.8, h: 0.4, y: 1.35, z: 0.04, bg: '#f0e2c8' });
  g.add(blobShadow(0.34));
  return finish(g, { kind: 'ticket_sign', word: opts.word || 'kippu', r: 0.9 });
}

/** 猫 / 龟：原版没有这两个模型，按小体量程序化 */
export function buildCat(seed = 'ct') {
  const g = new THREE.Group();
  const cols = [0xb0a89a, 0x8a7f74, 0xd8c8a8, 0x6a6a70];
  const fur = J(cols[Math.abs(hashCode(seed)) % cols.length], 0.9, 0, seed, { map: handTex('fur') });
  const body = mesh(new THREE.SphereGeometry(0.16, 12, 9), fur, 0, 0.16, 0.02);
  body.scale.set(0.78, 0.85, 1.25);
  g.add(body);
  g.add(mesh(new THREE.SphereGeometry(0.1, 12, 9), fur, 0, 0.24, 0.2));
  for (const dx of [-0.055, 0.055]) {
    const ear = mesh(new THREE.ConeGeometry(0.04, 0.08, 5), fur, dx, 0.33, 0.19);
    ear.rotation.x = -0.2;
    g.add(ear);
  }
  const tail = mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.26, 6), fur, 0, 0.22, -0.16);
  tail.rotation.x = 0.9;
  g.add(tail);
  for (const [dx, dz] of [[-0.08, 0.09], [0.08, 0.09], [-0.08, -0.06], [0.08, -0.06]]) {
    g.add(mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.12, 6), fur, dx, 0.06, dz));
  }
  g.userData.tick = (t) => { tail.rotation.z = Math.sin(t * 1.6 + hashCode(seed) % 7) * 0.35; };
  g.add(blobShadow(0.22));
  return finish(g, { kind: 'cat', word: 'cat', ja: '猫', r: 0.7 });
}

export function buildTurtle(seed = 'kt', opts = {}) {
  const g = new THREE.Group();
  const shell = J(0x6f7a4a, 0.8, 0, seed, { map: handTex('leaf'), flatShading: true });
  const s = mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell, 0, 0.1, 0);
  s.scale.set(1, 0.66, 1.15);
  g.add(s);
  g.add(mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 12), J(0x8a7f5a, 0.85, 0, seed + 'b', { map: handTex('woodWeathered') }), 0, 0.06, 0));
  g.add(mesh(new THREE.SphereGeometry(0.075, 10, 8), J(0x9aa07a, 0.85, 0, seed + 'h', { map: handTex('leaf') }), 0, 0.12, 0.28));
  for (const [dx, dz] of [[-0.2, 0.12], [0.2, 0.12], [-0.19, -0.16], [0.19, -0.16]]) {
    const leg = mesh(new THREE.BoxGeometry(0.09, 0.05, 0.13), J(0x9aa07a, 0.85, 0, seed + 'l', { map: handTex('leaf') }), dx, 0.05, dz);
    leg.rotation.y = dx > 0 ? -0.3 : 0.3;
    g.add(leg);
  }
  if (opts.rot) g.rotation.y = 0; // 朝向交给摆放层的 rot
  g.add(blobShadow(0.28));
  return finish(g, { kind: 'turtle', word: opts.word || 'kame', r: 0.7 });
}

// 食品サンプル：展示用的放大食物，摆在石座上（原版店头样品）
const FOODS = {
  bowl: (g, seed) => {
    g.add(mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.2, 18), J(0xe8e0d0, 0.5, 0, seed, { map: handTex('ceramic') }), 0, 0.5, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 18), M(0xc9a06a, { rough: 0.4, map: handTex('water') }), 0, 0.58, 0));
    for (let i = 0; i < 5; i++) {
      const n = mesh(new THREE.TorusGeometry(0.18, 0.02, 5, 12), M(0xf0e8c8, { rough: 0.8 }), 0, 0.6, 0);
      n.rotation.x = Math.PI / 2 + (i - 2) * 0.12;
      n.position.y = 0.6 + i * 0.012;
      g.add(n);
    }
  },
  onigiri: (g, seed) => {
    const rice = mesh(new THREE.ConeGeometry(0.26, 0.34, 4), J(0xf4f0e4, 0.9, 0, seed, { map: handTex('shoji') }), 0, 0.44, 0);
    rice.rotation.y = Math.PI / 4;
    g.add(rice);
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 0.02), M(0x2f3a34, { rough: 0.85, map: handTex('moss') }), 0, 0.36, 0.2));
  },
  bread: (g, seed) => {
    const b = mesh(new THREE.SphereGeometry(0.22, 12, 8), J(0xd9a85a, 0.85, 0, seed, { map: handTex('woodPale') }), 0, 0.42, 0);
    b.scale.set(1.35, 0.68, 0.9);
    g.add(b);
    for (let i = -1; i <= 1; i++) {
      const cut = mesh(new THREE.BoxGeometry(0.02, 0.03, 0.3), M(0xb8863f, { rough: 0.9 }), i * 0.1, 0.53, 0);
      g.add(cut);
    }
  },
  drink: (g, seed) => {
    for (let i = 0; i < 3; i++) {
      const c = J([0xc9564f, 0x4a8ac9, 0x6aa84a][i], 0.35, 0.5, seed + i, { map: handTex('metal') });
      g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.28, 12), c, -0.2 + i * 0.2, 0.42, (i % 2) * 0.12));
    }
  },
};
/** 食品展示件：word 决定形状 */
export function buildFood(seed = 'fd', opts = {}) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.32, 14), J(0xb5ab9c, 0.9, 0, seed, { map: handTex('stone'), roughnessMap: handRough('stone') }), 0, 0.16, 0));
  (FOODS[opts.form] || FOODS.bowl)(g, seed);
  g.add(blobShadow(0.4));
  return finish(g, { kind: opts.form || 'bowl', word: opts.word || null, r: 0.8 });
}

// 施工/堆放杂物：pipe / crate / lowwall / tires / cones / trashbags / gasbottle
const CLUTTER = {
  pipe: (g, seed) => {
    const m = J(0x8f8f8a, 0.7, 0.2, seed, { map: handTex('concrete') });
    for (let i = 0; i < 3; i++) {
      const p = mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.1, 10, 1, true), m, (i - 1) * 0.22, 0.18 + i * 0.02, i * 0.1);
      p.rotation.z = Math.PI / 2;
      p.rotation.y = (i - 1) * 0.3;
      g.add(p);
    }
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 10), m, 0.1, 0.5, 0.35).rotateZ(1.2));
  },
  crate: (g, seed) => {
    const w = J(0xa8855a, 0.85, 0, seed, { map: handTex('woodPlank') });
    g.add(mesh(new THREE.BoxGeometry(0.72, 0.6, 0.72), w, 0, 0.3, 0));
    for (const dy of [0.16, 0.44]) {
      g.add(mesh(new THREE.BoxGeometry(0.76, 0.07, 0.76), J(0x8a6a4a, 0.85, 0, seed + 'b', { map: handTex('wood') }), 0, dy, 0));
    }
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), w, 0.42, 0.85, 0.1).rotateY(0.5));
  },
  lowwall: (g, seed) => {
    const m = J(0xa09a92, 0.92, 0, seed, { map: handTex('concrete'), roughnessMap: handRough('concrete') });
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.5, 0.4), m, 0, 0.25, 0));
    g.add(mesh(new THREE.BoxGeometry(1.56, 0.08, 0.46), J(0x8f8a82, 0.9, 0, seed + 't', { map: handTex('concrete') }), 0, 0.53, 0));
  },
  tires: (g, seed) => {
    const r = J(0x2f2f32, 0.95, 0, seed, { map: handTex('rubber') });
    for (let i = 0; i < 3; i++) {
      const t = mesh(new THREE.TorusGeometry(0.26, 0.1, 8, 14), r, (i % 2) * 0.1, 0.1 + i * 0.19, i * 0.06);
      t.rotation.x = Math.PI / 2 + (i - 1) * 0.05;
      g.add(t);
    }
  },
  cones: (g, seed) => {
    const orange = M(0xe07a2a, { rough: 0.7, map: handTex('plastic') });
    const white = M(0xf0ece4, { rough: 0.8 });
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.62;
      g.add(mesh(new THREE.BoxGeometry(0.36, 0.04, 0.36), white, x, 0.02, 0));
      g.add(mesh(new THREE.ConeGeometry(0.17, 0.6, 12), orange, x, 0.32, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.115, 0.135, 0.09, 12), white, x, 0.36, 0));
    }
  },
  trashbags: (g, seed) => {
    for (let i = 0; i < 3; i++) {
      const b = mesh(new THREE.SphereGeometry(0.24 - i * 0.02, 9, 7), J([0x3a4038, 0x4a4a50, 0x38383c][i], 0.9, 0, seed + i, { map: handTex('plastic'), flatShading: true }),
        (i - 1) * 0.3, 0.2, (i % 2) * 0.18);
      b.scale.set(0.85, 1.05, 0.85);
      g.add(b);
    }
  },
  gasbottle: (g, seed) => {
    const m = J(0xa8b0b8, 0.4, 0.7, seed, { map: handTex('metal') });
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.62, 14), m, 0, 0.33, 0));
    g.add(mesh(new THREE.SphereGeometry(0.17, 14, 8), m, 0, 0.66, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8), J(0x6a6a70, 0.5, 0.6, seed + 'v', { map: handTex('metal') }), 0, 0.84, 0));
    g.add(mesh(new THREE.TorusGeometry(0.13, 0.02, 6, 12), m, 0, 0.5, 0).rotateX(Math.PI / 2));
  },
};
/** 施工/杂物（无词，纯场景细节） */
export function buildClutter(seed = 'cl', opts = {}) {
  const g = new THREE.Group();
  (CLUTTER[opts.form] || CLUTTER.crate)(g, seed);
  g.add(blobShadow(0.55));
  return finish(g, { kind: opts.form || 'crate', word: opts.word || null, r: 1.0 });
}

/** 路牌（roadsign）：立柱 + 圆牌 */
export function buildRoadsign(seed = 'rs', opts = {}) {
  const g = new THREE.Group();
  const metal = J(0x9aa0a6, 0.5, 0.6, seed, { map: handTex('metal') });
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.9, 8), metal, 0, 0.95, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 12), metal, 0, 0.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 18), M(0x4a86c9, { rough: 0.6, map: handTex('plastic') }), 0, 1.72, 0.02).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.055, 18), M(0xf0ece4, { rough: 0.7 }), 0, 1.72, 0.03).rotateX(Math.PI / 2));
  g.add(blobShadow(0.3));
  return finish(g, { kind: 'roadsign', word: opts.word || 'roadsign', r: 0.9 });
}

// 室内件（原版把家具词也撒在地图上，当作店头/样品展示，统一垫一块木地板）
const FURNITURE = {
  table: (g, s) => { const w = J(0xa8855a, 0.8, 0, s, { map: handTex('woodPlank') }); g.add(mesh(new THREE.BoxGeometry(1.1, 0.08, 0.72), w, 0, 0.7, 0)); for (const [dx, dz] of [[-0.46, -0.26], [0.46, -0.26], [-0.46, 0.26], [0.46, 0.26]]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.68, 0.08), w, dx, 0.34, dz)); },
  chair: (g, s) => { const w = J(0x8a6a4a, 0.82, 0, s, { map: handTex('wood') }); g.add(mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), w, 0, 0.44, 0)); g.add(mesh(new THREE.BoxGeometry(0.46, 0.56, 0.06), w, 0, 0.74, -0.2)); for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.44, 0.05), w, dx, 0.22, dz)); },
  sofa: (g, s) => { const f = J(0x8a9aa8, 0.92, 0, s, { map: handTex('fabric') }); g.add(mesh(new THREE.BoxGeometry(1.6, 0.42, 0.72), f, 0, 0.3, 0)); g.add(mesh(new THREE.BoxGeometry(1.6, 0.5, 0.2), f, 0, 0.62, -0.28)); for (const dx of [-0.72, 0.72]) g.add(mesh(new THREE.BoxGeometry(0.18, 0.34, 0.72), f, dx, 0.5, 0)); g.add(mesh(new THREE.BoxGeometry(0.62, 0.14, 0.5), J(0xb8c4cc, 0.92, 0, s + 'c', { map: handTex('fabric') }), -0.34, 0.56, 0.02)); },
  shelf: (g, s) => { const w = J(0x9a7a58, 0.85, 0, s, { map: handTex('woodPlank') }); g.add(mesh(new THREE.BoxGeometry(0.9, 1.5, 0.3), w, 0, 0.75, 0)); for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.84, 0.05, 0.28), J(0x7a5f48, 0.85, 0, s + i, { map: handTex('wood') }), 0, 0.4 + i * 0.42, 0.02)); for (let i = 0; i < 7; i++) g.add(mesh(new THREE.BoxGeometry(0.08, 0.3, 0.2), J([0xc9564f, 0x4a86c9, 0x6aa84a, 0xe0c84a][i % 4], 0.9, 0, s + 'b' + i, { map: handTex('paper') }), -0.34 + (i % 4) * 0.2, 0.58 + Math.floor(i / 4) * 0.42, 0.06)); },
  tv: (g, s) => { g.add(mesh(new THREE.BoxGeometry(0.9, 0.58, 0.1), M(0x2f3238, { rough: 0.4, map: handTex('plastic') }), 0, 0.66, 0)); g.add(mesh(new THREE.BoxGeometry(0.8, 0.48, 0.02), M(0x8ab8c9, { rough: 0.15, metal: 0.3, emissive: 0x223038, map: handTex('water') }), 0, 0.66, 0.06)); g.add(mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), M(0x3a3d42, { rough: 0.6 }), 0, 0.3, 0)); },
  lamp: (g, s) => { g.add(mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.06, 12), J(0x8a8e90, 0.4, 0.6, s, { map: handTex('metal') }), 0, 0.03, 0)); g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), J(0xb8a06a, 0.4, 0.7, s + 'p', { map: handTex('brass') }), 0, 0.33, 0)); g.add(mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.24, 12, 1, true), M(0xf0e0b8, { rough: 0.8, emissive: 0xe8c88f, emissiveIntensity: 0.5, doubleSided: true }), 0, 0.72, 0)); },
  bed: (g, s) => { const w = J(0x9a7a58, 0.85, 0, s, { map: handTex('woodPlank') }); g.add(mesh(new THREE.BoxGeometry(1.0, 0.28, 1.9), w, 0, 0.16, 0)); g.add(mesh(new THREE.BoxGeometry(1.02, 0.5, 0.08), w, 0, 0.5, -0.94)); g.add(mesh(new THREE.BoxGeometry(0.94, 0.16, 1.76), J(0xe8e0d0, 0.95, 0, s + 'm', { map: handTex('fabric') }), 0, 0.38, 0.04)); g.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.34), M(0xf4f0e4, { rough: 0.95, map: handTex('fabric') }), 0, 0.5, -0.7)); },
  wash: (g, s) => { const m = J(0xe4e4e0, 0.5, 0.1, s, { map: handTex('plastic') }); g.add(mesh(new THREE.BoxGeometry(0.62, 0.9, 0.6), m, 0, 0.45, 0)); g.add(mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 18), M(0x6a8a9a, { rough: 0.15, metal: 0.2, map: handTex('water') }), 0, 0.5, 0.31).rotateX(Math.PI / 2)); g.add(mesh(new THREE.BoxGeometry(0.56, 0.06, 0.06), J(0xb8bcc0, 0.4, 0.5, s + 'p', { map: handTex('metal') }), 0, 0.88, 0.3)); },
  kagu: (g, s) => { const w = J(0x8a6a4a, 0.82, 0, s, { map: handTex('wood') }); g.add(mesh(new THREE.BoxGeometry(0.8, 0.9, 0.4), w, 0, 0.45, 0)); g.add(mesh(new THREE.BoxGeometry(0.36, 0.72, 0.04), J(0xb8a06a, 0.7, 0.2, s + 'd', { map: handTex('brass') }), -0.18, 0.45, 0.21)); g.add(mesh(new THREE.BoxGeometry(0.36, 0.72, 0.04), J(0xb8a06a, 0.7, 0.2, s + 'd2', { map: handTex('brass') }), 0.18, 0.45, 0.21)); },
};
/** 家具词件：木地板垫 + 单体家具，避免"沙发直接插草地" */
export function buildFurniture(seed = 'fu', opts = {}) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.07, 1.5), J(0xb8a58a, 0.9, 0, seed, { map: handTex('woodPlank') }), 0, 0.035, 0));
  (FURNITURE[opts.form] || FURNITURE.table)(g, seed);
  g.add(blobShadow(0.85));
  return finish(g, { kind: opts.form || 'kagu', word: opts.word || null, r: 1.1 });
}

/** 宅急便包裹（delivery 的 model 字段）：h 给定尺寸 */
export function buildParcel(seed = 'dl', opts = {}) {
  const g = new THREE.Group();
  const h = opts.h || 0.45;
  const form = opts.model || 'samplebox';
  if (form === 'postcard') {
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), M(0xe8dcc0, { rough: 0.9, map: handTex('paperOld') }), 0, 0.02, 0).rotateY(0.3));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.005, 0.2), M(0xa8c0d0, { rough: 0.8, map: handTex('water') }), 0, 0.035, 0).rotateY(0.3));
  } else if (form === 'clothes') {
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.44 - i * 0.02, 0.09, 0.34 - i * 0.02), J([0xd8b8c0, 0xa8c0d0, 0xe8e0d0][i], 0.95, 0, seed + i, { map: handTex('fabric') }), 0, 0.06 + i * 0.1, i * 0.01));
  } else if (form === 'offering') {
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.08, 0.28), J(0xc9a06a, 0.7, 0, seed, { map: handTex('woodDark') }), 0, 0.05, 0));
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.SphereGeometry(0.07, 9, 7), J([0xe0c84a, 0xc9564f, 0x7d9a6c][i], 0.8, 0, seed + 'f' + i, { map: handTex('leaf') }), -0.12 + i * 0.12, 0.15, 0));
  } else {
    const b = J(0xc9a06a, 0.9, 0, seed, { map: handTex('paperBrown') });
    g.add(mesh(new THREE.BoxGeometry(0.44, 0.3, 0.34), b, 0, 0.15, 0));
    const tape = M(0xd8c8a0, { rough: 0.6, map: handTex('paper') });
    g.add(mesh(new THREE.BoxGeometry(0.46, 0.03, 0.08), tape, 0, 0.3, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.03, 0.36), tape, 0, 0.3, 0));
  }
  g.scale.setScalar(h / 0.45);
  g.add(blobShadow(0.3));
  return finish(g, { kind: 'delivery', word: opts.word || 'delivery', r: 0.8 });
}

/** 建筑门面构件：贴在宿主建筑的正面墙上（摆放层负责宿主定位） */
export function buildDoor(seed = 'dr', opts = {}) {
  const g = new THREE.Group();
  const w = opts.w || 0.95, h = opts.h || 1.85;
  g.add(mesh(new THREE.BoxGeometry(w + 0.16, h + 0.1, 0.08), J(0x6a5a48, 0.8, 0, seed, { map: handTex('woodDark') }), 0, h / 2, -0.02));
  g.add(mesh(new THREE.BoxGeometry(w, h, 0.07), J(0x7a5f42, 0.75, 0, seed + 'd', { map: handTex('wood') }), 0, h / 2, 0.03));
  g.add(mesh(new THREE.BoxGeometry(w - 0.2, 0.5, 0.02), M(0xd8c8a0, { rough: 0.5, metal: 0.2, map: handTex('brass') }), 0, h * 0.62, 0.07));
  g.add(mesh(new THREE.SphereGeometry(0.045, 10, 8), J(0xc9a06a, 0.35, 0.7, seed + 'k', { map: handTex('brass') }), w * 0.36, h * 0.48, 0.09));
  if (opts.text) addText(g, opts.text, { w: 0.34, h: 0.18, y: h + 0.16, z: 0.06, bg: '#f5efe2' });
  return finish(g, { kind: 'door', word: opts.word || 'door', r: 1.1 });
}

export function buildWindowProp(seed = 'wn', opts = {}) {
  const g = new THREE.Group();
  const w = opts.w || 0.86, h = opts.h || 0.78;
  g.add(mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.1), J(0xd8d0c0, 0.8, 0, seed, { map: handTex('plaster') }), 0, 0, -0.02));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    color: 0xf2d9a8, roughness: 0.12, metalness: 0,
    map: windowTexture(2, 2, '#f2d9a8'), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0,
  }));
  glass.position.z = 0.04;
  glass.userData.emissiveMat = glass.material;
  g.add(glass);
  const bar = J(0xe8e0d0, 0.75, 0, seed + 'b', { map: handTex('plaster') });
  g.add(mesh(new THREE.BoxGeometry(0.04, h, 0.03), bar, 0, 0, 0.055));
  g.add(mesh(new THREE.BoxGeometry(w, 0.04, 0.03), bar, 0, 0, 0.055));
  return finish(g, { kind: 'window', word: opts.word || 'window', r: 0.9 });
}

function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
