// 一次性生成脚本：把根目录城市版 src/world/layout.js 的手写落点表
// 转成 variant-z 的 kind 命名 + plan 米 + 度数朝向，输出 variant-z/src/world/cityPlan.js。
// 用法：node tools/gen-city-plan.mjs（cwd 必须是仓库根，three 从根 node_modules 解析）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// 城市版在仓库根：variant-z/tools/../../src/world/layout.js
const { PLACES, FOREST_TREES } = await import(
  new URL('../../src/world/layout.js', import.meta.url).href);

// kind：城市版叫法 → variant-z 的 BUILDERS 键名
const KIND = {
  supermarket: 'super', postOffice: 'post_office', shrine: 'temple', hydrant: 'fireplug',
  clothesline: 'laundry', potted: 'potplant', flowers: 'flower', flowerbed: 'flower',
  grassTuft: 'grass', parkingSign: 'parksign', catNpc: 'cat', wall: 'lowwall',
  trafficLight: 'traffic_light', phoneBox: 'phone_box', plazaFlag: 'plaza_flag',
};
// 城市版把角色写在 word 里，variant-z 的 npc 构建器按 o.npc 查骨骼模型
const NPC = {
  onna: 'young-lady', ojiisan: 'chef', kodomo: 'threekid', hito: 'office-worker',
  otona: 'office-worker', otoko: 'musician', gakusei: 'scout', sensei: 'office-worker',
  obaasan: 'oldwoman', akachan: 'threekid',
};
// 斑马线在 variant-z 是实体路面条带的一部分（townPlan.CROSSWALKS），不当摆件
const DROP = new Set(['crossing']);
// word id 必须是 variant-z 词表里有的，否则摆件放下去了却不能交互
const WORD_FIX = { parkingSign: 'chuushajou', fountain: 'funsui', potted: 'hachiue' };

const out = [];
const dropped = [];
for (const p of PLACES) {
  if (DROP.has(p.kind)) { dropped.push(p.kind); continue; }
  const kind = KIND[p.kind] || p.kind;
  const e = { kind, word: WORD_FIX[p.kind] || p.word, plan: [p.x, p.z], yaw: +(p.rotY * 180 / Math.PI).toFixed(2) };
  if (NPC[p.word]) e.npc = NPC[p.word];
  if (p.v !== undefined) e.v = p.v;
  out.push(e);
}
for (const t of FOREST_TREES) out.push({ kind: 'tree', word: 'tree', plan: [+t.x.toFixed(2), +t.z.toFixed(2)], yaw: +(t.rotY * 180 / Math.PI).toFixed(2), forest: 1 });

const lines = out.map((e) => '  ' + JSON.stringify(e)).join(',\n');

const src = `// 城市版落点表（由根目录 src/world/layout.js 生成：tools/gen-city-plan.mjs）
// 这是「之前那张像城市的图」的全部手写内容：市政区、公园、神社、海滩、街具、NPC、动物、绿植环。
// 坐标是 plan 米（x 向东、z 向南，原点 = 站前广场中心），与 townPlan.js 的街网同一口径；
// yaw 是度数且与 variant-z 的 basisAt 同号（两边都是「本地 +Z = 朝南，绕天顶转向东」）。
// 合并口径：这张表负责镇区核心（街道两侧），planet.json 的 245 个原版落点负责岛的外圈
// —— 两张手写图接成一张，谁也不覆盖谁。
export const CITY_OBJECTS = [
${lines},
];

// 生成期丢弃的条目（在 variant-z 另有归属）：${dropped.length ? dropped.join(', ') : '无'}
// kind 改名表：${Object.entries(KIND).map(([a, b]) => `${a}→${b}`).join(', ')}
`;
const dest = path.resolve(here, '../src/world/cityPlan.js');
fs.writeFileSync(dest, src);
console.log(`CITY_OBJECTS ${out.length} 条 → ${dest}`);
const kinds = {};
for (const e of out) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
console.log('kinds:', Object.entries(kinds).map(([k, v]) => `${k}:${v}`).sort().join(' '));
