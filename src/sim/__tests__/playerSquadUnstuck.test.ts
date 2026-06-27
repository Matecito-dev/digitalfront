import { describe, it, expect } from "vitest";
import { initSeason } from "../seasonsMath.js";
import type { WorldState } from "../worldState.js";
import { createPlayerSquad, unstuckPlayerSquad, countStuckUnits } from "../playerSquad.js";

function makeTerrain(cols = 32, rows = 32): WorldState["terrain"] {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  const cellsMut = cells as ("PLAINS" | "MOUNTAIN")[];
  cellsMut[10 * cols + 10] = "MOUNTAIN";
  for (let i = 0; i < n; i++) heights[i] = 40;
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 1 };
}

describe("playerSquad unstuck", () => {
  it("relocates unit stuck on mountain", () => {
    const terrain = makeTerrain();
    const squad = createPlayerSquad("p1", "Cap", 10.5, 10.5);
    expect(countStuckUnits(squad, terrain)).toBe(1);
    const moved = unstuckPlayerSquad(squad, terrain);
    expect(moved).toBeGreaterThan(0);
    expect(countStuckUnits(squad, terrain)).toBe(0);
  });

  it("does nothing when all units walkable", () => {
    const terrain = makeTerrain();
    const squad = createPlayerSquad("p1", "Cap", 5.5, 5.5);
    expect(unstuckPlayerSquad(squad, terrain)).toBe(0);
  });
});
