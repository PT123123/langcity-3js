// frontage.js — 沿街退线的唯一口径 + 「紧凑化」打包
//
// 为什么要它：并图后的图不是比例尺太大，是**退线没人排**。实测街网总长 560m、
// 两侧人行道退线约 1100m，按 3.6m 门面 + 0.9m 缝能放 240 栋，实际只落了 25 栋
// （镇界 80×60m 内底圈覆盖率 19%，楼-楼最近邻中位 9.2m；真实日本商店街是 1~3m）。
// 所以这里把「哪栋楼站哪条街的哪一段」当成一维装箱来解：
//   · first-fit-decreasing —— 按门面宽度降序进箱（大栋先落，小栋补缝）
//   · Growth-via-Contact —— Sayarath 的城市生长模型：新楼必须贴着已有的都市肌理长，
//     不许在空地中央孤立落地。落到实现上就是「只从空闲区间两端往里排」。
// 硬线（底圈不许踩沥青）不在这里商量，仍然走 asphaltSlack；排完由 unblockStreets 复核。
//
// 另外把 town.js 里那套「规划格子 ↔ 切平面」的换算（planK/tan2plan/roadDirs）和退线
// 口径（laneDepth/asphaltSlack）一起搬到这里——打包器、认街、让路必须用同一把尺，
// 否则就会重现「近似报余 0.18m 合规、真实角尖踩进行车道 1.43m」那种对不上账的病。
import * as THREE from 'three';
import { ROADS, SIDEWALK_W, PLAZA, roadDistance } from './townPlan.js';
import { dirFromPx } from './planetMap.js';

export const KERB = 0.16;         // 路缘石离街心的距离（asphaltSlack 的硬线就量到这里）
export const STAND_GAP = 0.45;    // 墙前站人带：日本商店街就是门面贴路缘
export const SIDE_GAP = 0.9;      // 连栋之间的缝（猫宽 0.7 + 余量）
export const CORNER_CLEAR = 0.2;  // 路口被交叉街吃掉的退线余量
export const SLACK_MIN = 0.12;    // 底圈离路缘石的最小余量（与 unblockStreets 的 MIN 同值）

export const PACK_CFG = {
  // 只往街网内沿排：镇界 xT=40/zT=30 再收一档，别把楼摊到台地边缘的锥坡上
  limitX: 37, limitZ: 24,
  target: 118,        // 实体建筑总数上限（含手写城那批锚点）
  minInfill: 2.8,     // 剩下的缝比这还窄就不塞了，留给人过
  landmarkClear: 13,  // 「一镇一次」：同款市政设施之间至少隔这么多米
};

// ---------- 几何换算（自 town.js 搬来，口径一字未改） ----------

/** 量出模型在本地的真实占地（构建器都以 +Z 朝前、底面 y≈0 为约定）。
 *  bodyOnly（楼用）：只算「体量」——平面两条边都 ≥0.6 m 的块。旗杆(0.09)、校门柱(0.3)、
 *  雨棚腿、招牌这些挂在山墙外的细件不能算进占地，否则 8×3.8 的校舎会被量成 10.2×9.4，
 *  全镇唯一放得下的街区也判成放不下，白白把校舍缩到七成。 */
export function measureFoot(g, bodyOnly = false) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const world = new THREE.Box3();
  const local = new THREE.Box3();
  const full = new THREE.Box3().makeEmpty();
  const body = new THREE.Box3().makeEmpty();
  let has = false, hasBody = false;
  g.traverse((o) => {
    if (!o.isMesh || o.isSprite || o.renderOrder === 2) return;         // blob shadow 不算体量
    if (o.material && (o.material.transparent || o.material.depthWrite === false)) return;
    if (!o.geometry) return;
    world.makeEmpty().setFromObject(o);
    if (world.isEmpty()) return;
    local.copy(world).applyMatrix4(inv);
    full.union(local);
    has = true;
    if (local.max.x - local.min.x >= 0.6 && local.max.z - local.min.z >= 0.6) { body.union(local); hasBody = true; }
  });
  if (!has) return { hx: 0.4, hz: 0.4, corner: 0.55, minY: 0, top: 0.8 };
  const src = bodyOnly && hasBody ? body : full;
  const hx = Math.max(-src.min.x, src.max.x), hz = Math.max(-src.min.z, src.max.z);
  return { hx, hz, corner: Math.hypot(hx, hz), minY: full.min.y, top: full.max.y };
}

/** 规划坐标系是等距圆柱经纬网（townPlan.makePlanFrame）：x = λ·R·sinφ、z = R(φ−φ0)。
 *  所以「沿南北走 b 米」会让规划 x 白漂 k·b 米，k = λ·cosφ —— 规划格子和玩家脚下的
 *  切平面差一个随位置变的剪切。镇心 λ≈0 看不出来，镇缘实测到 k = −1.17。
 *  街是照规划铺的（它就是权威），所以楼的落点与朝向统统换到切平面上量。 */
export function planK(frame, x, z) {
  const phi = frame.phi0Deg * Math.PI / 180 + z / frame.R;
  const s = Math.max(0.08, Math.sin(phi));
  return (x / (frame.R * s)) * Math.cos(phi);
}
/** 切平面偏移 (a=东, b=南) 米 → 规划落点 */
export function tan2plan(frame, x, z, a, b) {
  return [x + a + planK(frame, x, z) * b, z + b];
}
/** 规划方向 (dx,dz) → 切平面单位方向 [a,b]（basisAt 的 yaw 就按这个口径给） */
export function plan2tan(frame, x, z, dx, dz) {
  const a = dx - planK(frame, x, z) * dz, b = dz;
  const L = Math.hypot(a, b) || 1;
  return [a / L, b / L];
}
/** 街在某个街心点上的「真实顺街方向 + 真实法线」（切平面单位向量）。
 *  法线不能用 plan2tan(规划法线)：那是「规划法线这个方向的像」，跟画出来的街线不垂直。 */
export function roadDirs(frame, x, z, dx, dz) {
  const [ra, rb] = plan2tan(frame, x, z, dx, dz);
  return [ra, rb, -rb, ra];
}
/** 反向：切平面 yaw（模型真正转的角）→ 规划格子里看起来的角（小地图吃的是规划角） */
export function planYawDeg(frame, x, z, yawDeg) {
  const th = (yawDeg || 0) * Math.PI / 180;
  const k = planK(frame, x, z);
  return Math.atan2(Math.sin(th) + k * Math.cos(th), Math.cos(th)) * 57.2958;
}

/** 【认街线】一件楼正墙朝街时该站多远：街心 → 沥青半宽 → 路缘 → 墙前站人带 → 墙脚 */
export function laneDepth(rd, hz) {
  return rd.w + KERB + STAND_GAP + hz;
}

/** 【硬线】模型的底圈不能踩上任何一条街的沥青。
 *  取样点必须是**矩形**边界（四角 + 四边中点），不能是内切椭圆：早先按 8 个等角取
 *  (cos·hx, sin·hz)，那是椭圆的点，四角比矩形短最多 41%，于是「中心压着街心线」的病栋
 *  被量成合法（实测 hospital @ (20.6,-0.5)，体量 5.5×4.1，报 0 而玩家直接撞墙）。
 *  取样点还要过一遍 tan2plan：模型是照切平面摆的，矩形在规划格子里是平行四边形。 */
export function asphaltSlack(frame, hx, hz, yawDeg, x, z) {
  const th = (yawDeg || 0) * Math.PI / 180, c = Math.cos(th), si = Math.sin(th);
  const R = [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz], [hx, 0], [0, hz], [-hx, 0], [0, -hz]];
  let worst = Infinity;
  for (const [lx0, lz0] of R) {
    const [px, pz] = tan2plan(frame, x, z, lx0 * c + lz0 * si, -lx0 * si + lz0 * c);
    const q = roadDistance(frame, px, pz);
    const val = q.d - (q.rd.w + KERB);      // 路缘石在 w + 0.16
    if (val < worst) worst = val;
  }
  return worst;
}

/** 一栋楼在规划格子里的四个角点（切平面体量 → 规划平行四边形） */
export function rectCorners(frame, x, z, hx, hz, yawDeg) {
  const th = (yawDeg || 0) * Math.PI / 180, c = Math.cos(th), si = Math.sin(th);
  const out = [];
  for (const [lx, lz] of [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]]) {
    out.push(tan2plan(frame, x, z, lx * c + lz * si, -lx * si + lz * c));
  }
  return out;
}

/** 两个凸四边形是否相交（SAT：平行四边形只有两个独立方向，各取两条边法线就够） */
export function quadsOverlap(a, b) {
  const axes = [];
  for (const q of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const dx = q[i + 1][0] - q[i][0], dz = q[i + 1][1] - q[i][1];
      const L = Math.hypot(dx, dz) || 1;
      axes.push([-dz / L, dx / L]);
    }
  }
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of a) { const t = p[0] * ax + p[1] * az; if (t < a0) a0 = t; if (t > a1) a1 = t; }
    for (const p of b) { const t = p[0] * ax + p[1] * az; if (t < b0) b0 = t; if (t > b1) b1 = t; }
    if (a1 < b0 + 1e-6 || b1 < a0 + 1e-6) return false;
  }
  return true;
}

/** 「一镇一次」只管市政设施：駅/神社/学校/医院/邮局/图书馆/银行/派出所。
 *  民居·集合住宅·小店是店行的日常，套上这条规矩就等于「一条街只许一栋民居」——
 *  实测 8 栋原版民居因此排不进去，留在镇外 130m 的野地里，比不紧凑还难看。 */
export const ONCE_PER_TOWN = new Set(['station', 'temple', 'school', 'hospital', 'post_office', 'library', 'bank', 'police']);

// ---------- 退线（lane）：每条街的每一侧被路口切成若干段可建立面 ----------
const horizOf = (rd) => Math.abs(rd.x2 - rd.x1) >= Math.abs(rd.z2 - rd.z1);

/** 把路网展开成「可建立面区间」。切掉的部分：
 *  ① 垂直交叉街在本街上的铺装带（路口两端各让 other.w + 人行道 + 转角余量）；
 *  ② 站前广场圆盘外沿；
 *  ③ 打包限幅盒（镇缘锥坡之外不排楼）。 */
export function makeLanes(roads = ROADS, cfg = PACK_CFG) {
  const lanes = [];
  for (const rd of roads) {
    const horiz = horizOf(rd);
    const L = Math.hypot(rd.x2 - rd.x1, rd.z2 - rd.z1) || 1;
    const dx = (rd.x2 - rd.x1) / L, dz = (rd.z2 - rd.z1) / L;
    const along = (x, z) => (x - rd.x1) * dx + (z - rd.z1) * dz;
    const cuts = [];
    for (const other of roads) {
      if (other === rd || horizOf(other) === horiz) continue;
      const oa = horiz ? along(other.x1, rd.z1) : along(rd.x1, other.z1);
      const onMe = horiz ? rd.z1 : rd.x1;                  // 本街的固定轴
      const lo = horiz ? Math.min(other.z1, other.z2) - 0.5 : Math.min(other.x1, other.x2) - 0.5;
      const hi = horiz ? Math.max(other.z1, other.z2) + 0.5 : Math.max(other.x1, other.x2) + 0.5;
      if (onMe < lo || onMe > hi || oa < -1 || oa > L + 1) continue;
      const half = other.w + SIDEWALK_W + CORNER_CLEAR;
      cuts.push([oa - half, oa + half]);
    }
    // 广场：路穿过广场时，广场外沿一圈才允许立楼
    const pa = along(PLAZA.x, PLAZA.z);
    const pp = Math.hypot(PLAZA.x - rd.x1, PLAZA.z - rd.z1);
    const perp = Math.sqrt(Math.max(0, pp * pp - pa * pa));
    const pr = PLAZA.r + 1.8;
    if (perp < pr) cuts.push([pa - Math.sqrt(pr * pr - perp * perp), pa + Math.sqrt(pr * pr - perp * perp)]);
    // 限幅盒：这条街只有落在盒里的一段允许立楼（东西向路的 along 就是 x、南北向是 z）。
    // 注意这是「保留区间」，不是切口——早期版本拿它当 cuts 用，等于把街网内沿全切了，
    // 只剩镇缘两条缝，实测 lanes 从 40 变 4、退线从 1000m 变 40m。
    const axis = horiz ? rd.x1 : rd.z1;
    const lim = horiz ? cfg.limitX : cfg.limitZ;
    const u = (horiz ? dx : dz) || 1;
    const k0 = (-lim - axis) / u, k1 = (lim - axis) / u;
    const keep = [Math.max(0, Math.min(k0, k1)), Math.min(L, Math.max(k0, k1))];

    for (const side of [-1, 1]) {
      let spans = keep[1] - keep[0] > 0.5 ? [keep] : [];
      for (const [c0, c1] of cuts) {
        spans = spans.flatMap(([s, e]) => {
          if (c1 <= s || c0 >= e) return [[s, e]];
          const out = [];
          if (c0 - s > 0.5) out.push([s, Math.min(c0, e)]);
          if (e - c1 > 0.5) out.push([Math.max(c1, s), e]);
          return out;
        });
      }
      for (const [a0, a1] of spans) {
        if (a1 - a0 < 3.8) continue;                       // 最小一档民居的门面 + 缝 = 3.75m，再窄的边不排
        const mid = { x: rd.x1 + dx * ((a0 + a1) / 2), z: rd.z1 + dz * ((a0 + a1) / 2) };
        lanes.push({
          rd, horiz, side, x0: rd.x1, z0: rd.z1, dx, dz, a0, a1,
          len: a1 - a0, occ: [],
          // 排楼顺序：离站前广场近的先前台（先长镇芯再长镇缘），主干道另加 8m 折扣
          score: Math.hypot(mid.x - PLAZA.x, mid.z - PLAZA.z) - (rd.main ? 8 : 0),
        });
      }
    }
  }
  lanes.sort((a, b) => a.score - b.score);
  return lanes;
}

const laneAlong = (lane, x, z) => (x - lane.x0) * lane.dx + (z - lane.z0) * lane.dz;
const lanePoint = (lane, a) => ({ x: lane.x0 + lane.dx * a, z: lane.z0 + lane.dz * a });

/** 这一侧还能立的区间（扣掉本层已占的，两端各收半个门面 + 缝） */
function freeIntervals(lane, half) {
  let spans = [[lane.a0, lane.a1]];
  for (const [o0, o1] of lane.occ) {
    spans = spans.flatMap(([s, e]) => {
      if (o1 <= s || o0 >= e) return [[s, e]];
      const out = [];
      if (o0 - s > 0.01) out.push([s, Math.min(o0, e)]);
      if (e - o1 > 0.01) out.push([Math.max(o1, s), e]);
      return out;
    });
  }
  return spans.map(([s, e]) => [s + half, e - half]).filter(([s, e]) => e - s >= 0);
}

/** 某个位置上的一栋楼该站哪里、朝哪里（口径与 town.js 的认街一致：正墙朝街）。
 *  名义深度是「门面贴路缘 + 站人带」，但规划格子在镇缘有 |k|>1 的剪切：矩形在格子里
 *  被斜成平行四边形，按名义深度站下去，角点会捅过路缘石（实测 96 条退线里 72 条这么死）。
 *  所以从名义深度起，每 0.25m 往外挪一次，直到底圈离路缘石有 SLACK_MIN 的余量。 */
function frontSpot(frame, lane, a, hx, hz) {
  const { x: cx, z: cz } = lanePoint(lane, a);
  const [, , na, nb] = roadDirs(frame, cx, cz, lane.dx, lane.dz);
  const yaw = Math.atan2(-na * lane.side, -nb * lane.side) * 57.2958;
  let depth = laneDepth(lane.rd, hz), x = cx, z = cz, sl = Infinity;
  for (let t = 0; t < 14; t++) {
    [x, z] = tan2plan(frame, cx, cz, na * lane.side * depth, nb * lane.side * depth);
    sl = asphaltSlack(frame, hx, hz, yaw, x, z);
    if (sl >= SLACK_MIN) break;
    depth += 0.25;
  }
  return { x, z, yaw, slack: sl };
}

/** Growth-via-Contact：从空闲区间的两端往里走，所以店行是连着的，
 *  不会在空地中央孤零零立一栋。每 0.7m 一档，硬线不过就继续往里让。
 *  半个缝（SIDE_GAP/2）已经记在 occ 的两端，所以这里只让出「自己的门面」：
 *  连栋之间的缝由相邻两段 occ 各出一半，路口那头的余量 makeLanes 早已切走。 */
function tryLane(frame, lane, it, placed, anchors, cfg) {
  const half = it.front / 2;
  for (const [s0, s1] of freeIntervals(lane, half)) {
    for (const step of [0.7, -0.7]) {
      const start = step > 0 ? s0 : s1;
      for (let k = 0; k < 40; k++) {
        const a = start + step * k;
        if (a < s0 - 1e-6 || a > s1 + 1e-6) break;
        const p = frontSpot(frame, lane, a, it.hx, it.hz);
        if (Math.abs(p.x) > cfg.limitX + 3 || Math.abs(p.z) > cfg.limitZ + 3) continue;
        if (!frame.inBand(p.x, p.z)) continue;
        if (it.landmark && !landmarkClear(p, anchors, it, cfg)) continue;
        if (p.slack < SLACK_MIN) continue;
        const quad = rectCorners(frame, p.x, p.z, it.hx, it.hz, p.yaw);
        if (placed.some((q) => quadsOverlap(quad, q.quad))) continue;
        return { lane, a, x: p.x, z: p.z, yaw: p.yaw, quad };
      }
    }
  }
  return null;
}

/** 「一镇一次」：同款市政设施别在隔壁街区再立一座（实测双駅把站前广场堵死） */
function landmarkClear(p, anchors, it, cfg) {
  for (const a of anchors) {
    if (a.kind !== it.kind) continue;
    if (Math.hypot(p.x - a.x, p.z - a.z) < cfg.landmarkClear) return false;
  }
  return true;
}

/** 已就位的楼在本层上占掉的那一段：认它最贴近的那条退线。
 *  占位宽度量的是**这个楼沿街方向的真实投影**（把平行四边形四角投到街向上），不是角半径
 *  ——按 hypot(hx,hz) 保守一圈，363m 退线会凭空吃掉 40%，补楼一栋都塞不进。
 *  只认真站在这一层退线上的楼（余量 1.6m）：街区里随手一栋散楼投影到四条街上，
 *  会把四条街的店行全标成「已占」。真正的重叠由 placed 里的四边形判据兜住，不看这条 1D 账。 */
function claimLanes(lanes, placed) {
  for (const p of placed) {
    let best = null;
    for (const lane of lanes) {
      const a = laneAlong(lane, p.x, p.z);
      if (a < lane.a0 - 1 || a > lane.a1 + 1) continue;
      const pt = lanePoint(lane, a);
      const perp = Math.hypot(p.x - pt.x, p.z - pt.z);
      const cost = Math.abs(perp - (lane.rd.w + SIDEWALK_W + STAND_GAP + p.hz));
      if (cost > 1.6) continue;
      if (!best || cost < best.cost) best = { lane, a, cost };
    }
    if (!best) continue;
    claimQuad(best.lane, p.quad);
  }
}

/** 把一块四边形占到某条退线上（沿街方向的真实投影 + 半边缝） */
function claimQuad(lane, quad) {
  let lo = Infinity, hi = -Infinity;
  for (const [qx, qz] of quad) {
    const t = (qx - lane.x0) * lane.dx + (qz - lane.z0) * lane.dz;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  lane.occ.push([lo - SIDE_GAP / 2, hi + SIDE_GAP / 2]);
}

function mkPlaced(frame, kind, x, z, hx, hz, yawDeg) {
  return { kind, x, z, hx, hz, yaw: yawDeg || 0, quad: rectCorners(frame, x, z, hx, hz, yawDeg || 0) };
}

/** 补楼的型：民居为主（buildHouse 按 seed 换 4 套墙瓦），少量店与集合住宅打底。
 *  w 是抽型袋里的张数，不是「一定要这么多栋」——剩余退线宽度塞不下就顺延换型。
 *  市政楼（駅/神社/派出所…）不塞：「一镇一次」是这张图的规矩，
 *  而且 BUILDERS.police 复用 buildStation，补出来的「派出所」会挂成駅的词。 */
export const FILLER = [
  { kind: 'house', w: 46 },
  { kind: 'mansion', w: 13 },
  { kind: 'konbini', w: 8 },
  { kind: 'cafe', w: 8 },
  { kind: 'ramen', w: 7 },
  { kind: 'super', w: 5 },
  { kind: 'post_office', w: 4 },
  { kind: 'bank', w: 4 },
  { kind: 'library', w: 3 },
  { kind: 'hospital', w: 2 },
  { kind: 'school', w: 1 },
];
const FILLER_BAG = FILLER.flatMap((f) => Array.from({ length: f.w }, () => f.kind));
// 补楼的平面档位：先按模型的天然尺寸站，站不下再缩（层高不动，只缩平面）。
// 不做「放大到塞满这一段」那一档：实测把 4.5m 的退线喂给 1.14 档，一栋就吃掉 4.06m，
// 补楼数从 4 掉到 1——要的是店行连排、栋数多，不是每栋都顶格宽。
const FILLER_SC = [1.0, 0.92, 0.84, 0.78];
// 原版楼排不进退线时的缩档（保正墙层高，只缩平面）：宁可小一档也要搬进店行
const SHRINK_SC = [1, 0.92, 0.84, 0.76];

/** 按抽型袋定「想要哪种」，再用这一段的剩余宽度收敛到能塞下的最大档。
 *  判据要和 tryLane 用的那把尺一模一样（这一段宽度 ≥ 门面），不留 0.2m 的四舍五入：
 *  这张路网 44/50 条退线只有 4.5~4.8m 长，多给 0.2m 容差就是「挑中一档、站不下去」，
 *  实测整条店行一栋都没排出来。连栋之间的缝记在 occ 两端，不占这里的宽度。 */
function pickFiller(width, feet, bag) {
  const want = FILLER_BAG[bag % FILLER_BAG.length];
  const order = [want, ...FILLER.map((f) => f.kind).filter((k) => k !== want)];
  for (const kind of order) {
    const foot = feet[kind];
    if (!foot) continue;
    for (const sc of FILLER_SC) {
      const hx = foot.hx * sc, hz = foot.hz * sc;
      if (2 * hx <= width) return { kind, hx, hz, front: 2 * hx, sc };
    }
  }
  return null;
}

// ---------- 主入口 ----------
/** 紧凑化：只吃「已经并好的落点表」，产出「谁挪到哪」+「新增哪些」。
 *  手写城（o.from==='city'）只占地盘、一律不动——站前店行 1.2m 骑线是作者排的间距，
 *  一动就散架（town.js 的 frontOntoStreets 早就写了这条规矩）。
 *  原版的实体楼（含被外迁到镇缘的那些）全部重新认领退线；剩下的空闲退线按 FILLER 补楼。 */
export function compactTown({ frame, objects, feet, skipKinds = new Set(), solidKinds, cfg = PACK_CFG }) {
  const lanes = makeLanes(ROADS, cfg);
  const placed = [], anchors = [];
  const rejected = { nospace: 0 };
  let solidCount = 0;

  for (const o of objects) {
    if (o.from !== 'city' || !solidKinds.has(o.kind)) continue;
    const f = feet[o.kind];
    if (!f) continue;
    const p = frame.dirToPlan(dirFromPx(o.x, o.y));
    placed.push(mkPlaced(frame, o.kind, p.x, p.z, f.hx, f.hz, o.rot));
    anchors.push({ kind: o.kind, x: p.x, z: p.z });
    solidCount++;
  }
  const anchorCount = solidCount;
  claimLanes(lanes, placed);

  // 1) 原版的实体楼：按门面宽度降序进箱（FFD），大栋先落才塞得满
  const items = [];
  for (const o of objects) {
    if (o.from === 'city' || !solidKinds.has(o.kind) || skipKinds.has(o.kind)) continue;
    const f = feet[o.kind];
    if (!f) continue;
    const p0 = frame.dirToPlan(dirFromPx(o.x, o.y));
    items.push({ obj: o, kind: o.kind, hx0: f.hx, hz0: f.hz, hx: f.hx, hz: f.hz, front: 2 * f.hx, landmark: ONCE_PER_TOWN.has(o.kind), p0 });
  }
  items.sort((a, b) => b.front - a.front);

  // 缩档重试：这张路网 44/50 条退线只有 4.5~4.8m 长（12m 见方的街区，路口两端各吃掉
  // 「交叉街半宽 + 人行道」），门面比这宽 0.5m 就一格都塞不进。实测 13 栋原版楼因此
  // 留在镇外 145m 的野地里——那正是「地图不紧凑」最难看的一块。所以整栋缩到
  // 0.92/0.84/0.76 再试，宁可小一档也要搬进店行；缩的档位由 scaleSite 落到模型上。
  const moves = [];
  for (const it of items) {
    let got = null, sc = 1, foot = it;
    for (const k of SHRINK_SC) {
      foot = k === 1 ? it : { ...it, hx: it.hx0 * k, hz: it.hz0 * k, front: 2 * it.hx0 * k };
      for (const lane of lanes) {
        got = tryLane(frame, lane, foot, placed, anchors, cfg);
        if (got) break;
      }
      if (got) { sc = k; break; }
    }
    if (!got) {      // 排不进去就留在原位走老路，但它的体量要立刻记账——否则下一步补楼会把楼塞进这栋旧楼里
      rejected.nospace++;
      const q = mkPlaced(frame, it.kind, it.p0.x, it.p0.z, it.hx0, it.hz0, 0);
      placed.push(q);
      claimLanes(lanes, [q]);
      continue;
    }
    claimQuad(got.lane, got.quad);
    placed.push(mkPlaced(frame, it.kind, got.x, got.z, foot.hx, foot.hz, got.yaw));
    anchors.push({ kind: it.kind, x: got.x, z: got.z });
    moves.push({ obj: it.obj, x: got.x, z: got.z, yaw: got.yaw, sc });
    solidCount++;
  }

  // 2) 补楼：把剩下的空闲退线按抽型袋填满（有界 FFD），到 target 收手。
  //    每条退线是「内层 while 一路排到店行头」，不是每轮一格 —— 早先按「连续 24 次
  //    失败就收手」计数，96 条退线里前 24 条排不动就直接退出，实测只补出 10 栋。
  const added = [];
  let bag = 0, guard = 0;
  while (solidCount < cfg.target && guard++ < 30) {
    let any = false;
    for (const lane of lanes) {
      while (solidCount < cfg.target) {
        const widest = freeIntervals(lane, 0)
          .reduce((b, [s, e]) => (e - s > (b ? b[1] - b[0] : 0) ? [s, e] : b), null);
        if (!widest || widest[1] - widest[0] < cfg.minInfill) break;
        const pick = pickFiller(widest[1] - widest[0], feet, bag);
        if (!pick) break;
        const got = tryLane(frame, lane, { ...pick, landmark: ONCE_PER_TOWN.has(pick.kind) }, placed, anchors, cfg);
        if (!got) break;
        bag++;
        claimQuad(lane, got.quad);
        placed.push(mkPlaced(frame, pick.kind, got.x, got.z, pick.hx, pick.hz, got.yaw));
        if (ONCE_PER_TOWN.has(pick.kind)) anchors.push({ kind: pick.kind, x: got.x, z: got.z });
        // 词不写在这里：buildHouse 等构建器的 finish() 已经登记了正确词 id
        // （super→supermarket、school→gakkou…），拿 kind 当词会挂出一个查不到的条目
        added.push({ kind: pick.kind, x: got.x, z: got.z, yaw: got.yaw, sc: pick.sc });
        solidCount++;
        any = true;
      }
    }
    if (!any) break;
  }

  const frontageM = lanes.reduce((s, l) => s + l.len, 0);
  const usedM = lanes.reduce((s, l) => s + l.occ.reduce((t, [a, b]) => t + (b - a), 0), 0);
  return {
    moves, added, lanes,
    info: {
      lanes: lanes.length, frontageM: Math.round(frontageM),
      solidCount, anchors: anchorCount, moved: moves.length, infill: added.length,
      rejected, utilization: +(usedM / frontageM).toFixed(3),
    },
  };
}

/** 打包结果的体检指标（验收看这几个数，别拿眼睛判「看着挤不挤」） */
export function layoutMetrics(blocks, townRect) {
  let built = 0, inTown = 0;
  const xs = [], zs = [];
  for (const b of blocks) {
    xs.push(b.x); zs.push(b.z);
    if (Math.abs(b.x) <= townRect.xT && Math.abs(b.z) <= townRect.zT) { built += 4 * b.hx * b.hz; inTown++; }
  }
  const nn = [];
  for (let i = 0; i < blocks.length; i++) {
    let best = Infinity;
    for (let j = 0; j < blocks.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(blocks[i].x - blocks[j].x, blocks[i].z - blocks[j].z);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) nn.push(best);
  }
  nn.sort((a, b) => a - b);
  const area = 4 * townRect.xT * townRect.zT;
  return {
    blocks: blocks.length, inTown,
    bbox: [Math.round(Math.max(...xs, 0) - Math.min(...xs, 0)), Math.round(Math.max(...zs, 0) - Math.min(...zs, 0))],
    nnMedian: +(nn.length ? nn[nn.length >> 1] : 0).toFixed(2),
    nnP90: +(nn.length ? nn[Math.floor(nn.length * 0.9)] : 0).toFixed(2),
    coverage: +((built / area) * 100).toFixed(1),
  };
}
