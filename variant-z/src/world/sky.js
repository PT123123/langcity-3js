// 天空穹顶（三段渐变 + 太阳/月亮盘 + 夜星）+ 四时刻参数
// 参数承接 LangCity/docs/VISUAL_UPGRADE.md 实测表，黄昏★为默认
import * as THREE from 'three';
import { phaseEmissives } from './materials.js';

export const PHASES = {
  morning: {
    label: '晨', sunElev: 16, sunAzim: 95, sunColor: 0xffb27a, sunIntensity: 0.95,
    hemiSky: 0xbcc8d8, hemiGround: 0x8a7a68, hemiIntensity: 0.55,
    skyTop: 0x7f93b4, skyMid: 0xd8c2ae, skyHorizon: 0xf2c99a,
    fog: 0xd8c9b0, fogNear: 55, fogFar: 240,
    bloomThreshold: 0.82, exposure: 1.0,
    night: 0,
  },
  day: {
    label: '昼', sunElev: 58, sunAzim: 160, sunColor: 0xfff4e0, sunIntensity: 1.35,
    hemiSky: 0xc9d4e0, hemiGround: 0x9a8d7c, hemiIntensity: 0.6,
    skyTop: 0x6f87ad, skyMid: 0xa8bccb, skyHorizon: 0xdfe3e2,
    fog: 0xdfe3e8, fogNear: 70, fogFar: 300,
    bloomThreshold: 0.9, exposure: 1.05,
    night: 0,
  },
  dusk: {
    label: '暮', sunElev: 9, sunAzim: 250, sunColor: 0xff9e5e, sunIntensity: 1.5,
    hemiSky: 0x9a93b4, hemiGround: 0x77685a, hemiIntensity: 0.72,
    skyTop: 0x5b6b8c, skyMid: 0xb98a8f, skyHorizon: 0xe8b27d,
    fog: 0xc9957a, fogNear: 62, fogFar: 300,
    bloomThreshold: 0.72, exposure: 1.08,
    night: 0,
  },
  night: {
    label: '夜', sunElev: 40, sunAzim: 300, sunColor: 0x8fa8d8, sunIntensity: 0.45,
    hemiSky: 0x3a4468, hemiGround: 0x2c2a34, hemiIntensity: 0.7,
    skyTop: 0x141830, skyMid: 0x272e4d, skyHorizon: 0x4a4468,
    fog: 0x2b2f4a, fogNear: 45, fogFar: 200,
    bloomThreshold: 0.5, exposure: 1.15,
    night: 1,
  },
};

export function makeSkyDome(radius = 900) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x5b6b8c) },
      midColor: { value: new THREE.Color(0xb98a8f) },
      horizonColor: { value: new THREE.Color(0xe8b27d) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(0xffb27a) },
      nightMix: { value: 0 },
      time: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 topColor, midColor, horizonColor, sunColor, sunDir;
      uniform float nightMix, time;
      varying vec3 vDir;

      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }

      void main() {
        float h = vDir.y; // -1..1
        vec3 col;
        if (h < 0.0) {
          // 地平线以下：往暗处渐变（会被星球挡住大半）
          col = mix(horizonColor, horizonColor * 0.45, clamp(-h * 3.0, 0.0, 1.0));
        } else if (h < 0.22) {
          col = mix(horizonColor, midColor, smoothstep(0.0, 0.22, h));
        } else {
          col = mix(midColor, topColor, smoothstep(0.22, 0.72, h));
        }
        // 太阳/月亮盘 + 光晕
        float d = dot(vDir, normalize(sunDir));
        float disc = smoothstep(0.9993, 0.99965, d);
        float halo = pow(clamp(d, 0.0, 1.0), 180.0) * 0.55 + pow(clamp(d, 0.0, 1.0), 24.0) * 0.12;
        col += sunColor * (disc * 2.4 + halo);
        // 夜星
        if (nightMix > 0.01 && h > 0.05) {
          vec3 cell = floor(vDir * 160.0);
          float star = step(0.9985, hash(cell));
          float tw = 0.6 + 0.4 * sin(time * 2.0 + hash(cell + 1.0) * 40.0);
          col += vec3(0.9, 0.93, 1.0) * star * tw * nightMix * smoothstep(0.05, 0.3, h);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, mat };
}

/** 时刻应用：改 sky uniform / 灯 / 雾 / 自发光 / bloom / 曝光 */
export function applyPhase(name, ctx) {
  const P = PHASES[name] || PHASES.dusk;
  const { sky, sun, hemi, fill, scene, bloomPass, renderer, glowSprites, cloudMat, petalMats } = ctx;

  const elev = THREE.MathUtils.degToRad(P.sunElev);
  const azim = THREE.MathUtils.degToRad(P.sunAzim);
  const sunDir = new THREE.Vector3(
    Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)
  );

  sky.mat.uniforms.topColor.value.set(P.skyTop);
  sky.mat.uniforms.midColor.value.set(P.skyMid);
  sky.mat.uniforms.horizonColor.value.set(P.skyHorizon);
  sky.mat.uniforms.sunColor.value.set(P.sunColor);
  sky.mat.uniforms.sunDir.value.copy(sunDir);
  sky.mat.uniforms.nightMix.value = P.night;

  sun.color.set(P.sunColor);
  sun.intensity = P.sunIntensity;
  sun.position.copy(sunDir).multiplyScalar(120);

  hemi.color.set(P.hemiSky);
  hemi.groundColor.set(P.hemiGround);
  hemi.intensity = P.hemiIntensity;

  fill.color.set(P.sunColor);
  fill.intensity = 0.18 * Math.min(1, P.sunIntensity);
  fill.position.copy(sunDir).multiplyScalar(-100);

  scene.fog.color.set(P.fog);
  scene.fog.near = P.fogNear;
  scene.fog.far = P.fogFar;

  if (bloomPass) bloomPass.threshold = P.bloomThreshold;
  if (renderer) renderer.toneMappingExposure = P.exposure;

  for (const e of phaseEmissives) {
    e.mat.emissiveIntensity = e[name] * (e.mat.userData.glowScale || 1);
  }
  for (const s of glowSprites) s.material.opacity = P.night === 1 ? 0.85 : (name === 'dusk' ? 0.5 : 0);
  if (cloudMat) cloudMat.color.set(P.night ? 0x6a7089 : (name === 'dusk' ? 0xead9c8 : 0xf5f2ea));
  if (petalMats) for (const m of petalMats) m.opacity = name === 'day' ? 0.9 : 0.75;

  return P;
}
