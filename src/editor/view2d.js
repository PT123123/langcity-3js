// view2d.js — 2D plan 视图：地形底、道路网、物件符号；选择/拖动/旋转的鼠标交互
import { SOLIDS, makeField } from '../world/layout.js';
import { localToPlan, roadPolyline, distToRoad } from '../map/terrain.js';
import { S, snapshot, dropLastSnapshot, emit } from './state.js';
import { colorFor, kindInfo } from './kinds.js';

const cv = document.getElementById('plan');
const ctx = cv.getContext('2d');

// 视口：plan 原点 (cx,cz) 居中，scale = CSS 像素/米
const view = { cx: 0, cz: 2, scale: 14 };
let terrainCache = null;       // {key, cv}
let drag = null;               // {mode, ...}
let hover = null;              // 命中高亮 {type,i}
let showTrees = true;

const GROUND = {
  sea: '#4f9e9e', side: '#cabfb0', asphalt: '#8b8580',
  plaza: '#d6ccb9', line: '#fffaf2',
};
// 路面材质在 2D 上的颜色，与 planet.js 的 surfPatch 同色
const SURF = { asphalt: '#8b8580', cobble: '#a89a86', brick: '#b08a74', gravel: '#c2b8a4' };

let LW = 800, LH = 600;   // CSS 逻辑尺寸
const toScreenX = (x) => LW / 2 + (x - view.cx) * view.scale;
const toScreenY = (z) => LH / 2 + (z - view.cz) * view.scale;
export const toPlan = (px, py) => ({
  x: (px - LW / 2) / view.scale + view.cx,
  z: (py - LH / 2) / view.scale + view.cz,
});
/** plan → canvas 本地像素（验证脚本据此换 clientX/Y） */
export const planToLocal = (x, z) => ({ x: toScreenX(x), y: toScreenY(z) });
export const viewScale = () => view.scale;
export const viewCenter = () => ({ x: view.cx, z: view.cz });

// ---------- 地形底（缓丘 + 造成面 的晕渲，按相关参数缓存） ----------
const FOREST_RGB = [132, 150, 108];
function terrainCanvas() {
  const P = S.plan;
  const key = JSON.stringify([P.hills, P.beachZ, P.roads, P.terraces, P.flights]);
  if (terrainCache && terrainCache.key === key) return terrainCache.cv;
  const field = makeField(P);
  const W = 224, H = 224;
  const span = 64, x0 = -32;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  const hs = new Float32Array(W * H);        // 先存高程，再二次采样求坡度做晕渲
  for (let py = 0; py < H; py++) {
    const z = x0 + (py + 0.5) / H * span;
    for (let px = 0; px < W; px++) hs[py * W + px] = field.surface(x0 + (px + 0.5) / W * span, z);
  }
  const img = octx.createImageData(W, H);
  const cell = span / W;
  for (let py = 0; py < H; py++) {
    const z = x0 + (py + 0.5) / H * span;
    for (let px = 0; px < W; px++) {
      let col;
      if (z > 30.5) col = [79, 158, 158];
      else if (z > P.beachZ) col = [232, 216, 174];
      else {
        const g = Math.min(1, Math.max(0, hs[py * W + px] / 1.4));
        col = [163 - g * 34, 177 - g * 20, 131 - g * 30];
        const forestT = Math.max(0, Math.min(1, Math.max(-z - 23, Math.abs(x0 + (px + 0.5) / W * span) - 25.5) / 4));
        if (forestT > 0) col = col.map((c, k2) => c + (FOREST_RGB[k2] - c) * forestT);
      }
      // 光照从西北来：横坡越大越亮/越暗，起伏和台地边在俯视图上就能看见
      const xl = hs[py * W + Math.max(0, px - 1)], xr = hs[py * W + Math.min(W - 1, px + 1)];
      const zu = hs[Math.max(0, py - 1) * W + px], zd = hs[Math.min(H - 1, py + 1) * W + px];
      const s = ((xl - xr) + 0.6 * (zu - zd)) / cell * 0.5;
      const shade = Math.min(1.22, Math.max(0.78, 1.0 + s * 1.1));
      const i = (py * W + px) * 4;
      img.data[i] = Math.min(255, col[0] * shade);
      img.data[i + 1] = Math.min(255, col[1] * shade);
      img.data[i + 2] = Math.min(255, col[2] * shade);
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  terrainCache = { key, cv: off };
  return off;
}

// ---------- 绘制 ----------
export function render2d() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = GROUND.sea;
  ctx.fillRect(0, 0, LW, LH);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrainCanvas(), toScreenX(-32), toScreenY(-32), 64 * view.scale, 64 * view.scale);

  drawRoads();
  drawRelief();
  drawGrid();
  drawObjects();
  drawOverlay();
}

/** 道路折线描边（直线段就是两点折线） */
function strokeRoad(rd) {
  const pts = roadPolyline(rd);
  ctx.beginPath();
  ctx.moveTo(toScreenX(pts[0].x), toScreenY(pts[0].z));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(toScreenX(pts[i].x), toScreenY(pts[i].z));
  ctx.stroke();
}

function drawRoads() {
  const P = S.plan;
  ctx.lineCap = 'round';
  ctx.strokeStyle = GROUND.side;                       // 人行道：路面半宽 + 道牙宽，与 planet.js 同口径
  for (const rd of P.roads) {
    ctx.lineWidth = (rd.w + P.sidewalkW) * 2 * view.scale;
    strokeRoad(rd);
  }
  for (const rd of P.roads) {                          // 行车面（按路面材质分色）
    ctx.strokeStyle = SURF[rd.surf] || GROUND.asphalt;
    ctx.lineWidth = rd.w * 2 * view.scale;
    strokeRoad(rd);
  }
  ctx.strokeStyle = GROUND.line;                       // 中线虚线（只有沥青路画）
  ctx.lineWidth = Math.max(1, 0.12 * view.scale);
  ctx.setLineDash([6, 6]);
  for (const rd of P.roads) if (!rd.surf || rd.surf === 'asphalt') strokeRoad(rd);
  ctx.setLineDash([]);

  const pk = P.parking;                                // 停车场
  ctx.fillStyle = 'rgba(139,133,128,0.85)';
  ctx.fillRect(toScreenX(pk.x1), toScreenY(pk.z1), (pk.x2 - pk.x1) * view.scale, (pk.z2 - pk.z1) * view.scale);
  ctx.strokeStyle = GROUND.line;
  ctx.lineWidth = 1;
  for (let x = pk.x1; x <= pk.x2; x += 1.6) {
    ctx.beginPath();
    ctx.moveTo(toScreenX(x), toScreenY(pk.z1 + 0.3));
    ctx.lineTo(toScreenX(x), toScreenY(pk.z2 - 0.3));
    ctx.stroke();
  }

  const pl = P.plaza;                                  // 广场
  ctx.fillStyle = GROUND.plaza;
  ctx.beginPath();
  ctx.arc(toScreenX(pl.x), toScreenY(pl.z), pl.r * view.scale, 0, 7);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,250,242,0.9)';             // 斑马线
  for (const cw of P.crosswalks) {
    const w = cw.dir === 'h' ? 4 : 2, d = cw.dir === 'h' ? 2 : 4;
    ctx.fillRect(toScreenX(cw.x - w / 2), toScreenY(cw.z - d / 2), w * view.scale, d * view.scale);
  }
}

// ---------- 造成符号：台地边线 + 梯道/坡道踏面 ----------
function rectPath(cx, cz, hw, hd, rotY) {
  ctx.beginPath();
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    const p = localToPlan(cx, cz, rotY, lx, lz);
    const sx = toScreenX(p.x), sy = toScreenY(p.z);
    if (lx === -hw && lz === -hd) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

function drawRelief() {
  const P = S.plan;
  const sel = S.sel;
  const s = view.scale;
  (P.terraces || []).forEach((tc, i) => {
    const wall = (tc.edge || 'wall') === 'wall';
    rectPath(tc.x, tc.z, tc.hw, tc.hd, tc.rotY || 0);
    ctx.fillStyle = 'rgba(202,191,176,0.35)';
    ctx.fill();
    ctx.strokeStyle = sel && sel.type === 'terrace' && sel.i === i ? '#c94f4f'
      : wall ? 'rgba(120,92,60,0.95)' : 'rgba(120,92,60,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash(wall ? [] : [4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (s > 9) {
      ctx.fillStyle = 'rgba(74,66,56,0.9)';
      ctx.font = '11px "Noto Sans JP", sans-serif';
      ctx.fillText(`+${(tc.h ?? 0).toFixed(2)}m`, toScreenX(tc.x) - 12, toScreenY(tc.z));
    }
  });
  (P.flights || []).forEach((fl, i) => {
    const isStair = (fl.kind || 'stair') === 'stair';
    const steps = Math.max(1, Math.round(fl.steps || 6));
    const picked = sel && sel.type === 'flight' && sel.i === i;
    ctx.strokeStyle = picked ? '#c94f4f' : 'rgba(74,66,56,0.85)';
    ctx.lineWidth = picked ? 2.4 : 1.4;
    if (isStair) {
      for (let k = 0; k <= steps; k++) {
        const lz = (k / steps) * fl.run;
        const a = localToPlan(fl.x, fl.z, fl.rotY || 0, -fl.w / 2, lz);
        const b = localToPlan(fl.x, fl.z, fl.rotY || 0, fl.w / 2, lz);
        ctx.beginPath(); ctx.moveTo(toScreenX(a.x), toScreenY(a.z)); ctx.lineTo(toScreenX(b.x), toScreenY(b.z)); ctx.stroke();
      }
    }
    const c0 = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, 0);
    const c1 = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
    ctx.strokeStyle = 'rgba(201,79,79,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(toScreenX(c0.x), toScreenY(c0.z));
    ctx.lineTo(toScreenX(c1.x), toScreenY(c1.z));
    ctx.stroke();
    if (s > 9) {
      ctx.fillStyle = 'rgba(201,79,79,0.95)';
      ctx.font = '11px "Noto Sans JP", sans-serif';
      ctx.fillText(`${isStair ? `${steps}段` : '坡'} +${(fl.rise ?? 0).toFixed(2)}m`,
        toScreenX(c1.x) + 4, toScreenY(c1.z) + 4);
    }
  });
}

function drawGrid() {
  const x0 = view.cx - LW / 2 / view.scale, z0 = view.cz - LH / 2 / view.scale;
  const w = LW / view.scale, h = LH / view.scale;
  const step = view.scale > 30 ? 1 : 5;
  ctx.strokeStyle = 'rgba(74,66,56,0.16)';
  ctx.lineWidth = 1;
  for (let x = Math.ceil(x0 / step) * step; x < x0 + w; x += step) line(toScreenX(x), 0, toScreenX(x), LH);
  for (let z = Math.ceil(z0 / step) * step; z < z0 + h; z += step) line(0, toScreenY(z), LW, toScreenY(z));
  ctx.strokeStyle = 'rgba(201,79,79,0.45)';            // 南北主轴线
  line(toScreenX(0), 0, toScreenX(0), LH);
  ctx.strokeStyle = 'rgba(91,141,239,0.45)';           // 东西主轴线
  line(0, toScreenY(0), LW, toScreenY(0));
}
const line = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); };
const dot = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };

// rotY→plan 轴：local-x=(cos, -sin)，local-z=(sin, cos)，与 collision.js/planQuat 一致
function solidPath(def, s, rotY) {
  const c = Math.cos(rotY), si = Math.sin(rotY);
  for (const d of (Array.isArray(def) ? def : [def])) {
    const ox = (d.ox || 0) * c + (d.oz || 0) * si, oz = -(d.ox || 0) * si + (d.oz || 0) * c;
    ctx.save();
    ctx.translate(ox * s, oz * s);
    if (d.r !== undefined) {
      ctx.beginPath(); ctx.arc(0, 0, d.r * s, 0, 7); ctx.fill();
    } else {
      ctx.rotate(-rotY);
      ctx.fillRect(-d.w * s, -d.d * s, d.w * 2 * s, d.d * 2 * s);
    }
    ctx.restore();
  }
}

function objRadiusPx(p) {
  const def = SOLIDS[p.kind];
  if (!def) return Math.max(3, 0.4 * (p.s || 1) * view.scale);
  const d = Array.isArray(def) ? def[0] : def;
  const r = d.r !== undefined ? d.r : Math.max(d.w, d.d);
  return Math.max(3, r * (p.s || 1) * view.scale);
}

const treeR = () => Math.max(2.5, 0.35 * view.scale);

function drawObjects() {
  const P = S.plan;
  if (showTrees) {
    ctx.fillStyle = 'rgba(84,110,60,0.9)';
    for (const t of P.forestTrees) dot(toScreenX(t.x), toScreenY(t.z), treeR() * (t.s || 1));
  }
  P.places.forEach((p, i) => {
    const sx = toScreenX(p.x), sy = toScreenY(p.z);
    if (sx < -60 || sy < -60 || sx > LW + 60 || sy > LH + 60) return;
    const active = (hover && hover.type === 'place' && hover.i === i) ||
                   (S.sel && S.sel.type === 'place' && S.sel.i === i);
    ctx.fillStyle = colorFor(p.kind);
    ctx.globalAlpha = active ? 1 : 0.85;
    const def = SOLIDS[p.kind];
    if (def) {
      ctx.save();
      ctx.translate(sx, sy);
      solidPath(def, (p.s || 1) * view.scale, p.rotY || 0);
      ctx.restore();
    } else {
      dot(sx, sy, objRadiusPx(p));
    }
    ctx.globalAlpha = 1;
    // 朝向刻度（rotY=0 朝南 = 屏幕下方）
    ctx.strokeStyle = 'rgba(40,34,28,0.85)';
    ctx.lineWidth = 1.5;
    const r = objRadiusPx(p);
    line(sx, sy, sx + Math.sin(p.rotY || 0) * r * 0.9, sy + Math.cos(p.rotY || 0) * r * 0.9);
  });
}

export const degText = (rotY) => `${Math.round((((rotY || 0) * 180 / Math.PI) % 360 + 360) % 360)}°`;

/** 一条路的折点表（直线就是两个端点），与 roadPolyline 同口径但不带高程 */
export function roadVerts(rd) {
  return Array.isArray(rd.pts) ? rd.pts.map(([x, z]) => ({ x, z }))
    : [{ x: rd.x1, z: rd.z1 }, { x: rd.x2, z: rd.z2 }];
}

export function setRoadVert(rd, k, x, z) {
  if (Array.isArray(rd.pts)) rd.pts[k] = [x, z];
  else if (k === 0) { rd.x1 = x; rd.z1 = z; } else { rd.x2 = x; rd.z2 = z; }
}

function drawOverlay() {
  const sel = S.sel;
  if (!sel) return;
  if (sel.type === 'road') {
    const rd = S.plan.roads[sel.i];
    if (!rd) return;
    ctx.strokeStyle = '#ffd27a';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    strokeRoad(rd);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd27a';
    const vs = roadVerts(rd);
    for (const [k, v] of vs.entries()) dot(toScreenX(v.x), toScreenY(v.z), (k === 0 || k === vs.length - 1) ? 5 : 4);
    return;
  }
  if (sel.type === 'terrace' || sel.type === 'flight') return;   // 造成记录由 drawRelief 自己描红
  const p = sel.type === 'place' ? S.plan.places[sel.i] : S.plan.forestTrees[sel.i];
  if (!p) return;
  const sx = toScreenX(p.x), sy = toScreenY(p.z);
  const r = sel.type === 'place' ? objRadiusPx(p) : treeR() * (p.s || 1);
  ctx.strokeStyle = '#c94f4f';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sx, sy, r + 6, 0, 7); ctx.stroke();
  const hx = sx + Math.sin(p.rotY || 0) * (r + 18), hy = sy + Math.cos(p.rotY || 0) * (r + 18);
  ctx.strokeStyle = 'rgba(201,79,79,0.6)';
  line(sx, sy, hx, hy);
  ctx.fillStyle = '#c94f4f';
  dot(hx, hy, 5);
  ctx.fillStyle = 'rgba(247,243,234,0.94)';
  ctx.strokeStyle = 'rgba(74,66,56,0.4)';
  ctx.lineWidth = 1;
  ctx.font = '12px "Noto Sans JP", sans-serif';
  const info = sel.type === 'place' ? (kindInfo(p.kind)?.label || p.kind) : '森林装饰树';
  const tx = sx + r + 12, ty = sy - r - 10;
  ctx.fillRect(tx - 4, ty - 12, ctx.measureText(`${info} (0.0, 0.0) 0°`).width + 46, 17);
  ctx.strokeRect(tx - 4, ty - 12, ctx.measureText(`${info} (0.0, 0.0) 0°`).width + 46, 17);
  ctx.fillStyle = '#4a4238';
  ctx.fillText(`${info} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) 朝${degText(p.rotY)}`, tx, ty);
}

// ---------- 命中测试（px/py 为 CSS 像素，相对 canvas） ----------
export function hitTest(px, py) {
  const sel = S.sel;
  // 选中路的折点：先于一切（折点就画在路面上，晚测会被路身抢走）
  if (sel?.type === 'road') {
    const rd = S.plan.roads[sel.i];
    if (rd) {
      const vs = roadVerts(rd);
      for (let k = 0; k < vs.length; k++) {
        if (Math.hypot(px - toScreenX(vs[k].x), py - toScreenY(vs[k].z)) < 10) {
          return { mode: 'vertex', target: { type: 'road', i: sel.i, k } };
        }
      }
    }
  }
  if (sel && (sel.type === 'place' || sel.type === 'tree')) {
    const q = sel.type === 'place' ? S.plan.places[sel.i] : S.plan.forestTrees[sel.i];
    if (q) {
      const r = (sel.type === 'place' ? objRadiusPx(q) : treeR() * (q.s || 1)) + 18;
      if (Math.hypot(px - (toScreenX(q.x) + Math.sin(q.rotY || 0) * r),
                     py - (toScreenY(q.z) + Math.cos(q.rotY || 0) * r)) < 11) {
        return { mode: 'rotate', target: sel };
      }
    }
  }
  for (let i = S.plan.places.length - 1; i >= 0; i--) {
    const q = S.plan.places[i];
    if (Math.hypot(px - toScreenX(q.x), py - toScreenY(q.z)) < objRadiusPx(q) + 4) {
      return { mode: 'object', target: { type: 'place', i } };
    }
  }
  if (showTrees) {
    for (let i = S.plan.forestTrees.length - 1; i >= 0; i--) {
      const q = S.plan.forestTrees[i];
      if (Math.hypot(px - toScreenX(q.x), py - toScreenY(q.z)) < treeR() * (q.s || 1) + 3) {
        return { mode: 'object', target: { type: 'tree', i } };
      }
    }
  }
  for (let i = 0; i < S.plan.roads.length; i++) {
    const rd = S.plan.roads[i];
    const q = toPlan(px, py);
    if (distToRoad(rd, q.x, q.z) < rd.w + 6 / view.scale) {
      return { mode: 'road', target: { type: 'road', i } };
    }
  }
  return { mode: 'none', target: null };
}

export function objOf(sel) {
  if (!sel) return null;
  if (sel.type === 'place') return S.plan.places[sel.i];
  if (sel.type === 'tree') return S.plan.forestTrees[sel.i];
  if (sel.type === 'terrace') return S.plan.terraces?.[sel.i];
  if (sel.type === 'flight') return S.plan.flights?.[sel.i];
  return S.plan.roads[sel.i];
}

const snap = (v, step) => Math.round(v / step) * step;

// 待放置的 kind（调色板点选后由 app.js 设置）；命中画布即落子
let armedKind = null;
export const setArmed = (k) => { armedKind = k; };
export const getArmed = () => armedKind;

// ---------- 交互 ----------
export function attach2d({ onSelect, onEdited, onHover, onPlace }) {
  cv.addEventListener('pointerdown', (e) => {
    // 捕获失败（合成事件/无活动指针）不应让点击整体失效
    try { cv.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const px = e.offsetX, py = e.offsetY;
    if (e.button === 2 || e.button === 1) {
      drag = { mode: 'pan', px, py, cx: view.cx, cz: view.cz };
      return;
    }
    if (armedKind && e.button === 0) {
      const p = toPlan(px, py);
      snapshot();               // 先扣「放置前」，撤销一步即拿掉新物件
      onPlace?.(armedKind, snap(p.x, 0.1), snap(p.z, 0.1));
      return;
    }
    const hit = hitTest(px, py);
    if (hit.mode === 'rotate') {
      snapshot();               // 撤销一步 = 回到本次旋转开始前
      drag = { mode: 'rotate', sel: hit.target };
    } else if (hit.mode === 'vertex') {
      snapshot();               // 撤销一步 = 回到拖这个折点之前
      drag = { mode: 'vertex', target: hit.target, start: toPlan(px, py), orig: roadVerts(S.plan.roads[hit.target.i]), moved: false };
    } else if (hit.mode === 'object' || hit.mode === 'road') {
      snapshot();               // 撤销一步 = 回到本次拖动开始前（连续微移由快照合并收成一条）
      S.sel = hit.target;
      onSelect?.();
      drag = { mode: 'move', target: hit.target, start: toPlan(px, py), orig: structuredClone(objOf(hit.target)), moved: false };
      render2d();
    } else {
      S.sel = null;
      onSelect?.();
      render2d();
    }
  });

  cv.addEventListener('pointermove', (e) => {
    const px = e.offsetX, py = e.offsetY;
    if (!drag) {
      const hit = hitTest(px, py);
      const h = hit.mode === 'object' || hit.mode === 'road' ? hit.target : null;
      const changed = JSON.stringify(h) !== JSON.stringify(hover);
      hover = h;
      cv.style.cursor = hit.mode === 'rotate' ? 'crosshair' : hit.mode === 'none' ? 'default' : 'grab';
      if (changed) { onHover?.(hit.mode); render2d(); }
      return;
    }
    if (drag.mode === 'pan') {
      view.cx = drag.cx - (px - drag.px) / view.scale;
      view.cz = drag.cz - (py - drag.py) / view.scale;
      render2d();
      return;
    }
    const p = toPlan(px, py);
    const step = e.altKey ? 0.5 : 0.1;
    if (drag.mode === 'move') {
      const o = objOf(drag.target);
      const dx = p.x - drag.start.x, dz = p.z - drag.start.z;
      if (drag.target.type === 'road') {
        // 整条路平移：直线动两端，折线逐点走（这条路没有 x/z，硬写会留下脏字段）
        roadVerts(drag.orig).forEach((v, k) => setRoadVert(o, k, snap(v.x + dx, step), snap(v.z + dz, step)));
      } else {
        o.x = snap(drag.orig.x + dx, step);
        o.z = snap(drag.orig.z + dz, step);
      }
      drag.moved = true;
      onEdited?.();
      render2d();
    } else if (drag.mode === 'vertex') {
      const rd = S.plan.roads[drag.target.i];
      const v = drag.orig[drag.target.k];
      setRoadVert(rd, drag.target.k, snap(v.x + (p.x - drag.start.x), step), snap(v.z + (p.z - drag.start.z), step));
      drag.moved = true;
      onEdited?.();
      render2d();
    } else if (drag.mode === 'rotate') {
      const o = objOf(drag.sel);
      const deg = Math.round(Math.atan2(px - toScreenX(o.x), py - toScreenY(o.z)) * 180 / Math.PI / 5) * 5;
      o.rotY = ((deg % 360) + 360) % 360 * Math.PI / 180;
      onEdited?.();
      render2d();
    }
  });

  const end = () => {
    if (!drag) return;
    if (drag.mode === 'move' || drag.mode === 'rotate' || drag.mode === 'vertex') {
      if (drag.mode !== 'rotate' && !drag.moved) dropLastSnapshot();
      emit();
    }
    drag = null;
    render2d();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!drag) { hover = null; render2d(); } });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = toPlan(e.offsetX, e.offsetY);
    view.scale = Math.min(80, Math.max(4, view.scale * Math.exp(-e.deltaY * 0.0012)));
    const after = toPlan(e.offsetX, e.offsetY);
    view.cx += before.x - after.x;
    view.cz += before.z - after.z;
    render2d();
  }, { passive: false });
}

export function setSel(sel) { S.sel = sel; render2d(); }

export function focusOn(x, z) {  view.cx = x; view.cz = z;
  view.scale = Math.max(view.scale, 18);
  render2d();
}

export function fitView() {
  // 地形底画的就是 plan 的 ±32 见方，按当前画布短边算比例才真叫「归位」
  // 小窗口里照旧给 14 会把地图四周裁掉（413 高的画布只能容 29 米）
  view.cx = 0; view.cz = 1;
  view.scale = Math.max(2, Math.min(LW, LH) / 68);
  render2d();
}

export function setShowTrees(v) { showTrees = v; }

export function resize2d() {
  // 量父容器而非 canvas：塌陷/隐藏时 canvas 会报 300x150 的内禀尺寸
  const box = (cv.parentElement || cv).getBoundingClientRect();
  LW = box.width > 40 ? box.width : Math.max(300, innerWidth - 476);
  LH = box.height > 40 ? box.height : Math.max(200, (innerHeight - 130) / 2);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(LW * dpr);
  cv.height = Math.round(LH * dpr);
  render2d();
}
