// Pre-generates all tiles for one or more seeds and saves to .tile-cache/.
// Run once per seed before deploying; serving from cache is CPU-free.
//
// Usage:
//   npx tsx scripts/generate-world.ts [seed] [seed2] ...
//   npx tsx scripts/generate-world.ts 42 1337 999
//   npx tsx scripts/generate-world.ts          # defaults to seed 42

import {
  generateMacroWorld, generateTile, generateOverview,
  WORLD_TILES_X, WORLD_TILES_Y, TILE_SIZE,
} from '../src/worldgen/tiling.js';
import { encodeTile }                              from '../src/worldgen/tileBinary.js';
import { renderOverviewPng }                       from '../src/worldgen/overviewImage.js';
import { encodeMacro }                             from '../src/worldgen/macroCache.js';
import { computeWorldMeta }                        from '../src/worldgen/worldMeta.js';
import { saveTile, saveOverview, saveOverviewPng, saveMacro, saveWorldMeta,
         hasTile, hasOverview, hasOverviewPng, hasMacro, hasWorldMeta,
         cachedTileCount, CACHE_ROOT } from '../src/worldgen/diskCache.js';

function bar(n: number, total: number): string {
  const pct = n / total, w = 40;
  return `[${'█'.repeat(Math.round(pct*w))}${'░'.repeat(w-Math.round(pct*w))}] ${n}/${total} (${(pct*100).toFixed(1)}%)`;
}

async function generate(seed: number): Promise<void> {
  const total   = WORLD_TILES_X * WORLD_TILES_Y;
  console.log(`\n🌍  Seed ${seed} — ${WORLD_TILES_X}×${WORLD_TILES_Y} = ${total} tiles`);
  console.log(`    Cache: ${CACHE_ROOT}`);

  const t0    = Date.now();
  const macro = generateMacroWorld(seed, {});
  console.log(`    Macro ready in ${Date.now()-t0}ms`);

  // Persist macro + metadata so a serve-only server answers instantly (no pipeline)
  if (!hasMacro(seed))     { saveMacro(seed, encodeMacro(macro)); console.log(`    Macro cached.`); }
  if (!hasWorldMeta(seed)) { saveWorldMeta(seed, JSON.stringify(computeWorldMeta(macro, seed))); console.log(`    Metadata cached.`); }
  if (!hasOverviewPng(seed)) { saveOverviewPng(seed, renderOverviewPng(macro, {})); console.log(`    Overview PNG cached.`); }
  // The binary overview is optional (client uses the PNG); keep it if present.
  if (!hasOverview(seed)) {
    const ov = generateOverview(macro, {});
    saveOverview(seed, encodeTile(ov.cells as any, ov.heights, ov.hillshade, ov.cols, ov.rows));
    console.log(`    Overview .bin cached (${ov.cols}×${ov.rows}).`);
  }

  const already = cachedTileCount(seed);
  if (already >= total) { console.log(`    All ${total} tiles cached ✓`); return; }

  // Spiral from center outward so the most-visible tiles are cached first
  const cx = WORLD_TILES_X/2, cy = WORLD_TILES_Y/2;
  const pending: [number,number][] = [];
  for (let ty = 0; ty < WORLD_TILES_Y; ty++)
    for (let tx = 0; tx < WORLD_TILES_X; tx++)
      if (!hasTile(seed, tx, ty))
        pending.push([tx, ty]);
  pending.sort(([ax,ay],[bx,by]) => ((ax-cx)**2+(ay-cy)**2) - ((bx-cx)**2+(by-cy)**2));

  console.log(`    ${already}/${total} cached — generating ${pending.length} tiles…`);
  const t1 = Date.now();
  let done = already;

  for (const [tx, ty] of pending) {
    if (hasTile(seed, tx, ty)) { done++; continue; }
    const tile = generateTile(macro, tx, ty, {});
    saveTile(seed, tx, ty, encodeTile(tile.cells as any, tile.heights, tile.hillshade, TILE_SIZE, TILE_SIZE));
    done++;
    if (done % 200 === 0 || done === total) {
      const rate = (done - already) / ((Date.now()-t1)/1000);
      const eta  = pending.length > 0 ? Math.round((total-done)/rate) : 0;
      process.stdout.write(`\r    ${bar(done, total)}  ${rate.toFixed(0)}/s  ETA ${eta}s   `);
    }
  }

  const elapsed = ((Date.now()-t1)/1000).toFixed(1);
  console.log(`\n    Done — ${cachedTileCount(seed)}/${total} tiles in ${elapsed}s`);
}

(async () => {
  const seeds = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
  if (seeds.length === 0) seeds.push(42);
  for (const seed of seeds) await generate(seed);
  console.log('\n✅  Pre-generation complete. npx tsx scripts/viewer-server.ts\n');
})();
