import { describe, it, expect, beforeEach } from "vitest";
import { mulberry32 } from "../rng.js";
import { initSeason } from "../seasonsMath.js";
import type { WorldState } from "../worldState.js";
import { createPlayerSquad } from "../playerSquad.js";
import { tickSpawn } from "../../barbarians/barbarianSim.js";
import {
  markPlayerBarbDefeat,
  isPlayerOnBarbDefeatCooldown,
  clearBarbDefeatCooldowns,
  BARB_DEFEAT_COOLDOWN_MS,
} from "../../barbarians/barbarianDefeatCooldown.js";
import { findUnderServedPlayer } from "../../barbarians/barbarianSpawnPlacements.js";

function makeState(): WorldState {
  return {
    seed: 1,
    simTimeMs: 60_000,
    realStartMs: Date.now(),
    speedMultiplier: 1,
    paused: false,
    terrain: {
      cells: Array.from({ length: 64 * 48 }, () => "PLAINS" as const),
      heights: new Uint8Array(64 * 48).fill(40),
      hillshade: new Uint8Array(64 * 48),
      cols: 64,
      rows: 48,
      seed: 1,
    },
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

describe("barbarianDefeatCooldown", () => {
  beforeEach(() => clearBarbDefeatCooldowns());

  it("blocks near-player respawn for a while after defeat", () => {
    const state = makeState();
    state.playerSquads.set("p1", createPlayerSquad("p1", "Cap", 20, 20, Date.now()));
    markPlayerBarbDefeat("p1", 60_000);
    expect(isPlayerOnBarbDefeatCooldown("p1", 60_000)).toBe(true);
    expect(isPlayerOnBarbDefeatCooldown("p1", 60_000 + BARB_DEFEAT_COOLDOWN_MS - 1)).toBe(true);

    const before = state.barbarianGroups.size;
    tickSpawn(state, 60_100, mulberry32(1));
    const under = findUnderServedPlayer(state);
    expect(under?.profileId).toBe("p1");
    expect(state.barbarianGroups.size).toBe(before);

    expect(isPlayerOnBarbDefeatCooldown("p1", 60_000 + BARB_DEFEAT_COOLDOWN_MS)).toBe(false);
  });
});
