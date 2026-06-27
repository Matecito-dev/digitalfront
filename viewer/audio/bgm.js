/** Música de fondo — menú + partida (procedural + opcional menu-bgm.mp3) */
(function () {
  const BGM_KEY = 'df_bgm_muted';
  let ctx = null;
  let muted = localStorage.getItem(BGM_KEY) === '1';
  let loopNodes = null;
  let fileEl = null;
  let usingFile = false;
  let mode = 'off'; // 'menu' | 'game' | 'off'

  const VOL = { menu: { file: 0.35, proc: 0.08 }, game: { file: 0.14, proc: 0.035 } };

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

  function stopProcedural() {
    if (!loopNodes) return;
    try {
      loopNodes.forEach(n => { try { n.stop?.(); n.disconnect?.(); } catch {} });
    } catch {}
    loopNodes = null;
  }

  function startProcedural(vol) {
    if (muted || usingFile) return;
    const c = ensureCtx();
    if (!c) return;
    stopProcedural();
    const t0 = c.currentTime + 0.05;
    const master = c.createGain();
    master.gain.value = vol;
    master.connect(c.destination);

    const osc1 = c.createOscillator();
    const g1 = c.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(55, t0);
    g1.gain.setValueAtTime(0.35, t0);
    osc1.connect(g1);
    g1.connect(master);
    osc1.start(t0);

    const osc2 = c.createOscillator();
    const g2 = c.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(110, t0);
    g2.gain.setValueAtTime(0.12, t0);
    osc2.connect(g2);
    g2.connect(master);
    osc2.start(t0);

    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    lfo.frequency.value = 0.08;
    lfoG.gain.value = 8;
    lfo.connect(lfoG);
    lfoG.connect(osc2.frequency);
    lfo.start(t0);

    loopNodes = [osc1, osc2, lfo, master, g1, g2, lfoG];
  }

  function tryFileBgm() {
    fileEl = new Audio('./audio/menu-bgm.mp3');
    fileEl.loop = true;
    fileEl.preload = 'auto';
    fileEl.addEventListener('canplaythrough', () => { usingFile = true; }, { once: true });
    fileEl.addEventListener('error', () => { usingFile = false; }, { once: true });
    fileEl.load();
  }

  function playCurrent() {
    resume();
    if (muted || mode === 'off') return;
    const v = VOL[mode] ?? VOL.game;
    if (usingFile && fileEl) {
      stopProcedural();
      fileEl.volume = v.file;
      fileEl.play().catch(() => { usingFile = false; startProcedural(v.proc); });
    } else {
      if (fileEl && !fileEl.paused) { fileEl.pause(); }
      startProcedural(v.proc);
    }
  }

  window.DigitalFrontBgm = {
    init() { resume(); tryFileBgm(); },
    playMenu() { mode = 'menu'; playCurrent(); },
    playGame() { mode = 'game'; playCurrent(); },
    stopMenu() { mode = 'off'; stopProcedural(); if (fileEl) { fileEl.pause(); fileEl.currentTime = 0; } },
    isMuted() { return muted; },
    setMuted(v) {
      muted = !!v;
      localStorage.setItem(BGM_KEY, muted ? '1' : '0');
      if (muted) {
        stopProcedural();
        if (fileEl) { fileEl.pause(); fileEl.currentTime = 0; }
      } else if (mode !== 'off') playCurrent();
    },
    toggleMuted() {
      this.setMuted(!muted);
      return muted;
    },
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopProcedural();
      if (fileEl) fileEl.pause();
    } else if (mode !== 'off') {
      playCurrent();
    }
  });
})();
