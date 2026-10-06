// hud.js — 单词卡 / 词汇库抽屉 / 摇杆 / 白闪 / 提示（§2.8：安静、视觉重量低于世界）
import { groupByCategory, getCategory, getWord } from '../game/words.js';
import { speak } from '../game/vocab.js';

export class HUD {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.el = {
      flash: this.$('flash'),
      backdrop: this.$('card-backdrop'),
      card: this.$('word-card'),
      catBar: this.$('card-cat-bar'),
      newBadge: this.$('card-new'),
      ja: this.$('card-ja'),
      kana: this.$('card-kana'),
      romaji: this.$('card-romaji'),
      zh: this.$('card-zh'),
      speak: this.$('btn-speak'),
      closeCard: this.$('btn-close-card'),
      drawer: this.$('vocab-drawer'),
      vocabBody: this.$('vocab-body'),
      closeVocab: this.$('btn-close-vocab'),
      btnVocab: this.$('btn-vocab'),
      vocabCount: this.$('vocab-count'),
      btnShot: this.$('btn-shot'),
      btnTime: this.$('btn-time'),
      hint: this.$('hint'),
      joystick: this.$('joystick'),
      knob: this.$('joy-knob'),
    };

    this.currentWord = null;
    this.learnableIds = [];
    this.vocabDirty = true;

    this.el.closeCard.onclick = () => this.hideCard();
    this.el.backdrop.addEventListener('click', (e) => {
      if (e.target === this.el.backdrop) this.hideCard();
    });
    this.el.speak.onclick = () => {
      if (this.currentWord) speak(this.currentWord.ja);
    };
    this.el.btnVocab.onclick = () => this.toggleVocab();
    this.el.closeVocab.onclick = () => this.closeVocab();

    this._hintTimer = null;
    this._bindJoystick();
    this._bindTouchClass();
  }

  // ---------- 单词卡 ----------
  showCard(word, isNew, learnedCount) {
    this.currentWord = word;
    const cat = getCategory(word.category);
    this.el.catBar.style.background = cat.color;
    this.el.newBadge.style.display = isNew ? 'block' : 'none';
    this.el.ja.textContent = word.ja;
    this.el.kana.textContent = word.kana;
    this.el.romaji.textContent = word.romaji;
    this.el.zh.textContent = `${word.zh} · ${cat.name}${learnedCount != null ? ` · 已学 ${learnedCount} 词` : ''}`;
    this.el.backdrop.classList.remove('hidden');
    if (isNew) speak(word.ja);
  }

  hideCard() {
    this.el.backdrop.classList.add('hidden');
    this.currentWord = null;
  }

  // ---------- 词汇库 ----------
  setLearnable(ids) {
    this.learnableIds = ids;
    this.vocabDirty = true;
  }

  renderVocab(discovered) {
    const groups = groupByCategory(this.learnableIds);
    let html = '';
    for (const [cid, words] of groups) {
      const cat = getCategory(cid);
      const found = words.filter((w) => discovered.has(w.id)).length;
      const pct = Math.round((found / words.length) * 100);
      html += `<div class="vocab-cat">
        <div class="vocab-cat-head"><span>${cat.name}</span><span class="ratio">${found}/${words.length}</span></div>
        <div class="vocab-bar"><div style="width:${pct}%;background:${cat.color}"></div></div>`;
      for (const w of words) {
        const ok = discovered.has(w.id);
        html += `<div class="vocab-item ${ok ? 'found' : ''}" data-w="${ok ? w.id : ''}">
          ${ok ? '' : '<span class="new-dot" style="display:none"></span>'}
          <span>${ok ? w.ja : '？？？'}</span>
          <span class="zh">${ok ? w.zh : '未发现'}</span>
        </div>`;
      }
      html += '</div>';
    }
    this.el.vocabBody.innerHTML = html;
    this.el.vocabBody.querySelectorAll('.vocab-item.found').forEach((el) => {
      el.onclick = () => {
        const id = el.getAttribute('data-w');
        const w = id && getWord(id);
        if (w) speak(w.ja);
      };
    });
    this.vocabDirty = false;
  }

  openVocab(discovered) {
    if (this.vocabDirty) this.renderVocab(discovered);
    this.el.drawer.classList.add('open');
    this.el.drawer.classList.remove('hidden');
  }
  closeVocab() {
    this.el.drawer.classList.remove('open');
  }
  toggleVocab(discovered) {
    if (this.el.drawer.classList.contains('open')) this.closeVocab();
    else this.openVocab(discovered);
  }

  updateCount(n) {
    this.el.vocabCount.textContent = n;
  }

  // ---------- 白闪 ----------
  flash() {
    const f = this.el.flash;
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 130);
  }

  // ---------- 提示 ----------
  hint(text, ms = 2200) {
    this.el.hint.textContent = text;
    this.el.hint.classList.remove('hidden');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.el.hint.classList.add('hidden'), ms);
  }

  setTimeLabel(label) {
    this.el.btnTime.textContent = label;
  }

  // ---------- 触屏判定 + 摇杆 ----------
  _bindTouchClass() {
    if ('ontouchstart' in window) document.body.classList.add('touch');
  }

  _bindJoystick() {
    const joy = this.el.joystick, knob = this.el.knob;
    let activeId = null;
    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    joy.addEventListener('pointerdown', (e) => {
      activeId = e.pointerId;
      joy.setPointerCapture(activeId);
      this._joyMove(e);
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId === activeId) this._joyMove(e);
    });
    const end = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      setKnob(0, 0);
      this._joy = { x: 0, z: 0 };
    };
    joy.addEventListener('pointerup', end);
    joy.addEventListener('pointercancel', end);
  }

  _joyMove(e) {
    const rect = this.el.joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const max = rect.width / 2 - 20;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    this.el.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // 屏幕系→输入系：上推 = 前进（z 取反，与 W 键同向）
    this._joy = { x: dx / max, z: -dy / max };
  }

  joyState() {
    return this._joy || { x: 0, z: 0 };
  }
}
