// collision.js — 行走碰撞：把 PLACES / FOREST_TREES 变成 plan 空间的圆/盒碰撞体，
// 小猫移动后做推出解算，防止穿墙、穿建筑。
import { PLACES, FOREST_TREES } from './layout.js';

// kind → 碰撞体（局部坐标，米；w/d 为半宽/半深，r 为半径；ox/oz 为局部偏移）。
// 建筑尺寸与 props.js 的 buildXxx 外墙对齐。
const SOLIDS = {
  station:      { w: 3.3, d: 1.9 },
  house:        { w: 1.65, d: 1.45 },
  mansion:      { w: 2.15, d: 1.65 },
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

// plan 空间碰撞体列表：圆 { cx, cz, r } / 盒 { cx, cz, c, s, hw, hd, bound }
// rotY→plan 的轴：local-x = (cosθ, -sinθ)，local-z = (sinθ, cosθ)（与 planQuat 一致）
export const COLLIDERS = [];
function addCollider(cx, cz, rotY, def, scale) {
  if (def.r !== undefined) {
    COLLIDERS.push({ cx, cz, r: def.r * scale });
    return;
  }
  const t = rotY, c = Math.cos(t), s = Math.sin(t);
  COLLIDERS.push({
    cx, cz, c, s,
    hw: def.w * scale, hd: def.d * scale,
    bound: Math.hypot(def.w, def.d) * scale,
  });
}
for (const p of PLACES) {
  const def = SOLIDS[p.kind];
  if (!def) continue;
  const t = p.rotY || 0, c = Math.cos(t), s = Math.sin(t);
  for (const d of Array.isArray(def) ? def : [def]) {
    // 局部偏移 (ox, oz) → plan 偏移
    addCollider(
      p.x + (d.ox || 0) * c + (d.oz || 0) * s,
      p.z - (d.ox || 0) * s + (d.oz || 0) * c,
      t, d, p.s || 1
    );
  }
}
for (const t of FOREST_TREES) addCollider(t.x, t.z, t.rotY || 0, SOLIDS.tree, t.s || 1);

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
