// schema.js — town-plan.json 的形状闸门与内容指纹：纯函数，浏览器/Node/vite 配置三处共用。
// 谁写盘都得先过 validatePlan，否则一条写坏的路面材质就能让整张图渲染不出来。
import { ROAD_SURFACES } from './terrain.js';

/** 简易内容指纹（djb2 + 长度），够判「服务器上的版本变没变」 */
export function sha16(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16) + ':' + text.length;
}

/** 通过返回 null，否则返回第一条人话错误 */
export function validatePlan(p) {
  if (!p || typeof p !== 'object') return '不是 JSON 对象';
  for (const k of ['R', 'LAT0', 'LON0', 'sidewalkW', 'beachZ', 'forestLat']) {
    if (typeof p[k] !== 'number') return `${k} 必须是数字`;
  }
  for (const k of ['hills', 'roads', 'crosswalks', 'places', 'forestTrees']) {
    if (!Array.isArray(p[k])) return `${k} 必须是数组`;
  }
  // 空路网/空物件会把小镇直接写没，这种「形状合法但内容是空」的写入必须挡掉
  if (!p.places.length) return 'places 不能为空（存下去小镇就没东西了）';
  if (!p.roads.length) return 'roads 不能为空（存下去就没路了）';
  for (const [name, o] of [['plaza', p.plaza], ['parking', p.parking]]) {
    if (!o || typeof o !== 'object') return `${name} 必须是对象`;
  }
  for (const placeList of [p.places, p.forestTrees]) {
    for (const o of placeList) {
      if (typeof o.x !== 'number' || typeof o.z !== 'number') return '物件必须有数字 x/z';
      // 外观字段：写坏了不会崩，但会存出一张渲染不出来的图
      for (const k of ['wall', 'roof']) {
        if (o[k] !== undefined && (!Number.isInteger(o[k]) || o[k] < 0 || o[k] > 0xffffff)) return `${k} 必须是 0~0xffffff 的整数色号`;
      }
      if (o.floors !== undefined && (!Number.isInteger(o.floors) || o.floors < 1 || o.floors > 20)) return 'floors 必须是 1~20 的整数层数';
      if (o.s !== undefined && !(o.s > 0.05 && o.s < 20)) return '物件尺度 s 要在 0.05~20 之间';
      if (o.rotY !== undefined && !Number.isFinite(o.rotY)) return '物件朝向 rotY 必须是数字';
    }
  }
  for (const r of p.roads) {
    if (Array.isArray(r.pts)) {
      if (r.pts.length < 2) return '道路的 pts 至少要两个节点';
      if (r.x1 !== undefined) return '道路不能同时写 pts 与 x1/x2（直线与折线二选一）';
      for (const q of r.pts) {
        if (!Array.isArray(q) || q.length < 2 || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) return '道路 pts 节点必须是 [x, z] 两个数字';
      }
      if (r.e !== undefined) {
        if (!Array.isArray(r.e) || r.e.length !== r.pts.length || !r.e.every((v) => Number.isFinite(v))) {
          return '道路 e 必须是与 pts 等长的数字数组（逐节点抬升）';
        }
      }
    } else {
      for (const k of ['x1', 'z1', 'x2', 'z2']) {
        if (typeof r[k] !== 'number') return `道路缺少数字字段 ${k}`;
      }
      for (const k of ['e1', 'e2', 'efade']) {
        if (r[k] !== undefined && typeof r[k] !== 'number') return `道路 ${k} 必须是数字`;
      }
    }
    if (typeof r.w !== 'number' || !(r.w > 0)) return '道路半宽 w 必须是正数';
    if (r.surf !== undefined && !ROAD_SURFACES.includes(r.surf)) return `道路 surf 只能是 ${ROAD_SURFACES.join('/')}`;
  }
  // 造成（土方）：形状错了猫会踩空或卡在墙外，写入前逐条查数字
  for (const [name, list, need] of [
    ['terraces', p.terraces, ['x', 'z', 'hw', 'hd', 'h']],
    ['flights', p.flights, ['x', 'z', 'w', 'run', 'rise']],
  ]) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) return `${name} 必须是数组`;
    for (const o of list) {
      for (const k of need) if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) return `${name} 条目缺少数字字段 ${k}`;
      if (o.hw !== undefined && (o.hw <= 0 || o.hd <= 0)) return 'terraces 的 hw/hd 必须为正';
      if (o.run !== undefined && o.run <= 0) return 'flights 的 run 必须为正';
      if (o.edge !== undefined && o.edge !== 'wall' && o.edge !== 'slope') return 'terraces 的 edge 只能是 wall 或 slope';
      if (o.kind !== undefined && o.kind !== 'stair' && o.kind !== 'ramp') return 'flights 的 kind 只能是 stair 或 ramp';
      // steps=0 是「按 0.34 米自动分阶」的写法，不是坏数据
      if (o.steps !== undefined && (!Number.isInteger(o.steps) || o.steps < 0)) return 'flights 的 steps 必须是非负整数（0=自动）';
    }
  }
  return null;
}
