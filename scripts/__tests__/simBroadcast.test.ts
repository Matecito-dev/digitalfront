import { describe, it, expect } from "vitest";
import {
  isInAoi,
  shouldSendGroupThisTick,
  shouldSendOtherSquadThisTick,
  computeBarbDelta,
  computeOtherSquadsDelta,
  filterGroupsForClient,
  filterOtherSquadsForClient,
  filterMovementsForClient,
  filterEventsForClient,
  capOtherSquads,
  macroDistance,
  MAX_OTHER_SQUADS,
  type SerializedBarbGroup,
  type SerializedOtherSquad,
} from "../simBroadcast.js";

function mockGroup(id: string, x: number, y: number): SerializedBarbGroup {
  return {
    id, name: id, archetype: "RAIDERS",
    anchorX: x, anchorY: y, state: "RESTING",
    engageTargetId: null, tx: x, ty: y,
    units: [{ id: `${id}-u`, name: "u", type: "soldier", hp: 10, maxHp: 10, x, y }],
  };
}

function mockOtherSquad(profileId: string, x: number, y: number, captain = profileId): SerializedOtherSquad {
  return {
    profileId,
    captainName: captain,
    inCombatWith: null,
    units: [{ id: `${profileId}-u`, name: "u", type: "soldier", hp: 10, maxHp: 10, x, y }],
  };
}

describe("simBroadcast AOI", () => {
  it("includes groups within radius+buffer", () => {
    expect(isInAoi(100, 100, 100, 100)).toBe(true);
    expect(isInAoi(100 + 66, 100, 100, 100)).toBe(false);
    expect(isInAoi(100 + 65, 100, 100, 100)).toBe(true);
  });

  it("filters groups by squad position", () => {
    const groups = [mockGroup("near", 110, 110), mockGroup("far", 300, 300)];
    const { visible } = filterGroupsForClient(groups, 100, 100, 1);
    expect(visible.map(g => g.id)).toEqual(["near"]);
  });

  it("LOD far groups skip ticks", () => {
    expect(shouldSendGroupThisTick(10, 1)).toBe(true);
    expect(shouldSendGroupThisTick(40, 3)).toBe(false);
    expect(shouldSendGroupThisTick(40, 10)).toBe(true);
  });

  it("LOD far other squads use 4Hz interval", () => {
    expect(shouldSendOtherSquadThisTick(10, 1)).toBe(true);
    expect(shouldSendOtherSquadThisTick(40, 3)).toBe(false);
    expect(shouldSendOtherSquadThisTick(40, 5)).toBe(true);
    expect(shouldSendOtherSquadThisTick(40, 7)).toBe(false);
  });
});

describe("simBroadcast delta", () => {
  it("detects changed and removed groups", () => {
    const lastSent = new Map<string, string>();
    const g1 = mockGroup("a", 10, 10);
    const g2 = mockGroup("b", 20, 20);
    lastSent.set("a", JSON.stringify(g1));
    lastSent.set("b", JSON.stringify(g2));

    const g1m = { ...g1, tx: 11 };
    const { changed, removed } = computeBarbDelta(lastSent, [g1m], false);
    expect(changed.map(g => g.id)).toEqual(["a"]);
    expect(removed).toEqual(["b"]);
  });

  it("forceFull sends all visible", () => {
    const lastSent = new Map<string, string>();
    const groups = [mockGroup("a", 1, 1), mockGroup("b", 2, 2)];
    const { changed, removed } = computeBarbDelta(lastSent, groups, true);
    expect(changed).toHaveLength(2);
    expect(removed).toHaveLength(0);
    expect(lastSent.size).toBe(2);
  });
});

describe("macroDistance", () => {
  it("computes euclidean distance", () => {
    expect(macroDistance(0, 0, 3, 4)).toBe(5);
  });
});

describe("simBroadcast otherSquads", () => {
  it("filters other squads by AOI and excludes self via caller", () => {
    const squads = [mockOtherSquad("p2", 110, 110), mockOtherSquad("p3", 300, 300)];
    const { visible } = filterOtherSquadsForClient(squads, 100, 100, 1);
    expect(visible.map(s => s.profileId)).toEqual(["p2"]);
  });

  it("LOD far squads skip ticks at 4Hz", () => {
    const squads = [mockOtherSquad("far", 140, 100)];
    expect(filterOtherSquadsForClient(squads, 100, 100, 3).visible).toHaveLength(0);
    expect(filterOtherSquadsForClient(squads, 100, 100, 5).visible).toHaveLength(1);
    expect(filterOtherSquadsForClient(squads, 100, 100, 7).visible).toHaveLength(0);
  });

  it("detects changed and removed other squads", () => {
    const lastSent = new Map<string, string>();
    const s1 = mockOtherSquad("a", 10, 10);
    const s2 = mockOtherSquad("b", 20, 20);
    lastSent.set("a", JSON.stringify(s1));
    lastSent.set("b", JSON.stringify(s2));

    const s1m = { ...s1, units: [{ ...s1.units[0], x: 11 }] };
    const { changed, removedProfileIds } = computeOtherSquadsDelta(lastSent, [s1m], false);
    expect(changed.map(s => s.profileId)).toEqual(["a"]);
    expect(removedProfileIds).toEqual(["b"]);
  });

  it("caps other squads to MAX_OTHER_SQUADS nearest", () => {
    const squads = Array.from({ length: 20 }, (_, i) =>
      mockOtherSquad(`p${i}`, 100 + i, 100),
    );
    const capped = capOtherSquads(squads, "viewer", 100, 100, MAX_OTHER_SQUADS);
    expect(capped).toHaveLength(MAX_OTHER_SQUADS);
    expect(capped[0]!.profileId).toBe("p0");
  });

  it("prioritizes PvP combatants when capping 20 squads", () => {
    const squads = Array.from({ length: 20 }, (_, i) =>
      mockOtherSquad(`p${i}`, 100 + i * 0.1, 100, `cap${i}`),
    );
    squads[19] = { ...squads[19]!, inCombatWith: "viewer" };
    const capped = capOtherSquads(squads, "viewer", 100, 100, 12);
    expect(capped.some(s => s.profileId === "p19")).toBe(true);
  });

  it("filters movements by AOI", () => {
    const movements = [
      { fromX: 110, fromY: 110, toX: 120, toY: 120 },
      { fromX: 400, fromY: 300, toX: 410, toY: 310 },
    ];
    const filtered = filterMovementsForClient(movements, 100, 100);
    expect(filtered).toHaveLength(1);
  });

  it("filters combat events to AOI or participant", () => {
    const events = [
      { type: "BARB_UNIT_HIT" as const, attackerUnitId: "a", targetUnitId: "b", damage: 5, remainingHp: 5, groupId: "g1" },
      { type: "PVP_UNIT_HIT" as const, attackerUnitId: "s1", targetUnitId: "s2", attackerProfileId: "p1", targetProfileId: "p2", damage: 5, remainingHp: 5 },
    ];
    const positions = new Map([["g1", { x: 400, y: 300 }]]);
    const filtered = filterEventsForClient(events, 100, 100, "p1", positions);
    expect(filtered.some(e => e.type === "PVP_UNIT_HIT")).toBe(true);
    expect(filtered.some(e => e.type === "BARB_UNIT_HIT")).toBe(false);
  });
});
