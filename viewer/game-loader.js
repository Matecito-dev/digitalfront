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

  function totalWeight() {
    return STEPS.reduce(function (a, s) { return a + (s.weight || 1); }, 0);
  }

  function resolveSrc(src) {
    if (src.startsWith("http") || src.startsWith("/")) return src;
    var base = document.baseURI.replace(/[^/]*$/, "");
    return base + src;
  }

  function ensureLoadScreen() {
    var el = document.getElementById("game-load-screen");
    if (el) return el;
    el = document.createElement("div");
    el.id = "game-load-screen";
    el.innerHTML =
      '<div class="game-load-panel">' +
      '<h2>Preparando el frente</h2>' +
      '<p id="game-load-label">Iniciando…</p>' +
      '<div class="game-load-bar-track"><div id="game-load-bar-fill"></div></div>' +
      '<p id="game-load-pct">0%</p>' +
      "</div>";
    document.body.appendChild(el);
    return el;
  }

  function setProgress(pct, label) {
    var clamped = Math.max(0, Math.min(100, Math.round(pct)));
    var fill = document.getElementById("game-load-bar-fill");
    var pctEl = document.getElementById("game-load-pct");
    var labelEl = document.getElementById("game-load-label");
    if (fill) fill.style.width = clamped + "%";
    if (pctEl) pctEl.textContent = clamped + "%";
    if (labelEl && label) labelEl.textContent = label;
  }

  function loadScriptClassic(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-df-src="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = resolveSrc(src);
      s.async = false;
      s.dataset.dfSrc = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("No se pudo cargar " + src)); };
      document.head.appendChild(s);
    });
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
        return res.text().then(function (code) {
          return injectScript(src, code);
        });
      }
      var reader = res.body.getReader();
      var chunks = [];
      var received = 0;
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            var blob = new Blob(chunks, { type: "application/javascript" });
            return blob.text().then(function (code) {
              return injectScript(src, code);
            });
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

  function injectScript(src, code) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.dataset.dfSrc = src;
      s.text = code;
      s.onerror = function () { reject(new Error("Error al ejecutar " + src)); };
      document.head.appendChild(s);
      resolve();
    });
  }

  function reportProgress(doneWeight, stepWeight, stepFrac, label) {
    var pct = ((doneWeight + stepWeight * stepFrac) / totalWeight()) * 100;
    setProgress(pct, label);
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
  }

  function waitForGameBoot(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function tick() {
        if (window.__DF_GAME_BOOT_OK) return resolve();
        if (window.__DF_GAME_BOOT_ERR) {
          return reject(new Error(window.__DF_GAME_BOOT_ERR));
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error("Tiempo de espera agotado al iniciar el mundo."));
        }
        setTimeout(tick, 50);
      })();
    });
  }

  window.DfLoadAndStartGame = async function DfLoadAndStartGame() {
    if (window.__DF_GAME_BOOT_OK) return;
    if (loadPromise) return loadPromise;

    loadPromise = (async function () {
      var screen = ensureLoadScreen();
      screen.classList.add("visible");
      setProgress(0, "Preparando recursos…");

      try {
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
        screen.classList.remove("visible");
      } catch (err) {
        setProgress(0, err.message || "Error desconocido");
        screen.classList.add("error");
        if (typeof window.showLoginOverlay === "function") {
          window.showLoginOverlay(err.message || "No se pudo cargar el juego.");
        }
        loadPromise = null;
        throw err;
      }
    })();

    return loadPromise;
  };
})();
