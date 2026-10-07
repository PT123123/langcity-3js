// layout.js — 城镇规划数据（星球参数 / 道路网 / 广场 / 物件坐标表）
// 数据真源在 data/town-plan.json（可用 editor.html 编辑，见 docs/MAP-EDITOR.md），
// 本文件只做「JSON → 具名导出 + 球面换算函数」的薄壳，几何函数逻辑与迁移前一致。
// plan 坐标系：x 向东（米），z 向南（米），原点 = 车站前广场中心
import * as THREE from 'three';
import PLAN from '../../data/town-plan.json';
import { ensureRelief, makeField } from '../map/terrain.js';

export { PLAN };
export const R = PLAN.R;                       // 星球半径（米）
export const LAT0 = PLAN.LAT0;                 // 城镇中心纬度（弧度）
export const LON0 = PLAN.LON0;

/** plan(x,z) → 球面纬度/经度（弧度；真实 cos(lat) 反投影，plan 距离 = 实地距离） */
export function planToLatLon(x, z) {
  const lat = LAT0 - z / R;
  const latC = Math.max(0.15, Math.cos(lat));
  return {
    lat,
    lon: LON0 + x / (R * latC),
  };
}

/** plan(x,z) + 径向高度 h → 世界坐标 */
export function planToVec3(x, z, h = 0, out = new THREE.Vector3()) {
  const { lat, lon } = planToLatLon(x, z);
  const r = R + h;
  return out.set(
    r * Math.cos(lat) * Math.sin(lon),
    r * Math.sin(lat),
    r * Math.cos(lat) * Math.cos(lon)
  );
}

/** 球面法向（单位） */
export function normalAt(x, z, out = new THREE.Vector3()) {
  const { lat, lon } = planToLatLon(x, z);
  return out.set(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon)
  );
}

/** plan 位置 + 朝向 rotY → 四元数（rotY=0 时物件面朝 +z，即朝南；up=径向） */
const _up = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Matrix4();
export function planQuat(x, z, rotY, out = new THREE.Quaternion()) {
  normalAt(x, z, _up);
  // 南向切向 = -(Y - up*up.y)
  _f.set(0, 1, 0).addScaledVector(_up, -_up.y).negate();
  if (_f.lengthSq() < 1e-8) _f.set(1, 0, 0); else _f.normalize();
  _f.applyAxisAngle(_up, rotY);
  _r.crossVectors(_up, _f).normalize();
  _m.makeBasis(_r, _up, _f);
  return out.setFromRotationMatrix(_m);
}

// ---------- 地形缓坡（Town 核心区以外；cat/贴图/物件共用） ----------
export const HILLS = PLAN.hills;
export function terrainH(x, z) {
  let h = 0;
  for (const hl of HILLS) {
    const dx = x - hl.x, dz = z - hl.z;
    h += hl.a * Math.exp(-(dx * dx + dz * dz) / (2 * hl.s * hl.s));
  }
  return h;
}

// ---------- 造成（人工地形）：路堤高程 / 台地 / 梯道 ----------
// 高程场本体在 src/map/terrain.js（纯函数，Node 工具与浏览器共用）。
// groundHeight = 玩家与物件真正踩到的面；meshHeight = 星球网格位移（只放低频项，
// 台地/石阶由 terrainwork.js 出实体几何，不让 1 米格点的粗网格去顶一个垂直边）。
ensureRelief(PLAN);
export const TERRAIN_FIELD = makeField(PLAN);
export const TERRACES = PLAN.terraces;
export const FLIGHTS = PLAN.flights;
export const groundHeight = (x, z) => TERRAIN_FIELD.surface(x, z);
export const meshHeight = (x, z) => TERRAIN_FIELD.mesh(x, z);
export { makeField, ensureRelief } from '../map/terrain.js';

// ---------- 道路网（asphalt 半宽 w；两侧自动 +sidewalkW 人行道） ----------
export const SIDEWALK_W = PLAN.sidewalkW;
export const ROADS = PLAN.roads;

export const PLAZA = PLAN.plaza;
export const PARKING = PLAN.parking;
export const BEACH_Z = PLAN.beachZ;     // z > BEACH_Z 沙滩 → 海
export const FOREST_LAT = PLAN.forestLat; // |z| 超过此值起森林环（北侧 z<-25）

// 斑马线：{x,z,dir} dir='h' 条纹沿 x 重复（横穿南北向路）——画在星球贴图上
export const CROSSWALKS = PLAN.crosswalks;

// ---------- 物件总表（kind → props.js 的 BUILDERS；word → data/words.json id） ----------
// rotY：0=朝南(+z), PI=朝北, PI/2=朝西, -PI/2=朝东
export const PLACES = PLAN.places;

/** 森林环装饰树（不可交互，纯构图） */
export const FOREST_TREES = PLAN.forestTrees;

// ---------- 碰撞/占位表（kind → 局部尺寸，米；w/d 半宽半深，r 半径，ox/oz 偏移） ----------
// 建筑尺寸与 props.js 的 buildXxx 外墙对齐；collision.js 与编辑器 2D 视图共用。
export const SOLIDS = {
  station:      { w: 3.3, d: 1.9 },
  house:        { w: 1.65, d: 1.45 },
  mansion:      { w: 2.15, d: 1.65 },
  tower:        { w: 1.75, d: 1.5 },
  office:       { w: 2.05, d: 1.65 },
  hotel:        { w: 2.25, d: 1.75 },
  konbini:      { w: 2.25, d: 1.75 },
  ramen:        { w: 1.65, d: 1.55 },
  cafe:         { w: 1.75, d: 1.55 },
  supermarket:  { w: 3.1, d: 2.2 },
  postOffice:   { w: 1.85, d: 1.55 },
  school:       { w: 4.05, d: 1.95 },
  hospital:     { w: 2.65, d: 1.95 },
  bank:         { w: 2.25, d: 1.75 },
  library:      { w: 2.55, d: 1.75 },
  shrine: [                                    // 拝殿 + 鸟居柱 + 石灯笼
    { oz: -0.6, w: 1.35, d: 1.15 },
    { ox: -0.85, oz: 1.4, r: 0.16 },
    { ox: 0.85, oz: 1.4, r: 0.16 },
    { ox: -1.5, oz: 0.4, r: 0.22 },
    { ox: 1.5, oz: 0.4, r: 0.22 },
  ],
  car:          { w: 0.8, d: 1.5 },
  bicycle:      { w: 0.55, d: 0.5 },
  vending:      { w: 0.5, d: 0.42 },
  phoneBox:     { w: 0.45, d: 0.35 },
  fountain:     { r: 1.3 },
  flowerbed:    { w: 0.75, d: 0.55 },
  bench:        { w: 0.78, d: 0.3 },
  wall:         { w: 1.2, d: 0.18 },
  fence:        { w: 1.3, d: 0.1 },
  tree:         { r: 0.22 },                   // 树干（× 尺度 s）
  sakura:       { r: 0.22 },
  pole:         { r: 0.15 },
  streetlight:  { r: 0.14 },
  signboard:    { r: 0.14 },
  trafficLight: { r: 0.14 },
  trash:        { r: 0.3 },
  hydrant:      { r: 0.18 },
};
