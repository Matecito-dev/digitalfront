import { describe, it, expect } from "vitest";
import { generateOutposts, OUTPOST_MIN_COUNT, OUTPOST_MAX_COUNT } from "../outpostCamp.js";
import { MAP_SECTOR_COUNT } from "../../mmo/spawn.js";
import type { TerrainSnapshot } from "../worldState.js";

function makeTerrain(cols = 80, rows = 60): TerrainSnapshot {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  for (let i = 0; i < n; i++) heights[i] = 40;
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 42 };
}

describe("outpostCamp", () => {
  it("generates 14–18 outposts deterministically", () => {
    const terrain = makeTerrain();
    const a = generateOutposts(terrain, 42, { pois: [{ x: 20, y: 20 }] });
    const b = generateOutposts(terrain, 42, { pois: [{ x: 20, y: 20 }] });
    expect(a.size).toBeGreaterThanOrEqual(OUTPOST_MIN_COUNT);
    expect(a.size).toBeLessThanOrEqual(OUTPOST_MAX_COUNT);
    expect(a.size).toBe(b.size);
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  });

  it("has at least one outpost per sector", () => {
    const terrain = makeTerrain();
    const outposts = generateOutposts(terrain, 99);
    const sectors = new Set([...outposts.values()].map(o => o.sectorIndex));
    expect(sectors.size).toBe(MAP_SECTOR_COUNT);
  });

  it("places outposts on walkable terrain", () => {
    const terrain = makeTerrain();
    const outposts = generateOutposts(terrain, 7);
    for (const o of outposts.values()) {
      expect(o.x).toBeGreaterThan(1);
      expect(o.y).toBeGreaterThan(1);
      expect(o.x).toBeLessThan(terrain.cols - 1);
      expect(o.y).toBeLessThan(terrain.rows - 1);
      expect(o.radius).toBeGreaterThan(0);
      expect(o.safeRadius).toBeGreaterThan(o.radius);
    }
  });
});
