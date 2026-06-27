/** Marca del juego — espejo de src/shared/branding.ts para el viewer Phaser. */
window.DF_BRAND = Object.freeze({
  gameTitle: "Digital Front",
  gameSubtitle: "Guerra en tiempo real",
  defaultWorldSeed: "valle-bruma",
  appId: "com.digitalfront.game",
  worlds: {
    "valle-bruma": "Valle de Bruma",
  },
});

/** @deprecated alias */
window.WG_BRAND = window.DF_BRAND;

window.worldDisplayName = function worldDisplayName(seed) {
  return window.DF_BRAND.worlds[seed] ?? seed;
};
