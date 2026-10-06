// 天空穹顶（三段渐变 + 太阳/月亮盘 + 夜星）+ 四时刻参数
// 参数承接 LangCity/docs/VISUAL_UPGRADE.md 实测表，黄昏★为默认
import * as THREE from 'three';
import { phaseEmissives } from './materials.js';

export const PHASES = {
  morning: {
    label: '晨', sunElev: 16, sunAzim: 95, sunColor: 0xffb27a, sunIntensity: 1.5,
    hemiSky: 0xbcc8d8, hemiGround: 0x8a7a68, hemiIntensity: 0.5,
    fillColor: 0xbcd0e8, fillIntensity: 0.18,
    skyTop: 0x7f93b4, skyMid: 0xd8c2ae, skyHorizon: 0xf2c99a,
    fog: 0xd8c9b0, fogNear: 55, fogFar: 240,
    bloomThreshold: 0.82, exposure: 1.0,
    night: 0,
  },
  day: {
    label: '昼', sunElev: 58, sunAzim: 160, sunColor: 0xfff4e0, sunIntensity: 1.9,
    hemiSky: 0xc9d4e0, hemiGround: 0x9a8d7c, hemiIntensity: 0.55,
    fillColor: 0xcfe0f0, fillIntensity: 0.2,
    skyTop: 0x6f87ad, skyMid: 0xa8bccb, skyHorizon: 0xdfe3e2,
    fog: 0xdfe3e8, fogNear: 70, fogFar: 300,
    bloomThreshold: 0.9, exposure: 1.05,
    night: 0,
  },
  dusk: {
    label: '暮', sunElev: 20, sunAzim: 250, sunColor: 0xff9e5e, sunIntensity: 2.1,
    hemiSky: 0x9a93b4, hemiGround: 0x77685a, hemiIntensity: 0.5,
    fillColor: 0x8fa2c8, fillIntensity: 0.2,
    skyTop: 0x5b6b8c, skyMid: 0xb98a8f, skyHorizon: 0xe8b27d,
    fog: 0xc9957a, fogNear: 62, fogFar: 300,
    bloomThreshold: 0.72, exposure: 1.08,
    night: 0,
  },
  night: {
    label: '夜', sunElev: 40, sunAzim: 300, sunColor: 0x8fa8d8, sunIntensity: 0.55,
    hemiSky: 0x3a4468, hemiGround: 0x2c2a34, hemiIntensity: 0.7,
    fillColor: 0x4a5a88, fillIntensity: 0.15,
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

/** 世界系的太阳方向：只给「站在世界北极」的东西用（lab 预览、天空盘的赤道上视角）。
 *  星球玩法里别拿它直接照地面——见 sunDirLocal。 */
function sunDirWorld(elevDeg, azimDeg) {
  const elev = THREE.MathUtils.degToRad(elevDeg);
  const azim = THREE.MathUtils.degToRad(azimDeg);
  return new THREE.Vector3(
    Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)
  );
}

/** 把时刻参数里的 (仰角, 方位) 解释成「玩家脚下的当地地平坐标」再换到世界系。
 *  azim=0 指向世界 +X 投影到当地切平面的方向，与 sunDirWorld 在 up=(0,1,0) 时完全一致。
 *
 *  为什么非要当地系：镇区帽在余纬 31°，当地 up 与世界 +Y 差 31°，而方位 250° 又几乎正对着
 *  镇区的经度反面。世界系摆法下实测出生点 dot(阳光, 地面法线) = -0.348 —— 黄昏的太阳
 *  其实落在镇区地平线以下，整张地表吃不到直射光，只剩 hemiSky 那盏薰衣草色半球光在照，
 *  这就是「地面像鬼、看不出是什么材质」的根因。太阳仰角必须是「相对于你脚下」。 */
export function sunDirLocal(elevDeg, azimDeg, up) {
  const u = up.clone().normalize();
  let a = new THREE.Vector3(1, 0, 0).addScaledVector(u, -u.x);
  if (a.lengthSq() < 1e-6) a.set(0, 0, 1).addScaledVector(u, -u.z);
  a.normalize();
  const b = new THREE.Vector3().crossVectors(a, u);
  const el = THREE.MathUtils.degToRad(elevDeg);
  const az = THREE.MathUtils.degToRad(azimDeg);
  const ce = Math.cos(el);
  return a.multiplyScalar(ce * Math.cos(az))
    .addScaledVector(b, ce * Math.sin(az))
    .addScaledVector(u, Math.sin(el))
    .normalize();
}

/** 时刻应用：改 sky uniform / 灯 / 雾 / 自发光 / bloom / 曝光
 *  注意：太阳/补光的 position 只是初值，主循环每帧按玩家当地 up 重算（见 main.js loop）。 */
export function applyPhase(name, ctx) {
  const P = PHASES[name] || PHASES.dusk;
  const { sky, sun, hemi, fill, scene, bloomPass, renderer, glowSprites, cloudMat, petalMats } = ctx;

  const sunDir = sunDirWorld(P.sunElev, P.sunAzim);
  ctx.phase = P;   // 主循环要拿 sunElev/sunAzim 换当地系

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

  fill.color.set(P.fillColor ?? P.sunColor);   // 补光走冷色，才和暖主光拉开冷暖层次（HANDOFF §2.4）
  fill.intensity = P.fillIntensity ?? 0.18;
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
