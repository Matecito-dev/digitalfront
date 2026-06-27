import { describe, it, expect, beforeEach } from "vitest";
import { initSeason } from "../../src/sim/seasonsMath.js";
import type { WorldState } from "../../src/sim/worldState.js";
import {
  applyPlayerOrder,
  createPlayerSquad,
  getPlayerCentroid,
} from "../../src/sim/playerSquad.js";
import { getClientAoiAnchor, syncClientAoiAnchor } from "../simBroadcast.js";
import { resetPathfindingCache } from "../../src/barbarians/barbarianPathfinding.js";

function makeTerrain(cols = 128, rows = 96): WorldState["terrain"] {
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

describe("getClientAoiAnchor", () => {
  beforeEach(() => resetPathfindingCache());

  it("uses sim centroid, not order destination", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Alpha", 50, 50);
    state.playerSquads.set("p1", squad);

    const client = { profileId: "p1", squadX: 90, squadY: 90 };
    const before = getClientAoiAnchor(client, state)!;
    const centroid = getPlayerCentroid(squad.units.filter(u => u.hp > 0));

    expect(before.x).toBeCloseTo(centroid.x, 5);
    expect(before.y).toBeCloseTo(centroid.y, 5);
    expect(before.x).not.toBeCloseTo(90, 0);

    applyPlayerOrder(squad, "move", 120, 80, null, state.terrain);
    const afterOrder = getClientAoiAnchor(client, state)!;

    expect(afterOrder.x).toBeCloseTo(centroid.x, 5);
    expect(afterOrder.y).toBeCloseTo(centroid.y, 5);
    expect(afterOrder.x).not.toBeCloseTo(120, 0);
  });

  it("syncClientAoiAnchor overwrites stale client pos with sim centroid", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Alpha", 40, 30);
    state.playerSquads.set("p1", squad);

    const client = { profileId: "p1", squadX: 200, squadY: 200 };
    syncClientAoiAnchor(client, state);

    const c = getPlayerCentroid(squad.units.filter(u => u.hp > 0));
    expect(client.squadX).toBeCloseTo(c.x, 5);
    expect(client.squadY).toBeCloseTo(c.y, 5);
  });
});
