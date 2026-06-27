/** Restaura UI de sesión OAuth antes de cargar Phaser (evita pantalla en blanco). */
(function () {
  function readPendingProfile() {
    const pendingRaw = sessionStorage.getItem("df_oauth_pending");
    if (pendingRaw) {
      try {
        const pending = JSON.parse(pendingRaw);
        if (pending?.profile) return pending.profile;
      } catch { /* ignore */ }
    }
    try {
      const stored = localStorage.getItem("df_session");
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return parsed?.profile ?? null;
    } catch {
      return null;
    }
  }

  function providerLabel(provider) {
    if (provider === "github") return "Conectado con GitHub";
    if (provider === "x") return "Conectado con X";
    if (provider === "guest") return "Jugador invitado";
    return "";
  }

  function paintAvatar(profile) {
    const img = document.getElementById("login-session-avatar");
    const fallback = document.getElementById("login-session-avatar-fallback");
    const username = profile?.username ?? profile?.captainName ?? "?";
    const initial = username.trim().charAt(0).toUpperCase() || "?";
    if (!img || !fallback) return;
    fallback.textContent = initial;
    const showFallback = () => {
      img.hidden = true;
      img.removeAttribute("src");
      fallback.hidden = false;
    };
    if (profile?.avatarUrl) {
      img.onload = () => { fallback.hidden = true; img.hidden = false; };
      img.onerror = showFallback;
      img.referrerPolicy = "no-referrer";
      img.alt = username;
      img.src = profile.avatarUrl;
      if (img.complete && img.naturalWidth > 0) {
        fallback.hidden = true;
        img.hidden = false;
      } else {
        img.hidden = false;
        fallback.hidden = true;
      }
    } else {
      showFallback();
    }
  }

  function showSessionUi(profile) {
    const overlay = document.getElementById("login-overlay");
    const auth = document.getElementById("login-auth");
    const session = document.getElementById("login-session");
    if (!overlay || !auth || !session) return false;
    const username = profile?.username ?? profile?.captainName ?? "Comandante";
    const usernameEl = document.getElementById("login-session-username");
    const providerEl = document.getElementById("login-session-provider");
    const greetingEl = document.getElementById("login-session-greeting");
    if (usernameEl) usernameEl.textContent = username;
    if (providerEl) providerEl.textContent = providerLabel(profile?.authProvider);
    if (greetingEl) greetingEl.textContent = `Hola, ${username}. Cuando estés listo, entrá al mundo.`;
    paintAvatar(profile);
    auth.classList.add("hidden");
    session.classList.remove("hidden");
    overlay.classList.remove("hidden");
    document.documentElement.classList.remove("df-await-session-ui");
    const boot = document.getElementById("login-boot-status");
    if (boot) boot.style.display = "none";
    window.__DF_EARLY_SESSION_UI = true;
    return true;
  }

  function boot() {
    const profile = readPendingProfile();
    if (profile) showSessionUi(profile);
  }

  function showEnterLoading(msg) {
    const boot = document.getElementById("login-boot-status");
    const btn = document.getElementById("login-enter-world");
    if (boot) {
      boot.style.display = "block";
      boot.textContent = msg;
    }
    if (btn) btn.disabled = true;
  }

  function hideEnterLoading() {
    const btn = document.getElementById("login-enter-world");
    if (btn) btn.disabled = false;
  }

  function waitUntil(test, maxMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        if (test()) return resolve();
        if (Date.now() - start > maxMs) return reject(new Error("timeout"));
        setTimeout(tick, 100);
      })();
    });
  }

  async function tryEnterWorld() {
    showEnterLoading("Cargando motor del juego…");
    try {
      if (typeof window.startGameAfterAuth !== "function") {
        await waitUntil(() => typeof window.startGameAfterAuth === "function", 15000);
      }
      window.startGameAfterAuth();
      if (window.__DF_ENTER_WORLD_QUEUED) {
        await waitUntil(() => typeof window.__dfStartGameAfterAuth === "function", 120000);
        window.__DF_ENTER_WORLD_QUEUED = false;
        window.__dfStartGameAfterAuth();
      }
      await waitUntil(
        () => document.getElementById("login-overlay")?.classList.contains("hidden"),
        120000,
      );
      const boot = document.getElementById("login-boot-status");
      if (boot) boot.style.display = "none";
    } catch {
      showEnterLoading("No se pudo cargar el juego. Recargá con Ctrl+Shift+R.");
    } finally {
      hideEnterLoading();
    }
  }

  function tryLogout() {
    if (typeof window.logoutSession === "function") {
      window.logoutSession();
      return;
    }
    localStorage.removeItem("df_session");
    sessionStorage.removeItem("df_oauth_pending");
    sessionStorage.removeItem("df_oauth_fresh");
    location.reload();
  }

  document.addEventListener("click", (e) => {
    const id = e.target?.id;
    if (id === "login-enter-world") {
      e.preventDefault();
      void tryEnterWorld();
    } else if (id === "login-logout") {
      e.preventDefault();
      tryLogout();
    }
  });

  window.DfEnterWorld = tryEnterWorld;
  window.DfLogout = tryLogout;

  boot();
})();
