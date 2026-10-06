// 建筑族：全部程序化几何，朝 +Z，底部 y=0（略沉入地面防缝）
// 材质 = 原版 LangCity PBR 贴图三件套（public/tex），按微差取用
import * as THREE from 'three';
import { M, J, PBR, JPBR, signTexture, windowTexture, glowMat } from './materials.js';
import { mergeGeoms } from './planet.js';

function sh(m) { m.castShadow = true; m.receiveShadow = true; return m; }
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  m.position.set(x, y, z);
  return m;
}
function plane(w, h, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  return m;
}

/** 三棱柱双坡屋顶（屋脊沿 X） */
function gableRoof(w, d, h, mat, overhang = 0.18) {
  const W = w / 2 + overhang, D = d / 2 + overhang;
  const shape = new THREE.Shape();
  shape.moveTo(-W, 0); shape.lineTo(W, 0); shape.lineTo(0, h); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: D * 2, bevelEnabled: false });
  geo.translate(0, 0, -D);
  geo.rotateY(0);
  const m = sh(new THREE.Mesh(geo, mat));
  return m;
}

const windowMat = () => glowMat(0xffd9a0, { rough: 0.08, metal: 0.2, map: windowTexture(2, 2), intensity: 1.0 });

function windowPlane(w, h, x, y, z, rotY = 0, wm = null) {
  const p = plane(w, h, wm || windowMat(), x, y, z);
  p.rotation.y = rotY;
  return p;
}

/** 通用墙房：墙 + 双坡顶 + 门 + 窗（墙/屋顶用原版贴图，由 palette 选套） */
function baseHouse({ w = 3.2, d = 3.0, wallH = 2.2, wallTex = 'plaster_paint', roofTex = 'roof_tile', seed = 'h' }) {
  const g = new THREE.Group();
  const wallMat = JPBR(wallTex, { rx: 2, ry: 1.2, rough: 0.9 }, seed + 'w');
  const roofMat = JPBR(roofTex, { rx: 0.55, ry: 0.55, rough: 0.7 }, seed + 'r');
  g.add(box(w, wallH, d, wallMat, 0, wallH / 2 - 0.05, 0));
  const roof = gableRoof(w, d, 0.9, roofMat);
  roof.position.y = wallH - 0.05;
  g.add(roof);
  // 门
  g.add(plane(0.72, 1.5, JPBR('wood_dark', { rx: 1, ry: 1, rough: 0.7 }, seed + 'd'), w * 0.18, 0.75, d / 2 + 0.012));
  // 前后窗
  const wm = windowMat();
  g.add(windowPlane(0.8, 0.7, -w * 0.22, wallH * 0.58, d / 2 + 0.012, 0, wm));
  g.add(windowPlane(0.8, 0.7, -w * 0.22, wallH * 0.58, -d / 2 - 0.012, Math.PI, wm));
  g.add(windowPlane(0.7, 0.7, w / 2 + 0.012, wallH * 0.58, 0, Math.PI / 2, wm));
  return g;
}

/** 民居墙/瓦套装（米白灰泥 / 白木板 / 淡黄 / 砖红）×（陶瓦 / 石板瓦） */
const HOUSE_SETS = [
  { wallTex: 'plaster_paint', roofTex: 'roof_tile' },
  { wallTex: 'wall_white_plank', roofTex: 'roof_slate' },
  { wallTex: 'wall_yellow', roofTex: 'roof_tile' },
  { wallTex: 'red_brick_03', roofTex: 'roof_slate' },
];

export function buildHouse(seed = 'h0') {
  const p = HOUSE_SETS[Math.abs(hash(seed)) % HOUSE_SETS.length];
  const g = baseHouse({ seed, ...p });
  // 烟囱/屋檐小窗点缀
  if (hash(seed) % 2) g.add(box(0.34, 0.7, 0.34, JPBR('brick_warm', { rx: 1, ry: 1, rough: 0.9 }, seed + 'c'), -0.7, 2.6, -0.4));
  finish(g, { kind: 'house', word: 'house', ja: '家', r: 2.6 });
  return g;
}

export function buildMansion(seed = 'm0') {
  const g = new THREE.Group();
  const w = 4.2, d = 3.4, floors = 3, fh = 0.95;
  const wallMat = JPBR('plaster_paint', { rx: 3, ry: 2.4, rough: 0.9 }, seed + 'w');
  g.add(box(w, floors * fh, d, wallMat, 0, floors * fh / 2 - 0.05, 0));
  g.add(box(w + 0.3, 0.16, d + 0.3, JPBR('brick_warm', { rx: 3, ry: 0.5, rough: 0.85 }, seed + 'e'), 0, floors * fh, 0)); // 檐口砖带
  const wm = windowMat();
  for (let f = 0; f < floors; f++) {
    const y = fh * f + fh * 0.55;
    g.add(windowPlane(0.62, 0.55, -1.3, y, d / 2 + 0.012, 0, wm));
    g.add(windowPlane(0.62, 0.55, 0, y, d / 2 + 0.012, 0, wm));
    g.add(windowPlane(0.62, 0.55, 1.3, y, d / 2 + 0.012, 0, wm));
    g.add(windowPlane(0.62, 0.55, 0, y, -d / 2 - 0.012, Math.PI, wm));
  }
  // 入口雨棚 + 门
  g.add(box(1.1, 0.08, 0.6, M(0x7b7772, { rough: 0.8 }), 0, 1.62, d / 2 + 0.3));
  g.add(plane(0.8, 1.4, M(0x6b6258, { rough: 0.6 }), 0, 0.7, d / 2 + 0.012));
  finish(g, { kind: 'mansion', word: 'mansion', ja: 'マンション', r: 3.4 });
  return g;
}

function shopSign(g, text, { x = 0, y = 2.5, z, vertical = false, bg = '#f5efe2', fg = '#4a4238', accent = '#c94f4f', w = 1.7, h = 0.5 } = {}) {
  const tex = signTexture(text, { vertical, bg, fg, accent });
  const sw = vertical ? h : w, shh = vertical ? w : h;
  const board = box(sw, shh, 0.08, M(0xf5efe2, { rough: 0.85 }));
  board.position.set(x, y, z);
  const face = plane(sw - 0.08, shh - 0.08, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 }));
  face.position.set(x, y, z + 0.045);
  board.userData.emissiveMat = face.material;
  g.add(board, face);
  return board;
}

export function buildKonbini(seed = 'k') {
  const g = new THREE.Group();
  const w = 5.2, d = 4.2, h = 2.9;
  g.add(box(w, h, d, JPBR('plaster_paint', { rx: 3, ry: 1.6, rough: 0.86 }, seed), 0, h / 2 - 0.05, 0));
  // 正面玻璃带（暖光）
  const glass = glowMat(0xffd9a0, { rough: 0.1, metal: 0.2, map: windowTexture(5, 2, '#f2d9a8'), intensity: 1.2 });
  g.add(plane(w - 1.2, 1.5, glass, 0, 1.05, d / 2 + 0.015));
  // 条纹雨棚
  const awn = box(w - 0.4, 0.07, 0.9, M(0xc94f4f, { rough: 0.6 }), 0, 2.15, d / 2 + 0.45);
  g.add(awn);
  // 屋顶招牌
  shopSign(g, 'コンビニ', { y: h + 0.35, z: d / 2 - 0.8, accent: '#3f8f5f' });
  g.add(box(0.9, 1.9, 0.06, M(0x6b6258, { rough: 0.6 }), w / 2 - 0.75, 0.95, d / 2 + 0.012)); // 侧门
  finish(g, { kind: 'konbini', word: 'konbini', ja: 'コンビニ', r: 3.8 });
  return g;
}

export function buildRamen(seed = 'r') {
  const g = new THREE.Group();
  const w = 3.8, d = 3.4, h = 2.7;
  g.add(box(w, h, d, JPBR('wall_yellow', { rx: 2, ry: 1.4, rough: 0.88 }, seed), 0, h / 2 - 0.05, 0));
  g.add(gableRoof(w, d, 0.7, JPBR('roof_slate', { rx: 0.55, ry: 0.55, rough: 0.7 }, seed + 'rf'), 0.25).translateX(0).translateY(h - 0.05));
  // 暖帘（和纸质感短帘）
  const norenMat = M(0xf0e8d8, { rough: 0.95, doubleSided: true });
  for (let i = 0; i < 4; i++) {
    const s = plane(0.5, 0.75, norenMat, -0.85 + i * 0.56, 1.85, d / 2 + 0.03);
    g.add(s);
  }
  g.add(box(w - 0.3, 0.06, 0.3, M(0x7b5f4a, { rough: 0.75 }), 0, 2.26, d / 2 + 0.02));
  // 红灯笼
  const lantern = sh(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), glowMat(0xff7a5e, { rough: 0.9, intensity: 1.4 })));
  lantern.scale.y = 1.25;
  lantern.position.set(w / 2 - 0.3, 1.95, d / 2 + 0.28);
  g.add(lantern);
  shopSign(g, 'ラーメン', { y: h + 0.5, z: 0, vertical: true, w: 0.5, h: 1.5, bg: '#3a3430', fg: '#f5efe2' });
  finish(g, { kind: 'ramen', word: 'ramen_shop', ja: 'ラーメン屋', r: 3.2 });
  return g;
}

export function buildCafe(seed = 'c') {
  const g = new THREE.Group();
  const w = 4.2, d = 3.6, h = 2.8;
  g.add(box(w, h, d, JPBR('brick_warm', { rx: 2.2, ry: 1.4, rough: 0.88 }, seed), 0, h / 2 - 0.05, 0));
  const roof = gableRoof(w, d, 0.75, JPBR('roof_tile', { rx: 0.55, ry: 0.55, rough: 0.7 }, seed + 'rf'), 0.25);
  roof.position.y = h - 0.05;
  g.add(roof);
  const wm = windowMat();
  g.add(windowPlane(1.1, 0.9, -1.0, 1.25, d / 2 + 0.012, 0, wm));
  g.add(windowPlane(1.1, 0.9, 1.0, 1.25, d / 2 + 0.012, 0, wm));
  // 棕色雨棚
  const awnMat = JPBR('wood_dark', { rx: 1, ry: 1, rough: 0.72 }, seed + 'awn');
  for (let i = 0; i < 4; i++) {
    const s = plane(0.44, 0.7, awnMat, -1.2 + i * 0.8, 2.05, d / 2 + 0.32);
    s.rotation.x = 0.5;
    g.add(s);
  }
  g.add(plane(0.8, 1.5, M(0x7b5f4a, { rough: 0.7 }), 0, 0.75, d / 2 + 0.012));
  shopSign(g, '喫茶店', { y: h + 0.42, z: d / 2 - 0.5, bg: '#4a3f35', fg: '#f0e4cc' });
  finish(g, { kind: 'cafe', word: 'cafe', ja: '喫茶店', r: 3.4 });
  return g;
}

export function buildStation(seed = 's') {
  const g = new THREE.Group();
  const w = 8, d = 5, h = 3.2;
  g.add(box(w, h, d, JPBR('plaster_paint', { rx: 4.5, ry: 1.8, rough: 0.88 }, seed), 0, h / 2 - 0.05, 0));
  g.add(box(w + 0.5, 0.2, d + 0.5, JPBR('brick_warm', { rx: 4.5, ry: 0.5, rough: 0.85 }, seed + 'e'), 0, h, 0));
  // 大玻璃入口
  const glass = glowMat(0xffd9a0, { rough: 0.1, metal: 0.2, map: windowTexture(6, 2, '#f2d9a8'), intensity: 1.2 });
  g.add(plane(4.6, 1.8, glass, 0, 1.0, d / 2 + 0.015));
  // 站名牌
  shopSign(g, 'みなと駅', { y: h + 0.5, z: 0.4, w: 2.6, h: 0.6, accent: '#3f6f9f' });
  // 时钟
  const clock = plane(0.6, 0.6, clockTexture(), 2.6, h - 0.5, d / 2 + 0.02);
  g.add(clock);
  finish(g, { kind: 'station', word: 'station', ja: '駅', r: 5.4 });
  return g;
}

let _clockTex = null;
function clockTexture() {
  if (_clockTex) return _clockTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5efe2';
  ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4a4238'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64, 30); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(88, 74); ctx.stroke();
  _clockTex = new THREE.CanvasTexture(c);
  _clockTex.colorSpace = THREE.SRGBColorSpace;
  return _clockTex;
}

export function buildSuper(seed = 'su') {
  const g = new THREE.Group();
  const w = 7, d = 5.4, h = 3.4;
  g.add(box(w, h, d, JPBR('plaster_paint', { rx: 4, ry: 2, rough: 0.86 }, seed), 0, h / 2 - 0.05, 0));
  const glass = glowMat(0xffd9a0, { rough: 0.1, metal: 0.2, map: windowTexture(8, 2, '#f2d9a8'), intensity: 1.1 });
  g.add(plane(w - 1.6, 1.7, glass, -0.4, 1.05, d / 2 + 0.015));
  shopSign(g, 'スーパー', { y: h + 0.42, z: 0, w: 2.4, h: 0.62, accent: '#c9603f' });
  g.add(box(w + 0.4, 0.1, 1.2, M(0x9aa8a8, { rough: 0.6 }), 0, 2.3, d / 2 + 0.55));
  finish(g, { kind: 'super', word: 'supermarket', ja: 'スーパー', r: 5 });
  return g;
}

export function buildPostOffice(seed = 'p') {
  const g = new THREE.Group();
  const w = 4.6, d = 4, h = 3;
  g.add(box(w, h, d, JPBR('wall_white_plank', { rx: 2.6, ry: 1.6, rough: 0.88 }, seed), 0, h / 2 - 0.05, 0));
  g.add(box(w + 0.4, 0.18, d + 0.4, JPBR('metal_blue', { rx: 3, ry: 0.4, rough: 0.6, metal: 0.4 }, seed + 'e'), 0, h, 0));
  const wm = windowMat();
  g.add(windowPlane(0.9, 0.8, -1.4, 1.4, d / 2 + 0.012, 0, wm));
  g.add(windowPlane(0.9, 0.8, 1.4, 1.4, d / 2 + 0.012, 0, wm));
  g.add(plane(0.9, 1.5, M(0x6b6258, { rough: 0.6 }), 0, 0.75, d / 2 + 0.012));
  shopSign(g, '郵便局', { y: h + 0.45, z: 0, w: 2, h: 0.55, accent: '#c94f4f' });
  // 局门口小红邮筒
  const post = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.85, 14), M(0xc94f4f, { rough: 0.45, metal: 0.05 })));
  post.position.set(w / 2 - 0.5, 0.43, d / 2 + 0.5);
  g.add(post);
  finish(g, { kind: 'post_office', word: 'post_office', ja: '郵便局', r: 3.8 });
  return g;
}

export function buildShrine(seed = 'sh') {
  const g = new THREE.Group();
  // 拝殿（原版木纹 + 灰瓦）
  const w = 4, d = 3, h = 2.2;
  g.add(box(w, h, d, JPBR('wood_dark', { rx: 2, ry: 1.2, rough: 0.78 }, seed), 0, h / 2 - 0.05, 0));
  const roof = gableRoof(w + 0.6, d + 0.6, 0.9, JPBR('roof_slate', { rx: 0.7, ry: 0.7, rough: 0.75 }, seed + 'rf'), 0.3);
  roof.position.y = h - 0.05;
  g.add(roof);
  // 鸟居
  const toriiMat = M(0xc94f4f, { rough: 0.5, metal: 0.05 });
  const t = new THREE.Group();
  const L = 2.2, H = 1.9;
  const p1 = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, H, 10), toriiMat)); p1.position.set(-L / 2, H / 2, 0);
  const p2 = p1.clone(); p2.position.x = L / 2;
  const beam = sh(new THREE.Mesh(new THREE.BoxGeometry(L + 0.5, 0.14, 0.16), toriiMat)); beam.position.set(0, H - 0.15, 0);
  const beam2 = sh(new THREE.Mesh(new THREE.BoxGeometry(L + 0.2, 0.1, 0.12), toriiMat)); beam2.position.set(0, H - 0.62, 0);
  const cap = sh(new THREE.Mesh(new THREE.BoxGeometry(L + 0.7, 0.12, 0.22), toriiMat)); cap.position.set(0, H + 0.02, 0);
  cap.rotation.z = 0; t.add(p1, p2, beam, beam2, cap);
  t.position.set(0, 0, 2.6);
  g.add(t);
  // 石灯笼 ×2（原版石材）
  for (const sx of [-1.6, 1.6]) {
    const st = new THREE.Group();
    const stoneMat = JPBR('stone_jp', { rx: 0.8, ry: 0.8, rough: 0.9 }, seed + sx);
    st.add(sh(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 8), stoneMat)));
    const lamp = sh(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.3), glowMat(0xffd27a, { rough: 0.8, intensity: 1 })));
    lamp.position.y = 0.55;
    const cap2 = sh(new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 4), stoneMat));
    cap2.position.y = 0.8; cap2.rotation.y = Math.PI / 4;
    st.add(lamp, cap2);
    st.position.set(sx, 0, 1.6);
    g.add(st);
  }
  finish(g, { kind: 'shrine', word: 'jinja', ja: '神社', r: 3.6 });
  return g;
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/** 打包元数据（town.js 读取） */
function finish(g, meta) {
  g.userData.meta = meta;
  g.traverse(o => { if (o.isMesh && o.material?.emissive === undefined && !o.isMeshBasicMaterial) { /* noop */ } });
  return g;
}
