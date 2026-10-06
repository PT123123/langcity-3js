// uri-scan.mjs —— 列出每个模型引用的贴图 uri（找 kit 归属的地面真值）
import fs from 'node:fs';
import path from 'node:path';
import { glbParts } from './png-glb.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const M = path.join(ROOT, 'public/models');
const rows = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(glb|gltf)$/i.test(e.name)) continue;
    let j;
    try { j = glbParts(p).json; } catch (err) { rows.push([path.relative(M, p), 'PARSE_ERR', '']); continue; }
    const us = (j.images || []).map((i) => i.uri ? decodeURIComponent(i.uri) : `EMBED(bv ${i.bufferView})`);
    const matNames = (j.materials || []).map((m) => m.name).filter(Boolean);
    rows.push([path.relative(M, p).replaceAll('\\', '/'), [...new Set(us)].join(' , ') || '(no images)', matNames.slice(0, 8).join('/')]);
  }
})(M);
for (const [f, uri, names] of rows) console.log(`${f.padEnd(34)} ${uri.padEnd(52)} ${names}`);
const kit = rows.filter(([, u]) => /city-kit|holiday/.test(u));
console.log(`\nuri 中直接点名 kit 的模型：${kit.length} / ${rows.length}`);
for (const [f, u] of kit) console.log('  ', f, '→', u);
