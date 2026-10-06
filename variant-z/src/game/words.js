// 词库：优先 fetch data/words.json（514 词全量），失败则用内联兜底
const FALLBACK = {
  categories: [
    { id: 'street', name: '街道', color: '#5b8def' },
    { id: 'transport', name: '交通', color: '#4cc2c9' },
    { id: 'building', name: '建筑', color: '#e6a23c' },
    { id: 'nature', name: '自然', color: '#7fb069' },
    { id: 'animal', name: '动物', color: '#b08968' },
    { id: 'food', name: '食物', color: '#d64541' },
  ],
  words: [
    { id: 'house', ja: '家', kana: 'いえ', romaji: 'ie', zh: '家', category: 'building' },
    { id: 'mansion', ja: 'マンション', kana: 'まんしょん', romaji: 'manshon', zh: '公寓', category: 'building' },
    { id: 'konbini', ja: 'コンビニ', kana: 'こんびに', romaji: 'konbini', zh: '便利店', category: 'building' },
    { id: 'ramen_shop', ja: 'ラーメン屋', kana: 'らーめんや', romaji: 'raamenya', zh: '拉面店', category: 'building' },
    { id: 'cafe', ja: '喫茶店', kana: 'きっさてん', romaji: 'kissaten', zh: '咖啡店', category: 'building' },
    { id: 'supermarket', ja: 'スーパー', kana: 'すーぱー', romaji: 'suupaa', zh: '超市', category: 'building' },
    { id: 'post_office', ja: '郵便局', kana: 'ゆうびんきょく', romaji: 'yuubinkyoku', zh: '邮局', category: 'building' },
    { id: 'station', ja: '駅', kana: 'えき', romaji: 'eki', zh: '车站', category: 'transport' },
    { id: 'jinja', ja: '神社', kana: 'じんじゃ', romaji: 'jinja', zh: '神社', category: 'building' },
    { id: 'vending', ja: '自動販売機', kana: 'じどうはんばいき', romaji: 'jidouhanbaiki', zh: '自动贩卖机', category: 'street' },
    { id: 'pole', ja: '電柱', kana: 'でんちゅう', romaji: 'denchuu', zh: '电线杆', category: 'street' },
    { id: 'streetlight', ja: '街灯', kana: 'がいとう', romaji: 'gaitou', zh: '路灯', category: 'street' },
    { id: 'mailbox', ja: 'ポスト', kana: 'ぽすと', romaji: 'posuto', zh: '邮筒', category: 'street' },
    { id: 'trash', ja: 'ゴミ箱', kana: 'ごみばこ', romaji: 'gomibako', zh: '垃圾桶', category: 'street' },
    { id: 'signboard', ja: '看板', kana: 'かんばん', romaji: 'kanban', zh: '招牌', category: 'street' },
    { id: 'bench', ja: 'ベンチ', kana: 'べんち', romaji: 'benchi', zh: '长椅', category: 'street' },
    { id: 'hachiue', ja: '鉢植え', kana: 'はちうえ', romaji: 'hachiue', zh: '盆栽', category: 'street' },
    { id: 'shoukasen', ja: '消火栓', kana: 'しょうかせん', romaji: 'shoukasen', zh: '消火栓', category: 'street' },
    { id: 'monoboshizao', ja: '物干し竿', kana: 'ものぼしざお', romaji: 'monoboshizao', zh: '晾衣杆', category: 'street' },
    { id: 'car', ja: '車', kana: 'くるま', romaji: 'kuruma', zh: '汽车', category: 'transport' },
    { id: 'bicycle', ja: '自転車', kana: 'じてんしゃ', romaji: 'jitensha', zh: '自行车', category: 'transport' },
    { id: 'boat', ja: '船', kana: 'ふね', romaji: 'fune', zh: '船', category: 'transport' },
    { id: 'funsui', ja: '噴水', kana: 'ふんすい', romaji: 'funsui', zh: '喷泉', category: 'street' },
    { id: 'tree', ja: '木', kana: 'き', romaji: 'ki', zh: '树', category: 'nature' },
    { id: 'sakura', ja: '桜', kana: 'さくら', romaji: 'sakura', zh: '樱花树', category: 'nature' },
    { id: 'flower', ja: '花', kana: 'はな', romaji: 'hana', zh: '花', category: 'nature' },
    { id: 'grass', ja: '草', kana: 'くさ', romaji: 'kusa', zh: '草', category: 'nature' },
    { id: 'dog', ja: '犬', kana: 'いぬ', romaji: 'inu', zh: '狗', category: 'animal' },
    { id: 'bird', ja: '鳥', kana: 'とり', romaji: 'tori', zh: '鸟', category: 'animal' },
  ],
};

let data = null;
export const discovered = new Set();

export async function loadWords() {
  try {
    const res = await fetch('./data/words.json');
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    data = FALLBACK;
  }
  try {
    const saved = JSON.parse(localStorage.getItem('langcity3jz_discovered') || '[]');
    for (const id of saved) discovered.add(id);
  } catch { /* ignore */ }
  return data;
}

export function wordById(id) { return data?.words.find(w => w.id === id) || null; }
export function allWords() { return data ? data.words : []; }
export function categoryById(id) { return data?.categories.find(c => c.id === id) || null; }

export function discover(id) {
  discovered.add(id);
  localStorage.setItem('langcity3jz_discovered', JSON.stringify([...discovered]));
}

export function progressByCategory() {
  const map = new Map();
  if (!data) return map;
  for (const c of data.categories) map.set(c.id, { cat: c, total: 0, found: 0 });
  for (const w of data.words) {
    const e = map.get(w.category);
    if (!e) continue;
    e.total++;
    if (discovered.has(w.id)) e.found++;
  }
  return map;
}

export function totalProgress() {
  if (!data) return { found: 0, total: 0 };
  return { found: discovered.size, total: data.words.length };
}
