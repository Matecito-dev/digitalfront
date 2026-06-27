// Deterministic PRNG (mulberry32) with named sub-streams derived from a root seed.

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

// Derive a child RNG stream from a root seed + string key
export function deriveRng(rootSeed: number, key: string): RNG {
  let h = rootSeed;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x9e3779b9) >>> 0;
  }
  return mulberry32(h);
}

// Pick a random integer in [0, n)
export function randInt(rng: RNG, n: number): number {
  return Math.floor(rng() * n);
}

// Pick a random element from an array
export function randChoice<T>(rng: RNG, arr: T[]): T {
  return arr[randInt(rng, arr.length)];
}
