import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng.js";
import {
  rollBarbKillGold,
  rollGroupDefeatBonus,
  computePvpLoot,
  addGold,
  transferPvpGold,
  awardGroupDefeatGold,
  BOSS_GOLD_MULTIPLIER,
  PVP_LOOT_MIN,
  PVP_LOOT_MAX,
} from "../playerEconomy.js";
import { createPlayerSquad } from "../playerSquad.js";
import type { SimEvent } from "../events.js";

describe("playerEconomy", () => {
  it("awards gold in barb kill range", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 20; i++) {
      const g = rollBarbKillGold(rng, "soldier");
      expect(g).toBeGreaterThanOrEqual(8);
      expect(g).toBeLessThanOrEqual(15);
    }
    for (let i = 0; i < 20; i++) {
      const g = rollBarbKillGold(rng, "sniper");
      expect(g).toBeGreaterThanOrEqual(12);
      expect(g).toBeLessThanOrEqual(20);
    }
  });

  it("group defeat bonus scales with size", () => {
    const rng = mulberry32(2);
    const small = rollGroupDefeatBonus(rng, 2);
    const large = rollGroupDefeatBonus(rng, 10);
    expect(small).toBeGreaterThanOrEqual(25);
    expect(large).toBeGreaterThanOrEqual(25);
    expect(large).toBeLessThanOrEqual(80 + 20);
  });

  it("pvp loot respects min/max bounds", () => {
    const rng = mulberry32(3);
    expect(computePvpLoot(0, rng)).toBe(PVP_LOOT_MIN);
    expect(computePvpLoot(10000, rng)).toBeLessThanOrEqual(PVP_LOOT_MAX);
  });

  it("addGold emits GOLD_GAINED event", () => {
    const squad = createPlayerSquad("p1", "Cap", 1, 1);
    const events: SimEvent[] = [];
    addGold(squad, 50, "test", events);
    expect(squad.gold).toBe(50);
    expect(events[0]?.type).toBe("GOLD_GAINED");
  });

  it("transferPvpGold moves gold from loser to winner", () => {
    const winner = createPlayerSquad("w", "W", 1, 1);
    const loser = createPlayerSquad("l", "L", 2, 2);
    loser.gold = 200;
    const events: SimEvent[] = [];
    const taken = transferPvpGold(winner, loser, mulberry32(4), events);
    expect(taken).toBeGreaterThan(0);
    expect(loser.gold).toBe(200 - taken);
    expect(winner.gold).toBe(taken);
    expect(events.some(e => e.type === "GOLD_GAINED")).toBe(true);
    expect(events.some(e => e.type === "GOLD_LOST")).toBe(true);
  });

  it("boss group defeat doubles gold bonus", () => {
    const squad = createPlayerSquad("p1", "Cap", 1, 1);
    const events: SimEvent[] = [];
    const rng = mulberry32(5);
    const normalGroup = {
      id: "g1",
      name: "Band",
      archetype: "RAIDERS" as const,
      anchorX: 1,
      anchorY: 1,
      state: "RESTING" as const,
      units: [{ id: "u1", name: "A", type: "soldier" as const, hp: 0, maxHp: 120, x: 1, y: 1 }],
      tx: 1,
      ty: 1,
      path: [],
      pathIdx: 0,
      stateUntilMs: 0,
      lastActionMs: 0,
      restCount: 0,
      fatigue: 0,
    };
    const bossGroup = { ...normalGroup, isBoss: true };
    awardGroupDefeatGold(squad, normalGroup, rng, events);
    const normalGold = squad.gold ?? 0;
    squad.gold = 0;
    events.length = 0;
    awardGroupDefeatGold(squad, bossGroup, mulberry32(5), events);
    expect(squad.gold).toBeGreaterThanOrEqual(normalGold * BOSS_GOLD_MULTIPLIER);
  });
});
