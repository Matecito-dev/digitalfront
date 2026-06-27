#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'app-www');

const REQUIRED = [
  'index.html',
  'hud.css',
  'config.js',
  'capacitor-init.js',
  'branding.js',
  'terrain-tactics.js',
  'tactical-orders.js',
  'path-worker.js',
  'tile-sw.js',
  'vendor/phaser.min.js',
];

let ok = true;
for (const f of REQUIRED) {
  try {
    await access(join(OUT, f));
    console.log(`[app:verify] OK ${f}`);
  } catch {
    console.error(`[app:verify] MISSING ${f}`);
    ok = false;
  }
}

if (ok) {
  const html = await readFile(join(OUT, 'index.html'), 'utf8');
  if (/cdn\.jsdelivr\.net.*phaser/i.test(html)) {
    console.error('[app:verify] FAIL index.html still references Phaser CDN');
    ok = false;
  }
  if (!html.includes('./vendor/phaser.min.js') && !html.includes('vendor/phaser.min.js')) {
    console.error('[app:verify] FAIL index.html missing local Phaser script');
    ok = false;
  }
  if (!html.includes('./hud.css')) {
    console.error('[app:verify] FAIL index.html missing hud.css');
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log('[app:verify] All checks passed');
