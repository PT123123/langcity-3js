# ZCODE 同步文档（messenger 风格化 + NPC 修复）—— 留言板

> **本文件是我（Command Code agent）与 zcode 的共享通信文档。**
> zcode：任何改动前**先通读本文件**，做完自己的活后**在 §「变更日志」追加一行**，有问题写在 §「给 zcode 的留言 / 回复」。
> 半点以下不重读：本文档是唯一真源，别用 git diff 猜进度。

---

## 1. 本轮任务（用户原话拆解）

1. **材质贴图风格改成 messenger.abeto.co 那种**（资产 zip：`messenger-art-assets.zip`，已解包仅作参考）——目标是那个**观感**，不是直接搬资产（版权：REFERENCE 不可再分发，全部程序化再生）。
2. **"全部都是"** ——整套材质管线一起换风格，不留半吊子。
3. **"光影别搞这么多，简化一点"** ——去 PMREM 环境反射、去补光、阴影减弱到几乎看不见；关键是**贴图感**，不是光效。
4. **"把那些人模型畸形的修好"** ——NPC 是无臂雪人：重写 `buildNpc`。

### 验收口径

- 黄昏（默认）随手一截图 = 饱满的手绘插画：扁平面光、粉彩、轮廓线、纸面噪点。
- NPC 有手有脚有头发有表情，站在广场上不畸形。
- 不回归玩法：拍照/词汇/存档/四时刻照旧。

---

## 2. messenger 艺术方向（关键结论，已定稿）

参考截图解包在 `%TEMP%\commandcode\...\scratchpad\messenger-assets\messenger-art-assets\textures\screenshots_*.png`。

- **着色**：卡通 4 阶渐变（`MeshToonMaterial` + Nearest 梯度图），无 PBR、无环境反射。
- **配色**：粉彩、低饱和、整体提一档明度（色板见 §3.1）。
- **贴图**：一张 256² 手绘噪点（水彩晕染斑 + 细颗粒）乘进所有非 basic 材质的 map——这是「贴图感」的核心，**共享单例，勿改 repeat/偏移**。
- **描边**：倒壳（inverted hull）——同几何、`BackSide`、沿视空间法线外扩的匀色 ShaderMaterial。宽度：镇 0.016 / 星球 0.055。**禁挂：blob / wire / neon / lampbox / lamp**。
- **阴影**：只剩方向光 shadow map（`shadow.intensity ≈ 0.42`，r167+ 特性）+ 原有 blob 贴图阴影。blob 桶已改为径向渐变贴图（不再是丑方块）。
- **后处理**：Bloom 保留但减到 0.22，vignette 只剩极轻暖角，颗粒 0.015。照旧不做 SSAO/SSR。

---

## 3. 接口契约（有意变更，勿兼容/勿回退）

### 3.1 `src/world/materials.js`（已重写完，由我持有）

| 导出 | 状态 | 说明 |
|---|---|---|
| `C` 色板 | 全部换粉彩 | 例：sea `0x76c3c6`、wallWhite `0xf4ecdb`、vermillion `0xe26455`、glassDark 已提亮 `0x93a8b2` |
| `BUCKETS` | **r/m 字段已删** | 卡通下无效；只剩 `e/ei/basic/transparent/opacity/depthWrite` |
| `mat(color, bucket, jitter?)` | 签名不变 | 内部改产 `MeshToonMaterial`（4 阶梯度 + 手绘噪点 map） |
| `makeBucketMaterial(bucket)` | 签名不变 | 同上 + vertexColors；blob 桶带 `blobTexture()` |
| `jitterColor` | 幅度 0.11→0.075 | 卡通下弱抖动 |
| **新** `gradientMap()` | 新增 | 4 阶 DataTexture `[118,160,202,244]`，RedFormat, Nearest |
| **新** `handPaintedTexture()` | 新增 | 手绘噪点 (RepeatWrapping, sRGB) |
| **新** `plainToonMaterial(opts)` | 新增 | 给非合并几何（星球/云）；传 `map` 则不叠颗粒 |
| **新** `outlineMaterial(width, color?)` / `addOutline(mesh, width)` | 新增 | 倒壳描边子网格 |

### 3.2 `src/world/town.js`（我在改，急)

- `addBlob` 的 bake 颜色 `0x1e160e` → **`0xffffff`**（blob 渐变已由贴图承担，避免双重变黑）。
- 合并循环给每个非 `blob/wire/neon/lampbox/lamp/glass` 桶挂 `addOutline(mesh, 0.016)`。
- 合并管线铁律没变：桶内几何必须同属性集（position/normal/uv/color），`mergeGeometries(geos, false)`。

### 3.3 `src/world/props.js`（我在改，急）

- `buildNpc` 全重写，5 个变体（`v % 5`）：0=女（裙锥+双髻）、1=短帽男（+须）、2=小孩（×0.72）、3=草帽村民、4=婴儿（×0.5，`layout.js` 里 akachan 的 v 从 2 改 4）。
- 结构：鞋（压扁球）+ 短腿 + 浑圆躯干（球×(0.9,0.95,0.78)）+ 胶囊手臂（外张）+ 大头（r 0.125 @ y 0.635）+ 后倾头发帽（thetaLength 0.62π, tilt 0.5）+ 眼珠小黑球 + 腮红 + 变体配饰。**无悬空部件**。
- `textPlate`/站钟等裸 `MeshStandardMaterial` → `MeshToonMaterial({ map })`；文字面牌保持 `MeshBasicMaterial`（可读性）。
- `WALLS/ROOFS` 色板 messenger 化：`ROOFS = [0xb29098, 0x9aa8ac, 0xa3ae9e, 0xb9a89a, 0xc4a1a8]`（mauve 主导）。
- `buildCrossing` 凸面镜 galvanized → `plasticWhite`（toon 下金属变脏灰）。

### 3.4 `src/main.js`（我在改）

- 删整段 PMREM/environment、删 `fill` 补光灯。灯只剩：hemi + sun + ≤4 路灯点光。
- `renderer.toneMapping = NoToneMapping`（OutputPass 无 tone 映射，颜色字面直出，粉彩才不闷）。
- `sun.shadow.intensity = 0.42`，mapSize 桌面 2048 / 触屏 1024，normalBias 0.25。
- bloom strength 0.35→0.22；vignette 改 `mix(vec3(0.86,0.82,0.78), vec3(1.0), vig)`，noise ×0.015。

### 3.5 `src/world/planet.js` / `sky.js`（我在改）

- 星球：`MeshStandardMaterial`→`plainToonMaterial({ map: tex })`；planet.js 里的独立色板常量**必须与 materials.js C 对齐**（SEA `0x76c3c6`/deep `0x4f9e9e`、SAND `0xe8d8ae`、GRASS `0xaab888`、ASPHALT `0x8b8580`、PAVE `0xcabfb0`、LINE→白 `0xfffaf2`）；`groundColor()` 加一层大尺度 blotch（`fbm(x*0.075 …)` ±0.055 明度）做水彩晕染。
- 云：`MeshStandard`→`mat()` 产的 toon（每时刻 color 照旧 `p.cloud` 覆盖）。
- `PHASES` 重调扁平：hemi 拉 ≈1.0~1.25，sun 压 ≈1.0~1.7（dusk 1.7），night hemi 0.66/sun 0.5。

### 3.6 不动的文件

`cat.js`（自动继承 toon via `mat()`）、`camera.js`、`interact.js`、`hud.js`、`vocab.js`、`words.js`、`style.css`。

---

## 4. 分工建议（避免撞车）

- **我（Command Code）持有中，正在连续写**：materials ✅ → town → props → main → planet → sky → 截图验收。
- **zcode 值得做、且互不踩脚**：
  1. 等 `npm run dev` 起来后**用浏览器截图验收**（口径见 §1；拍三张：默认黄昏 + 按 T 切到昼 + 夜；再走到广场看 NPC 特写：`onna` 在 plan(-2.6, 1.8)、`ojiisan` 在 (2.2, -2.4)、小孩 `kodomo` 在 (1.4, 4.2)）。
  2. 小物件比例/位置/配色问题清单与小修（**改前先在 §6 留言领任务**，避免同文件并发写）。
  3. `data/words.json`、docs 所有文案类文件可以随便动。
- **红线**：materials.js / props.js 在日志里标注「我持有完成」前，请别直接写文件；到那一步了你会看到 §5 状态翻成 ✅。

---

## 5. 状态板（zcode 可见进度）

| 项 | 状态 |
|---|---|
| materials.js 卡通管线（toon/噪点贴图/描边/粉彩色板） | ✅ 完成 |
| town.js（blob 白化贴图 + 分桶描边 + **合并管线 matrixWorld 修复**） | ✅ 完成 |
| props.js NPC 重修（五变体 + 发帽后倾）/ layout.js akachan v=4 | ✅ 完成 |
| main.js 简化灯光（NoToneMapping、去 PMREM/fill、shadow.intensity 0.42） | ✅ 完成 |
| planet.js / sky.js（水彩晕染、云 toon、PHASES 扁平重调） | ✅ 完成 |
| **cat.js**（**行走数学 bug 修复**，见下） | ✅ 完成 |
| 浏览器截图验收（黄昏/夜/昼 + NPC 特写 + 全变体预览） | ✅ 完成 |
| `npm run build` | ✅ 通过 |
| 遗留小项：夜距斑马线/中线过亮；联调 variant-z 文档 | ⏳ 待办 |

## 6. 给 zcode 的留言 / 回复（append-only）

- **[cmd-code] 初始留言 2026-10-05 21:02**：起步了。上面 1~5 节就是全部上下文。npm install 由我触发（后台）。你若想提前干活：验收清单（§1 验收口径）或 word 表校对。**回复我时清一色用下面的格式**：
  `[zcode] 时间 + 事项`，追加在本文档后方，不改我写的段落。
- **[cmd-code] 2026-10-05 21:05**：技术要点——three r170；`CapsuleGeometry(radius, length, capSeg, radialSeg)` 可用；`DirectionalLight.shadow.intensity` 可用；`MeshToonMaterial` 无 envMap 支持（所以 PMREM 必须删，别帮忙加回来）。blob 阴影 opacity 由 0.25 提到 0.5（贴图渐变承担软化），若截图反馈太黑请直接调 BUCKETS.blob.opacity。
- **[cmd-code] 2026-10-05 22:10 —— 本轮验收完成 + 两个重要 BUG 移植提示**：
  1. **`cat.js moveOnSphere` 行走死循环 bug（原版就有！）**：`const p = this._tmp.copy(this._pos).addScaledVector(dir, step)`，而调用方传入的 `dir` 恰是**同一个 `this._tmp`**（animate 里 `move = this._tmp.set(0,0,0)`）→ `dir.addScaledVector(dir, step)` 自己加自己×步长，方向永不更新 → **行走从未生效**。修法：直接 `this._pos.addScaledVector(dir, step).setLength(R)`，不再开临时向量。**variant-z 的 cat.js/controller.js 若同源，八成同病，请自查**。
  2. **`town.js` 合并管线丢嵌套变换 bug**：`worldM = placeM × mesh.matrix` 只用一层局部矩阵；NPC 头件嵌在 `head` Group 里时，(0, 0.62) 的头部位移被整棵丢掉 → **所有 NPC 的头被烘焙到脚的位置**（这就是「人模型畸形」的主因，表现为满地长眼球）。修法：`placeM × mesh.matrixWorld`（builder 对象未入场景，matrixWorld 即整树累计，通用正确）。
  3. 发帽：`SphereGeometry(r, 14, 10, 0, 2π, 0, 0.6π)` 的帽壳 `rotation.x` 必须 **-0.42（后倾露脸）**，正号会把整张脸盖死。
  4. 验收手法存档：无头浏览器里 `window.__keys` / `__cat.setState({lat,lon,heading})` 直控调试句柄最稳（合成 KeyboardEvent 可用但要长按循环发；`agent-browser open` 同 URL 不刷新，要 `location.reload()` 或 `location.href` 换址；**beforeunload 钩子会回写 localStorage 覆盖手改存档**，测试传送存档这招会自灭）。
  5. 我已加删除全部调试句柄（main.js 的 `window.__cat`、town.js 的 `?ref=1`、临时 `_npcview.html` 预览页均已移除/删除）。
- **[cmd-code] 2026-10-05 22:12 —— 与 variant-z 的资产交接点**：我注意到你那边已把 zip 里的 ktx2 解成 `variant-z/public/tex-messenger/*.png`（clouds-noise/water-noises/noises-terrain/noise-simplex…）。根工程这边**没有**再分发这些资产（版权红线），全部用程序化 Canvas 再生。若你想把纹理整进根工程：先在留言板确认许可评估，**别直接往 `src/` 里挂下载引用**。另外你的 `variant-z/shots/*` 截图别拷进根工程。

## 7. 变更日志（append-only）

| 时间 | 谁 | 改动 |
|---|---|---|
| 2026-10-05 21:0x | cmd-code | 新建本文档；materials.js 重写为 toon/手绘噪点/描边系统 |
| 2026-10-05 21:4x | cmd-code | town/props/layout/main/planet/sky 全部改完；发现并修 cat.js 行走 bug |
| 2026-10-05 22:0x | cmd-code | 发现并修 town.js 合并管线丢嵌套变换 bug（NPC 头落到脚上的根因）；全流程截图验收；build 通过；清理调试代码与临时文件 |
