// 建筑族：全部程序化几何，朝 +Z，底部 y=0（略沉入地面防缝）
// 材质 = 原版 LangCity PBR 贴图三件套（public/tex），按微差取用
import * as THREE from 'three';
import { M, J, PBR, JPBR, signTexture, windowTexture, glowMat } from './materials.js';
import { handTex, handRough } from './textures.js';
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

/** 墙面：把原版 jpg kind 映射到 Canvas 手绘 Messenger 纹理（保留 J 微差 + roughnessMap） */
const WALL_MAP = {
  plaster_paint:    ['plaster',   0xe8e2d4],
  wall_yellow:      ['plaster',   0xe6d6ac],
  wall_white_plank: ['woodPlank', 0xe8e4da],
  wall_plank_siding:['woodPlank', 0xd9d1c1],
  red_brick_03:     ['brickRed',  0xc89a8a],
  brick_warm:       ['brickRed',  0xcaa292],
  wood_dark:        ['woodDark',  0x6c5a48],
};
function wallM(tex, seed, opts = {}) {
  const [kind, base] = WALL_MAP[tex] || ['plaster', 0xe5dfd2];
  return J(base, opts.rough ?? 0.9, 0, seed + 'w', {
    map: handTex(kind), roughnessMap: handRough(kind), ...opts,
  });
}

/** 通用墙房：墙 + 双坡顶 + 门 + 窗（墙用 Canvas 手绘，屋顶用原版贴图） */
function baseHouse({ w = 3.2, d = 3.0, wallH = 2.2, wallTex = 'plaster_paint', roofTex = 'roof_tile', seed = 'h' }) {
  const g = new THREE.Group();
  const wallMat = wallM(wallTex, seed, { rough: 0.9 });
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
  const wallMat = wallM('plaster_paint', seed, { rough: 0.9 });
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
  g.add(box(1.1, 0.08, 0.6, M(0x7b7772, { rough: 0.8, map: handTex('stone'), roughnessMap: handRough('stone') }), 0, 1.62, d / 2 + 0.3));
  g.add(plane(0.8, 1.4, M(0x6b6258, { rough: 0.6, map: handTex('wood') }), 0, 0.7, d / 2 + 0.012));
  finish(g, { kind: 'mansion', word: 'mansion', ja: 'マンション', r: 3.4 });
  return g;
}

function shopSign(g, text, { x = 0, y = 2.5, z, vertical = false, bg = '#f5efe2', fg = '#4a4238', accent = '#c94f4f', w = 1.7, h = 0.5 } = {}) {
  const tex = signTexture(text, { vertical, bg, fg, accent });
  const sw = vertical ? h : w, shh = vertical ? w : h;
  const board = box(sw, shh, 0.08, M(0xf5efe2, { rough: 0.85, map: handTex('paper') }));
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
  g.add(box(w, h, d, wallM('plaster_paint', seed, { rough: 0.86 }), 0, h / 2 - 0.05, 0));
  // 正面玻璃带（暖光）
  const glass = glowMat(0xffd9a0, { rough: 0.1, metal: 0.2, map: windowTexture(5, 2, '#f2d9a8'), intensity: 1.2 });
  g.add(plane(w - 1.2, 1.5, glass, 0, 1.05, d / 2 + 0.015));
  // 条纹雨棚
  const awn = box(w - 0.4, 0.07, 0.9, M(0xc94f4f, { rough: 0.6, map: handTex('vermilion') }), 0, 2.15, d / 2 + 0.45);
  g.add(awn);
  // 屋顶招牌
  shopSign(g, 'コンビニ', { y: h + 0.35, z: d / 2 - 0.8, accent: '#3f8f5f' });
  g.add(box(0.9, 1.9, 0.06, M(0x6b6258, { rough: 0.6, map: handTex('wood') }), w / 2 - 0.75, 0.95, d / 2 + 0.012)); // 侧门
  finish(g, { kind: 'konbini', word: 'konbini', ja: 'コンビニ', r: 3.8 });
  return g;
}

export function buildRamen(seed = 'r') {
  const g = new THREE.Group();
  const w = 3.8, d = 3.4, h = 2.7;
  g.add(box(w, h, d, wallM('wall_yellow', seed, { rough: 0.88 }), 0, h / 2 - 0.05, 0));
  g.add(gableRoof(w, d, 0.7, JPBR('roof_slate', { rx: 0.55, ry: 0.55, rough: 0.7 }, seed + 'rf'), 0.25).translateX(0).translateY(h - 0.05));
  // 暖帘（和纸质感短帘）
  const norenMat = M(0xf0e8d8, { rough: 0.95, doubleSided: true, map: handTex('noren') });
  for (let i = 0; i < 4; i++) {
    const s = plane(0.5, 0.75, norenMat, -0.85 + i * 0.56, 1.85, d / 2 + 0.03);
    g.add(s);
  }
  g.add(box(w - 0.3, 0.06, 0.3, M(0x7b5f4a, { rough: 0.75, map: handTex('wood') }), 0, 2.26, d / 2 + 0.02));
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
  g.add(box(w, h, d, wallM('brick_warm', seed, { rough: 0.88 }), 0, h / 2 - 0.05, 0));
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
  g.add(plane(0.8, 1.5, M(0x7b5f4a, { rough: 0.7, map: handTex('wood') }), 0, 0.75, d / 2 + 0.012));
  shopSign(g, '喫茶店', { y: h + 0.42, z: d / 2 - 0.5, bg: '#4a3f35', fg: '#f0e4cc' });
  finish(g, { kind: 'cafe', word: 'cafe', ja: '喫茶店', r: 3.4 });
  return g;
}

export function buildStation(seed = 's') {
  const g = new THREE.Group();
  const w = 8, d = 5, h = 3.2;
  g.add(box(w, h, d, wallM('plaster_paint', seed, { rough: 0.88 }), 0, h / 2 - 0.05, 0));
  // 屋顶压顶：原来是 brick_warm 砌体——从街面看只是檐口一条带子，但第三人称的机位
  // 常年高于房顶（星球比例），整片屋面就成了一堵躺平的砖墙。换成石板屋面。
  // 名字必须是 public/tex 里真有的 roof_slate：写 'slate' 会 404，贴图取不到 image
  // 不是「退回纯色」而是整片采样成黑，站房屋顶从街面看就是一块悬着的黑板（实测 topdown-station2.png）。
  g.add(box(w + 0.5, 0.2, d + 0.5, JPBR('roof_slate', { rx: 4.5, ry: 2.9, rough: 0.9 }, seed + 'e'), 0, h, 0));
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
  g.add(box(w, h, d, wallM('plaster_paint', seed, { rough: 0.86 }), 0, h / 2 - 0.05, 0));
  const glass = glowMat(0xffd9a0, { rough: 0.1, metal: 0.2, map: windowTexture(8, 2, '#f2d9a8'), intensity: 1.1 });
  g.add(plane(w - 1.6, 1.7, glass, -0.4, 1.05, d / 2 + 0.015));
  shopSign(g, 'スーパー', { y: h + 0.42, z: 0, w: 2.4, h: 0.62, accent: '#c9603f' });
  g.add(box(w + 0.4, 0.1, 1.2, M(0x9aa8a8, { rough: 0.6, map: handTex('metal') }), 0, 2.3, d / 2 + 0.55));
  finish(g, { kind: 'super', word: 'supermarket', ja: 'スーパー', r: 5 });
  return g;
}

export function buildPostOffice(seed = 'p') {
  const g = new THREE.Group();
  const w = 4.6, d = 4, h = 3;
  g.add(box(w, h, d, wallM('wall_white_plank', seed, { rough: 0.88 }), 0, h / 2 - 0.05, 0));
  g.add(box(w + 0.4, 0.18, d + 0.4, JPBR('metal_blue', { rx: 3, ry: 0.4, rough: 0.6, metal: 0.4 }, seed + 'e'), 0, h, 0));
  const wm = windowMat();
  g.add(windowPlane(0.9, 0.8, -1.4, 1.4, d / 2 + 0.012, 0, wm));
  g.add(windowPlane(0.9, 0.8, 1.4, 1.4, d / 2 + 0.012, 0, wm));
  g.add(plane(0.9, 1.5, M(0x6b6258, { rough: 0.6, map: handTex('wood') }), 0, 0.75, d / 2 + 0.012));
  shopSign(g, '郵便局', { y: h + 0.45, z: 0, w: 2, h: 0.55, accent: '#c94f4f' });
  // 局门口小红邮筒
  const post = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.85, 14), M(0xc94f4f, { rough: 0.45, metal: 0.05, map: handTex('vermilion') })));
  // 局门口小红邮筒：原来钉在正墙外 0.5 m（体量环只到 2.2），实测筒身压上 北环 路缘。
  post.position.set(w / 2 - 0.45, 0.43, d / 2 - 0.15);
  g.add(post);
  finish(g, { kind: 'post_office', word: 'post_office', ja: '郵便局', r: 3.8 });
  return g;
}

export function buildShrine(seed = 'sh') {
  const g = new THREE.Group();
  // 拝殿（原版木纹 + 灰瓦）
  const w = 4, d = 3, h = 2.2;
  g.add(box(w, h, d, wallM('wood_dark', seed, { rough: 0.78 }), 0, h / 2 - 0.05, 0));
  const roof = gableRoof(w + 0.6, d + 0.6, 0.9, JPBR('roof_slate', { rx: 0.7, ry: 0.7, rough: 0.75 }, seed + 'rf'), 0.3);
  roof.position.y = h - 0.05;
  g.add(roof);
  // 鸟居
  const toriiMat = M(0xc94f4f, { rough: 0.5, metal: 0.05, map: handTex('vermilion') });
  const t = new THREE.Group();
  const L = 2.2, H = 1.9;
  const p1 = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, H, 10), toriiMat)); p1.position.set(-L / 2, H / 2, 0);
  const p2 = p1.clone(); p2.position.x = L / 2;
  const beam = sh(new THREE.Mesh(new THREE.BoxGeometry(L + 0.5, 0.14, 0.16), toriiMat)); beam.position.set(0, H - 0.15, 0);
  const beam2 = sh(new THREE.Mesh(new THREE.BoxGeometry(L + 0.2, 0.1, 0.12), toriiMat)); beam2.position.set(0, H - 0.62, 0);
  const cap = sh(new THREE.Mesh(new THREE.BoxGeometry(L + 0.7, 0.12, 0.22), toriiMat)); cap.position.set(0, H + 0.02, 0);
  cap.rotation.z = 0; t.add(p1, p2, beam, beam2, cap);
  // 鸟居原来在正墙外 2.6 m（体量环只到 1.8），实测柱脚落进 环镇东路 行车道 0.9 m。
  // 收到檐下：小神社的鸟居本来就架在拝殿入口前，出不了自家用地。
  t.position.set(0, 0, d / 2 + 0.18);
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

// ---------- 市政区四件套（移植自仓库 HEAD 的 src/world/props.js） ----------
// 并图之后手写城市把学校/医院/银行/图书馆排在了 ±17 的市政区块上，
// 用民宅/邮局顶替（原来的做法）会让整个市政区读成「又一排店」，街区性质就糊了。
const concrete = (seed, base = 0xe8e0cf) => J(base, 0.92, 0, seed + 'cn', {
  map: handTex('concrete'), roughnessMap: handRough('concrete'),
});

export function buildSchool(seed = 'sc') {
  const g = new THREE.Group();
  const w = 8, d = 3.8, h = 4.4;
  g.add(box(w, h, d, concrete(seed), 0, h / 2 - 0.05, 0));
  // 屋面：星球比例下第三人称机位常年高过房顶，屋面就是玩家看到的第一表面。
  // 这里原来铺 stone_jp（砌墙石）——俯视就是一块 8×4 的广场石畳，跟脚边的地面分不出来
  // （实测 school2-top.png）。日本校舎/病院的平屋顶是立缝金属板，改用 corrugated。
  g.add(box(w + 0.3, 0.28, d + 0.3, JPBR('metal_corrugated', { rx: 5, ry: 3, rough: 0.8, metal: 0.2 }, seed + 'c'), 0, h, 0));
  const wm = windowMat();
  for (let fl = 0; fl < 2; fl++) {
    for (let i = 0; i < 5; i++) g.add(windowPlane(0.8, 0.9, -3.0 + i * 1.5, 1.3 + fl * 1.7, d / 2 + 0.012, 0, wm));
  }
  g.add(plane(1.2, 1.6, M(0x6b6258, { rough: 0.65, map: handTex('wood') }), 0, 0.8, d / 2 + 0.015));
  shopSign(g, 'みなと小学校', { y: h - 0.5, z: d / 2 + 0.06, w: 2.4, h: 0.55, accent: '#3f6f9f' });
  // 旗杆 + 日之丸：原来钉在侧墙外 1.1 m、正墙外 1.2 m——占地按体量算之后那一段没人管，
  // 实测旗杆落在 西二巷×商店街 路口中央（体检 stats.appendages 报 -1.7 m）。
  // 收回体量轮廓内（roof 环是 hx 4.15 / hz 2.05），立在入口左侧的墙角前。
  const fx = -w / 2 + 0.55, fz = d / 2 + 0.12;
  const pole = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 3.4, 8), M(0xc9c4ba, { rough: 0.5, metal: 0.4 })));
  pole.position.set(fx, 1.7, fz);
  g.add(pole);
  g.add(plane(0.52, 0.36, new THREE.MeshBasicMaterial({ color: 0xf2ecdc }), fx + 0.28, 3.05, fz));
  const sun = new THREE.Mesh(new THREE.CircleGeometry(0.11, 14), new THREE.MeshBasicMaterial({ color: 0xc94f4f }));
  sun.position.set(fx + 0.28, 3.05, fz + 0.001);
  g.add(sun);
  // 校门矮柱：钉在正墙外 0.95 m 时仍然站到沥青里（体量环只到 d/2+0.15，柱心却在 d/2+0.95）。
  // 收到檐下贴墙，读起来仍是「门口两根望柱」，但永远出不了自家用地。
  for (const sx of [-1.4, 1.4]) {
    g.add(box(0.3, 0.85, 0.3, JPBR('stone_jp', { rx: 1, ry: 1, rough: 0.9 }, seed + 'gate'), sx, 0.42, d / 2 - 0.05));
  }
  finish(g, { kind: 'school', word: 'gakkou', ja: '学校', r: 5.2 });
  return g;
}

export function buildHospital(seed = 'hp') {
  const g = new THREE.Group();
  const w = 5.2, d = 3.8, h = 4.2;
  g.add(box(w, h, d, concrete(seed, 0xf0ece2), 0, h / 2 - 0.05, 0));
  g.add(box(w + 0.3, 0.25, d + 0.3, JPBR('metal_corrugated', { rx: 5, ry: 3, rough: 0.8, metal: 0.2 }, seed + 'c'), 0, h, 0));
  const wm = windowMat();
  for (let fl = 0; fl < 2; fl++) {
    for (let i = 0; i < 4; i++) g.add(windowPlane(0.7, 0.8, -1.7 + i * 1.15, 1.25 + fl * 1.65, d / 2 + 0.012, 0, wm));
  }
  // 入口雨棚（救护车落客口）
  g.add(box(2.2, 0.12, 1.1, M(0xb8b2a6, { rough: 0.85, map: handTex('stone') }), 0, 2.5, d / 2 + 0.5));
  for (const sx of [-1, 1]) g.add(box(0.1, 2.5, 0.1, M(0xb8b2a6, { rough: 0.8 }), sx, 1.25, d / 2 + 1.0));
  // 落客口的自动门：原来用 MeshBasicMaterial（不吃光照也不跟时刻走），白天是一扇
  // 糊在墙上的死白方块。换成和窗同一套自发光玻璃：白天读作玻璃，夜里透出大堂暖光。
  g.add(plane(1.4, 1.5, wm, 0, 0.75, d / 2 + 0.015));
  // 红十字
  const cross = M(0xc94f4f, { rough: 0.45, map: handTex('vermilion') });
  g.add(box(0.52, 0.16, 0.06, cross, 0, h + 0.55, d / 2 - 0.02));
  g.add(box(0.16, 0.52, 0.06, cross, 0, h + 0.55, d / 2 - 0.02));
  shopSign(g, 'みなと病院', { y: h + 1.15, z: d / 2 - 0.2, w: 1.9, h: 0.5, bg: '#f2ecdc', fg: '#3f5f7f' });
  finish(g, { kind: 'hospital', word: 'byouin', ja: '病院', r: 4.4 });
  return g;
}

export function buildBank(seed = 'bk') {
  const g = new THREE.Group();
  const w = 4.4, d = 3.4, h = 3.2;
  g.add(box(w, h, d, concrete(seed, 0xe4ddcc), 0, h / 2 - 0.05, 0));
  const roof = gableRoof(w + 0.6, d + 0.6, 0.7, JPBR('roof_slate', { rx: 0.6, ry: 0.6, rough: 0.75 }, seed + 'rf'), 0.28);
  roof.position.y = h - 0.05;
  g.add(roof);
  const colMat = M(0xf0ead8, { rough: 0.88, map: handTex('stone'), roughnessMap: handRough('stone') });
  for (let i = 0; i < 4; i++) {
    const c = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, h - 0.5, 10), colMat));
    c.position.set(-1.5 + i, (h - 0.5) / 2, d / 2 + 0.3);
    g.add(c);
  }
  g.add(box(w - 0.5, 0.16, 0.42, colMat, 0, 0.08, d / 2 + 0.5));   // 台阶
  g.add(box(w - 0.5, 0.16, 0.42, colMat, 0, 0.24, d / 2 + 0.28));
  g.add(plane(1.1, 1.5, M(0x5f564c, { rough: 0.6, map: handTex('wood') }), 0, 0.9, d / 2 + 0.015));
  shopSign(g, 'みなと銀行', { y: h + 0.35, z: d / 2 - 0.4, w: 1.9, h: 0.5, bg: '#e8e2d4', fg: '#4a4238', accent: '#8a7a52' });
  finish(g, { kind: 'bank', word: 'ginkou', ja: '銀行', r: 3.6 });
  return g;
}

export function buildLibrary(seed = 'lb') {
  const g = new THREE.Group();
  const w = 5, d = 3.4, h = 3;
  g.add(box(w, h, d, wallM('brick_warm', seed, { rough: 0.88 }), 0, h / 2 - 0.05, 0));
  const roof = gableRoof(w + 0.6, d + 0.6, 0.85, JPBR('roof_tile', { rx: 0.6, ry: 0.6, rough: 0.72 }, seed + 'rf'), 0.28);
  roof.position.y = h - 0.05;
  g.add(roof);
  const glass = glowMat(0xffd9a0, { rough: 0.12, metal: 0.2, map: windowTexture(4, 1, '#f2d9a8'), intensity: 1.1 });
  g.add(plane(w - 1.4, 1.2, glass, 0, 1.15, d / 2 + 0.015));
  g.add(plane(1, 1.5, M(0x6b6055, { rough: 0.65, map: handTex('wood') }), 0, 0.75, d / 2 + 0.015));
  const colMat = M(0xe0d8c4, { rough: 0.88, map: handTex('stone') });
  for (const sx of [-1.6, 1.6]) {
    const c = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, h - 0.5, 10), colMat));
    c.position.set(sx, (h - 0.5) / 2, d / 2 + 0.26);
    g.add(c);
  }
  shopSign(g, '図書館', { y: h + 0.42, z: d / 2 - 0.3, w: 1.7, h: 0.5, accent: '#5f7f5f' });
  // 门口的书堆雕塑：一眼说明这栋是干什么的
  for (let i = 0; i < 3; i++) {
    const bk = box(0.44, 0.11, 0.32, M([0xc96a5e, 0x5e7d96, 0x8fa06a][i], { rough: 0.8, map: handTex('paper') }),
      2.1, 0.34 + i * 0.12, d / 2 + 0.75);
    bk.rotation.y = i * 0.4;
    g.add(bk);
  }
  finish(g, { kind: 'library', word: 'toshokan', ja: '図書館', r: 4 });
  return g;
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/** 打包元数据（town.js 读取） */
function finish(g, meta) {
  g.userData.meta = meta;
  g.traverse(o => { if (o.isMesh && o.material?.emissive === undefined && !o.isMeshBasicMaterial) { /* noop */ } });
  return g;
}
