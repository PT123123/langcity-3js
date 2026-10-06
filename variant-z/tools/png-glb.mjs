// png-glb.mjs —— 零依赖工具：PNG 解码 + GLB/GLTF 解析 + accessor 读取（给材质盘点脚本共用）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 0, idat = [], plte = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlace unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth + ' unsupported');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 3;
  if (colorType === 3 && !plte) throw new Error('no PLTE');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  const stride = w * ch;
  let pos = 0, prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0, x = line[i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
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

export function glbParts(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.gltf')) return { json: JSON.parse(buf.toString('utf8')), bin: null, dir: path.dirname(file) };
  const jsonLen = buf.readUInt32LE(12);
  let s = buf.slice(20, 20 + jsonLen).toString('utf8');
  s = s.slice(0, s.lastIndexOf('}') + 1); // 容忍 langcity-art-convert 的 \0 填充
  const off = 20 + jsonLen;
  const bin = buf.length > off + 8 ? buf.slice(off + 8, off + 8 + buf.readUInt32LE(off)) : Buffer.alloc(0);
  return { json: JSON.parse(s), bin, dir: path.dirname(file) };
}

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function readAccessor(json, bin, idx) {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const Ctor = COMPONENT[a.componentType];
  const n = NCOMP[a.type];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const arr = new Ctor(bin.buffer, bin.byteOffset + base, a.count * n);
  const strideEls = bv.byteStride ? bv.byteStride / arr.BYTES_PER_ELEMENT : n;
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const o = i * strideEls;
    out.push(Array.from(arr.subarray(o, o + n)));
  }
  return out;
}
