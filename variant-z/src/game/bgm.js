// 安静背景音乐：WebAudio 程序化生成（零音频资源、无版权负担）
// 曲风：70 BPM 八音盒/竖琴式分解和弦 + 软贝斯 + 稀疏风铃旋律，Cmaj7-Am7-Fmaj7-G
// 浏览器自动播放策略：首次用户手势（点击/按键）才启动；♪ 按钮随时开关

const BPM = 70;
const STEP = 60 / BPM / 2;   // 8 分音符步长（秒）
const STEPS_PER_BAR = 8;
const BARS = 4;              // 4 小节循环

// 和弦进行：Cmaj7 / Am7 / Fmaj7 / G（MIDI 音高）
const CHORDS = [
  { root: 48, notes: [60, 64, 67, 71] }, // Cmaj7: C4 E4 G4 B4
  { root: 45, notes: [57, 60, 64, 67] }, // Am7  : A3 C4 E4 G4
  { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7: F3 A3 C4 E4
  { root: 43, notes: [55, 59, 62, 67] }, // G    : G3 B3 D4 G4
];

// 旋律：32 步（4 小节）稀疏乐句，音少留白多；null = 休止
const MELODY = [
  76, null, null, null, 74, null, 72, null,     // E5 - D5 - C5
  69, null, null, null, null, null, 72, null,   // A4 —— C5
  74, null, null, null, 72, null, 69, null,     // D5 - C5 - A4
  67, null, null, null, null, null, null, null, // G4 长留白收尾
];

const midi2hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

let ctx = null, master = null, delaySend = null;
let timer = null, nextTime = 0, step = 0;
let started = false, muted = false, loopCount = 0;

// ---------- 合成器 ----------

/** 竖琴拨音：三角波 + 低通 + 柔和长衰减 */
function pluck(midi, t, vel = 0.25, pan = 0) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = midi2hz(midi);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(600, t + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  o.connect(f).connect(g).connect(p);
  p.connect(master);
  p.connect(delaySend);
  o.start(t); o.stop(t + 1.0);
}

/** 软贝斯：正弦 + 一点二次谐波，绵长圆润 */
function bass(midi, t, vel = 0.32) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = midi2hz(midi);
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = midi2hz(midi);
  const g2 = ctx.createGain(); g2.gain.value = 0.12;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
  o.connect(g); o2.connect(g2).connect(g);
  g.connect(master);
  o.start(t); o.stop(t + 1.4);
  o2.start(t); o2.stop(t + 1.4);
}

/** 风铃/马林巴旋律音：正弦 + 泛音，带余韵 */
function bell(midi, t, vel = 0.16) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  const p = ctx.createStereoPanner(); p.pan.value = -0.25;
  g.connect(p);
  p.connect(master); p.connect(delaySend);
  for (const [mult, amp] of [[1, 1], [2, 0.35], [4, 0.08]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midi2hz(midi) * mult;
    const og = ctx.createGain(); og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t); o.stop(t + 1.2);
  }
}

// ---------- 编曲调度 ----------

function scheduleStep(s, t) {
  const bar = Math.floor(s / STEPS_PER_BAR) % BARS;
  const beat = s % STEPS_PER_BAR;
  const ch = CHORDS[bar];

  // 贝斯：每小节两下，根音 + 五音，很轻
  if (beat === 0) bass(ch.root, t, 0.3);
  if (beat === 4) bass(ch.root + 7, t, 0.2);

  // 竖琴式分解和弦：一步一音，缓缓上-下摆动，无打击乐
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  pluck(ch.notes[ARP[beat]], t, beat === 0 ? 0.22 : 0.14, (ARP[beat] - 1.5) * 0.08);

  // 旋律：偶数循环整句、奇数循环随机省 1 个音做变化
  const mIdx = s % (BARS * STEPS_PER_BAR);
  let note = MELODY[mIdx];
  if (note != null && loopCount % 2 === 1 && Math.random() < 0.22) note = null;
  if (note != null) bell(note, t, beat === 0 ? 0.13 : 0.1);

  // 每句结尾偶尔加个上行装饰音
  if (mIdx === 30 && loopCount % 4 === 3) bell(MELODY[31] ? 79 : 81, t + STEP, 0.08);
}

function tick() {
  if (!ctx || document.hidden) return; // 页面隐藏时暂停调度
  const ahead = ctx.currentTime + 0.18;
  while (nextTime < ahead) {
    scheduleStep(step, nextTime);
    nextTime += STEP;
    step++;
    if (step % (BARS * STEPS_PER_BAR) === 0) loopCount++;
  }
}

// ---------- 开关与初始化 ----------

function startAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  // 点缀回声：附点 8 分延迟（轻，营造梦幻感）
  delaySend = ctx.createGain(); delaySend.gain.value = 0.13;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = STEP * 1.5;
  const fb = ctx.createGain(); fb.gain.value = 0.24;
  const wet = ctx.createGain(); wet.gain.value = 0.9;
  delaySend.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(master);
  nextTime = ctx.currentTime + 0.1;
  step = 0;
  timer = setInterval(tick, 60);
  // 淡入
  master.gain.linearRampToValueAtTime(muted ? 0 : 0.45, ctx.currentTime + 2.2);
}

export function setMuted(m) {
  muted = m;
  localStorage.setItem('langcity3jz_bgm', m ? 'off' : 'on');
  const btn = document.getElementById('bgm-btn');
  if (btn) {
    btn.classList.toggle('muted', m);
    btn.title = m ? '开启音乐' : '关闭音乐';
  }
  if (ctx && master) master.gain.linearRampToValueAtTime(m ? 0 : 0.45, ctx.currentTime + 0.4);
}

export function initBGM() {
  const btn = document.getElementById('bgm-btn');
  if (!btn) return;
  muted = localStorage.getItem('langcity3jz_bgm') === 'off';
  btn.classList.toggle('muted', muted);
  btn.title = muted ? '开启音乐' : '关闭音乐';

  btn.addEventListener('click', () => {
    if (!started) { started = true; startAudio(); setMuted(!muted); return; } // 首次点按钮 = 直接开始
    setMuted(!muted);
  });

  // 首次任意手势自动开播（用户明确关掉过则不自动开）
  const autoStart = () => {
    if (started) return;
    started = true;
    startAudio();
    if (muted) setMuted(true);
  };
  window.addEventListener('pointerdown', autoStart, { once: true });
  window.addEventListener('keydown', autoStart, { once: true });

  // 标签页隐藏→挂起，回来→恢复（并快进调度点，避免补爆发音）
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else {
      if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.1;
      ctx.resume();
    }
  });
}
