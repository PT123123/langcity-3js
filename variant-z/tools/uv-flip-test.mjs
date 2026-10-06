// uv-flip-test.mjs —— 判定 colormap 的 V 轴朝向约定 + 每个模型在 5 张图集上的主色
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, glbParts, readAccessor } from './png-glb.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const TD = path.join(ROOT, 'public/models/kenney/textures');
const MD = path.join(ROOT, 'public/models/kenney');

const kits = {};
for (const f of fs.readdirSync(TD)) {
  if (f.endsWith('.png')) kits[f.replace('_colormap.png', '').replace('city-kit-', '')] = decodePng(fs.readFileSync(path.join(TD, f)));
}

function uvsOf(file) {
  const { json, bin } = glbParts(file);
  const a = [];
  for (const m of json.meshes || []) for (const p of m.primitives) {
    if (p.attributes.TEXCOORD_0 == null) continue;
    for (const uv of readAccessor(json, bin, p.attributes.TEXCOORD_0)) a.push([uv[0], uv[1]]);
  }
  return a;
}

// flip=true → y = (1-v)*h（glTF 标准：UV 原点在左上，图行从上往下）
function top(img, uvs, flip, nTop = 4) {
  const step = Math.max(1, Math.floor(uvs.length / 2000));
  const m = new Map();
  for (let i = 0; i < uvs.length; i += step) {
    const u = ((uvs[i][0] % 1) + 1) % 1;
    const v0 = ((uvs[i][1] % 1) + 1) % 1;
    const v = flip ? 1 - v0 : v0;
    const x = Math.min(img.w - 1, Math.floor(u * img.w));
    const y = Math.min(img.h - 1, Math.floor(v * img.h));
    const o = (y * img.w + x) * 4;
    const k = `${img.data[o]},${img.data[o + 1]},${img.data[o + 2]}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  const n = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, nTop)
    .map(([c, k]) => `${c}:${Math.round((k / n) * 100)}`).join('  ');
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['grass.glb', 'plant_bush.glb', 'flower_redA.glb', 'sedan.glb', 'bench.glb', 'traffic_light.glb', 'elec_pole.glb', 'light_curved.glb'];
for (const f of files) {
  const u = uvsOf(path.join(MD, f));
  if (!u.length) { console.log(`${f} 无UV`); continue; }
  console.log(`\n== ${f}  (uv点=${u.length})`);
  for (const flip of [true, false]) {
    for (const [k, img] of Object.entries(kits)) console.log(`  ${flip ? 'flip' : 'norm'} ${k.padEnd(11)} ${top(img, u, flip)}`);
  }
}
