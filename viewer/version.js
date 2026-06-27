/** Versión del cliente — sobrescrita en build:web desde version.json */
window.DF_GAME_VERSION = "0.0.5";
window.DF_GAME_VERSION_INFO = {
  version: "0.0.5",
  title: "Botones OAuth clicables",
  changelog: [
    "Botones GitHub/X ya no quedan deshabilitados y responden al clic.",
    "El juego usa siempre api.gamedevforge.com en la web (no el dominio del frontend).",
    "Arreglado login con X: ya te lleva al juego tras autorizar.",
    "Bárbaros ya no reaparecen al instante tras derrotarlos.",
    "Aviso cuando hay una versión nueva del juego.",
  ],
};

window.paintVersionInfo = function paintVersionInfo() {
  const info = window.DF_GAME_VERSION_INFO;
  if (!info) return;
  const badge = document.getElementById("login-version-badge");
  const label = document.getElementById("login-version-label");
  const list = document.getElementById("login-changelog-list");
  if (badge && info.version) badge.textContent = `v${info.version}`;
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
