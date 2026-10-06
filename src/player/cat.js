// cat.js — 程序化小猫（真实比例：肩高 ~0.23m）+ 球面行走（§1 玩法 MVP）
import * as THREE from 'three';
import { R, terrainH, planToLatLon } from '../world/layout.js';
import { worldToPlan } from '../world/planet.js';
import { resolveCollisions } from '../world/collision.js';
import { mat } from '../world/materials.js';

const WALK_SPEED = 2.3;
const TURN_SPEED = 11;
const JUMP_V = 3.6;             // ≈0.66m 跳高
const G = 9.8;
const CAT_R = 0.18;             // 猫碰撞半径（米）

export class Cat {
  constructor(scene) {
    this.group = this.buildModel();
    scene.add(this.group);

    // 球面状态
    this.lat = THREE.MathUtils.degToRad(35.2);  // 初始位置：广场南侧
    this.lon = THREE.MathUtils.degToRad(0.01);
    this.heading = 0;                          // 朝北（面向车站；0=北，+=东）
    this.airV = 0;
    this.grounded = true;
    this.walkPhase = 0;
    this.moving = false;

    this.input = { x: 0, z: 0 };               // 相机相对移动输入
    this.wantJump = false;

    this._pos = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.syncFromSpherical();
  }

  buildModel() {
    const g = new THREE.Group();
    const fur = mat(0xe8e0d0, 'plasticWhite');
    const furDark = mat(0xb9ab97, 'plasticWhite');
    const pink = mat(0xd8a49a, 'plasticRed');

    // 躯干（胶囊状：拉长球）
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), fur);
    body.scale.set(1, 0.92, 1.65);
    body.position.set(0, 0.155, -0.01);
    g.add(body);

    // 胸（略浅色）
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.088, 12, 10), fur);
    chest.scale.set(0.95, 0.85, 1.1);
    chest.position.set(0, 0.145, 0.07);
    g.add(chest);

    // 头
    const head = new THREE.Group();
    head.position.set(0, 0.24, 0.155);
    g.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.082, 16, 12), fur);
    skull.scale.set(1, 0.94, 0.92);
    head.add(skull);
    // 吻部
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), fur);
    muzzle.scale.set(1.05, 0.8, 0.9);
    muzzle.position.set(0, -0.02, 0.066);
    head.add(muzzle);
    // 鼻
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), pink);
    nose.position.set(0, -0.005, 0.104);
    head.add(nose);
    // 耳
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.031, 0.055, 8), furDark);
      ear.position.set(s * 0.042, 0.062, -0.005);
      ear.rotation.z = -s * 0.32;
      head.add(ear);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.032, 8), pink);
      inner.position.set(s * 0.041, 0.06, 0.002);
      inner.rotation.z = -s * 0.32;
      head.add(inner);
    }
    // 眼（闭眼弧线用小黑球简化为亮点）
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), mat(0x35302a, 'plasticWhite'));
      eye.position.set(s * 0.034, 0.012, 0.068);
      head.add(eye);
    }
    this.head = head;

    // 腿 ×4（上粗下细）
    this.legs = [];
    const legGeo = new THREE.CylinderGeometry(0.021, 0.016, 0.13, 8);
    legGeo.translate(0, -0.065, 0);
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const leg = new THREE.Mesh(legGeo, fur);
      leg.position.set(sx * 0.052, 0.145, sz * 0.085);
      g.add(leg);
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), fur);
      paw.position.set(0, -0.125, 0.004);
      leg.add(paw);
      this.legs.push(leg);
    }

    // 尾（两段，摆动）
    const tail = new THREE.Group();
    tail.position.set(0, 0.19, -0.15);
    g.add(tail);
    const tail1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.12, 8), fur);
    tail1.rotation.x = Math.PI * 0.62;
    tail1.position.set(0, 0.028, -0.045);
    tail.add(tail1);
    const tail2 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.015, 0.11, 8), furDark);
    tail2.rotation.x = Math.PI * 0.42;
    tail2.position.set(0, 0.075, -0.105);
    tail.add(tail2);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), furDark);
    tip.position.set(0, 0.108, -0.128);
    tail.add(tip);
    this.tail = tail;

    // 影子 blob（跟随猫，廉价但稳）
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.7),
      new THREE.MeshBasicMaterial({
        map: blobMap(), transparent: true, depthWrite: false, opacity: 0.8,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.renderOrder = 2;
    this.blob = blob;
    g.add(blob);

    g.traverse((o) => { if (o.isMesh && o !== blob) o.castShadow = true; });
    return g;
  }

  /** 输入（相机系）→ 球面移动 */
  update(dt, camForwardTangent) {
    const inp = this.input;
    this.moving = Math.abs(inp.x) + Math.abs(inp.z) > 0.05;

    // 期望方向（相机前向为前进方向）
    this._fwd.copy(camForwardTangent);       // 切平面单位向量
    this._up.copy(this._pos).normalize();
    this._right.crossVectors(this._fwd, this._up).normalize(); // 屏幕右方

    const move = this._tmp.set(0, 0, 0);
    if (this.moving) {
      move.addScaledVector(this._fwd, inp.z);
      move.addScaledVector(this._right, inp.x);
      if (move.lengthSq() > 1e-6) {
        move.normalize();
        // 目标朝向
        const targetHeading = headingOnSphere(this._pos, move);
        let dh = targetHeading - this.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        this.heading += dh * Math.min(1, TURN_SPEED * dt);
        // 位移（切平面）
        const step = WALK_SPEED * dt * Math.min(1, Math.hypot(inp.x, inp.z) * 1.2);
        this.moveOnSphere(move, step);
        this.walkPhase += step * 14;
      }
    }

    // 跳
    if (this.wantJump && this.grounded) {
      this.airV = JUMP_V;
      this.grounded = false;
    }
    this.wantJump = false;

    // 高度 = 地形 + 跳跃
    const plan = worldToPlan(this._pos);
    const groundH = terrainH(plan.x, plan.z);
    const surfaceR = R + groundH;
    if (!this.grounded) {
      this.airV -= G * dt;
      this.jumpH = (this.jumpH || 0) + this.airV * dt;
      if (this.jumpH <= 0) { this.jumpH = 0; this.grounded = true; this.airV = 0; }
    }
    const rNow = surfaceR + this.jumpH;

    this._pos.setLength(rNow);

    // 碰撞：命中墙体/建筑等则推出（plan 空间），并把结果写回球面坐标
    const hit = resolveCollisions(plan.x, plan.z, CAT_R);
    if (hit) {
      const ll = planToLatLon(hit.x, hit.z);
      this.lat = ll.lat;
      this.lon = ll.lon;
      const cr = Math.cos(ll.lat);
      this._pos.set(
        R * cr * Math.sin(ll.lon),
        R * Math.sin(ll.lat),
        R * cr * Math.cos(ll.lon)
      ).multiplyScalar(rNow / R);
    }

    // 姿态：up = 径向，前向 = heading 切向
    orientOnSphere(this.group, this._pos, this.heading);
    // 走路摆动
    const sw = this.moving && this.grounded ? 1 : 0;
    const amp = 0.5 * sw;
    const s = Math.sin(this.walkPhase), c2 = Math.sin(this.walkPhase + Math.PI);
    this.legs[0].rotation.x = s * amp;
    this.legs[1].rotation.x = c2 * amp;
    this.legs[2].rotation.x = c2 * amp;
    this.legs[3].rotation.x = s * amp;
    this.group.position.copy(this._pos);
    this.group.position.y += this.jumpH * 0 + (this.grounded ? Math.abs(Math.sin(this.walkPhase)) * 0.006 * sw : 0);
    // 身体/头部/尾随动
    this.head.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.04 * sw;
    this.tail.rotation.z = Math.sin(this.walkPhase * 0.7 + 1.2) * (0.12 + 0.25 * sw);
    this.tail.rotation.x = -0.15 + (this.moving ? 0.1 : 0) + Math.sin(this.walkPhase * 0.35) * 0.05;
    // blob 贴地
    this.blob.position.y = 0.012 - (this._pos.length() - surfaceR);
    this.blob.visible = this._pos.length() - surfaceR < 1.2;
  }

  moveOnSphere(dir, step) {
    // 在切平面移动后重投影到球面（dir 独立于 _pos；不能用 _tmp，会和 move 混叠）
    this._pos.addScaledVector(dir, step).setLength(R);
    // 经纬度更新
    const r = this._pos.length();
    this.lat = Math.asin(THREE.MathUtils.clamp(this._pos.y / r, -1, 1));
    this.lon = Math.atan2(this._pos.x, this._pos.z);
  }

  syncFromSpherical() {
    const cr = Math.cos(this.lat);
    this._pos.set(
      R * cr * Math.sin(this.lon),
      R * Math.sin(this.lat),
      R * cr * Math.cos(this.lon)
    );
    this.jumpH = 0;
    this.grounded = true;
    this.group.position.copy(this._pos);
    orientOnSphere(this.group, this._pos, this.heading);
  }

  /** 保存/读档用 */
  getState() {
    return { lat: this.lat, lon: this.lon, heading: this.heading };
  }
  setState(st) {
    this.lat = st.lat; this.lon = st.lon; this.heading = st.heading;
    this.syncFromSpherical();
  }
}

/** 球面上 p 点、切向 dir 的航向角（用于平滑转向） */
const _tN = new THREE.Vector3(), _tE = new THREE.Vector3();
function headingOnSphere(p, dir) {
  const up = _tN.copy(p).normalize();
  const north = _tE.set(0, 1, 0).sub(up.clone().multiplyScalar(up.y)).normalize();
  const east = new THREE.Vector3().crossVectors(north, up).normalize();
  // dir 在 (north, east) 基下的角度：0 = 朝北
  const dn = dir.dot(north), de = dir.dot(east);
  return Math.atan2(de, dn);
}

/** 把物体放到球面 p 上，up=径向，面朝 heading（0=北，+=东） */
const _oUp = new THREE.Vector3(), _oF = new THREE.Vector3(), _oR = new THREE.Vector3();
export function orientOnSphere(obj, p, heading) {
  _oUp.copy(p).normalize();
  // 北切向
  _oF.set(0, 1, 0).sub(_oUp.clone().multiplyScalar(_oUp.y));
  if (_oF.lengthSq() < 1e-8) _oF.set(1, 0, 0); else _oF.normalize();
  // heading 旋转：绕 up；+heading 朝东（与 headingOnSphere 一致）
  _oF.applyAxisAngle(_oUp, -heading);
  _oR.crossVectors(_oUp, _oF).normalize(); // X×Y=Z ⇒ right = up × fwd
  _oM.makeBasis(_oR, _oUp, _oF);
  obj.quaternion.setFromRotationMatrix(_oM);
}
const _oM = new THREE.Matrix4();

// 小猫专属 blob 贴图（同材质库，但独立实例避免 renderOrder 冲突）
let _blobMap = null;
function blobMap() {
  if (_blobMap) return _blobMap;
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(30,22,14,0.75)');
  g.addColorStop(0.6, 'rgba(30,22,14,0.32)');
  g.addColorStop(1, 'rgba(30,22,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _blobMap = new THREE.CanvasTexture(cv);
  return _blobMap;
}
