import { describe, it, expect, beforeEach } from "vitest";
import {
  buildMacroNavGrid,
  getMoveSpeedMultiplier,
  getEffectiveSpeed,
  hasLineOfSight,
  getVisionRadius,
  getEffectiveSniperRange,
  estimateTravelMs,
  updateVelocityFactor,
  sampleCell,
  SEA_LEVEL,
} from "../terrainTactics.js";
import type { TerrainSnapshot } from "../../sim/worldState.js";
import type { TerrainKind } from "../../worldgen/worldTerrainConfigData.js";

function makeTerrain(
  cols: number,
  rows: number,
  fill: TerrainKind = "PLAINS",
  height = 40,
): TerrainSnapshot {
  const cells: TerrainKind[] = Array.from({ length: cols * rows }, () => fill);
  const heights = new Uint8Array(cols * rows).fill(height);
  const hillshade = new Uint8Array(cols * rows).fill(128);
  return { cells, heights, hillshade, cols, rows, seed: 1 };
}

describe("terrainTactics", () => {
  it("forest slows movement vs plains", () => {
    expect(getMoveSpeedMultiplier("FOREST", 40)).toBeLessThan(getMoveSpeedMultiplier("PLAINS", 40));
    expect(getMoveSpeedMultiplier("ROAD", 40)).toBeGreaterThan(getMoveSpeedMultiplier("PLAINS", 40));
  });

  it("water and mountain are unwalkable in nav grid", () => {
    const t = makeTerrain(8, 8, "PLAINS");
    t.cells[0] = "WATER";
    t.cells[1] = "MOUNTAIN";
    t.heights[0] = 10;
    const grid = buildMacroNavGrid(t);
    expect(grid.blocked[0]).toBe(1);
    expect(grid.blocked[1]).toBe(1);
    expect(grid.moveCost[2]).toBeLessThan(Infinity);
  });

  it("height penalizes high ground movement", () => {
    const low = getMoveSpeedMultiplier("PLAINS", 30);
    const high = getMoveSpeedMultiplier("PLAINS", 75);
    expect(high).toBeLessThan(low);
  });

  it("hills extend sniper range", () => {
    const t = makeTerrain(16, 16, "HILLS", 60);
    const grid = buildMacroNavGrid(t);
    const plainRange = getEffectiveSniperRange(4, 4, buildMacroNavGrid(makeTerrain(16, 16, "PLAINS", 30)));
    const hillRange = getEffectiveSniperRange(4, 4, grid);
    expect(hillRange).toBeGreaterThan(plainRange);
  });

  it("forest blocks line of sight", () => {
    const t = makeTerrain(20, 20, "PLAINS", 40);
    t.cells[10 * 20 + 10] = "FOREST";
    const grid = buildMacroNavGrid(t);
    expect(hasLineOfSight(grid, 5, 10, 15, 10)).toBe(false);
    expect(hasLineOfSight(grid, 5, 5, 5, 15)).toBe(true);
  });

  it("velocity factor eases in and out", () => {
    let v = 0;
    for (let i = 0; i < 30; i++) v = updateVelocityFactor(v, true, 0.016);
    expect(v).toBeGreaterThan(0.9);
    for (let i = 0; i < 30; i++) v = updateVelocityFactor(v, false, 0.016);
    expect(v).toBeLessThan(0.1);
  });

  it("estimateTravelMs aligns with tactical speeds", () => {
    const ms = estimateTravelMs(10);
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(8000);
  });

  it("soldier speed uses terrain multiplier", () => {
    const forest = getEffectiveSpeed("soldier", "FOREST", 40);
    const plains = getEffectiveSpeed("soldier", "PLAINS", 40);
    expect(forest).toBeLessThan(plains);
  });

  it("uses balanced 2.6/2.2 base speeds", () => {
    const soldier = getEffectiveSpeed("soldier", "PLAINS", 40);
    const sniper = getEffectiveSpeed("sniper", "PLAINS", 40);
    expect(soldier).toBeCloseTo(2.6, 1);
    expect(sniper).toBeCloseTo(2.2, 1);
    expect(soldier).toBeGreaterThan(sniper);
  });

  it("stealth reduces effective speed", () => {
    const normal = getEffectiveSpeed("soldier", "PLAINS", 40);
    const stealth = getEffectiveSpeed("soldier", "PLAINS", 40, 0, 1, { stealth: true });
    expect(stealth).toBeLessThan(normal);
  });

  it("sampleCell returns correct kind", () => {
    const t = makeTerrain(8, 8, "SWAMP", 35);
    const grid = buildMacroNavGrid(t);
    const cell = sampleCell(grid, 3.5, 3.5);
    expect(cell.kind).toBe("SWAMP");
    expect(cell.height).toBe(35);
  });
});

describe("terrainTactics sea level", () => {
  it("blocks cells below sea level", () => {
    const t = makeTerrain(4, 4, "PLAINS", SEA_LEVEL - 5);
    const grid = buildMacroNavGrid(t);
    expect(grid.blocked[0]).toBe(1);
  });
});
