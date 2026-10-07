// app.js — 地图编辑器主控：装配三视图、调色板、属性面板、快捷键、保存与体检
import { PHASES } from '../world/sky.js';
import { SOLIDS } from '../world/layout.js';
import { WORDS } from '../game/words.js';
import {
  S, loadPlan, savePlan, downloadPlan, snapshot, undo, redo, emit, onChange,
  undoDepth, serializePlan, setPlan,
} from './state.js';
import {
  attach2d, render2d, resize2d, fitView, focusOn, objOf,
  setShowTrees, setArmed, planToLocal, viewCenter, roadVerts, setRoadVert,
} from './view2d.js';
import {
  rebuildTown, rebuildPlanet, moveMarker, flyTo, resize3d, startLoop, setPhase, dbg3d, core,
} from './view3d.js';
import { checkPlan } from './problems.js';
import { KINDS, GROUPS, GROUP_COLORS, kindInfo, colorFor } from './kinds.js';
import { mountBatch } from './batch.js';
import { applyOps, findHits, OPS_DOC } from '../map/ops.js';

const $ = (id) => document.getElementById(id);
const saveStateEl = $('save-state');
const phaseLabels = PHASES.map((p) => p.label);
let phaseIdx = 2;
let armed = null;
let autoPreview = true;
let previewTimer = null;
let lastPlanJson = JSON.stringify(S.plan);

// ---------- 启动：从 dev server 读最新版 ----------
(async function boot() {
  try {
    await loadPlan();
    setSaveState('ok', `已载入 data/town-plan.json`);
  } catch (e) {
    setSaveState('err', `读服务器失败，用构建期垫底数据：${e.message}`);
  }
  buildPalette();
  buildTabs();
  mountBatch({
    plan: () => S.plan,
    setReadout: (t) => { $('stat-batch').textContent = t; },
    float, flyTo,
    commit: (newPlan, msg, detail) => {
      snapshot();                 // 一整批只压一条撤销
      setPlan(newPlan);
      emit();
      render2d();
      rebuildTownNow();
      runCheck(false);
      float(`${msg} · ${detail}`, '改回去', doUndo);
    },
  });
  buildWordPicker();
  buildWorldPanel();
  render2d();
  rebuildTownNow();
  updateStats();
  runCheck(false);
})();

attach2d({
  onSelect: refreshInspector,
  onEdited: () => { syncInspectorLive(); markDirty(); },
  onHover: () => {},
  onPlace: placeNew,
});
onChange(() => {
  markDirty();
  updateStats();
  schedulePreview();
});

// ---------- 保存状态 / 底栏 ----------
function setSaveState(kind, text) {
  saveStateEl.className = 'save-state' + (kind === 'dirty' ? ' dirty' : kind === 'err' ? ' err' : '');
  saveStateEl.textContent = text;
}
function markDirty() {
  if (S.dirty) setSaveState('dirty', '有改动未保存（Ctrl+S）');
  updateStats();
}
function updateStats() {
  const P = S.plan;
  const learnable = P.places.filter((p) => p.word).length;
  const relief = (P.terraces?.length || 0) + (P.flights?.length || 0);
  $('stat-places').textContent = `可学习物件 ${learnable} 个（共 ${P.places.length} 件）`;
  $('stat-roads').textContent = `道路 ${P.roads.length} 条 · 造成 ${relief} 处 · 森林树 ${P.forestTrees.length} 棵 · 占位碰撞 ${Object.keys(SOLIDS).length} 类`;
  $('stat-undo').textContent = `可撤销 ${undoDepth()} 步`;
  if ($('relief-sec')) renderReliefSection();
}

// ---------- 浮条：每个改动数据的动作都给一条反向写的 ----------
let floatTimer = null;
let floatSeq = 0;                 // 按一次动作＝换一条浮条；换了新的一条就别再把刚显示的那条藏掉
function float(msg, actLabel, actFn) {
  const bar = $('floatbar');
  const seq = ++floatSeq;
  $('float-msg').textContent = msg;
  const btn = $('float-act');
  if (actLabel) {
    btn.textContent = actLabel;
    btn.onclick = () => { actFn(); if (floatSeq === seq) hideFloat(); };
    btn.style.display = '';
  } else btn.style.display = 'none';
  bar.classList.remove('hidden');
  clearTimeout(floatTimer);
  floatTimer = setTimeout(hideFloat, 4200);
}
const hideFloat = () => $('floatbar').classList.add('hidden');
$('float-act').parentElement.insertAdjacentHTML('beforeend',
  '<button class="close" title="关掉">✕</button>');
$('floatbar').querySelector('.close').onclick = hideFloat;

// ---------- 撤销 / 重做 ----------
// 浮条上的反向动作必须挂这两个包装函数，不能直接挂 state.js 的 undo/redo：
// 裸的那两个只换 plan 数据，不走 afterPlanSwapped()，于是图改了、2D/3D/属性面板/底栏计数全都还停在旧图。
function doUndo() {
  const msg = undo();
  afterHistory(msg ? `已退回改动前` : null, msg ? '重做到这一步' : '没有可撤销的步骤',
    msg ? doRedo : null);
  afterPlanSwapped();
}
function doRedo() {
  const msg = redo();
  afterHistory(msg ? '已重做到这一步' : null, msg ? '撤销回去' : null, msg ? doUndo : null);
  afterPlanSwapped();
}
function afterHistory(msg, actLabel, actFn) {
  if (msg) float(msg, actLabel, actFn); else float('没有可操作的记录');
}
function afterPlanSwapped() {
  const sel = S.sel;
  if (sel && !objOf(sel)) S.sel = null;
  refreshInspector();
  render2d();
  updateStats();
  rebuildTownNow();
  runCheck(false);
  setSaveState(S.dirty ? 'dirty' : 'ok', S.dirty ? '有改动未保存（Ctrl+S）' : '已同步');
}

// ---------- 3D 预览重建 ----------
function structuralChanged() {
  // 道路/广场/停车场/斑马线/山丘变了才值得重画星球贴图（1~2 秒）
  const a = JSON.parse(lastPlanJson), b = S.plan;
  for (const k of ['roads', 'plaza', 'parking', 'crosswalks', 'hills', 'sidewalkW', 'beachZ']) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return k;
  }
  return null;
}
function schedulePreview() {
  if (!autoPreview) return;
  clearTimeout(previewTimer);
  $('preview-busy').classList.remove('hidden');
  previewTimer = setTimeout(() => {
    const why = structuralChanged();
    if (why) rebuildPlanetNow();
    else rebuildTownNow();
    lastPlanJson = JSON.stringify(S.plan);
  }, 500);
}
let rebuilding = false;
function rebuildTownNow() {
  if (rebuilding) return;
  rebuilding = true;
  // 挂一帧只为了不在拖动的中途重搭，不用非 rAF 不可：窗口被遮挡/最小化时 rAF 根本不回调，
  // rebuilding 会永久卡在 true，「正在重建 3D 预览…」也一并卡住不消失
  setTimeout(() => {
    rebuildTown(S.plan);
    moveMarker();
    rebuilding = false;
    $('preview-busy').classList.add('hidden');
  }, 16);
}
function rebuildPlanetNow() {
  $('preview-busy').classList.remove('hidden');
  setTimeout(() => { rebuildPlanet(S.plan); rebuildTownNow(); }, 30);
}

// ---------- 左栏分页（摆物件 / 批量改外观）：一个能力一个入口，不塞进属性面板 ----------
function buildTabs() {
  for (const t of document.querySelectorAll('.aside-tabs .tab')) {
    t.onclick = () => {
      for (const o of document.querySelectorAll('.aside-tabs .tab')) o.classList.toggle('on', o === t);
      for (const p of document.querySelectorAll('.tab-pane')) p.classList.toggle('hidden', p.id !== `tab-${t.dataset.tab}`);
    };
  }
}

// ---------- 调色板 ----------
function buildPalette() {
  const list = $('palette-list');
  const search = $('palette-search');
  const render = () => {
    const q = search.value.trim();
    list.innerHTML = '';
    for (const g of GROUPS) {
      const items = KINDS.filter(
        (k) => k.group === g.id && (!q || k.label.includes(q) || k.kind.toLowerCase().includes(q.toLowerCase()))
      );
      if (!items.length) continue;
      const h = document.createElement('div');
      h.className = 'pal-group';
      h.textContent = g.name;
      list.appendChild(h);
      for (const info of items) {
        const row = document.createElement('div');
        row.className = 'pal-item' + (armed === info.kind ? ' armed' : '');
        row.dataset.kind = info.kind;
        row.innerHTML =
          `<span class="pal-swatch" style="background:${GROUP_COLORS[g.id]}"></span>` +
          `<span>${info.label}</span><span class="pal-count">${info.kind}</span>`;
        row.onclick = () => armKind(armed === info.kind ? null : info.kind);
        list.appendChild(row);
      }
    }
  };
  search.oninput = render;
  list._render = render;
  render();
}
function armKind(kind) {
  armed = kind;
  setArmed(kind);
  for (const row of $('palette-list').querySelectorAll('.pal-item')) {
    row.classList.toggle('armed', row.dataset.kind === kind);
  }
  $('plan').style.cursor = kind ? 'copy' : '';
}
function placeNew(kind, x, z) {
  const info = kindInfo(kind);
  const place = { kind, word: info?.word || '', x, z, rotY: 0 };
  if (['vending', 'car', 'bicycle', 'dog', 'catNpc', 'bird', 'npc', 'house', 'mansion', 'tower', 'office', 'hotel'].includes(kind)) place.v = 0;
  if (['tree', 'sakura', 'flowers', 'grassTuft'].includes(kind)) place.s = 1;
  S.plan.places.push(place);
  const i = S.plan.places.length - 1;
  S.sel = { type: 'place', i };
  emit();
  float(`放了一个${info?.label || kind}`, '拿掉它', () => removeAt(i));
  refreshInspector();
  render2d();
}

// ---------- 属性面板 ----------
const wordIds = WORDS.map((w) => w.id);
function buildWordPicker() {
  const dl = document.createElement('datalist');
  dl.id = 'word-list';
  dl.innerHTML = WORDS.map((w) => `<option value="${w.id}">${w.ja}（${w.zh}）</option>`).join('');
  document.body.appendChild(dl);
}

function refreshInspector() {
  const box = $('insp-body');
  const sel = S.sel;
  moveMarker();
  if (!sel) {
    $('insp-title').textContent = '没选中东西';
    box.innerHTML = '<p class="note">在平面图上点一个物件，或点一条路：选中后能拖端点，按「路中加折点」就能把路拉弯。</p>';
    return;
  }
  const o = objOf(sel);
  if (!o) { S.sel = null; return refreshInspector(); }
  if (sel.type === 'road') { renderRoadInspector(sel, o, box); return; }
  if (sel.type === 'terrace' || sel.type === 'flight') { renderReliefInspector(sel, o, box); return; }
  const isPlace = sel.type === 'place';
  const info = isPlace ? kindInfo(o.kind) : null;
  $('insp-title').textContent = isPlace ? `${info?.label || o.kind} #${sel.i}` : `森林装饰树 #${sel.i}`;
  const rows = [num('位置 东', o.x), num('位置 南', o.z)];
  if (isPlace || true) rows.push(num('朝向', Math.round((((o.rotY || 0) * 180 / Math.PI) % 360 + 360) % 360), 5, '°'));
  rows.push(num('尺度', o.s ?? 1, 0.05));
  if (isPlace) {
    rows.push(num('外观编号', o.v ?? 0, 1));
    rows.push(`<div class="field"><label>单词</label><input data-f="word" value="${o.word || ''}" list="word-list" placeholder="词库 id" /></div>`);
    rows.push(`<div class="field"><label>类型</label><select data-f="kind">${
      KINDS.map((k) => `<option value="${k.kind}"${k.kind === o.kind ? ' selected' : ''}>${k.label} ${k.kind}</option>`).join('')
    }${KINDS.some((k) => k.kind === o.kind) ? '' : `<option value="${o.kind}" selected>${o.kind}（未知类型）</option>`}</select></div>`);
  }
  box.innerHTML = fieldsHTML(rows) + actionsHTML([
    ['dup', '复制一份'],
    ['view', '3D 看它'],
    ...(isPlace ? [['del', '删掉']] : [['del', '删掉这棵树']]),
  ]);
  bindFields(sel, box);
  box.querySelector('[data-act=dup]').onclick = () => duplicateSel();
  box.querySelector('[data-act=view]').onclick = () => flyTo(o.x, o.z);
  box.querySelector('[data-act=del]').onclick = () => removeAt(sel.i, sel.type);
}

const num = (label, v, step = 0.1, unit = '米') =>
  `<div class="field"><label>${label}</label><input type="number" step="${step}" value="${round6(v)}" /><span class="unit">${unit}</span></div>`;
const numF = (k, label, v, step = 0.1, unit = '米') =>
  `<div class="field" data-k="${k}"><label>${label}</label><input type="number" step="${step}" value="${v === undefined || v === null ? '' : round6(v)}" /><span class="unit">${unit}</span></div>`;
const selF = (k, label, value, opts) =>
  `<div class="field" data-k="${k}"><label>${label}</label><select>${
    opts.map(([v, t]) => `<option value="${v}"${v === value ? ' selected' : ''}>${t}</option>`).join('')
  }</select></div>`;

// ---------- 道路面板：直线与折线一视同仁，逐折点给坐标和路面抬升 ----------
const SURF_NAMES = { asphalt: '沥青', cobble: '石板路', brick: '砖石', gravel: '碎石' };

const vertE = (rd, k) => (Array.isArray(rd.pts) ? rd.e?.[k] ?? 0 : k === 0 ? rd.e1 ?? 0 : rd.e2 ?? 0);

function setVertE(rd, k, v) {
  if (Array.isArray(rd.pts)) { rd.e ||= roadVerts(rd).map((_, i) => vertE(rd, i)); rd.e[k] = v; }
  else if (k === 0) rd.e1 = v; else rd.e2 = v;
}

/** 直线 → 折线：点位与逐点高程原样搬过去，之后所有折点编辑都只走 pts/e 一套口径 */
function toPolyline(rd) {
  if (Array.isArray(rd.pts)) return rd;
  const vs = roadVerts(rd);
  // 高程必须在写 pts 之前取：先写了 pts，vertE 就会改去读还不存在的 rd.e，把 0.45 悄悄清零
  const es = vs.map((_, k) => vertE(rd, k));
  rd.pts = vs.map((v) => [round6(v.x), round6(v.z)]);
  rd.e = es;
  for (const k of ['x1', 'z1', 'x2', 'z2', 'e1', 'e2']) delete rd[k];
  return rd;
}

/** 只剩两个折点时收回直线写法：真源里少一种写法，就少一处将来要对齐的口径 */
function straighten(rd) {
  if (!Array.isArray(rd.pts) || rd.pts.length !== 2) return rd;
  const [a, b] = rd.pts;
  rd.x1 = a[0]; rd.z1 = a[1]; rd.x2 = b[0]; rd.z2 = b[1];
  rd.e1 = rd.e?.[0] ?? 0; rd.e2 = rd.e?.[1] ?? 0;
  delete rd.pts; delete rd.e;
  return rd;
}

const roadMid = (rd) => { const vs = roadVerts(rd); return { x: (vs[0].x + vs.at(-1).x) / 2, z: (vs[0].z + vs.at(-1).z) / 2 }; };

function renderRoadInspector(sel, o, box) {
  const vs = roadVerts(o);
  $('insp-title').textContent = `道路 #${sel.i} · ${vs.length} 个折点`;
  const rows = [
    numF('w', '半宽', o.w, 0.1),
    selF('surf', '路面材质', o.surf || 'asphalt', Object.entries(SURF_NAMES).map(([v, t]) => [v, t])),
    numF('efade', '抬升过渡宽', o.efade ?? 3, 0.5),
  ];
  vs.forEach((v, k) => {
    const name = vs.length === 2 ? (k === 0 ? '起点' : '终点') : `折点 #${k}`;
    rows.push(numF(`v${k}x`, `${name} 东`, v.x));
    rows.push(numF(`v${k}z`, `${name} 南`, v.z));
    rows.push(numF(`v${k}e`, `${name} 路面抬升`, vertE(o, k), 0.05));
    if (k > 0 && k < vs.length - 1) rows.push(`<div class="field"><label>&nbsp;</label><button class="chip" data-drop="${k}">拆掉${name}</button></div>`);
  });
  box.innerHTML = rows.join('') + actionsHTML([['split', '路中加折点'], ['view', '3D 看这条路'], ['del', '删掉这条路']]);

  for (const f of box.querySelectorAll('.field')) {
    const input = f.querySelector('input, select');
    if (!input) continue;
    const k = f.dataset.k;
    const apply = () => {
      snapshot();
      if (k === 'surf') {
        o.surf = input.value;
      } else {
        const val = parseFloat(input.value) || 0;
        if (k === 'w') o.w = Math.max(0.2, val);
        else if (k === 'efade') o.efade = Math.max(0, val);
        else {
          const m = /^v(\d+)(x|z|e)$/.exec(k);
          const kk = +m[1];
          if (m[2] === 'e') setVertE(o, kk, val);
          else setRoadVert(o, kk, m[2] === 'x' ? round6(val) : roadVerts(o)[kk].x, m[2] === 'z' ? round6(val) : roadVerts(o)[kk].z);
        }
      }
      emit(); render2d(); runCheck(false);
    };
    input.onchange = apply;
    if (input.type === 'number') input.oninput = () => { input._deb && clearTimeout(input._deb); input._deb = setTimeout(apply, 400); };
  }

  box.querySelector('[data-act=split]').onclick = () => {
    snapshot();
    const before = roadVerts(o);
    let bi = 0, bl = 0;                                   // 在最长的那一段中间加折点，弯才加得有道理
    for (let i = 0; i < before.length - 1; i++) {
      const l = Math.hypot(before[i + 1].x - before[i].x, before[i + 1].z - before[i].z);
      if (l > bl) { bl = l; bi = i; }
    }
    toPolyline(o);
    const a = o.pts[bi], b = o.pts[bi + 1];
    o.pts.splice(bi + 1, 0, [round6((a[0] + b[0]) / 2), round6((a[1] + b[1]) / 2)]);
    o.e.splice(bi + 1, 0, round6(((o.e[bi] ?? 0) + (o.e[bi + 1] ?? 0)) / 2));
    emit(); render2d(); runCheck(false); refreshInspector();
    const at = bi + 1;
    float(`加了折点 #${at}，拖着它就能把路拉弯`, '把折点拆回去', () => {
      snapshot(); toPolyline(o); o.pts.splice(at, 1); o.e.splice(at, 1); straighten(o);
      emit(); render2d(); runCheck(false); refreshInspector();
    });
  };
  for (const b of box.querySelectorAll('[data-drop]')) {
    b.onclick = () => {
      const kk = +b.dataset.drop;
      snapshot();
      const gone = { p: o.pts[kk], e: o.e?.[kk] ?? 0 };
      o.pts.splice(kk, 1); if (Array.isArray(o.e)) o.e.splice(kk, 1); straighten(o);
      emit(); render2d(); runCheck(false); refreshInspector();
      float(`拆掉了折点 #${kk}`, '把折点放回去', () => {
        snapshot(); toPolyline(o); o.pts.splice(kk, 0, gone.p); if (Array.isArray(o.e)) o.e.splice(kk, 0, gone.e);
        emit(); render2d(); runCheck(false); refreshInspector();
      });
    };
  }
  box.querySelector('[data-act=view]').onclick = () => { const m = roadMid(o); flyTo(m.x, m.z); };
  box.querySelector('[data-act=del]').onclick = () => {
    snapshot();
    S.plan.roads.splice(sel.i, 1);
    S.sel = null;
    emit();
    float('删了一条路', '把路加回来', () => { snapshot(); S.plan.roads.splice(sel.i, 0, o); S.sel = null; emit(); });
    refreshInspector(); render2d();
  };
}

const TC_KEYS = { x: '米', z: '米', rotY: '°', hw: '米', hd: '米', h: '米', apron: '米' };
const FL_KEYS = { x: '米', z: '米', rotY: '°', w: '米', run: '米', rise: '米', steps: '级' };

/** 造成记录（台地 / 石阶 / 坡道）的属性面板：数字直接改，一条撤销回一个动作 */
function renderReliefInspector(sel, o, box) {
  const isTc = sel.type === 'terrace';
  const keys = isTc ? TC_KEYS : FL_KEYS;
  const n = (k, label, v, step = 0.1) => numF(k, label, v, step, keys[k]);
  const deg = Math.round((((o.rotY || 0) * 180 / Math.PI) % 360 + 360) % 360);
  $('insp-title').textContent = isTc ? `造成台地 #${sel.i}`
    : `${(o.kind || 'stair') === 'ramp' ? '坡道' : '石阶'} #${sel.i}`;
  const rows = isTc
    ? [n('x', '中心 东', o.x), n('z', '中心 南', o.z), n('rotY', '长边朝向', deg, 5),
       n('hw', '半宽 东西', o.hw), n('hd', '半深 南北', o.hd), n('h', '台面抬升', o.h, 0.05),
       selF('edge', '边缘做法', o.edge || 'wall', [['wall', '垂直挡墙'], ['slope', '放坡草坡']]),
       n('apron', '放坡裙宽', o.apron ?? 1.6)]
    : [n('x', '坡脚 东', o.x), n('z', '坡脚 南', o.z), n('rotY', '上坡朝向', deg, 5),
       n('w', '净宽', o.w), n('run', '水平坡长', o.run), n('rise', '抬升', o.rise, 0.05),
       n('steps', '阶数（空=自动）', o.steps, 1),
       selF('kind', '形式', o.kind || 'stair', [['stair', '石阶'], ['ramp', '坡道']])];
  rows.push(`<div class="field" data-k="word"><label>单词</label><input value="${o.word || ''}" list="word-list" placeholder="词库 id" /></div>`);
  box.innerHTML = rows.join('') + actionsHTML([['view', '3D 看它'], ['del', '删掉这条造成']]);

  for (const f of box.querySelectorAll('.field')) {
    const input = f.querySelector('input, select');
    const k = f.dataset.k;
    const apply = () => {
      snapshot();
      if (k === 'word') {
        const v = input.value.trim();
        if (v) o.word = v; else delete o.word;
      } else if (k === 'rotY') {
        o.rotY = (parseFloat(input.value) || 0) * Math.PI / 180;
      } else if (k === 'edge' || k === 'kind') {
        o[k] = input.value;
      } else {
        const v = parseFloat(input.value);
        if (Number.isNaN(v)) delete o[k]; else o[k] = v;
      }
      emit();
      render2d();
      runCheck(false);
    };
    input.onchange = apply;
    if (input.type === 'number') input.oninput = () => { input._deb && clearTimeout(input._deb); input._deb = setTimeout(apply, 400); };
  }
  box.querySelector('[data-act=view]').onclick = () => flyTo(o.x, o.z);
  box.querySelector('[data-act=del]').onclick = () => {
    const arr = isTc ? S.plan.terraces : S.plan.flights;
    snapshot();
    arr.splice(sel.i, 1);
    S.sel = null;
    emit();
    float(isTc ? '删掉了一块台地' : '删掉了一条梯道', isTc ? '把台地加回来' : '把梯道加回来', () => {
      snapshot(); arr.splice(sel.i, 0, o); S.sel = null; emit();
    });
    refreshInspector(); render2d(); runCheck(false);
  };
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const round1 = (v) => Math.round(v * 10) / 10;
const fieldsHTML = (rows) => rows.join('');
const actionsHTML = (acts) => `<div class="insp-actions">${acts.map(([a, t]) => `<button class="chip" data-act="${a}">${t}</button>`).join('')}</div>`;

function bindFields(sel, box) {
  const o = objOf(sel);
  const inputs = box.querySelectorAll('.field');
  inputs.forEach((f) => {
    const input = f.querySelector('input, select');
    if (!input) return;
    const label = f.querySelector('label').textContent.trim();
    const apply = () => {
      let v = input.value;
      snapshot();
      if (label === '位置 东') o.x = parseFloat(v) || 0;
      else if (label === '位置 南') o.z = parseFloat(v) || 0;
      else if (label === '朝向') o.rotY = (parseFloat(v) || 0) * Math.PI / 180;
      else if (label === '尺度') o.s = parseFloat(v) || 1;
      else if (label === '外观编号') o.v = Math.round(parseFloat(v) || 0);
      else if (label === '单词') o.word = v.trim();
      else if (label === '类型') o.kind = v;
      emit();
      render2d();
    };
    input.onchange = apply;
    if (input.type === 'number') input.oninput = () => { input._deb && clearTimeout(input._deb); input._deb = setTimeout(apply, 300); };
  });
}

/** 拖动中的实时同步：只改面板数字与标记，不重建 3D */
function syncInspectorLive() {
  const sel = S.sel;
  if (!sel) return;
  if (sel.type === 'road') {          // 道路面板的折点行随拖动重画（拖画布时不可能在输入框里打字）
    const o = objOf(sel);
    if (o) renderRoadInspector(sel, o, $('insp-body'));
    return;
  }
  const o = objOf(sel);
  const box = $('insp-body');
  const nums = box.querySelectorAll('input[type=number]');
  if (nums.length >= 2) { nums[0].value = round6(o.x); nums[1].value = round6(o.z); }
  moveMarker();
}

function duplicateSel() {
  const sel = S.sel;
  if (!sel || sel.type === 'road') return;
  const src = objOf(sel);
  const copy = structuredClone(src);
  copy.x = Math.round((copy.x + 1.2) * 10) / 10;
  snapshot();
  S.plan[sel.type === 'place' ? 'places' : 'forestTrees'].push(copy);
  S.sel = { type: sel.type, i: S.plan[sel.type === 'place' ? 'places' : 'forestTrees'].length - 1 };
  emit();
  float('复制了一份', '撤掉这份', () => removeAt(S.plan.places.length - 1, sel.type));
  refreshInspector();
  render2d();
}

function removeAt(i, type = S.sel?.type) {
  const arr = type === 'tree' ? S.plan.forestTrees : S.plan.places;
  if (!arr[i]) return;
  snapshot();
  const removed = arr.splice(i, 1)[0];
  if (S.sel && S.sel.type !== 'road' && S.sel.i >= i) S.sel = null;
  emit();
  float('删掉了一个物件', '把它放回来', () => {
    snapshot();
    arr.splice(Math.min(i, arr.length), 0, removed);
    emit();
    render2d();
  });
  refreshInspector();
  render2d();
}

// ---------- 世界参数面板 ----------
function buildWorldPanel() {
  const P = S.plan;
  const rows = [
    ['星球半径 R', 'R', 1], ['中心纬度', 'LAT0deg', 0.5],
    ['人行道宽', 'sidewalkW', 0.05], ['海滩起点 南', 'beachZ', 0.5],
    ['广场·东', 'plaza.x', 0.1], ['广场·南', 'plaza.z', 0.1], ['广场·半径', 'plaza.r', 0.1],
    ['停车场 x1', 'parking.x1', 0.1], ['停车场 z1', 'parking.z1', 0.1],
    ['停车场 x2', 'parking.x2', 0.1], ['停车场 z2', 'parking.z2', 0.1],
  ];
  $('world-body').innerHTML = rows.map(([label, key, step]) => {
    const v = key.includes('.') ? getPath(P, key) : (key === 'LAT0deg' ? P.LAT0 * 180 / Math.PI : P[key]);
    return `<div class="field"><label>${label}</label><input type="number" step="${step}" data-w="${key}" value="${round6(v)}" /><span class="unit">${key === 'LAT0deg' ? '度' : '米'}</span></div>`;
  }).join('') + '<p class="note">改半径/纬度/海滩会连地图底色一起重算。</p>'
    + '<div id="relief-sec"></div>';
  $('world-body').querySelectorAll('input').forEach((input) => {
    input.onchange = () => {
      snapshot();
      const key = input.dataset.w;
      let v = parseFloat(input.value) || 0;
      if (key === 'LAT0deg') v = v * Math.PI / 180;
      if (key.includes('.')) setPath(S.plan, key, v);
      else S.plan[key] = v;
      emit();
      render2d();
      float('改了世界参数', '改回原值', doUndo);
    };
  });
  renderReliefSection();
}

/** 造成清单 + 新建入口：台地/石阶靠属性面板改数字，这个列表负责「找到它」 */
function renderReliefSection() {
  const P = S.plan;
  const items = [
    ...(P.terraces || []).map((t, i) =>
      `<button class="chip" data-rel="terrace:${i}">台地 #${i} +${(t.h ?? 0).toFixed(2)}m ${t.edge === 'slope' ? '放坡' : '挡墙'}</button>`),
    ...(P.flights || []).map((f, i) =>
      `<button class="chip" data-rel="flight:${i}">${f.kind === 'ramp' ? '坡道' : '石阶'} #${i} +${(f.rise ?? 0).toFixed(2)}m${f.word ? `·${f.word}` : ''}</button>`),
  ];
  $('relief-sec').innerHTML =
    `<p class="note">造成（土方）${items.length} 处 — 点一条就在图上选中它：</p>` +
    '<button class="chip" data-rel="add-terrace">＋ 加一块台地</button>' +
    '<button class="chip" data-rel="add-flight">＋ 加一条石阶</button>' +
    `<div class="relief-list">${items.join('') || '<span class="note">还没有造成，地面全是自然缓丘。</span>'}</div>`;
  $('relief-sec').querySelectorAll('[data-rel]').forEach((btn) => {
    btn.onclick = () => {
      const [kind, arg] = btn.dataset.rel.split(':');
      if (kind === 'add-terrace' || kind === 'add-flight') {
        const isTc = kind === 'add-terrace';
        const c = viewCenter();
        snapshot();
        const rec = isTc
          ? { x: round1(c.x), z: round1(c.z), rotY: 0, hw: 4, hd: 3, h: 0.6, edge: 'wall', apron: 1.6 }
          : { x: round1(c.x), z: round1(c.z), rotY: 0, w: 2.2, run: 2, rise: 0.6, steps: 4, kind: 'stair' };
        const arr = isTc ? (S.plan.terraces ||= []) : (S.plan.flights ||= []);
        arr.push(rec);
        S.sel = { type: isTc ? 'terrace' : 'flight', i: arr.length - 1 };
        emit();
        float(isTc ? '加了一块 0.6 米高台，落在视图正中' : '加了一条 4 级石阶，坡脚在视图正中', '拿掉它', () => {
          snapshot(); arr.pop(); S.sel = null; emit(); refreshInspector(); render2d();
        });
        refreshInspector(); render2d(); runCheck(false);
        return;
      }
      S.sel = { type: kind, i: Number(arg) };
      const o = objOf(S.sel);
      if (o) focusOn(o.x, o.z);
      refreshInspector();
      render2d();
    };
  });
}
const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
const setPath = (o, p, v) => {
  const ks = p.split('.');
  const last = ks.pop();
  ks.reduce((a, k) => a[k], o)[last] = v;
};

// ---------- 体检 ----------
function runCheck(manual) {
  const issues = checkPlan(S.plan);
  $('problem-count').textContent = issues.length;
  const ul = $('problem-list');
  ul.innerHTML = '';
  for (const is of issues.slice(0, 60)) {
    const li = document.createElement('li');
    li.className = is.level === 'err' ? 'err' : '';
    li.textContent = is.msg;
    li.onclick = () => {
      S.sel = is.target;
      const o = objOf(is.target);
      if (o) focusOn(o.x, o.z);
      refreshInspector();
    };
    ul.appendChild(li);
  }
  if (manual) {
    const errs = issues.filter((i) => i.level === 'err').length;
    float(issues.length ? `体检完毕：${errs} 个会出怪事、${issues.length - errs} 个建议` : '体检完毕，没有发现问题');
  }
  return issues;
}

// ---------- 顶栏 / 快捷键 ----------
$('btn-undo').onclick = doUndo;
$('btn-redo').onclick = doRedo;
$('btn-fit').onclick = fitView;
$('btn-check').onclick = () => runCheck(true);
$('btn-trees').onclick = (e) => {
  const show = !e.currentTarget.classList.contains('on');
  e.currentTarget.classList.toggle('on', show);
  setShowTrees(show);
  render2d();
};
$('btn-trees').classList.add('on');
$('btn-phase').onclick = () => {
  phaseIdx = (phaseIdx + 1) % PHASES.length;
  setPhase(phaseIdx);
  $('btn-phase').textContent = phaseLabels[phaseIdx];
};
$('btn-download').onclick = () => downloadPlan();
$('btn-save').onclick = () => doSave();

async function doSave(force = false) {
  const issues = checkPlan(S.plan);
  const errs = issues.filter((i) => i.level === 'err');
  if (errs.length && !force) {
    runCheck(true);
    float(`有 ${errs.length} 处会让游戏出错（详见右栏），先改掉再存；或按提示强制`, '照样保存', () => doSave(true));
    return;
  }
  try {
    await savePlan();
    setSaveState('ok', `已写入 town-plan.json（${new Date().toLocaleTimeString()}）`);
    float('已保存到 data/town-plan.json，游戏刷新即生效', '撤销刚才这步改动', doUndo);
    lastPlanJson = JSON.stringify(S.plan);
  } catch (e) {
    if (e.conflict) {
      if (window.confirm('服务器上的 town-plan.json 在你打开编辑器之后又被改过。重新载入服务器版（放弃本地改动）吗？\n想保留本地改动请先点「下载 JSON」。')) {
        await loadPlan();
        afterPlanSwapped();
        setSaveState('ok', '已重新载入服务器版');
      }
    } else {
      setSaveState('err', `保存失败：${e.message}`);
      float(`保存失败：${e.message}`);
    }
  }
}

addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); doUndo(); return; }
  if (e.ctrlKey && e.code === 'KeyY') { e.preventDefault(); doRedo(); return; }
  if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); doSave(); return; }
  if (e.ctrlKey && e.code === 'KeyD') { e.preventDefault(); duplicateSel(); return; }
  if (typing) return;
  if (e.code === 'Escape') { armKind(null); return; }
  if (!S.sel || S.sel.type === 'road') return;
  const o = objOf(S.sel);
  if (!o) return;
  const step = e.shiftKey ? 0.5 : 0.1;
  const nudge = (dx, dz) => {
    snapshot();
    o.x = Math.round((o.x + dx) * 100) / 100;
    o.z = Math.round((o.z + dz) * 100) / 100;
    emit();
    syncInspectorLive();
    render2d();
  };
  if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); removeAt(S.sel.i, S.sel.type); }
  else if (e.code === 'KeyQ') { snapshot(); o.rotY = round6(((o.rotY || 0) - Math.PI / 12) * 1e6) / 1e6; emit(); refreshInspector(); render2d(); }
  else if (e.code === 'KeyE') { snapshot(); o.rotY = round6(((o.rotY || 0) + Math.PI / 12) * 1e6) / 1e6; emit(); refreshInspector(); render2d(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
  else if (e.code === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
  else if (e.code === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
});

// ---------- 布局 ----------
function layout() {
  resize2d();
  resize3d();
}
addEventListener('resize', layout);
new ResizeObserver(layout).observe($('plan-wrap'));
setTimeout(() => { layout(); startLoop(); }, 50);
updateStats();

// 开发期钩子：与 main.js 的 window.__dbg 同口径，供无界面验证脚本驱动
window.__editor = {
  S, state: { snapshot, undo, redo, emit, serializePlan, setPlan },
  ops: { applyOps, findHits, doc: OPS_DOC },
  placeNew, removeAt, duplicateSel, refreshInspector, render2d, runCheck,
  doSave, armKind, flyTo, focusOn, planToLocal, dbg3d, core, float,
  rebuild: { town: rebuildTown, planet: rebuildPlanet, structural: structuralChanged },
};
