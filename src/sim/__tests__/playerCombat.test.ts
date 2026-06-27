import { describe, it, expect, beforeEach } from "vitest";
import { mulberry32 } from "../rng.js";
import { initSeason } from "../seasonsMath.js";
import type { WorldState, BarbarianGroup } from "../worldState.js";
import { createPlayerSquad, applyPlayerOrder, ensurePlayerSquad } from "../playerSquad.js";
import { tickPlayerCombat } from "../playerCombat.js";
import { resetPathfindingCache } from "../../barbarians/barbarianPathfinding.js";

function makeTerrain(cols = 64, rows = 48): WorldState["terrain"] {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  for (let i = 0; i < n; i++) heights[i] = 40;
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 1 };
}

function makeState(): WorldState {
  return {
    seed: 1,
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

function makeBarbGroup(id: string, x: number, y: number): BarbarianGroup {
  return {
    id,
    name: "Raiders",
    archetype: "RAIDERS",
    anchorX: x,
    anchorY: y,
    state: "RESTING",
    units: [
      { id: "b1", name: "Brute", type: "soldier", hp: 80, maxHp: 80, x: x + 1, y, cooldownMs: 0 },
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
}

describe("playerCombat", () => {
  beforeEach(() => resetPathfindingCache());

  it("damages barbarian units when player attacks", () => {
    const state = makeState();
    const squad = createPlayerSquad("c1", "Capitán Test", 10, 10);
    state.playerSquads.set("c1", squad);
    const group = makeBarbGroup("g1", 12, 10);
    state.barbarianGroups.set("g1", group);

    applyPlayerOrder(squad, "attack", 12, 10, "g1", state.terrain);

    const rng = mulberry32(42);
    let barbHpBefore = group.units[0].hp;
    for (let i = 0; i < 30; i++) {
      tickPlayerCombat(state, i * 50, 50, rng);
    }
    expect(group.units[0]?.hp ?? 0).toBeLessThan(barbHpBefore);
  });

  it("creates squad with five units", () => {
    const squad = ensurePlayerSquad(makeState(), "p1", "TestCap", 20, 20);
    expect(squad.units).toHaveLength(5);
    expect(squad.units.filter(u => u.type === "soldier")).toHaveLength(3);
    expect(squad.units.filter(u => u.type === "sniper")).toHaveLength(2);
    expect(squad.units.find(u => u.id === "s1")?.name).toBe("TestCap");
    expect(squad.profileId).toBe("p1");
    expect(squad.captainName).toBe("TestCap");
  });
});
