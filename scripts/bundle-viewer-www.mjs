#!/usr/bin/env node
/** Empaqueta viewer/ Phaser (juego completo) para Capacitor Android — sin CDN. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = join(ROOT, 'viewer');
const OUT = join(ROOT, 'app-www');

const versionInfo = JSON.parse(await readFile(join(ROOT, 'version.json'), 'utf8'));
const cacheV = encodeURIComponent(String(versionInfo.version ?? '0'));

const serverUrl = (process.env.DF_SERVER_URL ?? process.env.VELIS_SERVER_URL)?.replace(/\/$/, '') ?? '';

const COPY_FILES = [
  'branding.js',
  'auth-oauth.js',
  'auth-ui.js',
  'game-loader.js',
  'game-core.js',
  'session-boot.js',
  'oauth-callback.html',
  'version.js',
  'terrain-tactics.js',
  'tactical-orders.js',
  'path-worker.js',
  'tile-sw.js',
  'hud.css',
  'hud-desktop.css',
  'login.css',
  'load-screen.css',
  'config.js',
  'capacitor-init.js',
];

const COPY_DIRS = ['audio', 'assets'];

await mkdir(join(OUT, 'vendor'), { recursive: true });

for (const f of COPY_FILES) {
  await cp(join(VIEWER, f), join(OUT, f));
}

for (const d of COPY_DIRS) {
  try {
    await cp(join(VIEWER, d), join(OUT, d), { recursive: true });
  } catch { /* optional */ }
}

await cp(join(VIEWER, 'vendor', 'phaser.min.js'), join(OUT, 'vendor', 'phaser.min.js'));

let html = await readFile(join(VIEWER, 'index.html'), 'utf8');
html = html
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/phaser@[^"']+/g, './vendor/phaser.min.js')
  .replace(/src="\/terrain-tactics\.js"/g, 'src="./terrain-tactics.js"')
  .replace(/src="\/tactical-orders\.js"/g, 'src="./tactical-orders.js"')
  .replace(/src="config\.js"/g, 'src="./config.js"')
  .replace(/src="branding\.js"/g, 'src="./branding.js"')
  .replace(/src="session-boot\.js"/g, `src="./session-boot.js?v=${cacheV}"`)
  .replace(/src="auth-ui\.js"/g, `src="./auth-ui.js?v=${cacheV}"`)
  .replace(/src="game-loader\.js"/g, `src="./game-loader.js?v=${cacheV}"`)
  .replace(/src="auth-oauth\.js"/g, `src="./auth-oauth.js?v=${cacheV}"`)
  .replace(/src="\.\/session-boot\.js(\?[^"']*)?"/g, `src="./session-boot.js?v=${cacheV}"`)
  .replace(/src="\.\/auth-ui\.js(\?[^"']*)?"/g, `src="./auth-ui.js?v=${cacheV}"`)
  .replace(/src="\.\/game-loader\.js(\?[^"']*)?"/g, `src="./game-loader.js?v=${cacheV}"`)
  .replace(/src="game-core\.js"/g, 'src="./game-core.js"')
  .replace(/src="terrain-tactics\.js"/g, 'src="./terrain-tactics.js"')
  .replace(/src="tactical-orders\.js"/g, 'src="./tactical-orders.js"')
  .replace(/src="capacitor-init\.js"/g, 'src="./capacitor-init.js"')
  .replace(/src="audio\/sfx\.js"/g, 'src="./audio/sfx.js"')
  .replace(/src="audio\/bgm\.js"/g, 'src="./audio/bgm.js"')
  .replace(/href="hud\.css"/g, 'href="./hud.css"')
  .replace(/href="hud-desktop\.css"/g, 'href="./hud-desktop.css"')
  .replace(/href="login\.css"/g, 'href="./login.css"')
  .replace(/href="load-screen\.css"/g, 'href="./load-screen.css"')
  .replace(/src="vendor\/phaser\.min\.js"/g, 'src="./vendor/phaser.min.js"')
  .replace(/new Worker\('\/path-worker\.js'\)/g, "new Worker('./path-worker.js')")
  .replace(/new Worker\("\/path-worker\.js"\)/g, 'new Worker("./path-worker.js")');

if (serverUrl) {
  html = html.replace(
    /window\.DF_CONFIG = \{[\s\S]*?\};/,
    `window.DF_CONFIG = {\n  apiBase: "${serverUrl}",\n  wsPath: "/api/sim/ws",\n};`,
  );
}

await writeFile(join(OUT, 'index.html'), html);

const configJs = `/** Generado por app:build — editable en runtime vía Ajustes */
window.DF_CONFIG = {
  apiBase: ${serverUrl ? `"${serverUrl}"` : '""'},
  wsPath: "/api/sim/ws",
};
window.VELIS_CONFIG = window.DF_CONFIG;
`;
await writeFile(join(OUT, 'config.js'), configJs);

const versionJs = `/** Generado por app:build — version.json */
window.DF_GAME_VERSION = ${JSON.stringify(String(versionInfo.version ?? '0.0.0'))};
window.DF_GAME_VERSION_INFO = ${JSON.stringify({
  version: String(versionInfo.version ?? '0.0.0'),
  title: String(versionInfo.title ?? ''),
  changelog: Array.isArray(versionInfo.changelog) ? versionInfo.changelog : [],
})};

window.paintVersionInfo = function paintVersionInfo() {
  const info = window.DF_GAME_VERSION_INFO;
  if (!info) return;
  const badge = document.getElementById("login-version-badge");
  const label = document.getElementById("login-version-label");
  const list = document.getElementById("login-changelog-list");
  if (badge && info.version) badge.textContent = "v" + info.version;
  if (label && info.title) label.textContent = info.title;
  if (list && Array.isArray(info.changelog) && info.changelog.length) {
    list.innerHTML = info.changelog.map(function (line) { return "<li>" + line + "</li>"; }).join("");
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { window.paintVersionInfo(); });
} else {
  window.paintVersionInfo();
}
`;
await writeFile(join(OUT, 'version.js'), versionJs);

/** Fallback estático OAuth si App Link no abre la APK. */
const oauthCallbackSrc = await readFile(join(VIEWER, 'oauth-callback.html'), 'utf8');
function oauthCallbackHtml(depth) {
  const prefix = '../'.repeat(depth);
  return oauthCallbackSrc
    .replace(/<base href="\/">/, '')
    .replace(/src="\/config\.js"/g, `src="${prefix}config.js"`)
    .replace(/src="\/auth-oauth\.js"/g, `src="${prefix}auth-oauth.js"`)
    .replace(/location\.replace\("\/"/g, `location.replace("${prefix}"`)
    .replace(/location\.replace\("\/\?/g, `location.replace("${prefix}?`);
}

for (const sub of ['auth/x/callback', 'auth/github/callback']) {
  const dir = join(OUT, sub);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), oauthCallbackHtml(2));
}

await writeFile(
  join(OUT, 'README.txt'),
  'Generado por npm run app:build — juego Phaser completo para Capacitor.\n',
);

console.log(`[app:build] ${OUT} (${COPY_FILES.length} archivos + vendor/phaser.min.js + OAuth callbacks)`);
