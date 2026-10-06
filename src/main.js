// main.js — 入口：渲染器 + 场景组装 + 四时刻 + 后处理 + 输入 + 拍照闭环
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { buildPlanet } from './world/planet.js';
import { buildTown } from './world/town.js';
import {
  makeSkyDome, applySkyUniforms, makeClouds,
  PHASES, DEFAULT_PHASE, lerpPhase, sunDirFrom,
} from './world/sky.js';
import { Cat } from './player/cat.js';
import { FollowCamera } from './player/camera.js';
import { Interact } from './game/interact.js';
import { vocab, shutterSound } from './game/vocab.js';
import { getWord } from './game/words.js';
import { HUD } from './ui/hud.js';

// ---------- 基础 ----------
const canvas = document.getElementById('scene');
const isTouch = 'ontouchstart' in window;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;   // 卡通风：颜色字面直出，不做胶片压制
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9957a, 14, 95);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);

// ---------- 灯光架（极简：半球 + 唯一太阳；toon 渐变自带明暗过渡） ----------
const hemi = new THREE.HemisphereLight(0x8d94ac, 0x9a8a76, 0.42);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xff9e5e, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
sun.shadow.camera.left = -32;
sun.shadow.camera.right = 32;
sun.shadow.camera.top = 32;
sun.shadow.camera.bottom = -32;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 220;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.25;
sun.shadow.intensity = 0.42;   // messenger 几乎无影：只留一点压地感
scene.add(sun);
scene.add(sun.target);

// 街道点光（≤4 盏，跟随最近路灯）
const streetLights = [];
for (let i = 0; i < 4; i++) {
  const pl = new THREE.PointLight(0xffd9a0, 0, 8, 2);
  scene.add(pl);
  streetLights.push(pl);
}

// ---------- 世界 ----------
const skyDome = makeSkyDome(340);
scene.add(skyDome);

const planet = buildPlanet();
scene.add(planet);

const town = buildTown(scene);
const clouds = makeClouds(60);
scene.add(clouds);
const cloudMats = [];
clouds.traverse((o) => { if (o.isMesh) cloudMats.push(o.material); });

// ---------- 角色 ----------
const cat = new Cat(scene);

// ---------- HUD / 存档 ----------
const hud = new HUD();
const saved = vocab.load();
if (saved?.player) cat.setState(saved.player);
hud.setLearnable(town.interactables.map((it) => it.word).filter(Boolean));
hud.updateCount(vocab.count());

const followCam = new FollowCamera(camera, cat);
const interact = new Interact(scene, cat, town);

let todIdx = saved?.tod ?? DEFAULT_PHASE;
let phaseSnap = { ...PHASES[todIdx] };
let phaseTarget = todIdx;
let phaseBlend = 1;
let currentPhase = lerpPhase(PHASES[todIdx], PHASES[todIdx], 0, {});

hud.setTimeLabel(PHASES[todIdx].label);
hud.el.btnTime.onclick = () => setPhase((phaseTarget + 1) % PHASES.length);

function setPhase(i) {
  phaseSnap = { ...currentPhase };
  phaseTarget = i;
  phaseBlend = 0;
  todIdx = i;
  hud.setTimeLabel(PHASES[i].label);
  scheduleSave();
}

// ---------- 四时刻应用 ----------
function applyPhase(p) {
  const sunDir = sunDirFrom(p.sunAz, p.sunEl);
  const catPos = cat.group.position;

  sun.position.copy(catPos).addScaledVector(sunDir, 90);
  sun.target.position.copy(catPos);
  sun.intensity = p.sunInt;
  sun.color.copy(p.sunColor);

  hemi.intensity = p.hemiInt;
  hemi.color.copy(p.hemiSky);
  hemi.groundColor.copy(p.hemiGround);

  scene.fog.color.copy(p.fog);
  scene.background = null;

  applySkyUniforms(skyDome, p, sunDir, p.fog);
  bloom.threshold = p.bloomThreshold;
  if (town.mats.glass) town.mats.glass.emissiveIntensity = p.windowEi;
  for (const pl of streetLights) pl.intensity = p.streetLight * 1.1;
  for (const m of cloudMats) m.color.copy(p.cloud);
  currentPhase = p;
}

// ---------- 后处理（§2.6：克制） ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.65
);
composer.addPass(bloom);

const GrainVignette = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = length(vUv - 0.5);
      float vig = smoothstep(1.05, 0.35, d);
      c.rgb *= mix(vec3(0.88, 0.84, 0.80), vec3(1.0), vig);
      c.rgb += (hash(vUv * 913.0 + uTime) - 0.5) * 0.015;
      gl_FragColor = c;
    }
  `,
};
const grainPass = new ShaderPass(GrainVignette);
composer.addPass(grainPass);
composer.addPass(new OutputPass());

if (isTouch) bloom.strength = 0.13;

// ---------- 输入 ----------
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyF') takePhoto();
  if (e.code === 'Space') { cat.wantJump = true; e.preventDefault(); }
  if (e.code === 'KeyT') setPhase((phaseTarget + 1) % PHASES.length);
  if (e.code === 'KeyV') hud.toggleVocab(vocab.discovered);
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// 鼠标/触摸拖动 orbit
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  followCam.addDrag(e.clientX - lastX, e.clientY - lastY);
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointerup', () => { dragging = false; });
addEventListener('wheel', (e) => followCam.addZoom(e.deltaY), { passive: true });

// ---------- 拍照闭环 ----------
let lastShot = 0;
function takePhoto() {
  const now = performance.now();
  if (now - lastShot < 450) return;
  lastShot = now;

  hud.flash();
  shutterSound();

  const target = interact.photo();
  if (!target) {
    hud.hint('附近没有可学习的物品…');
    return;
  }
  const isNew = vocab.discover(target.word);
  const w = getWord(target.word);
  hud.updateCount(vocab.count());
  hud.vocabDirty = true;
  if (w) hud.showCard(w, isNew, vocab.count());
  scheduleSave();
}
hud.el.btnShot.onclick = takePhoto;

// ---------- 存档 ----------
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => vocab.save(cat, todIdx), 800);
}
setInterval(() => vocab.save(cat, todIdx), 6000);
addEventListener('beforeunload', () => vocab.save(cat, todIdx));

// ---------- 主循环 ----------
const clock = new THREE.Clock();
const _fwd = new THREE.Vector3();
let lampTimer = 0;

function updateStreetLights(dt) {
  lampTimer -= dt;
  if (lampTimer > 0) return;
  lampTimer = 0.5;
  const catPos = cat.group.position;
  const lamps = town.lampPositions
    .map((p) => ({ p, d: p.distanceToSquared(catPos) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (lamps[i]) streetLights[i].position.copy(lamps[i].p);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // 移动输入（键盘 + 摇杆）
  const joy = hud.joyState();
  cat.input.z = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.z;
  cat.input.x = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
  cat.input.x = THREE.MathUtils.clamp(cat.input.x, -1, 1);
  cat.input.z = THREE.MathUtils.clamp(cat.input.z, -1, 1);

  followCam.getForwardTangent(_fwd);
  cat.update(dt, _fwd);
  followCam.update(dt);
  interact.update(dt, t);

  // 时刻过渡
  if (phaseBlend < 1) {
    phaseBlend = Math.min(1, phaseBlend + dt / 1.6);
    lerpPhase(phaseSnap, PHASES[phaseTarget], phaseBlend, currentPhase);
  }
  applyPhase(currentPhase);

  updateStreetLights(dt);
  clouds.rotation.y += dt * 0.004;
  grainPass.uniforms.uTime.value = t % 100;

  composer.render();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- 启动 ----------
applyPhase(currentPhase);
hud.hint('WASD 走近发光的物体，按 F 拍下单词卡！', 4200);
animate();
