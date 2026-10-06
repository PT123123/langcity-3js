# 猫咪连跳 / 无限连跳 + 设置开关 —— 实现记录

> 本文件记录本轮「给猫咪加连跳 → 改成无限连跳 → 加设置开关」的实现过程、设计决策、改动清单与验证结果。
> 生效工程：`variant-z/`（根目录 `src/` 已废弃，见 git status）。

---

## 1. 任务来源（用户原话）

1. 「给猫咪加上连跳的功能，」——先做成落地前可二段跳的「连跳」。
2. 「这个帮我改成无限连跳。然后可以在设置中去开启是否要无限连跳」——默认改成无限连跳，并在**设置**里提供开关。

---

## 2. 需求拆解

| 需求 | 实现 |
|---|---|
| 猫咪空中可再跳（连跳） | 地面起跳后、落地前，滞空段数未用尽即可再蹬一脚 |
| 无限连跳 | 设置开启后不限段数，空中反复按键可一直升高 |
| 设置里开关 | 新增 ⚙ 设置面板，含「无限连跳」开关 |
| 长按不误触 | 忽略跳跃键的系统按键重复（`e.repeat`），连跳必须松手再按 |
| 记忆设置 | 开关状态持久化到 `localStorage` |

---

## 3. 设计决策

- **默认行为**：设置默认**关闭**，即「最多二段跳（`MAX_JUMPS = 2`）」；开启后 `infiniteJumps` 为真，不限段数。
- **空中段初速**：首跳 `JUMP_V = 3.6`（≈0.66m），连跳（空中段）用略弱的 `AIR_JUMP_V = 3.2`，避免无线连跳时升得太快/失控。
- **计数方式**：用 `this.jumps` 记录「本次滞空已用段数」，落地清零；开启无限连跳时该计数不参与判定。
- **攀爬衔接**：蹬墙跳（`_leaveClimb`）算作已用一段（`jumps = 1`），落地前还能接一次连跳，避免墙跳白送两段。
- **按键边沿**：连跳需要「重新按」而不是「一直按住」。实现方式是在 `keydown` 里对跳跃键忽略 `e.repeat`。
- **持久化 key**：`langcity3jz_infinitejump`（`'1'` 开 / `'0'` 关），与既有 `langcity3jz_bgm` / `langcity3jz_player` 命名一致。

---

## 4. 改动清单

### 4.1 `variant-z/src/player/controller.js`

- 新增常量：
  - `AIR_JUMP_V = 3.2` —— 连跳（空中段）初速度。
  - `MAX_JUMPS = 2` —— **关闭**无限连跳时，落地前最多起跳段数（二段跳）。
- 构造函数新增状态：
  - `this.jumps = 0` —— 本次滞空已用跳跃段数（落地清零）。
  - `this.infiniteJumps = false` —— 无限连跳开关（由设置面板控制）。
- 跳跃判定（`update` 内，约 146–153 行）：
  ```js
  if (grabbed) {
    k['Space'] = false; k['KeyK'] = false;
  } else if (wantJump && (grounded || this.infiniteJumps || this.jumps < MAX_JUMPS)) {
    this.vAlt = grounded ? JUMP_V : AIR_JUMP_V;
    this.jumps = grounded ? 1 : this.jumps + 1;
    k['Space'] = false; k['KeyK'] = false;
  }
  ```
- 落地清零：`if (this.alt < 0) { this.alt = 0; this.vAlt = 0; this.jumps = 0; }`
- `_leaveClimb(...)`：`this.jumps = vUp > 0 ? 1 : 0;`（蹬墙跳算一段）。
- `teleportTo(...)`：重置 `this.jumps = 0;`。

### 4.2 `variant-z/src/main.js`

- 跳跃键忽略系统重复（避免长按自动连跳）：
  ```js
  addEventListener('keydown', e => {
    const p = window.__dbg.player;
    if (!p) return;
    // 长按跳跃键的系统重复不重启跳：连跳需重新按键（松手再按）
    if (e.repeat && (e.code === 'Space' || e.code === 'KeyK')) return;
    p.keys[e.code] = true;
  });
  ```
- 给 `Hud` 传开关回调，落到玩家对象上：
  ```js
  hud = new Hud({
    onShoot: ..., onPhase: ...,
    onInfiniteJump: (on) => { player.infiniteJumps = on; },
  });
  ```

### 4.3 `variant-z/src/game/hud.js`

- 构造函数新增入参 `onInfiniteJump`。
- 设置面板接线（`#settings-btn` 开合 `#settings`，`#settings-close` 关闭，`Escape` 也关）：
  ```js
  this.settingsPanel = document.getElementById('settings');
  this.infiniteToggle = document.getElementById('toggle-infinite-jump');
  this.onInfiniteJump = onInfiniteJump;
  const savedInfinite = localStorage.getItem('langcity3jz_infinitejump') === '1';
  this.infiniteToggle.checked = savedInfinite;
  if (onInfiniteJump) onInfiniteJump(savedInfinite);   // 启动即应用已存设置
  this.infiniteToggle.addEventListener('change', () => {
    const on = this.infiniteToggle.checked;
    localStorage.setItem('langcity3jz_infinitejump', on ? '1' : '0');
    if (this.onInfiniteJump) this.onInfiniteJump(on);
  });
  ```

### 4.4 `variant-z/index.html`

- `#hud-top` 末尾新增设置按钮：`<button id="settings-btn" title="设置">⚙</button>`。
- 新增设置面板（居中模态，沿用 bigmap 遮罩风格），含 `#toggle-infinite-jump` 开关与说明。
- 操作提示更新为「空格 跳跃/连跳（空中再按一次）」。

### 4.5 `variant-z/src/style.css`

- `#settings-btn` 并入右上 HUD 按钮样式（含 hover）。
- 新增 `#settings / #settings-panel / #settings-head / .set-*` 与开关样式 `.sw / .sw-track / .sw-thumb`（选中态用主题朱红 `--vermilion`）。

---

## 5. 验证记录

### 5.1 构建

- `npm run build`（variant-z）：**通过**，95 模块，无报错（仅 chunk >500kB 的体积提示，属既有）。

### 5.2 运行时验证（无头浏览器，agent-browser）

- 第一轮（二段跳版本）实测**通过**，结果为：
  - 单跳最高 **0.663 m**
  - 连跳（按两次）最高 **1.167 m**（明显二段升高）
  - 长按（持续 repeat keydown）最高 **0.664 m**（未自动连跳）
  - 页面无运行时错误（`window.__err` 为 null）
- 第二轮（无限连跳 + 设置开关版本）：脚本已备好，但本轮 agent-browser 会话不稳定（每条命令重新拉起浏览器、页面状态丢失），**结果未取到，待复测**。

复测脚本（在页面控制台 / `agent-browser eval --stdin` 注入；思路：分别测「关闭时封顶二段」「开启时可一直升高」「设置持久化」「面板开合」）：

```js
window.__setTest = { done: false };
(async () => {
  const p = window.__dbg.player;
  const press = c => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true, repeat: false }));
  const release = c => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sampleMax = ms => new Promise(res => {
    let m = 0; const t0 = performance.now();
    const tick = () => { m = Math.max(m, p.alt); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(m); };
    requestAnimationFrame(tick);
  });
  const reset = () => { p.alt = 0; p.vAlt = 0; p.jumps = 0; p.climbing = false; p.keys = {}; };
  const tapJump = async () => { press('Space'); await sleep(50); release('Space'); };

  const panel = document.getElementById('settings');
  const toggle = document.getElementById('toggle-infinite-jump');
  document.getElementById('settings-btn').click();
  const panelOpened = !panel.classList.contains('hidden');

  toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(60); reset(); await sleep(120);
  for (let i = 0; i < 5; i++) { await tapJump(); await sleep(170); }
  const finiteMax = await sampleMax(1100);
  const finiteSaved = localStorage.getItem('langcity3jz_infinitejump');
  await sleep(500);

  toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
  const flagOn = p.infiniteJumps;
  reset(); await sleep(120);
  for (let i = 0; i < 12; i++) { await tapJump(); await sleep(170); }
  const infiniteMax = await sampleMax(1100);
  const infiniteSaved = localStorage.getItem('langcity3jz_infinitejump');

  document.getElementById('settings-close').click();
  window.__setTest = { done: true, panelOpened,
    finiteMax: +finiteMax.toFixed(3), infiniteMax: +infiniteMax.toFixed(3),
    flagOn, finiteSaved, infiniteSaved, pageClosed: panel.classList.contains('hidden'),
    pageErr: window.__err };
})();
// 结果读取：agent-browser eval "JSON.stringify(window.__setTest)"
```

**预期**：`finiteMax ≈ 1.1`（二段封顶）；`infiniteMax` 远大于它（十来段累加，数米）；`flagOn === true`；`finiteSaved === '0'`、`infiniteSaved === '1'`；`panelOpened === true`；`pageErr === null`。

### 5.3 手动验收步骤

1. `cd variant-z && npm run dev`，浏览器打开本地地址。
2. 右上角点 **⚙** → 打开设置，确认有「无限连跳」开关。
3. 关闭开关：地面上按一次空格起跳，空中再按一次可二段跳，**第三次按无效**。
4. 开启开关：空中可**反复按空格持续升高**。
5. 刷新页面：开关状态与行为应保持（`localStorage.langcity3jz_infinitejump`）。
6. 长按空格松开前不会自动连跳（需松手再按）。

---

## 6. 待办 / 遗留

- [ ] 无限连跳版本的运行时自动验证复测（本轮 agent-browser 会话不稳，未取到数据）。
- [ ] 可选的视觉/手感调参：无限连跳时空中段速度 `AIR_JUMP_V`、是否加跳跃上限高度等，交给用户自测拍板。
- [ ] 若后续有更多设置项，可把设置面板扩展为通用列表（当前仅一项）。
