// relief-check.mjs — 造成（土方）机检：高程场自洽 + 地图体检零错 + 序列化往返
// 用法：npx vite-node tools/relief-check.mjs   （纯 CPU，不开浏览器）
import * as THREE from 'three';
import { PLAN, R, makeField, planToVec3 } from '../src/world/layout.js';
import { buildTerrainWorks } from '../src/world/terrainwork.js';
import { checkPlan } from '../src/editor/problems.js';
import { resolveCollisions } from '../src/world/collision.js';
import { serializePlan } from '../src/editor/state.js';
import { stairK, localToPlan, planToLocal, deckLevel, flightLevel, flightFeedsTerrace,
  influenceK, hasRelief, roadPolyline, roadSamples, distToRoad } from '../src/map/terrain.js';

/** 这个 plan 点是不是落在台地某条边的挡墙带上（±1.1 米） */
function landsOnWall(tc, p) {
  const loc = planToLocal(tc.x, tc.z, tc.rotY || 0, p.x, p.z);
  const dn = [Math.abs(Math.abs(loc.lx) - tc.hw), Math.abs(Math.abs(loc.lz) - tc.hd)];
  if (Math.min(...dn) > 1.1) return false;
  const along = dn[0] <= dn[1] ? loc.lz : loc.lx;
  const span = dn[0] <= dn[1] ? tc.hd : tc.hw;
  return Math.abs(along) <= span + 0.6;
}

const say = (...a) => console.log(...a);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; say('FAIL', msg); } else say('ok  ', msg); };

const field = makeField(PLAN);
const Tc = PLAN.terraces || [], Fl = PLAN.flights || [];
say(`台地 ${Tc.length} 块 · 梯道 ${Fl.length} 条 · 有路堤的道路 ${(PLAN.roads || []).filter((r) => r.e1 || r.e2).length} 条`);

// 1) 台面：中心必须 = 自然地面 + h，而且整块台面是水平的；墙外要落回自然地面（含路堤）
for (const [i, tc] of Tc.entries()) {
  const s = field.surface(tc.x, tc.z), nat = field.hillsH(tc.x, tc.z);
  ok(Math.abs(s - nat - tc.h) < 1e-9, `台地 #${i} 台面抬升 ${(s - nat).toFixed(3)}（要 ${tc.h}）`);
  let tilt = 0;
  for (const [lx, lz] of [[0, 0], [tc.hw - 0.3, 0], [-(tc.hw - 0.3), 0], [0, tc.hd - 0.3], [0, -(tc.hd - 0.3)]]) {
    const p = localToPlan(tc.x, tc.z, tc.rotY || 0, lx, lz);
    // 填方台面：整块水平，但绝不挖进山 —— 山脊或路堤顶到台面以上时就地贴地
    const want = Math.max(field.mesh(p.x, p.z), deckLevel(field.hillsH, tc));
    tilt = Math.max(tilt, Math.abs(field.surface(p.x, p.z) - want));
  }
  ok(tilt < 0.02, `台地 #${i} 台面按水平填方（高程差 ${tilt.toFixed(3)} 米，台面绝对高程 ${deckLevel(field.hillsH, tc).toFixed(3)}）`);
  const out = localToPlan(tc.x, tc.z, tc.rotY || 0, tc.hw + 1.5, 0);
  const so = field.surface(out.x, out.z);
  const natOut = field.hillsH(out.x, out.z), roadOut = field.roadElev(out.x, out.z);
  if (tc.edge === 'slope') {
    ok(so > natOut + 0.02 && so < s, `台地 #${i}（放坡）外侧 1.5 米处 ${(so - natOut).toFixed(3)}，在自然地面与台面之间`);
  } else {
    ok(Math.abs(so - (natOut + roadOut)) < 0.05,
      `台地 #${i}（挡墙）外侧 1.5 米处落回地面 ${(so - natOut).toFixed(3)}（路面抬升 ${roadOut.toFixed(3)}）`);
  }
}

// 2) 梯道：每一阶踏面都是一个水平面，绝对高程 = 坡脚自然地面 + k·rise
for (const [i, fl] of Fl.entries()) {
  const steps = Math.max(1, Math.round(fl.steps || Math.round(fl.run / 0.34)));
  const td = fl.run / steps;                                       // 踏面进深
  const base = field.hillsH(fl.x, fl.z);                     // 坡脚基准
  let worst = 0;
  for (let k = 0; k < steps; k++) {
    const lv = flightLevel(field.hillsH, fl, (k + 1) / steps);      // 这一阶的绝对高程（水平踏面）
    for (const lx of [0, -fl.w / 2 + 0.2, fl.w / 2 - 0.2]) {        // 连左右边缘一起，宽度内都得同高
      const p = localToPlan(fl.x, fl.z, fl.rotY || 0, lx, (k + 0.5) * td);
      worst = Math.max(worst, Math.abs(field.surface(p.x, p.z) - Math.max(field.hillsH(p.x, p.z), lv)));
    }
  }
  ok(worst < 1e-9, `石阶 #${i} ${steps} 阶，可见顶面与可走面最大差 ${worst.toFixed(6)} 米`);
  const foot = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, -0.6);      // 坡脚外：该是自然地面
  const f = field.surface(foot.x, foot.z);
  ok(Math.abs(f - field.hillsH(foot.x, foot.z) - field.roadElev(foot.x, foot.z)) < 0.02,
    `石阶 #${i} 坡脚外抬升 ${(f - field.hillsH(foot.x, foot.z)).toFixed(3)}（应只剩路堤）`);
  const top = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
  const lv1 = flightLevel(field.hillsH, fl, 1);
  const t = field.surface(top.x, top.z);
  ok(Math.abs(t - Math.max(field.hillsH(top.x, top.z), lv1)) < 1e-9,
    `石阶 #${i} 顶端绝对高程 ${t.toFixed(3)}（要 坡脚 ${base.toFixed(3)} + ${fl.rise} = ${lv1.toFixed(3)}）`);
  const tc = Tc.find((t2) => t2.edge === 'wall' && landsOnWall(t2, top));
  if (tc) {
    const d = Math.abs(lv1 - deckLevel(field.hillsH, tc));
    ok(d <= 0.15, `石阶 #${i} 顶上就是台地挡墙：梯顶 ${lv1.toFixed(3)} 与台面 ${deckLevel(field.hillsH, tc).toFixed(3)} 差 ${d.toFixed(3)} 米（要 ≤0.15，否则墙不开口）`);
  }
  const mid = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run / 2);
  const side = localToPlan(fl.x, fl.z, fl.rotY || 0, fl.w / 2 + 0.8, fl.run / 2);
  say(`     #${i} 中段阶高 ${(field.surface(mid.x, mid.z) - field.hillsH(mid.x, mid.z)).toFixed(3)}，侧外地面 ${(field.surface(side.x, side.z) - field.hillsH(side.x, side.z)).toFixed(3)}`);
}

// 3) 路堤：只在「这条路自己说了算」的地方比对设计剖面；横向过渡另用一条隔离的路来查。
//    路口段两条路是混合的（见 §3b），拿设计值硬比必然差 —— 那是特性不是 bug。
const SWK = PLAN.sidewalkW ?? 1.35;
const kOf = (rd, x, z) => influenceK(distToRoad(rd, x, z), (rd.w || 2) + SWK, rd.efade ?? 3.0);
let cleanRoads = 0;                                                  // 有几条路在真图上能原样兑现（B 那项不是空转）
/** 折线在 p 点的设计抬升（最近段线性插值），与高程场该兑现的那个值同源 */
function designE(pl, x, z) {
  let best = { d: Infinity, e: 0 };
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1], b = pl[i];
    const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1e-6;
    const u = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / len2));
    const d = Math.hypot(x - (a.x + (b.x - a.x) * u), z - (a.z + (b.z - a.z) * u));
    if (d < best.d) best = { d, e: a.e + (b.e - a.e) * u };
  }
  return best.e;
}
for (const [i, rd] of (PLAN.roads || []).entries()) {
  if (!hasRelief({ roads: [rd] })) continue;
  const pl = roadPolyline(rd);
  const smp = roadSamples(rd, 0.5);
  const clean = smp.filter((p) => PLAN.roads.every((o, j) => j === i || kOf(o, p.x, p.z) < 0.1));
  // A) 单拿这条路建场：逐点必须等于自己的设计剖面（真图上被邻路裙边盖住的短街也能查，且不依赖样本数）
  const iso = makeField({ hills: [], terraces: [], flights: [], sidewalkW: SWK, roads: [rd] });
  let isoOff = 0;
  for (const p of smp) isoOff = Math.max(isoOff, Math.abs(iso.roadElev(p.x, p.z) - designE(pl, p.x, p.z)));
  ok(isoOff < 0.02, `道路 #${i}：设计剖面写进了高程场（单拿这条路建场，每 0.5 米取一个点，最大偏差 ${(isoOff * 100).toFixed(1)} 厘米，设计值跨度 ${(Math.max(...pl.map((q) => q.e)) - Math.min(...pl.map((q) => q.e))).toFixed(2)} 米）`);
  // B) 真图上邻路管不着的那些段还得原样兑现（一条都找不到时由 A 与 §3b 把关，这里只报数）
  let off = 0;
  for (const p of clean) off = Math.max(off, Math.abs(field.relief(p.x, p.z) - designE(pl, p.x, p.z)));
  if (clean.length >= 3) {
    cleanRoads++;
    ok(off < 0.03, `道路 #${i}：邻路管不到的 ${clean.length}/${smp.length} 段照设计兑现（最大偏差 ${(off * 100).toFixed(1)} 厘米）`);
  } else {
    say(`     道路 #${i}：全程在邻路的过渡裙边里（干净样本 ${clean.length}/${smp.length} 段），真图上只由 §3b 的连续性把关`);
  }
  let floating = 0;
  for (const p of smp) {
    if (field.relief(p.x, p.z) !== field.roadElev(p.x, p.z)) continue;   // 台地/石阶压过路面的地方本来就不等
    if (Math.abs(field.mesh(p.x, p.z) - (field.hillsH(p.x, p.z) + field.relief(p.x, p.z))) > 1e-9) floating++;
  }
  ok(floating === 0, `道路 #${i}：星球网格与可走面同高（${smp.length} 个采样点里 ${floating} 个不一致，不一致就是路会浮空或陷进地里）`);
}

ok(cleanRoads >= 2, `control：${cleanRoads} 条路在真图上有一段完全归自己（上面 B 那条逐点比对不是全程空转）`);

// 3b) 路口连续性单元测：两条标高差一米的路十字相交，猫沿任何一条走过去都不能被瞬移上台
{
  const cross = makeField({
    hills: [], terraces: [], flights: [], sidewalkW: 1.35,
    roads: [
      { x1: -20, z1: 0, x2: 20, z2: 0, w: 2.2, e1: 0.9, e2: 0.9, efade: 3 },
      { x1: 0, z1: -20, x2: 0, z2: 20, w: 2, e1: -0.1, e2: -0.1, efade: 3 },
    ],
  });
  let worst = 0, at = 0;
  for (const axis of ['x', 'z']) {
    for (let s = -14; s <= 14; s += 0.5) {
      const a = axis === 'x' ? [s, 0] : [0, s];
      const b = axis === 'x' ? [s - 0.5, 0] : [0, s - 0.5];
      const j = Math.abs(cross.relief(...a) - cross.relief(...b));
      if (j > worst) { worst = j; at = s; }
    }
  }
  ok(worst <= 0.35, `十字路口连续：两式设计标高差 1 米（0.9 与 -0.1），沿任何一条走每 0.5 米最多变 ${worst.toFixed(3)} 米 @${at}（要 ≤0.35 米＝高差的三分之一；旧口径「谁近听谁的」在路带边缘一步跨完 1 米，那就是一道垂直坎）`);
  const mid = cross.relief(0, 0);
  ok(mid > -0.1 && mid < 0.9, `路口板落在两式设计标高之间（${mid.toFixed(3)} 米，介于堑沟 -0.1 与路堤 0.9）`);
  ok(Math.abs(cross.relief(0, 14) + 0.1) < 1e-9 && Math.abs(cross.relief(14, 0) - 0.9) < 1e-9,
    `control：离路口 14 米处仍各自照自己的剖面（${cross.relief(0, 14)} / ${cross.relief(14, 0)}）—— 混合只发生在路口，没有把全线拉平`);
}
{
  const iso = makeField({
    hills: [], terraces: [], flights: [], sidewalkW: 1.35,
    roads: [{ x1: 0, z1: -20, x2: 0, z2: 20, w: 2, e1: 0.5, e2: 0, efade: 3 }],
  });
  const want = 0.5 + (0 - 0.5) * 0.25;                              // e1=0.5 → e2=0，沿线 1/4 处
  ok(Math.abs(iso.relief(0, -10) - want) < 1e-9, `隔离路堤：南北 1/4 处 = ${iso.relief(0, -10).toFixed(3)}（要 ${want}）`);
  ok(iso.relief(0, 19.9) < 0.005, `隔离路堤：南端归零（${iso.relief(0, 19.9).toFixed(4)}）`);
  const edge = 2 + 1.35;                                            // 道牙外缘
  ok(iso.relief(edge - 0.1, -10) > want - 0.005, `隔离路堤：道牙内还是满值（${iso.relief(edge - 0.1, -10).toFixed(3)}）`);
  ok(iso.relief(edge + 3.1, -10) === 0, `隔离路堤：过渡带 3 米外归零（${iso.relief(edge + 3.1, -10)}）`);
  ok(iso.relief(edge + 1.5, -10) > 0 && iso.relief(edge + 1.5, -10) < want,
    `隔离路堤：过渡带中段有坡度（${iso.relief(edge + 1.5, -10).toFixed(3)}）`);
}

// 4) 全域：不许出现 NaN / 离谱高程
let bad = 0, hi = -99, lo = 99, hiAt = null;
for (let x = -34; x <= 34; x += 0.25) {
  for (let z = -34; z <= 30; z += 0.25) {
    const h = field.surface(x, z);
    if (!Number.isFinite(h)) { bad++; continue; }
    if (h > hi) { hi = h; hiAt = [x, z]; }
    if (h < lo) lo = h;
  }
}
ok(bad === 0, `全域采样无 NaN（坏点 ${bad}）`);
ok(hi < 4.5, `全域最高 ${hi.toFixed(2)} 米 @ ${hiAt}（超过 4.5 米猫会爬不动）`);
say(`     全域最低 ${lo.toFixed(2)} 米`);

// 5) stairK 与几何的对应：站在第 k 阶就是第 k 阶顶
ok(stairK(0, 4) === 0.25 && stairK(0.999, 4) === 1, `stairK：坡脚即第一阶顶 ${stairK(0, 4)}，顶端 ${stairK(0.999, 4)}`);

// 6) 反向兼容：把造成清空后必须等于纯山丘
const bare = structuredClone(PLAN);
bare.terraces = []; bare.flights = [];
for (const r of bare.roads) { r.e1 = 0; r.e2 = 0; delete r.e; }   // 折线路的抬升写在 e 数组里，只清 e1/e2 等于没清
const bf = makeField(bare);
let maxDiff = 0;
for (let x = -30; x <= 30; x += 1) for (let z = -30; z <= 28; z += 1) {
  maxDiff = Math.max(maxDiff, Math.abs(bf.surface(x, z) - bf.hillsH(x, z)));
}
ok(hasRelief(PLAN), `control：这张真图确实带造成（不然下一条「清零后等于山丘」是空转）`);
ok(maxDiff === 0, `没有造成时 surface 完全等于自然丘陵（差 ${maxDiff}）`);

// 7) 地图体检：造成相关的不许有 err
const issues = checkPlan(PLAN);
const reliefErrs = issues.filter((i) => i.type === 'relief' && i.level === 'err');
const reliefWarns = issues.filter((i) => i.type === 'relief' && i.level === 'warn');
for (const i of reliefErrs) say('  ERR ', i.msg);
for (const i of reliefWarns) say('  WARN', i.msg);
ok(reliefErrs.length === 0, `造成体检 0 错（warn ${reliefWarns.length}）`);
const otherErrs = issues.filter((i) => i.type !== 'relief' && i.level === 'err');
say(`     本轮非造成 err ${otherErrs.length} 条`);
for (const i of otherErrs.slice(0, 8)) say('  ERR ', i.msg);

// 8) 序列化往返：写出去再读回来必须一模一样（编辑器的撤销/保存靠这个）
const text = serializePlan(PLAN);
const back = JSON.parse(text);
const f2 = makeField(back);
let ser = 0;
for (const tc of Tc) ser = Math.max(ser, Math.abs(field.surface(tc.x, tc.z) - f2.surface(tc.x, tc.z)));
for (const fl of Fl) {
  const p = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run / 2);
  ser = Math.max(ser, Math.abs(field.surface(p.x, p.z) - f2.surface(p.x, p.z)));
}
ok(ser === 0, `序列化往返后高程一致（差 ${ser}）`);
ok(text.includes('"terraces"') && text.includes('"flights"'), 'town-plan.json 里带上了 terraces/flights 两段');
ok(!/undefined/.test(text), '序列化没写出 undefined');

// 9) 实体回验：拿 terrainwork 真的三角形 + 径向射线，可见顶面必须等于可走面
//    （前面几节只验了公式，这里验的是画到屏幕上的那层几何 —— 公式对、盒子画歪了同样会踩空）
const bk = {};
buildTerrainWorks(bk, field, PLAN);
const meshes = [];
for (const [bucket, gs] of Object.entries(bk)) {
  for (const g of gs) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.userData.bucket = bucket;
    m.updateMatrixWorld(true);
    meshes.push(m);
  }
}
const wallMeshes = meshes.filter((m) => m.userData.bucket === 'concrete');
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
const rc = new THREE.Raycaster();
rc.far = 16;
/** 从 (x,z) 上方 8 米沿球面法向打下来，返回第一个命中的「离地高度」 */
function topAt(x, z, only = meshes) {
  planToVec3(x, z, 8, _o);
  planToVec3(x, z, 0, _d).sub(_o).normalize();
  rc.set(_o, _d);
  let best = null;
  for (const m of only) {
    for (const h of rc.intersectObject(m, false)) {
      const hh = h.point.length() - R;
      if (best === null || hh > best) best = hh;
    }
  }
  return best;
}
say(`     造成几何体块 ${meshes.length} 个（其中挡墙 ${wallMeshes.length}）`);
for (const [i, tc] of Tc.entries()) {
  const pts = [['中心', 0, 0], ['+x 内沿', tc.hw - 0.3, 0], ['-z 内沿', 0, -(tc.hd - 0.3)]];
  for (const [tag, lx, lz] of pts) {
    const p = localToPlan(tc.x, tc.z, tc.rotY || 0, lx, lz);
    const got = topAt(p.x, p.z);
    ok(got !== null && Math.abs(got - field.surface(p.x, p.z)) < 0.03,
      `台地 #${i} ${tag}：可见顶面 ${got === null ? '无' : got.toFixed(3)}，可走面 ${field.surface(p.x, p.z).toFixed(3)}`);
  }
}
for (const [i, fl] of Fl.entries()) {
  const steps = Math.max(1, Math.round(fl.steps || 3)), th = fl.rise / steps, td = fl.run / steps;
  let worst = 0, miss = 0;
  for (let k = 0; k < steps; k++) {
    const p = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, (k + 0.5) * td);
    const got = topAt(p.x, p.z);
    if (got === null) { miss++; continue; }
    worst = Math.max(worst, Math.abs(got - field.surface(p.x, p.z)));
  }
  ok(miss === 0 && worst < 0.005, `石阶 #${i}：${steps} 阶实体可打中，可见顶面与可走面最大差 ${worst.toFixed(4)} 米（漏 ${miss} 阶）`);
  // 挡墙必须在梯道顶部开口：梯道正上方只该有台阶，墙身要让路；侧移一段墙还得在
  const top0 = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
  const tc = Tc.find((t) => t.edge === 'wall' && landsOnWall(t, top0) && flightFeedsTerrace(field.hillsH, t, fl));
  if (!tc) { say(`     #${i} 顶部没接挡墙（或标高对不上），跳过开口回验`); continue; }
  const top = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
  const loc = planToLocal(tc.x, tc.z, tc.rotY || 0, top.x, top.z);
  const sideAx = Math.abs(Math.abs(loc.lx) - tc.hw) < Math.abs(Math.abs(loc.lz) - tc.hd) ? 'x' : 'z';
  const half = sideAx === 'x' ? tc.hw : tc.hd;          // 这条边到中心的法向距离
  const span = sideAx === 'x' ? tc.hd : tc.hw;          // 这条边的半长
  const sgn = sideAx === 'x' ? Math.sign(loc.lx) : Math.sign(loc.lz);
  const along = sideAx === 'x' ? loc.lz : loc.lx;
  say(`     墙开口 #${i}：靠${sideAx} 边 sgn=${sgn} half=${half.toFixed(2)} span=${span.toFixed(2)} along=${along.toFixed(2)}`);
  const probe = (a) => {
    const l = sideAx === 'x' ? { lx: sgn * (half + 0.15), lz: a } : { lx: a, lz: sgn * (half + 0.15) };
    return localToPlan(tc.x, tc.z, tc.rotY || 0, l.lx, l.lz);
  };
  const outA = Math.min((fl.w || 1.5) / 2 + 0.5, span - 0.2);
  const holeAt = probe(along), fullAt = probe(along + outA);
  const hole = topAt(holeAt.x, holeAt.z, wallMeshes);
  const full = topAt(fullAt.x, fullAt.z, wallMeshes);
  const deck = deckLevel(field.hillsH, tc);              // 压顶石就该在这一水平高度上
  ok(hole === null,
    `台地挡墙在石阶 #${i} 顶部开口：梯顶正对处（plan ${holeAt.x.toFixed(2)},${holeAt.z.toFixed(2)}）${hole === null ? '没有墙' : '还有 ' + hole.toFixed(3) + ' 米的压顶'}`);
  ok(full !== null && Math.abs(full - deck) < 0.06,
    `台地挡墙未开口处仍有压顶：沿边侧移 ${outA.toFixed(1)} 米（plan ${fullAt.x.toFixed(2)},${fullAt.z.toFixed(2)}）墙顶 ${full === null ? '空' : full.toFixed(3)}，台面 ${deck.toFixed(3)}`);
}

// 10) 虚拟猫：沿坡面走要一路通畅（碰撞开口 = 几何开口），撞挡墙要被推出（不能瞬移上台）
const CAT_R = 0.18;                                    // 与 player/cat.js 同口径
for (const [i, fl] of Fl.entries()) {
  let worst = 0, at = null;
  // 只扫到挡墙带外沿（坡顶 + 0.4 米）再多走就进了台面，台面上的神社本来就要挡人，不是这一项要查的
  for (let lz = -2; lz <= fl.run + 0.41; lz += 0.1) {
    const p = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, lz);
    const hit = resolveCollisions(p.x, p.z, CAT_R);
    if (!hit) continue;
    const d = Math.hypot(hit.x - p.x, hit.z - p.z);
    if (d > worst) { worst = d; at = lz; }
  }
  ok(worst < 0.05,
    `虚拟猫沿石阶 #${i} 中线从坡脚走上挡墙带（只到墙外 0.4 米，台面里的建筑本该挡人）：最大被推出 ${worst.toFixed(2)} 米${at === null ? '（全程无阻）' : `（lz=${at.toFixed(1)} 处）`}`);
  // control：同一条边侧移 1.6 米（墙身）必须挡人，否则上面那条「无阻」是碰撞体压根没建出来的空转
  {
    const landing = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
    const tc = Tc.find((t) => t.edge === 'wall' && landsOnWall(t, landing) && flightFeedsTerrace(field.hillsH, t, fl));
    if (tc) {
      const loc = planToLocal(tc.x, tc.z, tc.rotY || 0, landing.x, landing.z);
      const nx = Math.abs(Math.abs(loc.lx) - tc.hw), nz = Math.abs(Math.abs(loc.lz) - tc.hd);
      // 法向（墙所在那侧）与沿边（墙身方向）
      const dn = nx <= nz ? 'x' : 'z';
      const off = { lx: loc.lx, lz: loc.lz };
      off[dn === 'x' ? 'lz' : 'lx'] = loc[dn === 'x' ? 'lz' : 'lx'] + 1.6;
      const l = localToPlan(tc.x, tc.z, tc.rotY || 0, off.lx, off.lz);
      const hit = resolveCollisions(l.x, l.z, CAT_R);
      ok(hit && Math.hypot(hit.x - l.x, hit.z - l.z) > 0.05,
        `石阶 #${i} 的口子旁边 1.6 米是墙身，虚拟猫要被推出（control：证明上面那条「无阻」不是空转）`);
    }
  }
}
for (const [i, tc] of Tc.filter((t) => t.edge === 'wall' && t.h > 0.15).entries()) {
  let blocked = null;
  for (const side of [{ ax: 'z', sgn: 1 }, { ax: 'z', sgn: -1 }, { ax: 'x', sgn: 1 }, { ax: 'x', sgn: -1 }]) {
    const half = side.ax === 'x' ? tc.hd : tc.hw, span = side.ax === 'x' ? tc.hw : tc.hd;
    const a = span - 0.6;                               // 靠墙角采样，那里不该是梯道开口
    for (let d = half + 1.0; d >= half - 0.5 && !blocked; d -= 0.1) {
      const l = side.ax === 'x' ? { lx: a, lz: side.sgn * d } : { lx: side.sgn * d, lz: a };
      const p = localToPlan(tc.x, tc.z, tc.rotY || 0, l.lx, l.lz);
      const hit = resolveCollisions(p.x, p.z, CAT_R);
      if (hit && Math.hypot(hit.x - p.x, hit.z - p.z) > 0.05) blocked = `${side.ax === 'x' ? (side.sgn > 0 ? '+z' : '-z') : (side.sgn > 0 ? '+x' : '-x')} 边 @沿边 ${a.toFixed(1)}`;
    }
    if (blocked) break;
  }
  ok(blocked !== null, `虚拟猫撞台地 #${i} 的挡墙要能被推出（否则能直接穿上台）：${blocked ?? '四条边都穿过去了'}`);
}

// 8) 合并契约：同一个材质桶里的几何，属性集必须一模一样
//    three 的 mergeGeometries 一遇到不齐的就整桶返回 null，而 town.js 只看 null 就 continue ——
//    结果是那一桶的建筑集体消失，console 里只留一行 error。造成是手搓几何，最容易在这里破约。
{
  const bucketGeos = {};
  buildTerrainWorks(bucketGeos, field, PLAN);
  const EXPECT = 'color normal position uv -idx';   // props 出来的几何都是这一套；桶材质挂了颗粒贴图，uv 不能少
  const bad = [];
  let n = 0;
  for (const [bucket, geos] of Object.entries(bucketGeos)) {
    for (const g of geos) {
      n++;
      const sig = [...Object.keys(g.attributes).sort(), g.index ? '+idx' : '-idx'].join(' ');
      if (sig !== EXPECT) bad.push(`${bucket}: ${sig}`);
    }
  }
  ok(n > Tc.length + Fl.length, `control：造成这一趟真产出了 ${n} 块几何（台地 ${Tc.length} + 梯道 ${Fl.length} 条各自都不止一块，下面那条不是空转）`);
  ok(!bad.length, `造成进桶的 ${n} 块几何属性集都是「${EXPECT}」${bad.length ? ` — 不齐的有：${bad.slice(0, 3).join(' / ')}` : ''}`);
}

say(fails ? `\n${fails} 项不合格` : '\n全部合格');
process.exit(fails ? 1 : 0);
