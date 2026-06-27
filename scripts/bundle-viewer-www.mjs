#!/usr/bin/env node
/** Empaqueta viewer/ Phaser (juego completo) para Capacitor Android — sin CDN. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = join(ROOT, 'viewer');
const OUT = join(ROOT, 'app-www');

const COPY_FILES = [
  'branding.js',
  'terrain-tactics.js',
  'tactical-orders.js',
  'path-worker.js',
  'tile-sw.js',
  'hud.css',
  'config.js',
  'capacitor-init.js',
];

const serverUrl = (process.env.DF_SERVER_URL ?? process.env.VELIS_SERVER_URL)?.replace(/\/$/, '') ?? '';

await mkdir(join(OUT, 'vendor'), { recursive: true });

for (const f of COPY_FILES) {
  await cp(join(VIEWER, f), join(OUT, f));
}

await cp(join(VIEWER, 'vendor', 'phaser.min.js'), join(OUT, 'vendor', 'phaser.min.js'));

let html = await readFile(join(VIEWER, 'index.html'), 'utf8');
html = html
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/phaser@[^"']+/g, './vendor/phaser.min.js')
  .replace(/src="\/terrain-tactics\.js"/g, 'src="./terrain-tactics.js"')
  .replace(/src="\/tactical-orders\.js"/g, 'src="./tactical-orders.js"')
  .replace(/src="config\.js"/g, 'src="./config.js"')
  .replace(/src="branding\.js"/g, 'src="./branding.js"')
  .replace(/src="terrain-tactics\.js"/g, 'src="./terrain-tactics.js"')
  .replace(/src="tactical-orders\.js"/g, 'src="./tactical-orders.js"')
  .replace(/src="capacitor-init\.js"/g, 'src="./capacitor-init.js"')
  .replace(/href="hud\.css"/g, 'href="./hud.css"')
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

await writeFile(
  join(OUT, 'README.txt'),
  'Generado por npm run app:build — juego Phaser completo para Capacitor.\n',
);

console.log(`[app:build] ${OUT} (${COPY_FILES.length + 2} archivos + vendor/phaser.min.js)`);
