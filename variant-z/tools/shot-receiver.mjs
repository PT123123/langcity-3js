// 开发期截图回传服务：页面里离屏渲染后 POST dataURL，这里落盘成 PNG。
// 用法: node tools/shot-receiver.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 8899);
const outDir = path.resolve(process.cwd(), 'shots', 'audit');
fs.mkdirSync(outDir, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v)); res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end('no'); return; }
  const url = new URL(req.url, 'http://localhost');
  const name = (url.searchParams.get('name') || 'shot').replace(/[^a-zA-Z0-9_.-]/g, '_');
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let file;
    if (url.pathname === '/json') {
      file = path.join(outDir, `${name}.json`);
      fs.writeFileSync(file, body);
    } else {
      const b64 = body.replace(/^data:image\/\w+;base64,/, '');
      file = path.join(outDir, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    }
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    res.end(`ok ${file} ${fs.statSync(file).size}`);
    console.log('wrote', file, fs.statSync(file).size);
  });
}).listen(port, '127.0.0.1', () => console.log('shot receiver on', port, '->', outDir));
