// road-walk.mjs — 行车面通行机检：沿每条路的中心线走一遍，报出被谁压住、起伏多大、坡有多陡
// 用法：npx vite-node tools/road-walk.mjs [--file 某个 plan.json]
//
// 路面加了高程与折线之后，最坏的情形不是不好看，而是「路中间杵着一栋楼」或「某段陡到猫爬不上」。
// 高程沿中心线按 0.5 米一格扫；压路那一项扫整个行车面（中心线 + 两侧贴道牙的线），
// 只查中心线会漏掉「楼伸进车道半米」这种刚好错开中线的情形。
// 拿 SOLIDS 的碰撞盒自己判压路（不 import collision.js：
// 那份碰撞表是模块加载时按磁盘真源建好的，本工具要能查任意一份 plan）。
// 手写图与生成器出的图都过这同一道闸门。
import { readFileSync } from 'node:fs';
import { SOLIDS, makeField, groundHeight } from '../src/world/layout.js';
import { COLLIDERS } from '../src/world/collision.js';
import { roadPolyline, distToRoad, influenceK } from '../src/map/terrain.js';
import { checkPlan } from '../src/editor/problems.js';

const say = (...a) => console.log(...a);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; say('FAIL', msg); } else say('ok  ', msg); };

const argv = process.argv.slice(2);
const fi = argv.indexOf('--file');
const path = fi >= 0 ? argv[fi + 1] : 'data/town-plan.json';
const PLAN = JSON.parse(readFileSync(path, 'utf8'));
const field = makeField(PLAN);
const SW = PLAN.sidewalkW ?? 1.35;

/** 行车面这一点上方压着哪栋建筑（kind #下标）；没有则 null */
function buildingAt(x, z) {
  for (const [i, p] of PLAN.places.entries()) {
    const def = SOLIDS[p.kind];
    if (!def) continue;
    const t = p.rotY || 0, c = Math.cos(t), s = Math.sin(t);
    const dx = x - p.x, dz = z - p.z;
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    for (const d of (Array.isArray(def) ? def : [def])) {
      const k = p.s || 1, ox = (d.ox || 0) * k, oz = (d.oz || 0) * k;
      if (d.r !== undefined) {
        if (Math.hypot(lx - ox, lz - oz) < d.r * k) return `${p.kind} #${i}`;
      } else if (Math.abs(lx - ox) < d.w * k && Math.abs(lz - oz) < d.d * k) {
        return `${p.kind} #${i}`;
      }
    }
  }
  return null;
}

/** 这条折线在 p 点的设计抬升（取最近线段上的线性插值，就是高程场该兑现的那个值） */
function ownElev(pl, p) {
  let best = { d: Infinity, e: 0 };
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1], b = pl[i];
    const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1e-6;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / len2));
    const d = Math.hypot(p.x - (a.x + (b.x - a.x) * u), p.z - (a.z + (b.z - a.z) * u));
    if (d < best.d) best = { d, e: a.e + (b.e - a.e) * u };
  }
  return best.e;
}

say(`读入 ${path} · 道路 ${PLAN.roads.length} 条 · 折线 ${PLAN.roads.filter((r) => Array.isArray(r.pts)).length} 条`);

const EXEMPT = /^car$/;   // 只有车豁免：车本就停在行车面上。站房/挡墙/扶手压路一律算堵住，猫走不过去就是缺陷
const kindOf = (w) => (w && !EXEMPT.test(w.split(' ')[0]) ? w : null);   // 豁免项一律当空，压路统计只看走不通的东西

// ---------- 猫真踩的那张碰撞表（含挡墙、梯道扶手、树林） ----------
// COLLIDERS 是 collision.js 按磁盘真源建的：只有查磁盘那张图时可比，--file 查别的 plan 时明说没查
const CAT_R = 0.18;                 // 与 cat.js 的猫碰撞半径同口径
const SKIP_COLLIDER = EXEMPT;       // 与上面同一张豁免表，别让两项检查各说一套
function colliderAt(x, z, pad = CAT_R) {
  for (const b of COLLIDERS) {
    if (b.from && SKIP_COLLIDER.test(b.from.split(' ')[0])) continue;
    const dx = x - b.cx, dz = z - b.cz;
    if (b.r !== undefined) { if (Math.hypot(dx, dz) < b.r + pad) return b.from; continue; }
    if (Math.abs(dx) > b.bound + pad || Math.abs(dz) > b.bound + pad) continue;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    if (Math.abs(lx) < b.hw + pad && Math.abs(lz) < b.hd + pad) return b.from;
  }
  return null;
}
for (const [ri, rd] of PLAN.roads.entries()) {
  const pl = roadPolyline(rd);
  const pts = [];                                   // 中心线：查高程与纵坡
  const stations = [];                              // 每档三条线（中心 + 两侧贴道牙）：查行车面还剩几条车辙
  const push = (c) => {
    // 折线节点是相邻两段的公共端点，重推一次会造出零距离样本，纵坡就成了 0/0
    const q = pts.at(-1);
    if (q && Math.hypot(c.x - q.x, c.z - q.z) < 1e-9) return false;
    pts.push(c);
    return true;
  };
  const kerb = Math.max(0, rd.w - 0.35);            // 贴着道牙内侧那条线
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1], b = pl[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
    const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
    const n = Math.max(2, Math.round(L / 0.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n, px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      const c = { x: px, z: pz };
      if (!push(c)) continue;
      stations.push(kerb > 0.2
        ? [c, { x: px + nx * kerb, z: pz + nz * kerb }, { x: px - nx * kerb, z: pz - nz * kerb }]
        : [c]);
    }
  }
  const hs = pts.map((p) => field.surface(p.x, p.z));
  const mn = Math.min(...hs), mx = Math.max(...hs);
  // 「这条路自己说了算」按混合权重算，不按裙边外沿算：邻路归属感 k<0.1（权重 k²<1%）才算没污染。
  // 裙边尾端本来只剩 1% 影响，把它当污染的话，两条路口之间只有十几米的短街会全段无可比样本。
  const clean = (p) => PLAN.roads.every((other, j) => j === ri
    || influenceK(distToRoad(other, p.x, p.z), other.w + SW, other.efade ?? 3) < 0.1);
  const openRoad = pts.filter(clean);
  // 剖面兑现分两层查：
  //   A) 把这条路单独拿出来建一场 —— 逐点必须等于自己的设计剖面，证明 e 真被高程场读进去了，
  //      不受邻路/台地/石阶污染（污染掉的由 C 的「每步落差」把关，路口本来就该混）。
  //   B) 真图上邻路管不着的那些段，实测还得等于设计。
  const iso = makeField({ hills: [], terraces: [], flights: [], sidewalkW: SW, roads: [rd] }).roadElev;
  const isoOff = pts.reduce((a, p) => Math.max(a, Math.abs(iso(p.x, p.z) - ownElev(pl, p))), 0);
  const realOff = openRoad.reduce((a, p) => Math.max(a, Math.abs(field.roadElev(p.x, p.z) - ownElev(pl, p))), 0);
  const dspan = Math.max(...pl.map((q) => q.e)) - Math.min(...pl.map((q) => q.e));
  const steps = hs.slice(1).map((h, i) => ({
    jump: Math.abs(h - hs[i]),
    step: Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z),
    at: pts[i + 1],
  })).filter((o) => o.step > 1e-6);
  const worst = steps.reduce((a, b) => (b.jump > a.jump ? b : a), { jump: 0, at: pts[0], step: 1 });
  const hits = [];      // 中线被占，或三条线里两条以上没了 —— 这条道就走不通了
  const nibbles = [];   // 只咬掉一条车辙：难看但还能过，报出来不判不合格
  for (const probes of stations) {
    const occ = probes.map((q) => kindOf(buildingAt(q.x, q.z)));
    const n = occ.filter(Boolean).length;
    if (!n) continue;
    const row = { who: occ.find(Boolean), n, centre: !!occ[0], p: probes[0] };
    (occ[0] || n * 3 >= probes.length * 2 ? hits : nibbles).push(row);
  }
  const at2 = (p) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
  // 行车面还得过猫真踩的那张碰撞表：它比 SOLIDS 多出台地挡墙与梯道扶手，正是「有垂直高差必须有东西挡着」那一族缺陷。
  // 只沿中心线查（贴道牙的路灯本来就该在道牙上，用探针查会一片假警）：
  //   paved = 实体直接盖住中心线（pad 0，一寸都不许）；tight = 猫站不住（连猫身半径 0.18 的余量都没有）
  const paved = [], tight = [];
  if (fi < 0) for (const q of pts) {
    const w = colliderAt(q.x, q.z, 0);
    if (w) { paved.push({ w, at: q }); continue; }
    const t = colliderAt(q.x, q.z, CAT_R);
    if (t) tight.push({ w: t, at: q });
  }
  const tally = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const e = m.get(r.who) || { n: 0, worst: r, centre: false };
      e.n += r.n;
      e.centre = e.centre || r.centre;
      if (r.centre && !e.worst.centre || r.n > e.worst.n) e.worst = r;
      m.set(r.who, e);
    }
    return [...m].map(([who, e]) => `${who} 占掉 ${e.n} 个采样点${e.centre ? '（含中线）' : ''}，最好处 ${at2(e.worst.p)}`);
  };
  const label = `道路 #${ri}（${rd.surf || 'asphalt'}，${pl.length} 节点，约 ${Math.round(pts.length * 0.5)} 米）`;
  say(`     ${label}：中心线高程 ${mn.toFixed(2)}~${mx.toFixed(2)} 米（起伏 ${(mx - mn).toFixed(2)}），最陡一段 ${(worst.jump * 200).toFixed(0)}%（每 0.5 米升 ${worst.jump.toFixed(2)} 米）@(${worst.at.x.toFixed(1)}, ${worst.at.z.toFixed(1)})，自家剖面管得着 ${openRoad.length}/${pts.length} 段`);
  for (const s of tally(hits)) say(`       · 堵住行车面：${s}`);
  for (const s of tally(nibbles)) say(`       · 只贴到道牙：${s}`);
  ok(Number.isFinite(mn) && Number.isFinite(mx) && mn > -3 && mx < 6, `${label}：中心线高程全程有限且在 -3~6 米内`);
  ok(worst.jump <= 0.15, `${label}：最陡一段 ≤ 30% 纵坡（每 0.5 米落差 ≤ 0.15 米，实测 ${worst.jump.toFixed(2)} 米；再陡或突跳就是猫会瞬移上/下台）`);
  ok(hits.length === 0, `${label}：行车面没被建筑堵住（中线被占，或三条车辙少两条）${hits.length ? `（${[...new Set(hits.map((h) => h.who))].join('、')}）` : ''}`);
  if (fi >= 0) say(`       note 碰撞表这项没查（COLLIDERS 是照磁盘真源建的，这次读的是 ${path}）`);
  else {
    ok(paved.length === 0, `${label}：中心线没被任何实体盖住（猫的碰撞表口径：站房/挡墙/梯道扶手/树都算）${paved.length ? `（${[...new Set(paved.map((o) => o.w))].join('、')}，共 ${paved.length} 个采样点，最北一处 ${at2(paved[0].at)}）` : ''}`);
    ok(tight.length === 0, `${label}：猫在中心线上站得下（离最近实体还留得出半个猫身 ${CAT_R * 2} 分米）${tight.length ? `（挤到站不下的：${[...new Set(tight.map((o) => o.w))].join('、')}，共 ${tight.length} 点，例 ${at2(tight[0].at)}）` : ''}`);
  }
  ok(isoOff < 0.02 && (openRoad.length === 0 || realOff < 0.05),
    `${label}：设计剖面落进了高程场（单拿这条路逐点比最大 ${(isoOff * 100).toFixed(1)} 厘米，设计起伏 ${dspan.toFixed(2)} 米；真图上邻路管不着的 ${openRoad.length}/${pts.length} 段最大 ${(openRoad.length ? realOff * 100 : 0).toFixed(1)} 厘米）`);
}

{
  // control：上面每条路那条「剖面兑现」如果全程在零上比，就是空转 —— 所以这张图本身必须真起伏、真弯、真多种路面
  const undulated = PLAN.roads.filter((r) => {
    const es = roadPolyline(r).map((q) => q.e);
    return Math.max(...es) - Math.min(...es) >= 0.3;
  });
  ok(undulated.length >= 2, `control：${undulated.length}/${PLAN.roads.length} 条路的设计起伏 ≥ 0.3 米（剖面那条比对不是在全零上打转）`);
  const bent = PLAN.roads.filter((r) => Array.isArray(r.pts) && r.pts.length >= 3);
  ok(bent.length >= 1, `control：${bent.length} 条路是三点以上的折线（弯街），直线与折线两种形态在这张图里都走通了`);
  const surf = new Set(PLAN.roads.map((r) => r.surf || 'asphalt'));
  ok(surf.size >= 2, `control：路面材质有 ${surf.size} 种（${[...surf].join('/')}），不是整张图一种灰`);
  const own = PLAN.places.find((q) => SOLIDS[q.kind] && !EXEMPT.test(q.kind));
  const probe = own && kindOf(buildingAt(own.x, own.z));
  ok(probe, `control：在 ${own.kind} #${PLAN.places.indexOf(own)} 的正中心探得到不该豁免的东西（${probe}，上面压路那两项不是空转）`);
  if (fi < 0) ok(colliderAt(own.x, own.z) !== null, `control：colliderAt 在同一处也探得到碰撞体（${colliderAt(own.x, own.z)}，行车面的碰撞检查不是空转）`);
}

{
  const rd = PLAN.roads.find((r) => Array.isArray(r.pts)) || PLAN.roads[0];
  const p = roadPolyline(rd)[0];
  // groundHeight 是 layout.js 建模块时按磁盘真源做好的场：只有查的就是那份图时才可比。
  // 拿 --file 查别的 plan 时这条不算空转也不算失败，直说没查（游戏里的面还照磁盘那份走）。
  if (fi >= 0) say(`note 可走面同源这项没查（--file 查的是 ${path}，而 layout.groundHeight 绑的是磁盘真源）`);
  else ok(Math.abs(groundHeight(p.x, p.z) - field.surface(p.x, p.z)) < 1e-6, '可走面高度与高程场同源（同一份 plan 只有一个真值）');
}

const errs = checkPlan(PLAN).filter((i) => i.level === 'err');
ok(errs.length === 0, `体检零错${errs.length ? `（${errs.slice(0, 3).map((e) => e.msg).join(' / ')}）` : ''}`);

say(fails ? `\n${fails} 条不合格` : '\n全部合格');
process.exit(fails ? 1 : 0);
