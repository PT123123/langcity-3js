// serialize.js — plan → 存档文本（一张记录一行，便于 git diff 与手写）
// 纯函数，不 import three：编辑器、Node 命令行工具、vite dev 中间件三条写入路径共用，
// 保证「谁改的图都是同一个排版」，否则一次 AI 批量改外观就能把整个文件重排成大 diff。

const LINES_KEYS = new Set(['hills', 'roads', 'terraces', 'flights', 'crosswalks', 'places', 'forestTrees']);
const PLAN_ORDER = [
  'R', 'LAT0', 'LON0', 'hills', 'sidewalkW', 'roads', 'terraces', 'flights', 'plaza',
  'parking', 'beachZ', 'forestLat', 'crosswalks', 'places', 'forestTrees',
];

export function serializePlan(plan) {
  const body = [];
  for (const k of PLAN_ORDER) {
    const v = plan[k];
    if (v === undefined) continue;
    if (LINES_KEYS.has(k)) {
      body.push(`  ${JSON.stringify(k)}: [`);
      body.push(v.map((o) => `    ${JSON.stringify(o)}`).join(',\n'));
      body.push('  ],');
    } else {
      body.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    }
  }
  if (!body.length) return '{}\n';
  body[body.length - 1] = body[body.length - 1].replace(/,$/, '');
  return `{\n${body.join('\n')}\n}\n`;
}
