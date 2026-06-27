/** Login / sesión sin Phaser — corre al cargar la página. */
(function () {
  window.dfAuthToken = window.dfAuthToken ?? null;
  window.dfProfile = window.dfProfile ?? null;
  window.gameStarted = window.gameStarted ?? false;

  var AUTH_PROVIDER_LABELS = {
    github: "Conectado con GitHub",
    x: "Conectado con X",
    guest: "Jugador invitado",
  };

  function applyLoginVersionInfo() {
    window.paintVersionInfo?.();
  }

  function updateCaptainHud() {
    var el = document.getElementById("captain-lbl");
    if (!el) return;
    var name = window.dfProfile?.captainName ?? window.dfProfile?.username ?? "—";
    el.replaceChildren();
    var avatarUrl = window.dfProfile?.avatarUrl;
    if (avatarUrl) {
      var img = document.createElement("img");
      img.id = "captain-avatar";
      img.src = avatarUrl;
      img.alt = "";
      img.width = 20;
      img.height = 20;
      img.referrerPolicy = "no-referrer";
      el.appendChild(img);
    }
    el.append("Capitán: " + name);
  }

  function saveDfSession(token, profile) {
    window.dfAuthToken = token;
    window.dfProfile = profile;
    window.DfAuth?.saveDfSession(token, profile);
    updateCaptainHud();
  }
  window.saveDfSession = saveDfSession;

  function ensureLoginUiVisible() {
    var overlay = document.getElementById("login-overlay");
    var auth = document.getElementById("login-auth");
    var session = document.getElementById("login-session");
    overlay?.classList.remove("hidden");
    if (auth?.classList.contains("hidden") && session?.classList.contains("hidden")) {
      auth.classList.remove("hidden");
    }
  }

  function showLoginOverlay(message) {
    var overlay = document.getElementById("login-overlay");
    var err = document.getElementById("login-error");
    document.getElementById("login-auth")?.classList.remove("hidden");
    document.getElementById("login-session")?.classList.add("hidden");
    if (overlay) overlay.classList.remove("hidden");
    document.documentElement.classList.remove("df-await-session-ui");
    var boot = document.getElementById("login-boot-status");
    if (boot) boot.style.display = "none";
    if (err) err.textContent = message ?? "";
    var status = document.getElementById("status");
    if (status) status.textContent = "Identifícate para entrar al batallón";
    applyLoginVersionInfo();
    window.DigitalFrontBgm?.init?.();
    window.DigitalFrontBgm?.playMenu?.();
    void window.DfAuth?.refreshOAuthButtons?.();
  }
  window.showLoginOverlay = showLoginOverlay;

  function paintSessionAvatar(profile) {
    var img = document.getElementById("login-session-avatar");
    var fallback = document.getElementById("login-session-avatar-fallback");
    var username = profile?.username ?? profile?.captainName ?? "?";
    var initial = username.trim().charAt(0).toUpperCase() || "?";
    if (!img || !fallback) return;
    fallback.textContent = initial;
    var showFallback = function () {
      img.hidden = true;
      img.removeAttribute("src");
      fallback.hidden = false;
    };
    if (profile?.avatarUrl) {
      img.onload = function () { fallback.hidden = true; img.hidden = false; };
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

  function showSessionPanel(profile) {
    if (window.__DF_EARLY_SESSION_UI) {
      window.dfAuthToken = window.DfAuth?.loadDfSession?.()?.token ?? window.dfAuthToken;
      window.dfProfile = profile;
      updateCaptainHud();
      return;
    }
    var overlay = document.getElementById("login-overlay");
    document.getElementById("login-auth")?.classList.add("hidden");
    document.getElementById("login-session")?.classList.remove("hidden");
    if (overlay) overlay.classList.remove("hidden");
    document.documentElement.classList.remove("df-await-session-ui");
    var boot = document.getElementById("login-boot-status");
    if (boot) boot.style.display = "none";
    var username = profile?.username ?? profile?.captainName ?? "Comandante";
    var usernameEl = document.getElementById("login-session-username");
    var providerEl = document.getElementById("login-session-provider");
    var greetingEl = document.getElementById("login-session-greeting");
    if (usernameEl) usernameEl.textContent = username;
    if (providerEl) providerEl.textContent = AUTH_PROVIDER_LABELS[profile?.authProvider] ?? "";
    if (greetingEl) greetingEl.textContent = "Hola, " + username + ". Cuando estés listo, entrá al mundo.";
    paintSessionAvatar(profile);
    var status = document.getElementById("status");
    if (status) status.textContent = "Sesión activa";
    applyLoginVersionInfo();
    window.DigitalFrontBgm?.init?.();
    window.DigitalFrontBgm?.playMenu?.();
  }
  window.showSessionPanel = showSessionPanel;

  function logoutSession() {
    window.DfAuth?.clearDfSession();
    window.dfAuthToken = null;
    window.dfProfile = null;
    sessionStorage.removeItem("df_oauth_fresh");
    sessionStorage.removeItem("df_oauth_pending");
    if (window.gameStarted) {
      location.reload();
      return;
    }
    showLoginOverlay();
  }
  window.logoutSession = logoutSession;

  function hideLoginOverlay() {
    document.getElementById("login-overlay")?.classList.add("hidden");
  }
  window.hideLoginOverlay = hideLoginOverlay;

  async function guestLogin(username) {
    return window.DfAuth.loginAsGuest(username);
  }

  async function tryRestoreDfSession() {
    var urlParams = new URLSearchParams(location.search);
    var urlErr = urlParams.get("oauth_error");
    if (urlErr) {
      history.replaceState(null, "", location.pathname + location.hash);
      showLoginOverlay(decodeURIComponent(urlErr));
      return;
    }
    if (urlParams.get("signed_in") === "1") {
      history.replaceState(null, "", location.pathname + location.hash);
    }
    var oauthErr = sessionStorage.getItem("df_oauth_error");
    if (oauthErr) {
      sessionStorage.removeItem("df_oauth_error");
      showLoginOverlay(oauthErr);
      return;
    }
    if (window.DfAuth?.isOAuthCallbackPath?.()) {
      showLoginOverlay("Completando inicio de sesión…");
    }
    var statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Verificando sesión…";
    try {
      var restored = await window.DfAuth.tryRestoreDfSession();
      if (restored?.error) {
        showLoginOverlay(restored.error);
        return;
      }
      if (restored?.token && restored?.profile) {
        saveDfSession(restored.token, restored.profile);
        if (!window.__DF_EARLY_SESSION_UI) showSessionPanel(restored.profile);
        else updateCaptainHud();
        return;
      }
      showLoginOverlay();
    } catch {
      showLoginOverlay("No se pudo conectar al servidor. ¿Está levantado?");
    } finally {
      ensureLoginUiVisible();
      window.__DF_AUTH_READY = true;
    }
  }

  var dfAuthBootDone = false;
  function bootAuthOnce() {
    if (dfAuthBootDone) return;
    dfAuthBootDone = true;
    var stored = window.DfAuth?.loadDfSession?.();
    if (stored?.token && stored?.profile) saveDfSession(stored.token, stored.profile);
    window.__DF_AUTH_READY = true;
    void tryRestoreDfSession();
  }

  async function submitGuestLogin() {
    var input = document.getElementById("login-username");
    var btn = document.getElementById("login-submit");
    var err = document.getElementById("login-error");
    var username = input?.value?.trim() ?? "";
    if (!username) {
      if (err) err.textContent = "Escribe un nombre de capitán.";
      return;
    }
    if (username.length < 3) {
      if (err) err.textContent = "El nombre debe tener al menos 3 caracteres.";
      return;
    }
    if (btn) btn.disabled = true;
    if (err) err.textContent = "";
    document.getElementById("status").textContent = "Entrando al batallón…";
    try {
      var data = await guestLogin(username);
      saveDfSession(data.token, data.profile);
      showSessionPanel(data.profile);
    } catch (e) {
      if (err) err.textContent = e.message || "Error de login";
      document.getElementById("status").textContent = "Esperando identificación…";
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.getElementById("login-submit")?.addEventListener("click", submitGuestLogin);
  document.getElementById("login-username")?.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitGuestLogin();
  });

  window.startGameAfterAuth = function dfEnterWorldEarly() {
    if (typeof window.__dfStartGameAfterAuth === "function") {
      return window.__dfStartGameAfterAuth();
    }
    if (typeof window.DfLoadAndStartGame === "function") {
      return window.DfLoadAndStartGame();
    }
  };

  if (!window.DfAuth?.isOAuthCallbackPath?.()) {
    bootAuthOnce();
  }
})();
