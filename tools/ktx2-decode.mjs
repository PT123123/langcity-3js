// ktx2-decode.mjs —— messenger-art-assets.zip 的 KTX2/LUT 纹理 → PNG/raw
// 零新依赖:Basis 压缩用 three 自带转码器(node_modules/three/.../basis_transcoder)解;
// 非压缩(R16G16B16A16_SFLOAT 的 3D LUT)手工解析 KTX2 容器,Zstd 层用 Node 内置 zlib。
//
// 用法:
//   1) 先把 zip 解开(任选目录):
//      unzip ~/Desktop/messenger-art-assets.zip -d /tmp/messenger-art
//   2) node tools/ktx2-decode.mjs --src <解出的 messenger-art-assets 目录> \
//        --out variant-z/public/tex-messenger
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import vm from 'node:vm';

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(arg('--src', '/tmp/messenger-art/messenger-art-assets'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'variant-z/public/tex-messenger')));
fs.mkdirSync(OUT, { recursive: true });

// zip 内文件名 → 输出名(前缀 assets_images_ 是原始路径防冲突用的,这里拍平)
const TEXTURES = [
  ['assets_images_noise-simplex-layered-blur-highq.ktx2', 'noise-simplex-layered-blur.png'],
  ['assets_images_noise-simplex-layered-pixellated-highq.ktx2', 'noise-simplex-layered-pixellated.png'],
  ['assets_images_noises-terrain.ktx2', 'noises-terrain.png'],
  ['assets_images_water-noises-highq.ktx2', 'water-noises.png'],
  ['assets_images_clouds_noise_512.ktx2', 'clouds-noise-512.png'],
  ['assets_images_clouds_noise_64.ktx2', 'clouds-noise-64.png'],
  ['assets_images_grass-blades-highq.ktx2', 'grass-blades.png'],
  ['assets_images_tree-leaves.ktx2', 'tree-leaves.png'],
  ['assets_images_tree-leaves-detail.ktx2', 'tree-leaves-detail.png'],
  ['assets_images_trails-noise.ktx2', 'trails-noise.png'],
  ['assets_images_particle_sprites.ktx2', 'particle-sprites.png'],
  ['assets_images_galaxy.ktx2', 'galaxy.png'],
];
const LUT = ['assets_images_lut.ktx2', 'lut3d.raw', 'lut3d-atlas.png'];
const REF = ['textures/screenshots_after-start.png', 'reference-after-start.png'];

// ---------------- PNG 编码(8bit RGBA,filter 0) ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------- Basis 解码(KTX2File,three 同款调用方式) ----------------
const CTF_RGBA32 = 13; // 实测:this 构建的绑定里 13 = RGBA32(14 会按 2B/px 算尺寸导致越界)
async function initBasis() {
  const basisDir = path.join(ROOT, 'node_modules/three/examples/jsm/libs/basis');
  // three 0.170 的 package.json 是 "type":"module",这个 UMD 会被 Node 当 ESM 加载(导出为空),
  // 所以用 vm 造一个 CJS 环境(module/exports)让文件尾部的 module.exports = BASIS 生效。
  const code = fs.readFileSync(path.join(basisDir, 'basis_transcoder.js'), 'utf8');
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(code, sandbox);
  const createModule = sandbox.module.exports;
  const mod = { wasmBinary: fs.readFileSync(path.join(basisDir, 'basis_transcoder.wasm')) };
  await createModule(mod);
  mod.initializeBasis();
  return mod;
}
function decodeBasis(basis, buf) {
  const file = new basis.KTX2File(new Uint8Array(buf));
  if (!file.isValid()) { file.close(); file.delete(); throw new Error('KTX2File invalid'); }
  const w = file.getWidth(), h = file.getHeight();
  const ok = file.startTranscoding();
  if (!ok) { file.close(); file.delete(); throw new Error('startTranscoding failed'); }
  const dst = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, CTF_RGBA32));
  const status = file.transcodeImage(dst, 0, 0, 0, CTF_RGBA32, 0, -1, -1);
  file.close(); file.delete();
  if (!status) throw new Error('transcodeImage failed');
  return { width: w, height: h, rgba: Buffer.from(dst.buffer, dst.byteOffset, dst.byteLength) };
}

// ---------------- 手工 KTX2 解析(3D LUT:R16G16B16A16_SFLOAT) ----------------
function parseKTX2Header(buf) {
  const u32 = (o) => buf.readUInt32LE(o);
  const u64 = (o) => Number(buf.readBigUInt64LE(o));
  return {
    vkFormat: u32(0x0c), typeSize: u32(0x10),
    width: u32(0x14), height: u32(0x18), depth: u32(0x1c),
    layers: u32(0x20), faces: u32(0x24), levels: u32(0x28),
    scheme: u32(0x2c),
    levelIndexOffset: 0x60,
    level: (i) => ({ offset: u64(0x60 + i * 24), length: u64(0x60 + i * 24 + 8) }),
  };
}
function halfToFloat(h) {
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  if (e === 0) return s ? -Math.pow(2, -14) * (f / 1024) : Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}
function decodeLUT(buf) {
  const hdr = parseKTX2Header(buf);
  if (hdr.vkFormat !== 97) throw new Error(`LUT: 预期 vkFormat 97(R16G16B16A16_SFLOAT),实际 ${hdr.vkFormat}`);
  // 注意:这个 zip 的 KTX2 是早期草案布局(dfd/kvd 偏移为 u32),levelIndex 位置不按现行规范。
  // 但 scheme=2 时 zstd 帧自带魔数和内容长度,直接定位魔数解压即可,不依赖 levelIndex。
  const expect = hdr.width * hdr.height * hdr.depth * hdr.typeSize * 4;
  let data = null;
  if (hdr.scheme === 2) {
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) {
        try {
          const out = zlib.zstdDecompressSync(buf.subarray(i));
          if (out.length === expect) { data = out; break; }
        } catch { /* 试下一个候选(帧自终止,尾部如有垃圾会抛错) */ }
      }
    }
    if (!data) throw new Error(`LUT: zstd 解压结果不等于预期 ${expect} 字节`);
  } else if (hdr.scheme === 0) {
    const { offset, length } = hdr.level(0);
    data = buf.subarray(offset, offset + length);
    if (data.length !== expect) throw new Error(`LUT: level0 ${data.length}B ≠ 预期 ${expect}B`);
  } else {
    throw new Error(`LUT: 不支持的 supercompressionScheme=${hdr.scheme}`);
  }
  const n = hdr.width * hdr.height * hdr.depth;
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.min(1, Math.max(0, halfToFloat(data.readUInt16LE(i * 8 + c * 2))));
      rgba[i * 4 + c] = Math.round(v * 255);
    }
    rgba[i * 4 + 3] = 255;
  }
  // 调试图集:32 张 z-slice 铺成 8×4 网格(256×128)
  const W = hdr.width, H = hdr.height, D = hdr.depth;
  const AW = 8 * W, AH = Math.ceil(D / 8) * H;
  const atlas = Buffer.alloc(AW * AH * 4);
  for (let z = 0; z < D; z++) {
    const tx = (z % 8) * W, ty = Math.floor(z / 8) * H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = ((ty + y) * AW + tx + x) * 4, di = (x + y * W + z * W * H) * 4;
      atlas[si] = rgba[di]; atlas[si + 1] = rgba[di + 1]; atlas[si + 2] = rgba[di + 2]; atlas[si + 3] = 255;
    }
  }
  return { rgba, atlas, dims: [W, H, D], atlasDims: [AW, AH] };
}

// ---------------- 主流程 ----------------
console.log(`源:${SRC}\n出:${OUT}\n`);
const basis = await initBasis();
let fail = 0;

for (const [srcName, outName] of TEXTURES) {
  try {
    const buf = fs.readFileSync(path.join(SRC, 'textures', srcName));
    const { width, height, rgba } = decodeBasis(basis, buf);
    fs.writeFileSync(path.join(OUT, outName), encodePNG(width, height, rgba));
    console.log(`  ✓ ${outName}  ${width}×${height}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${srcName}: ${e.message}`);
  }
}

try {
  const buf = fs.readFileSync(path.join(SRC, 'textures', LUT[0]));
  const { rgba, atlas, dims, atlasDims } = decodeLUT(buf);
  fs.writeFileSync(path.join(OUT, LUT[1]), rgba);
  fs.writeFileSync(path.join(OUT, LUT[2]), encodePNG(atlasDims[0], atlasDims[1], atlas));
  console.log(`  ✓ ${LUT[1]}  ${dims.join('×')} 3D LUT(+ ${LUT[2]} 调试图集)`);
} catch (e) {
  fail++;
  console.error(`  ✗ ${LUT[0]}: ${e.message}`);
}

fs.copyFileSync(path.join(SRC, REF[0]), path.join(OUT, REF[1]));
console.log(`  ✓ ${REF[1]}(参考截图)`);
console.log(fail ? `\n完成,${fail} 个失败` : '\n全部成功');
