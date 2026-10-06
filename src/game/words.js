// words.js — 词库数据绑定（data/words.json，514 词）
import data from '../../data/words.json';

export const CATEGORIES = data.categories;
export const WORDS = data.words;

const byId = new Map(WORDS.map((w) => [w.id, w]));
const catById = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getWord(id) {
  return byId.get(id);
}
export function getCategory(cid) {
  return catById.get(cid) || { id: cid, name: cid, color: '#999' };
}
/** 城镇里实际可学的词（按分类分组） */
export function groupByCategory(wordIds) {
  const groups = new Map();
  for (const id of wordIds) {
    const w = byId.get(id);
    if (!w) continue;
    if (!groups.has(w.category)) groups.set(w.category, []);
    groups.get(w.category).push(w);
  }
  return groups;
}
