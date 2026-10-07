// generate-town.mjs — 地图生成器：把「起伏的路面 + 交点同高 + 沿街净空 + 高楼」一次算出来
// 用法：
//   npx vite-node tools/generate-town.mjs --seed 7                # 只算，打到 stdout（不写盘）
//   npx vite-node tools/generate-town.mjs --seed 7 --out /tmp/x.json
//   npx vite-node tools/generate-town.mjs --seed 7 --write        # 备份后写回 data/town-plan.json
//
// 生成器以现有真源为底（保留词条与街具位置），重做三件事：
//   1) 每条路一条起伏的纵向剖面（seed 驱动的正弦 + 缓坡），并把折线节点、路口分段点都补成可控点
//   2) 路口同高：两条路的行车面带一旦重叠，重叠段内所有控制点被松弛到同一个水平
//      —— 高程场在路口按归属权重连续混合（terrain.js 的 roadElev），不同高也不会再留垂直坎，
//         但混合出来的路口板会斜着翘；把重叠段松弛成同高，路口就是一块水平板，猫走进去不掉高
//   3) 沿街净空：只把真咬进行车面的东西（碰撞盒越过道牙）沿法向让到车道外沿
//      —— 人行道上的路灯、长椅、售货机是设定，不许推；只有车能停在行车面上，站房压路也得让位
// 出图后必须过 tools/road-walk.mjs 那道闸门（每步落差 ≤ 0.15 米、行车面无压占、设计抬升落地）。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLAN as DISK, makeField, SOLIDS } from '../src/world/layout.js';
import { roadPolyline, distToRoad } from '../src/map/terrain.js';
import { validatePlan } from '../src/map/schema.js';
import { checkPlan } from '../src/editor/problems.js';
import { serializePlan } from '../src/editor/state.js';
import { FLOOR_SPEC, clampFloors, hasFloors } from '../src/map/style.js';
import { rng } from '../src/map/ops.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const SEED = Number(flag('--seed', 7));
const OUT = flag('--out', null);
const WRITE = argv.includes('--write');
// --clear-only：只沿街让位（§4），不重做剖面/材质/层数 —— 手写图不想被重排但需要清行车面时用这条
const CLEAR_ONLY = argv.includes('--clear-only');

const plan = JSON.parse(readFileSync('data/town-plan.json', 'utf8'));
const SW = plan.sidewalkW ?? 1.35;
const field = makeField(plan);
const rand = rng(SEED);

// ---------- 1) 每条路：沿中心线布控制点（原顶点 + 每 3 米一档 + 路口重叠段的两端） ----------
const stationsOf = (rd) => {
  const pl = roadPolyline(rd);
  const segs = [];
  let acc = 0;
  for (let i = 1; i < pl.length; i++) {
    const len = Math.hypot(pl[i].x - pl[i - 1].x, pl[i].z - pl[i - 1].z);
    segs.push({ a: pl[i - 1], b: pl[i], len, s0: acc });
    acc += len;
  }
  const total = acc;
  const at = (s) => {
    const cl = Math.max(0, Math.min(total, s));
    const seg = segs.find((g) => cl <= g.s0 + g.len) || segs.at(-1);
    const t = (cl - seg.s0) / seg.len;
    return { x: seg.a.x + (seg.b.x - seg.a.x) * t, z: seg.a.z + (seg.b.z - seg.a.z) * t };
  };
  const ss = new Set([0, total]);
  for (let i = 1; i < pl.length; i++) ss.add(segs[i - 1].s0);         // 折线顶点（含首末）
  for (let s = 3; s < total; s += 3) ss.add(Math.round(s * 100) / 100);
  return { total, at, s: [...ss].sort((a, b) => a - b) };
};

const roads = plan.roads.map((rd, ri) => {
  const st = stationsOf(rd);
  // 起伏剖面：两个不同周期的正弦叠加（一个走长缓坡，一个走短波），振幅按路的等级给
  const a1 = rand() * Math.PI * 2, a2 = rand() * Math.PI * 2;
  const amp = rd.w >= 2.2 ? 0.7 : rd.w >= 2 ? 0.55 : 0.45;
  const target = st.s.map((s) => {
    const u = s / st.total;
    return amp * Math.sin(u * Math.PI * (1.2 + (ri % 3) * 0.4) + a1) * 0.7
      + amp * 0.35 * Math.sin(u * Math.PI * 5.5 + a2)
      + (field.hillsH(st.at(s).x, st.at(s).z) > 0.9 ? 0.25 : 0);   // 丘陵脊上略抬，路面贴着山走
  });
  return { ri, rd, ...st, target, h: target.slice(), band: rd.w + SW };
});

// ---------- 2) 找路口：两条路的行车面带一旦重叠，把重叠段两端的桩号记下来 ----------
const crossings = [];
for (let i = 0; i < roads.length; i++) {
  for (let j = i + 1; j < roads.length; j++) {
    const A = roads[i], B = roads[j];
    const inB = A.s.filter((s) => distToRoad(B.rd, A.at(s).x, A.at(s).z) <= B.band + 0.6);
    const inA = B.s.filter((t) => distToRoad(A.rd, B.at(t).x, B.at(t).z) <= A.band + 0.6);
    if (!inB.length || !inA.length) continue;
    crossings.push({ a: i, b: j, aStations: inB, bStations: inA });
  }
}

// 松弛：剖面既要贴着 target，又要相邻平顺，路口段还要全平同高
for (let it = 0; it < 240; it++) {
  for (const r of roads) {
    for (let k = 0; k < r.h.length; k++) {
      const l = r.h[Math.max(0, k - 1)], u = r.h[Math.min(r.h.length - 1, k + 1)];
      r.h[k] += 0.22 * (r.target[k] - r.h[k]) + 0.30 * ((l + u) / 2 - r.h[k]);
    }
  }
  for (const c of crossings) {
    const hs = [...c.aStations.map((s) => roads[c.a].h[rIdx(roads[c.a], s)]),
      ...c.bStations.map((t) => roads[c.b].h[rIdx(roads[c.b], t)])];
    const m = hs.reduce((a, v) => a + v, 0) / hs.length;
    for (const [ri, arr] of [[c.a, c.aStations], [c.b, c.bStations]]) {
      for (const s of arr) roads[ri].h[rIdx(roads[ri], s)] += 0.75 * (m - roads[ri].h[rIdx(roads[ri], s)]);
    }
  }
}
function rIdx(r, s) {
  let bi = 0, bd = Infinity;
  for (let k = 0; k < r.s.length; k++) { const d = Math.abs(r.s[k] - s); if (d < bd) { bd = d; bi = k; } }
  return bi;
}

// ---------- 3) 交点同高之后，路面材质按区划给（老街卵石、市场街砖、小巷碎石、干道沥青） ----------
const surfOf = (rd, ri) => {
  if (rd.surf && rd.surf !== 'asphalt') return rd.surf;
  if (rd.w >= 2.2) return ri % 2 ? 'asphalt' : 'cobble';
  return ri % 3 === 0 ? 'brick' : rd.w < 1.8 ? 'gravel' : 'asphalt';
};

// ---------- 4) 沿街净空：只把碰撞盒越过道牙的物件让到车道外 ----------
const ONROAD = /^car$/;             // 与 road-walk 的豁免同一张表：只有车能停在行车面上，站房压路也得让位
const EDGE = 0.15;                  // 让开之后碰撞盒外沿离道牙还剩这点余量，别贴着磨
let cleared = 0;
for (let pass = 0; pass < 2; pass++) {
  for (const p of plan.places) {
    if (ONROAD.test(p.kind)) continue;
    const def = SOLIDS[p.kind];
    const half = def ? Math.max(...(Array.isArray(def) ? def : [def]).map((d) => (d.r ?? Math.max(d.w, d.d)) * (p.s || 1))) : 0.4;
    for (const rd of plan.roads) {
      const d = distToRoad(rd, p.x, p.z);
      const need = rd.w + EDGE + half;
      if (d >= need || d <= 0.001) continue;
      const pl = roadPolyline(rd);
      let bx = pl[0], bd = Infinity, seg = null;
      for (let i = 1; i < pl.length; i++) {
        const a = pl[i - 1], b = pl[i];
        const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1e-6;
        const u = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / len2));
        const q = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
        const dd = Math.hypot(p.x - q.x, p.z - q.z);
        if (dd < bd) { bd = dd; bx = q; seg = { a, b }; }
      }
      const L = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z) || 1e-6;
      // 正杵在中心线上的物件没有「远离方向」，就按这一段的路法向推开
      const ux = bd > 1e-4 ? (p.x - bx.x) / bd : -(seg.b.z - seg.a.z) / L;
      const uz = bd > 1e-4 ? (p.z - bx.z) / bd : (seg.b.x - seg.a.x) / L;
      p.x = Math.round((bx.x + ux * need) * 1e6) / 1e6;
      p.z = Math.round((bx.z + uz * need) * 1e6) / 1e6;
      if (pass === 0) cleared++;
      break;
    }
  }
}

// ---------- 5) 高楼：离车站/广场越近层数越多（层数区间仍由 style.js 兜住） ----------
let tall = 0;
if (!CLEAR_ONLY) for (const p of plan.places) {
  if (!hasFloors(p.kind)) continue;
  const d = Math.hypot(p.x, p.z);
  const sp = FLOOR_SPEC[p.kind];
  const want = Math.round(sp.def + (sp.max - sp.def) * Math.max(0, 1 - d / 26) * (0.4 + rand() * 0.6));
  const h = clampFloors(p.kind, want);
  if (h !== p.floors) { p.floors = h; tall++; }
}

// ---------- 写回 roads ----------
if (!CLEAR_ONLY) plan.roads = roads.map((r) => {
  const pts = r.s.map((s) => { const q = r.at(s); return [Math.round(q.x * 1e6) / 1e6, Math.round(q.z * 1e6) / 1e6]; });
  const out = { w: r.rd.w, pts, e: r.h.map((v) => Math.round(v * 1e6) / 1e6), efade: r.rd.efade ?? 4, surf: surfOf(r.rd, r.ri) };
  if (r.rd.word) out.word = r.rd.word;
  return out;
});

const err = validatePlan(plan);
console.log(CLEAR_ONLY
  ? `只清行车面（seed ${SEED}）：${plan.roads.length} 条路一根线没动，街具让位 ${cleared} 件，层数照旧`
  : `seed ${SEED}：${plan.roads.length} 条路重排（路口 ${crossings.length} 处同高）、街具让位 ${cleared} 件、改层数 ${tall} 栋`);
if (!CLEAR_ONLY) for (const r of roads) {
  const grade = Math.max(...r.h.slice(1).map((v, k) => Math.abs(v - r.h[k]) / (r.s[k + 1] - r.s[k])));
  const span = Math.max(...r.h) - Math.min(...r.h);
  console.log(`  道路 #${r.ri}：${r.s.length} 个桩号，起伏 ${span.toFixed(2)} 米，最陡 ${(grade * 100).toFixed(0)}%`);
}
if (err) { console.log(`形状不过：${err}\n没出图。`); process.exit(1); }
// 形状过了还得问「游戏里会不会出怪事」——与 plan-ops.mjs / dev 端点同一道闸：任何一条 err 都不出图
const bad = checkPlan(plan).filter((i) => i.level === 'err');
if (bad.length) {
  console.log(`体检 ${bad.length} 条 err：`);
  for (const e of bad.slice(0, 8)) console.log(`  · ${e.msg}`);
  console.log('没出图。');
  process.exit(1);
}

const text = serializePlan(plan);
if (OUT) writeFileSync(OUT, text);
if (WRITE) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync('data/town-plan.json', `data/town-plan.backup-${stamp}.json`);
  writeFileSync('data/town-plan.json', text);
  console.log(`已写回 data/town-plan.json（备份 town-plan.backup-${stamp}.json）`);
} else {
  console.log('没写盘（要写请加 --write）。');
}
const preview = join(tmpdir(), 'town-plan.gen.json');
if (!OUT && !WRITE) { writeFileSync(preview, text); console.log(`预览写到 ${preview}（${text.length} 字节）`); }
