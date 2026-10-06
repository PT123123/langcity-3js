// interact.js — 金色光圈池 + 目标锁定 + 拍照判定（§1/§5）
import * as THREE from 'three';
import { planQuat } from '../world/layout.js';

const RING_COLOR = 0xffd27a;

export class Interact {
  constructor(scene, cat, town) {
    this.cat = cat;
    this.town = town;
    this.currentTarget = null;
    this.nearby = [];

    // 光圈池（复用，避免动态创建）
    this.pool = [];
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.RingGeometry(0.5, 0.64, 40);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }));
      m.renderOrder = 3;
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
    this._v = new THREE.Vector3();
  }

  /** 每帧：找出 2.2m 附近可交互物，摆光圈，锁最近目标 */
  update(dt, time) {
    const catPos = this.cat.group.position;
    const targets = [];
    for (const it of this.town.interactables) {
      const d = it.pos.distanceTo(catPos);
      const range = Math.min(3.2, it.radius + 1.1);
      if (d < range) targets.push({ it, d });
    }
    targets.sort((a, b) => a.d - b.d);
    this.nearby = targets;
    this.currentTarget = targets.length ? targets[0].it : null;

    // 光圈
    for (let i = 0; i < this.pool.length; i++) {
      const ring = this.pool[i];
      if (i < targets.length) {
        const { it, d } = targets[i];
        ring.visible = true;
        ring.position.copy(it.pos);
        const n = this._v.copy(it.pos).normalize();
        ring.position.addScaledVector(n, 0.06);
        ring.quaternion.copy(planQuat(it.plan.x, it.plan.z, 0));
        const near = this.currentTarget === it;
        const pulse = 1 + Math.sin(time * (near ? 5 : 3.2)) * (near ? 0.09 : 0.05);
        const s = (it.radius * 0.8 + 0.25) * pulse;
        ring.scale.setScalar(s);
        ring.material.opacity = (near ? 0.95 : 0.55) * (1 - d / 4.2);
      } else {
        ring.visible = false;
      }
    }
  }

  /** 拍照：返回锁定的目标（可能为 null） */
  photo() {
    return this.currentTarget;
  }
}
