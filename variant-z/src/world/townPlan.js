// 手写城镇规划：移植自仓库 HEAD 的 src/world/layout.js + src/world/planet.js 地面绘制。
//
// 为什么要它：planet.json 的 245 个落点写明是给 planets_present_intro_planet.glb 用的
// （那颗模型不在仓库里），插进来的 planets_present_full_* 碎块壳只带了一片粉灰地皮，
// 一寸路面都没有。之前我在这里现算最小生成树当街道，量出来是 27 条 6m 短枝，
// 玩家从出生点看着像「楼之间随便踩出来的缝」，不像街。原版 layout.js 里有真正
// 定过的一套：主干/次干/巷/广场/停车场/斑马线，照它铺。
//
// plan 坐标系：x 向东（米）、z 向南（米），原点 = 站前广场中心。
import * as THREE from 'three';
import { CFG, pxFromDir } from './planetMap.js';

const D2R = THREE.MathUtils.degToRad;

/** 广场中心的余纬：可玩带 10°~52° 的正中，南北各留 21°（≈30m）给镇 */
export const PHI0_DEG = 31;
export const SIDEWALK_W = 1.35;

// ---------- HANDOFF §2.2 色板（低饱和、同一色彩环境） ----------
export const PLAN_C = {
  asphalt: 0x6f6a66, asphaltHi: 0x75706c, line: 0xfffaf2,
  kerb: 0xb8b2a8, kerbDark: 0x8d867c,
  pave: 0xa89f92, paveAlt: 0xb5ab9c, paveJoint: 0x877e73,
  plaza: 0xcabfb0, plazaAlt: 0xbcb2a4, plazaEdge: 0x9a8f80,
  grass: 0x8fa876, grassDark: 0x7d9a6c, forest: 0x6f8b60,
  sand: 0xe8d8ae, sandWet: 0xd2ba92, sea: 0x7fb3b5,
};

// ---------- 路网 ----------
// 原版 6 条（南北主街/东西大街/住宅区街/东巷/西巷/商店后巷）保留，
// 向东西两侧延长并补两条环路、两条巷：可玩带在 φ=31° 处约 190m 宽，
// 原版那 52m 见方的镇芯只占中间一小块，其余地方还是「平地插模型」。
// 注意经线在球面上是收的：z=-22 一带只剩 ±44m 可放，环路不能一律拉到 ±34。
//
// 并图后（CITY_OBJECTS 住核心、原版 245 条外迁到环镇路一带）又补了两件事：
// ① 北环/南环/商店街/住宅区街一律拉到 ±34，东西大街拉到 ±44 通到乡间；
// ② 新增环镇东路/环镇西路（x=±34，z=-22..21），和四条横线闭合成一圈外环。
// 有了这圈环，从核心外迁出去的原版落点才每条都临街、能从站前广场一路走过去，
// 而不是「镇界外一片平地上散着模型」。
export const ROADS = [
  // 南北主街在站房前门收口（原 z1=-24 是从站房中间穿过去的：layout.js 写这张表时
  // 「路只是地面贴皮」，搬到球面上就是一进门被站房堵死）。站房北移 1.5m 让出前坪，
  // 主街止于商店街路口，站后那块靠 北环 + 东/西二巷连通。
  { x1: 0, z1: -12.4, x2: 0, z2: 24, w: 2.4, main: true, name: '南北主街' },
  { x1: -44, z1: 0, x2: 44, z2: 0, w: 2.4, main: true, name: '东西大街' },
  { x1: -34, z1: 12, x2: 34, z2: 12, w: 2.0, name: '住宅区街' },
  { x1: -34, z1: -12, x2: 34, z2: -12, w: 2.0, name: '商店街' },
  { x1: -34, z1: -22, x2: 34, z2: -22, w: 1.7, name: '北环' },
  { x1: -34, z1: 21, x2: 34, z2: 21, w: 1.7, name: '南环' },
  { x1: 12, z1: -12, x2: 12, z2: 12, w: 1.7, name: '东巷' },
  { x1: -12, z1: -12, x2: -12, z2: 12, w: 1.7, name: '西巷' },
  { x1: 24, z1: -22, x2: 24, z2: 21, w: 1.7, name: '东二巷' },
  { x1: -24, z1: -22, x2: -24, z2: 21, w: 1.7, name: '西二巷' },
  { x1: 34, z1: -22, x2: 34, z2: 21, w: 1.7, name: '环镇东路' },
  { x1: -34, z1: -22, x2: -34, z2: 21, w: 1.7, name: '环镇西路' },
];

export const PLAZA = { x: 0, z: 0, r: 5.6 };
export const PARKING = { x1: 4.5, z1: -19, x2: 11, z2: -13.5, bay: 1.6 };

/** 镇界（plan 米）。台地压平、街前认领、地表重画三处共用这一个口径：
 *  以前「哪里算城镇」散在顶点色饱和度和落点距离里，两边都不认账。
 *  34/24 是路网外沿（东西大街到 ±34），再加 6m 缓冲才是要压的镇界。 */
export const TOWN_RECT = { xT: 40, zT: 30, coneDeg: 18, colourRamp: 26 };

/** 斑马线：画在路口两端。dir='h' 条纹沿 x 重复（横穿南北向路） */
export const CROSSWALKS = [
  { x: 0, z: 6.6, dir: 'h' }, { x: 0, z: -6.6, dir: 'h' },
  { x: 6.6, z: 0, dir: 'v' }, { x: -6.6, z: 0, dir: 'v' },
  { x: 0, z: 17.4, dir: 'h' },
  { x: 12, z: 6.6, dir: 'v' }, { x: -12, z: 6.6, dir: 'v' },
  { x: 12, z: -6.6, dir: 'v' }, { x: -12, z: -6.6, dir: 'v' },
  { x: 24, z: 3.4, dir: 'v' }, { x: -24, z: 3.4, dir: 'v' },
  { x: 3.4, z: 12, dir: 'h' }, { x: -3.4, z: 12, dir: 'h' },
  { x: 3.4, z: -12, dir: 'h' }, { x: -3.4, z: -12, dir: 'h' },
  // 外环与街坊的路口（并图新增）：环镇东/西路 × 东西大街、住宅区街、商店街，
  // 以及北环/南环接进外环的两端
  { x: 34, z: 3.4, dir: 'v' }, { x: 34, z: -3.4, dir: 'v' },
  { x: -34, z: 3.4, dir: 'v' }, { x: -34, z: -3.4, dir: 'v' },
  { x: 30.6, z: 0, dir: 'h' }, { x: -30.6, z: 0, dir: 'h' },
  { x: 34, z: 15, dir: 'v' }, { x: 34, z: -15, dir: 'v' },
  { x: -34, z: 15, dir: 'v' }, { x: -34, z: -15, dir: 'v' },
  { x: 30, z: -22, dir: 'h' }, { x: -30, z: -22, dir: 'h' },
  { x: 30, z: 21, dir: 'h' }, { x: -30, z: 21, dir: 'h' },
];

// ---------- plan ↔ 球面 ----------
/** plan(米) ↔ 单位方向 / 地图像素。R 用烘完实测的地面半径，别用 CFG 的标称值。 */
export function makePlanFrame(R, phi0Deg = PHI0_DEG) {
  const phi0 = D2R(phi0Deg);
  const planToDir = (x, z) => {
    const phi = phi0 + z / R;
    const lam = x / (R * Math.max(0.08, Math.sin(phi)));
    const sp = Math.sin(phi), cp = Math.cos(phi);
    return new THREE.Vector3(sp * Math.sin(lam), cp, sp * Math.cos(lam)).normalize();
  };
  const dirToPlan = (d) => {
    const phi = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
    const lam = Math.atan2(d.x, d.z);
    return { x: lam * R * Math.max(0.08, Math.sin(phi)), z: (phi - phi0) * R };
  };
  return {
    R, phi0Deg, planToDir, dirToPlan,
    planToPx: (x, z) => pxFromDir(planToDir(x, z)),
    /** 这个 plan 点还在可玩带里吗（经线收口处会出界） */
    inBand: (x, z) => {
      const phi = phi0Deg + THREE.MathUtils.radToDeg(z / R);
      if (phi < CFG.latTopDeg + 1 || phi > CFG.latBottomDeg - 1) return false;
      const lamDeg = THREE.MathUtils.radToDeg(x / (R * Math.max(0.08, Math.sin(D2R(phi)))));
      return Math.abs(lamDeg) < CFG.lonSpanDeg - 2;
    },
  };
}

/** 某 plan 点到最近街心线的米距（横向按平面近似；镇区 60m 尺度上够用） */
export function roadDistance(frame, x, z) {
  let best = Infinity, hit = null;
  for (const rd of ROADS) {
    const dx = rd.x2 - rd.x1, dz = rd.z2 - rd.z1;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - rd.x1) * dx + (z - rd.z1) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (rd.x1 + dx * t), z - (rd.z1 + dz * t));
    if (d < best) { best = d; hit = { rd, t }; }
  }
  return { d: best, ...hit };
}

// ---------- 地面颜色（镇区按 HANDOFF 色板重画，不再用碎块壳的粉灰） ----------
function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const _c = new THREE.Color();
const C = Object.fromEntries(Object.entries(PLAN_C).map(([k, v]) => [k, new THREE.Color(v)]));

/**
 * 镇区地表色。x/z 是 plan 米。
 * 街道本身不画在这里——路面是 streetMesh 的实体条带，比顶点色锐利得多；
 * 这里只负责「街与街之间的那片地」终于像草/沙/土，而不是插入模型的粉灰噪声。
 */
export function groundColor(frame, x, z, out) {
  const n = vnoise(x * 0.22, z * 0.22);
  const n2 = vnoise(x * 0.7 + 9.7, z * 0.7 + 3.1);
  const n3 = vnoise(x * 0.075 + 4.2, z * 0.075 + 8.3);
  const { d, rd } = roadDistance(frame, x, z);
  const edge = rd.w + SIDEWALK_W;

  if (d < edge + 0.35) {                       // 街缘：被路肩和人流踩秃的土色
    out.copy(C.pave).lerp(C.sand, 0.35 + n * 0.2);
  } else if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 1.2) {
    out.copy(C.plaza).lerp(C.plazaAlt, n2 * 0.5);
  } else if (x > PARKING.x1 - 0.8 && x < PARKING.x2 + 0.8 && z > PARKING.z1 - 0.8 && z < PARKING.z2 + 0.8) {
    out.copy(C.asphalt).lerp(C.asphaltHi, n2 * 0.7).lerp(C.grass, 0.18 + n * 0.1);   // 停车场：沥青里掺点被踩旧的土
  } else {
    const forestT = THREE.MathUtils.clamp((Math.abs(x) - 26) / 8, 0, 1);
    out.copy(C.grass).lerp(C.grassDark, n * 0.55).lerp(C.forest, forestT * 0.7);
    out.offsetHSL(0, 0, (n2 - 0.5) * 0.04 + (n3 - 0.5) * 0.05);
  }
  return out;
}

// ---------- 路面条带 ----------
const PX_PER_M = 24;

/** 一条街的横断面纹理：沥青+虚线中线 / 路缘石 / 人行道砖，纵向 4m 一个周期 */
const roadTexCache = new Map();
export function roadTexture(w) {
  if (roadTexCache.has(w)) return roadTexCache.get(w);
  const total = 2 * (w + SIDEWALK_W);
  const LEN = 4;
  const cv = document.createElement('canvas');
  cv.width = Math.round(LEN * PX_PER_M);
  cv.height = Math.round(total * PX_PER_M);
  const ctx = cv.getContext('2d');
  const H = cv.height, W = cv.width;
  const toV = (py) => (py / H - 0.5) * total;    // 像素行 → 横向米

  for (let py = 0; py < H; py++) {
    const v = toV(py + 0.5), av = Math.abs(v);
    let col;
    if (av <= w) {
      col = C.asphalt.clone().lerp(C.asphaltHi, vnoise(0, py * 0.35) * 0.5);
      if (av <= 0.09) col.copy(C.line);          // 中线实线打底，下面再挖虚线
    } else if (av <= w + 0.16) {
      col = C.kerb.clone().lerp(C.kerbDark, vnoise(py * 0.5, 3.1) * 0.5);
    } else {
      const t = (av - w - 0.16) / (SIDEWALK_W - 0.16);
      col = C.pave.clone().lerp(C.paveAlt, hash2(Math.floor(py / (0.4 * PX_PER_M)), 7) * 0.9);
      // 砖缝：每 0.8m 一道横缝，纵缝按 0.4m 错开
      if (py % Math.round(0.8 * PX_PER_M) < 1) col.copy(C.paveJoint);
    }
    // 必须走 getStyle()：three r170 起 new Color(0x..) 存的是线性值，直接 r*255 会把线性值
    // 当 sRGB 写进画布，而这张 CanvasTexture 又按 SRGBColorSpace 解码 → 反照率被平方级压暗
    // （沥青 0.159 线性 → 写 40 → 解码回 0.021，等于暗了 7.5 倍，路面就糊成「不知什么材质的黑渣」）。
    ctx.fillStyle = col.getStyle();
    ctx.fillRect(0, py, W, 1);
  }
  // 虚线中线：2.8m 走线 / 1.2m 空档。空档必须刷回沥青色，不能用 destination-out 打洞——
  // 材质 transparent=false，three 对它走 NoBlending，贴图里 alpha=0 的像素照样把 RGB 写进
  // 帧缓冲，所以「洞」既不会露出下面的路面、也不会变透明，只会让白线读成一条实心带。
  const cy = H / 2, dash = Math.round(1.2 * PX_PER_M), gap = Math.round(2.8 * PX_PER_M);
  for (let py = Math.round(cy - 1.1); py <= Math.round(cy + 1.1); py++) {
    ctx.fillStyle = C.asphalt.clone().lerp(C.asphaltHi, vnoise(0, py * 0.35) * 0.5).getStyle();
    for (let px = gap; px < W; px += dash + gap) ctx.fillRect(px, py, gap, 1);
  }
  // 沥青裂纹/碎石斑点
  const speck = ctx.getImageData(0, 0, W, H);
  const sd = speck.data;
  for (let py = 0; py < H; py++) {
    const av = Math.abs(toV(py + 0.5));
    if (av > w) continue;
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      const j = (hash2(px * 1.7, py * 3.3) - 0.5) * 26;
      sd[i] += j; sd[i + 1] += j; sd[i + 2] += j;
    }
  }
  ctx.putImageData(speck, 0, 0);
  // 人行道纵缝 + 路缘接缝
  ctx.strokeStyle = `rgba(120,110,100,0.55)`;
  ctx.lineWidth = 1;
  for (const s of [-1, 1]) {
    const y = cy + s * (w + 0.16) * PX_PER_M;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let px = 0; px < W; px += Math.round(0.4 * PX_PER_M)) {
    const l = hash2(px, 11);
    for (const s of [-1, 1]) {
      const y0 = cy + s * (w + 0.16) * PX_PER_M, y1 = cy + s * total / 2 * PX_PER_M;
      ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
      if (l > 0.5) { ctx.beginPath(); ctx.moveTo(px, (y0 + y1) / 2); ctx.lineTo(W, (y0 + y1) / 2); ctx.stroke(); }
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  roadTexCache.set(w, tex);
  return tex;
}

/** 沿大圆把一条街铺成贴地条带：横向 9 个采样点跟住地面，UV 直接对到横断面纹理 */
export function streetMesh(surfaceAt, frame, rd, mat, { lift = 0.035, stepM = 0.8, myIdx = ROADS.length } = {}) {
  const Rm = frame.R;
  const a = frame.planToDir(rd.x1, rd.z1);
  const b = frame.planToDir(rd.x2, rd.z2);
  const ang = a.angleTo(b);
  if (ang < 1e-5) return null;
  const axis = new THREE.Vector3().crossVectors(a, b);
  if (axis.lengthSq() < 1e-12) return null;
  axis.normalize();

  const half = rd.w + SIDEWALK_W;
  const offs = [-half, -(rd.w + 0.16), -rd.w, -rd.w * 0.5, 0, rd.w * 0.5, rd.w, rd.w + 0.16, half];
  const steps = Math.max(2, Math.ceil((ang * Rm) / stepM));
  // 路口让位：两条街的条带都按「贴地 + 同一个 lift」烘，交叉处必然共面，
  // 实测一个路口 20% 的像素在抖（菱形锯齿暗斑）。让编号靠后的那条在重叠段收手，
  // 每个路口只有一条街铺到底。判据与铺法同口径（到别家街心的平面距离 ≤ 它的全宽），
  // 所以让位边界正好贴着对方条带的边缘，不会留缝。
  const keep = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = rd.x1 + (rd.x2 - rd.x1) * t, z = rd.z1 + (rd.z2 - rd.z1) * t;
    let covered = false;
    for (let i = 0; i < myIdx; i++) {
      const o = ROADS[i];
      const dx = o.x2 - o.x1, dz = o.z2 - o.z1, len2 = dx * dx + dz * dz || 1;
      const tt = Math.max(0, Math.min(1, ((x - o.x1) * dx + (z - o.z1) * dz) / len2));
      if (Math.hypot(x - (o.x1 + dx * tt), z - (o.z1 + dz * tt)) <= o.w + SIDEWALK_W) { covered = true; break; }
    }
    keep.push(!covered);
  }
  const pos = [], uvs = [], idx = [];
  const col = new THREE.Vector3();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    col.copy(a).applyAxisAngle(axis, ang * t);
    for (const o of offs) {
      const cd = col.clone().addScaledVector(axis, o / Rm).normalize();
      const h = surfaceAt(cd);
      if (!h.hit) return null;
      const p = h.pos.clone().addScaledVector(cd, lift);
      pos.push(p.x, p.y, p.z);
      uvs.push(t * (ang * Rm) / 4, (o / (2 * half)) + 0.5);
    }
  }
  const COLUMNS = offs.length;
  for (let s = 0; s < steps; s++) {
    if (!keep[s] || !keep[s + 1]) continue;
    for (let c = 0; c < COLUMNS - 1; c++) {
      const a0 = s * COLUMNS + c, b0 = a0 + 1, a1 = a0 + COLUMNS, b1 = a1 + 1;
      // 绕序必须是 (行→列) 而不是 (列→行)：沿街方向 A × 横向偏移 L 才是外法线。
      // 写反时 computeVertexNormals 给出一圈指向球心的法线（实测 dot(法线, 径向) = -1），
      // 单面材质的条带从玩家视角整个被背面剔除——路看不见，人就一直走在烘出来的地球基底上。
      idx.push(a0, a1, b0, b0, a1, b1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.road = true;
  return mesh;
}

/** 斑马线：横跨一条街的一组白条 */
export function crosswalkMesh(surfaceAt, frame, cw, mat, { lift = 0.05 } = {}) {
  const Rm = frame.R;
  const rd = ROADS.find((r) => (r.x1 === r.x2 ? Math.abs(r.x1 - cw.x) < 0.5 : Math.abs(r.z1 - cw.z) < 0.5));
  if (!rd) return null;
  const along = rd.x1 === rd.x2 ? 'z' : 'x';   // 街的走向
  const half = rd.w + 0.25;
  const stripeW = 0.45, gapW = 0.30;
  const pos = [], uvs = [], idx = [];
  const span = half * 2;
  const n = Math.floor((span + gapW) / (stripeW + gapW));
  let quad = 0;
  for (let i = 0; i < n; i++) {
    const o0 = -half + i * (stripeW + gapW);
    const o1 = o0 + stripeW;
    for (const [o, uu] of [[o0, 0], [o1, 1]]) {
      // 沿街方向铺 2.4m 长的一条
      for (const dl of [-1.2, 1.2]) {
        const x = along === 'z' ? cw.x + o : cw.x + dl;
        const z = along === 'z' ? cw.z + dl : cw.z + o;
        const d = frame.planToDir(x, z);
        const h = surfaceAt(d);
        if (!h.hit) return null;
        const p = h.pos.clone().addScaledVector(d, lift);
        pos.push(p.x, p.y, p.z);
        uvs.push(uu, (dl + 1.2) / 2.4);
      }
    }
    const a0 = quad * 4;
    idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    quad++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
