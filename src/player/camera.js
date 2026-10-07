// camera.js — 第三人称跟随相机（§5：距离 2.6m、仰角 18°、lerp 软跟随、FOV 50）
import * as THREE from 'three';
import { R, groundHeight } from '../world/layout.js';
import { worldToPlan } from '../world/planet.js';

const DIST = 2.6;
const PITCH0 = THREE.MathUtils.degToRad(18);
const PITCH_MIN = THREE.MathUtils.degToRad(4);
const PITCH_MAX = THREE.MathUtils.degToRad(62);
const FOV = 50;

export class FollowCamera {
  constructor(camera, cat) {
    this.camera = camera;
    this.cat = cat;
    this.yaw = cat.heading + Math.PI; // 初始在猫背后
    this.pitch = PITCH0;
    this.dist = DIST;
    this.lookSmooth = new THREE.Vector3();
    this.snapped = false;

    camera.fov = FOV;
    camera.near = 0.1;
    camera.far = 500;
    camera.updateProjectionMatrix();

    this._up = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._e = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  addDrag(dx, dy) {
    // 拖动方向与视角一致：拖右=视角右转，拖下=俯视（yaw 以东为正，故取 +=）
    this.yaw += dx * 0.0052;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, PITCH_MIN, PITCH_MAX);
  }
  addZoom(d) {
    this.dist = THREE.MathUtils.clamp(this.dist + d * 0.0022, 1.6, 4.2);
  }

  update(dt) {
    const catPos = this.cat.group.position;
    this._up.copy(catPos).normalize();

    // 切平面 (north, east) 基
    this._n.set(0, 1, 0).addScaledVector(this._up, -this._up.y);
    if (this._n.lengthSq() < 1e-8) this._n.set(1, 0, 0); else this._n.normalize();
    this._e.crossVectors(this._n, this._up).normalize(); // north × up = east

    // 相机方向：切平面内 yaw（0=北，+=东），正交分量 up*pitch
    const cy = this.yaw;
    this._dir.copy(this._n).multiplyScalar(Math.cos(cy)).addScaledVector(this._e, Math.sin(cy));

    this._desired.copy(catPos)
      .addScaledVector(this._dir, this.dist * Math.cos(this.pitch))
      .addScaledVector(this._up, this.dist * Math.sin(this.pitch));

    // 防止钻地：不低于可走面 0.35m（含台地/梯道，否则站在高台上相机穿顶面）
    const plan = worldToPlan(this._desired);
    const minR = R + groundHeight(plan.x, plan.z) + 0.35;
    if (this._desired.length() < minR) this._desired.setLength(minR);

    // 首帧直接就位（避免从星球中心飞出）
    if (!this.snapped) {
      this.camera.position.copy(this._desired);
      this.lookSmooth.copy(catPos);
      this.snapped = true;
    } else {
      const k = 1 - Math.exp(-dt * 10);
      this.camera.position.lerp(this._desired, k);
      this.lookSmooth.lerp(catPos, 1 - Math.exp(-dt * 14));
    }

    this.camera.up.copy(this._up);
    this.camera.lookAt(this.lookSmooth.x, this.lookSmooth.y, this.lookSmooth.z);
  }

  /** 相机前向在猫所在切平面的投影（给小猫当移动基准） */
  getForwardTangent(out) {
    const catPos = this.cat.group.position;
    out.copy(catPos).sub(this.camera.position);
    const up = this._up;
    out.addScaledVector(up, -out.dot(up));
    if (out.lengthSq() < 1e-8) out.copy(this._n);
    return out.normalize();
  }
}
