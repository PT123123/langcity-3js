// kenney-kit-match.mjs —— 用 UV 落点判断每个 Kenney 模型属于哪套图集（roads/commercial/industrial/suburban/holiday）
// 原理：colormap 图集有一整片单一「背景填充色」，模型真实 UV 岛落在自己那套图集上时
// 命中背景的比例很低、颜色数很多；配错图集时大概率一片背景或颜色对不上。
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, glbParts, readAccessor } from './png-glb.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEXDIR = path.join(ROOT, 'public/models/kenney/textures');
const MDIR = path.join(ROOT, 'public/models/kenney');

const kits = {};
for (const f of fs.readdirSync(TEXDIR)) {
  if (!f.endsWith('.png')) continue;
  const img = decodePng(fs.readFileSync(path.join(TEXDIR, f)));
  const key = f.replace('_colormap.png', '');
  // 背景色 = 四角像素的众数
  const corners = [[1, 1], [img.w - 2, 1], [1, img.h - 2], [img.w - 2, img.h - 2]].map(([x, y]) => {
    const o = (y * img.w + x) * 4;
    return `${img.data[o]},${img.data[o + 1]},${img.data[o + 2]}`;
  });
  const bg = corners.sort((a, b) => corners.filter((c) => c === a).length - corners.filter((c) => c === b).length).pop();
  kits[key] = { img, bg };
  console.log(`[${key}] ${img.w}x${img.h} 背景填充=${bg}`);
}

function sample(img, u, v) {
  const x = Math.min(img.w - 1, Math.max(0, Math.floor((u % 1) * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor((1 - (v % 1)) * img.h))); // glTF V 轴向下
  const o = (y * img.w + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

const rows = [];
for (const f of fs.readdirSync(MDIR)) {
  if (!f.endsWith('.glb')) continue;
  let json, bin;
  try { ({ json, bin } = glbParts(path.join(MDIR, f))); } catch { continue; }
  const uvs = [];
  const xforms = new Set();
  for (const mesh of json.meshes || []) for (const p of mesh.primitives) {
    if (p.attributes.TEXCOORD_0 == null) continue;
    const m = (json.materials || [])[p.material] || {};
    const tt = m.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform;
    xforms.add(tt ? `s${(tt.scale || [1, 1]).join('x')}o${(tt.offset || [0, 0]).map((v) => Math.round(v * 100) / 100).join('x')}` : 'identity');
    for (const uv of readAccessor(json, bin, p.attributes.TEXCOORD_0)) uvs.push([uv[0], uv[1]]);
  }
  if (!uvs.length) { rows.push({ f, best: '(无UV)', scores: {} }); continue; }
  // 每 7 个采样点取 1 个，够用且快
  const step = Math.max(1, Math.floor(uvs.length / 4000));
  const scores = {};
  for (const [key, { img, bg }] of Object.entries(kits)) {
    let bgHits = 0, n = 0, lumSum = 0;
    const colors = new Set();
    for (let i = 0; i < uvs.length; i += step) {
      const c = sample(img, uvs[i][0], uvs[i][1]);
      const cs = `${c[0]},${c[1]},${c[2]}`;
      if (cs === bg) bgHits++;
      lumSum += (c[0] + c[1] + c[2]) / 3;
      colors.add(cs);
      n++;
    }
    scores[key] = { bgPct: Math.round((bgHits / n) * 100), colors: colors.size, lum: Math.round(lumSum / n) };
  }
  const best = Object.entries(scores).sort((a, b) => (a[1].bgPct - b[1].bgPct) || (b[1].colors - a[1].colors))[0][0];
  rows.push({ f, best, scores, xf: [...xforms].join('|') });
}
for (const r of rows) {
  const s = Object.entries(r.scores).map(([k, v]) => `${k.replace('city-kit-', '')}:${v.bgPct}%/${v.colors}c/L${v.lum}`).join('  ');
  console.log(`${r.f.padEnd(30)} 判定=${String(r.best).padEnd(20)} ${r.xf === 'identity' ? '' : 'XF=' + r.xf + ' '}${s}`);
}
const tally = {};
for (const r of rows) tally[r.best] = (tally[r.best] || 0) + 1;
console.log('\n各 kit 命中模型数:', JSON.stringify(tally));
fs.writeFileSync(path.join(ROOT, 'tools', 'kenney-kit-map.json'), JSON.stringify(Object.fromEntries(rows.map((r) => [r.f, r.best])), null, 1));
console.log('已写出 tools/kenney-kit-map.json');
