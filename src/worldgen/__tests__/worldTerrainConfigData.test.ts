import { afterAll, describe, expect, it } from "vitest";
import {
  calculatePathSpeedMultiplier,
  calculateWalkablePath,
  findNearestBuildablePoint,
  isBuildableTerrain,
  isPathReachable,
  resolveTerrainAt,
  setActiveProceduralTerrain,
  worldToNormalized,
  type TerrainKind,
} from "../worldTerrainConfigData.js";

const size = { width: 1000, height: 800 };

describe("world terrain config", () => {
  it("converts centered world coordinates to normalized map coordinates", () => {
    expect(worldToNormalized(0, 0, size.width, size.height)).toEqual({ x: 0.5, y: 0.5 });
    expect(worldToNormalized(-500, -400, size.width, size.height)).toEqual({ x: 0, y: 0 });
    expect(worldToNormalized(500, 400, size.width, size.height)).toEqual({ x: 1, y: 1 });
  });

  it("marks local mountain and water zones as blocked when no editor mask overrides them", () => {
    expect(resolveTerrainAt(0, -360, size.width, size.height).kind).toBe("MOUNTAIN");
    expect(isBuildableTerrain(430, 0, size.width, size.height)).toBe(false);
  });

  it("finds a nearby buildable point when the requested point is blocked", () => {
    const point = findNearestBuildablePoint(430, 0, size.width, size.height);

    expect(isBuildableTerrain(point.x, point.y, size.width, size.height)).toBe(true);
  });

  it("keeps path speed multipliers bounded for terrain-aware travel", () => {
    const multiplier = calculatePathSpeedMultiplier(-250, 0, 250, 0, size.width, size.height);

    expect(multiplier).toBeGreaterThanOrEqual(0.15);
    expect(multiplier).toBeLessThanOrEqual(1.4);
  });
});

describe("nav-grid pathfinding around water", () => {
  const W = 4000, H = 4000;
  const COLS = 40, ROWS = 40;

  // Vertical WATER wall (cols 18-22) that fully separates left from right, except
  // a 6-row gap at the top through which a route can pass.
  function buildTerrain(withGap: boolean): TerrainKind[] {
    const cells: TerrainKind[] = new Array(COLS * ROWS).fill("PLAINS");
    for (let row = 0; row < ROWS; row++) {
      if (withGap && row < 6) continue; // open corridor at the top
      for (let col = 18; col <= 22; col++) cells[row * COLS + col] = "WATER";
    }
    return cells;
  }

  afterAll(() => setActiveProceduralTerrain(null));

  it("routes around a water wall without ever crossing water, and rebuilds when terrain changes", () => {
    setActiveProceduralTerrain({ cols: COLS, rows: ROWS, cells: buildTerrain(true) });

    const from = { x: -1800, y: 1500 }; // bottom-left
    const to = { x: 1800, y: 1500 };    // bottom-right (other side of the wall)

    expect(isPathReachable(from.x, from.y, to.x, to.y, W, H)).toBe(true);

    const path = calculateWalkablePath(from.x, from.y, to.x, to.y, W, H);
    expect(path.length).toBeGreaterThan(2); // detoured, not a straight fallback

    // Every sampled point along the corridor must be on dry, walkable terrain.
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        expect(resolveTerrainAt(x, y, W, H).kind).not.toBe("WATER");
      }
    }

    // Sealing the gap (new terrain) must invalidate the cached grid → now unreachable.
    setActiveProceduralTerrain({ cols: COLS, rows: ROWS, cells: buildTerrain(false) });
    expect(isPathReachable(from.x, from.y, to.x, to.y, W, H)).toBe(false);
  });
});
