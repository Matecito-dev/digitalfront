/** Init Capacitor plugins — solo en WebView nativa. */
(function initCapacitor() {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;

  document.documentElement.classList.add("capacitor-native");

  const plugins = cap.Plugins ?? {};

  plugins.ScreenOrientation?.lock?.({ orientation: "landscape" }).catch(() => {});

  plugins.StatusBar?.setOverlaysWebView?.({ overlay: true }).catch(() => {});
  plugins.StatusBar?.setStyle?.({ style: "DARK" }).catch(() => {});

  plugins.App?.addListener?.("appUrlOpen", ({ url }) => {
    if (!url || typeof window.DfAuth?.handleOAuthReturnUrl !== "function") return;
    if (!/\/auth\/(x|github)\/callback/.test(url)) return;
    void (async () => {
      try {
        await plugins.Browser?.close?.();
        const result = await window.DfAuth.handleOAuthReturnUrl(url);
        if (result?.profile && typeof window.showSessionPanel === "function") {
          window.showSessionPanel(result.profile);
        }
      } catch (e) {
        window.showLoginOverlay?.(e?.message || "OAuth falló al volver a la app.");
      }
    })();
  });

  plugins.App?.addListener?.("backButton", () => {
    const modals = [
      document.getElementById("camp-modal"),
      document.getElementById("death-screen"),
      document.getElementById("confirm-attack"),
      document.getElementById("help-panel"),
      document.getElementById("tutorial-overlay"),
    ];
    for (const el of modals) {
      if (el?.classList?.contains("visible") || el?.style?.display === "flex" || el?.classList?.contains("open")) {
        el.classList.remove("visible", "open");
        if (el.id === "tutorial-overlay") el.style.display = "none";
        if (el.id === "help-panel") el.style.display = "none";
        if (typeof closeCampModal === "function") closeCampModal();
        if (typeof hideDeathScreen === "function") hideDeathScreen();
        if (typeof hideAttackConfirm === "function") hideAttackConfirm();
        return;
      }
    }
    plugins.App?.exitApp?.();
  });

  window.__dfHideSplash = () => {
    plugins.SplashScreen?.hide?.().catch(() => {});
  };
})();
