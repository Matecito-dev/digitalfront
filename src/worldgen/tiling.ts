// Two-scale tile streaming for continent-scale maps.
//
// MacroWorld (256×192): runs the FULL pipeline (Voronoi + tectonics + climate).
//   Captures global structure: continents, mountain ranges, climate zones.
//   Generated once per seed; served as the overview.
//   Stores moisture + temperature per cell so tiles can match biomes exactly.
//
// Tiles (128×128): generated on demand.
//   Height  = bilinear(macro.heights) + high-freq fBm at GLOBAL coords → seamless
//   Moisture/Temp = bilinear(macro) + tiny fBm variation → same biome character
//   Biomes  = same Whittaker classifier as macro → overview matches zoomed-in view
//
// World size: 64 tiles × 48 tiles × 128 cells = 8 192 × 6 144 cells

import type { TerrainKind } from "./worldTerrainConfigData.js";
import { generateTerrainData, type TerrainData } from "./worldTerrainGenerator.js";
import { computeHillshade } from "./hillshade.js";
import { DEFAULT_PARAMS, type TerrainParams } from "./terrainParams.js";

export const TILE_SIZE     = 128;
export const WORLD_TILES_X = 256;   // C1: WoW scale → 32 768 world cells
export const WORLD_TILES_Y = 192;   // C1: WoW scale → 24 576 world cells
export const MACRO_COLS    = 512;   // C1: higher-res macro → better continent detail
export const MACRO_ROWS    = 384;

export interface MacroWorld {
  seed: number;
  tilesX: number; tilesY: number;
  cols: number; rows: number;           // = MACRO_COLS / MACRO_ROWS
  cells:       TerrainKind[];
  heights:     Uint8Array;
  hillshade:   Uint8Array;
  moisture:    Float32Array;            // 0-1 per macro cell (real orographic)
  temperature: Float32Array;            // 0-1 per macro cell
}

// ── PRNG / noise (global-coordinate fBm for seamless tiles) ──────────────────

function hashU32(x: number, y: number, seed: number): number {
  let h = ((x * 1619 + y * 31337 + seed * 1013) | 0) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function quintic(t: number) { return t*t*t*(t*(t*6-15)+10); }

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = quintic(x-ix), fy = quintic(y-iy);
  return ( hashU32(ix,   iy,   seed) * (1-fx) * (1-fy)
         + hashU32(ix+1, iy,   seed) *    fx  * (1-fy)
         + hashU32(ix,   iy+1, seed) * (1-fx) *    fy
         + hashU32(ix+1, iy+1, seed) *    fx  *    fy  );
}

function fbm(gx: number, gy: number, seed: number, oct = 5): number {
  let v=0, amp=0.5, freq=1, max=0;
  for (let o=0; o<oct; o++) {
    v += valueNoise(gx*freq, gy*freq, (seed + o*1997)|0) * amp;
    max += amp; amp *= 0.5; freq *= 2;
  }
  return v / max;
}

// ── Bilinear sampler ─────────────────────────────────────────────────────────

function sampleF(arr: Uint8Array | Float32Array, cols: number, rows: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(cols-2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(rows-2, Math.floor(y)));
  const fx = x-x0, fy = y-y0;
  return ( arr[ y0   *cols+x0  ] * (1-fx) * (1-fy)
         + arr[ y0   *cols+x0+1] *    fx  * (1-fy)
         + arr[(y0+1)*cols+x0  ] * (1-fx) *    fy
         + arr[(y0+1)*cols+x0+1] *    fx  *    fy  );
}

// ── Biome classifier (mirrors worldTerrainGenerator Whittaker logic) ──────────

function classifyBiome(h: number, m: number, t: number, mThr: number, hThr: number): TerrainKind {
  if (h < 20) return "WATER";
  if (h >= mThr) return "MOUNTAIN";
  if (h >= hThr+6 && t < 0.26) return "MOUNTAIN";
  if (h >= hThr) return "HILLS";
  if (t < 0.10) return "TUNDRA";
  if (h < 34 && m > 0.70 && t > 0.42) return "SWAMP";
  if (t < 0.22) return m > 0.55 ? "TAIGA" : "TUNDRA";
  if (t >= 0.22 && t < 0.40 && m > 0.52) return "TAIGA";
  if (t > 0.74 && m > 0.74) return "JUNGLE";
  if (t > 0.60 && m > 0.30 && m < 0.52) return "SAVANNA";
  if (t > 0.66 && m < 0.30) return "DESERT";
  if (m > 0.58) return "FOREST";
  return "PLAINS";
}

// ── Macro world generation ────────────────────────────────────────────────────

export function generateMacroWorld(seed: number, params: Partial<TerrainParams> = {}): MacroWorld {
  const clean = Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined));
  const p: TerrainParams = {
    ...DEFAULT_PARAMS,
    ...clean,
    numPlates: (clean as any).numPlates ?? 4,   // fewer plates → fewer, bigger continents
    erosionIterations: 0,
    waterPercent: (clean as any).waterPercent ?? 0.28,
  } as TerrainParams;

  const terrain = generateTerrainData(seed, MACRO_COLS, MACRO_ROWS, p);

  const cells = terrain.cells as TerrainKind[];
  const N = MACRO_COLS * MACRO_ROWS;

  // ── Continental separation mask ─────────────────────────────────────────────
  // Canales oceánicos anchos y pocos — el umbral 0.34 anterior perforaba ~34%
  // del terreno y generaba cientos de islitas.
  {
    for (let row = 0; row < MACRO_ROWS; row++) {
      for (let col = 0; col < MACRO_COLS; col++) {
        const i = row * MACRO_COLS + col;
        if (cells[i] === "WATER") continue;
        const basin = fbm(col / MACRO_COLS * 0.9, row / MACRO_ROWS * 0.9, (seed ^ 0xbadcafe) | 0, 2);
        if (basin < 0.10) {
          terrain.heights[i] = 0;
          cells[i] = "WATER";
          if (terrain.moisture) terrain.moisture[i] = 0.5;
        }
      }
    }
  }

  // ── Post-process: remove small islands (merge into ocean) ──────────────────
  const MIN_ISLAND = Math.round(MACRO_COLS * MACRO_ROWS * 0.045); // 4.5%
  {
    const visited = new Uint8Array(N);
    for (let start = 0; start < N; start++) {
      if (visited[start] || cells[start] === "WATER") continue;
      const component: number[] = [];
      const q = [start]; visited[start] = 1; let head = 0;
      while (head < q.length) {
        const ci = q[head++]; component.push(ci);
        const cc = ci % MACRO_COLS, cr = Math.floor(ci / MACRO_COLS);
        for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr=cr+dr, nc=cc+dc;
          if (nr<0||nc<0||nr>=MACRO_ROWS||nc>=MACRO_COLS) continue;
          const ni=nr*MACRO_COLS+nc;
          if (!visited[ni] && cells[ni] !== "WATER") { visited[ni]=1; q.push(ni); }
        }
      }
      if (component.length < MIN_ISLAND) {
        for (const ci of component) {
          cells[ci] = "WATER";
          terrain.heights[ci] = 0;
          if (terrain.moisture) terrain.moisture[ci] = 0.5;
        }
      }
    }
  }

  // ── Keep only major continents (sink tiny stray landmasses) ─────────────────
  {
    const MIN_CONTINENT = Math.round(N * 0.022); // 2.2% del mapa
    const MAX_CONTINENTS = 6;
    const visited3 = new Uint8Array(N);
    const landComps: number[][] = [];
    for (let start = 0; start < N; start++) {
      if (visited3[start] || cells[start] === "WATER") continue;
      const comp: number[] = [];
      const q = [start]; visited3[start] = 1; let head = 0;
      while (head < q.length) {
        const ci = q[head++]; comp.push(ci);
        const cc = ci % MACRO_COLS, cr = Math.floor(ci / MACRO_COLS);
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= MACRO_ROWS || nc >= MACRO_COLS) continue;
          const ni = nr * MACRO_COLS + nc;
          if (!visited3[ni] && cells[ni] !== "WATER") { visited3[ni] = 1; q.push(ni); }
        }
      }
      landComps.push(comp);
    }
    landComps.sort((a, b) => b.length - a.length);
    for (let i = 0; i < landComps.length; i++) {
      const comp = landComps[i];
      if (i < MAX_CONTINENTS && comp.length >= MIN_CONTINENT) continue;
      for (const ci of comp) {
        cells[ci] = "WATER";
        terrain.heights[ci] = 0;
        if (terrain.moisture) terrain.moisture[ci] = 0.5;
      }
    }
  }

  // ── Also merge small ocean pockets into nearest coast biome ──────────────
  // (tiny lagoons surrounded by land look noisy at macro scale)
  {
    const MIN_OCEAN_POCKET = 20;
    const visited2 = new Uint8Array(N);
    for (let start = 0; start < N; start++) {
      if (visited2[start] || cells[start] !== "WATER") continue;
      const component: number[] = [];
      const q = [start]; visited2[start]=1; let head=0; let touchesBorder=false;
      while (head < q.length) {
        const ci = q[head++]; component.push(ci);
        const cc=ci%MACRO_COLS, cr=Math.floor(ci/MACRO_COLS);
        if (cc===0||cr===0||cc===MACRO_COLS-1||cr===MACRO_ROWS-1) touchesBorder=true;
        for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr=cr+dr, nc=cc+dc;
          if (nr<0||nc<0||nr>=MACRO_ROWS||nc>=MACRO_COLS) continue;
          const ni=nr*MACRO_COLS+nc;
          if (!visited2[ni] && cells[ni]==="WATER") { visited2[ni]=1; q.push(ni); }
        }
      }
      if (!touchesBorder && component.length < MIN_OCEAN_POCKET) {
        for (const ci of component) {
          cells[ci] = "PLAINS";
          terrain.heights[ci] = 30;
        }
      }
    }
  }

  return {
    seed,
    tilesX: WORLD_TILES_X, tilesY: WORLD_TILES_Y,
    cols: MACRO_COLS, rows: MACRO_ROWS,
    cells,
    heights:     terrain.heights,
    hillshade:   terrain.hillshade,
    moisture:    terrain.moisture    ?? new Float32Array(N).fill(0.5),
    temperature: terrain.temperature ?? new Float32Array(N).fill(0.5),
  };
}

// ── Shared per-cell evaluation (coast-aware) ──────────────────────────────────
// Used by BOTH generateTile and generateOverview so coastlines + meso relief are
// identical at every zoom level → loading tiles only sharpens, never reshapes.
//
// Coast logic (fixes "weird islands instead of coast"):
//   The shoreline is defined by a SMOOTH low-frequency field (macroH + coastWarp),
//   not by high-amplitude noise. Meso/detail relief is damped to 0 at the shore so
//   it can never punch islands into the sea or holes into the land. Asymmetric
//   clamps guarantee land never sinks below sea level and sea never emerges.

const SEA          = 20;   // sea level (worldTerrainGenerator shifts heights so the
                           // water percentile lands exactly here)
const COAST_SCALE  = 56;   // low-freq shoreline warp → natural bays/capes
const COAST_AMP    = 7;
const COAST_FAR    = 22;   // relief-damping band width around sea level
const DETAIL_SCALE = 24;
const DETAIL_AMP   = 8;
const MESO_SCALE   = 96;
const MESO_AMP     = 14;
const MOIST_SCALE  = 48;
const MOIST_VAR    = 0.08;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface CellEval { h: number; cell: TerrainKind; }

function evalWorldCell(
  macro: MacroWorld,
  gx: number, gy: number,        // global world-cell coords
  worldW: number, worldH: number,
  p: TerrainParams,
  fineDetail: boolean,
): CellEval {
  // Sample position in macro grid + bilinear macro fields
  const mx = (gx + 0.5) / worldW * macro.cols;
  const my = (gy + 0.5) / worldH * macro.rows;
  const macroH = sampleF(macro.heights,     macro.cols, macro.rows, mx, my);
  const macroM = sampleF(macro.moisture,    macro.cols, macro.rows, mx, my);
  const macroT = sampleF(macro.temperature, macro.cols, macro.rows, mx, my);

  // Low-freq coastal warp — weighted by proximity to shore so deep ocean and
  // deep interior are never warped (eliminates false islands in open sea).
  const rawWarp     = (fbm(gx/COAST_SCALE, gy/COAST_SCALE, (macro.seed^0x5eed)|0, 3) - 0.5) * 2 * COAST_AMP;
  const shoreProx   = smoothstep(COAST_FAR * 3.5, 0, Math.abs(macroH - SEA));
  const coastWarp   = rawWarp * shoreProx;
  const baseH = macroH + coastWarp;

  const meso   = (fbm(gx/MESO_SCALE,   gy/MESO_SCALE,   (macro.seed^0xdeadbeef)|0, 4) - 0.5) * 2 * MESO_AMP;
  const detail = fineDetail ? (fbm(gx/DETAIL_SCALE, gy/DETAIL_SCALE, macro.seed, 5) - 0.5) * 2 * DETAIL_AMP : 0;

  let h: number;
  if (baseH >= SEA) {
    // LAND: full relief inland, damped to 0 at the shore; never sinks below sea
    const damp = smoothstep(0, COAST_FAR, baseH - SEA);
    h = Math.max(SEA, Math.min(100, baseH + (meso + detail) * damp));
  } else {
    // SEA: gentle seabed variation, never emerges above sea level
    const sb = smoothstep(0, COAST_FAR, SEA - baseH);
    h = Math.max(0, Math.min(SEA - 1, baseH + meso * 0.25 * sb));
  }

  const detailM = (fbm(gx/MOIST_SCALE, gy/MOIST_SCALE, (macro.seed^0xabcdef)|0, 3) - 0.5) * 2 * MOIST_VAR;
  const moisture = Math.min(1, Math.max(0, macroM + detailM));

  return {
    h: Math.round(h),
    cell: classifyBiome(h, moisture, macroT, p.mountainThreshold, p.hillsThreshold),
  };
}

// ── Tile generation (seamless + biome-consistent with macro) ─────────────────

export function generateTile(
  macro: MacroWorld,
  tx: number, ty: number,
  params: Partial<TerrainParams> = {},
): TerrainData {
  const clean = Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined));
  const p = { ...DEFAULT_PARAMS, ...clean } as TerrainParams;

  const TS = TILE_SIZE;       // 128
  const N  = TS * TS;
  const heights = new Uint8Array(N);
  const cells: TerrainKind[] = new Array(N);

  const worldW = macro.tilesX * TS;
  const worldH = macro.tilesY * TS;

  for (let ly = 0; ly < TS; ly++) {
    for (let lx = 0; lx < TS; lx++) {
      const gx = tx * TS + lx;
      const gy = ty * TS + ly;
      const { h, cell } = evalWorldCell(macro, gx, gy, worldW, worldH, p, true);
      heights[ly * TS + lx] = h;
      cells  [ly * TS + lx] = cell;
    }
  }

  const hillshade = computeHillshade(heights, TS, TS);
  return { cells, heights, hillshade };
}

// ── Overview generation (same coast/meso logic as tiles, higher resolution) ───
// Renders the whole world at `scale`× macro resolution using evalWorldCell so the
// overview's coastlines and meso relief match the tiles exactly. fineDetail=false
// avoids aliasing the 24-cell noise at this lower sampling density; tiles add it.

export interface OverviewData extends TerrainData { cols: number; rows: number; }

export function generateOverview(
  macro: MacroWorld,
  params: Partial<TerrainParams> = {},
  scale = 2,
): OverviewData {
  const clean = Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined));
  const p = { ...DEFAULT_PARAMS, ...clean } as TerrainParams;

  const cols = macro.cols * scale;   // 1024
  const rows = macro.rows * scale;   // 768
  const N    = cols * rows;
  const heights = new Uint8Array(N);
  const cells: TerrainKind[] = new Array(N);

  const worldW = macro.tilesX * TILE_SIZE;
  const worldH = macro.tilesY * TILE_SIZE;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Global world-cell coords at the center of this overview pixel
      const gx = (x + 0.5) / cols * worldW - 0.5;
      const gy = (y + 0.5) / rows * worldH - 0.5;
      const { h, cell } = evalWorldCell(macro, gx, gy, worldW, worldH, p, false);
      heights[y * cols + x] = h;
      cells  [y * cols + x] = cell;
    }
  }

  const hillshade = computeHillshade(heights, cols, rows);
  return { cells, heights, hillshade, cols, rows };
}

// ── LRU Tile Cache ────────────────────────────────────────────────────────────

export class TileCache {
  private cache = new Map<string, TerrainData>();
  private readonly maxSize: number;
  constructor(maxSize = 256) { this.maxSize = maxSize; }
  key(seed: number, tx: number, ty: number) { return `${seed}:${tx}:${ty}`; }
  get(seed: number, tx: number, ty: number) {
    const k = this.key(seed,tx,ty);
    if (!this.cache.has(k)) return undefined;
    const v = this.cache.get(k)!; this.cache.delete(k); this.cache.set(k,v); return v;
  }
  set(seed: number, tx: number, ty: number, data: TerrainData) {
    const k = this.key(seed,tx,ty);
    if (this.cache.size >= this.maxSize) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(k, data);
  }
}
