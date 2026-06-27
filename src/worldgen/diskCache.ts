// Disk-based tile cache — stores pre-generated binary tiles and overview.
//
// Structure:
//   .tile-cache/
//     {seed}/
//       overview.bin.gz
//       {tx}_{ty}.bin.gz
//
// All files are gzip-compressed binary (tileBinary format).
// Reading from cache = fs.readFileSync → no CPU cost, serves thousands of users.

import fs   from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_ROOT = (process.env.DF_TILE_CACHE ?? process.env.VELIS_TILE_CACHE)
  ? path.resolve(process.env.DF_TILE_CACHE ?? process.env.VELIS_TILE_CACHE!)
  : path.resolve(__dirname, '..', '..', '.tile-cache');

export function cacheDir(seed: number): string {
  return path.join(CACHE_ROOT, String(seed));
}

export function tileKey(tx: number, ty: number): string { return `${tx}_${ty}`; }

export function tilePath(seed: number, tx: number, ty: number): string {
  return path.join(cacheDir(seed), `${tileKey(tx, ty)}.bin.gz`);
}

export function tileWebpPath(seed: number, tx: number, ty: number): string {
  return path.join(cacheDir(seed), "webp", `${tileKey(tx, ty)}.webp`);
}

export function tilePngPath(seed: number, tx: number, ty: number): string {
  return path.join(cacheDir(seed), "png", `${tileKey(tx, ty)}.png`);
}

export function hasTileWebp(seed: number, tx: number, ty: number): boolean {
  return fs.existsSync(tileWebpPath(seed, tx, ty));
}

export function hasTilePng(seed: number, tx: number, ty: number): boolean {
  return fs.existsSync(tilePngPath(seed, tx, ty));
}

export function saveTileWebp(seed: number, tx: number, ty: number, buf: Buffer): void {
  const p = tileWebpPath(seed, tx, ty);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
}

export function saveTilePng(seed: number, tx: number, ty: number, buf: Buffer): void {
  const p = tilePngPath(seed, tx, ty);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
}

export function loadTileWebp(seed: number, tx: number, ty: number): Buffer {
  return fs.readFileSync(tileWebpPath(seed, tx, ty));
}

export function loadTilePng(seed: number, tx: number, ty: number): Buffer {
  return fs.readFileSync(tilePngPath(seed, tx, ty));
}

export function overviewPath(seed: number): string {
  return path.join(cacheDir(seed), 'overview.bin.gz');
}

// Pre-rendered overview image (browser decodes natively on the GPU — no JS render).
export function overviewPngPath(seed: number): string {
  return path.join(cacheDir(seed), 'overview.png');
}
export function hasOverviewPng(seed: number): boolean {
  return fs.existsSync(overviewPngPath(seed));
}
export function saveOverviewPng(seed: number, buf: Buffer): void {
  fs.mkdirSync(cacheDir(seed), { recursive: true });
  fs.writeFileSync(overviewPngPath(seed), buf);
}
export function loadOverviewPng(seed: number): Buffer {
  return fs.readFileSync(overviewPngPath(seed));
}

export function hasTile(seed: number, tx: number, ty: number): boolean {
  return fs.existsSync(tilePath(seed, tx, ty));
}

export function hasOverview(seed: number): boolean {
  return fs.existsSync(overviewPath(seed));
}

export function saveTile(seed: number, tx: number, ty: number, raw: Buffer): void {
  fs.mkdirSync(cacheDir(seed), { recursive: true });
  fs.writeFileSync(tilePath(seed, tx, ty), zlib.gzipSync(raw, { level: 6 }));
}

export function saveOverview(seed: number, raw: Buffer): void {
  fs.mkdirSync(cacheDir(seed), { recursive: true });
  fs.writeFileSync(overviewPath(seed), zlib.gzipSync(raw, { level: 6 }));
}

export function loadTileGz(seed: number, tx: number, ty: number): Buffer {
  return fs.readFileSync(tilePath(seed, tx, ty));
}

export function loadOverviewGz(seed: number): Buffer {
  return fs.readFileSync(overviewPath(seed));
}

// Serialized macro world — lets a serve-only server skip the ~8.6s pipeline.
export function macroPath(seed: number): string {
  return path.join(cacheDir(seed), 'macro.bin.gz');
}
export function hasMacro(seed: number): boolean {
  return fs.existsSync(macroPath(seed));
}
export function saveMacro(seed: number, raw: Buffer): void {
  fs.mkdirSync(cacheDir(seed), { recursive: true });
  fs.writeFileSync(macroPath(seed), zlib.gzipSync(raw, { level: 6 }));
}
export function loadMacro(seed: number): Buffer {
  return zlib.gunzipSync(fs.readFileSync(macroPath(seed)));
}

// World metadata JSON (pois/regions/climate/histogram) — instant /api/world.
export function worldMetaPath(seed: number): string {
  return path.join(cacheDir(seed), 'meta.json');
}
export function hasWorldMeta(seed: number): boolean {
  return fs.existsSync(worldMetaPath(seed));
}
export function saveWorldMeta(seed: number, json: string): void {
  fs.mkdirSync(cacheDir(seed), { recursive: true });
  fs.writeFileSync(worldMetaPath(seed), json);
}
export function loadWorldMeta(seed: number): any {
  return JSON.parse(fs.readFileSync(worldMetaPath(seed), 'utf8'));
}

/** Returns count of cached tiles for a given seed.
 *  readdir over a full seed (~49k files) is ~40ms, and this is called on the hot
 *  /api/world path, so the result is memoized with a short TTL. */
const _tileCountCache = new Map<number, { n: number; at: number }>();
const _TILE_COUNT_TTL = 3000;
export function cachedTileCount(seed: number): number {
  const c = _tileCountCache.get(seed);
  if (c && Date.now() - c.at < _TILE_COUNT_TTL) return c.n;
  let n = 0;
  try {
    n = fs.readdirSync(cacheDir(seed)).filter(f => f.endsWith('.bin.gz') && f !== 'overview.bin.gz').length;
  } catch { n = 0; }
  _tileCountCache.set(seed, { n, at: Date.now() });
  return n;
}
