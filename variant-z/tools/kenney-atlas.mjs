// kenney-atlas.mjs —— 无依赖 PNG 解码 + Kenney colormap 图集分析 + 模型 UV 用格统计
// 用途：搞清「Kenney GLB 缺 Textures/colormap.png」到底该配哪张图集，以及每格的语义色。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEXDIR = path.join(ROOT, 'public/models/kenney/textures');

// ---------- 最小 PNG 解码（8bit RGBA/RGB/灰度，全部转 RGBA） ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 0, idat = [];
  let plte = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlace unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth + ' unsupported');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : (() => { throw new Error('colorType ' + colorType); })();
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  const stride = w * ch;
  let pos = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      const x = line[i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error('bad filter ' + filter);
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      let r, g, bl, al = 255;
      if (colorType === 6) { r = cur[x * 4]; g = cur[x * 4 + 1]; bl = cur[x * 4 + 2]; al = cur[x * 4 + 3]; }
      else if (colorType === 2) { r = cur[x * 3]; g = cur[x * 3 + 1]; bl = cur[x * 3 + 2]; }
      else if (colorType === 0) { r = g = bl = cur[x]; }
      else if (colorType === 4) { r = g = bl = cur[x * 2]; al = cur[x * 2 + 1]; }
      else { const idx = cur[x]; r = plte[idx * 3]; g = plte[idx * 3 + 1]; bl = plte[idx * 3 + 2]; if (trns && idx < trns.length) al = trns[idx]; }
      const o = (y * w + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = al;
    }
    prev = cur;
  }
  return { w, h, data: out };
}

// ---------- 读 GLB：拿 material 的贴图引用 + 每个 primitive 的 TEXCOORD_0 ----------
function glbParts(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  let str = buf.slice(20, 20 + jsonLen).toString('utf8');
  str = str.slice(0, str.lastIndexOf('}') + 1);          // 容忍 \0/垃圾填充
  const json = JSON.parse(str);
  const binOff = 20 + jsonLen;
  const bin = buf.length > binOff + 8
    ? buf.slice(binOff + 8, binOff + 8 + buf.readUInt32LE(binOff))
    : Buffer.alloc(0);
  return { json, bin };
}

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json, bin, idx) {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const Ctor = COMPONENT[a.componentType];
  const n = NCOMP[a.type];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const arr = new Ctor(bin.buffer, bin.byteOffset + base, a.count * n);
  const stride = bv.byteStride || n * arr.BYTES_PER_ELEMENT;
  const out = [];
  for (let i = 0; i < a.count; i++) out.push(Array.from(arr.subarray(i * (stride / arr.BYTES_PER_ELEMENT), i * (stride / arr.BYTES_PER_ELEMENT) + n)));
  return out;
}

// ---------- 主流程 ----------
const atlases = {};
for (const f of fs.readdirSync(TEXDIR)) {
  if (!f.endsWith('.png')) continue;
  const img = decodePng(fs.readFileSync(path.join(TEXDIR, f)));
  const key = f.replace('_colormap.png', '');
  atlases[key] = img;
  // 按 16×16 格取每格中心色
  const cells = [];
  const cw = img.w / 16, chh = img.h / 16;
  for (let cy = 0; cy < 16; cy++) for (let cx = 0; cx < 16; cx++) {
    const x = Math.floor(cx * cw + cw / 2), y = Math.floor(cy * chh + chh / 2);
    const o = (y * img.w + x) * 4;
    cells.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
  }
  img.cells = cells;
  const uniq = new Set(cells.map((c) => c.join(',')));
  console.log(`\n[${key}] ${img.w}x${img.h}  16x16格=${cells.length} 去重色=${uniq.size}  样本前8格: ${cells.slice(0, 8).map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')).join(' ')}`);
}

// 图集之间格色差异
const keys = Object.keys(atlases);
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const A = atlases[keys[i]].cells, B = atlases[keys[j]].cells;
  let diff = 0, maxd = 0;
  for (let k = 0; k < A.length; k++) {
    const d = Math.abs(A[k][0] - B[k][0]) + Math.abs(A[k][1] - B[k][1]) + Math.abs(A[k][2] - B[k][2]);
    if (d > 24) diff++;
    maxd = Math.max(maxd, d);
  }
  console.log(`差异 ${keys[i]} vs ${keys[j]}: 不同格=${diff}/256 最大通道差和=${maxd}`);
}

// 模型 UV 用格统计
console.log('\n=== 模型 UV → 图集格子（列,行），看每张图集被哪些模型共用 ===');
const MDIR = path.join(ROOT, 'public/models/kenney');
const usage = {};
for (const f of fs.readdirSync(MDIR)) {
  if (!f.endsWith('.glb')) continue;
  let json, bin;
  try { ({ json, bin } = glbParts(path.join(MDIR, f))); } catch (e) { console.log(`${f}: 解析失败 ${e.message}`); continue; }
  const cells = new Set();
  let hasUV = 0, noUV = 0;
  for (const mesh of json.meshes || []) for (const p of mesh.primitives) {
    if (p.attributes.TEXCOORD_0 == null) { noUV++; continue; }
    hasUV++;
    for (const uv of readAccessor(json, bin, p.attributes.TEXCOORD_0)) {
      // 取整到格（Kenney colormap 是 16x16 格，UV 中心对齐）
      const cx = Math.floor((uv[0] % 1) * 16), cy = Math.floor((uv[1] % 1) * 16);
      cells.add(`${cx},${cy}`);
    }
  }
  if (!hasUV) { console.log(`${f.padEnd(26)} 无 TEXCOORD_0（纯色件，贴图帮不上）`); }
  else console.log(`${f.padEnd(26)} uv图元=${hasUV} 用格数=${cells.size}  格: ${[...cells].slice(0, 12).join(' ')}${cells.size > 12 ? ' …' : ''}`);
  usage[f] = [...cells];
}
fs.writeFileSync(path.join(ROOT, 'tools', 'kenney-uv-cells.json'), JSON.stringify(usage, null, 1));
console.log('\n已写出 tools/kenney-uv-cells.json（模型→用格表，供后续按格手绘用）');
