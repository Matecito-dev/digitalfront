// Heightmap generation over a Voronoi cell graph (Azgaar-style operations).
// Mirrors the grid ops in azgaarHeightmap.ts but spreads over cell neighbors.
// Because cells are irregular (blue-noise), there is no axis alignment, so ridge
// walks can use a free heading without the 45° banding that plagued the grid port.

import { buildVoronoiGraph, mulberry32, type VoronoiGraph, type RNG } from "./voronoiGraph.js";
import { calcBlobPower, calcLinePower, fbmNoise, chooseTemplate, TEMPLATES } from "./azgaarHeightmap.js";

export type CellHeightmap = {
  graph: VoronoiGraph;
  height: Float32Array; // [0..100] per cell, sea level = 20
};

function parseRange(s: string): [number, number] {
  const parts = s.split("-").map(Number);
  return [parts[0], parts.length > 1 ? parts[1] : parts[0]];
}

// Nearest cell to a normalized [0,1] map position.
function cellAtNorm(g: VoronoiGraph, nx: number, ny: number): number {
  const x = nx * g.cols, y = ny * g.rows;
  let best = 0, bestD = Infinity;
  // small linear scan is fine — only called a handful of times per template
  for (let i = 0; i < g.count; i++) {
    const dx = g.px[i] - x, dy = g.py[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ── Blob (hill / pit) ─────────────────────────────────────────────────────────
function addBlob(hm: CellHeightmap, rng: RNG, count: number, amount: [number, number], rangeX: [number, number], rangeY: [number, number], sign: number, blobPower: number) {
  const { graph: g, height } = hm;
  for (let n = 0; n < count; n++) {
    const nx = (rangeX[0] + rng() * (rangeX[1] - rangeX[0])) / 100;
    const ny = (rangeY[0] + rng() * (rangeY[1] - rangeY[0])) / 100;
    const peak = amount[0] + rng() * (amount[1] - amount[0]);
    const start = cellAtNorm(g, nx, ny);
    const queue: [number, number][] = [[start, peak]];
    const visited = new Set<number>();
    while (queue.length) {
      const [i, change] = queue.shift()!;
      if (visited.has(i)) continue;
      visited.add(i);
      height[i] = Math.max(0, Math.min(100, height[i] + sign * change));
      for (const nb of g.neighbors[i]) {
        if (!visited.has(nb)) {
          const next = Math.pow(change, blobPower) * (0.9 + rng() * 0.2);
          if (next > 0.8) queue.push([nb, next]);
        }
      }
    }
  }
}

// ── Ridge walk (range / trough) ───────────────────────────────────────────────
// Walks cell-to-cell following a wandering heading, depositing a decaying ridge,
// then expands laterally to neighbors. Ridged modulation sharpens the crest.
function addRidge(hm: CellHeightmap, rng: RNG, count: number, amount: number, rangeX: [number, number], rangeY: [number, number], sign: number, linePower: number, ridgeSeed: number) {
  const { graph: g, height } = hm;
  for (let n = 0; n < count; n++) {
    const nx = (rangeX[0] + rng() * (rangeX[1] - rangeX[0])) / 100;
    const ny = (rangeY[0] + rng() * (rangeY[1] - rangeY[0])) / 100;
    let cur = cellAtNorm(g, nx, ny);
    let theta = rng() * Math.PI * 2;
    let curH = amount;
    const spine: Array<[number, number]> = [];
    const visited = new Set<number>();

    const maxSteps = g.count; // safety bound
    for (let step = 0; step < maxSteps && curH > 0.5; step++) {
      if (!visited.has(cur)) {
        visited.add(cur);
        // Ridged modulation sharpens the crest upward (can exceed 1× → real peaks).
        const ridged = 1 - Math.abs(2 * fbmNoise(g.px[cur] * 0.04, g.py[cur] * 0.04, ridgeSeed, 3) - 1);
        const dep = curH * (0.9 + 0.55 * ridged);
        height[cur] = Math.max(0, Math.min(100, height[cur] + sign * dep));
        spine.push([cur, dep]);
      }
      curH *= linePower;

      // Wander the heading for organic curves
      theta += (rng() - 0.5) * 0.9;
      const dx = Math.cos(theta), dy = Math.sin(theta);

      const nbs = g.neighbors[cur];
      if (nbs.length === 0) break;
      let next = -1;
      if (rng() < 0.18) {
        // occasional random hop for irregularity
        next = nbs[Math.floor(rng() * nbs.length)];
      } else {
        let bestDot = -Infinity;
        for (const nb of nbs) {
          const ox = g.px[nb] - g.px[cur], oy = g.py[nb] - g.py[cur];
          const len = Math.hypot(ox, oy) || 1;
          const d = (ox * dx + oy * dy) / len;
          if (d > bestDot) { bestDot = d; next = nb; }
        }
      }
      if (next < 0) break;
      cur = next;
    }

    // Lateral expansion (BFS over neighbors) — gives the ridge real width
    const expandPower = linePower * 0.8;
    const expanded = new Set<number>(visited);
    const bfsQ: [number, number][] = spine.map(([i, dep]) => [i, dep * expandPower]);
    while (bfsQ.length) {
      const [i, contrib] = bfsQ.shift()!;
      if (contrib < 0.6) continue;
      for (const nb of g.neighbors[i]) {
        if (!expanded.has(nb)) {
          expanded.add(nb);
          height[nb] = Math.max(0, Math.min(100, height[nb] + sign * contrib));
          bfsQ.push([nb, contrib * expandPower]);
        }
      }
    }
  }
}

// ── Whole-grid modifiers ──────────────────────────────────────────────────────
function modify(hm: CellHeightmap, add: number, mult: number, range: "all" | "land" | "sea") {
  const { height } = hm;
  for (let i = 0; i < height.length; i++) {
    const isLand = height[i] >= 20;
    if (range === "land" && !isLand) continue;
    if (range === "sea" && isLand) continue;
    height[i] = Math.min(100, Math.max(0, height[i] * mult + add));
  }
}

function smoothCells(hm: CellHeightmap, iterations: number, fr: number) {
  const { graph: g, height } = hm;
  for (let it = 0; it < iterations; it++) {
    const tmp = height.slice();
    for (let i = 0; i < g.count; i++) {
      const nbs = g.neighbors[i];
      let sum = tmp[i];
      for (const nb of nbs) sum += tmp[nb];
      const mean = sum / (nbs.length + 1);
      height[i] = fr === 1 ? mean : (tmp[i] * (fr - 1) + mean) / fr;
    }
  }
}

function addNoiseCells(hm: CellHeightmap, rng: RNG, scale: number, amplitude: number, octaves: number) {
  const { graph: g, height } = hm;
  const seed = Math.floor(rng() * 99999);
  for (let i = 0; i < g.count; i++) {
    const nx = (g.px[i] / g.cols) * scale;
    const ny = (g.py[i] / g.rows) * scale;
    const noise = fbmNoise(nx, ny, seed, octaves);
    height[i] = Math.min(100, Math.max(0, height[i] + (noise * 2 - 1) * amplitude));
  }
}

// ── Template runner ───────────────────────────────────────────────────────────
function runCellTemplate(hm: CellHeightmap, rng: RNG, template: string, seed: number) {
  const N = hm.graph.count;
  const blobPower = calcBlobPower(N);
  const linePower = calcLinePower(N);
  let ridgeCounter = 0;
  for (const line of template.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    const op = parts[0]?.toLowerCase();
    if (!op) continue;
    if (op === "hill")        addBlob(hm, rng, +parts[1], parseRange(parts[2]), parseRange(parts[3]), parseRange(parts[4]), +1, blobPower);
    else if (op === "pit")    addBlob(hm, rng, +parts[1], parseRange(parts[2]), parseRange(parts[3]), parseRange(parts[4]), -1, blobPower);
    else if (op === "range")  addRidge(hm, rng, +parts[1], +parts[2], parseRange(parts[3]), parseRange(parts[4]), +1, linePower, seed + (ridgeCounter++) * 131);
    else if (op === "trough") addRidge(hm, rng, +parts[1], +parts[2], parseRange(parts[3]), parseRange(parts[4]), -1, linePower, seed + (ridgeCounter++) * 131);
    else if (op === "add")    modify(hm, +parts[1], 1, (parts[2] as any) ?? "all");
    else if (op === "multiply") modify(hm, 0, +parts[1], (parts[2] as any) ?? "all");
    else if (op === "smooth") smoothCells(hm, +parts[1] || 1, parts[2] ? +parts[2] : 2);
    else if (op === "noise")  addNoiseCells(hm, rng, +parts[1] || 4, +parts[2] || 10, +parts[3] || 4);
    // "mask" intentionally skipped: we want land to the borders (continental).
  }
}

// Rank-based elevation redistribution (Azgaar/Red Blob style).
// Smoothing compresses land into a mid band with no real peaks. We remap land
// heights (>= sea level 20) by their rank through a power curve so the relief
// spans the full [20,100] range with a thin top fraction reaching the mountain
// line — independent of template. Water (< 20) is left untouched so lakes/sea
// keep their basins. Spatial ordering is preserved (only the value scale changes).
function redistributeLand(hm: CellHeightmap, exponent: number) {
  const { height } = hm;
  const landIdx: number[] = [];
  for (let i = 0; i < height.length; i++) if (height[i] >= 20) landIdx.push(i);
  if (landIdx.length < 2) return;
  landIdx.sort((a, b) => height[a] - height[b]);
  const last = landIdx.length - 1;
  for (let rank = 0; rank <= last; rank++) {
    const r = rank / last;            // 0 = lowest land, 1 = highest
    height[landIdx[rank]] = 20 + 80 * Math.pow(r, exponent);
  }
}

// Public entry: build graph, run the seed's template, return per-cell heights + graph.
export function generateCellHeightmap(seed: number, cols: number, rows: number, targetCells: number): CellHeightmap {
  const graph = buildVoronoiGraph(seed, cols, rows, targetCells);
  const hm: CellHeightmap = { graph, height: new Float32Array(graph.count) };
  const rng = mulberry32(seed);
  const tname = chooseTemplate(seed);
  runCellTemplate(hm, rng, TEMPLATES[tname], seed);
  // exponent 2.6 → ~top 10% of land crosses the mountain line (h≥78)
  redistributeLand(hm, 2.6);
  return hm;
}
