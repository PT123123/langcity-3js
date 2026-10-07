// view3d.js — 3D 实景预览：复用游戏的 planet/town/sky 装配，plan 变更后重建验证
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildPlanet, worldToPlan } from '../world/planet.js';
import { buildTown } from '../world/town.js';
import { makeSkyDome, applySkyUniforms, makeClouds, PHASES, lerpPhase, sunDirFrom } from '../world/sky.js';
import { planToVec3, TERRAIN_FIELD, makeField } from '../world/layout.js';
import { S } from './state.js';

const canvas = document.getElementById('preview');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9957a, 14, 95);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
// 预览当前 plan 的高程场：选中环/飞行目标要踩到造成后的面，不是纯山丘
let field = TERRAIN_FIELD;
const _v = new THREE.Vector3();
const originSurf = planToVec3(0, 0, 0, _v).clone();      // 平面原点的地面位置（相机绕它转，不是 +Y 顶点）
const originTop = planToVec3(0, 0, 14, _v).clone();
camera.position.copy(originTop);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(originSurf);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.minDistance = 4;
controls.maxDistance = 90;

const hemi = new THREE.HemisphereLight(0x8d94ac, 0x9a8a76, 0.42);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xff9e5e, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const SH = 40;
sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
sun.shadow.camera.near = 20; sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.25;
sun.shadow.intensity = 0.42;
scene.add(sun, sun.target);

const skyDome = makeSkyDome(340);
scene.add(skyDome);
let planet = buildPlanet();
scene.add(planet);
let town = buildTown(scene);
const clouds = makeClouds(60);
scene.add(clouds);
const cloudMats = [];
clouds.traverse((o) => { if (o.isMesh) cloudMats.push(o.material); });

// 选中物件标记：地面发光环
const markerGeo = new THREE.RingGeometry(0.9, 1.15, 40);
markerGeo.rotateX(-Math.PI / 2);
const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({
  color: 0xc94f4f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false,
}));
marker.renderOrder = 50;
marker.visible = false;
scene.add(marker);

let phaseIdx = 2;
export function setPhase(i) {
  phaseIdx = i;
  const p = PHASES[i];
  const sunDir = sunDirFrom(p.sunAz, p.sunEl);
  applyPhaseTo(p, sunDir);
}
setPhase(phaseIdx);

function applyPhaseTo(raw, sunDir) {
  // 相位表里颜色是十六进制数字，得先经 lerpPhase 换成 THREE.Color 才能 copy()（游戏里传的就是插值后的对象）
  const p = lerpPhase(raw, raw, 0, {});
  sun.position.set(0, 0, 0).addScaledVector(sunDir, 120);
  sun.target.position.set(0, 0, 0);
  sun.intensity = p.sunInt;
  sun.color.copy(p.sunColor);
  hemi.intensity = p.hemiInt;
  hemi.color.copy(p.hemiSky);
  hemi.groundColor.copy(p.hemiGround);
  scene.fog.color.copy(p.fog);
  applySkyUniforms(skyDome, p, sunDir, p.fog);
  if (town.mats.glass) town.mats.glass.emissiveIntensity = p.windowEi;
  for (const m of cloudMats) m.color.copy(p.cloud);
}

function disposeObject(obj) {
  // 只放几何：材质走 materials.js 的全局缓存，动它就等于毁掉其他对象的材质
  obj.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
  obj.parent?.remove(obj);
}

export function rebuildPlanet(data) {
  field = makeField(data);
  // 地面贴图是每次新建的 2048×1024 CanvasTexture（约 8 MB 显存）。只放几何不放它，
  // 改几次路就堆几份，实测到第 4~5 次整页不再响应。轮廓材质是全局缓存的，不能动。
  const old = planet.material;
  disposeObject(planet);
  if (old?.isMeshToonMaterial) { old.map?.dispose(); old.dispose(); }
  planet = buildPlanet(data);
  scene.add(planet);
}

export function rebuildTown(data) {
  field = makeField(data);
  disposeObject(town.root);
  town = buildTown(scene, data);
  const p = PHASES[phaseIdx];
  applyPhaseTo(p, sunDirFrom(p.sunAz, p.sunEl));
}

export function moveMarker() {
  const sel = S.sel;
  const o = sel && (sel.type === 'place' || sel.type === 'tree')
    ? (sel.type === 'place' ? S.plan.places[sel.i] : S.plan.forestTrees[sel.i])
    : null;
  if (!o) { marker.visible = false; return; }
  planToVec3(o.x, o.z, field.surface(o.x, o.z) + 0.06, _v);
  marker.position.copy(_v);
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v.clone().normalize());
  marker.visible = true;
}

/** 相机飞到某个 plan 坐标上空 */
export function flyTo(x, z, dist = 16) {
  planToVec3(x, z, field.surface(x, z), _v);
  const up = _v.clone().normalize();
  const south = planToVec3(x, z + 1, 0, new THREE.Vector3()).sub(_v).normalize();
  controls.target.copy(_v);
  camera.position.copy(_v).addScaledVector(up, dist * 0.9).addScaledVector(south, -dist * 0.4);
}

export function resize3d() {
  const box = (canvas.parentElement || canvas).getBoundingClientRect();
  const w = box.width > 40 ? box.width : Math.max(300, innerWidth - 476);
  const h = box.height > 40 ? box.height : Math.max(200, (innerHeight - 130) / 2);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let running = false;
export function startLoop() {
  if (running) return;
  running = true;
  (function tick() {
    requestAnimationFrame(tick);
    clouds.rotation.y += 0.0003;
    controls.update();
    renderer.render(scene, camera);
  })();
}

/** 验证钩子：预览里到底装了多少东西（网格数/三角数/交互物数） */
const _shot = { rt: null };
export function dbg3d() {
  let meshes = 0, tris = 0;
  town.root.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) {
      meshes++;
      const g = o.geometry;
      tris += Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
    }
  });
  // 页面被隐藏时 rAF 不跑、默认帧缓冲也回读不到内容，所以渲染进离屏目标再取像素
  const W = 120, H = 80;
  if (!_shot.rt) _shot.rt = new THREE.WebGLRenderTarget(W, H);
  const aspect = camera.aspect;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  controls.update();          // 隐藏页面里 rAF 不跑，相机指向得自己推一次
  renderer.setRenderTarget(_shot.rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const buf = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(_shot.rt, 0, 0, W, H, buf);
  const at = (fx, fy) => {
    const i = (Math.round(H * (1 - fy)) * W + Math.round(W * fx)) * 4;
    return `${buf[i]},${buf[i + 1]},${buf[i + 2]}`;
  };
  let lit = 0;
  const buckets = new Set();
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i] + buf[i + 1] + buf[i + 2] > 30) lit++;
    buckets.add(`${buf[i] >> 3},${buf[i + 1] >> 3},${buf[i + 2] >> 3}`);
  }
  return {
    meshes, tris,
    interactables: town.interactables.length,
    lamps: town.lampPositions.length,
    frameCalls: renderer.info.render.calls,
    sampleColors: [[0.5, 0.5], [0.35, 0.62], [0.66, 0.4]].map(([x, y]) => at(x, y)),
    litRatio: Math.round(lit / (W * H) * 100) / 100,
    colorBuckets: buckets.size,
    running,
  };
}

export { worldToPlan };

/** 验证钩子：与游戏页 window.__dbg 同口径，把预览场景本体交出去 */
export function core() {
  return { THREE, scene, camera, renderer, controls, town, get planet() { return planet; } };
}
