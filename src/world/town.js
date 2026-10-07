// town.js — 城镇装配：把 PLACES 摆上球面，按材质桶合并静态几何，登记可交互物
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  PLAN, PLACES, FOREST_TREES, planToVec3, planQuat, TERRAIN_FIELD,
} from './layout.js';
import { makeField, localToPlan } from '../map/terrain.js';
import { buildTerrainWorks } from './terrainwork.js';
import { BUILDERS } from './props.js';
import { makeBucketMaterial, bakeColor, addOutline } from './materials.js';

// 各 kind 的交互半径（米）
const RADII = {
  station: 2.6, school: 2.4, supermarket: 2.2, hospital: 2.2, bank: 2.0,
  library: 2.0, konbini: 2.0, postOffice: 1.8, mansion: 1.8, house: 1.7,
  cafe: 1.6, ramen: 1.6, shrine: 2.0, fountain: 1.4, flowerbed: 1.0,
  car: 1.2, tree: 1.2, sakura: 1.2, clothesline: 1.2, bench: 1.0,
  vending: 1.0, signboard: 1.0, trafficLight: 1.0, phoneBox: 0.9,
  pole: 0.9, streetlight: 0.9, mailbox: 0.8, trash: 0.8, hydrant: 0.7,
  potted: 0.7, wall: 1.2, fence: 1.2, parkingSign: 0.8, plazaFlag: 0.8,
  crossing: 0.9, flowers: 0.8, grassTuft: 0.7,
  dog: 0.7, catNpc: 0.7, bird: 0.6, npc: 0.7,
};

// 描边宽度（米）：0 = 不描边（发光/贴图/细丝类跳过）
const OUTLINE_WIDTHS = {
  concrete: 0.017, asphalt: 0, paving: 0, tile: 0.017, wood: 0.016,
  leaf: 0.016, leafDark: 0.013, plasticRed: 0.016, plasticWhite: 0.016,
  metalDark: 0.015, galvanized: 0.014, rubber: 0, glass: 0, paint: 0.016,
};

// 需要脚下 blob 的小物件
const BLOB_KINDS = new Set([
  'vending', 'streetlight', 'pole', 'trash', 'mailbox', 'hydrant', 'bench',
  'signboard', 'phoneBox', 'trafficLight', 'potted', 'flowers', 'grassTuft',
  'clothesline', 'parkingSign', 'plazaFlag', 'dog', 'catNpc', 'bird', 'npc',
  'crossing', 'flowerbed', 'fountain', 'wall', 'fence', 'tree', 'sakura',
]);

export function buildTown(scene, data) {
  // data（编辑器实时预览用）可覆写整份 plan；缺省 = layout.js 的构建期数据
  const P = data || PLAN;
  const PLACES_D = P.places || PLACES;
  const TREES_D = P.forestTrees || FOREST_TREES;
  const field = data ? makeField(data) : TERRAIN_FIELD;
  const terrain = (x, z) => field.surface(x, z);
  const bucketGeos = {};
  const decals = [];        // 带贴图的小面片（不合并）
  const interactables = [];
  const lampPositions = []; // 路灯灯泡世界坐标（供点光）
  const placeOne = (p, interactive) => {
    const builder = BUILDERS[p.kind];
    if (!builder) return;
    const inst = builder(p.v || 0, p.s || 1, p);

    const pos = planToVec3(p.x, p.z, terrain(p.x, p.z));
    const quat = planQuat(p.x, p.z, p.rotY || 0);
    const placeM = new THREE.Matrix4().compose(
      pos, quat, new THREE.Vector3(1, 1, 1).multiplyScalar(p.s || 1)
    );

    inst.updateMatrix();
    inst.updateMatrixWorld(true);

    inst.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const hasBucket = mats.every((m) => m.userData && m.userData.bucket);
      // matrixWorld = 构建器整棵树的累计变换（支持嵌套 Group，如 NPC 的 head 组）
      const worldM = new THREE.Matrix4().multiplyMatrices(placeM, mesh.matrixWorld);

      if (!hasBucket) {
        // 贴花（贴图面片）：独立保留
        const clone = new THREE.Mesh(mesh.geometry.clone(), mesh.material);
        clone.applyMatrix4(worldM);
        clone.castShadow = false;
        clone.receiveShadow = true;
        decals.push(clone);
        return;
      }
      const bucket = mats[0].userData.bucket;
      let geo = mesh.geometry.clone();
      geo.applyMatrix4(worldM);
      if (geo.index) geo = geo.toNonIndexed();
      const wp = new THREE.Vector3().setFromMatrixPosition(worldM);
      bakeColor(geo, mats[0].userData.baseColor.getHex(), bucket, wp);
      (bucketGeos[bucket] ||= []).push(geo);
    });

    if (interactive) {
      interactables.push({
        word: p.word,
        kind: p.kind,
        pos,
        radius: RADII[p.kind] ?? 1.0,
        plan: { x: p.x, z: p.z },
      });
      // 路灯灯泡位置（本地 (1.0, 2.86, 0)）
      if (p.kind === 'streetlight') {
        const lp = new THREE.Vector3(1.0, 2.86, 0).applyMatrix4(placeM);
        lampPositions.push(lp);
      }
      if (BLOB_KINDS.has(p.kind)) addBlob(bucketGeos, pos, quat, p.kind);
    }
  };

  for (const p of PLACES_D) placeOne(p, true);
  for (const t of TREES_D) placeOne({ kind: 'tree', x: t.x, z: t.z, rotY: t.rotY, v: t.v, s: t.s, word: '' }, false);

  // —— 造成：台地顶面 / 挡土墙 / 石阶 / 坡道，走同一条合并管线 ——
  buildTerrainWorks(bucketGeos, field, P);
  for (const rec of P.terraces || []) {
    if (!rec.word) continue;
    const pos = planToVec3(rec.x, rec.z, field.surface(rec.x, rec.z));
    interactables.push({ word: rec.word, kind: 'terrace', pos, radius: 2.6, plan: { x: rec.x, z: rec.z } });
  }
  for (const rec of P.flights || []) {
    if (!rec.word) continue;
    const mid = localToPlan(rec.x, rec.z, rec.rotY || 0, 0, rec.run / 2);
    const pos = planToVec3(mid.x, mid.z, field.surface(mid.x, mid.z));
    interactables.push({ word: rec.word, kind: rec.kind || 'stair', pos, radius: 2.0, plan: mid });
  }

  buildWires(bucketGeos, PLACES_D, field);

  // —— 合并成每桶一个 Mesh ——
  const merged = new THREE.Group();
  const mats = {};
  for (const [bucket, geos] of Object.entries(bucketGeos)) {
    const mergedGeo = mergeGeometries(geos, false);
    if (!mergedGeo) continue;
    const material = makeBucketMaterial(bucket);
    mats[bucket] = material;
    const mesh = new THREE.Mesh(mergedGeo, material);
    mesh.castShadow = bucket !== 'blob';
    mesh.receiveShadow = bucket !== 'blob';
    mesh.name = 'town_' + bucket;
    if (bucket === 'blob') {
      mesh.renderOrder = 1;
    } else if (OUTLINE_WIDTHS[bucket] !== undefined) {
      addOutline(mesh, OUTLINE_WIDTHS[bucket]);
    }
    merged.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  for (const d of decals) merged.add(d);
  scene.add(merged);

  return { interactables, lampPositions, mats, root: merged };
}

// ---------- 脚下 blob 影 ----------
function addBlob(bucketGeos, pos, quat, kind) {
  const size = ({ npc: 0.5, dog: 0.4, catNpc: 0.4, bird: 0.24, potted: 0.4, flowers: 0.5, grassTuft: 0.4, hydrant: 0.4, trash: 0.55 })[kind] || 1.0;
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const n = new THREE.Vector3().copy(pos).normalize();
  const m = new THREE.Matrix4().compose(
    pos.clone().addScaledVector(n, 0.03),
    quat,
    new THREE.Vector3(1, 1, 1)
  );
  geo.applyMatrix4(m);
  bakeColor(geo, 0xffffff, 'blob', pos); // 渐变由 blob 贴图承担，顶点色只传白
  (bucketGeos.blob ||= []).push(geo);
}

// ---------- 电线（杆间垂弧） ----------
function buildWires(bucketGeos, places, field) {
  const poles = places.filter((p) => p.kind === 'pole');
  if (poles.length < 2) return;
  const wireColor = 0x35393d;
  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i], b = poles[i + 1];
    const pa = planToVec3(a.x, a.z, field.surface(a.x, a.z) + 4.3);
    const pb = planToVec3(b.x, b.z, field.surface(b.x, b.z) + 4.3);
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    const sag = pa.distanceTo(pb) * 0.09;
    mid.addScaledVector(mid.clone().normalize(), -sag);
    for (const off of [-0.5, 0.5]) {
      const A = pa.clone(), B = pb.clone(), M = mid.clone();
      // 沿杆横向偏移（用东西切向近似）
      const t = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3(0, 1, 0)).normalize();
      A.addScaledVector(t, off); B.addScaledVector(t, off); M.addScaledVector(t, off);
      const curve = new THREE.CatmullRomCurve3([A, M, B]);
      let geo = new THREE.TubeGeometry(curve, 10, 0.014, 4, false);
      if (geo.index) geo = geo.toNonIndexed();
      bakeColor(geo, wireColor, 'wire', M);
      (bucketGeos.wire ||= []).push(geo);
    }
  }
}
