// 仓库根目录这套是「纯程序化城市」版（数据真源 data/town-plan.json，不依赖任何 GLB）。
// variant-z/ 是另一套（原版 planets_present_* 碎块壳资产）。
// 两套各跑各的端口：just run → variant-z :5173，just run-city → 本文件 :5174。
// editor.html（地图编辑器）与游戏同端口，接口见 townPlanDevApi 插件。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { applyOps, OPS_DOC, OPS_RULES, OPS_VERSION, WHERE_DOC } from './src/map/ops.js';
import { serializePlan } from './src/map/serialize.js';
import { validatePlan, sha16 } from './src/map/schema.js';

const PLAN_FILE = fileURLToPath(new URL('./data/town-plan.json', import.meta.url));

// 地图编辑器的读写接口：
//   GET  /__plan       读当前文件（带内容指纹）
//   POST /__plan       校验后整张写回
//   GET  /__plan/ops   op 说明书（AI 照着写）
//   POST /__plan/ops   声明式改图：{ops:[…], dryRun?, sha?}
//                      有一条 op 写歪 → 422 且整批不落盘；改出来的图不合法 → 422 不落盘
// 仅 dev server 生效，生产构建不含任何写文件能力。
function townPlanDevApi() {
  return {
    name: 'town-plan-dev-api',
    configureServer(server) {
      server.middlewares.use('/__plan', (req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(obj));
        };
        const sub = (req.url || '').split('?')[0].replace(/\/+$/, '');
        const isOps = sub === '/ops';

        if (req.method === 'GET') {
          if (isOps) return send(200, { version: OPS_VERSION, ops: OPS_DOC, where: WHERE_DOC, rules: OPS_RULES, file: PLAN_FILE });
          try {
            return send(200, { sha: sha16(readFileSync(PLAN_FILE, 'utf8')), plan: JSON.parse(readFileSync(PLAN_FILE, 'utf8')) });
          } catch (e) {
            return send(500, { error: `读取失败: ${e.message}` });
          }
        }
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 4e6) req.destroy();
        });
        req.on('end', () => {
          const text = Buffer.from(body, 'utf8').toString('utf8');
          if (isOps) return opsHandler(text, send);
          let err = null;
          try {
            err = validatePlan(JSON.parse(text));
          } catch (e) {
            return send(400, { error: `JSON 解析失败: ${e.message}` });
          }
          if (err) return send(400, { error: err });
          writeFileSync(PLAN_FILE, text.endsWith('\n') ? text : text + '\n');
          send(200, { ok: true, sha: sha16(text) });
        });
      });
    },
  };
}

/** 声明式改图：读当前文件 → applyOps → 校验 → 落盘（dryRun 只回报不写） */
function opsHandler(body, send) {
  let req;
  try {
    req = JSON.parse(body);
  } catch (e) {
    return send(400, { error: `JSON 解析失败: ${e.message}` });
  }
  if (!Array.isArray(req.ops)) return send(400, { error: 'body 要有 ops 数组（GET /__plan/ops 看说明书）' });
  let current;
  const raw = readFileSync(PLAN_FILE, 'utf8');
  try {
    current = JSON.parse(raw);
  } catch (e) {
    return send(500, { error: `真源读不动: ${e.message}` });
  }
  // 指纹对不上说明有人（编辑器或另一条命令）已经改过，别让两次批处理互相盖掉
  if (req.sha && req.sha !== sha16(raw)) return send(409, { error: '文件已被别人改过，先 GET /__plan 拿最新 sha 再来', sha: sha16(raw) });
  const { plan, report } = applyOps(current, req.ops);
  // 一条写歪就整批不落盘：AI 脚本常常七八步连着来，改到一半把真源弄脏比全不写更难查
  if (report.errors.length) return send(422, { error: `这批有 ${report.errors.length} 条 op 写歪了，整批都没落盘`, errors: report.errors, changes: report.changes });
  if (!report.changed) return send(200, { ok: true, changed: false, report, sha: sha16(raw), plan });
  const err = validatePlan(plan);
  if (err) return send(422, { error: `改出来的图不合法，没写盘: ${err}`, report });
  const text = serializePlan(plan);
  if (!req.dryRun) writeFileSync(PLAN_FILE, text);
  send(200, { ok: true, changed: true, dryRun: !!req.dryRun, report, sha: sha16(text), plan });
}

export default defineConfig({
  plugins: [townPlanDevApi()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  optimizeDeps: {
    // Vite 默认把 root 下 **/*.html 全当入口去预打包，会连带扫到 variant-z/ 那两套页面
    // （实测报 "Unexpected else" 之类的错算到本项目头上）。本项目入口只有这两个。
    entries: ['index.html', 'editor.html'],
  },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: 'index.html', editor: 'editor.html' } },
  },
});
