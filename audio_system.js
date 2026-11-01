// ============================================================================
// 全域音效管理器（非破壞性新增）
// 使用 WebAudio 即時合成，不需外部音檔；所有音效由 Hook 觸發。
// ============================================================================
export const SoundManager = (() => {
  let ctx = null;
  let master = null;
  let volume = 0.55;
  let muted = false;
  let unlocked = false;
  const media = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem('party-audio-v1') || '{}');
    if (typeof saved.volume === 'number') volume = Math.max(0, Math.min(1, saved.volume));
    muted = Boolean(saved.muted);
  } catch { }

  function ensure() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    return ctx;
  }

  function save() {
    try { localStorage.setItem('party-audio-v1', JSON.stringify({ volume, muted })); } catch { }
    if (master) master.gain.value = muted ? 0 : volume;
    for (const rec of media.values()) {
      try { rec.el.volume = muted ? 0 : Math.max(0, Math.min(1, volume * (rec.gain || 1))); } catch { }
    }
    const el = document.querySelector('#volume-slider');
    if (el) el.value = String(Math.round(volume * 100));
    const btn = document.querySelector('#mute-btn');
    if (btn) { btn.textContent = muted ? '🔇' : '🔊'; btn.title = muted ? '取消靜音' : '一鍵靜音'; }
  }

  function playMedia(name, src, { gain = 1 } = {}) {
    if (muted) return;
    try {
      let rec = media.get(name);
      if (!rec) {
        const el = new Audio(src);
        el.preload = 'auto';
        rec = { el, gain };
        media.set(name, rec);
      }
      rec.el.pause();
      rec.el.currentTime = 0;
      rec.el.volume = Math.max(0, Math.min(1, volume * gain));
      const task = rec.el.play();
      if (task?.catch) task.catch(() => { });
    } catch { }
  }

  function tone({ freq = 440, endFreq = freq, dur = 0.12, type = 'sine', gain = 0.15, delay = 0, sweep = false }) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (sweep || endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  function noise({ dur = 0.25, gain = 0.12, delay = 0, lowpass = 1200 }) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = lowpass;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start(t0);
  }

  const sounds = {
    click() { tone({ freq: 520, endFreq: 640, dur: 0.05, type: 'triangle', gain: 0.08 }); },
    hover() { tone({ freq: 720, dur: 0.035, type: 'sine', gain: 0.035 }); },
    dice() { for (let i = 0; i < 7; i++) tone({ freq: 220 + Math.random() * 300, dur: 0.055, type: 'square', gain: 0.045, delay: i * 0.07 }); },
    move() { tone({ freq: 380, endFreq: 520, dur: 0.09, type: 'triangle', gain: 0.07 }); },
    coin() { tone({ freq: 880, dur: 0.08, type: 'triangle', gain: 0.1 }); tone({ freq: 1320, dur: 0.12, type: 'triangle', gain: 0.08, delay: 0.07 }); },
    marketBull() { [880, 1100, 1320].forEach((freq, i) => tone({ freq, dur: 0.16, type: 'sine', gain: 0.09, delay: i * 0.07 })); },
    marketStable() { tone({ freq: 560, dur: 0.2, type: 'triangle', gain: 0.08 }); tone({ freq: 700, dur: 0.18, type: 'triangle', gain: 0.06, delay: 0.11 }); },
    marketPonzi() { [360, 280, 190].forEach((freq, i) => tone({ freq, endFreq: freq * 0.82, dur: 0.22, type: 'triangle', gain: 0.09, delay: i * 0.08, sweep: true })); },
    cashGain() { [720, 980, 1240, 1560].forEach((f, i) => tone({ freq: f, dur: 0.13, type: 'triangle', gain: 0.08, delay: i * 0.055 })); },
    cashLoss() { [620, 470, 340, 240].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'sawtooth', gain: 0.055, delay: i * 0.07, sweep: true, endFreq: f * .72 })); noise({ dur: 0.32, gain: 0.03, lowpass: 900 }); },
    magic() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, endFreq: f * 1.02, dur: 0.3, type: 'sine', gain: 0.075, delay: i * 0.045 })); tone({ freq: 1760, dur: 0.5, type: 'sine', gain: 0.035, delay: 0.18 }); noise({ dur: 0.35, gain: 0.025, lowpass: 5200 }); },
    domain() { tone({ freq: 92, endFreq: 68, dur: 0.7, type: 'sawtooth', gain: 0.12, sweep: true }); tone({ freq: 430, endFreq: 260, dur: 0.5, type: 'triangle', gain: 0.07, delay: 0.05, sweep: true }); noise({ dur: 0.45, gain: 0.06, lowpass: 1600 }); },
    witch() { playMedia('witch-factor', new URL('./witch_factor.mp3', document.baseURI).href, { gain: 1 }); tone({ freq: 300, endFreq: 110, dur: 0.9, type: 'sine', gain: 0.1, sweep: true }); noise({ dur: 0.8, gain: 0.05, lowpass: 900 }); },
    endingStar() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone({ freq: f, dur: 0.45, type: 'triangle', gain: 0.1, delay: i * 0.12 })); noise({ dur: 1.2, gain: 0.02, lowpass: 7000 }); },
    endingTycoon() { [262, 330, 392, 523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.4, type: 'square', gain: 0.06, delay: i * 0.1 })); for (let i = 0; i < 8; i++) tone({ freq: 1200 + (i % 3) * 260, dur: 0.1, type: 'triangle', gain: 0.045, delay: 0.35 + i * 0.07 }); },
    star() { [660, 880, 1100, 1320].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'sine', gain: 0.1, delay: i * 0.08 })); },
    ghost() { tone({ freq: 310, endFreq: 90, dur: 0.65, type: 'sine', gain: 0.12, sweep: true }); noise({ dur: 0.5, gain: 0.05, lowpass: 700 }); },
    doom() { tone({ freq: 55, endFreq: 30, dur: 1.4, type: 'sawtooth', gain: 0.18, sweep: true }); noise({ dur: 1.2, gain: 0.1, lowpass: 500 }); },
    laser() { tone({ freq: 1400, endFreq: 80, dur: 1.0, type: 'sawtooth', gain: 0.15, sweep: true }); noise({ dur: 0.8, gain: 0.1, lowpass: 2400 }); },
    explosion() { noise({ dur: 0.9, gain: 0.28, lowpass: 900 }); tone({ freq: 95, endFreq: 28, dur: 0.8, type: 'square', gain: 0.16, sweep: true }); },
    inflation() { for (let i = 0; i < 5; i++) tone({ freq: 420 + i * 110, dur: 0.22, type: 'square', gain: 0.11, delay: i * 0.18 }); },
    alarm() { for (let i = 0; i < 6; i++) tone({ freq: i % 2 ? 620 : 880, dur: 0.16, type: 'square', gain: 0.09, delay: i * 0.2 }); },
    whoosh() { noise({ dur: 0.45, gain: 0.1, lowpass: 1800 }); tone({ freq: 180, endFreq: 700, dur: 0.4, type: 'sine', gain: 0.05, sweep: true }); },
    wheel() { for (let i = 0; i < 16; i++) tone({ freq: 500 + (i % 4) * 70, dur: 0.05, type: 'triangle', gain: 0.05, delay: i * 0.09 }); },
    freeze() { tone({ freq: 1600, endFreq: 2100, dur: 0.4, type: 'sine', gain: 0.08, sweep: true }); noise({ dur: 0.35, gain: 0.04, lowpass: 4000 }); },
    frozen() { playMedia('frozen', new URL('./frozen.mp3', document.baseURI).href, { gain: 1 }); },
    // 矢量傳送與幽靈專屬音效原本偏大，統一壓到約 45%，避免突然爆音。
    swing() { playMedia('swing', new URL('./swing.mp3', document.baseURI).href, { gain: .45 }); },
    totem() { playMedia('totem', new URL('./minecraft-totem-sound.mp3', document.baseURI).href, { gain: 1 }); },
    ghostLaugh() { playMedia('king-boos-laugh', new URL('./king-boos-laugh.mp3', document.baseURI).href, { gain: .45 }); },
    cuff() {
      // 金屬鎖銬扣上：短促高頻金屬聲 + 兩段機械卡榫。
      noise({ dur: 0.08, gain: 0.16, lowpass: 5600 });
      tone({ freq: 2100, endFreq: 1250, dur: 0.07, type: 'square', gain: 0.1, sweep: true });
      tone({ freq: 950, endFreq: 620, dur: 0.09, type: 'triangle', gain: 0.08, delay: 0.055, sweep: true });
      noise({ dur: 0.1, gain: 0.12, lowpass: 3200, delay: 0.1 });
      tone({ freq: 480, endFreq: 340, dur: 0.08, type: 'square', gain: 0.06, delay: 0.11, sweep: true });
    },
    paper() { noise({ dur: 0.36, gain: 0.12, lowpass: 3600 }); noise({ dur: 0.18, gain: 0.08, lowpass: 5200, delay: 0.09 }); tone({ freq: 240, endFreq: 170, dur: 0.22, type: 'triangle', gain: 0.04, sweep: true }); },
    bankai() { noise({ dur: 0.7, gain: 0.16, lowpass: 2600 }); tone({ freq: 70, endFreq: 42, dur: 0.9, type: 'sawtooth', gain: 0.14, sweep: true }); tone({ freq: 1200, endFreq: 180, dur: 0.35, type: 'sawtooth', gain: 0.1, sweep: true, delay: 0.12 }); },
    lightning() { noise({ dur: 0.22, gain: 0.2, lowpass: 5000 }); tone({ freq: 1900, endFreq: 140, dur: 0.25, type: 'sawtooth', gain: 0.12, sweep: true }); },
    victory() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.12, delay: i * 0.16 })); },
    error() { tone({ freq: 220, endFreq: 160, dur: 0.2, type: 'square', gain: 0.08, sweep: true }); },
    slide() { tone({ freq: 300, endFreq: 900, dur: 0.35, type: 'sine', gain: 0.06, sweep: true }); }
  };

  function play(name) {
    ensure();
    const fn = sounds[name];
    if (!fn) return;
    try { fn(); } catch { }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ensure();
  }

  function injectControls() {
    const actions = document.querySelector('.top-actions');
    if (!actions || document.querySelector('#volume-slider')) return;
    const wrap = document.createElement('span');
    wrap.className = 'audio-controls';
    wrap.innerHTML = `<button id="mute-btn" class="quiet audio-btn" type="button" title="一鍵靜音">${muted ? '🔇' : '🔊'}</button><input id="volume-slider" class="volume-slider" type="range" min="0" max="100" value="${Math.round(volume * 100)}" aria-label="音量">`;
    actions.prepend(wrap);
    wrap.querySelector('#mute-btn').addEventListener('click', () => { muted = !muted; save(); play('click'); });
    wrap.querySelector('#volume-slider').addEventListener('input', e => { volume = Number(e.target.value) / 100; if (volume > 0) muted = false; save(); });
    wrap.querySelector('#volume-slider').addEventListener('change', () => play('click'));
    save();
  }

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('click', e => {
    if (e.target.closest('button, [data-item-id], [data-tile-index], .tab, .lobby-role')) play('click');
  }, true);
  document.addEventListener('DOMContentLoaded', injectControls);
  if (document.readyState !== 'loading') setTimeout(injectControls, 0);

  return {
    play, unlock, injectControls,
    get volume() { return volume; },
    get muted() { return muted; },
    setVolume(v) { volume = Math.max(0, Math.min(1, Number(v))); save(); },
    toggleMute() { muted = !muted; save(); return muted; }
  };
})();

globalThis.SoundManager = SoundManager;
