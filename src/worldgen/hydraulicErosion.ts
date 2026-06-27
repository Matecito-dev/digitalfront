// Hydraulic erosion via particle droplets.
// Each droplet flows downhill, eroding high ground and depositing sediment in valleys.

export function hydraulicErosion(
  h: Float32Array,
  cols: number,
  rows: number,
  seed: number,
  iterations = 30000,
  erosionStrength = 0.08,
  depositionRate = 0.3,
): void {
  if (iterations <= 0) return;

  let s = seed ^ 0xfade1234;
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const MAX_STEPS = 64;
  const INERTIA = 0.05;
  const MIN_SLOPE = 0.001;
  const CAPACITY_FACTOR = 8;

  function getH(col: number, row: number): number {
    col = Math.max(0, Math.min(cols - 1, col));
    row = Math.max(0, Math.min(rows - 1, row));
    return h[row * cols + col];
  }

  function bilinear(x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    return (1 - fx) * (1 - fy) * getH(x0, y0)
         + fx       * (1 - fy) * getH(x0 + 1, y0)
         + (1 - fx) * fy       * getH(x0, y0 + 1)
         + fx       * fy       * getH(x0 + 1, y0 + 1);
  }

  // Bilinear gradient
  function gradient(x: number, y: number): [number, number] {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const h00 = getH(x0, y0), h10 = getH(x0+1, y0), h01 = getH(x0, y0+1), h11 = getH(x0+1, y0+1);
    const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
    const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
    return [gx, gy];
  }

  // Deposit/erode at bilinear footprint
  function depositAt(x: number, y: number, amount: number): void {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const add = (c: number, r: number, w: number) => {
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      h[r * cols + c] += amount * w;
    };
    add(x0,   y0,   (1-fx)*(1-fy));
    add(x0+1, y0,   fx*(1-fy));
    add(x0,   y0+1, (1-fx)*fy);
    add(x0+1, y0+1, fx*fy);
  }

  for (let it = 0; it < iterations; it++) {
    let x = rng() * (cols - 2) + 1;
    let y = rng() * (rows - 2) + 1;
    let vx = 0, vy = 0;
    let sediment = 0;
    let water = 1;

    for (let step = 0; step < MAX_STEPS; step++) {
      const [gx, gy] = gradient(x, y);
      vx = vx * INERTIA - gx * (1 - INERTIA);
      vy = vy * INERTIA - gy * (1 - INERTIA);
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < 1e-6) break;
      vx /= speed; vy /= speed;

      const nx = x + vx, ny = y + vy;
      if (nx < 0 || ny < 0 || nx >= cols - 1 || ny >= rows - 1) break;

      const oldH = bilinear(x, y);
      const newH = bilinear(nx, ny);
      const slope = Math.max(MIN_SLOPE, oldH - newH);

      const capacity = Math.max(0.01, slope) * speed * water * CAPACITY_FACTOR;

      if (sediment > capacity) {
        const deposit = (sediment - capacity) * depositionRate;
        sediment -= deposit;
        depositAt(x, y, deposit);
      } else {
        const erode = Math.min((capacity - sediment) * erosionStrength, slope * 0.5);
        sediment += erode;
        depositAt(x, y, -erode);
      }

      water *= 0.01;
      x = nx; y = ny;

      // Stop if we reach water (below sea level proxy ~20)
      if (bilinear(x, y) < 20) break;
    }

    // Deposit remaining sediment at final position
    if (sediment > 0) depositAt(x, y, sediment);
  }

  // Clamp
  for (let i = 0; i < h.length; i++) h[i] = Math.min(100, Math.max(0, h[i]));
}
