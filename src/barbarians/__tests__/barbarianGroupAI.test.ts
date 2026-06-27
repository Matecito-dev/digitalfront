import { describe, expect, it, beforeEach } from "vitest";
import { mulberry32 } from "../../sim/rng.js";
import { initSeason } from "../../sim/seasonsMath.js";
import type { WorldState, BarbarianGroup, BarbarianArchetype } from "../../sim/worldState.js";
import { generateUniqueBarbarianName } from "../barbarianNames.js";
import {
  spawnRoamingGroup,
  tickBarbarianGroups,
  MAX_DISTANCE_FROM_ANCHOR,
  getGroupCentroid,
  BOSS_SPAWN_CHANCE,
  BOSS_HP_MULTIPLIER,
} from "../barbarianGroupAI.js";
import { BARB_SOLDIER_HP } from "../barbarianConfigData.js";
import { findPathMacro, isLandCell, resetPathfindingCache } from "../barbarianPathfinding.js";
import { tickBarbarianGroupCombat, areHostile } from "../barbarianGroupCombat.js";
import { tick } from "../../sim/simEngine.js";

function makeTerrain(cols = 64, rows = 48): WorldState["terrain"] {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  for (let i = 0; i < n; i++) heights[i] = 40;
  for (let col = 28; col < 36; col++) {
    for (let row = 0; row < rows; row++) {
      const i = row * cols + col;
      heights[i] = 10;
      cells[i] = "WATER";
    }
  }
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 99 };
}

function makeState(): WorldState {
  return {
    seed: 99,
    simTimeMs: 0,
    realStartMs: Date.now(),
    speedMultiplier: 1,
    paused: false,
    terrain: makeTerrain(),
    season: initSeason(0),
    camps: new Map(),
    outposts: new Map(),
    cities: new Map(),
    barbarianGroups: new Map(),
    usedBarbarianNames: new Set(),
    playerSquads: new Map(),
    nextId: 1,
  };
}

function placeGroup(
  state: WorldState,
  archetype: BarbarianArchetype,
  x: number,
  y: number,
  id = "g1",
): BarbarianGroup {
  const group: BarbarianGroup = {
    id,
    name: "Test Group",
    archetype,
    anchorX: x,
    anchorY: y,
    state: "RESTING",
    units: [
      { id: "u1", name: "Soldado A", type: "soldier", hp: 120, maxHp: 120, x, y },
      { id: "u2", name: "Franco B", type: "sniper", hp: 70, maxHp: 70, x: x + 0.5, y },
    ],
    tx: x,
    ty: y,
    path: [],
    pathIdx: 0,
    stateUntilMs: 0,
    lastActionMs: 0,
    restCount: 0,
    fatigue: 0,
  };
  state.barbarianGroups.set(id, group);
  return group;
}

describe("barbarianNames", () => {
  it("generates 100 unique names", () => {
    const used = new Set<string>();
    const rng = mulberry32(1);
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      names.add(generateUniqueBarbarianName(used, rng, String(i)));
    }
    expect(names.size).toBe(100);
  });
});

describe("barbarianGroupAI", () => {
  beforeEach(() => resetPathfindingCache());

  it("spawn places units on land", () => {
    const state = makeState();
    const rng = mulberry32(2);
    const group = spawnRoamingGroup(state, 10, 10, "RAIDERS", 0, rng)!;
    expect(group).toBeTruthy();
    for (const u of group.units) {
      expect(isLandCell(state.terrain, u.x, u.y)).toBe(true);
    }
  });

  it("spawns boss bands with 2x HP on lead unit (~5%)", () => {
    let bossCount = 0;
    for (let seed = 0; seed < 600; seed++) {
      const state = makeState();
      const rng = mulberry32(seed);
      const group = spawnRoamingGroup(state, 10, 10, "RAIDERS", 0, rng);
      if (!group?.isBoss) continue;
      bossCount++;
      expect(group.units[0]!.maxHp).toBe(BARB_SOLDIER_HP * BOSS_HP_MULTIPLIER);
      expect(group.units[0]!.name.startsWith("Jefe ")).toBe(true);
    }
    expect(bossCount).toBeGreaterThan(10);
    expect(bossCount).toBeLessThan(60);
    expect(BOSS_SPAWN_CHANCE).toBe(0.05);
  });

  it("RESTING transitions to WANDERING after timeout", () => {
    const state = makeState();
    const rng = mulberry32(3);
    const group = spawnRoamingGroup(state, 10, 10, "RAIDERS", 0, rng)!;
    group.stateUntilMs = 0;
    const events = tickBarbarianGroups(state, 1000, 50, rng);
    expect(["WANDERING", "MARCHING"]).toContain(group.state);
    expect(events.some(e => e.type === "GROUP_STATE_CHANGED" || e.type === "GROUP_DEPARTED")).toBe(true);
  });

  it("RETURNING when far from anchor", () => {
    const state = makeState();
    const group = placeGroup(state, "RAIDERS", 10, 10);
    for (const u of group.units) u.y = 10 + MAX_DISTANCE_FROM_ANCHOR + 5;
    group.state = "WANDERING";
    group.stateUntilMs = 0;
    const rng = mulberry32(4);
    tickBarbarianGroups(state, 5000, 50, rng);
    expect(group.state).toBe("RETURNING");
  });

  it("empty path when destination is ocean", () => {
    const terrain = makeTerrain();
    const path = findPathMacro(terrain, 10, 10, 32, 24);
    expect(path).toEqual([]);
  });
});

describe("barbarianGroupCombat", () => {
  beforeEach(() => resetPathfindingCache());

  it("RAIDERS vs MARAUDERS engage in range", () => {
    const state = makeState();
    const a = placeGroup(state, "RAIDERS", 10, 10, "ga");
    const b = placeGroup(state, "MARAUDERS", 11, 10, "gb");
    a.state = "WANDERING";
    b.state = "WANDERING";
    const events = tickBarbarianGroupCombat(state, 1000, 50, mulberry32(5));
    expect(a.state).toBe("ENGAGED");
    expect(b.state).toBe("ENGAGED");
    expect(events.some(e => e.type === "GROUP_ENGAGED")).toBe(true);
  });

  it("soldier damage can kill unit", () => {
    const state = makeState();
    const a = placeGroup(state, "RAIDERS", 10, 10, "ga");
    const b = placeGroup(state, "MARAUDERS", 10.2, 10, "gb");
    b.units[0].hp = 1;
    a.state = b.state = "ENGAGED";
    a.engageTargetId = "gb";
    b.engageTargetId = "ga";
    const rng = mulberry32(6);
    for (let i = 0; i < 80; i++) {
      tickBarbarianGroupCombat(state, 1000 + i * 50, 50, rng);
    }
    expect(b.units.some(u => u.hp <= 0) || !state.barbarianGroups.has("gb")).toBe(true);
  });

  it("disbands empty group", () => {
    const state = makeState();
    const g = placeGroup(state, "RAIDERS", 10, 10);
    g.units.forEach(u => { u.hp = 0; });
    const events = tickBarbarianGroups(state, 1000, 50, mulberry32(7));
    expect(state.barbarianGroups.has(g.id)).toBe(false);
    expect(events.some(e => e.type === "GROUP_DISBANDED")).toBe(true);
  });

  it("HUNTERS do not initiate combat", () => {
    const state = makeState();
    const a = placeGroup(state, "HUNTERS", 10, 10, "gh");
    const b = placeGroup(state, "RAIDERS", 10.5, 10, "gr");
    const events = tickBarbarianGroupCombat(state, 1000, 50, mulberry32(9));
    expect(events.filter(e => e.type === "GROUP_ENGAGED")).toHaveLength(0);
    expect(a.state).not.toBe("ENGAGED");
  });
});

describe("sim integration", () => {
  it("tickSpawn creates roaming groups", () => {
    const state = makeState();
    const rng = mulberry32(10);
    tick(state, 50, rng);
    expect(state.barbarianGroups.size).toBeGreaterThan(0);
    expect(state.camps.size).toBe(0);
  });
});
