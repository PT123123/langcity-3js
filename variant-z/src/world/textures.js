// textures.js — 小零件专用手绘纹理（动漫写实、线条细致、白底 multiply）
// 用于 buildings.js / props.js 里那些纯色 M(0x...) 的小零件（鸟居/门/邮筒/暖帘/雨棚…）。
// 大墙面/屋顶已经有 PBR jpg 贴图，这里只补空白小表面。
// 约定：256×256 白底 + 深色线条，作为 map 与材质 color 相乘（颜色由 color 决定，本图只加纹路）。
import * as THREE from 'three';

let _seed = 1;
function rnd() { _seed = (_seed * 16807) % 2147483647; return _seed / 2147483647; }
function resetSeed(s) { _seed = s; }

function makeCanvas(S = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  return { cv, ctx, S };
}
// 无缝：在 ±S 偏移处各画一份
function seamlessEllipse(ctx, S, x, y, r, sy, rot, style) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.ellipse(x + dx, y + dy, r, r * sy, rot, 0, Math.PI * 2);
    ctx.fill();
  }
}
function seamlessLine(ctx, S, pts, style, width) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
    ctx.stroke();
  }
}
function addGrain(ctx, S, count, alpha = 0.05) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.fillStyle = rnd() > 0.5
      ? `rgba(110,95,75,${alpha * rnd()})`
      : `rgba(255,255,255,${alpha * rnd()})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
}
// 水彩晕染斑
function addWash(ctx, S, count, alpha = 0.06) {
  for (let i = 0; i < count; i++) {
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 12 + rnd() * 28, 0.7, rnd() * Math.PI,
      rnd() > 0.45 ? `rgba(150,132,104,${alpha + rnd() * alpha})` : `rgba(255,255,252,${alpha + rnd() * alpha})`);
  }
}
// 满幅柔和铺底（关键：多层低透明椭圆叠加，100% 覆盖消除纯白，窄灰阶变化）
// shade=中心灰度，spread=明暗摆动幅度，alpha 小但层数多 → 处处有细节但不脏
function softFill(ctx, S, seed, { layers = 5, n = 38, rMin = 16, rMax = 48, shade = 180, spread = 45, alpha = 0.06, warm = false } = {}) {
  resetSeed(seed);
  for (let L = 0; L < layers; L++) {
    for (let i = 0; i < n; i++) {
      const v = Math.round(shade + (rnd() - 0.5) * spread);
      // warm=true 时带极淡暖色，不是纯灰
      const col = warm ? `${v},${Math.round(v * 0.97)},${Math.round(v * 0.9)}` : `${v},${v},${v}`;
      seamlessEllipse(ctx, S, rnd() * S, rnd() * S, rMin + rnd() * (rMax - rMin),
        0.8 + rnd() * 0.4, rnd() * Math.PI, `rgba(${col},${alpha})`);
    }
  }
}

// ---------- 木纹（Messenger：暖灰线条 + 柔和明暗，远看干净） ----------
function wood() {
  resetSeed(303);
  const { cv, ctx, S } = makeCanvas(256);
  // 大范围柔和明暗（木板的整体色泽变化）
  for (let i = 0; i < 6; i++) {
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 35 + rnd() * 50, 0.9, 0,
      `rgba(180,160,130,${0.04 + rnd() * 0.03})`);
  }
  // 纵向木纹（暖灰色，不是深棕）
  for (let i = 0; i < 12; i++) {
    const x0 = rnd() * S;
    const pts = [];
    for (let y = 0; y <= S; y += 12) pts.push([x0 + Math.sin(y * 0.04 + rnd() * 4) * (1.5 + rnd() * 2), y]);
    seamlessLine(ctx, S, pts, `rgba(130,110,85,${0.12 + rnd() * 0.08})`, 0.9 + rnd() * 0.4);
  }
  // 板缝（淡灰，不是黑色）
  for (let i = 0; i < 2; i++) {
    const x = rnd() * S;
    seamlessLine(ctx, S, [[x, 0], [x, S]], 'rgba(100,85,65,0.18)', 1.2);
  }
  // 木节（淡、小）
  for (let i = 0; i < 1; i++) {
    ctx.strokeStyle = 'rgba(120,100,75,0.15)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.ellipse(rnd() * S, rnd() * S, 4 + rnd() * 4, 2.5 + rnd() * 2, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.stroke();
  }
  addGrain(ctx, S, 200, 0.03);
  return cv;
}

// ---------- 朱红漆面（鸟居/邮筒/消火栓/暖帘红） ----------
function vermilion() {
  resetSeed(404);
  const { cv, ctx, S } = makeCanvas(256);
  // 漆面细微不匀
  for (let i = 0; i < 14; i++) seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 10 + rnd() * 22, 0.7, rnd() * Math.PI, `rgba(120,40,30,${0.05 + rnd() * 0.05})`);
  // 漆面竖刷痕
  for (let i = 0; i < 8; i++) {
    const x0 = rnd() * S;
    const pts = [];
    for (let y = 0; y <= S; y += 16) pts.push([x0 + Math.sin(y * 0.05 + rnd() * 3) * 1.5, y]);
    seamlessLine(ctx, S, pts, `rgba(140,50,35,${0.06 + rnd() * 0.05})`, 1.0);
  }
  // 少量掉漆/锈点
  for (let i = 0; i < 10; i++) {
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 1.5 + rnd() * 3, 1, rnd() * Math.PI, `rgba(80,50,35,${0.12 + rnd() * 0.1})`);
  }
  addGrain(ctx, S, 250, 0.04);
  return cv;
}

// ---------- 和纸 / 暖帘（纸感 + 纤维） ----------
function paper() {
  resetSeed(505);
  const { cv, ctx, S } = makeCanvas(256);
  // 纸纤维
  for (let i = 0; i < 40; i++) {
    const x0 = rnd() * S, y0 = rnd() * S, len = 12 + rnd() * 24, ang = rnd() * Math.PI;
    const pts = [[x0, y0], [x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len]];
    seamlessLine(ctx, S, pts, `rgba(140,125,100,${0.06 + rnd() * 0.05})`, 0.7);
  }
  // 淡染斑
  for (let i = 0; i < 6; i++) seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 12 + rnd() * 20, 0.8, rnd() * Math.PI, `rgba(160,140,110,${0.04 + rnd() * 0.04})`);
  addGrain(ctx, S, 400, 0.04);
  return cv;
}

// ---------- 石材（Messenger：满幅柔和变化，处处有细节但不脏） ----------
function stone() {
  resetSeed(606);
  const { cv, ctx, S } = makeCanvas(256);
  // 1) 满幅大明暗（表面不平整，100% 覆盖）
  softFill(ctx, S, 606, { layers: 6, n: 40, rMin: 24, rMax: 60, shade: 200, spread: 60, alpha: 0.07, warm: true });
  // 2) 中号风化石
  softFill(ctx, S, 707, { layers: 4, n: 30, rMin: 10, rMax: 24, shade: 180, spread: 45, alpha: 0.06, warm: true });
  // 3) 密集花岗岩颗粒（三色，处处分布）
  for (let i = 0; i < 420; i++) {
    const r = 0.7 + rnd() * 1.8;
    const s = rnd();
    const col = s < 0.35 ? '120,116,108' : s < 0.7 ? '165,160,150' : '210,206,196';
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, r, 0.9 + rnd() * 0.2, rnd() * Math.PI,
      `rgba(${col},${0.1 + rnd() * 0.12})`);
  }
  // 4) 裂纹（柔和、近看才发现）
  for (let i = 0; i < 3; i++) {
    let x = rnd() * S, y = rnd() * S;
    const pts = [[x, y]];
    let ang = rnd() * Math.PI * 2;
    for (let s = 0; s < 4; s++) {
      ang += (rnd() - 0.5) * 1.0;
      x += Math.cos(ang) * (14 + rnd() * 20);
      y += Math.sin(ang) * (14 + rnd() * 20);
      pts.push([x, y]);
    }
    seamlessLine(ctx, S, pts, `rgba(110,104,94,${0.16 + rnd() * 0.1})`, 0.9);
  }
  return cv;
}

// ---------- 金属（电线杆/灯柱/镀锌） ----------
function metal() {
  resetSeed(707);
  const { cv, ctx, S } = makeCanvas(256);
  // 横向拉丝
  for (let i = 0; i < 36; i++) {
    const y = rnd() * S;
    seamlessLine(ctx, S, [[0, y], [S, y]], `rgba(80,80,85,${0.06 + rnd() * 0.06})`, 0.7);
  }
  // 锈斑
  for (let i = 0; i < 7; i++) {
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 2 + rnd() * 5, 1, rnd() * Math.PI, `rgba(140,90,55,${0.10 + rnd() * 0.1})`);
  }
  addGrain(ctx, S, 250, 0.04);
  return cv;
}

// ---------- 布料（晾衣/遮阳伞） ----------
function fabric() {
  resetSeed(808);
  const { cv, ctx, S } = makeCanvas(256);
  // 布纹经纬
  for (let i = 0; i < S; i += 4) {
    seamlessLine(ctx, S, [[i, 0], [i, S]], 'rgba(120,110,100,0.05)', 0.6);
    seamlessLine(ctx, S, [[0, i], [S, i]], 'rgba(120,110,100,0.05)', 0.6);
  }
  // 褶皱
  for (let i = 0; i < 4; i++) {
    const x0 = rnd() * S;
    const pts = [];
    for (let y = 0; y <= S; y += 16) pts.push([x0 + Math.sin(y * 0.03 + rnd() * 4) * (3 + rnd() * 4), y]);
    seamlessLine(ctx, S, pts, `rgba(90,80,70,${0.08 + rnd() * 0.06})`, 1.2);
  }
  return cv;
}

// ---------- 塑料（贩卖机/车壳/邮筒蓝） ----------
function plastic() {
  resetSeed(909);
  const { cv, ctx, S } = makeCanvas(256);
  // 极淡注塑痕
  for (let i = 0; i < 3; i++) {
    const y = rnd() * S;
    seamlessLine(ctx, S, [[0, y], [S, y]], 'rgba(120,115,110,0.05)', 0.8);
  }
  addGrain(ctx, S, 180, 0.03);
  return cv;
}

// ---------- 橡胶（轮胎） ----------
function rubber() {
  resetSeed(1010);
  const { cv, ctx, S } = makeCanvas(256);
  // 深颗粒（橡胶质感）
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.06})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // 极淡胎纹横沟
  for (let y = 20; y < S; y += 42) {
    seamlessLine(ctx, S, [[0, y], [S, y]], 'rgba(0,0,0,0.18)', 2.0);
  }
  return cv;
}

// ---------- 叶簇（树冠/灌木丛远看的团块斑点） ----------
function leaf() {
  resetSeed(1111);
  const { cv, ctx, S } = makeCanvas(256);
  // 大块叶团
  for (let i = 0; i < 36; i++) {
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 7 + rnd() * 16, 0.7, rnd() * Math.PI,
      rnd() > 0.5 ? `rgba(50,70,35,${0.12 + rnd() * 0.1})` : `rgba(140,160,100,${0.10 + rnd() * 0.08})`);
  }
  // 单小叶点
  for (let i = 0; i < 130; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.fillStyle = rnd() > 0.5
      ? `rgba(40,60,28,${0.14 + rnd() * 0.12})`
      : `rgba(150,170,110,${0.12 + rnd() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.8 + rnd() * 1.8, 1.2 + rnd(), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return cv;
}

// ---------- 树皮（Messenger：柔和纵纹，不是黑色裂缝） ----------
function bark() {
  resetSeed(1212);
  const { cv, ctx, S } = makeCanvas(256);
  // 大范围明暗
  for (let i = 0; i < 5; i++) {
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 30 + rnd() * 40, 0.9, 0,
      `rgba(150,130,100,${0.05 + rnd() * 0.03})`);
  }
  // 纵向纹理（暖灰棕，不是黑）
  for (let i = 0; i < 15; i++) {
    const x0 = rnd() * S;
    const pts = [];
    for (let y = 0; y <= S; y += 10) {
      pts.push([x0 + Math.sin(y * 0.05 + rnd() * 5) * (1.2 + rnd() * 2), y]);
    }
    seamlessLine(ctx, S, pts, `rgba(110,90,65,${0.15 + rnd() * 0.1})`, 0.9 + rnd() * 0.5);
  }
  // 皮孔斑（淡）
  for (let i = 0; i < 8; i++) {
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, 1.5 + rnd() * 2.5, 0.5, rnd() * Math.PI, `rgba(100,80,55,${0.1 + rnd() * 0.08})`);
  }
  addGrain(ctx, S, 200, 0.04);
  return cv;
}

// ---------- 水面（喷泉/池水，柔和波纹） ----------
function water() {
  resetSeed(1313);
  const { cv, ctx, S } = makeCanvas(256);
  // 横向柔波（多层正弦，浅色高光 + 深色阴影）
  for (let layer = 0; layer < 3; layer++) {
    const amp = 3 + layer * 2;
    const freq = 0.025 + layer * 0.015;
    for (let i = 0; i < 5; i++) {
      const y0 = rnd() * S;
      const pts = [];
      for (let x = 0; x <= S; x += 8) {
        pts.push([x, y0 + Math.sin(x * freq + rnd() * 6) * amp]);
      }
      seamlessLine(ctx, S, pts, layer === 0
        ? `rgba(255,255,255,${0.18 + rnd() * 0.1})`
        : `rgba(40,90,100,${0.08 + rnd() * 0.06})`, layer === 0 ? 1.2 : 0.8);
    }
  }
  // 细闪
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.15})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1.5, 1.0);
  }
  return cv;
}

// ---------- 皮毛（狗/狐狸 chibi 身体） ----------
function fur() {
  resetSeed(1414);
  const { cv, ctx, S } = makeCanvas(256);
  // 短绒方向（微斜短线）
  for (let i = 0; i < 200; i++) {
    const x = rnd() * S, y = rnd() * S;
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 0.6;
    const len = 2 + rnd() * 3;
    seamlessLine(ctx, S, [[x, y], [x + Math.cos(ang) * len, y + Math.sin(ang) * len]],
      rnd() > 0.5 ? `rgba(60,45,30,${0.10 + rnd() * 0.08})` : `rgba(200,170,130,${0.08 + rnd() * 0.06})`, 0.8);
  }
  addGrain(ctx, S, 300, 0.04);
  return cv;
}

// ============================================================
// 批量日式材质（用工厂函数紧凑生成）
// ============================================================

// 通用：网格缝（瓷砖/砖/榻榻米）
function gridLines(ctx, S, cols, rows, alpha = 0.25, color = '90,80,70') {
  for (let i = 0; i <= cols; i++) {
    const x = (i / cols) * S;
    seamlessLine(ctx, S, [[x, 0], [x, S]], `rgba(${color},${alpha})`, 1.2);
  }
  for (let j = 0; j <= rows; j++) {
    const y = (j / rows) * S;
    seamlessLine(ctx, S, [[0, y], [S, y]], `rgba(${color},${alpha})`, 1.2);
  }
}
// 通用：波浪竖纹（木板/瓦）
function waveLines(ctx, S, n, color, alpha, width, vertical = true) {
  for (let i = 0; i < n; i++) {
    const p0 = rnd() * S;
    const pts = [];
    for (let t = 0; t <= S; t += 10) {
      const off = Math.sin(t * 0.04 + rnd() * 4) * 2.5;
      pts.push(vertical ? [p0 + off, t] : [t, p0 + off]);
    }
    seamlessLine(ctx, S, pts, `rgba(${color},${alpha})`, width);
  }
}
// 通用：斑点散布
function speckle(ctx, S, n, color, alphaMin, alphaMax, rMin = 1, rMax = 3) {
  for (let i = 0; i < n; i++) {
    seamlessEllipse(ctx, S, rnd() * S, rnd() * S, rMin + rnd() * (rMax - rMin), 1, rnd() * Math.PI,
      `rgba(${color},${alphaMin + rnd() * (alphaMax - alphaMin)})`);
  }
}

// ---- 外墙/屋顶 ----
function plaster()   { resetSeed(2001); const { cv, ctx, S } = makeCanvas();
  // 满幅柔和明暗（灰泥涂抹，100% 覆盖）
  softFill(ctx, S, 2001, { layers: 6, n: 40, rMin: 20, rMax: 55, shade: 215, spread: 45, alpha: 0.06, warm: true });
  // 修补痕迹（不同批次灰泥）
  softFill(ctx, S, 2011, { layers: 3, n: 20, rMin: 10, rMax: 22, shade: 200, spread: 30, alpha: 0.06, warm: true });
  // 密集细颗粒
  speckle(ctx, S, 280, '170,163,150', 0.06, 0.12, 0.7, 1.5);
  return cv; }
function brickRed()  { resetSeed(2002); const { cv, ctx, S } = makeCanvas(); gridLines(ctx, S, 8, 4, 0.18, '140,120,110'); speckle(ctx, S, 80, '150,120,110', 0.06, 0.1); return cv; }
function brickWhite() { resetSeed(2003); const { cv, ctx, S } = makeCanvas(); gridLines(ctx, S, 8, 4, 0.15, '180,175,165'); speckle(ctx, S, 60, '185,180,170', 0.04, 0.08); return cv; }
function concrete()   { resetSeed(2004); const { cv, ctx, S } = makeCanvas();
  // 大范围明暗
  for (let i = 0; i < 6; i++) seamlessEllipse(ctx, S, rnd()*S, rnd()*S, 40+rnd()*60, 0.9, 0,
    rnd()>0.5?`rgba(185,183,177,${0.05+rnd()*0.03})`:`rgba(235,233,228,${0.04+rnd()*0.03})`);
  // 局部偏暖/偏冷
  seamlessEllipse(ctx, S, S*0.3, S*0.3, 40, 0.9, 0, 'rgba(200,185,165,0.04)');
  seamlessEllipse(ctx, S, S*0.7, S*0.7, 40, 0.9, 0, 'rgba(170,180,190,0.04)');
  // 气孔
  for (let i = 0; i < 60; i++) seamlessEllipse(ctx, S, rnd()*S, rnd()*S, 0.8+rnd()*1.5, 1, 0, `rgba(100,98,92,${0.12+rnd()*0.1})`);
  // 模板接缝
  seamlessLine(ctx, S, [[S*0.5,0],[S*0.5,S]], 'rgba(150,148,142,0.1)', 1.2);
  addGrain(ctx, S, 350, 0.04);
  return cv; }
function tileRoof()   { resetSeed(2005); const { cv, ctx, S } = makeCanvas(); waveLines(ctx, S, 5, '60,55,50', 0.3, 1.5, false); gridLines(ctx, S, 6, 1, 0.2, '70,60,55'); return cv; }
function slate()      { resetSeed(2006); const { cv, ctx, S } = makeCanvas(); gridLines(ctx, S, 4, 3, 0.3, '70,70,75'); speckle(ctx, S, 150, '80,80,85', 0.08, 0.15); return cv; }
function woodPlank()  { resetSeed(2007); const { cv, ctx, S } = makeCanvas(); waveLines(ctx, S, 12, '95,65,38', 0.2, 1.0, true); gridLines(ctx, S, 5, 1, 0.3, '70,50,30'); return cv; }
function shoji()      { resetSeed(2008); const { cv, ctx, S } = makeCanvas(); gridLines(ctx, S, 4, 6, 0.4, '120,90,60'); addGrain(ctx, S, 200, 0.03); return cv; }

// ---- 木/竹/草 ----
function woodDark()     { resetSeed(2009); const { cv, ctx, S } = makeCanvas(); waveLines(ctx, S, 16, '50,30,18', 0.25, 1.1); speckle(ctx, S, 30, '40,25,15', 0.1, 0.2, 1, 3); return cv; }
function woodPainted()  { resetSeed(2010); const { cv, ctx, S } = makeCanvas(); addWash(ctx, S, 10, 0.04); waveLines(ctx, S, 6, '120,100,70', 0.12, 0.8); return cv; }
function woodLight()    { resetSeed(2011); const { cv, ctx, S } = makeCanvas(); waveLines(ctx, S, 14, '140,110,70', 0.18, 0.9); return cv; }
function woodWeathered(){ resetSeed(2012); const { cv, ctx, S } = makeCanvas(); waveLines(ctx, S, 14, '100,95,85', 0.2, 1.0); speckle(ctx, S, 60, '80,75,65', 0.1, 0.18, 1, 3); return cv; }
function bamboo()       { resetSeed(2013); const { cv, ctx, S } = makeCanvas(); for (let y = 40; y < S; y += 60) seamlessLine(ctx, S, [[0, y], [S, y]], 'rgba(90,110,60,0.35)', 2); waveLines(ctx, S, 3, '120,140,80', 0.15, 0.8); return cv; }
function tatami()       { resetSeed(2014); const { cv, ctx, S } = makeCanvas(); gridLines(ctx, S, 2, 4, 0.3, '160,150,100'); for (let i = 0; i < 200; i++) { ctx.fillStyle = `rgba(180,170,110,${0.05 + rnd()*0.05})`; ctx.fillRect(rnd()*S, rnd()*S, 2, 1); } return cv; }
function cedar()        { resetSeed(2015); const { cv, ctx, S } = makeCanvas(); waveLines(ctx, S, 18, '110,80,50', 0.22, 1.2); return cv; }

// ---- 石/土/路 ----
function cobble()    { resetSeed(2016); const { cv, ctx, S } = makeCanvas();
  // 石畳要「密铺 + 看得见的灰缝」。原来只往平灰底上撒 26 颗浮石（覆盖率 ~28%），
  // 站前广场俯视就是一地浅色气泡，跟旁边沙地分不出彼此（实测 topdown-station.png）。
  // 第一版密铺走成 7×6 等距行列，1.15 m/块时石头只有 0.13 m，远看是张铁丝网
  // （实测 topdown-station2.png）：所以石头放大到 ~0.2 m、行列错位之外再随机并块/补碎石。
  ctx.fillStyle = 'rgb(96,92,86)'; ctx.fillRect(0,0,S,S);          // 灰缝
  softFill(ctx, S, 2116, { layers: 3, n: 26, rMin: 12, rMax: 30, shade: 104, spread: 30, alpha: 0.12, warm: true });
  const cols = 5, rows = 4, cw = S / cols, ch = S / rows;
  const stone = (cx, cy, rx, ry, rot) => {
    const t = rnd(), g = 148 + Math.floor(rnd() * 30);
    const body = t < 0.14 ? `${g - 3},${g - 4},${g + 5}`   // 略青
                 : t < 0.28 ? `${g + 5},${g + 1},${g - 4}` // 略暖
                 : `${g},${g},${g - 3}`;                   // 中性灰
    seamlessEllipse(ctx, S, cx + rx * 0.07, cy + ry * 0.1, rx, ry / rx, rot, 'rgba(56,52,46,0.5)');
    seamlessEllipse(ctx, S, cx, cy, rx, ry / rx, rot, `rgb(${body})`);
    seamlessEllipse(ctx, S, cx - rx * 0.22, cy - ry * 0.3, rx * 0.48, (ry / rx) * 0.5, rot, 'rgba(250,248,242,0.18)');
    for (let k = 0; k < 4; k++) {
      const a = rnd() * Math.PI * 2, d = rnd() * rx * 0.75;
      seamlessEllipse(ctx, S, cx + Math.cos(a) * d, cy + Math.sin(a) * d * (ry / rx), 1.1, 1, 0, 'rgba(66,62,56,0.15)');
    }
  };
  for (let j = 0; j < rows; j++) {
    const rowOff = (j % 2) * cw * 0.5;
    for (let i = 0; i < cols; i++) {
      const cx = i * cw + rowOff + cw * 0.5 + (rnd() - 0.5) * cw * 0.3;
      const cy = j * ch + ch * 0.5 + (rnd() - 0.5) * ch * 0.3;
      const rot = (rnd() - 0.5) * 1.6;
      if (rnd() < 0.26) {
        // 一块大石占掉邻格的一半，剩下三颗碎石填缝：行列感在这里断掉
        stone(cx - cw * 0.22, cy, cw * 0.46, ch * 0.4, rot);
        stone(cx + cw * 0.34, cy - ch * 0.24, cw * 0.17, ch * 0.16, rot * 0.5);
        stone(cx + cw * 0.36, cy + ch * 0.26, cw * 0.15, ch * 0.15, rot);
        stone(cx - cw * 0.3, cy + ch * 0.32, cw * 0.13, ch * 0.13, rot * 0.7);
      } else {
        stone(cx, cy, cw * (0.36 + rnd() * 0.1), ch * (0.32 + rnd() * 0.12), rot);
        if (rnd() < 0.5) stone(cx + cw * 0.42, cy + ch * 0.38, cw * 0.12, ch * 0.11, rot);
      }
    }
  }
  addGrain(ctx, S, 900, 0.03);
  return cv; }
function dirt()      { resetSeed(2017); const { cv, ctx, S } = makeCanvas(); speckle(ctx, S, 400, '90,70,50', 0.1, 0.2, 1, 3); addGrain(ctx, S, 300, 0.06); return cv; }
function sand()      { resetSeed(2018); const { cv, ctx, S } = makeCanvas(); speckle(ctx, S, 600, '180,160,110', 0.15, 0.25, 0.8, 1.6); return cv; }
function gravel()    { resetSeed(2019); const { cv, ctx, S } = makeCanvas();
  // 缝隙底色
  ctx.fillStyle='rgb(170,165,155)'; ctx.fillRect(0,0,S,S);
  // 每块碎石：阴影 + 主体 + 高光
  for (let i=0;i<70;i++){
    const x=rnd()*S,y=rnd()*S,r=1.5+rnd()*3.5,sy=0.85+rnd()*0.3,rot=rnd()*Math.PI;
    seamlessEllipse(ctx,S,x+0.8,y+1,r,sy,rot,'rgba(95,90,82,0.3)');
    const g=150+Math.floor(rnd()*40);
    seamlessEllipse(ctx,S,x,y,r,sy,rot,`rgba(${g},${g-2},${g-8},0.9)`);
    if(rnd()>0.5) seamlessEllipse(ctx,S,x-r*0.2,y-r*0.25,r*0.4,sy*0.6,rot,'rgba(245,242,235,0.25)');
  }
  return cv; }
function tileFloor() { resetSeed(2020); const { cv, ctx, S } = makeCanvas();
  // 陶砖底色（暖，非白）
  ctx.fillStyle='rgb(205,188,160)'; ctx.fillRect(0,0,S,S);
  // 满幅明暗
  softFill(ctx, S, 2120, { layers: 5, n: 38, rMin: 14, rMax: 36, shade: 195, spread: 45, alpha: 0.07, warm: true });
  // 砖缝（柔和暖灰，不生硬）
  gridLines(ctx, S, 4, 4, 0.2, '130,112,88');
  // 每块砖密集颗粒
  speckle(ctx, S, 220, '150,130,102', 0.08, 0.14, 0.7, 1.6);
  return cv; }

// ---- 织物/纸 ----
function noren()    { resetSeed(2021); const { cv, ctx, S } = makeCanvas(); for (let x = 32; x < S; x += 64) seamlessLine(ctx, S, [[x, 0], [x, S]], 'rgba(160,40,40,0.3)', 3); addGrain(ctx, S, 200, 0.04); return cv; }
function stripe()   { resetSeed(2022); const { cv, ctx, S } = makeCanvas(); for (let x = 0; x < S; x += 32) seamlessLine(ctx, S, [[x, 0], [x, S]], `rgba(80,80,90,${0.1 + rnd()*0.1})`, 4); return cv; }
function check()    { resetSeed(2023); const { cv, ctx, S } = makeCanvas(); gridLines(ctx, S, 8, 8, 0.15, '100,100,110'); return cv; }
function curtain()  { resetSeed(2024); const { cv, ctx, S } = makeCanvas(); waveLines(ctx, S, 6, '150,140,130', 0.15, 1.5, false); return cv; }
function paperOld()  { resetSeed(2025); const { cv, ctx, S } = makeCanvas(); speckle(ctx, S, 80, '140,120,90', 0.08, 0.15, 2, 6); addGrain(ctx, S, 300, 0.05); return cv; }
function paperBrown(){ resetSeed(2026); const { cv, ctx, S } = makeCanvas(); addWash(ctx, S, 15, 0.08); addGrain(ctx, S, 400, 0.05); return cv; }

// ---- 植被 ----
function moss()       { resetSeed(2027); const { cv, ctx, S } = makeCanvas(); speckle(ctx, S, 300, '80,110,50', 0.2, 0.35, 1, 3); return cv; }
function bambooLeaf() { resetSeed(2028); const { cv, ctx, S } = makeCanvas(); for (let i = 0; i < 40; i++) { const x=rnd()*S,y=rnd()*S; ctx.fillStyle='rgba(90,130,70,0.2)'; ctx.beginPath(); ctx.ellipse(x,y,6,2,rnd()*Math.PI,0,Math.PI*2); ctx.fill(); } return cv; }
function pine()       { resetSeed(2029); const { cv, ctx, S } = makeCanvas(); for (let i = 0; i < 150; i++) { const x=rnd()*S,y=rnd()*S; seamlessLine(ctx,S,[[x,y],[x+(rnd()-0.5)*4,y+3+rnd()*4]],'rgba(50,70,40,0.25)',0.7); } return cv; }
function leafAutumn() { resetSeed(2030); const { cv, ctx, S } = makeCanvas(); speckle(ctx, S, 120, '180,100,40', 0.2, 0.35, 2, 4); return cv; }
function leafSpring() { resetSeed(2031); const { cv, ctx, S } = makeCanvas(); speckle(ctx, S, 120, '150,190,90', 0.2, 0.35, 2, 4); return cv; }

// ---- 金属/陶/其他 ----
function ceramic() { resetSeed(2032); const { cv, ctx, S } = makeCanvas(); addWash(ctx, S, 12, 0.05); speckle(ctx, S, 80, '140,90,70', 0.08, 0.15, 1, 3); return cv; }
function asphalt(){ resetSeed(2033); const { cv, ctx, S } = makeCanvas();
  // 大范围明暗（新旧/磨损区域）
  for (let i=0;i<6;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,35+rnd()*55,0.9,0,
    rnd()>0.5?`rgba(120,120,125,${0.05+rnd()*0.04})`:`rgba(200,200,205,${0.04+rnd()*0.03})`);
  // 油迹（暗斑，局部）
  for (let i=0;i<3;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,12+rnd()*20,0.8,rnd()*Math.PI,`rgba(60,60,65,${0.1+rnd()*0.08})`);
  // 细密沥青颗粒
  speckle(ctx, S, 450, '90,90,95', 0.12, 0.22, 0.8, 1.8);
  // 微裂纹（淡）
  for (let i=0;i<2;i++) {
    let x=rnd()*S,y=rnd()*S; const pts=[[x,y]]; let ang=rnd()*Math.PI*2;
    for (let s=0;s<3;s++){ang+=(rnd()-0.5)*1;x+=Math.cos(ang)*(15+rnd()*20);y+=Math.sin(ang)*(15+rnd()*20);pts.push([x,y]);}
    seamlessLine(ctx,S,pts,'rgba(80,80,85,0.12)',0.7);
  }
  return cv; }
function brass()  { resetSeed(2034); const { cv, ctx, S } = makeCanvas(); for (let i=0;i<20;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(120,90,40,0.12)',0.8); speckle(ctx,S,40,'140,100,50',0.1,0.2,1,2); return cv; }
function rust()   { resetSeed(2035); const { cv, ctx, S } = makeCanvas(); speckle(ctx, S, 150, '150,80,40', 0.2, 0.4, 2, 6); return cv; }
function glass()  { resetSeed(2036); const { cv, ctx, S } = makeCanvas(); for (let i=0;i<5;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(255,255,255,0.25)',2); return cv; }
function snow()   { resetSeed(2037); const { cv, ctx, S } = makeCanvas(); speckle(ctx, S, 200, '200,210,220', 0.1, 0.2, 1, 2); return cv; }
function cloud()  { resetSeed(2038); const { cv, ctx, S } = makeCanvas(); for (let i=0;i<15;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,15+rnd()*25,0.6,0,'rgba(255,255,255,0.3)'); return cv; }

// ============================================================
// 第二批深化纹理（Messenger 风格：更多材质变体 + 近看细节）
// ============================================================

// ---- 木变体 ----
function woodOld()      { resetSeed(3001); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<5;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,30+rnd()*40,0.9,0,`rgba(160,140,110,${0.05+rnd()*0.03})`);
  waveLines(ctx, S, 10, '120,100,75', 0.14, 0.9, true);
  speckle(ctx, S, 40, '110,90,65', 0.08, 0.12, 1, 2);
  return cv; }
function woodPale()     { resetSeed(3002); const { cv, ctx, S } = makeCanvas();
  waveLines(ctx, S, 10, '170,150,120', 0.1, 0.8, true);
  addGrain(ctx, S, 150, 0.02);
  return cv; }
function woodDarkOld()  { resetSeed(3003); const { cv, ctx, S } = makeCanvas();
  waveLines(ctx, S, 14, '80,60,40', 0.18, 1.0, true);
  speckle(ctx, S, 50, '70,50,30', 0.1, 0.15, 1, 3);
  return cv; }
function woodTea()      { resetSeed(3004); const { cv, ctx, S } = makeCanvas();
  waveLines(ctx, S, 12, '140,110,80', 0.15, 0.9, true);
  for (let i=0;i<3;i++) seamlessLine(ctx,S,[[rnd()*S,0],[rnd()*S,S]],'rgba(110,85,60,0.15)',1.0);
  return cv; }

// ---- 石/土变体 ----
function stoneLight()   { resetSeed(3005); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<6;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,35+rnd()*50,0.9,0,`rgba(210,208,200,${0.05+rnd()*0.03})`);
  speckle(ctx, S, 120, '180,178,170', 0.06, 0.1, 1, 2);
  return cv; }
function stoneDark()    { resetSeed(3006); const { cv, ctx, S } = makeCanvas();
  // 大范围明暗
  for (let i=0;i<6;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,35+rnd()*50,0.9,0,
    rnd()>0.5?`rgba(110,108,102,${0.07+rnd()*0.04})`:`rgba(175,173,167,${0.05+rnd()*0.03})`);
  // 矿物颗粒（深色岩石，颗粒对比稍强）
  for (let i=0;i<200;i++){const r=0.8+rnd()*2;const s=rnd();const col=s<0.4?'80,78,72':s<0.7?'120,118,112':'160,158,152';
    seamlessEllipse(ctx,S,rnd()*S,rnd()*S,r,0.9,rnd()*Math.PI,`rgba(${col},${0.1+rnd()*0.1})`);}
  // 裂纹（淡）
  for (let i=0;i<2;i++){let x=rnd()*S,y=rnd()*S;const pts=[[x,y]];let ang=rnd()*Math.PI*2;
    for(let s2=0;s2<3;s2++){ang+=(rnd()-0.5)*1;x+=Math.cos(ang)*(14+rnd()*18);y+=Math.sin(ang)*(14+rnd()*18);pts.push([x,y]);}
    seamlessLine(ctx,S,pts,'rgba(70,68,62,0.15)',0.8);}
  return cv; }
function gravelFine()   { resetSeed(3007); const { cv, ctx, S } = makeCanvas();
  speckle(ctx, S, 300, '130,128,122', 0.1, 0.18, 0.8, 1.5);
  return cv; }
function dirtPath()      { resetSeed(3008); const { cv, ctx, S } = makeCanvas();
  // 大范围明暗
  for (let i=0;i<5;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,35+rnd()*50,0.9,0,`rgba(160,140,110,${0.05+rnd()*0.03})`);
  // 踩踏压实带（纵向中间区域，更暗更平）
  for (const dx of [-S,0,S]) {
    const g=ctx.createLinearGradient(S/2+dx-40,0,S/2+dx+40,0);
    g.addColorStop(0,'rgba(120,95,65,0)');g.addColorStop(0.5,'rgba(120,95,65,0.12)');g.addColorStop(1,'rgba(120,95,65,0)');
    ctx.fillStyle=g;ctx.fillRect(S/2+dx-40,0,80,S);
  }
  // 小石子
  speckle(ctx, S, 120, '130,120,105', 0.1, 0.18, 0.8, 1.8);
  addGrain(ctx, S, 250, 0.05);
  return cv; }

// ---- 墙/屋顶变体 ----
function wallOld()      { resetSeed(3009); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<5;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,40+rnd()*60,0.9,0,`rgba(190,180,160,${0.06+rnd()*0.04})`);
  speckle(ctx, S, 100, '170,160,140', 0.06, 0.1, 1, 3);
  // 雨水痕迹（垂直淡线）
  for (let i=0;i<4;i++) seamlessLine(ctx,S,[[rnd()*S,0],[rnd()*S,S]],'rgba(160,145,120,0.06)',1.5);
  return cv; }
function wallNew()      { resetSeed(3010); const { cv, ctx, S } = makeCanvas();
  speckle(ctx, S, 80, '200,198,192', 0.04, 0.07, 1, 2);
  return cv; }
function tileRoofOld()  { resetSeed(3011); const { cv, ctx, S } = makeCanvas();
  waveLines(ctx, S, 4, '100,95,88', 0.18, 1.2, false);
  gridLines(ctx, S, 5, 1, 0.15, '110,105,98');
  speckle(ctx, S, 60, '90,85,78', 0.08, 0.12, 1, 2);
  return cv; }

// ---- 金属变体 ----
function metalOld()     { resetSeed(3012); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<8;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(140,135,130,0.08)',0.8);
  speckle(ctx, S, 40, '120,115,110', 0.1, 0.15, 1, 2);
  return cv; }
function metalNew()     { resetSeed(3013); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<5;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(200,200,205,0.1)',0.6);
  return cv; }
function copper()       { resetSeed(3014); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<6;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(180,130,90,0.1)',0.8);
  speckle(ctx, S, 30, '160,110,75', 0.08, 0.12, 1, 2);
  return cv; }

// ---- 织物/纸变体 ----
function cotton()       { resetSeed(3015); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<10;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(200,195,185,0.08)',0.7);
  for (let i=0;i<10;i++) seamlessLine(ctx,S,[[rnd()*S,0],[rnd()*S,S]],'rgba(200,195,185,0.08)',0.7);
  return cv; }
function silk()         { resetSeed(3016); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<4;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(220,215,205,0.12)',1.5);
  return cv; }
function washi()        { resetSeed(3017); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<15;i++) seamlessLine(ctx,S,[[rnd()*S,0],[rnd()*S+20,S]],'rgba(200,190,170,0.06)',0.5);
  addGrain(ctx, S, 150, 0.03);
  return cv; }

// ---- 植被变体 ----
function mossThin()     { resetSeed(3018); const { cv, ctx, S } = makeCanvas();
  speckle(ctx, S, 150, '130,150,90', 0.1, 0.18, 1, 2);
  return cv; }
function grassDry()     { resetSeed(3019); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<30;i++) seamlessLine(ctx,S,[[rnd()*S,rnd()*S],[rnd()*S+(rnd()-0.5)*4,rnd()*S+3+rnd()*4]],'rgba(180,170,100,0.15)',0.6);
  return cv; }
function flowerPetal()  { resetSeed(3020); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<20;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,4+rnd()*6,0.5,rnd()*Math.PI,`rgba(230,200,200,${0.1+rnd()*0.08})`);
  return cv; }

// ---- 其他 ----
function ceramicOld()   { resetSeed(3021); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<4;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,20+rnd()*30,0.9,0,`rgba(180,140,120,${0.05+rnd()*0.03})`);
  speckle(ctx, S, 50, '170,130,110', 0.08, 0.12, 1, 2);
  return cv; }
function plasticOld()   { resetSeed(3022); const { cv, ctx, S } = makeCanvas();
  speckle(ctx, S, 60, '180,180,185', 0.06, 0.1, 1, 2);
  for (let i=0;i<3;i++) seamlessLine(ctx,S,[[rnd()*S,rnd()*S],[rnd()*S+10+rnd()*20,rnd()*S]],'rgba(170,170,175,0.08)',0.5);
  return cv; }
function glassFrost()   { resetSeed(3023); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<8;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(255,255,255,0.15)',1.5);
  speckle(ctx, S, 50, '220,225,230', 0.08, 0.12, 1, 2);
  return cv; }

// ============================================================
// 第三批：日式建筑构件 / 神社器物 / 枯山水 / 漆箔（凑满 100 种）
// ============================================================

// ---- 屋顶 ----
function thatch()       { resetSeed(4001); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<200;i++) { const x=rnd()*S,y=rnd()*S; seamlessLine(ctx,S,[[x,y],[x+(rnd()-0.5)*6,y+4+rnd()*5]],'rgba(160,140,90,0.15)',0.7); }
  return cv; }
function copperRoof()   { resetSeed(4002); const { cv, ctx, S } = makeCanvas();
  waveLines(ctx, S, 5, '160,120,90', 0.12, 1.0, false);
  gridLines(ctx, S, 6, 1, 0.1, '150,110,80');
  speckle(ctx, S, 40, '140,100,70', 0.08, 0.12, 1, 2);
  return cv; }
function tileWave()     { resetSeed(4003); const { cv, ctx, S } = makeCanvas();
  for (let y=20;y<S;y+=32) for (let x=0;x<S;x+=32) {
    ctx.strokeStyle='rgba(120,115,108,0.15)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(x,y,14,Math.PI,0); ctx.stroke();
  }
  return cv; }

// ---- 墙面 ----
function lacquerWall()  { resetSeed(4004); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<4;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,30+rnd()*40,0.9,0,'rgba(180,175,165,0.04)');
  speckle(ctx, S, 60, '190,185,175', 0.03, 0.06, 1, 2);
  return cv; }
function sandWall()     { resetSeed(4005); const { cv, ctx, S } = makeCanvas();
  speckle(ctx, S, 300, '190,175,150', 0.1, 0.18, 0.8, 1.8);
  return cv; }
function shurakuWall()  { resetSeed(4006); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<5;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,35+rnd()*50,0.9,0,`rgba(170,160,140,${0.05+rnd()*0.03})`);
  speckle(ctx, S, 150, '160,150,130', 0.08, 0.14, 1, 2);
  return cv; }

// ---- 门窗构件 ----
function amado()        { resetSeed(4007); const { cv, ctx, S } = makeCanvas();
  waveLines(ctx, S, 12, '130,110,85', 0.12, 0.9, true);
  for (let x=64;x<S;x+=64) seamlessLine(ctx,S,[[x,0],[x,S]],'rgba(100,80,60,0.15)',1.2);
  return cv; }
function koushido()     { resetSeed(4008); const { cv, ctx, S } = makeCanvas();
  gridLines(ctx, S, 6, 8, 0.2, '120,95,65');
  return cv; }
function ranmai()       { resetSeed(4009); const { cv, ctx, S } = makeCanvas();
  gridLines(ctx, S, 8, 1, 0.15, '140,115,80');
  waveLines(ctx, S, 4, '150,125,90', 0.08, 0.8, false);
  return cv; }

// ---- 室内 ----
function tatamiGreen()  { resetSeed(4010); const { cv, ctx, S } = makeCanvas();
  gridLines(ctx, S, 2, 4, 0.2, '170,180,120');
  for (let i=0;i<200;i++) ctx.fillStyle=`rgba(180,190,130,${0.04+rnd()*0.04})`; ctx.fillRect(rnd()*S,rnd()*S,2,1);
  return cv; }
function tatamiEdge()   { resetSeed(4011); const { cv, ctx, S } = makeCanvas();
  seamlessLine(ctx,S,[[0,8],[S,8]],'rgba(100,110,70,0.2)',3);
  seamlessLine(ctx,S,[[0,S-8],[S,S-8]],'rgba(100,110,70,0.2)',3);
  return cv; }
function shojiPaper()   { resetSeed(4012); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<10;i++) seamlessLine(ctx,S,[[rnd()*S,0],[rnd()*S+15,S]],'rgba(210,200,180,0.05)',0.4);
  addGrain(ctx, S, 100, 0.02);
  return cv; }
function fusuma()       { resetSeed(4013); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<3;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,20+rnd()*30,0.9,0,'rgba(190,180,160,0.04)');
  seamlessLine(ctx,S,[[S/2,0],[S/2,S]],'rgba(120,100,75,0.12)',1.5);
  return cv; }
function sudare()       { resetSeed(4014); const { cv, ctx, S } = makeCanvas();
  for (let y=8;y<S;y+=10) seamlessLine(ctx,S,[[0,y],[S,y]],'rgba(180,150,100,0.2)',1.2);
  return cv; }

// ---- 神社器物 ----
function chochin()      { resetSeed(4015); const { cv, ctx, S } = makeCanvas();
  for (let y=20;y<S;y+=24) seamlessLine(ctx,S,[[0,y],[S,y]],'rgba(180,60,50,0.15)',1.5);
  for (let i=0;i<8;i++) seamlessLine(ctx,S,[[rnd()*S,0],[rnd()*S,S]],'rgba(160,50,40,0.06)',0.5);
  return cv; }
function andon()        { resetSeed(4016); const { cv, ctx, S } = makeCanvas();
  gridLines(ctx, S, 4, 6, 0.12, '140,110,70');
  addGrain(ctx, S, 100, 0.03);
  return cv; }
function shimenawa()    { resetSeed(4017); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<30;i++) { const x=rnd()*S,y=rnd()*S; seamlessLine(ctx,S,[[x,y],[x+8+rnd()*8,y+(rnd()-0.5)*4]],'rgba(140,110,60,0.2)',2); }
  return cv; }
function shide()        { resetSeed(4018); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<6;i++) { ctx.strokeStyle='rgba(200,200,190,0.2)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(rnd()*S,rnd()*S); ctx.lineTo(rnd()*S,rnd()*S+15); ctx.stroke(); }
  return cv; }
function ema()          { resetSeed(4019); const { cv, ctx, S } = makeCanvas();
  waveLines(ctx, S, 8, '140,100,60', 0.15, 0.9, true);
  seamlessLine(ctx,S,[[0,15],[S,15]],'rgba(110,75,40,0.2)',1.5);
  return cv; }

// ---- 枯山水 / 庭园 ----
function gravelZen()    { resetSeed(4020); const { cv, ctx, S } = makeCanvas();
  speckle(ctx, S, 250, '150,145,135', 0.12, 0.2, 0.8, 1.5);
  return cv; }
function sandRipple()   { resetSeed(4021); const { cv, ctx, S } = makeCanvas();
  for (let y=20;y<S;y+=20) { ctx.strokeStyle='rgba(160,150,130,0.15)'; ctx.lineWidth=1; ctx.beginPath();
    for (let x=0;x<=S;x+=8) ctx.lineTo(x,y+Math.sin(x*0.08+y)*3); ctx.stroke(); }
  return cv; }
function mossStone()    { resetSeed(4022); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<6;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,30+rnd()*40,0.9,0,'rgba(140,135,125,0.06)');
  speckle(ctx, S, 100, '100,130,70', 0.15, 0.25, 1, 3);
  return cv; }
function tobiishi()     { resetSeed(4023); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<6;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,18+rnd()*22,0.85,rnd()*Math.PI,'rgba(130,125,115,0.15)');
  return cv; }
function ishidatami()   { resetSeed(4024); const { cv, ctx, S } = makeCanvas();
  // 缝隙底色
  ctx.fillStyle = 'rgb(168,162,150)'; ctx.fillRect(0,0,S,S);
  softFill(ctx, S, 4124, { layers: 4, n: 40, rMin: 8, rMax: 20, shade: 155, spread: 40, alpha: 0.07, warm: true });
  // 不规则石板
  const cols = 4, rows = 4;
  for (let j = 0; j < rows; j++) {
    const rowOff = (j % 2) * (S/cols*0.4);
    for (let i = 0; i < cols; i++) {
      const cw = S/cols, ch = S/rows;
      const cx = i*cw + rowOff + cw*0.5 + (rnd()-0.5)*6;
      const cy = j*ch + ch*0.5 + (rnd()-0.5)*6;
      const rw = cw*0.42 + rnd()*4, rh = ch*0.42 + rnd()*4;
      seamlessEllipse(ctx, S, cx+1.5, cy+2, rw, rh/rw, 0, 'rgba(98,92,82,0.3)');
      const g = 180 + Math.floor(rnd()*26);
      seamlessEllipse(ctx, S, cx, cy, rw, rh/rw, 0, `rgba(${g},${g-3},${g-10},0.95)`);
      seamlessEllipse(ctx, S, cx-rw*0.2, cy-rh*0.25, rw*0.5, 0.6, 0, 'rgba(248,245,238,0.3)');
      // 表面密集颗粒
      for (let k=0;k<12;k++) seamlessEllipse(ctx,S,cx+(rnd()-0.5)*rw*1.5,cy+(rnd()-0.5)*rh*1.5,0.7,1,0,'rgba(110,104,94,0.12)');
    }
  }
  return cv; }

// ---- 落叶 / 花瓣 ----
function leafLitter()   { resetSeed(4025); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<40;i++) { const x=rnd()*S,y=rnd()*S; ctx.fillStyle=`rgba(180,120,50,${0.15+rnd()*0.1})`;
    ctx.beginPath(); ctx.ellipse(x,y,3+rnd()*3,1.5,rnd()*Math.PI,0,Math.PI*2); ctx.fill(); }
  return cv; }
function mapleLeaf()    { resetSeed(4026); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<15;i++) { ctx.fillStyle=`rgba(200,80,40,${0.15+rnd()*0.1})`;
    ctx.beginPath(); ctx.ellipse(rnd()*S,rnd()*S,4,3,rnd()*Math.PI,0,Math.PI*2); ctx.fill(); }
  return cv; }
function ginkgoLeaf()   { resetSeed(4027); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<15;i++) { ctx.fillStyle=`rgba(210,190,80,${0.15+rnd()*0.1})`;
    ctx.beginPath(); ctx.ellipse(rnd()*S,rnd()*S,4,3,rnd()*Math.PI,0,Math.PI*2); ctx.fill(); }
  return cv; }
function sakuraPetal()  { resetSeed(4028); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<20;i++) { ctx.fillStyle=`rgba(240,200,210,${0.15+rnd()*0.1})`;
    ctx.beginPath(); ctx.ellipse(rnd()*S,rnd()*S,3,2,rnd()*Math.PI,0,Math.PI*2); ctx.fill(); }
  return cv; }

// ---- 漆 / 箔 / 陶 ----
function urushiBlack()  { resetSeed(4029); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<4;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(60,50,45,0.15)',1.2);
  return cv; }
function urushiRed()    { resetSeed(4030); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<4;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(120,40,30,0.15)',1.2);
  return cv; }
function goldFoil()     { resetSeed(4031); const { cv, ctx, S } = makeCanvas();
  speckle(ctx, S, 80, '200,170,90', 0.15, 0.25, 1, 3);
  for (let i=0;i<5;i++) seamlessLine(ctx,S,[[0,rnd()*S],[S,rnd()*S]],'rgba(220,190,110,0.1)',1);
  return cv; }
function silverFoil()   { resetSeed(4032); const { cv, ctx, S } = makeCanvas();
  speckle(ctx, S, 80, '190,190,195', 0.15, 0.25, 1, 3);
  return cv; }
function rakuWare()     { resetSeed(4033); const { cv, ctx, S } = makeCanvas();
  for (let i=0;i<4;i++) seamlessEllipse(ctx,S,rnd()*S,rnd()*S,25+rnd()*35,0.9,0,'rgba(160,120,100,0.06)');
  speckle(ctx, S, 60, '150,110,90', 0.1, 0.16, 1, 2);
  return cv; }

// ============================================================
// Roughness Map（Messenger 重点：不同区域粗糙度不同）
// 灰度图：白=高 roughness（粗糙），黑=低 roughness（光滑）
// ============================================================
const roughCache = new Map();

function makeRoughCanvas(kind) {
  resetSeed(5000 + (kind.length * 37));
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  // 基底 roughness（不同材质基础值不同）
  // 粗糙材质（水泥/木/石/布）= 偏白；光滑材质（金属/玻璃/漆面）= 偏黑
  const isSmooth = ['metal','metalNew','brass','copper','glass','glassFrost','silk','urushiBlack','urushiRed','goldFoil','silverFoil','plastic','water'].includes(kind);
  const base = isSmooth ? 130 : 210;
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, S, S);

  // 大范围柔和 roughness 变化（潮湿/磨损/污渍区域）
  const variationCount = isSmooth ? 6 : 10;
  for (let i = 0; i < variationCount; i++) {
    const x = rnd() * S, y = rnd() * S;
    const r = 30 + rnd() * 60;
    // 粗糙材质：大部分区域粗糙，局部磨损变光滑（变暗）
    // 光滑材质：大部分区域光滑，局部污渍变粗糙（变亮）
    const v = isSmooth ? 40 : -40;
    const alpha = 0.08 + rnd() * 0.08;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, `rgba(${base + v},${base + v},${base + v},${alpha})`);
      g.addColorStop(1, `rgba(${base + v},${base + v},${base + v},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }

  // 细微 roughness 颗粒（表面微观粗糙度变化）
  const grainCount = isSmooth ? 150 : 300;
  for (let i = 0; i < grainCount; i++) {
    const v = (rnd() - 0.5) * 50;
    ctx.fillStyle = `rgba(${base + v},${base + v},${base + v},${0.1 + rnd() * 0.1})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
  }

  return cv;
}

/**
 * 取 roughnessMap（灰度图）。配合 handTex(kind) 一起用。
 */
export function handRough(kind) {
  if (roughCache.has(kind)) return roughCache.get(kind);
  const cv = makeRoughCanvas(kind);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  roughCache.set(kind, t);
  return t;
}

// ---------- 缓存 ----------
const cache = new Map();
function toTex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * 取手绘纹理。kind 共 47 种，覆盖日式小镇全部材质类别。
 */
export function handTex(kind) {
  if (cache.has(kind)) return cache.get(kind);
  let cv;
  switch (kind) {
    // 原有 12 种
    case 'wood':      cv = wood(); break;
    case 'vermilion': cv = vermilion(); break;
    case 'paper':     cv = paper(); break;
    case 'stone':     cv = stone(); break;
    case 'metal':     cv = metal(); break;
    case 'fabric':    cv = fabric(); break;
    case 'plastic':   cv = plastic(); break;
    case 'rubber':    cv = rubber(); break;
    case 'leaf':      cv = leaf(); break;
    case 'bark':      cv = bark(); break;
    case 'water':     cv = water(); break;
    case 'fur':       cv = fur(); break;
    // 外墙/屋顶
    case 'plaster':     cv = plaster(); break;
    case 'brickRed':    cv = brickRed(); break;
    case 'brickWhite':   cv = brickWhite(); break;
    case 'concrete':    cv = concrete(); break;
    case 'tileRoof':    cv = tileRoof(); break;
    case 'slate':       cv = slate(); break;
    case 'woodPlank':   cv = woodPlank(); break;
    case 'shoji':       cv = shoji(); break;
    // 木/竹/草
    case 'woodDark':     cv = woodDark(); break;
    case 'woodPainted':  cv = woodPainted(); break;
    case 'woodLight':    cv = woodLight(); break;
    case 'woodWeathered':cv = woodWeathered(); break;
    case 'bamboo':      cv = bamboo(); break;
    case 'tatami':      cv = tatami(); break;
    case 'cedar':       cv = cedar(); break;
    // 石/土/路
    case 'cobble':     cv = cobble(); break;
    case 'dirt':      cv = dirt(); break;
    case 'sand':      cv = sand(); break;
    case 'gravel':    cv = gravel(); break;
    case 'tileFloor': cv = tileFloor(); break;
    // 织物/纸
    case 'noren':     cv = noren(); break;
    case 'stripe':    cv = stripe(); break;
    case 'check':     cv = check(); break;
    case 'curtain':   cv = curtain(); break;
    case 'paperOld':  cv = paperOld(); break;
    case 'paperBrown':cv = paperBrown(); break;
    // 植被
    case 'moss':       cv = moss(); break;
    case 'bambooLeaf': cv = bambooLeaf(); break;
    case 'pine':       cv = pine(); break;
    case 'leafAutumn': cv = leafAutumn(); break;
    case 'leafSpring': cv = leafSpring(); break;
    // 金属/陶/其他
    case 'ceramic':  cv = ceramic(); break;
    case 'asphalt':  cv = asphalt(); break;
    case 'brass':    cv = brass(); break;
    case 'rust':     cv = rust(); break;
    case 'glass':    cv = glass(); break;
    case 'snow':     cv = snow(); break;
    case 'cloud':    cv = cloud(); break;
    // 第二批深化变体
    case 'woodOld':      cv = woodOld(); break;
    case 'woodPale':     cv = woodPale(); break;
    case 'woodDarkOld':  cv = woodDarkOld(); break;
    case 'woodTea':      cv = woodTea(); break;
    case 'stoneLight':   cv = stoneLight(); break;
    case 'stoneDark':    cv = stoneDark(); break;
    case 'gravelFine':   cv = gravelFine(); break;
    case 'dirtPath':     cv = dirtPath(); break;
    case 'wallOld':      cv = wallOld(); break;
    case 'wallNew':      cv = wallNew(); break;
    case 'tileRoofOld':  cv = tileRoofOld(); break;
    case 'metalOld':     cv = metalOld(); break;
    case 'metalNew':     cv = metalNew(); break;
    case 'copper':       cv = copper(); break;
    case 'cotton':       cv = cotton(); break;
    case 'silk':         cv = silk(); break;
    case 'washi':        cv = washi(); break;
    case 'mossThin':     cv = mossThin(); break;
    case 'grassDry':     cv = grassDry(); break;
    case 'flowerPetal':  cv = flowerPetal(); break;
    case 'ceramicOld':   cv = ceramicOld(); break;
    case 'plasticOld':   cv = plasticOld(); break;
    case 'glassFrost':   cv = glassFrost(); break;
    // 第三批：日式构件/神社/枯山水/漆箔
    case 'thatch':       cv = thatch(); break;
    case 'copperRoof':   cv = copperRoof(); break;
    case 'tileWave':     cv = tileWave(); break;
    case 'lacquerWall':  cv = lacquerWall(); break;
    case 'sandWall':     cv = sandWall(); break;
    case 'shurakuWall':  cv = shurakuWall(); break;
    case 'amado':        cv = amado(); break;
    case 'koushido':     cv = koushido(); break;
    case 'ranmai':       cv = ranmai(); break;
    case 'tatamiGreen':  cv = tatamiGreen(); break;
    case 'tatamiEdge':   cv = tatamiEdge(); break;
    case 'shojiPaper':   cv = shojiPaper(); break;
    case 'fusuma':       cv = fusuma(); break;
    case 'sudare':       cv = sudare(); break;
    case 'chochin':      cv = chochin(); break;
    case 'andon':        cv = andon(); break;
    case 'shimenawa':    cv = shimenawa(); break;
    case 'shide':        cv = shide(); break;
    case 'ema':          cv = ema(); break;
    case 'gravelZen':    cv = gravelZen(); break;
    case 'sandRipple':   cv = sandRipple(); break;
    case 'mossStone':    cv = mossStone(); break;
    case 'tobiishi':     cv = tobiishi(); break;
    case 'ishidatami':   cv = ishidatami(); break;
    case 'leafLitter':   cv = leafLitter(); break;
    case 'mapleLeaf':    cv = mapleLeaf(); break;
    case 'ginkgoLeaf':   cv = ginkgoLeaf(); break;
    case 'sakuraPetal':  cv = sakuraPetal(); break;
    case 'urushiBlack':  cv = urushiBlack(); break;
    case 'urushiRed':    cv = urushiRed(); break;
    case 'goldFoil':     cv = goldFoil(); break;
    case 'silverFoil':   cv = silverFoil(); break;
    case 'rakuWare':     cv = rakuWare(); break;
    default:         cv = plastic();
  }
  const t = toTex(cv);
  cache.set(kind, t);
  return t;
}

// ---------- 贴图亮度补偿 ----------
// 本文件的约定是「白底 + 深色纹路，颜色由材质 color 决定」。但 softFill 那层 shade=180
// 的铺底加上线条，让多数纹样的均值只有 ~0.7 sRGB ≈ 0.46 线性；map 与 color 相乘时设计色
// 会被压掉一半以上。实测站前广场地坪比同反照率的裸面暗 2.4 倍，看着像一块脏斑而不是石板。
// 地坪那边原先是靠手调 mul=1.85 顶回来的（town.js YARDS），这里改成按实测均值算，
// 与 planetMap 给地形硬乘 1.414 是同一个思路。
const meanCache = new Map();

/** 一张 sRGB 贴图的平均线性反照率（0~1）。只对 CanvasTexture 这类立即可读的图可靠。 */
export function texLinearMean(tex) {
  if (!tex || !tex.image) return 1;
  if (meanCache.has(tex.uuid)) return meanCache.get(tex.uuid);
  const img = tex.image;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, cv.width, cv.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += Math.pow(d[i] / 255, 2.2) * 0.2126 + Math.pow(d[i + 1] / 255, 2.2) * 0.7152 + Math.pow(d[i + 2] / 255, 2.2) * 0.0722;
    n++;
  }
  const m = n ? sum / n : 1;
  meanCache.set(tex.uuid, m);
  return m;
}

/** 让 map 只加纹路、不改亮度：color = 设计色 ÷ 贴图线性均值 */
export function tintFor(hex, tex) {
  const m = Math.max(0.08, Math.min(1, texLinearMean(tex)));
  return new THREE.Color(hex).multiplyScalar(1 / m);
}
