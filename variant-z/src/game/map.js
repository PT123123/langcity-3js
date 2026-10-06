// 地图 + 传送：右上角小地图（实时猫标）→ 点击/按 M 展开大地图 → 点地标图标传送
// 底图在启动时用地形 BVH 射线采样烘焙：海洋平涂 + 调色板陆地色 + 海岸墨线描边（手绘纸感）
// 街网不是顶点色，是实体条带，射线烘不出来——所以这里照 townPlan 的手写路网自己画一层。
import * as THREE from 'three';
import { CFG, dirFromPx, pxFromDir, eastAt, northAt } from '../world/planetMap.js';
import { ROADS, SIDEWALK_W, PLAZA, PARKING, CROSSWALKS, roadDistance } from '../world/townPlan.js';

// 地标：落点取自 planet.json 的建筑像素坐标（x∈[0,5200] 横向环绕，y∈[0,4000] 北→南）
export const LANDMARKS = [
  { id: 'station',     icon: '🚉', ja: '駅',         zh: '车站',   px: [3154, 619] },
  { id: 'cafe',        icon: '☕', ja: '喫茶店',     zh: '咖啡店', px: [4518, 503] },
  { id: 'temple',      icon: '⛩️', ja: 'お寺',       zh: '寺庙',   px: [4140, 794] },
  { id: 'police',      icon: '🚓', ja: '警察署',     zh: '警察局', px: [4290, 370] },
  { id: 'hospital',    icon: '🏥', ja: '病院',       zh: '医院',   px: [3000, 99] },
  { id: 'ramen',       icon: '🍜', ja: 'ラーメン屋', zh: '拉面店', px: [313, 814] },
  { id: 'konbini',     icon: '🏪', ja: 'コンビニ',   zh: '便利店', px: [0, 2274] },
  { id: 'bank',        icon: '🏦', ja: '銀行',       zh: '银行',   px: [2636, 1292] },
  { id: 'super',       icon: '🛒', ja: 'スーパー',   zh: '超市',   px: [3754, 2848] },
  { id: 'library',     icon: '📚', ja: '図書館',     zh: '图书馆', px: [2039, 3151] },
  { id: 'school',      icon: '🏫', ja: '学校',       zh: '学校',   px: [3182, 3248] },
  { id: 'post_office', icon: '📮', ja: '郵便局',     zh: '邮局',   px: [4915, 4000] },
];

const MW = 780, MH = 600;           // 大地图逻辑分辨率（与地图像素同 13:10 比例）
const BAKE_W = 1040, BAKE_H = 800;  // 烘焙底图分辨率
const OCEAN = '#aecdd9';
const INK = 'rgba(74,66,56,0.9)';
const WASHI = 'rgba(247,243,234,0.94)';
const VERMILION = '#c94f4f';
const SAND = new THREE.Color(0xd9c49a);

const fract = (n) => n - Math.floor(n);

export class GameMap {
  constructor({ onTeleport } = {}) {
    this.onTeleport = onTeleport || null;
    this.player = null;       // main.js 注入
    this.mapCanvas = null;    // 烘焙底图
    this.pins = LANDMARKS;    // bake() 换成并图后真正摆出来的位置
    this.hover = -1;
    this.pinPos = [];
    this._bigOn = false;

    this.miniCv = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCv.getContext('2d');
    this.big = document.getElementById('bigmap');
    this.bigCv = document.getElementById('bigmap-canvas');
    this.bigCv.width = MW * 2; this.bigCv.height = MH * 2; // 固定 2x 抗模糊
    this.bigCtx = this.bigCv.getContext('2d');
    this.bigCtx.scale(2, 2);
    this.toast = document.getElementById('map-toast');

    this._fitMini();
    addEventListener('resize', () => this._fitMini());
    this._bind();
  }

  _fitMini() {
    const r = this.miniCv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.miniW = r.width; this.miniH = r.height;
    this.miniCv.width = Math.round(r.width * dpr);
    this.miniCv.height = Math.round(r.height * dpr);
    this.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _bind() {
    document.getElementById('minimap').addEventListener('click', () => this.openBig());
    document.getElementById('bigmap-close').addEventListener('click', () => this.closeBig());
    this.big.addEventListener('click', (e) => { if (e.target === this.big) this.closeBig(); });
    this.bigCv.addEventListener('click', (e) => this._clickPin(e));
    this.bigCv.addEventListener('mousemove', (e) => this._hoverPin(e));
    this.bigCv.addEventListener('mouseleave', () => { this.hover = -1; });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        this.big.classList.contains('hidden') ? this.openBig() : this.closeBig();
      } else if (e.code === 'Escape' && !this.big.classList.contains('hidden')) {
        this.closeBig();
      }
    });
  }

  /** 烘焙底图：网格射线采样地形 → 陆地色块 + 海岸墨线 + 手绘街网（一次性，加载页期间完成） */
  bake(planet, stats) {
    this.planet = planet;
    this.setPins(stats && stats.mapPins);
    this.blocks = (stats && stats.mapBlocks) || [];
    const GW = 116, GH = 90;
    const terr = document.createElement('canvas'); terr.width = GW; terr.height = GH;
    const mask = document.createElement('canvas'); mask.width = GW; mask.height = GH;
    const tctx = terr.getContext('2d'), mctx = mask.getContext('2d');
    tctx.fillStyle = OCEAN; tctx.fillRect(0, 0, GW, GH);
    const col = new THREE.Color(), white = new THREE.Color(1, 1, 1);
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const h = planet.surfaceAt(dirFromPx((gx + 0.5) / GW * CFG.world[0], (gy + 0.5) / GH * CFG.world[1]));
        if (!h.hit || h.pos.length() < planet.waterRadius + 0.12) continue; // 海里/打空
        col.copy(h.col || SAND).lerp(white, 0.16); // 提亮成粉彩纸感
        col.offsetHSL(0, 0, fract(Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453) * 0.06 - 0.03);
        tctx.fillStyle = col.getStyle();
        tctx.fillRect(gx, gy, 1, 1);
        mctx.fillStyle = '#fff';
        mctx.fillRect(gx, gy, 1, 1);
      }
    }

    const m = document.createElement('canvas');
    m.width = BAKE_W; m.height = BAKE_H;
    const ctx = m.getContext('2d');
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, BAKE_W, BAKE_H);
    // 海岸墨线：陆掩膜染墨后向 8 方向偏移勾边，再盖地形色
    const inkCv = document.createElement('canvas'); inkCv.width = GW; inkCv.height = GH;
    const ictx = inkCv.getContext('2d');
    ictx.drawImage(mask, 0, 0);
    ictx.globalCompositeOperation = 'source-in';
    ictx.fillStyle = INK;
    ictx.fillRect(0, 0, GW, GH);
    const o = 3;
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o], [0, 0]]) {
      ctx.drawImage(inkCv, dx, dy, BAKE_W, BAKE_H);
    }
    ctx.drawImage(terr, 0, 0, BAKE_W, BAKE_H);
    // 海面手绘波纹（只落在陆地掩膜之外）
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    const md = mctx.getImageData(0, 0, GW, GH).data;
    for (let gy = 3; gy < GH - 3; gy += 4) {
      for (let gx = 3; gx < GW - 3; gx += 4) {
        if (md[(gy * GW + gx) * 4 + 3] > 0) continue; // 陆地跳过
        if (fract(Math.sin(gx * 7.13 + gy * 3.71) * 911.37) > 0.16) continue;
        const x = (gx + 0.5) / GW * BAKE_W, y = (gy + 0.5) / GH * BAKE_H;
        ctx.beginPath();
        ctx.arc(x, y, 5, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      }
    }
    if (planet.planFrame && !planet.raw) this._drawTown(ctx, planet.planFrame, BAKE_W, BAKE_H);
    this.mapCanvas = m;
  }

  /** 镇区铺装：街廊按 plan 米展成经纬度多边形，天然跟着经线收口。
   *  路面是场景里的实体条带，射线烘焙量不到，不画这一层小地图就还是「一张平地」。 */
  _drawTown(ctx, frame, W, H) {
    const toMap = (x, z) => {
      const [qx, qy] = frame.planToPx(x, z);
      return [qx / CFG.world[0] * W, qy / CFG.world[1] * H];
    };
    // 一条 plan 直线展成贴地四边形：中心线按 frac 偏移半个宽度（宽度单位 = plan 米）
    const quad = (x1, z1, x2, z2, w1, w2, steps = 10) => {
      const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      const A = [], B = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, hw = (w1 + (w2 - w1) * t) / 2;
        const cx = x1 + dx * t, cz = z1 + dz * t;
        A.push(toMap(cx + nx * hw, cz + nz * hw));
        B.push(toMap(cx - nx * hw, cz - nz * hw));
      }
      ctx.beginPath();
      ctx.moveTo(A[0][0], A[0][1]);
      for (let i = 1; i < A.length; i++) ctx.lineTo(A[i][0], A[i][1]);
      for (let i = B.length - 1; i >= 0; i--) ctx.lineTo(B[i][0], B[i][1]);
      ctx.closePath();
      return { A, B, mid: A.map((p, i) => [(p[0] + B[i][0]) / 2, (p[1] + B[i][1]) / 2]) };
    };
    const fill = (pts, style) => { ctx.fillStyle = style; ctx.fill(); };

    for (const rd of ROADS) fill(quad(rd.x1, rd.z1, rd.x2, rd.z2, rd.w + SIDEWALK_W * 2, rd.w + SIDEWALK_W * 2), 'rgba(233,224,206,0.5)'); // 街廊：沥青 + 两侧人行道
    for (const rd of ROADS) fill(quad(rd.x1, rd.z1, rd.x2, rd.z2, rd.w, rd.w), '#8a8378');                                               // 沥青
    for (const b of this.blocks) {                                                             // 建筑轮廓：镇芯是城市那套，外环是原版外迁的
      const c = Math.cos(b.yaw * Math.PI / 180), si = Math.sin(b.yaw * Math.PI / 180);
      ctx.beginPath();
      for (const [ix, iz, i] of [[-1, -1, 0], [1, -1, 1], [1, 1, 2], [-1, 1, 3]]) {
        const p = toMap(b.x + ix * b.hx * c + iz * b.hz * si, b.z - ix * b.hx * si + iz * b.hz * c);
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      }
      ctx.closePath(); ctx.fillStyle = 'rgba(122,110,96,0.55)'; ctx.fill();
    }
    for (const rd of ROADS.filter((r) => r.main)) {                                                                                      // 主街中心虚线
      const q = quad(rd.x1, rd.z1, rd.x2, rd.z2, rd.w, rd.w);
      ctx.strokeStyle = 'rgba(252,246,232,0.8)'; ctx.lineWidth = 1.4; ctx.setLineDash([7, 9]); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(q.mid[0][0], q.mid[0][1]);
      for (let i = 1; i < q.mid.length; i++) ctx.lineTo(q.mid[i][0], q.mid[i][1]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    for (const cw of CROSSWALKS) {                                                 // 斑马线：横过最近那条街
      const nr = roadDistance(frame, cw.x, cw.z);
      if (!nr.rd) continue;
      const half = nr.rd.w / 2 + 0.35, along = 1.05;
      const q = cw.dir === 'h'
        ? quad(cw.x - half, cw.z - along / 2, cw.x + half, cw.z - along / 2, along, along)
        : quad(cw.x - along / 2, cw.z - half, cw.x - along / 2, cw.z + half, along, along);
      fill(q, 'rgba(252,246,232,0.62)');
    }
    const pk = PARKING;                                                            // 停车场 + 车位线
    ctx.beginPath();
    const corners = [[pk.x1, pk.z1], [pk.x2, pk.z1], [pk.x2, pk.z2], [pk.x1, pk.z2]].map(([x, z]) => toMap(x, z));
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath(); ctx.fillStyle = 'rgba(138,131,120,0.75)'; ctx.fill();
    ctx.strokeStyle = 'rgba(252,246,232,0.55)'; ctx.lineWidth = 1;
    for (let x = pk.x1 + pk.bay; x < pk.x2; x += pk.bay) {
      const a = toMap(x, pk.z1 + 0.5), b = toMap(x, pk.z2 - 0.5);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.beginPath();                                                               // 站前广场：圆盘 + 墨线边
    const R = PLAZA.r + 0.7, seg = 40;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      const p = toMap(PLAZA.x + Math.cos(a) * R, PLAZA.z + Math.sin(a) * R);
      i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
    }
    ctx.fillStyle = 'rgba(214,201,181,0.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(122,110,96,0.75)'; ctx.lineWidth = 1.6; ctx.stroke();
  }

  // ---------- 坐标 ----------
  _toMap(px, py, W, H) {
    return [(px / CFG.world[0]) * W, (py / CFG.world[1]) * H];
  }

  /** 横向环绕（x=0 与 x=5200 是同一经线）：靠边时补画对侧副本 */
  _wrappedX(x, W) {
    const out = [x];
    if (x < 18) out.push(x + W);
    else if (x > W - 18) out.push(x - W);
    return out;
  }

  /** 地标针脚换成并图后真正摆下去的位置：planet.json 那套旧像素在街网里已经对不上门牌了 */
  setPins(pins) {
    if (!pins || !pins.length) return;
    this.pins = LANDMARKS.map((lm) => {
      const hit = pins.find((p) => p.kind === lm.id);
      return hit ? { ...lm, px: hit.px } : lm;
    });
  }

  /** 猫在地形图上的位置与朝向角（地图 y 向下 = 向南） */
  _playerMapPos(W, H) {
    const p = this.player;
    if (!p) return null;
    const [px, py] = pxFromDir(p.normal);
    const [x, y] = this._toMap(px, py, W, H);
    const he = p.heading.dot(eastAt(p.normal));
    const hn = p.heading.dot(northAt(p.normal));
    return { x, y, ang: Math.atan2(-hn, he) };
  }

  _drawCat(ctx, x, y, ang, s, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); // 呼吸脉冲圈
    ctx.arc(0, 0, (7 + Math.sin(t * 3.2) * 1.4) * s, 0, 7);
    ctx.strokeStyle = 'rgba(201,79,79,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(6.5 * s, 0);
    ctx.lineTo(-4.5 * s, 4.5 * s);
    ctx.lineTo(-2.5 * s, 0);
    ctx.lineTo(-4.5 * s, -4.5 * s);
    ctx.closePath();
    ctx.fillStyle = VERMILION;
    ctx.fill();
    ctx.strokeStyle = '#fff8f0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // ---------- 右上角小地图（主循环每帧调用） ----------
  tickMini(t) {
    if (!this.mapCanvas) return;
    const W = this.miniW, H = this.miniH, ctx = this.miniCtx;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.mapCanvas, 0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const lm of this.pins) {
      const [x, y] = this._toMap(lm.px[0], lm.px[1], W, H);
      for (const wx of this._wrappedX(x, W)) {
        ctx.beginPath();
        ctx.arc(wx, y, 2.3, 0, 7);
        ctx.fillStyle = '#fff8f0';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }
    const pp = this._playerMapPos(W, H);
    if (pp) for (const x of this._wrappedX(pp.x, W)) this._drawCat(ctx, x, pp.y, pp.ang, 0.9, t);
  }

  // ---------- 大地图 ----------
  openBig() {
    if (!this.mapCanvas || !this.player || this._bigOn) return;
    this.big.classList.remove('hidden');
    this._bigOn = true;
    const loop = (ms) => {
      if (!this._bigOn) return;
      this._drawBig(ms / 1000);
      this._bigRaf = requestAnimationFrame(loop);
    };
    this._bigRaf = requestAnimationFrame(loop);
  }

  closeBig() {
    this._bigOn = false;
    cancelAnimationFrame(this._bigRaf);
    this.big.classList.add('hidden');
  }

  _drawBig(t) {
    const ctx = this.bigCtx;
    ctx.clearRect(0, 0, MW, MH);
    ctx.drawImage(this.mapCanvas, 0, 0, MW, MH);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.pinPos = [];
    this.pins.forEach((lm, i) => {
      let [x, y] = this._toMap(lm.px[0], lm.px[1], MW, MH);
      y = THREE.MathUtils.clamp(y, 15, MH - 15);
      for (const wx of this._wrappedX(x, MW)) {
        this.pinPos.push({ x: wx, y, i });
        const hov = this.hover === i;
        ctx.beginPath();
        ctx.arc(wx, y, hov ? 19 : 15, 0, 7);
        ctx.fillStyle = hov ? '#ffffff' : WASHI;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = hov ? VERMILION : INK;
        ctx.stroke();
        ctx.font = '17px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        ctx.fillText(lm.icon, wx, y + 1);
        if (hov) { // 悬停名牌
          ctx.font = '12px "Noto Sans JP", sans-serif';
          const txt = `${lm.ja} ・ ${lm.zh}`;
          const w = ctx.measureText(txt).width + 18;
          const bx = THREE.MathUtils.clamp(wx - w / 2, 6, MW - w - 6);
          const by = y - 46 < 6 ? y + 26 : y - 46;
          ctx.fillStyle = WASHI;
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(bx, by, w, 22, 11);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#4a4238';
          ctx.fillText(txt, bx + w / 2, by + 12);
        }
      }
    });
    const pp = this._playerMapPos(MW, MH);
    if (pp) for (const x of this._wrappedX(pp.x, MW)) this._drawCat(ctx, x, pp.y, pp.ang, 1.4, t);
  }

  _eventToMap(e) {
    const r = this.bigCv.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * MW, (e.clientY - r.top) / r.height * MH];
  }

  _hoverPin(e) {
    if (!this.pinPos.length) return;
    const [x, y] = this._eventToMap(e);
    let hit = -1;
    for (const p of this.pinPos) {
      if (Math.hypot(p.x - x, p.y - y) < 20) { hit = p.i; break; }
    }
    if (hit !== this.hover) {
      this.hover = hit;
      this.bigCv.style.cursor = hit >= 0 ? 'pointer' : 'default';
    }
  }

  _clickPin(e) {
    const [x, y] = this._eventToMap(e);
    let best = null, bd = 22;
    for (const p of this.pinPos) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) this._go(best.i);
  }

  _go(i) {
    const lm = this.pins[i];
    if (!lm) return;
    this.closeBig();
    if (this.onTeleport) this.onTeleport(lm.px[0], lm.px[1], lm);
    this.toast.textContent = `${lm.icon} 传送到了 ${lm.ja}（${lm.zh}）`;
    this.toast.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toast.classList.add('hidden'), 1900);
  }
}
