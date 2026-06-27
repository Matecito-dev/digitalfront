/** OAuth (GitHub/X) + guest key persistence for Digital Front viewer. */
(function () {
  const DF_SESSION_KEY = "df_session";
  const DF_GUEST_KEY = "df_guest_key";
  const X_PKCE_KEY = "df_x_pkce_verifier";
  const GITHUB_CALLBACK = "/auth/github/callback";
  const X_CALLBACK = "/auth/x/callback";

  let cachedProviders = null;

  function getApiUrl(path) {
    if (typeof window.apiUrl === "function") return window.apiUrl(path);
    const base = (window.DF_CONFIG?.apiBase || "").replace(/\/$/, "");
    const p = path.startsWith("/") ? path : `/${path}`;
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
    if (!clientId || !redirectUri || isPlaceholder(clientId)) return null;
    return { clientId, redirectUri };
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
    if (!gh?.clientId || !gh?.redirectUri) {
      throw new Error("GitHub OAuth no configurado. Revisa las variables en Vercel y el VPS.");
    }
    const state = randomString(16);
    sessionStorage.setItem("df_oauth_state", state);
    const params = new URLSearchParams({
      client_id: gh.clientId,
      redirect_uri: gh.redirectUri,
      scope: "read:user",
      state,
    });
    location.href = `https://github.com/login/oauth/authorize?${params}`;
  }

  async function loginWithX() {
    const providers = await fetchProviders();
    const x = providers?.x;
    if (!x?.clientId || !x?.redirectUri) {
      throw new Error("X OAuth no configurado. Revisa las variables en Vercel y el VPS.");
    }
    const verifier = randomString(32);
    sessionStorage.setItem(X_PKCE_KEY, verifier);
    const challenge = await sha256Base64Url(verifier);
    const state = randomString(16);
    sessionStorage.setItem("df_oauth_state", state);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: x.clientId,
      redirect_uri: x.redirectUri,
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
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.message || data.error || "OAuth falló";
      throw new Error(msg);
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

  async function handleOAuthCallback() {
    const path = location.pathname.replace(/\/$/, "");
    if (path !== GITHUB_CALLBACK && path !== X_CALLBACK) return false;

    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const err = params.get("error");
    if (err) {
      cleanOAuthUrl();
      throw new Error(params.get("error_description") || err);
    }
    if (!code) return false;

    let data;
    if (path === GITHUB_CALLBACK) {
      data = await exchangeOAuth("/api/auth/oauth/github", { code });
    } else {
      const codeVerifier = sessionStorage.getItem(X_PKCE_KEY);
      sessionStorage.removeItem(X_PKCE_KEY);
      data = await exchangeOAuth("/api/auth/oauth/x", { code, codeVerifier });
    }
    sessionStorage.removeItem("df_oauth_state");
    saveDfSession(data.token, data.profile);
    cleanOAuthUrl();
    return data;
  }

  async function tryRestoreDfSession() {
    try {
      const oauth = await handleOAuthCallback();
      if (oauth) return oauth;
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
    try {
      const providers = await fetchProviders();
      if (ghBtn) {
        ghBtn.disabled = !providers?.github;
        ghBtn.title = providers?.github ? "" : "GitHub OAuth no configurado";
      }
      if (xBtn) {
        xBtn.disabled = !providers?.x;
        xBtn.title = providers?.x ? "" : "X OAuth no configurado";
      }
    } catch {
      if (ghBtn) ghBtn.disabled = true;
      if (xBtn) xBtn.disabled = true;
    }
  }

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
  };
})();
