// 城镇组装：读 planet.json（245 个物件的原版落点），用本地程序化构建器摆放
// 坐标换算与落点全部来自现成数据，不自绘地图
import * as THREE from 'three';
import { dirFromPx, basisAt } from './planetMap.js';
import { PBR } from './materials.js';
import { wordById } from '../game/words.js';
import { preloadProps } from './props.js';
import * as B from './buildings.js';
import * as P from './props.js';

// kind → 构建器（planet.json 的 kind 命名）
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
  school: () => B.buildHouse('sch'),
  hospital: () => B.buildMansion('hosp'),
  bank: () => B.buildPostOffice('bank'),
  police: () => B.buildStation('pol'),
  library: () => B.buildSuper('lib'),

  pole: () => P.buildPole('pl'),
  streetlight: () => P.buildStreetlight('sl'),
  vending: () => P.buildVendingMachine('vm'),
  trash: () => P.buildTrash('tr'),
  mailbox: () => P.buildMailbox('mb'),
  signboard: () => P.buildSignboard('sg', { idx: Math.floor(Math.random() * 6) }),
  parksign: () => P.buildSignboard('pk', { idx: 0 }),
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
  fox: () => P.buildDog('fox'),
  npc: () => P.buildNpc('np', { variant: Math.floor(Math.random() * 5) }),
  delivery: () => P.buildNpc('dl', { variant: Math.floor(Math.random() * 5) }),
};

// 只有建筑族生成碰撞体（道具密度太高，碰撞链会把猫弹飞；猫可以穿过小物件）
const SOLID_KINDS = new Set([
  'station', 'konbini', 'house', 'mansion', 'super', 'cafe', 'ramen',
  'post_office', 'temple', 'school', 'hospital', 'bank', 'police', 'library',
]);
const SPECIAL_COLLIDER_R = { station: 2.6, temple: 3.0 };

// 贴图地坪：建筑周围一圈随地形起伏的铺装圆盘（原版贴图，射线贴地）
const YARDS = {
  station: { tex: 'concrete_pavers', r: 6.5, tile: 2.6, rings: 12 }, // 駅前広場
  temple: { tex: 'pavement', r: 5.5, tile: 2.4, rings: 10 },         // 神社石板庭院
  fountain: { tex: 'pavers_alt', r: 3.4, tile: 1.7, rings: 8 },      // 喷泉砖面
};

/** 随地形起伏的圆盘：极坐标网格逐点射线取地表(+lift)，smooth 法线。
 *  岛面起伏极大（悬崖/红砂石构造），先测平整度：采样半径极差 > flatTol 就返回 null 不铺 */
function yardDisc(surfaceAt, center, normal, radius, mat, { seg = 48, rings = 12, lift = 0.035, flatTol = 0.9 } = {}) {
  const up = normal.clone().normalize();
  let u = new THREE.Vector3(0, 0, 1).cross(up);
  if (u.lengthSq() < 1e-6) u = new THREE.Vector3(1, 0, 0).cross(up);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(up, u).normalize();
  const pos = [], uvs = [], idx = [];
  const dir = new THREE.Vector3();
  let rMin = Infinity, rMax = -Infinity;
  for (let ri = 0; ri <= rings; ri++) {
    const rr = (ri / rings) * radius;
    for (let si = 0; si <= seg; si++) {
      const a = (si / seg) * Math.PI * 2;
      dir.copy(up).addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr).normalize();
      const h = surfaceAt(dir, 1.5);
      if (!h.hit) return null; // 采样打空(悬崖背面等) → 不铺
      const r = h.pos.length();
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      const p = h.pos.clone().addScaledVector(up, lift);
      pos.push(p.x, p.y, p.z);
      uvs.push(Math.cos(a) * rr / (radius * 2) + 0.5, Math.sin(a) * rr / (radius * 2) + 0.5);
    }
  }
  if (rMax - rMin > flatTol) return null; // 地面不平整，铺了必穿帮
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
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

export async function buildTownFromPlanetJson(scene, surfaceAt) {
  await preloadProps(); // 现成模型（车/电杆/NPC…）先就位，构建器里同步克隆
  const res = await fetch('./planet/planet.json');
  const data = await res.json();

  const town = new THREE.Group();
  scene.add(town);
  const interactables = [];
  const colliders = [];
  const ticks = [];
  const buildingBoxes = [];
  let placed = 0, skipped = 0;

  for (const [i, o] of (data.objects || []).entries()) {
    const make = BUILDERS[o.kind];
    if (!make) { skipped++; continue; }
    const dir = dirFromPx(o.x, o.y);
    const hit = surfaceAt(dir);
    if (!hit.hit) { skipped++; continue; }
    const g = make(String(i));
    g.position.copy(hit.pos).addScaledVector(hit.normal, -0.03);
    g.quaternion.copy(basisAt(dir, 0));
    town.add(g);
    placed++;

    // 贴图地坪（视觉件，不参与碰撞/射线）；地面不平整时 yardDisc 返回 null 不铺
    const yd = YARDS[o.kind];
    if (yd) {
      const rep = (yd.r * 2) / yd.tile;
      const pmat = PBR(yd.tex, { rx: rep, ry: rep, rough: 0.92 });
      pmat.polygonOffset = true; // 贴地圆盘与地形距离近，偏移深度防 z-fight
      pmat.polygonOffsetFactor = -2;
      pmat.polygonOffsetUnits = -2;
      const disc = yardDisc(surfaceAt, hit.pos, hit.normal, yd.r, pmat, { seg: 48, rings: yd.rings });
      if (disc) town.add(disc);
    }

    const meta = g.userData.meta || {};
    // 词优先用 planet.json 里登记的 id，其次用构建器默认
    const wordId = o.word || meta.word;
    const w = wordById(wordId);
    if (w) {
      interactables.push({
        group: g, meta: { ...meta, word: wordId, ja: w.ja },
        worldPos: hit.pos.clone().addScaledVector(hit.normal, 0.8),
        radius: (meta.r || 1.4) + 1.4,
      });
    }
    if (SOLID_KINDS.has(o.kind)) {
      const cr = SPECIAL_COLLIDER_R[o.kind] ?? meta.r ?? 3;
      // 相机防穿墙/攀爬判顶用包围盒
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      box.expandByScalar(0.1);
      buildingBoxes.push(box);
      colliders.push({ n: dir.clone().normalize(), r: cr * 0.75, box });
    }
    if (g.userData.tick) ticks.push(g.userData.tick);
  }

  console.log(`town: ${placed} placed, ${skipped} skipped (no builder / no ground)`);
  return { town, interactables, colliders, ticks, buildingBoxes, spawnPx: data.spawn, planetCfg: data.planet };
}
