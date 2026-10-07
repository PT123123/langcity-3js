// planet.js — 星球本体 + 程序化地面贴图（messenger 粉彩水彩风）
import * as THREE from 'three';
import {
  R, LAT0, LON0, TERRAIN_FIELD,
  SIDEWALK_W, PLAZA, PARKING, CROSSWALKS,
} from './layout.js';
import { makeField, roadNear } from '../map/terrain.js';
import { plainToonMaterial, outlineMaterial } from './materials.js';

/** 编辑器预览传 data 就现造一张高程场，游戏走构建期那张 */
export function fieldFor(D) {
  return D ? makeField(D) : TERRAIN_FIELD;
}

// ---------- 确定性 value noise ----------
function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  return vnoise(x, y) * 0.65 + vnoise(x * 2.3, y * 2.3) * 0.35;
}

// ---------- 点到道路折线的最近距离（plan 2D） ----------
// 折线/直线两种写法都在 src/map/terrain.js 的 prepareRoads 里折成线段表，这里只查表。

// 色板与 materials.js 的 C 对齐（messenger 粉彩）
const SEA = new THREE.Color(0x76c3c6), SEA_DEEP = new THREE.Color(0x4f9e9e);
const SAND = new THREE.Color(0xe8d8ae), SAND_WET = new THREE.Color(0xd2ba92);
const GRASS = new THREE.Color(0xaab888), GRASS_D = new THREE.Color(0x96a870);
const FOREST_FLOOR = new THREE.Color(0x84966c);
const ASPHALT = new THREE.Color(0x8b8580), ASPHALT_L = new THREE.Color(0x9a948c);
const GUTTER = new THREE.Color(0x6f6a64), CURB = new THREE.Color(0xbdb2a0);
const LINE = new THREE.Color(0xfffaf2);
const PAVE = new THREE.Color(0xcabfb0), PAVE_L = new THREE.Color(0xd6ccb9), PAVE_D = new THREE.Color(0xb2a894);
const PLAZA_C = new THREE.Color(0xd6ccb9), PLAZA_L = new THREE.Color(0xbcb2a4);
// 三种非沥青路面（老城的街面就该长得不一样）
const COBBLE = new THREE.Color(0xa89a86), COBBLE_D = new THREE.Color(0x8d8071);
const BRICK_C = new THREE.Color(0xb08a74), BRICK_D = new THREE.Color(0x94705c);
const GRAVEL = new THREE.Color(0xc2b8a4), GRAVEL_D = new THREE.Color(0xa89d88);

/** 世界坐标 → plan 坐标（planToVec3 的严格逆） */
export function worldToPlan(v) {
  const r = v.length();
  const lat = Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1));
  const lon = Math.atan2(v.x, v.z);
  const latC = Math.max(0.15, Math.cos(lat));
  return { x: (lon - LON0) * R * latC, z: (LAT0 - lat) * R };
}

/** 贴图用的道路/其它数据索引（每帧只建一次，逐像素查表） */
function rowIndex(D) {
  const field = fieldFor(D);
  return {
    field,
    roads: field.roads,
    sw: D?.sidewalkW ?? SIDEWALK_W,
    plaza: D?.plaza || PLAZA,
    parking: D?.parking || PARKING,
    cw: D?.crosswalks || CROSSWALKS,
  };
}

/** 某个 plan 点的地面颜色（供贴图与调试）；shade = 该点的坡向明暗系数 */
function groundColor(x, z, out, RI, shade = 1) {
  const { roads, sw, plaza: PLAZA_D, parking: PARK_D, cw: CW_D } = RI;
  const n = fbm(x * 0.22, z * 0.22);
  const n2 = fbm(x * 0.7 + 9.7, z * 0.7 + 3.1);
  const n3 = fbm(x * 0.075 + 4.2, z * 0.075 + 8.3); // 大尺度水彩晕染

  // —— 海 / 沙滩（按 plan z，南边是海） ——
  if (z > 30.5) {
    const d = Math.min(1, (z - 30.5) / 16);
    out.copy(SEA).lerp(SEA_DEEP, Math.sqrt(d));
    out.offsetHSL(0, 0, (n2 - 0.5) * 0.02);
    out.offsetHSL(0, 0, (n3 - 0.5) * 0.03);
    return out;
  }
  if (z > 24) {
    out.copy(SAND);
    if (z > 28.8) out.lerp(SAND_WET, Math.min(1, (z - 28.8) / 1.7));
    out.offsetHSL(0, 0, (n2 - 0.5) * 0.035);
    out.offsetHSL(0, 0, (n3 - 0.5) * 0.05);
  } else {
    // —— 陆地草地 ——
    out.copy(GRASS).lerp(GRASS_D, n * 0.35);
    const forestT = Math.max(0, Math.min(1, Math.max(-z - 23, Math.abs(x) - 25.5) / 4));
    if (forestT > 0) out.lerp(FOREST_FLOOR, forestT);
    out.offsetHSL(0, 0, (n2 - 0.5) * 0.035);
    out.offsetHSL(0, 0, (n3 - 0.5) * 0.055);
  }

  // —— 道路（沿折线的 SDF） ——
  let minD = Infinity, sideD = Infinity, bestW = 0, bestD = Infinity, bestSurf = 'asphalt';
  for (const pr of roads) {
    const np = roadNear(pr, x, z);
    if (!np) continue;
    const d = np.d, w = pr.w;
    if (d < minD) minD = d;
    if (d < w && d < bestD) { bestD = d; bestW = w; bestSurf = pr.r.surf || 'asphalt'; }
    if (d < w + sw) sideD = Math.min(sideD, d - w);
  }
  // 停车场
  const pk = PARK_D;
  const inPkX = x > pk.x1 && x < pk.x2, inPkZ = z > pk.z1 && z < pk.z2;

  if (bestD < Infinity || (inPkX && inPkZ)) {
    out.copy(ASPHALT).lerp(ASPHALT_L, n2 * 0.22);
    if (inPkX && inPkZ) {
      // 停车位白线
      const lx = (x - pk.x1) % 1.6;
      if (lx < 0.1 && z > pk.z1 + 0.3 && z < pk.z2 - 0.3) out.copy(LINE).multiplyScalar(0.92);
      if (x < pk.x1 + 0.15 || x > pk.x2 - 0.15 || z < pk.z1 + 0.15 || z > pk.z2 - 0.15) out.copy(LINE).multiplyScalar(0.95);
    } else if (bestSurf === 'asphalt') {
      // 路拱：中线两侧略亮，靠边沟略暗（配合高程场，路才不像贴上去的纸）
      const crown = 1 - bestD / bestW;
      out.lerp(ASPHALT_L, crown * crown * 0.18);
      if (bestW - bestD < 0.16) out.lerp(GUTTER, 0.5);          // 边沟
      else if (bestW - bestD < 0.4) out.lerp(ASPHALT_L, 0.3);    // 路缘石
      // 中线（虚线）：只画在道路中心线 9cm 带内（注意：不减半宽！）
      if (minD < 0.09 && (Math.abs(x + z) % 2.6) < 1.3) out.lerp(LINE, 0.45);
      // —— 斑马线（画在沥青之上） ——
      for (const cw of CW_D) {
        const dx = x - cw.x, dz = z - cw.z;
        const ax = Math.abs(dx), az = Math.abs(dz);
        if (cw.dir === 'h' && ax < 2.0 && az < 1.0) {
          if ((dx + 10) % 0.75 < 0.42) out.copy(LINE).multiplyScalar(0.96);
        } else if (cw.dir === 'v' && az < 2.0 && ax < 1.0) {
          if ((dz + 10) % 0.75 < 0.42) out.copy(LINE).multiplyScalar(0.96);
        }
      }
    } else {
      // —— 石板/砖/砂砾：块材按各自的排铺网格画缝 ——
      surfPatch(out, bestSurf, x, z, bestW, bestD, n2);
    }
    out.multiplyScalar(shade);
    return out;
  }
  if (sideD < 0) {
    // —— 人行道（铺装砖 + 砖缝 + 靠车行道一侧的道牙） ——
    out.copy(PAVE).lerp(PAVE_L, n2 * 0.6);
    const tx = Math.abs(((x * 2) % 1.6) - 0.8), tz = Math.abs(((z * 2) % 1.6) - 0.8);
    if (tx > 0.72 || tz > 0.72) out.copy(PAVE_D);
    if (-sideD < 0.14) out.lerp(CURB, 0.75);
    out.multiplyScalar(shade);
    return out;
  }

  // —— 广场（覆盖道路收尾） ——
  const pd = Math.hypot(x - PLAZA_D.x, z - PLAZA_D.z);
  if (pd < PLAZA_D.r) {
    out.copy(PLAZA_C).lerp(PLAZA_L, n2 * 0.5);
    const gx = Math.abs(((x * 1.5) % 1) - 0.5), gz = Math.abs(((z * 1.5) % 1) - 0.5);
    if (gx > 0.44 || gz > 0.44) out.copy(PLAZA_L);
    if (pd > PLAZA.r - 0.35) out.lerp(new THREE.Color(0x9a8f80), 0.8); // 边缘石
  }
  out.multiplyScalar(shade);

  return out;
}

/** 老式路面的块材图案：cobble 扇形石块 / brick 长条砖 / gravel 碎石 */
const _sc = new THREE.Color();
function surfPatch(out, surf, x, z, W, D, n2) {
  const crown = 1 - D / W;
  let base, dark, cell, row, mortar;
  if (surf === 'cobble') { base = COBBLE; dark = COBBLE_D; cell = 0.42; row = 0.28; mortar = 0.055; }
  else if (surf === 'brick') { base = BRICK_C; dark = BRICK_D; cell = 0.72; row = 0.22; mortar = 0.035; }
  else { base = GRAVEL; dark = GRAVEL_D; cell = 0; row = 0; mortar = 0; }
  out.copy(base).lerp(dark, n2 * 0.5);
  if (cell > 0) {
    // 错缝排铺：奇数行整体错开半块
    const rz = Math.floor(z / row);
    const ox = (rz & 1) ? cell / 2 : 0;
    const ux = Math.abs((((x - ox) / cell) % 1) - 0.5) * 2 * cell;   // 到竖向缝的距离
    const uz = Math.abs(((z / row) % 1) - 0.5) * 2 * row;            // 到横向缝的距离
    const seam = Math.max(ux, uz) > cell - mortar * 2 ? 1 : 0;
    const blk = hash2(Math.floor((x - ox) / cell) * 7.13, rz * 3.71);
    if (seam) out.copy(dark).multiplyScalar(0.86);
    else out.offsetHSL(0, 0, (blk - 0.5) * 0.07);
  } else {
    // 碎石：两档细噪 + 车辙
    out.offsetHSL(0, 0, (hash2(x * 5.3, z * 5.1) - 0.5) * 0.1);
    if (Math.abs(D) > W * 0.45) out.lerp(dark, 0.25);
  }
  if (crown * crown > 0.55) out.lerp(_sc.copy(base).multiplyScalar(1.12), 0.25);
  if (W - D < 0.18) out.lerp(GUTTER, 0.45);   // 这些路面靠边一样收暗，才分得出路缘
}

// ---------- 逐像素绘制 equirect 贴图 ----------

/**
 * 坡向明暗网格：把高程场在贴图的 lat/lon 格点上采一遍，再按格子求横向坡度。
 * 每像素只双线性取斜率（不重算高程），2M 像素也只多花几十毫秒。
 * 返回 {sx, sz, gw, gh, step, py0} —— sx=东西向坡度 dh/dx，sz=南北向坡度 dh/dz。
 */
function slopeGrid(field, W, py0, py1) {
  const STEP = 6;
  const gw = Math.ceil(W / STEP) + 1;
  const gh = Math.ceil((py1 - py0) / STEP) + 1;
  const sx = new Float32Array(gw * gh);
  const sz = new Float32Array(gw * gh);
  const d = 0.75;   // 中心差分步长（米）
  for (let gy = 0; gy < gh; gy++) {
    const py = Math.min(py1 - 1, py0 + gy * STEP);
    const lat = Math.PI / 2 - (py + 0.5) / 1024 * Math.PI;
    const latC = Math.max(0.05, Math.cos(lat));
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(W - 1, gx * STEP);
      const lon = (px + 0.5) / W * Math.PI * 2 - Math.PI;
      const x = (lon - LON0) * R * latC;
      const z = (LAT0 - lat) * R;
      sx[gy * gw + gx] = (field.mesh(x + d, z) - field.mesh(x - d, z)) / (2 * d);
      sz[gy * gw + gx] = (field.mesh(x, z + d) - field.mesh(x, z - d)) / (2 * d);
    }
  }
  return { sx, sz, gw, gh, step: STEP, py0 };
}

const SHADE_AMP = 1.15;   //  baked 明暗幅度：坡向每倾斜 1 里约 ±6.6%
function shadeAt(g, px, py) {
  const fx = px / g.step, fy = (py - g.py0) / g.step;
  const ix = Math.max(0, Math.min(g.gw - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(g.gh - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - ix)), ty = Math.min(1, Math.max(0, fy - iy));
  const a = iy * g.gw + ix, b = a + 1, c = a + g.gw, d = c + 1;
  const lerp = (arr) => arr[a] + (arr[b] - arr[a]) * tx + (arr[c] - arr[a]) * ty
    + (arr[d] - arr[c] - arr[b] + arr[a]) * tx * ty;
  const s = lerp(g.sx) + 0.3 * lerp(g.sz);
  const v = 1 + SHADE_AMP * s;
  return v < 0.86 ? 0.86 : v > 1.14 ? 1.14 : v;
}

// 地面贴布的复用池：编辑器每改一次路就要重画一次 2048×1024，
// 每次都新建画布 + ImageData（各约 8 MB）的话 GC 追不上，重画到第七八次整页就不响应了。
// 循环会把 [py0, py1) 的每个像素连 alpha 一起重写，py1 以下由 fillRect 铺海，所以复用不留残影。
let _gcv = null, _gimg = null;
function groundCanvas(W, H) {
  if (!_gcv) { _gcv = document.createElement('canvas'); _gcv.width = W; _gcv.height = H; }
  if (!_gimg) _gimg = _gcv.getContext('2d').createImageData(W, H);
  return { cv: _gcv, img: _gimg };
}

function paintGroundTexture(D) {
  const W = 2048, H = 1024;
  const { cv, img } = groundCanvas(W, H);
  const ctx = cv.getContext('2d');
  const data = img.data;
  const c = new THREE.Color();
  const deep = new THREE.Color(0x4a7d84);
  const RI = rowIndex(D);
  const field = RI.field;

  // 只画纬度 -30°~+90° 带（其余是纯海）
  const latMax = Math.PI / 2, latMin = -Math.PI / 6;
  const py0 = Math.floor((Math.PI / 2 - latMax) / Math.PI * H);
  const py1 = Math.ceil((Math.PI / 2 - latMin) / Math.PI * H);
  const grid = slopeGrid(field, W, py0, py1);

  for (let py = py0; py < py1; py++) {
    const lat = Math.PI / 2 - (py + 0.5) / H * Math.PI;
    const latC = Math.max(0.05, Math.cos(lat));
    for (let px = 0; px < W; px++) {
      const lon = (px + 0.5) / W * Math.PI * 2 - Math.PI;
      const x = (lon - LON0) * R * latC;
      const z = (LAT0 - lat) * R;

      let r, g, b;
      if (z > 47) { // 极区远处纯海/雾色，省计算
        c.copy(SEA_DEEP).lerp(deep, Math.min(1, (z - 47) / 40));
      } else {
        groundColor(x, z, c, RI, z > 30.5 ? 1 : shadeAt(grid, px, py));
      }
      // THREE.Color 是线性空间；ImageData 是 sRGB 域，需转换
      c.convertLinearToSRGB();
      r = c.r * 255; g = c.g * 255; b = c.b * 255;
      const i = (py * W + px) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 极区以下填海
  ctx.fillStyle = '#4a7d84';
  ctx.fillRect(0, py1, W, H - py1);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- 星球网格（自定义 lat/lon 网格，便于地形位移与 UV 对齐） ----------
export function buildPlanet(data) {
  const geo = buildPlanetGeometry(data);
  const tex = paintGroundTexture(data);
  const mat = plainToonMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'planet';
  mesh.add(new THREE.Mesh(geo, outlineMaterial(0.055))); // 星球剪影轮廓线
  return mesh;
}

/**
 * 非均匀格点：把 share 比例的经纬带压进城镇窗口，其余地方稀疏。
 * 均匀 128×192 的格距约 1.4 m，画不出 3 m 宽的路堤（玩家会踩在悬空/陷地里）；
 * 这样改总三角形只涨一点点，镇内拿到 ~0.7 m/格，镇外该省还是省。
 */
function warpedBands(n, fullLo, fullHi, winLo, winHi, share) {
  const winN = Math.max(8, Math.round(n * share));
  const outStep = ((fullHi - winHi) + (winLo - fullLo)) / Math.max(1, n - winN);
  const vals = [];
  for (let v = fullLo; v < winLo - outStep * 0.01; v += outStep) vals.push(v);
  const winStep = (winHi - winLo) / winN;
  for (let i = 0; i <= winN; i++) vals.push(winLo + i * winStep);
  for (let v = winHi + outStep; v < fullHi - outStep * 0.01; v += outStep) vals.push(v);
  vals.push(fullHi);
  return vals;
}

function buildPlanetGeometry(D) {
  const field = fieldFor(D);
  // 镇内窗口：plan z ∈ [−46, 34] → lat ∈ [−0.15, 1.50]；plan x ∈ [−46, 46] → lon ∈ LON0 ± 1.15
  const lats = warpedBands(160, -Math.PI / 2, Math.PI / 2, -0.15, 1.50, 0.75);
  const lons = warpedBands(240, -Math.PI, Math.PI, LON0 - 1.15, LON0 + 1.15, 0.75);
  const pos = [], uv = [], idx = [];

  for (let iy = 0; iy <= lats.length - 1; iy++) {
    const lat = lats[iy];
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let ix = 0; ix <= lons.length - 1; ix++) {
      const lon = lons[ix];
      // plan 坐标 → 地形高度（hills + 路堤；台地/石阶是实体几何，不挤这张粗网格）
      const latC = Math.max(0.05, cl);
      const px = (lon - LON0) * R * latC;
      const pz = (LAT0 - lat) * R;
      let h = 0;
      if (pz < 30.5 && pz > -60) {
        const t = THREE.MathUtils.clamp((30.5 - pz) / 8, 0, 1);
        h = field.mesh(px, pz) * t;
      }
      const r = R + h;
      pos.push(r * cl * Math.sin(lon), r * sl, r * cl * Math.cos(lon));
      uv.push((lon + Math.PI) / (Math.PI * 2), (lat + Math.PI / 2) / Math.PI);
    }
  }
  const row = lons.length;
  for (let iy = 0; iy < lats.length - 1; iy++) {
    for (let ix = 0; ix < lons.length - 1; ix++) {
      const a = iy * row + ix, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
