// layering-check.mjs — 3D 分层红线机检（地图/模型/材质只能通过框架改，不许手撸）
// 用法：
//   node tools/layering-check.mjs            检查；踩线就 exit 1
//   node tools/layering-check.mjs --bless    把当前计数钉成基线（收紧时才这么跑）
//
// 两道机制：
//  1) 绝对红线：结构性违规，一次都不许有（数据层碰 three、真源手写进 JS、别处塞碰撞盒……）。
//  2) 棘轮基线：three 构造点的数量只准减不准增。新文件冒出来、老文件变胖，都 FAIL。
//     为什么要棘轮而不是「一次清零」：props/sky/cat 里已有 12 处历史构造点，
//     把它们全塞进 materials.js 是另一件大事；先冻结现状，谁改谁顺手挪，挪少了就重新 --bless 收紧。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BLESS = process.argv.includes('--bless');
const BASELINE_FILE = path.join(ROOT, 'tools', 'layering-baseline.json');

const say = (...a) => console.log(...a);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; say('FAIL', msg); } else say('ok  ', msg); };

// ---------- 扫描器 ----------
const SCOPES = { city: 'src', z: 'variant-z/src' };
const RULES = {
  MATERIAL: {
    label: '材质构造',
    re: /new THREE\.\w*Material\(/g,
    route: 'src/world/materials.js 的 mat()／BUCKETS（分档 roughness 与抖动都在那儿）',
    owners: ['src/world/materials.js', 'variant-z/src/world/materials.js'],
  },
  GEOMETRY: {
    label: '几何构造',
    re: /new THREE\.\w*Geometry\(/g,
    route: 'src/world/props.js 的 buildXxx()＋BUILDERS 登记表（造成实体走 terrainwork.js，猫本体走 cat.js）',
    owners: ['src/world/props.js', 'src/world/terrainwork.js', 'src/player/cat.js',
      'variant-z/src/world/props.js', 'variant-z/src/world/buildings.js'],
  },
  MERGE: {
    label: '合并/实例化',
    re: /mergeGeometries\(|new THREE\.InstancedMesh\(/g,
    route: 'src/world/town.js（按材质桶合并）／sky.js；新 kind 只在 town.js 里加桶',
    owners: ['src/world/town.js', 'src/world/sky.js', 'variant-z/src/world/scatter.js'],
  },
};

// 注释里的示例代码不算构造点；粗粒度去注释（整行 // 与 /* */），够这条红线用
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => !l.trimStart().startsWith('//')).join('\n');
}

function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(path.relative(ROOT, p).replaceAll('\\', '/'));
  }
  return out;
}

/** 返回 { 'src/world/props.js': 7, ... }，只收非零 */
function countSites(files, textOf, re) {
  const got = {};
  for (const f of files) {
    const m = stripComments(textOf(f)).match(re);
    if (m && m.length) got[f] = m.length;
  }
  return got;
}

/** 拿现状和基线比：新文件、变胖 = 违规；变瘦只提示（不 FAIL，鼓励还债） */
function audit(current, baseline) {
  const bad = [];
  const shrunk = [];
  for (const [file, n] of Object.entries(current)) {
    const b = baseline[file];
    if (b === undefined) bad.push({ kind: 'new', file, n });
    else if (n > b) bad.push({ kind: 'grew', file, n, b });
    else if (n < b) shrunk.push(`${file} ${b}→${n}`);
  }
  return { bad, shrunk };
}

const textOf = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const allFiles = [];
for (const dir of Object.values(SCOPES)) allFiles.push(...jsFiles(path.join(ROOT, dir)));

const current = {};
for (const [rule, cfg] of Object.entries(RULES)) {
  current[rule] = {};
  for (const [scope, dir] of Object.entries(SCOPES)) {
    const inScope = allFiles.filter((f) => f.startsWith(`${dir}/`));
    const rel = {};
    for (const [f, n] of Object.entries(countSites(inScope, textOf, new RegExp(cfg.re.source, 'g')))) rel[f] = n;
    current[rule][scope] = rel;
  }
}

// ---------- 0) control：先自证这套比较器不是空转 ----------
{
  const base = { 'a.js': 2 };
  const c1 = audit({ 'a.js': 2, 'b.js': 1 }, base);
  ok(c1.bad.length === 1 && c1.bad[0].kind === 'new' && c1.bad[0].file === 'b.js',
    'control：冒出新构造文件 → 比较器抓到（棘轮不是摆设）');
  const c2 = audit({ 'a.js': 3 }, base);
  ok(c2.bad.length === 1 && c2.bad[0].kind === 'grew' && c2.bad[0].n === 3,
    'control：老构造点变胖 2→3 → 比较器抓到');
  const c3 = audit({ 'a.js': 1 }, base);
  ok(c3.bad.length === 0 && c3.shrunk.length === 1, 'control：变瘦 2→1 只提示不 FAIL（还债是好事）');
  ok(audit({ 'a.js': 2 }, base).bad.length === 0, 'control：一模一样时不放水也不误报');
  // 正则本身也得是活的：真源文件里量得到东西
  const owner = current.MATERIAL.city['src/world/materials.js'] || 0;
  ok(owner >= 5, `materials.js 量到 ${owner} 处材质构造（正则不是写瞎的）`);
  ok((current.GEOMETRY.city['src/world/props.js'] || 0) >= 20, `props.js 量到 ${current.GEOMETRY.city['src/world/props.js']} 处几何构造`);
  ok((current.GEOMETRY.city['src/player/cat.js'] || 0) >= 5, `cat.js 量到 ${current.GEOMETRY.city['src/player/cat.js']} 处几何构造`);
  ok((current.MERGE.city['src/world/town.js'] || 0) >= 1, `town.js 量到 ${current.MERGE.city['src/world/town.js']} 处合并/实例化`);
}

// ---------- 1) 绝对红线 ----------
const hit = (re, files) => files.filter((f) => re.test(stripComments(textOf(f))));
const MAP = allFiles.filter((f) => f.startsWith('src/map/'));
const EDITOR_DATA = ['src/editor/state.js', 'src/editor/serialize.js'].filter((f) => fs.existsSync(path.join(ROOT, f)));
const LAYOUT = 'src/world/layout.js';

// 每条 = [名字, 命中的文件（空数组=过）, 踩线时怎么说]
const ABS_RULES = [
  ['数据层不碰 three', hit(/from 'three'|from "three"|new THREE\./, MAP),
    (f) => `src/map/ 是纯数据与算式（Node 门和 /__plan 端点都靠它不依赖渲染器），${f} 却引了 three`],
  ['地图真源只有 JSON', /from '\.\.\/\.\.\/data\/town-plan\.json/.test(stripComments(textOf(LAYOUT))) ? [] : [LAYOUT],
    () => `${LAYOUT} 不再 import data/town-plan.json —— 真源被绕开了`],
  ['落点不许手写进 JS', hit(/kind:\s*'/, [LAYOUT]),
    () => `${LAYOUT} 里出现了 { kind: '…' } —— 改地图请走 ops／编辑器／生成器，别在 JS 里铺坐标表`],
  ['地面高程单一来源', (hills) => hills.filter((f) => f !== 'src/map/terrain.js'),
    (f) => `hillsH 的定义出现在 ${f} —— 地面高程只准 src/map/terrain.js 一家出，别处再写一份，猫的脚和地面贴图就会分家`],
  ['碰撞盒单一来源', hit(/COLLIDERS\.push\(/, allFiles).filter((f) => f !== 'src/world/collision.js'),
    (f) => `COLLIDERS.push 出现在 ${f} —— 碰撞只准 collision.js 从 kind 的 SOLIDS 推`],
  ['数据层不吃随机', hit(/Math\.random\(\)/, [...MAP, ...EDITOR_DATA]),
    (f) => `数据层 ${f} 用了 Math.random() —— 摆物件/改外观必须用 ops.js 的 rng(seed)，AI 才复现得出来`],
  ['页面不许自己落盘', hit(/writeFileSync\(/, allFiles),
    (f) => `${f} 直接写文件 —— 存图只走 vite.config.js 的 /__plan 端点（有校验、有备份）`],
];
const hills = hit(/function hillsH\b/, allFiles);
ABS_RULES[3][1] = ABS_RULES[3][1](hills);
const abs = ABS_RULES.filter(([, files]) => files.length)
  .map(([name, files, say_]) => say_(files.join(', ')));
ok(abs.length === 0, `绝对红线 ${abs.length ? `踩了 ${abs.length}/${ABS_RULES.length} 条：\n     ${abs.join('\n     ')}`
  : `${ABS_RULES.length} 条全过（${ABS_RULES.map(([n]) => n).join('／')}）`}`);
// control：这些判据不是摆设 —— 拿注入的违规走一遍同一套函数
{
  const evil = {
    f1: "import * as THREE from 'three';\nexport const a = () => {}",
    f2: "export const P = { places: [{ kind: 'house', x: 1 }] };\n",
    f3: 'function hillsH(x, z) { return 0; }\n',
    f4: 'COLLIDERS.push({ cx: 0, cz: 0, r: 1 });\n',
    f5: 'const v = Math.random();\n',
    f6: "import { writeFileSync } from 'node:fs';\nwriteFileSync('x', '');\n",
  };
  const tests = [
    [/from 'three'|from "three"|new THREE\./, 'f1'],
    [/kind:\s*'/, 'f2'],
    [/function hillsH\b/, 'f3'],
    [/COLLIDERS\.push\(/, 'f4'],
    [/Math\.random\(\)/, 'f5'],
    [/writeFileSync\(/, 'f6'],
  ];
  const caught = tests.filter(([re, f]) => re.test(stripComments(evil[f]))).length;
  ok(caught === tests.length,
    `control：六类注入违规被同样的判据全抓到（${caught}/${tests.length}），上面那条不是运气`);
  ok(!/kind:\s*'/.test(stripComments("export const PLAN = import(x);\n// { kind: 'house' } 只是注释\n")),
    'control：注释里的示例落点不计入违规（判据不会把文档行当成手写数据）');
}

// ---------- 2) 棘轮 ----------
if (!BLESS && !fs.existsSync(BASELINE_FILE)) {
  say('FAIL 没有 tools/layering-baseline.json，先跑：node tools/layering-check.mjs --bless');
  process.exit(1);
}
if (fs.existsSync(BASELINE_FILE)) {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).counts;
  for (const [rule, cfg] of Object.entries(RULES)) {
    for (const [scope, dir] of Object.entries(SCOPES)) {
      const cur = current[rule][scope];
      const base = (baseline[rule] || {})[scope] || {};
      const { bad, shrunk } = audit(cur, base);
      const total = Object.values(cur).reduce((s, v) => s + v, 0);
      if (!bad.length && !Object.keys(base).length && !total) continue;
      const detail = bad.map((b) => b.kind === 'new'
        ? `${b.file} 新出现 ${b.n} 处（该走 ${cfg.route}）`
        : `${b.file} ${b.b}→${b.n}（多出来的 ${b.n - b.b} 处该走 ${cfg.route}）`).join('\n     ');
      ok(!bad.length, `${cfg.label}［${scope}／${dir}］${total} 处${bad.length ? `，越线 ${bad.length} 个文件：\n     ${detail}`
      : `（${Object.keys(cur).length} 个文件，与基线一致${shrunk.length ? '；已变瘦：' + shrunk.join('、') : ''}）`}`);
      if (!bad.length && shrunk.length) say('     ↑ 变瘦了记得重钉：node tools/layering-check.mjs --bless');
    }
  }
}

// ---------- 3) 单一入口自证：改外观/改地图的三条路都通向同一份 ops ----------
{
  const routes = [
    ['src/map/ops.js', /export function applyOps/],
    ['src/editor/batch.js', /place\.style/],
    ['vite.config.js', /__plan\/ops/],
    ['tools/plan-ops.mjs', /applyOps/],
  ].filter(([f, re]) => fs.existsSync(path.join(ROOT, f)) && re.test(textOf(f)));
  ok(routes.length === 4, `改图四条入口都还在：${routes.map(([f]) => f).join(' / ')}（面板与 AI 用的是同一个 applyOps，不是各写一套）`);
  const styleOwner = textOf('src/world/materials.js');
  ok(/export function mat\(/.test(styleOwner), 'materials.js 仍导出 mat()：外观参数的唯一出口');
  ok(/BUILDERS/.test(textOf('src/world/props.js')) && /BUILDERS/.test(textOf('src/world/town.js')),
    '新 kind 的登记链路还在：props.BUILDERS → town.js 装配');
}

if (BLESS) {
  if (fails) { say(`\n${fails} 条不合格 —— 红线没过，基线不钉。`); process.exit(1); }
  const n = Object.values(current).reduce((s, sc) => s + Object.values(sc).reduce((t, m) => t + Object.values(m).reduce((q, v) => q + v, 0), 0), 0);
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({
    note: '3D 构造点棘轮基线：只准减不准增。挪进框架入口变瘦之后，跑 node tools/layering-check.mjs --bless 重钉收紧。',
    owners: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.owners])),
    routes: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.route])),
    counts: current,
  }, null, 2) + '\n');
  say(`\n基线已钉：${n} 处构造点 → tools/layering-baseline.json`);
  process.exit(0);
}

say(fails ? `\n${fails} 条不合格：把构造点挪回框架里的入口，或确认确实该扩基线后跑 --bless` : '\n分层红线全部合格');
process.exit(fails ? 1 : 0);
