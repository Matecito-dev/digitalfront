import type { TerrainKind } from "./worldTerrainConfigData.js";
import { generateCellHeightmap } from "./voronoiHeightmap.js";
import { buildSiteOfPixel } from "./voronoiGraph.js";
import { applyTectonics } from "./tectonics.js";
import { hydraulicErosion } from "./hydraulicErosion.js";
import { computeClimate } from "./climate.js";
import { computeHillshade } from "./hillshade.js";
import { DEFAULT_PARAMS, type TerrainParams } from "./terrainParams.js";

// ── PRNG ─────────────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── VALUE NOISE (for moisture FBM) ───────────────────────────────────────────

function hash(x: number, y: number, seed: number): number {
  const n = (x * 1619 + y * 31337 + seed * 1013) | 0;
  const m = (n ^ (n << 13)) ^ n;
  return (1 - ((m * (m * m * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824) * 0.5 + 0.5;
}

function quintic(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number): number { return a + t * (b - a); }

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = quintic(x - ix), fy = quintic(y - iy);
  return lerp(
    lerp(hash(ix, iy, seed), hash(ix + 1, iy, seed), fx),
    lerp(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), fx),
    fy
  );
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let v = 0, amp = 0.5, freq = 1.0, max = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * freq, y * freq, seed + i * 1997) * amp;
    max += amp; amp *= 0.5; freq *= 2.0;
  }
  return v / max;
}

// ── RANK-PERCENTILE ──────────────────────────────────────────────────────────

function rankPercentile(arr: Float32Array): Float32Array {
  const n = arr.length;
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  indices.sort((a, b) => arr[a] - arr[b]);
  const result = new Float32Array(n);
  for (let rank = 0; rank < n; rank++) result[indices[rank]] = rank / (n - 1);
  return result;
}

// ── DEPRESSION FILLING (Azgaar preprocessing for rivers) ─────────────────────
// Raises each land cell that is lower than all its neighbors by a tiny amount,
// so greedy descent always finds a downhill path to water. Iterative.
function fillDepressions(h: Float32Array, cols: number, rows: number, iterations = 5) {
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const i = row * cols + col;
        if (h[i] < 20) continue; // skip water
        let minNb = h[i];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nb = (row + dr) * cols + (col + dc);
            if (h[nb] < minNb) minNb = h[nb];
          }
        }
        if (minNb >= h[i] && h[i] > 20) {
          // Depression: raise just above minimum neighbor
          h[i] = minNb + 0.15;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

// ── FLUX-BASED RIVERS (Azgaar-style precipitation accumulation) ──────────────
// Each land cell accumulates precipitation flux from higher neighbors.
// Cells processed high→low; flux transferred to the lowest neighbor.
// River tiles form where accumulated flux exceeds MIN_FLUX.
// Rivers widen toward the mouth (higher flux = wider river).
function traceFluxRivers(
  h: Float32Array,
  cells: TerrainKind[],
  cols: number,
  rows: number,
  rng: () => number
): void {
  const N = cols * rows;

  // Biomes that can carry/generate rivers. Biomes NOT in this set act as
  // sinks: they absorb flux without passing it downstream, preventing mountain
  // runoff from creating rivers in plains/savanna/desert that have no rainfall.
  const RIVER_BIOMES = new Set<TerrainKind>(["JUNGLE","SWAMP","FOREST","TAIGA","HILLS","MOUNTAIN","COAST"]);
  // Base precipitation only for source biomes (multiplier on 1.0).
  const BIOME_PREC: Partial<Record<TerrainKind, number>> = {
    JUNGLE: 2.0, SWAMP: 1.6, FOREST: 1.0, TAIGA: 0.7, HILLS: 0.6, MOUNTAIN: 0.5, COAST: 0.3,
  };
  const prec = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (h[i] < 20) continue;
    const mult = BIOME_PREC[cells[i] as TerrainKind] ?? 0;
    if (mult > 0) prec[i] = mult * (0.8 + rng() * 0.4);
  }

  // Sort land cells high→low
  const landCells: number[] = [];
  for (let i = 0; i < N; i++) if (h[i] >= 20) landCells.push(i);
  landCells.sort((a, b) => h[b] - h[a]);

  const flux = new Float32Array(N);
  for (const i of landCells) flux[i] = prec[i];

  // Accumulate flux downhill — 4-directional only (NSEW).
  // Flux is ABSORBED (not passed on) when it enters a non-river biome
  // (plains, savanna, desert, tundra). This means mountain runoff cannot
  // create rivers in flat dry biomes.
  for (const i of landCells) {
    if (!RIVER_BIOMES.has(cells[i] as TerrainKind)) continue; // sink: don't pass flux on
    const col = i % cols, row = Math.floor(i / cols);
    let bestNb = -1, bestH = h[i];
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nb = nr * cols + nc;
      if (h[nb] < bestH) { bestH = h[nb]; bestNb = nb; }
    }
    if (bestNb >= 0) flux[bestNb] += flux[i];
  }

  // Only top 0.08% of flux (within RIVER_BIOMES) become narrow tributaries,
  // and top 0.02% become wide rivers. At 2200×2200 with ~30% river biomes
  // that is ~1150 tributary cells and ~290 wide-river cells — a handful of
  // rivers visible at any zoom level, not a web scattered across every forest.
  const riverBiomeCells = landCells.filter(i => RIVER_BIOMES.has(cells[i] as TerrainKind));
  const landFluxValues = riverBiomeCells.map(i => flux[i]).filter(f => f > 0);
  landFluxValues.sort((a, b) => a - b);
  const pct9992 = landFluxValues[Math.floor(landFluxValues.length * 0.9992)] ?? 999999;
  const pct9998 = landFluxValues[Math.floor(landFluxValues.length * 0.9998)] ?? 999999;

  for (let i = 0; i < N; i++) {
    if (h[i] < 20 || h[i] >= 72) continue;
    if (!RIVER_BIOMES.has(cells[i] as TerrainKind)) continue;
    if (flux[i] >= pct9998) {
      cells[i] = "WATER"; // wide river (dilated below)
    } else if (flux[i] >= pct9992) {
      cells[i] = "COAST"; // narrow tributaries
    }
  }

  // Dilate wide-river WATER cells by 1 neighbor to make them 2-3px wide.
  const riverWater = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (cells[i] === "WATER" && h[i] >= 20 && h[i] < 72) riverWater[i] = 1;
  }
  for (let i = 0; i < N; i++) {
    if (!riverWater[i]) continue;
    const col = i % cols, row = Math.floor(i / cols);
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (h[ni] >= 20 && h[ni] < 72 && cells[ni] !== "WATER") cells[ni] = "WATER";
    }
  }

  // Delta fans: river WATER cells that border ocean WATER get extra spread.
  for (let i = 0; i < N; i++) {
    if (!riverWater[i]) continue;
    const col = i % cols, row = Math.floor(i / cols);
    let nearOcean = false;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      if (h[nr * cols + nc] < 20) { nearOcean = true; break; }
    }
    if (!nearOcean) continue;
    // Spread 2 cells in cardinal directions into ocean
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]] as const) {
      for (let step = 1; step <= 2; step++) {
        const nc = col + dc * step, nr = row + dr * step;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (h[ni] < 20) cells[ni] = "WATER"; // already ocean, keeps same color but marks as delta
      }
    }
  }
}

// ── TERRAIN GENERATION ────────────────────────────────────────────────────────

export type TerrainData = {
  cells: TerrainKind[];
  heights: Uint8Array;
  hillshade: Uint8Array;
  // Populated by generateTerrainData; server uses these for seamless tile biome consistency.
  moisture?: Float32Array;
  temperature?: Float32Array;
};

export function generateTerrainData(seed: number, cols: number, rows: number, params: TerrainParams = DEFAULT_PARAMS): TerrainData {
  const N = cols * rows;
  const rng = mulberry32(seed + 77777);

  // ── Step 1: Voronoi-cell heightmap, rasterized to the grid ────────────────
  // Generation happens on an irregular Voronoi cell graph (organic, no grid
  // artifacts), then every grid pixel takes its owning cell's height.
  const targetCells = Math.max(2000, Math.min(30000, Math.round(N / 18)));
  const cellHm = generateCellHeightmap(seed, cols, rows, targetCells);
  // Domain-warp the rasterization so coastlines and biome edges are organic, not faceted.
  const siteOfPixel = buildSiteOfPixel(cellHm.graph, { seed: (seed * 7919 + 13) | 0, warpAmp: 5, warpScale: 0.05 });
  const hg = { h: new Float32Array(N), cols, rows };
  for (let i = 0; i < N; i++) hg.h[i] = cellHm.height[siteOfPixel[i]];

  // One light blur pass to remove hard Voronoi facets; keep biome edges sharp.
  {
    for (let pass = 0; pass < 1; pass++) {
      const src = hg.h.slice();
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          let sum = 0, cnt = 0;
          for (let dr = -1; dr <= 1; dr++) {
            const nr = row + dr; if (nr < 0 || nr >= rows) continue;
            for (let dc = -1; dc <= 1; dc++) {
              const nc = col + dc; if (nc < 0 || nc >= cols) continue;
              sum += src[nr * cols + nc]; cnt++;
            }
          }
          hg.h[row * cols + col] = sum / cnt;
        }
      }
    }
  }

  // ── Step 1.5: Plate tectonics ─────────────────────────────────────────────
  applyTectonics(hg.h, cols, rows, seed, params.numPlates, params.upliftStrength, params.riftDepth);

  // ── Step 2: Balance land/water ratio ──────────────────────────────────────
  // Resolution-independent sea level: find the height at the target water
  // percentile and shift the whole map so that value lands exactly on the
  // shoreline (20). The old iterative ±3 loop under-converged on large grids
  // (1400² came out 95% land); this guarantees the same ratio at any resolution.
  {
    const TARGET_WATER = params.waterPercent; // ~88% land — less open ocean, no fringe seas
    const sorted = Float32Array.from(hg.h).sort();
    const seaLevel = sorted[Math.floor(TARGET_WATER * (N - 1))];
    const shift = 20 - seaLevel;
    if (Math.abs(shift) > 0.01) {
      for (let i = 0; i < N; i++) hg.h[i] = Math.min(100, Math.max(0, hg.h[i] + shift));
    }
  }

  // ── Step 2b: Guarantee inland lakes ──────────────────────────────────────
  {
    const minLakes = 2;
    const visited = new Uint8Array(N);
    let lakeCount = 0;
    for (let i = 0; i < N; i++) {
      if (hg.h[i] >= 20 || visited[i]) continue;
      const q: number[] = [i];
      visited[i] = 1;
      let touchesBorder = false;
      const component: number[] = [];
      while (q.length) {
        const ci = q.pop()!;
        const cc = ci % cols, cr = Math.floor(ci / cols);
        if (cc === 0 || cr === 0 || cc === cols - 1 || cr === rows - 1) touchesBorder = true;
        component.push(ci);
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nc = cc + dc, nr = cr + dr;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const ni = nr * cols + nc;
            if (!visited[ni] && hg.h[ni] < 20) { visited[ni] = 1; q.push(ni); }
          }
        }
      }
      if (!touchesBorder && component.length >= 4) lakeCount++;
    }
    const existingLakeCenters: Array<[number, number]> = [];
    if (lakeCount < minLakes) {
      const toCarve = minLakes - lakeCount;
      const border = Math.floor(Math.min(cols, rows) * 0.1);
      for (let attempt = 0; attempt < toCarve * 60 && existingLakeCenters.length < toCarve; attempt++) {
        const lc = border + Math.floor(rng() * (cols - border * 2));
        const lr = border + Math.floor(rng() * (rows - border * 2));
        const tooClose = existingLakeCenters.some(([ec, er]) =>
          Math.abs(ec - lc) + Math.abs(er - lr) < Math.floor(Math.min(cols, rows) * 0.15)
        );
        if (tooClose) continue;
        const startI = lr * cols + lc;
        const targetH = 10 + Math.floor(rng() * 6);
        const blobSize = Math.floor(N / 8000) + 10 + Math.floor(rng() * 20); // scale with grid
        const q2: number[] = [startI];
        const seen = new Set<number>([startI]);
        let carved = 0;
        while (q2.length && carved < blobSize) {
          const ci = q2.shift()!;
          hg.h[ci] = Math.min(hg.h[ci], targetH);
          carved++;
          const cc = ci % cols, cr = Math.floor(ci / cols);
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const nc = cc + dc, nr = cr + dr;
              if (nc <= 0 || nr <= 0 || nc >= cols - 1 || nr >= rows - 1) continue;
              const ni = nr * cols + nc;
              if (!seen.has(ni)) { seen.add(ni); q2.push(ni); }
            }
          }
        }
        existingLakeCenters.push([lc, lr]);
      }
    }
  }

  // ── Step 3: Depression filling (Azgaar preprocessing for rivers) ──────────
  // Must run BEFORE river tracing so flux has clear paths to water.
  fillDepressions(hg.h, cols, rows, 6);

  // ── Step 3.5: Hydraulic erosion ──────────────────────────────────────────
  hydraulicErosion(hg.h, cols, rows, seed, params.erosionIterations, params.erosionStrength, params.depositionRate);

  // ── Step 4: Moisture + climate via orographic model ──────────────────────
  // Temp heights Uint8 for climate module
  const tempH8 = new Uint8Array(N);
  for (let i = 0; i < N; i++) tempH8[i] = Math.round(Math.min(100, Math.max(0, hg.h[i])));

  const { moisture: moist, temperature: tempField } = computeClimate(
    tempH8, cols, rows, seed,
    params.windAngleDeg,
    params.moistureScale,
    params.orographicStrength,
  );

  // One smooth pass to remove orographic edge artifacts
  for (let pass = 0; pass < 1; pass++) {
    const src = moist.slice();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let s = 0, c = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const nr = row + dr; if (nr < 0 || nr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const nc = col + dc; if (nc < 0 || nc >= cols) continue;
            s += src[nr * cols + nc]; c++;
          }
        }
        moist[row * cols + col] = s / c;
      }
    }
  }

  // ── Step 5: Biome classification (Whittaker: temperature × moisture × elev) ─
  const cells: TerrainKind[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const h = hg.h[i];
    const m = moist[i];
    const temp = tempField[i];

    if (h < 20) { cells[i] = "WATER"; continue; }

    if (h >= params.mountainThreshold) { cells[i] = "MOUNTAIN"; continue; }
    if (h >= params.hillsThreshold + 6 && temp < 0.26) { cells[i] = "MOUNTAIN"; continue; }
    if (h >= params.hillsThreshold) { cells[i] = "HILLS"; continue; }

    // Polar caps
    if (temp < 0.10) { cells[i] = "TUNDRA"; continue; }

    // Lowland Whittaker matrix
    if (h < 34 && m > 0.70 && temp > 0.42) { cells[i] = "SWAMP"; continue; }
    if (temp < 0.22) { cells[i] = m > 0.55 ? "TAIGA" : "TUNDRA"; continue; }
    if (temp >= 0.22 && temp < 0.40 && m > 0.52) { cells[i] = "TAIGA"; continue; }
    if (temp > 0.74 && m > 0.74) { cells[i] = "JUNGLE"; continue; }
    if (temp > 0.60 && m > 0.30 && m < 0.52) { cells[i] = "SAVANNA"; continue; }
    if (temp > 0.66 && m < 0.30) { cells[i] = "DESERT"; continue; }
    if (m > 0.58) { cells[i] = "FOREST"; continue; }
    cells[i] = "PLAINS";
  }

  // ── Step 5.5: Despeckle biomes (majority vote) ────────────────────────────
  // Domain-warped rasterization + threshold biomes leave salt-and-pepper at
  // boundaries. A couple of majority passes merge isolated pixels into their
  // surrounding region. Runs BEFORE rivers so 1-px river lines stay intact.
  {
    // Gentle: only absorb genuinely isolated pixels (≤1 like neighbour) into a
    // strong surrounding majority. Aggressive majority filtering was creating
    // blocky axis-aligned artifacts (morphological closing), so keep it light.
    for (let iter = 0; iter < 2; iter++) {
      const next = cells.slice();
      for (let row = 1; row < rows - 1; row++) {
        for (let col = 1; col < cols - 1; col++) {
          const i = row * cols + col;
          const k = cells[i];
          const counts: Record<string, number> = {};
          let self = 0, bestK = k, bestN = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const nk = cells[(row + dr) * cols + (col + dc)];
              const c = (counts[nk] = (counts[nk] || 0) + 1);
              if (nk === k) self = c;
              if (c > bestN) { bestN = c; bestK = nk; }
            }
          }
          if (self <= 1 && bestN >= 5 && bestK !== k) next[i] = bestK;
        }
      }
      for (let i = 0; i < N; i++) cells[i] = next[i];
    }
  }

  // ── Step 5.6: Connected-component blob cleanup ────────────────────────────
  // Erase tiny isolated biome patches (specks of desert in forest, etc.) by
  // flood-fill: any land component smaller than MIN_BIOME_BLOB cells is replaced
  // by the most common biome touching its perimeter.
  {
    const MIN_BIOME_BLOB = Math.max(10, Math.round(N / 180000)); // ~27 at 2200²
    const visited = new Uint8Array(N);
    for (let start = 0; start < N; start++) {
      if (visited[start] || cells[start] === "WATER") continue;
      const kind = cells[start];
      const component: number[] = [];
      const queue = [start];
      visited[start] = 1;
      let head = 0;
      while (head < queue.length) {
        const ci = queue[head++];
        component.push(ci);
        const cc = ci % cols, cr = Math.floor(ci / cols);
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (!visited[ni] && cells[ni] === kind) { visited[ni] = 1; queue.push(ni); }
        }
      }
      if (component.length >= MIN_BIOME_BLOB) continue;
      // Count perimeter biomes
      const neighborCounts: Record<string, number> = {};
      for (const ci of component) {
        const cc = ci % cols, cr = Math.floor(ci / cols);
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const nk = cells[nr * cols + nc];
          if (nk !== kind && nk !== "WATER") neighborCounts[nk] = (neighborCounts[nk] || 0) + 1;
        }
      }
      let bestBiome = kind, bestCount = 0;
      for (const [bk, bc] of Object.entries(neighborCounts)) {
        if (bc > bestCount) { bestCount = bc; bestBiome = bk as typeof kind; }
      }
      if (bestCount === 0) { for (const ci of component) cells[ci] = "WATER"; continue; } // island → sink to water
      for (const ci of component) cells[ci] = bestBiome;
    }
  }

  // ── Step 5.7: Inland water-body cleanup (remove "lagitos") ────────────────
  // The global sea-level cut turns every shallow local minimum in flat lowland
  // into a tiny isolated WATER blob ("lagitos"). fillDepressions skips sub-water
  // cells, and the biome blob cleanup skips WATER, so nothing removes them.
  // Flood-fill each WATER component: ocean (touches border) and genuine large
  // lakes survive; small mediterranean ponds are filled back to land.
  {
    const MIN_LAKE = Math.max(60, Math.round(N / 45000)); // ~107 cells at 2200²
    const visited = new Uint8Array(N);
    for (let start = 0; start < N; start++) {
      if (visited[start] || cells[start] !== "WATER") continue;
      const component: number[] = [];
      const queue = [start];
      visited[start] = 1;
      let head = 0;
      let touchesBorder = false;
      while (head < queue.length) {
        const ci = queue[head++];
        component.push(ci);
        const cc = ci % cols, cr = Math.floor(ci / cols);
        if (cc === 0 || cr === 0 || cc === cols - 1 || cr === rows - 1) touchesBorder = true;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (!visited[ni] && cells[ni] === "WATER") { visited[ni] = 1; queue.push(ni); }
        }
      }
      // Keep oceans (touch border) and lakes large enough to matter.
      if (touchesBorder || component.length >= MIN_LAKE) continue;
      // Fill the pond: raise height just above shore and adopt the dominant
      // surrounding land biome so it blends into the prairie/forest around it.
      const neighborCounts: Record<string, number> = {};
      for (const ci of component) {
        const cc = ci % cols, cr = Math.floor(ci / cols);
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const nk = cells[nr * cols + nc];
          if (nk !== "WATER") neighborCounts[nk] = (neighborCounts[nk] || 0) + 1;
        }
      }
      let bestBiome: TerrainKind = "PLAINS", bestCount = 0;
      for (const [bk, bc] of Object.entries(neighborCounts)) {
        if (bc > bestCount) { bestCount = bc; bestBiome = bk as TerrainKind; }
      }
      if (bestBiome === "COAST") bestBiome = "PLAINS"; // don't seed beaches inland
      for (const ci of component) {
        cells[ci] = bestBiome;
        if (hg.h[ci] < 22) hg.h[ci] = 22; // lift above sea level for buildability
      }
    }
  }

  // ── Step 6: Flux-based rivers (Azgaar precipitation model) ───────────────
  traceFluxRivers(hg.h, cells, cols, rows, rng);

  // ── Step 6b: Coastline pass — land directly touching water becomes COAST ──
  // (Replaces the old height-band COAST so beaches only appear at real shores.)
  {
    const coastOf = cells.slice();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const k = cells[i];
        if (k === "WATER" || k === "MOUNTAIN") continue;
        let touchesWater = false;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nr = row + dr, nc = col + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (cells[nr * cols + nc] === "WATER") { touchesWater = true; break; }
        }
        if (touchesWater) coastOf[i] = "COAST";
      }
    }
    for (let i = 0; i < N; i++) cells[i] = coastOf[i];
  }

  // ── Step 7: Post-river lagitos cleanup ────────────────────────────────────
  // Rivers (Step 6) create new WATER cells after the earlier lagitos pass (5.7),
  // so isolated tiny water blobs produced by river tributaries are removed here.
  // Threshold is smaller than 5.7 (rivers are intentionally thin lines) — only
  // blobs fully disconnected from the ocean/large-lakes are filled.
  {
    const MIN_RIVER_ISLAND = 8; // blobs smaller than this that don't touch border → fill
    const visited2 = new Uint8Array(N);
    for (let start = 0; start < N; start++) {
      if (visited2[start] || cells[start] !== "WATER") continue;
      const component: number[] = [];
      const queue = [start];
      visited2[start] = 1;
      let head = 0;
      let touchesBorder = false;
      while (head < queue.length) {
        const ci = queue[head++];
        component.push(ci);
        const cc = ci % cols, cr = Math.floor(ci / cols);
        if (cc === 0 || cr === 0 || cc === cols - 1 || cr === rows - 1) touchesBorder = true;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (!visited2[ni] && cells[ni] === "WATER") { visited2[ni] = 1; queue.push(ni); }
        }
      }
      if (touchesBorder || component.length >= MIN_RIVER_ISLAND) continue;
      const neighborCounts: Record<string, number> = {};
      for (const ci of component) {
        const cc = ci % cols, cr = Math.floor(ci / cols);
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const nk = cells[nr * cols + nc];
          if (nk !== "WATER") neighborCounts[nk] = (neighborCounts[nk] || 0) + 1;
        }
      }
      let bestBiome: TerrainKind = "PLAINS", bestCount = 0;
      for (const [bk, bc] of Object.entries(neighborCounts)) {
        if (bc > bestCount) { bestCount = bc; bestBiome = bk as TerrainKind; }
      }
      if (bestBiome === "COAST") bestBiome = "PLAINS";
      for (const ci of component) cells[ci] = bestBiome;
    }
  }

  // ── Step 7b: Final single-cell speck removal ───────────────────────────────
  const smoothed = cells.slice();
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const i = row * cols + col;
      if (cells[i] !== "WATER") continue;
      let land = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if ((dr || dc) && cells[(row + dr) * cols + (col + dc)] !== "WATER") land++;
      if (land >= 7) smoothed[i] = "COAST";
    }
  }

  // ── Step 8: Pack heights into Uint8 + hillshade ──────────────────────────
  const heights = new Uint8Array(N);
  for (let i = 0; i < N; i++) heights[i] = Math.round(Math.min(100, Math.max(0, hg.h[i])));

  const hillshade = computeHillshade(heights, cols, rows);

  return { cells: smoothed, heights, hillshade, moisture: moist, temperature: tempField };
}

// Compatibility wrapper
export function generateTerrain(seed: number, cols: number, rows: number): TerrainKind[] {
  return generateTerrainData(seed, cols, rows).cells;
}

// ── RLE ───────────────────────────────────────────────────────────────────────

export function rleEncode(cells: TerrainKind[]): Array<[TerrainKind, number]> {
  const result: Array<[TerrainKind, number]> = [];
  let i = 0;
  while (i < cells.length) {
    const kind = cells[i];
    let count = 1;
    while (i + count < cells.length && cells[i + count] === kind) count++;
    result.push([kind, count]);
    i += count;
  }
  return result;
}

export function rleDecode(rle: Array<[TerrainKind, number]>): TerrainKind[] {
  const result: TerrainKind[] = [];
  for (const [kind, count] of rle) {
    for (let i = 0; i < count; i++) result.push(kind);
  }
  return result;
}
