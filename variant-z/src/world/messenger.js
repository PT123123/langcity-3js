// messenger.js —— Messenger(messenger.abeto.co)风格套件
// 逆向来源:docs/MESSENGER_STYLE.md(193 个 shader 的结论),公式要点:
//   ① 光照二值化:受光色 vs 阴影色两档,阴影色 = HSV 色相-0.02、明度×0.5
//   ② 表面叠三平面噪声颗粒(手绘画布感)
//   ③ 屏幕空间描边,且描边强度被噪声打散(断续手绘线)——用场景 alpha 通道当遮罩
//   ④ 32³ 3D LUT 四面体采样调色(整幅画的最终颜色大半来自它)
// 本模块不改 CommandCode 的 materials.js;集成方式见 docs/MESSENGER_STYLE.md §5。
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ---------- 共享状态(单例 uniform,一次更新全体生效) ----------
export const MSE = {
  time: { value: 0 },
  sunDir: { value: new THREE.Vector3(0.3, 0.9, 0.35).normalize() },
  // 太阳直达光参考值 ≈ sun.intensity/π(Lambert BRDF),用于把 directDiffuse 归一成 0..1 阴影信号
  sunRef: { value: 0.5 },
  noiseScale: { value: 0.35 },  // 表面颗粒密度(095 地形用 0.4)
  noiseAmt: { value: 0.11 },    // 颗粒明度摆幅(±)
  litLo: { value: 0.1 },        // 二值化阈值(普通面 0.2→0.4,角色 0.1→0.15)
  litHi: { value: 0.34 },
  sunLift: { value: 0.3 },      // 受光判定方向向天顶抬升:低仰角黄昏时地面不至于全泡在阴影里
  hueShift: { value: -0.02 },   // 阴影色相偏移(偏紫)
  valueMul: { value: 0.7 },    // 阴影明度倍率
  ambient: { value: 1.25 },     // indirectDiffuse 放大系数(暗部可读性)
};

let _noiseTex = null;
/** 主噪声(noise-simplex-layered-blur):数据纹理,线性空间、重复寻址 */
export function mseNoise() {
  if (_noiseTex) return _noiseTex;
  const t = new THREE.TextureLoader().load('./tex-messenger/noise-simplex-layered-blur.png');
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _noiseTex = t;
  return t;
}

// ---------- GLSL 公共块 ----------
const COMMON_GLSL = /* glsl */`
  uniform sampler2D tNoise;
  uniform vec3 uSunDir;
  uniform float uSunRef, uNoiseScale, uNoiseAmt, uLitLo, uLitHi, uSunLift, uHueShift, uValueMul, uAmbient, uMseTime, uDither;
  varying vec3 vMseWPos;
  varying vec3 vMseWNrm;
  vec3 mseHsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 mseRgb(vec3 h) {
    vec3 p = abs(fract(h.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return h.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), h.y);
  }
  vec3 mseTri(sampler2D t, vec3 n, vec3 p) {
    vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
    return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
  }
`;

const VERTEX_GLSL = /* glsl */`
  #include <begin_vertex>
  vMseWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vMseWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

// 二值化光照 + 噪声颗粒 + 描边遮罩写进 alpha(替代 opaque_fragment)
const OPAQUE_GLSL = /* glsl */`
  {
    vec3 N = normalize(vMseWNrm);
    #ifdef FLAT_SHADED
      N = normalize(cross(dFdx(vMseWPos), dFdy(vMseWPos)));
      if (dot(N, cameraPosition - vMseWPos) < 0.0) N = -N;
    #endif
    vec3 n1 = mseTri(tNoise, N, vMseWPos * uNoiseScale);
    vec3 base = diffuseColor.rgb * (1.0 + (n1.r - 0.5) * 2.0 * uNoiseAmt);
    // 二值化:受光/背光两档;受光方向向天顶抬升(低仰角太阳时地面仍读作受光)
    vec3 Ldir = normalize(mix(normalize(uSunDir), vec3(0.0, 1.0, 0.0), uSunLift));
    float lit = smoothstep(uLitLo, uLitHi, dot(N, Ldir));
    float sun = max(reflectedLight.directDiffuse.r, max(reflectedLight.directDiffuse.g, reflectedLight.directDiffuse.b));
    lit *= smoothstep(0.2, 0.45, sun / max(uSunRef, 1e-4));
    vec3 hsv = mseHsv(base);
    vec3 shadowCol = mseRgb(vec3(hsv.x + uHueShift, hsv.y, hsv.z * uValueMul));
    vec3 col = mix(shadowCol, base, lit);
    col += reflectedLight.indirectDiffuse * uAmbient;
    col += totalEmissiveRadiance;
    // 描边遮罩:噪声打散(095: step(0.17, g*b)),写进 alpha 给描边 pass 用
    vec3 n2 = mseTri(tNoise, N, vMseWPos * 0.07 + vec3(0.0, uMseTime * 0.015, 0.0));
    float dither = mix(1.0, step(0.17, n2.g * n2.b), uDither);
    gl_FragColor = vec4(col, diffuseColor.a * dither);
  }
`;

/**
 * 把现有 MeshStandardMaterial 原地改造成 Messenger 风格(共享实例改一次全体生效)。
 * 默认丢掉 normalMap/roughnessMap(该风格不用法线/粗糙贴图),metalness 归零。
 */
export function mseFromMaterial(mat, {
  dither = 1,          // 描边打散(角色/道具 1;水面/大地 0.3~1)
  flat = false,        // 低模平头着色(道具建议开)
  keepMaps = false,    // 保留 albedo 贴图(GLB 内嵌 colormap 的现成模型用)
} = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tNoise = { value: mseNoise() };
    shader.uniforms.uSunDir = MSE.sunDir;
    shader.uniforms.uSunRef = MSE.sunRef;
    shader.uniforms.uNoiseScale = MSE.noiseScale;
    shader.uniforms.uNoiseAmt = MSE.noiseAmt;
    shader.uniforms.uLitLo = MSE.litLo;
    shader.uniforms.uLitHi = MSE.litHi;
    shader.uniforms.uSunLift = MSE.sunLift;
    shader.uniforms.uHueShift = MSE.hueShift;
    shader.uniforms.uValueMul = MSE.valueMul;
    shader.uniforms.uAmbient = MSE.ambient;
    shader.uniforms.uMseTime = MSE.time;
    shader.uniforms.uDither = { value: dither };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMseWPos; varying vec3 vMseWNrm;`)
      .replace('#include <begin_vertex>', VERTEX_GLSL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_GLSL}`)
      .replace('#include <opaque_fragment>', OPAQUE_GLSL);
  };
  mat.customProgramCacheKey = () => 'mse';
  if (!keepMaps) { mat.normalMap = null; mat.roughnessMap = null; }
  mat.metalness = 0;
  mat.roughness = 1;
  if (flat) mat.flatShading = true;
  mat.needsUpdate = true;
  return mat;
}

/** 新建一个 Messenger 风格纯色材质 */
export function mseMaterial(color, opts = {}) {
  return mseFromMaterial(new THREE.MeshStandardMaterial({ color, vertexColors: !!opts.vertexColors }), opts);
}

/**
 * 星球地面:调色板顶点色(原版色块)× 地形噪声纹理的三平面细节 + 二值化光照。
 * 顶点色是主色,噪声只加颗粒和描边打散——不再用照片 PBR 贴图。
 */
export function mseGround({ noise = 'noises-terrain.png', scale = 0.12, amt = 0.14, dither = 0.5 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const t = new THREE.TextureLoader().load(`./tex-messenger/${noise}`);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tNoise = { value: t };
    shader.uniforms.uSunDir = MSE.sunDir;
    shader.uniforms.uSunRef = MSE.sunRef;
    shader.uniforms.uNoiseScale = { value: scale };
    shader.uniforms.uNoiseAmt = { value: amt };
    shader.uniforms.uLitLo = MSE.litLo;
    shader.uniforms.uLitHi = MSE.litHi;
    shader.uniforms.uSunLift = MSE.sunLift;
    shader.uniforms.uHueShift = MSE.hueShift;
    shader.uniforms.uValueMul = MSE.valueMul;
    shader.uniforms.uAmbient = MSE.ambient;
    shader.uniforms.uMseTime = MSE.time;
    shader.uniforms.uDither = { value: dither };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMseWPos; varying vec3 vMseWNrm;`)
      .replace('#include <begin_vertex>', VERTEX_GLSL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_GLSL}`)
      .replace('#include <opaque_fragment>', OPAQUE_GLSL);
  };
  mat.customProgramCacheKey = () => 'mse-ground';
  return mat;
}

// ---------- 屏幕空间描边 ----------
// 深度边 + 深度重构法线边 + 场景 alpha 遮罩(mse 材质把噪声打散写进 alpha)
export function makeOutlinePass({
  color = 0x2b2620, thickness = 2.0, depthThresh = 3.5, normalThresh = 0.25, maxDist = 150,
} = {}) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 }, uFar: { value: 500 },
      uProj: { value: new THREE.Matrix4() },
      uColor: { value: new THREE.Color(color) },
      uThick: { value: thickness },
      uDepthThresh: { value: depthThresh },
      uNormalThresh: { value: normalThresh },
      uMaxDist: { value: maxDist },
      uDebug: { value: 0 }, // 1=深度灰度 2=遮罩alpha 3=原始场景
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse, tDepth;
      uniform vec2 uRes;
      uniform float uNear, uFar, uThick, uDepthThresh, uNormalThresh, uMaxDist;
      uniform mat4 uProj;
      uniform vec3 uColor;
      uniform float uDebug;
      varying vec2 vUv;
      #include <packing>
      float linDepth(vec2 uv) {
        float z = texture2D(tDepth, uv).x;
        return -perspectiveDepthToViewZ(z, uNear, uFar);
      }
      vec3 viewPos(vec2 uv, float z) {
        vec2 ndc = uv * 2.0 - 1.0;
        float a = uProj[1][1];
        return vec3(ndc * vec2(1.0 / uProj[0][0], 1.0 / a) * z, -z);
      }
      // 深度重构法线:退化时(共面/天空边界)cross 长度≈0,normalize 出 NaN 会渲染成随机黑块
      vec3 safeNormal(vec2 uv, float z) {
        vec2 ndc = uv * 2.0 - 1.0;
        float a = uProj[1][1];
        vec3 p = vec3(ndc * vec2(1.0 / uProj[0][0], 1.0 / a) * z, -z);
        float dR = linDepth(uv + vec2(2e-5, 0.0));
        float dU = linDepth(uv + vec2(0.0, 2e-5));
        vec3 c = cross(viewPos(uv + vec2(2e-5, 0.0), dR) - p, viewPos(uv + vec2(0.0, 2e-5), dU) - p);
        return length(c) < 1e-5 ? vec3(0.0, 1.0, 0.0) : normalize(c);
      }
      void main() {
        vec4 scene = texture2D(tDiffuse, vUv);
        vec2 texel = uThick / uRes;
        float dC = linDepth(vUv);
        // 远处直接跳过:掠射角下每像素深度差爆表,相对阈值整片误判成边(黑斑随视角出现);
        // 且屏幕上不足一像素的边没有意义。天空穹顶(r900,不写深度)读数=uFar,也被这挡住。
        if (dC >= uMaxDist) { gl_FragColor = vec4(scene.rgb, 1.0); return; }
        vec3 pC = viewPos(vUv, dC);
        vec3 nC = safeNormal(vUv, dC);
        // 朝向权重:斜视(掠射角)时同一像素的深度差天然巨大,阈值必须按表面朝向放宽,
        // 否则近处地面/墙面整片误判成边 —— 大块黑斑随视角闪动
        float facing = max(abs(dot(nC, normalize(pC))), 0.25);
        float outline = 0.0;
        for (int i = 0; i < 4; i++) {
          vec2 off = vec2(0.0);
          if (i == 0) off = vec2(texel.x, 0.0);
          else if (i == 1) off = vec2(-texel.x, 0.0);
          else if (i == 2) off = vec2(0.0, texel.y);
          else off = vec2(0.0, -texel.y);
          vec2 uv = vUv + off;
          float dN = linDepth(uv);
          // 深度边:相对深度差(远处自动放宽,掠射角按朝向再放宽)
          if (abs(dC - dN) > dC * uDepthThresh * texel.y / facing) outline = 1.0;
          // 法线边:性能档只查右/上两向(轮廓由深度边兜底),深度边已命中就跳过重构
          if (outline < 0.5 && (i == 0 || i == 2)) {
            vec3 nN = safeNormal(uv, dN);
            if (1.0 - abs(dot(nC, nN)) > uNormalThresh) outline = 1.0;
          }
        }
        // 距离渐隐:避免 150m 截断处边线突然消失的接缝
        outline *= 1.0 - smoothstep(uMaxDist * 0.72, uMaxDist, dC);
        // 场景 alpha = 材质端写好的描边遮罩(噪声打散)
        outline *= step(0.5, scene.a);
        if (uDebug > 0.5) {
          if (uDebug < 1.5) gl_FragColor = vec4(vec3(clamp(dC / 120.0, 0.0, 1.0)), 1.0);
          else if (uDebug < 2.5) gl_FragColor = vec4(vec3(step(0.5, scene.a)), 1.0);
          else gl_FragColor = vec4(scene.rgb, 1.0);
          return;
        }
        gl_FragColor = vec4(mix(scene.rgb, uColor, outline), 1.0);
      }
    `,
  });
  pass.material.depthWrite = false;
  pass.material.depthTest = false; // 全屏 quad 必须关深度测试,否则被 RT 里的残留深度整面剔除;
  return pass;
}

/** 同步相机参数到描边 pass(每帧或 resize 时调) */
export function outlineSync(pass, camera, w, h) {
  const u = pass.uniforms;
  u.uRes.value.set(w, h);
  u.uNear.value = camera.near;
  u.uFar.value = camera.far;
  u.uProj.value.copy(camera.projectionMatrix);
}

// ---------- 3D LUT 调色 ----------
// 用 lut3d-atlas.png(32 张 z-slice 铺成 8×4 网格,256×128)做 GLSL1 安全的 3D 查表:
// xy 双线性靠 LinearFilter,两邻层手工 mix。原版是 sampler3D 四面体采样,视觉等价。
export async function makeLUTPass({ url = './tex-messenger/lut3d-atlas.png', intensity = 0.9 } = {}) {
  const atlas = new THREE.TextureLoader().load(url);
  atlas.colorSpace = THREE.NoColorSpace; // LUT 是数据,不参与色彩转换
  atlas.flipY = false; // 关键:z 分块行序按图像行 0 在 v=0 计算,默认 flipY 会上下颠倒(通道错乱)
  atlas.magFilter = THREE.LinearFilter;
  atlas.minFilter = THREE.LinearFilter;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tAtlas: { value: atlas },
      uIntensity: { value: intensity },
      uDims: { value: new THREE.Vector2(256, 128) }, // 图集尺寸
      uSize: { value: 32 },
      uDbg: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform sampler2D tAtlas;
      uniform float uIntensity;
      uniform vec2 uDims;
      uniform float uSize;
      uniform float uDbg;
      varying vec2 vUv;
      vec3 sampleLUT(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        vec3 p = c * (uSize - 1.0);
        float z0 = floor(p.z);
        float z1 = min(z0 + 1.0, uSize - 1.0);
        float fz = p.z - z0;
        vec2 uv = p.xy + 0.5;
        vec2 tile0 = vec2(mod(z0, 8.0), floor(z0 / 8.0)) * uSize;
        vec2 tile1 = vec2(mod(z1, 8.0), floor(z1 / 8.0)) * uSize;
        vec3 c0 = texture2D(tAtlas, (tile0 + uv) / uDims).rgb;
        vec3 c1 = texture2D(tAtlas, (tile1 + uv) / uDims).rgb;
        return mix(c0, c1, fz);
      }
      void main() {
        if (uDbg > 0.5) { gl_FragColor = vec4(texture2D(tAtlas, vUv).rgb, 1.0); return; }
        vec4 col = texture2D(tDiffuse, vUv);
        col.rgb = mix(col.rgb, sampleLUT(col.rgb), uIntensity);
        gl_FragColor = col;
      }
    `,
  });
  pass.material.depthWrite = false;
  pass.material.depthTest = false; // 全屏 quad 必须关深度测试,否则被 RT 里的残留深度整面剔除;
  return pass;
}

/** 每帧驱动:时间 + 太阳方向/参考强度(在 loop 里调一次) */
export function mseUpdate(elapsed, { sunDir, sunIntensity }) {
  MSE.time.value = elapsed;
  if (sunDir) MSE.sunDir.value.copy(sunDir).normalize();
  if (sunIntensity != null) MSE.sunRef.value = sunIntensity / Math.PI + 1e-4;
}
