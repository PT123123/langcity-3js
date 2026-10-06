// props.js — 各物件构建函数 buildXxx()（全部程序化几何，无外部资源）
// 约定：局部空间 y 向上、面朝 +z；材质一律 mat(color, bucket, jitterPos?)，
// jitterPos=null 时由 town 合并阶段按世界坐标补抖动。
import * as THREE from 'three';
import { mat, plainToonMaterial, C } from './materials.js';

// ---------- 小工具 ----------
function box(w, h, d, color, bucket, x = 0, y = 0, z = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, bucket));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}
function cyl(rt, rb, h, color, bucket, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, bucket));
  m.position.set(x, y, z);
  return m;
}
function sph(r, color, bucket, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2)), mat(color, bucket));
  m.position.set(x, y, z);
  return m;
}
/** 三棱柱（双坡屋顶） */
function gableRoof(w, h, d, color, bucket, y = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  const m = new THREE.Mesh(geo, mat(color, bucket));
  m.position.y = y;
  return m;
}
/** Canvas 文字贴图（招牌/看板用，规格允许 canvas 程序生成） */
const _textTexCache = new Map();
export function textTexture(text, { bg = '#f7f3ea', fg = '#4a4238', w = 256, h = 128, vertical = false, font = '700 72px "Noto Sans JP", sans-serif' } = {}) {
  const key = text + bg + fg + w + h + vertical;
  if (_textTexCache.has(key)) return _textTexCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (vertical) {
    const chars = [...text];
    const step = h / (chars.length + 0.6);
    chars.forEach((ch, i) => ctx.fillText(ch, w / 2, step * (i + 0.8), w * 0.82));
  } else {
    ctx.fillText(text, w / 2, h / 2, w * 0.86);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _textTexCache.set(key, tex);
  return tex;
}
function textPlate(text, w, h, opts, bucket = 'wood') {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.05),
    [
      mat(0x8a7a62, bucket), mat(0x8a7a62, bucket),
      mat(0x8a7a62, bucket), mat(0x8a7a62, bucket),
      plainToonMaterial({ map: textTexture(text, opts) }),
      mat(0x8a7a62, bucket),
    ]
  );
  return m;
}

// ---------- 建筑 ----------
const WALLS = [C.wallWhite, C.wallGray, C.wallYellow, C.wallBrick, 0xf6e8d8];
// messenger 屋顶色：灰粉 mauve 主导，配灰蓝/鼠尾草绿
const ROOFS = [C.roofMauve, C.roofBlue, C.roofGreen, 0xb9a89a, C.roofPink];

export function buildHouse(v = 0) {
  const g = new THREE.Group();
  const wall = WALLS[v % WALLS.length];
  const roof = ROOFS[v % ROOFS.length];
  const W = 3.2, D = 2.8, H = 2.1;
  g.add(box(W, H, D, wall, 'concrete', 0, H / 2, 0));
  // 屋檐基座
  g.add(box(W + 0.3, 0.16, D + 0.3, C.woodDark, 'wood', 0, H + 0.08, 0));
  g.add(gableRoof(W + 0.7, 1.0, D + 0.7, roof, 'tile', H + 0.16));
  // 门 + 窗
  g.add(box(0.62, 1.05, 0.06, C.woodDark, 'wood', -0.75, 0.53, D / 2 + 0.02));
  g.add(box(0.56, 0.6, 0.05, C.glassDark, 'glass', 0.6, 1.0, D / 2 + 0.02));
  g.add(box(0.6, 0.55, 0.05, C.glassDark, 'glass', -0.8, 1.35, D / 2 + 0.02));
  g.add(box(0.6, 0.55, 0.05, C.glassDark, 'glass', 0.55, 1.35, D / 2 + 0.02));
  g.add(box(0.05, 0.55, 0.8, C.glassDark, 'glass', W / 2 + 0.02, 1.1, -0.3));
  // 烟囱
  g.add(box(0.28, 0.55, 0.28, WALLS[(v + 2) % WALLS.length], 'concrete', W / 2 - 0.5, H + 1.0, -0.6));
  // 门牌
  const plate = textPlate('すずき', 0.34, 0.16, { bg: '#f2ecdc', fg: '#4a4238', w: 128, h: 64, font: '500 34px "Noto Sans JP"' });
  plate.position.set(-0.75, 1.18, D / 2 + 0.05);
  g.add(plate);
  return g;
}

export function buildMansion(v = 0) {
  const g = new THREE.Group();
  const wall = v % 2 ? 0xd6cfc2 : C.wallGray;
  const W = 4.2, D = 3.2, H = 4.6;
  g.add(box(W, H, D, wall, 'concrete', 0, H / 2, 0));
  g.add(box(W + 0.2, 0.3, D + 0.2, C.roofDark, 'concrete', 0, H + 0.12, 0)); // 女儿墙
  // 窗阵
  for (let fl = 0; fl < 3; fl++) {
    for (let i = 0; i < 3; i++) {
      g.add(box(0.66, 0.72, 0.05, C.glassDark, 'glass', -1.3 + i * 1.3, 1.15 + fl * 1.35, D / 2 + 0.02));
      g.add(box(0.05, 0.72, 0.9, C.glassDark, 'glass', W / 2 + 0.02, 1.15 + fl * 1.35, -0.5 + (i % 2) * 1.4));
    }
  }
  // 入口
  g.add(box(1.0, 1.3, 0.1, 0x6b6055, 'wood', 0, 0.65, D / 2 + 0.03));
  g.add(box(1.5, 0.1, 0.7, C.concrete ?? 0xb5ab9c, 'concrete', 0, 0.05, D / 2 + 0.35));
  // 阳台栏杆
  for (let fl = 1; fl < 3; fl++) {
    g.add(box(1.9, 0.05, 0.05, C.galvanized ?? 0x9aa0a4, 'galvanized', 1.35, 1.6 + fl * 1.35 - 0.7, D / 2 + 0.18));
  }
  // 空调外机
  g.add(box(0.5, 0.4, 0.3, 0xb8bdbf, 'galvanized', -W / 2 + 0.6, 1.0, D / 2 + 0.12));
  return g;
}

export function buildStation() {
  const g = new THREE.Group();
  const W = 6.4, D = 3.6, H = 2.6;
  g.add(box(W, H, D, 0xe6ddcc, 'concrete', 0, H / 2, 0));
  g.add(gableRoof(W + 0.8, 1.15, D + 0.8, C.roofDark, 'tile', H + 0.12));
  // 大窗 + 拱门
  g.add(box(1.3, 1.3, 0.06, C.glassDark, 'glass', -1.8, 1.05, D / 2 + 0.03));
  g.add(box(1.3, 1.3, 0.06, C.glassDark, 'glass', 1.8, 1.05, D / 2 + 0.03));
  g.add(box(1.6, 1.5, 0.08, 0x5f564c, 'wood', 0, 0.75, D / 2 + 0.04));
  // 时钟（钟面用 canvas；CylinderGeometry 材质序 = [侧面, 顶盖, 底盖]）
  const clock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.08, 20),
    [
      mat(0xece5d8, 'plasticWhite'),
      plainToonMaterial({ map: textTexture('駅', { bg: '#3f4648', fg: '#f2ecdc', w: 128, h: 128, font: '700 84px "Noto Serif JP"' }) }),
      mat(0xece5d8, 'plasticWhite'),
    ]
  );
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, H + 0.75, D / 2 - 0.2 + 0.06);
  g.add(clock);
  // 站名牌（灯箱）
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.08), [
    mat(0x35404d, 'plasticWhite'), mat(0x35404d, 'plasticWhite'),
    mat(0x35404d, 'plasticWhite'), mat(0x35404d, 'plasticWhite'),
    new THREE.MeshBasicMaterial({ map: textTexture('まちまえ駅', { bg: '#f0e8d0', fg: '#35404d', w: 512, h: 128, font: '700 66px "Noto Sans JP"' }) }),
    mat(0x35404d, 'plasticWhite'),
  ]);
  sign.position.set(0, 2.1, D / 2 + 0.08);
  g.add(sign);
  // 长椅 + 站台矮墙
  g.add(box(2.6, 0.09, 0.5, C.wood, 'wood', -1.6, 0.42, D / 2 + 0.75));
  g.add(box(2.6, 0.5, 0.08, C.wood, 'wood', -1.6, 0.25, D / 2 + 0.96));
  return g;
}

export function buildKonbini() {
  const g = new THREE.Group();
  const W = 4.4, D = 3.4, H = 2.7;
  g.add(box(W, H, D, 0xe8e2d4, 'concrete', 0, H / 2, 0));
  g.add(box(W + 0.15, 0.22, D + 0.15, 0x8f8a80, 'concrete', 0, H + 0.05, 0));
  // 玻璃橱窗带
  g.add(box(W - 0.7, 1.5, 0.06, C.glassDark, 'glass', 0, 1.05, D / 2 + 0.03));
  g.add(box(0.9, 1.8, 0.06, 0xd8d3c8, 'plasticWhite', W / 2 - 0.28, 0.9, D / 2 + 0.03)); // 门
  // 招牌灯箱（发光条）
  const band = box(W + 0.1, 0.62, 0.14, 0x2f7d4f, 'lampbox', 0, H + 0.32, D / 2 - 0.05);
  g.add(band);
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.4, 0.5),
    new THREE.MeshBasicMaterial({ map: textTexture('コンビニ', { bg: '#2f7d4f', fg: '#f7f3ea', w: 512, h: 96, font: '700 58px "Noto Sans JP"' }), transparent: false })
  );
  logo.position.set(0, H + 0.33, D / 2 + 0.03);
  g.add(logo);
  // 色条装饰
  g.add(box(W + 0.1, 0.08, 0.16, 0xe86a5e, 'lampbox', 0, H + 0.62, D / 2 - 0.05));
  return g;
}

export function buildRamen() {
  const g = new THREE.Group();
  const W = 3.2, D = 3.0, H = 2.3;
  g.add(box(W, H, D, 0xe0d2b8, 'concrete', 0, H / 2, 0));
  g.add(gableRoof(W + 0.5, 0.7, D + 0.5, 0x8a5a4a, 'tile', H + 0.1));
  // 暖帘（朱红短帘）
  for (let i = 0; i < 4; i++) {
    const noren = box(0.42, 0.55, 0.03, C.vermillion, 'plasticRed', -0.8 + i * 0.53, 1.45, D / 2 + 0.06);
    noren.rotation.x = 0.06;
    g.add(noren);
  }
  g.add(box(W - 0.4, 0.9, 0.06, C.glassDark, 'glass', 0, 0.62, D / 2 + 0.03));
  // 灯笼
  const lantern = cyl(0.16, 0.16, 0.42, 0xe8b08a, 'lamp', 1.1, 1.62, D / 2 + 0.3);
  g.add(lantern);
  g.add(cyl(0.05, 0.05, 0.14, 0x3a352e, 'wood', 1.1, 1.9, D / 2 + 0.3));
  // 竖招牌
  const sign = textPlate('ラーメン', 0.5, 1.5, { bg: '#243846', fg: '#f2ecdc', w: 128, h: 384, vertical: true, font: '700 66px "Noto Serif JP"' }, 'wood');
  sign.position.set(-1.75, 1.35, D / 2 + 0.12);
  g.add(sign);
  return g;
}

export function buildCafe() {
  const g = new THREE.Group();
  const W = 3.4, D = 3.0, H = 2.5;
  g.add(box(W, H, D, 0xdccdb8, 'concrete', 0, H / 2, 0));
  g.add(gableRoof(W + 0.5, 0.75, D + 0.5, C.roofBlue, 'tile', H + 0.1));
  g.add(box(1.4, 1.1, 0.06, C.glassDark, 'glass', -0.7, 1.0, D / 2 + 0.03));
  g.add(box(0.8, 1.6, 0.06, 0x7a6a52, 'wood', 0.8, 0.8, D / 2 + 0.03));
  // 雨棚
  const awning = box(W - 0.3, 0.06, 0.8, 0xb98a6e, 'plasticRed', 0, 1.75, D / 2 + 0.42);
  awning.rotation.x = 0.32;
  g.add(awning);
  // 座位：桌 + 遮阳伞
  const table = cyl(0.32, 0.32, 0.05, 0xf0ead8, 'plasticWhite', 1.9, 0.5, 1.3);
  g.add(table);
  g.add(cyl(0.035, 0.035, 0.5, 0x8a7f70, 'metalDark', 1.9, 0.25, 1.3));
  const umbrella = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.3, 8), mat(0xc96a5e, 'plasticRed'));
  umbrella.position.set(1.9, 1.05, 1.3);
  g.add(umbrella);
  g.add(cyl(0.025, 0.025, 0.9, 0x8a7f70, 'metalDark', 1.9, 0.55, 1.3));
  // 招牌
  const sign = textPlate('喫茶', 0.7, 0.36, { bg: '#f0e8d0', fg: '#6b4a3a', w: 256, h: 128, font: '700 64px "Noto Serif JP"' });
  sign.position.set(-0.7, 2.15, D / 2 + 0.06);
  g.add(sign);
  return g;
}

export function buildSupermarket() {
  const g = new THREE.Group();
  const W = 6.0, D = 4.2, H = 3.0;
  g.add(box(W, H, D, 0xe4dcc8, 'concrete', 0, H / 2, 0));
  g.add(box(W + 0.2, 0.25, D + 0.2, 0x9a948a, 'concrete', 0, H + 0.06, 0));
  g.add(box(W - 1.2, 1.7, 0.06, C.glassDark, 'glass', -0.6, 1.1, D / 2 + 0.03));
  g.add(box(1.0, 1.9, 0.06, 0xd8d3c8, 'plasticWhite', 1.8, 0.95, D / 2 + 0.03));
  const band = box(W + 0.1, 0.7, 0.14, 0xc94f4f, 'lampbox', 0, H + 0.38, D / 2 - 0.05);
  g.add(band);
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.6, 0.55),
    new THREE.MeshBasicMaterial({ map: textTexture('スーパーまるい', { bg: '#c94f4f', fg: '#f7f3ea', w: 640, h: 96, font: '700 54px "Noto Sans JP"' }) })
  );
  logo.position.set(0, H + 0.39, D / 2 + 0.03);
  g.add(logo);
  // 购物篮堆
  g.add(box(0.6, 0.3, 0.45, 0x8fa8b8, 'plasticWhite', -W / 2 + 0.6, 0.15, D / 2 + 0.5));
  return g;
}

export function buildPostOffice() {
  const g = new THREE.Group();
  const W = 3.6, D = 3.0, H = 2.8;
  g.add(box(W, H, D, 0xd8c8b0, 'concrete', 0, H / 2, 0));
  g.add(gableRoof(W + 0.5, 0.8, D + 0.5, C.roofBlue, 'tile', H + 0.1));
  g.add(box(0.9, 1.4, 0.06, 0x6b6055, 'wood', 0, 0.7, D / 2 + 0.03));
  g.add(box(0.8, 0.7, 0.05, C.glassDark, 'glass', -1.0, 1.15, D / 2 + 0.03));
  // 〒 圆形红标
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 24), mat(C.vermillion, 'plasticRed'));
  ring.position.set(1.0, 1.9, D / 2 + 0.04);
  g.add(ring);
  const bar = box(0.4, 0.09, 0.03, C.vermillion, 'plasticRed', 1.0, 1.9, D / 2 + 0.07);
  g.add(bar);
  return g;
}

export function buildSchool() {
  const g = new THREE.Group();
  const W = 8.0, D = 3.8, H = 4.4;
  g.add(box(W, H, D, 0xe8e0cf, 'concrete', 0, H / 2, 0));
  g.add(box(W + 0.2, 0.3, D + 0.2, 0x9a948a, 'concrete', 0, H + 0.08, 0));
  for (let fl = 0; fl < 2; fl++) {
    for (let i = 0; i < 5; i++) {
      g.add(box(0.8, 0.9, 0.06, C.glassDark, 'glass', -3.0 + i * 1.5, 1.3 + fl * 1.7, D / 2 + 0.03));
    }
  }
  g.add(box(1.2, 1.6, 0.1, 0x6b6055, 'wood', 0, 0.8, D / 2 + 0.05));
  // 旗杆 + 国旗
  g.add(cyl(0.03, 0.04, 3.0, 0xc9c4ba, 'metalDark', -W / 2 - 0.8, 1.5, D / 2 + 0.6));
  const flag = box(0.66, 0.42, 0.02, 0xf2ecdc, 'plasticWhite', -W / 2 - 0.8 + 0.36, 2.7, D / 2 + 0.6);
  g.add(flag);
  g.add(box(0.2, 0.2, 0.022, C.vermillion, 'plasticRed', -W / 2 - 0.8 + 0.2, 2.7, D / 2 + 0.612));
  // 校门矮柱
  g.add(box(0.3, 0.8, 0.3, 0xcfc8b8, 'concrete', -2.2, 0.4, D / 2 + 1.6));
  g.add(box(0.3, 0.8, 0.3, 0xcfc8b8, 'concrete', 2.2, 0.4, D / 2 + 1.6));
  return g;
}

export function buildHospital() {
  const g = new THREE.Group();
  const W = 5.2, D = 3.8, H = 4.2;
  g.add(box(W, H, D, 0xf0ece2, 'concrete', 0, H / 2, 0));
  g.add(box(W + 0.2, 0.25, D + 0.2, 0xb8b2a6, 'concrete', 0, H + 0.06, 0));
  for (let fl = 0; fl < 2; fl++) {
    for (let i = 0; i < 4; i++) {
      g.add(box(0.7, 0.8, 0.06, C.glassDark, 'glass', -1.7 + i * 1.15, 1.25 + fl * 1.65, D / 2 + 0.03));
    }
  }
  g.add(box(1.4, 1.5, 0.1, 0xd8d3c8, 'plasticWhite', 0, 0.75, D / 2 + 0.05));
  // 红十字
  g.add(box(0.5, 0.16, 0.06, C.vermillion, 'plasticRed', 0, H + 0.55, D / 2 - 0.05));
  g.add(box(0.16, 0.5, 0.06, C.vermillion, 'plasticRed', 0, H + 0.55, D / 2 - 0.05));
  return g;
}

export function buildBank() {
  const g = new THREE.Group();
  const W = 4.4, D = 3.4, H = 3.2;
  g.add(box(W, H, D, 0xe4ddcc, 'concrete', 0, H / 2, 0));
  // 山形屋顶楣 + 柱廊
  g.add(gableRoof(W + 0.6, 0.7, D + 0.6, C.roofDark, 'tile', H + 0.05));
  for (let i = 0; i < 4; i++) {
    g.add(cyl(0.14, 0.16, H - 0.4, 0xf0ead8, 'concrete', -1.5 + i, (H - 0.4) / 2, D / 2 + 0.25, 10));
  }
  g.add(box(1.1, 1.5, 0.08, 0x5f564c, 'wood', 0, 0.75, D / 2 + 0.02));
  g.add(box(W - 0.6, 0.35, 0.3, 0xd0c8b4, 'concrete', 0, 0.18, D / 2 + 0.5)); // 台阶
  return g;
}

export function buildLibrary() {
  const g = new THREE.Group();
  const W = 5.0, D = 3.4, H = 3.0;
  g.add(box(W, H, D, 0xcfb896, 'concrete', 0, H / 2, 0));
  g.add(gableRoof(W + 0.6, 0.85, D + 0.6, C.roofGreen, 'tile', H + 0.08));
  g.add(box(W - 1.4, 1.2, 0.06, C.glassDark, 'glass', 0, 1.15, D / 2 + 0.03));
  g.add(box(1.0, 1.5, 0.08, 0x6b6055, 'wood', 0, 0.75, D / 2 + 0.04));
  for (let i = 0; i < 2; i++) {
    g.add(cyl(0.13, 0.15, H - 0.5, 0xe0d8c4, 'concrete', -1.6 + i * 3.2, (H - 0.5) / 2, D / 2 + 0.22, 10));
  }
  // 书本雕塑
  for (let i = 0; i < 3; i++) {
    g.add(box(0.42, 0.1, 0.3, [0xc96a5e, 0x5e7d96, 0x8fa06a][i], 'plasticWhite', 1.6, 0.4 + i * 0.11, D / 2 + 0.5, i * 0.4));
  }
  return g;
}

export function buildShrine() {
  const g = new THREE.Group();
  // 鸟居
  const T = C.vermillion;
  g.add(cyl(0.09, 0.11, 1.9, T, 'plasticRed', -0.85, 0.95, 1.4, 10));
  g.add(cyl(0.09, 0.11, 1.9, T, 'plasticRed', 0.85, 0.95, 1.4, 10));
  g.add(box(2.3, 0.16, 0.22, T, 'plasticRed', 0, 1.95, 1.4));
  g.add(box(2.0, 0.12, 0.16, T, 'plasticRed', 0, 1.6, 1.4));
  // 拝殿（小屋）
  const W = 2.6, D = 2.2, H = 1.7;
  g.add(box(W, H, D, 0xd8cbb0, 'wood', 0, H / 2, -0.6));
  g.add(gableRoof(W + 0.5, 0.7, D + 0.6, 0x6a7a6e, 'tile', H + 0.05));
  g.add(box(0.6, 0.9, 0.05, 0x4a4038, 'wood', 0, 0.45, -0.6 + D / 2 + 0.03));
  // 石灯笼 ×2
  for (const s of [-1, 1]) {
    const lx = s * 1.5, lz = 0.4;
    g.add(cyl(0.1, 0.14, 0.25, 0xb8b0a0, 'concrete', lx, 0.12, lz, 8));
    g.add(cyl(0.06, 0.06, 0.5, 0xb8b0a0, 'concrete', lx, 0.5, lz, 8));
    g.add(box(0.34, 0.24, 0.34, 0xc4bcac, 'concrete', lx, 0.85, lz));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 4), mat(0xb0a898, 'concrete'));
    cap.position.set(lx, 1.06, lz);
    g.add(cap);
  }
  return g;
}

// ---------- 街具 ----------
export function buildVending(v = 0) {
  const g = new THREE.Group();
  const body = v % 2 ? 0x3563a8 : C.vermillion;
  g.add(box(0.92, 1.72, 0.72, body, 'plasticRed', 0, 0.86, 0));
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshBasicMaterial({
    map: textTexture('ドリンク', { bg: v % 2 ? '#2c4f88' : '#a83c3c', fg: '#f7f3ea', w: 256, h: 320, font: '700 52px "Noto Sans JP"' }),
  }));
  front.position.set(0, 1.18, 0.365);
  g.add(front);
  g.add(box(0.8, 0.42, 0.03, 0x1e2830, 'plasticWhite', 0, 0.42, 0.365)); // 取物口
  g.add(box(0.86, 0.06, 0.76, 0x242a30, 'metalDark', 0, 1.78, 0));
  return g;
}

export function buildStreetlight() {
  const g = new THREE.Group();
  g.add(cyl(0.05, 0.07, 3.0, 0x4a4f54, 'metalDark', 0, 1.5, 0, 10));
  const arm = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 8, 16, Math.PI / 2), mat(0x4a4f54, 'metalDark'));
  arm.position.set(0.5, 3.0, 0);
  arm.rotation.z = Math.PI / 2;
  g.add(arm);
  const capCone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 10), mat(0x3a4046, 'metalDark'));
  capCone.position.set(1.0, 2.94, 0);
  g.add(capCone);
  g.add(sph(0.09, 0xfff2d8, 'lamp', 1.0, 2.86, 0, 10));
  return g;
}

export function buildPole() {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.09, 5.0, 0x5a5f63, 'metalDark', 0, 2.5, 0, 10));
  g.add(box(1.5, 0.07, 0.07, 0x5a5f63, 'metalDark', 0, 4.3, 0));
  g.add(box(1.1, 0.06, 0.06, 0x5a5f63, 'metalDark', 0, 3.9, 0));
  for (const x of [-0.7, -0.35, 0.35, 0.7]) {
    g.add(cyl(0.03, 0.03, 0.1, 0xd8d4cc, 'plasticWhite', x, 4.38, 0, 8));
  }
  g.add(cyl(0.16, 0.16, 0.5, 0x9aa0a4, 'galvanized', 0.24, 1.6, 0, 10)); // 变压器
  return g;
}

export function buildTrash() {
  const g = new THREE.Group();
  g.add(cyl(0.24, 0.2, 0.62, 0x9aa0a4, 'galvanized', 0, 0.31, 0, 12));
  g.add(cyl(0.26, 0.26, 0.05, 0x7d8286, 'galvanized', 0, 0.64, 0, 12));
  g.add(box(0.3, 0.16, 0.02, 0x2a2e32, 'metalDark', 0, 0.56, 0.24));
  return g;
}

export function buildMailbox() {
  const g = new THREE.Group();
  g.add(cyl(0.035, 0.035, 0.9, 0x4a4f54, 'metalDark', 0, 0.45, 0, 8));
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.3), mat(C.vermillion, 'plasticRed'));
  body.position.set(0, 1.02, 0);
  g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 12, 1, false, 0, Math.PI), mat(C.vermillion, 'plasticRed'));
  top.rotation.z = Math.PI / 2;
  top.rotation.y = Math.PI / 2;
  top.position.set(0, 1.19, 0);
  g.add(top);
  g.add(box(0.26, 0.03, 0.04, 0x2a2e32, 'metalDark', 0, 1.1, 0.16));
  return g;
}

export function buildBench() {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) g.add(box(1.5, 0.05, 0.14, C.wood, 'wood', 0, 0.4, -0.12 + i * 0.26));
  for (let i = 0; i < 2; i++) g.add(box(1.5, 0.14, 0.05, C.wood, 'wood', 0, 0.55 + i * 0.2, 0.26));
  for (const s of [-1, 1]) {
    g.add(box(0.06, 0.4, 0.5, 0x4a4f54, 'metalDark', s * 0.62, 0.2, 0.05));
    g.add(box(0.06, 0.5, 0.06, 0x4a4f54, 'metalDark', s * 0.62, 0.45, 0.28));
  }
  return g;
}

export function buildSignboard() {
  const g = new THREE.Group();
  g.add(cyl(0.045, 0.05, 2.0, C.woodDark, 'wood', 0, 1.0, 0, 8));
  const texts = ['営業中', 'たばこ', 'お酒'];
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 1.3, 0.08),
    [
      mat(C.woodDark, 'wood'), mat(C.woodDark, 'wood'),
      mat(C.woodDark, 'wood'), mat(C.woodDark, 'wood'),
      new THREE.MeshBasicMaterial({ map: textTexture(texts[0], { bg: '#243846', fg: '#f2ecdc', w: 128, h: 320, vertical: true, font: '700 64px "Noto Serif JP"' }) }),
      mat(C.woodDark, 'wood'),
    ]
  );
  plate.position.set(0, 1.65, 0.06);
  g.add(plate);
  return g;
}

export function buildTrafficLight() {
  const g = new THREE.Group();
  g.add(cyl(0.06, 0.08, 2.6, 0x4a4f54, 'metalDark', 0, 1.3, 0, 10));
  g.add(box(1.6, 0.07, 0.07, 0x4a4f54, 'metalDark', 0.8, 2.6, 0));
  const boxM = box(0.3, 0.8, 0.26, 0x3a4046, 'plasticWhite', 1.5, 2.35, 0);
  g.add(boxM);
  const cols = [0xd85848, 0xe8c060, 0x6ab86a];
  for (let i = 0; i < 3; i++) {
    const light = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), new THREE.MeshBasicMaterial({ color: cols[i] }));
    light.position.set(1.5, 2.62 - i * 0.26, 0.14);
    g.add(light);
  }
  return g;
}

export function buildPhoneBox() {
  const g = new THREE.Group();
  g.add(box(0.8, 2.0, 0.6, 0x4a6a58, 'plasticWhite', 0, 1.0, 0));
  g.add(box(0.86, 0.1, 0.66, 0x3a5a48, 'plasticWhite', 0, 2.02, 0));
  g.add(box(0.6, 1.2, 0.03, C.glassDark, 'glass', 0, 1.1, 0.3));
  g.add(box(0.34, 0.5, 0.12, 0x8a4a42, 'plasticRed', 0, 1.25, 0.18)); // 电话机
  return g;
}

export function buildHydrant() {
  const g = new THREE.Group();
  g.add(cyl(0.13, 0.15, 0.5, C.vermillion, 'plasticRed', 0, 0.25, 0, 10));
  g.add(sph(0.13, C.vermillion, 'plasticRed', 0, 0.5, 0, 10));
  for (const s of [-1, 1]) g.add(cyl(0.05, 0.05, 0.1, 0xa83c3c, 'plasticRed', s * 0.15, 0.32, 0, 8));
  g.add(cyl(0.04, 0.04, 0.08, 0xa83c3c, 'plasticRed', 0, 0.6, 0, 8));
  return g;
}

export function buildClothesline() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(cyl(0.03, 0.04, 1.7, 0x8a9298, 'galvanized', s * 1.1, 0.85, 0, 8));
    const cross = cyl(0.025, 0.025, 0.5, 0x8a9298, 'galvanized', s * 1.1, 1.62, 0, 8);
    cross.rotation.z = Math.PI / 2;
    g.add(cross);
  }
  const line = cyl(0.008, 0.008, 2.2, 0x6a6458, 'rubber', 0, 1.62, 0.22, 6);
  line.rotation.z = Math.PI / 2;
  g.add(line);
  const cloths = [
    [0xf2ecdc, -0.55, 0.1], [0xe8c9cf, 0.05, -0.08], [0xa8c0cc, 0.6, 0.12],
  ];
  for (const [col, x, rz] of cloths) {
    const cloth = box(0.42, 0.5, 0.015, col, 'plasticWhite', x, 1.35, 0.22);
    cloth.rotation.z = rz;
    cloth.rotation.y = 0.08;
    g.add(cloth);
  }
  return g;
}

export function buildPotted() {
  const g = new THREE.Group();
  g.add(cyl(0.14, 0.1, 0.2, 0xb5705a, 'tile', 0, 0.1, 0, 10));
  const plant = sph(0.16, C.leaf2, 'leaf', 0, 0.3, 0, 10);
  plant.scale.y = 1.15;
  g.add(plant);
  if (Math.random() > 0.5) g.add(sph(0.05, 0xe8b0c0, 'plasticRed', 0.08, 0.42, 0.04, 6));
  return g;
}

export function buildWall() {
  const g = new THREE.Group();
  g.add(box(2.4, 0.75, 0.22, 0xdcd4c2, 'concrete', 0, 0.38, 0));
  g.add(box(2.4, 0.08, 0.3, 0x8d968a, 'tile', 0, 0.79, 0));
  return g;
}

export function buildFence() {
  const g = new THREE.Group();
  g.add(box(2.6, 0.05, 0.05, 0x8a9298, 'galvanized', 0, 0.72, 0));
  g.add(box(2.6, 0.05, 0.05, 0x8a9298, 'galvanized', 0, 0.3, 0));
  for (let i = 0; i < 9; i++) {
    g.add(box(0.04, 0.72, 0.04, 0x9aa2a8, 'galvanized', -1.2 + i * 0.3, 0.36, 0));
  }
  return g;
}

export function buildParkingSign() {
  const g = new THREE.Group();
  g.add(cyl(0.03, 0.035, 1.3, 0x8a9298, 'galvanized', 0, 0.65, 0, 8));
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.04),
    [
      mat(0x4a6a8a, 'plasticWhite'), mat(0x4a6a8a, 'plasticWhite'),
      mat(0x4a6a8a, 'plasticWhite'), mat(0x4a6a8a, 'plasticWhite'),
      new THREE.MeshBasicMaterial({ map: textTexture('P', { bg: '#4a6a8a', fg: '#f2ecdc', w: 128, h: 128, font: '700 92px "Noto Sans JP"' }) }),
      mat(0x4a6a8a, 'plasticWhite'),
    ]
  );
  plate.position.set(0, 1.45, 0);
  g.add(plate);
  return g;
}

export function buildPlazaFlag() {
  const g = new THREE.Group();
  g.add(cyl(0.03, 0.045, 3.4, 0xc9c4ba, 'metalDark', 0, 1.7, 0, 8));
  g.add(cyl(0.16, 0.2, 0.12, 0xb0a898, 'concrete', 0, 0.06, 0, 10));
  const flag = box(0.7, 0.44, 0.02, C.vermillion, 'plasticRed', 0.38, 3.0, 0);
  flag.rotation.y = 0.15;
  g.add(flag);
  return g;
}

export function buildFountain() {
  const g = new THREE.Group();
  g.add(cyl(1.15, 1.25, 0.4, 0xcfc8b8, 'concrete', 0, 0.2, 0, 20));
  g.add(cyl(1.0, 1.0, 0.1, 0x6aa8ac, 'paving', 0, 0.38, 0, 20)); // 水面
  g.add(cyl(0.12, 0.16, 0.8, 0xc4bcac, 'concrete', 0, 0.6, 0, 10));
  g.add(cyl(0.3, 0.06, 0.16, 0xc4bcac, 'concrete', 0, 1.05, 0, 12));
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 8), mat(0x9fd0d4, 'glass'));
  jet.position.set(0, 1.35, 0);
  g.add(jet);
  return g;
}

export function buildFlowerbed() {
  const g = new THREE.Group();
  g.add(box(1.4, 0.3, 1.0, C.woodDark, 'wood', 0, 0.15, 0));
  g.add(box(1.2, 0.1, 0.8, 0x5a4a3a, 'rubber', 0, 0.3, 0)); // 土
  const cols = [0xe8b0c0, 0xf0d090, 0xf2ecdc, 0xd88a94];
  for (let i = 0; i < 8; i++) {
    const x = -0.5 + (i % 4) * 0.33, z = i < 4 ? -0.2 : 0.2;
    g.add(sph(0.055, cols[i % 4], 'plasticRed', x, 0.4, z, 6));
    g.add(cyl(0.012, 0.012, 0.12, C.leaf3, 'leafDark', x, 0.34, z, 5));
  }
  return g;
}

// ---------- 植物 ----------
export function buildTree(v = 0, s = 1) {
  const g = new THREE.Group();
  const trunkH = (v === 1 ? 1.3 : 0.95) * s;
  g.add(cyl(0.09 * s, 0.14 * s, trunkH, C.wood, 'wood', 0, trunkH / 2, 0, 8));
  const leafCols = [C.leaf, C.leaf2, C.leaf3];
  const base = leafCols[v % 3];
  if (v === 0) {
    g.add(sph(0.62 * s, base, 'leaf', 0, trunkH + 0.35 * s, 0, 12));
    g.add(sph(0.45 * s, base, 'leaf', 0.4 * s, trunkH + 0.1 * s, 0.15 * s, 10));
    g.add(sph(0.4 * s, C.leaf3, 'leaf', -0.38 * s, trunkH + 0.15 * s, -0.1 * s, 10));
  } else if (v === 1) {
    const c = sph(0.5 * s, base, 'leaf', 0, trunkH + 0.55 * s, 0, 12);
    c.scale.set(0.85, 1.45, 0.85);
    g.add(c);
    g.add(sph(0.34 * s, C.leaf2, 'leaf', 0.25 * s, trunkH + 0.3 * s, 0.1 * s, 10));
  } else {
    const c = sph(0.75 * s, base, 'leaf', 0, trunkH + 0.25 * s, 0, 12);
    c.scale.set(1.2, 0.62, 1.2);
    g.add(c);
    g.add(sph(0.4 * s, C.leaf3, 'leaf', 0.45 * s, trunkH + 0.4 * s, 0.2 * s, 10));
  }
  return g;
}

export function buildSakura(s = 1) {
  const g = new THREE.Group();
  const trunkH = 1.05 * s;
  const trunk = cyl(0.08 * s, 0.13 * s, trunkH, 0x8a7260, 'wood', 0, trunkH / 2, 0, 8);
  trunk.rotation.z = 0.06;
  g.add(trunk);
  const branch = cyl(0.05 * s, 0.06 * s, 0.5 * s, 0x8a7260, 'wood', 0.18 * s, trunkH + 0.1 * s, 0, 8);
  branch.rotation.z = -0.7;
  g.add(branch);
  g.add(sph(0.6 * s, C.sakura, 'leaf', 0.1 * s, trunkH + 0.42 * s, 0, 12));
  g.add(sph(0.42 * s, 0xf0d8dc, 'leaf', 0.45 * s, trunkH + 0.2 * s, 0.2 * s, 10));
  g.add(sph(0.4 * s, C.sakura, 'leaf', -0.35 * s, trunkH + 0.25 * s, -0.15 * s, 10));
  g.add(sph(0.3 * s, 0xe8bcc6, 'leaf', 0, trunkH + 0.75 * s, -0.1 * s, 10));
  return g;
}

export function buildFlowers(s = 1) {
  const g = new THREE.Group();
  const cols = [0xe8b0c0, 0xf0d090, 0xf2ecdc, 0xd88a94, 0xc0d0e8];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05, r = 0.1 + (i % 3) * 0.12;
    const x = Math.cos(a) * r * s, z = Math.sin(a) * r * s;
    g.add(cyl(0.012, 0.012, 0.22 * s, C.leaf3, 'leafDark', x, 0.11 * s, z, 5));
    g.add(sph(0.05 * s, cols[i % 5], 'plasticRed', x, 0.24 * s, z, 6));
  }
  return g;
}

export function buildGrassTuft(s = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4, r = 0.09 * s;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, 0.26 * s, 5), mat(i % 2 ? C.leaf2 : C.grassDark, 'leafDark'));
    blade.position.set(Math.cos(a) * r, 0.12 * s, Math.sin(a) * r);
    blade.rotation.z = (i - 1.5) * 0.16;
    g.add(blade);
  }
  return g;
}

// ---------- 车辆 ----------
const CAR_COLS = [0xe8e2d4, 0x9aa8b0, 0x6a7d8a, 0xc99a83];
export function buildCar(v = 0) {
  const g = new THREE.Group();
  const col = CAR_COLS[v % CAR_COLS.length];
  g.add(box(1.5, 0.42, 2.9, col, 'plasticWhite', 0, 0.42, 0));       // 车身
  const cabin = box(1.3, 0.42, 1.5, col, 'plasticWhite', 0, 0.84, -0.1);
  g.add(cabin);
  g.add(box(1.32, 0.3, 1.4, C.glassDark, 'glass', 0, 0.86, -0.1));   // 车窗带
  g.add(box(1.5, 0.08, 0.3, 0xd8d3c8, 'plasticWhite', 0, 0.32, 1.32)); // 保险杠
  for (const [x, z] of [[-0.68, 0.95], [0.68, 0.95], [-0.68, -0.95], [0.68, -0.95]]) {
    const wheel = cyl(0.26, 0.26, 0.16, 0x2a2c2e, 'rubber', x, 0.26, z, 14);
    wheel.rotation.z = Math.PI / 2;
    g.add(wheel);
    const hub = cyl(0.1, 0.1, 0.17, 0xc9c4ba, 'galvanized', x, 0.26, z, 10);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
  }
  for (const s of [-1, 1]) g.add(box(0.28, 0.12, 0.06, 0xf5ead0, 'lamp', s * 0.5, 0.5, 1.46));
  g.add(box(0.28, 0.1, 0.05, 0xb04838, 'plasticRed', s2(v), 0.5, -1.47));
  return g;
}
function s2(v) { return (v % 2 ? 0.5 : -0.5); }

export function buildBicycle(v = 0) {
  const g = new THREE.Group();
  const frame = v % 2 ? 0x8a4a42 : 0x4a5a6a;
  for (const x of [-0.52, 0.52]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.028, 8, 20), mat(0x2a2c2e, 'rubber'));
    w.position.set(x, 0.24, 0);
    w.rotation.y = Math.PI / 2;
    g.add(w);
  }
  g.add(box(0.04, 0.04, 0.7, frame, 'metalDark', 0, 0.42, 0));
  g.add(box(0.04, 0.42, 0.04, frame, 'metalDark', 0.05, 0.45, 0.18));
  g.add(box(0.04, 0.4, 0.04, frame, 'metalDark', 0.05, 0.45, -0.22));
  g.add(box(0.5, 0.03, 0.03, frame, 'metalDark', 0, 0.64, 0.42));
  g.add(box(0.24, 0.04, 0.1, 0x2a2c2e, 'rubber', -0.1, 0.68, -0.28)); // 车座
  g.add(box(0.03, 0.24, 0.03, 0x8a9298, 'galvanized', 0, 0.56, 0.42));
  return g;
}

// ---------- 动物 ----------
export function buildDog(v = 0) {
  const g = new THREE.Group();
  const col = v % 2 ? 0xc9a878 : 0xe8e0d0;
  const body = sph(0.14, col, 'plasticWhite', 0, 0.24, 0, 10);
  body.scale.set(1, 0.9, 1.7);
  g.add(body);
  g.add(sph(0.1, col, 'plasticWhite', 0, 0.32, 0.2, 10));
  g.add(sph(0.045, col, 'plasticWhite', 0, 0.3, 0.28, 8)); // 吻
  g.add(sph(0.02, 0x35302a, 'plasticWhite', 0, 0.32, 0.32, 6));
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 6), mat(col, 'plasticWhite'));
    ear.position.set(s * 0.05, 0.4, 0.18);
    g.add(ear);
  }
  const tail = cyl(0.02, 0.03, 0.18, col, 'plasticWhite', 0, 0.32, -0.24, 6);
  tail.rotation.x = -0.8;
  g.add(tail);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    g.add(cyl(0.025, 0.02, 0.16, col, 'plasticWhite', sx * 0.07, 0.08, sz * 0.1, 6));
  }
  return g;
}

export function buildCatNpc(v = 0) {
  const g = new THREE.Group();
  const col = v % 2 ? 0x9a8a76 : 0xd8d0c0;
  const body = sph(0.11, col, 'plasticWhite', 0, 0.17, 0, 10);
  body.scale.set(1, 0.9, 1.6);
  g.add(body);
  g.add(sph(0.085, col, 'plasticWhite', 0, 0.28, 0.12, 10));
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.055, 6), mat(col, 'plasticWhite'));
    ear.position.set(s * 0.04, 0.36, 0.1);
    g.add(ear);
  }
  const tail = cyl(0.016, 0.02, 0.24, col, 'plasticWhite', 0, 0.24, -0.18, 6);
  tail.rotation.x = -1.0;
  g.add(tail);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    g.add(cyl(0.02, 0.016, 0.1, col, 'plasticWhite', sx * 0.05, 0.05, sz * 0.08, 6));
  }
  return g;
}

export function buildBird(v = 0) {
  const g = new THREE.Group();
  const col = v % 2 ? 0x8a7a66 : 0x9aa2a8;
  const body = sph(0.06, col, 'plasticWhite', 0, 0.08, 0, 8);
  body.scale.set(1, 0.95, 1.35);
  g.add(body);
  g.add(sph(0.04, col, 'plasticWhite', 0, 0.14, 0.05, 8));
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.035, 6), mat(0xd8a050, 'plasticRed'));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.135, 0.095);
  g.add(beak);
  const tail = box(0.03, 0.015, 0.08, col, 'plasticWhite', 0, 0.08, -0.09);
  tail.rotation.x = 0.3;
  g.add(tail);
  return g;
}

// ---------- NPC（chibi 比例：大头圆身、手脚齐全、贴合 messenger 风格） ----------
const SKIN = [0xf4dabb, 0xecd0b2, 0xf6dfc2, 0xe8c8a4];
const HAIR = [0x4a3a2c, 0x6a523c, 0x9a928c, 0x2e2c34, 0x7a5c48];
const CLOTHES = [0xd88a94, 0x9ab2c4, 0x9cb996, 0xd8c290, 0xb2a2c8, 0xc98a72, 0x8fa4b8, 0xe8d4b4];

// v%5：0=女（裙+双髻） 1=短发男 2=小孩(×0.72) 3=草帽村民 4=婴儿(×0.5)
export function buildNpc(v = 0) {
  const g = new THREE.Group();
  const mod = v % 5;
  const skin = SKIN[v % SKIN.length];
  const hair = HAIR[(v + (mod === 4 ? 2 : 0)) % HAIR.length];
  const cloth = CLOTHES[v % CLOTHES.length];
  const s = mod === 2 ? 0.72 : mod === 4 ? 0.5 : 1;

  // —— 鞋（压扁小圆球） ——
  for (const sx of [-1, 1]) {
    const foot = sph(0.05 * s, 0x5a4a3c, 'plasticWhite', sx * 0.052 * s, 0.032 * s, 0.012 * s, 8);
    foot.scale.set(1, 0.55, 1.4);
    g.add(foot);
  }
  // —— 短腿 ——
  for (const sx of [-1, 1]) {
    g.add(cyl(0.034 * s, 0.04 * s, 0.15 * s, 0x50464a, 'plasticWhite', sx * 0.05 * s, 0.19 * s, 0, 8));
  }
  // —— 圆躯干 ——
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.148 * s, 14, 12), mat(cloth, 'plasticWhite'));
  torso.scale.set(0.92, 0.98, 0.8);
  torso.position.y = 0.35 * s;
  g.add(torso);
  if (mod === 0) {
    g.add(cyl(0.125 * s, 0.185 * s, 0.2 * s, cloth, 'plasticWhite', 0, 0.28 * s, 0, 12)); // 裙
  }

  // —— 手臂（胶囊，微外张）+ 肤色手 ——
  const armGeo = new THREE.CapsuleGeometry(0.034 * s, 0.1 * s, 3, 8);
  armGeo.translate(0, -0.07 * s, 0);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, mat(cloth, 'plasticWhite'));
    arm.position.set(sx * 0.152 * s, 0.4 * s, 0.01 * s);
    arm.rotation.z = sx * 0.5;
    g.add(arm);
    g.add(sph(0.036 * s, skin, 'plasticWhite', sx * 0.19 * s, 0.3 * s, 0.01 * s, 8));
  }

  // —— 大头（无脖子，直接砸在躯干上） ——
  const head = new THREE.Group();
  head.position.y = 0.62 * s;
  g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.126 * s, 16, 12), mat(skin, 'plasticWhite'));
  skull.scale.set(1, 0.96, 0.95);
  head.add(skull);
  // 头发：球帽后倾（盖发际线、露脸，绝不悬空）
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.134 * s, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
    mat(hair, 'plasticWhite')
  );
  cap.position.y = 0.006 * s;
  cap.rotation.x = -0.42;   // 后倾：掀开刘海露脸（正号会整个盖死脸）
  head.add(cap);
  if (mod === 0) { // 双髻
    for (const sx of [-1, 1]) g.add(sph(0.05 * s, hair, 'plasticWhite', sx * 0.105 * s, 0.1 * s, -0.03 * s, 8));
  }
  if (mod === 3) { // 草帽
    g.add(cyl(0.19 * s, 0.21 * s, 0.02 * s, 0xdcc294, 'plasticWhite', 0, 0.075 * s, 0, 12));
    const dome = sph(0.105 * s, 0xdcc294, 'plasticWhite', 0, 0.09 * s, 0, 10);
    dome.scale.y = 0.6;
    g.add(dome);
  }
  if (mod === 4) { // 婴儿小绒帽
    const bonnet = new THREE.Mesh(
      new THREE.SphereGeometry(0.138 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
      mat(0xf2ece0, 'plasticWhite')
    );
    bonnet.position.y = 0.028 * s;
    head.add(bonnet);
  }
  // —— 脸：眼珠 + 高光 + 腮红 ——
  for (const sx of [-1, 1]) {
    g.add(sph(0.0135 * s, 0x2e2a26, 'plasticWhite', sx * 0.046 * s, 0.62 * s, 0.104 * s, 8)); // 眼
    g.add(sph(0.0045 * s, 0xffffff, 'plasticWhite', sx * 0.05 * s, 0.627 * s, 0.113 * s, 6)); // 高光
    g.add(sph(0.012 * s, 0xf0a89a, 'plasticWhite', sx * 0.078 * s, 0.585 * s, 0.09 * s, 6)); // 腮红
  }
  return g;
}

export function buildCrossing() {
  // 凸面镜立柱（交差点角标）
  const g = new THREE.Group();
  g.add(cyl(0.035, 0.04, 1.8, 0x8a9298, 'galvanized', 0, 0.9, 0, 8));
  const mirror = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mat(0xcfdde2, 'plasticWhite')
  );
  mirror.rotation.x = Math.PI * 0.62;
  mirror.position.set(0, 1.85, 0);
  g.add(mirror);
  return g;
}

export const BUILDERS = {
  house: buildHouse, mansion: buildMansion, station: buildStation,
  konbini: buildKonbini, ramen: buildRamen, cafe: buildCafe,
  supermarket: buildSupermarket, postOffice: buildPostOffice,
  school: buildSchool, hospital: buildHospital, bank: buildBank,
  library: buildLibrary, shrine: buildShrine,
  vending: buildVending, streetlight: buildStreetlight, pole: buildPole,
  trash: buildTrash, mailbox: buildMailbox, bench: buildBench,
  signboard: buildSignboard, trafficLight: buildTrafficLight,
  phoneBox: buildPhoneBox, hydrant: buildHydrant, clothesline: buildClothesline,
  potted: buildPotted, wall: buildWall, fence: buildFence,
  parkingSign: buildParkingSign, plazaFlag: buildPlazaFlag,
  fountain: buildFountain, flowerbed: buildFlowerbed,
  tree: buildTree, sakura: buildSakura, flowers: buildFlowers,
  grassTuft: buildGrassTuft, car: buildCar, bicycle: buildBicycle,
  dog: buildDog, catNpc: buildCatNpc, bird: buildBird, npc: buildNpc,
  crossing: buildCrossing,
};
