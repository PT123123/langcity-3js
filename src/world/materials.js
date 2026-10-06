// materials.js — messenger 风格材质系统：卡通渐变着色 + 手绘噪点贴图 + 倒壳描边
// 光影极简：材质层负责「贴图感」，灯光层只留 半球光 + 单平行光（无 PMREM、无补光）。
import * as THREE from 'three';

// ---------- 色彩表（粉彩化：整体提一档明度，低饱和暖灰基调） ----------
export const C = {
  asphalt: 0x8b8580,
  asphaltDark: 0x827c76,
  sidewalk: 0xcabfb0,
  sidewalk2: 0xd6ccb9,
  wallWhite: 0xf4ecdb,
  wallGray: 0xe4dfd4,
  wallYellow: 0xf2e4be,
  wallBrick: 0xd8a48e,
  roofGreen: 0xa3ae9e,
  roofBlue: 0xa8b2ba,
  roofDark: 0x8a847c,
  roofMauve: 0xb29098,
  roofPink: 0xc4a1a8,
  leaf: 0x9ebd84,
  leaf2: 0x8ab076,
  leaf3: 0x7a9e66,
  sakura: 0xf2ccd6,
  sea: 0x76c3c6,
  sand: 0xe8d8ae,
  grass: 0xaab888,
  grassDark: 0x96a870,
  dirt: 0xd2c096,
  wood: 0xb08a5f,
  woodDark: 0x8a6a4a,
  vermillion: 0xe26455,
  ink: 0x55493a,
  glassDark: 0x93a8b2,
  windowWarm: 0xffdf9e,
  lampWarm: 0xffeabf,
  neonPink: 0xf0a2b2,
  neonBlue: 0xa2c8e8,
  cream: 0xf2ece0,
  cloud: 0xf6f3ea,
};

// ---------- 材质分档（卡通着色下 r/m 无效，仅保留发光/透明差异） ----------
export const BUCKETS = {
  concrete:   {},
  asphalt:    {},
  paving:     {},
  tile:       {},
  wood:       {},
  leaf:       {},
  leafDark:   {},
  plasticRed: {},
  plasticWhite: {},
  metalDark:  {},
  wire:       {},
  galvanized: {},
  rubber:     {},
  paint:      {},
  glass:      { e: 0xffd9a0, ei: 0.0 },   // ei 按时刻驱动
  lamp:       { basic: true },            // 路灯灯泡（basic 高亮）
  lampbox:    { basic: true },            // 贩卖机灯箱面
  neon:       { basic: true },            // 招牌发光字
  blob:       { basic: true, transparent: true, opacity: 0.5, depthWrite: false }, // Blob shadow
};

// ---------- 明度 ±4% + 轻微色相偏移（按世界坐标 hash） ----------
export function hash3(x, y, z) {
  let h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

export function jitterColor(color, p) {
  const h = hash3(Math.round(p.x * 10), Math.round(p.y * 10), Math.round(p.z * 10));
  const c = color.clone();
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.l += (h - 0.5) * 0.075;               // ±4% 明度
  hsl.h += (hash3(h * 91.7, 3.3, 7.7) - 0.5) * 0.012; // 轻微色相偏移
  hsl.s = Math.max(0, Math.min(1, hsl.s * (0.94 + h * 0.12)));
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
}

// ---------- 卡通渐变梯度图（4 阶硬分档） ----------
let _gradTex = null;
export function gradientMap() {
  if (_gradTex) return _gradTex;
  const steps = Uint8Array.from([118, 160, 202, 244]);
  const t = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return _gradTex = t;
}

// ---------- 手绘噪点贴图（水彩补丁 + 细颗粒，乘进所有表面 → 「贴图感」核心） ----------
let _grainTex = null;
export function handPaintedTexture() {
  if (_grainTex) return _grainTex;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  let seed = 1213;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // 低频水彩晕染斑（明/暗）
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 34;
    const dark = rnd() > 0.45;
    ctx.fillStyle = dark
      ? `rgba(150,132,104,${0.035 + rnd() * 0.05})`
      : `rgba(255,255,252,${0.05 + rnd() * 0.05})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.55 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 细颗粒
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(120,105,85,0.05)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return _grainTex = t;
}

// ---------- 工厂：给构建器用的真实材质（合并时读取元数据） ----------
const cache = new Map();

/** 独立 toon 材质（无 vertexColors；选项可覆盖，指定 map 时不叠颗粒贴图） */
export function plainToonMaterial(opts = {}) {
  const { map, ...rest } = opts;
  return new THREE.MeshToonMaterial({
    gradientMap: gradientMap(),
    map: map || handPaintedTexture(),
    ...rest,
  });
}

export function mat(colorHex, bucket = 'concrete', jitterPos = null) {
  let color = new THREE.Color(colorHex);
  if (jitterPos) color = jitterColor(color, jitterPos);
  const key = `${bucket}|${color.getHex()}`;
  if (cache.has(key)) return cache.get(key);

  const def = BUCKETS[bucket] || {};
  let m;
  if (def.basic) {
    m = new THREE.MeshBasicMaterial({ color });
    if (def.transparent) {
      m.transparent = true;
      m.opacity = def.opacity;
      m.depthWrite = def.depthWrite;
    }
  } else {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), map: handPaintedTexture() });
    if (def.e) {
      m.emissive = new THREE.Color(def.e === true ? colorHex : def.e);
      m.emissiveIntensity = def.ei ?? 1;
    }
  }
  m.userData = { baseColor: color.clone(), bucket };
  cache.set(key, m);
  return m;
}

// ---------- 合并用：每个 bucket 一个 vertexColors 材质 ----------
export function makeBucketMaterial(bucket) {
  const def = BUCKETS[bucket] || {};
  let m;
  if (def.basic) {
    m = new THREE.MeshBasicMaterial({ vertexColors: true });
    if (bucket === 'blob') m.map = blobTexture();
    if (def.transparent) {
      m.transparent = true;
      m.opacity = def.opacity;
      m.depthWrite = def.depthWrite;
    }
  } else {
    m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap(), map: handPaintedTexture() });
    if (def.e) {
      m.emissive = new THREE.Color(def.e === true ? 0xffffff : def.e);
      m.emissiveIntensity = def.ei ?? 1;
    }
  }
  m.userData = { bucket };
  return m;
}

// ---------- 倒壳描边（messenger 标志性轮廓线：沿法线外扩的匀色壳） ----------
const _outlineCache = new Map();
export function outlineMaterial(width, color = 0x3f382f) {
  const key = `${width}|${color}`;
  if (_outlineCache.has(key)) return _outlineCache.get(key);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uWidth: { value: width },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */`
      uniform float uWidth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz += normalize(normalMatrix * normal) * uWidth;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
  });
  _outlineCache.set(key, m);
  return m;
}

/** 给 mesh 挂一个同几何描边子网格（共享 geometry，省显存） */
export function addOutline(mesh, width) {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(width));
  mesh.add(o);
  return o;
}

// ---------- Blob shadow 贴图（径向渐变圆片） ----------
let blobTex = null;
export function blobTexture() {
  if (blobTex) return blobTex;
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(30,22,14,0.85)');
  g.addColorStop(0.55, 'rgba(30,22,14,0.4)');
  g.addColorStop(1, 'rgba(30,22,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  blobTex = new THREE.CanvasTexture(cv);
  return blobTex;
}

/** 给几何体上顶点色（含按世界位置抖动），供合并管线使用 */
export function bakeColor(geom, colorHex, bucket, worldPos) {
  const color = worldPos ? jitterColor(new THREE.Color(colorHex), worldPos) : new THREE.Color(colorHex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}
