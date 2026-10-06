// colormap-layout.mjs —— Kenney 图集布局判定：
//  A) 每个模型的 UV 岛（占用了哪些 64×64 网格块）→ 两两冲突统计（同套布局应互不重叠）
//  B) 每个模型在 5 张候选图集上采样到的主色 → 判断哪张图集的颜色对该模型讲得通
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, glbParts, readAccessor } from './png-glb.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEXDIR = path.join(ROOT, 'public/models/kenney/textures');
const MDIR = path.join(ROOT, 'public/models/kenney');
const GRID = 64; // 把 512×512 划成 64×64 个 8px 块

const kits = {};
for (const f of fs.readdirSync(TEXDIR)) {
  if (!f.endsWith('.png')) continue;
  const img = decodePng(fs.readFileSync(path.join(TEXDIR, f)));
  kits[f.replace('_colormap.png', '').replace('city-kit-', '')] = img;
}

function uvIslands(file) {
  const { json, bin } = glbParts(file);
  const islands = []; // {mesh, blocks:Set, samples:[[u,v]]}
  for (const mesh of json.meshes || []) {
    for (const p of mesh.primitives) {
      if (p.attributes.TEXCOORD_0 == null) continue;
      const uvs = readAccessor(json, bin, p.attributes.TEXCOORD_0);
      const blocks = new Set();
      for (const [u, v] of uvs) {
        const bx = Math.min(GRID - 1, Math.floor((u % 1) * GRID));
        const by = Math.min(GRID - 1, Math.floor((v % 1) * GRID));
        blocks.add(`${bx},${by}`);
      }
      islands.push({ mesh: mesh.name || 'mesh', blocks, uvs });
    }
  }
  return islands;
}

const propsSrc = fs.readFileSync(path.join(ROOT, 'src/world/props.js'), 'utf8');
const usedFiles = new Set([...propsSrc.matchAll(/:\s*'kenney\/([^']+)'/g)].map((m) => m[1]));

const models = [];
for (const f of fs.readdirSync(MDIR)) {
  if (!f.endsWith('.glb')) continue;
  let isl;
  try { isl = uvIslands(path.join(MDIR, f)); } catch { continue; }
  if (!isl.length) continue;
  const blocks = new Set();
  for (const i of isl) for (const b of i.blocks) blocks.add(b);
  models.push({ f, blocks, isl });
}

// A) 冲突矩阵
let pairs = 0, heavy = 0;
const conflicts = new Map();
for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) {
  const A = models[i].blocks, B = models[j].blocks;
  let ov = 0;
  for (const b of B) if (A.has(b)) ov++;
  const frac = ov / Math.min(A.size, B.size);
  pairs++;
  if (frac > 0.25) { heavy++; conflicts.set(models[i].f, (conflicts.get(models[i].f) || 0) + 1); conflicts.set(models[j].f, (conflicts.get(models[j].f) || 0) + 1); }
}
console.log(`模型数=${models.length}  两两组合=${pairs}  显著重叠(>25%)=${heavy}`);
console.log(`重叠最多的模型:`, [...conflicts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f, n]) => `${f}:${n}`).join(' '));
const unionBlocks = new Set();
for (const m of models) for (const b of m.blocks) unionBlocks.add(b);
console.log(`所有模型 UV 块并集=${unionBlocks.size} / ${GRID * GRID}  （若远小于总块数说明各模型只用图集的一角）`);

// B) 主色采样
function topColors(img, uvs) {
  const m = new Map();
  const step = Math.max(1, Math.floor(uvs.length / 1200));
  for (let i = 0; i < uvs.length; i += step) {
    const [u, v] = uvs[i];
    const x = Math.min(img.w - 1, Math.floor((u % 1) * img.w));
    const y = Math.min(img.h - 1, Math.floor((1 - (v % 1)) * img.h));
    const o = (y * img.w + x) * 4;
    const key = `${img.data[o]},${img.data[o + 1]},${img.data[o + 2]}`;
    m.set(key, (m.get(key) || 0) + 1);
  }
  const n = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, k]) => `${c}(${Math.round((k / n) * 100)}%)`).join(' ');
}
const sampleUvs = (m) => { const all = []; for (const i of m.isl) all.push(...i.uvs); return all; };

console.log('\n=== 游戏内用到的 Kenney 道具：各图集主色（★=props.js 引用）===');
for (const m of models) {
  const tag = usedFiles.has(m.f) ? '★' : ' ';
  console.log(`\n${tag} ${m.f}  块数=${m.blocks.size}`);
  for (const [k, img] of Object.entries(kits)) console.log(`    ${k.padEnd(11)} ${topColors(img, sampleUvs(m))}`);
}
fs.writeFileSync(path.join(ROOT, 'tools', 'kenney-uv-blocks.json'), JSON.stringify(models.map((m) => ({ f: m.f, blocks: [...m.blocks] })), null, 1));
