// 地图体检（开发期工具，不参与玩法）：以玩家真正使用的取面函数为基准，量化
// ① 每个已摆放物件的落地质量（底圈顶点 vs 真实地形的浮空/陷入/坡地/孤立凸起）
// ② 网格可走性与连通性（出生点能否自然走到每个地标，路上最大台阶高）
// 用法：window.__dbg.audit.sites() / .walk() / .reach() / .heat()
import * as THREE from 'three';
import { CFG, R, dirFromPx, pxFromDir } from './planetMap.js';

const r2 = (n) => Math.round(n * 100) / 100;

export function makeAudit(planet, town) {
  const rc = new THREE.Raycaster();
  rc.firstHitOnly = true;
  const meshes = planet.terrainMeshes;

  /** 玩家真正踩到的地面（与玩法同一个取面入口，保证体检结论=游玩结论） */
  function ground(dir) {
    const h = planet.surfaceAt(dir);
    if (!h.hit) return null;
    const r = h.pos.length();
    return { pos: h.pos.clone(), normal: h.normal.clone(), r, slope: Math.acos(Math.min(1, Math.max(-1, h.normal.dot(dir.clone().normalize())))) * 57.2958 };
  }

  /** 头顶压着的岩壳高度（0=露天）：地面壳选低了就会出现"屋顶是山的底面" */
  function cover(dir, rGround) {
    const d = dir.clone().normalize();
    rc.set(d.clone().multiplyScalar(rGround + 26), d.clone().negate());
    rc.far = 26;
    const hits = rc.intersectObjects(meshes, false);
    let top = 0;
    for (const h of hits) top = Math.max(top, h.point.length());
    return r2(Math.max(0, top - rGround));
  }

  /** 局部地面：只在 r0±bracket 的短射线上取最外命中，避免抓到几米外的山脊 */
  function localGround(dir, r0, bracket = 7) {
    const d = dir.clone().normalize();
    rc.set(d.clone().multiplyScalar(r0 + bracket), d.clone().negate());
    rc.far = bracket * 2;
    const hits = rc.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    return { pos: h.point.clone(), normal: h.face.normal.clone().normalize(), r: h.point.length() };
  }

  function collectMeshes(g) {
    const out = [];
    g.traverse((o) => {
      if (!o.isMesh || o.renderOrder === 2 || o.isSprite) return; // blob shadow / 贴片不算体量
      if (o.material && o.material.transparent) return;           // 半透明装饰（花瓣地毯等）
      if (!o.geometry || !o.geometry.attributes.position) return;
      out.push(o);
    });
    return out;
  }

  /** 物件底圈顶点（整个 group 局部 y 最低的一层），返回 [{dir, planeH}] */
  function bottomRing(g, maxPts = 40) {
    const pos = g.position.clone();
    const up = pos.clone().normalize();
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const parts = [];
    let bottom = Infinity;
    for (const o of collectMeshes(g)) {
      const rel = new THREE.Matrix4().copy(inv).multiply(o.matrixWorld);
      const a = o.geometry.attributes.position, p = new THREE.Vector3();
      let minY = Infinity;
      for (let i = 0; i < a.count; i++) { const y = p.fromBufferAttribute(a, i).applyMatrix4(rel).y; if (y < minY) minY = y; }
      if (minY < bottom) bottom = minY;
      parts.push({ rel, a, minY });
    }
    const pts = [];
    for (const { rel, a, minY } of parts) {
      if (minY > bottom + 0.16) continue;                         // 屋顶/上层构件不算底圈
      const p = new THREE.Vector3(), w = new THREE.Vector3();
      for (let i = 0; i < a.count && pts.length < maxPts; i++) {
        p.fromBufferAttribute(a, i).applyMatrix4(rel);
        if (p.y > bottom + 0.16) continue;
        w.copy(p).applyMatrix4(g.matrixWorld);
        pts.push({ dir: w.clone().normalize(), planeH: w.clone().sub(pos).dot(up) });
      }
    }
    return pts;
  }

  /** 逐个物件的落地质量 */
  function sites({ limit = 400 } = {}) {
    const rows = [];
    for (const g of town.children) {
      const meta = g.userData && g.userData.meta;
      if (!g.isGroup || !meta) continue;
      if (g.userData.attached) continue;              // 门窗等上墙构件：离地高度是有意的，不参与落地判定
      const pos = g.position.clone(), up = pos.clone().normalize(), r0 = pos.length();
      const ring = bottomRing(g);
      if (!ring.length) continue;
      const errs = [];
      let noGround = 0;
      for (const p of ring) {
        const gr = ground(p.dir);
        if (!gr) { noGround++; continue; }                        // 底圈下方根本没有地面=彻底悬空
        errs.push(p.planeH - (gr.pos.clone().sub(pos).dot(up)));  // +底面高于地面=浮空, -低于=陷入
      }
      if (!errs.length) { rows.push({ kind: meta.kind, px: 0, py: 0, float: 99, sink: 0, relief: 99, noGround, sit: 99, slope: 99, cover: 0, n: ring.length }); continue; }
      // 周围 3m 环的中位地面半径：整体是否站在孤立凸起上
      const u = new THREE.Vector3(0, 0, 1).cross(up);
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize();
      const v = new THREE.Vector3().crossVectors(up, u).normalize();
      const ringR = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const d = up.clone().addScaledVector(u, Math.cos(a) * 3 / r0).addScaledVector(v, Math.sin(a) * 3 / r0).normalize();
        const gr = ground(d);
        if (gr) ringR.push(gr.r);
      }
      ringR.sort((a, b) => a - b);
      const ctrH = ground(up);
      const slope = ctrH ? ctrH.slope : 99;
      const floatMax = Math.max(...errs), sinkMax = -Math.min(...errs);
      const [px, py] = pxFromDir(up);
      rows.push({
        kind: meta.kind, px: Math.round(px), py: Math.round(py),
        float: r2(floatMax), sink: r2(sinkMax), relief: r2(floatMax + sinkMax),
        noGround, sit: r2(r0 - (ringR[ringR.length >> 1] || r0)), slope: Math.round(slope),
        cover: cover(up, r0), n: errs.length,
      });
    }
    rows.sort((a, b) => Math.max(b.float, b.sink) - Math.max(a.float, a.sink));
    return rows.slice(0, limit);
  }

  const SOLID = new Set(['station', 'konbini', 'house', 'mansion', 'super', 'cafe', 'ramen',
    'post_office', 'temple', 'shrine', 'school', 'hospital', 'bank', 'police', 'library']);

  const isBad = (row) => (SOLID.has(row.kind)
    ? (row.float > 0.30 || row.sink > 0.45 || row.slope > 24 || row.sit > 2.0 || row.noGround > 0 || row.cover > 1.2)
    : (row.float > 0.55 || row.sink > 0.55 || row.slope > 40 || row.noGround > 0 || row.cover > 1.2));

  /** 汇总：各类别最差值 + 问题清单 */
  function summary() {
    const rows = sites();
    const bad = rows.map((r) => ({ ...r, solid: SOLID.has(r.kind), bad: isBad(r) }));
    const by = {};
    for (const r of bad) {
      const k = r.kind; by[k] = by[k] || { n: 0, bad: 0, float: 0, sink: 0, slope: 0, sit: 0 };
      by[k].n++;
      if (r.bad) by[k].bad++;
      by[k].float = Math.max(by[k].float, r.float);
      by[k].sink = Math.max(by[k].sink, r.sink);
      by[k].slope = Math.max(by[k].slope, r.slope);
      by[k].sit = Math.max(by[k].sit, r.sit);
      by[k].cover = Math.max(by[k].cover || 0, r.cover);
    }
    return {
      checked: bad.length, problems: bad.filter((r) => r.bad).length,
      solidsBad: bad.filter((r) => r.bad && r.solid).length,
      by, list: bad.filter((r) => r.bad),
    };
  }

  /** 地形本体统计：网格半径分布 + 射线多层命中情况（判断取面函数是否可靠） */
  function terrain({ N = 260, M = 200 } = {}) {
    const pct = (arr) => {
      const a = arr.slice().sort((x, y) => x - y);
      const q = (p) => r2(a[Math.min(a.length - 1, Math.floor(a.length * p))]);
      return { n: a.length, min: q(0), p05: q(0.05), p25: q(0.25), med: q(0.5), p75: q(0.75), p95: q(0.95), max: q(1) };
    };
    const v = new THREE.Vector3();
    const meshes = planet.terrainMeshes.map((m) => {
      const a = m.geometry.attributes.position, rs = [];
      const step = Math.max(1, Math.floor(a.count / 4000));
      for (let i = 0; i < a.count; i += step) {
        v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
        rs.push(v.length());
      }
      const bb = new THREE.Box3().setFromObject(m);
      return { name: m.name, tris: (m.geometry.index ? m.geometry.index.count : a.count) / 3, ...pct(rs), bbox: [r2(bb.max.x - bb.min.x), r2(bb.max.y - bb.min.y), r2(bb.max.z - bb.min.z)] };
    });

    // 可走带内射线：统计每张 mesh 一个命中的层数与半径
    const rcAll = new THREE.Raycaster(); // firstHitOnly 默认 false → 每 mesh 最近命中
    let multi = 0, nohit = 0, tot = 0;
    const outer = [], inner = [], game = [], spread = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const d = dirFromPx(i / (N - 1) * CFG.world[0], j / (M - 1) * CFG.world[1]);
        const far = R * 3 + 60;
        rcAll.set(d.clone().multiplyScalar(far), d.clone().negate());
        rcAll.far = far;
        const hits = rcAll.intersectObjects(planet.terrainMeshes, false);
        tot++;
        if (!hits.length) { nohit++; continue; }
        if (hits.length > 1) multi++;
        const rs = hits.map((h) => h.point.length());
        outer.push(rs[0]);
        inner.push(rs[rs.length - 1]);
        spread.push(rs[0] - rs[rs.length - 1]);
        game.push(planet.surfaceAt(d).pos.length());
      }
    }
    const whole = new THREE.Box3().setFromObject(planet.group);
    return {
      R, waterRadius: r2(planet.waterRadius),
      bbox: [r2(whole.max.x - whole.min.x), r2(whole.max.y - whole.min.y), r2(whole.max.z - whole.min.z)],
      meshes,
      rays: { tot, nohit, multi, multiPct: Math.round(multi / tot * 100) },
      outerHit: pct(outer), innerHit: pct(inner), gamePick: pct(game), spread: pct(spread),
    };
  }

  /** 可走性场：网格采样玩家真实地面半径 + 相邻台阶高 */
  function walk(GX = 120, GY = 92) {
    const r = new Array(GX * GY), stepH = new Array(GX * GY).fill(0), slope = new Array(GX * GY).fill(99);
    const dirs = new Array(GX * GY);
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const i = gy * GX + gx;
        const d = dirFromPx((gx + 0.5) / GX * CFG.world[0], (gy + 0.5) / GY * CFG.world[1]);
        dirs[i] = d;
        const h = planet.surfaceAt(d);
        r[i] = h.hit ? h.pos.length() : NaN;
        if (h.hit) slope[i] = Math.acos(Math.min(1, Math.max(-1, h.normal.dot(d)))) * 57.2958;
      }
    }
    // 台阶高：移到相邻格时脚下地面的竖向突变（沿出发点的 up 投影）
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const i = gy * GX + gx;
      if (!isFinite(r[i])) continue;
      let worst = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (gy + dy) * GX + (gx + dx);
        if (gx + dx < 0 || gx + dx >= GX || gy + dy < 0 || gy + dy >= GY) continue;
        if (!isFinite(r[j])) continue;
        const up = dirs[i];
        const pj = up.clone().multiplyScalar(r[i]);
        const ni = dirs[j].clone().multiplyScalar(r[j]);
        worst = Math.max(worst, Math.abs(ni.clone().sub(pj).dot(up)));
      }
      stepH[i] = worst;
    }
    const okFn = (i) => isFinite(r[i]) && r[i] > planet.waterRadius + 0.35 && stepH[i] < 0.85 && slope[i] < 42;
    return { GX, GY, r, stepH, slope, dirs, ok: okFn };
  }

  /** 从出生点 BFS，看地标是否可达 + 最少台阶路径的最大台阶 */
  function reach(spawnPx = [0, 2756], landmarks = [], stepLimit = 0.85) {
    const W = walk();
    const { GX, GY, stepH, slope, r } = W;
    const idx = (x, y) => y * GX + x;
    const sx = Math.min(GX - 1, Math.max(0, Math.round(spawnPx[0] / CFG.world[0] * GX - 0.5)));
    const sy = Math.min(GY - 1, Math.max(0, Math.round(spawnPx[1] / CFG.world[1] * GY - 0.5)));
    const passable = (i) => isFinite(r[i]) && r[i] > planet.waterRadius + 0.35 && slope[i] < 42;
    // minimax Dijkstra（Dial 分桶：台阶高截到 4m，桶宽 0.02 → 200 桶，免堆排序）
    const CAP = 4, NB = Math.ceil(CAP / 0.02) + 1;
    const Q = Array.from({ length: NB }, () => []);
    const cost = new Float32Array(GX * GY).fill(CAP + 1);
    const start = idx(sx, sy); cost[start] = 0; Q[0].push(start);
    let bi = 0;
    for (;;) {
      while (bi < NB && Q[bi].length === 0) bi++;
      if (bi >= NB) break;
      const cur = Q[bi].pop();
      if (Math.round(cost[cur] / 0.02) !== bi) continue;      // 陈旧入队
      const gx = cur % GX, gy = (cur / GX) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue;
        const j = idx(nx, ny);
        if (!passable(j)) continue;
        const nc = Math.max(cost[cur], Math.min(CAP, Math.max(stepH[cur], stepH[j])));
        if (nc < cost[j]) { cost[j] = nc; Q[Math.round(nc / 0.02)].push(j); }
      }
    }
    const out = landmarks.map((lm) => {
      const gx = Math.round(lm.px[0] / CFG.world[0] * GX - 0.5), gy = Math.round(lm.px[1] / CFG.world[1] * GY - 0.5);
      let best = CAP + 1;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const i = idx(Math.min(GX - 1, Math.max(0, gx + dx)), Math.min(GY - 1, Math.max(0, gy + dy)));
        best = Math.min(best, cost[i]);
      }
      return { id: lm.id, maxStep: best > CAP ? 'no-path' : r2(best), overLimit: best > stepLimit };
    });
    let reachable = 0, total = 0;
    for (let i = 0; i < GX * GY; i++) { if (!passable(i)) continue; total++; if (cost[i] < stepLimit) reachable++; }
    return { landCells: total, reachableCells: reachable, pct: Math.round(reachable / total * 100), out };
  }


  /** 把烘出来的地面场画成 2x2 体检图：高程 / 头顶岩壳 / 坡度 / 出生点可达域 */
  function heat({ spawnPx = [0, 2756], stepLimit = 0.85, landmarks = [] } = {}) {
    const F = planet.groundField, { N, M } = planet.field.BF;
    const W = N * 2 + 6, H = M * 2 + 6;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#101014'; ctx.fillRect(0, 0, W, H);
    const put = (ox, oy, gx, gy, rgb) => { ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; ctx.fillRect(ox + gx, oy + gy, 1, 1); };
    const STEPS = [[8, 24, 64], [24, 120, 150], [70, 160, 80], [225, 200, 70], [250, 248, 240]];
    const ramp = (t) => {                        // 深蓝→青→绿→黄→白
      t = Math.max(0, Math.min(1, t || 0));
      const i = Math.min(3, Math.floor(t * 4)), f = t * 4 - i;
      return STEPS[i].map((v, k) => Math.round(v + (STEPS[i + 1][k] - v) * f));
    };
    const sea = planet.waterRadius;
    let eMin = Infinity, eMax = -Infinity;
    for (let k = 0; k < N * M; k++) { const e = F.h[k] - sea; if (e < eMin) eMin = e; if (e > eMax) eMax = e; }

    // 头顶岩壳：从脚下地面向上 26m 里还有没有别的面（烘完应当处处为 0）
    const rcUp = new THREE.Raycaster();
    const coverAt = (d, r) => {
      rcUp.set(d.clone().multiplyScalar(r + 0.05), d.clone());
      rcUp.far = 26;
      const hits = rcUp.intersectObjects(planet.terrainMeshes, false);
      let top = 0;
      for (const h of hits) top = Math.max(top, h.point.length() - r);
      return Math.max(0, top);
    };
    const dirOf = (i, j) => dirFromPx((i + 0.5) / N * CFG.world[0], (j + 0.5) / M * CFG.world[1]);
    let coverMax = 0;
    for (let j = 0; j < M; j += 2) for (let i = 0; i < N; i += 2) {
      const d = dirOf(i, j), c = coverAt(d, F.h[j * N + i]);
      coverMax = Math.max(coverMax, c);
    }

    // 出生点可达域：格上 BFS，台阶高超限或坡太陡就断开
    const stepAt = (i, j) => {
      const k = j * N + i;
      let w = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + dx, y = j + dy;
        if (x < 0 || y < 0 || x >= N || y >= M) continue;
        w = Math.max(w, Math.abs(F.h[y * N + x] - F.h[k]));
      }
      return w;
    };
    const ok = (i, j) => {
      const k = j * N + i;
      return F.h[k] > sea + 0.35 && F.slope[k] < 42 && stepAt(i, j) < stepLimit;
    };
    const reach = new Uint8Array(N * M);
    const stack = [];
    const sx = Math.min(N - 1, Math.max(0, Math.round(spawnPx[0] / CFG.world[0] * N)));
    const sy = Math.min(M - 1, Math.max(0, Math.round(spawnPx[1] / CFG.world[1] * M)));
    if (ok(sx, sy)) { reach[sy * N + sx] = 1; stack.push(sy * N + sx); }
    while (stack.length) {
      const i = stack.pop(), gx = i % N, gy = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= N || y >= M) continue;
        const j = y * N + x;
        if (reach[j] || !ok(x, y)) continue;
        reach[j] = 1; stack.push(j);
      }
    }

    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      put(2, 2, i, j, ramp((F.h[k] - sea - eMin) / (eMax - eMin)));
      put(N + 8, 2, i, j, ramp(F.slope[k] / 30));
      put(2, M + 6, i, j, ramp(coverAt(dirOf(i, j), F.h[k]) / 6));
      put(N + 8, M + 6, i, j, reach[k] ? [90, 200, 110] : (F.h[k] > sea + 0.35 ? [120, 40, 40] : [20, 30, 60]));
    }
    for (const lm of landmarks) {
      const gx = 2 + (N + 6) * (lm.px[0] / CFG.world[0]), gy = 2 + M * (lm.px[1] / CFG.world[1]);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(gx, gy, 4, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx + N + 6, gy, 4, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`height ${Math.round(eMin * 10) / 10}~${Math.round(eMax * 10) / 10}m`, 2, M + 4);
    ctx.fillText(`slope max ${Math.round(coverMax * 10) / 10}m cover`, N + 8, M + 4);
    ctx.fillText('slope 0~30deg', 2, 2 * M + 8);
    ctx.fillText(`reachable from spawn ${Math.round(reach.reduce((a, b) => a + b, 0) / (N * M) * 100)}%`, N + 8, 2 * M + 8);
    return cv.toDataURL('image/png');
  }

  return { localGround, bottomRing, sites, summary, terrain, walk, reach, heat, SOLID };
}
