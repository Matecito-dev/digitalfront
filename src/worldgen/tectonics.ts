// Tectonic plate simulation.
// Key fix vs naive approach: uplift/rift is spread with a Gaussian falloff
// over a wide radius around plate borders, creating smooth mountain ranges
// instead of 1-pixel-wide visible seams.

function rng32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Plate {
  cx: number; cy: number;
  vx: number; vy: number;
  oceanic: boolean;
}

function nearestPlate(px: number, py: number, plates: Plate[]): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < plates.length; i++) {
    const dx = px - plates[i].cx, dy = py - plates[i].cy;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function applyTectonics(
  h: Float32Array,
  cols: number,
  rows: number,
  seed: number,
  numPlates = 8,
  upliftStrength = 2.0,
  riftDepth = 1.5,
): void {
  const rng = rng32(seed ^ 0xdeadbeef);

  // Plate seeds with minimum separation (Bridson-ish)
  const plates: Plate[] = [];
  const minDist = 0.9 / Math.sqrt(numPlates);
  let att = 0;
  while (plates.length < numPlates && att++ < numPlates * 60) {
    const cx = rng(), cy = rng();
    if (plates.some(p => { const dx=cx-p.cx,dy=cy-p.cy; return dx*dx+dy*dy < minDist*minDist; })) continue;
    const ang = rng() * Math.PI * 2;
    plates.push({ cx, cy, vx: Math.cos(ang), vy: Math.sin(ang), oceanic: rng() < 0.4 });
  }

  const N = cols * rows;
  const plateOf = new Uint8Array(N);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      plateOf[row * cols + col] = nearestPlate(col / cols, row / rows, plates);
    }
  }

  // ── Continental bias: oceanic plates sit lower ────────────────────────────
  // Applied UNIFORMLY per plate (no visible border artifact here)
  for (let i = 0; i < N; i++) {
    h[i] += plates[plateOf[i]].oceanic ? -6 : 5;
  }

  // ── Uplift / rift with GAUSSIAN FALLOFF ──────────────────────────────────
  // Step 1: compute a "tectonic signal" at every cell based on whether its plate
  // pair is convergent or divergent. Store as sparse per-border-cell signal.
  const signal = new Float32Array(N); // 0 = interior, >0 = convergent, <0 = divergent

  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const i = row * cols + col;
      const pi = plateOf[i];
      let borderPlate = -1;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
        const nb = (row + dr) * cols + (col + dc);
        if (plateOf[nb] !== pi) { borderPlate = plateOf[nb]; break; }
      }
      if (borderPlate < 0) continue;

      const pA = plates[pi], pB = plates[borderPlate];
      const dx = pB.cx - pA.cx, dy = pB.cy - pA.cy;
      const len = Math.sqrt(dx*dx + dy*dy) + 1e-9;
      const relV = (pA.vx - pB.vx)*(dx/len) + (pA.vy - pB.vy)*(dy/len);

      if (relV > 0.15) {
        // Convergent — scale by whether continental or oceanic
        const factor = (!pA.oceanic && !pB.oceanic) ? 1.0 : 0.55;
        signal[i] = relV * factor;
      } else if (relV < -0.15) {
        signal[i] = relV; // divergent → negative
      }
    }
  }

  // Step 2: Gaussian blur the signal with radius = ~6% of shortest dimension.
  // This spreads 1-px border signals into wide, smooth mountain bands.
  const radius = Math.max(4, Math.round(Math.min(cols, rows) * 0.06));
  const sigma = radius / 2.5;
  const blurred = new Float32Array(N);

  // Separable 1D Gaussian blur (horizontal pass → temp, vertical pass → blurred)
  const temp = new Float32Array(N);
  const kLen = radius * 2 + 1;
  const kernel = new Float32Array(kLen);
  let kSum = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-(k*k) / (2*sigma*sigma));
    kernel[k + radius] = v;
    kSum += v;
  }
  for (let k = 0; k < kLen; k++) kernel[k] /= kSum;

  // Horizontal
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const nc = Math.max(0, Math.min(cols-1, col+k));
        s += signal[row*cols + nc] * kernel[k+radius];
      }
      temp[row*cols + col] = s;
    }
  }
  // Vertical
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const nr = Math.max(0, Math.min(rows-1, row+k));
        s += temp[nr*cols + col] * kernel[k+radius];
      }
      blurred[row*cols + col] = s;
    }
  }

  // Step 3: Apply blurred signal to heightmap
  for (let i = 0; i < N; i++) {
    if (blurred[i] > 0) {
      h[i] += blurred[i] * 22 * upliftStrength;   // mountains
    } else if (blurred[i] < 0) {
      h[i] += blurred[i] * 10 * riftDepth;         // rifts / trenches
    }
  }

  // Clamp
  for (let i = 0; i < N; i++) h[i] = Math.min(100, Math.max(0, h[i]));
}
