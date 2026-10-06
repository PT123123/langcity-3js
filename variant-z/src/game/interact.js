// 交互：金色光圈 → 拍照判定 → 白闪 → 弹卡回调
import * as THREE from 'three';
import { M } from '../world/materials.js';

export class InteractSystem {
  constructor(scene, camera, interactables) {
    this.camera = camera;
    this.interactables = interactables;
    this.target = null;

    // 金色光圈（贴地脉动）
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    scene.add(this.ring);
    this.ringInner = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.34, 40),
      this.ring.material.clone()
    );
    this.ringInner.rotation.x = -Math.PI / 2;
    this.ringInner.visible = false;
    this.ringInner.renderOrder = 3;
    scene.add(this.ringInner);

    this.ray = new THREE.Raycaster();
    this.ray.far = 30;
    this.floatMeshes = new Map(); // target.group → {baseY, n}
  }

  /** 每帧：找猫前方最近的可交互物（≤物件半径内、朝向锥 60°），更新光圈 */
  update(dt, t, player) {
    const catPos = player.mesh.position;
    const heading = player.heading;

    let best = null, bestScore = Infinity;
    for (const it of this.interactables) {
      const toObj = it.worldPos.distanceTo(catPos);
      if (toObj > it.radius + 0.4) continue;
      const dirTo = it.worldPos.clone().sub(catPos).normalize();
      const cosA = dirTo.dot(heading);
      if (cosA < 0.5) continue; // 朝向锥 ~60°
      const score = toObj * 0.3 + (1 - cosA) * 8;
      if (score < bestScore) { bestScore = score; best = it; }
    }

    if (best !== this.target) {
      this.target = best;
      if (best) {
        const n = best.worldPos.clone().normalize();
        this.floatMeshes.set(best.group, { basePos: best.group.position.clone(), n });
      }
    }

    if (this.target) {
      const st = this.floatMeshes.get(this.target.group);
      const n = st.n;
      // 小物件轻微浮动（大建筑不浮，只铺光圈）
      if (this.target.meta.r <= 2.2) {
        this.target.group.position.copy(st.basePos).addScaledVector(n, 0.02 + Math.sin(t * 2.2) * 0.015);
      }
      const p = this.target.group.position;
      this.ring.visible = this.ringInner.visible = true;
      this.ring.position.copy(p).addScaledVector(n, 0.03);
      this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const s = 1 + Math.sin(t * 3.5) * 0.07;
      this.ring.scale.setScalar(s);
      this.ringInner.position.copy(this.ring.position);
      this.ringInner.quaternion.copy(this.ring.quaternion);
      this.ringInner.scale.setScalar(1 + Math.sin(t * 3.5 + Math.PI) * 0.07);
    } else {
      this.ring.visible = this.ringInner.visible = false;
    }
    return this.target;
  }

  /** 拍照：返回命中的 word 元数据或 null */
  shoot() {
    if (!this.target) return null;
    return this.target.meta;
  }
}
