// 全球撒细节：路缝杂草 / 碎石砾 / Kenney 岩石堆 / 草地草叶。
// 表面类型由 surfaceAt 命中三角形的顶点色判定（灰=路面/岩石，暖=沙泥，绿=草），
// 草叶与砾石走 InstancedMesh（整个星球各一条 draw call），岩石堆用 GLB 克隆限量摆放
import * as THREE from 'three';
import { R } from './planetMap.js';
import { buildRockPile } from './props.js';

const UP = new THREE.Vector3(0, 1, 0);
const STONE_COLS = [0x8d867c, 0x9a938a, 0x7d7870, 0xa39a8c, 0x8f8577];
const WEED_COLS = [0x5f7a4d, 0x6b8256, 0x74885e, 0x57704a];   // 灰面路缝杂草（深绿）
const DRY_COLS = [0xa89a6a, 0xb5a678, 0x9a8f62];              // 暖沙枯草（卡其）
const GRASS_COLS = [0x7d9a6c, 0x6f8b60, 0x86a274];            // 草地草叶（亮绿）

function jitCol(hex) {
  const c = new THREE.Color(hex);
  c.offsetHSL((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.05);
  return c;
}

/** 随机球面方向（限可走带内，与 planet.json 落点同一纬度带） */
function randDir(maxPhiDeg) {
  const phi = Math.acos(1 - Math.random() * (1 - Math.cos(THREE.MathUtils.degToRad(maxPhiDeg))));
  const lam = Math.random() * Math.PI * 2;
  return new THREE.Vector3(Math.sin(phi) * Math.sin(lam), Math.cos(phi), Math.sin(phi) * Math.cos(lam));
}

export function scatterDetails(scene, planet, colliders = []) {
  const group = new THREE.Group();
  scene.add(group);

  const stoneMats = [], stoneCols = [];
  const bladeMats = [], bladeCols = [];
  let rockBudget = 40;

  const stoneGeo = new THREE.IcosahedronGeometry(1, 0);
  const bladeGeo = new THREE.ConeGeometry(1, 1, 4);
  bladeGeo.translate(0, 0.5, 0); // 底部为原点，贴地长

  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();

  const nearBuilding = (dir) => {
    for (const c of colliders) {
      if (dir.angleTo(c.n) < (c.r + 0.7) / R) return true;
    }
    return false;
  };

  const TRIALS = 1700;
  for (let i = 0; i < TRIALS; i++) {
    const dir = randDir(55);
    const h = planet.surfaceAt(dir);
    if (!h.hit || !h.col) continue;
    if (h.pos.length() < planet.waterRadius + 0.2) continue;   // 别撒进水里
    if (h.normal.y < 0.55) continue;                            // 陡壁不撒
    if (nearBuilding(dir)) continue;                            // 建筑圈里不撒
    const sat = Math.max(h.col.r, h.col.g, h.col.b) - Math.min(h.col.r, h.col.g, h.col.b);
    const kind = h.grass > 0.45 ? 'grass' : (sat < 0.10 ? 'gray' : 'sand');
    const r = Math.random();

    if (kind === 'gray') {
      // 灰面（马路/广场）：只撒路缝杂草和细碎石，岩石堆不上路——路面留干净可走
      if (r < 0.30) {
        const n = 2 + (Math.random() * 2 | 0);
        for (let k = 0; k < n && bladeMats.length < 900; k++) {
          v3.copy(h.pos).addScaledVector(h.normal, 0.006);
          q.setFromUnitVectors(UP, h.normal);
          q2.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.6, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.6));
          q.multiply(q2);
          const bh = 0.1 + Math.random() * 0.13;
          s3.set(0.016 + Math.random() * 0.012, bh, 0.016 + Math.random() * 0.012);
          m4.compose(v3, q, s3);
          bladeMats.push(m4.clone());
          bladeCols.push(jitCol(WEED_COLS[Math.random() * WEED_COLS.length | 0]));
        }
      } else if (r < 0.52) {
        const n = 2 + (Math.random() * 2 | 0);
        for (let k = 0; k < n && stoneMats.length < 700; k++) {
          const s = 0.045 + Math.random() * 0.08;
          v3.copy(h.pos).addScaledVector(h.normal, s * 0.3).addScaledVector(UP, 0);
          // 碎石摊开一点，别全叠在中心
          q.setFromUnitVectors(UP, h.normal);
          v3.addScaledVector(new THREE.Vector3(Math.cos(k * 2.4 + i), 0, Math.sin(k * 2.4 + i)).applyQuaternion(q), s * 1.6);
          q2.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
          q.multiply(q2);
          s3.set(s, s * (0.55 + Math.random() * 0.3), s * (0.8 + Math.random() * 0.4));
          m4.compose(v3, q, s3);
          stoneMats.push(m4.clone());
          stoneCols.push(jitCol(STONE_COLS[Math.random() * STONE_COLS.length | 0]));
        }
      }
    } else if (kind === 'sand') {
      // 暖沙：砾石 + 枯草 + 偶尔岩石堆
      if (r < 0.34) {
        const n = 3 + (Math.random() * 3 | 0);
        for (let k = 0; k < n && stoneMats.length < 700; k++) {
          const s = 0.04 + Math.random() * 0.11;
          v3.copy(h.pos).addScaledVector(h.normal, s * 0.3);
          q.setFromUnitVectors(UP, h.normal);
          v3.addScaledVector(new THREE.Vector3(Math.cos(k * 2.1 + i * 0.7), 0, Math.sin(k * 2.1 + i * 0.7)).applyQuaternion(q), s * 1.8);
          q2.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
          q.multiply(q2);
          s3.set(s, s * (0.5 + Math.random() * 0.3), s * (0.8 + Math.random() * 0.4));
          m4.compose(v3, q, s3);
          stoneMats.push(m4.clone());
          stoneCols.push(jitCol(STONE_COLS[Math.random() * STONE_COLS.length | 0]));
        }
      } else if (r < 0.44) {
        for (let k = 0; k < 3 && bladeMats.length < 900; k++) {
          v3.copy(h.pos).addScaledVector(h.normal, 0.006);
          q.setFromUnitVectors(UP, h.normal);
          q2.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.7, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.7));
          q.multiply(q2);
          s3.set(0.014 + Math.random() * 0.01, 0.09 + Math.random() * 0.11, 0.014 + Math.random() * 0.01);
          m4.compose(v3, q, s3);
          bladeMats.push(m4.clone());
          bladeCols.push(jitCol(DRY_COLS[Math.random() * DRY_COLS.length | 0]));
        }
      } else if (r < 0.46 && rockBudget > 0) {
        rockBudget--;
        const rk = buildRockPile('rk' + i, { scale: 0.8 + Math.random() * 0.9 });
        rk.position.copy(h.pos).addScaledVector(h.normal, -0.02);
        rk.quaternion.setFromUnitVectors(UP, h.normal);
        q2.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
        rk.quaternion.multiply(q2);
        group.add(rk);
      }
    } else {
      // 草地：偶尔一撮亮草叶，破一下大色块
      if (r < 0.13) {
        for (let k = 0; k < 3 && bladeMats.length < 900; k++) {
          v3.copy(h.pos).addScaledVector(h.normal, 0.006);
          q.setFromUnitVectors(UP, h.normal);
          q2.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.55, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.55));
          q.multiply(q2);
          s3.set(0.015 + Math.random() * 0.011, 0.1 + Math.random() * 0.14, 0.015 + Math.random() * 0.011);
          m4.compose(v3, q, s3);
          bladeMats.push(m4.clone());
          bladeCols.push(jitCol(GRASS_COLS[Math.random() * GRASS_COLS.length | 0]));
        }
      }
    }
  }

  const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, flatShading: true });
  const bladeMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true });
  if (stoneMats.length) {
    const im = new THREE.InstancedMesh(stoneGeo, stoneMat, stoneMats.length);
    stoneMats.forEach((m, k) => { im.setMatrixAt(k, m); im.setColorAt(k, stoneCols[k]); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.receiveShadow = true;
    group.add(im);
  }
  if (bladeMats.length) {
    const im = new THREE.InstancedMesh(bladeGeo, bladeMat, bladeMats.length);
    bladeMats.forEach((m, k) => { im.setMatrixAt(k, m); im.setColorAt(k, bladeCols[k]); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im);
  }

  console.log(`scatter: stones ${stoneMats.length}, blades ${bladeMats.length}, rocks ${40 - rockBudget}`);
  return group;
}
