// style.js — 建筑外观参数的单一真源：纯数据 + 纯算式，不 import three。
// props.js（造几何）、ops.js（批量改外观 / AI 改图接口）、编辑器面板、Node 机检共用这一把尺子；
// 层高、上下限、屋身高只要在这里改，四处一起变，不会出现「面板说 11 层、3D 只认到 9 层」。

//   wall / roof：0x 十六进制色号；记录上没写就按外观编号 v 从 props.js 的色板轮
//   floors    ：层数，只有 FLOOR_SPEC 里列出的 kind 认（其余 kind 一律没有层数）
// 星球半径只有 60 米，十几层就已经很扎眼，所以上限压得很死。
// plinth=底层（门厅/骑柱）自带的高度，extra=层数以外并进墙体的余量，kit=屋顶构件（女儿墙/水箱/天线/招牌）再高多少。
export const FLOOR_SPEC = {
  mansion: { def: 3, fh: 1.35, min: 2, max: 8, plinth: 1.15, extra: 0.75, ground: true, kit: 0.3 },
  tower:   { def: 6, fh: 1.55, min: 3, max: 10, plinth: 0.85, extra: 0, ground: false, kit: 1.9 },
  office:  { def: 7, fh: 1.45, min: 4, max: 11, plinth: 1.3, extra: 0, ground: false, kit: 1.6 },
  hotel:   { def: 5, fh: 1.55, min: 3, max: 9, plinth: 1.5, extra: 0, ground: false, kit: 1.5 },
};

/** 该 kind 能改的字段清单（批量工具据此出控件） */
export const STYLE_FIELDS = {
  wall:   { label: '外墙色', type: 'color' },
  roof:   { label: '屋顶色', type: 'color' },
  floors: { label: '层数', type: 'int' },
};

export const hasFloors = (kind) => Boolean(FLOOR_SPEC[kind]);

/** 夹到该 kind 的合法层数；没给或给坏了就用默认，不认层数的 kind 返回 0 */
export function clampFloors(kind, floors) {
  const sp = FLOOR_SPEC[kind];
  if (!sp) return 0;
  const v = Number.isFinite(+floors) ? Math.round(+floors) : sp.def;
  return Math.min(sp.max, Math.max(sp.min, v));
}

/**
 * 层数 → 米。body = 墙体顶（builder 直接拿它当 H），total = 连屋顶构件的扎眼高度。
 * 平层小物件（house 等）返回 null：它们不吃 floors。
 */
export function buildingHeight(kind, floors) {
  const sp = FLOOR_SPEC[kind];
  if (!sp) return null;
  const f = clampFloors(kind, floors);
  const body = sp.plinth + (f - (sp.ground ? 1 : 0)) * sp.fh + sp.extra;
  return { floors: f, fh: sp.fh, body, total: body + sp.kit };
}
