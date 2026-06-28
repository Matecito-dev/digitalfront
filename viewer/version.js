/** Versión del cliente — sobrescrita en build:web desde version.json */
window.DF_GAME_VERSION = "0.0.20";
window.DF_GAME_VERSION_INFO = {
  version: "0.0.20",
  title: "Login cinematográfico + HUD desktop",
  changelog: [
    "Rediseño cinematográfico de login y pantalla de carga (desktop + mobile landscape).",
    "HUD desktop moderno con paneles glass, chip de perfil y menú de ajustes.",
    "Ir al inicio desde in-game (panel de sesión) y cerrar sesión desde el menú.",
    "Package ID unificado com.digitalfront.game, ranking rebuild cada 6h, smoke tests.",
    "Limpieza de procesos huérfanos tras tests (vitest globalTeardown + hook Cursor).",
  ],
};

window.paintVersionInfo = function paintVersionInfo() {
  const info = window.DF_GAME_VERSION_INFO;
  if (!info) return;
  const badge = document.getElementById("login-version-badge");
  const apkBadge = document.getElementById("login-apk-version-badge");
  const label = document.getElementById("login-version-label");
  const list = document.getElementById("login-changelog-list");
  const versionText = info.version ? `v${info.version}` : "";
  if (badge && versionText) badge.textContent = versionText;
  if (apkBadge && versionText) apkBadge.textContent = versionText;
  if (label && info.title) label.textContent = info.title;
  if (list && Array.isArray(info.changelog) && info.changelog.length) {
    list.innerHTML = info.changelog.map(line => `<li>${line}</li>`).join("");
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => window.paintVersionInfo());
} else {
  window.paintVersionInfo();
}
