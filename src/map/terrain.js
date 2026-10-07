// terrain.js — 高程场（造成 / 土方）：纯函数，不 import three，浏览器与 Node 工具共用。
//
// 地面高度 = 自然丘陵 hills + 人工 relief。relief 由三类记录组成，全用 plan 坐标（米）：
//   roads[i]          —— 道路：直线段 {x1,z1,x2,z2} 或折线 {pts:[[x,z],…]}；
//                        抬升 e1/e2（直线）或 e:[…]（折线逐节点）＝相对自然地面，正=路堤负=堑沟
//   terraces[i]       —— 台地（造成地块）：旋转矩形，顶面 = 自然地面 + h，边缘 wall（垂直挡墙）或 slope（放坡）
//   flights[i]        —— 梯道/坡道：从 (x,z) 坡脚沿局部 +z 延伸 run，抬到 rise；stair 量化成踢面，ramp 线性
//
// rotY 与 layout.planQuat 同口径：局部 +z → plan (sinθ, cosθ)，局部 +x → (cosθ, −sinθ)。
// 谁读这张场：planet.js（网格位移只用 hills+路堤，台地交给实体几何）、town.js（落位高度）、
// player/cat.js（可走面）、collision.js（挡墙碰撞）、editor/view2d.js（明暗与符号）。

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export const ROAD_SURFACES = ['asphalt', 'cobble', 'brick', 'gravel'];

/** 道路 → 折线节点表 [{x,z,e}]（直线段是它的两个端点），全场共用这一个口径 */
export function roadPolyline(r) {
  if (Array.isArray(r.pts) && r.pts.length >= 2) {
    const e = Array.isArray(r.e) ? r.e : [];
    return r.pts.map((p, i) => ({ x: +p[0], z: +p[1], e: e[i] ?? 0 }));
  }
  return [{ x: r.x1, z: r.z1, e: r.e1 || 0 }, { x: r.x2, z: r.z2, e: r.e2 || 0 }];
}

/** 折线总长（米） */
export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}

/** 补齐 v2/v3 可选字段，返回同一个 plan（不深拷，调用方负责） */
export function ensureRelief(plan) {
  plan.terraces ||= [];
  plan.flights ||= [];
  for (const r of plan.roads || []) {
    r.e1 ||= 0;
    r.e2 ||= 0;
  }
  return plan;
}

export function hasRelief(plan) {
  return !!(plan && ((plan.terraces && plan.terraces.length) || (plan.flights && plan.flights.length)
    || (plan.roads || []).some((r) => (r.e1 || r.e2 || (r.e || []).some((v) => v)))));
}

/** 局部坐标 → plan 偏移 */
export function localToPlan(x, z, rotY, lx, lz) {
  const c = Math.cos(rotY || 0), s = Math.sin(rotY || 0);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

/** plan 偏移 → 局部坐标（localToPlan 的严格逆） */
export function planToLocal(x, z, rotY, px, pz) {
  const c = Math.cos(rotY || 0), s = Math.sin(rotY || 0);
  const dx = px - x, dz = pz - z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

// ---------- 道路折线：一次预处理，高程/贴图/体检/编辑器共用 ----------
/**
 * 把道路表折成线段表（带包围盒与沿线高程），省掉每个采样点重复算三角。
 * 返回项：{ r, pts, segs, w, len, on, band, fade, bx1, bx2, bz1, bz2 }
 */
export function prepareRoads(roads, sidewalkW = 1.35) {
  return (roads || []).map((r) => {
    const pts = roadPolyline(r);
    const segs = [];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const len = Math.sqrt(len2) || 1e-6;
      segs.push({ x1: a.x, z1: a.z, dx, dz, len2: len2 || 1e-6, len, e1: a.e, de: b.e - a.e, s0: acc });
      acc += len;
    }
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
    const band = (r.w || 2) + sidewalkW;
    return {
      r, pts, segs, w: r.w || 2, len: acc || 1e-6,
      on: !!(pts.some((p) => p.e) || r.e1 || r.e2),
      band, fade: r.efade ?? 3.0,
      bx1: Math.min(...xs) - 8, bx2: Math.max(...xs) + 8,
      bz1: Math.min(...zs) - 8, bz2: Math.max(...zs) + 8,
    };
  });
}

/** 点到这条（已 prepare 的）路的最近结果：横向距离 d、沿线位置 t∈[0,1]、该处抬升 e */
export function roadNear(pr, x, z) {
  if (x < pr.bx1 || x > pr.bx2 || z < pr.bz1 || z > pr.bz2) return null;
  let bd = Infinity, bt = 0, be = 0;
  for (const s of pr.segs) {
    let u = ((x - s.x1) * s.dx + (z - s.z1) * s.dz) / s.len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const d = Math.hypot(x - (s.x1 + s.dx * u), z - (s.z1 + s.dz * u));
    if (d < bd) { bd = d; bt = (s.s0 + s.len * u) / pr.len; be = s.e1 + s.de * u; }
  }
  return { d: bd, t: bt, e: be };
}

/** 点到道路（折线）的距离，无 prepare 时用这个 */
export function distToRoad(r, x, z) {
  const pts = roadPolyline(r);
  let bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1e-6;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    bd = Math.min(bd, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return bd;
}

/** 沿道路折线按步长取样（体检与编辑器用） */
export function roadSamples(r, step = 0.5) {
  const pts = roadPolyline(r);
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const last = pts[pts.length - 1];
  out.push({ x: last.x, z: last.z });
  return out;
}

/**
 * 由「到中心线的横向距离」算一条路对这个点的归属感：路带（w+人行道）内 1，裙边 smooth 衰减到 0。
 * roadElev 与机检工具共用这一个口径，否则工具会自己臆造一套「什么算路口污染」。
 */
export function influenceK(d, band, fade) {
  if (d > band + fade) return 0;
  return d <= band ? 1 : 1 - smooth01((d - band) / fade);
}

/** 台地的抬升系数 k∈[0,1]：台面内 1，放坡边缘过渡，垂直边 0 */
function terraceK(tc, x, z) {
  const { lx, lz } = planToLocal(tc.x, tc.z, tc.rotY, x, z);
  const hw = tc.hw, hd = tc.hd;
  // 台地自己的边算内侧：几何把节点和压顶正好摆在 hw/hd 上，浮点零头会判成外侧 → 台面 rim 掉回自然地面
  const du = Math.max(0, Math.abs(lx) - hw - 1e-6);
  const dv = Math.max(0, Math.abs(lz) - hd - 1e-6);
  if (du === 0 && dv === 0) return 1;
  if ((tc.edge || 'wall') === 'wall') return 0;
  const ap = tc.apron ?? 1.6;
  if (du > ap || dv > ap) return 0;
  return 1 - smooth01(Math.hypot(du, dv) / ap);
}

/** 台面绝对高程：以台地中心的自然地面为基准抬 h —— 整块台面是水平填方，不是跟着山歪的壳 */
export function deckLevel(hillsH, tc) {
  return hillsH(tc.x, tc.z) + (tc.h || 0);
}

/** 梯道/坡道第 k 档（0=坡脚 1=坡顶）的绝对高程：坡脚踩在坡脚处的自然地面上 */
export function flightLevel(hillsH, fl, k) {
  return hillsH(fl.x, fl.z) + (fl.rise || 0) * k;
}

/**
 * 这条梯道是不是真接上了这块台地顶：顶标高对得上（±15 厘米）才算。
 * 挡墙开口、挡墙碰撞、地图体检三处共用同一个口径，否则会出现「墙上开了口但碰撞还挡着」。
 */
export function flightFeedsTerrace(hillsH, tc, fl) {
  return Math.abs(flightLevel(hillsH, fl, 1) - deckLevel(hillsH, tc)) <= 0.15;
}

/** 第 i 阶踏面的踩面高度系数：站在这阶上就是这阶的顶面，所以 +1 */
export function stairK(p, steps) {
  return Math.min(1, (Math.floor(p * steps) + 1) / steps);
}

/** 梯道/坡道的抬升系数 k∈[0,1]；不在坡面矩形内返回 -1 */
function flightK(fl, x, z) {
  const { lx, lz } = planToLocal(fl.x, fl.z, fl.rotY, x, z);
  const hw = (fl.w || 1.5) / 2;
  if (Math.abs(lx) > hw || lz < -0.001 || lz > fl.run) return -1;
  const p = Math.min(1, lz / fl.run);
  if ((fl.kind || 'stair') === 'ramp') return p;
  return stairK(p, Math.max(1, Math.round(fl.steps || Math.round(fl.run / 0.34))));
}

/**
 * 造一个高程场。plan 里的数值改了要重新造（编辑器每轮预览重建一次）。
 * meshHeight 只含 hills + 路堤（低频，粗网格画得住）；surfaceHeight 含全部 relief，
 * 是玩家与物件真正踩到的面。
 */
export function makeField(plan) {
  const hills = plan.hills || [];
  const roads = plan.roads || [];
  const terraces = plan.terraces || [];
  const flights = plan.flights || [];
  const sw = plan.sidewalkW ?? 1.35;

  // 预计算，避免每个像素重复三角函数
  const H = hills.map((hl) => ({ x: hl.x, z: hl.z, a: hl.a, i2: 1 / (2 * hl.s * hl.s) }));
  const Rd = prepareRoads(roads, sw);
  const Tc = terraces.map((t) => ({
    ...t, edge: t.edge || 'wall',
    rx: Math.hypot(t.hw, t.hd) + (t.apron || 0),
    deck: hillsH(t.x, t.z) + (t.h || 0),
  }));
  const Fl = flights.map((f) => ({
    ...f, rx: Math.hypot((f.w || 1.5) / 2, f.run) + 0.5, base: hillsH(f.x, f.z),
  }));

  function hillsH(x, z) {
    let h = 0;
    for (const hl of H) {
      const dx = x - hl.x, dz = z - hl.z;
      h += hl.a * Math.exp(-(dx * dx + dz * dz) * hl.i2);
    }
    return h;
  }

  function roadElev(x, z) {
    // 多条路在这里相遇：按各自的过渡系数 k 加权平均，再乘「至少一条路罩着」的覆盖度。
    // 为什么不能像以前那样「谁近听谁的」：两条设计标高不同的路在路带重叠处硬切换，
    // 切换线就是一道 0.7~0.9 米的垂直坎，猫走过去等于瞬移上台/下台。加权平均在空间上连续，
    // 路口板落在两者之间； lone 路仍是 e*k（乘覆盖度那一步保证裙边外照旧归零）。
    // 全零抬升的路不参与（on=false）：一条平路不该把旁边的高路堤拽回地面。
    let num = 0, den = 0, uncovered = 1;
    for (const r of Rd) {
      if (!r.on) continue;
      const np = roadNear(r, x, z);
      if (!np || np.d > r.band + r.fade) continue;
      const k = influenceK(np.d, r.band, r.fade);
      const w = k * k;
      num += w * np.e;
      den += w;
      uncovered *= (1 - k);
    }
    return den ? (num / den) * (1 - uncovered) : 0;
  }

  function relief(x, z) {
    // 1) 梯道/坡道优先：坡面矩形内完全由它决定（实体台阶就是照这条 profile 出的，
    //    再和路堤取 max 就会对不上，猫会踩空）
    for (const f of Fl) {
      if (Math.abs(x - f.x) > f.rx || Math.abs(z - f.z) > f.rx) continue;
      const k = flightK(f, x, z);
      if (k >= 0) return Math.max(0, f.base + f.rise * k - hillsH(x, z));   // 每阶顶都是水平面
    }
    let best = roadElev(x, z);
    for (const t of Tc) {
      if (Math.abs(x - t.x) > t.rx || Math.abs(z - t.z) > t.rx) continue;
      const k = terraceK(t, x, z);
      if (k <= 0) continue;
      // 填方只加不减：台面低于自然地面的那一侧就地贴地，免得实体面沉进星球网格里
      const v = Math.max(0, k * (t.deck - hillsH(x, z)));
      if (v > best) best = v;
    }
    return best;
  }

  function surface(x, z) {
    return hillsH(x, z) + relief(x, z);
  }

  function mesh(x, z) {
    return hillsH(x, z) + roadElev(x, z);
  }

  /** 该点属于哪块台地（编辑器/几何生成用）；返回 {tc,k} 或 null */
  function terraceAt(x, z) {
    let best = null, bk = 0;
    for (const t of Tc) {
      if (Math.abs(x - t.x) > t.rx || Math.abs(z - t.z) > t.rx) continue;
      const k = terraceK(t, x, z);
      if (k > bk) { bk = k; best = t; }
    }
    return best ? { tc: best, k: bk } : null;
  }

  function flightAt(x, z) {
    for (const f of Fl) {
      if (Math.abs(x - f.x) > f.rx || Math.abs(z - f.z) > f.rx) continue;
      const k = flightK(f, x, z);
      if (k >= 0) return { fl: f, k };
    }
    return null;
  }

  return { hillsH, roadElev, relief, surface, mesh, terraceAt, flightAt, roads: Rd, src: plan };
}

/** 记录的中心包围半径，供碰撞与体检粗筛 */
export function terraceBound(tc) {
  return Math.hypot(tc.hw, tc.hd) + (tc.edge === 'slope' ? (tc.apron ?? 1.6) : 0);
}
