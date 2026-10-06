// 星球本体：岛屿地形（顶点色 + 高度隆起）、海水、云环、球面坐标工具
import * as THREE from 'three';
import { M } from './materials.js';

export const R = 30; // 星球半径（米）

// ---------- 球面坐标 ----------
// latDeg: 距赤道的仰角(0=赤道, 90=北极)；lonDeg: 绕 Y 轴经度
export function surfacePos(latDeg, lonDeg, radius = R) {
  const lat = THREE.MathUtils.degToRad(latDeg), lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.sin(lon)
  );
}

export function normalAt(latDeg, lonDeg) {
  return surfacePos(latDeg, lonDeg, 1);
}

/** 东向切向量（经度增大方向） */
export function eastAt(latDeg, lonDeg) {
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(-Math.sin(lon), 0, Math.cos(lon));
}

/** 物体朝向四元数：up=球面法线，forward=东向再绕法线转 rotY */
export function orientAt(latDeg, lonDeg, rotYDeg = 0) {
  const n = normalAt(latDeg, lonDeg);
  let fwd = eastAt(latDeg, lonDeg);
  fwd = fwd.sub(n.clone().multiplyScalar(fwd.dot(n))).normalize();
  if (rotYDeg) fwd.applyAxisAngle(n, THREE.MathUtils.degToRad(-rotYDeg));
  const xAxis = new THREE.Vector3().crossVectors(n, fwd).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, n, fwd);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// ---------- 确定性噪声 ----------
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return hash2(xi, yi) * (1 - u) * (1 - v) + hash2(xi + 1, yi) * u * (1 - v)
       + hash2(xi, yi + 1) * (1 - u) * v + hash2(xi + 1, yi + 1) * u * v;
}

// 地形高度：岛屿冠(lat>10°)隆起，向海滩过渡，海床下沉
export function landRadius(latDeg, lonDeg) {
  const t = THREE.MathUtils.smoothstep(latDeg, 5.5, 11);
  const bump = 0.55 + (vnoise(lonDeg * 0.35, latDeg * 0.5) - 0.5) * 0.5;
  const floor = -0.4;
  return R + THREE.MathUtils.lerp(floor, bump, t);
}

// ---------- 星球网格 ----------
export function buildPlanet() {
  const group = new THREE.Group();

  const seg = 140, rings = 90;
  const geo = new THREE.SphereGeometry(R + 0.6, seg, rings);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), cGrassA = new THREE.Color(0x8fa075), cGrassB = new THREE.Color(0x9db083),
        cDry = new THREE.Color(0xaab189), cSand = new THREE.Color(0xd9c9a4), cShallow = new THREE.Color(0x86ada3),
        cDeep = new THREE.Color(0x648d94);

  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(v.y / (R + 0.6), -1, 1)));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(v.z, v.x));
    const r = landRadius(lat, lon);
    v.normalize().multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);

    const n1 = vnoise(lon * 0.5 + 7, lat * 0.8);
    const n2 = vnoise(lon * 2.1, lat * 2.4 + 3);
    if (lat > 11.5) {
      c.copy(cGrassA).lerp(cGrassB, n1);
      if (n2 > 0.8) c.lerp(cDry, 0.4); // 干草斑
      c.offsetHSL(0, 0, (n2 - 0.5) * 0.03);
    } else if (lat > 5.0) {
      // 海滩
      c.copy(cSand).lerp(cGrassA, THREE.MathUtils.smoothstep(lat, 9.5, 11.5));
      c.offsetHSL(0, 0, (n2 - 0.5) * 0.04);
    } else if (lat > -2) {
      c.copy(cShallow);
    } else {
      c.copy(cShallow).lerp(cDeep, THREE.MathUtils.smoothstep(-lat, 2, 40));
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
  }));
  land.receiveShadow = true;
  group.add(land);

  // ---- 海水：略低于陆地的球壳，柔和反光 ----
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x7fb3b5, roughness: 0.25, metalness: 0.05,
    transparent: true, opacity: 0.9,
  });
  const water = new THREE.Mesh(new THREE.SphereGeometry(R - 0.05, 96, 64), waterMat);
  group.add(water);

  // ---- 云环：几朵慢速环绕的软白云 ----
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 1, metalness: 0, flatShading: true });
  const clouds = new THREE.Group();
  const cloudGeo = (() => {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.IcosahedronGeometry(0.9 + Math.random() * 0.7, 1);
      g.scale(1.6 + Math.random(), 0.55, 1.1 + Math.random() * 0.6);
      g.translate((i - 1.5) * 1.5, Math.random() * 0.4, Math.random() * 0.8);
      parts.push(g);
    }
    return mergeGeoms(parts);
  })();
  for (let i = 0; i < 10; i++) {
    const cl = new THREE.Mesh(cloudGeo, cloudMat);
    const lat = 8 + Math.random() * 48, lon = Math.random() * 360;
    cl.position.copy(surfacePos(lat, lon, R + 10 + Math.random() * 5));
    cl.quaternion.copy(orientAt(lat, lon));
    cl.scale.setScalar(0.9 + Math.random() * 0.9);
    clouds.add(cl);
  }
  group.add(clouds);
  group.userData.clouds = clouds;

  return { group, waterMat, cloudMat };
}

// 简易几何合并（免引 examples，够用）
export function mergeGeoms(geoms) {
  let vCount = 0, iCount = 0, hasIndex = true;
  for (const g of geoms) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; if (!g.index) hasIndex = false; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geoms) {
    if (g.attributes.uv === undefined) {
      const cnt = g.attributes.position.count;
      const u = new Float32Array(cnt * 2);
      g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
    }
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
      io += ia.length;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = i + vo;
      io += g.attributes.position.count;
    }
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (hasIndex || true) out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---------- 道路：沿球面的丝带 ----------
/**
 * 在两点间铺一条球面沥青路。points: [{lat,lon},...] 折线；width 米。
 * 返回 Mesh（已抬高避免 z-fight），并把每段中心点存进 userData.centerline 供摆放参考。
 */
export function roadRibbon(points, width = 1.6, color = 0x6b6663) {
  const LIFT = 0.06; // 抬高避免 z-fight
  const verts = [], norms = [], uvs = [], idxArr = [];
  const centerline = [];
  let row = 0;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  const samplePts = [];
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s], b = points[s + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(b.lat - a.lat, b.lon - a.lon) * 1.4));
    for (let i = 0; i < steps; i++) samplePts.push({ lat: THREE.MathUtils.lerp(a.lat, b.lat, i / steps), lon: THREE.MathUtils.lerp(a.lon, b.lon, i / steps) });
  }
  samplePts.push(points[points.length - 1]);

  for (let i = 0; i < samplePts.length; i++) {
    const p = samplePts[i];
    const prev = samplePts[Math.max(0, i - 1)], next = samplePts[Math.min(samplePts.length - 1, i + 1)];
    const dir = surfacePos(next.lat, next.lon).sub(surfacePos(prev.lat, prev.lon)).normalize();
    const n = normalAt(p.lat, p.lon);
    const side = new THREE.Vector3().crossVectors(n, dir).normalize();
    const hw = width / 2;
    const r0 = landRadius(p.lat, p.lon) + LIFT;
    const c = surfacePos(p.lat, p.lon, r0);
    centerline.push(c.clone());
    const e0 = c.clone().addScaledVector(side, hw);
    const e1 = c.clone().addScaledVector(side, -hw);
    verts.push(e0.x, e0.y, e0.z, e1.x, e1.y, e1.z);
    norms.push(n.x, n.y, n.z, n.x, n.y, n.z);
    const u = i / (samplePts.length - 1);
    uvs.push(u, 0, u, 1);
    if (i > 0) {
      idxArr.push(row, row + 1, row + 2, row + 1, row + 3, row + 2);
      row += 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idxArr);
  const mesh = new THREE.Mesh(geo, M(color, { rough: 0.95 }));
  mesh.receiveShadow = true;
  mesh.userData.centerline = centerline;
  return mesh;
}

/** 圆形铺装广场（贴地圆盘） */
export function pavedDisc(lat, lon, radius = 3, color = 0xa89f92) {
  const n = normalAt(lat, lon);
  const c = surfacePos(lat, lon, landRadius(lat, lon) + 0.04);
  const geo = new THREE.CircleGeometry(radius, 36);
  geo.rotateX(-Math.PI / 2);
  const q = orientAt(lat, lon);
  const mesh = new THREE.Mesh(geo, M(color, { rough: 0.85 }));
  mesh.position.copy(c);
  mesh.quaternion.copy(q);
  mesh.receiveShadow = true;
  return mesh;
}
