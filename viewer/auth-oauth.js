/** OAuth (GitHub/X) + guest key persistence for Digital Front viewer. */
(function () {
  const DF_SESSION_KEY = "df_session";
  const DF_GUEST_KEY = "df_guest_key";
  const X_PKCE_KEY = "df_x_pkce_verifier";
  const X_REDIRECT_KEY = "df_x_redirect_uri";
  const OAUTH_STATE_KEY = "df_oauth_state";
  const PKCE_TTL_MS = 15 * 60 * 1000;
  const GITHUB_CALLBACK = "/auth/github/callback";
  const X_CALLBACK = "/auth/x/callback";

  let cachedProviders = null;

  function getApiUrl(path) {
    if (typeof window.apiUrl === "function") return window.apiUrl(path);
    const p = path.startsWith("/") ? path : `/${path}`;
    const configured = (window.DF_CONFIG?.apiBase || "").replace(/\/$/, "");
    const origin = window.location.origin?.replace(/\/$/, "") || "";
    const stored = (localStorage.getItem("df_api_base") || "").replace(/\/$/, "");
    const isNative = window.Capacitor?.isNativePlatform?.() === true;
    let base;
    if (!isNative) {
      base = configured || (stored && stored !== origin ? stored : origin);
    } else {
      base = stored || configured || origin;
    }
    return base ? base + p : p;
  }

  function isPlaceholder(value) {
    if (!value || typeof value !== "string") return true;
    const v = value.trim();
    return v.startsWith("your_") || v.endsWith("_here");
  }

  function pickProvider(apiEntry, bakedEntry) {
    const clientId = !isPlaceholder(bakedEntry?.clientId)
      ? bakedEntry.clientId
      : !isPlaceholder(apiEntry?.clientId)
        ? apiEntry.clientId
        : null;
    const redirectUri = bakedEntry?.redirectUri || apiEntry?.redirectUri || null;
    if (!clientId || isPlaceholder(clientId)) return null;
    return { clientId, redirectUri };
  }

  /** Redirect del dominio actual (evita perder PKCE entre vercel.app y play.*). */
  function currentRedirectUri(callbackPath, fallback) {
    const origin = window.location.origin?.replace(/\/$/, "");
    if (origin) return `${origin}${callbackPath}`;
    return fallback || null;
  }

  function saveDfSession(token, profile, guestKey) {
    localStorage.setItem(DF_SESSION_KEY, JSON.stringify({ token, profile }));
    if (guestKey) localStorage.setItem(DF_GUEST_KEY, guestKey);
  }

  function loadDfSession() {
    try {
      const raw = localStorage.getItem(DF_SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function loadGuestKey() {
    return localStorage.getItem(DF_GUEST_KEY) || null;
  }

  function clearDfSession() {
    localStorage.removeItem(DF_SESSION_KEY);
  }

  function storePkceVerifier(verifier, redirectUri) {
    localStorage.setItem(X_PKCE_KEY, JSON.stringify({ v: verifier, t: Date.now() }));
    if (redirectUri) localStorage.setItem(X_REDIRECT_KEY, redirectUri);
  }

  function loadPkceVerifier() {
    const raw = localStorage.getItem(X_PKCE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.v && Date.now() - (parsed.t ?? 0) < PKCE_TTL_MS) return parsed.v;
      return null;
    } catch {
      return raw.length >= 32 ? raw : null;
    }
  }

  function loadStoredRedirectUri() {
    return localStorage.getItem(X_REDIRECT_KEY) || null;
  }

  function clearPkceStorage() {
    localStorage.removeItem(X_PKCE_KEY);
    localStorage.removeItem(X_REDIRECT_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  }

  async function fetchProviders() {
    if (cachedProviders) return cachedProviders;
    let api = {};
    try {
      const r = await fetch(getApiUrl("/api/auth/providers"));
      if (r.ok) api = await r.json();
    } catch { /* build-time fallback */ }
    const baked = window.DF_OAUTH || {};
    cachedProviders = {
      github: pickProvider(api.github, baked.github),
      x: pickProvider(api.x, baked.x),
    };
    return cachedProviders;
  }

  function randomString(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Base64Url(input) {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function loginWithGitHub() {
    const providers = await fetchProviders();
    const gh = providers?.github;
    if (!gh?.clientId) {
      throw new Error("GitHub OAuth no configurado. Revisa las variables en Vercel y el VPS.");
    }
    const redirectUri = currentRedirectUri(GITHUB_CALLBACK, gh.redirectUri);
    const state = randomString(16);
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    const params = new URLSearchParams({
      client_id: gh.clientId,
      redirect_uri: redirectUri,
      scope: "read:user",
      state,
    });
    location.href = `https://github.com/login/oauth/authorize?${params}`;
  }

  async function loginWithX() {
    const providers = await fetchProviders();
    const x = providers?.x;
    if (!x?.clientId) {
      throw new Error("X OAuth no configurado. Revisa las variables en Vercel y el VPS.");
    }
    const redirectUri = currentRedirectUri(X_CALLBACK, x.redirectUri);
    const verifier = randomString(32);
    storePkceVerifier(verifier, redirectUri);
    const challenge = await sha256Base64Url(verifier);
    const state = randomString(16);
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: x.clientId,
      redirect_uri: redirectUri,
      scope: "tweet.read users.read offline.access",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    location.href = `https://x.com/i/oauth2/authorize?${params}`;
  }

  async function exchangeOAuth(path, body) {
    const r = await fetch(getApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await r.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      const hint = raw.trimStart().startsWith("<")
        ? " La petición llegó al frontend en vez del API — recarga sin caché (Ctrl+Shift+R)."
        : "";
      throw new Error(`Respuesta inválida del servidor.${hint}`);
    }
    if (!r.ok) {
      const msg = data.message || data.error_description || data.error || "OAuth falló";
      throw new Error(msg);
    }
    if (!data.token || !data.profile) {
      throw new Error("Respuesta OAuth inválida del servidor.");
    }
    return data;
  }

  async function loginAsGuest(username) {
    const r = await fetch(getApiUrl("/api/auth/guest"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.message
        || (data.error === "mmo_services_unavailable"
          ? "Servidor MMO no disponible. Ejecuta: npm run infra:up && npm run db:migrate"
          : null)
        || data.error
        || "No se pudo iniciar sesión";
      throw new Error(msg);
    }
    if (data.guestKey) localStorage.setItem(DF_GUEST_KEY, data.guestKey);
    saveDfSession(data.token, data.profile);
    return data;
  }

  async function restoreByGuestKey(guestKey) {
    const r = await fetch(getApiUrl("/api/auth/guest"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestKey }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    saveDfSession(data.token, data.profile, guestKey);
    return data;
  }

  async function validateDfSession(token) {
    const r = await fetch(getApiUrl("/api/profile/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return r.json();
  }

  function cleanOAuthUrl() {
    const u = new URL(location.href);
    u.search = "";
    u.pathname = "/";
    history.replaceState(null, "", u.pathname + u.hash);
  }

  function isOAuthCallbackPath() {
    const path = location.pathname.replace(/\/$/, "");
    return path === GITHUB_CALLBACK || path === X_CALLBACK;
  }

  async function handleOAuthCallback() {
    const path = location.pathname.replace(/\/$/, "");
    if (path !== GITHUB_CALLBACK && path !== X_CALLBACK) return false;

    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const err = params.get("error");
    if (err) {
      cleanOAuthUrl();
      clearPkceStorage();
      throw new Error(params.get("error_description") || err);
    }
    if (!code) return false;

    const savedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    const returnedState = params.get("state");
    if (savedState && returnedState && savedState !== returnedState) {
      cleanOAuthUrl();
      clearPkceStorage();
      throw new Error("Sesión OAuth expirada. Volvé a intentar iniciar sesión.");
    }
    sessionStorage.removeItem(OAUTH_STATE_KEY);

    try {
      let data;
      if (path === GITHUB_CALLBACK) {
        const redirectUri = currentRedirectUri(GITHUB_CALLBACK, null);
        data = await exchangeOAuth("/api/auth/oauth/github", { code, redirectUri });
      } else {
        const codeVerifier = loadPkceVerifier();
        const redirectUri = loadStoredRedirectUri() || currentRedirectUri(X_CALLBACK, null);
        if (!codeVerifier) {
          throw new Error("Faltan datos de X (PKCE). Volvé a pulsar «Continuar con X».");
        }
        data = await exchangeOAuth("/api/auth/oauth/x", { code, codeVerifier, redirectUri });
      }
      clearPkceStorage();
      saveDfSession(data.token, data.profile);
      cleanOAuthUrl();
      return data;
    } catch (e) {
      cleanOAuthUrl();
      clearPkceStorage();
      throw e;
    }
  }

  async function tryRestoreDfSession() {
    try {
      const oauth = await handleOAuthCallback();
      if (oauth?.token && oauth?.profile) return oauth;
    } catch (e) {
      return { error: e.message || "OAuth falló" };
    }

    const stored = loadDfSession();
    if (stored?.token) {
      try {
        const profile = await validateDfSession(stored.token);
        if (profile) {
          saveDfSession(stored.token, profile);
          return { token: stored.token, profile };
        }
        clearDfSession();
      } catch { /* fall through to guest key */ }
    }

    const guestKey = loadGuestKey();
    if (guestKey) {
      const restored = await restoreByGuestKey(guestKey);
      if (restored) return restored;
    }

    return null;
  }

  async function refreshOAuthButtons() {
    const ghBtn = document.getElementById("login-github");
    const xBtn = document.getElementById("login-x");
    if (!ghBtn && !xBtn) return;
    const baked = window.DF_OAUTH || {};
    const bakedGh = pickProvider(null, baked.github);
    const bakedX = pickProvider(null, baked.x);
    if (ghBtn) ghBtn.title = bakedGh ? "" : "GitHub OAuth no configurado";
    if (xBtn) xBtn.title = bakedX ? "" : "X OAuth no configurado";
    try {
      const providers = await fetchProviders();
      if (ghBtn) ghBtn.title = providers?.github ? "" : "GitHub OAuth no configurado";
      if (xBtn) xBtn.title = providers?.x ? "" : "X OAuth no configurado";
    } catch { /* baked config sigue usable */ }
  }

  async function handleOAuthButtonClick(provider) {
    const err = document.getElementById("login-error");
    const ghBtn = document.getElementById("login-github");
    const xBtn = document.getElementById("login-x");
    const status = document.getElementById("status");
    if (err) err.textContent = "";
    if (status) status.textContent = "Redirigiendo al proveedor…";
    if (ghBtn) ghBtn.classList.add("oauth-loading");
    if (xBtn) xBtn.classList.add("oauth-loading");
    try {
      if (provider === "github") await loginWithGitHub();
      else await loginWithX();
    } catch (e) {
      if (err) err.textContent = e.message || "OAuth no disponible";
      if (status) status.textContent = "Identifícate para entrar al batallón";
      if (ghBtn) ghBtn.classList.remove("oauth-loading");
      if (xBtn) xBtn.classList.remove("oauth-loading");
    }
  }

  document.addEventListener("click", (e) => {
    const id = e.target?.id;
    if (id !== "login-github" && id !== "login-x") return;
    e.preventDefault();
    void handleOAuthButtonClick(id === "login-github" ? "github" : "x");
  });

  window.DfAuth = {
    DF_SESSION_KEY,
    DF_GUEST_KEY,
    saveDfSession,
    loadDfSession,
    loadGuestKey,
    clearDfSession,
    fetchProviders,
    loginWithGitHub,
    loginWithX,
    loginAsGuest,
    handleOAuthCallback,
    tryRestoreDfSession,
    validateDfSession,
    refreshOAuthButtons,
    handleOAuthButtonClick,
    isOAuthCallbackPath,
  };
})();
