import { describe, it, expect, beforeEach } from "vitest";
import { mulberry32 } from "../../sim/rng.js";
import { initSeason } from "../../sim/seasonsMath.js";
import type { WorldState, BarbarianGroup, BarbarianArchetype } from "../../sim/worldState.js";
import { createPlayerSquad } from "../../sim/playerSquad.js";
import { resetPathfindingCache } from "../barbarianPathfinding.js";
import {
  tickBarbarianPlayerAI,
  findNearestDetectablePlayer,
  isPlayerHunterArchetype,
  huntTransitionProbability,
  PLAYER_DETECT_RADIUS,
} from "../barbarianPlayerAI.js";

function makeTerrain(cols = 64, rows = 48): WorldState["terrain"] {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  for (let i = 0; i < n; i++) heights[i] = 40;
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 7 };
}

function makeState(): WorldState {
  return {
    seed: 7,
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
    state: "WANDERING",
    units: [
      { id: "u1", name: "Soldado A", type: "soldier", hp: 120, maxHp: 120, x, y },
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

describe("barbarianPlayerAI", () => {
  beforeEach(() => resetPathfindingCache());

  it("flags aggressive archetypes as hunters", () => {
    expect(isPlayerHunterArchetype("RAIDERS")).toBe(true);
    expect(isPlayerHunterArchetype("MARAUDERS")).toBe(true);
    expect(isPlayerHunterArchetype("WARHOST")).toBe(true);
    expect(isPlayerHunterArchetype("HUNTERS")).toBe(false);
    expect(isPlayerHunterArchetype("NOMADS")).toBe(false);
  });

  it("detects player squad within radius and enters HUNTING", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 30, 30);
    state.playerSquads.set("p1", squad);
    const group = placeGroup(state, "RAIDERS", 18, 30);

    const prey = findNearestDetectablePlayer(state, group, PLAYER_DETECT_RADIUS.RAIDERS);
    expect(prey?.profileId).toBe("p1");

    const rng = mulberry32(1);
    let hunted = false;
    for (let i = 0; i < 20 && !hunted; i++) {
      tickBarbarianPlayerAI(state, 1000 + i * 50, rng);
      hunted = group.state === "HUNTING";
    }
    expect(group.state).toBe("HUNTING");
    expect(group.huntProfileId).toBe("p1");
    expect(group.path.length).toBeGreaterThan(0);
  });

  it("does not hunt with peaceful archetypes", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 30, 30);
    state.playerSquads.set("p1", squad);
    const group = placeGroup(state, "NOMADS", 10, 30);

    tickBarbarianPlayerAI(state, 1000, mulberry32(2));
    expect(group.state).toBe("WANDERING");
    expect(group.huntProfileId).toBeUndefined();
  });

  it("marches toward player while HUNTING", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 40, 30);
    state.playerSquads.set("p1", squad);
    const group = placeGroup(state, "MARAUDERS", 10, 30);
    group.state = "HUNTING";
    group.huntProfileId = "p1";

    tickBarbarianPlayerAI(state, 2000, mulberry32(3));
    expect(group.tx).toBeGreaterThan(group.anchorX);
  });

  it("hunt probability increases with proximity", () => {
    const edge = huntTransitionProbability(22, 22);
    const close = huntTransitionProbability(14, 22);
    expect(edge).toBeLessThan(close);
    expect(close).toBeGreaterThan(0.5);
  });
});
