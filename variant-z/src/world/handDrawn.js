// handDrawn.js —— GLB 模型的手绘材质库（动漫写实、线条细致）
// 背景：public/models 里的 Kenney 件引用的 Textures/colormap.png 在仓库里不存在（GLTFLoader
// 直接把 map 置空 → 整车整杆渲染成纯白），NPC/动物则是几十个纯色 baseColorFactor 的平涂件。
// 这里不依赖模型自带 UV（那套 UV 指向丢失的图集），而是把细节按「世界坐标三平面」乘进漫反射，
// 密度与物件大小无关、也不受坏 UV 影响；注入点在 messenger.js 的 mseFromMaterial。
// 约定同根工程 textures.js：256×256、白底、深色细线，与漫反射相乘（颜色由材质 color 决定）。
import * as THREE from 'three';

// ---------- 绘制小工具 ----------
let _seed = 1;
const rnd = () => (_seed = (_seed * 16807) % 2147483647) / 2147483647;
const resetSeed = (s) => { _seed = s; };

function canvas2d(S = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  return { cv, ctx, S };
}

/** 平铺无缝：同一条线在 ±S 处各画一遍 */
function wrapLine(ctx, S, pts, style, width) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
    ctx.stroke();
  }
}
function wrapBlob(ctx, S, x, y, rx, ry, style, rot = 0) {
  ctx.fillStyle = style;
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    ctx.beginPath();
    ctx.ellipse(x + dx, y + dy, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
  }
}
/** 一条带粗细变化的手绘长墨线（动漫上色的"活线"） */
function inkStroke(ctx, S, x0, y0, len, angle, { seg = 8, wob = 3, a = 0.16, w = 1.0, taper = true } = {}) {
  const pts = [];
  let x = x0, y = y0, ang = angle;
  for (let i = 0; i <= seg; i++) {
    pts.push([x, y]);
    ang += (rnd() - 0.5) * (wob / 24);
    x += Math.cos(ang) * (len / seg);
    y += Math.sin(ang) * (len / seg);
  }
  const n = pts.length;
  for (let i = 1; i < n; i++) {
    const k = taper ? Math.sin((i / (n - 1)) * Math.PI) : 1;
    wrapLine(ctx, S, [pts[i - 1], pts[i]], `rgba(58,50,42,${a * (0.45 + 0.55 * k)})`, w * (0.6 + 0.6 * k));
  }
}
function grain(ctx, S, count, alpha = 0.05, size = 1.3) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(104,90,74,${alpha * rnd()})` : `rgba(255,255,255,${alpha * rnd()})`;
    ctx.fillRect(x, y, size, size);
  }
}
function wash(ctx, S, count, alpha = 0.045) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 34;
    wrapBlob(ctx, S, x, y, r, r * (0.5 + rnd() * 0.5), rnd() > 0.45
      ? `rgba(146,128,104,${alpha + rnd() * alpha})`
      : `rgba(255,255,252,${0.05 + rnd() * 0.06})`, rnd() * Math.PI);
  }
}
/** 等距平行线组（拉丝/织纹/胎纹的地母） */
function hatch(ctx, S, gap, { vertical = false, a = 0.06, w = 0.8, jitter = 1.5 } = {}) {
  for (let p = 0; p < S + gap; p += gap) {
    const off = (rnd() - 0.5) * jitter;
    const pts = [];
    for (let q = 0; q <= S; q += 32) {
      const wob = Math.sin((q + p) * 0.05) * 0.8;
      pts.push(vertical ? [p + off + wob, q] : [q, p + off + wob]);
    }
    wrapLine(ctx, S, pts, `rgba(74,64,54,${a * (0.6 + rnd() * 0.8)})`, w);
  }
}

// ============================================================
// 各材质的手绘贴图
// ============================================================
const PAINTERS = {
  // 汽车/机车外壳：清漆刷痕 + 钣金分缝 + 磨白与细划痕
  paintedMetal({ ctx, S }) {
    wash(ctx, S, 14, 0.035);
    for (let i = 0; i < 26; i++) { // 清漆横向刷痕
      const y = rnd() * S;
      wrapLine(ctx, S, [[0, y], [S * 0.5, y + (rnd() - 0.5) * 2], [S, y]], `rgba(96,86,76,${0.03 + rnd() * 0.035})`, 0.7);
    }
    for (let i = 0; i < 2; i++) { // 钣金分缝（门缝/机盖缝）：暗线 + 缝下反光
      const y = rnd() * S;
      wrapLine(ctx, S, [[0, y], [S * 0.4, y + 1.5], [S, y]], 'rgba(46,40,34,0.34)', 1.15);
      wrapLine(ctx, S, [[0, y + 2.2], [S, y + 2.6]], 'rgba(255,255,255,0.5)', 0.9);
    }
    for (let i = 0; i < 5; i++) inkStroke(ctx, S, rnd() * S, rnd() * S, 18 + rnd() * 34, rnd() * Math.PI, { a: 0.07, w: 0.6 }); // 细划痕
    for (let i = 0; i < 26; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 0.9 + rnd() * 1.6, 0.7 + rnd(), 'rgba(255,255,255,0.42)'); } // 磨白点
    grain(ctx, S, 260, 0.035);
  },

  // 灯杆/金属构件：纵向拉丝 + 环向接缝
  brushedMetal({ ctx, S }) {
    hatch(ctx, S, 3.2, { vertical: true, a: 0.075, w: 0.7, jitter: 1 });
    hatch(ctx, S, 9, { vertical: true, a: 0.05, w: 1.1, jitter: 2 });
    for (let i = 0; i < 2; i++) { // 管段接缝
      const y = rnd() * S;
      wrapLine(ctx, S, [[0, y], [S, y]], 'rgba(48,44,40,0.3)', 1.3);
      wrapLine(ctx, S, [[0, y + 2.4], [S, y + 2.4]], 'rgba(255,255,255,0.45)', 1.0);
    }
    for (let i = 0; i < 10; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 1.6 + rnd() * 3, 1 + rnd() * 2, `rgba(126,84,52,${0.08 + rnd() * 0.09})`); } // 锈点
    grain(ctx, S, 300, 0.04);
  },

  // 铸铁/深灰件：麻点 + 分叉锈线
  castIron({ ctx, S }) {
    wash(ctx, S, 10, 0.05);
    for (let i = 0; i < 130; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 0.7 + rnd() * 1.5, 0.6 + rnd() * 1.2, `rgba(40,36,32,${0.08 + rnd() * 0.12})`); }
    for (let i = 0; i < 5; i++) {
      let x = rnd() * S, y = rnd() * S, ang = rnd() * Math.PI * 2;
      for (let s = 0; s < 4; s++) {
        const nx = x + Math.cos(ang) * (10 + rnd() * 16), ny = y + Math.sin(ang) * (10 + rnd() * 16);
        wrapLine(ctx, S, [[x, y], [nx, ny]], `rgba(120,74,44,${0.12 + rnd() * 0.1})`, 0.8);
        x = nx; y = ny; ang += (rnd() - 0.5) * 1.1;
      }
    }
    hatch(ctx, S, 14, { vertical: false, a: 0.03, w: 0.7 });
    grain(ctx, S, 420, 0.05);
  },

  // 轮胎：胎面横纹 + 侧壁弧线与灰尘
  rubber({ ctx, S }) {
    for (let x = 0; x < S + 16; x += 16) { // 胎面块
      wrapLine(ctx, S, [[x, 0], [x + 5, S * 0.5], [x, S]], 'rgba(30,28,26,0.3)', 2.0);
      wrapLine(ctx, S, [[x + 6, 0], [x + 10, S * 0.5], [x + 6, S]], 'rgba(255,255,255,0.14)', 1.0);
    }
    for (let i = 0; i < 3; i++) { const y = rnd() * S; wrapLine(ctx, S, [[0, y], [S, y]], `rgba(60,56,52,${0.1 + rnd() * 0.08})`, 0.8); } // 侧壁模线
    for (let i = 0; i < 90; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 0.8 + rnd() * 1.4, 0.7 + rnd(), `rgba(150,138,120,${0.06 + rnd() * 0.1})`); } // 灰尘
    grain(ctx, S, 520, 0.06, 1.5);
  },

  // 玻璃/灯罩：斜向反光带 + 尘点 + 边缝
  glass({ ctx, S }) {
    for (let i = 0; i < 5; i++) { // 斜向反光条（暗线组，乘出来是"反光纹路"）
      const x0 = rnd() * S, w = 6 + rnd() * 16;
      for (let k = 0; k < 4; k++) {
        const x = x0 + k * (w / 4);
        wrapLine(ctx, S, [[x, 0], [x + S * 0.28, S]], `rgba(120,132,142,${0.05 + rnd() * 0.05})`, 0.8);
      }
    }
    for (let i = 0; i < 3; i++) { const y = rnd() * S; wrapLine(ctx, S, [[0, y], [S, y]], 'rgba(70,66,60,0.16)', 1.0); } // 密封胶条
    for (let i = 0; i < 40; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 0.6 + rnd() * 1.1, 0.6 + rnd(), `rgba(90,96,100,${0.08 + rnd() * 0.1})`); } // 尘点
    grain(ctx, S, 160, 0.03);
  },

  // 木：细木纹 + 板缝 + 节疤
  wood({ ctx, S }) {
    wash(ctx, S, 10, 0.04);
    for (let i = 0; i < 22; i++) { // 纵向纹理线
      const x = rnd() * S;
      const pts = [];
      for (let y = 0; y <= S; y += 14) pts.push([x + Math.sin(y * 0.035 + i) * (1.5 + rnd() * 2.5), y]);
      wrapLine(ctx, S, pts, `rgba(92,62,36,${0.09 + rnd() * 0.13})`, 0.7 + rnd() * 0.7);
    }
    for (let i = 0; i < 2; i++) { // 板缝：深线 + 一侧高光
      const x = rnd() * S;
      wrapLine(ctx, S, [[x, 0], [x + 2, S]], 'rgba(52,34,20,0.36)', 1.5);
      wrapLine(ctx, S, [[x + 3.4, 0], [x + 5.4, S]], 'rgba(255,255,255,0.4)', 1.0);
    }
    for (let i = 0; i < 2; i++) { // 节疤：同心细椭圆
      const x = rnd() * S, y = rnd() * S, rot = rnd() * Math.PI;
      for (let k = 1; k <= 3; k++) {
        ctx.strokeStyle = `rgba(74,46,26,${0.2 - k * 0.04})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(x, y, k * 2.6, k * 1.7, rot, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    hatch(ctx, S, 6, { vertical: true, a: 0.028, w: 0.6 });
    grain(ctx, S, 320, 0.045);
  },

  // 上漆木（围栏/长椅）：隐约木纹 + 漆面细裂 + 磨角
  paintedWood({ ctx, S }) {
    hatch(ctx, S, 7, { vertical: true, a: 0.03, w: 0.7 });
    for (let i = 0; i < 6; i++) {
      let x = rnd() * S, y = rnd() * S, ang = rnd() * Math.PI * 2;
      const pts = [[x, y]];
      for (let s = 0; s < 5; s++) { ang += (rnd() - 0.5) * 1.4; x += Math.cos(ang) * 12; y += Math.sin(ang) * 12; pts.push([x, y]); }
      wrapLine(ctx, S, pts, `rgba(88,74,60,${0.14 + rnd() * 0.1})`, 0.75);
    }
    for (let i = 0; i < 24; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 1.2 + rnd() * 2.6, 1 + rnd() * 2, 'rgba(255,255,255,0.4)'); } // 磨白
    for (let i = 0; i < 2; i++) { const y = rnd() * S; wrapLine(ctx, S, [[0, y], [S, y]], 'rgba(60,50,42,0.22)', 1.2); } // 板缝
    grain(ctx, S, 300, 0.04);
  },

  // 岩石/混凝土：不规则裂纹 + 矿物点 + 苔痕
  stone({ ctx, S }) {
    wash(ctx, S, 22, 0.05);
    for (let i = 0; i < 6; i++) { // 主裂纹
      let x = rnd() * S, y = rnd() * S, ang = rnd() * Math.PI * 2;
      const pts = [[x, y]];
      for (let s = 0; s < 6; s++) { ang += (rnd() - 0.5) * 1.1; x += Math.cos(ang) * (12 + rnd() * 20); y += Math.sin(ang) * (12 + rnd() * 20); pts.push([x, y]); }
      wrapLine(ctx, S, pts, `rgba(72,64,56,${0.2 + rnd() * 0.14})`, 0.9);
      const br = pts[Math.floor(rnd() * pts.length)]; // 支裂纹
      wrapLine(ctx, S, [br, [br[0] + (rnd() - 0.5) * 26, br[1] + (rnd() - 0.5) * 26]], `rgba(72,64,56,${0.12 + rnd() * 0.1})`, 0.7);
    }
    for (let i = 0; i < 90; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 0.7 + rnd() * 1.6, 0.6 + rnd() * 1.3, rnd() > 0.5 ? `rgba(255,255,255,${0.2 + rnd() * 0.25})` : `rgba(70,62,54,${0.08 + rnd() * 0.1})`); } // 矿物颗粒
    for (let i = 0; i < 6; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 4 + rnd() * 9, 3 + rnd() * 6, `rgba(96,110,74,${0.07 + rnd() * 0.07})`); } // 苔痕
    grain(ctx, S, 520, 0.05);
  },

  // 灌木/树冠：叶形 + 叶脉 + 团块明暗
  foliage({ ctx, S }) {
    for (let i = 0; i < 60; i++) { // 叶片：椭圆轮廓 + 中线叶脉
      const x = rnd() * S, y = rnd() * S, r = 4 + rnd() * 7, rot = rnd() * Math.PI;
      ctx.fillStyle = rnd() > 0.5 ? `rgba(58,84,44,${0.1 + rnd() * 0.1})` : `rgba(150,176,110,${0.09 + rnd() * 0.09})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.5, rot, 0, Math.PI * 2); ctx.fill();
      wrapLine(ctx, S, [[x - Math.cos(rot) * r * 0.9, y - Math.sin(rot) * r * 0.9], [x + Math.cos(rot) * r * 0.9, y + Math.sin(rot) * r * 0.9]], `rgba(44,62,34,${0.14 + rnd() * 0.12})`, 0.6);
      for (let k = -1; k <= 1; k += 2) { // 侧脉
        const mx = x + Math.cos(rot) * r * 0.3 * k, my = y + Math.sin(rot) * r * 0.3 * k;
        wrapLine(ctx, S, [[mx, my], [mx + Math.cos(rot + k * 0.9) * r * 0.5, my + Math.sin(rot + k * 0.9) * r * 0.5]], 'rgba(44,62,34,0.1)', 0.5);
      }
    }
    for (let i = 0; i < 26; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 6 + rnd() * 14, 5 + rnd() * 10, `rgba(40,58,32,${0.06 + rnd() * 0.07})`); } // 暗团
    for (let i = 0; i < 18; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 5 + rnd() * 11, 4 + rnd() * 8, 'rgba(255,252,236,0.22)'); } // 受光斑
    grain(ctx, S, 260, 0.04);
  },

  // 草：成束细长叶片（线条要细）
  grassBlade({ ctx, S }) {
    for (let i = 0; i < 46; i++) {
      const x = rnd() * S, y = rnd() * S, h = 26 + rnd() * 40, lean = (rnd() - 0.5) * 16;
      const pts = [[x, y + h], [x + lean * 0.3, y + h * 0.55], [x + lean, y]];
      wrapLine(ctx, S, pts, `rgba(74,96,52,${0.16 + rnd() * 0.16})`, 0.9 + rnd() * 0.5);
      wrapLine(ctx, S, pts.map(([px, py], k) => [px + 1.6, py]), `rgba(255,252,238,${0.14 + rnd() * 0.12})`, 0.6); // 叶脊高光
    }
    for (let i = 0; i < 20; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 5 + rnd() * 10, 4 + rnd() * 7, `rgba(120,140,86,${0.06 + rnd() * 0.06})`); }
    grain(ctx, S, 240, 0.045);
  },

  // 布：经纬织纹 + 缝线（虚线）+ 纤维毛刺
  fabric({ ctx, S }) {
    hatch(ctx, S, 4, { vertical: false, a: 0.05, w: 0.7, jitter: 0.6 });
    hatch(ctx, S, 4, { vertical: true, a: 0.045, w: 0.7, jitter: 0.6 });
    for (let i = 0; i < 2; i++) { // 缝线
      const y = rnd() * S, pts = [];
      for (let x = 0; x <= S; x += 10) pts.push([x, y + Math.sin(x * 0.08) * 0.6]);
      for (let k = 0; k < pts.length - 1; k += 2) wrapLine(ctx, S, [pts[k], pts[k + 1]], 'rgba(70,62,54,0.24)', 0.85);
      wrapLine(ctx, S, pts.map(([x, yy]) => [x, yy + 3]), 'rgba(255,255,255,0.3)', 0.7); // 缝线压痕
    }
    for (let i = 0; i < 60; i++) { const x = rnd() * S, y = rnd() * S; wrapLine(ctx, S, [[x, y], [x + (rnd() - 0.5) * 5, y + (rnd() - 0.5) * 5]], `rgba(120,110,98,${0.1 + rnd() * 0.12})`, 0.5); } // 毛刺
    wash(ctx, S, 8, 0.03);
  },

  // 皮肤：极细颗粒 + 淡晕（线条要克制，否则显脏）
  skin({ ctx, S }) {
    for (let i = 0; i < 900; i++) { const x = rnd() * S, y = rnd() * S; ctx.fillStyle = `rgba(150,104,86,${0.02 + rnd() * 0.035})`; ctx.fillRect(x, y, 1.1, 1.1); }
    for (let i = 0; i < 8; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 8 + rnd() * 16, 6 + rnd() * 12, 'rgba(255,250,242,0.28)'); } // 受光
    for (let i = 0; i < 5; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 6 + rnd() * 10, 5 + rnd() * 8, `rgba(176,116,96,${0.05 + rnd() * 0.05})`); }
    for (let i = 0; i < 10; i++) inkStroke(ctx, S, rnd() * S, rnd() * S, 8 + rnd() * 12, rnd() * Math.PI, { a: 0.035, w: 0.5 }); // 细纹
  },

  // 头发：顺向发丝 + 高光带
  hair({ ctx, S }) {
    for (let i = 0; i < 34; i++) {
      const x = rnd() * S;
      const pts = [];
      for (let y = 0; y <= S; y += 16) pts.push([x + Math.sin(y * 0.02 + i) * 3.5, y]);
      wrapLine(ctx, S, pts, `rgba(46,38,34,${0.14 + rnd() * 0.16})`, 0.8 + rnd() * 0.6);
    }
    for (let i = 0; i < 14; i++) {
      const x = rnd() * S;
      wrapLine(ctx, S, [[x, 0], [x + 4, S * 0.5], [x, S]], 'rgba(255,252,246,0.34)', 1.2); // 发丝高光
    }
    grain(ctx, S, 200, 0.03);
  },

  // 动物毛：短毛簇成束
  fur({ ctx, S }) {
    for (let i = 0; i < 150; i++) {
      const x = rnd() * S, y = rnd() * S, ang = Math.PI / 2 + (rnd() - 0.5) * 0.9, len = 5 + rnd() * 11;
      wrapLine(ctx, S, [[x, y], [x + Math.cos(ang) * len * 0.5 + (rnd() - 0.5) * 2, y + Math.sin(ang) * len * 0.5], [x + Math.cos(ang) * len, y + Math.sin(ang) * len]],
        `rgba(72,56,44,${0.1 + rnd() * 0.16})`, 0.7 + rnd() * 0.5);
    }
    for (let i = 0; i < 40; i++) { const x = rnd() * S, y = rnd() * S; wrapLine(ctx, S, [[x, y], [x + 1, y + 6 + rnd() * 5]], 'rgba(255,252,244,0.3)', 0.7); } // 亮毛
    wash(ctx, S, 8, 0.035);
  },

  // 陶盆：粗颗粒 + 水渍环 + 釉裂
  terracotta({ ctx, S }) {
    grain(ctx, S, 900, 0.07, 1.6);
    for (let i = 0; i < 5; i++) { const y = rnd() * S; wrapLine(ctx, S, [[0, y], [S, y + (rnd() - 0.5) * 3]], `rgba(120,78,52,${0.1 + rnd() * 0.1})`, 1.1); } // 拉坯轮纹
    for (let i = 0; i < 6; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 7 + rnd() * 12, 5 + rnd() * 9, `rgba(96,62,40,${0.06 + rnd() * 0.06})`); }
    for (let i = 0; i < 4; i++) inkStroke(ctx, S, rnd() * S, rnd() * S, 16 + rnd() * 22, rnd() * Math.PI, { a: 0.09, w: 0.6 });
  },

  // 塑料件：分模线 + 弧面高光 + 细划痕
  plastic({ ctx, S }) {
    for (let i = 0; i < 2; i++) { const y = rnd() * S; wrapLine(ctx, S, [[0, y], [S, y]], 'rgba(70,66,62,0.18)', 1.0); wrapLine(ctx, S, [[0, y + 2], [S, y + 2]], 'rgba(255,255,255,0.42)', 0.9); }
    for (let i = 0; i < 4; i++) { const y = rnd() * S; wrapLine(ctx, S, [[0, y], [S * 0.5, y + 2], [S, y]], 'rgba(255,255,255,0.5)', 2.4); } // 宽高光带
    for (let i = 0; i < 6; i++) inkStroke(ctx, S, rnd() * S, rnd() * S, 12 + rnd() * 26, rnd() * Math.PI, { a: 0.05, w: 0.55 });
    grain(ctx, S, 220, 0.03);
  },

  // 灯罩：放射细线 + 网纹
  lampGlow({ ctx, S }) {
    for (let i = 0; i < 16; i++) { const y = (i / 16) * S; wrapLine(ctx, S, [[0, y], [S, y]], 'rgba(120,104,72,0.12)', 0.8); }
    hatch(ctx, S, 8, { vertical: true, a: 0.05, w: 0.7 });
    for (let i = 0; i < 30; i++) { const x = rnd() * S, y = rnd() * S; wrapBlob(ctx, S, x, y, 2 + rnd() * 4, 2 + rnd() * 3, 'rgba(255,252,240,0.35)'); }
  },
};

// ---------- 贴图缓存 ----------
const _texCache = new Map();
export function hdTexture(kind) {
  if (_texCache.has(kind)) return _texCache.get(kind);
  const painter = PAINTERS[kind] || PAINTERS.plastic;
  resetSeed(kind.split('').reduce((a, c) => a + c.charCodeAt(0) * 31, 7));
  const { cv, ctx, S } = canvas2d(256);
  painter({ ctx, S });
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _texCache.set(kind, t);
  return t;
}

/** 导出给调试/文档用：把某张手绘贴图存成 PNG dataURL */
export function hdPreview(kind) {
  const t = hdTexture(kind);
  return t.image.toDataURL();
}

// ---------- 每种材质的世界密度(scale=每米贴图数)与强度 ----------
const HD_DENSITY = {
  paintedMetal: { scale: 0.55, amt: 0.9 },
  brushedMetal: { scale: 0.9, amt: 0.85 },
  castIron: { scale: 1.4, amt: 0.8 },
  rubber: { scale: 1.5, amt: 0.85 },
  glass: { scale: 0.8, amt: 0.7 },
  wood: { scale: 0.75, amt: 1.0 },
  paintedWood: { scale: 0.8, amt: 0.9 },
  stone: { scale: 0.7, amt: 0.95 },
  foliage: { scale: 1.3, amt: 1.0 },
  grassBlade: { scale: 1.8, amt: 0.95 },
  fabric: { scale: 2.6, amt: 0.8 },
  skin: { scale: 3.2, amt: 0.5 },
  hair: { scale: 2.2, amt: 0.8 },
  fur: { scale: 2.6, amt: 0.85 },
  terracotta: { scale: 1.2, amt: 0.9 },
  plastic: { scale: 1.1, amt: 0.7 },
  lampGlow: { scale: 1.6, amt: 0.8 },
};

/**
 * 手绘材质：MeshStandardMaterial + userData.hd（由 messenger.js 的 mseFromMaterial 读走，
 * 在着色器里按世界坐标三平面乘进漫反射）。故意不设 map —— 模型的 UV 指向丢失的图集。
 */
const _matCache = new Map();
export function hdMaterial({ kind = 'plastic', color = 0xcccccc, rough = 0.9, metal = 0, emissive = 0x000000, emissiveIntensity = 1, side }) {
  const key = `${kind}|${color}|${rough}|${metal}|${emissive}|${emissiveIntensity}|${side || 0}`;
  if (_matCache.has(key)) return _matCache.get(key);
  const d = HD_DENSITY[kind] || { scale: 1, amt: 0.8 };
  const m = new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal,
    emissive, emissiveIntensity,
    side: side || THREE.FrontSide,
  });
  m.map = null;
  m.userData.hd = { kind, scale: d.scale, amt: d.amt };
  _matCache.set(key, m);
  return m;
}
