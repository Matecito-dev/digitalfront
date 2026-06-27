#!/usr/bin/env node
/** Empaqueta viewer/ para deploy estático en Vercel (HTTPS → backend remoto). */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = join(ROOT, 'viewer');
const OUT = join(ROOT, 'web');

const versionInfo = JSON.parse(await readFile(join(ROOT, 'version.json'), 'utf8'));

const apiBase = (process.env.DF_API_URL ?? process.env.VELIS_API_URL ?? 'https://api.gamedevforge.com').replace(/\/$/, '');
const siteUrl = (process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`
  : (process.env.DF_SITE_URL ?? process.env.VELIS_SITE_URL)?.replace(/\/$/, '') ?? '');

function isOAuthPlaceholder(v) {
  if (!v) return true;
  const s = String(v).trim();
  return s.startsWith('your_') || s.endsWith('_here');
}

function oauthBuildEntry(clientId, redirectUri, fallbackRedirect) {
  const id = clientId?.trim();
  const uri = (redirectUri?.trim() || fallbackRedirect)?.trim();
  if (isOAuthPlaceholder(id) || !uri) return null;
  return { clientId: id, redirectUri: uri };
}

const playBase = (process.env.DF_SITE_URL ?? process.env.VELIS_SITE_URL ?? 'https://play.gamedevforge.com').replace(/\/$/, '');
const dfOAuth = {
  github: oauthBuildEntry(
    process.env.GITHUB_CLIENT_ID,
    process.env.GITHUB_REDIRECT_URI,
    `${playBase}/auth/github/callback`,
  ),
  x: oauthBuildEntry(
    process.env.X_CLIENT_ID,
    process.env.X_REDIRECT_URI,
    `${playBase}/auth/x/callback`,
  ),
};

const COPY_FILES = [
  'branding.js',
  'auth-oauth.js',
  'version.js',
  'terrain-tactics.js',
  'tactical-orders.js',
  'path-worker.js',
  'tile-sw.js',
  'hud.css',
  'config.js',
  'capacitor-init.js',
  'og-cover.png',
];

const COPY_DIRS = ['audio', 'assets'];

await mkdir(join(OUT, 'vendor'), { recursive: true });

for (const f of COPY_FILES) {
  await cp(join(VIEWER, f), join(OUT, f));
}

for (const d of COPY_DIRS) {
  await cp(join(VIEWER, d), join(OUT, d), { recursive: true });
}

await cp(join(VIEWER, 'vendor', 'phaser.min.js'), join(OUT, 'vendor', 'phaser.min.js'));

let html = await readFile(join(VIEWER, 'index.html'), 'utf8');
html = html
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/phaser@[^"']+/g, './vendor/phaser.min.js')
  .replace(/src="\/terrain-tactics\.js"/g, 'src="./terrain-tactics.js"')
  .replace(/src="\/tactical-orders\.js"/g, 'src="./tactical-orders.js"')
  .replace(/src="config\.js"/g, 'src="./config.js"')
  .replace(/src="branding\.js"/g, 'src="./branding.js"')
  .replace(/src="auth-oauth\.js"/g, 'src="./auth-oauth.js"')
  .replace(/src="terrain-tactics\.js"/g, 'src="./terrain-tactics.js"')
  .replace(/src="tactical-orders\.js"/g, 'src="./tactical-orders.js"')
  .replace(/src="capacitor-init\.js"/g, 'src="./capacitor-init.js"')
  .replace(/src="audio\/sfx\.js"/g, 'src="./audio/sfx.js"')
  .replace(/src="audio\/bgm\.js"/g, 'src="./audio/bgm.js"')
  .replace(/href="hud\.css"/g, 'href="./hud.css"')
  .replace(/src="vendor\/phaser\.min\.js"/g, 'src="./vendor/phaser.min.js"')
  .replace(/new Worker\('\/path-worker\.js'\)/g, "new Worker('./path-worker.js')")
  .replace(/new Worker\("\/path-worker\.js"\)/g, 'new Worker("./path-worker.js")');

if (siteUrl) {
  html = html.replace(
    /content="\.\/og-cover\.png"/g,
    `content="${siteUrl}/og-cover.png"`,
  );
}

await writeFile(join(OUT, 'index.html'), html);

const configJs = `/** Generado por build:web — API remota en Vercel */
window.DF_CONFIG = {
  apiBase: "${apiBase}",
  wsPath: "/api/sim/ws",
};
window.DF_OAUTH = ${JSON.stringify(dfOAuth)};
window.VELIS_CONFIG = window.DF_CONFIG;
`;
await writeFile(join(OUT, 'config.js'), configJs);

const versionJs = `/** Generado por build:web — version.json */
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

await writeFile(
  join(OUT, 'README.txt'),
  'Generado por npm run build:web — deploy estático Vercel.\n',
);

console.log(`[build:web] ${OUT} → apiBase=${apiBase}`);
