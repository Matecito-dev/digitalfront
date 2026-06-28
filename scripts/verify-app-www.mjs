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
  'auth-oauth.js',
  'auth-ui.js',
  'session-boot.js',
  'game-loader.js',
  'game-core.js',
  'oauth-callback.html',
  'version.js',
  'terrain-tactics.js',
  'tactical-orders.js',
  'path-worker.js',
  'tile-sw.js',
  'vendor/phaser.min.js',
  'auth/x/callback/index.html',
  'auth/github/callback/index.html',
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
  if (!html.includes('./hud.css')) {
    console.error('[app:verify] FAIL index.html missing hud.css');
    ok = false;
  }
  if (!html.includes('game-loader.js')) {
    console.error('[app:verify] FAIL index.html missing game-loader.js');
    ok = false;
  }
  for (const script of ['session-boot.js', 'auth-ui.js', 'game-loader.js', 'auth-oauth.js']) {
    if (!html.includes(script)) {
      console.error(`[app:verify] FAIL index.html missing reference to ${script}`);
      ok = false;
    }
  }
  for (const sub of ['auth/x/callback/index.html', 'auth/github/callback/index.html']) {
    const cb = await readFile(join(OUT, sub), 'utf8');
    if (!cb.includes('handleOAuthCallback')) {
      console.error(`[app:verify] FAIL ${sub} missing OAuth handler`);
      ok = false;
    }
  }
}

if (!ok) process.exit(1);
console.log('[app:verify] All checks passed');
