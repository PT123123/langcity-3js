// vocab.js — 发现状态 + localStorage 存档（§1 玩法：已发现单词 id 集合 + 玩家位置）
const KEY = 'langcity3d_save_v1';

export const vocab = {
  discovered: new Set(),

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (Array.isArray(d.words)) this.discovered = new Set(d.words);
      return d;
    } catch {
      return null;
    }
  },

  save(player, todIndex) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        words: [...this.discovered],
        player: player ? player.getState() : undefined,
        tod: todIndex,
        t: Date.now(),
      }));
    } catch { /* 隐私模式等场景静默失败 */ }
  },

  /** 返回是否首次发现 */
  discover(id) {
    const isNew = !this.discovered.has(id);
    this.discovered.add(id);
    return isNew;
  },

  count() {
    return this.discovered.size;
  },
};

// ---------- 发音（Web Speech API，ja-JP，不可用则静默跳过） ----------
let voiceJa = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  voiceJa = voices.find((v) => v.lang === 'ja-JP')
    || voices.find((v) => v.lang && v.lang.startsWith('ja'))
    || null;
  return voiceJa;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (voiceJa || pickVoice()) u.voice = voiceJa;
    u.rate = 0.85;
    speechSynthesis.speak(u);
  } catch { /* 静默 */ }
}

// ---------- 快门音（WebAudio：短白噪 + click 包络） ----------
let actx = null;
export function shutterSound() {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = actx;
    if (ctx.state === 'suspended') ctx.resume();

    const dur = 0.09;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(g).connect(ctx.destination);
    src.start();

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.frequency.setValueAtTime(2600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.05);
    og.gain.setValueAtTime(0.18, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(og).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  } catch { /* 无音频环境静默 */ }
}
