// 玩家小猫：网上现成的 Quaternius CC0 动画猫 GLB（poly.pizza，Idle/Walk/Run/Jump 等 8 段动画）
// 加载失败时退回程序化橘白猫（与 props.js "现成模型 + 程序化兜底" 同一套路）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { M, blobShadowTexture } from '../world/materials.js';

const CAT_GLB = './models/animals/cat.glb';
const HEIGHT = 0.37;   // 归一化后的猫总高（含耳朵，米）
const MODEL_YAW = 0; // 模型原生朝 +Z（已实测：PI 会让猫倒着走）

// 动画片段按 "Armature|Armature|Name" 的尾段匹配
function clipTail(n) { return n.split('|').pop(); }

export function buildCat() {
  const root = new THREE.Group();  // 根（贴地、朝 +Z），controller 只操作这个
  const holder = new THREE.Group(); // 实际模型挂这里，GLB 到位后替换占位
  root.add(holder);

  // 贴地 blob 软影：接触感（跳跃时由 controller 拉大淡出，攀爬时隐藏）
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(0.58, 0.58),
    new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, opacity: 0.4, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.025;
  blob.renderOrder = 3;
  root.add(blob);
  root.userData.blob = blob;

  const fallback = makeProcedural(holder);
  root.userData.animate = fallback.animate;

  new GLTFLoader().load(CAT_GLB, (gltf) => {
    holder.clear();
    const model = normalizeModel(gltf.scene);
    holder.add(model);
    const anim = makeGlbAnimator(model, gltf.animations);
    root.userData.animate = anim.animate;
    root.userData.catAnim = anim; // 调试：window.__dbg.player.mesh.userData.catAnim.force('Run')
  }, undefined, () => { /* 加载失败：保留程序化猫 */ });

  return root;
}

/** 缩放/抬升到真实猫尺寸，材质去塑料感 */
function normalizeModel(scene) {
  const wrap = new THREE.Group();
  scene.rotation.y = MODEL_YAW;
  wrap.add(scene);
  scene.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false; // 蒙皮网格包围盒不随骨骼动，关闭视锥裁剪防消失
      if (o.material) {
        o.material.metalness = Math.min(o.material.metalness ?? 0, 0.05);
        o.material.roughness = 0.88;
      }
    }
  });
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  wrap.scale.setScalar(HEIGHT / Math.max(size.y, 1e-6));
  const box2 = new THREE.Box3().setFromObject(wrap);
  const c = box2.getCenter(new THREE.Vector3());
  wrap.position.set(-c.x, -box2.min.y, -c.z);
  return wrap;
}

/** GLB 动画状态机：idle/eat/walk/run/jump/climb（攀爬用 Walk 循环，身体贴墙由 controller 处理） */
function makeGlbAnimator(model, clips) {
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const clip of clips) {
    const name = clipTail(clip.name);
    const a = mixer.clipAction(clip);
    if (name === 'Jump_Start' || name === 'Idle_Eating') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    act[name] = a;
  }

  let phase = '';
  let idleT = 0;
  let forceName = null;

  function to(name, fade = 0.16, ts = 1) {
    if (phase === name) return;
    const next = act[name];
    if (!next) return;
    next.setEffectiveTimeScale(ts);
    if (phase && act[phase]) act[phase].fadeOut(fade);
    next.reset().fadeIn(fade).play();
    phase = name;
  }

  mixer.addEventListener('finished', () => {
    if (phase === 'Idle_Eating') { phase = ''; idleT = -8; to('Idle', 0.3); } // 吃完歇 8s 再吃
    else if (phase === 'Jump_Start') { phase = ''; to('Jump_Loop', 0.05); }
  });

  return {
    animate(t, dt, st) {
      mixer.update(dt);
      if (forceName) return;
      if (st.climbing) { idleT = 0; to('Walk', 0.18, 1.8); return; }
      if (!st.grounded) {
        idleT = 0;
        if (st.vAlt > 0.8) to('Jump_Start', 0.08);
        else to('Jump_Loop', 0.12);
        return;
      }
      if (st.speed01 < 0.06) {
        idleT += dt;
        if (idleT > 7 && act.Idle_Eating) to('Idle_Eating', 0.35);
        else to('Idle', 0.25);
      } else {
        idleT = 0;
        if (st.speed01 < 0.8) to('Walk', 0.14, 0.55 + st.speed01 * 0.6);
        else to('Run', 0.14, 0.9);
      }
    },
    force(name) { forceName = name; if (name) to(name, 0.1); else { forceName = null; } },
    phase: () => phase,
  };
}

/** 程序化橘白猫兜底：真实猫比例（肩高~0.23m），走路摆腿、尾巴摆动 */
function makeProcedural(g) {
  const body = new THREE.Group();
  g.add(body);

  const fur = M(0xe8ddca, { rough: 0.9 });
  const furDark = M(0xb9987a, { rough: 0.9 });
  const pink = M(0xd8a8a0, { rough: 0.85 });
  const dark = M(0x4a3f38, { rough: 0.7 });

  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), fur);
  torso.scale.set(1.35, 0.95, 0.9);
  torso.position.y = 0.155;
  torso.castShadow = true;
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 10), fur);
  chest.scale.set(1.1, 1, 0.95);
  chest.position.set(0.12, 0.15, 0);
  chest.castShadow = true;
  body.add(chest);

  const head = new THREE.Group();
  head.position.set(0.24, 0.235, 0);
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), fur);
  skull.scale.set(1.05, 0.95, 0.95);
  skull.castShadow = true;
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), fur);
  snout.scale.set(1.2, 0.8, 0.9);
  snout.position.set(0.07, -0.02, 0);
  head.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), pink);
  nose.position.set(0.108, -0.008, 0);
  head.add(nose);
  for (const dz of [0.045, -0.045]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.07, 4), furDark);
    ear.position.set(-0.01, 0.075, dz);
    ear.rotation.z = -0.35;
    head.add(ear);
  }
  for (const dz of [0.035, -0.035]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 5), dark);
    eye.position.set(0.062, 0.015, dz);
    head.add(eye);
  }

  const legs = [];
  const legGeo = new THREE.CylinderGeometry(0.026, 0.022, 0.14, 8);
  for (const [dx, dz, front] of [[0.09, 0.05, 1], [0.09, -0.05, 1], [-0.1, 0.05, 0], [-0.1, -0.05, 0]]) {
    const leg = new THREE.Group();
    leg.position.set(dx, 0.1, dz);
    const m = new THREE.Mesh(legGeo, front ? fur : furDark);
    m.position.y = -0.07;
    m.castShadow = true;
    leg.add(m);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), fur);
    paw.position.y = -0.135;
    leg.add(paw);
    body.add(leg);
    legs.push(leg);
  }

  const tail1 = new THREE.Group();
  tail1.position.set(-0.16, 0.19, 0);
  body.add(tail1);
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.16, 6), furDark);
  t1.rotation.z = Math.PI / 2 - 0.5;
  t1.position.x = -0.06;
  tail1.add(t1);
  const tail2 = new THREE.Group();
  tail2.position.set(-0.13, 0.06, 0);
  tail1.add(tail2);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.14, 6), furDark);
  t2.rotation.z = Math.PI / 2 - 1.0;
  t2.position.x = -0.055;
  tail2.add(t2);

  return {
    animate(t, dt, st) {
      const speed01 = st ? st.speed01 : 0;
      const stride = 9 * (0.4 + speed01 * 0.9);
      const amp = 0.55 * Math.min(1, speed01 * 1.6);
      legs[0].rotation.z = Math.sin(t * stride) * amp * 0.5;
      legs[3].rotation.z = Math.sin(t * stride) * amp * 0.5;
      legs[1].rotation.z = Math.sin(t * stride + Math.PI) * amp * 0.5;
      legs[2].rotation.z = Math.sin(t * stride + Math.PI) * amp * 0.5;
      body.position.y = Math.abs(Math.sin(t * stride)) * 0.012 * Math.min(1, speed01 * 2);
      body.rotation.y = Math.sin(t * stride * 0.5) * 0.03 * Math.min(1, speed01);
      tail1.rotation.z = Math.sin(t * 2.2) * 0.3 - 0.2;
      tail2.rotation.z = Math.sin(t * 2.2 + 0.7) * 0.4;
      head.rotation.x = Math.sin(t * 0.9) * 0.05;
    },
  };
}
