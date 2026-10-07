// kinds.js — 编辑器用的物件类型登记表：分组、中文名、默认词条、配色
// 真源对照：props.js 的 BUILDERS（kind 必须存在于其中）、words.json（word id）
export const GROUPS = [
  { id: 'building', name: '建筑' },
  { id: 'shop', name: '商店' },
  { id: 'street', name: '街具' },
  { id: 'plant', name: '植物' },
  { id: 'vehicle', name: '车辆' },
  { id: 'creature', name: '生灵' },
];

export const KINDS = [
  // —— 建筑 ——
  { kind: 'station', group: 'building', label: '车站', word: 'station' },
  { kind: 'school', group: 'building', label: '学校', word: 'gakkou' },
  { kind: 'hospital', group: 'building', label: '医院', word: 'byouin' },
  { kind: 'bank', group: 'building', label: '银行', word: 'ginkou' },
  { kind: 'library', group: 'building', label: '图书馆', word: 'toshokan' },
  { kind: 'postOffice', group: 'building', label: '邮局', word: 'post_office' },
  { kind: 'mansion', group: 'building', label: '公寓楼', word: 'mansion' },
  { kind: 'house', group: 'building', label: '住宅', word: 'house' },
  { kind: 'tower', group: 'building', label: '高层住宅', word: 'apaato' },
  { kind: 'office', group: 'building', label: '写字楼', word: 'ofisu' },
  { kind: 'hotel', group: 'building', label: '高层酒店', word: 'hoteru' },
  { kind: 'shrine', group: 'building', label: '神社', word: 'jinja' },
  // —— 商店 ——
  { kind: 'konbini', group: 'shop', label: '便利店', word: 'konbini' },
  { kind: 'ramen', group: 'shop', label: '拉面店', word: 'ramen_shop' },
  { kind: 'cafe', group: 'shop', label: '咖啡馆', word: 'cafe' },
  { kind: 'supermarket', group: 'shop', label: '超市', word: 'supermarket' },
  // —— 街具 ——
  { kind: 'vending', group: 'street', label: '自动售货机', word: 'vending' },
  { kind: 'streetlight', group: 'street', label: '路灯', word: 'streetlight' },
  { kind: 'pole', group: 'street', label: '电线杆', word: 'pole' },
  { kind: 'trafficLight', group: 'street', label: '红绿灯', word: 'traffic_light' },
  { kind: 'phoneBox', group: 'street', label: '电话亭', word: 'koushuudenwa' },
  { kind: 'mailbox', group: 'street', label: '邮筒', word: 'mailbox' },
  { kind: 'trash', group: 'street', label: '垃圾桶', word: 'trash' },
  { kind: 'hydrant', group: 'street', label: '消防栓', word: 'shoukasen' },
  { kind: 'bench', group: 'street', label: '长椅', word: 'bench' },
  { kind: 'signboard', group: 'street', label: '招牌', word: 'signboard' },
  { kind: 'parkingSign', group: 'street', label: '停车牌', word: 'chuushajou' },
  { kind: 'plazaFlag', group: 'street', label: '广场旗', word: 'hata' },
  { kind: 'crossing', group: 'street', label: '斑马线牌', word: 'crossing' },
  { kind: 'fountain', group: 'street', label: '喷泉', word: 'funsui' },
  { kind: 'flowerbed', group: 'street', label: '花坛', word: 'kadan' },
  { kind: 'wall', group: 'street', label: '围墙', word: 'hei' },
  { kind: 'fence', group: 'street', label: '栅栏', word: 'fensu' },
  { kind: 'clothesline', group: 'street', label: '晾衣杆', word: 'monoboshizao' },
  { kind: 'potted', group: 'street', label: '盆栽', word: 'hachiue' },
  // —— 植物 ——
  { kind: 'tree', group: 'plant', label: '树', word: 'tree' },
  { kind: 'sakura', group: 'plant', label: '樱花树', word: 'sakura' },
  { kind: 'flowers', group: 'plant', label: '花丛', word: 'flower' },
  { kind: 'grassTuft', group: 'plant', label: '草丛', word: 'grass' },
  // —— 车辆 ——
  { kind: 'car', group: 'vehicle', label: '汽车', word: 'car' },
  { kind: 'bicycle', group: 'vehicle', label: '自行车', word: 'bicycle' },
  // —— 生灵 ——
  { kind: 'npc', group: 'creature', label: '行人', word: 'hito' },
  { kind: 'dog', group: 'creature', label: '狗', word: 'dog' },
  { kind: 'catNpc', group: 'creature', label: '猫', word: 'cat' },
  { kind: 'bird', group: 'creature', label: '鸟', word: 'bird' },
];

export const kindInfo = (k) => KINDS.find((e) => e.kind === k);

export const GROUP_COLORS = {
  building: '#e6a23c', shop: '#d64541', street: '#5b8def',
  plant: '#7fb069', vehicle: '#4cc2c9', creature: '#b08968',
};

export const DEFAULT_COLOR = '#9a93a8';

export function colorFor(kind) {
  const info = kindInfo(kind);
  if (info) return GROUP_COLORS[info.group] || DEFAULT_COLOR;
  return DEFAULT_COLOR;
}

/** 该 kind 允许摆在路上的例外（斑马线牌/红绿灯/路灯必须在路上） */
export const ROAD_OK_KINDS = new Set(['crossing', 'trafficLight', 'streetlight', 'pole']);
