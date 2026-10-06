// LangCity 3JS — variant Z：Stylized 3D 插画风日语星球
// 地图 = LangCity 原版星球地形 GLB + planet.json 落点数据（不自绘地图）
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { makeSkyDome, applyPhase } from './world/sky.js';
import { loadPlanet, dirFromPx, R } from './world/planetMap.js';
import { buildTownFromPlanetJson } from './world/town.js';
import { collectGlows } from './world/props.js';
import { Player } from './player/controller.js';
import { InteractSystem } from './game/interact.js';
import { Hud } from './game/hud.js';
import { loadWords } from './game/words.js';
import { initBGM } from './game/bgm.js';
import {
  mseFromMaterial, mseGround, makeOutlinePass, makeLUTPass, mseUpdate, outlineSync,
} from './world/messenger.js';
import './style.css';

// ---------- 渲染器 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// 性能档:HiDPI 全分辨率渲染是 4 倍像素量,平涂粉彩风 1.5x 完全看不出差
const DPR = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; // 最轻微光影:只留低强度真实阴影
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // messenger 平涂风:字面亮度,不额外加曝

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9957a, 62, 300);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 950); // far 收到 950(天空穹顶 900):深度精度更好,描边更稳

// ---------- 灯光架：Hemisphere + 太阳 + 反向补光 ----------
const hemi = new THREE.HemisphereLight(0x9a93b4, 0x77685a, 0.72);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xff9e5e, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 200;
const S = 34;
sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.08;
sun.shadow.intensity = 0.45; // 最轻微:影子淡淡的,只做接触感不做氛围
sun.shadow.autoUpdate = false; // 隔帧手动更新(见 loop),阴影开销减半
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xff9e5e, 0.25);
scene.add(fill);

// ---------- 天空 ----------
const sky = makeSkyDome(900);
scene.add(sky.mesh);

// ---------- 后处理 ----------
// 默认全关（排查期用户要求）：原 PBR 材质 + 朴素管线,无描边/辉光/LUT/调色/messenger 转换。
// 可选回开:?mse=1 messenger 全套风格  ?plain=0 加回 Bloom+调色
const _q = new URLSearchParams(location.search);
const MSE = _q.get('mse') === '1';
const NOEDGE = _q.get('noedge') !== '0';
const PLAIN = _q.get('plain') !== '0';
const composer = new EffectComposer(renderer);
// 注意:composer 的 RT 倍率必须和 renderer 一致,且别超采样 —— Windows 分数缩放 + ceil(1.25)=2
// 曾把渲染量翻 4 倍;深度纹理挂载时非整数 RT 尺寸还会导致 FBO 创建失败、全链黑屏。
composer.setPixelRatio(DPR); // 与 renderer 同倍率,1.5 封顶
composer.addPass(new RenderPass(scene, camera));

// 描边需要深度:两个 RT 各挂一张深度纹理(共享一张会构成 framebuffer feedback loop,全链黑)。
// 注意:render() 时 RenderPass 写入的是 composer.readBuffer,双缓冲逐帧交替 ——
// 深度必须在每帧 render 前重新对齐(见 loop),写死一张会隔帧读到陈旧深度 → 大块黑斑闪动。
let outlinePass = null;
function syncDepthTexture() {
  const w = Math.floor(composer.renderTarget1.width), h = Math.floor(composer.renderTarget1.height);
  if (composer.renderTarget1.depthTexture) composer.renderTarget1.depthTexture.dispose();
  if (composer.renderTarget2.depthTexture) composer.renderTarget2.depthTexture.dispose();
  const mk = () => { const t = new THREE.DepthTexture(w, h); t.type = THREE.UnsignedIntType; return t; };
  composer.renderTarget1.depthTexture = mk();
  composer.renderTarget2.depthTexture = mk();
}
if (MSE && !NOEDGE && !PLAIN) {
  outlinePass = makeOutlinePass({ color: 0x2b2620, thickness: 2.2, depthThresh: 3.0, normalThresh: 0.22 });
  syncDepthTexture(); // 须在 outlinePass 之后(绑深度给它)
  composer.addPass(outlinePass);
}

let bloomPass = null;
if (!PLAIN) {
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 3, innerHeight / 3), 0.28, 0.5, 0.8); // 性能档:1/3 分辨率,辉光是模糊看不出差
  composer.addPass(bloomPass);
}
composer.addPass(new OutputPass());
let lutPass = null;
if (MSE && !PLAIN) makeLUTPass({ intensity: 0.92 }).then(p => { lutPass = p; composer.addPass(p); });

// 调色放最后：显示空间下做轻暖角 + 极淡颗粒（messenger 粉彩风的收尾）
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.95, 0.35, length(d) * 1.35);
      col.rgb = mix(vec3(0.86, 0.82, 0.78), col.rgb, vig); // 轻暖角(不压黑,平涂风要亮)
      float grain = (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 7.0) - 0.5) * 0.015;
      col.rgb += grain;
      gl_FragColor = col;
    }
  `,
});
if (!PLAIN) composer.addPass(gradePass);

// ---------- 异步启动：词库 → 星球 GLB → planet.json 摆放 ----------
let player, interact, hud;
const clock = new THREE.Clock();
let elapsed = 0;
window.__err = null;
window.__dbg = {};

const phaseCtx = { sky, sun, hemi, fill, scene, bloomPass, renderer, glowSprites: [] };
applyPhase('dusk', phaseCtx);

async function boot() {
  await loadWords();
  const planet = await loadPlanet();
  scene.add(planet.group);

  // messenger 风格材质转换：一切 MeshStandardMaterial → 卡通平涂（messenger-lab 验证过的方案）
  // 星球 GLB 命名:p0..p9 地形 / p10 水 / p11..p15 树冠(见 planetMap.loadPlanet)
  function mseSwap(root, pet = false) {
    if (!MSE) return;
    root.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || !m.isMeshStandardMaterial || m.userData.mse) return;
      m.userData.mse = true;
      if (planet.terrainMeshes.includes(o)) {
        o.material = mseGround(); // 星球地面:调色板顶点色 + 地形噪声
        return;
      }
      // 主角猫专用:平滑着色 + 保留原始配色(不压暗,低模平头会毁掉动画体的体积感)
      if (pet) {
        mseFromMaterial(m, { flat: false, keepMaps: true, dither: 1 });
        return;
      }
      const name = o.name || '';
      const isLeaf = /tree-leaves/.test(name);
      const isWater = /water/.test(name);
      // 树冠:leafmask 通道约定没对上会镂空,关掉并压回灰绿
      if (isLeaf && m.alphaMap) { m.alphaMap = null; m.alphaTest = 0; m.transparent = false; }
      if (isLeaf) m.color.set(0x9db884);
      // LangCity 照片 PBR 贴图件提亮成暖灰;Kenney/polypizza 白亮 colormap 压一档防过曝
      if (m.map && m.color) {
        const src = (m.map.image && m.map.image.src) || String(m.map.source?.data?.src || '');
        if (/tex/.test(src)) m.color.setRGB(1.7, 1.6, 1.45);
        else m.color.multiplyScalar(0.62);
      }
      // 纯黑无贴图件在平涂风里会读成"洞",抬到深灰
      if (!m.map && !m.vertexColors && m.color && m.color.r + m.color.g + m.color.b < 0.15) m.color.set(0x3d3936);
      mseFromMaterial(m, {
        flat: !isLeaf && !isWater,   // 树叶/水面用平滑法线,道具低模平头
        keepMaps: true,              // GLB 内嵌 colormap 保留(识别度)
        dither: isWater ? 0.25 : 1,  // 水面描边少打散
      });
    });
  }
  mseSwap(planet.group);

  const { town, interactables, colliders, ticks, buildingBoxes, spawnPx } = await buildTownFromPlanetJson(scene, planet.surfaceAt);
  mseSwap(town);
  phaseCtx.glowSprites = collectGlows(town);
  applyPhase('dusk', phaseCtx); // 重放:build 时的自发光窗/灯此刻才注册进 phaseEmissives,初始 applyPhase 时还是空表

  player = new Player(scene, colliders, planet.groundRadiusAt, dirFromPx(...(spawnPx || [0, 2756])));
  mseSwap(player.mesh, true); // 猫:主角待遇,不压色不平头
  player.buildingBoxes = buildingBoxes;
  const occluders = [...planet.terrainMeshes];
  town.traverse(o => { if (o.isMesh && o.renderOrder !== 2) occluders.push(o); });
  player.occluders = occluders;

  // ---------- 交互 + HUD ----------
  interact = new InteractSystem(scene, camera, interactables);
  hud = new Hud({
    onShoot: () => {
      const meta = interact.shoot();
      if (meta && meta.word) { hud.flash(); setTimeout(() => hud.openCard(meta), 130); }
      else hud.flash();
    },
    onPhase: (p) => applyPhase(p, phaseCtx),
  });

  window.__dbg = { player, camera, scene, interact, THREE };
  document.getElementById('loading').classList.add('off');
  hud.refreshChip();
  initBGM(); // 首次手势自动开播，♪ 按钮可开关

  // ---------- 存档 ----------
  try {
    const s = JSON.parse(localStorage.getItem('langcity3jz_player') || 'null');
    if (s) player.loadState(s);
  } catch { /* ignore */ }
  setInterval(() => {
    localStorage.setItem('langcity3jz_player', JSON.stringify(player.saveState()));
  }, 5000);

  loop(ticks);
}

function loop(ticks) {
  requestAnimationFrame(() => loop(ticks));
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    player.update(dt, elapsed);
    player.updateCamera(camera, dt);

    // 阴影相机跟随玩家
    sun.target.position.copy(player.mesh.position);
    sun.position.copy(sun.target.position).addScaledVector(sky.mat.uniforms.sunDir.value, 110);
    sun.shadow.needsUpdate = (loop._sf = (loop._sf || 0) + 1) % 2 === 0; // 隔帧重绘阴影(autoUpdate=false)

    const target = interact.update(dt, elapsed, player);
    crosshair.classList.toggle('hot', !!target);
    document.getElementById('photo-btn').classList.toggle('ready', !!target);

    for (const fn of ticks) fn(elapsed, dt);

    sky.mat.uniforms.time.value = elapsed;
    if (gradePass) gradePass.uniforms.uTime.value = elapsed;
    if (MSE && outlinePass) {
      // 深度逐帧对齐 readBuffer(本帧场景所在缓冲),否则隔帧读陈旧深度 → 黑斑闪动
      outlinePass.uniforms.tDepth.value = composer.readBuffer.depthTexture;
      // 光影下线(排查期):sunIntensity 0 → mse 材质只剩均匀底色+噪点,无明暗二值化
      mseUpdate(elapsed, { sunDir: sky.mat.uniforms.sunDir.value, sunIntensity: 0 });
      outlineSync(outlinePass, camera, innerWidth, innerHeight);
    }

    composer.render();
  } catch (e) {
    if (!window.__err) window.__err = (e && e.stack) || String(e);
  }
}

// ---------- 输入 ----------
addEventListener('keydown', e => { if (window.__dbg.player) window.__dbg.player.keys[e.code] = true; });
addEventListener('keyup', e => { if (window.__dbg.player) window.__dbg.player.keys[e.code] = false; });

// 拖动转头（鼠标/触摸）
let dragging = false, lastX = 0, lastY = 0;
function dragStart(x, y) { dragging = true; lastX = x; lastY = y; }
function dragMove(x, y) {
  if (!dragging || !window.__dbg.player) return;
  window.__dbg.player.turnBy((x - lastX) * 0.005);
  window.__dbg.player.pitchBy((y - lastY) * 0.004); // 上拖抬头看天,下拖低头
  lastX = x; lastY = y;
}
function dragEnd() { dragging = false; }
canvas.addEventListener('pointerdown', e => { if (e.isPrimary) dragStart(e.clientX, e.clientY); });
addEventListener('pointermove', e => dragMove(e.clientX, e.clientY));
addEventListener('pointerup', dragEnd);

// 滚轮缩放视角距离
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (window.__dbg.player) window.__dbg.player.zoomBy(Math.sign(e.deltaY) * 0.5);
}, { passive: false });

// 触屏摇杆
const joyEl = document.getElementById('touch-joystick');
const knob = document.getElementById('joy-knob');
let joyId = null;
joyEl.addEventListener('pointerdown', e => { joyId = e.pointerId; joyMove(e); });
joyEl.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
addEventListener('pointerup', e => {
  if (e.pointerId === joyId && window.__dbg.player) {
    joyId = null; window.__dbg.player.joy.x = window.__dbg.player.joy.y = 0;
    knob.style.transform = 'translate(-50%,-50%)';
  }
});
function joyMove(e) {
  if (!window.__dbg.player) return;
  const r = joyEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  window.__dbg.player.joy.x = dx; window.__dbg.player.joy.y = -dy;
  knob.style.transform = `translate(calc(-50% + ${dx * 32}px), calc(-50% + ${dy * 32}px))`;
}

const crosshair = document.getElementById('crosshair');

// turnBy 挂到 Player 原型（controller.js 内定义）
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  if (MSE) syncDepthTexture(); // 重建两 RT 的深度纹理并重绑给描边
});

boot().catch(e => {
  // 启动失败直接显示在加载页上,不再无声卡死
  const el = document.getElementById('loading');
  el.classList.remove('off');
  el.textContent = '启动失败: ' + ((e && e.message) || e);
  console.error(e);
});
