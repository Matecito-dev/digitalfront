import { describe, it, expect, beforeEach } from "vitest";
import { mulberry32 } from "../rng.js";
import { initSeason } from "../seasonsMath.js";
import type { WorldState } from "../worldState.js";
import { createPlayerSquad } from "../playerSquad.js";
import {
  canInitiatePvp,
  isInPvpSafeZone,
  tickPlayerVsPlayer,
  PVP_SAFE_ZONE_RADIUS,
  PVP_GRACE_PERIOD_MS,
} from "../playerVsPlayer.js";
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

describe("playerVsPlayer", () => {
  beforeEach(() => resetPathfindingCache());

  it("blocks attack inside safe zone", () => {
    const squad = createPlayerSquad("a", "Alpha", 10, 10);
    squad.spawnX = 10;
    squad.spawnY = 10;
    expect(isInPvpSafeZone(squad, 10, 10)).toBe(true);
    expect(isInPvpSafeZone(squad, 10 + PVP_SAFE_ZONE_RADIUS - 1, 10)).toBe(true);
    expect(isInPvpSafeZone(squad, 10 + PVP_SAFE_ZONE_RADIUS + 2, 10)).toBe(false);
  });

  it("rejects PvP during grace period", () => {
    const now = Date.now();
    const attacker = createPlayerSquad("a", "A", 30, 30, now);
    const defender = createPlayerSquad("b", "B", 35, 35, now - PVP_GRACE_PERIOD_MS - 1000);
    attacker.spawnX = 30;
    attacker.spawnY = 30;
    defender.spawnX = 35;
    defender.spawnY = 35;
    expect(canInitiatePvp(attacker, defender, now)).toBe("attacker_grace");
  });

  it("allows PvP outside safe zone after grace", () => {
    const now = Date.now();
    const attacker = createPlayerSquad("a", "A", 30, 30, now - PVP_GRACE_PERIOD_MS - 1000);
    const defender = createPlayerSquad("b", "B", 50, 50, now - PVP_GRACE_PERIOD_MS - 1000);
    attacker.spawnX = 10;
    attacker.spawnY = 10;
    defender.spawnX = 50;
    defender.spawnY = 50;
    attacker.units.forEach(u => { u.x = 30; u.y = 30; u.tx = 30; u.ty = 30; });
    defender.units.forEach(u => { u.x = 32; u.y = 30; u.tx = 32; u.ty = 30; });
    expect(canInitiatePvp(attacker, defender, now)).toBeNull();
  });

  it("deals damage when squads are in combat", () => {
    const state = makeState();
    const a = createPlayerSquad("a", "A", 20, 20);
    const b = createPlayerSquad("b", "B", 22, 20);
    a.attackProfileId = "b";
    b.attackProfileId = "a";
    a.spawnX = 5; a.spawnY = 5;
    b.spawnX = 50; b.spawnY = 50;
    for (const u of a.units) { u.x = 20; u.y = 20; u.tx = 20; u.ty = 20; u.cooldownMs = 0; }
    for (const u of b.units) { u.x = 21.5; u.y = 20; u.tx = 21.5; u.ty = 20; u.cooldownMs = 0; }
    state.playerSquads.set("a", a);
    state.playerSquads.set("b", b);

    const rng = mulberry32(7);
    const hpBefore = b.units.reduce((s, u) => s + u.hp, 0);
    for (let i = 0; i < 80; i++) {
      state.simTimeMs = (i + 1) * 50;
      tickPlayerVsPlayer(state, state.simTimeMs, 50, rng);
    }
    const hpAfter = b.units.reduce((s, u) => s + u.hp, 0);
    expect(hpAfter).toBeLessThan(hpBefore);
  });

  it("enforces one active PvP target per squad", () => {
    const now = Date.now();
    const attacker = createPlayerSquad("a", "A", 30, 30, now - PVP_GRACE_PERIOD_MS - 1000);
    const d1 = createPlayerSquad("b", "B", 35, 35, now - PVP_GRACE_PERIOD_MS - 1000);
    const d2 = createPlayerSquad("c", "C", 38, 38, now - PVP_GRACE_PERIOD_MS - 1000);
    attacker.attackProfileId = "b";
    attacker.spawnX = 5; attacker.spawnY = 5;
    d1.spawnX = 50; d1.spawnY = 50;
    d2.spawnX = 55; d2.spawnY = 55;
    expect(canInitiatePvp(attacker, d2, now)).toBe("already_in_combat");
  });

  it("transfers gold on PvP elimination", () => {
    const state = makeState();
    const now = Date.now();
    const winner = createPlayerSquad("a", "A", 30, 30, now - PVP_GRACE_PERIOD_MS - 1000);
    const loser = createPlayerSquad("b", "B", 30.5, 30.5, now - PVP_GRACE_PERIOD_MS - 1000);
    loser.gold = 100;
    winner.attackProfileId = "b";
    loser.attackProfileId = "a";
    winner.spawnX = 5; winner.spawnY = 5;
    loser.spawnX = 50; loser.spawnY = 50;
    for (const u of loser.units) u.hp = 1;
    state.playerSquads.set("a", winner);
    state.playerSquads.set("b", loser);
    const rng = mulberry32(99);
    tickPlayerVsPlayer(state, 1000, 50, rng);
    expect(loser.units.every(u => u.hp <= 0)).toBe(true);
    expect(winner.gold).toBeGreaterThan(0);
    expect(loser.gold).toBeLessThan(100);
  });
});
