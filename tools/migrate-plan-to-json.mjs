// tools/migrate-plan-to-json.mjs — 一次性迁移：把 layout.js 硬编码数据导出为 data/town-plan.json
// crosswalks 从 planet.js 的常量手抄（迁移时核对过）。
import { writeFileSync } from 'node:fs';
import {
  R, LAT0, LON0, terrainH,
  SIDEWALK_W, ROADS, PLAZA, PARKING, BEACH_Z, FOREST_LAT,
  PLACES, FOREST_TREES,
} from '../src/world/layout.js';

// layout.js 里 HILLS 未导出，手抄一份（下方自检保证与 terrainH 一致）
const HILLS = [
  { x: 0, z: -27, a: 1.3, s: 8 },
  { x: -24, z: +5, a: 0.8, s: 7 },
  { x: 21, z: +18, a: 0.6, s: 7 },
  { x: -7, z: +27, a: 0.55, s: 5 },
];

const plan = {
  R, LAT0, LON0,
  hills: HILLS,
  sidewalkW: SIDEWALK_W,
  roads: ROADS,
  plaza: PLAZA,
  parking: PARKING,
  beachZ: BEACH_Z,
  forestLat: FOREST_LAT,
  crosswalks: [
    { x: 0, z: 6.8, dir: 'h' }, { x: 0, z: -6.8, dir: 'h' },
    { x: 6.8, z: 0, dir: 'v' }, { x: -6.8, z: 0, dir: 'v' },
    { x: 0, z: 13.1, dir: 'h' }, { x: 12.9, z: 6, dir: 'v' },
    { x: -12.9, z: 6, dir: 'v' },
  ],
  places: PLACES,
  forestTrees: FOREST_TREES,
};

// 自检：JSON 数据必须能还原出与 terrainH 一致的取值
const sample = [[0, 0], [-24, 5], [21, 18], [30, -40]];
for (const [x, z] of sample) {
  let h = 0;
  for (const hl of plan.hills) {
    const dx = x - hl.x, dz = z - hl.z;
    h += hl.a * Math.exp(-(dx * dx + dz * dz) / (2 * hl.s * hl.s));
  }
  if (Math.abs(h - terrainH(x, z)) > 1e-12) throw new Error(`terrainH mismatch @ ${x},${z}`);
}

const lines = [];
for (const [k, v] of Object.entries(plan)) {
  if (Array.isArray(v) && (k === 'places' || k === 'forestTrees')) {
    lines.push(`  ${JSON.stringify(k)}: [`);
    lines.push(v.map((o) => `    ${JSON.stringify(o)}`).join(',\n'));
    lines.push('  ],');
  } else if (Array.isArray(v) && v.length > 3) {
    lines.push(`  ${JSON.stringify(k)}: [`);
    lines.push(v.map((o) => `    ${JSON.stringify(o)}`).join(',\n'));
    lines.push('  ],');
  } else {
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  }
}
lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
writeFileSync(new URL('../data/town-plan.json', import.meta.url), `{\n${lines.join('\n')}\n}\n`);
console.log(`OK: places=${plan.places.length} forestTrees=${plan.forestTrees.length} roads=${plan.roads.length}`);
