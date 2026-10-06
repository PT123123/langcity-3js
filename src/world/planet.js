// planet.js — 星球本体 + 程序化地面贴图（messenger 粉彩水彩风）
import * as THREE from 'three';
import {
  R, LAT0, LON0, terrainH,
  ROADS, SIDEWALK_W, PLAZA, PARKING,
} from './layout.js';
import { plainToonMaterial, outlineMaterial } from './materials.js';

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

// ---------- 点到线段距离（plan 2D） ----------
function distSeg(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  let t = ((px - x1) * dx + (pz - z1) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + dx * t, cz = z1 + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

// 斑马线：{x,z,dir} dir='h' 条纹沿 x 重复（横穿南北向路）
const CROSSWALKS = [
  { x: 0, z: 6.8, dir: 'h' }, { x: 0, z: -6.8, dir: 'h' },
  { x: 6.8, z: 0, dir: 'v' }, { x: -6.8, z: 0, dir: 'v' },
  { x: 0, z: 13.1, dir: 'h' }, { x: 12.9, z: 6, dir: 'v' },
  { x: -12.9, z: 6, dir: 'v' },
];

const _col = new THREE.Color();
// 色板与 materials.js 的 C 对齐（messenger 粉彩）
const SEA = new THREE.Color(0x76c3c6), SEA_DEEP = new THREE.Color(0x4f9e9e);
const SAND = new THREE.Color(0xe8d8ae), SAND_WET = new THREE.Color(0xd2ba92);
const GRASS = new THREE.Color(0xaab888), GRASS_D = new THREE.Color(0x96a870);
const FOREST_FLOOR = new THREE.Color(0x84966c);
const ASPHALT = new THREE.Color(0x8b8580), ASPHALT_L = new THREE.Color(0x9a948c);
const LINE = new THREE.Color(0xfffaf2);
const PAVE = new THREE.Color(0xcabfb0), PAVE_L = new THREE.Color(0xd6ccb9), PAVE_D = new THREE.Color(0xb2a894);
const PLAZA_C = new THREE.Color(0xd6ccb9), PLAZA_L = new THREE.Color(0xbcb2a4);

/** 世界坐标 → plan 坐标（planToVec3 的严格逆） */
export function worldToPlan(v) {
  const r = v.length();
  const lat = Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1));
  const lon = Math.atan2(v.x, v.z);
  const latC = Math.max(0.15, Math.cos(lat));
  return { x: (lon - LON0) * R * latC, z: (LAT0 - lat) * R };
}

/** 某个 plan 点的地面颜色（供贴图与调试） */
function groundColor(x, z, out) {
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

  // —— 道路（SDF） ——
  let asphD = Infinity, sideD = Infinity;
  for (const rd of ROADS) {
    const d = distSeg(x, z, rd.x1, rd.z1, rd.x2, rd.z2);
    if (d < rd.w) asphD = Math.min(asphD, d);
    if (d < rd.w + SIDEWALK_W) sideD = Math.min(sideD, d - rd.w);
  }
  // 停车场
  const pk = PARKING;
  const inPkX = x > pk.x1 && x < pk.x2, inPkZ = z > pk.z1 && z < pk.z2;

  if (asphD < Infinity || (inPkX && inPkZ)) {
    out.copy(ASPHALT).lerp(ASPHALT_L, n2 * 0.22);
    if (inPkX && inPkZ) {
      // 停车位白线
      const lx = (x - pk.x1) % 1.6;
      if (lx < 0.1 && z > pk.z1 + 0.3 && z < pk.z2 - 0.3) out.copy(LINE).multiplyScalar(0.92);
      if (x < pk.x1 + 0.15 || x > pk.x2 - 0.15 || z < pk.z1 + 0.15 || z > pk.z2 - 0.15) out.copy(LINE).multiplyScalar(0.95);
    } else {
      // 中线（虚线）：只画在道路中心线 9cm 带内（注意：不减半宽！）
      const centerD = ROADS.reduce((best, rd) => Math.min(best, distSeg(x, z, rd.x1, rd.z1, rd.x2, rd.z2)), Infinity);
      if (centerD < 0.09 && (Math.abs(x + z) % 2.6) < 1.3) out.lerp(LINE, 0.45);
      // —— 斑马线（画在沥青之上） ——
      for (const cw of CROSSWALKS) {
        const dx = x - cw.x, dz = z - cw.z;
        const ax = Math.abs(dx), az = Math.abs(dz);
        if (cw.dir === 'h' && ax < 2.0 && az < 1.0) {
          if ((dx + 10) % 0.75 < 0.42) out.copy(LINE).multiplyScalar(0.96);
        } else if (cw.dir === 'v' && az < 2.0 && ax < 1.0) {
          if ((dz + 10) % 0.75 < 0.42) out.copy(LINE).multiplyScalar(0.96);
        }
      }
    }
    return out;
  }
  if (sideD < 0) {
    // —— 人行道（铺装砖 + 砖缝） ——
    out.copy(PAVE).lerp(PAVE_L, n2 * 0.6);
    const tx = Math.abs(((x * 2) % 1.6) - 0.8), tz = Math.abs(((z * 2) % 1.6) - 0.8);
    if (tx > 0.72 || tz > 0.72) out.copy(PAVE_D);
    return out;
  }

  // —— 广场（覆盖道路收尾） ——
  const pd = Math.hypot(x - PLAZA.x, z - PLAZA.z);
  if (pd < PLAZA.r) {
    out.copy(PLAZA_C).lerp(PLAZA_L, n2 * 0.5);
    const gx = Math.abs(((x * 1.5) % 1) - 0.5), gz = Math.abs(((z * 1.5) % 1) - 0.5);
    if (gx > 0.44 || gz > 0.44) out.copy(PLAZA_L);
    if (pd > PLAZA.r - 0.35) out.lerp(new THREE.Color(0x9a8f80), 0.8); // 边缘石
  }

  return out;
}

// ---------- 逐像素绘制 equirect 贴图 ----------
function paintGroundTexture() {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const c = new THREE.Color();

  // 只画纬度 -30°~+90° 带（其余是纯海）
  const latMax = Math.PI / 2, latMin = -Math.PI / 6;
  const py0 = Math.floor((Math.PI / 2 - latMax) / Math.PI * H);
  const py1 = Math.ceil((Math.PI / 2 - latMin) / Math.PI * H);

  for (let py = py0; py < py1; py++) {
    const lat = Math.PI / 2 - (py + 0.5) / H * Math.PI;
    const latC = Math.max(0.05, Math.cos(lat));
    for (let px = 0; px < W; px++) {
      const lon = (px + 0.5) / W * Math.PI * 2 - Math.PI;
      const x = (lon - LON0) * R * latC;
      const z = (LAT0 - lat) * R;

      let r, g, b;
      if (z > 47) { // 极区远处纯海/雾色，省计算
        c.copy(SEA_DEEP).lerp(new THREE.Color(0x4a7d84), Math.min(1, (z - 47) / 40));
      } else {
        groundColor(x, z, c);
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
export function buildPlanet() {
  const geo = buildPlanetGeometry();
  const tex = paintGroundTexture();
  const mat = plainToonMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'planet';
  mesh.add(new THREE.Mesh(geo, outlineMaterial(0.055))); // 星球剪影轮廓线
  return mesh;
}

function buildPlanetGeometry() {
  const latBands = 128, lonBands = 192;
  const pos = [], uv = [], idx = [];

  for (let iy = 0; iy <= latBands; iy++) {
    const lat = Math.PI / 2 - (iy / latBands) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let ix = 0; ix <= lonBands; ix++) {
      const lon = (ix / lonBands) * Math.PI * 2 - Math.PI;
      // plan 坐标 → 地形高度
      const latC = Math.max(0.05, cl);
      const px = (lon - LON0) * R * latC;
      const pz = (LAT0 - lat) * R;
      let h = 0;
      if (pz < 30.5 && pz > -60) {
        const t = THREE.MathUtils.clamp((30.5 - pz) / 8, 0, 1);
        h = terrainH(px, pz) * t;
      }
      const r = R + h;
      pos.push(r * cl * Math.sin(lon), r * sl, r * cl * Math.cos(lon));
      uv.push(ix / lonBands, (lat + Math.PI / 2) / Math.PI);
    }
  }
  const row = lonBands + 1;
  for (let iy = 0; iy < latBands; iy++) {
    for (let ix = 0; ix < lonBands; ix++) {
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
