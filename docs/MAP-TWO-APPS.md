# 地图来源全表：四套原始素材、三张可玩的图

> 记录时间：2026-10-06。触发原因：用户发现「之前那个像城市的地图没了」，
> 要求先回答成因、再决定怎么处理。结论：**两套都留着，先拉回来再对比。**
> 同日追问「我记得还有一套地图…messenger-art-assets.zip，还有个从桌面 LangCity 拉回来的，都要弄回来」
> —— 核对之后确认来源**不止两套，是四套**，见 §8。本文是这件事的唯一权威记录，改任何一套之前先读它。

---

## 0. 一句话

仓库里从来就有**两套各自独立的地图实现**。用户记忆里「像城市」的那张图是
**根目录那套纯程序化小镇**；它被一次未提交的重组从工作区**整个删掉**了（代码没丢，全在 git HEAD）。
本轮已把它原样恢复并跑在 `:5174`，与 `variant-z`（`:5173`）并存对照。
另外从桌面的 `LangCity/`（原版 Godot 工程）与 `messenger-art-assets.zip` 把**缺的资产与手作数据全部拉回仓库**，
并给 `variant-z` 加了两个「原版岛直通」模式：`?island=raw`（十块碎块壳直接当碰撞面）与 `?island=intro`（菜单同款单体低模岛）。
现在三张图都能走：城市版 `:5174`、资产版烘场 `:5173/`、原版岛 `:5173/?island=raw|intro`。

---

## 1. 两套实现分别是什么

| | 根目录「城市版」 | `variant-z/`「原版资产版」 |
|---|---|---|
| 入口 | `index.html` → `src/main.js` | `variant-z/index.html` → `variant-z/src/main.js` |
| 星球地面 | `src/world/planet.js` **自己建面**（程序化球帽 + 顶点色刷路面） | `src/world/planetMap.js` **烘场**：读原版 GLB，把碎块壳烘焙成 240×160 高程场 |
| 城镇布局 | `src/world/layout.js` **手写规划表**（路网/广场/停车场/斑马线/物件坐标） | `public/planet/planet.json` 的 245 个落点 + `src/world/town.js` 程序化构建器 |
| 星球半径 | `R = 60`（layout.js 常量） | 标称 `radius 34 × scale 1.5 = 51`，**实测地面中位半径 92.55** |
| 外部模型 | **一个 GLB 都不用**，全部程序生成 | `planets_present_full_0..9.glb` + `water` + `tree-leaves_0..4` + Kenney/polypizza 道具库 |
| 视觉基调 | 平涂插画风（`NoToneMapping`，颜色字面直出） | 原版 GLB 顶点色 + MSE 换装 + ACES |
| 规模 | 295 行 main.js，251k 三角形，103 draw call | 更大，含 messenger/云/树叶等 |

两套在 HEAD 里是**平行的两份代码**，`variant-z/` 从来没有 `layout.js`（已核对：
`git ls-files | grep -c "variant-z/src/world/layout.js"` = 0）。

---

## 2. 城市版是「怎么没的」

不是被改坏的，是被**未提交地删除**了。恢复前的 `git status` 原文（18 个 `D`）：

```
 D index.html
 D package-lock.json
 D package.json
 D src/game/interact.js      D src/game/vocab.js       D src/game/words.js
 D src/main.js               D src/player/camera.js    D src/player/cat.js
 D src/style.css             D src/ui/hud.js           D src/world/collision.js
 D src/world/layout.js       D src/world/materials.js  D src/world/planet.js
 D src/world/props.js        D src/world/sky.js        D src/world/town.js
```

配套的两处改动说明这是一次**有意的收敛**，不是误删：

- `README.md` 被改成「**游戏本体只有一份：variant-z/**（使用原版现成地图资产的版本）」；
- `justfile` 删掉了 `run` / `build` / `preview` 指向根目录的三个目标，只留 variant-z。

`git log --diff-filter=D` 查不到任何删除提交 —— **这些删除从未提交**，所以文件一直躺在 HEAD 里可取。
仓库里也没有 `.quarantine-*` 目录，说明当时是直接删的（违反本项目「迁移删旧副本改用隔离目录」的规矩，
本文先把这件事记下来，之后同类重组一律 `mv` 到 `.quarantine-<日期>/`）。

### 恢复命令（本次实际执行）

```bash
git checkout HEAD -- index.html package.json package-lock.json src/
npm install --no-audit --no-fund          # 根目录独立 node_modules，15 个包
npm run dev -- --host                     # http://localhost:5174
```

`README.md` 与 `justfile` **没有**回滚（它们带着本轮其它有效改动），只把目标补回去：
`just run` = variant-z :5173，`just run-city` = 城市版 :5174，`just setup` 一次装两套依赖。

### 恢复路上踩到的两个坑（都已修）

1. **根目录 vite 会扫到 variant-z 的页面。** Vite 的 `optimizeDeps.entries` 默认是 root 下
   `**/*.html`，于是根项目预打包时把 `variant-z/messenger-lab.html` 也当入口，
   报 `Unexpected "else" at variant-z/src/lab.js:125`。
   → 新增根目录 `vite.config.js`，把 entries 锁成 `['index.html']`，并固定 `port 5174 strictPort`。
2. **那个 `Unexpected "else"` 本身是真 bug。** `variant-z/src/lab.js:124` 写成了
   `if (//tex//.test(src))` —— `//` 起头是**行注释**，整行条件被吞掉，`else` 就悬空了。
   原意是 `if (/\/tex\//.test(src))`。已修正（该页 `messenger-lab.html` 之前是打不开的）。

---

## 3. 城市版恢复后的实拍

两张图由 `window.__dbg`（本轮新加，与 variant-z 同口径）在页内渲染后 POST 给
`tools/shot-receiver.mjs`，落在 `variant-z/shots/audit/`。

- `city-asobo.png` — 出生即站在街上，正对「まちまえ駅」，左「コンビニ」右「スーパーまる」，
  有电线杆+电线、自动售货机、路人 NPC、脚下斑马线。**这就是用户记得的那张图。**
- `city-topdown.png` — 俯视：完整路网（虚线中线 + 每个路口斑马线 + 环路+巷道），
  房子**沿街道两侧排开**，树和野地在外圈。

对照 `variant-z` 当前状态（见下一节），差别一目了然：城市版有街，variant-z 是「一块地上插模型」。

---

## 4. variant-z 的病根（为什么它天生对不上）

三条已核对的事实：

1. `public/planet/planet.json` 的 `planet.model` 明写
   **`planets_present_intro_planet.glb`**，245 个落点全部照那颗星球的坐标标注。
2. 那颗模型**不在仓库里**（`find . -iname "*planets_present*"` 只有 `full_0..9` / `tree-leaves_0..4` / `water`）。
   仓库里塞进来的是 `full_*` —— 一堆互相重叠的**碎块壳**，径向高差 20~60 m。
3. 于是「坐标照着 A 星球、地面却是 B 碎块」：
   - 标称半径 51，实测碎块地面中位半径 **92.55**（`planetMap.js:297` 的注释早就记了这件事）；
   - 碎块壳整体是低饱和粉灰（实测镇区顶点色 sat 中位 **0.028**，而判「路面」用的阈值是 0.03）；
   - 碎块壳在可玩带正中揉出一个大洼地：**镇界内 6814 格里 2203 格（32%）低于水面**
     （洼底 77.6，海面 80.1）。

第 3 条最后一项是本轮最严重的后果：摆放阶段把低于水面的落点判成「掉进海里」直接跳过，
实测 **245 个原版落点里 102 个被吃掉**，只剩 142 个。这就是用户问「我原本的那些去哪了」的直接答案
—— 不是被重画没了，是被海平面判定删了。

### 走过的两条弯路（别再走）

| 判据 | 结果 |
|---|---|
| 按顶点色饱和度判「这是路面 ⇒ 压平」 | 碎块壳整体低饱和，一半格子算灰面 → 全图摊成平板 |
| 按「离某个落点多远」压 3.2 m σ 的平地 | 245 个落点铺满整个可玩带 → 同样全图摊成平板，就是用户说的「一缕平地」 |

两条都已从代码里删掉。现在「哪里算城镇」**只有一处判定**：`townPlan.js` 的 `TOWN_RECT`。

---

## 5. 本轮对 variant-z 的修复（进行中）

方向（用户已确认）：**移植 layout.js 的手写街网** + **按 HANDOFF §2.2 色板重画地表** +
**把 245 个原版落点领到街前**，一条都不删。

| 文件 | 改动 |
|---|---|
| `variant-z/src/world/townPlan.js`（新） | layout.js 的路网表移植成 plan 米制：10 条街（2 主干/2 次干/2 环路/4 巷道）、站前广场、停车场、16 处斑马线；`TOWN_RECT` 是镇界唯一口径；`makePlanFrame` 做 plan↔球面↔地图像素换算；`groundColor` 按 HANDOFF 色板画街间地；`roadTexture`+`streetMesh` 生成带中线/路缘石/人行道砖的实体路面条带；`crosswalkMesh` 生成斑马线 |
| `variant-z/src/world/planetMap.js` | 删掉饱和度判据与逐落点压平；新增 **3b 镇区台地**：台面高程 = 镇内干地 p60 且至少高出海面 2.5 m，镇界内一寸压平，镇外按「离镇界的真实米距」加 18° 锥形限高（贴边的假岩台削下来、洼地垫上去）；`planFrame` 用**台地自己的半径**建（不是全图中位半径，否则街网窄一成、斑马线对不上路口）；`F.town` 位图让镇区地表**跳过碎块壳 16 色调色板量化** |
| `variant-z/src/world/town.js` | 删掉现算最小生成树当街道的 `layRoads`/`roadRibbon`（量出来是 27 条 6 m 短枝，像踩出来的缝不像街）；换成 `layStreets`（每条街压一条同宽同高的**路床**）+ `frontOntoStreets`（楼退到人行道外、正墙朝街；街具站上人行道；车停在沥青上顺街；镇外/离网远的原地不动）；小道具让路改成整条街廊（沥青+人行道+半米路肩）；铺装换成手写街网的实体条带+斑马线+广场地坪；出生点改成**站前广场**（`planet.json` 登记的 `[0,2756]` 贴着世界边界还压在 45° 褶子上） |

### 关键原则：看到的路就是踩到的路

`terrainMeshes = [groundMesh]` —— 玩法射线**只碰烘出来的那张地面网格**，
`sourceMeshes`（带着画路的碎块壳）默认隐藏。所以路床必须烘进地面网格顶点，
沥青条带只是穿在最上面的一层可辨认铺装。床不跟着街走，猫就永远走在「地球基底」上。

### 台地修复前的实测（待复验）

```
frontage 17, roadTiles 10, crosswalks 16, plaza 1, placed 142,
inWater 102  ← 台地修复后要变成 0, tooSteep 1, pads 64, nudged 25
spawn: standSlope 0.2
terrace(修复后应出现): level / frameR / dryCells / wetCells=2203 / sea 80.1
```

---

## 6. 复现与量测工具链

| 用途 | 做法 |
|---|---|
| 跑城市版 | `just run-city` → http://localhost:5174 |
| 跑资产版 | `just run` → http://localhost:5173 |
| 落盘截图 | `node tools/shot-receiver.mjs`（127.0.0.1:8899）→ 写进 `variant-z/shots/audit/`；`/?name=` 收 base64 dataURL 字符串，`/json?name=` 收 JSON |
| 页内钩子 | 两套都有 `window.__dbg`：城市版 `{THREE,scene,camera,renderer,planet,town,cat,interact,hud,followCam}`；资产版另有 `player/interact/colliders/buildingBoxes/interactables/surfaceAt/spawnPx/townStats/audit/dirFromPx/composer/canvas` |
| 资产版 URL 开关 | `?plain=1` 跳过 HUD、`?audit=1` 跑完整体检并回传 JSON+热图、`?fresh=N` 破缓存、`?mse=1` MSE 换装、`?chunks=1` 显示碎块壳原物、`?leaves=1` 树叶 |
| 停服 | **只按 PID 杀**（`netstat -ano | grep :5174` 取 PID），别按映像名 `taskkill /IM node.exe`，会连带杀掉其它 node 进程 |

---

## 7. 待办

- [x] 台地修复后复验 —— **改口径了**：见 §9，原版岛直通模式下一个落点都不丢（245/245），
      烘场模式的丢点问题因此有了更好的解法（不再靠台地硬抬）
- [ ] 修 `mapAudit.js` 的 `reach()`：它用 `spawnPx[0]/CFG.world[0]*N` 直接算格子，
      没走 `planet.field.pxToCell`（高程场跨 360° 经度而世界像素只跨 260°），可达率是从错误的格子算的
- [ ] 三张图逐项目视对比后，决定长期留哪一套（或把城市版的建面逻辑并入资产版）
- [x] `planetMap.js` 里 `applyRoads` 的「刷沥青」注释已过时 —— 已改成实情：路面颜色只由 `streetMesh` 条带画，
      这里只压街床 + 路肩（见 §11.3）
- [ ] `variant-z/.scratch/` 是本轮的临时草稿目录，收尾时清掉
- [x] 更新 `README.md`：改成三张图并存的口径
- [ ] `reference/` 里的第三方二进制（原版 GLB、messenger 包）在提交前先确认推送范围，见 §8 末
- [x] 并图（§10）+ 小地图跟着并图改（§10.5）
- [x] NPC 骨骼尖刺（§10.6）：去掉坏动画、给坐着的阿婆配长椅
- [x] Kenney 植物件荧光青（§10.7）
- [ ] 站前广场实拍还有几处「一眼假」没收：房屋/站房立面上那些**纯黑的大方块**（窗？面板？）、
      近景里粗得离谱的**路灯杆/电力横担**、沥青上的**碎石与橙色路障**、斑马线上**插着的路灯杆**、
      **半空剪断的电线**、盆栽/花的 Kenney 几何仍是**尖角剪影**且有几个半埋进路面（换了色没换形）
      —— 其中「半空电线 + 巨型白杆」已修（`elec_pole` 那批 Kenney 件不是电线杆而是「两杆一弧」，
      归一化后变成横在别人家屋顶上的 5～9 m 白管；电杆已改走程序化单杆，见 props.js `buildPole`）。
      其余最新清单见 §11.6
- [x] 并图后的**街廊与地表**修完一版：楼不骑沥青（`blocked/laneLeft/shrunk` 全 0）、
      街区中央留得住草、屋面不再读成铺装。详见 §11
- [x] §11 那几个 0 里**有两个是假的**：量具本身错了三层（离屏出图绕过 composer、`asphaltSlack` 取的是内切椭圆、
      终检用近似尺自证）。挖到根因：**规划系是等距圆柱经纬网，带 `k = λ·cosφ` 的剪切**，
      镇缘的楼与街夹 45°、角尖踩进行车道 1.43 m。摆放期三处调用点已统一换成切平面口径，
      朝向改成「先认街再谈距离」（背对街的山墙没了）。详见 §12
- [ ] 镇缘「原版外迁的背街排」（离街 6～8 m 的那几栋）还缺一套自己的落位规矩，见 §12.7
- [ ] 主角猫在并图后的落点上是**未贴图的灰块**（`obaasan-0-front.png` 里脚下那只），
      `mseSwap(pet)` 走的是 `keepMaps`，但它自己的 colormap 似乎没带上来，待查

---

## 8. 地图来源其实是四套（2026-10-06 补）

之前本文只写了两套实现，那是**只数了仓库里的代码**。用户记忆里还有两份素材，
核对桌面后确认全部真实存在，且都带回了仓库：

| # | 来源 | 里面是什么 | 落在仓库哪里 |
|---|---|---|---|
| ① | 仓库根目录（git HEAD） | 纯程序化城市版：`layout.js` 手写路网 + 建面，零外部模型 | 原样在 `src/`、`index.html`，`:5174` |
| ② | `variant-z/` | 碎块壳烘场版：`full_0..9` 烘焙成高程场 + `townPlan.js` 手写街网 | 原样在 `variant-z/`，`:5173` |
| ③ | `~/Desktop/LangCity/`（原版 Godot 工程） | **手作地图数据本体**：`data/map.json`（平面城 352 物件 + 显式路网 `roads_h/roads_v/rail/park`）、`data/planet.json`（岛冠 245 落点，另有 `planet.json.bak`）、`places/npcs/quests/interiors/words.json`；**摆件算法** `scripts/planet/planet_math.gd`+`planet_builder.gd`+`street.gd`；**整备工具** `_tools/curate_planet.gd`、`_tools/audit_float.gd`、`_tools/geom_audit.gd`、`tools/{scatter_planet,gen_city,scatter_props}.py`；**修复史** `docs/{MAP_FLOATING_FIX,PLANET_WORLD_FIX,VISUAL_DIRECTION,VISUAL_UPGRADE}.md`；**模型** `assets/art/env/*.glb`（含 `planets_present_intro_planet.glb` 4.75MB） | `reference/LangCity/{data,tools,docs,scripts-planet,scripts-street}/`；env 模型直接进 `variant-z/public/planet/` |
| ④ | `~/Desktop/messenger-art-assets.zip`（7.1MB，375 条） | 上游 messenger 的资产包：111 个 `.drc`（Draco 压缩网格，含 `..._intro_planet.drc` 337KB）、193 个 shader、25 贴图、28 UI、字体 | `reference/messenger-art-assets/`（整包解开，含它自带的 `INVENTORY.md`/`MANIFEST.md`） |

③ 与 ④ 是同一批美术的两条路径：④ 是 web 版 Draco 压缩件，③ 里 Godot 已经转成了**未压缩的 GLB**，
所以本次不需要写 Draco 解码器——直接用 ③ 的 GLB。

> 本次推送只带了 ③④ 里**跑起来真需要的东西**（env 模型进了 `variant-z/public/planet/`，
> 街网与落点数据并进了 `townPlan.js`/`planet.json`）。`reference/`（8.9MB，原版 Godot 工程与
> messenger 包的对档副本）留在本地未入库 —— 它是参考件不是运行依赖，要不要进公开仓库先确认。

### 撤回一条错误结论

`planetMap.js` 里原来写着（本文 §4 也抄过）：

> 「planet.json 的 245 个落点是照一份仓库里没有的 `planets_present_intro_planet.glb` 标的」

**这句是错的，已就地改正。** 读了 ③ 的源码才知道：

- `planet_math.gd` 的开头写明：像素坐标是**复用旧平面地图（`data/map.json`）的 schema**，
  「px 在星球上不再表示米，而是岛冠展开图上的经纬度，进星球前正映射、存档时逆映射」。
  落点跟某一份具体 GLB 没有绑定关系。
- `planet_builder.gd` 的主路径是 **`full_0..9` 十块穿插分层拼岛**（注释原话：直接实例化即对齐），
  `intro_planet` 只是**缺块时的退化路径**（菜单同款低模岛）。`planet.json` 里的 `model` 字段
  全项目没人读，是残留元数据。
- 所以 variant-z 走 `full_0..9` 本来就是对的，缺的从来不是那张 intro 模型。

### 顺带纠正的两条「原版有而我们没有」

- `planet_builder.gd` 注释说摆件「必须先过 `water_radius` 这道海拔门槛」，但 `street.gd` 的
  `_place_on_planet` **没有这道门槛**（全项目 grep 只有注释命中）。原版靠 `walk_phi` 软墙拦玩家，
  不靠删物件。→ 直通模式照此实现：245 个落点全摆，一个不删。
- `_place_on_planet` 的坡度倾斜比的是**命中点的径向**而不是标称球面方向（`dot > 0.8`，≈37° 以内才跟着地面倾斜，
  再陡就直立插进坡里）。`MAP_FLOATING_FIX.md` 记着这条改动的原因：比 `dir` 会把高海拔平地误判成斜坡。
  → 直通模式已移植（`town.js` 步骤 3 的 `RAW` 分支）。

---

## 9. 原版岛直通模式：`?island=raw` / `?island=intro`

`variant-z/src/world/planetMap.js` 在烘场之前分出一条路：**不标定、不削平、不台地、不铺街**，
`terrainMeshes` 就是真实网格本身，玩法射线直接打它。口径逐条对齐 ③ 的 `PlanetBuilder` + `street.gd`：

| 环节 | 原版（Godot） | 直通模式 |
|---|---|---|
| 缩放 | `scale = 1.5`，标称 `R = 34×1.5 = 51` | 同：跳过 `TARGET_GROUND_R = 100` 标定 |
| 地面 | 十块 `full` 的 trimesh 碰撞 | `chunkMeshes` + BVH 射线（`?island=intro` 时是单体 `intro_planet`） |
| 海平面 | 水壳顶点到球心的**中位距离** | 同（`_water_shell_radius` 同款算法） |
| 摆件 | `dir_from_px → surface() → 切平面基 × rot`，不删不挪 | 同：`live = sites`，跳过认街/松弛/让路/地基 |
| 坡面 | 法线·命中点径向 `> 0.8` 才跟着倾斜 | 同 |
| 出生点 | `map.spawn`，越界则新档传送到便利店门口 | 同（`originalSpawn()`；实测 `[0,2756]` 本身合格：r=43.56、高出海面 7.88m、倾角 3.3°） |

实测（`:5173/?island=raw&fresh=1`）：

| | `?island=raw` | `?island=intro` | 烘场模式（默认） |
|---|---|---|---|
| 地形网格 | 10 块碎块壳 | 1 块 | 1 张烘焙地面 |
| 三角形 | 381k | 59k | ~240×160 网格 |
| 地面中位半径 | 35.91 | 35.85 | 92.55 |
| 海面半径 | 35.68 | 35.06 | 80.10 |
| 摆放 | **245 / 245**，`noHit 0` | **245 / 245**，`noHit 0` | 台地修复前 143（丢 102 判为掉海） |
| 245 个落点的 r 分布 | 32.0 ~ 57.4（中位 41.0） | 同量级 | — |

落点 r 分布与 ③ `MAP_FLOATING_FIX.md` 记录的「hit radius range: 35.0 .. 55.1」对得上，
说明这条射线链路与原版等价。

实拍（`variant-z/shots/audit/`）：`raw-top.png`（整颗岛鸟瞰）、`raw-town.png`（镇区斜视）、
`intro-island.png`（单体低模岛）。**两张图都印证了同一件事**：原版的岛就是小——
岛冠只有 31m×97m 上下，而房子模型 4.6×8m，所以建筑彼此压得很紧；
这正是当初把整场放大到 `GROUND_R=100` 的动机。放大与不放大是**取舍**，不是谁对谁错，
现在两条路都在，可以直接走进去比。

### GLB 的 NUL 补白坑（已修）

从 ③ 复制过来的 11 个 GLB（`intro_planet/intro_water/intro_trees/intro_clouds/intro_galaxies/
beachfoam_vfx/waterfall*_vfx/smoke-1/birds_2`）在 `GLTFLoader` 下报
`Unexpected non-whitespace character after JSON at position 1237`。
原因：**glTF 规范要求 JSON chunk 用空格(0x20)补齐到 4 字节，这些文件用 NUL(0x00) 补齐**，
而 NUL 不是 JSON 空白。修法是把 JSON chunk 里的 `\x00` 就地换成 `\x20`（长度不变、二进制其余部分不动），
一次性脚本处理了 `variant-z/public/planet/*.glb` 里命中的 11 个。**桌面 `LangCity/` 的原文件没有改动。**

### 第三方二进制的推送范围

`reference/messenger-art-assets/INVENTORY.md` 自己记着上游声明「reference 资产不可在未经许可下再分发」。
本仓库 `origin` 是 `github.com:PT123123/langcity-3js`，且 **`origin/main` 已经包含 112 个同源 GLB**
（Initial commit 就推上去了）。本轮新增的这批先只留在工作区，**没有提交、没有推送**；
要不要入库/要不要把已有的那批撤下来，需要用户拍板。

---

## 10. 并图：三套来源合成一张（2026-10-06 深夜～10-07）

用户的第一优先级一直是这句：**「把那几个地图拼接到一起」**。现在做到了。

### 10.1 拼的是什么

| 来源 | 条目数 | 坐标口径 |
|---|---|---|
| `cityPlan.js`（layout.js 的城市内容） | 179 | plan 米（x 东、z 南，原点=站前广场） |
| `planet.json`（原版 Godot 落点） | 245 | 旧平面地图像素（`CFG.world=[5200,4000]`） |

`town.js:579 mergeCityObjects()` 把城市条目的 plan 米经 `frame.planToPx` 换成像素，
和原版条目并成**同一张落点表**，后面所有环节（退让、松弛、压路床、落座、贴门窗）
都只认这一张表。`?island=raw` 直通模式不参与合并（那条路要的就是「作者坐标一个都不动」的对照）。

### 10.2 分区规则：镇芯只放城市楼

原版 245 个落点里有 61 个落在 layout.js 街网的镇芯矩形（`CITY_CORE`）里，和城市楼正面撞。
规则是**城市内容优先占镇芯，原版落点沿自己那条射线外迁**：

- `ejectFromCore()`（`town.js:528`）从落点自身的方位向外走，步进 1.5 m，要求同时满足：
  出得了 `CITY_CORE`、还在可玩带 `inBand` 内、离镇界不超 8/6 m、
  **不正好甩进行车道**（原版图书馆就被甩到过住宅区街心）、且不与已让位者重叠。
- 地标类（银行/医院…）的起跳余量 `lead` 是 13 m，普通物件 3.5 m。
- 作者那条射线整条被城市楼占死时（实测 17 条），**换 24 个方位重扫**，
  而不是把第二座银行留在站前广场心上穿模 —— `stuck` 从 19 降到 **0**。
- 最后一道才松的约束是「彼此别挨着」：宁可两个让位者靠近点，也不回镇芯。

### 10.3 城市侧唯一一次挪楼：站房让街

`layout.js` 那张表的口径是「路只是地面贴皮」，所以南北主街直接从站房中间穿过去。
按「先挪建筑、别硬塞地形」的优先级，只动了这一栋：

```js
const CITY_RESEAT = { station: [0, -1.5] };   // 北移 1.5 m 让出前坪
```

同时把 `townPlan.js` 的南北主街北端收口在商店街路口（`z1: -12.4`，原来伸到 -17.4），
并删掉那条落在收口外的孤儿斑马线（现在 29 条，数目对得上）。楼还是那栋楼，门还是朝着广场。

### 10.4 并图后的实测（`?fresh=1`，2026-10-07）

```
merge:   city 179 / island 245 / ejected 61 / stuck 0 / offBand 2
placed:  420
roads:   laid 12 / 616 m / main 2      crosswalks 29   plaza 1
laneLeft []   blocked []   attachLost 0
pads 150  flattened 12  slopePads 26  reseated 17  frontage 19  streetClear 50
yards 5 (skipped 0)   inWater 2（就是那两条船）
offBand 2：北弧森林环压在经线收口处，出了可玩带 φ∈[10°,52°]，按规则丢弃
```

### 10.5 小地图跟着并图一起改了（用户特别叮嘱过）

`game/map.js:87` 从 `townStats` 读两份数据，**不再用写死的 `LANDMARKS` 坐标**：

- `stats.mapPins`（12 个）：`town.js` 在落座完成后，把 `MAP_PIN_KINDS` 里每个 kind
  **真正摆出来的那颗**的像素坐标交出来，并带 `city: true/false` 标出它来自哪套；
  `setPins()` 按 `id` 逐个替换针脚坐标，没摆出来的地标不会留个假针脚。
- `stats.mapBlocks`（44 个）：每个实心建筑的 `{x,z,hx,hz,yaw}` 轮廓，
  镇芯是城市那套、外环是原版外迁的 —— 并图之后「镇子长什么样」在小地图上是看得见的。

### 10.6 骨骼角色：不是我们的绑定错了，是 GLB 的骨架被压平了

现象：所有原版 NPC 在街上炸成一堆 1.2～1.5 m 的尖刺。三条结论（都实测过，别再重走）：

1. **不是 `SkeletonUtils.clone` 的锅。** 它给一个 mesh 节点的 60 个 primitive 各造一份
   Skeleton（60 skeleton / 22 根真实骨骼）是**正常行为**；手写 `cloneSkinned` 单骨架重绑后
   与它**像素级一致**。
2. **不是 `bindMode` 的锅。** 改成 `DetachedBindMode` 会把星球那份祖先变换乘两遍（A²），
   92 m 的半径直接把角色甩到 180 m 外：实测 62 次 drawcall / 3338 三角形、**一个像素都看不见**。
   必须保持默认的 `attached`。
3. **真因**：这些 GLB 导出的是一副**被压平的骨架**（22 根关节里 18 根直接挂在场景根下，
   只有 j6/j10 挂在 j4、j14/j18 挂在 j1），而 5 条动画曲线是按真正的嵌套链写的。
   绑定姿势下 delta 是单位阵 → 画出来是正常人（`variant-z/shots/audit/npc-bindpose.png` 是决定性证据）；
   动画一推进到任何关键帧，旋转枢轴落到错误的关节上 → 袖子被拉成尖刺。

**处理**：`props.js` 里 NPC 不再挂 `AnimationMixer`，改成和程序化兜底同口径的轻摆
（`rotation.z = sin(t*1.2+…)*0.02`），原版模型一个都不换。犬/狐是 three.js 示例件、
骨架是嵌套正确的，`attachIdle` 对它们照旧生效（`dog-sway-0.png` 里跑动正常）。

副作用发现：**`npc_0`（oldwoman.glb）的绑定姿势本身就是坐着的**（大腿水平、小腿垂直、坐面 0.45 m）。
所以随机路人池 `NPC_KEYS` 去掉 `npc_0`（只剩 6 个站着的），点名的 obaasan 保留原模型，
并在 `buildNpc` 里给她配一条按她局部坐标对齐的长椅（`sitBench()`，坐面顶 0.455、椅背在她身后）。
实拍：`obaasan-0-front.png`、`leaf-fix-a.png`。七个 key 逐个验过：`npc-key-{0,1,3}.png`、`npc456-{a,b}.png`。

### 10.7 Kenney 植物件的荧光青

`prop()` 现在会过一遍 `fixLeafless()`：材质色号命中 `#73eddd`/`#76eac8`
（那是 colormap 图集缺失后只剩 baseColorFactor 的叶子层）就换成 `hdMaterial({kind:'foliage'})`。
全图 **100 个荧光青尖角 → 0**（`planter` 20、`flower` 66、`grass` 16），
换成走世界坐标三平面的手绘叶材，正好绕开那套指向丢失图集的 UV。

### 10.8 本轮补上的验证口径（工具链）

| 坑 | 结论 |
|---|---|
| 隐藏标签页里 `canvas.toDataURL()` 拿到的是黑图 | `document.hidden=true` + `preserveDrawingBuffer:false`。**必须** `renderer.render()` 后 `drawImage` 到一张 2D canvas 再 `toDataURL` |
| 用 `requestAnimationFrame` 等一帧 | 隐藏页 rAF 是暂停的，只会等到超时，此路不通 |
| 判断「模型到底画没画/多大」 | **像素差分**：同一机位渲两帧，只切换目标对象的 `visible`，对差异像素求包围盒；`pxPerM = (H/2)/(dist·tan(fov/2))` 直接换算成米 |
| 目标被别的物件挡住 | 绕 8 个方位各测一次，取差异像素最多的那个方位再截 |
| 页内 `import('/src/world/props.js?probe=1')` | 查询串能拿到一个**独立**模块实例（用来单练某个 key），但它自己的 `propLib` 是空的，要先 `await P.preloadProps()` |
| 页内 import `three/addons/...` | 裸 specifier 解析不了，得写 `/node_modules/three/examples/jsm/...` |
| `Box3.setFromObject` 量骨骼模型 | 不可信（不跟着蒙皮走）：同一个模型量出 1.45～2.18 m，而像素差分是 1.56 m。要尺寸就用差分 |

---

## 11. 街廊与地表：这一轮把「后插入感」修掉的六处（2026-10-07）

并图之后剩下的不是「少东西」，是**东西摆下去的姿态不对**：楼骑在行车道上、街区中央一片砂、
平屋顶读成广场石畳。这类问题的共同成因是**放置管线里那几把尺都是错的**，
所以这一节按「错在哪 → 怎么量出来的 → 改完的数字」记，方便下次有人想改回去时先看见代价。

### 11.1 根因：`measureFoot` 把附属件量进了占地

`measureFoot(g)` 原来是**整个 group 的包围盒**。校舍（buildings.js:304 起）体量是 `8 × 3.8`，
但它挂了三样山墙外的细件：**旗杆**（0.09 m 见方，伸出侧墙 1.1 m）、**两根校门矮柱**（各 0.3 m，
在正墙外 2.6 m）。这些细件的包围盒一 union，占地立刻变成 **10.2 × 9.4**——
于是全镇唯一放得下它的 12 m 街区也判成放不下，白白把校舎缩到七成（`stats` 里那一行 `shrunk@0.70`）。

**改法**（town.js:128）：`measureFoot(g, bodyOnly)`。楼（`SOLID_KINDS`）走 `bodyOnly`，
只 union **平面两条边都 ≥ 0.6 m** 的块——旗杆、门柱、雨棚腿、招牌这类挂在体外的细件一律不算占地。
保留一条兜底：如果一件模型**全是**细件（鸟居、灯柱），退回全盒，不许塌成 `0.4` 默认值。

实测：`shrunk 1 → 0`，`placed 420` 不变，校舎以原尺寸站进街区。

### 11.2 让位规则：从「街心距换算」改成「底圈直接量」

这里踩了两次过头，都记下来：

1. **原来的尺太松**：`laneNeed` 按 `rd.w / 2` 算，楼只退到沥青一半就停手。
   实测 **16 栋实体的底圈压在铺装带上**（library / bank / shrine 整圈 100%，站房 86%）——门面插进街心就是典型的「后插入模型块」。
2. **中间那版又太严**：改成拿「街心距 − 路半宽 − 体量投影」换算，并要求**每条**街都让满。
   12 m 街区里楼与两条平行街的距离此消彼长，换算式还得猜朝向，结果报出 **8 栋「堵塞」、13 处 `noGap`**，
   其中 6 栋只是**墙脚咬着路缘**——那正是日本商店街的样子，正常店行被误诊成病。

**现在的尺**（town.js:435 `asphaltSlack`）：沿模型底圈取 8 个真实角点，按真实 yaw 变换后
逐个查「离最近街中心线多少 − 该街路缘位置（`rd.w + 0.16`）」，取最差值。
**只有一条硬线：底圈不许踩上任何一条街的沥青**；人行道被墙脚吃掉不算病，玩家走不过去才算。
`laneNeed`（town.js:425）降级成**舒适线**，只对它正对的那条街要求「沥青 + 路缘 + 墙前 0.45 m 站人」，
背街与街区中央由 `asphaltSlack` 兜底。终检（town.js:1081）与让位**共用同一把尺**——
以前终检自己换成街心距近似，才报出那 8 栋假堵塞。

**让位走的是用户给的维修阶梯**（town.js:`unblockStreets`）：
原地不动 → 沿该街法线外推 → **斜挪**（路口转角两条街的铺装带重叠，只沿一条法线永远踩上另一条，实测卡死 9 件街具）
→ 最后才 `shrinkSite` 压体量。`shrinkSite` 只压 x/z 不压 y（local Y 是「当地向上」，压 y 会把两层校舎缩成棚屋），
并同步换算 `foot` / `pad` / `padR`。当前这批数据用不到它，`stats.shrunk = 0`。

实测（`?fresh=1&v=road8`）：`blocked 13 → 0`、`laneLeft 8 → 0`、`shrunk 1 → 0`、`streetClear 143`、
`pads 138`、`crosswalks 29`、`spawn.standSlope 0`。
另外写了一个**独立**探针 `__lane2()`（对 `townStats.mapBlocks` 每个街区取 72 个周长采样点，
完全不走 town.js 的函数）来对账——它和代码口径第一次不一致，才发现错的是代码不是地图。

### 11.3 「像鬼一样的地面」：草权重跟错了路肩缓坡

用户口径：「当务之急是把街道弄完整，不要像鬼一样的地面」。像素证据是**街区中央没有草**：
`applyRoads`（planetMap.js:917）用同一个 `w` 同时压高程和 `F.grass`，
而那个 `w` 的衰减尾巴是 **1 m 路肩**（为了把街床压平）。12 m 街区两头各被吃掉 4 m 以上，
中央只剩 **2.5 m 见方**保得住草权重 → 整个镇子的街区是一片砂石贴图。
实测 block 内像素均值 `215,205,180`，而 HANDOFF 色板的草是 `143,168,118`。

**改法**（planetMap.js:931）：草权重单开一条 `wg`，只让到 `streetMesh` **真正铺到头**的地方（`half + 0.35`），
不再跟着压平用的 1 m 缓坡走。高程仍用原来的 `w`（街面该压平还得压平）。
复测像素均值 ≈ `131,115,95`。证据：`shots/audit/ground-blockNW.png`、`ground-street.png`。

### 11.4 屋面是第三人称的第一表面

星球比例下（GROUND_R≈92）**机位常年高过房顶**，所以屋面就是玩家看到的第一表面，不能糊：

| 件 | 原来 | 现在 | 为什么 |
|---|---|---|---|
| 校舎 / 病院（平屋顶） | `stone_jp`（砌墙石） | `metal_corrugated`（立缝金属板，`rx5 ry3 metal0.2`） | 俯视是一块 8×4 的广场石畳，跟脚边地面分不出来（`school2-top.png`）。日本校舎/病院的平屋顶就是立缝金属板 |
| 站房压顶 | `roof_slate`，`rx/ry` 与面比例无关 | `rx 4.5, ry 2.9` | 采样频率不跟面的长宽走，4.5×2.9 之下压顶被拉成一丝一丝的竖纹 |

顺带把 §5 那条坑再钉一次：贴图名**必须**是 `public/tex` 里真有的键。写 `'slate'` 会 404，
而取不到 image 的贴图不是「退回纯色」，是**整片采样成黑**——站房屋顶从街面看是一块悬着的黑板。
现在 `TEX`/`PBR` 有 404 兜底（`userData.lost` + watchers 摘掉 map），不会再出现纯黑面。

### 11.5 11.1 引出的回归：校门矮柱站到沥青里

占地不再包含门柱之后，**门柱自己**站进了 `商店街` 的行车道（`ground-street.png` 里前景那两根）。
`buildSchool` 的门柱从正墙外 2.6 m 收到 **0.95 m**（buildings.js:325）——仍在自家门前，不碰人行道外沿。

### 11.6 这一轮没收的清单（下一轮接着做）

站前与街面实拍里还剩这些**一眼假**，都有截图但没有对应尺子：
- 站前广场那个**纯青灰的空盒**（`#9aa8a8`，2.97×2.82×6.99，plan ≈ (5.98, 87.68, 34.46)）——没立面、没窗、没贴图
- 沥青与路肩上的**碎石/泥块**团；**出租车停在行车道中间**；草地上一个**蓝环 + 灰柱**的来历不明件
- `npc[2]` 被完全遮挡（60 个 skinned primitive 全在别的楼后面）
- 主角猫仍是**未贴图的灰块**（§7 旧账，未查）
- **病院站在裸砂地上**，四周没有铺装带（其它市政件都有地坪）
- `pov-street-day.png` 里路人有一只**伸直不弯的手臂**
- 地面 `boost = 2.6` 在正午仍偏曝，近景街区底色还带一点砂

---

## 12. 规划系是斜的：这一轮把「楼跟街夹 45°」连根挖掉（2026-10-07）

§11 收尾时 `laneLeft / blocked / shrunk` 都是 0，我以为街廊已经干净了。
用户口径是「整张图要像一个地方设计出来的」，所以接着从**玩家真走得到的镇缘**再看一遍——
结果那一块全是「模型块斜着插进街里」。这一节记的是**尺子本身错了两层**，
以及为什么改完之后 `stats` 里那几个 0 才第一次算真话。

### 12.1 先修量具：三个把我引向假结论的探针 bug

按「先怀疑自己的验证脚本」的规矩逐条查，三条都记下来，因为它们各自造出过一个**不存在的缺陷**：

| 现象 | 真因 | 证据 / 修法 |
|---|---|---|
| 截图整体灰暗、校舎像浮空 | 离屏出图用了 `renderer.render()`，绕过了 `composer` 的 `OutputPass`（ACES + 曝光 1.05） | 同机位像素均值 `83,80,72` vs `116,113,105`（差 40%）。**所有离屏出图必须走 `composer.render()`** |
| 探针量到全镇所有楼的 `plan z ≈ -49.8` | `frame.dirToPlan(d)` 要的是**单位方向**，我把世界坐标点直接喂进去了 | 加 `.normalize()`。已在终检处写了行内注释 |
| 「上一轮 3 个违规，这一轮 0 个」 | `?fresh=1` 会重播种（`BUILDERS` 表里就有 `Math.random()`），**跨轮数字根本不可比** | 同一轮内自证，别拿 A 轮的读数去比 B 轮的扫描 |

「校舎浮空」这条被实测否掉：底圈离地 0.02～0.33 m，`audit.sites` 415 件里最大 `float 0.30`（是 `lowwall`）。
**没有像素证据不下缺陷结论**这条规矩，这一轮又救了一次。

### 12.2 终检换成真实几何，并且让它自证

`asphaltSlack` 是**摆放期搜索用的廉价近似**（矩形四角 + yaw 旋转），拿它当终检等于用要检验的尺自己量自己。
两个坑：

1. 它原先按 8 个等角取 `(cos·hx, sin·hz)` —— 那是**内切椭圆**的点，四角比矩形短最多 41%，
   于是「中心压着东西大街中心线」的病栋（体量 5.5×4.1）被量成合法，`laneLeft` 报 0 而玩家直接撞墙。
   → 改成显式的**矩形** 4 角 + 4 边中点。
2. 终检（town.js:1130 起）改成直接量**每个子网格自己的定向包围盒底角**：
   `geometry.boundingBox` 的 4 个底角 × `o.matrixWorld` → 归一化 → `dirToPlan` → `roadDistance`。
   一次遍历同时产出**体量违规**（`laneLeft`）和**附属件违规**（`appendages`，如门/招牌/门柱）。
   挂在墙上的件（窗、招牌面、檐口）用 `ctr.length() − ey/2 > groundR + 0.35` 排除，不落地就不算堵路。

并且加了两个**自证读数**，专门防止「报 0 是假绿」：
`stats.dirDrift`（`s.dir` 与模型真正朝向的夹角，阈值 0.0015 rad）与 `stats.slackDiff`
（廉价近似 `rule` 与真实几何 `real` 的差）。这两个都是 0 / 全同号，才敢说终检的账对得上模型。

### 12.3 根因：`planToDir` 是等距圆柱经纬网，带一个随位置变的剪切

这是这一轮真正的收获。规划系（townPlan.js:89）是

```
φ = φ0 + z/R,  λ = x / (R·sinφ)      ⇒  x = λ·R·sinφ,  z = R(φ − φ0)
```

`z` 方向确实是等距的，但 `x` 里那个 `sinφ` 让它**不是直角坐标**：沿南北走 `b` 米（λ 不变），
规划 `x` 会白漂 **`k·b` 米，`k = λ·cosφ`**。镇心 `λ≈0` 完全看不出来，镇缘实测：

| 规划点 | `k = λ·cosφ` | 一栋 3.2×3.0 的家，南北向那条边在规划里被拉成 |
|---|---|---|
| (0, 0) | 0 | 3.00 m（正） |
| (-37.7, -18.9) | **−1.17** | 偏移 **+3.70 m**（实测角点 3.69，公式对上） |
| (-44, 0) | −0.62 | — |

于是三件事同时发生，全都长在「后插入资源」这张脸上：

- **楼斜着插进街里**：`yaw` 是拿**规划法线**算的，而街线本身在这个网里是弯的。
  镇缘按规划法线摆的楼，与它正对着的那条街在切平面里夹到 **45°**（`r10-westedge-top.png` 一整排都是斜的）。
- **角尖踩进行车道**：`asphaltSlack` 在规划里量矩形，真实模型在切平面上是**平行四边形**，
  实测 `rule = 0.18`（合规）而真实角点 `−1.43 m`（骑在 环镇西路 上）。
- **小地图与实景不一致**：`mapBlocks` 把楼当规划矩形画。

**改法**（town.js:429 起，四个换算函数）：`planK` / `tan2plan`（切平面偏移→规划落点）/
`plan2tan`（规划方向→切平面方向）/ `roadDirs`。三个摆放期调用点全部换口径：

- `asphaltSlack`（town.js:482）：8 个采样点走 `tan2plan`。
- `frontOntoStreets`（town.js:359）：退线距离与 `yaw` 都用真实街线。
- `unblockStreets`（town.js:516）：让位阶梯的「沿法线外推 / 斜挪」都改成切平面米数。
- `mapBlocks`：`planYawDeg`（town.js:454）把切平面角换回规划角，小地图仍按街网画。

一个必须记住的细节：**法线不能拿 `plan2tan(规划法线)`**。那是「规划法线这个方向的像」，
与画出来的街线不垂直；街线是照规划铺到球上的（它就是权威），所以法线只能取**真实街线的垂线**。
`tan→plan` 的雅可比行列式 = 1（保向），所以 `(-rb, ra)` 与原来的 `roadLat = (-dz, dx)` 同侧，`side` 的符号照旧。
（第一版就错在这里：`laneLeft` 掉到 0 但 `shrunk` 涨成 2，改成 `roadDirs` 之后两个都是对的。）

### 12.4 朝向要先认街，再谈距离

`frontOntoStreets` 原来有个「已经在退线带上就 `continue`」的短路，
但它把**朝向**也一起短路了 —— 于是距离刚好、`rot` 是原版随手给的那批楼，就永远背对着街
（`r11-alongWestRing2.png`：环镇西路 那栋家把山墙和后门对着街）。
现在 `s.isSolid` 的 `yaw` 提到短路之前算（town.js:391），街具仍保留 `planet.json` 的 `rot`（原版一批车/神社
就是因为 `rot` 被忽略才全朝一个方向，这条别动）。

### 12.5 四个 builder 的附属件收回自家体量环

`measureFoot` 改成只量体量（§11.1）之后，挂在环外的细件就没人管了，实测四处：
校舎**旗杆**（正墙外 1.1 m）、**校门矮柱**（±1.4 m 沿街 + 正墙外 0.95 m）、**校名牌**（原来在屋顶上）、
**鸟居**（正墙外 2.6 m，实测柱脚落进 环镇东路 行车道 0.9 m）、**邮筒**（正墙外 0.5 m，压上 北环 路缘）。
现在全部收进各自体量环内（buildings.js：`buildSchool` / `buildShrine` / `buildPostOffice`），
校名牌从屋顶搬到正墙（第三人称平视才读得到字）。

### 12.6 实测对照（同一轮内自证，跨轮不可比）

| 读数 | road18（近似尺 + 规划法线） | road21（切平面尺 + 真实街线 + 朝向先认街） |
|---|---|---|
| `placed` | 420 | 420 |
| `laneLeft`（体量踩沥青） | 3，最差 `house −1.43 m` | **2，最差 −0.15 m**（墙脚咬着路缘，不算病） |
| `appendages`（细件踩沥青） | 2 | **1**（同一栋家的门片，随体量违规） |
| `shrunk` / `noGap` | 0 / 0 | **0 / 0** |
| `dirDrift` | 0 | 0（终检的账对得上模型朝向） |
| `slackDiff` | 16（有正有负 = 近似会漏报） | 16，**全部 `rule ≤ real`**（近似只偏保守，不再假绿） |
| 近街 27 件实体的朝向 | 一排斜的 | **23 件 ≤ 15°**，4 件是「最近街 ≠ 正对街」的探针假阳性 |
| `audit.summary` | `problems 0` | `problems 0`、`solidsBad 0`、最大 `float 0.30`、`merge.stuck 0`、`spawn.standSlope 0` |

证据图：`r10-westedge-top.png`（改前，整排楼斜出街网）、`r11-westedge-top.png` / `r11-swestedge-top.png`（改后）、
`r11-alongWestRing2.png`（街面视角）。

### 12.7 这一轮又没收的（接着 §11.6）

- 镇缘两栋**站在裸砂地里、离街 6～8 m** 的楼（`mansion@(-23.2,-30)`、`house@(-38.4,-25.9)`）：
  它们在 `frontOntoStreets` 的 `d > 18` 与 `TOWN_RECT` 边界之外，属于「原版外迁的背街排」，该给它们一条自己的规矩
- 街面实拍里那几个**黑色球状 blob shadow**（树脚下），掠射角下读成一颗颗黑石头
- 镇缘地表仍有**斜向条纹**与一大片**阴影带**（`r11-westedge-top.png` 左半），是 `boost` + 法线贴图在球缘的掠射问题
- 斑马线在**没有铺装的地方**也画了（`r10`/`r11` 中景那两块白条）—— `CROSSINGS` 表还是并图前那套坐标


