import { bootWorldScene } from "./game/worldScene.js";
import { DEFAULT_SEED } from "./shared/constants.js";

const params = new URLSearchParams(location.search);
if (params.get("lab") !== "1") {
  throw new Error("Pixi lab: abrí con ?lab=1 o jugá en http://localhost:3333 (npm run dev)");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/tile-sw.js").catch(() => {});
}

const mountEl = document.getElementById("app");
if (!mountEl) throw new Error("#app missing");

document.body.insertAdjacentHTML(
  "afterbegin",
  `<div id="lab-banner" style="position:fixed;top:0;left:0;right:0;z-index:9999;padding:8px 12px;background:#6e4000cc;color:#fff;font:12px system-ui;text-align:center">
    Lab Pixi — solo mapa/tiles. Juego completo: <a href="http://localhost:3333/" style="color:#fff;font-weight:600">npm run dev → :3333</a>
  </div>`,
);

const seed = params.get("seed") ?? DEFAULT_SEED;

bootWorldScene(mountEl, seed).catch((err) => {
  console.error(err);
  mountEl.innerHTML = `<p style="color:#f85149;padding:24px">Lab Pixi: ${err instanceof Error ? err.message : String(err)}<br><br>Primero: <code>npm run dev</code> en otra terminal (API :3333)</p>`;
});
