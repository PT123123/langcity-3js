# LangCity 3JS

LangCity（日语星球学习游戏，原 Godot 项目 `LangCity`）的 **Three.js 复刻版**。
第三人称小猫漫步低多边形日式小镇星球，看到什么点什么，弹出日语单词卡。

## 仓库里有两套地图实现、三种可走的图

| | 怎么跑 | 是什么 |
|---|---|---|
| **城市版**（仓库根目录 `src/`） | `just run-city` → http://localhost:5174 | **纯程序化**：`src/world/layout.js` 手写路网/广场/停车场/斑马线，`src/world/planet.js` 自己建面刷路，**零外部模型** |
| **资产版·烘场** [`variant-z/`](variant-z/) | `just run` → http://localhost:5173 | 读原版现成资产：`planets_present_full_0..9.glb` 碎块壳烘成高程场 + `planet.json` 的 245 个落点，手写街网压进路床 |
| **资产版·原版岛** | 同上 → http://localhost:5173/?island=raw （或 `?island=intro`） | **不烘场不缩放**：玩法射线直接打原版网格（`raw` = 十块碎块壳，`intro` = 菜单同款单体低模岛），245 个落点照原版口径全摆、一个不删 |

> ⚠️ 三张图的来龙去脉、城市版曾被未提交删除又恢复的经过、四套素材来源清单（桌面 `LangCity/` 与
> `messenger-art-assets.zip` 已拉回 `reference/`）、原版岛直通模式的实测数据，
> 全部记在 **[docs/MAP-TWO-APPS.md](docs/MAP-TWO-APPS.md)**。改任何一套之前先读它。

```bash
just setup      # 一次装齐两套依赖
just run-city   # 城市版 :5174
just run        # 资产版 :5173（?island=raw / ?island=intro 走原版岛）
```

- 📐 **实现规格：[docs/HANDOFF.md](docs/HANDOFF.md)** —— 玩法范围、视觉规格（Stylized 3D 插画风/色彩表/材质分档/四时刻参数）、性价比原则、性能预算、验收清单。
- 🗺️ [docs/MAP-TWO-APPS.md](docs/MAP-TWO-APPS.md) —— 四套来源、三张图的口径与踩坑记录。
- 📖 资产版详细说明（玩法、资产、踩坑）：[variant-z/README.md](variant-z/README.md)
- 📦 [reference/](reference/) —— 从桌面拉回的**只读参照**：`reference/LangCity/`（原版手作数据 `data/map.json` 平面城 352 物件+显式路网、`data/planet.json`、摆件算法 `.gd`、整备工具、修复史文档）、`reference/messenger-art-assets/`（上游资产包解压）。**不要在这里改东西**，改完运行时也不读它。**这份只在本地**：上游包自己声明了未经许可不得再分发，所以没入库。
- 📚 词库：`data/words.json`（城市版）与 `variant-z/public/data/words.json`（资产版），同一份 514 词。


两条用户铁律：
1. **视觉第一**——随手一截图像一张完整的 3D 插画（默认黄昏场景是门面）。
2. **性价比**——钱花在色彩/光照/构图/材质微差上；禁 SSAO/SSR/强后处理。

## 操作

| 输入 | 功能 |
|---|---|
| WASD / 方向键 | 走（球面重力，可绕星球一圈） |
| 空格 | 跳 |
| 鼠标拖动 / 触屏拖动 | 转视角；滚轮缩放 |
| F / 右下拍照钮 | 对准金色光圈物体拍照 → 单词卡 + 自动发音 |
| T / 左上时刻钮 | 晨 → 昼 → 暮 → 夜 循环（黄昏为默认） |
| V / 右上词汇本 | 词汇库抽屉（分类进度条，点条目重听） |

- 存档：localStorage（已发现单词 + 猫位置 + 时刻），自动保存/恢复。
- 触屏设备自动降档（pixelRatio ≤1.5、阴影 1024、bloom 减半），左下虚拟摇杆。

## 技术要点

**城市版（根目录）**
- Vite + three（ESM），全部几何程序化生成，**零外部模型/贴图**（招牌文字为 Canvas 生成）
- 静态几何按 17 个材质桶合并（`town_xxx`），城镇合计 ~16 draw call；实测 251k 三角形 / 103 call
- 四时刻参数表插值驱动：太阳/半球/补光/雾/窗户自发光/路灯点光/Bloom 阈值/天空穹顶
- 后处理：Bloom + 自制 Vignette/颗粒 + OutputPass；ACESFilmic + PCFSoft 阴影
- 星球地面为 2048×1024 逐像素程序化 equirect 贴图（道路/人行道/广场/斑马线为 SDF 绘制）
- 星球半径 `R = 60`，城镇帽落在纬度 11°~65°（符合规格 10°~62°）

**资产版（variant-z）**
- 碎块壳 GLB 烘焙成 240×160 高程场；`terrainMeshes = [groundMesh]`，**玩法射线只碰这张地面**
- 地基（`levelDisc`）与路床（`levelPath`）都烘进这张网格的顶点：看到的路就是踩到的路
- 镇区台地 + 18° 锥形限高，见 `docs/MAP-TWO-APPS.md` §5
- `?island=raw|intro` 走「原版岛直通」：跳过标定/烘场/台地/铺街，射线直接打真实网格，
  摆放口径逐条对齐 Godot 的 `street.gd _place_on_planet`（见 §9）
- 开发期钩子 `window.__dbg`（两套同名同口径），配 `tools/shot-receiver.mjs` 做页内截图落盘

## 后续路线（未做，按性价比排序）

- 小地图（左上圆形俯视 + 物件点 + 玩家朝向）——规格中标「可选，后置」
- 光圈目标物的上下浮动微动画（当前物体为静态合并，仅光圈脉动）
- 更多词条上星（现有 ~100 个可交互物件，词库还有 400+ 词可用：食物/内饰/天气…）
- 室内场景、复习测验、NPC 对话、任务系统
- 音效扩展（环境音/脚步），相机防穿墙，建筑碰撞
- 两套地图逐项目视对比后，决定长期只留哪一套（或把城市版的建面逻辑并入资产版）
