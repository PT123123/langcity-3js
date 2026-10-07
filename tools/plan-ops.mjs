// plan-ops.mjs — 命令行改图（AI 接口脱机版）：把一串声明式 op 打到 data/town-plan.json 上
//
//   npx vite-node tools/plan-ops.mjs --ops '[{"op":"place.style","where":{"kind":"mansion"},"floors":[3,6]}]'
//   npx vite-node tools/plan-ops.mjs --file tools/ops-今晚改这批.json --dry-run
//   echo '[{"op":"plan.set","path":"sidewalkW","value":1.6}]' | npx vite-node tools/plan-ops.mjs --stdin
//
// 默认就写盘（和 dev 端点 POST /__plan/ops 同一套语义）；--dry-run 只回报，--out 写到别处不动真源。
// 两道关再落盘：schema（形状）+ checkPlan（游戏里会不会出怪事），任何一条 err 都不写；
// 这批里只要有一条 op 写歪，整批都不写 —— 改到一半的地图最难查。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyOps, OPS_DOC } from '../src/map/ops.js';
import { serializePlan } from '../src/map/serialize.js';
import { validatePlan, sha16 } from '../src/map/schema.js';
import { checkPlan } from '../src/editor/problems.js';

const PLAN_FILE = fileURLToPath(new URL('../data/town-plan.json', import.meta.url));
const say = (...a) => console.log(...a);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.findIndex((a) => a === `--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

if (flag('help') || (!opt('ops') && !opt('file') && !flag('stdin') && !flag('doc'))) {
  say('用法：npx vite-node tools/plan-ops.mjs --ops <JSON数组> | --file <ops.json> | --stdin [--dry-run] [--out <文件>]');
  say('      --doc 打印全部 op 与筛选器；--list 只看现在有什么可改\n');
  say('op 清单：');
  for (const d of OPS_DOC) say(`  ${d.op.padEnd(26)} ${d.args}\n  ${' '.repeat(28)}${d.note}`);
  process.exit(flag('help') || flag('doc') ? 0 : 2);
}

let ops;
try {
  const raw = flag('stdin')
    ? readFileSync(0, 'utf8')
    : opt('file')
      ? readFileSync(opt('file'), 'utf8')
      : opt('ops');
  ops = JSON.parse(raw);
} catch (e) {
  say(`ops 读不动：${e.message}`);
  process.exit(2);
}
if (!Array.isArray(ops)) { say('ops 必须是一个数组'); process.exit(2); }

const before = readFileSync(PLAN_FILE, 'utf8');
if (validatePlan(JSON.parse(before))) { say('真源本身就不合法，先修它再来改图'); process.exit(1); }

const { plan, report } = applyOps(JSON.parse(before), ops);
for (const c of report.changes) say(`  改了  ${c.msg}`);
for (const e of report.errors) say(`  报错  ${e}`);

// 一条写歪 = 整批不落盘（和 dev 端点同一口径）：改到一半的真源最难查
if (report.errors.length) { say(`这批有 ${report.errors.length} 条写歪了，整批没落盘（修好再重发）`); process.exit(1); }
if (!report.changed) { say('什么都没改（多半是 where 筛空了）；没写盘。'); process.exit(0); }

const shapeErr = validatePlan(plan);
if (shapeErr) { say(`形状不过：${shapeErr}\n没写盘。`); process.exit(1); }
const errs = checkPlan(plan).filter((i) => i.level === 'err');
if (errs.length) {
  say(`游戏里会出怪事，${errs.length} 条：`);
  for (const e of errs.slice(0, 8)) say(`  · ${e.msg}`);
  say('没写盘。');
  process.exit(1);
}

const text = serializePlan(plan);
if (flag('out')) { writeFileSync(opt('out'), text); say(`写到 ${opt('out')}（真源没动）`); }
else if (flag('dry-run')) say(`dry-run：本来要写 ${text.length} 字节（sha ${sha16(text)}），真源没动`);
else { writeFileSync(PLAN_FILE, text); say(`已写回 ${PLAN_FILE}（sha ${sha16(text)}，改前 ${sha16(before)}）`); }
say(`体检零错，物件 ${plan.places.length} 个 / 道路 ${plan.roads.length} 条 / 造成 ${(plan.terraces || []).length} 台地 +${(plan.flights || []).length} 梯道`);
