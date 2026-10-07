// problems.js — 地图体检：把「游戏里会出怪事」的情形逐条列出，可点击定位
import { SOLIDS, makeField } from '../world/layout.js';
import { BUILDERS } from '../world/props.js';
import { WORDS } from '../game/words.js';
import { ROAD_OK_KINDS } from './kinds.js';
import { planToLocal, localToPlan, terraceBound, deckLevel, flightLevel, distToRoad, roadSamples } from '../map/terrain.js';

const wordIds = new Set(WORDS.map((w) => w.id));

/** SOLIDS 条目 → 旋转后的 AABB（plan 空间），用于重叠粗筛 */
function footprint(p, solid) {
  const s = p.s || 1;
  const t = p.rotY || 0, c = Math.abs(Math.cos(t)), si = Math.abs(Math.sin(t));
  const hw = (solid.w || solid.r || 0.3) * s, hd = (solid.d || solid.r || 0.3) * s;
  const ex = (hw * c + hd * si) * 0.86;   // 0.86：外观上多数建筑没占满碰撞盒，容得下紧贴摆放
  const ez = (hw * si + hd * c) * 0.86;
  return { x1: p.x - ex, x2: p.x + ex, z1: p.z - ez, z2: p.z + ez };
}

const BUILDING_KINDS = new Set([
  'station', 'school', 'hospital', 'bank', 'library', 'postOffice',
  'mansion', 'house', 'konbini', 'ramen', 'cafe', 'supermarket', 'shrine',
  'tower', 'office', 'hotel',
]);

const LAND_Z_MAX = 23.5;   // 再往南就是沙滩/海
const DISC_R = 46;         // 球面贴图带覆盖到纬度 +90°/-30°，plan 距离 46 以外才算丢进虚空
const PLANT_KINDS = new Set(['tree', 'sakura', 'flowers', 'grassTuft']);

export function checkPlan(plan) {
  const issues = [];  const push = (level, type, target, msg) => issues.push({ level, type, target, msg });

  plan.places.forEach((p, i) => {
    const target = { type: 'place', i };
    const label = `${p.kind} #${i}（${p.x.toFixed(1)}, ${p.z.toFixed(1)}）`;
    if (!BUILDERS[p.kind]) {
      push('err', 'kind', target, `不认识的房子类型 "${p.kind}"，游戏里会凭空消失 — ${label}`);
    }
    if (!p.word) {
      push('warn', 'word', target, `没配单词，玩家拍不到它 — ${label}`);
    } else if (!wordIds.has(p.word)) {
      push('err', 'word', target, `单词本里没有 "${p.word}"，拍下会报错 — ${label}`);
    }
    if (p.z > 30.5) {
      push('err', 'sea', target, `z=${p.z.toFixed(1)} 已是海面，物件会飘在水上 — ${label}`);
    } else if (p.z > LAND_Z_MAX && !PLANT_KINDS.has(p.kind)) {
      push('err', 'sea', target, `南边 ${p.z.toFixed(1)} 米已是沙滩，这里该放植物而不是 ${p.kind} — ${label}`);
    }
    if (Math.hypot(p.x, p.z) > DISC_R) {
      push('err', 'edge', target, `离中心 ${(Math.hypot(p.x, p.z)).toFixed(1)} 米，超出城镇帽 — ${label}`);
    }
  });

  plan.forestTrees.forEach((t, i) => {
    const d = Math.hypot(t.x, t.z);
    if (d > DISC_R || t.z > 24 || t.z < -34) {
      push('warn', 'forest', { type: 'tree', i }, `森林装饰树（${t.x.toFixed(1)}, ${t.z.toFixed(1)}）跑出了林带（d=${d.toFixed(1)}, z=${t.z.toFixed(1)}）`);
    }
  });

  // 建筑压路 / 建筑互压：只查实体类
  const solids = [];
  plan.places.forEach((p, i) => {
    const def = SOLIDS[p.kind];
    if (!def) return;
    solids.push({ p, i, def: Array.isArray(def) ? def[0] : def });
    // 压路：盒中心到路中心线距离 < 半宽 + 0.2 视为骑在路上（车站正对主街尽头，是设定好的）
    if (BUILDING_KINDS.has(p.kind) && p.kind !== 'station') {
      for (const rd of plan.roads) {
        const d = distToRoad(rd, p.x, p.z);
        if (!ROAD_OK_KINDS.has(p.kind) && d < rd.w + 0.2) {
          push('warn', 'road', { type: 'place', i },
            `${p.kind} #${i} 压在马路上（离中心线 ${d.toFixed(1)} 米），玩家会被卡在墙外`);
          break;
        }
      }
    }
  });
  for (let a = 0; a < solids.length; a++) {
    for (let b = a + 1; b < solids.length; b++) {
      const ka = solids[a].p.kind, kb = solids[b].p.kind;
      if (!(BUILDING_KINDS.has(ka) && BUILDING_KINDS.has(kb))) continue;
      const fa = footprint(solids[a].p, solids[a].def);
      const fb = footprint(solids[b].p, solids[b].def);
      if (fa.x1 < fb.x2 && fa.x2 > fb.x1 && fa.z1 < fb.z2 && fa.z2 > fb.z1) {
        push('err', 'overlap', { type: 'place', i: solids[a].i },
          `${ka} #${solids[a].i} 与 ${kb} #${solids[b].i} 占地重叠，会互相穿模`);
      }
    }
  }
  issues.push(...checkRelief(plan, solids));
  return issues;
}

// ---------- 造成（土方）体检：台地/石阶/路堤把地面改了，就得保证改得走人 ----------
/** 点到台地矩形边界的带符号距离（负=在台面内） */
function rectEdgeDist(tc, x, z) {
  const { lx, lz } = planToLocal(tc.x, tc.z, tc.rotY || 0, x, z);
  return Math.max(Math.abs(lx) - tc.hw, Math.abs(lz) - tc.hd);
}

/** 梯道自身的采样线（左右边 + 中线），用来查它有没有压在行车面上 */
function flightSamples(fl, step = 0.5) {
  const n = Math.max(2, Math.ceil((fl.run || 0) / step));
  const hw = (fl.w || 1.5) / 2;
  const pts = [];
  for (const lx of [-hw, 0, hw]) {
    for (let i = 0; i <= n; i++) pts.push(localToPlan(fl.x, fl.z, fl.rotY || 0, lx, (i / n) * fl.run));
  }
  return pts;
}

/** 石阶/坡道的顶端是否落在这块台地的边线上（离矩形边界 1.1 米内、沿边不出台地） */
function landsOnWall(tc, fl) {
  const top = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
  const loc = planToLocal(tc.x, tc.z, tc.rotY || 0, top.x, top.z);
  const du = Math.abs(loc.lx) - tc.hw, dv = Math.abs(loc.lz) - tc.hd;
  if (Math.abs(Math.max(du, dv)) > 1.1) return false;
  return du > dv ? Math.abs(loc.lx) <= tc.hw + 0.6 : Math.abs(loc.lz) <= tc.hd + 0.6;
}

/** 台地矩形边线采样点（含放坡裙不算，查的是「边」压到道牙没有） */
function terracePerimeter(tc, step = 0.5) {
  const per = 4 * (tc.hw + tc.hd);
  const n = Math.max(8, Math.ceil(per / step));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 4, side = Math.floor(t) % 4, f = t - Math.floor(t);
    let lx, lz;
    if (side === 0) { lx = -tc.hw + 2 * tc.hw * f; lz = -tc.hd; }
    else if (side === 1) { lx = tc.hw; lz = -tc.hd + 2 * tc.hd * f; }
    else if (side === 2) { lx = tc.hw - 2 * tc.hw * f; lz = tc.hd; }
    else { lx = -tc.hw; lz = tc.hd - 2 * tc.hd * f; }
    pts.push(localToPlan(tc.x, tc.z, tc.rotY || 0, lx, lz));
  }
  return pts;
}

export function checkRelief(plan, solidPlaces) {
  const issues = [];
  const push = (level, type, target, msg) => issues.push({ level, type, target, msg });
  const Tc = plan.terraces || [], Fl = plan.flights || [];
  const field = makeField(plan);                 // 台面/梯顶要按同一把绝对高程尺子比，光看 h 和 rise 不够

  (plan.roads || []).forEach((rd, i) => {
    for (const k of ['e1', 'e2']) {
      const v = rd[k] || 0;
      if (Math.abs(v) > 1.2) {
        push('err', 'relief', { type: 'road', i },
          `道路 #${i} 的 ${k}=${v.toFixed(2)} 米：路堤/堑沟超过 1.2 米，小猫爬不动也会卡在坡脚`);
      }
    }
  });

  Tc.forEach((tc, i) => {
    const target = { type: 'terrace', i };
    const label = `台地 #${i}（${tc.x.toFixed(1)}, ${tc.z.toFixed(1)}，+${(tc.h ?? 0).toFixed(2)}m）`;
    if (!(tc.hw > 0.4) || !(tc.hd > 0.4)) {
      push('err', 'relief', target, `${label} 半宽/半深要大于 0.4 米，现在没法出几何`);
    }
    if (!(tc.h > -1.5 && tc.h < 2.5)) push('err', 'relief', target, `${label} 抬升要在 -1.5~2.5 米之间`);
    if (tc.edge === 'slope' && !(tc.apron >= 0.8)) {
      push('warn', 'relief', target, `${label} 放坡裙宽 ${tc.apron ?? '缺省'} 米，小于 0.8 米会看成垂直墙`);
    }
    if (Math.hypot(tc.x, tc.z) + terraceBound(tc) > DISC_R) {
      push('err', 'relief', target, `${label} 伸到城镇帽外（半径 ${DISC_R} 米），边缘会悬空`);
    }
    if (tc.z + tc.hd > (plan.beachZ ?? 24)) {
      push('warn', 'relief', target, `${label} 南边压到沙滩线（z=${plan.beachZ}），挡墙会插进海里`);
    }
    // 挡墙横穿马路 / 边缘压到道牙
    for (const [ri, rd] of (plan.roads || []).entries()) {
      const band = rd.w + (plan.sidewalkW ?? 1.35);
      const covered = roadSamples(rd).some((pt) => rectEdgeDist(tc, pt.x, pt.z) < 0);
      const onBand = terracePerimeter(tc).filter((pt) => distToRoad(rd, pt.x, pt.z) < band).length;
      if (covered && tc.h > 0.15 && (tc.edge || 'wall') === 'wall') {
        push('err', 'relief', target,
          `${label} 的台面盖住了道路 #${ri} 的中心线，挡墙会从马路中间穿过去`);
      } else if (onBand && tc.h > 0.15) {
        push('warn', 'relief', target,
          `${label} 的边线压到道路 #${ri} 的人行道上了，道牙会歪`);
      }
    }
    // 建筑被挡墙切开
    if ((tc.edge || 'wall') === 'wall' && tc.h > 0.15) {
      for (const { p, def } of solidPlaces) {
        if (!BUILDING_KINDS.has(p.kind)) continue;
        const f = footprint(p, def);
        const cs = [[f.x1, f.z1], [f.x2, f.z1], [f.x1, f.z2], [f.x2, f.z2]];
        const inside = cs.filter(([x, z]) => rectEdgeDist(tc, x, z) < -0.2).length;
        if (inside === 0 || inside === 4) continue;
        push('err', 'relief', target,
          `${p.kind}（${p.x.toFixed(1)}, ${p.z.toFixed(1)}）跨在${label}的挡墙上：一部分在台顶一部分在台下，房子会被切开`);
      }
      const served = Fl.some((fl) => landsOnWall(tc, fl) && Math.abs(flightLevel(field.hillsH, fl, 1) - deckLevel(field.hillsH, tc)) <= 0.3);
      if (!served) {
        push('warn', 'relief', target, `${label} 四周只有挡墙，没有石阶/坡道接上去，猫只能绕着走`);
      }
    }
  });

  Fl.forEach((fl, i) => {
    const target = { type: 'flight', i };
    const label = `${(fl.kind || 'stair') === 'ramp' ? '坡道' : '石阶'} #${i}（${fl.x.toFixed(1)}, ${fl.z.toFixed(1)}，+${(fl.rise ?? 0).toFixed(2)}m）`;
    if (!(fl.run > 0.2) || !(fl.w >= 0.6) || !(fl.rise > 0.05)) {
      push('err', 'relief', target, `${label} 需要 run>0.2、w≥0.6、rise>0.05 才能出几何`);
      return;
    }
    const steps = Math.max(1, Math.round(fl.steps || Math.round(fl.run / 0.34)));
    const kick = fl.rise / steps;
    if (kick > 0.3) push('err', 'relief', target, `${label} 每级踢面 ${(kick * 100).toFixed(0)} 厘米，猫一步跨不上去`);
    else if (kick > 0.2) push('warn', 'relief', target, `${label} 每级踢面 ${(kick * 100).toFixed(0)} 厘米，偏陡（舒适区 20 厘米内）`);
    const ratio = fl.run / fl.rise;
    if (ratio < 1.1) push('err', 'relief', target, `${label} 坡度太陡：升高 1 米只走 ${ratio.toFixed(1)} 米`);
    else if ((fl.kind || 'stair') === 'ramp' && ratio < 2.2) {
      push('warn', 'relief', target, `${label} 是无台阶的坡道，升高 1 米只走 ${ratio.toFixed(1)} 米，推车会上不去`);
    }
    if (Math.hypot(fl.x, fl.z) + Math.hypot(fl.w / 2, fl.run) > DISC_R) {
      push('err', 'relief', target, `${label} 伸出城镇帽外了`);
    }
    for (const [ri, rd] of (plan.roads || []).entries()) {
      const hit = flightSamples(fl).some((pt) => distToRoad(rd, pt.x, pt.z) < rd.w);
      if (hit) push('err', 'relief', target, `${label} 压在道路 #${ri} 的行车面上`);
    }
    // 顶端接的台地必须同高（绝对高程），否则接不上台面
    for (const tc of Tc) {
      if (!landsOnWall(tc, fl)) continue;
      const d = Math.abs(flightLevel(field.hillsH, fl, 1) - deckLevel(field.hillsH, tc));
      if (d > 0.3) {
        push('err', 'relief', target,
          `${label} 顶面高程 ${flightLevel(field.hillsH, fl, 1).toFixed(2)}m 与台地 #${(plan.terraces || []).indexOf(tc)} 台面 ${deckLevel(field.hillsH, tc).toFixed(2)}m 差 ${d.toFixed(2)} 米，接不上台面`);
      }
    }
    // 坡脚和坡顶都泡在山坡里（自然地面已高于剖面）＝这条坡道其实是埋在地下的
    const footNat = field.hillsH(fl.x, fl.z), topP = localToPlan(fl.x, fl.z, fl.rotY || 0, 0, fl.run);
    const riseNat = field.hillsH(topP.x, topP.z) - footNat;
    if (riseNat > fl.rise + 0.05) {
      push('err', 'relief', target,
        `${label} 沿山坡往上走：坡脚到坡顶自然地面自己就涨了 ${riseNat.toFixed(2)} 米，比 ${fl.rise.toFixed(2)} 米的设计高差还大，台阶会埋进土里`);
    }
  });
  return issues;
}
