// Climate system: orographic rainfall + latitude bands + polar caps.
// Returns moisture[N] and temperature[N] arrays, both in [0,1].

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(v: number, lo = 0, hi = 1): number { return Math.max(lo, Math.min(hi, v)); }

// Simple value noise for temperature jitter
function hash(x: number, y: number, s: number): number {
  const n = (x * 1619 + y * 31337 + s * 1013) | 0;
  const m = (n ^ (n << 13)) ^ n;
  return (1 - ((m * (m * m * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824) * 0.5 + 0.5;
}
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = (x - ix) ** 3 * ((x - ix) * ((x - ix) * 6 - 15) + 10);
  const fy = (y - iy) ** 3 * ((y - iy) * ((y - iy) * 6 - 15) + 10);
  return lerp(lerp(hash(ix, iy, seed), hash(ix+1, iy, seed), fx),
              lerp(hash(ix, iy+1, seed), hash(ix+1, iy+1, seed), fx), fy);
}

export interface ClimateResult {
  moisture: Float32Array;
  temperature: Float32Array;
}

export function computeClimate(
  heights: Uint8Array | Float32Array,
  cols: number,
  rows: number,
  seed: number,
  windAngleDeg = 45,
  moistureScale = 1.0,
  orographicStrength = 1.0,
): ClimateResult {
  const N = cols * rows;
  const moisture = new Float32Array(N);
  const temperature = new Float32Array(N);

  // Wind direction: angle in degrees, convert to unit vector (wind blows FROM this direction)
  const windRad = (windAngleDeg * Math.PI) / 180;
  const wx = Math.cos(windRad);  // wind moves in +x, +y
  const wy = Math.sin(windRad);

  // --- Orographic rainfall ---
  // March rays across the grid in wind direction.
  // Each ray starts at the upwind edge and accumulates moisture from the ocean.
  // Crossing a mountain ridge dumps moisture (rain shadow on leeward side).

  // We sweep along the anti-wind direction to trace each air parcel's path.
  // For simplicity: iterate through grid cells sorted by dot(pos, windVec) ascending
  // (upwind first), carry a moisture packet that decays over high terrain.

  // Base moisture: start each cell at 1.0 at ocean, 0.6 at coast, 0.0 at land
  // Then propagate downwind, losing moisture to orographic lift.

  // Compute pass order: sort indices by projection onto wind direction (upwind first)
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => {
    const ax = (a % cols) / cols * wx + (Math.floor(a / cols) / rows) * wy;
    const bx = (b % cols) / cols * wx + (Math.floor(b / cols) / rows) * wy;
    return ax - bx;
  });

  // Running moisture per column perpendicular to wind
  // We simulate multiple independent air-parcel streams: one per "row" perpendicular to wind
  // Simplified: just propagate from upwind edge cell-by-cell

  const airMoisture = new Float32Array(N);

  // Initialize: ocean cells start with full moisture
  for (let i = 0; i < N; i++) {
    airMoisture[i] = heights[i] < 20 ? 1.0 : 0.3; // baseline land moisture
  }

  // Propagate downwind (sorted order = upwind first)
  for (const idx of order) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const h = heights[idx] / 100;

    // Find upwind neighbor (opposite of wind direction)
    const nc = Math.round(col - wx);
    const nr = Math.round(row - wy);
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
    const upwindMoisture = airMoisture[nr * cols + nc];

    // Orographic lift: gain in elevation removes moisture from air
    const upwindH = heights[nr * cols + nc] / 100;
    const elevGain = Math.max(0, h - upwindH);
    const rainOut = elevGain * 1.8 * orographicStrength; // moisture lost to precipitation
    const carryOver = upwindMoisture * Math.exp(-rainOut * 0.5); // exponential decay

    // Over ocean: replenish
    const replenish = heights[idx] < 20 ? 0.15 : 0;
    airMoisture[idx] = Math.min(1, carryOver + replenish);
  }

  // Deposit moisture from air to ground (precipitation)
  for (let i = 0; i < N; i++) {
    if (heights[i] < 20) { moisture[i] = 1.0; continue; }
    const h = heights[i] / 100;

    // Windward slope gets more rain (orographic precipitation)
    const col = i % cols, row = Math.floor(i / cols);
    const nc = Math.round(col - wx), nr = Math.round(row - wy);
    let upwindH = h;
    if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) upwindH = heights[nr * cols + nc] / 100;
    const windwardBoost = Math.max(0, h - upwindH) * 2.0 * orographicStrength;

    // BFS water proximity (done separately below, just use airMoisture for now)
    moisture[i] = clamp((airMoisture[i] + windwardBoost) * moistureScale);
  }

  // Add water proximity bonus via quick BFS
  {
    const MAX_DIST = 20;
    const dist = new Int16Array(N).fill(-1);
    const q: number[] = [];
    for (let i = 0; i < N; i++) if (heights[i] < 20) { dist[i] = 0; q.push(i); }
    let head = 0;
    while (head < q.length) {
      const ci = q[head++];
      const cc = ci % cols, cr = Math.floor(ci / cols);
      const d = dist[ci];
      if (d >= MAX_DIST) continue;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
        const nc2 = cc + dc, nr2 = cr + dr;
        if (nc2 < 0 || nr2 < 0 || nc2 >= cols || nr2 >= rows) continue;
        const ni = nr2 * cols + nc2;
        if (dist[ni] === -1) { dist[ni] = d + 1; q.push(ni); }
      }
    }
    for (let i = 0; i < N; i++) {
      if (heights[i] < 20) continue;
      const d = dist[i] < 0 ? MAX_DIST : dist[i];
      const prox = 1 - Math.min(1, d / MAX_DIST);
      moisture[i] = clamp(moisture[i] * 0.65 + prox * 0.35);
    }
  }

  // --- Temperature ---
  // Latitude: row 0 = north (cold), row rows-1 = south (warm)
  // Elevation cooling: high ground colder
  // Small FBM jitter so isotherms aren't flat bands
  const tempSeed = (seed * 5003 + 19) | 0;
  for (let i = 0; i < N; i++) {
    if (heights[i] < 20) { temperature[i] = 0.5; continue; }
    const row = Math.floor(i / cols);
    const col = i % cols;
    const latNorm = row / (rows - 1);
    const elevN = (heights[i] - 20) / 80;
    const jitter = (valueNoise((col / cols) * 6 + 5.5, (row / rows) * 6 + 31.0, tempSeed) - 0.5) * 0.20;
    temperature[i] = clamp(0.26 + 0.74 * latNorm - elevN * 0.42 + jitter);
  }

  return { moisture, temperature };
}
