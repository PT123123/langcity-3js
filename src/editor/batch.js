// batch.js — 「批量改外观」面板：一次挑一批，一次改一类，一条撤销退一整批。
//
// 面板不自己写 plan：它把控件状态拼成一串声明式 op（与 AI 接口 /__plan/ops、命令行 tools/plan-ops.mjs
// 同一套语义），交给 applyOps 算出新图再提交。于是界面上能做的，脚本一定能做，反之亦然 ——
// 不会出现「编辑器里有个按钮、AI 却调不出来」这种两套口径。
import { KINDS, GROUPS, kindInfo } from './kinds.js';
import { FLOOR_SPEC, buildingHeight } from '../map/style.js';
import { applyOps, findHits } from '../map/ops.js';
import { viewCenter } from './view2d.js';

// 随机候选色：与 props.js 色板同源的米色系（整条街各刷各的，但不会刷成大红大绿）
const WALL_PICKS = [0xf2ece0, 0xe8dcc8, 0xd6cfc2, 0xcfc4b4, 0xf6e8d8, 0xdfd3c0];
const ROOF_PICKS = [0x9a8f86, 0x7f8b96, 0x8a9a86, 0xb9a89a, 0xc08e8a, 0x6f7d8c];

let H = null;                       // 由 app.js 注入的钩子
let el = null;

const q = (id) => el.querySelector(id);
const num = (node) => {
  const v = parseFloat(node.value);
  return Number.isFinite(v) ? v : null;
};

export function mountBatch(hooks) {
  H = hooks;
  el = document.getElementById('batch-body');
  el.innerHTML = `
    <p class="note">先说改哪些，再说改成什么样。按一次「就改这些」＝一条撤销。</p>

    <h4>改哪些</h4>
    <div class="field"><label>物件类型</label><select id="b-kind"></select></div>
    <div class="field"><label>只改屏幕中心附近</label><input type="number" id="b-radius" step="2" placeholder="不填＝全图" /><span class="unit">米内</span></div>
    <div class="field"><label>最多改几条</label><input type="number" id="b-limit" step="1" min="1" placeholder="不限" /><span class="unit">条</span></div>
    <div class="field"><label>随机抽几成</label><input type="number" id="b-every" step="10" min="1" max="100" placeholder="100" /><span class="unit">%</span></div>

    <h4>改成什么样</h4>
    ${colorRow('wall', '外墙色', '这 6 套米色外墙')}
    ${colorRow('roof', '屋顶色', '这 6 顶瓦色')}
    <div class="field batch-row" data-k="floors">
      <label><input type="checkbox" id="b-floors-on" /> 层数</label>
      <div class="batch-vals">
        <input type="number" id="b-floors" step="1" min="1" class="short" /><span class="unit">层（都盖这么多）</span>
        <label class="inline"><input type="checkbox" id="b-floors-rand" /> 高低错落：在 <input type="number" id="b-floors-lo" step="1" class="tiny" /> ~ <input type="number" id="b-floors-hi" step="1" class="tiny" /> 层里随机</label>
        <p class="hint" id="b-floors-hint"></p>
      </div>
    </div>
    <div class="field batch-row" data-k="v">
      <label><input type="checkbox" id="b-v-on" /> 外观编号</label>
      <div class="batch-vals">
        <input type="number" id="b-v" step="1" min="0" class="short" /><span class="unit">号（都换这个）</span>
        <label class="inline"><input type="checkbox" id="b-v-rand" /> 在 0 ~ <input type="number" id="b-v-max" step="1" class="tiny" value="4" /> 号里随机</label>
      </div>
    </div>
    <div class="field batch-row" data-k="s">
      <label><input type="checkbox" id="b-s-on" /> 尺度</label>
      <div class="batch-vals">
        <input type="number" id="b-s" step="0.05" min="0.05" class="short" /><span class="unit">倍（1＝原大）</span>
      </div>
    </div>
    <div class="field"><label>随机种子</label><input type="number" id="b-seed" step="1" value="7" /><span class="unit">同种子＝同一批结果</span></div>

    <div class="insp-actions">
      <button class="chip primary" id="b-apply">就改这些</button>
      <button class="chip" id="b-look">3D 看这批</button>
    </div>
    <p class="note">想整条街换风格、给某个方向的路面换材质，这类活儿也能让 AI 直接改：接口说明在 <b>GET /__plan/ops</b>。</p>`;

  q('#b-kind').innerHTML = `<option value="">全部类型</option>` + GROUPS.map((g) =>
    `<optgroup label="${g.name}">${KINDS.filter((k) => k.group === g.id)
      .map((k) => `<option value="${k.kind}">${k.label}</option>`).join('')}</optgroup>`).join('');

  for (const input of el.querySelectorAll('input, select')) {
    input.addEventListener('change', readout);
    if (input.type === 'number' || input.type === 'color') input.addEventListener('input', readout);
  }
  q('#b-apply').onclick = commit;
  q('#b-look').onclick = lookBatch;
  readout();
}

const colorRow = (key, label, picksLabel) => `
  <div class="field batch-row" data-k="${key}">
    <label><input type="checkbox" id="b-${key}-on" /> ${label}</label>
    <div class="batch-vals">
      <input type="color" id="b-${key}" class="short" value="#e8dcc8" /><span class="unit">都涂这个色</span>
      <label class="inline"><input type="checkbox" id="b-${key}-rand" /> 一栋一个样：在${picksLabel}里随机</label>
    </div>
  </div>`;

/** 控件状态 → where 筛选器（什么都不填＝整表） */
function currentWhere() {
  const w = {};
  const kind = q('#b-kind').value;
  if (kind) w.kind = kind;
  const r = num(q('#b-radius'));
  if (r && r > 0) { const c = viewCenter(); w.near = { x: c.x, z: c.z, r }; }
  const lim = num(q('#b-limit'));
  if (lim && lim > 0) w.limit = Math.round(lim);
  const pct = num(q('#b-every'));
  if (pct && pct > 0 && pct < 100) w.every = pct / 100;
  return w;
}

function currentStyle() {
  const on = (k) => q(`#b-${k}-on`).checked;
  const o = {};
  const swatch = (k) => parseInt(q(`#b-${k}`).value.slice(1), 16);
  if (on('wall')) o.wall = q('#b-wall-rand').checked ? WALL_PICKS : swatch('wall');
  if (on('roof')) o.roof = q('#b-roof-rand').checked ? ROOF_PICKS : swatch('roof');
  if (on('floors')) {
    if (q('#b-floors-rand').checked) {
      const lo = num(q('#b-floors-lo')), hi = num(q('#b-floors-hi'));
      if (lo && hi && hi > lo) o.floors = [Math.round(lo), Math.round(hi)];
    } else {
      const f = num(q('#b-floors'));
      if (f) o.floors = Math.round(f);
    }
  }
  if (on('v')) {
    if (q('#b-v-rand').checked) o.v = [0, Math.round(num(q('#b-v-max')) ?? 4)];
    else { const v = num(q('#b-v')); if (v !== null) o.v = Math.round(v); }
  }
  if (on('s')) { const s = num(q('#b-s')); if (s) o.s = s; }
  return o;
}

const currentOps = () => {
  const style = currentStyle();
  if (!Object.keys(style).length) return [];
  return [{ op: 'place.style', where: currentWhere(), ...style, seed: Math.round(num(q('#b-seed')) ?? 1) }];
};

const hitsOf = (ops) => (ops.length ? findHits(H.plan().places, ops[0].where, ops[0].seed).length : 0);

const hex = (v) => `#${Number(v).toString(16).padStart(6, '0')}`;
function describe(o) {
  const parts = [];
  if (o.wall !== undefined) parts.push(Array.isArray(o.wall) ? '外墙一栋一色' : `外墙涂 ${hex(o.wall)}`);
  if (o.roof !== undefined) parts.push(Array.isArray(o.roof) ? '屋顶一栋一瓦' : `屋顶涂 ${hex(o.roof)}`);
  if (o.floors !== undefined) parts.push(Array.isArray(o.floors) ? `${o.floors[0]}~${o.floors[1]} 层错落` : `统一 ${o.floors} 层`);
  if (o.v !== undefined) parts.push(Array.isArray(o.v) ? `外观 0~${o.v[1]} 随机` : `外观 ${o.v} 号`);
  if (o.s !== undefined) parts.push(`放大到 ${o.s} 倍`);
  const w = o.where || {};
  const scope = w.kind ? (kindInfo(w.kind)?.label || w.kind) : '所有物件';
  const extra = w.near ? `（${w.near.r.toFixed(0)} 米内）` : w.limit ? `（最多 ${w.limit} 个）` : '';
  return `${scope}${extra}：${parts.join('，')}`;
}

/** 读数：面板里说清这一型能盖多高，底栏报命中数（计数沉到底栏） */
function readout() {
  const kind = q('#b-kind').value;
  const sp = FLOOR_SPEC[kind];
  const hint = q('#b-floors-hint');
  if (kind) {
    const top = buildingHeight(kind, sp?.max);
    hint.textContent = sp
      ? `这一型 ${sp.min}~${sp.max} 层、层高 ${sp.fh} 米；拉满 ${sp.max} 层约 ${top.total.toFixed(1)} 米高`
      : '这一型是平层物件，没有层数可改';
  } else {
    hint.textContent = `选「全部类型」时层数只落在 ${Object.keys(FLOOR_SPEC).join('、')}，其余类型自动跳过`;
  }
  q('[data-k=floors]').classList.toggle('dim', Boolean(kind) && !sp);
  const ops = currentOps();
  const n = hitsOf(ops);
  H.setReadout(ops.length ? `批量改外观：命中 ${n} 个` : '批量改外观：还没勾选要改什么');
  q('#b-apply').disabled = !ops.length || !n;
  q('#b-look').disabled = !n;
}

function lookBatch() {
  const ops = currentOps();
  const idx = findHits(H.plan().places, ops[0]?.where || {}, ops[0]?.seed || 1);
  if (!idx.length) return H.float('这一批一个都没命中');
  const ps = idx.map((i) => H.plan().places[i]);
  const c = ps.reduce((a, p) => ({ x: a.x + p.x / ps.length, z: a.z + p.z / ps.length }), { x: 0, z: 0 });
  H.flyTo(c.x, c.z);
  H.float(`这批共 ${ps.length} 个，镜头已对准它们`);
}

function commit() {
  const ops = currentOps();
  if (!ops.length) return H.float('还没勾选要改的外观');
  const { plan, report } = applyOps(H.plan(), ops);
  if (report.errors.length) return H.float(report.errors[0]);
  if (!report.changed) return H.float('这一批一个都没命中');
  H.commit(plan, `改了 ${report.changes[0].n} 个物件的外观`, describe(ops[0]));
}
