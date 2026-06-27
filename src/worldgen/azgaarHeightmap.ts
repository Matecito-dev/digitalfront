// Port of Azgaar Fantasy Map Generator heightmap operations
// Original: https://github.com/Azgaar/Fantasy-Map-Generator — MIT License
// Adapted for rectangular grid with mulberry32 PRNG (no D3, no browser deps)

export type HeightGrid = {
  h: Float32Array; // heights 0–100; sea level = 20
  cols: number;
  rows: number;
};

type RNG = () => number;

function mulberry32(seed: number): RNG {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function neighbors8(i: number, cols: number, rows: number): number[] {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const ns: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = col + dc;
      const nr = row + dr;
      if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) ns.push(nr * cols + nc);
    }
  }
  return ns;
}

// Azgaar scales power parameters by cell count — larger grids need wider feature spread.
// blobPower must always be < 1 (otherwise BFS diverges and floods the entire grid).
// At 200×200 (40k cells): ~0.993. At 500×500 (250k cells): ~0.997.
// Formula: interpolate linearly on log scale, hard-clamp < 0.998.
// Calibrated at 200×200 (N=40000): blobPower=0.993, linePower=0.84 (known good values).
// Scales up for larger grids so features stay proportional. Always clamped < 1.
export function calcBlobPower(N: number): number {
  // blob = 1 - (1 - 0.993) * (40000/N)^0.4
  // At N=40000: 0.993. At N=250000: 0.9968. Never ≥1.
  return 1 - 0.007 * Math.pow(40000 / Math.max(N, 1), 0.4);
}
export function calcLinePower(N: number): number {
  // line = 1 - (1 - 0.84) * (40000/N)^0.35
  // At N=40000: 0.84. At N=250000: 0.921.
  return 1 - 0.16 * Math.pow(40000 / Math.max(N, 1), 0.35);
}

// ── Value noise (for addNoise operation) ────────────────────────────────────

function hashV(x: number, y: number, seed: number): number {
  const n = Math.imul(x * 1619 + y * 31337 + seed * 1013, 1) | 0;
  const m = (n ^ (n << 13)) ^ n;
  return (((m * (m * m * 15731 + 789221) + 1376312589) & 0x7fffffff) / 2147483648);
}

function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return (
    hashV(ix, iy, seed) * (1 - ux) * (1 - uy) +
    hashV(ix + 1, iy, seed) * ux * (1 - uy) +
    hashV(ix, iy + 1, seed) * (1 - ux) * uy +
    hashV(ix + 1, iy + 1, seed) * ux * uy
  );
}

export function fbmNoise(x: number, y: number, seed: number, octaves: number): number {
  let v = 0, amp = 0.5, freq = 1.0, max = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise2(x * freq, y * freq, seed + i * 997) * amp;
    max += amp; amp *= 0.5; freq *= 2.0;
  }
  return v / max;
}

// ── Operations ───────────────────────────────────────────────────────────────

function addHill(g: HeightGrid, rng: RNG, count: number, height: [number, number], rangeX: [number, number], rangeY: [number, number]) {
  const { h, cols, rows } = g;
  const N = cols * rows;
  const blobPower = calcBlobPower(N);
  for (let n = 0; n < count; n++) {
    const px = (rangeX[0] + rng() * (rangeX[1] - rangeX[0])) / 100;
    const py = (rangeY[0] + rng() * (rangeY[1] - rangeY[0])) / 100;
    const peak = height[0] + rng() * (height[1] - height[0]);
    const startI = Math.min(N - 1, Math.floor(py * rows) * cols + Math.floor(px * cols));
    const queue: [number, number][] = [[startI, peak]];
    const visited = new Set<number>();
    while (queue.length) {
      const [i, change] = queue.shift()!;
      if (visited.has(i)) continue;
      visited.add(i);
      h[i] = Math.min(100, h[i] + change);
      for (const nb of neighbors8(i, cols, rows)) {
        if (!visited.has(nb)) {
          const next = change ** blobPower * (0.9 + rng() * 0.2);
          if (next > 0.1) queue.push([nb, next]);
        }
      }
    }
  }
}

function addPit(g: HeightGrid, rng: RNG, count: number, depth: [number, number], rangeX: [number, number], rangeY: [number, number]) {
  const { h, cols, rows } = g;
  const N = cols * rows;
  const blobPower = calcBlobPower(N);
  for (let n = 0; n < count; n++) {
    const px = (rangeX[0] + rng() * (rangeX[1] - rangeX[0])) / 100;
    const py = (rangeY[0] + rng() * (rangeY[1] - rangeY[0])) / 100;
    const d = depth[0] + rng() * (depth[1] - depth[0]);
    const startI = Math.min(N - 1, Math.floor(py * rows) * cols + Math.floor(px * cols));
    const queue: [number, number][] = [[startI, d]];
    const visited = new Set<number>();
    while (queue.length) {
      const [i, change] = queue.shift()!;
      if (visited.has(i)) continue;
      visited.add(i);
      h[i] = Math.max(0, h[i] - change);
      for (const nb of neighbors8(i, cols, rows)) {
        if (!visited.has(nb)) {
          const next = change ** blobPower * (0.9 + rng() * 0.2);
          if (next > 0.1) queue.push([nb, next]);
        }
      }
    }
  }
}

// Directionally-biased random walk — no target point.
// Picks H or V as dominant direction, then walks that way with organic drift.
// Each step moves EXACTLY ONE cell. Never diagonal.
// This avoids the 45° artifact that appears when walking toward a random target
// where |ΔC| ≈ |ΔR| (equal remaining distance → 50/50 → diagonal).
function biasedWalk(
  cols: number, rows: number, rng: RNG,
  startC: number, startR: number, maxSteps: number,
  fn: (idx: number) => boolean
) {
  // Choose dominant direction: H or V
  const isH = rng() < 0.5;
  // Starting movement direction along dominant axis
  let mainDir = rng() < 0.5 ? 1 : -1;
  let curC = startC, curR = startR;

  for (let step = 0; step < maxSteps; step++) {
    const ci = Math.max(0, Math.min(cols - 1, curC));
    const ri = Math.max(0, Math.min(rows - 1, curR));
    if (!fn(ri * cols + ci)) break;

    // 20% small perpendicular drift (single step, then back to main axis)
    if (rng() < 0.20) {
      if (isH) curR += rng() < 0.5 ? 1 : -1;
      else     curC += rng() < 0.5 ? 1 : -1;
      continue;
    }

    // 5% reverse main direction (creates bends)
    if (rng() < 0.05) mainDir = -mainDir;

    // Advance along dominant axis
    if (isH) curC += mainDir;
    else      curR += mainDir;
  }
}

function addRange(g: HeightGrid, rng: RNG, count: number, height: number, rangeX: [number, number], rangeY: [number, number]) {
  const { h, cols, rows } = g;
  const N = cols * rows;
  const linePower = calcLinePower(N);

  for (let n = 0; n < count; n++) {
    const fromC = Math.floor((rangeX[0] / 100 + rng() * (rangeX[1] - rangeX[0]) / 100) * cols);
    const fromR = Math.floor((rangeY[0] / 100 + rng() * (rangeY[1] - rangeY[0]) / 100) * rows);

    const spine: Array<[number, number]> = [];
    const spineVisited = new Set<number>();
    let curH = height;

    biasedWalk(cols, rows, rng, fromC, fromR, (cols + rows) * 3, (idx) => {
      if (curH <= 0.5) return false;
      if (!spineVisited.has(idx)) {
        spineVisited.add(idx);
        h[idx] = Math.min(100, h[idx] + curH);
        spine.push([idx, curH]);
      }
      curH *= linePower;
      return true;
    });

    // Lateral BFS expansion (4-directional — no diagonal spread)
    const expandPower = linePower * 0.80;
    const expanded = new Set<number>(spineVisited);
    const bfsQ: [number, number][] = spine.map(([i, contrib]) => [i, contrib * expandPower]);
    while (bfsQ.length) {
      const [i, contrib] = bfsQ.shift()!;
      if (contrib < 0.5) continue;
      const r = Math.floor(i / cols), c = i % cols;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nb = nr * cols + nc;
        if (!expanded.has(nb)) {
          expanded.add(nb);
          h[nb] = Math.min(100, h[nb] + contrib);
          bfsQ.push([nb, contrib * expandPower]);
        }
      }
    }

    // Prominence bumps
    for (let si = 0; si < spine.length; si += 6) {
      const ridgeH = h[spine[si][0]];
      const r = Math.floor(spine[si][0] / cols), c = spine[si][0] % cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nb = nr * cols + nc;
        if (h[nb] < ridgeH * 0.8) h[nb] = (ridgeH * 2 + h[nb]) / 3;
      }
    }
  }
}

function addTrough(g: HeightGrid, rng: RNG, count: number, depth: number, rangeX: [number, number], rangeY: [number, number]) {
  const { h, cols, rows } = g;
  const N = cols * rows;
  const linePower = calcLinePower(N);
  for (let n = 0; n < count; n++) {
    const fromC = Math.floor((rangeX[0] / 100 + rng() * (rangeX[1] - rangeX[0]) / 100) * cols);
    const fromR = Math.floor((rangeY[0] / 100 + rng() * (rangeY[1] - rangeY[0]) / 100) * rows);
    let curD = depth;
    biasedWalk(cols, rows, rng, fromC, fromR, (cols + rows) * 3, (idx) => {
      if (curD <= 0.5) return false;
      h[idx] = Math.max(0, h[idx] - curD);
      curD *= linePower;
      return true;
    });
  }
}

function modifyGrid(g: HeightGrid, range: "all" | "land" | "sea", add: number, mult: number) {
  const { h } = g;
  for (let i = 0; i < h.length; i++) {
    const isLand = h[i] >= 20;
    if (range === "land" && !isLand) continue;
    if (range === "sea" && isLand) continue;
    h[i] = Math.min(100, Math.max(0, h[i] * mult + add));
  }
}

function smooth(g: HeightGrid, iterations: number, fr = 2) {
  const { h, cols, rows } = g;
  for (let it = 0; it < iterations; it++) {
    const tmp = h.slice();
    for (let i = 0; i < h.length; i++) {
      const ns = neighbors8(i, cols, rows);
      let sum = 0;
      for (const nb of ns) sum += tmp[nb];
      const mean = sum / ns.length;
      // fr=1: full average; fr=2: half-smooth (matches Azgaar default)
      h[i] = fr === 1 ? mean : (tmp[i] * (fr - 1) + mean) / fr;
    }
  }
}

function maskEdge(g: HeightGrid, power: number) {
  const { h, cols, rows } = g;
  for (let i = 0; i < h.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const nx = (col / (cols - 1)) * 2 - 1;
    const ny = (row / (rows - 1)) * 2 - 1;
    const bump = Math.max(0, (1 - nx * nx) * (1 - ny * ny));
    h[i] = Math.min(100, Math.max(0, (h[i] * (power - 1) + h[i] * bump) / power));
  }
}

// Adds FBM noise perturbation directly to the heightmap — creates organic terrain variation.
// scale: noise wavelength relative to grid (2=coarse, 8=fine)
// amplitude: max height change (typically 5–20)
function addNoise(g: HeightGrid, rng: RNG, scale: number, amplitude: number, octaves: number) {
  const { h, cols, rows } = g;
  const seed = Math.floor(rng() * 99999);
  for (let i = 0; i < h.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const n = fbmNoise((col / cols) * scale, (row / rows) * scale, seed, octaves);
    h[i] = Math.min(100, Math.max(0, h[i] + (n * 2 - 1) * amplitude));
  }
}

// ── Template runner ───────────────────────────────────────────────────────────

function parseRange(s: string): [number, number] {
  const parts = s.split("-").map(Number);
  return [parts[0], parts.length > 1 ? parts[1] : parts[0]];
}

export function runTemplate(g: HeightGrid, rng: RNG, template: string) {
  for (const line of template.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    const op = parts[0]?.toLowerCase();
    if (!op) continue;
    if (op === "hill")       addHill(g, rng, +parts[1], parseRange(parts[2]), parseRange(parts[3]), parseRange(parts[4]));
    else if (op === "pit")   addPit(g, rng, +parts[1], parseRange(parts[2]), parseRange(parts[3]), parseRange(parts[4]));
    else if (op === "range") addRange(g, rng, +parts[1], +parts[2], parseRange(parts[3]), parseRange(parts[4]));
    else if (op === "trough") addTrough(g, rng, +parts[1], +parts[2], parseRange(parts[3]), parseRange(parts[4]));
    else if (op === "add")   modifyGrid(g, (parts[2] as "all" | "land" | "sea") ?? "all", +parts[1], 1);
    else if (op === "multiply") modifyGrid(g, (parts[2] as "all" | "land" | "sea") ?? "all", 0, +parts[1]);
    else if (op === "smooth") smooth(g, +parts[1] || 1, parts[2] ? +parts[2] : 2);
    else if (op === "mask")  maskEdge(g, +parts[1] || 1.2);
    else if (op === "noise") addNoise(g, rng, +parts[1] || 4, +parts[2] || 10, +parts[3] || 4);
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────
// Continental style: land fills the map (Add 30–34 lifts all above sea level 20).
// Pit ops carve inland lake basins. No Mask = no ocean border.
// Noise ops add organic micro-variation. Range uses lateral expansion.

export const TEMPLATES: Record<string, string> = {
  // Llanuras amplias — lago grande central, cordillera norte, suave al sur
  highIsland: `
Add 30 all
Hill 3 55-75 30-70 30-70
Hill 6 35-55 10-90 10-90
Range 2 45 20-80 10-40
Pit 1 55-70 40-60 40-60
Pit 2 28-42 15-85 15-85
Noise 3 8 4
Smooth 3 2
`,
  // Dos masas continentales separadas por dorsal montañosa central
  continents: `
Add 32 all
Hill 3 65-80 10-35 15-85
Hill 3 65-80 65-90 15-85
Hill 5 40-60 10-90 10-90
Range 3 50 40-60 20-80
Pit 1 50-65 20-35 30-70
Pit 1 50-65 65-80 30-70
Pit 1 28-40 45-55 10-25
Noise 4 10 4
Smooth 2 2
`,
  // Pangea: gran masa única con relieve interior variado y varios lagos
  pangea: `
Add 34 all
Hill 2 75-90 35-65 35-65
Hill 4 55-75 20-80 20-80
Hill 6 38-58 10-90 10-90
Range 2 55 20-80 20-80
Pit 2 45-60 25-45 25-75
Pit 2 28-42 55-75 25-75
Noise 5 12 5
Smooth 2 2
`,
  // Mundo clásico: norte montañoso, sur de llanuras, rift de lagos al centro
  oldWorld: `
Add 30 all
Hill 4 60-78 15-50 10-90
Hill 3 50-68 50-85 10-90
Hill 5 35-55 10-90 10-90
Range 4 42 20-80 20-80
Trough 2 22 38-62 20-80
Pit 2 40-58 35-65 35-65
Pit 1 28-40 15-30 15-30
Noise 4 9 4
Smooth 3 2
`,
  // Tierra quebrada: muchos lagos chicos y colinas dispersas, terreno fracturado
  shattered: `
Add 28 all
Hill 10 42-65 10-90 10-90
Hill 6 28-48 10-90 10-90
Range 2 38 20-80 20-80
Pit 4 30-50 10-90 10-90
Pit 3 20-35 10-90 10-90
Noise 6 15 5
Smooth 2 2
`,
  // Mediterráneo: altiplano central, valles profundos con lagos, montañas laterales
  mediterranean: `
Add 32 all
Hill 2 68-82 15-40 15-85
Hill 2 62-78 60-85 15-85
Hill 4 42-60 20-80 20-80
Trough 2 28 35-65 15-85
Pit 1 48-62 25-45 30-70
Pit 1 48-62 55-75 30-70
Pit 1 30-42 45-55 45-55
Noise 4 8 4
Smooth 2 2
`,
};

const TEMPLATE_KEYS = Object.keys(TEMPLATES);

export function chooseTemplate(seed: number): string {
  return TEMPLATE_KEYS[seed % TEMPLATE_KEYS.length];
}

export function generateHeightmap(seed: number, cols: number, rows: number): HeightGrid {
  const rng = mulberry32(seed);
  const g: HeightGrid = { h: new Float32Array(cols * rows), cols, rows };
  const tname = chooseTemplate(seed);
  runTemplate(g, rng, TEMPLATES[tname]);
  return g;
}
