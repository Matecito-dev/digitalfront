import { describe, it, expect, beforeEach } from "vitest";
import { initSeason } from "../seasonsMath.js";
import type { WorldState, OutpostCamp } from "../worldState.js";
import { createPlayerSquad } from "../playerSquad.js";
import { applyCampAction, leaveOutpostForFieldOrder, deploySquadAtOutpostRing } from "../outpostActions.js";
import {
  HEAL_INSTANT_COST_PER_UNIT,
  RECRUIT_SOLDIER_COST,
  RECOMPOSE_COST_PER_UNIT,
  RESUPPLY_COST,
} from "../playerEconomy.js";

function makeTerrain(cols = 64, rows = 48): WorldState["terrain"] {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  for (let i = 0; i < n; i++) heights[i] = 40;
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 1 };
}

function makeState(): WorldState {
  const outpost: OutpostCamp = {
    id: "o1",
    name: "Refugio Test",
    x: 20,
    y: 20,
    radius: 4,
    safeRadius: 6,
    sectorIndex: 0,
  };
  return {
    seed: 1,
    simTimeMs: 0,
    realStartMs: Date.now(),
    speedMultiplier: 1,
    paused: false,
    terrain: makeTerrain(),
    season: initSeason(0),
    camps: new Map(),
    outposts: new Map([["o1", outpost]]),
    cities: new Map(),
    barbarianGroups: new Map(),
    usedBarbarianNames: new Set(),
    playerSquads: new Map(),
    nextId: 2,
  };
}

describe("outpostActions", () => {
  let state: WorldState;

  beforeEach(() => {
    state = makeState();
    const squad = createPlayerSquad("p1", "Capitán", 20, 20);
    squad.gold = 500;
    state.playerSquads.set("p1", squad);
  });

  it("enter sets insideOutpostId and teleports units", () => {
    const r = applyCampAction(state, "p1", "enter", "o1");
    expect(r.ok).toBe(true);
    const squad = state.playerSquads.get("p1")!;
    expect(squad.insideOutpostId).toBe("o1");
    expect(squad.units.every(u => Math.hypot(u.x - 20, u.y - 20) < 2)).toBe(true);
  });

  it("exit clears insideOutpostId", () => {
    applyCampAction(state, "p1", "enter", "o1");
    const r = applyCampAction(state, "p1", "exit", "o1");
    expect(r.ok).toBe(true);
    expect(state.playerSquads.get("p1")!.insideOutpostId).toBeNull();
  });

  it("leaveOutpostForFieldOrder deploys squad outside camp", () => {
    applyCampAction(state, "p1", "enter", "o1");
    const squad = state.playerSquads.get("p1")!;
    leaveOutpostForFieldOrder(state, squad);
    expect(squad.insideOutpostId).toBeNull();
    expect(Math.hypot(squad.units[0]!.x - 20, squad.units[0]!.y - 20)).toBeGreaterThan(2);
  });

  it("deploySquadAtOutpostRing sets home outpost", () => {
    const squad = state.playerSquads.get("p1")!;
    deploySquadAtOutpostRing(state, squad, "o1");
    expect(squad.insideOutpostId).toBeNull();
    expect(squad.homeOutpostId).toBe("o1");
  });

  it("instant heal costs gold per damaged unit", () => {
    applyCampAction(state, "p1", "enter", "o1");
    const squad = state.playerSquads.get("p1")!;
    squad.units[0]!.hp = 50;
    const before = squad.gold;
    const r = applyCampAction(state, "p1", "heal", "o1", { instantHeal: true });
    expect(r.ok).toBe(true);
    expect(squad.units[0]!.hp).toBe(squad.units[0]!.maxHp);
    expect(squad.gold).toBe(before - HEAL_INSTANT_COST_PER_UNIT);
  });

  it("recruit replaces dead units for gold", () => {
    applyCampAction(state, "p1", "enter", "o1");
    const squad = state.playerSquads.get("p1")!;
    squad.units[1]!.hp = 0;
    const before = squad.gold;
    const r = applyCampAction(state, "p1", "recruit", "o1");
    expect(r.ok).toBe(true);
    expect(squad.units[1]!.hp).toBeGreaterThan(0);
    expect(squad.gold).toBe(before - RECRUIT_SOLDIER_COST);
  });

  it("recompose changes squad composition", () => {
    applyCampAction(state, "p1", "enter", "o1");
    const r = applyCampAction(state, "p1", "recompose", "o1", { soldiers: 2, snipers: 2 });
    expect(r.ok).toBe(true);
    const updated = state.playerSquads.get("p1")!;
    expect(updated.units.filter(u => u.type === "soldier" && u.hp > 0).length).toBe(2);
    expect(updated.units.filter(u => u.type === "sniper" && u.hp > 0).length).toBe(2);
  });

  it("resupply clears fatigue for gold", () => {
    applyCampAction(state, "p1", "enter", "o1");
    const squad = state.playerSquads.get("p1")!;
    squad.units[0]!.marchMs = 5000;
    squad.units[0]!.suppressionMs = 3000;
    const before = squad.gold;
    const r = applyCampAction(state, "p1", "resupply", "o1");
    expect(r.ok).toBe(true);
    expect(squad.units[0]!.marchMs).toBe(0);
    expect(squad.units[0]!.suppressionMs).toBe(0);
    expect(squad.gold).toBe(before - RESUPPLY_COST);
  });

  it("set_home stores homeOutpostId", () => {
    applyCampAction(state, "p1", "enter", "o1");
    const r = applyCampAction(state, "p1", "set_home", "o1");
    expect(r.ok).toBe(true);
    expect(state.playerSquads.get("p1")!.homeOutpostId).toBe("o1");
  });

  it("respawn after wipe creates 3S+2F squad", () => {
    const squad = state.playerSquads.get("p1")!;
    squad.wiped = true;
    squad.units.forEach(u => { u.hp = 0; });
    const r = applyCampAction(state, "p1", "respawn", "o1");
    expect(r.ok).toBe(true);
    const fresh = state.playerSquads.get("p1")!;
    expect(fresh.wiped).toBe(false);
    expect(fresh.units.filter(u => u.type === "soldier" && u.hp > 0).length).toBe(3);
    expect(fresh.units.filter(u => u.type === "sniper" && u.hp > 0).length).toBe(2);
    expect(fresh.insideOutpostId).toBe("o1");
  });

  it("rejects actions with insufficient gold", () => {
    applyCampAction(state, "p1", "enter", "o1");
    state.playerSquads.get("p1")!.gold = 0;
    const r = applyCampAction(state, "p1", "resupply", "o1");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient_gold");
  });
});
