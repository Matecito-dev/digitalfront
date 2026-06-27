import { describe, it, expect, beforeEach } from "vitest";
import { mulberry32 } from "../rng.js";
import { initSeason } from "../seasonsMath.js";
import type { WorldState, BarbarianGroup } from "../worldState.js";
import { createPlayerSquad, applyPlayerOrder } from "../playerSquad.js";
import { tickBarbarianVsPlayer } from "../barbarianVsPlayer.js";
import { tickPlayerCombat } from "../playerCombat.js";
import { resetPathfindingCache } from "../../barbarians/barbarianPathfinding.js";
import { PLAYER_COMBAT_ENGAGE_RADIUS } from "../../barbarians/barbarianPlayerAI.js";

function makeTerrain(cols = 64, rows = 48): WorldState["terrain"] {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  for (let i = 0; i < n; i++) heights[i] = 40;
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 3 };
}

function makeState(): WorldState {
  return {
    seed: 3,
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

function makeBarbGroup(id: string, x: number, y: number, state: BarbarianGroup["state"] = "HUNTING"): BarbarianGroup {
  return {
    id,
    name: "Raiders",
    archetype: "RAIDERS",
    anchorX: x,
    anchorY: y,
    state,
    huntProfileId: "p1",
    units: [
      { id: "b1", name: "Brute", type: "soldier", hp: 80, maxHp: 80, x, y, cooldownMs: 0 },
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

describe("barbarianVsPlayer", () => {
  beforeEach(() => resetPathfindingCache());

  it("damages player units when HUNTING in combat range without player attack order", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 12, 10, Date.now() - 60_000);
    state.playerSquads.set("p1", squad);
    const group = makeBarbGroup("g1", 13, 10);
    state.barbarianGroups.set("g1", group);

    expect(squad.order).toBe("hold");
    const hpBefore = squad.units.reduce((s, u) => s + u.hp, 0);
    const rng = mulberry32(99);
    const events = tickBarbarianVsPlayer(state, 0, 50, rng);

    const hpAfter = squad.units.reduce((s, u) => s + u.hp, 0);
    expect(hpAfter).toBeLessThan(hpBefore);
    expect(events.some(e => e.type === "PLAYER_UNIT_HIT")).toBe(true);
  });

  it("does not damage player when out of combat range", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 12, 10, Date.now() - 60_000);
    state.playerSquads.set("p1", squad);
    const group = makeBarbGroup("g1", 12 + PLAYER_COMBAT_ENGAGE_RADIUS + 10, 10);
    state.barbarianGroups.set("g1", group);

    const hpBefore = squad.units[0].hp;
    tickBarbarianVsPlayer(state, 0, 50, mulberry32(1));
    expect(squad.units[0].hp).toBe(hpBefore);
  });

  it("does not damage when not HUNTING and far from player", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 12, 10, Date.now() - 60_000);
    state.playerSquads.set("p1", squad);
    const group = makeBarbGroup("g1", 50, 50, "RESTING");
    group.huntProfileId = undefined;
    state.barbarianGroups.set("g1", group);

    const hpBefore = squad.units[0].hp;
    tickBarbarianVsPlayer(state, 0, 50, mulberry32(2));
    expect(squad.units[0].hp).toBe(hpBefore);
  });

  it("skips damage when squad is inside outpost safe zone", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 12, 10, Date.now() - 60_000);
    squad.insideOutpostId = "o1";
    state.outposts.set("o1", {
      id: "o1", name: "Refugio", x: 12, y: 10, radius: 4, safeRadius: 6, sectorIndex: 0,
    });
    state.playerSquads.set("p1", squad);
    const group = makeBarbGroup("g1", 12.5, 10.5);
    state.barbarianGroups.set("g1", group);
    const hpBefore = squad.units[0].hp;
    tickBarbarianVsPlayer(state, 0, 50, mulberry32(3));
    expect(squad.units[0].hp).toBe(hpBefore);
  });

  it("does not double-damage player when squad is attacking the same HUNTING group", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 12, 10, Date.now() - 60_000);
    state.playerSquads.set("p1", squad);
    const group = makeBarbGroup("g1", 13, 10);
    state.barbarianGroups.set("g1", group);
    squad.attackGroupId = "g1";

    const hpBefore = squad.units.reduce((s, u) => s + u.hp, 0);
    const rng = mulberry32(77);
    const pcEvents = tickPlayerCombat(state, 0, 50, rng);
    const bvpEvents = tickBarbarianVsPlayer(state, 0, 50, rng);

    const allHits = [...pcEvents, ...bvpEvents].filter(e => e.type === "PLAYER_UNIT_HIT");
    const barbHitsOnPlayer = allHits.filter(
      e => e.type === "PLAYER_UNIT_HIT" && e.attackerUnitId === "b1",
    );
    expect(barbHitsOnPlayer.length).toBeLessThanOrEqual(1);
    const hpAfter = squad.units.reduce((s, u) => s + u.hp, 0);
    expect(hpBefore - hpAfter).toBeLessThanOrEqual(20);
  });

  it("WANDERING group in range does not attack player", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 12, 10, Date.now() - 60_000);
    state.playerSquads.set("p1", squad);
    const group = makeBarbGroup("g1", 13, 10, "WANDERING");
    group.huntProfileId = undefined;
    state.barbarianGroups.set("g1", group);

    const hpBefore = squad.units.reduce((s, u) => s + u.hp, 0);
    const events = tickBarbarianVsPlayer(state, 0, 50, mulberry32(4));
    const hpAfter = squad.units.reduce((s, u) => s + u.hp, 0);
    expect(hpAfter).toBe(hpBefore);
    expect(events.some(e => e.type === "PLAYER_UNIT_HIT")).toBe(false);
  });

  it("fire_hold squad deals damage to nearest barbarian in range", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 12, 10, Date.now() - 60_000);
    state.playerSquads.set("p1", squad);
    const group = makeBarbGroup("g1", 13, 10, "WANDERING");
    state.barbarianGroups.set("g1", group);

    applyPlayerOrder(squad, "fire_hold", 12, 10, null, state.terrain);
    expect(squad.unitOrder).toBe("fire_hold");

    const barbHpBefore = group.units[0].hp;
    const events = tickPlayerCombat(state, 0, 50, mulberry32(5));
    expect(group.units[0].hp).toBeLessThan(barbHpBefore);
    expect(events.some(e => e.type === "BARB_UNIT_HIT" || e.type === "COMBAT_BURST")).toBe(true);
  });

  it("combat intensity rises on hits and decays out of combat", () => {
    const state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 12, 10, Date.now() - 60_000);
    state.playerSquads.set("p1", squad);
    const group = makeBarbGroup("g1", 13, 10);
    state.barbarianGroups.set("g1", group);

    const rng = mulberry32(6);
    const events = tickBarbarianVsPlayer(state, 0, 50, rng);
    expect(squad.combatIntensity ?? 0).toBeGreaterThan(0);
    expect(events.some(e => e.type === "COMBAT_INTENSITY")).toBe(true);

    const peak = squad.combatIntensity ?? 0;
    for (let i = 1; i <= 40; i++) {
      tickPlayerCombat(state, i * 50, 50, rng);
    }
    expect(squad.combatIntensity ?? 0).toBeLessThan(peak);
  });
});
