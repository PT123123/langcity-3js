# LangCity 3JS — variant Z

LangCity（Godot 原版）的 Three.js 复刻，**使用原版现成地图资产**（按用户要求不自绘地图）。

## 运行

```bash
cd variant-z
npm install
npm run dev        # 开发模式（或 npm run build && npm run preview）
```

默认端口见 vite 输出（preview 用 `--port 4199` 时为 http://localhost:4199）。

## 这版做了什么

- **原版星球地形**：加载 `public/planet/planets_present_full_0..9.glb`（十块分层拼岛，来自
  `LangCity/assets/art/env/`）+ 海面 + 高模树冠。调色板贴图（palette.png 16×16）在加载时
  按 UV 烘焙成顶点色（原版 shader 的 CPU 等价简化），逐顶点微差消塑料感。
- **原版物件落点**：`public/planet/planet.json` 的 245 个物件（kind/word/px 坐标）按
  PlanetMath 的坐标换算（`src/world/planetMap.js`，从 planet_math.gd 移植）放到球面，
  射线落到真实地形上；词库用 `public/data/words.json`（514 词全量）。
- **三个 GLB 解坑**（重要，未来更新资产必读）：
  1. 这些 GLB 的 JSON chunk 用 `\0` 填充，three 的 GLTFLoader 会报
     "Unexpected non-whitespace character after JSON"——已写脚本把填充改成空格
     （见 git 历史或重新执行：找 JSON 末尾 `}`，其后到 chunk 末尾全部覆写 0x20）。
  2. GLTF 场景树必须先 `updateMatrixWorld(true)` 再取 getWorldPosition，否则十块错位。
  3. 落点射线要过滤「半径最接近标称岛面 R±9m」的命中，否则会站到浮空岩石/塔顶上。
- **玩法闭环**：球面行走（重力指向球心 + 海边软墙 walk_phi 62°）→ 金色光圈 →
  拍照（白闪+快门音）→ 单词卡（汉字/假名/罗马音/中文 + 分类色 + Web Speech 日语发音）→
  词汇库（17 分类进度条 + 514 词列表）→ localStorage 存档（位置 + 已发现词）。
- **视觉**：按 `../docs/HANDOFF.md` 的视觉规格执行——ACES + 黄昏默认四时刻（朝/昼/夕/夜）、
  材质 roughness 分档、 Bloom（阈值随时段）+ Vignette/颗粒、PCFSoft 阴影 + 小物件 Blob Shadow、
  和纸 × 朱红 UI。
- **碰撞**（踩过的坑）：城镇道具密度高，圆形碰撞体互相重叠会"弹球式"连环推挤把猫甩飞。
  解法：只有建筑族生成碰撞体（道具可穿越，性价比取舍）+ 每帧推挤总量上限 0.4m +
  按距离排序处理。车站等特殊建筑用 `SPECIAL_COLLIDER_R` 单独给半径。
- **相机防穿墙**：aim→相机射线拉近 + 建筑包围盒检测（射线从盒内打不到背面），
  钻进盒子时切俯视脱困并立即生效（不经插值）。

## 已知限制 / 后续可做

- 树冠树叶在某些角度整片被 alphaTest 剔掉(只剩铁丝网般的枝干框)——leafmask 的
  通道约定没完全对上(alphaMap 取绿色通道),值得再对一下原始材质。
- 出生点 [0,2756] 在坡地上俯瞰小镇,构图尚可但不是最优;可在 planet.json 换 spawn。
  实测出生视角可能卡进建筑/朝天(相机防穿墙在窄缝里反复拉近),建议换开阔落点。
- 地形块之间存在缝隙,高空俯视会看到"黑洞"(穿缝看到天穹暗面);贴地行走不受影响。
- 个别物件落点与原版地形内容重叠(如某贩卖机被神社红砂石构造掩埋)——planet.json
  坐标在该点直接放道具会穿模,可加落点黑名单。
- NPC 为原版骨骼角色(含动画),但姿势库未逐一核对,个别动作(如音乐家)可能做出
  演奏姿势;后续可显式挑 /idle/ 片段或固定第一帧站姿。
- 雾偏浓(用户指示"云雾先不搞",维持现状);四时刻只调了参数表,过渡动画未做。
- 拍照判定是「猫的位置 + 朝向 60° 锥」,不是准星精确瞄准(更接近原版"走近出圈"的体验)。
- 物件朝向全部按 yaw=0(面朝南)摆放——planet.json 没有朝向数据,原版 street.gd
  可能有邻路对齐逻辑,未移植。

## 材质与现成模型(2026-10-06 更新)

不再全程序化:材质贴图与道具模型改用 **LangCity 原项目现成资产**(零自绘、零外网依赖),
复制到 `public/tex/`(57 张,缩至 1024,共 9.4MB)与 `public/models/`(17MB):

- **PBR 三件套**(`LangCity/assets/tex/{name}_{col,nrm,rgh}.jpg`):plaster_paint /
  wall_white_plank / wall_yellow / red_brick_03 / brick_warm / roof_tile / roof_slate /
  wood_dark / metal_blue / metal_iron / stone_jp / pavers 等 19 组。
  接口在 `src/world/materials.js`:`TEX(name, tag, rx, ry)`(异步缓存)与
  `PBR(name, {rx, ry, rough, metal, tint})` / `JPBR(name, opts, jitterKey)`(明度微差版)。
  教训:`concrete_tile_facade`(近黑瓷砖)与 `plaster_brick_01`(霉绿砖)与整体淡彩
  画风冲突,已弃用——选贴图先看原图。
- **Kenney city-kit 模型**(`public/models/kenney/`,GLB 内嵌 colormap):
  车 6 种(sedan/taxi/van/truck/suv/hatchback)、电杆 2 种、路灯 3 种、长椅、
  盆栽 3 种、花 3 色、草 2 种、栅栏、红绿灯。
- **polypizza**:消防栓、自行车、麻雀(带贴图)。
- **原版角色/动物**(`public/models/npcs/` 9 角色、`animals/` Husky/Fox):
  骨骼模型,`SkeletonUtils.clone` + `AnimationMixer` 自动播 /idle/ 片段。
- **统一入口**:`props.js` 的 `PROP_FILES` 表 + `preloadProps()`(town.js 开头 await)+
  `prop(key, {h, rotY})`(底部贴地/XZ 居中/按高度归一,加载失败回退程序化几何)。
- **⚠ 所有 `langcity-art-convert` 生成的 GLB(原项目全部 env/npcs 资产)JSON chunk
  尾部有 `\0` 填充**,GLTFLoader 会解析失败静默走兜底。复制新资产后必须重填为空格
  (本仓库已修 npc/env;planet GLB 上轮已修;动物为 .gltf 不受影响)。
- 程序化保留:贩卖机/邮筒/招牌(日文 Canvas 字)/拉面暖帘/喷泉/船/樱花树(飘瓣动画)
  ——这类"和风点睛"件没有现成模型,且 Canvas 字贴图反而更贴原作气质。

## 玩家猫换网上模型(2026-10-06 第三轮)

玩家小猫从程序化拼装换成 **网上现成的 Quaternius CC0 动画猫**
(poly.pizza 转载,`public/models/animals/cat.glb`,239KB,贴图内嵌,公有领域零署名):

- **自带 8 段动画**:Idle / Idle_Eating(进食) / Walk / Run / Jump_Start / Jump_Loop /
  Headbutt / Death。`src/player/cat.js` 用 AnimationMixer 做状态机,带淡入淡出交叉切换:
  待机 7s 后播进食再回待机;走/跑按 speed01(以 RUN 为基准,走≈0.58/跑=1.0)自动换挡;
  跳跃 Jump_Start→Jump_Loop 滞空;加载失败回退程序化橘猫(保留为兜底)。
- **朝向**:该 GLB 原生朝 +Z,不要按原项目 Fox 的经验加 MODEL_YAW=PI(会倒着走,已实测)。
- **攀爬**(controller.js 新机制,原版 Godot 有、3js 版首次补上):跳向建筑/树干墙面
  →扒墙竖直攀爬,W 上 S 下、空格蹬墙跳离、到顶自动向外跃下、按 S 下到地面自动脱墙。
  判墙高用 town.js 挂到碰撞体上的 `box`(Box3),沿贴墙点径向步进找盒顶;模型没有
  原生攀爬片段,攀爬姿态=身体贴墙(略后仰)+ Walk 循环 1.8 倍速,与原版"程序化攀爬姿态"
  思路一致。已知取舍:不会站上屋顶(无屋顶行走支持),到顶即跃下。
- 调试:`window.__dbg.player.mesh.userData.catAnim` 暴露 `force('Run')` / `phase()`,
  可强制播片段/读当前片段名。
- 根项目(根 src/,CommandCode 的道)未动,仍是程序化猫。

## 地面贴图(2026-10-06 第二轮)

星球地形(玩家脚下的地板)从纯调色板顶点色升级为 **真实贴图三平面混合**,资产仍全部
来自原项目(`LangCity-tex-cache`,ffmpeg 重压缩到 q6 后拷入 `public/tex/`,新增 5 组约 0.5MB):

- **三平面混合材质** `groundMat()`(`materials.js`):原版地形 GLB 的 UV 是调色板
  索引,不能用来铺贴图,故按**世界坐标 triplanar 采样**(法线加权三向投影,免 UV、
  无接缝、悬崖侧面不拉伸);`onBeforeCompile` 注入,顶点色仍作 tint 保留原版色块布局。
- **草地×砂石双贴图**:`grass_ground`(草)× `worn_asphalt`(路面/泥地/广场)按顶点
  属性 `aGrass` 混合——权重在 `planetMap.js` 烘焙调色板时按「绿通道显著高于红蓝」算出,
  调色板里的灰阶路面(444..eee)自然落进沥青贴图。草贴图在 shader 里去饱和提亮
  (色相交给顶点色,贴图只出细节),`boost 2.6` 把偏暗贴图提回原版亮度。
- 实测:镇区调色板本来就是灰(路面/广场 41%)+暖棕(泥地 28%)为主,绿色只占 5%,
  贴图后观感与原版色块布局一致,近看有颗粒/裂纹细节(截图 shots/tex2-ground-*.png)。
- **贴图地坪**(车站前广场/神社庭院/喷泉):`town.js` 的 `yardDisc()` 极坐标网格逐点
  射线贴地 + `polygonOffset` 防 z-fight;**带平整度守卫**——采样半径极差 >0.9m 直接
  不铺(本岛地形起伏 14m+,神社/车站当前落点全是陡崖,地坪自动跳过,宁可无也不穿帮)。
- 调试技巧:`window.__dbg` 暴露 {player, camera, scene, THREE},可直接改
  `player.normal/heading/alt` 传送到任意落点验证地面;`material.userData.shader.uniforms`
  可运行时调 boost/scale。注意 4199 端口若被上轮的 `vite preview` 占用,服务的是旧
  dist,必须杀掉换 `npm run dev`。

## 文件结构

```
public/planet/    原版地形 GLB ×16 + planet.json + tex/palette.png + tex/leafmask.png
public/data/      words.json（514 词）
src/world/planetMap.js   GLB 加载 + 调色板烘焙 + BVH 射线 + PlanetMath 坐标换算
src/world/town.js        planet.json → 构建器摆放 + 碰撞
src/world/buildings.js   程序化建筑族（民宅/公寓/车站/便利店/拉面/咖啡/超市/邮局/神社）
src/world/props.js       街具/植物/动物/行人 + Blob Shadow + 灯光光晕
src/world/sky.js         天空穹顶 shader + 四时刻参数表
src/player/cat.js        玩家猫:Quaternius CC0 动画猫 GLB + 动画状态机(程序化兜底)
src/player/controller.js 球面行走 + 攀爬 + 碰撞 + 第三人称相机(防穿墙)
src/game/interact.js     金色光圈 + 拍照判定
src/game/words.js        词库加载 + 已发现集合
src/game/hud.js          单词卡 / 词汇库 / 发音 / 时刻切换
src/main.js              渲染器 + 后处理 + 异步启动
shots/                   截图记录
```
