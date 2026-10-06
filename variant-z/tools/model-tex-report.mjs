// model-tex-report.mjs —— 逐个模型检查：材质有无贴图、贴图 uri 能否解析、有无 TEXCOORD_0
// 目的：找出游戏里真正"空白"（黑面/平涂无纹路）的模型。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MDIR = path.join(ROOT, 'public/models');

function glbParts(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.gltf')) {
    let s = buf.toString('utf8');
    return { json: JSON.parse(s), bin: null, dir: path.dirname(file) };
  }
  const jsonLen = buf.readUInt32LE(12);
  let s = buf.slice(20, 20 + jsonLen).toString('utf8');
  s = s.slice(0, s.lastIndexOf('}') + 1);
  const off = 20 + jsonLen;
  const bin = fs.readFileSync(file).slice(off + 8, off + 8 + fs.readFileSync(file).readUInt32LE(off));
  return { json: JSON.parse(s), bin, dir: path.dirname(file) };
}

const hex = (cf) => '#' + cf.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

function report(rel) {
  const file = path.join(MDIR, rel);
  if (!fs.existsSync(file)) return { rel, state: 'NOFILE' };
  let json, bin;
  try { ({ json, bin } = glbParts(file)); } catch (e) { return { rel, state: 'PARSE_ERR ' + e.message.slice(0, 40) }; }
  const texImgs = (json.textures || []).map((t) => (json.images || [])[t.source] || {});
  const matInfo = (json.materials || []).map((m) => {
    const pbr = m.pbrMetallicRoughness || {};
    const cf = pbr.baseColorFactor ? hex(pbr.baseColorFactor) : null;
    if (pbr.baseColorTexture == null) return { kind: 'flat', cf, name: m.name || '' };
    const img = texImgs[pbr.baseColorTexture.index] || {};
    if (img.bufferView != null) return { kind: 'emb', cf, name: m.name || '' };
    const uri = decodeURIComponent(img.uri || '');
    // GLB 的 image uri 相对模型所在目录解析（three 的 GLTFLoader 也这样）
    const abs = path.resolve(path.join(MDIR, path.dirname(rel)), uri);
    return { kind: fs.existsSync(abs) ? 'uri-ok' : 'uri-MISSING', cf, name: m.name || '', uri };
  });
  const primUV = (json.meshes || []).flatMap((mesh) => mesh.primitives.map((p) => p.attributes.TEXCOORD_0 != null));
  const withUV = primUV.filter(Boolean).length, noUV = primUV.length - withUV;
  const broken = matInfo.filter((m) => m.kind === 'uri-MISSING').length;
  const flat = matInfo.filter((m) => m.kind === 'flat').length;
  const state = broken > 0 ? 'TEX_BROKEN' : (flat === matInfo.length && matInfo.length > 0) ? 'ALL_FLAT' : matInfo.length === 0 ? 'NO_MATERIAL' : withUV === 0 && primUV.length > 0 ? 'UV_LESS' : 'ok';
  return { rel, state, mats: matInfo.length, uris: [...new Set(matInfo.filter((m) => m.uri).map((m) => m.uri))].join(','), sample: matInfo.slice(0, 4).map((m) => `${m.kind}${m.cf ? ':' + m.cf : ''}${m.name ? '/' + m.name : ''}`).join(' '), uv: `${withUV}/${primUV.length}` };
}

// 游戏实际用到的键（props.js PROP_FILES）
const propsSrc = fs.readFileSync(path.join(ROOT, 'src/world/props.js'), 'utf8');
const used = [...propsSrc.matchAll(/:\s*'([^']+\.(?:glb|gltf))'/g)].map((m) => m[1]);
const uniqUsed = [...new Set(used)];

console.log('=== 游戏 PROP_FILES 引用的模型 ===');
for (const rel of uniqUsed) {
  const r = report(rel);
  const bad = /TEX_BROKEN|ALL_FLAT|NO_MATERIAL|UV_LESS|PARSE_ERR|NOFILE/.test(r.state || '');
  console.log(`${bad ? '>>' : '  '} ${(r.state || '?').padEnd(12)} ${rel.padEnd(34)} uv=${r.uv ?? '-'} mats=${r.mats ?? '-'} ${r.uris ? 'uri=' + r.uris : ''}  ${r.sample ?? ''}`);
}
console.log('\n=== public/models 全量 ===');
const all = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(glb|gltf)$/.test(e.name)) all.push(path.relative(MDIR, p).replaceAll('\\', '/')); } })(MDIR);
const tally = {};
for (const rel of all) { const r = report(rel); tally[r.state] = (tally[r.state] || 0) + 1; if (r.state !== 'ok' && r.state !== 'NO_MATERIAL') console.log(`${r.state.padEnd(12)} ${rel.padEnd(36)} ${r.uris || r.sample || ''}`); }
console.log('\n统计:', JSON.stringify(tally), ` 共 ${all.length} 个`);
