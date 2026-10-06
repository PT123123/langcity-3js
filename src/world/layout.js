// layout.js — 城镇规划数据（星球参数 / 道路网 / 广场 / 物件坐标表）
// plan 坐标系：x 向东（米），z 向南（米），原点 = 车站前广场中心
import * as THREE from 'three';

export const R = 60;                 // 星球半径（城镇帽 ≈ 纬度 11°~65°，符合规格 10°~62°）
export const LAT0 = THREE.MathUtils.degToRad(38); // 城镇中心纬度（日本-ish）
export const LON0 = 0;

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

// ---------- 地形缓坡（ Town 核心区以外；cat/贴图/物件共用） ----------
const HILLS = [
  { x: 0, z: -27, a: 1.3, s: 8 },     // 北侧森林丘
  { x: -24, z: +5, a: 0.8, s: 7 },    // 西侧
  { x: 21, z: +18, a: 0.6, s: 7 },    // 神社丘
  { x: -7, z: +27, a: 0.55, s: 5 },   // 海滩沙丘
];
export function terrainH(x, z) {
  let h = 0;
  for (const hl of HILLS) {
    const dx = x - hl.x, dz = z - hl.z;
    h += hl.a * Math.exp(-(dx * dx + dz * dz) / (2 * hl.s * hl.s));
  }
  return h;
}

// ---------- 道路网（asphalt 半宽 w；两侧自动 +1.35 人行道） ----------
export const SIDEWALK_W = 1.35;
export const ROADS = [
  { x1: 0, z1: -30, x2: 0, z2: +30, w: 2.2 },     // 南北主街（车站→海滩）
  { x1: -26, z1: 0, x2: 26, z2: 0, w: 2.2 },      // 东西大街（市政区）
  { x1: -22, z1: 12, x2: 22, z2: 12, w: 2.0 },    // 住宅区街
  { x1: 12, z1: 0, x2: 12, z2: 12, w: 2.0 },      // 东巷
  { x1: -12, z1: 0, x2: -12, z2: 12, w: 2.0 },    // 西巷
  { x1: -10, z1: -10, x2: 10, z2: -10, w: 1.7 },  // 商店后巷
];

export const PLAZA = { x: 0, z: 0, r: 5.6 };
export const PARKING = { x1: 4.5, z1: -19, x2: 11, z2: -13.5 }; // 駐車場（车站东侧）
export const BEACH_Z = 24;   // z > BEACH_Z 沙滩 → 海
export const FOREST_LAT = 27; // |z| > 25 起森林环（北侧 z<-25）

// ---------- 物件总表（kind → props.js 的 buildXxx；word → data/words.json id） ----------
// rotY：0=朝南(+z), PI=朝北, PI/2=朝西, -PI/2=朝东
export const PLACES = [
  // —— 车站前广场（北入口） ——
  { kind: 'station', word: 'station', x: 0, z: -16, rotY: 0 },
  { kind: 'parkingSign', word: 'chuushajou', x: 3.6, z: -13.4, rotY: Math.PI / 2 },
  { kind: 'trafficLight', word: 'traffic_light', x: 3.2, z: 3.2, rotY: Math.PI * 0.75 },
  { kind: 'phoneBox', word: 'koushuudenwa', x: -3.8, z: -6.2, rotY: 0 },
  { kind: 'plazaFlag', word: 'hata', x: 2.5, z: 2.5, rotY: 0.8 },

  // —— 商店街（广场以北） ——
  { kind: 'konbini', word: 'konbini', x: -7.5, z: -8, rotY: Math.PI / 2 },
  { kind: 'ramen', word: 'ramen_shop', x: 7.5, z: -8, rotY: -Math.PI / 2 },
  { kind: 'cafe', word: 'cafe', x: -8, z: -14.5, rotY: Math.PI / 2 },
  { kind: 'supermarket', word: 'supermarket', x: 9, z: -15, rotY: -Math.PI / 2 },
  { kind: 'postOffice', word: 'post_office', x: -9, z: -20, rotY: Math.PI / 2 },
  { kind: 'signboard', word: 'signboard', x: 5.2, z: -6.5, rotY: Math.PI * 0.85 },
  { kind: 'signboard', word: 'signboard', x: -5.2, z: -11.5, rotY: -Math.PI * 0.2 },
  { kind: 'signboard', word: 'signboard', x: 4.6, z: -12.4, rotY: Math.PI * 0.95 },

  // —— 东西大街市政区 ——
  { kind: 'school', word: 'gakkou', x: -17, z: -4.5, rotY: Math.PI / 2 },      // 朝东
  { kind: 'library', word: 'toshokan', x: -17, z: 6.5, rotY: Math.PI / 2 },    // 朝东
  { kind: 'hospital', word: 'byouin', x: 17, z: -4.5, rotY: -Math.PI / 2 },    // 朝西
  { kind: 'bank', word: 'ginkou', x: 17, z: 6.5, rotY: Math.PI },              // 朝北

  // —— 住宅区（南） ——
  { kind: 'house', word: 'house', x: -8.5, z: 7.5, rotY: 0, v: 0 },
  { kind: 'house', word: 'house', x: -3.8, z: 7.8, rotY: 0, v: 1 },
  { kind: 'house', word: 'house', x: 4.2, z: 7.6, rotY: 0, v: 2 },
  { kind: 'house', word: 'house', x: 9, z: 7.8, rotY: 0, v: 3 },
  { kind: 'house', word: 'house', x: -13.5, z: 17.5, rotY: Math.PI, v: 4 },
  { kind: 'mansion', word: 'mansion', x: -4.5, z: 19.5, rotY: Math.PI },
  { kind: 'mansion', word: 'mansion', x: 6.5, z: 20, rotY: Math.PI, v: 1 },
  { kind: 'wall', word: 'hei', x: -1.2, z: 7.6, rotY: 0 },
  { kind: 'wall', word: 'hei', x: 6.8, z: 7.7, rotY: 0 },
  { kind: 'fence', word: 'fensu', x: 14.5, z: 9, rotY: 0 },
  { kind: 'crossing', word: 'crossing', x: 0, z: 12, rotY: -Math.PI / 2, flat: true },

  // —— 公园（西南） ——
  { kind: 'fountain', word: 'funsui', x: -15.5, z: 19, rotY: 0 },
  { kind: 'bench', word: 'bench', x: -12.5, z: 17.2, rotY: -Math.PI / 2 - 0.5 },
  { kind: 'bench', word: 'bench', x: -18.2, z: 20.8, rotY: 0.9 },
  { kind: 'flowerbed', word: 'kadan', x: -13, z: 21.5, rotY: 0.4 },
  { kind: 'flowerbed', word: 'kadan', x: -18.5, z: 16.8, rotY: 1.2 },

  // —— 神社（东南丘） ——
  { kind: 'shrine', word: 'jinja', x: 21, z: 18, rotY: -Math.PI / 2 }, // 朝西

  // —— 街具散布 ——
  { kind: 'pole', word: 'pole', x: 3.8, z: -4.5, rotY: 0.3 },
  { kind: 'pole', word: 'pole', x: -3.8, z: -13, rotY: 0.9 },
  { kind: 'pole', word: 'pole', x: 3.8, z: 6, rotY: 0.1 },
  { kind: 'pole', word: 'pole', x: -14.5, z: -0.5, rotY: 0.7 },
  { kind: 'pole', word: 'pole', x: 14.5, z: 13.5, rotY: 0.4 },
  { kind: 'pole', word: 'pole', x: -8.2, z: 14.5, rotY: 1.1 },
  { kind: 'streetlight', word: 'streetlight', x: -3.6, z: -3.2, rotY: 0 },
  { kind: 'streetlight', word: 'streetlight', x: 3.6, z: -12.8, rotY: Math.PI },
  { kind: 'streetlight', word: 'streetlight', x: -3.6, z: 8.5, rotY: 0 },
  { kind: 'streetlight', word: 'streetlight', x: 10.5, z: 2, rotY: Math.PI / 2 },
  { kind: 'streetlight', word: 'streetlight', x: -10.5, z: 10.5, rotY: -Math.PI / 2 },
  { kind: 'streetlight', word: 'streetlight', x: 2.8, z: 17.5, rotY: Math.PI },
  { kind: 'vending', word: 'vending', x: -5.8, z: -9.6, rotY: Math.PI },
  { kind: 'vending', word: 'vending', x: 5.8, z: -10.9, rotY: 0, v: 1 },
  { kind: 'vending', word: 'vending', x: -6.2, z: 9.2, rotY: 0, v: 0 },
  { kind: 'vending', word: 'vending', x: 7.8, z: 17.8, rotY: Math.PI, v: 1 },
  { kind: 'vending', word: 'vending', x: -6.6, z: -2.2, rotY: 0.5 },
  { kind: 'trash', word: 'trash', x: 4.6, z: -6.8, rotY: 0.4 },
  { kind: 'trash', word: 'trash', x: -4.6, z: 5.4, rotY: 1.2 },
  { kind: 'trash', word: 'trash', x: 11, z: 12.8, rotY: 0.2 },
  { kind: 'trash', word: 'trash', x: -9.5, z: -7.4, rotY: 0.8 },
  { kind: 'mailbox', word: 'mailbox', x: -4.4, z: -7.6, rotY: 0.3 },
  { kind: 'mailbox', word: 'mailbox', x: 8.2, z: 2.2, rotY: Math.PI / 2 },
  { kind: 'mailbox', word: 'mailbox', x: -3.2, z: 18.6, rotY: Math.PI },
  { kind: 'hydrant', word: 'shoukasen', x: 5.5, z: 0.9, rotY: 0.5 },
  { kind: 'hydrant', word: 'shoukasen', x: -5.5, z: 12.9, rotY: 1.0 },
  { kind: 'hydrant', word: 'shoukasen', x: 9.8, z: -6.2, rotY: 0.2 },
  { kind: 'hydrant', word: 'shoukasen', x: -10.8, z: 2.8, rotY: 0.9 },
  { kind: 'clothesline', word: 'monoboshizao', x: -10.5, z: 10.2, rotY: Math.PI / 2 },
  { kind: 'clothesline', word: 'monoboshizao', x: 5.6, z: 10.4, rotY: Math.PI / 2 },
  { kind: 'clothesline', word: 'monoboshizao', x: 10.5, z: 10.2, rotY: Math.PI / 2 },
  { kind: 'clothesline', word: 'monoboshizao', x: -6.4, z: 21.8, rotY: 0 },
  { kind: 'clothesline', word: 'monoboshizao', x: 8.4, z: 22.2, rotY: 0 },
  { kind: 'potted', word: 'hachiue', x: -7, z: 8.4, rotY: 0.3 },
  { kind: 'potted', word: 'hachiue', x: -6.2, z: 8.2, rotY: 1.1 },
  { kind: 'potted', word: 'hachiue', x: 2.8, z: 8.3, rotY: 0.6 },
  { kind: 'potted', word: 'hachiue', x: 7.4, z: 8.5, rotY: 0.9 },
  { kind: 'potted', word: 'hachiue', x: -5.4, z: 20.2, rotY: 0.4 },
  { kind: 'potted', word: 'hachiue', x: -3.6, z: 20.4, rotY: 1.3 },
  { kind: 'potted', word: 'hachiue', x: 5.2, z: 20.6, rotY: 0.8 },
  { kind: 'potted', word: 'hachiue', x: 7.6, z: 20.4, rotY: 0.2 },
  { kind: 'potted', word: 'hachiue', x: -8.6, z: 13.2, rotY: 0.5 },
  { kind: 'potted', word: 'hachiue', x: 13.2, z: 11.2, rotY: 1.0 },

  // —— 植物（聚簇、非等距） ——
  { kind: 'tree', word: 'tree', x: -8, z: 3.4, rotY: 0.7, v: 0, s: 1.1 },
  { kind: 'tree', word: 'tree', x: 8.5, z: 4.2, rotY: 1.3, v: 1, s: 0.95 },
  { kind: 'tree', word: 'tree', x: -15, z: 2.8, rotY: 0.2, v: 2, s: 1.2 },
  { kind: 'tree', word: 'tree', x: 15.2, z: 3.2, rotY: 0.9, v: 0, s: 0.9 },
  { kind: 'tree', word: 'tree', x: -9.5, z: 16.2, rotY: 0.5, v: 1, s: 1.05 },
  { kind: 'tree', word: 'tree', x: 2.5, z: 23, rotY: 1.0, v: 2, s: 1.0 },
  { kind: 'tree', word: 'tree', x: 16, z: 12.6, rotY: 0.4, v: 0, s: 1.15 },
  { kind: 'tree', word: 'tree', x: 25, z: 8, rotY: 0.8, v: 1, s: 1.2 },
  { kind: 'tree', word: 'tree', x: -25, z: -2, rotY: 0.6, v: 2, s: 1.1 },
  { kind: 'tree', word: 'tree', x: -20, z: -12, rotY: 0.9, v: 0, s: 1.0 },
  { kind: 'tree', word: 'tree', x: 12, z: -20, rotY: 0.3, v: 1, s: 1.1 },
  { kind: 'tree', word: 'tree', x: 24, z: -8, rotY: 1.1, v: 2, s: 0.95 },
  { kind: 'sakura', word: 'sakura', x: -13.2, z: 14.8, rotY: 0.8, s: 1.1 },
  { kind: 'sakura', word: 'sakura', x: -17.5, z: 18.4, rotY: 0.2, s: 1.0 },
  { kind: 'sakura', word: 'sakura', x: -11, z: 21, rotY: 1.2, s: 0.9 },
  { kind: 'sakura', word: 'sakura', x: -19.5, z: 22.4, rotY: 0.6, s: 1.15 },
  { kind: 'sakura', word: 'sakura', x: -9.2, z: 23.4, rotY: 0.4, s: 0.95 },
  { kind: 'sakura', word: 'sakura', x: 17.5, z: 15.2, rotY: 0.7, s: 1.05 },
  { kind: 'sakura', word: 'sakura', x: 24.5, z: 20.5, rotY: 0.9, s: 1.0 },
  { kind: 'sakura', word: 'sakura', x: 14.8, z: 20.2, rotY: 0.5, s: 0.9 },
  { kind: 'flowers', word: 'flower', x: -10.8, z: 19.4, rotY: 0.3, s: 1.0 },
  { kind: 'flowers', word: 'flower', x: -16.8, z: 21.6, rotY: 0.9, s: 1.2 },
  { kind: 'flowers', word: 'flower', x: 4.5, z: 15.5, rotY: 0.1, s: 0.9 },
  { kind: 'flowers', word: 'flower', x: 18.8, z: 10.8, rotY: 0.7, s: 1.0 },
  { kind: 'flowers', word: 'flower', x: -6.5, z: 4.6, rotY: 0.5, s: 1.1 },
  { kind: 'flowers', word: 'flower', x: 6.8, z: -4.2, rotY: 1.1, s: 0.9 },
  { kind: 'flowers', word: 'flower', x: -2.8, z: 14.8, rotY: 0.2, s: 1.0 },
  { kind: 'flowers', word: 'flower', x: 11.2, z: 18.4, rotY: 0.8, s: 1.1 },
  { kind: 'flowers', word: 'flower', x: -20.8, z: 12.6, rotY: 0.6, s: 0.95 },
  { kind: 'flowers', word: 'flower', x: 8.2, z: 13.4, rotY: 0.4, s: 1.05 },
  { kind: 'grassTuft', word: 'grass', x: -7.4, z: 2.2, rotY: 0.3, s: 1.0 },
  { kind: 'grassTuft', word: 'grass', x: 7.2, z: 6.4, rotY: 0.9, s: 1.2 },
  { kind: 'grassTuft', word: 'grass', x: -12.2, z: 12.8, rotY: 0.1, s: 1.0 },
  { kind: 'grassTuft', word: 'grass', x: 13.8, z: 16.2, rotY: 0.7, s: 1.1 },
  { kind: 'grassTuft', word: 'grass', x: -16.2, z: 14.2, rotY: 0.5, s: 0.9 },
  { kind: 'grassTuft', word: 'grass', x: 3.2, z: 20.8, rotY: 1.0, s: 1.0 },
  { kind: 'grassTuft', word: 'grass', x: -4.2, z: 4.8, rotY: 0.4, s: 1.1 },
  { kind: 'grassTuft', word: 'grass', x: 10.2, z: 8.8, rotY: 0.8, s: 0.95 },

  // —— 车辆 ——
  { kind: 'car', word: 'car', x: 7, z: -16.2, rotY: Math.PI / 2, v: 0 },      // 停车场
  { kind: 'car', word: 'car', x: 9.2, z: -14.6, rotY: Math.PI / 2, v: 1 },
  { kind: 'car', word: 'car', x: -5.5, z: 1.6, rotY: 0, v: 2 },               // 路边
  { kind: 'car', word: 'car', x: 6.5, z: 10.8, rotY: Math.PI, v: 0 },
  { kind: 'bicycle', word: 'bicycle', x: 4.2, z: -17.8, rotY: 0.4, v: 0 },
  { kind: 'bicycle', word: 'bicycle', x: 5.4, z: -18.2, rotY: 0.8, v: 1 },
  { kind: 'bicycle', word: 'bicycle', x: -2.2, z: -13.4, rotY: 1.4, v: 0 },
  { kind: 'bicycle', word: 'bicycle', x: -9.8, z: 12.4, rotY: 0.2, v: 1 },

  // —— 动物 ——
  { kind: 'dog', word: 'dog', x: -6.8, z: 15.4, rotY: 0.6, v: 0 },
  { kind: 'dog', word: 'dog', x: 4.8, z: 18.6, rotY: 2.2, v: 1 },
  { kind: 'catNpc', word: 'cat', x: 3.2, z: -11.6, rotY: 1.0, v: 0 },
  { kind: 'catNpc', word: 'cat', x: -14.2, z: 8.2, rotY: 2.6, v: 1 },
  { kind: 'bird', word: 'bird', x: -1.8, z: 3.4, rotY: 0.4, v: 0 },
  { kind: 'bird', word: 'bird', x: -13.8, z: 18.2, rotY: 1.8, v: 1 },

  // —— NPC ——
  { kind: 'npc', word: 'onna', x: -2.6, z: 1.8, rotY: 1.2, v: 0 },
  { kind: 'npc', word: 'ojiisan', x: 2.2, z: -2.4, rotY: 0.4, v: 1 },
  { kind: 'npc', word: 'kodomo', x: 1.4, z: 4.2, rotY: 2.0, v: 2 },
  { kind: 'npc', word: 'hito', x: -2.2, z: -12.4, rotY: 0.9, v: 3 },
  { kind: 'npc', word: 'otona', x: 4.4, z: -14.6, rotY: 1.6, v: 0 },
  { kind: 'npc', word: 'otoko', x: -5.6, z: -6.8, rotY: 0.7, v: 1 },
  { kind: 'npc', word: 'gakusei', x: 5.8, z: -6.4, rotY: 2.4, v: 2 },
  { kind: 'npc', word: 'sensei', x: -13.4, z: -3.4, rotY: 1.1, v: 0 },
  { kind: 'npc', word: 'obaasan', x: -6.2, z: 17.6, rotY: 0.3, v: 1 },
  { kind: 'npc', word: 'otoko', x: 10.4, z: 15.2, rotY: 2.1, v: 3 },
  { kind: 'npc', word: 'kodomo', x: -11.8, z: 20.6, rotY: 1.9, v: 2 },
  { kind: 'npc', word: 'onna', x: 14.2, z: 2.6, rotY: 0.8, v: 0 },
  { kind: 'npc', word: 'hito', x: 15.2, z: -6.4, rotY: 1.4, v: 1 },
  { kind: 'npc', word: 'akachan', x: -3.4, z: 3.6, rotY: 2.6, v: 4 },
];

/** 森林环装饰树（不可交互，纯构图） */
export const FOREST_TREES = (() => {
  const arr = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // 北弧
  for (let i = 0; i < 26; i++) {
    const x = -30 + rnd() * 60;
    const z = -25 - rnd() * 8;
    arr.push({ x, z, v: Math.floor(rnd() * 3), s: 0.9 + rnd() * 0.7, rotY: rnd() * 6.28 });
  }
  // 西南/东侧点缀
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 27 + rnd() * 4;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (z > BEACH_Z - 4) continue;
    arr.push({ x, z, v: Math.floor(rnd() * 3), s: 0.9 + rnd() * 0.6, rotY: rnd() * 6.28 });
  }
  return arr;
})();
