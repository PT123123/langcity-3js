// sky.js — 天空渐变穹顶 + 日月 + 星空 + 云 + 四时刻参数（HANDOFF §2.4/§2.5）
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gradientMap } from './materials.js';

// ---------- 四时刻参数表（§2.5，黄昏为默认门面；定格卡通光照：hemi 主导环境，sun 只给方向性阶梯） ----------
export const PHASES = [
  {
    id: 'dawn', label: '晨 6:30',
    sunEl: 16, sunAz: 105, sunInt: 1.0, sunColor: 0xffb27a,
    hemiInt: 1.05, hemiSky: 0x9aa3b8, hemiGround: 0xa89a86,
    windowEi: 0.25, streetLight: 0.5,
    fog: 0xd8c9b0, bloomThreshold: 0.82,
    skyTop: 0x6b7a9e, skyMid: 0xc9a3a0, skyHorizon: 0xf0cfa0,
    cloud: 0xe8cfc0, star: 0.0,
  },
  {
    id: 'day', label: '昼 12:30',
    sunEl: 58, sunAz: 175, sunInt: 1.2, sunColor: 0xfff4e0,
    hemiInt: 1.2, hemiSky: 0xaebfd2, hemiGround: 0xb0a692,
    windowEi: 0.0, streetLight: 0.0,
    fog: 0xdfe3e8, bloomThreshold: 0.9,
    skyTop: 0x6f9fc8, skyMid: 0xa9c9dd, skyHorizon: 0xe6f0ec,
    cloud: 0xf4f1ea, star: 0.0,
  },
  {
    id: 'dusk', label: '暮 18:00',
    sunEl: 13, sunAz: 255, sunInt: 1.7, sunColor: 0xff9e5e,
    hemiInt: 1.25, hemiSky: 0x8d94ac, hemiGround: 0xb3a086,
    windowEi: 0.85, streetLight: 0.85,
    fog: 0xc9957a, bloomThreshold: 0.72,
    skyTop: 0x5b6b8c, skyMid: 0xb98a8f, skyHorizon: 0xe8b27d,
    cloud: 0xe8c0a8, star: 0.12,
  },
  {
    id: 'night', label: '夜 21:30',
    sunEl: 40, sunAz: 210, sunInt: 0.5, sunColor: 0x8fa8d8,
    hemiInt: 0.62, hemiSky: 0x4a5278, hemiGround: 0x565040,
    windowEi: 1.0, streetLight: 1.0,
    fog: 0x2b2f4a, bloomThreshold: 0.5,
    skyTop: 0x141a30, skyMid: 0x232a4a, skyHorizon: 0x3a4060,
    cloud: 0x5a6080, star: 1.0,
  },
];

export const DEFAULT_PHASE = 2; // 夕 18:00 ★

// 数值/颜色插值
const _ca = new THREE.Color(), _cb = new THREE.Color();
function lerpColorHex(hexA, hexB, t, out) {
  _ca.set(hexA); _cb.set(hexB);
  return out.copy(_ca).lerp(_cb, t);
}

export function lerpPhase(a, b, t, out = {}) {
  const f = (k) => (out[k] = a[k] + (b[k] - a[k]) * t);
  f('sunEl'); f('sunAz'); f('sunInt'); f('hemiInt'); f('windowEi');
  f('streetLight'); f('bloomThreshold'); f('star');
  out.sunColor = lerpColorHex(a.sunColor, b.sunColor, t, new THREE.Color());
  out.fog = lerpColorHex(a.fog, b.fog, t, new THREE.Color());
  out.hemiSky = lerpColorHex(a.hemiSky, b.hemiSky, t, new THREE.Color());
  out.hemiGround = lerpColorHex(a.hemiGround, b.hemiGround, t, new THREE.Color());
  out.skyTop = lerpColorHex(a.skyTop, b.skyTop, t, new THREE.Color());
  out.skyMid = lerpColorHex(a.skyMid, b.skyMid, t, new THREE.Color());
  out.skyHorizon = lerpColorHex(a.skyHorizon, b.skyHorizon, t, new THREE.Color());
  out.cloud = lerpColorHex(a.cloud, b.cloud, t, new THREE.Color());
  out.label = t < 0.5 ? a.label : b.label;
  return out;
}

/** 太阳/月亮方向向量（az 度、el 度） */
export function sunDirFrom(azDeg, elDeg) {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az)
  );
}

// ---------- 天空穹顶着色器 ----------
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 topColor;
uniform vec3 midColor;
uniform vec3 horizonColor;
uniform vec3 fogColor;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float starAlpha;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;

  // 三段渐变：地平线 → 中间 → 天顶
  vec3 col = mix(horizonColor, midColor, smoothstep(-0.02, 0.18, h));
  col = mix(col, topColor, smoothstep(0.12, 0.62, h));
  // 地平线下方（远景地面方向）融入雾色 → 与场景雾无缝
  col = mix(col, fogColor, smoothstep(0.045, -0.02, h));
  // 地平线下继续压暗（海面方向）
  col = mix(col, fogColor * 0.82, smoothstep(-0.05, -0.35, h));

  // 太阳/月亮光晕 + 圆盘
  float d = max(dot(dir, normalize(sunDir)), 0.0);
  col += sunColor * pow(d, 90.0) * 0.9;           // 近核光晕
  col += sunColor * pow(d, 9.0) * 0.22;           // 大范围氛围
  float disc = smoothstep(0.9993, 0.9997, d);
  col = mix(col, sunColor * 1.35, disc);

  // 星空（夜里淡入，只在天顶区域）
  if (starAlpha > 0.01 && h > 0.06) {
    vec3 cell = floor(dir * 220.0);
    float s = hash(cell);
    float star = step(0.9975, s) * (0.5 + 0.5 * hash(cell + 7.0));
    float twinkle = 0.75 + 0.25 * sin(s * 90.0);
    col += vec3(0.9, 0.93, 1.0) * star * starAlpha * smoothstep(0.06, 0.3, h) * twinkle;
  }

  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSkyDome(radius = 340) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color() },
      midColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      fogColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      starAlpha: { value: 0 },
    },
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

export function applySkyUniforms(dome, phase, sunDir, fogColor) {
  const u = dome.material.uniforms;
  u.topColor.value.copy(phase.skyTop);
  u.midColor.value.copy(phase.skyMid);
  u.horizonColor.value.copy(phase.skyHorizon);
  u.fogColor.value.copy(fogColor || phase.fog);
  u.sunDir.value.copy(sunDir);
  u.sunColor.value.copy(phase.sunColor);
  u.starAlpha.value = phase.star;
}

// ---------- 云（少量、构图元素，缓慢绕星） ----------
export function makeClouds(planetR = 30) {
  const group = new THREE.Group();
  const cloudGeo = [];
  const proto = [
    [[0, 0, 0, 2.6, 1.5], [1.9, 0.5, 0.7, 1.7, 1.0], [-2.0, 0.3, -0.4, 1.5, 0.9]],
    [[0, 0, 0, 3.2, 1.7], [2.3, 0.4, 0.9, 2.0, 1.1]],
    [[0, 0, 0, 2.2, 1.3], [-1.7, 0.4, 0.5, 1.5, 0.9], [1.6, 0.2, 0.3, 1.4, 0.85]],
  ];
  for (const puffs of proto) {
    const geos = [];
    for (const [x, y, z, sx, sy] of puffs) {
      const g = new THREE.SphereGeometry(1, 10, 7);
      g.scale(sx, sy, sx * 0.8);
      g.translate(x, y, z);
      geos.push(g);
    }
    cloudGeo.push(mergeGeometries(geos));
  }
  const N = 9;
  const cloudMat = new THREE.MeshToonMaterial({
    color: 0xf6f3ea, gradientMap: gradientMap(),
    transparent: true, opacity: 0.92,
  });
  for (let i = 0; i < N; i++) {
    const geo = cloudGeo[i % cloudGeo.length].clone();
    const sc = 0.8 + Math.random() * 1.1;
    geo.scale(sc, sc, sc);
    const az = Math.random() * Math.PI * 2;
    const el = 0.25 + Math.random() * 0.5;
    const r = planetR + 42 + Math.random() * 20;
    const pos = new THREE.Vector3(
      Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)
    ).multiplyScalar(r);
    const m = new THREE.Mesh(geo, cloudMat);
    m.position.copy(pos);
    m.rotation.y = Math.random() * Math.PI * 2;
    group.add(m);
  }
  return group;
}
