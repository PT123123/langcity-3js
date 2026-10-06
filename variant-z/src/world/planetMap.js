// 现成地图加载：LangCity 原版星球地形 GLB（planets_present_full_0..9 分层拼岛）
// + 海面 + 高模树冠 + planet.json 落点数据的球面坐标换算（移植 PlanetMath）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

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
export const R = CFG.radius * CFG.scale;

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

/**
 * 加载原版星球：full_0..9 地形（进 BVH/碰撞）+ 海面 + 树冠（装饰）。
 * 返回 { group, terrainMeshes, surfaceAt(dir)→{pos,normal,hit}, waterRadius }
 */
export async function loadPlanet() {
  const paletteData = await loadPalette();

  const urls = [];
  for (let i = 0; i < 10; i++) urls.push(`./planet/planets_present_full_${i}.glb`);
  urls.push('./planet/planets_present_water.glb');
  for (let i = 0; i < 5; i++) urls.push(`./planet/planets_present_tree-leaves_${i}.glb`);

  const results = await Promise.all(urls.map(u => loadGLB(u).catch(e => ({ error: String(e && e.message || e), url: u }))));
  window.__loadErrors = results.filter(r => r.error).map(r => `${r.url}: ${r.error}`);

  const group = new THREE.Group();
  const terrainMeshes = [];
  // 漫画风地面:调色板顶点色平涂 + 纯灰度手绘噪声(云噪声图,三通道相等不染色;noises-terrain 是绿色色带,不能用)
  const groundNoise = new THREE.TextureLoader().load('./tex-messenger/clouds-noise-512.png');
  groundNoise.wrapS = groundNoise.wrapT = THREE.RepeatWrapping;
  groundNoise.repeat.set(48, 24); // UV 跨整个星球(周长约 320m),48 铺 → 每tile约6.7m
  groundNoise.anisotropy = 8;
  // 噪声均亮 0.707(实测灰度),color 提 1/0.707 保住顶点色整体亮度,只留手绘明暗摆动
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
    map: groundNoise, color: new THREE.Color(1.414, 1.414, 1.414),
  });
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
    const isWater = idx === 10;
    const isLeaf = idx > 10;
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
      if (isWater) { waterMesh = mesh; mesh.renderOrder = 1; }
      else if (isLeaf) { mesh.castShadow = true; }
      else { terrainMeshes.push(mesh); mesh.castShadow = true; mesh.receiveShadow = true; }
      group.add(mesh);
    });
  });

  // 岛心挪到原点（PlanetBuilder 同款：合并 AABB 中心归零）
  const bbox = new THREE.Box3().setFromObject(group);
  const center = bbox.getCenter(new THREE.Vector3());
  group.children.forEach(ch => ch.position.sub(center));

  // 整体缩放到世界尺寸（radius 34 → 51）
  group.scale.setScalar(CFG.scale);
  group.updateMatrixWorld(true);

  // 水面壳半径：水壳顶点到球心距离的中位数
  let waterRadius = R * 0.995;
  if (waterMesh) {
    const pos = waterMesh.geometry.attributes.position;
    const ds = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 500))) {
      v.fromBufferAttribute(pos, i);
      ds.push(v.length());
    }
    ds.sort((a, b) => a - b);
    waterRadius = ds[Math.floor(ds.length / 2)] * CFG.scale;
  }

  // BVH：只给地形块（射线取高/物件落点全走这里）
  for (const m of terrainMeshes) m.geometry.computeBoundsTree();

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;

  /** 沿 dir 从外向内打地形，取表面落点（物件摆放/地面高度统一入口）
   *  浮空岩石等装饰会先被打中——按「半径最接近标称岛面」过滤（原版只碰 full_0..9 的等效逻辑） */
  function pickIslandHit(hits) {
    for (const h of hits) {
      if (Math.abs(h.point.length() - R) < 9) return h;
    }
    return hits[0] || null;
  }

  function surfaceAt(dir, farMultiplier = 3) {
    const d = dir.clone().normalize();
    const far = R * farMultiplier + 60;
    raycaster.set(d.clone().multiplyScalar(far), d.clone().negate());
    raycaster.far = far;
    const hits = raycaster.intersectObjects(terrainMeshes, false);
    const hit = pickIslandHit(hits);
    if (hit) {
      return { pos: hit.point.clone(), normal: hit.face.normal.clone().normalize(), hit: true };
    }
    return { pos: d.multiplyScalar(R), normal: d.clone(), hit: false };
  }

  /** 猫脚下的地面半径（米，世界坐标） */
  function groundRadiusAt(dir) {
    const h = surfaceAt(dir, 1.5);
    return h.hit ? h.pos.length() : R;
  }

  return { group, terrainMeshes, surfaceAt, groundRadiusAt, waterRadius };
}
