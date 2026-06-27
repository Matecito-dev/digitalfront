/** Procedural SFX via Web Audio — sin archivos externos. */
(function () {
  const MUTE_KEY = 'df_sfx_muted';
  let ctx = null;
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function resume() {
    const c = ensureCtx();
    if (c?.state === 'suspended') void c.resume();
  }

  function playTone(freq, dur, type, gain, when) {
    if (muted || document.hidden) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = when ?? c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function playNoise(dur, gain) {
    if (muted || document.hidden) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const bufferSize = Math.floor(c.sampleRate * dur);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g);
    g.connect(c.destination);
    src.start(t0);
  }

  window.DigitalFrontSfx = {
    init() { resume(); },
    isMuted() { return muted; },
    setMuted(v) {
      muted = !!v;
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      document.getElementById('btn-sfx-mute')?.classList.toggle('muted', muted);
    },
    toggleMuted() {
      this.setMuted(!muted);
      return muted;
    },
    play(name) {
      resume();
      switch (name) {
        case 'shot':
          playNoise(0.06, 0.08);
          playTone(880, 0.04, 'square', 0.04);
          break;
        case 'impact':
          playTone(120, 0.12, 'sine', 0.12);
          playNoise(0.05, 0.06);
          break;
        case 'alert':
          playTone(660, 0.1, 'triangle', 0.07);
          playTone(880, 0.12, 'triangle', 0.06, ensureCtx().currentTime + 0.12);
          break;
        case 'ui':
          playTone(520, 0.05, 'sine', 0.04);
          break;
        case 'frenzy':
          playTone(440, 0.08, 'sawtooth', 0.05);
          playTone(660, 0.1, 'sawtooth', 0.05, ensureCtx().currentTime + 0.08);
          playTone(880, 0.14, 'sawtooth', 0.04, ensureCtx().currentTime + 0.16);
          break;
        case 'boss':
          playTone(220, 0.2, 'triangle', 0.1);
          playTone(330, 0.25, 'triangle', 0.08, ensureCtx().currentTime + 0.15);
          break;
        default:
          break;
      }
    },
  };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resume();
  });
  ['click', 'touchstart', 'keydown'].forEach(ev => {
    document.addEventListener(ev, () => resume(), { once: true, passive: true });
  });
})();
