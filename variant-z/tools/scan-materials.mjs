// scan-materials.mjs —— 盘点 public/models 下每个 GLB/GLTF 的材质：有无贴图、纯色 baseColorFactor、贴图来源与尺寸
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MODELS = path.join(ROOT, 'public/models');

function chunks(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.gltf')) return { json: JSON.parse(buf.toString('utf8')), bin: null, buf };
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const off = 20 + jsonLen;
  let bin = null;
  if (buf.length > off + 8) {
    const binLen = buf.readUInt32LE(off);
    bin = buf.slice(off + 8, off + 8 + binLen);
  }
  return { json, bin, buf };
}

function pngSize(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return '?';
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (/\.(glb|gltf)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function hexOf(cf) {
  if (!cf) return '-';
  return '#' + cf.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

const rows = [];
for (const file of listFiles(MODELS)) {
  const rel = path.relative(MODELS, file);
  let j, bin;
  try { ({ json: j, bin } = chunks(file)); } catch (e) { console.log(`ERR   ${rel} ${String(e.message).slice(0, 70)}`); continue; }
  const mats = (j.materials || []).map((m) => {
    const pbr = m.pbrMetallicRoughness || {};
    const tex = pbr.baseColorTexture;
    if (!tex) return `FLAT(${hexOf(pbr.baseColorFactor)})${m.name ? '·' + m.name : ''}`;
    const t = (j.textures || [])[tex.index] || {};
    const img = (j.images || [])[t.source];
    let dim = '?';
    if (img) {
      if (img.bufferView != null && bin) {
        const bv = j.bufferViews[img.bufferView];
        dim = pngSize(bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
      } else if (img.uri) {
        const up = path.resolve(path.dirname(file), decodeURIComponent(img.uri));
        dim = fs.existsSync(up) ? pngSize(fs.readFileSync(up)) : 'MISSING:' + img.uri;
      }
    }
    return `TEX[${dim}]${m.name ? '·' + m.name : ''}`;
  });
  const tris = (j.meshes || []).reduce((s, mesh) => s + mesh.primitives.reduce((a, p) => {
    const c = p.indices != null ? (j.accessors[p.indices].count || 0) : (p.attributes.POSITION ? j.accessors[p.attributes.POSITION].count : 0);
    return a + (p.mode === 4 ? c : p.indices != null ? c / 3 : 0);
  }, 0), 0);
  const nTex = mats.filter((s) => s.startsWith('TEX')).length;
  rows.push({ rel, n: mats.length, blank: mats.length - nTex, tris: Math.round(tris), detail: mats.join(' ') });
}
for (const r of rows) {
  console.log(`${r.blank > 0 ? 'BLANK' : '  tex '} ${r.rel.padEnd(40)} mats=${String(r.n).padStart(2)} blank=${r.blank} tris=${String(r.tris).padStart(6)}  ${r.detail.slice(0, 160)}`);
}
const blank = rows.filter((r) => r.blank > 0);
console.log(`\n== ${rows.length} 个模型；${blank.length} 个含纯色(无贴图)材质；纯白/近白 FLAT(#ffffff) 是最扎眼的空白 ==`);
