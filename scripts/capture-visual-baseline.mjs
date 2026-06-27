#!/usr/bin/env node
/**
 * Stub Fase 0 — captura automatizada de baseline visual.
 *
 * Uso (servidor viewer ya en marcha):
 *   node scripts/capture-visual-baseline.mjs
 *   node scripts/capture-visual-baseline.mjs --url http://127.0.0.1:3000 --out docs/visual-baseline/captures
 *
 * Requiere Playwright (opcional, no en package.json por defecto):
 *   npm i -D playwright && npx playwright install chromium
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    url: 'http://127.0.0.1:3000/',
    out: join(ROOT, 'docs/visual-baseline/captures'),
    waitMs: 12_000,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--url') opts.url = argv[++i];
    else if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--wait-ms') opts.waitMs = Number(argv[++i]);
  }
  return opts;
}

async function loadPlaywright(outDir) {
  try {
    return await import('playwright');
  } catch {
    const readme = join(ROOT, 'docs/visual-baseline/README.md');
    const stub = `# Stub — Playwright no instalado

Ejecuta manualmente las capturas descritas en README.md
o instala: npm i -D playwright && npx playwright install chromium
`;
    await mkdir(outDir, { recursive: true }).catch(() => {});
    console.warn('[capture-visual-baseline] Playwright no disponible.');
    console.warn('  Instala: npm i -D playwright && npx playwright install chromium');
    console.warn(`  Guía manual: ${readme}`);
    await writeFile(join(outDir, 'README-STUB.txt'), stub.trim() + '\n').catch(() => {});
    return null;
  }
}

const opts = parseArgs(process.argv);

async function main() {
  await mkdir(opts.out, { recursive: true });

  const pw = await loadPlaywright(opts.out);
  if (!pw) {
    process.exitCode = 0;
    return;
  }

  const { chromium } = pw;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log(`[capture] ${opts.url} → ${opts.out}`);
  await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(opts.waitMs);

  await page.keyboard.press('f');
  await page.waitForTimeout(1500);

  const shots = [
    { name: 'baseline-tactical-idle.png', wait: 500 },
    { name: 'baseline-tactical-move.png', wait: 0, action: async () => {
      await page.mouse.click(960, 540);
      await page.waitForTimeout(300);
    }},
  ];

  for (const shot of shots) {
    if (shot.action) await shot.action();
    await page.waitForTimeout(shot.wait ?? 300);
    const path = join(opts.out, shot.name);
    await page.screenshot({ path, fullPage: false });
    console.log(`  ✓ ${shot.name}`);
  }

  await browser.close();
  console.log('[capture] Listo. Revisar checklist en docs/visual-baseline/README.md');
}

main().catch(err => {
  console.error('[capture-visual-baseline]', err);
  process.exitCode = 1;
});
