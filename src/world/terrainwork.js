// terrainwork.js — 造成（土方）实体几何：台地顶面 / 挡土墙 / 石阶 / 坡道 / 扶手
// 输入 src/map/terrain.js 的高程场，输出直接进 town.js 的材质桶合并管线。
// 死规矩：可见面必须和高程场同值，否则猫踩空或陷地 ——
//   台面顶 = field.surface，台阶/坡道顶 = field.hillsH + k·rise，挡墙底埋进外侧地面 0.35 米。
import * as THREE from 'three';
import { planToVec3 } from './layout.js';
import { localToPlan, planToLocal, stairK, flightLevel, flightFeedsTerrace } from '../map/terrain.js';
import { bakeColor } from './materials.js';

const C_TOP = 0xcabfb0;      // 台面 = 人行道同色铺装
const C_WALL = 0xb2a894;     // 挡墙石材
const C_STEP = 0xd6ccb9;     // 踏面
const C_RAIL = 0x5b5f63;     // 扶手金属

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

/** 球面局部框架：位置 = 局部(lx,lz) 高度 h 处，Y=径向，Z=沿局部 +z 的切向（与 planQuat 同手性） */
function frameAt(origin, lx, lz, h) {
  const p = localToPlan(origin.x, origin.z, origin.rotY, lx, lz);
  const pos = planToVec3(p.x, p.z, h, new THREE.Vector3());
  const up = pos.clone().normalize();
  const a = localToPlan(origin.x, origin.z, origin.rotY, lx, lz - 1);
  const b = localToPlan(origin.x, origin.z, origin.rotY, lx, lz + 1);
  const t = planToVec3(b.x, b.z, h, _v).sub(planToVec3(a.x, a.z, h, _v2));
  const fwd = t.addScaledVector(up, -t.dot(up)).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  _m.makeBasis(right, up, fwd);
  return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(_m) };
}

function pushBox(bucketGeos, bucket, colorHex, origin, lx, lz, h, w, thick, depth) {
  const f = frameAt(origin, lx, lz, h);
  const geo = new THREE.BoxGeometry(w, thick, depth);
  geo.applyMatrix4(new THREE.Matrix4().compose(f.pos, f.quat, ONE));
  const out = geo.index ? geo.toNonIndexed() : geo;
  geo.dispose();
  bakeColor(out, colorHex, bucket, f.pos);
  (bucketGeos[bucket] ||= []).push(out);
  return f;
}

const UV_M = 1 / 1.4;   // 颗粒贴图是 RepeatWrapping，每 1.4 米一格

/**
 * 给手搓的三角网补 uv。
 * 桶材质都挂了颗粒贴图，props 出来的几何因此一律带 uv；这里少一个 uv 属性，
 * 同桶的 mergeGeometries 会整桶失败（three 只打 console.error），那一桶的建筑就集体消失。
 */
function assignUV(geo) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    const e0 = [p.getX(i), p.getY(i), p.getZ(i)];
    const e1 = [p.getX(i + 1) - e0[0], p.getY(i + 1) - e0[1], p.getZ(i + 1) - e0[2]];
    const e2 = [p.getX(i + 2) - e0[0], p.getY(i + 2) - e0[1], p.getZ(i + 2) - e0[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const drop = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0
      : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;   // 法向最强的轴丢掉 = 投影到面积最大的面
    const [ua, va] = drop === 0 ? [1, 2] : drop === 1 ? [0, 2] : [0, 1];
    for (let k = 0; k < 3; k++) {
      const v = [p.getX(i + k), p.getY(i + k), p.getZ(i + k)];
      uv[(i + k) * 2] = v[ua] * UV_M;
      uv[(i + k) * 2 + 1] = v[va] * UV_M;
    }
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

function pushMesh(bucketGeos, bucket, colorHex, pos, idx, anchor) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const out = assignUV(geo.toNonIndexed());
  geo.dispose();
  bakeColor(out, colorHex, bucket, anchor);
  (bucketGeos[bucket] ||= []).push(out);
}

/** 贴地三角网：局部矩形按 cell 剖分，每节点高度 = heightFn(planX, planZ) */
function surfacePatch(bucketGeos, origin, rect, cell, bucket, colorHex, heightFn) {
  const { x, z, rotY } = origin;
  const nx = Math.max(1, Math.round((rect.lx1 - rect.lx0) / cell));
  const nz = Math.max(1, Math.round((rect.lz1 - rect.lz0) / cell));
  const pos = [], idx = [];
  let anchor = null;
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const lx = rect.lx0 + (rect.lx1 - rect.lx0) * (ix / nx);
      const lz = rect.lz0 + (rect.lz1 - rect.lz0) * (iz / nz);
      const p = localToPlan(x, z, rotY, lx, lz);
      planToVec3(p.x, p.z, heightFn(p.x, p.z), _v);
      pos.push(_v.x, _v.y, _v.z);
      if (!anchor) anchor = _v.clone();
    }
  }
  const row = nx + 1;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * row + ix, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  pushMesh(bucketGeos, bucket, colorHex, pos, idx, anchor);
}

/** 这条边上被梯道/坡道让开的沿边区间（局部坐标，米）——挡墙在此断开，否则石阶埋在墙里 */
function flightGaps(tc, s, flights, hillsH) {
  const half = s.ax === 'x' ? tc.hd : tc.hw;
  const gaps = [];
  for (const fl of flights || []) {
    if (!flightFeedsTerrace(hillsH, tc, fl)) continue;
    const top = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
    const loc = planToLocal(tc.x, tc.z, tc.rotY || 0, top.x, top.z);
    const [side, along] = s.ax === 'x' ? [loc.lz, loc.lx] : [loc.lx, loc.lz];
    if (Math.abs(side - s.sgn * half) > 1.1) continue;
    gaps.push([along - (fl.w || 1.5) / 2 - 0.1, along + (fl.w || 1.5) / 2 + 0.1]);
  }
  return gaps;
}

/** 台地顶面 + 垂直边的挡土墙（墙只出压顶和外立面，内立面被台面盖住） */
export function buildTerrace(bucketGeos, field, tc, flights) {
  const origin = { x: tc.x, z: tc.z, rotY: tc.rotY || 0 };
  const ap = tc.edge === 'slope' ? (tc.apron ?? 1.6) : 0;
  // 放坡裙的最外圈高程和粗网格星球面几乎相等 → 抬 2 厘米防抖动，肉眼看不出来
  const eps = ap > 0 ? 0.02 : 0;
  surfacePatch(bucketGeos, origin, {
    lx0: -(tc.hw + ap), lx1: tc.hw + ap, lz0: -(tc.hd + ap), lz1: tc.hd + ap,
  }, 1.0, 'paving', C_TOP, (x, z) => field.surface(x, z) + eps);
  if (tc.edge !== 'wall' || tc.h <= 0.12) return;

  for (const s of [{ ax: 'z', sgn: 1 }, { ax: 'z', sgn: -1 }, { ax: 'x', sgn: 1 }, { ax: 'x', sgn: -1 }]) {
    // 这条边：法向距离 half、沿边半长 span
    const half = s.ax === 'x' ? tc.hd : tc.hw;
    const span = s.ax === 'x' ? tc.hw : tc.hd;
    const gaps = flightGaps(tc, s, flights, field.hillsH);
    const inGap = (a) => gaps.some(([g0, g1]) => a > g0 && a < g1);
    const n = Math.max(1, Math.round((span * 2) / 1.0));
    const pos = [], idx = [];
    let anchor = null;
    for (let i = 0; i <= n; i++) {
      const a = -span + span * 2 * (i / n);
      const aPrev = -span + span * 2 * ((i - 1) / n);
      const skip = i === 0 ? false : inGap((a + aPrev) / 2);
      const inL = s.ax === 'x' ? { lx: a, lz: s.sgn * half } : { lx: s.sgn * half, lz: a };
      const outL = s.ax === 'x' ? { lx: a, lz: s.sgn * (half + 0.3) } : { lx: s.sgn * (half + 0.3), lz: a };
      const pi = localToPlan(origin.x, origin.z, origin.rotY, inL.lx, inL.lz);
      const po = localToPlan(origin.x, origin.z, origin.rotY, outL.lx, outL.lz);
      const hTop = field.surface(pi.x, pi.z);          // 台顶标高
      // 靠山那一侧墙外地表比台面还高 → 墙退化成缝，别让外立面翻面（填方台地不挖方）
      const hOut = Math.min(field.surface(po.x, po.z), hTop);
      planToVec3(pi.x, pi.z, hTop, _v); pos.push(_v.x, _v.y, _v.z);
      planToVec3(po.x, po.z, hTop, _v); pos.push(_v.x, _v.y, _v.z);
      planToVec3(po.x, po.z, hOut - 0.35, _v); pos.push(_v.x, _v.y, _v.z);
      if (!anchor) anchor = _v.clone();
      if (i > 0 && !skip) {
        const b = (i - 1) * 3, c = i * 3;
        idx.push(b, b + 1, c + 1, b, c + 1, c);                  // 压顶石
        idx.push(b + 1, b + 2, c + 2, b + 1, c + 2, c + 1);      // 外立面
      }
    }
    pushMesh(bucketGeos, 'concrete', C_WALL, pos, idx, anchor);
  }
}

/** 石阶（一阶一整块，侧面自然呈锯齿）/ 坡道（贴地斜面） */
export function buildFlight(bucketGeos, field, fl) {
  const origin = { x: fl.x, z: fl.z, rotY: fl.rotY || 0 };
  const w = fl.w || 1.5, run = fl.run, rise = fl.rise || 0;
  const steps = Math.max(1, Math.round(fl.steps || Math.round(run / 0.34)), 1);
  const td = run / steps, th = rise / steps;

  if ((fl.kind || 'stair') === 'ramp') {
    // 坡面矩形内高程场完全由这条坡道决定（relief 的优先规则），直接踩 field.surface 就是坡道自己
    surfacePatch(bucketGeos, origin, { lx0: -w / 2, lx1: w / 2, lz0: 0, lz1: run }, 0.6,
      'paving', C_TOP, (x, z) => field.surface(x, z));
    return;
  }

  for (let i = 0; i < steps; i++) {
    const lz = (i + 0.5) * td;
    const p = localToPlan(origin.x, origin.z, origin.rotY, 0, lz);
    const top = field.surface(p.x, p.z);                                      // 猫踩到的就是这一阶顶
    const bottom = Math.min(top - th, field.hillsH(p.x, p.z)) - 0.18;         // 埋进当地地面 18 厘米
    pushBox(bucketGeos, 'paving', C_STEP, origin, 0, lz, (top + bottom) / 2, w, top - bottom, td * 1.04);
  }

  if (rise < 0.9) return;   // 高差不到 1 米不配扶手
  const n = Math.max(2, Math.round(run / 1.2));
  for (const s of [-1, 1]) {
    const lx = s * (w / 2 + 0.07);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const lz = (i / n) * run;
      const k = stairK(Math.min(1, lz / run), steps);
      const p = localToPlan(origin.x, origin.z, origin.rotY, lx, lz);
      const railH = flightLevel(field.hillsH, fl, k) + 0.58;
      pushBox(bucketGeos, 'metalDark', C_RAIL, origin, lx, lz, railH - 0.3, 0.06, 0.66, 0.06);
      const f = frameAt(origin, lx, lz, railH);
      if (prev) {
        const mid = prev.pos.clone().add(f.pos).multiplyScalar(0.5);
        const dir = f.pos.clone().sub(prev.pos).normalize();
        const up = mid.clone().normalize();
        const xx = dir.clone().addScaledVector(up, -dir.dot(up)).normalize();
        const yy = up.clone().cross(xx).normalize();
        _m.makeBasis(xx, yy, up);
        const geo = new THREE.BoxGeometry(0.07, 0.07, prev.pos.distanceTo(f.pos));
        geo.applyMatrix4(new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromRotationMatrix(_m), ONE));
        const out = geo.index ? geo.toNonIndexed() : geo;
        geo.dispose();
        bakeColor(out, C_RAIL, 'metalDark', mid);
        (bucketGeos.metalDark ||= []).push(out);
      }
      prev = f;
    }
  }
}

/** 汇总：造成几何塞进 bucketGeos，返回记录条数 */
export function buildTerrainWorks(bucketGeos, field, plan) {
  let count = 0;
  const flights = plan.flights || [];
  for (const tc of plan.terraces || []) { buildTerrace(bucketGeos, field, tc, flights); count++; }
  for (const fl of flights) { buildFlight(bucketGeos, field, fl); count++; }
  return count;
}
