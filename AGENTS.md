# AGENTS.md — 动手前先读这一页

Three.js 复刻 LangCity 的低多边形日式小镇星球。视觉是第一验收标准，玩法可以薄。
完整规格见 [`docs/HANDOFF.md`](docs/HANDOFF.md)，地图与编辑器见 [`docs/MAP-EDITOR.md`](docs/MAP-EDITOR.md)。

**这个项目最容易犯的错是「手撸 3D」**：在功能文件里 `new THREE.Material`、在 JS 里手写一张坐标表、
在第二处重算地面高度。就像写 Win32 不该自己去光栅化界面 —— 地图、模型、材质都必须通过框架的入口操控。
边界与理由在 [`docs/3D-LAYERING.md`](docs/3D-LAYERING.md)，下面这几条是不许破的硬规则，
`tools/layering-check.mjs` 会机器检查，踩了就 FAIL（不靠自觉）。

## 硬规则

1. **地图数据只有一个真源**：`data/town-plan.json`。改它只走三条路 ——
   声明式 ops（`POST /__plan/ops` / `npx vite-node tools/plan-ops.mjs --ops <JSON数组>` / 页内 `window.__editor.ops`）、
   编辑器 `editor.html`、生成器 `tools/generate-town.mjs`。
   不要在 `src/world/layout.js` 或任何 JS 里再铺一份坐标数组；`layout.js` 只是 JSON → 具名导出的薄壳。
2. **材质只走 `src/world/materials.js`**：`mat(colorHex, bucket, jitterPos)` 与 `BUCKETS`。
   新质感先在 `BUCKETS` 加一档（roughness/metalness 分档是消除塑料感的关键），不要在调用处硬写色号。
3. **模型只在 `src/world/props.js`**：写 `buildXxx()` → 注册进 `BUILDERS` → 在 `src/editor/kinds.js` 的 `KINDS` 登记。
   `src/world/town.js` 只负责按 `PLACES` 装配与合批，那里不写形状、不写颜色。
4. **地面高程只有一处定义**：`src/map/terrain.js` 的 `makeField()`；用就取 `layout.js` 的 `groundHeight` / `meshHeight`。
   别处再写一份 `hillsH` 或自己估高度 = 猫的脚和地面贴图分家。
5. **碰撞只改 `SOLIDS`**（`layout.js`），`COLLIDERS` 由 `src/world/collision.js` 单点生成。要挡就补定义，别在 `cat.js` 加特判。
6. **层与随机有铁律**：`src/map/**` 不许 import three（它要能在 Node 里无渲染器跑）；
   数据层不许 `Math.random()`（要复现就用 `src/map/ops.js` 的 `rng(seed)`）；`src/**` 不许 `writeFileSync`（存图只走 `/__plan` 端点）。
7. **正路表达不了需求时**：先在**归属层**加参数化接口，再让调用方用接口。加接口允许，在调用方现场手撸实现不允许。
8. **three 构造点只准减**：`tools/layering-baseline.json` 钉死了现状计数（337 处）。新文件冒出构造点、老文件变胖，都会 FAIL。
   还债变瘦后跑 `node tools/layering-check.mjs --bless` 收紧。

## 动手前

- 想知道「这个改动属于哪一层、该改哪个文件」→ 查 `docs/3D-LAYERING.md` §1 归属表和 §2「手撸 → 正路」对照表。
- **op 字段名不要凭记忆写**：`GET /__plan/ops`（或 `npx vite-node tools/plan-ops.mjs --doc`）拿说明书，先 `--dry-run` 看报告。
  字段写错不会静默空转 —— `applyOps` 报错且整批不改。kind 列表看 `src/editor/kinds.js`。
- 数据改动落成 op 文件（形状照 `tools/ops-station-forecourt.json`），带 `seed`，别贴一串坐标。

## 交活前

```bash
just check     # ops 语义 / 造成几何与碰撞 / 猫真走一遍行车面 / 3D 分层红线
```

- 四道门全绿才算改完；新报错要能解释是哪条口径变了。
- 视觉按 `docs/HANDOFF.md` §2 与 §7 验收（随便截图要像一张 3D 插画；廉价感先修色彩/光照/构图，**不许加特效遮丑**）。
- 每个功能切片都要同步 docs：改了地图口径进 `MAP-EDITOR.md`，改了视觉规格进 `HANDOFF.md`，新增入口或红线回来更新本页与 `3D-LAYERING.md`。
- **未经要求不要 commit/push**；提交作者只用 GitHub noreply 邮箱；推送走 SSH；推送前扫邮箱/本机路径等隐私。
