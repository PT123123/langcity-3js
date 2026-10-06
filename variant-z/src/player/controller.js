// 球面行走控制器：重力指向球心，地面高度由地形 GLB 射线检测给出
// 第三人称软跟随相机（轻微俯视散步镜头）
// 攀爬：跳向建筑/树干墙面 → 贴墙竖直攀爬（W 上 / S 下 / 空格蹬墙跳 / 到顶自动跃下）
import * as THREE from 'three';
import { R, clampWalk, pxFromDir, dirFromPx, eastAt, northAt } from '../world/planetMap.js';
import { buildCat } from './cat.js';

const WALK = 2.3, RUN = 4.0, TURN = 2.6, JUMP_V = 3.6, G = 9.5;
const AIR_JUMP_V = 3.2;   // 连跳（空中段）初速：略弱于首跳
const MAX_JUMPS = 2;      // 关闭无限连跳时，落地前最多起跳段数（2 = 二段跳）
const CLIMB_V = 1.35, WALL_PAD = 0.16, CLIMB_CD = 0.45;

export class Player {
  /** @param groundFn (dirUnit) => 地面半径（米）  @param spawnDir 出生球面方向 */
  constructor(scene, colliders, groundFn, spawnDir) {
    this.mesh = buildCat();
    scene.add(this.mesh);
    this.colliders = colliders;
    this.groundFn = groundFn;

    this.normal = spawnDir.clone().normalize();
    this.lat = THREE.MathUtils.radToDeg(Math.asin(this.normal.y));
    this.lon = THREE.MathUtils.radToDeg(Math.atan2(this.normal.z, this.normal.x));
    this.heading = this._eastAtSpawn();
    this.alt = 0; this.vAlt = 0;
    this.jumps = 0;          // 本次滞空已用跳跃段数（落地清零）
    this.infiniteJumps = false; // 无限连跳开关（设置面板控制）：开启后空中可反复起跳
    this.speed01 = 0;
    this.keys = {};
    this.joy = { x: 0, y: 0 };

    // 攀爬状态
    this.climbing = false;
    this._wallC = null;      // 本帧接触的墙（碰撞体）
    this._climbD = new THREE.Vector3(); // 墙面外法线（水平切向）
    this.climbTop = 0;
    this._climbCd = 0;

    this.camPos = new THREE.Vector3();
    this.camAim = new THREE.Vector3();
    this.camPitch = 0.65;  // 相机俯仰(弧度):大=俯视,小/负=仰视看天
    this.camDist = 3.8;    // 相机距离(滚轮可调)
    this.occluders = []; // 防穿墙射线检测的目标（地形 + 建筑），main.js 注入
    this.buildingBoxes = []; // 建筑包围盒：相机钻进盒子时强制贴身
    this._camRay = new THREE.Raycaster();
    this._camRay.firstHitOnly = true;

    this.mesh.position.copy(this.normal).multiplyScalar(this._groundRadius());
    this._orient();
  }

  _eastAtSpawn() {
    const e = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.normal).normalize();
    if (!isFinite(e.x)) e.set(1, 0, 0);
    return e.addScaledVector(this.normal, -e.dot(this.normal)).normalize();
  }

  _groundRadiusAt(dir) {
    try {
      return this.groundFn(dir) + 0.02;
    } catch {
      return R + 0.02;
    }
  }

  _groundRadius() {
    return this._groundRadiusAt(this.normal);
  }

  _surfaceWorld() {
    return this.normal.clone().multiplyScalar(this._groundRadius() + this.alt);
  }

  _orient() {
    const up = this.normal;
    const fwd = this.heading.clone().addScaledVector(up, -this.heading.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, fwd);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.mesh.quaternion.slerp(q, 0.25);
    this.heading = fwd;
  }

  /** 攀爬姿态：身体贴墙（背朝墙外法线、头沿墙面向上），略后仰 */
  _orientClimb() {
    const wOut = this._climbD;
    const upR = this.normal;
    const fwd = upR.clone().addScaledVector(wOut, -upR.dot(wOut)).normalize();
    const back = wOut.clone().lerp(upR, 0.3).normalize();
    const right = new THREE.Vector3().crossVectors(back, fwd).normalize();
    const m = new THREE.Matrix4().makeBasis(right, back, fwd);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.mesh.quaternion.slerp(q, 0.3);
  }

  _setFromDir(d) {
    this.normal.copy(d).normalize();
    this.lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(this.normal.y, -1, 1)));
    this.lon = THREE.MathUtils.radToDeg(Math.atan2(this.normal.z, this.normal.x));
  }

  update(dt, t) {
    const k = this.keys;
    let fwdIn = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    let turnIn = (k['KeyA'] || k['ArrowLeft'] ? 1 : 0) - (k['KeyD'] || k['ArrowRight'] ? 1 : 0);
    fwdIn += this.joy.y;
    turnIn -= this.joy.x; // 摇杆推右(joy.x>0)=右转：turnIn 正=左转，故取负
    this._climbCd = Math.max(0, this._climbCd - dt);

    if (this.climbing) {
      this._climbUpdate(dt, THREE.MathUtils.clamp(fwdIn, -1, 1), k, t);
      return;
    }

    if (Math.abs(turnIn) > 0.01) {
      // A/←(turnIn=+1) = 左转:绕法线正转把朝向带向 +X,面朝 +Z 时 +X 是猫的左侧(右手系右侧是 -X)
      this.heading.applyAxisAngle(this.normal, turnIn * TURN * dt).normalize();
    }

    // 移动（沿切向），再投影回球面
    const running = k['ShiftLeft'] || k['ShiftRight'];
    const speed = (running ? RUN : WALK) * Math.min(1, Math.abs(fwdIn));
    if (Math.abs(fwdIn) > 0.05) {
      const dir = fwdIn > 0 ? this.heading : this.heading.clone().negate();
      const world = this.mesh.position;
      world.addScaledVector(dir, speed * dt);
      const n = world.clone().normalize();
      // 海边软墙
      const clamped = clampWalk(n);
      if (clamped) n.copy(clamped);
      world.copy(n).multiplyScalar(this._groundRadius() + this.alt);
      this._setFromDir(n);
    }

    this._resolveCollisions();

    // 跳跃 / 起跳扒墙
    const grounded = this.alt <= 0.001;
    const wantJump = k['Space'] || k['KeyK'];
    let grabbed = false;
    if (wantJump && this._wallC && this._climbCd <= 0 && (grounded || this.vAlt > 0.3)) {
      grabbed = this._tryGrab();
    }
    if (!grabbed && !grounded && this.vAlt > 0.5 && fwdIn > 0.3 && this._wallC && this._climbCd <= 0) {
      grabbed = this._tryGrab(); // 上升途中撞上墙面也扒住
    }
    if (grabbed) {
      k['Space'] = false; k['KeyK'] = false;
    } else if (wantJump && (grounded || this.infiniteJumps || this.jumps < MAX_JUMPS)) {
      // 地面起跳 + 空中连跳：开启无限连跳时不限段数，否则落地前最多 MAX_JUMPS 段
      this.vAlt = grounded ? JUMP_V : AIR_JUMP_V;
      this.jumps = grounded ? 1 : this.jumps + 1;
      k['Space'] = false; k['KeyK'] = false;
    }
    this.vAlt -= G * dt;
    this.alt += this.vAlt * dt;
    if (this.alt < 0) { this.alt = 0; this.vAlt = 0; this.jumps = 0; }

    this.mesh.position.copy(this._surfaceWorld());
    this._orient();

    // 主角 blob 软影:贴地跟随;跳起时拉大淡出,攀爬(贴墙)时隐藏
    const blob = this.mesh.userData.blob;
    if (blob) {
      blob.visible = !this.climbing;
      if (blob.visible) {
        blob.position.y = 0.025 - this.alt;
        const k = Math.min(1, this.alt / 1.4);
        blob.material.opacity = 0.4 * (1 - k * 0.85);
        const s = 1 + k * 0.7;
        blob.scale.set(s, s, 1);
      }
    }
    this.speed01 += ((Math.abs(fwdIn) > 0.05 ? Math.min(1, speed / RUN) : 0) - this.speed01) * Math.min(1, dt * 8);
    this.mesh.userData.animate(t, dt, { speed01: this.speed01, grounded: this.alt <= 0.001, climbing: false, vAlt: this.vAlt });
  }

  /** 攀爬中：沿墙竖直移动，贴墙距离固定；W 上 S 下，空格蹬墙跳，到顶自动跃下 */
  _climbUpdate(dt, fwdIn, k, t) {
    const c = this._wallC;
    this.alt = Math.max(0, this.alt + CLIMB_V * fwdIn * dt);
    const th = (c.r + WALL_PAD) / R;
    const p = c.n.clone().multiplyScalar(Math.cos(th)).addScaledVector(this._climbD, Math.sin(th));
    this._setFromDir(p);
    this.mesh.position.copy(p).multiplyScalar(this._groundRadius() + this.alt);
    this._orientClimb();
    this.speed01 = Math.abs(fwdIn) * 0.7;

    if (k['Space'] || k['KeyK']) {
      k['Space'] = false; k['KeyK'] = false;
      this._leaveClimb(0.55, 3.4, true);
    } else if (this.alt >= this.climbTop) {
      this._leaveClimb(0.65, 1.4, true);
    } else if (this.alt <= 0.001 && fwdIn <= 0.05) {
      this._leaveClimb(0.5, 0, false);
    }
    this.mesh.userData.animate(t, dt, {
      speed01: this.speed01,
      grounded: !this.climbing && this.alt <= 0.001,
      climbing: this.climbing,
      vAlt: this.vAlt,
    });
  }

  /** 尝试扒住本帧接触的墙；墙面太矮（<0.6m）不爬 */
  _tryGrab() {
    const c = this._wallC;
    const p = this.mesh.position.clone().normalize();
    const d = p.clone().addScaledVector(c.n, -p.dot(c.n));
    if (d.lengthSq() < 1e-8) return false;
    d.normalize();
    const top = this._roofTopAt(c, d);
    if (!(top >= 0.6)) return false;
    this.climbing = true;
    this._climbD.copy(d);
    this.climbTop = top;
    this.vAlt = 0;
    if (this.alt < 0.2) this.alt = 0;
    // 朝向墙面（相机跟随用）
    const h = d.clone().negate();
    h.addScaledVector(this.normal, -h.dot(this.normal)).normalize();
    this.heading.copy(h);
    return true;
  }

  /** 沿贴墙点的径向，向上找建筑包围盒顶（步进 0.2m） */
  _roofTopAt(c, d) {
    if (!c.box) return 2.4;
    const th = (c.r + WALL_PAD) / R;
    const p = c.n.clone().multiplyScalar(Math.cos(th)).addScaledVector(d, Math.sin(th));
    const g = this._groundRadiusAt(p);
    const box = c.box;
    let top = 0, inside = false;
    for (let alt = 0.3; alt <= 14; alt += 0.2) {
      const pt = p.clone().multiplyScalar(g + alt);
      const hit = pt.x > box.min.x - 0.05 && pt.x < box.max.x + 0.05
        && pt.y > box.min.y - 0.05 && pt.y < box.max.y + 0.05
        && pt.z > box.min.z - 0.05 && pt.z < box.max.z + 0.05;
      if (hit) { top = alt; inside = true; }
      else if (inside) break;
    }
    return inside ? top + 0.1 : 0;
  }

  /** 离墙：向外挪 pushM 米（避免落地即触发碰撞），vUp 为蹬离初速 */
  _leaveClimb(pushM, vUp, faceAway) {
    const c = this._wallC;
    const th = Math.min((c.r + WALL_PAD + pushM) / R, Math.PI - 1e-3);
    const p = c.n.clone().multiplyScalar(Math.cos(th)).addScaledVector(this._climbD, Math.sin(th));
    this._setFromDir(p);
    this.mesh.position.copy(p).multiplyScalar(this._groundRadius() + this.alt);
    this.climbing = false;
    this._climbCd = CLIMB_CD;
    this.vAlt = vUp;
    this.jumps = vUp > 0 ? 1 : 0; // 蹬墙跳算作已用一段，落地前还能接一次连跳
    if (faceAway) {
      this.heading.copy(this._climbD);
      this.heading.addScaledVector(this.normal, -this.heading.dot(this.normal)).normalize();
    }
  }

  /** 圆形碰撞体推挤修正；记录本帧接触的墙（供起跳扒墙用） */
  _resolveCollisions() {
    const pr = 0.35;
    let budget = 0.4; // 每帧总修正上限（米）：防"弹球式"连环推挤把猫甩飞
    const p = this.mesh.position.clone().normalize();
    this._wallC = null;

    const hits = [];
    for (const c of this.colliders) {
      const cosA = THREE.MathUtils.clamp(p.dot(c.n), -1, 1);
      const chord = Math.acos(cosA) * R;
      const rc = c.r + pr;
      if (chord < rc) hits.push({ c, chord, rc });
    }
    hits.sort((a, b) => a.chord - b.chord);

    let cur = p.clone();
    for (const { c, rc } of hits) {
      if (budget <= 0.001) break;
      const cosA = THREE.MathUtils.clamp(cur.dot(c.n), -1, 1);
      const chord = Math.acos(cosA) * R;
      if (chord >= rc) continue;
      this._wallC = c; // 贴着墙（攀爬抓点）
      const dir = cur.clone().addScaledVector(c.n, -cosA);
      if (dir.lengthSq() < 1e-8) continue;
      dir.normalize();
      const pushLen = Math.min(rc - chord, budget);
      const newAngle = (chord + pushLen) / R;
      cur = c.n.clone().multiplyScalar(Math.cos(newAngle)).addScaledVector(dir, Math.sin(newAngle));
      budget -= pushLen;
    }

    if (!cur.equals(p)) {
      this.mesh.position.copy(cur.multiplyScalar(this._groundRadius() + this.alt));
      this._setFromDir(cur);
    }
  }

  /** 第三人称相机：俯仰可调(上拖看天)、滚轮缩放、软跟随、被建筑挡住时拉近 */
  updateCamera(camera, dt) {
    const up = this.normal;
    const fwd = this.heading;
    const target = this.mesh.position;
    // 俯仰轨道:camPitch 越大相机越高(俯视),越小越低(仰视看天)
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    let want = target.clone()
      .addScaledVector(up, Math.max(this.camDist * sp, 0.45)) // 仰视时也别钻到地面以下
      .addScaledVector(fwd, -this.camDist * cp);
    // 相机不要钻进星球
    const minR = this._groundRadius() + 0.4;
    if (want.length() < minR) want.setLength(minR);

    // 仰视时抬高注视点越过猫头看天;默认俯仰(0.65)时 aimUp=0.45 与原版一致
    const aimUp = Math.max(0.2, 0.45 + Math.max(0, -this.camPitch) * 2.6);
    const aim = target.clone().addScaledVector(up, aimUp);
    const camDir = want.clone().sub(aim);
    const len = camDir.length();
    camDir.normalize();
    if (this.occluders.length) {
      this._camRay.set(aim, camDir);
      this._camRay.far = len;
      const hits = this._camRay.intersectObjects(this.occluders, false);
      if (hits.length > 0) {
        const d = Math.max(0.5, hits[0].distance - 0.25);
        want = aim.clone().addScaledVector(camDir, d);
      }
    }
    // 相机钻进建筑包围盒 → 就近拉近贴脸(原先瞬移头顶俯视,是"镜头突然甩动"的元凶)
    for (const b of this.buildingBoxes) {
      if (b.containsPoint(want) || b.distanceToPoint(want) < 0.15) {
        want = aim.clone().addScaledVector(camDir, 0.7);
        break;
      }
    }
    // 只有真的快贴脸才直接生效,其余一律软跟随(镜头不再突然跳动)
    if (want.distanceTo(aim) < 0.9) this.camPos.copy(want);
    else this.camPos.lerp(want, Math.min(1, dt * 5));
    camera.position.copy(this.camPos);
    this.camAim.lerp(aim, Math.min(1, dt * 7));
    camera.up.copy(up);
    camera.lookAt(this.camAim);
  }

  /** 拖动转头：直接绕法线转 heading（弧度） */
  turnBy(angleRad) {
    this.heading.applyAxisAngle(this.normal, angleRad).normalize();
  }

  /** 拖动俯仰：上拖(dy<0)抬头看天，下拖低头 */
  pitchBy(dAngle) {
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dAngle, -0.5, 1.25);
  }

  /** 滚轮缩放：拉近/拉远视角（米） */
  zoomBy(d) {
    this.camDist = THREE.MathUtils.clamp(this.camDist + d, 2.2, 8.5);
  }

  saveState() {
    const [px, py] = pxFromDir(this.normal);
    return { px, py, hx: this.heading.x, hy: this.heading.y, hz: this.heading.z };
  }
  loadState(s) {
    if (!s || s.px === undefined) return;
    this.climbing = false;
    this._setFromDir(dirFromPx(s.px, s.py));
    this.mesh.position.copy(this.normal).multiplyScalar(this._groundRadius());
    if (s.hx !== undefined) {
      this.heading.set(s.hx, s.hy, s.hz).normalize();
      this.heading.addScaledVector(this.normal, -this.heading.dot(this.normal)).normalize();
    }
  }

  /** 传送到地图像素落点：朝向保持切向投影，相机直接就位（软跟随跨半个星球会甩镜头） */
  teleportTo(px, py) {
    this.climbing = false;
    this._wallC = null;
    const d = this._findDropSpot(dirFromPx(px, py).normalize());
    this._setFromDir(d);
    this.heading.addScaledVector(this.normal, -this.heading.dot(this.normal));
    if (this.heading.lengthSq() < 1e-6) this.heading.copy(this._eastAtSpawn());
    this.heading.normalize();
    this.alt = 0; this.vAlt = 0;
    this.jumps = 0;
    this.mesh.position.copy(this.normal).multiplyScalar(this._groundRadius());
    this._orient();
    this.camPos.copy(this.mesh.position)
      .addScaledVector(this.normal, 2.4)
      .addScaledVector(this.heading, -2.8);
    this.camAim.copy(this.mesh.position).addScaledVector(this.normal, 0.45);
  }

  /** 落点被建筑碰撞圈/海面/软墙占住时，在切平面 8 方向由近及远找空位 */
  _findDropSpot(d0) {
    const minR = (this.waterRadius || R * 0.995) + 0.3;
    const free = (d) => {
      if (clampWalk(d)) return false;
      if (this._groundRadiusAt(d) < minR) return false;
      for (const c of this.colliders) {
        if (Math.acos(THREE.MathUtils.clamp(d.dot(c.n), -1, 1)) * R < c.r + 0.5) return false;
      }
      return true;
    };
    if (free(d0)) return d0;
    const e = eastAt(d0), n = northAt(d0);
    for (const dist of [3.2, 4.6, 6.2]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.4;
        const cand = d0.clone()
          .addScaledVector(e, Math.cos(a) * dist / R)
          .addScaledVector(n, Math.sin(a) * dist / R)
          .normalize();
        if (free(cand)) return cand;
      }
    }
    return d0; // 实在没空位就原点落，碰撞推挤会兜底
  }
}
