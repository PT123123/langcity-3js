// 城镇组装：读 planet.json（245 个物件的原版落点），用本地程序化构建器摆放
// 坐标换算与落点全部来自现成数据，不自绘地图
import * as THREE from 'three';
import { CFG, dirFromPx, pxFromDir, basisAt, R } from './planetMap.js';
import { PBR, M } from './materials.js';
import { handTex, handRough, tintFor } from './textures.js';
import { ROADS, SIDEWALK_W, PLAZA, PARKING, CROSSWALKS, PLAN_C, TOWN_RECT, roadDistance, streetMesh, crosswalkMesh, roadTexture } from './townPlan.js';
import { CITY_OBJECTS } from './cityPlan.js';
import { measureFoot, tan2plan, roadDirs, planYawDeg, asphaltSlack, laneDepth, KERB,
  compactTown, layoutMetrics, PACK_CFG } from './frontage.js';
import { wordById } from '../game/words.js';
import { preloadProps, NPC_BY_NAME } from './props.js';
import * as B from './buildings.js';
import * as P from './props.js';

const D2R = THREE.MathUtils.degToRad;
const ja = (id) => (id && wordById(id)?.ja) || '';

// kind → 构建器（planet.json 的 kind 命名）；第二个参数是 planet.json 的原始条目
const BUILDERS = {
  station: () => B.buildStation('st', { colliderR: 2.6 }),
  konbini: () => B.buildKonbini('kb'),
  house: (seed) => B.buildHouse('h' + seed),
  mansion: (seed) => B.buildMansion('m' + seed),
  super: () => B.buildSuper('sp'),
  cafe: () => B.buildCafe('cf'),
  ramen: () => B.buildRamen('rm'),
  post_office: () => B.buildPostOffice('po'),
  temple: () => B.buildShrine('sh'),
  school: () => B.buildSchool('sch'),
  hospital: () => B.buildHospital('hosp'),
  bank: () => B.buildBank('bank'),
  police: () => B.buildStation('pol'),
  library: () => B.buildLibrary('lib'),

  pole: () => P.buildPole('pl'),
  streetlight: () => P.buildStreetlight('sl'),
  vending: () => P.buildVendingMachine('vm'),
  trash: () => P.buildTrash('tr'),
  mailbox: () => P.buildMailbox('mb'),
  signboard: () => P.buildSignboard('sg', { idx: Math.floor(Math.random() * 6) }),
  parksign: () => P.buildParkingSign('ps'),
  traffic_light: (seed) => P.buildTrafficLight('tl' + seed),
  phone_box: (seed) => P.buildPhoneBox('pb' + seed),
  plaza_flag: (seed) => P.buildPlazaFlag('pf' + seed),
  fence: (seed) => P.buildFence('fn' + seed),
  busstop: () => P.buildBusStop('bs'),
  bench: () => P.buildBench('bn'),
  planter: () => P.buildPlanter('pt'),
  potplant: () => P.buildPlanter('pp'),
  fireplug: () => P.buildFireplug('fp'),
  laundry: () => P.buildLaundry('ld'),
  car: (seed) => P.buildCar('car' + seed),
  truck: () => P.buildCar('trk'),
  bicycle: () => P.buildBicycle('bc'),
  boat: () => P.buildBoat('bt'),
  fountain: () => P.buildFountain('ft'),

  tree: () => P.buildTree('t' + Math.floor(Math.random() * 999), { scale: 0.9 + Math.random() * 0.5 }),
  sakura: () => P.buildSakura('sk' + Math.floor(Math.random() * 999), { scale: 0.9 + Math.random() * 0.4 }),
  flower: () => P.buildFlowerPatch('fl'),
  grass: () => P.buildGrassTuft('gr'),
  dog: () => P.buildDog('dg'),
  fox: () => P.buildFox('fx'),
  bird: () => P.buildBird('bd'),
  deer: () => P.buildDog('deer'),
  wolf: () => P.buildFox('wf'),
  npc: (seed, o) => P.buildNpc('np' + seed, { key: NPC_BY_NAME[o.npc], variant: Math.floor(Math.random() * 5) }),

  // 原版数据里有、此前没有构建器的一批（= 玩家永远碰不到的词与场景件）
  delivery: (seed, o) => P.buildParcel('dv' + seed, {
    model: o.model, h: o.h,
    word: o.model === 'clothes' ? 'fuku' : o.model === 'samplebox' ? 'hako' : null,
  }),
  plate: (seed, o) => P.buildPlate('pa' + seed, { word: o.word, text: ja(o.word) }),
  goods: (seed, o) => P.buildGoods('gd' + seed, { word: o.word, text: ja(o.word) }),
  ticket_sign: (seed, o) => P.buildTicketSign('ts' + seed, { word: o.word, text: ja(o.word) || '切符' }),
  roadsign: (seed, o) => P.buildRoadsign('rs' + seed, { word: o.word }),
  turtle: (seed, o) => P.buildTurtle('tu' + seed, { word: o.word }),
  cat: (seed) => P.buildCat('ca' + seed),
  bowl: (seed, o) => P.buildFood('bo' + seed, { form: 'bowl', word: o.word }),
  onigiri: (seed, o) => P.buildFood('og' + seed, { form: 'onigiri', word: o.word }),
  bread: (seed, o) => P.buildFood('br' + seed, { form: 'bread', word: o.word }),
  cans: (seed, o) => P.buildFood('cn' + seed, { form: 'drink', word: o.word }),
  pipe: (seed) => P.buildClutter('pp' + seed, { form: 'pipe' }),
  crate: (seed) => P.buildClutter('cr' + seed, { form: 'crate' }),
  lowwall: (seed, o) => P.buildClutter('lw' + seed, { form: 'lowwall', word: o.word }),
  tires: (seed) => P.buildClutter('ti' + seed, { form: 'tires' }),
  cones: (seed) => P.buildClutter('co' + seed, { form: 'cones' }),
  trashbags: (seed) => P.buildClutter('tb' + seed, { form: 'trashbags' }),
  gasbottle: (seed) => P.buildClutter('gb' + seed, { form: 'gasbottle' }),
  furniture: (seed, o) => P.buildFurniture('fu' + seed, { form: 'kagu', word: o.word }),
  table: (seed, o) => P.buildFurniture('tb' + seed, { form: 'table', word: o.word }),
  chair: (seed, o) => P.buildFurniture('ch' + seed, { form: 'chair', word: o.word }),
  sofa: (seed, o) => P.buildFurniture('sf' + seed, { form: 'sofa', word: o.word }),
  shelf: (seed, o) => P.buildFurniture('sh' + seed, { form: 'shelf', word: o.word }),
  tv: (seed, o) => P.buildFurniture('tv' + seed, { form: 'tv', word: o.word }),
  lamp: (seed, o) => P.buildFurniture('lp' + seed, { form: 'lamp', word: o.word }),
  bed: (seed, o) => P.buildFurniture('bd' + seed, { form: 'bed', word: o.word }),
  wash: (seed, o) => P.buildFurniture('wh' + seed, { form: 'wash', word: o.word }),
};

// 门与窗不独立选址，贴在宿主建筑的正墙上
const ATTACH = { door: P.buildDoor, window: P.buildWindowProp };

// 只有建筑族生成碰撞体（道具密度太高，碰撞链会把猫弹飞；猫可以穿过小物件）
const SOLID_KINDS = new Set([
  'station', 'konbini', 'house', 'mansion', 'super', 'cafe', 'ramen',
  'post_office', 'temple', 'school', 'hospital', 'bank', 'police', 'library',
]);
// 有真实体量的小件：要和建筑抢地方，也要压地基
// 这一批同时是「街具」——认街时会被收到人行道带上，所以别把树/花/草放进来（它们该留在野地）。
const HARD_KINDS = new Set([
  'car', 'truck', 'boat', 'busstop', 'vending', 'laundry', 'goods', 'fountain',
  'furniture', 'table', 'chair', 'sofa', 'shelf', 'tv', 'lamp', 'bed', 'wash', 'crate', 'lowwall', 'pipe', 'tires', 'cones', 'trashbags', 'gasbottle', 'roadsign',
  'fence', 'traffic_light', 'phone_box',
  'bicycle', 'bench', 'mailbox', 'fireplug', 'signboard', 'trash', 'parksign', 'ticket_sign', 'pole', 'streetlight',
]);

// 地基比建筑对角半径多出的余量 / 两块地基之间至少留出的走道（猫宽 0.7 + 余量）
const PAD_GAP = 0.7;
const STREET = 1.3;

/** 经纬都钳回可玩带（越界就掉进海里/烘到场外） */
function clampBand(d) {
  const lam = THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -D2R(CFG.lonSpanDeg - 1), D2R(CFG.lonSpanDeg - 1));
  const phi = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)),
    D2R(CFG.latTopDeg + 0.5), D2R(CFG.latBottomDeg - 0.5));
  const sl = Math.sin(phi);
  return d.set(sl * Math.sin(lam), Math.cos(phi), sl * Math.cos(lam)).normalize();
}

/** 球面松弛：原版落点比真实模型窄得多（8m 宽的建筑中心只隔 2~12m），全部互相穿模，
 *  而没有任何一个统一缩放能救（半径放大到 180m 才只剩 1 对）。
 *  这里沿大圆把叠死的一对推开，重量决定谁让得多，并钳住「最多离开原位几米」保住街道格局。 */
function relaxSites(sites) {
  const GAP = [[STREET, 0.8, 0.5], [0.8, 0.35, 0.3], [0.5, 0.3, -1]];
  const MASS = [1, 1.8, 2.4];
  const MAXPUSH = [14, 8, 3];
  const ax = new THREE.Vector3();
  let pass = 0;
  for (let iter = 0; iter < 48; iter++) {
    let moved = 0;
    for (let i = 0; i < sites.length; i++) {
      const sa = sites[i];
      if (sa.cls === 2) continue; // 软体（树/人/动物）只被推，不互推
      for (let j = i + 1; j < sites.length; j++) {
        const sb = sites[j];
        const gap = GAP[sa.cls][sb.cls];
        if (gap < 0) continue;
        // 手写城市那 179 条是「定稿的规划表」：楼与楼之间的间距是作者排好的，
        // 一旦被松弛推走，站前店行就散了架。它们只推别人，自己不动。
        if (sa.fixed && sb.fixed) continue;
        const need = (sa.padR + sb.padR + gap) / R;
        const ang = sa.dir.angleTo(sb.dir);
        if (ang >= need) continue;
        ax.crossVectors(sa.dir, sb.dir);
        if (ax.lengthSq() < 1e-10) ax.set(0, 1, 0).cross(sa.dir);
        if (ax.lengthSq() < 1e-10) continue;
        ax.normalize();
        const push = (need - ang) * 0.55;
        const wa = sa.fixed ? 0 : sb.fixed ? 1 : MASS[sb.cls] / (MASS[sa.cls] + MASS[sb.cls]);
        sa.dir.applyAxisAngle(ax, -push * wa).normalize();
        sb.dir.applyAxisAngle(ax, push * (1 - wa)).normalize();
        moved += push;
      }
    }
    for (const s of sites) {
      if (s.fixed) continue;
      const maxA = MAXPUSH[s.cls] / R;
      if (s.home.angleTo(s.dir) > maxA) {
        ax.crossVectors(s.home, s.dir);
        if (ax.lengthSq() > 1e-12) s.dir.copy(s.home).applyAxisAngle(ax.normalize(), maxA).normalize();
      }
      clampBand(s.dir);
    }
    if (moved === 0) break;
    pass = iter + 1;
  }
  return pass;
}

// 贴图地坪：建筑周围一圈随地形起伏的铺装圆盘（Canvas 手绘 Messenger 纹理，射线贴地）
// hand=手绘纹理 kind，base=设计色，tile=一块纹理覆盖的米数
// base 不再手乘系数：textures.js:tintFor 按贴图实测的线性均值反补，让 map 只加纹路不改亮度
// （手绘图白底铺底均值只有 ~0.46 线性，硬乘会把地坪读成地上的一个洞，实测顶点色 0.95 vs 地坪 0.37）。
const YARDS = {
  // tile 是「一块鹅卵石纹理盖几米」。原来站前 2.6 m/块，按 cobble 图里石子占 7~17%
  // 算出来单颗石头 0.45 m 起，站在 6 m 外看就是一地浅色水洼，和旁边的沙地一个明度
  // （实测坪内平均 (150,125,95) vs 坪外沙地 (138,129,111)）。收到 1.1 m/块 = 石头
  // 0.19~0.44 m，同时把设计色压灰压暗一档，铺装才读得出「铺过」而不是「踩实的沙」。
  station: { hand: 'cobble', base: 0xa9a29a, r: 6.5, tile: 1.15, rings: 12 }, // 駅前石畳広場
  temple: { hand: 'ishidatami', base: 0xa8a49a, r: 5.5, tile: 1.1, rings: 10 }, // 神社石板庭院
  fountain: { hand: 'tileFloor', base: 0xb3a48c, r: 3.4, tile: 0.8, rings: 8 },  // 喷泉陶砖面
};

/** 随地形起伏的圆盘：极坐标网格逐点射线取地表(+lift)，smooth 法线。
 *  两个口径必须对：① 切向偏移要除以 cR 再归一化，否则 rr 米被当成 rr 弧度
 *  （6.5m 的广场实际摊到 520m，永远"起伏过大"，一寸地坪都没铺上过）；
 *  ② 烘出来的地面是「等半径穹顶」，坪内所有顶点半径相同，所以平整度直接量半径极差。 */
function yardDisc(surfaceAt, center, normal, radius, mat, { seg = 48, rings = 12, lift = 0.035, flatTol = 0.9 } = {}) {
  const up = normal.clone().normalize();
  let u = new THREE.Vector3(0, 0, 1).cross(up);
  if (u.lengthSq() < 1e-6) u = new THREE.Vector3(1, 0, 0).cross(up);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(up, u).normalize();
  const cR = center.length();
  const pos = [], uvs = [], idx = [];
  let rMin = Infinity, rMax = -Infinity;
  const dir = new THREE.Vector3();
  for (let ri = 0; ri <= rings; ri++) {
    const rr = (ri / rings) * radius;
    for (let si = 0; si <= seg; si++) {
      const a = (si / seg) * Math.PI * 2;
      dir.copy(up).addScaledVector(u, Math.cos(a) * rr / cR).addScaledVector(v, Math.sin(a) * rr / cR).normalize();
      const h = surfaceAt(dir);
      if (!h.hit) return null; // 采样打空(悬崖背面等) → 不铺
      const r = h.pos.length();
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      const p = h.pos.clone().addScaledVector(up, lift);
      pos.push(p.x, p.y, p.z);
      uvs.push(Math.cos(a) * rr / (radius * 2) + 0.5, Math.sin(a) * rr / (radius * 2) + 0.5);
    }
  }
  if (rMax - rMin > flatTol) return null; // 地面真的起伏过大，铺了必穿帮
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < seg; si++) {
      const a = ri * (seg + 1) + si, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const na = geo.attributes.normal;
  for (let k = 0; k < na.count; k++) {   // 圆心一圈是零面积三角形，法线会算成零向量→黑点
    if (na.getX(k) ** 2 + na.getY(k) ** 2 + na.getZ(k) ** 2 < 1e-8) na.setXYZ(k, up.x, up.y, up.z);
  }
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// ---------- 路面判定与让位：灰色低饱和顶点色 = 沥青/石板路 ----------
// 阈值与 scatter.js 的灰面判定一致（sat<0.10 且非草）
function roadHit(h) {
  if (!h.col) return false;
  const sat = Math.max(h.col.r, h.col.g, h.col.b) - Math.min(h.col.r, h.col.g, h.col.b);
  return sat < 0.10 && h.grass < 0.45;
}

/** 把压在街面上的小道具挪到最近的路肩（≤3.3m）：在够平的路肩里挑最近的，
 *  全都陡就留在路面上。原先只要法线差 ≤53° 就照挪，结果售货机、垃圾桶
 *  被从平路上挪到 50~60° 的坡肩上，一半埋进土里——比留在路上还假。 */
function nudgeOffRoad(surfaceAt, hit, waterRadius, isRoad, maxD = 3.3) {
  const t1 = new THREE.Vector3().crossVectors(hit.pos, new THREE.Vector3(0, 1, 0)).normalize();
  const t2 = new THREE.Vector3().crossVectors(t1, hit.pos).normalize();
  const cand = [];
  // 搜索半径必须盖过整条街廊：主干道 need() 有 4.6m，只探到 3.3m 的话
  // 落在街心的道具八个方向全都还在走廊里，等于「让位失败」，原样留在行车道上。
  const radii = [];
  for (let d = 0.55; d <= maxD + 1e-6; d += 0.55) radii.push(+d.toFixed(2));
  for (const t of [t1, t1.clone().negate(), t2, t2.clone().negate()]) {
    for (const d of radii) {
      const p = hit.pos.clone().addScaledVector(t, d).normalize();
      const h2 = surfaceAt(p);
      if (!h2.hit || !h2.col) continue;
      if (h2.pos.length() < waterRadius + 0.3) continue;  // 别挪进海里
      if (isRoad(p, h2)) continue;
      const tilt = Math.acos(Math.min(1, Math.max(-1, h2.normal.dot(p)))) * 57.2958;
      if (tilt > 25) continue;                            // 别挪上陡壁
      cand.push({ dir: p, hit: h2, d, over: Math.max(0, tilt - 12) });
    }
  }
  if (!cand.length) return null;
  cand.sort((a, b) => (a.over - b.over) || (a.d - b.d));   // 先保证平，平的前提内再挑最近
  return cand[0];
}

/** 没压地基的小件：取脚下几点的中位半径落座，既不让一边浮空也不让一边埋进土 */
function settleRadius(surfaceAt, dir, corner) {
  const up = dir.clone().normalize();
  let u = new THREE.Vector3(0, 0, 1).cross(up);
  if (u.lengthSq() < 1e-6) u = new THREE.Vector3(1, 0, 0).cross(up);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(up, u).normalize();
  const probe = Math.min(corner, 1.6);
  const rs = [];
  const d = new THREE.Vector3();
  for (const [du, dv] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    d.copy(up).addScaledVector(u, du * probe / R).addScaledVector(v, dv * probe / R).normalize();
    const h = surfaceAt(d);
    if (h.hit) rs.push(h.pos.length());
  }
  if (!rs.length) return null;
  rs.sort((a, b) => a - b);
  return rs[rs.length >> 1];
}

/** 沿街压平：手写街网的每条街都要一条和它同宽、同高的路床。
 *  玩法射线只碰烘出来的那张地面网格（terrainMeshes=[groundMesh]），沥青条带只是铺在
 *  床面上的薄层——床面不跟着街走，猫就永远走在街旁边的土上，这正是「走在地球基底」的成因。 */
function layStreets(planet, frame) {
  let metres = 0;
  for (const rd of ROADS) {
    planet.field.levelPath([frame.planToPx(rd.x1, rd.z1), frame.planToPx(rd.x2, rd.z2)],
      rd.w + SIDEWALK_W + 0.9);
    metres += Math.hypot(rd.x2 - rd.x1, rd.z2 - rd.z1);
  }
  // 站前广场与停车场：同样是地面的一部分，不是贴皮
  planet.field.levelDisc(...frame.planToPx(PLAZA.x, PLAZA.z), PLAZA.r + 1.4);
  const pk = PARKING;
  for (const [a, b] of [[[pk.x1, pk.z1], [pk.x2, pk.z1]], [[pk.x1, pk.z2], [pk.x2, pk.z2]],
    [[pk.x1, pk.z1], [pk.x1, pk.z2]], [[pk.x2, pk.z1], [pk.x2, pk.z2]]]) {
    planet.field.levelPath([frame.planToPx(a[0], a[1]), frame.planToPx(b[0], b[1])], 1.1);
  }
  return { laid: ROADS.length, metres: Math.round(metres), main: ROADS.filter((r) => r.main).length };
}

/** 把人和物都贴到街面上。planet.json 的 245 个落点是照 planets_present_intro_planet.glb
 *  排的（那颗模型不在仓库里），跟这套街网毫无关系：不挪的话就是「平地插模型」。
 *  楼沿最近那条街的垂线退到人行道外、正墙朝街；售货机/候车亭/垃圾桶这类街具
 *  摆到人行道带上，汽车停在沥青上贴着路缘；树/花/草（cls 2）留在原地当野地。
 *  镇界外与离网太远的落点不动——把它们全拽到街尾堆起来比原地更假。
 *  楼与楼之间交给 relaxSites 分开。 */
const NO_FRONTAGE = new Set(['boat']);          // 船该在水边，不该在街上
const PARKED = new Set(['car', 'truck']);       // 车本来就该停在沥青上
function frontOntoStreets(frame, sites) {
  let moved = 0;
  const slots = [];   // 已认领的人行道桩位（见下面「街具顺街挪开」）
  for (const s of sites) {
    if (s.cls > 1 || NO_FRONTAGE.has(s.o.kind)) continue;
    // 手写城市的落点本来就是照这套街网排的（楼退人行道外、正墙朝街），
    // 再认一次街只会把店行从 1.2m 骑线推到 2.2m 退线，站前商店街的紧凑感就没了
    if (s.fixed) continue;
    const p = frame.dirToPlan(s.dir);
    if (Math.abs(p.x) > TOWN_RECT.xT || Math.abs(p.z) > TOWN_RECT.zT) continue;   // 镇外的（田/海岸/山口）留在原地
    const { d, rd, t } = roadDistance(frame, p.x, p.z);
    // 街具（cls 1：售货机/候车亭/晾衣架/自行车…）不论原来离街心多远都收进人行道带：
    // 并图之后它们在镇界内，原版那 245 个点跟这套街网毫无关系，量到 18m 外就放手
    // 等于把一堆晾衣架留在行车道上——正是「后插入资源」最扎眼的样子。
    const inTown = Math.abs(p.x) <= TOWN_RECT.xT - 2 && Math.abs(p.z) <= TOWN_RECT.zT - 2;
    if (d > 18 && !(s.cls === 1 && inTown)) continue;          // 太远说明不属于这套网
    const dx = rd.x2 - rd.x1, dz = rd.z2 - rd.z1;
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;                        // 路的横向单位（规划系）
    const cx = rd.x1 + dx * t, cz = rd.z1 + dz * t;         // 街心上的最近点
    const side = ((p.x - cx) * nx + (p.z - cz) * nz) >= 0 ? 1 : -1;
    // 退线和朝向都换到切平面上量：街线在镇缘与规划格子差到 45°（见 planK / roadDirs）
    const [ra, rb, na, nb] = roadDirs(frame, cx, cz, dx / L, dz / L);
    // 街心 → 沥青半宽 → 路缘 → 墙脚（口径与 laneNeed 同一处定义，别让认街和让路互相拉扯）
    const vehicle = s.o.kind === 'car' || s.o.kind === 'truck';
    const want = s.isSolid ? laneNeed(s, rd)
      : vehicle ? Math.max(0.9, rd.w - 0.55)                // 车就在车道里，别站上人行道
        : rd.w + 0.16 + SIDEWALK_W * 0.55;                  // 街具站在人行道上
    const tol = s.isSolid ? 1.2 : 0.8;
    // 楼的朝向先认街，再谈距离：原版落点自带 rot，「距离刚好」的那批如果只在真的挪动时才重算朝向，
    // 玩家走到街边看见的就是背墙（实测 环镇西路 那栋家把山墙和后门对着街）。
    // 街具（候车亭/售货机）仍旧保留 planet.json 的 rot，别把它们的角清成 0。
    if (s.isSolid) s.yaw = Math.atan2(-na * side, -nb * side) * 57.2958;
    if (d > want - tol && d < want + (s.isSolid ? 7 : 3.5)) continue;   // 已经在该有的位置带上
    const o0 = na * side * want, o1 = nb * side * want;     // 离街心的切平面偏移
    const stand = (al) => tan2plan(frame, cx, cz, o0 + ra * al, o1 + rb * al);
    let [fx, fz] = stand(0);
    const spaced = !s.isSolid && !vehicle;
    if (spaced) {
      // 人行道只有 1.35m 宽：两件街具落在同一个桩上会互相穿模，顺街挪开
      for (let k = 0; k < 12 && slots.some((q) => Math.hypot(fx - q.x, fz - q.z) < 2.1); k++) {
        const sgn = k % 2 ? -1 : 1;
        [fx, fz] = stand(2.1 * Math.ceil(k / 2) * sgn);
      }
    }
    if (!frame.inBand(fx, fz)) continue;
    if (spaced) slots.push({ x: fx, z: fz });
    s.dir.copy(frame.planToDir(fx, fz));
    s.home.copy(s.dir);
    s.fronted = true;
    // basisAt 的 yaw 把本地 +Z(南) 转到 (sinθ, cosθ)，反解即得「正墙指向街心」的角（楼的在上面已经认过街了）。
    // 车只在真的挪进车道带时顺街停；其余街具保留原版 rot。
    if (vehicle) s.yaw = Math.atan2(ra, rb) * 57.2958 + (side < 0 ? 180 : 0);   // 沿街停放，车头顺行车方向
    moved++;
  }
  return moved;
}

/** 路在平面上的横向单位向量（街心 → 楼那边） */
function roadLat(rd) {
  const dx = rd.x2 - rd.x1, dz = rd.z2 - rd.z1, L = Math.hypot(dx, dz) || 1;
  return [-dz / L, dx / L];
}

/** 【认街线】一件楼正墙朝街时该站多远。rd.w 是**车行道半宽**
 *  （townPlan.streetMesh: 铺装半宽 = rd.w + SIDEWALK_W，路缘在 rd.w + KERB）。
 *  原先全按 w/2 算，楼只退到沥青一半就停手：实测 16 栋实体的底圈压在铺装带上
 *  （library/bank/shrine 整圈 100%，站房 86%），门面插进街心正是「后插入模型块」。
 *  底线取「沥青 + 路缘 + 墙前站人」——墙线压着人行道外沿正是日本商店街的样子。
 *  口径与打包器共用 frontage.laneDepth，别让认街和装箱互相拉扯。
 *  这是「尽量达成」的舒适线，只对正对的那条街要求；背街与街区中央由 asphaltSlack 兜底。 */
function laneNeed(s, rd) {
  if (!s.isSolid) return rd.w + KERB + SIDEWALK_W * 0.55;      // 街具站在人行道上
  return laneDepth(rd, s.foot ? s.foot.hz : s.padR || 0.4);
}

/** 街区放不下就把楼缩到放得下（只缩平面，保住层高）。
 *  这是让位阶梯的最后一级：挪 → 斜挪 → 缩。修好 measureFoot 把旗杆/门柱算进占地之后，
 *  当前这批数据里已经用不到它（stats.shrunk = 0，最胖的校舎体量 8.3×4.1 也放得进 12m 街区），
 *  留着是给往后的城市表兜底：宁可缩一栋楼，也不能留它骑在行车道上。
 *  measureFoot 取的是 group 本地坐标（inv(matrixWorld)），所以缩放不会自动反映到
 *  s.foot/s.pad/s.padR —— 必须手动同步，否则碰撞圈、地基、门窗挂载全按旧体量走。 */
function shrinkSite(s, k) {
  s.g.scale.set(s.g.scale.x * k, s.g.scale.y, s.g.scale.z * k);
  const f = s.foot;
  // 只压 x/z：local y 是「当地向上」（basisAt 把 Y 转到径向），压层高会把两层校舎缩成棚屋
  if (f) s.foot = { hx: f.hx * k, hz: f.hz * k, corner: f.corner * k, minY: f.minY, top: f.top };
  const pad = Math.max((s.pad || 0) * k, s.yd ? s.yd.r : 0);   // 地坪仍按原半径铺，压平盘不能比它小
  s.pad = pad;
  s.padR = pad || 0.4;
  s.shrunk = +k.toFixed(2);
}

/** 街廊里的东西一律腾出行车道。城市表是在「路只是地面贴皮」的平面上写的：
 *  站房 (0,-16) 正好压在南北主街的街心上，搬到球面上就是玩家走到街口被一栋楼堵住。
 *  这条规矩对「fixed」的城市锚点同样生效——认街可以免，堵住行车道不行。
 *  找位阶梯照用户给的修法顺序走：原地合规 → 沿法线让 → 斜着让（路口转角） → 缩体量。 */
function unblockStreets(frame, sites, planet, trace) {
  const note = (s, p, rd, why) => trace && trace.push({ kind: s.o.kind, at: [+p.x.toFixed(1), +p.z.toFixed(1)], d: +p.d.toFixed(2), road: rd.name, why });
  const MIN = 0.12;             // 底圈离路缘石的最小余量
  let moved = 0, shrunk = 0;
  for (const s of sites) {
    if (PARKED.has(s.o.kind) || NO_FRONTAGE.has(s.o.kind)) continue;
    const p = frame.dirToPlan(s.dir);
    if (Math.abs(p.x) > TOWN_RECT.xT + 6 || Math.abs(p.z) > TOWN_RECT.zT + 6) continue;
    const { d, rd, t } = roadDistance(frame, p.x, p.z);
    p.d = d;
    const f = s.foot || { hx: 0.4, hz: 0.4 };
    const dx = rd.x2 - rd.x1, dz = rd.z2 - rd.z1, L = Math.hypot(dx, dz) || 1;
    const [nx, nz] = roadLat(rd);
    const cx0 = rd.x1 + dx * t, cz0 = rd.z1 + dz * t;         // 街心上的最近点
    const side = ((p.x - cx0) * nx + (p.z - cz0) * nz) >= 0 ? 1 : -1;
    const lat = Math.abs(((p.x - cx0) * nx + (p.z - cz0) * nz));
    // 让位是「真实米数」的活：退线/顺街都得走切平面（见 planK / roadDirs）
    const [ra, rb, ta, tb] = roadDirs(frame, cx0, cz0, dx / L, dz / L);
    // yaw 一律用「度」：s.yaw 本来就是度，只有正墙朝街时才算的是弧度，要换算
    const yawOf = (sg) => (s.isSolid ? Math.atan2(-ta * sg, -tb * sg) * 57.2958 : (s.yaw || 0));
    // 落点还得相对「下一条」街站得住：南环与住宅区街只隔 9 m，让开一条就踩上另一条
    const fits = (k, sg, want, slide) => {
      const [fx, fz] = tan2plan(frame, cx0, cz0, ta * sg * want + ra * slide, tb * sg * want + rb * slide);
      if (!frame.inBand(fx, fz)) return null;
      if (planet) {
        const [bx, by] = frame.planToPx(fx, fz);
        if (planet.field.heightAt(bx, by) < planet.waterRadius + 0.3) return null;
      }
      if (asphaltSlack(frame, f.hx * k, f.hz * k, yawOf(sg), fx, fz) < MIN) return null;
      return { fx, fz, sg };
    };
    if (fits(1, side, lat, 0)) continue;   // 底圈本来就没碰沥青
    let q = null, kk = 1;
    const seek = (k, diag) => {
      for (const sg of [side, -side]) {
        for (let w = lat + 0.4; w <= lat + 14; w += 0.4) {
          q = fits(k, sg, w, 0);
          if (q) return true;
        }
      }
      if (!diag) return false;
      // 路口转角：两条街的铺装带在角上重叠，只沿一条法线挪永远踩上另一条（实测 9 件街具卡死）
      for (const sg of [side, -side]) {
        for (let sl = -6; sl <= 6; sl += 0.6) {
          for (let w = 0.4; w <= 12; w += 0.4) {
            q = fits(k, sg, w, sl);
            if (q) return true;
          }
        }
      }
      return false;
    };
    // 缩体量之前先把斜位找满；缩的时候也要允许斜挪（转角地块缩了才站得进去）
    if (!seek(1, true) && s.isSolid) {
      for (let k = 0.9; k >= 0.5; k -= 0.05) { if (seek(k, true)) { kk = k; break; } }
    }
    if (!q) { note(s, p, rd, 'noGap'); continue; }
    if (kk < 1) { shrinkSite(s, kk); shrunk++; note(s, p, rd, 'shrunk@' + kk.toFixed(2)); }
    s.dir.copy(frame.planToDir(q.fx, q.fz));
    s.home.copy(s.dir);
    s.unblocked = true;
    if (s.isSolid) s.yaw = Math.atan2(-ta * q.sg, -tb * q.sg) * 57.2958;   // 让出去之后正墙仍然朝街
    moved++;
  }
  return { moved, shrunk };
}

/** 成型后的地表上挑落脚点：出生点给自己压了块坪，街也在坪面上过，
 *  这时再量一次坡度才知道玩家脚下到底平不平（选点阶段量的是天然地形）。 */
function finalStand(planet, spawnPx, avoid) {
  const Rm = planet.GROUND_R;
  const score = (cd) => {
    for (const a of avoid) if (cd.angleTo(a.dir) * Rm < a.r) return null;
    const [cx, cy] = pxFromDir(cd);
    if (planet.field.heightAt(cx, cy) < planet.waterRadius + 1.2) return null;
    return planet.field.slopeAt(cx, cy);
  };
  const o = dirFromPx(spawnPx[0], spawnPx[1]).normalize();
  let u = new THREE.Vector3(0, 0, 1).cross(o);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(o);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(o, u).normalize();
  const s0 = score(o);
  let best = { dir: o, cost: s0 === null ? Infinity : s0 };
  for (let a = 0; a < 12; a++) {
    const th = (a / 12) * Math.PI * 2;
    for (const rr of [1.2, 2.4]) {                          // 只在出生坪内挪，别走出街口
      const cd = o.clone().addScaledVector(u, Math.cos(th) * rr / Rm).addScaledVector(v, Math.sin(th) * rr / Rm).normalize();
      const s = score(cd);
      if (s === null) continue;
      const cost = s + rr * 0.5;                  // 平优先，一样平就挪得近的
      if (cost < best.cost) best = { dir: cd, cost };
    }
  }
  return pxFromDir(best.dir);
}

/** 原版出生点：planet.json 的 spawn 若能打在陆地上就照用；
 *  打空或落进海里就退回 Godot 新档的那条规矩——站到便利店门口两米多（street.gd 的
 *  `_teleport_to_kind('konbini')`），因为原版的 [0,2756] 压在世界边界、射线常打空。 */
function originalSpawn(planet, authored, live) {
  const dry = (px, py) => {
    const h = planet.surfaceAt(dirFromPx(px, py));
    return h.hit && h.pos.length() > planet.waterRadius + 0.6 ? [px, py] : null;
  };
  const a = authored || [0, 2756];
  const atAuthored = dry(a[0], a[1]);
  if (atAuthored) return atAuthored;
  for (const s of live) {
    if (s.o.kind !== 'konbini') continue;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(basisAt(s.dir, s.yaw || 0));
    const inFront = s.dir.clone().addScaledVector(fwd, 2.2 / planet.GROUND_R).normalize();
    const found = dry(...pxFromDir(inFront)) || dry(...pxFromDir(s.dir));
    if (found) return found;
  }
  return a;
}

// ---------- 并图：两张手写地图接成一张 ----------
// 手写城市（layout.js → cityPlan.js，179 条）的足迹是 |x|≤25、|z|≤24 那一整块街网核心；
// 原版岛（planet.json，245 条）最密的一段正好压在同一块上（实测 56 条落在核心内）。
// 直接 concat 会得到并排的两座駅/银行/医院、穿模的店行——玩家一眼看出是两张图叠起来的。
// 所以并图要先分地盤：核心内的原版落点沿「从广场出发过该点」的射线整体外迁到环镇路一带，
// 相对方位不变（原来在西北的还是西北），只是让出核心块；核心外的一条都不动。
// 两张手写图谁也不覆盖谁，245 + 179 全保。
const CITY_CORE = { xT: 25, zT: 24 };
// 「一镇一次」的市政设施让位更远，落到郊外去自成一处集落，而不是在隔壁街区再立一座駅
const LANDMARK_KINDS = new Set(['station', 'bank', 'school', 'hospital', 'police', 'library',
  'super', 'post_office', 'temple', 'konbini', 'mansion']);
// 避让用的名义半径： buildings.js finish() 里登记的 r，小件统一 0.9
const KIND_R = {
  station: 5.4, konbini: 3.8, house: 2.6, mansion: 3.4, super: 5, cafe: 3.4, ramen: 3.2,
  post_office: 3.8, temple: 3.6, school: 4.6, hospital: 3.6, bank: 3.4, library: 3.6, police: 5,
};
const kindR = (k) => KIND_R[k] || (SOLID_KINDS.has(k) ? 3 : 0.9);
// 小地图/大地图要钉住的地标（与 game/map.js 的 LANDMARKS 同一份 kind 名单）
const MAP_PIN_KINDS = new Set(['station', 'cafe', 'temple', 'police', 'hospital', 'ramen',
  'konbini', 'bank', 'super', 'library', 'school', 'post_office']);

/** 沿射线把核心内的原版落点推到核心外：躲城市楼、躲镇芯、躲行车道，一次搜完 */
function ejectFromCore(frame, p, kind, taken) {
  const r = kindR(kind);
  let ux = p.x, uz = p.z;
  if (Math.hypot(ux, uz) < 1.2) {          // 正站在广场心上的：按 kind 派一个方位，别挤在同一条射线
    const a = (kind.charCodeAt(0) % 8) * Math.PI / 4;
    ux = Math.cos(a); uz = Math.sin(a);
  }
  const L = Math.hypot(ux, uz);
  ux /= L; uz /= L;
  const freeAt = (x, z, avoidTaken) => {
    if (Math.abs(x) <= CITY_CORE.xT + 2.5 && Math.abs(z) <= CITY_CORE.zT + 2.5) return false;
    if (!frame.inBand(x, z)) return false;
    if (Math.abs(x) > TOWN_RECT.xT + 8 || Math.abs(z) > TOWN_RECT.zT + 6) return false;
    // 外迁的落点自己也不能正好甩进行车道：原版图书馆就被甩到住宅区街街心上
    const nr = roadDistance(frame, x, z);
    if (nr.d < nr.rd.w + SIDEWALK_W + r * 0.55) return false;
    if (avoidTaken && taken.some((t) => Math.hypot(x - t.x, z - t.z) < r + t.r + 1.4)) return false;
    return true;
  };
  const start = Math.max(Math.abs(p.x), Math.abs(p.z));
  const lead = LANDMARK_KINDS.has(kind) ? 13 : 3.5;
  const walk = (uxx, uzz, d0, avoidTaken) => {
    for (let d = d0; d < 150; d += 1.5) {
      const x = uxx * d, z = uzz * d;
      if (Math.abs(x) > TOWN_RECT.xT + 8 || Math.abs(z) > TOWN_RECT.zT + 6) return null;  // 甩出镇界太远就不硬塞
      if (freeAt(x, z, avoidTaken)) return { x, z };
    }
    return null;
  };
  const sweep = (avoidTaken) => {
    const q = walk(ux, uz, start + lead, avoidTaken);
    if (q) return q;
    // 作者那条射线整条都被城市楼占着（实测 17 条）：换个方位照样能出核心，
    // 比把第二座银行留在站前广场心上当场穿模强。
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const q2 = walk(Math.cos(ang), Math.sin(ang), CITY_CORE.xT + lead, avoidTaken);
      if (q2) return q2;
    }
    return null;
  };
  // 宁可和别的让位者挨着，也不把第二座银行留在镇芯原地穿模：taken 是最后一道才松的约束。
  return sweep(true) || sweep(false);
}

/** 并图后要让街的少数城市锚点（plan 米增量）。站房是唯一一个：layout.js 把它写在
 *  (0,-16)，那张表的口径是「路只是地面贴皮」，南北主街直接从站房中间穿过去。
 *  北移 1.5m 让出前坪（主街同步收口在商店街路口），楼还是那栋楼、门还是朝着广场。 */
const CITY_RESEAT = { station: [0, -1.5] };

/** 合并两张落点表：城市条目 plan 米 → 地图像素，原版条目按上面的规矩让位 */
function mergeCityObjects(frame, orig, city) {
  const out = [];
  const taken = [];
  let offBand = 0;
  for (const c of city) {
    const dlt = CITY_RESEAT[c.kind];
    const x = c.plan[0] + (dlt ? dlt[0] : 0), z = c.plan[1] + (dlt ? dlt[1] : 0);
    if (!frame.inBand(x, z)) { offBand++; continue; }   // 北弧森林环压在经线收口处，出了可玩带
    const [px, py] = frame.planToPx(x, z);
    const o = { kind: c.kind, word: c.word, x: px, y: py, rot: c.yaw || 0, from: 'city' };
    if (c.npc) o.npc = c.npc;
    if (c.v !== undefined) o.v = c.v;
    if (c.forest) o.forest = 1;
    out.push(o);
    if (!c.forest) taken.push({ x, z, r: kindR(c.kind) });
  }
  let ejected = 0, stuck = 0;
  for (const e of orig) {
    const p = frame.dirToPlan(dirFromPx(e.x, e.y));
    if (Math.abs(p.x) > CITY_CORE.xT || Math.abs(p.z) > CITY_CORE.zT) { out.push(e); continue; }
    const q = ejectFromCore(frame, p, e.kind, taken);
    if (q) {
      const [px, py] = frame.planToPx(q.x, q.z);
      out.push({ ...e, x: px, y: py, from: 'island-out' });
      taken.push({ x: q.x, z: q.z, r: kindR(e.kind) });
      ejected++;
    } else {
      out.push(e);
      stuck++;
    }
  }
  return { objects: out, ejected, stuck, offBand, city: city.length };
}

/** 每种实体各建一次模型，量出真实体量给装箱器用。
 *  构建器的平面尺寸是确定的（buildHouse 只按 seed 换 HOUSE_SETS 的四套墙瓦，
 *  不改 3.2×3.0 的体量），所以一次量完全镇通用；补楼另有一档平面缩放，
 *  在 scaleSite 里乘回 foot/pad（measureFoot 走 group 本地坐标，g.scale 不进体量）。 */
const FEET_PROBE = {};
function probeFeet() {
  for (const k of SOLID_KINDS) {
    if (FEET_PROBE[k] || !BUILDERS[k]) continue;
    FEET_PROBE[k] = measureFoot(BUILDERS[k]('probe-' + k, { kind: k }), true);
  }
  return FEET_PROBE;
}

/** 补楼的平面缩放：只缩 x/z、保住层高，体量与地基跟着同一档走 */
function scaleSite(s, k) {
  s.g.scale.set(k, 1, k);
  const f = s.foot;
  s.foot = { hx: f.hx * k, hz: f.hz * k, corner: f.corner * k, minY: f.minY, top: f.top };
  s.pad = (s.pad || 0) * k;
  s.padR = s.pad || 0.4;
  s.sc = k;
}

export async function buildTownFromPlanetJson(scene, planet) {
  const surfaceAt = planet.surfaceAt;
  const frame = planet.planFrame;          // plan(米) ↔ 球面：整套手写街网共用它
  await preloadProps(); // 现成模型（车/电杆/NPC…）先就位，构建器里同步克隆
  const data = planet.plan || await fetch('./planet/planet.json').then((r) => r.json());
  // ---------- 0) 三张手写图并成一张 ----------
  // 原版岛直通(?island=raw|intro)不并：那条路要的就是「作者坐标一个都不动」的对照。
  const RAW = !!planet.raw;
  const merge = RAW ? { objects: data.objects || [], ejected: 0, stuck: 0, offBand: 0, city: 0 }
    : mergeCityObjects(frame, data.objects || [], CITY_OBJECTS);
  const objects = merge.objects;

  // ---------- 0b) 紧凑化：照街网重排落点 + 沿空闲退线补楼 ----------
  // 为什么排在建模型之前：装箱要的是「每栋的门面宽度」，而量体量要建模型——
  // 所以先用 probeFeet 每种实体各建一次拿到真实宽度，排完把新位置写回条目、
  // 把补出来的楼追加进表。下游（建模型/认街/让路/压地基/落座）一律按新位置走，一个都不用改。
  // ?compact=0 关掉这一步，用来和老图并排比截图。
  const COMPACT = !RAW && new URLSearchParams(location.search).get('compact') !== '0';
  let pack = null;
  if (COMPACT) {
    const r = compactTown({
      frame, objects, feet: probeFeet(), solidKinds: SOLID_KINDS,
      skipKinds: new Set([...NO_FRONTAGE, ...PARKED]), cfg: PACK_CFG,
    });
    for (const m of r.moves) {
      const [px, py] = frame.planToPx(m.x, m.z);
      m.obj.x = px; m.obj.y = py; m.obj.rot = m.yaw; m.obj.packed = 1;
      if (m.sc && m.sc !== 1) m.obj.sc = m.sc;   // 排不进去才缩档，缩的量在 scaleSite 里乘回体量
    }
    for (const a of r.added) {
      const [px, py] = frame.planToPx(a.x, a.z);
      objects.push({ kind: a.kind, x: px, y: py, rot: a.yaw, sc: a.sc, from: 'infill', packed: 1 });
    }
    pack = r.info;
  }

  const town = new THREE.Group();
  scene.add(town);
  const interactables = [];
  const colliders = [];
  const ticks = [];
  const buildingBoxes = [];
  let placed = 0, skipped = 0, nudged = 0, attached = 0;
  const stats = {
    total: objects.length, noBuilder: 0, noHit: 0, inWater: 0, tooSteep: 0,
    yards: 0, yardsSkipped: 0, pads: 0, flattened: 0, attachLost: 0, slopePads: 0, reseated: 0, roadTiles: 0, frontage: 0, streetClear: 0, shrunk: 0, crosswalks: 0, plaza: 0, steep: [],
    merge: { city: merge.city, island: (data.objects || []).length, ejected: merge.ejected, stuck: merge.stuck, offBand: merge.offBand },
    pack, metrics: null,
  };
  const noBuilderKinds = {};

  // ---------- 1) 先把模型建出来并量出真实占地 ----------
  // 建筑既不能只「贴」在起伏地面上（墙脚一半悬空一半陷进去），也不能彼此穿模，
  // 所以顺序是：建模型 → 量体量 → 球面松弛 → 压地基 → 重建地面 → 最后摆放。
  const sites = [];
  const attachQueue = [];
  for (const [i, o] of objects.entries()) {
    if (ATTACH[o.kind]) { attachQueue.push({ i, o }); continue; }
    const make = BUILDERS[o.kind];
    if (!make) { skipped++; stats.noBuilder++; noBuilderKinds[o.kind] = (noBuilderKinds[o.kind] || 0) + 1; continue; }
    const g = make(String(i), o);
    const isSolid = SOLID_KINDS.has(o.kind);
    const foot = measureFoot(g, isSolid);
    const cls = isSolid ? 0 : (HARD_KINDS.has(o.kind) ? 1 : 2);
    const yd = YARDS[o.kind];
    // 地基不能比广场小：圆盘一旦出界，外圈采样到自然地形就又被判「不平整」而整块不铺
    const pad = isSolid ? Math.max(foot.corner + PAD_GAP, yd ? yd.r : 0)
      : yd ? yd.r
        : (cls === 1 && foot.corner >= 0.9 ? foot.corner + 0.35 : 0);
    const dir = dirFromPx(o.x, o.y);
    const site = { i, o, g, foot, isSolid, cls, yd, pad, padR: pad || 0.4, dir, home: dir.clone(), yaw: o.rot || 0,
      // packed = 装箱器已经把它摆在退线上定稿了：和手写城锚点同等待遇（认街免、松弛免动、
      // 让路仍要过），下游再把它推一把就等于把刚排好的店行打回散点。
      fixed: o.from === 'city' || !!o.packed };
    if (o.sc) scaleSite(site, o.sc);
    sites.push(site);
  }
  // 先认街，再松弛：顺序反了的话 relax 把楼从街面上推回野地，街道格局就白排了
  // 原版岛模式(?island=raw|intro)不走这套：street.gd 的 `_place_on_planet` 就是
  // 「作者像素坐标 → 球面方向 → 对真实网格打射线 → 落座」，一个坐标都不改。
  let relaxPass = 0, roadInfo = { laid: 0, metres: 0, main: 0 }, spawnPx = null, standPx = null;
  if (!RAW) {
    stats.frontage = frontOntoStreets(frame, sites);
    relaxPass = relaxSites(sites);
  }

  // ---------- 2a) 落点复核：掉海的退回，陡坡的先挪到平地 ----------
  const live = [];
  if (!RAW) {
  for (const s of sites) {
    let [px, py] = pxFromDir(s.dir);
    if (planet.field.heightAt(px, py) < planet.waterRadius + 0.3) {
      let ok = false;
      for (const t of [0.25, 0.5, 0.75, 1]) {                 // 沿原路退回找一块陆地
        const d = s.dir.clone().lerp(s.home, t).normalize();
        [px, py] = pxFromDir(d);
        if (planet.field.heightAt(px, py) >= planet.waterRadius + 0.3) { s.dir.copy(d); ok = true; break; }
      }
      if (!ok) { skipped++; stats.inWater++; continue; }
    }
    if (s.cls <= 1) {
      let sl = planet.field.slopeAt(px, py);
      if (sl > 20) {
        // 挪位置优先于把建筑硬塞进陡坡（塞进去就是一半墙脚悬空）
        const up = s.dir;
        let u = new THREE.Vector3(0, 0, 1).cross(up);
        if (u.lengthSq() < 1e-6) u = new THREE.Vector3(1, 0, 0).cross(up);
        u.normalize();
        const v = new THREE.Vector3().crossVectors(up, u).normalize();
        const cand = new THREE.Vector3();
        let best = { d: up.clone(), sl };
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2;
          for (const rr of [2, 3.5, 5]) {
            cand.copy(up).addScaledVector(u, Math.cos(ang) * rr / R).addScaledVector(v, Math.sin(ang) * rr / R).normalize();
            const [cx, cy] = pxFromDir(cand);
            if (planet.field.heightAt(cx, cy) < planet.waterRadius + 0.3) continue;
            const csl = planet.field.slopeAt(cx, cy);
            if (csl < best.sl) best = { d: cand.clone(), sl: csl };
          }
        }
        if (best.sl < sl) { s.dir.copy(best.d); sl = best.sl; stats.flattened++; }
      }
      if (s.isSolid && sl > 30) { skipped++; stats.tooSteep++; continue; }
    }
    live.push(s);
  }

  // 松弛与「躲陡坡」都会把落点推回路廊里，所以让路必须排在落点定稿之后、压路床之前：
  // 顺序反了就是 library@南环、streetlight@住宅区街 这类「楼压在行车道上」。
  const unblockTrace = [];
  const cleared = unblockStreets(frame, live, planet, unblockTrace);
  stats.streetClear = cleared.moved;
  stats.shrunk = cleared.shrunk;
  stats.blocked = unblockTrace.slice(0, 14);

  // ---------- 2b) 街网路床：位置定稿之后统一压平，出生点就站在站前广场上 ----------
  // 原版 layout.js 把出生点定在车站前的小广场，这条规矩比 planet.json 那个
  // 贴着世界边界、压在 45° 褶子上的 [0,2756] 靠谱得多：一睁眼是铺好的广场和两条主街。
  spawnPx = frame.planToPx(PLAZA.x, PLAZA.z);
  roadInfo = layStreets(planet, frame);

  // ---------- 2c) 没认街的野道具让开路，然后统一压地基 ----------
  for (const s of live) {
    let [px, py] = pxFromDir(s.dir);
    if (!s.isSolid && !s.fronted && s.o.kind !== 'fountain') {
      // 整条街廊（沥青 + 人行道 + 半米路肩）都要腾出来：树长在行车道上是最常见的「后插入」观感
      const need = (w) => w + SIDEWALK_W + 0.5 + (s.padR || 0.4);
      const h0 = surfaceAt(s.dir);
      const onRoad = (dd, hh) => {
        const q = frame.dirToPlan(dd);
        const nr = roadDistance(frame, q.x, q.z);
        return nr.d < need(nr.rd.w) || roadHit(hh);
      };
      if (onRoad(s.dir, h0)) {
        const q0 = frame.dirToPlan(s.dir);
        const maxD = need(roadDistance(frame, q0.x, q0.z).rd.w) + 1.2;
        const nud = h0.hit && nudgeOffRoad(surfaceAt, h0, planet.waterRadius, onRoad, maxD);
        if (nud) { s.dir.copy(nud.dir); [px, py] = pxFromDir(s.dir); nudged++; }
      }
    }
    const sl0 = planet.field.slopeAt(px, py);
    if (sl0 > 20 && stats.steep.length < 40) stats.steep.push([s.o.kind, Math.round(px), Math.round(py), +s.pad.toFixed(2), Math.round(sl0), s.cls]);
    if (!s.pad) {
      // 占地再小也怕陡坡：电线杆、自动售货机、垃圾桶压在 45° 坡上，
      // 底圈一半埋进地里一半悬空，读起来就是「后插进来的道具」。
      if (sl0 > 16) { s.pad = Math.max(0.75, s.foot.corner + 0.3); s.padR = s.pad; stats.slopePads++; }
    }
    if (s.pad > 0) {
      planet.field.levelDisc(px, py, s.pad);
      stats.pads++;
    }
  }
  planet.rebuildGround();
  // 落脚点要按烘完的地表再定一次：选点阶段量的是天然地形，坪与街压完才有真脚下
  standPx = finalStand(planet, spawnPx, live.filter((s) => s.isSolid).map((s) => ({ dir: s.dir, r: (s.pad || 1.2) + 0.8 })));
  stats.spawn = {
    authored: data.spawn, nominal: spawnPx.map(Math.round), stand: standPx.map(Math.round),
    standSlope: +planet.field.slopeAt(standPx[0], standPx[1]).toFixed(1),
  };
  } else {
    // ---------- 原版岛直通：245 个作者坐标一个都不动 ----------
    // 落座/让位/陡坡挪动全交给步骤 3，那里量的就是真实壳面射线。
    for (const s of sites) live.push(s);
    spawnPx = originalSpawn(planet, data.spawn, live);
    standPx = spawnPx;
    stats.spawn = { authored: data.spawn, stand: spawnPx.map(Math.round), mode: planet.raw };
  }

  // ---------- 2d) 街面铺装：地面烘完之后再铺，条带才跟得住坪沿与街口的台阶 ----------
  // 路床在 2b 就压好了，烘的是玩法射线唯一会碰的那张地面网格，所以「看到的街」和
  // 「踩到的街」是同一条走廊；这里的沥青条带只是穿在最上面的一层可辨认铺装。
  if (!RAW) {
    let cwOk = 0;
    for (const [ri, rd] of ROADS.entries()) {
      const mat = M(0xffffff, { rough: 0.95, map: roadTexture(rd.w) });
      mat.userData.mseKeep = true;
      mat.polygonOffset = true;              // 广场地坪压过街面一档，交界处不闪面
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = -1;
      const mesh = streetMesh(surfaceAt, frame, rd, mat, { myIdx: ri });
      if (mesh) { town.add(mesh); stats.roadTiles++; }
    }
    const wmat = M(PLAN_C.line, { rough: 0.85, doubleSided: true });
    wmat.userData.mseKeep = true;
    wmat.polygonOffset = true;               // 斑马线在沥青条带之上，得赢过它的 -1
    wmat.polygonOffsetFactor = -3;
    wmat.polygonOffsetUnits = -3;
    for (const cw of CROSSWALKS) {
      const mesh = crosswalkMesh(surfaceAt, frame, cw, wmat);
      if (mesh) { town.add(mesh); cwOk++; }
    }
    stats.crosswalks = cwOk;

    // 站前广场：主街从中间穿过，看得见的是环在路口外圈的那圈地坪
    // 1.6 m/块时鹅卵石单颗到 0.28 m，俯视就是一地白斑；收到 1.15 m 和站前地坪同口径
    const rep = (PLAZA.r * 2) / 1.15;
    const pmap = handTex('cobble').clone(); pmap.needsUpdate = true; pmap.repeat.set(rep, rep);
    // tintFor：cobble 是白底纹路图，均值只有 0.46 线性，直接乘会把设计色压掉一半多
    const pmat = M(tintFor(PLAN_C.plaza, pmap), { rough: 0.8, map: pmap });
    pmat.userData.mseKeep = true;
    const pdir = frame.planToDir(PLAZA.x, PLAZA.z);
    const plaza = yardDisc(surfaceAt, pdir.clone().multiplyScalar(planet.GROUND_R), pdir, PLAZA.r, pmat, { seg: 64, rings: 14 });
    if (plaza) { plaza.userData.plaza = true; town.add(plaza); stats.plaza = 1; } else stats.plaza = 0;
  }

  // ---------- 3) 按成型后的地表摆放 ----------
  // 小地图的地标针脚不能再用 planet.json 的旧像素：并图之后车站是城市那一站，
  // 原版寺庙被外迁到环镇路上。这里按「真正摆下去的位置」重新登记一次。
  const pinCandidates = [];
  const mapBlocks = [];   // 大地图上的建筑轮廓：并图之后「镇子长什么样」得看得见
  for (const s of live) {
    const { o, g, isSolid, foot, yd } = s;
    const hit = surfaceAt(s.dir);
    if (!hit.hit) { skipped++; stats.noHit++; continue; }
    // 海面门槛只归烘场模式管：那套地表是我们自己重烘的，低进海里就是穿帮。
    // 原版岛不判——street.gd 的 `_place_on_planet` 从来没有这道门槛（planet_builder.gd
    // 的注释写了「都要先过 water_radius」，但全项目只有注释里没有实现），猫不许下水是靠
    // walk_phi 软墙拦玩家，不是靠删物件。实测 245 个落点全打得上地形，r 分布 32.0~57.4。
    if (!RAW && hit.pos.length() < planet.waterRadius + 0.3) { skipped++; stats.inWater++; continue; }

    // 让位与地基都在选点阶段定过了，这里只按成型后的地表落座
    let placeDir = s.dir, placeHit = hit;
    // 复核用的是烘完的地表：坪与坪、坪与海岸之间的收口坡度这时才量得到，
    // 小道具挪一两米就能从崖壁上回到台面。建筑不动——坪是照着它的位置压的。
    // 原版岛不挪：道具站在作者标的像素上，坡陡就由步骤 3 末尾的法线倾斜接管。
    if (!isSolid && !RAW) {
      const tl = (dd, hh) => (hh.hit ? Math.acos(Math.min(1, Math.max(-1, hh.normal.dot(dd)))) * 57.2958 : 99);
      const t0 = tl(placeDir, placeHit);
      if (t0 > 18) {
        const up = placeDir.clone().normalize();
        let u = new THREE.Vector3(0, 0, 1).cross(up);
        if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
        u.normalize();
        const v = new THREE.Vector3().crossVectors(up, u).normalize();
        const cand = new THREE.Vector3();
        let best = null;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          for (const rr of [1.2, 2.4]) {
            cand.copy(up).addScaledVector(u, Math.cos(ang) * rr / R).addScaledVector(v, Math.sin(ang) * rr / R).normalize();
            const h2 = surfaceAt(cand);
            if (!h2.hit || h2.pos.length() < planet.waterRadius + 0.3) continue;
            const t2 = tl(cand, h2);
            if (!best || t2 < best.t) best = { dir: cand.clone(), hit: h2, t: t2 };
          }
        }
        if (best && best.t < t0 - 3) {
          placeDir = best.dir; placeHit = best.hit;
          s.dir.copy(best.dir);   // 写回落点表：街廊终检量的是 s.dir，不写回就是把「站在行车道上的道具」漏报成合规
          stats.reseated++;
        }
      }
    }

    let r = placeHit.pos.length();
    if (!s.pad) {
      const st = settleRadius(surfaceAt, placeDir, foot.corner);
      if (st !== null) r = st;
    }
    g.position.copy(placeDir).multiplyScalar(r).addScaledVector(placeDir, -0.03 - foot.minY);
    // planet.json 的 rot 一直在用，但街前认领之后朝向归街网：正墙朝街、车头顺街
    const q0 = basisAt(placeDir, s.yaw || 0);
    if (RAW) {
      // 原版口径（street.gd `_place_on_planet`）：法线与「当地径向」夹角不到 37°(dot>0.8)
      // 就跟着地面倾斜；比这更陡的崖壁宁可直立插进坡里，也不整栋躺倒。
      // 基准必须是命中点的径向而不是 placeDir——真实壳面不是理想球，比 dir 会系统性压低 dot。
      const radial = placeHit.pos.clone().normalize();
      const tilt = placeHit.normal.dot(radial);
      if (tilt > 0.8 && tilt < 0.9995) q0.premultiply(new THREE.Quaternion().setFromUnitVectors(radial, placeHit.normal));
    }
    g.quaternion.copy(q0);
    if (o.flip) g.rotateY(Math.PI);
    town.add(g);
    placed++;
    if (isSolid) s.placed = true;
    if (MAP_PIN_KINDS.has(o.kind)) {
      pinCandidates.push({ kind: o.kind, dir: placeDir.clone(), city: s.o.from === 'city' });
    }
    if (isSolid) {
      const bl = frame.dirToPlan(placeDir);
      mapBlocks.push({ x: bl.x, z: bl.z, hx: foot.hx, hz: foot.hz, yaw: planYawDeg(frame, bl.x, bl.z, s.yaw || 0) });
    }

    // 手绘地坪（视觉件，不参与碰撞/射线）；地面不平整时 yardDisc 返回 null 不铺
    if (yd) {
      stats.yards++;
      // 地坪是圆、街是带：圆不裁就会盖住行车道，斑马线白条直接压在石畳上
      // （实测 topdown-station3.png 站前那块）。按「离最近街铺装外沿的余量」收半径。
      const yl = frame.dirToPlan(placeDir);
      const yrd = roadDistance(frame, yl.x, yl.z);
      const rr = Math.max(2.2, Math.min(yd.r, yrd.d - (yrd.rd.w + SIDEWALK_W) - 0.5));
      const rep = (rr * 2) / yd.tile;
      // clone 共享纹理设置各自 repeat，不影响其他使用处
      const map = handTex(yd.hand).clone(); map.needsUpdate = true; map.repeat.set(rep, rep);
      const rmap = handRough(yd.hand).clone(); rmap.needsUpdate = true; rmap.repeat.set(rep, rep);
      const pmat = M(tintFor(yd.base, map), { rough: 0.92, map, roughnessMap: rmap });
      pmat.userData.mseKeep = true; // 铺装本来就靠贴图压色，mse 换装时别再乘 0.62
      pmat.polygonOffset = true; // 贴地圆盘与地形距离近，偏移深度防 z-fight
      pmat.polygonOffsetFactor = -2;
      pmat.polygonOffsetUnits = -2;
      const disc = yardDisc(surfaceAt, g.position, placeDir, rr, pmat, { seg: 48, rings: yd.rings });
      if (disc) town.add(disc); else stats.yardsSkipped++;
    }

    const meta = g.userData.meta || {};
    // 词优先用 planet.json 里登记的 id，其次用构建器默认
    const wordId = o.word || meta.word;
    const w = wordById(wordId);
    if (w) {
      interactables.push({
        group: g, meta: { ...meta, word: wordId, ja: w.ja },
        worldPos: g.position.clone().addScaledVector(placeDir, Math.max(0.8, foot.top * 0.5)),
        radius: (meta.r || 1.4) + 1.4,
      });
    }
    if (isSolid) {
      // 碰撞圈取包围盒半对角再收一点：只按半宽会在斜角让猫穿进墙里
      // （猫半径 0.35 在 controller 里另加）
      const cr = foot.corner * 0.86;
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      box.expandByScalar(0.1);
      buildingBoxes.push(box);
      colliders.push({ n: placeDir.clone().normalize(), r: cr, box });
    }
    if (g.userData.tick) ticks.push(g.userData.tick);
  }

  // ---------- 4) 门/窗贴到宿主建筑的正墙上（跟着建筑一起被松弛与翻转） ----------
  for (const a of attachQueue) {
    const o = a.o;
    const from = dirFromPx(o.x, o.y);
    let best = null, bestA = Infinity;
    for (const s of live) {
      if (!s.placed || s.o.kind !== o.host) continue;
      const ang = s.dir.angleTo(from);
      if (ang < bestA) { bestA = ang; best = s; }
    }
    if (!best || bestA * R > 40) { skipped++; stats.attachLost++; continue; }
    const g = ATTACH[o.kind](String(a.i), o);
    const local = new THREE.Vector3(o.dx || 0,
      o.kind === 'window' ? THREE.MathUtils.clamp(best.foot.top * 0.42, 1.3, 2.3) : 0,
      best.foot.hz + 0.04);
    g.quaternion.copy(best.g.quaternion);
    g.position.copy(best.g.position).add(local.applyQuaternion(best.g.quaternion));
    g.userData.attached = true;   // 上墙构件：地图体检按地面物件量它会一律报「浮空」
    town.add(g);
    placed++; attached++;
    const meta = g.userData.meta || {};
    const wordId = o.word || meta.word;
    const w = wordById(wordId);
    if (w) {
      interactables.push({
        group: g, meta: { ...meta, word: wordId, ja: w.ja },
        worldPos: g.position.clone().addScaledVector(best.dir, 1.0),
        radius: (meta.r || 1.0) + 1.4,
      });
    }
  }

  // 窄巷疏通：相邻建筑碰撞圈叠死时双向收缩，留出一只猫能过的缝（直径余量 0.7m）
  const GAP = 0.7;
  for (let a = 0; a < colliders.length; a++) {
    for (let b = a + 1; b < colliders.length; b++) {
      const ca = colliders[a], cb = colliders[b];
      const chord = ca.n.angleTo(cb.n) * R;
      if (chord < ca.r + cb.r + GAP) {
        const half = Math.max(0.9, (chord - GAP) / 2);
        ca.r = Math.min(ca.r, half);
        cb.r = Math.min(cb.r, half);
      }
    }
  }

  // 地标针脚：同名有两份（城市镇芯 + 原版外迁）时钉镇芯那份，其余取离广场近的
  const pins = [];
  for (const c of pinCandidates) {
    const p = frame.dirToPlan(c.dir);
    const [d, px, py] = [Math.hypot(p.x - PLAZA.x, p.z - PLAZA.z), ...pxFromDir(c.dir)];
    const cur = pins.find((q) => q.kind === c.kind);
    if (cur && (cur.city || !c.city) && cur.d <= d) continue;
    const pin = { kind: c.kind, px: [px, py], d, city: c.city };
    if (cur) pins[pins.indexOf(cur)] = pin; else pins.push(pin);
  }
  stats.mapPins = pins.map((q) => ({ kind: q.kind, px: q.px, city: q.city }));
  stats.mapBlocks = mapBlocks;
  // 紧凑化的验收口径：实体栋数、镇界内底圈覆盖率、楼-楼最近邻中位（真实商店街 1~3m）
  stats.metrics = layoutMetrics(mapBlocks, TOWN_RECT);

  // 终检：拿「真正摆下去的位置」再量一次街廊。和 stats.blocked 对得上就是让路本身没让开，
  // 对不上就是后面某一步又把它推回去了——两种病因修法完全不同。
  //
  // 【尺换成真实几何】asphaltSlack 那套「矩形四角 + yaw 旋转」是**摆放期搜索用的廉价近似**，
  // 它默认规划格子是正交直角系。实测并不成立：规划系是等距圆柱经纬网，x = λ·R·sinφ，
  // 沿南北走 1 米规划 x 就白漂 λ·cosφ 米（镇心 0，(-37.7,-18.9) 实测 −1.17）。
  // 于是同一栋 3.2×3.0 的家在镇心量出来正好，在镇缘被剪成 4.85 m 长的平行四边形，
  // 近似报「余 0.18 米合规」而真实角点踩进 环镇西路 行车道 1.43 米。
  // 摆放期现在用 tan2plan 补了这个剪切（planK），终检仍直接量**每个子网格自己的定向包围盒底角**
  // （世界系→规划系），一次遍历同时产出体量违规（laneLeft）和附属件违规（appendages）。
  // 两者之差留在 stats.slackDiff 里当对账：它涨回来说明近似又不成立了。
  stats.laneLeft = [];
  stats.appendages = [];
  stats.dirDrift = [];
  stats.slackDiff = [];
  {
    const wp = new THREE.Vector3(), ctr = new THREE.Vector3();
    const cornerPlan = (o, cx, cy, cz) => {
      o.updateWorldMatrix(true, false);
      wp.set(cx, cy, cz).applyMatrix4(o.matrixWorld).normalize();
      return frame.dirToPlan(wp);
    };
    for (const s of live) {
      if (!s.placed || PARKED.has(s.o.kind) || NO_FRONTAGE.has(s.o.kind)) continue;
      const p = frame.dirToPlan(s.dir);
      if (Math.abs(p.x) > TOWN_RECT.xT + 6 || Math.abs(p.z) > TOWN_RECT.zT + 6) continue;
      s.g.updateMatrixWorld(true);
      // 自证：终检的账要能对得上模型真正坐的地方，不然报 0 也是假绿。
      const gp = s.g.getWorldPosition(new THREE.Vector3()).normalize();
      const drift = s.dir.angleTo(gp);
      if (drift > 0.0015) stats.dirDrift.push({ kind: s.o.kind, deg: +(drift * 57.2958).toFixed(2), dir: [+p.x.toFixed(1), +p.z.toFixed(1)], gp: [+frame.dirToPlan(gp).x.toFixed(1), +frame.dirToPlan(gp).z.toFixed(1)] });
      // g.position = placeDir * (r - 0.03 - foot.minY)，反推出这一站的整地半径
      const groundR = s.g.position.length() + 0.03 + (s.foot ? s.foot.minY : 0);
      let body = null, app = null;
      s.g.traverse((o) => {
        if (!o.isMesh || o.isSprite || o.renderOrder === 2 || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const lb = o.geometry.boundingBox;
        const ex = lb.max.x - lb.min.x, ez = lb.max.z - lb.min.z, ey = lb.max.y - lb.min.y;
        o.updateWorldMatrix(true, false);
        ctr.addVectors(lb.min, lb.max).multiplyScalar(0.5).applyMatrix4(o.matrixWorld);
        if (ctr.length() - ey / 2 > groundR + 0.35) return;   // 挂在墙上的（窗/招牌/檐口）不落地
        const isBody = ex >= 0.6 && ez >= 0.6;
        for (const [cx, cz] of [[lb.min.x, lb.min.z], [lb.max.x, lb.min.z], [lb.min.x, lb.max.z], [lb.max.x, lb.max.z]]) {
          const pp = cornerPlan(o, cx, lb.min.y, cz);
          const r = roadDistance(frame, pp.x, pp.z);
          const v = r.d - (r.rd.w + 0.16);
          const rec = { over: +v.toFixed(2), cornerAt: [+pp.x.toFixed(1), +pp.z.toFixed(1)], road: r.rd.name, part: o.geometry.type, size: [+ex.toFixed(2), +ez.toFixed(2)] };
          if (isBody) { if (!body || v < body.over) body = rec; } else if (v < -0.02 && (!app || v < app.over)) app = rec;
        }
      });
      if (body && body.over < 0) {
        stats.laneLeft.push({ kind: s.o.kind, from: s.o.from || 'island', solid: !!s.isSolid, at: [+p.x.toFixed(1), +p.z.toFixed(1)], over: body.over, cornerAt: body.cornerAt, road: body.road, part: body.part, unblocked: !!s.unblocked, shrunk: s.shrunk || null });
      }
      if (app) stats.appendages.push({ kind: s.o.kind, at: [+p.x.toFixed(1), +p.z.toFixed(1)], ...app });
      // 【对账】廉价近似与真实几何的差：摆放期只有近似可用，所以这个差值要一直看得见，
      // 它决定近似还能不能拿来选点（差得远就得把余量放大再选）。
      if (body && s.isSolid && s.foot) {
        const rule = asphaltSlack(frame, s.foot.hx, s.foot.hz, s.yaw || 0, p.x, p.z);
        if (Math.abs(rule - body.over) > 0.15) {
          stats.slackDiff.push({ kind: s.o.kind, at: [+p.x.toFixed(1), +p.z.toFixed(1)], rule: +rule.toFixed(2), real: body.over, yaw: +((s.yaw || 0) % 360).toFixed(0), foot: [+s.foot.hx.toFixed(2), +s.foot.hz.toFixed(2)], size: body.size, road: body.road });
        }
      }
    }
    stats.laneLeft.sort((a, b) => a.over - b.over);
    stats.appendages.sort((a, b) => a.over - b.over);
    stats.appendages = stats.appendages.slice(0, 24);
    stats.dirDrift = stats.dirDrift.slice(0, 14);
    stats.slackDiff.sort((a, b) => Math.abs(b.rule - b.real) - Math.abs(a.rule - a.real));
    stats.slackDiff = stats.slackDiff.slice(0, 16);
  }

  console.log(`town: ${placed} placed (+${attached} attached), ${skipped} skipped, ${nudged} nudged, frontage ${stats.frontage}, relax ${relaxPass} pass, streets ${roadInfo.laid} (${roadInfo.metres}m, ${roadInfo.main} main), tiles ${stats.roadTiles}, crosswalks ${stats.crosswalks}`, stats, noBuilderKinds);
  return {
    town, interactables, colliders, ticks, buildingBoxes,
    spawnPx: standPx, planetCfg: data.planet,
    stats: { ...stats, placed, nudged, attached, roads: roadInfo, noBuilderKinds },
  };
}
