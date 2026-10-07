// collision.js — 行走碰撞：把 PLACES / FOREST_TREES / 造成边坡变成 plan 空间的圆/盒碰撞体，
// 小猫移动后做推出解算，防止穿墙、穿建筑、从挡墙边直接穿到台下。
// 注意：可走面高度是解析高程场（src/map/terrain.js），碰撞只管平面，
// 所以凡是有垂直高差的地方都必须有碰撞体挡着，否则猫会瞬移上/下台。
import { PLACES, FOREST_TREES, SOLIDS, TERRACES, FLIGHTS, TERRAIN_FIELD } from './layout.js';
import { localToPlan, planToLocal, flightLevel, flightFeedsTerrace } from '../map/terrain.js';

// kind → 碰撞体定义在 layout.js 的 SOLIDS（与编辑器 2D 视图共用）。

// plan 空间碰撞体列表：圆 { cx, cz, r } / 盒 { cx, cz, c, s, hw, hd, bound }
// rotY→plan 的轴：local-x = (cosθ, -sinθ)，local-z = (sinθ, cosθ)（与 planQuat 一致）
export const COLLIDERS = [];
function addCollider(cx, cz, rotY, def, scale, from) {
  if (def.r !== undefined) {
    COLLIDERS.push({ cx, cz, r: def.r * scale, from });
    return;
  }
  const t = rotY, c = Math.cos(t), s = Math.sin(t);
  COLLIDERS.push({
    cx, cz, c, s,
    hw: def.w * scale, hd: def.d * scale,
    bound: Math.hypot(def.w, def.d) * scale,
    from,
  });
}
for (const [i, p] of PLACES.entries()) {
  const def = SOLIDS[p.kind];
  if (!def) continue;
  const t = p.rotY || 0, c = Math.cos(t), s = Math.sin(t);
  for (const d of Array.isArray(def) ? def : [def]) {
    // 局部偏移 (ox, oz) → plan 偏移
    addCollider(
      p.x + (d.ox || 0) * c + (d.oz || 0) * s,
      p.z - (d.ox || 0) * s + (d.oz || 0) * c,
      t, d, p.s || 1, `${p.kind} #${i}`
    );
  }
}
for (const t of FOREST_TREES) addCollider(t.x, t.z, t.rotY || 0, SOLIDS.tree, t.s || 1, 'forestTree');

// ---------- 造成边坡：挡墙 + 梯道两侧 ----------
/**
 * 这条边上被梯道让开的沿边区间（台地局部坐标，米）。
 * 口径与 terrainwork.flightGaps 完全一致：几何画了口子，碰撞就得照样开口，反之也是。
 */
function sideGaps(tc, side) {
  const half = side.ax === 'x' ? tc.hd : tc.hw;
  const gaps = [];
  for (const fl of FLIGHTS || []) {
    if (!flightFeedsTerrace(TERRAIN_FIELD.hillsH, tc, fl)) continue;
    const top = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
    const loc = planToLocal(tc.x, tc.z, tc.rotY || 0, top.x, top.z);
    const [s, a] = side.ax === 'x' ? [loc.lz, loc.lx] : [loc.lx, loc.lz];
    if (Math.abs(s - side.sgn * half) > 1.1) continue;
    gaps.push([a - (fl.w || 1.5) / 2 - 0.1, a + (fl.w || 1.5) / 2 + 0.1]);
  }
  return gaps;
}
const WALL_T = 0.16;   // 挡墙碰撞半厚
for (const [ti, tc] of TERRACES.entries()) {
  if (tc.edge !== 'wall' || tc.h <= 0.15) continue;
  for (const side of [
    { ax: 'z', sgn: 1 }, { ax: 'z', sgn: -1 },
    { ax: 'x', sgn: 1 }, { ax: 'x', sgn: -1 },
  ]) {
    const half = side.ax === 'x' ? tc.hd : tc.hw;      // 法向
    const span = side.ax === 'x' ? tc.hw : tc.hd;      // 沿边半长
    // 沿边切成「有墙 / 是口子」的若干段，只给有墙的那几段加碰撞体
    const segs = [];
    let cur = -span;
    for (const [g0, g1] of sideGaps(tc, side).sort((a, b) => a[0] - b[0])) {
      const a0 = Math.max(-span, g0), a1 = Math.min(span, g1);
      if (a0 > cur) segs.push([cur, a0]);
      cur = Math.max(cur, a1);
    }
    if (cur < span) segs.push([cur, span]);
    for (const [a0, a1] of segs) {
      if (a1 - a0 < 0.2) continue;
      const am = (a0 + a1) / 2, hl = (a1 - a0) / 2;
      const inL = side.ax === 'x' ? { lx: am, lz: side.sgn * half } : { lx: side.sgn * half, lz: am };
      const c = localToPlan(tc.x, tc.z, tc.rotY || 0, inL.lx, inL.lz);
      addCollider(c.x, c.z, tc.rotY || 0, side.ax === 'x'
        ? { w: hl, d: WALL_T }
        : { w: WALL_T, d: hl }, 1, `terrace #${ti} ${side.ax === 'x' ? 'front' : 'side'}${side.sgn > 0 ? '+' : '−'}`);
    }
  }
}
for (const [fli, fl] of FLIGHTS.entries()) {
  const rise = fl.rise || 0;
  if (rise <= 0.4 || (fl.kind || 'stair') === 'ramp') continue;
  const steps = Math.max(1, Math.round(fl.steps || Math.round(fl.run / 0.34)));
  const n = Math.max(2, Math.ceil(fl.run / 0.9));
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const lz0 = (i / n) * fl.run, lz1 = ((i + 1) / n) * fl.run, lzm = (lz0 + lz1) / 2;
      const k = Math.min(1, (Math.floor((lzm / fl.run) * steps) + 1) / steps);
      const hStep = flightLevel(TERRAIN_FIELD.hillsH, fl, k);
      const side = localToPlan(fl.x, fl.z, fl.rotY || 0, sgn * ((fl.w || 1.5) / 2 + 0.55), lzm);
      if (Math.abs(hStep - TERRAIN_FIELD.surface(side.x, side.z)) < 0.4) continue;
      const c = localToPlan(fl.x, fl.z, fl.rotY || 0, sgn * ((fl.w || 1.5) / 2 + 0.1), lzm);
      addCollider(c.x, c.z, fl.rotY || 0, { w: 0.1, d: (lz1 - lz0) / 2 }, 1, `flight #${fli} rail${sgn > 0 ? '+' : '−'}`);
    }
  }
}

/**
 * 圆（猫）与碰撞体解算：命中则返回推出后的 {x,z}，否则返回 null。
 * 盒用最小穿透轴推出，圆沿径向推出。
 */
export function resolveCollisions(px, pz, catR) {
  let hit = false;
  for (const b of COLLIDERS) {
    const dx = px - b.cx, dz = pz - b.cz;
    if (b.r !== undefined) {
      const rr = b.r + catR, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        px = b.cx + dx / d * rr;
        pz = b.cz + dz / d * rr;
        hit = true;
      }
      continue;
    }
    if (Math.abs(dx) > b.bound + catR || Math.abs(dz) > b.bound + catR) continue;
    const lx = dx * b.c - dz * b.s;
    const lz = dx * b.s + dz * b.c;
    const ex = b.hw + catR, ez = b.hd + catR;
    if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
      const penX = ex - Math.abs(lx), penZ = ez - Math.abs(lz);
      let nlx = lx, nlz = lz;
      if (penX < penZ) nlx = (lx >= 0 ? ex : -ex);
      else nlz = (lz >= 0 ? ez : -ez);
      px = b.cx + nlx * b.c + nlz * b.s;
      pz = b.cz - nlx * b.s + nlz * b.c;
      hit = true;
    }
  }
  return hit ? { x: px, z: pz } : null;
}
