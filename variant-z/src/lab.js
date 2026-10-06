// lab.js —— Messenger 风格实验页(messenger-lab.html 专用入口)
// 不动 main.js:同样的星球+城镇数据,材质全部换成 messenger.js 风格,后处理 = 描边+Bloom+LUT。
// URL 参数:?pose=street|aerial|shore|spawn &phase=dusk|day|night|morning &orbit=1
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { makeSkyDome, applyPhase } from './world/sky.js';
import { loadPlanet, dirFromPx } from './world/planetMap.js';
import { buildTownFromPlanetJson } from './world/town.js';
import { collectGlows } from './world/props.js';
import { loadWords } from './game/words.js';
import {
  mseFromMaterial, mseGround, makeOutlinePass, makeLUTPass, mseUpdate, mseNoise,
} from './world/messenger.js';

const q = new URLSearchParams(location.search);
const PHASE = q.get('phase') || 'dusk';
const POSE = q.get('pose') || 'street';

// ---------- 渲染器 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9957a, 62, 300);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);

// ---------- 灯光(与 main.js 同架) ----------
const hemi = new THREE.HemisphereLight(0x9a93b4, 0x77685a, 0.72);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xff9e5e, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
const S = 42;
sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.06; // 二值化光照下阴影边缘更抢眼,normalBias 加大防痤疮
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xff9e5e, 0.25);
scene.add(fill);

const sky = makeSkyDome(900);
scene.add(sky.mesh);

// ---------- 后处理:渲染 → 描边 → Bloom → 输出 → LUT ----------
// 描边需要深度:两个 RT 共享同一张 DepthTexture(RenderPass 渲进 readBuffer)。
// 尺寸必须等于 composer 实际缓冲(renderer 尺寸 × pixelRatio),否则 FBO 不完整、深度全空。
const composer = new EffectComposer(renderer);
// IAB/Windows 缩放下 devicePixelRatio 可能是 1.33 这种分数,composer 会算出 2129.6 的纹理尺寸,
// 深度纹理挂上去 FBO 直接创建失败、全链黑屏。这里强制整数倍率(≤2)。
composer.setPixelRatio(Math.min(2, Math.max(1, Math.ceil(devicePixelRatio || 1))));
// 每个 RT 各一张深度纹理:描边 pass 渲进 rt1 时采样 rt2 的深度,
// 若两 RT 共享同一张深度纹理 = framebuffer feedback loop(GL_INVALID_OPERATION,全链黑)。
let depthTex = null; // rt2 的深度(场景所在),描边采样它
function syncDepthTexture() {
  const w = Math.floor(composer.renderTarget1.width), h = Math.floor(composer.renderTarget1.height);
  if (composer.renderTarget1.depthTexture) composer.renderTarget1.depthTexture.dispose();
  if (composer.renderTarget2.depthTexture) composer.renderTarget2.depthTexture.dispose();
  const mk = () => { const t = new THREE.DepthTexture(w, h); t.type = THREE.UnsignedIntType; return t; };
  composer.renderTarget1.depthTexture = mk();
  composer.renderTarget2.depthTexture = mk();
  depthTex = composer.renderTarget2.depthTexture;
  if (typeof outlinePass !== 'undefined') outlinePass.uniforms.tDepth.value = depthTex;
}
window.__lab = { composer, renderer, scene, camera, depthTex: () => depthTex }; // 调试:无头验证读像素用
composer.addPass(new RenderPass(scene, camera));
const outlinePass = makeOutlinePass({ color: 0x2b2620, thickness: 2.2, depthThresh: 3.0, normalThresh: 0.22 });
syncDepthTexture(); // 建 RT 各自的深度纹理并绑给描边(须在 outlinePass 之后)
if (q.get('dbg')) outlinePass.uniforms.uDebug.value = parseFloat(q.get('dbg'));
if (q.get('outline') !== '0') composer.addPass(outlinePass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.28, 0.5, 0.8);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
let lutPass = null;
if (q.get('lut') !== '0') makeLUTPass({ intensity: parseFloat(q.get('luti') || '0.92') }).then(p => { lutPass = p; composer.addPass(p); });

const phaseCtx = { sky, sun, hemi, fill, scene, bloomPass, renderer, glowSprites: [] };

// ---------- 素材 ----------
let player = null;
await loadWords();
const planet = await loadPlanet();
scene.add(planet.group);
const { town, interactables, colliders, ticks, buildingBoxes, spawnPx } = await buildTownFromPlanetJson(scene, planet.surfaceAt);
phaseCtx.glowSprites = collectGlows(town);

// ---------- 材质替换:一切 MeshStandardMaterial → messenger 风格 ----------
// 星球 GLB 命名:p0..p9 地形 / p10 水 / p11..p15 树冠(见 planetMap.loadPlanet)
// ?mse=0 保留原材质(对照组)
function mseSwap(root) {
  if (q.get('mse') === '0') return;
  root.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!m || !m.isMeshStandardMaterial || m.userData.mse) return;
    m.userData.mse = true;
    if (planet.terrainMeshes.includes(o)) {
      o.material = mseGround(); // 星球地面:调色板顶点色 + 地形噪声
      return;
    }
    const name = o.name || '';
    const isLeaf = /tree-leaves/.test(name);   // GLB 节点名:planets_present_tree-leaves_*
    const isWater = /water/.test(name);        // planets_present_water
    // 树冠:leafmask 通道约定没对上会镂空(messenger 的树是实心团块),关掉并压回灰绿
    if (isLeaf && m.alphaMap) { m.alphaMap = null; m.alphaTest = 0; m.transparent = false; }
    if (isLeaf) m.color.set(0x9db884);
    // 贴图件分两类:LangCity 照片 PBR(yardDisc 庭院盘,本身偏暗)提亮成暖灰;
    // Kenney/polypizza 白亮 colormap 压一档,防止平涂风里过曝
    if (m.map && m.color) {
      const src = (m.map.image && m.map.image.src) || String(m.map.source?.data?.src || '');
      if (//tex//.test(src)) m.color.setRGB(1.7, 1.6, 1.45);
      else m.color.multiplyScalar(0.62);
    }
    // 纯黑无贴图件(colormap 缺失/轮胎)在平涂风里会读成"洞",抬到深灰
    if (!m.map && !m.vertexColors && m.color && m.color.r + m.color.g + m.color.b < 0.15) m.color.set(0x3d3936);
    mseFromMaterial(m, {
      flat: !isLeaf && !isWater,   // 树叶/水面用平滑法线,道具低模平头
      keepMaps: true,              // GLB 内嵌 colormap 保留(识别度)
      dither: isWater ? 0.25 : 1,  // 水面描边少打散
    });
  });
}
mseSwap(planet.group);
mseSwap(town);
phaseCtx.glowSprites = collectGlows(town);
applyPhase(PHASE, phaseCtx);

// ---------- 相机机位 ----------
const center = new THREE.Box3().setFromObject(town).getCenter(new THREE.Vector3());
const spawnDir = dirFromPx(...(spawnPx || [0, 2756]));
function poseCamera(name) {
  const up = new THREE.Vector3(0, 1, 0);
  if (name === 'aerial') {
    camera.position.copy(center).addScaledVector(up, 85).addScaledVector(spawnDir, 8);
  } else if (name === 'shore') {
    camera.position.copy(center).addScaledVector(spawnDir, -95).addScaledVector(up, 16);
  } else if (name === 'spawn') {
    camera.position.copy(center).addScaledVector(spawnDir, 120).addScaledVector(up, 26);
  } else { // street:贴近街面
    camera.position.copy(center).addScaledVector(spawnDir, 34).addScaledVector(up, 9);
  }
  camera.lookAt(center.x, center.y + (name === 'aerial' ? 0 : 3), center.z);
}
poseCamera(POSE);

// 阴影相机跟随视野中心
sun.target.position.copy(center);
sun.position.copy(center).addScaledVector(sky.mat.uniforms.sunDir.value, 130);

// ---------- 循环 ----------
const clock = new THREE.Clock();
let elapsed = 0;
const hud = document.getElementById('hud');
window.__err = null;
let noiseReady = false;
const _noise = mseNoise();
const noiseCheck = setInterval(() => { if (_noise.image && _noise.image.width > 0) { noiseReady = true; clearInterval(noiseCheck); } }, 100);

function loop() {
  requestAnimationFrame(loop);
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    if (q.get('orbit')) {
      const a = elapsed * 0.08;
      const dir = spawnDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const base = POSE === 'aerial' ? 85 : POSE === 'street' ? 9 : 16;
      const dist = POSE === 'aerial' ? 8 : POSE === 'street' ? 34 : POSE === 'shore' ? 95 : 120;
      camera.position.copy(center).addScaledVector(dir, dist).addScaledVector(new THREE.Vector3(0, 1, 0), base);
      camera.lookAt(center);
      sun.target.position.copy(center);
      sun.position.copy(center).addScaledVector(sky.mat.uniforms.sunDir.value, 130);
    }
    mseUpdate(elapsed, { sunDir: sky.mat.uniforms.sunDir.value, sunIntensity: sun.intensity });
    for (const fn of ticks) fn(elapsed, dt);
    sky.mat.uniforms.time.value = elapsed;
    outlineSyncSafe();
    if (noiseReady && (lutPass || q.get('lut') === '0')) {
      if (!window.__ready) { window.__ready = true; document.getElementById('loading').classList.add('off'); }
    }
    composer.render();
    if (Math.floor(elapsed * 2) % 4 === 0) {
      hud.textContent = `${PHASE} / ${POSE}\nmse 材质 ✓ 描边 ✓ LUT ${lutPass ? '✓' : '…'} 噪声 ${noiseReady ? '✓' : '…'}`;
    }
  } catch (e) {
    if (!window.__err) window.__err = (e && e.stack) || String(e);
  }
}
function outlineSyncSafe() {
  // 描边 pass 的相机/分辨率参数
  const u = outlinePass.uniforms;
  u.uRes.value.set(innerWidth, innerHeight);
  u.uNear.value = camera.near;
  u.uFar.value = camera.far;
  u.uProj.value.copy(camera.projectionMatrix);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  syncDepthTexture();
  outlinePass.uniforms.tDepth.value = depthTex;
});
loop();
