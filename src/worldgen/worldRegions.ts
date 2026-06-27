import type { TerrainKind } from "./worldTerrainConfigData.js";
import type { WorldRegion } from "../shared/world.js";

// ─── Biome-based prefix lists ────────────────────────────────────────────────

const BIOME_PREFIXES: Record<string, string[]> = {
  FOREST:  ["Bosques", "Selvas", "Espesura", "Arboleda"],
  JUNGLE:  ["Jungla", "Selva Profunda", "Espesura", "Follaje"],
  DESERT:  ["Desierto", "Dunas", "Arenas", "Tierras Áridas"],
  MOUNTAIN:["Montañas", "Picos", "Cordillera", "Cumbres"],
  HILLS:   ["Sierra", "Colinas", "Altiplano", "Lomas"],
  SWAMP:   ["Marismas", "Pantanos", "Ciénagas", "Bañados"],
  TUNDRA:  ["Páramos", "Estepas", "Tundra", "Yermos"],
  TAIGA:   ["Taiga", "Bosques Fríos", "Pinares", "Boreales"],
  SAVANNA: ["Sabana", "Llanuras", "Praderas Secas", "Pastizales"],
  PLAINS:  ["Llanuras", "Praderas", "Campos", "Tierras"],
  COAST:   ["Costa", "Riberas", "Orillas", "Litoral"],
};

const REGION_SUFFIXES = [
  "del Norte", "Sombrías", "Doradas", "del Este", "del Sur", "Heladas",
  "Ardientes", "Verdes", "Grises", "Perdidas", "Antiguas", "Salvajes",
  "Olvidadas", "Eternas", "Oscuras", "Brillantes", "Secas", "Fértiles",
];

function seededPick<T>(arr: T[], h: number): T {
  return arr[Math.abs(h) % arr.length];
}

function hashInt(n: number): number {
  let x = n ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function regionName(dominantBiome: string, idx: number): string {
  const prefixes = BIOME_PREFIXES[dominantBiome] ?? BIOME_PREFIXES.PLAINS;
  const h1 = hashInt(idx * 13 + 7);
  const h2 = hashInt(idx * 31 + 17);
  return `${seededPick(prefixes, h1)} ${seededPick(REGION_SUFFIXES, h2)}`;
}

// ─── Region generation ───────────────────────────────────────────────────────

export type RegionMapData = {
  cols: number;
  rows: number;
  ids: string; // base64-encoded Uint8Array, value = region idx (0..N-1) or 255=water
};

export function generateRegions(
  cells: TerrainKind[],
  cols: number,
  rows: number,
  worldWidth: number,
  worldHeight: number,
  seed: number,
): { regions: WorldRegion[]; regionMap: RegionMapData } {
  const N = cols * rows;

  // Build a list of land cells (non-WATER) for seed placement
  const landCells: number[] = [];
  for (let i = 0; i < N; i++) {
    if (cells[i] !== "WATER") landCells.push(i);
  }
  if (landCells.length === 0) return { regions: [], regionMap: { cols: 1, rows: 1, ids: Buffer.from([255]).toString("base64") } };

  // ── Seed placement: jittered grid on land ────────────────────────────────
  const REGION_COLS = 5;
  const REGION_ROWS = 4; // 20 provinces total
  const seeds: number[] = [];

  let s = seed ^ 0x4c3a1b9f;
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let gr = 0; gr < REGION_ROWS; gr++) {
    for (let gc = 0; gc < REGION_COLS; gc++) {
      const colStart = Math.floor((gc / REGION_COLS) * cols);
      const colEnd = Math.floor(((gc + 1) / REGION_COLS) * cols);
      const rowStart = Math.floor((gr / REGION_ROWS) * rows);
      const rowEnd = Math.floor(((gr + 1) / REGION_ROWS) * rows);

      let placed = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const rc = colStart + Math.floor(rng() * (colEnd - colStart));
        const rr = rowStart + Math.floor(rng() * (rowEnd - rowStart));
        const ri = rr * cols + rc;
        if (cells[ri] !== "WATER") {
          seeds.push(ri);
          placed = true;
          break;
        }
      }
      if (!placed) {
        const cc = Math.floor((colStart + colEnd) / 2);
        const cr = Math.floor((rowStart + rowEnd) / 2);
        let best = -1, bestD = Infinity;
        for (const li of landCells) {
          const lc = li % cols, lr = Math.floor(li / cols);
          const d = (lc - cc) ** 2 + (lr - cr) ** 2;
          if (d < bestD) { bestD = d; best = li; }
        }
        if (best >= 0) seeds.push(best);
      }
    }
  }

  const numRegions = seeds.length;
  if (numRegions === 0) return { regions: [], regionMap: { cols: 1, rows: 1, ids: Buffer.from([255]).toString("base64") } };

  // ── BFS Voronoi assignment on land cells ────────────────────────────────
  const assign = new Int16Array(N).fill(-1);
  const queue: number[] = [];

  for (let ri = 0; ri < numRegions; ri++) {
    assign[seeds[ri]] = ri;
    queue.push(seeds[ri]);
  }

  let head = 0;
  while (head < queue.length) {
    const ci = queue[head++];
    const reg = assign[ci];
    const cc = ci % cols, cr = Math.floor(ci / cols);
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (assign[ni] !== -1 || cells[ni] === "WATER") continue;
      assign[ni] = reg;
      queue.push(ni);
    }
  }

  // ── Pole of inaccessibility: BFS distance-from-border ───────────────────
  // Seed = every cell that is WATER or has a neighbor with a different region id.
  const dist = new Int32Array(N).fill(-1);
  const distQ: number[] = [];
  for (let i = 0; i < N; i++) {
    if (assign[i] < 0) { dist[i] = 0; distQ.push(i); continue; }
    const cc = i % cols, cr = Math.floor(i / cols);
    let isBorder = false;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) { isBorder = true; break; }
      const ni = nr * cols + nc;
      if (assign[ni] !== assign[i]) { isBorder = true; break; }
    }
    if (isBorder) { dist[i] = 0; distQ.push(i); }
  }
  let dhead = 0;
  while (dhead < distQ.length) {
    const ci = distQ[dhead++];
    const cc = ci % cols, cr = Math.floor(ci / cols);
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (dist[ni] === -1) { dist[ni] = dist[ci] + 1; distQ.push(ni); }
    }
  }

  // ── Per-region: pole = max-dist cell; dominant biome ────────────────────
  const poleCell = new Int32Array(numRegions).fill(-1);
  const poleDist = new Int32Array(numRegions).fill(-1);
  const biomeCounts: Record<string, number>[] = Array.from({ length: numRegions }, () => ({}));

  for (let i = 0; i < N; i++) {
    const r = assign[i];
    if (r < 0) continue;
    const kind = cells[i];
    if (kind !== "WATER") {
      biomeCounts[r][kind] = (biomeCounts[r][kind] ?? 0) + 1;
    }
    if (dist[i] > poleDist[r]) {
      poleDist[r] = dist[i];
      poleCell[r] = i;
    }
  }

  // ── Convert pole position to world coords ───────────────────────────────
  const halfW = worldWidth / 2;
  const halfH = worldHeight / 2;

  const regions: WorldRegion[] = [];
  for (let ri = 0; ri < numRegions; ri++) {
    const pi = poleCell[ri];
    if (pi < 0) continue;
    const pc = pi % cols;
    const pr = Math.floor(pi / cols);

    // Determine dominant biome (ignore WATER, ROAD, COAST for naming)
    const bc = biomeCounts[ri];
    let dominant = "PLAINS";
    let dominantCount = 0;
    for (const [biome, count] of Object.entries(bc)) {
      if (["WATER", "ROAD", "COAST"].includes(biome)) continue;
      if (count > dominantCount) { dominantCount = count; dominant = biome; }
    }

    regions.push({
      id: `region-${ri}`,
      name: regionName(dominant, ri),
      centroidX: Math.round((pc / cols) * worldWidth - halfW),
      centroidY: Math.round((pr / rows) * worldHeight - halfH),
    });
  }

  // ── Region-map: downsample assignment grid to ~512×512 ──────────────────
  const RMAP_COLS = 512;
  const RMAP_ROWS = 512;
  const rmapBuf = new Uint8Array(RMAP_COLS * RMAP_ROWS).fill(255);
  for (let ry = 0; ry < RMAP_ROWS; ry++) {
    const gridRow = Math.min(rows - 1, Math.floor((ry / RMAP_ROWS) * rows));
    for (let rx = 0; rx < RMAP_COLS; rx++) {
      const gridCol = Math.min(cols - 1, Math.floor((rx / RMAP_COLS) * cols));
      const a = assign[gridRow * cols + gridCol];
      rmapBuf[ry * RMAP_COLS + rx] = a >= 0 ? (a & 0xfe) : 255; // even=land, 255=water
    }
  }

  const regionMap: RegionMapData = {
    cols: RMAP_COLS,
    rows: RMAP_ROWS,
    ids: Buffer.from(rmapBuf).toString("base64"),
  };

  return { regions, regionMap };
}
