// state.js — 编辑器文档核心：当前 plan、选中、撤销/重做、读写服务器
// 存档排版（一张记录一行）的真源在 src/map/serialize.js，三条写入路径共用。
import { PLAN } from '../world/layout.js';
import { serializePlan } from '../map/serialize.js';

export { serializePlan };

let serverSha = '';

export const S = {
  plan: structuredClone(PLAN),   // 先拿构建期数据垫底，随后 loadPlan() 从服务器读最新版
  sel: null,                      // {type:'place'|'tree'|'road', i}
  dirty: false,
  serverStale: false,             // 服务器上的文件比编辑器加载时新（别处改过）
};

const undoStack = [];
const redoStack = [];

export const clonePlan = () => structuredClone(S.plan);
export const setPlan = (p) => { S.plan = p; };

export function snapshot() {
  const cur = JSON.stringify(S.plan);
  // 与当前状态相同的快照没有意义（连续微操作合并成一条撤销记录）
  if (undoStack.length && undoStack[undoStack.length - 1] === cur) {
    S.dirty = true;
    return;
  }
  undoStack.push(cur);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  S.dirty = true;
}

/** 每次改动提交后调用：广播给 2D/3D/体检三个消费者 */
const listeners = [];
export function onChange(fn) { listeners.push(fn); }
export function emit() { for (const fn of listeners) fn(); }

export function undo() {
  if (!undoStack.length) return null;
  redoStack.push(JSON.stringify(S.plan));
  S.plan = JSON.parse(undoStack.pop());
  S.dirty = true;
  return `已撤销一步（还剩 ${undoStack.length} 步可撤）`;
}

export function redo() {
  if (!redoStack.length) return null;
  undoStack.push(JSON.stringify(S.plan));
  S.plan = JSON.parse(redoStack.pop());
  S.dirty = true;
  return '已重做一步';
}

export const undoDepth = () => undoStack.length;

/** 丢弃最近一次快照（拖动开始预扣、实际没移动时作废） */
export function dropLastSnapshot() { undoStack.pop(); }

// ---------- 服务器读写 ----------
export async function loadPlan() {
  const res = await fetch('/__plan', { cache: 'no-store' });
  if (!res.ok) throw new Error(`读取 /__plan 失败：HTTP ${res.status}`);
  const { sha, plan } = await res.json();
  serverSha = sha;
  S.plan = plan;
  S.dirty = false;
  S.serverStale = false;
  undoStack.length = 0;
  redoStack.length = 0;
  return plan;
}

export async function savePlan() {
  const text = serializePlan(S.plan);
  // 先确认服务器上的文件还是我们加载时的版本，避免覆盖别处的改动
  const cur = await fetch('/__plan', { cache: 'no-store' }).then((r) => r.json());
  if (cur.sha !== serverSha) {
    const err = new Error('conflict');
    err.conflict = true;
    throw err;
  }
  const res = await fetch('/__plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: text,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
  serverSha = out.sha;
  S.dirty = false;
  return out;
}

export function downloadPlan() {
  const blob = new Blob([serializePlan(S.plan)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'town-plan.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
