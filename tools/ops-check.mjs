// ops-check.mjs — 声明式改图（AI 接口）机检：每条 op 真改到东西 + 改完的图仍然过关
// 用法：npx vite-node tools/ops-check.mjs
//
// 这套接口的风险是「写错字段名 → 静默没改」和「随机数根本没生效」，
// 所以每条断言都配一条对照（control）：故意写坏，确认它报错且图一个字节都没动。
import { PLAN } from '../src/world/layout.js';
import { applyOps, OPS_DOC, OPS_VERSION, rng, polylineSamples } from '../src/map/ops.js';
import { roadPolyline, polylineLength, ROAD_SURFACES, distToRoad, makeField } from '../src/map/terrain.js';
import { validatePlan } from '../src/map/schema.js';
import { FLOOR_SPEC, buildingHeight } from '../src/map/style.js';
import { BUILDERS } from '../src/world/props.js';
import { KINDS } from '../src/editor/kinds.js';
import { checkPlan } from '../src/editor/problems.js';
import { serializePlan } from '../src/editor/state.js';

const say = (...a) => console.log(...a);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; say('FAIL', msg); } else say('ok  ', msg); };

const BASE = structuredClone(PLAN);
const J = (v) => JSON.stringify(v);
const untouched = (plan) => J(plan) === J(BASE);
const nOf = (plan, key, pred) => (plan[key] || []).filter(pred).length;
// 真源里直线与折线并存，样本得按形状挑 —— 别把某条路的坡度值写死当成索引
const STR = BASE.roads.findIndex((r) => r.x1 !== undefined && (r.e1 || r.e2));
const BEND = BASE.roads.findIndex((r) => Array.isArray(r.pts));
const LONG = BASE.roads.reduce((a, r, i) => (polylineLength(roadPolyline(r)) > polylineLength(roadPolyline(BASE.roads[a])) ? i : a), 0);

// ---------- 0) 登记表自洽： kinds ↔ BUILDERS ↔ FLOOR_SPEC ----------
{
  const builderKinds = new Set(Object.keys(BUILDERS));
  const kindList = new Set(KINDS.map((k) => k.kind));
  const missing = [...kindList].filter((k) => !builderKinds.has(k));
  const specOrphan = Object.keys(FLOOR_SPEC).filter((k) => !kindList.has(k) || !builderKinds.has(k));
  ok(missing.length === 0, `KINDS 登记的 ${kindList.size} 类在 props.BUILDERS 里都有出图函数${missing.length ? `（缺 ${missing.join(',')}）` : ''}`);
  ok(specOrphan.length === 0, `能改层数的 kind（${Object.keys(FLOOR_SPEC).join('/')}）都在登记表里`);
  for (const [k, sp] of Object.entries(FLOOR_SPEC)) {
    ok(sp.min >= 2 && sp.max > sp.min && sp.def >= sp.min && sp.def <= sp.max && sp.fh > 1 && sp.max <= 12
      && sp.plinth > 0 && sp.kit > 0 && sp.extra >= 0,
      `${k} 层数区间 ${sp.min}~${sp.max}、层高 ${sp.fh} 米、裙房 ${sp.plinth} 米自洽`);
  }
  ok(OPS_DOC.length >= 10 && OPS_VERSION === 1, `OPS_DOC 列了 ${OPS_DOC.length} 条 op 说明，版本 ${OPS_VERSION}`);
}

// ---------- 1) place.style：批量改外观（本轮主菜） ----------
{
  const mansions = nOf(BASE, 'places', (p) => p.kind === 'mansion');
  const flowers = nOf(BASE, 'places', (p) => p.kind === 'flowers');
  ok(mansions >= 2 && flowers >= 6, `样本够：公寓楼 ${mansions} 栋、花丛 ${flowers} 丛（不然随机断言是空的）`);

  const op = (seed) => [{ op: 'place.style', where: { kind: 'mansion' }, floors: [3, 7], wall: [0xc0c0c0, 0xf0f0f0], seed }];
  const { plan, report } = applyOps(BASE, op(7));
  const got = plan.places.filter((p) => p.kind === 'mansion');
  ok(report.errors.length === 0 && report.changed, `公寓楼批量改外观零报错（${report.changes[0]?.msg}）`);
  ok(got.length === mansions && got.every((p) => p.floors >= 3 && p.floors <= 7 && p.wall >= 0xc0c0c0 && p.wall <= 0xf0f0f0),
    `${got.length} 栋的层数与外墙色都落在请求区间内`);
  ok(J(applyOps(BASE, op(7)).plan) === J(plan), '同 seed 重跑逐字节一致（AI 能复现同一批动作）');
  // 给两个色号 = 二选一，不是插值（颜色插值只会调出脏色）
  const two = applyOps(BASE, [{ op: 'place.style', where: { kind: 'flowers' }, wall: [0xff0000, 0x00ff00], seed: 4 }]).plan
    .places.filter((p) => p.kind === 'flowers').map((p) => p.wall);
  ok(two.every((w) => w === 0xff0000 || w === 0x00ff00), `色号数组是二选一（出现 ${[...new Set(two)].map((v) => v.toString(16)).join('/')}），不会插出中间色`);
  ok(new Set(two).size === 2, 'control：两色都真被抽到了（不是只会取第一个）');
  // 随机流真的在动：拿数量多的花丛改外观编号，换 seed 必然不同
  const fl = (seed) => applyOps(BASE, [{ op: 'place.style', where: { kind: 'flowers' }, v: [0, 6], seed }]).plan
    .places.filter((p) => p.kind === 'flowers').map((p) => p.v).join(',');
  ok(new Set(Array.from({ length: 12 }, rng(7))).size >= 10, 'rng(7) 连吐 12 个数，几乎不重复（随机源不是常量）');
  ok(fl(7) !== fl(8), `换 seed 后花丛外观编号变了（${fl(7)} ≠ ${fl(8)}）`);
  ok(new Set(fl(7).split(',')).size >= 2, `同一批里编号铺开成 ${new Set(fl(7).split(',')).size} 种，不是把同一个数盖 ${flowers} 遍`);

  // 夹区间：先加一栋高楼再改层数，越界必须被夹到上限而不是写出 99 层
  const t = applyOps(BASE, [{ op: 'place.add', rec: { kind: 'tower', x: 12, z: -8, floors: 5 } }]);
  const ti = t.plan.places.length - 1;
  const clamped = applyOps(t.plan, [{ op: 'place.style', where: { ids: [ti] }, floors: 99 }]).plan.places[ti];
  ok(clamped.floors === FLOOR_SPEC.tower.max, `tower floors=99 夹到上限 ${FLOOR_SPEC.tower.max}（不是 99 层捅穿天空）`);
  const auto = applyOps(t.plan, [{ op: 'place.style', where: { ids: [ti] }, floors: 'auto' }]).plan.places[ti];
  ok(auto.floors === FLOOR_SPEC.tower.def, `floors:'auto' = 回到该型默认 ${FLOOR_SPEC.tower.def} 层`);
  const viaSet = applyOps(t.plan, [{ op: 'place.set', where: { ids: [ti] }, set: { floors: 40, wall: 0x10ffffff } }]).plan.places[ti];
  ok(viaSet.floors === FLOOR_SPEC.tower.max && viaSet.wall === 0xffffff,
    'control：绕道走 place.set 写越界层数/越界色号，一样被夹（不是只有 style 才设防）');

  // control：平层小物件没有层数 / 字段名打错 → 必须报错且整张图不动
  const badKind = applyOps(BASE, [{ op: 'place.style', where: { kind: 'vending' }, floors: 5 }]);
  ok(badKind.report.errors.length === 1 && untouched(badKind.plan), `给自动售货机改层数 → 报错且图没动（${badKind.report.errors[0]}）`);
  const typo = applyOps(BASE, [{ op: 'place.style', where: { kind: 'mansion' }, wallColor: 0xff0000 }]);
  ok(typo.report.errors.length === 1 && untouched(typo.plan), '外观字段名打错（wallColor）→ 报错且图没动，不会静默空转');
  const noHit = applyOps(BASE, [{ op: 'place.style', where: { kind: 'manshin' }, floors: 5 }]);
  ok(noHit.report.errors.length === 1 && untouched(noHit.plan), 'kind 拼错（manshin）筛不到东西 → 报错，AI 立刻知道写错了');
}

// ---------- 2) place.set / move / rotate / remove / add ----------
{
  const lights = nOf(BASE, 'places', (p) => p.kind === 'streetlight');
  const { plan, report } = applyOps(BASE, [{ op: 'place.set', where: { kind: 'streetlight' }, set: { s: 1.2, v: 3 } }]);
  ok(report.changes[0].n === lights, `streetlight 一条 op 命中全部 ${lights} 盏`);
  ok(plan.places.filter((p) => p.kind === 'streetlight').every((p) => p.s === 1.2 && p.v === 3), '这批路灯的尺度与外观编号都改到了');
  const others = (P) => P.places.filter((p) => p.kind !== 'streetlight');
  ok(J(others(plan)) === J(others(BASE)), `control：只有路灯变了，其余 ${others(BASE).length} 个物件一字节未动`);

  const before = BASE.places.filter((p) => p.kind === 'bench').map((p) => [p.x, p.z]);
  const moved = applyOps(BASE, [{ op: 'place.move', where: { kind: 'bench' }, dx: 0.5, dz: -1 }]).plan;
  const after = moved.places.filter((p) => p.kind === 'bench');
  ok(after.length === before.length && after.every((p, i) => Math.abs(p.x - before[i][0] - 0.5) < 1e-6
    && Math.abs(p.z - before[i][1] + 1) < 1e-6), `长椅整体平移 (+0.5, -1) 米，${after.length} 条逐条对得上`);
  ok(J(moved.roads) === J(BASE.roads) && J(moved.terraces) === J(BASE.terraces), 'control：平移长椅没碰道路与造成');

  const cars = BASE.places.filter((p) => p.kind === 'car');
  const rot = applyOps(BASE, [{ op: 'place.rotate', where: { kind: 'car' }, deg: 90 }]).plan.places.filter((p) => p.kind === 'car');
  ok(rot.every((p, i) => Math.abs((p.rotY || 0) - (cars[i].rotY || 0) - Math.PI / 2) < 1e-6), '汽车右转 90°（增量叠加，不是覆盖成 90°）');
  const abs = applyOps(BASE, [{ op: 'place.rotate', where: { kind: 'car' }, rotDeg: 180 }]).plan.places.filter((p) => p.kind === 'car');
  ok(abs.every((p) => Math.abs(p.rotY - Math.PI) < 1e-6), 'rotDeg=180 是绝对朝向，四条车都正好朝 180°');

  const trashN = nOf(BASE, 'places', (p) => p.kind === 'trash');
  const rm = applyOps(BASE, [{ op: 'place.remove', where: { kind: 'trash' } }]);
  ok(rm.plan.places.length === BASE.places.length - trashN && nOf(rm.plan, 'places', (p) => p.kind === 'trash') === 0,
    `删掉全部 ${trashN} 个垃圾桶，总数从 ${BASE.places.length} 减到 ${rm.plan.places.length}`);
  ok(applyOps(BASE, [{ op: 'place.remove', where: { kind: 'nope' } }]).report.changes[0].n === 0, '删不存在的东西 = 删 0 条（幂等，不算错）');

  const lim = applyOps(BASE, [{ op: 'place.style', where: { kind: 'house', limit: 4 }, v: 2, seed: 3 }]);
  ok(lim.report.changes[0].n === 4, `limit:4 只动 4 栋住宅（房子共 ${nOf(BASE, 'places', (p) => p.kind === 'house')} 栋）`);
  ok(applyOps(BASE, [{ op: 'place.remove', where: { kind: 'hydrant', every: 1 } }]).report.changes[0].n
    === nOf(BASE, 'places', (p) => p.kind === 'hydrant'), 'every:1 = 全命中，等价于不筛');

  const add = applyOps(BASE, [{ op: 'place.add', rec: {
    kind: 'tower', x: 5, z: -5, rotDeg: 90, floors: 6, word: 'apaato',
    evil: '<img onerror=1>', bogus: NaN, s: 'big', proto: { a: 1 },
  } }]);
  const rec = add.plan.places.at(-1);
  ok('floors' in rec && !('evil' in rec) && !('bogus' in rec) && !('s' in rec) && !('proto' in rec),
    'place.add 只收白名单字段：注入串、NaN、字符串尺度、嵌套对象全被丢掉');
  ok(Math.abs(rec.rotY - Math.PI / 2) < 1e-5 && rec.floors === 6, 'rotDeg 在入口换算成 rotY 弧度，层数留得住');
  ok(applyOps(BASE, [{ op: 'place.add', rec: { kind: 'tower', x: 1, z: 1, floors: 99 } }]).plan.places.at(-1).floors === FLOOR_SPEC.tower.max,
    'place.add 也夹层数（写 99 层进不了真源）');
  ok(!('floors' in applyOps(BASE, [{ op: 'place.add', rec: { kind: 'vending', x: 1, z: 1, floors: 4 } }]).plan.places.at(-1)),
    'control：给售货机写层数 → 字段直接丢掉，真源里不留脏字段');
  ok(applyOps(BASE, [{ op: 'place.add', rec: { nope: 1 } }]).report.errors.length === 1, 'place.add 没有可写字段 → 报错');
  ok(applyOps(BASE, [{ op: 'place.set', where: { kind: 'bench' } }]).report.errors.length === 1, 'place.set 不给 set → 报错而不是空转');
}

// ---------- 3) road：折线 / 路面材质 / 整体平移 ----------
{
  ok(STR >= 0 && BEND >= 0 && LONG >= 0, `真源里直线与折线并存（直线带坡 #${STR}／折线 #${BEND}／最长 #${LONG}＝${polylineLength(roadPolyline(BASE.roads[LONG])).toFixed(0)} 米），下面的样本按形状挑，不写死索引`);
  ok(BASE.roads.every((r) => (r.x1 === undefined) !== !Array.isArray(r.pts)), 'control：每条路都只有一种形态（pts 与 x1 恰好有一个），schema 的 XOR 在真源里成立');
  const add = applyOps(BASE, [{ op: 'road.add', rec: {
    pts: [[-10, -12], [-2, -12], [-2, -2]], e: [0, 0.6, 0.6], w: 2.4, surf: 'cobble',
  } }]);
  ok(add.report.errors.length === 0, '折线道路能加进来');
  const nr = add.plan.roads.at(-1);
  const poly = roadPolyline(nr);
  ok(poly.length === 3 && poly[0].e === 0 && poly[2].e === 0.6, `折线三节点、逐节点高程读得出来（末端 ${poly[2].e} 米）`);
  ok(nr.surf === 'cobble', '路面材质写进去了');

  const badSurf = applyOps(BASE, [{ op: 'road.set', where: { ids: [0] }, set: { surf: 'banana' } }]);
  ok(!ROAD_SURFACES.includes('banana'), 'control：banana 确实不在合法材质表里（下一条不是走运）');
  ok(badSurf.report.errors.length === 1 && untouched(badSurf.plan), '乱写的路面材质被拒 → 报错且图没动');
  for (const s of ROAD_SURFACES) {
    const r = applyOps(BASE, [{ op: 'road.set', where: { ids: [0] }, set: { surf: s } }]);
    ok(r.plan.roads[0].surf === s, `路面材质 ${s} 能写`);
  }

  const pi = add.plan.roads.length - 1;
  const shifted = applyOps(add.plan, [{ op: 'road.move', where: { ids: [pi] }, dx: 3, dz: 1 }]).plan.roads[pi];
  ok(shifted.pts.every((p, i) => Math.abs(p[0] - nr.pts[i][0] - 3) < 1e-6 && Math.abs(p[1] - nr.pts[i][1] - 1) < 1e-6),
    '折线道路整体平移：三个节点一起走（不是只挪第一个）');
  ok(J(shifted.e) === J(nr.e), 'control：平移只改坐标，逐节点高程原样保留');
  const rl = BASE.roads[STR];
  const sl = applyOps(BASE, [{ op: 'road.move', where: { ids: [STR] }, dx: -2, dz: 0.5 }]).plan.roads[STR];
  ok(sl.x1 === rl.x1 - 2 && sl.x2 === rl.x2 - 2 && sl.z1 === rl.z1 + 0.5 && sl.z2 === rl.z2 + 0.5,
    `直线道路按端点平移，四个数一起走（e1=${sl.e1} 没丢）`);

  const smp = polylineSamples(poly, 2);
  ok(smp.length === 4 + 5, `${8 + 10} 米折线按 2 米取样得 ${smp.length} 个点（每段各按自己长度分）`);
  ok(smp.every((p) => Math.abs(Math.hypot(p.nx, p.nz) - 1) < 1e-9), '每个采样点的法向是单位向量');
  ok(smp.every((p, i) => !i || Math.hypot(p.x - smp[i - 1].x, p.z - smp[i - 1].z) <= 2.01), '相邻采样点不超一步间距');
}

// ---------- 3b) road.set 换形态：直线 ⇄ 折线（AI 把路改弯的唯一入口） ----------
{
  const ri = STR;                                            // 真源里那条直线、带坡度的街
  const rl = BASE.roads[ri];
  const bend = applyOps(BASE, [{ op: 'road.set', where: { ids: [ri] }, set: {
    pts: [[rl.x1, rl.z1], [rl.x1 + 2, 0], [rl.x2, rl.z2]], surf: 'cobble',
  } }]);
  ok(bend.report.errors.length === 0, `直线主街 #${ri} 一次 op 改弯（${bend.report.changes[0]?.msg}）`);
  const b = bend.plan.roads[ri];
  ok(!['x1', 'z1', 'x2', 'z2', 'e1', 'e2'].some((k) => k in b), `control：改弯后直线端点全清了（残留 ${Object.keys(b).join('/')}）`);
  ok(validatePlan(bend.plan) === null, '改完的图过 schema 闸门（pts 与 x1/x2 二选一这条正是它把关的）');
  const bp = roadPolyline(b);
  ok(bp.length === 3 && Math.abs(bp[0].e - rl.e1) < 1e-6 && Math.abs(bp[2].e - rl.e2) < 1e-6
    && Math.abs(bp[1].e - (rl.e1 + rl.e2) / 2) < 1e-6,
    `没给逐节点高程时按原 e1→e2 线性铺（${bp.map((p) => p.e.toFixed(3)).join('→')} 米），${rl.e1} 的坡度没被悄悄清零`);

  const straighten = applyOps(bend.plan, [{ op: 'road.set', where: { ids: [ri] }, set: { x1: rl.x1, z1: rl.z1, x2: rl.x2, z2: rl.z2 } }]);
  ok(straighten.report.errors.length === 0 && validatePlan(straighten.plan) === null, '折线拉直回直线也一次 op 搞定');
  const st = straighten.plan.roads[ri];
  ok(!('pts' in st) && !('e' in st) && st.surf === 'cobble' && st.x1 === rl.x1 && st.z2 === rl.z2,
    `拉直后 pts/e 清空，与形态无关的字段（surf=${st.surf}）照旧留着`);
  ok(Math.abs(st.e1 - bp[0].e) < 1e-6 && Math.abs(st.e2 - bp[2].e) < 1e-6,
    `拉直时逐节点高程首尾折回 e1/e2（${st.e1}/${st.e2}）`);

  const eOnly = applyOps(BASE, [{ op: 'road.set', where: { ids: [ri] }, set: { e: [0.8, 0.1] } }]);
  ok(eOnly.report.errors.length === 0 && eOnly.plan.roads[ri].e1 === 0.8 && eOnly.plan.roads[ri].e2 === 0.1
    && !('e' in eOnly.plan.roads[ri]), 'control：给直线写折线口径的 e → 首尾折进 e1/e2，不把 e 留在真源里');
  const both = applyOps(BASE, [{ op: 'road.set', where: { ids: [ri] }, set: { e: [0.8, 0.1], e2: 0.3 } }]).plan.roads[ri];
  ok(both.e1 === 0.8 && both.e2 === 0.3, `同一条 set 里 e 与 e2 都给时，点名的 ${both.e2} 赢（e 只管没写的那头）`);

  const mismatch = applyOps(BASE, [{ op: 'road.set', where: { ids: [ri] }, set: {
    pts: [[0, -30], [1, 0], [0, 30]], e: [0, 0.5],
  } }]);
  ok(validatePlan(mismatch.plan) !== null, 'control：pts 与 e 长度对不上时 schema 确实会拦（下一条不是走运）');
  ok(mismatch.report.errors.length === 0 && validatePlan(mismatch.plan).includes('等长'),
    `e 长度不匹配 → 交给闸门报「${validatePlan(mismatch.plan)}」，长度对不上绝不静默重采样`);
}

// ---------- 4) place.scatter：沿街自动摆 ----------
{
  const ri = LONG;                          // 沿最长的主街摆（短街两侧全是路口，摆不下一页另说）
  const n0 = BASE.places.length;
  const sc = applyOps(BASE, [{ op: 'place.scatter', where: { ids: [ri] }, kind: 'streetlight', step: 5, offset: 2.6, sides: 1, minGap: 2 }]);
  const fresh = sc.plan.places.slice(n0);
  ok(sc.report.errors.length === 0 && fresh.length > 0, `沿主街 #${ri} 一侧摆出 ${fresh.length} 盏路灯`);
  ok(fresh.every((p) => p.kind === 'streetlight'), 'control：摆出来的确实全是路灯，没有把原有物件算进命中数');
  const ds = fresh.map((p) => distToRoad(BASE.roads[ri], p.x, p.z));
  ok(Math.max(...ds) - Math.min(...ds) < 0.9 && Math.min(...ds) > 1.5 && Math.max(...ds) < 4,
    `每盏到路中心线 ${Math.min(...ds).toFixed(2)}~${Math.max(...ds).toFixed(2)} 米（请求 2.6，容差一个路缘）`);
  ok(fresh.every((p) => p.z <= (BASE.beachZ ?? 24) - 1.5), `control：没有灯被摆进沙滩（最南 z=${Math.max(...fresh.map((p) => p.z)).toFixed(1)}，沙滩线 ${BASE.beachZ}）`);
  ok(applyOps(BASE, [{ op: 'place.scatter', where: { ids: [ri] } }]).report.errors.length === 1, 'scatter 不写 kind → 报错');
  ok(applyOps(BASE, [{ op: 'place.scatter', where: { kind: 'nope' }, kind: 'trash' }]).report.errors.length === 1, 'scatter 的 where 筛不到路 → 报错');
  ok(applyOps(BASE, [{ op: 'road.scatter', where: {} }]).report.errors.length === 1, 'road 表没有 scatter 动作 → 报错');
}

// ---------- 5) terrace / flight / hill / plan.set ----------
{
  const t0 = (BASE.terraces || []).length;
  const ta = applyOps(BASE, [{ op: 'terrace.add', rec: { x: 8, z: -8, hw: 4, hd: 3, h: 0.9, edge: 'slope', apron: 1.8 } }]);
  const tc = ta.plan.terraces.at(-1);
  ok(ta.plan.terraces.length === t0 + 1 && tc.edge === 'slope' && tc.apron === 1.8, '台地能加，放坡做法与裙宽带得住');
  const te = applyOps(ta.plan, [{ op: 'terrace.set', where: { ids: [t0] }, set: { h: 1.2, edge: 'nonsense' } }]).plan.terraces[t0];
  ok(te.h === 1.2 && te.edge === 'slope', '台地改高程生效；乱写的边缘做法被拒（保留原值）');

  const f0 = (BASE.flights || []).length;
  const fa = applyOps(BASE, [{ op: 'flight.add', rec: { x: 16.8, z: 15.6, rotDeg: 90, w: 1.6, run: 3.4, rise: 0.7, kind: 'stair', steps: 4 } }]);
  ok(fa.plan.flights.length === f0 + 1 && fa.plan.flights.at(-1).kind === 'stair', '石阶能加（rotDeg 90 → rotY）');
  const fr = applyOps(fa.plan, [{ op: 'flight.set', where: { ids: [f0] }, set: { kind: 'ramp', steps: 0 } }]).plan.flights[f0];
  ok(fr.kind === 'ramp' && fr.steps === 0, '石阶改成坡道、阶数归零（几何端按 0.34 米自动分阶）');

  const h0 = (BASE.hills || []).length;
  const ha = applyOps(BASE, [{ op: 'hill.add', rec: { x: -20, z: -20, a: 1.2, s: 9 } }]);
  ok(ha.plan.hills.length === h0 + 1 && ha.plan.hills.at(-1).a === 1.2, '自然丘陵能加');
  ok(applyOps(ha.plan, [{ op: 'hill.remove', where: { ids: [h0] } }]).plan.hills.length === h0, '自然丘陵能删');

  ok(applyOps(BASE, [{ op: 'plan.set', path: 'sidewalkW', value: 1.6 }]).plan.sidewalkW === 1.6, 'plan.set 改全局参数');
  ok(applyOps(BASE, [{ op: 'plan.set', path: 'sidewalkW', value: 'wide' }]).report.errors.length === 1, 'plan.set 类型不符 → 报错');
  ok(applyOps(BASE, [{ op: 'plan.set', path: 'places', value: [] }]).report.errors.length === 1
    && applyOps(BASE, [{ op: 'plan.set', path: 'R', value: 1 }]).report.errors.length === 0,
    'plan.set 白名单外的路径（places）报拒；R 这类数值路径可写（上面那条 R=1 是唯一合法项）');
}

// ---------- 6) 坏 op：只记 error，绝不半改 ----------
{
  const junk = applyOps(BASE, [
    { op: 'house.paint', color: 'red' },
    { op: 'place' },
    { op: 'place.fly', where: {} },
  ]);
  ok(junk.report.errors.length === 3 && untouched(junk.plan), `三行坏 op 逐条报到（${junk.report.errors.length} 条）且图一字节未动`);
  ok(applyOps(BASE, []).report.changed === false && untouched(applyOps(BASE, []).plan), '空 op 列表 = 图一模一样');
  const src = structuredClone(BASE);
  applyOps(src, [{ op: 'place.style', where: { kind: 'mansion' }, floors: 5 }, { op: 'road.add', rec: { x1: 0, z1: 0, x2: 1, z2: 1, w: 2 } }]);
  ok(J(src) === J(BASE), 'applyOps 不改传入的 plan（纯函数：编辑器拿它做预览不会把真源弄脏）');
  ok(applyOps(BASE, '不是数组').report.errors.length === 0 && applyOps(BASE).report.changes.length === 0, '参数残缺（非数组/没给 op）不炸');
  // 一条坏 op 混在好 op 里：好的照样生效
  const mix = applyOps(BASE, [{ op: 'place.style', where: { kind: 'mansion' }, floors: 4 }, { op: 'nope.nope' }]);
  ok(mix.report.errors.length === 1 && mix.plan.places.filter((p) => p.kind === 'mansion').every((p) => p.floors === 4),
    '坏 op 只让自己失败，同批的好 op 照样生效');
}

// ---------- 7) 一份「AI 会写的」综合脚本：改完必须还是过关的图 ----------
{
  const ri = STR;                             // 东西大街：沥青 → 石板是真实改动，不是同值空转
  const script = [
    { op: 'place.add', rec: { kind: 'tower', x: -14, z: -18, rotDeg: 180, floors: 8, word: 'apaato' } },
    { op: 'place.style', where: { kinds: ['mansion', 'tower'] }, floors: [3, 6], wall: [0xe8dcc8, 0xf6e8d8], seed: 11 },
    { op: 'place.style', where: { kind: 'house' }, v: [0, 4], seed: 12 },
    { op: 'road.set', where: { ids: [ri] }, set: { surf: 'cobble' } },
    { op: 'road.add', rec: { pts: [[-26, 6], [-14, 6], [-14, 12]], e: [0, 0.45, 0.45], w: 2, surf: 'brick' } },
    { op: 'terrace.add', rec: { x: 18, z: -16, hw: 3, hd: 2.5, h: 0.8, edge: 'slope', apron: 2 } },
    { op: 'place.scatter', where: { ids: [ri] }, kind: 'flowerbed', step: 9, offset: 3.4, sides: 1, minGap: 1.4 },
  ];
  const { plan, report } = applyOps(BASE, script);
  ok(report.errors.length === 0, `综合脚本 ${script.length} 步零报错：${report.changes.map((c) => c.msg).join('；')}${report.errors.length ? ` ✗ ${report.errors.join(' | ')}` : ''}`);
  const errs = checkPlan(plan).filter((i) => i.level === 'err');
  ok(errs.length === 0, `改完的图体检零错${errs.length ? `（${errs.slice(0, 3).map((e) => e.msg).join(' / ')}）` : ''}`);
  const rt = JSON.parse(serializePlan(plan));
  ok(['places', 'roads', 'terraces', 'flights', 'hills', 'forestTrees', 'crosswalks']
    .every((k) => J(rt[k]) === J(plan[k])), '序列化 → 解析回对象：七张表逐字节往返');
  const f = makeField(rt);
  let nan = 0;
  for (let x = -30; x <= 30; x += 2.5) for (let z = -30; z <= 20; z += 2.5) if (!Number.isFinite(f.surface(x, z))) nan++;
  ok(nan === 0, `改完的高程场在 ${(25 * 21)} 个采样点上全都有限（NaN ${nan} 个）`);
  ok(plan.places.every((p) => BUILDERS[p.kind]), `改完的 ${plan.places.length} 个物件全都出得了几何（没有会被游戏吞掉的 kind）`);
  // control：这份脚本确实改了图，而不是七步全空转
  ok(!untouched(plan) && plan.places.length > BASE.places.length, `control：图与改前不同，物件数 ${BASE.places.length} → ${plan.places.length}`);
}

// ---------- 8) 高楼：层数真的换算成米（纯算式，不碰 three） ----------
{
  for (const kind of ['tower', 'office', 'hotel', 'mansion']) {
    const sp = FLOOR_SPEC[kind];
    const lo = buildingHeight(kind, sp.min), hi = buildingHeight(kind, sp.max);
    ok(lo.floors === sp.min && hi.floors === sp.max, `${kind} 层数按 ${sp.min}~${sp.max} 夹住`);
    ok(Math.abs(hi.body - lo.body - (sp.max - sp.min) * sp.fh) < 1e-9, `${kind} 每加一层就长 ${sp.fh} 米（${lo.body.toFixed(2)}→${hi.body.toFixed(2)} 米墙体）`);
    ok(hi.total < 20, `${kind} 拉满 ${sp.max} 层高 ${hi.total.toFixed(2)} 米（含屋顶构件），在半径 60 米的星球上还站得住`);
  }
  ok(buildingHeight('house', 9) === null, 'control：住宅不吃层数，buildingHeight 直接返回 null');
  ok(buildingHeight('tower', 99).total === buildingHeight('tower', FLOOR_SPEC.tower.max).total, '越界层数换算出来的高度 = 上限那栋的高度');
  ok(buildingHeight('tower', undefined).floors === FLOOR_SPEC.tower.def, '没写层数就用该型默认（老数据不用补字段也不会塌）');
}

say(fails ? `\n${fails} 条不合格` : '\n全部合格');
process.exit(fails ? 1 : 0);
