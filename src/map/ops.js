// ops.js — 声明式改图操作（AI 接口、命令行工具、编辑器批量改外观三处共用同一套语义）
//
//   const { plan, report } = applyOps(PLAN, [{ op: 'place.style', where: { kind: 'mansion' }, floors: [3, 7], seed: 7 }]);
//
// 纯函数：不改传入的 plan（内部 structuredClone），返回新 plan + 逐条报告；不碰 DOM/three，
// 所以 Node 脚本、vite dev 中间件、浏览器编辑器都能直接 import。
//
// where 是筛选器（省略＝整表）：
//   kind / kinds      物件类型
//   surf              道路路面材质
//   word              词条 id
//   ids               数组下标白名单
//   box: [x1,z1,x2,z2]  plan 范围
//   near: {x,z,r}       离某点多近（米）
//   has: ['wall',…]     记录上必须已有这些字段
//   every: 0.5          按比例抽样（配 seed 可复现）
//   limit: 12           最多动几条（配 seed 随机取，否则取前 N 条）
//
// 表名 = place / tree / road / terrace / flight / hill；动作 = add / set / move / rotate / style / remove，
// 另有 place.scatter（沿街摆）与 plan.set（全局参数）。

import { roadPolyline, ROAD_SURFACES } from './terrain.js';
import { FLOOR_SPEC, clampFloors, hasFloors } from './style.js';

export const OPS_VERSION = 1;

const PLACE_KEYS = ['kind', 'word', 'x', 'z', 'rotY', 's', 'v', 'wall', 'roof', 'floors'];
const TREE_KEYS = ['kind', 'x', 'z', 'rotY', 's', 'v', 'word'];
const ROAD_KEYS = ['x1', 'z1', 'x2', 'z2', 'pts', 'e', 'w', 'e1', 'e2', 'efade', 'surf', 'word'];
const TC_KEYS = ['x', 'z', 'rotY', 'hw', 'hd', 'h', 'edge', 'apron', 'word'];
const FL_KEYS = ['x', 'z', 'rotY', 'w', 'run', 'rise', 'steps', 'kind', 'word'];
const HILL_KEYS = ['x', 'z', 'a', 's'];

const TABLES = {
  place: ['places', PLACE_KEYS],
  tree: ['forestTrees', TREE_KEYS],
  road: ['roads', ROAD_KEYS],
  terrace: ['terraces', TC_KEYS],
  flight: ['flights', FL_KEYS],
  hill: ['hills', HILL_KEYS],
};

const PLAN_PATHS = {
  sidewalkW: 'number', beachZ: 'number', forestLat: 'number',
  'plaza.x': 'number', 'plaza.z': 'number', 'plaza.r': 'number',
  'parking.x1': 'number', 'parking.z1': 'number', 'parking.x2': 'number', 'parking.z2': 'number',
  'R': 'number',
};

/** 确定性随机（同 seed 同结果，脚本与 AI 才能复现同一批改动作） */
export function rng(seed = 1) {
  let t = Math.abs(Math.trunc(seed)) || 1;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** 只收白名单字段；rotDeg→rotY 在这里换算，其余非数字一律丢，避免把 NaN 写进真源 */
function pick(src, keys) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of keys) {
    if (src[k] === undefined) continue;
    const v = src[k];
    if (k === 'pts') {
      if (Array.isArray(v) && v.length >= 2 && v.every((p) => Array.isArray(p) && finite(p[0]) !== null && finite(p[1]) !== null)) {
        out.pts = v.map((p) => [round6(p[0]), round6(p[1])]);
      }
      continue;
    }
    if (k === 'e') {
      if (Array.isArray(v) && v.every((n) => finite(n) !== null)) out.e = v.map(round6);
      continue;
    }
    if (k === 'surf') { if (ROAD_SURFACES.includes(v)) out.surf = v; continue; }
    if (k === 'edge') { if (v === 'wall' || v === 'slope') out.edge = v; continue; }
    if (k === 'kind' || k === 'word') { if (typeof v === 'string') out[k] = v; continue; }
    if (k === 'steps' || k === 'v') { const n = finite(v); if (n !== null) out[k] = Math.round(n); continue; }
    if (k === 'floors' || k === 'wall' || k === 'roof') { const n = finite(v); if (n !== null) out[k] = Math.round(n); continue; }
    const n = finite(v);
    if (n !== null) out[k] = round6(n);
  }
  if (finite(src.rotDeg) !== null) out.rotY = round6((src.rotDeg * Math.PI) / 180);
  return out;
}

function centerOf(rec) {
  if (finite(rec.x) !== null) return { x: rec.x, z: rec.z };
  if (finite(rec.x1) !== null) return { x: (rec.x1 + rec.x2) / 2, z: (rec.z1 + rec.z2) / 2 };
  const pts = roadPolyline(rec);
  return { x: pts[0].x, z: pts[0].z };
}

function matches(rec, f, i, rand) {
  if (!f || Object.keys(f).length === 0) return true;
  if (f.kind && rec.kind !== f.kind) return false;
  if (f.kinds && !f.kinds.includes(rec.kind)) return false;
  if (f.surf !== undefined && (rec.surf || 'asphalt') !== f.surf) return false;
  if (f.word && rec.word !== f.word) return false;
  if (Array.isArray(f.ids) && !f.ids.includes(i)) return false;
  if (Array.isArray(f.has) && !f.has.every((k) => rec[k] !== undefined)) return false;
  if (Array.isArray(f.box)) {
    const [x1, z1, x2, z2] = f.box;
    const c = centerOf(rec);
    if (c.x < x1 || c.x > x2 || c.z < z1 || c.z > z2) return false;
  }
  if (f.near) {
    const c = centerOf(rec);
    if (Math.hypot(c.x - f.near.x, c.z - f.near.z) > (f.near.r ?? 5)) return false;
  }
  if (finite(f.every) !== null && rand() > f.every) return false;
  return true;
}

/** 筛选 + limit（limit 超出命中数时：有 seed 就随机抽，否则按原顺序取前 N） */
function select(list, f, rand) {
  const hits = [];
  list.forEach((rec, i) => { if (matches(rec, f, i, rand)) hits.push(i); });
  const limit = finite(f?.limit) !== null ? Math.round(f.limit) : null;
  if (limit !== null && hits.length > limit) {
    if (rand) {
      for (let k = hits.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [hits[k], hits[j]] = [hits[j], hits[k]];
      }
    }
    return hits.slice(0, limit);
  }
  return hits;
}

/**
 * 值可以是标量，也可以是数组。
 * 数字字段：[a,b] = 区间随机，[a,b,c…] = 从候选里随机挑一个。
 * 色号（pickOnly）：数组一律当候选，两个色号就是二选一 —— 颜色插值只会调出脏色。
 */
function valueOf(v, rand, isInt = false, pickOnly = false) {
  if (Array.isArray(v)) {
    if (!pickOnly && v.length === 2 && v.every((n) => finite(n) !== null)) {
      const t = finite(v[0]) + rand() * (finite(v[1]) - finite(v[0]));
      return isInt ? Math.round(t) : round6(t);
    }
    if (!v.length) return null;
    return v[Math.floor(rand() * v.length) % v.length];
  }
  return v;
}

/** 批量改外观：外墙色/屋顶色/层数/编号/尺度，支持区间与候选随机。返回这条记录实际被改了哪些字段 */
function applyStyle(rec, o, rand) {
  const sp = FLOOR_SPEC[rec.kind];
  const did = [];
  for (const key of ['wall', 'roof']) {
    if (o[key] === undefined) continue;
    const v = valueOf(o[key], rand, true, true);
    if (finite(v) !== null) { rec[key] = clamp(Math.round(v), 0, 0xffffff); did.push(key); }
  }
  if (o.floors !== undefined && sp) {
    let v = o.floors;
    if (v === 'auto') v = sp.def;
    if (Array.isArray(v)) v = valueOf(v, rand, true);
    rec.floors = clampFloors(rec.kind, finite(v) ?? sp.def);
    did.push(`floors=${rec.floors}`);
  }
  if (o.v !== undefined) { rec.v = Math.round(valueOf(o.v, rand, true)); did.push('v'); }
  if (finite(o.s) !== null || Array.isArray(o.s)) { rec.s = round6(valueOf(o.s, rand)); did.push('s'); }
  return did;
}

/** 楼类字段收尾：层数夹进该 kind 的区间，不认层数的 kind 干脆不许带 floors；色号夹到 24 位 */
function sanitizePlace(rec) {
  for (const k of ['wall', 'roof']) if (rec[k] !== undefined) rec[k] = clamp(Math.round(rec[k]), 0, 0xffffff);
  if (rec.floors !== undefined) {
    if (!hasFloors(rec.kind)) delete rec.floors;
    else rec.floors = clampFloors(rec.kind, rec.floors);
  }
  return rec;
}

/** 整条道路平移（折线逐点走，直线走端点） */
function shiftRoad(rec, dx, dz) {
  if (Array.isArray(rec.pts)) rec.pts = rec.pts.map(([x, z]) => [round6(x + dx), round6(z + dz)]);
  if (finite(rec.x1) !== null) {
    rec.x1 = round6(rec.x1 + dx); rec.x2 = round6(rec.x2 + dx);
    rec.z1 = round6(rec.z1 + dz); rec.z2 = round6(rec.z2 + dz);
  }
}

const STRAIGHT_KEYS = ['x1', 'z1', 'x2', 'z2', 'e1', 'e2'];

/**
 * 道路形态收尾：真源里直线与折线二选一（validatePlan 见到 pts+x1 直接拒），
 * 但 road.set 只写调用方给的那几个键，记录上旧的另一套字段会留在原地。
 * 这里按「这次写了哪套」定谁让位，AI 才能用一套字段把直路改弯、把弯路拉直：
 *   写了 pts → 折线，直线端点删掉；没给逐节点高程就按原本 e1→e2 线性铺，别把坡度悄悄清零
 *   写了 x1/x2 而记录是折线 → 拉直，逐节点高程的首尾折回 e1/e2
 *   给直线写了 e → 同样折回 e1/e2
 * written 是这次真正落笔的键（add 时就是整条记录）。
 */
function normalizeRoadForm(rec, written = rec) {
  if (written.pts !== undefined) {
    if (!Array.isArray(rec.e)) {
      const a = finite(rec.e1) ?? 0, b = finite(rec.e2) ?? 0;
      const last = Math.max(1, rec.pts.length - 1);
      rec.e = rec.pts.map((_, i) => round6(a + ((b - a) * i) / last));
    }
    for (const k of STRAIGHT_KEYS) delete rec[k];
    return rec;
  }
  if (Array.isArray(rec.pts) && (written.x1 !== undefined || written.z1 !== undefined || written.x2 !== undefined || written.z2 !== undefined)) {
    const es = Array.isArray(rec.e) ? rec.e : [];
    if (finite(rec.e1) === null) rec.e1 = round6(es[0] ?? 0);
    if (finite(rec.e2) === null) rec.e2 = round6(es[rec.pts.length - 1] ?? es[es.length - 1] ?? 0);
    delete rec.pts;
    delete rec.e;
    return rec;
  }
  if (Array.isArray(rec.e) && rec.e.length) {
    const head = round6(rec.e[0]), tail = round6(rec.e[rec.e.length - 1]);
    // 这次写了 e 就是照折线口径下的令，首尾要盖掉旧的 e1/e2；没写 e 只是顺手清形态时才保留原值
    rec.e1 = finite(written.e1) ?? (written.e === undefined ? (finite(rec.e1) ?? head) : head);
    rec.e2 = finite(written.e2) ?? (written.e === undefined ? (finite(rec.e2) ?? tail) : tail);
    delete rec.e;
  }
  return rec;
}

/** 折线按间距取样，附法向与朝向（rotY 口径同 planQuat：atan2(ux,uz)） */
export function polylineSamples(pts, step) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.round(len / step));
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: uz, nz: -ux, rotY: Math.atan2(ux, uz) });
    }
  }
  return out;
}

/** 只筛不改，返回命中的下标：面板实时显示「这批有几个」，AI 也能先查再动（同 seed 同结果） */
export function findHits(list, where = {}, seed = 1) {
  return select(Array.isArray(list) ? list : [], where, rng(seed));
}

/**
 * 应用一串 op。
 * 返回 { plan, report:{ changed, changes:[{op,table,n,msg}], errors:[] } }；
 * op 写错只记 error 并跳过，绝不半改就把整张图写坏。
 */
export function applyOps(input, ops, opts = {}) {
  const plan = structuredClone(input);
  const changes = [];
  const errors = [];
  let changed = false;
  let seq = 0;

  const run = (o, k) => {
    const op = String(o.op || '');
    const dot = op.indexOf('.');
    const table = dot < 0 ? op : op.slice(0, dot);
    const action = dot < 0 ? '' : op.slice(dot + 1);
    // 每条 op 一条随机流：写了 seed 就用它（同 seed 同结果），没写就用序号，保证两次跑同一串 op 一模一样
    const rand = rng(o.seed ?? ++seq);

    if (op === 'plan.set') {
      const kind = PLAN_PATHS[o.path];
      if (!kind) { errors.push(`#${k} plan.set 不支持路径 "${o.path}"`); return; }
      if (typeof o.value !== kind) { errors.push(`#${k} ${o.path} 要填 ${kind}`); return; }
      const [head, leaf] = o.path.split('.');
      if (!leaf) plan[head] = o.value;
      else { plan[head] ||= {}; plan[head][leaf] = o.value; }
      changes.push({ op, table: 'plan', n: 1, msg: `${o.path} = ${o.value}` });
      changed = true;
      return;
    }

    const spec = TABLES[table];
    if (!spec) { errors.push(`#${k} 不认识的操作 "${op}"（表名只能是 ${Object.keys(TABLES).join('/')}）`); return; }
    const [key, keys] = spec;
    plan[key] = Array.isArray(plan[key]) ? plan[key] : [];
    const arr = plan[key];

    if (action === 'add') {
      const rec = pick(o.rec ?? o.place ?? o.road ?? o.record ?? {}, keys);
      if (!Object.keys(rec).length) { errors.push(`#${k} ${op} 没给可写的字段`); return; }
      arr.push(table === 'place' ? sanitizePlace(rec) : table === 'road' ? normalizeRoadForm(rec) : rec);
      changes.push({ op, table, n: 1, msg: `${table} 新增 1 条（现共 ${arr.length}）` });
      changed = true;
      return;
    }
    if (action === 'remove') {
      const hits = select(arr, o.where, rand);
      for (let j = hits.length - 1; j >= 0; j--) arr.splice(hits[j], 1);
      changes.push({ op, table, n: hits.length, msg: `${table} 删掉 ${hits.length} 条` });
      changed = hits.length > 0;
      return;
    }
    if (action === 'scatter') {
      if (table !== 'place') { errors.push(`#${k} 只有 place 表能 scatter`); return; }
      const kind = o.kind || o.rec?.kind;
      if (!kind) { errors.push(`#${k} place.scatter 要写 kind`); return; }
      const roads = select(plan.roads || [], o.where, rand);
      if (!roads.length) { errors.push(`#${k} place.scatter 的 where 没筛到任何道路`); return; }
      const step = clamp(finite(o.step) ?? 6, 1.5, 60);
      const off = finite(o.offset) ?? 3.2;
      const minGap = finite(o.minGap) ?? 1.2;
      const maxZ = (finite(plan.beachZ) ?? 24) - 1.5;   // 别把街具摆进沙滩/海里
      const extra = pick(o.rec || {}, keys);
      let placed = 0;
      for (const ri of roads) {
        const rd = plan.roads[ri];
        for (const pt of polylineSamples(roadPolyline(rd), step)) {
          for (const sgn of o.sides === 1 ? [1] : [1, -1]) {
            const x = round6(pt.x + pt.nx * off * sgn), z = round6(pt.z + pt.nz * off * sgn);
            if (z > maxZ) continue;
            if (plan.places.some((p) => Math.hypot(p.x - x, p.z - z) < minGap)) continue;
            plan.places.push(sanitizePlace({ ...extra, kind, x, z, rotY: round6(pt.rotY + (sgn > 0 ? 0 : Math.PI)) }));
            placed++;
          }
        }
      }
      if (!placed) { errors.push(`#${k} place.scatter 一个都没摆下（${roads.length} 条路沿线全被已有物件占了？试试加大 step/offset）`); return; }
      changes.push({ op, table: 'place', n: placed, msg: `沿街摆了 ${placed} 个 ${kind}` });
      changed = true;
      return;
    }
    if (action === 'set' || action === 'move' || action === 'rotate' || action === 'style') {
      const set = action === 'set' ? pick(o.set ?? o, keys) : {};
      if (action === 'set' && !Object.keys(set).length) {
        // set 里全是非法值时 pick 会清空，光说「没给字段」会把人绕晕，得把丢掉的键名报出来
        const given = o.set && typeof o.set === 'object' ? Object.keys(o.set) : [];
        errors.push(`#${k} ${op} ${given.length
          ? `的 set 里没有能写的值（给了 ${given.join('/')}；可写字段是 ${keys.join('/')}，非数字的值一律拒）`
          : '没给要写的字段（set:{…}）'}`);
        return;
      }
      const hits = select(arr, o.where, rand);
      // 筛到 0 条基本等于筛选器写错了（AI 最容易犯的就是 kind 拼错），必须让它响，不能悄悄过
      if (!hits.length) { errors.push(`#${k} ${op} 的 where 在 ${table} 表里没筛到任何东西（${JSON.stringify(o.where ?? {})}）`); return; }
      let n = 0;
      const notes = [];
      for (const i of hits) {
        const rec = arr[i];
        if (action === 'move') {
          const dx = finite(o.dx) ?? 0, dz = finite(o.dz) ?? 0;
          if (table === 'road' && (dx || dz)) { shiftRoad(rec, dx, dz); n++; continue; }
          if (finite(o.x) !== null) rec.x = round6(o.x); else if (dx) rec.x = round6((rec.x ?? 0) + dx);
          if (finite(o.z) !== null) rec.z = round6(o.z); else if (dz) rec.z = round6((rec.z ?? 0) + dz);
        } else if (action === 'rotate') {
          const deg = finite(o.deg) ?? 0;
          if (finite(o.rotDeg) !== null && !deg) rec.rotY = round6((o.rotDeg * Math.PI) / 180);
          else rec.rotY = round6(((rec.rotY || 0) + (deg * Math.PI) / 180) % (Math.PI * 2));
        } else if (action === 'style') {
          if (table !== 'place') { errors.push(`#${k} 只有 place 表能 style（道路用 road.set）`); return; }
          const did = applyStyle(rec, o, rand);
          if (!did.length) continue;            // 这条改不动（比如平层小物件没有层数），别算进 n
          for (const d of did) notes.push(d);
        } else {
          for (const [k2, v2] of Object.entries(set)) rec[k2] = v2;
          if (table === 'place') sanitizePlace(rec);
          else if (table === 'road') normalizeRoadForm(rec, set);
        }
        n++;
      }
      if (action === 'style' && n === 0 && hits.length) {
        errors.push(`#${k} place.style 没改到东西：命中的 ${hits.length} 条都没有这些外观字段（wall/roof/floors/v/s，层数只有 ${Object.keys(FLOOR_SPEC).join('/')} 有）`);
        return;
      }
      const uniq = [...new Set(notes)];
      changes.push({ op, table, n, msg: uniq.length ? `${table} 改了 ${n} 条：${uniq.join('/')}` : `${table} 改了 ${n} 条` });
      changed = n > 0;
      return;
    }
    errors.push(`#${k} "${table}" 没有 "${action || '（空动作）'}" 这个动作（可用 add/set/move/rotate/style/remove/scatter）`);
  };

  (Array.isArray(ops) ? ops : []).forEach(run);
  return { plan, report: { version: OPS_VERSION, changed, changes, errors } };
}

/** 筛选器说明书：GET /__plan/ops 一并吐出，AI 不用翻源码才知道 where 能写什么 */
export const WHERE_DOC = {
  kind: '物件类型（place/tree/flight）',
  kinds: '类型数组，命中其中之一',
  surf: '道路路面材质（asphalt/cobble/brick/gravel）',
  word: '词条 id',
  ids: '数组下标白名单，如 [0,3]',
  has: '记录上必须已有这些字段，如 ["wall"]',
  box: '[x1,z1,x2,z2] plan 范围（米）',
  near: '{x,z,r} 离某点多近（米）',
  every: '0~1 按比例抽样（配 seed 可复现）',
  limit: '最多动几条（配 seed 随机取，否则取前 N 条）',
};

export const OPS_RULES = [
  'applyOps 是纯函数：同 plan + 同 ops + 同 seed 永远得到逐字节相同的结果',
  'where 省略＝整表；筛到 0 条一律报错，不静默空转',
  '字段名只能写白名单内的，非数字的值会被拒并报错',
  '落盘方（dev 端点 / 命令行）有一条 op 报错就整批不写，避免改到一半',
  '层数只有 ' + Object.keys(FLOOR_SPEC).join('/') + ' 有，且夹在各自的 min~max 内',
];

/** op 清单：文档、编辑器菜单与 AI 说明书都由这一份生成，避免三处各写一套 */
export const OPS_DOC = [
  { op: 'place.add', args: 'rec:{kind,x,z,rotY|rotDeg,s,v,word,wall,roof,floors}', note: '放一个物件' },
  { op: 'place.set', args: 'where, set:{字段…}', note: '按筛选器改任意字段' },
  { op: 'place.move', args: 'where, dx,dz 或 x,z', note: '平移' },
  { op: 'place.rotate', args: 'where, deg（增量）或 rotDeg（绝对）', note: '改朝向' },
  { op: 'place.style', args: 'where, wall/roof(色号或色号数组＝随机挑一个), floors(数字/[最矮,最高]区间随机/"auto"), v, s, seed', note: '批量改外观与层数' },
  { op: 'place.remove', args: 'where', note: '删除' },
  { op: 'place.scatter', args: 'where(筛道路), kind, step, offset, sides, minGap, rec, seed', note: '沿街自动摆' },
  { op: 'tree.add|set|move|remove', args: '同 place（字段 kind,x,z,rotY,s,v）', note: '森林装饰树' },
  { op: 'road.add|set|move|remove', args: '字段 x1,z1,x2,z2 或 pts[[x,z]…], e[e…], w, e1,e2,efade, surf', note: '道路：写 pts 就按折线走（旧的直线端点自动删，e 缺省按原 e1→e2 逐节点铺）；写 x1/x2 就把折线拉直（e 首尾折回 e1/e2）' },
  { op: 'terrace.add|set|move|remove', args: '字段 x,z,rotY,hw,hd,h,edge,apron,word', note: '台地（造成）' },
  { op: 'flight.add|set|move|remove', args: '字段 x,z,rotY,w,run,rise,steps,kind,word', note: '石阶/坡道' },
  { op: 'hill.add|set|remove', args: '字段 x,z,a,s', note: '自然丘陵' },
  { op: 'plan.set', args: `path(${Object.keys(PLAN_PATHS).join(', ')}), value`, note: '全局参数' },
];
