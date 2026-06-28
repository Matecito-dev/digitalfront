/** Carga Phaser + game-core bajo demanda con barra de progreso real. */
(function () {
  var STEPS = [
    { src: "vendor/phaser.min.js", label: "Motor gráfico (Phaser)", weight: 2 },
    { src: "audio/sfx.js", label: "Efectos de sonido", weight: 1 },
    { src: "audio/bgm.js", label: "Música de batalla", weight: 1 },
    { src: "terrain-tactics.js", label: "Terreno y táctica", weight: 1 },
    { src: "tactical-orders.js", label: "Órdenes de escuadrón", weight: 1 },
    { src: "capacitor-init.js", label: "Adaptación al dispositivo", weight: 1 },
    { src: "game-core.js", label: "Mundo del juego", weight: 4 },
  ];

  var loadPromise = null;
  var scriptsLoaded = false;
  var stepsInitialized = false;

  function formatError(err, fallback) {
    if (!err) return fallback;
    if (typeof err === "string" && err.trim()) return err.trim();
    if (err.message && String(err.message).trim()) return String(err.message).trim();
    return fallback;
  }

  function totalWeight() {
    return STEPS.reduce(function (a, s) { return a + (s.weight || 1); }, 0);
  }

  function resolveSrc(src) {
    if (src.startsWith("http") || src.startsWith("/")) return src;
    try {
      return new URL(src, document.baseURI || location.href).href;
    } catch {
      return src;
    }
  }

  function initLoadSteps() {
    if (stepsInitialized) return;
    var list = document.getElementById("game-load-steps");
    if (!list) return;
    list.innerHTML = STEPS.map(function (step, i) {
      return (
        '<li data-step="' + i + '">' +
        '<span class="step-mark">○</span>' +
        '<span class="step-label">' + step.label + "</span>" +
        "</li>"
      );
    }).join("");
    stepsInitialized = true;
  }

  function setActiveStep(label) {
    var list = document.getElementById("game-load-steps");
    if (!list) return;
    var idx = STEPS.findIndex(function (s) { return s.label === label; });
    if (idx < 0) idx = 0;
    var items = list.querySelectorAll("li");
    for (var j = 0; j < items.length; j++) {
      var row = items[j];
      if (!row) continue;
      row.classList.remove("active", "done");
      var m = row.querySelector(".step-mark");
      if (j < idx) {
        row.classList.add("done");
        if (m) m.textContent = "✓";
      } else if (j === idx) {
        row.classList.add("active");
        if (m) m.textContent = "◉";
      } else if (m) {
        m.textContent = "○";
      }
    }
  }

  function ensureLoadScreen() {
    var el = document.getElementById("game-load-screen");
    if (!el) {
      el = document.createElement("div");
      el.id = "game-load-screen";
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-busy", "true");
      el.innerHTML =
        '<div class="load-screen-bg" aria-hidden="true"></div>' +
        '<div class="load-screen-content">' +
        '<div class="load-brand-col">' +
        '<img class="load-logo" src="./assets/dglogo.png" width="96" height="96" alt="">' +
        '<h2 class="load-title">Digital Front</h2>' +
        "</div>" +
        '<div class="load-progress-col">' +
        '<p id="game-load-label">Iniciando…</p>' +
        '<div class="load-progress-wrap">' +
        '<div class="game-load-bar-track"><div id="game-load-bar-fill"></div></div>' +
        '<span id="game-load-pct">0%</span>' +
        "</div>" +
        '<ul id="game-load-steps" class="load-steps"></ul>' +
        '<button type="button" id="game-load-retry" class="hidden">Reintentar</button>' +
        "</div>" +
        "</div>";
      document.body.appendChild(el);
      stepsInitialized = false;
    }
    initLoadSteps();
    var retry = document.getElementById("game-load-retry");
    if (retry && !retry.dataset.bound) {
      retry.dataset.bound = "1";
      retry.addEventListener("click", function () {
        retry.classList.remove("visible");
        loadPromise = null;
        void window.DfLoadAndStartGame();
      });
    }
    return el;
  }

  function hideLoadScreen() {
    var el = document.getElementById("game-load-screen");
    if (el) {
      el.classList.remove("visible", "error");
      el.setAttribute("aria-busy", "false");
    }
    document.getElementById("game-load-retry")?.classList.remove("visible");
  }

  function setProgress(pct, label) {
    var clamped = Math.max(0, Math.min(100, Math.round(pct)));
    var fill = document.getElementById("game-load-bar-fill");
    var pctEl = document.getElementById("game-load-pct");
    var labelEl = document.getElementById("game-load-label");
    if (fill) fill.style.width = clamped + "%";
    if (pctEl) pctEl.textContent = clamped + "%";
    if (labelEl && label) labelEl.textContent = label;
    if (label) setActiveStep(label);
  }

  function showSessionLoadError(message) {
    var boot = document.getElementById("login-boot-status");
    var session = document.getElementById("login-session");
    var overlay = document.getElementById("login-overlay");
    if (overlay) overlay.classList.remove("hidden");
    if (session) session.classList.remove("hidden");
    if (boot) {
      boot.style.display = "block";
      boot.textContent = message;
    }
  }

  function loadScriptFromUrl(url, srcKey) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-df-src="' + srcKey + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = url;
      s.async = false;
      s.dataset.dfSrc = srcKey;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("No se pudo cargar " + srcKey)); };
      document.head.appendChild(s);
    });
  }

  function loadScriptClassic(src) {
    return loadScriptFromUrl(resolveSrc(src), src);
  }

  function loadScriptWithProgress(src, onFraction) {
    var url = resolveSrc(src);
    if (document.querySelector('script[data-df-src="' + src + '"]')) {
      onFraction(1);
      return Promise.resolve();
    }
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " al cargar " + src);
      var len = Number(res.headers.get("content-length") || 0);
      if (!res.body || !len) {
        return res.blob().then(function (blob) {
          return runBlobScript(src, blob, function () { onFraction(1); });
        });
      }
      var reader = res.body.getReader();
      var chunks = [];
      var received = 0;
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            var blob = new Blob(chunks, { type: "application/javascript" });
            return runBlobScript(src, blob, function (frac) { onFraction(frac); });
          }
          chunks.push(result.value);
          received += result.value.length;
          onFraction(Math.min(0.99, received / len));
          return pump();
        });
      }
      return pump();
    });
  }

  function runBlobScript(srcKey, blob, onDone) {
    onDone(1);
    var blobUrl = URL.createObjectURL(blob);
    return loadScriptFromUrl(blobUrl, srcKey).then(function () {
      URL.revokeObjectURL(blobUrl);
    }).catch(function (err) {
      URL.revokeObjectURL(blobUrl);
      throw err;
    });
  }

  function reportProgress(doneWeight, stepWeight, stepFrac, label) {
    var pct = ((doneWeight + stepWeight * stepFrac) / totalWeight()) * 100;
    setProgress(pct, label);
  }

  function ensureAuthSession() {
    if (window.dfAuthToken) return true;
    var stored = window.DfAuth?.loadDfSession?.();
    if (stored?.token && stored?.profile) {
      if (typeof window.saveDfSession === "function") {
        window.saveDfSession(stored.token, stored.profile);
      } else {
        window.dfAuthToken = stored.token;
        window.dfProfile = stored.profile;
        window.DfAuth?.saveDfSession?.(stored.token, stored.profile);
      }
      return true;
    }
    return false;
  }

  async function loadAllScripts() {
    if (scriptsLoaded) return;
    var done = 0;
    for (var i = 0; i < STEPS.length; i++) {
      var step = STEPS[i];
      var w = step.weight || 1;
      reportProgress(done, w, 0, step.label);
      if (step.src === "game-core.js") {
        await loadScriptWithProgress(step.src, function (frac) {
          reportProgress(done, w, frac, step.label);
        });
      } else {
        await loadScriptClassic(step.src);
      }
      done += w;
      reportProgress(done, 0, 0, step.label);
    }
    scriptsLoaded = true;
    var list = document.getElementById("game-load-steps");
    if (list) {
      list.querySelectorAll("li").forEach(function (li) {
        li.classList.remove("active");
        li.classList.add("done");
        var mark = li.querySelector(".step-mark");
        if (mark) mark.textContent = "✓";
      });
    }
  }

  function waitForGameBoot(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function tick() {
        if (window.__DF_GAME_BOOT_OK) return resolve();
        if (window.__DF_GAME_BOOT_ERR) {
          return reject(new Error(String(window.__DF_GAME_BOOT_ERR)));
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error("Tiempo de espera agotado al iniciar el mundo."));
        }
        setTimeout(tick, 50);
      })();
    });
  }

  window.DfLoadAndStartGame = async function DfLoadAndStartGame() {
    if (window.__DF_GAME_BOOT_OK) {
      hideLoadScreen();
      return;
    }
    if (loadPromise) return loadPromise;

    loadPromise = (async function () {
      var screen = ensureLoadScreen();
      screen.classList.remove("error");
      screen.classList.add("visible");
      screen.setAttribute("aria-busy", "true");
      document.getElementById("game-load-retry")?.classList.remove("visible");
      setProgress(0, "Preparando recursos…");

      try {
        if (!ensureAuthSession()) {
          throw new Error("Sesión no encontrada. Volvé a iniciar sesión.");
        }

        if (typeof window.__dfStartGameAfterAuth !== "function") {
          await loadAllScripts();
        }

        setProgress(95, "Entrando al mapa…");
        window.__DF_GAME_BOOT_ERR = null;
        window.__DF_GAME_BOOT_OK = false;

        if (typeof window.__dfStartGameAfterAuth !== "function") {
          throw new Error("El núcleo del juego no se registró (game-core.js).");
        }

        window.__dfStartGameAfterAuth();
        await waitForGameBoot(120000);
        setProgress(100, "¡Listo!");
        hideLoadScreen();
      } catch (err) {
        var msg = formatError(err, "No se pudo cargar el juego. Recargá con Ctrl+Shift+R.");
        setProgress(0, msg);
        screen.classList.add("error");
        screen.setAttribute("aria-busy", "false");
        document.getElementById("game-load-retry")?.classList.add("visible");
        showSessionLoadError(msg);
        loadPromise = null;
        throw new Error(msg);
      }
    })();

    return loadPromise;
  };
})();
