import { describe, it, expect } from "vitest";
import {
  buildFreshDailyQuests,
  applySimEventsToQuests,
  parseDailyQuests,
  utcDayString,
  goldRewardFor,
} from "../dailyQuests.js";
import type { SimEvent } from "../../sim/events.js";

describe("dailyQuests", () => {
  it("builds three quest types with defaults", () => {
    const quests = buildFreshDailyQuests();
    expect(quests).toHaveLength(3);
    expect(quests.map(q => q.kind)).toEqual(["kill_barbarians", "explore_pct", "pvp_win"]);
    expect(quests.every(q => q.progress === 0 && !q.completed)).toBe(true);
  });

  it("resets when stored day differs from UTC today", () => {
    const today = utcDayString();
    const stale = parseDailyQuests(
      [{ kind: "kill_barbarians", target: 2, progress: 2, completed: true, rewarded: true }],
      today,
    );
    expect(stale.quests).toHaveLength(3);
    expect(stale.quests[0]!.progress).toBe(0);
  });

  it("tracks barbarian group defeat toward kill quest", () => {
    const quests = buildFreshDailyQuests();
    const events: SimEvent[] = [{
      type: "GROUP_DEFEATED",
      loserGroupId: "g1",
      winnerGroupId: "player",
      survivorCount: 3,
      profileId: "p1",
    }];
    const next = applySimEventsToQuests(quests, events);
    const killQuest = next.find(q => q.kind === "kill_barbarians")!;
    expect(killQuest.progress).toBe(1);
  });

  it("tracks PvP win quest", () => {
    const quests = buildFreshDailyQuests();
    const events: SimEvent[] = [{
      type: "PVP_COMBAT_END",
      reason: "elimination",
      winnerProfileId: "p1",
      loserProfileId: "p2",
    }];
    const next = applySimEventsToQuests(quests, events);
    const pvpQuest = next.find(q => q.kind === "pvp_win")!;
    expect(pvpQuest.completed).toBe(true);
  });

  it("tracks explore quest from explored_pct_max", () => {
    const quests = buildFreshDailyQuests();
    const next = applySimEventsToQuests(quests, [], 12);
    const exploreQuest = next.find(q => q.kind === "explore_pct")!;
    expect(exploreQuest.progress).toBe(12);
    expect(exploreQuest.completed).toBe(true);
  });

  it("assigns gold rewards per quest kind", () => {
    expect(goldRewardFor("kill_barbarians")).toBe(50);
    expect(goldRewardFor("explore_pct")).toBe(75);
    expect(goldRewardFor("pvp_win")).toBe(100);
  });
});
