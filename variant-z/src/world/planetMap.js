// 现成地图加载：LangCity 原版星球地形 GLB（planets_present_full_0..9 分层拼岛）
// + 海面 + 高模树冠 + planet.json 落点数据的球面坐标换算（移植 PlanetMath）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { makePlanFrame, groundColor, TOWN_RECT } from './townPlan.js';

const TMP_COL = new THREE.Color();

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// planet.json 的 planet 段（与 PlanetMath._init 同参）
export const CFG = {
  world: [5200, 4000],
  radius: 34,          // GLB 原生标称半径（米）
  scale: 1.5,
  lonSpanDeg: 130,
  latTopDeg: 10,       // 离极角距（余纬），y=0
  latBottomDeg: 52,    // y=H
  walkPhiDeg: 62,      // 可走软墙
};
/** 弧长↔角度换算用的标称半径；loadPlanet 烘完地面后会改成实测的地面中位半径 */
export let R = CFG.radius * CFG.scale;

const D2R = THREE.MathUtils.degToRad;

/** 地图像素 → 球面单位方向（球心在原点，极点=+Y） */
export function dirFromPx(px, py) {
  const u = THREE.MathUtils.clamp(px / CFG.world[0], 0, 1);
  const v = THREE.MathUtils.clamp(py / CFG.world[1], 0, 1);
  return dirFromUV(u, v);
}
export function dirFromUV(u, v) {
  const lam = (u - 0.5) * 2 * D2R(CFG.lonSpanDeg);
  const phi = THREE.MathUtils.lerp(D2R(CFG.latTopDeg), D2R(CFG.latBottomDeg), v);
  return new THREE.Vector3(Math.sin(phi) * Math.sin(lam), Math.cos(phi), Math.sin(phi) * Math.cos(lam));
}
/** 球面方向 → 地图像素 */
export function pxFromDir(d) {
  const u = Math.atan2(d.x, d.z) / (2 * D2R(CFG.lonSpanDeg)) + 0.5;
  const phi = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
  const v = THREE.MathUtils.inverseLerp(D2R(CFG.latTopDeg), D2R(CFG.latBottomDeg), phi);
  return [THREE.MathUtils.clamp(u, 0, 1) * CFG.world[0], THREE.MathUtils.clamp(v, 0, 1) * CFG.world[1]];
}
export function northAt(dir) {
  const n = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
  if (n.lengthSq() < 1e-6) n.set(1, 0, 0).addScaledVector(dir, -dir.x);
  return n.normalize();
}
export function eastAt(dir) { return northAt(dir).cross(dir).normalize(); }

/** 表面朝向四元数：X=东 Y=上(径向) Z=南，再绕 up 转 yaw（度） */
export function basisAt(dir, yawDeg = 0) {
  const up = dir.clone().normalize();
  const e = eastAt(up);
  const s = northAt(up).negate();
  const m = new THREE.Matrix4().makeBasis(e, up, s);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (yawDeg) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), D2R(yawDeg)));
  return q;
}

/** 可走软墙：离极角距超界时返回钳回后的方向，否则 null */
export function clampWalk(dir) {
  const phi = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
  const walk = D2R(CFG.walkPhiDeg);
  if (phi <= walk) return null;
  const lam = Math.atan2(dir.x, dir.z);
  return new THREE.Vector3(Math.sin(walk) * Math.sin(lam), Math.cos(walk), Math.sin(walk) * Math.cos(lam));
}

// ---------- 调色板烘焙：UV → palette.png → 顶点色 + 草地权重 ----------
function bakePalette(paletteData, geo, maskB = null) {
  const uv = geo.attributes.uv;
  const cnt = geo.attributes.position.count;
  const colors = new Float32Array(cnt * 3);
  const grassW = new Float32Array(cnt);
  const c = new THREE.Color();
  for (let i = 0; i < cnt; i++) {
    if (uv) {
      const u = uv.getX(i), v = uv.getY(i);
      // palette 16×16，最近邻。GLB UV 按原图 v=0 在底的方式排布，
      // 但实测映射取反才对上色彩三角（row5-15 是颜色区，row0-4 全白）
      const px = Math.min(15, Math.max(0, Math.floor(u * 16)));
      const py = Math.min(15, Math.max(0, Math.floor(v * 16)));
      const o = (py * 16 + px) * 4;
      c.setRGB(paletteData[o] / 255, paletteData[o + 1] / 255, paletteData[o + 2] / 255);
    } else {
      c.setRGB(0.62, 0.6, 0.55);
    }
    // 草地权重：绿通道显著高于红/蓝 → 草(1)；灰系路面/岩石、暖色沙泥 → 砂石(0)。
    // 道路、广场在调色板里是灰阶(444..eee)，自然落进沥青贴图
    grassW[i] = THREE.MathUtils.clamp((c.g - Math.max(c.r, c.b)) / 0.14, 0, 1);
    // 轻微逐顶点微差，消除大色块的塑料感
    const j = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.06 - 0.03;
    c.offsetHSL(0, 0, j);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGrass', new THREE.BufferAttribute(grassW, 1));
}

async function loadPalette() {
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = './planet/tex/palette.png';
  });
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, 16, 16);
  return ctx.getImageData(0, 0, 16, 16).data;
}

function loadGLB(url) {
  return new Promise((res, rej) => {
    new GLTFLoader().load(url, res, undefined, rej);
  });
}

/** 手绘灰度 doodle 图：白底 + 沥青补丁 + 随机游走裂纹 + 深浅斑点。
 *  灰度乘法只改明度不改色相，路面上读作沥青裂纹，岩石上读作石纹 */
function doodleCrackTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  // 补丁修复痕迹：深浅圆角块
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.translate(Math.random() * S, Math.random() * S);
    ctx.rotate(Math.random() * Math.PI);
    const w = 46 + Math.random() * 92, h = 34 + Math.random() * 66;
    ctx.fillStyle = `rgba(72,72,75,${0.06 + Math.random() * 0.06})`;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 12 + Math.random() * 12);
    ctx.fill();
    ctx.restore();
  }
  // 裂纹：随机游走折线，偶发分叉（手绘抖动感）
  const crack = (x, y, ang, steps, width, alpha) => {
    ctx.strokeStyle = `rgba(50,50,54,${alpha})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (steps-- > 0) {
      ang += (Math.random() - 0.5) * 0.85;
      x += Math.cos(ang) * 7;
      y += Math.sin(ang) * 7;
      ctx.lineTo(x, y);
      if (Math.random() < 0.055 && steps > 8) crack(x, y, ang + (Math.random() - 0.5) * 2.4, steps * 0.45, width * 0.6, alpha * 0.8);
    }
    ctx.stroke();
  };
  for (let i = 0; i < 9; i++) {
    crack(Math.random() * S, Math.random() * S, Math.random() * Math.PI * 2, 24 + Math.random() * 30, 1.5 + Math.random() * 1.8, 0.32 + Math.random() * 0.2);
  }
  // 深斑点（碎石感）+ 浅点（崩边高光）
  for (let i = 0; i < 680; i++) {
    ctx.fillStyle = `rgba(58,58,62,${0.06 + Math.random() * 0.13})`;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, 0.8 + Math.random() * 1.7, 0, 7);
    ctx.fill();
  }
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * 加载原版星球：full_0..9 地形（进 BVH/碰撞）+ 海面 + 树冠（装饰）。
 * 返回 { group, terrainMeshes, surfaceAt(dir)→{pos,normal,hit}, waterRadius }
 */
export async function loadPlanet() {
  const paletteData = await loadPalette();

  const pqMode = new URLSearchParams(location.search).get('island');
  // 'raw' = 原版十块穿插分层直接当碰撞面；'intro' = 菜单同款单体低模岛（原版的退化路径）。
  // 两者都不烘场、不压台地、不铺街——就是 LangCity 里 PlanetBuilder 摆出来的那座岛。
  const ISLAND_MODE = pqMode === 'raw' || pqMode === 'intro' ? pqMode : null;
  const urls = [];
  const kinds = [];   // 与 urls 同长：'terrain' | 'water' | 'leaves' | 'trees'
  function want(stem, kind) { urls.push(`./planet/${stem}.glb`); kinds.push(kind); }
  if (ISLAND_MODE === 'intro') {
    want('planets_present_intro_planet', 'terrain');
    want('planets_present_intro_water', 'water');
    want('planets_present_intro_trees', 'trees');
  } else {
    for (let i = 0; i < 10; i++) want(`planets_present_full_${i}`, 'terrain');
    want('planets_present_water', 'water');
    for (let i = 0; i < 5; i++) want(`planets_present_tree-leaves_${i}`, 'leaves');
  }

  const results = await Promise.all(urls.map(u => loadGLB(u).catch(e => ({ error: String(e && e.message || e), url: u }))));
  window.__loadErrors = results.filter(r => r.error).map(r => `${r.url}: ${r.error}`);

  const group = new THREE.Group();
  const chunkMeshes = [];
  const _pq = new URLSearchParams(location.search);
  const SHOW_CHUNKS = _pq.get('chunks') === '1';    // 对照用：把原始碎块壳显示出来
  const SHOW_LEAVES = _pq.get('leaves') === '1';
  // 漫画风地面:调色板顶点色平涂 + 纯灰度手绘噪声(云噪声图,三通道相等不染色;noises-terrain 是绿色色带,不能用)
  const groundNoise = new THREE.TextureLoader().load('./tex-messenger/clouds-noise-512.png');
  groundNoise.wrapS = groundNoise.wrapT = THREE.RepeatWrapping;
  groundNoise.repeat.set(1, 1); // 烘出来的地面自带按弧长铺的 uv，一块噪声≈5m，不用再铺
  groundNoise.anisotropy = 8;
  // 噪声均亮 0.707(实测灰度),color 提 1/0.707 保住顶点色整体亮度,只留手绘明暗摆动
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
    map: groundNoise, color: new THREE.Color(1.414, 1.414, 1.414),
  });
  // 手绘 doodle 层：裂纹/斑点/补丁，只叠在灰系(低饱和)表面——马路沥青裂纹、岩石石纹。
  // 纯灰度乘法不染色，草(绿)和暖沙不参与，保住漫画平涂大色块
  const crackTex = doodleCrackTexture();
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDoodle = { value: crackTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWN; varying float vGrassW;
        attribute float aGrass;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGrassW = aGrass;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWN; varying float vGrassW;
        uniform sampler2D uDoodle;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // 灰度面罩：饱和度低(灰阶路面/广场/岩石)→1，草地/暖沙→0
          float sat = max(max(vColor.r, vColor.g), vColor.b) - min(min(vColor.r, vColor.g), vColor.b);
          float grayM = (1.0 - smoothstep(0.035, 0.11, sat)) * (1.0 - vGrassW);
          if (grayM > 0.004) {
            vec3 w = pow(abs(normalize(vWN)), vec3(4.0)); w /= (w.x + w.y + w.z);
            // 粗层(补丁/大裂纹 ~6m tile) + 细层(斑点碎石 ~1m tile) 三平面采样
            float d1 = texture2D(uDoodle, vWPos.zy * 0.16).r * w.x
                     + texture2D(uDoodle, vWPos.xz * 0.16).r * w.y
                     + texture2D(uDoodle, vWPos.xy * 0.16).r * w.z;
            float d2 = texture2D(uDoodle, vWPos.zy * 0.95).r * w.x
                     + texture2D(uDoodle, vWPos.xz * 0.95).r * w.y
                     + texture2D(uDoodle, vWPos.xy * 0.95).r * w.z;
            float doodle = d1 * 0.62 + d2 * 0.38;
            diffuseColor.rgb *= mix(1.0, doodle, grayM * 0.82);
          }
        }`);
  };
  const waterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05 });
  let leafMaskTex = null;
  try {
    leafMaskTex = new THREE.TextureLoader().load('./planet/tex/leafmask.png');
  } catch { /* 没有遮罩就整片渲染 */ }
  const leafMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, metalness: 0,
    side: THREE.DoubleSide,
    ...(leafMaskTex ? { alphaMap: leafMaskTex, alphaTest: 0.5, transparent: false } : {}),
  });

  let waterMesh = null;

  results.forEach((res, idx) => {
    if (res.error) { console.warn('planet GLB 加载失败', res.url, res.error); return; }
    const kind = kinds[idx];
    const isWater = kind === 'water';
    const isLeaf = kind === 'leaves' || kind === 'trees';
    const mat = isWater ? waterMat : (isLeaf ? leafMat : terrainMat);
    res.scene.updateMatrixWorld(true); // 必须先刷新矩阵，否则 getWorldPosition 拿到的是恒等变换
    res.scene.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry; // 索引结构保留（BVH 支持索引几何，省内存）
      bakePalette(paletteData, geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = o.name || `p${idx}`;
      mesh.position.copy(o.getWorldPosition(new THREE.Vector3()));
      mesh.quaternion.copy(o.getWorldQuaternion(new THREE.Quaternion()));
      mesh.scale.copy(o.getWorldScale(new THREE.Vector3()));
      if (isWater) { waterMesh = mesh; mesh.renderOrder = 1; mesh.visible = ISLAND_MODE ? true : SHOW_CHUNKS; }
      else if (isLeaf) { mesh.castShadow = true; mesh.visible = ISLAND_MODE ? true : SHOW_LEAVES; }
      else { chunkMeshes.push(mesh); mesh.castShadow = true; mesh.receiveShadow = true; }
      group.add(mesh);
    });
  });

  // 岛心挪到原点（PlanetBuilder 同款：合并 AABB 中心归零）
  const bbox = new THREE.Box3().setFromObject(group);
  const center = bbox.getCenter(new THREE.Vector3());
  group.children.forEach(ch => ch.position.sub(center));

  // 整体缩放到世界尺寸
  group.scale.setScalar(CFG.scale);
  group.updateMatrixWorld(true);

  // BVH：给碎块（只用来烘地面场）
  for (const m of chunkMeshes) m.geometry.computeBoundsTree();
  const sourceMeshes = chunkMeshes.slice();   // 原始碎块壳，烘完只留作对照（?chunks=1）

  // ---------- 星球尺寸标定 ----------
  // 【只针对烘场模式】原版岛(?island=raw|intro)整段跳过：LangCity 从不改尺度，
  // scale 就是 planet.json 的 1.5，标称半径 34×1.5=51，真实岛面 r≈35~55。
  //
  // 烘场模式为什么要放大：碎块壳在镇区揉出一个大洼地，镇界内三分之一的格子低于水面，
  // 摆放阶段会把大批原版落点判成「掉进海里」直接删掉。整场放大不改地形形态（坡度、
  // 海平面都是度量单位），只是把同一张镇子图纸摊大，建筑之间不再互相穿模。
  const TARGET_GROUND_R = 100;
  let WORLD_SCALE = CFG.scale;
  if (!ISLAND_MODE) {
    const probe = new THREE.Raycaster();
    probe.firstHitOnly = true;
    const rs = [];
    for (const v of [0.25, 0.5, 0.75]) for (let a = 0; a < 180; a++) {
      const d = dirFromUV(a / 180, v);
      probe.set(d.clone().multiplyScalar(240), d.clone().negate());
      probe.far = 240;
      const hits = probe.intersectObjects(sourceMeshes, false);
      if (hits.length) rs.push(hits[0].point.length());
    }
    rs.sort((x, y) => x - y);
    const measuredR = rs.length ? rs[rs.length >> 1] : CFG.radius * CFG.scale;
    WORLD_SCALE = CFG.scale * (TARGET_GROUND_R / measuredR);
    group.scale.setScalar(WORLD_SCALE);
    group.updateMatrixWorld(true);
    console.log(`planet calib: 碎块实测中位半径 ${measuredR.toFixed(2)}m → 地面标定 ${TARGET_GROUND_R}m，scale=${WORLD_SCALE.toFixed(3)}`);
  }

  // ---------- 镇子落点数据（烘焙地面场要按镇子密度加权） ----------
  const plan = await fetch('./planet/planet.json').then(r => r.json()).catch(() => null);
  const r2 = (n) => Math.round(n * 100) / 100;
  let seaRadius = R * 0.9;

  // ---------- 地面场烘焙 ----------
  // full_0..9 各是一批互相穿插的浮岛碎块：每张只盖住画面 15~30%，同一方向最多叠 12 层，
  // 层间高差最大 25m。所以"取最外层"必然把建筑放在孤立岩台/悬崖上，猫每走一步在几张壳
  // 之间跳 6~12m。（更正：这 245 个落点不是照着某一份 GLB 标的 —— LangCity 的 planet_math.gd
  // 写明它们就是旧平面地图 data/map.json 的像素坐标，进星球前正映射、存档时逆映射；
  // 原版的 PlanetBuilder 也是直接用十块 full 拼岛，intro_planet 只是缺块时的退化路径。）
  // 这里把全部碎块的最外层高度烘成一张网格场：中值滤波削掉孤立岩台，扩散 + 限坡把悬崖
  // 摊成可走缓坡，镇子覆盖到的地方再平滑一档（镇子落在台地上、野外留山），边缘压到海面
  // 以下让岛自然沉进海里。之后玩法/摆放/体检全部只走这张烘出来的地面。
  // 场覆盖整圈经度（±180），不只是可玩带：dirFromUV 里 lonSpanDeg 是半跨，
  // 245 个落点实际铺到 λ=±130、φ=11~52，烘半边会把另一半甩在海面外，猫走不出镇就掉下去。
  // 带外的格子统一压到海面以下，从经度方向看就是自然消失的海，世界没有「地图尽头」。
  // 注意经纬格是按角度均分的，度量边长随纬度变（1° 经度弧长 ∝ sinφ），一律用 stepLonAt(j)。
  const BF = { N: 240, M: 160, lonHalf: 180, phiA: 2, phiB: 66 };
  const F = {
    h: new Float64Array(BF.N * BF.M),
    slope: new Float64Array(BF.N * BF.M),
    col: new Float32Array(BF.N * BF.M * 3),
    grass: new Float32Array(BF.N * BF.M),
    pave: new Uint8Array(BF.N * BF.M),
    pad: new Uint8Array(BF.N * BF.M),
    town: new Uint8Array(BF.N * BF.M),
    ok: new Uint8Array(BF.N * BF.M),
  };
  const dirAt = (lamDeg, phiDeg) => {
    const lam = D2R(lamDeg), phi = D2R(phiDeg);
    return new THREE.Vector3(Math.sin(phi) * Math.sin(lam), Math.cos(phi), Math.sin(phi) * Math.cos(lam));
  };
  const cellLon = (i) => -BF.lonHalf + (i + 0.5) * 2 * BF.lonHalf / BF.N;
  const cellPhi = (j) => BF.phiA + (j + 0.5) * (BF.phiB - BF.phiA) / BF.M;
  /** 地图像素 → 场的分格浮点坐标（λ 口径必须与 dirFromUV 一致：lonSpanDeg 是半跨，乘 2） */
  function pxToCell(px, py) {
    const lon = (px / CFG.world[0] - 0.5) * 2 * CFG.lonSpanDeg;
    const phi = THREE.MathUtils.lerp(CFG.latTopDeg, CFG.latBottomDeg, py / CFG.world[1]);
    return [(lon + BF.lonHalf) / (2 * BF.lonHalf) * BF.N - 0.5, (phi - BF.phiA) / (BF.phiB - BF.phiA) * BF.M - 0.5];
  }
  /** 场的双线性采样（px 坐标） */
  function sampleField(px, py) {
    const [fx, fy] = pxToCell(px, py);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (x, y) => {
      const xx = Math.min(BF.N - 1, Math.max(0, x)), yy = Math.min(BF.M - 1, Math.max(0, y));
      return F.h[yy * BF.N + xx];
    };
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(x0, y0), at(x0 + 1, y0), tx),
      THREE.MathUtils.lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty);
  }

  // 1) 原始最外层高度 + 调色板颜色
  {
    const rc = new THREE.Raycaster();
    rc.firstHitOnly = true;
    const far = 420;   // 标定后碎块最远壳 ~230m，射线要从它外面进来
    for (let j = 0; j < BF.M; j++) {
      for (let i = 0; i < BF.N; i++) {
        const k = j * BF.N + i;
        const d = dirAt(cellLon(i), cellPhi(j));
        rc.set(d.clone().multiplyScalar(far), d.clone().negate());
        rc.far = far;
        const hits = rc.intersectObjects(sourceMeshes, false);
        if (!hits.length) continue;
        const hit = hits[0];
        F.h[k] = hit.point.length();
        F.slope[k] = Math.acos(THREE.MathUtils.clamp(hit.face.normal.clone().normalize().dot(d), -1, 1)) * 57.2958;
        F.ok[k] = 1;
        let u = 0.5, v = 0.5;
        if (hit.uv) { u = hit.uv.x; v = hit.uv.y; }
        const o = (Math.min(15, Math.max(0, Math.floor(v * 16))) * 16 + Math.min(15, Math.max(0, Math.floor(u * 16)))) * 4;
        const cr = paletteData[o] / 255, cg = paletteData[o + 1] / 255, cb = paletteData[o + 2] / 255;
        F.col[k * 3] = cr; F.col[k * 3 + 1] = cg; F.col[k * 3 + 2] = cb;
        F.grass[k] = THREE.MathUtils.clamp((cg - Math.max(cr, cb)) / 0.14, 0, 1);
      }
    }
    // 空洞用邻格均值迭代填平（画面外/碎块间隙）
    for (let pass = 0; pass < 24; pass++) {
      const src = F.h.slice();
      let holes = 0;
      for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
        const k = j * BF.N + i;
        if (F.ok[k]) continue;
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = i + dx, y = j + dy;
          if (x < 0 || y < 0 || x >= BF.N || y >= BF.M) continue;
          const kk = y * BF.N + x;
          if (!F.ok[kk]) continue;
          s += src[kk]; n++;
        }
        if (n) { F.h[k] = s / n; holes++; }
      }
      if (!holes) break;
      for (let k = 0; k < F.ok.length; k++) if (!F.ok[k] && F.h[k] !== src[k]) F.ok[k] = 1;
    }
    // 颜色空洞同样用邻格补一遍
    for (let pass = 0; pass < 6; pass++) {
      for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
        const k = j * BF.N + i;
        if (F.slope[k] < 90) continue;
        let n = 0; const acc = [0, 0, 0]; let g = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = i + dx, y = j + dy;
          if (x < 0 || y < 0 || x >= BF.N || y >= BF.M) continue;
          const kk = y * BF.N + x;
          if (F.slope[kk] >= 90) continue;
          acc[0] += F.col[kk * 3]; acc[1] += F.col[kk * 3 + 1]; acc[2] += F.col[kk * 3 + 2]; g += F.grass[kk]; n++;
        }
        if (!n) continue;
        F.col[k * 3] = acc[0] / n; F.col[k * 3 + 1] = acc[1] / n; F.col[k * 3 + 2] = acc[2] / n;
        F.grass[k] = g / n; F.slope[k] = 0;
      }
    }
  }
  const rawH = F.h.slice();

  // ---------- 原版岛直通模式（?island=raw / ?island=intro）----------
  // LangCity 的 PlanetBuilder 从不烘场：十块 full_0..9 是同一座岛的穿插分层，直接实例化即对齐，
  // 摆件/出生点全靠对真实网格打射线（street.gd `_place_on_planet`），海面半径取水壳顶点到球心的
  // 中位距离（`_water_shell_radius`），标称半径 34×1.5=51 只用来起射线与画小地图——
  // 真实岛面在 r≈35~55。这个模式就是照这套口径跑：不削平、不台地、不铺街，猫踩的就是原版壳。
  if (ISLAND_MODE) {
    const band = [];
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const lon = Math.abs(cellLon(i)), phi = cellPhi(j);
      if (lon > CFG.lonSpanDeg || phi < CFG.latTopDeg || phi > CFG.latBottomDeg) continue;
      const k = j * BF.N + i;
      if (F.ok[k]) band.push(rawH[k]);
    }
    band.sort((a, b) => a - b);
    const GROUND_R = band.length ? band[band.length >> 1] : CFG.radius * CFG.scale;
    R = GROUND_R;

    // 海平面：水壳顶点的中位球半径（AABB 量不出球冠，Godot 同款注释）
    const seaRadius = (() => {
      if (!waterMesh) return GROUND_R * 0.9;
      waterMesh.updateMatrixWorld(true);
      const pos = waterMesh.geometry.attributes.position;
      const v = new THREE.Vector3();
      const ds = [];
      for (let i = 0; i < pos.count; i++) ds.push(v.fromBufferAttribute(pos, i).applyMatrix4(waterMesh.matrixWorld).length());
      ds.sort((a, b) => a - b);
      return ds.length ? ds[ds.length >> 1] : GROUND_R * 0.9;
    })();

    const rc = new THREE.Raycaster();
    rc.firstHitOnly = true;
    const FAR = GROUND_R * 3 + 60;
    function surfaceAt(dir) {
      const d = dir.clone().normalize();
      rc.set(d.clone().multiplyScalar(FAR), d.clone().negate());
      rc.far = FAR;
      const hit = rc.intersectObjects(chunkMeshes, false)[0] || null;
      if (hit) {
        let col = null, grass = 0;
        const ca = hit.object.geometry.attributes.color, ga = hit.object.geometry.attributes.aGrass;
        if (ca && hit.face) {
          const { a, b, c } = hit.face;
          col = new THREE.Color(
            (ca.getX(a) + ca.getX(b) + ca.getX(c)) / 3,
            (ca.getY(a) + ca.getY(b) + ca.getY(c)) / 3,
            (ca.getZ(a) + ca.getZ(b) + ca.getZ(c)) / 3,
          );
          if (ga) grass = (ga.getX(a) + ga.getX(b) + ga.getX(c)) / 3;
        }
        return { pos: hit.point.clone(), normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize(), hit: true, col, grass };
      }
      return { pos: d.multiplyScalar(GROUND_R), normal: d.clone(), hit: false };
    }
    const groundRadiusAt = (dir) => {
      const h = surfaceAt(dir);
      return h.hit ? h.pos.length() : GROUND_R;
    };
    const slopeAt = (px, py) => {
      const h = surfaceAt(dirFromPx(px, py));
      return h.hit ? Math.acos(THREE.MathUtils.clamp(h.normal.dot(h.pos.clone().normalize()), -1, 1)) * 57.2958 : 90;
    };

    const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return r2(s[Math.min(s.length - 1, Math.floor(s.length * p))]); };
    const el = band.map((h) => h - seaRadius);
    const sl = [];
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const lon = Math.abs(cellLon(i)), phi = cellPhi(j);
      if (lon > CFG.lonSpanDeg || phi < CFG.latTopDeg || phi > CFG.latBottomDeg) continue;
      sl.push(F.slope[j * BF.N + i]);
    }
    console.log(`planet: 原版岛模式(${ISLAND_MODE}) 不烘场 —— 地面中位 r=${GROUND_R.toFixed(2)}m，海 r=${seaRadius.toFixed(2)}m，scale=${CFG.scale}`);
    return {
      group, terrainMeshes: chunkMeshes, sourceMeshes, surfaceAt, groundRadiusAt,
      waterRadius: seaRadius, seaRadius, GROUND_R, plan, groundField: F, planFrame: null, raw: ISLAND_MODE,
      rebuildGround: () => {},
      field: {
        BF, pxToCell, heightAt: sampleField, slopeAt,
        levelDisc: () => {}, levelPath: () => {}, roadDist: () => ({ d: 1e9, t: 0, rd: null }), roadCount: () => 0,
      },
      stats: {
        mode: ISLAND_MODE, cells: band.length,
        elevMin: q(el, 0), elevP50: q(el, 0.5), elevP95: q(el, 0.95), elevMax: q(el, 1),
        slopeP50: q(sl, 0.5), slopeP90: q(sl, 0.9), slopeMax: q(sl, 1),
        terrace: null,
        walkablePct: Math.round(sl.filter((s) => s < 30).length / sl.length * 100),
        tris: chunkMeshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0),
      },
    };
  }

  // 度量边长用可玩带的中位半径算：整圈外壳里混着带外的高岩台，拿全图中位会把米制放大两成
  let rRef = 40;
  {
    const s = [];
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const lon = Math.abs(cellLon(i)), phi = cellPhi(j);
      if (lon > CFG.lonSpanDeg || phi < CFG.latTopDeg || phi > CFG.latBottomDeg) continue;
      s.push(rawH[j * BF.N + i]);
    }
    s.sort((a, b) => a - b);
    rRef = s[s.length >> 1] || 40;
  }
  // 格子度量边长：纬度方向恒定，经度方向随 sinφ 收缩（靠近地图顶端越窄）
  const stepPhi = D2R((BF.phiB - BF.phiA) / BF.M) * rRef;
  const stepLonDeg = D2R(2 * BF.lonHalf / BF.N) * rRef;
  const stepLonAt = (phiDeg) => stepLonDeg * Math.max(0.05, Math.sin(D2R(Math.max(0, phiDeg))));
  const stepLonOf = (j) => stepLonAt(cellPhi(j));

  // 2) 中值滤波（削孤立岩台）→ 扩散（摊平悬崖）→ 限坡
  const medianPass = (src, rad) => {
    const out = src.slice();
    const win = [];
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      win.length = 0;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const x = Math.min(BF.N - 1, Math.max(0, i + dx)), y = Math.min(BF.M - 1, Math.max(0, j + dy));
        win.push(src[y * BF.N + x]);
      }
      win.sort((a, b) => a - b);
      out[j * BF.N + i] = win[win.length >> 1];
    }
    return out;
  };
  const diffuse = (h, passes, lambda = 0.5) => {
    for (let p = 0; p < passes; p++) {
      const src = h.slice();
      for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
        const k = j * BF.N + i;
        let s = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = i + dx, y = j + dy;
          if (x < 0 || y < 0 || x >= BF.N || y >= BF.M) continue;
          s += src[y * BF.N + x]; n++;
        }
        h[k] = src[k] + lambda * (s / n - src[k]);
      }
    }
    return h;
  };
  /** 限坡裁剪：h'(k)=min over 所有格 (h + 沿格走到那里的坡程)，即「不超过 maxSlope 的最大下界场」。
   *  只削峰不填谷——碎块里的假岩台正是悬在真地面之上，削掉才对；正反向交替扫四遍即全局收敛。 */
  function slopeTrim(src, maxSlopeDeg) {
    const tg = Math.tan(D2R(maxSlopeDeg));
    const lx = new Float64Array(BF.M);
    for (let j = 0; j < BF.M; j++) lx[j] = tg * stepLonOf(j);
    const ly = tg * stepPhi;
    const h = src.slice();
    for (let pass = 0; pass < 4; pass++) {
      const fwd = pass % 2 === 0;
      for (let jj = 0; jj < BF.M; jj++) {
        const j = fwd ? jj : BF.M - 1 - jj;
        for (let ii = 0; ii < BF.N; ii++) {
          const i = fwd ? ii : BF.N - 1 - ii;
          const k = j * BF.N + i;
          let v = h[k];
          for (const [dx, dy, l] of [[-1, 0, lx[j]], [1, 0, lx[j]], [0, -1, ly], [0, 1, ly]]) {
            const x = i + dx, y = j + dy;
            if (x < 0 || y < 0 || x >= BF.N || y >= BF.M) continue;
            v = Math.min(v, h[y * BF.N + x] + l);
          }
          h[k] = v;
        }
      }
    }
    return h;
  }
  // 碎块外壳的径向高差有 20~60m，而可玩带只有约 190m×59m——那不是山脉，
  // 是悬在真地面之上的假岩台。中值先削掉孤立台，再按坡度上限削峰。
  //
  // 这一张是「野外」场：限坡 15°，留得住丘陵感。镇区不在这里特判——
  // 之前试过两条特判路，都走歪：按顶点色饱和度判「这是路面所以压平」（碎块壳整体
  // 就是低饱和粉灰，实测镇区 sat 中位 0.028 对阈值 0.03，一半格子直接算灰面），
  // 以及按「离某个落点多远」压一块 3.2m σ 的平地（245 个落点铺满整个可玩带）。
  // 两种判据最后都会把全图摊成平板，房子像粘在桌面上。镇区改到 3b 用明确的手写镇界处理。
  const base = medianPass(medianPass(F.h, 2), 1);
  const hills = slopeTrim(diffuse(slopeTrim(base, 20), 10), 15);
  const H = hills.slice();

  // 4) 海面：取可玩带的低水位，边缘沉进海里
  {
    const core = (i, j) => {
      const lon = Math.abs(cellLon(i)), phi = cellPhi(j);
      return lon <= CFG.lonSpanDeg + 0.5 && phi >= CFG.latTopDeg - 0.5 && phi <= CFG.latBottomDeg + 0.5;
    };
    const inside = [];
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) if (core(i, j)) inside.push(j * BF.N + i);
    const sorted = inside.map(k => H[k]).sort((a, b) => a - b);
    // 海面必须落在镇区最低点之下：拿百分位+抬升会把洼地顶成一片平顶，边缘全是刀切直壁
    seaRadius = sorted[Math.floor(sorted.length * 0.01)] - 0.15;
    // 可玩带外一圈压进海里。经度还有 50° 余量、南北只有 7~14°，所以海岸必然陡——
    // 但陡在玩家走不到的地方，落进水面底下看着就是海蚀崖，比刀切折角自然。
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const k = j * BF.N + i;
      if (core(i, j)) continue;
      const lon = Math.abs(cellLon(i)), phi = cellPhi(j);
      const over = Math.max(
        (lon - CFG.lonSpanDeg) / 6,
        (CFG.latTopDeg - phi) / 5,
        (phi - CFG.latBottomDeg) / 14,
      );
      const t = THREE.MathUtils.smoothstep(Math.max(0, over), 0, 1);
      H[k] = THREE.MathUtils.lerp(H[k], seaRadius - 1.2, t);
    }
    // 只平滑镇外那一圈：core 当边值不动，把折角摊开；海面以下多深都无所谓
    const shore = [];
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) if (!core(i, j)) shore.push(j * BF.N + i);
    for (let p = 0; p < 10; p++) {
      const src = H.slice();
      for (const k of shore) {
        const i = k % BF.N, j = (k / BF.N) | 0;
        let s = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = i + dx, y = j + dy;
          if (x < 0 || y < 0 || x >= BF.N || y >= BF.M) continue;
          s += src[y * BF.N + x]; n++;
        }
        if (n) H[k] = H[k] + 0.5 * (s / n - H[k]);
      }
    }
  }
  F.h.set(H);
  /** 场坡度（相邻格最大倾角）：地基压平后要重算，体检与摆放都读它 */
  function recomputeSlope() {
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const k = j * BF.N + i;
      let worst = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + dx, y = j + dy;
        if (x < 0 || y < 0 || x >= BF.N || y >= BF.M) continue;
        const ax = dx ? stepLonOf(j) : stepPhi;
        worst = Math.max(worst, Math.atan(Math.abs(F.h[y * BF.N + x] - F.h[k]) / ax) * 57.2958);
      }
      F.slope[k] = worst;
    }
  }
  recomputeSlope();

  // 地面中位半径：弧长↔角度换算用它。标称 R=51 是照 GLB 猜的，实测地面在 36 上下，
  // 拿 51 算会把建筑碰撞圈缩掉三成、猫一步滑 0.7 步，所以烘完就地改成真值。
  const GROUND_R = (() => {
    const s = [];
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const lon = Math.abs(cellLon(i)), phi = cellPhi(j);
      if (lon > CFG.lonSpanDeg || phi < CFG.latTopDeg || phi > CFG.latBottomDeg) continue;
      s.push(F.h[j * BF.N + i]);
    }
    s.sort((a, b) => a - b);
    return s[s.length >> 1];
  })();
  R = GROUND_R;

  // ---------- 3b) 镇区台地：一块高于海面的平整地面 + 按 HANDOFF 色板重画地表 ----------
  // 「哪里算城镇」只在这一处判定（手写规划 townPlan 的镇界），不再散进顶点色饱和度
  // 和「离某个落点多远」里：插入的碎块壳整体就是低饱和粉灰（实测镇区 sat 中位 0.028，
  // 阈值 0.03，一半格子直接算灰面），那两种判据最后会把全图摊成一块平板。
  // 台面直接烘进地面网格顶点：玩法射线只碰这张地面（terrainMeshes=[groundMesh]），
  // 所以「看到的路」必须和「踩到的路」是同一张网，否则猫永远走在地球基底上。
  //
  // 为什么非要把整块镇抬高：插进来的碎块壳在可玩带正中揉出一个大洼地。实测镇界内
  // 6814 格里 2203 格（32%）低于水面（洼底 77.6，海面 80.1），摆放阶段因此把 102 个
  // 原版落点判成「掉进海里」直接删掉——手作内容就是这么丢的。台地取镇内干地的六成
  // 高分位，一次填平洼地；镇外按「离镇界的真实米距」加一道锥形限高，
  // 贴着台地的假岩台削下来、洼地垫上去，接回坡度不超过 18°，玩家走出镇才重新见山。
  let terraceInfo = null;
  const planFrame = (() => {
    const probe = makePlanFrame(GROUND_R);
    const dv = new THREE.Vector3();
    const dry = [];
    let wet = 0;
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const p = probe.dirToPlan(dv.copy(dirAt(cellLon(i), cellPhi(j))));
      if (Math.abs(p.x) > TOWN_RECT.xT || Math.abs(p.z) > TOWN_RECT.zT) continue;
      const h = hills[j * BF.N + i];
      if (h > seaRadius + 0.8) dry.push(h); else wet++;
    }
    dry.sort((a, b) => a - b);
    // 台地高程：干地 p60，但无论如何要高出海面 2.5m（街床、坪、出生点都在它上面）
    const level = Math.max(seaRadius + 2.5, dry.length ? dry[Math.floor(dry.length * 0.6)] : seaRadius + 3);
    // 规划坐标系用台地自己的半径：plan 的 1 米就是脚下实打实的 1 米。
    // 拿全图中位半径（92.55）换算的话，街网会比设计窄一成，斑马线对不上路口。
    const frame = makePlanFrame(level);
    const t = Math.tan(D2R(TOWN_RECT.coneDeg));
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const k = j * BF.N + i;
      const p = frame.dirToPlan(dv.copy(dirAt(cellLon(i), cellPhi(j))));
      const dOut = Math.hypot(Math.max(Math.abs(p.x) - TOWN_RECT.xT, 0), Math.max(Math.abs(p.z) - TOWN_RECT.zT, 0));
      const h0 = F.h[k];
      if (dOut <= 1e-6) {
        F.h[k] = level;                                   // 镇界内：一寸不高不低的台面
      } else {
        F.h[k] = THREE.MathUtils.clamp(h0, level - t * dOut, level + t * dOut);
      }
      if (F.h[k] !== h0) F.pad[k] = 0;                    // 台地改过的高程不属于任何地基
      const cw = dOut <= 1e-6 ? 1 : 1 - THREE.MathUtils.smoothstep(dOut, 0, TOWN_RECT.colourRamp);
      if (cw < 0.02) continue;
      if (cw > 0.6) F.town[k] = 1;
      // 碎块壳自带的粉灰调色板是「像鬼」的根源：镇区连外围缓坡一起改用规格书色板。
      // 街道本身不画在顶点色里（2.1m 一格画不出 4m 宽的路），交给 streetMesh 的实体条带。
      groundColor(frame, p.x, p.z, TMP_COL);
      F.col[k * 3] = THREE.MathUtils.lerp(F.col[k * 3], TMP_COL.r, cw);
      F.col[k * 3 + 1] = THREE.MathUtils.lerp(F.col[k * 3 + 1], TMP_COL.g, cw);
      F.col[k * 3 + 2] = THREE.MathUtils.lerp(F.col[k * 3 + 2], TMP_COL.b, cw);
      F.grass[k] = THREE.MathUtils.lerp(F.grass[k], 1, cw * 0.85);
    }
    terraceInfo = { level: +level.toFixed(2), frameR: +frame.R.toFixed(2), dryCells: dry.length, wetCells: wet, sea: +seaRadius.toFixed(2) };
    recomputeSlope();   // 台面压平后坡度场要跟着更新，摆放与体检都读它
    return frame;
  })();

  /** 局部地基：先登记（目标高程取天然地形），rebuildGround 时一次性写入。
   *  逐块即时写入的话，相邻两块坪的接回缓坡会互相从对方墙脚下穿过，
   *  刚压平的地面又被下一块坪的斜坡掀斜 —— 实测有民居因此浮到 0.4m。 */
  const pads = [];
  function levelDisc(px, py, rM) {
    const [fx, fy] = pxToCell(px, py);
    const target = sampleField(px, py);
    pads.push({ cx: fx + 0.5, cy: fy + 0.5, rM, target });
    return target;
  }

  /** 坪内 dist ≤ rM 铺平，外圈按 ≤14° 的缓坡接回原地形。
   *  边宽由高差反推——写死 0.9m 的话两块高差 1m 的相邻地基之间就是一道直壁。
   *  半径一律按真实弧长算：经向 1 格的实际宽度随纬度变，中纬度差 2~3 倍。
   *  一次算完所有坪的候选、每格取权重最大的那块：谁也不覆盖谁，
   *  写入顺序不再决定结果（逐块即时写入时，后一块的斜坡会切进前一块的坪面）。
   *  坪高先各自取核内中位数，再做一轮松弛：两块坪的坪面一旦挨着或搭界，
   *  高差就会在两格之间立成 60° 的直壁（实测售货机、垃圾桶正好卡在这种壁上）。 */
  function applyPads() {
    F.pad.fill(0);
    const bestT = new Map();     // 格号 → { w, target }
    const put = (k, w, target) => {
      const cur = bestT.get(k);
      if (!cur || w > cur.w) bestT.set(k, { w, target });
    };
    const A = [];
    for (const p of pads) {
      const ci = Math.round(p.cx), cj = Math.round(p.cy);
      const lx = stepLonOf(cj);
      const jLo = Math.max(0, cj - Math.ceil((p.rM + 12) / stepPhi)), jHi = Math.min(BF.M - 1, cj + Math.ceil((p.rM + 12) / stepPhi));
      // 坪内高程取核内中位数，不取中心单点：压在坡上的坪若按中心点定高，
      // 半边坪是填方半边是挖方，压完仍然一边翘。
      const inside = [];
      for (let j = jLo; j <= jHi; j++) {
        const lxj = stepLonOf(j), dy = (j - p.cy) * stepPhi;
        const half = Math.ceil((p.rM + 6) / lxj);
        for (let i = Math.max(0, ci - half); i <= Math.min(BF.N - 1, ci + half); i++) {
          if (Math.hypot((i - p.cx) * lxj, dy) > p.rM) continue;
          inside.push(F.h[j * BF.N + i]);
        }
      }
      inside.sort((a, b) => a - b);
      A.push({
        cx: p.cx, cy: p.cy, ci, cj, lx, rM: p.rM, target: inside.length ? inside[inside.length >> 1] : p.target, jLo, jHi,
        rf: p.rM + Math.hypot(lx, stepPhi) * 0.75,
      });
    }
    // 坪间松弛：重叠的坪合成同一台面，相邻不重叠的坪之间只允许 ≤18° 的过渡
    for (let pass = 0; pass < 10; pass++) {
      let fixed = 0;
      for (let a = 0; a < A.length; a++) {
        for (let b = a + 1; b < A.length; b++) {
          const pa = A[a], pb = A[b];
          const lxm = 0.5 * (pa.lx + pb.lx);
          const D = Math.hypot((pa.cx - pb.cx) * lxm, (pa.cy - pb.cy) * stepPhi);
          if (D > pa.rf + pb.rf + 14) continue;                 // 够不着的坪互不影响
          const diff = pa.target - pb.target;
          const ad = Math.abs(diff);
          if (ad < 0.02) continue;
          const gap = D - pa.rf - pb.rf;
          const allow = gap <= 0 ? 0 : Math.tan(D2R(18)) * gap;
          if (ad <= allow) continue;
          if (gap <= 0) {                                       // 坪面搭界 → 一块台地，按面积定高
            const wa = pa.rf * pa.rf, wb = pb.rf * pb.rf;
            pa.target = pb.target = (pa.target * wa + pb.target * wb) / (wa + wb);
          } else {
            const half = (ad - allow) / 2, s = diff > 0 ? 1 : -1;
            pa.target -= s * half; pb.target += s * half;
          }
          fixed++;
        }
      }
      if (!fixed) break;
    }
    for (const p of A) {
      // 高差要往坪外看 10m：只看 6m 的话，靠海的坪把「坪→海岸」的整段落差
      // 挤进 7m 的收口边，实测收口处 46°，摆在边上的自动售货机就像卡在崖壁上。
      let dh = 0;
      for (let j = p.jLo; j <= p.jHi; j++) {
        const lx = stepLonOf(j), dy = (j - p.cy) * stepPhi;
        const half = Math.ceil((p.rM + 10) / lx);
        for (let i = Math.max(0, p.ci - half); i <= Math.min(BF.N - 1, p.ci + half); i++) {
          const dist = Math.hypot((i - p.cx) * lx, dy);
          if (dist <= p.rM || dist > p.rM + 10) continue;         // 坪内不参与高差
          dh = Math.max(dh, Math.abs(F.h[j * BF.N + i] - p.target));
        }
      }
      const edgeM = THREE.MathUtils.clamp(dh / Math.tan(D2R(14)), 1.0, 9.0);
      for (let j = p.jLo; j <= p.jHi; j++) {
        const lx = stepLonOf(j), dy = (j - p.cy) * stepPhi;
        // 网格顶点走的是 sampleCell(i-0.5, j-0.5)，等于把场做了 2×2 平均：
        // 场里压到 rM，网格上只有 rM−1 格是平的，剩下半格被天然地形拽歪。
        // 坪核按同样的模糊量反向放大，网格才真是平的。
        const half = Math.ceil((p.rf + edgeM) / lx);
        for (let i = Math.max(0, p.ci - half); i <= Math.min(BF.N - 1, p.ci + half); i++) {
          const dist = Math.hypot((i - p.cx) * lx, dy);
          if (dist > p.rf + edgeM) continue;
          const d = Math.max(0, (dist - p.rf) / edgeM);
          const w = 1 - d * d * (3 - 2 * d);                     // smoothstep，边缘不留折角
          put(j * BF.N + i, w, p.target);
        }
      }
    }
    for (const [k, v] of bestT) {
      F.h[k] = THREE.MathUtils.lerp(F.h[k], v.target, v.w * 0.96);
      if (v.w > 0.6) F.pad[k] = 1;   // 这块格的高程归地基：街从坪下穿过时不许把台面掀高
    }
    pads.length = 0;
  }

  // ---------- 街道：沿折线压平 + 街床底色 ----------
  // 实体路面是 town.js 的 streetMesh 条带（沥青/路缘/人行道一个断面画全），这里只把街床压平，
  // 并在条带底下留一圈同色底，免得条带接缝处露出碎块壳那片粉土。
  // 插进来的碎块壳只带了一片粉土，没有任何路面：出生点→车站→商店街走不成一条路，
  // 建筑也像随手撒在坡上。街是照 planet.json 的建筑锚点现算的。
  const roads = [];
  /** pts: [[px,py],...] 折线，halfM: 半宽（米）。街心线在 town.js 里连好再登记。 */
  function levelPath(pts, halfM) {
    if (!pts || pts.length < 2 || !(halfM > 0)) return;
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pxToCell(pts[i][0], pts[i][1]), b = pxToCell(pts[i + 1][0], pts[i + 1][1]);
      const ax = a[0] + 0.5, ay = a[1] + 0.5, bx = b[0] + 0.5, by = b[1] + 0.5;
      const mj = Math.round(THREE.MathUtils.clamp((ay + by) / 2, 0, BF.M - 1));
      const len = Math.hypot((bx - ax) * stepLonOf(mj), by - ay);
      const n = Math.max(1, Math.ceil(len / 0.8));
      for (let s = (i === 0 ? 0 : 1); s <= n; s++) {
        const t = s / n;
        dense.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      }
    }
    roads.push({ dense, halfM });
  }

  function applyRoads() {
    for (const rd of roads) {
      // 纵断面照「压完坪的地表」取点，再滑动平均三次：街面自己就成了缓坡。
      // 必须在 applyPads 之后跑，否则街会按天然地形定高，在每块地基的坪沿立坎。
      const prof = rd.dense.map(([cx, cy]) => sampleCell(cx - 0.5, cy - 0.5).r);
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < prof.length - 1; i++) prof[i] = (prof[i - 1] + prof[i] * 2 + prof[i + 1]) / 4;
      }
      const half = rd.halfM;
      for (let p = 0; p < rd.dense.length; p++) {
        const [cx, cy] = rd.dense[p];
        const jLo = Math.max(0, Math.floor(cy - (half + 1.8) / stepPhi)), jHi = Math.min(BF.M - 1, Math.ceil(cy + (half + 1.8) / stepPhi));
        for (let j = jLo; j <= jHi; j++) {
          const lx = stepLonOf(j), dy = (j - cy) * stepPhi;
          const iLo = Math.max(0, Math.floor(cx - (half + 1.8) / lx)), iHi = Math.min(BF.N - 1, Math.ceil(cx + (half + 1.8) / lx));
          for (let i = iLo; i <= iHi; i++) {
            const dist = Math.hypot((i - cx) * lx, dy);
            if (dist > half + 1.4) continue;
            // 路面要留一段「满值」的硬核：网格顶点走的是 2×2 平均，
            // 从路缘就开始衰减的话，4m 宽的路会被平均回原地表色，一寸路面都看不见。
            const w = 1 - THREE.MathUtils.clamp((dist - half * 0.86) / (half * 0.14 + 1.0), 0, 1);
            if (w <= 0.02) continue;
            const k = j * BF.N + i;
            if (!F.pad[k]) F.h[k] = THREE.MathUtils.lerp(F.h[k], prof[p], w * 0.97);   // 坪内高程归地基
            if (w > 0.55) F.pave[k] = 1;
            // 路面颜色不在这里画：实体条带 streetMesh 已经按 HANDOFF 色板铺好沥青/路缘/人行道，
            // 顶点色只负责条带外那一圈路肩。以前这里往两侧各刷近白（实测 224/225/231，出界 4m），
            // 12m 的街区被糊掉 8m，整个镇子读起来就是一块看不出材质的浅粉地毯。
            // 街缘色交给 townPlan.groundColor（pave→sand 的踩踏土色），这里只压草权重。
            // 草权重单独一条：只让开 streetMesh 真正铺到头的 half + 0.35。
            // 跟着上面那条 1m 路肩缓坡一起衰减的话，12m 街区中央只剩 2.5m 见方保得住草，
            // 全镇街区就是一片砂石贴图（实测 block 内像素均值 215,205,180，色板草是 143,168,118）。
            const wg = 1 - THREE.MathUtils.clamp((dist - half * 0.86) / (half * 0.14 + 0.35), 0, 1);
            F.grass[k] = THREE.MathUtils.lerp(F.grass[k], 0, wg);
          }
        }
      }
    }
  }

  /** 到最近街心的米距：摆道具靠它躲开路肩，比读顶点色可靠（色要烘完才有） */
  function roadDist(px, py) {
    const c = pxToCell(px, py);
    const cx = c[0] + 0.5, cy = c[1] + 0.5;
    let best = Infinity;
    for (const rd of roads) {
      for (const [dx, dy] of rd.dense) {
        const j = Math.round(THREE.MathUtils.clamp(dy, 0, BF.M - 1));
        const d = Math.hypot((dx - cx) * stepLonOf(j), (dy - cy) * stepPhi);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // ---------- 地面网格 ----------
  const paletteCells = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const o = (y * 16 + x) * 4;
    paletteCells.push([paletteData[o] / 255, paletteData[o + 1] / 255, paletteData[o + 2] / 255]);
  }
  function snapPalette(c) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < paletteCells.length; i++) {
      const p = paletteCells[i], dr = p[0] - c[0], dg = p[1] - c[1], db = p[2] - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return paletteCells[best];
  }
  /** 场的双线性采样（分格坐标），返回 {r, col, grass} */
  function sampleCell(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const at = (i, j) => {
      const ii = Math.min(BF.N - 1, Math.max(0, i)), jj = Math.min(BF.M - 1, Math.max(0, j));
      return jj * BF.N + ii;
    };
    const k00 = at(x0, y0), k10 = at(x0 + 1, y0), k01 = at(x0, y0 + 1), k11 = at(x0 + 1, y0 + 1);
    const lerp4 = (get) => THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(get(k00), get(k10), tx), THREE.MathUtils.lerp(get(k01), get(k11), tx), ty);
    const col = [0, 1, 2].map(c => lerp4(k => F.col[k * 3 + c]));
    // 街面与镇区地表是程序按规格书色板画的，不吸碎块壳那 16 色调色板：
    // 一吸就被就近的粉灰带走，路面和草地又变回「看不出是什么材质」
    const paved = (F.pave[k00] && F.pave[k10] && F.pave[k01] && F.pave[k11])
      || (F.town[k00] && F.town[k10] && F.town[k01] && F.town[k11]);
    return { r: lerp4(k => F.h[k]), col: paved ? col : snapPalette(col), grass: lerp4(k => F.grass[k]) };
  }

  const groundGeo = new THREE.BufferGeometry();
  const groundMesh = new THREE.Mesh(groundGeo, terrainMat);
  groundMesh.name = 'baked_ground';
  groundMesh.castShadow = true;
  groundMesh.receiveShadow = true;
  groundMesh.scale.setScalar(1 / WORLD_SCALE);   // 场按世界米存，抵消 group 的整体缩放
  group.add(groundMesh);

  function writeGroundGeometry() {
    const vn = BF.N + 1, vm = BF.M + 1, cnt = vn * vm;
    const pos = new Float32Array(cnt * 3), col = new Float32Array(cnt * 3);
    const grass = new Float32Array(cnt), uvs = new Float32Array(cnt * 2);
    for (let j = 0; j < vm; j++) {
      for (let i = 0; i < vn; i++) {
        const k = j * vn + i;
        const s = sampleCell(i - 0.5, j - 0.5);
        const d = dirAt(-BF.lonHalf + i * 2 * BF.lonHalf / BF.N, BF.phiA + j * (BF.phiB - BF.phiA) / BF.M);
        pos[k * 3] = d.x * s.r; pos[k * 3 + 1] = d.y * s.r; pos[k * 3 + 2] = d.z * s.r;
        col[k * 3] = s.col[0]; col[k * 3 + 1] = s.col[1]; col[k * 3 + 2] = s.col[2];
        grass[k] = s.grass;
        // uv 按真实弧长铺（经向 1 格的宽度随纬度变），贴图才不会被投影拉扁
        uvs[k * 2] = (i * stepLonAt(BF.phiA + j * (BF.phiB - BF.phiA) / BF.M)) / 5;
        uvs[k * 2 + 1] = (j * stepPhi) / 5;
      }
    }
    const idx = [];
    for (let j = 0; j < vm - 1; j++) for (let i = 0; i < vn - 1; i++) {
      const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    groundGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    groundGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    groundGeo.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
    groundGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    groundGeo.setIndex(idx);
    groundGeo.computeVertexNormals();
    groundGeo.deleteBoundsTree?.();
    groundGeo.computeBoundsTree();
    // group 的矩阵在摆完碎块时就刷过一次，之后新加的地面/海壳从没进过 matrixWorld。
    // 首帧渲染之前所有摆放射线都拿恒等变换去求交 → 上百个落点「没有地面」，必须就地刷新。
    group.updateMatrixWorld(true);
    recomputeSlope();   // 地基压平后坡度场要跟着一块儿更新
  }
  writeGroundGeometry();
  const terrainMeshes = [groundMesh];   // 玩法/摆放/体检只认这张地面
  sourceMeshes.forEach(m => { m.visible = SHOW_CHUNKS; });

  // ---------- 海面：换成真正的球壳 ----------
  // 原 planets_present_water.glb 同样是碎块，铺在地上读作一块发光的平板；
  // 烘完的地面最低点就是海岸线，海面只有球壳才像一颗行星。
  // 注意 group 自带 1.5 倍缩放，球半径要按本地单位给，否则海面会把整座岛吞掉。
  // 场景没有 envMap：粗糙度必须高，否则镜面项反射不到东西 → 整颗球渲染成黑的。
  const waterSphere = new THREE.Mesh(
    new THREE.SphereGeometry(seaRadius / WORLD_SCALE, 96, 64),
    new THREE.MeshStandardMaterial({
      color: 0x7fb4bd, roughness: 0.62, metalness: 0,
    }),
  );
  waterSphere.name = 'planets_present_water_sphere';   // mseSwap 靠 /water/ 认它
  group.add(waterSphere);
  const waterRadius = seaRadius;

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const RAY_FAR = seaRadius + 90;

  /** 沿 dir 取地面：只剩一张烘过的地面 → 看到的就是踩到的 */
  function surfaceAt(dir) {
    const d = dir.clone().normalize();
    raycaster.set(d.clone().multiplyScalar(RAY_FAR), d.clone().negate());
    raycaster.far = RAY_FAR - seaRadius + 30;
    const hit = raycaster.intersectObjects(terrainMeshes, false)[0] || null;
    if (hit) {
      // 命中三角形顶点色均值 → 表面类型（撒细节时判草地/灰路面/暖沙）
      let col = null, grass = 0;
      const ca = hit.object.geometry.attributes.color, ga = hit.object.geometry.attributes.aGrass;
      if (ca && hit.face) {
        const { a, b, c } = hit.face;
        col = new THREE.Color(
          (ca.getX(a) + ca.getX(b) + ca.getX(c)) / 3,
          (ca.getY(a) + ca.getY(b) + ca.getY(c)) / 3,
          (ca.getZ(a) + ca.getZ(b) + ca.getZ(c)) / 3,
        );
        if (ga) grass = (ga.getX(a) + ga.getX(b) + ga.getX(c)) / 3;
      }
      return { pos: hit.point.clone(), normal: hit.face.normal.clone().normalize(), hit: true, col, grass };
    }
    return { pos: d.multiplyScalar(GROUND_R), normal: d.clone(), hit: false };
  }

  /** 猫脚下的地面半径（米，世界坐标） */
  function groundRadiusAt(dir) {
    const h = surfaceAt(dir);
    return h.hit ? h.pos.length() : GROUND_R;
  }

  /** 场的高程/坡度统计（体检报告用） */
  const stats = (() => {
    const el = [], sl = [];
    for (let j = 0; j < BF.M; j++) for (let i = 0; i < BF.N; i++) {
      const lon = Math.abs(cellLon(i)), phi = cellPhi(j);
      if (lon > CFG.lonSpanDeg || phi < CFG.latTopDeg || phi > CFG.latBottomDeg) continue;
      const k = j * BF.N + i;
      el.push(F.h[k] - seaRadius); sl.push(F.slope[k]);
    }
    const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return r2(s[Math.min(s.length - 1, Math.floor(s.length * p))]); };
    return {
      cells: el.length, elevMin: q(el, 0), elevP50: q(el, 0.5), elevP95: q(el, 0.95), elevMax: q(el, 1),
      slopeP50: q(sl, 0.5), slopeP90: q(sl, 0.9), slopeMax: q(sl, 1),
      terrace: terraceInfo,
      walkablePct: Math.round(sl.filter((s) => s < 30).length / sl.length * 100),
      tris: groundGeo.index.count / 3,
    };
  })();

  return {
    group, terrainMeshes, sourceMeshes, surfaceAt, groundRadiusAt, waterRadius, seaRadius,
    GROUND_R, plan, groundField: F, planFrame,
    rebuildGround: () => { applyPads(); applyRoads(); writeGroundGeometry(); },
    field: {
      BF, pxToCell,
      heightAt: sampleField,
      slopeAt: (px, py) => {
        const [fx, fy] = pxToCell(px, py);
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const at = (i, j) => {
          const ii = Math.min(BF.N - 1, Math.max(0, i)), jj = Math.min(BF.M - 1, Math.max(0, j));
          return F.slope[jj * BF.N + ii];
        };
        return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(x0, y0), at(x0 + 1, y0), tx),
          THREE.MathUtils.lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty);
      },
      levelDisc, levelPath, roadDist, roadCount: () => roads.length,
    },
    stats,
  };
}
