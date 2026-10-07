# 3D 分层红线 —— 地图、模型、材质只能通过框架操控

> 写这份文档的起因（用户原话）：「做 3D 有个问题，就是 AI 会去手撸。地图、模型、材质这些都应该通过框架去操控，
> 必须得限定死这些。就像 Windows 做界面，你也不会 win32 直接去调自己渲染。这些必须得提示词提前铺路。」
>
> 类比落地成三件东西：**这份文档**（为什么、边界在哪）、**根目录 [`AGENTS.md`](../AGENTS.md)**（会话开头就被读到的提示词路障）、
> **[`tools/layering-check.mjs`](../tools/layering-check.mjs)**（机器门，红线踩了会 FAIL，不靠自觉）。

---

## 0. 为什么「手撸」在这个项目里是事故

Win32 里没人自己写光栅化，因为控件框架已经把「画什么」和「怎么画」分开了；自己画会立刻失去主题、DPI、无障碍、重绘正确性。
这里的损失更具体，每一条都真实发生过或随时会发生：

| 手撸的样子 | 坏在哪 |
|---|---|
| 在 `layout.js` 里再手写一张坐标表 | 真源 `data/town-plan.json` 就有两份了。编辑器存的、AI ops 改的、猫踩的，从此不是同一张图 |
| 在功能文件里 `new THREE.MeshStandardMaterial(...)` | 绕开 `materials.js` 的 roughness 分档与世界坐标抖动 → 「同一个颜色出现 200 次」的塑料感回来了（[HANDOFF §2.3](HANDOFF.md)） |
| 在 `props.js` 外面临时拼一个 group 塞进街景 | 它不进 `BUILDERS`、不进 `KINDS`、没有碰撞体、不能被 ops 选中，下一轮重生成/体检就凭空消失 |
| 在别处再算一份地面高度 | 猫踩的面和贴图刷的面分家 → 穿模或踩空（这条踩过一次：路口「谁近听谁的」硬切出 0.7~0.9 米的垂直坎，见 [MAP-EDITOR §6](MAP-EDITOR.md)） |
| 用 `Math.random()` 摆物件或调外观 | 不可复现。AI 第二次跑同样的脚本会得到另一张图，验收与回滚全部失效 |
| 在页面代码里 `writeFileSync` 存图 | 绕开 `/__plan` 的 `validatePlan` + 备份，坏数据直接落盘 |

**一句话判据**：改动如果不能被编辑器看到、不能被 ops 描述、不能过体检，它就是手撸。

---

## 1. 分层与归属（每层只有一个主人）

| 层 | 唯一归属 | 框架入口（要改就改这里） | 这一层的规矩 |
|---|---|---|---|
| 地图数据：有什么、在哪、多高 | [`data/town-plan.json`](../data/town-plan.json) | 编辑器 `:5174/editor.html`；声明式 ops（HTTP `POST /__plan/ops`、CLI `tools/plan-ops.mjs`、页内 `window.__editor.ops`）；生成器 `tools/generate-town.mjs` | 只有这四个写入口。JS 侧一律 `import`，不许再铺数组 |
| 数据算式：采样、高程场、校验 | `src/map/`（[`terrain.js`](../src/map/terrain.js)／[`ops.js`](../src/map/ops.js)／[`schema.js`](../src/map/schema.js)／[`style.js`](../src/map/style.js)／`serialize.js`) | `makeField(plan)`、`applyOps()`、`validatePlan()`、`FLOOR_SPEC` | **纯函数，禁止 import three**：Node 门与 dev 端点都靠它无渲染器可跑 |
| 球面映射与导出壳 | [`src/world/layout.js`](../src/world/layout.js) | `planToVec3`/`planQuat`/`normalAt`、`PLACES`/`ROADS`/`SOLIDS`、`groundHeight`/`meshHeight` | 只做「JSON → 具名导出」；`TERRAIN_FIELD` 在 :74，`SOLIDS` 在 :102 |
| 模型：一个物件长什么样 | [`src/world/props.js`](../src/world/props.js) | `buildXxx()` + `BUILDERS`（:1006）+ [`src/editor/kinds.js`](../src/editor/kinds.js) 的 `KINDS`（:12） | 新 kind 三处一起登记，缺一处就进不了体检与编辑器 |
| 装配：落点 → 场景 + 合批 | [`src/world/town.js`](../src/world/town.js) | 按材质桶 `mergeGeometries`，遍历 `PLACES` 取 `BUILDERS[kind]` | 只搬不改：这里不写形状、不写颜色 |
| 造成实体：台地/石阶/坡道 | [`src/world/terrainwork.js`](../src/world/terrainwork.js) | 读 `TERRACES`/`FLIGHTS` + `terrain.js` 的 profile | 与高程场共用同一条 profile，几何不对齐就是踩空 |
| 材质：颜色/粗糙度/贴图 | [`src/world/materials.js`](../src/world/materials.js) | `mat(colorHex, bucket, jitterPos)`（:144）、`BUCKETS`、`handPaintedTexture` | 外观参数从 plan 字段来，不在调用处硬写色号 |
| 地面高程 | `src/map/terrain.js` 的 `makeField` | `surface(x,z)` = 猫踩的，`mesh(x,z)` = 星球网格 | 单一来源。别人只准调，不准另算 |
| 碰撞 | [`src/world/collision.js`](../src/world/collision.js) | `COLLIDERS` 由 `SOLIDS` 推出来（:12） | 只有这个文件 `COLLIDERS.push`；要挡就加 `SOLIDS` 定义 |
| 天空/光照/四时刻 | [`src/world/sky.js`](../src/world/sky.js) | `applyTimeOfDay` | 灯光参数表在这儿，物件不许自带光 |
| 角色与相机 | `src/player/`（`cat.js` 本体几何、`camera.js` 跟随） | 球面行走 + `resolveCollisions` | 猫只吃 `groundHeight`，不许自己估高度 |
| 交互与 UI | `src/game/`、`src/ui/` | 光圈/拍照/词库 | 这层理想态是零 three 构造点；现存 `interact.js` 光圈 1 处（`hud.js`/`words.js`/`vocab.js` 为 0）算历史例外，冻结只准减 |
| 编辑器视图 | `src/editor/`（`view2d`/`view3d`/`problems`/`batch`） | 只画 plan、只出报告 | 视图不回写几何，改动一律产 op |

变体版 `variant-z/src/` 结构镜像同一套层（它有自己的 `materials.js`/`props.js`/`buildings.js`），同一把尺量。

---

## 2. 想干这事 → 走这条路（AI 最常问的就是这张表）

| 想做的改动 | ❌ 手撸会写 | ✅ 正路 |
|---|---|---|
| 加一栋高楼 | 在 `town.js` 拼 box | `place.add { kind:'tower', x, z, floors }`；形状不对就改 `props.js` 的 `buildTower()` |
| 沿街一排路灯 | for 循环塞坐标 | `place.scatter { kind:'streetlight', step, offset, sides }`，或跑生成器 |
| 整片公寓楼换外墙色/层数 | 改 `props.js` 常量 | `place.style { where:{kind:'mansion'}, wall:[..], floors:[3,7], seed }`（面板「批量改外观」产的就是这一条） |
| 路面要起伏 | 在 `planet.js` 加 sin 波 | `road.set { e1/e2 }` 或折线 `pts + e[]`；自然起伏用 `hill.add` |
| 要台阶/坡道上台地 | 摆几个 box 当楼梯 | `terrace.add` + `flight.add`（几何、高程、碰撞、体检四家共用同一条 profile） |
| 想要新的质感 | `new MeshStandardMaterial` | `materials.js` 加一个 `BUCKETS` 档位，`mat()` 传 bucket |
| 想让猫上不去某处 | 在 `cat.js` 加特判 | 在 `layout.js` 的 `SOLIDS[kind]` 补占位；体检会告诉你漏没漏 |
| 想改猫/树的随机长相 | `Math.random()` | `ops.js` 的 `rng(seed)`（外观类 op 都吃 `seed`）；同 seed 必须复现同一结果 |
| 想加个新物件种类 | 复制粘贴一个 group | `props.js` `buildXxx` + `BUILDERS` + `kinds.js` `KINDS`（+ 需要挡就 `SOLIDS`），然后 `ops-check` 的登记表断言会替你核对 |
| 想把图存下来 | `fs.writeFileSync` | `POST /__plan`（有 sha 冲突检测 + 备份 + `validatePlan`） |
| 不知道 op 怎么写 | 凭记忆猜字段名 | `GET /__plan/ops` 或 `npx vite-node tools/plan-ops.mjs --doc` 拿说明书；`--dry-run` 先看报告 |

字段名猜错不会静默空转：`applyOps` 对未知字段与筛不到对象都记 error，且**整批不改**（原子性，见 [MAP-EDITOR §7](MAP-EDITOR.md)）。

---

## 3. 机器门：`node tools/layering-check.mjs`

```
node tools/layering-check.mjs              检查，踩线 exit 1
node tools/layering-check.mjs --bless      把当前构造点数钉成基线（只在「还债变瘦了」之后跑）
```

它只用 `fs` 扫文件、不 import 项目模块，所以裸 `node` 就能跑（另外三道门要 `npx vite-node`，因为它们要读 `layout.js` 那份 JSON import）。

两道机制，性质不同：

**① 绝对红线（结构性，一次都不许有）—— 当前 7 条**

1. `src/map/**` 不许 import three 或出现 `new THREE.`
2. `layout.js` 必须 import `data/town-plan.json`
3. `layout.js` 里不许出现 `{ kind: '…' }` 字面量（真源不许手写进 JS）
4. `function hillsH` 只准在 `src/map/terrain.js` 定义
5. `COLLIDERS.push(` 只准在 `src/world/collision.js` 出现
6. 数据层（`src/map/**` + `src/editor/state.js`）不许 `Math.random()`
7. `src/**` 不许 `writeFileSync(`

**② 构造点棘轮（历史债务只准减）**

`tools/layering-baseline.json` 钉住三类 three 构造点（材质 / 几何 / 合并与实例化）按文件的计数：
新文件冒出来 → FAIL；老文件变胖 → FAIL；变瘦 → 只提示，并提醒重跑 `--bless` 收紧。

钉住时（2026-10-07）的量：**337 处** —— city 版材质 18（6 个文件）／几何 56（8）／合并 2；
`variant-z` 版材质 35（11）／几何 224（10）／合并 2。
为什么不一次清零：把那 12 处历史构造点全塞进 `materials.js` 是另一件大事；先冻结现状，谁改谁顺手挪。

**这套门自己也被验过**（不然它和「写了没跑的检查」没区别）：

- 门内含 control 断言：注入的合成文件六类违规 6/6 被抓；比较器对「新文件／变胖／变瘦／相等」四种情形分别给出对的结果；
  并断言 `materials.js` 量到 ≥5、`props.js` ≥20、`cat.js` ≥5、`town.js` ≥1 —— 正则瞎了这些就会红。
- 端到端实测（跑完立刻按 md5 还原源文件，两次都字节一致）：
  - 往 `src/map/style.js` 追加 `import * as THREE from 'three'` → `FAIL 绝对红线 踩了 1/7 条`，报错点名该文件；
  - 往 `src/world/planet.js` 追加 `new THREE.MeshStandardMaterial()` → `FAIL 材质构造［city］19 处，src/world/planet.js 新出现 1 处（该走 materials.js 的 mat()）`，退出码 1。

它和其他三门一起跑：`just check`（ops 声明式改图 / 高程场与造成 / 猫真走一遍路面 / 分层红线）。

---

## 4. 以后自己（或任何 AI）改 3D 的标准动作

改动开始前，按这五步走；这五步就是「提示词提前铺路」要铺的那条路。

1. **定位归属层**：先回答「这个改动属于数据、算式、模型、材质、还是装配」。查 §1 的表，只碰那一层的主人文件。
   跨了两层 = 需求还没想清楚，先拆开。
2. **用已有入口，不造新构造点**：数据改动 → ops；形状 → `buildXxx`；外观 → `BUCKETS`/`mat()`；高程 → `makeField`；碰撞 → `SOLIDS`。
   如果现有入口真的表达不了：**先在归属文件里加接口（参数化），再让调用方用接口** ——
   「加接口」是允许的，「在调用方现场手撸一份实现」不允许。这是这条红线的泄压阀，否则规则会把人逼成绕路。
3. **数据改动写成 op 文件**（`tools/ops-*.json` 那种形状），带 `seed`，先 `--dry-run` 看报告，再落盘。
   理由：可复现、可 review、可回滚，且不依赖某台机器上打开过的编辑器。
4. **跑 `just check`**：四道门全绿才叫改完。棘轮若因「还债」变瘦，`--bless` 重钉并在提交说明里写清挪走了哪几处。
5. **docs 落地**：改了地图口径进 [MAP-EDITOR.md](MAP-EDITOR.md)，改了视觉规格进 [HANDOFF.md](HANDOFF.md)，
   新增了入口/红线就回头更新本文件与 `AGENTS.md`。文档没跟上 = 这一轮没做完。

给 AI 的两条硬提醒（`AGENTS.md` 里也有，会话开头就会被读到）：

- 不要凭记忆写 op 字段名，先 `GET /__plan/ops`；不要凭记忆写 kind，先 `src/editor/kinds.js`。
- 想在 `src/` 里敲 `new THREE.` 之前停一下：那个构造点要么挪进 `materials.js`/`props.js`，要么就是棘轮会拒的那一类。

---

## 5. 现状债务（诚实记录，棘轮已冻结）

- **city 版 18 处材质构造分散在 6 个文件**：`materials.js` 6（正当）、`props.js` 7、`sky.js` 2、`cat.js` 1、`interact.js` 1、`view3d.js` 1。
  最该先还的是 `props.js` 那 7 处 —— 6 处是招牌文字的 `MeshBasicMaterial`（:296/:320/:389/:515/:594/:694），1 处是路灯灯罩的光斑色（:611），
  前六处可折成 `materials.js` 的一个 `labelMaterial(text, opts)` 入口。
- **`variant-z` 几何 224 处/10 个文件**：那是原版 GLB 资产的美术变体，量级合理，同样只准减。
- `interact.js`（金色光圈）与 `view3d.js`（编辑器预览代理）各 1 处材质/几何：性质是「特效与辅助视图」，允许长期保留，但新增要过 `--bless` 说明。
- 门只查得了「形状」（构造点、单一来源、随机、落盘），查不了「味道」。色彩/光照/构图的验收仍按 [HANDOFF §2 与 §7](HANDOFF.md) 人眼 + 截图。
