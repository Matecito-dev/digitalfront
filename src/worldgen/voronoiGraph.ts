// Voronoi cell graph for terrain generation (Azgaar-style).
// Poisson-disk sampling (Bridson) → Delaunay (delaunator) → per-cell neighbor graph.
// Deterministic by seed via mulberry32. Pure module, no side effects.
//
// The rest of the terrain pipeline still consumes a rectangular grid, so this
// module also provides rasterizeToGrid: nearest-site lookup for every grid pixel
// using a coarse bucket grid for O(1) neighborhood queries.

import Delaunator from "delaunator";
import { fbmNoise } from "./azgaarHeightmap.js";

export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type VoronoiGraph = {
  /** number of cells (sites) */
  count: number;
  /** site x coordinates in grid space [0, cols) */
  px: Float64Array;
  /** site y coordinates in grid space [0, rows) */
  py: Float64Array;
  /** adjacency list per cell (Delaunay neighbors) */
  neighbors: number[][];
  cols: number;
  rows: number;
  /** spatial bucket index for nearest-site queries */
  _buckets: Int32Array[]; // bucket -> list of site indices
  _bucketCols: number;
  _bucketRows: number;
  _bucketSize: number;
};

// ── Poisson-disk sampling (Bridson 2007) ──────────────────────────────────────
// Scatters blue-noise points with minimum spacing `radius` over [0,cols]×[0,rows].
// Deterministic given rng.
function poissonDisk(cols: number, rows: number, radius: number, rng: RNG): { px: number[]; py: number[] } {
  const k = 30; // candidate attempts before rejecting an active point
  const cellSize = radius / Math.SQRT2;
  const gw = Math.ceil(cols / cellSize);
  const gh = Math.ceil(rows / cellSize);
  const grid = new Int32Array(gw * gh).fill(-1);
  const px: number[] = [];
  const py: number[] = [];
  const active: number[] = [];

  const gridIndex = (x: number, y: number) => Math.floor(y / cellSize) * gw + Math.floor(x / cellSize);

  const addPoint = (x: number, y: number) => {
    const idx = px.length;
    px.push(x);
    py.push(y);
    grid[gridIndex(x, y)] = idx;
    active.push(idx);
  };

  // Seed with a deterministic first point near center
  addPoint(cols * 0.5, rows * 0.5);

  const r2 = radius * radius;
  while (active.length > 0) {
    const ai = Math.floor(rng() * active.length);
    const parent = active[ai];
    const ox = px[parent], oy = py[parent];
    let found = false;

    for (let attempt = 0; attempt < k; attempt++) {
      const ang = rng() * Math.PI * 2;
      const rad = radius * (1 + rng()); // [radius, 2*radius]
      const nx = ox + Math.cos(ang) * rad;
      const ny = oy + Math.sin(ang) * rad;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;

      const gx = Math.floor(nx / cellSize);
      const gy = Math.floor(ny / cellSize);
      let ok = true;
      for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2) && ok; yy++) {
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
          const s = grid[yy * gw + xx];
          if (s >= 0) {
            const dx = px[s] - nx, dy = py[s] - ny;
            if (dx * dx + dy * dy < r2) { ok = false; break; }
          }
        }
      }
      if (ok) { addPoint(nx, ny); found = true; break; }
    }

    if (!found) {
      // Remove parent from active list (swap-pop)
      active[ai] = active[active.length - 1];
      active.pop();
    }
  }

  return { px, py };
}

// ── Build graph ───────────────────────────────────────────────────────────────
// targetCells: desired approximate cell count. Radius derived so Poisson yields ~that many.
export function buildVoronoiGraph(seed: number, cols: number, rows: number, targetCells: number): VoronoiGraph {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const area = cols * rows;
  // Empirically Poisson yields count ≈ area / (radius² · 1.6) with this sampler.
  // Solve for radius given the desired cell count.
  const radius = Math.sqrt(area / (targetCells * 1.6));

  const { px: pxArr, py: pyArr } = poissonDisk(cols, rows, radius, rng);
  const count = pxArr.length;
  const px = Float64Array.from(pxArr);
  const py = Float64Array.from(pyArr);

  // Delaunay expects flat [x0,y0,x1,y1,...]
  const coords = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) { coords[i * 2] = px[i]; coords[i * 2 + 1] = py[i]; }
  const del = new Delaunator(coords);
  const triangles = del.triangles;

  // Derive symmetric neighbor lists from triangle edges
  const neighborSets: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    neighborSets[a].add(b); neighborSets[a].add(c);
    neighborSets[b].add(a); neighborSets[b].add(c);
    neighborSets[c].add(a); neighborSets[c].add(b);
  }
  const neighbors = neighborSets.map((s) => Array.from(s));

  // Build spatial buckets for rasterization (bucket ≈ radius so each pixel checks ~9 buckets)
  const bucketSize = Math.max(1, radius);
  const bucketCols = Math.max(1, Math.ceil(cols / bucketSize));
  const bucketRows = Math.max(1, Math.ceil(rows / bucketSize));
  const lists: number[][] = Array.from({ length: bucketCols * bucketRows }, () => []);
  for (let i = 0; i < count; i++) {
    const bx = Math.min(bucketCols - 1, Math.floor(px[i] / bucketSize));
    const by = Math.min(bucketRows - 1, Math.floor(py[i] / bucketSize));
    lists[by * bucketCols + bx].push(i);
  }
  const _buckets = lists.map((l) => Int32Array.from(l));

  return {
    count, px, py, neighbors, cols, rows,
    _buckets, _bucketCols: bucketCols, _bucketRows: bucketRows, _bucketSize: bucketSize,
  };
}

// Nearest site to (x, y) using the bucket grid. Expands the search ring until a
// site is found and no closer site can exist in unexplored rings.
export function nearestSite(g: VoronoiGraph, x: number, y: number): number {
  const { _buckets, _bucketCols, _bucketRows, _bucketSize, px, py } = g;
  const bx = Math.min(_bucketCols - 1, Math.floor(x / _bucketSize));
  const by = Math.min(_bucketRows - 1, Math.floor(y / _bucketSize));
  let best = -1, bestD = Infinity;

  for (let ring = 0; ring < Math.max(_bucketCols, _bucketRows); ring++) {
    const x0 = Math.max(0, bx - ring), x1 = Math.min(_bucketCols - 1, bx + ring);
    const y0 = Math.max(0, by - ring), y1 = Math.min(_bucketRows - 1, by + ring);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        // only scan the perimeter of the current ring
        if (ring > 0 && xx > x0 && xx < x1 && yy > y0 && yy < y1) continue;
        const bucket = _buckets[yy * _bucketCols + xx];
        for (let m = 0; m < bucket.length; m++) {
          const s = bucket[m];
          const dx = px[s] - x, dy = py[s] - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = s; }
        }
      }
    }
    // Once we have a candidate, one extra ring guarantees correctness
    // (a closer site could sit just across a bucket boundary).
    if (best >= 0 && bestD <= (ring * _bucketSize) * (ring * _bucketSize)) break;
  }
  return best;
}

// Rasterize a per-cell value array to a cols×rows grid via nearest-site lookup.
export function rasterizeToGrid(g: VoronoiGraph, siteValue: Float32Array): Float32Array {
  const { cols, rows } = g;
  const out = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // sample at pixel center
      const s = nearestSite(g, col + 0.5, row + 0.5);
      out[row * cols + col] = s >= 0 ? siteValue[s] : 0;
    }
  }
  return out;
}

// Returns, for every grid pixel, the index of its owning site. Lets callers
// rasterize multiple per-cell arrays without repeating nearest-site work.
//
// Domain warping: each pixel's lookup position is offset by a two-octave-ish FBM
// field before the nearest-site query. This bends every boundary (coastline, biome
// edge, mountain front) into organic wiggles instead of straight Voronoi facets —
// the single cheapest way to add realism + detail across the whole map.
// warpAmp is in grid pixels; warpScale is the warp frequency (cycles ~ scale).
export function buildSiteOfPixel(g: VoronoiGraph, opts?: { seed?: number; warpAmp?: number; warpScale?: number }): Int32Array {
  const { cols, rows } = g;
  const seed = opts?.seed ?? 12345;
  const warpAmp = opts?.warpAmp ?? 7;
  const warpScale = opts?.warpScale ?? 0.06;
  const out = new Int32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Two decorrelated FBM fields drive x/y displacement.
      const wx = (fbmNoise(col * warpScale, row * warpScale, seed, 3) * 2 - 1) * warpAmp;
      const wy = (fbmNoise(col * warpScale + 41.7, row * warpScale + 13.3, seed + 991, 3) * 2 - 1) * warpAmp;
      let x = col + 0.5 + wx, y = row + 0.5 + wy;
      if (x < 0) x = 0; else if (x >= cols) x = cols - 1;
      if (y < 0) y = 0; else if (y >= rows) y = rows - 1;
      out[row * cols + col] = nearestSite(g, x, y);
    }
  }
  return out;
}
