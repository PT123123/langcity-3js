# Messenger 风格移植 —— 风格解析 + 资产管线 + 实现进度

> 来源:`messenger-art-assets.zip`(messenger.abeto.co 美术资产剥离包,375 文件)
> 目标:LangCity 3JS(主项目 + variant-z)的**全部材质贴图风格**切换成 Messenger 风格。
> 分工:CommandCode 在自己的会话里做材质替换;本文档 + 转码资产 + `messenger.js` 风格模块由协作者完成,**CommandCode 直接取用,不必重复逆向**。
> 参考图:`textures/screenshots_after-start.png`(提取后见 `variant-z/public/tex-messenger/reference-after-start.png`)——手绘粗描边 + 平涂画布质感 + 扁平蓝绿海面。

---

## 1. 风格解析(逆向自 193 个 shader,已完成)

直接读源 shader 得出,不是猜的。文件对照:`shaders_App3D-BLRWK1h9-095.frag`(通用表面材质)、`-156.frag`(草地)、`port-waterMaterial_*`、`port-cloudMaterial_*`、`port-outlines_frag.glsl`。

### 1.1 表面材质核心公式(095,适用于建筑/道具/角色一切表面)

```glsl
// ① 阴影色 = HSV 色相 -0.02(偏紫)、明度 ×0.5 —— 这是暗部不发灰发黑的秘诀
vec3 hsv = rgb2hsv(baseColor);
vec3 shadowColor = hsv2rgb(vec3(hsv.x - 0.02, hsv.y, hsv.z * 0.5));

// ② 光照二值化:directDiffuse(标量)× 阴影因子,smoothstep 硬切
//    普通物体 0.2→0.4(略带过渡);角色 HARD_CUT_SHADOW 0.1→0.15(更硬)
float lit = smoothstep(0.2, 0.4, NdotL_radiance * shadowOcc);
vec3 col = mix(shadowColor, baseColor, lit);

// ③ 非角色表面加一点点镜面(0.075),且只在接近水平朝上的面上:
col += smoothstep(0.01, 0.011, directSpecular) * 0.075 * fit(dot(n,up), 0.95, 0.9, 0, 1);
// ④ 补间接光(环境),最后加雾
```

**要点:光照输出只有两档颜色(受光/背光),没有平滑渐变。** 体积感全部来自几何和 AO,不来自光照渐变。我们现有的 MeshStandardMaterial + 半球光做不出这个效果,必须走 onBeforeCompile 或 ShaderMaterial。

### 1.2 三平面噪声颗粒(手绘画布质感)

所有表面叠一层 triplanar 采样的噪声纹理 `tNoise`(`assets_images_noise-simplex-layered-blur-highq`,已转 png):

| 场景 | 采样强度 `wPos * k` |
|---|---|
| 地形 | **0.4**(大颗粒,草地/岩石色带) |
| 云 / 水 | **0.07** + `time*0.05` 流动 |

噪声三个通道各有用途(r/g/b 是不同噪声),草地/岩石按 r,g,b 阈值 `step()` 出**色带斑块**而非连续过渡。

### 1.3 描边 = 屏幕空间后处理 + 噪声打散(手绘感的灵魂)

- 渲染时往 MRT 的 gInfo 写:深度(1-z/w 高精度)、球面编码法线、`outlineContribution`
- `outlineContribution *= step(0.17, noise.g * noise.b)` ——**噪声让轮廓线断续、粗细不均**,这是手绘感的来源;草地还有一道 `sinenoise` 概率去边
- 后处理 `port-outlines`:邻域采样比深度/法线/info,`thickness × resScale(min(1, h/1300) * scale)`,描边色 `uOutlineColor` 混入后**再过 3D LUT 调色**
- 岩石:`striations = step(0.47, noise(高度条纹))` 写进 surfaceId → 岩壁上出横向条纹描边

### 1.4 草地(156):实例级色块跳变

每簇草按实例随机取三档颜色:`baseColor ± 0.075 (HSV.V)`,再按 `sinenoise` 概率把描边打掉 → 远看是**拼色块的手绘草地**,不是均匀绿。

### 1.5 水(port-waterMaterial)

- 基色来自顶点色纹理;`waves = fract(noise.r*0.7 + vDist*3 + time*0.1)`,只在 `0.3<vDist<0.7` 带内,`step(0.3, waves)` → 岸边一圈圈**阶梯状白浪**
- 近岸两级 `smoothstep` 阶梯加 `vec3(0.2,0.8,1.0)` 浅水色 → 水线一圈青色描边感
- 同样有噪声打散描边 + 色相偏移阴影

### 1.6 后处理链

```
渲染(MRT: 颜色 + gInfo) → 描边混合 → 3D LUT 四面体采样(uLUTIntensity) → (bloom/暗角)
```

LUT 是 32³ R16G16B16A16_SFLOAT(`assets_images_lut.ktx2`,已转)。**整幅画的"那一口颜色"大半来自这个 LUT**——暖奶白高光 + 青绿中间调。现有 ACESFilmic 换成/叠加 LUT 后风格立刻贴近。

### 1.7 UI/字体(参考)

厚实奶油色块字(`UglyDave` 手写感)、按钮 = 黄色圆角块 + 深棕粗描边;UI 视觉重量极低。`ui/*.icon`/`fonts/*.font` 是引擎私有格式不能直接用,取**风格**即可:和纸底 → 奶油 #f2ead8,描边 #4a4238 加粗,圆角加大。

---

## 2. 资产管线(zip ktx2 → png,已完成 ✅)

工具:`tools/ktx2-decode.mjs`(Node,零新依赖——用 three 自带的 Basis 转码器 WASM 解码,手写 PNG 编码)。

```bash
node tools/ktx2-decode.mjs   # zip 已解到临时目录时:自动扫描 → 转 png
```

产出 `variant-z/public/tex-messenger/`:

| png | 用途 | 在模块里叫 |
|---|---|---|
| noise-simplex-layered-blur.png | 表面颗粒/描边打散(主噪声) | `noiseBlur` |
| noise-simplex-layered-pixellated.png | 像素颗粒变体 | `noisePix` |
| noises-terrain.png | 地形色带(R/G/B 通道分色带) | `terrain` |
| water-noises.png | 水浪/浅滩 | `water` |
| clouds-noise-512.png / -64.png | 云 | `clouds` |
| grass-blades.png | 草叶形状图集 | `grass` |
| tree-leaves.png / -detail.png | 树冠透光斑 | `leaves` |
| trails-noise.png | 拖尾/粒子 | `trails` |
| particle-sprites.png | 粒子图集 | `particles` |
| galaxy.png | 天空/星系 | `galaxy` |
| reference-after-start.png | 官方参考截图(调色对照) | — |

LUT 特殊:32³ R16G16B16A16 半浮点 3D 纹理,png 装不下 → 解成 `lut3d.raw`(8bit RGBA, 32768×4 字节)+ 运行时 `Data3DTexture`。解码脚本同样产出。

---

## 3. 风格模块(新文件,不与 CommandCode 冲突)

`variant-z/src/world/messenger.js`,全部可独立 import:

- `mseNoise()` — 加载转好的噪声纹理集
- `mseSurface({color|vertexColors, noiseScale, hardCut, outlineBreak, ...})` — §1.1 公式材质(onBeforeCompile 注入,兼容现有合并几何/顶点色/阴影接收)
- `mseWater(opts)` — §1.5;`mseCloud(opts)` — 云
- `OutlinePass` — §1.3 屏幕空间描边(ShaderPass,读深度/法线/材质标记)
- `LUTPass` — §1.6 四面体 LUT 调色(`lut3d.raw` → Data3DTexture)
- `MSE_OUTLINE_COLOR` 等常量

集成:`main.js` 里 3 行(描边 pass + LUT pass + 把 `M/PBR/JPBR` 换 `mseSurface`);详细步骤见 §5。

## 4. 验证记录

(实验页 `variant-z/messenger-lab.html` 出图后在此贴结论)

## 5. 给 CommandCode 的集成清单

(模块定稿后填写)

## 6. 对账

- [x] 风格逆向解析(§1)
- [x] ktx2/3D LUT 转码管线 + 12 张 png + lut3d.raw(§2)
- [ ] messenger.js 模块
- [ ] 实验页截图验证
- [ ] 集成清单/对账
