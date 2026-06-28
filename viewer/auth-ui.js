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

  function formatOAuthErrorMessage(message) {
    if (!message) return "";
    var msg = String(message);
    var isNative = window.Capacitor?.isNativePlatform?.() === true;
    var appLinkHint = isNative
      ? " Si el App Link falló: cerrá el navegador, reabrí la app y repetí. Revisá assetlinks.json en play.gamedevforge.com."
      : "";
    if (msg.includes("invalid_redirect_uri") || msg.includes("Redirect URI")) {
      return "OAuth: redirect URI no autorizada. En APK debe ser https://play.gamedevforge.com/auth/…/callback — revisá consola X/GitHub y assetlinks.json." + appLinkHint;
    }
    if (msg.includes("PKCE") || msg.includes("code_verifier") || msg.includes("Faltan datos de X")) {
      return msg + (isNative ? " No recargues la app a mitad del flujo." : "");
    }
    if (msg.includes("state no coincide") || msg.includes("Sesión OAuth expirada")) {
      return "La sesión OAuth expiró. Volvé a pulsar «Continuar con X» o GitHub." + appLinkHint;
    }
    if (msg.includes("Cancelaste la autorización")) {
      return "Cancelaste el inicio de sesión en el proveedor.";
    }
    if (msg.includes("Respuesta inválida del servidor") || msg.includes("frontend en vez del API")) {
      return "El servidor API no respondió correctamente. Revisá la URL en Ajustes (APK) o recargá sin caché.";
    }
    if (isNative && (msg.includes("OAuth falló") || msg.includes("App Link") || msg.includes("assetlinks"))) {
      return msg + appLinkHint;
    }
    return msg;
  }

  function applyLoginVersionInfo() {
    window.paintVersionInfo?.();
  }

  function paintAvatarInto(img, fallback, profile, displayName) {
    if (!img || !fallback) return;
    var username = displayName ?? profile?.username ?? profile?.captainName ?? "?";
    var initial = username.trim().charAt(0).toUpperCase() || "?";
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

  function paintSessionAvatar(profile) {
    paintAvatarInto(
      document.getElementById("login-session-avatar"),
      document.getElementById("login-session-avatar-fallback"),
      profile,
    );
  }

  function paintHudMenuProfile(profile) {
    var displayName = profile?.captainName ?? profile?.username ?? "—";
    var username = profile?.username ?? "";
    var nameEl = document.getElementById("hud-menu-display-name");
    var userEl = document.getElementById("hud-menu-username");
    var providerEl = document.getElementById("hud-menu-provider");
    var statsEl = document.getElementById("hud-menu-stats");
    var versionEl = document.getElementById("hud-menu-version");
    if (nameEl) nameEl.textContent = displayName;
    if (userEl) {
      userEl.textContent = username && username !== displayName ? "@" + username : "";
      userEl.style.display = username && username !== displayName ? "" : "none";
    }
    if (providerEl) providerEl.textContent = AUTH_PROVIDER_LABELS[profile?.authProvider] ?? "";
    paintAvatarInto(
      document.getElementById("hud-menu-avatar"),
      document.getElementById("hud-menu-avatar-fallback"),
      profile,
      displayName,
    );
    if (statsEl) {
      var stats = profile?.stats;
      if (!stats) {
        statsEl.innerHTML = "";
        statsEl.style.display = "none";
      } else {
        statsEl.style.display = "";
        var rows = [
          { label: "Bárbaros", value: stats.barbariansKilled ?? 0 },
          { label: "Exploración", value: (stats.exploredPctMax ?? 0) + "%" },
          { label: "Misiones", value: stats.missionsCompleted ?? 0 },
          { label: "Score", value: stats.compositeScore ?? 0, accent: true },
        ];
        statsEl.innerHTML = rows.map(function (r) {
          return (
            '<div class="hud-menu-stat">' +
            '<span class="hud-menu-stat-label">' + r.label + "</span>" +
            '<span class="hud-menu-stat-value' + (r.accent ? " accent" : "") + '">' + r.value + "</span>" +
            "</div>"
          );
        }).join("");
      }
    }
    if (versionEl) {
      versionEl.textContent = window.DF_GAME_VERSION ? "Digital Front v" + window.DF_GAME_VERSION : "";
    }
    var serverLink = document.getElementById("hud-menu-server-link");
    if (serverLink && typeof window.needsServerSettings === "function") {
      serverLink.classList.toggle("visible", window.needsServerSettings());
    }
  }

  function updateCaptainHud() {
    var profile = window.dfProfile;
    var name = profile?.captainName ?? profile?.username ?? "—";
    var lbl = document.getElementById("captain-lbl");
    if (lbl) lbl.textContent = name;
    paintAvatarInto(
      document.getElementById("hud-profile-avatar"),
      document.getElementById("hud-profile-avatar-fallback"),
      profile,
      name,
    );
    paintHudMenuProfile(profile);
  }
  window.updateCaptainHud = updateCaptainHud;

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
    closeHudMenu();
    var overlay = document.getElementById("login-overlay");
    var err = document.getElementById("login-error");
    document.getElementById("login-auth")?.classList.remove("hidden");
    document.getElementById("login-session")?.classList.add("hidden");
    if (overlay) overlay.classList.remove("hidden");
    document.documentElement.classList.remove("df-await-session-ui");
    var boot = document.getElementById("login-boot-status");
    if (boot) boot.style.display = "none";
    if (err) err.textContent = formatOAuthErrorMessage(message) ?? "";
    var status = document.getElementById("status");
    if (status) status.textContent = "Identifícate para entrar al batallón";
    applyLoginVersionInfo();
    window.DigitalFrontBgm?.init?.();
    window.DigitalFrontBgm?.playMenu?.();
    void window.DfAuth?.refreshOAuthButtons?.();
  }
  window.showLoginOverlay = showLoginOverlay;

  function showSessionPanel(profile) {
    if (window.__DF_EARLY_SESSION_UI) {
      window.dfAuthToken = window.DfAuth?.loadDfSession?.()?.token ?? window.dfAuthToken;
      window.dfProfile = profile;
      updateCaptainHud();
      return;
    }
    closeHudMenu();
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

  function openHudMenu() {
    if (document.body.classList.contains("mobile-play")) return;
    paintHudMenuProfile(window.dfProfile);
    var overlay = document.getElementById("hud-menu-overlay");
    if (overlay) overlay.classList.add("visible");
  }

  function closeHudMenu() {
    document.getElementById("hud-menu-overlay")?.classList.remove("visible");
  }

  function returnToHome() {
    closeHudMenu();
    var profile = window.dfProfile ?? window.DfAuth?.loadDfSession?.()?.profile;
    if (!profile) {
      showLoginOverlay();
      return;
    }
    if (window.gameStarted) {
      window.__DF_EARLY_SESSION_UI = false;
      window.DfPauseForMenu?.();
    }
    showSessionPanel(profile);
  }
  window.returnToHome = returnToHome;

  function initHudMenu() {
    if (window.__dfHudMenuReady) return;
    window.__dfHudMenuReady = true;
    document.getElementById("btn-hud-menu")?.addEventListener("click", openHudMenu);
    document.getElementById("hud-profile-chip")?.addEventListener("click", openHudMenu);
    document.getElementById("hud-menu-close")?.addEventListener("click", closeHudMenu);
    document.getElementById("hud-menu-overlay")?.addEventListener("click", function (e) {
      if (e.target?.id === "hud-menu-overlay") closeHudMenu();
    });
    document.getElementById("hud-menu-home")?.addEventListener("click", returnToHome);
    document.getElementById("hud-menu-logout")?.addEventListener("click", function () {
      closeHudMenu();
      logoutSession();
    });
    document.getElementById("hud-menu-server-link")?.addEventListener("click", function () {
      closeHudMenu();
      window.showSettingsOverlay?.();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeHudMenu();
    });
  }

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
    closeHudMenu();
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
      showLoginOverlay(formatOAuthErrorMessage(decodeURIComponent(urlErr)));
      return;
    }
    if (urlParams.get("signed_in") === "1") {
      history.replaceState(null, "", location.pathname + location.hash);
    }
    var oauthErr = sessionStorage.getItem("df_oauth_error");
    if (oauthErr) {
      sessionStorage.removeItem("df_oauth_error");
      showLoginOverlay(formatOAuthErrorMessage(oauthErr));
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

  initHudMenu();
})();
