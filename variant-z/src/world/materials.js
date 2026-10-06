// 材质工厂：roughness/metalness 分档 + 每实例微差（消塑料感的关键）
import * as THREE from 'three';

const cache = new Map();

/**
 * 全场景没有 envMap（见 planetMap.js 水面那段注释），MeshStandardMaterial 的
 * metalness 于是只有副作用：按 (1-m) 削掉漫反射，而削下来的部分要去反射环境贴图——
 * 环境贴图是空的，什么都反射不到。实测金属蓝屋脊（m=0.4）正对太阳时像素只有 rgb(2,1,2)，
 * 同一栋楼的白墙是 rgb(75,60,62)。所以工厂入口一律把 metal 归零：
 * 「金属感」改由明亮基色 + 低 roughness 的镜面高光来表达。
 */
const METAL = 0;

/** 基础标准材质（共享实例，按参数缓存） */
export function M(color, { rough = 0.85, metal = 0, emissive = 0x000000, emissiveIntensity = 1, side, flatShading, transparent, opacity, map, roughnessMap, doubleSided } = {}) {
  const key = `M|${color}|${rough}|${metal}|${emissive}|${emissiveIntensity}|${side || ''}|${flatShading ? 1 : 0}|${transparent ? 1 : 0}|${opacity ?? 1}|${map ? map.uuid : ''}|${roughnessMap ? roughnessMap.uuid : ''}|${doubleSided ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: METAL,
    emissive, emissiveIntensity,
    transparent, opacity,
    map, roughnessMap,
    side: side || (doubleSided ? THREE.DoubleSide : THREE.FrontSide),
    flatShading: !!flatShading,
  });
  cache.set(key, mat);
  return mat;
}

// ---- 微差材质池：同一基色的 N 个明度/色相微变体，按 key 哈希取用 ----
const jitterPools = new Map();

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

/**
 * 取一个微差材质实例。同 baseColor 不同 key 会得到略不同的明度(±5.5%)/色相，
 * 让成片的砖、窗、树冠看起来"每块都不一样"。
 */
export function J(baseColor, rough = 0.85, metal = 0, jitterKey = '', extra = {}) {
  const poolKey = `${baseColor}|${rough}|${metal}|${JSON.stringify(extra)}`;
  let pool = jitterPools.get(poolKey);
  if (!pool) {
    pool = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color(baseColor);
      const hsl = {}; c.getHSL(hsl);
      const off = (i / n - 0.5) * 2; // -1..1
      c.setHSL(
        hsl.h + off * 0.012,
        THREE.MathUtils.clamp(hsl.s + off * 0.02, 0, 1),
        THREE.MathUtils.clamp(hsl.l * (1 + off * 0.055), 0.02, 0.98)
      );
      pool.push(M(c.getHex(), { rough, metal, ...extra }));
    }
    jitterPools.set(poolKey, pool);
  }
  return pool[hashStr(jitterKey || poolKey) % pool.length];
}

// ---- 原版 PBR 贴图三件套（LangCity/assets/tex → public/tex，col/nrm/rgh）----

const texLoader = new THREE.TextureLoader();
const texCache = new Map();

/** 单张贴图：按 (name,tag,repeat) 缓存。col 走 sRGB，nrm/rgh 线性。异步加载，到位后自动显示。
 *  取不到图（贴图名打错、public/tex 少文件）会记 lost 并通知挂上来的材质，
 *  因为 three.js 对没有 image 的 sampler 返回**黑**而不是「先显示纯色」——
 *  diffuse = color × map，整面墙/整片屋顶会被画成一块悬在空中的黑板。 */
export function TEX(name, tag = 'col', rx = 1, ry = 1) {
  const key = `${name}|${tag}|${rx}|${ry}`;
  if (texCache.has(key)) return texCache.get(key);
  const t = texLoader.load(`./tex/${name}_${tag}.jpg`, undefined, undefined, () => {
    t.userData.lost = true;
    for (const f of t.userData.watchers) f();
  });
  t.colorSpace = tag === 'col' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  t.userData.watchers = new Set();
  t.userData.lost = false;
  texCache.set(key, t);
  return t;
}

/**
 * PBR 材质：贴图三件套 + 轻微明度微差（tint 0.9~1.1），替代纯色+J 的位置。
 * 加载完成前以 tint 颜色显示，避免白闪；任一张取不到就摘掉贴图退回 tint 纯色。
 */
const pbrCache = new Map();
export function PBR(name, { rx = 2, ry = 2, rough = 0.85, metal = 0, tint = 1 } = {}) {
  const key = `${name}|${rx}|${ry}|${rough}|${metal}|${tint}`;
  if (pbrCache.has(key)) return pbrCache.get(key);
  const col = new THREE.Color(tint, tint, tint);
  const map = TEX(name, 'col', rx, ry);
  const nrm = TEX(name, 'nrm', rx, ry);
  const rgh = TEX(name, 'rgh', rx, ry);
  const mat = new THREE.MeshStandardMaterial({
    color: col, roughness: rough, metalness: METAL,
    map,
    normalMap: nrm,
    roughnessMap: rgh,
    normalScale: new THREE.Vector2(0.6, 0.6), // 风格化：法线只提体积不抢戏
  });
  const drop = () => {
    if (mat.map === null && mat.normalMap === null && mat.roughnessMap === null) return;
    mat.map = mat.normalMap = mat.roughnessMap = null;
    mat.needsUpdate = true;
  };
  for (const t of [map, nrm, rgh]) { t.userData.watchers.add(drop); if (t.userData.lost) drop(); }
  pbrCache.set(key, mat);
  return mat;
}

/** 同一套贴图取微差变体（6 档明度），按 key 哈希 —— 相当于 J() 的贴图版 */
export function JPBR(name, opts = {}, jitterKey = '') {
  const off = (hashStr(jitterKey || name) % 6 - 2.5) / 2.5; // -1..1
  const tint = 1 + off * 0.07;
  return PBR(name, { ...opts, tint });
}

/**
 * 地形三平面混合材质（星球地面专用）：
 * - 草地贴图 × 砂石贴图按顶点属性 aGrass(0..1) 混合——权重在 planetMap 烘焙调色板时
 *   按「绿色显著高于红蓝」算出，道路/广场(灰)、泥地(棕)自然落进砂石贴图。
 * - 三平面(triplanar)按世界坐标采样：原版地形 GLB 的 UV 是调色板索引用的，不能拿来
 *   铺贴图；世界坐标投影免 UV、无接缝、悬崖侧面不拉伸。
 * - 防模糊三板斧：① 贴图平铺密度调高（scale 大 → 一张贴图覆盖更少米数）
 *   ② 法线贴图同样三平面采样，给表面凹凸细节  ③ 高频细节层：同贴图 7× 频率再叠一层，
 *   远近都有纹理可看。
 * - 顶点色调制（diffuse × 贴图 × vColor）保留原版色块布局，boost 把偏暗的贴图提回亮度。
 */
export function groundMat({ grass = 'grass_ground', ground = 'worn_asphalt', scale = 0.42, rough = 0.95, boost = 2.6 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: rough, metalness: 0, vertexColors: true });
  const mapG = TEX(grass, 'col');
  const mapM = TEX(ground, 'col');
  const nrmG = TEX(grass, 'nrm');
  const nrmM = TEX(ground, 'nrm');
  for (const t of [mapG, mapM, nrmG, nrmM]) t.anisotropy = 16; // 地面掠射角多，各向异性拉满防糊
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMapG = { value: mapG };
    shader.uniforms.uMapM = { value: mapM };
    shader.uniforms.uNrmG = { value: nrmG };
    shader.uniforms.uNrmM = { value: nrmM };
    shader.uniforms.uScale = { value: scale };
    shader.uniforms.uBoost = { value: boost };
    mat.userData.shader = shader; // 运行时调参/调试用
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying float vGrass;
        attribute float aGrass;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGrass = aGrass;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying float vGrass;
        uniform sampler2D uMapG; uniform sampler2D uMapM;
        uniform sampler2D uNrmG; uniform sampler2D uNrmM;
        uniform float uScale; uniform float uBoost;
        vec3 triWeights(vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z);
        }
        vec3 triSample(sampler2D t, vec3 p, float s, vec3 n) {
          vec3 w = triWeights(n);
          return texture2D(t, p.zy * s).rgb * w.x
               + texture2D(t, p.xz * s).rgb * w.y
               + texture2D(t, p.xy * s).rgb * w.z;
        }
        // 三平面法线扰动：各投影轴用各自切线架，把法线贴图 xy 摊到世界上
        vec3 triPerturb(sampler2D t, vec3 p, float s, vec3 n) {
          vec3 w = triWeights(n);
          vec3 nx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0;
          vec3 ny = texture2D(t, p.xz * s).xyz * 2.0 - 1.0;
          vec3 nz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
          vec3 pert = (nx.x * vec3(0.0, 0.0, 1.0) + nx.y * vec3(0.0, 1.0, 0.0)) * w.x
                    + (ny.x * vec3(1.0, 0.0, 0.0) + ny.y * vec3(0.0, 1.0, 0.0)) * w.y
                    + (nz.x * vec3(1.0, 0.0, 0.0) + nz.y * vec3(0.0, 0.0, 1.0)) * w.z;
          return normalize(n + pert * 0.55);
        }`)
      .replace('#include <map_fragment>', `
        vec3 gCol = triSample(uMapG, vWPos, uScale, vWNrm);
        float gLuma = dot(gCol, vec3(0.299, 0.587, 0.114));
        gCol = mix(vec3(gLuma * 1.12), gCol, 0.68); // 色相仍交给顶点色，但保留更多贴图细节
        vec3 mCol = triSample(uMapM, vWPos, uScale, vWNrm);
        // 高频细节层：同贴图 7× 频率，提亮度均值后按 0.4 叠乘，打破放大模糊
        vec3 gDet = triSample(uMapG, vWPos, uScale * 7.0, vWNrm);
        vec3 mDet = triSample(uMapM, vWPos, uScale * 7.0, vWNrm);
        vec3 detCol = mix(mDet, gDet, vGrass);
        detCol = mix(vec3(1.0), detCol / max(dot(detCol, vec3(0.333)), 0.05) * 0.5 + 0.5, 0.4);
        vec3 texCol = mix(mCol, gCol, vGrass);
        diffuseColor.rgb *= texCol * detCol * uBoost;`);
    // 法线扰动：保留原 normal_fragment_begin（视空间），再叠世界空间三平面法线后转回视空间
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      {
        vec3 wN = normalize(mix(
          triPerturb(uNrmM, vWPos, uScale, vWNrm),
          triPerturb(uNrmG, vWPos, uScale, vWNrm), vGrass));
        normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
      }`);
  };
  return mat;
}

// ---- Canvas 纹理工具 ----

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

/** 招牌：底色圆角板 + 文字（可竖排） */
export function signTexture(text, { bg = '#f5efe2', fg = '#4a4238', vertical = false, accent = null } = {}) {
  const [c, ctx] = canvas(vertical ? 128 : 256, vertical ? 256 : 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  if (accent) {
    ctx.strokeStyle = accent; ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (vertical) {
    const chars = [...text];
    const step = Math.min(56, (c.height - 30) / chars.length);
    ctx.font = `700 ${Math.min(52, step * 0.92)}px "Noto Serif JP", serif`;
    chars.forEach((ch, i) => ctx.fillText(ch, c.width / 2, 24 + step * (i + 0.5)));
  } else {
    const size = text.length > 4 ? 44 : text.length > 2 ? 58 : 72;
    ctx.font = `700 ${size}px "Noto Serif JP", serif`;
    ctx.fillText(text, c.width / 2, c.height / 2 + 4);
  }
  return toTex(c);
}

/** 窗面纹理：白天反天空、夜里透室内，外加细窗框格 */
export function windowTexture(cols = 2, rows = 2, warm = '#e8c88f') {
  const [c, ctx] = canvas(128, 128);
  // 白天 glowMat 的 emissiveIntensity=0，这张贴图就是窗子的全部长相。原来画的是
  // 「夜里亮着的房间」：整面暖棕渐变 + 7px 深灰框。贴到站房 4.6 m 宽的玻璃带上，
  // 窗框被放大成 0.25 m 的黑梁、格子中心糊成黑洞
  // （实测窗心 rgb(17,16,12) vs 旁边同一面墙 rgb(135,125,104)）。
  // 改成白天优先：上半反天空、下半才透室内暖光，框收到 3px（≈0.11 m 截面）并抬成中灰。
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#c6d6de'); g.addColorStop(0.55, warm); g.addColorStop(1, '#a8825c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  // 家具剪影暗示（原来 0.5 的不透明深棕块，白天读成两块脏影子）
  ctx.fillStyle = 'rgba(90,60,40,0.22)';
  ctx.fillRect(14, 96, 30, 32);
  ctx.fillRect(84, 82, 26, 46);
  // 窗框
  ctx.strokeStyle = '#8b8478'; ctx.lineWidth = 3;
  for (let i = 1; i < cols; i++) { const x = (128 / cols) * i; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
  for (let i = 1; i < rows; i++) { const y = (128 / rows) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke(); }
  ctx.lineWidth = 5; ctx.strokeRect(0, 0, 128, 128);
  return toTex(c);
}

/** 墙面细噪点（很淡，只为打破纯色） */
export function plasterTexture(base = '#ece5d8') {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(120,110,95,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  return toTex(c, 2, 2);
}

/** Blob shadow：径向渐变圆片 */
let blobTex = null;
export function blobShadowTexture() {
  if (blobTex) return blobTex;
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(35,25,18,0.5)');
  g.addColorStop(0.65, 'rgba(35,25,18,0.22)');
  g.addColorStop(1, 'rgba(35,25,18,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  blobTex = toTex(c);
  return blobTex;
}

/** 柔光光晕（路灯/灯箱 glow sprite 用） */
let glowTexCache = null;
export function glowTexture() {
  if (glowTexCache) return glowTexCache;
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,214,150,0.9)');
  g.addColorStop(0.4, 'rgba(255,190,120,0.35)');
  g.addColorStop(1, 'rgba(255,180,110,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  glowTexCache = toTex(c);
  return glowTexCache;
}

// ---- 时刻相关的自发光材质登记（time.js 统一调制） ----
export const phaseEmissives = []; // {mat, day:0, dusk:0.85, night:1, morning:0.25}

/** 自发光窗/灯箱材质（进 phaseEmissives，随时刻变亮） */
export function glowMat(baseEmissive = 0xffd9a0, { rough = 0.4, metal = 0, map, intensity = 1.0 } = {}) {
  // 带 map 的是窗面/灯箱：白天 emissiveIntensity=0，全靠漫反射。底色沿用 0x2a2622 的话，
  // 乘上暖色窗贴图整扇窗会糊成一个纯黑方洞（mseSwap 对无贴图件有同款「抬到深灰」的规矩）。
  // 抬成冷灰蓝白天读作反光玻璃，夜晚由 emissive 接管、底色基本看不见。
  const mat = new THREE.MeshStandardMaterial({
    color: map ? 0xa8b6bd : 0x2a2622, roughness: rough, metalness: METAL,
    emissive: baseEmissive, emissiveIntensity: 0, map,
  });
  mat.userData.glowScale = intensity;
  phaseEmissives.push({ mat, day: 0, dusk: 0.85, night: 1.0, morning: 0.25 });
  return mat;
}

/** 恒亮霓虹/灯面（MeshBasic，永远亮，靠 bloom 溢光） */
export function neonMat(color = 0xffe0b0) {
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: true });
  mat.color.multiplyScalar(2.2); // 拉高亮度让 bloom 捕获
  return mat;
}
