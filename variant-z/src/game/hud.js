// HUD：单词卡、词汇库抽屉、发音、时刻切换、快门音
import { wordById, categoryById, discovered, discover, progressByCategory, totalProgress, allWords } from './words.js';

let audioCtx = null;
function shutterSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    const buf = audioCtx.createBuffer(1, 2200, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const g = audioCtx.createGain(); g.gain.value = 0.25;
    src.connect(g).connect(audioCtx.destination);
    src.start(t0);
    src.start(t0 + 0.07);
  } catch { /* 无声也行 */ }
}

export function speak(text) {
  if (!text || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.9;
    const voices = speechSynthesis.getVoices();
    const ja = voices.find(v => v.lang && v.lang.startsWith('ja'));
    if (ja) u.voice = ja;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

export class Hud {
  constructor({ onShoot, onPhase }) {
    this.card = document.getElementById('word-card');
    this.el = {
      cat: document.getElementById('card-category'),
      ja: document.getElementById('card-ja'),
      kana: document.getElementById('card-kana'),
      romaji: document.getElementById('card-romaji'),
      zh: document.getElementById('card-zh'),
      isNew: document.getElementById('card-new'),
      speak: document.getElementById('card-speak'),
      close: document.getElementById('card-close'),
    };
    this.drawer = document.getElementById('vocab-drawer');
    this.chip = document.getElementById('discovered-chip');
    this.flashEl = document.getElementById('flash');
    this.current = null;

    document.getElementById('photo-btn').addEventListener('click', () => onShoot());
    this.el.close.addEventListener('click', () => this.closeCard());
    this.el.speak.addEventListener('click', () => this.current && speak(this.current.kana || this.current.ja));
    document.getElementById('vocab-btn').addEventListener('click', () => this.openVocab());
    document.getElementById('vocab-close').addEventListener('click', () => this.drawer.classList.add('hidden'));
    document.querySelectorAll('#time-switch button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#time-switch button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        onPhase(b.dataset.phase);
      });
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF') onShoot();
      if (e.code === 'Escape') { this.closeCard(); this.drawer.classList.add('hidden'); }
    });
    this.refreshChip();
  }

  refreshChip() {
    const p = totalProgress();
    this.chip.textContent = `已发现 ${p.found} / ${p.total}`;
  }

  openCard(meta) {
    const w = wordById(meta.word);
    if (!w) return;
    this.current = w;
    const isNew = !discovered.has(w.id);
    if (isNew) { discover(w.id); this.refreshChip(); }
    const cat = categoryById(w.category);
    this.el.cat.textContent = cat ? cat.name : '';
    this.el.cat.style.background = cat ? cat.color : '#c94f4f';
    this.el.ja.textContent = w.ja;
    this.el.kana.textContent = w.kana;
    this.el.romaji.textContent = w.romaji;
    this.el.zh.textContent = w.zh;
    this.el.isNew.classList.toggle('hidden', !isNew);
    this.card.classList.remove('hidden');
    shutterSound();
    setTimeout(() => speak(w.kana || w.ja), 350);
  }

  closeCard() { this.card.classList.add('hidden'); }

  flash() {
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  openVocab() {
    const prog = document.getElementById('vocab-progress');
    const list = document.getElementById('vocab-list');
    prog.innerHTML = '';
    for (const [, e] of progressByCategory()) {
      if (e.total === 0) continue;
      const row = document.createElement('div');
      row.className = 'vp-row';
      row.innerHTML = `
        <span class="vp-name">${e.cat.name}</span>
        <div class="vp-bar"><div class="vp-fill" style="width:${(e.found / e.total * 100).toFixed(0)}%;background:${e.cat.color}"></div></div>
        <span class="vp-num">${e.found}/${e.total}</span>`;
      prog.appendChild(row);
    }
    list.innerHTML = '';
    for (const w of allWordsSorted()) {
      const found = discovered.has(w.id);
      const row = document.createElement('div');
      row.className = 'vw-row' + (found ? '' : ' undiscovered');
      row.innerHTML = `
        <span class="vw-ja">${found ? w.ja : '？？？'}</span>
        <span class="vw-zh">${found ? `${w.kana} ・ ${w.zh}` : '未发现'}</span>
        ${found ? '<span class="vw-new">🔊</span>' : ''}`;
      if (found) row.addEventListener('click', () => speak(w.kana || w.ja));
      list.appendChild(row);
    }
    this.drawer.classList.remove('hidden');
  }
}

function allWordsSorted() {
  return allWords().slice().sort((a, b) => (discovered.has(b.id) ? 1 : 0) - (discovered.has(a.id) ? 1 : 0));
}
