import { describe, it, expect } from "vitest";
import type { SimEvent } from "../../sim/events.js";
import {
  eventWeight,
  generateHeadline,
  isPublicChronicleWeight,
  filterChronicleEvents,
  buildChronicleContext,
} from "../chronicleRecorder.js";
import type { WorldState } from "../../sim/worldState.js";
import { initSeason } from "../../sim/seasonsMath.js";

function emptyContext() {
  return {
    captainNames: new Map([["p1", "Bruma"]]),
    groupNames: new Map([["g1", "Llanura Roja"]]),
    groupPositions: new Map([["g1", { x: 42.5, y: 18.2 }]]),
  };
}

describe("chronicleRecorder", () => {
  describe("eventWeight", () => {
    it("assigns weight 4 to player PvE victories", () => {
      const ev: SimEvent = {
        type: "GROUP_DEFEATED",
        loserGroupId: "g1",
        winnerGroupId: "player",
        survivorCount: 3,
        profileId: "p1",
      };
      expect(eventWeight(ev)).toBe(4);
    });

    it("assigns weight 0 to combat bursts", () => {
      expect(eventWeight({ type: "COMBAT_BURST", hits: [] })).toBe(0);
    });

    it("assigns weight 3 to season changes", () => {
      expect(eventWeight({ type: "SEASON_CHANGED", season: "WINTER", phase: "MID" })).toBe(3);
    });
  });

  describe("isPublicChronicleWeight", () => {
    it("includes weight >= 2 in public feed", () => {
      expect(isPublicChronicleWeight(2)).toBe(true);
      expect(isPublicChronicleWeight(5)).toBe(true);
      expect(isPublicChronicleWeight(1)).toBe(false);
    });
  });

  describe("generateHeadline", () => {
    it("formats player band defeat headline", () => {
      const ev: SimEvent = {
        type: "GROUP_DEFEATED",
        loserGroupId: "g1",
        winnerGroupId: "player",
        survivorCount: 4,
        profileId: "p1",
      };
      const result = generateHeadline(ev, emptyContext());
      expect(result?.headline).toContain("Bruma");
      expect(result?.headline).toContain("Llanura Roja");
      expect(result?.headline).toContain("(43,18)");
    });

    it("formats season change headline", () => {
      const result = generateHeadline(
        { type: "SEASON_CHANGED", season: "AUTUMN", phase: "LATE" },
        emptyContext(),
      );
      expect(result?.headline).toContain("AUTUMN");
    });

    it("formats city defense headline", () => {
      const result = generateHeadline(
        {
          type: "BARB_ATTACKS_CITY",
          campId: "c1",
          cityId: "city1",
          campName: "Horda Salvaje",
          cityName: "Valmar",
          outcome: "LOSS",
        },
        emptyContext(),
      );
      expect(result?.headline).toContain("Valmar");
      expect(result?.headline).toContain("resistió");
    });
  });

  describe("filterChronicleEvents", () => {
    it("drops zero-weight events", () => {
      const events: SimEvent[] = [
        { type: "COMBAT_BURST", hits: [] },
        { type: "SEASON_CHANGED", season: "SPRING", phase: "EARLY" },
      ];
      expect(filterChronicleEvents(events)).toHaveLength(1);
    });
  });

  describe("buildChronicleContext", () => {
    it("indexes squad and group names from state", () => {
      const state: WorldState = {
        seed: 1,
        simTimeMs: 0,
        realStartMs: Date.now(),
        speedMultiplier: 1,
        paused: false,
        terrain: {
          cells: [],
          heights: new Uint8Array(),
          hillshade: new Uint8Array(),
          cols: 1,
          rows: 1,
          seed: 1,
        },
        season: initSeason(0),
        camps: new Map(),
        outposts: new Map(),
        cities: new Map(),
        barbarianGroups: new Map([
          ["g1", {
            id: "g1",
            name: "Test Band",
            archetype: "HUNTERS",
            anchorX: 1,
            anchorY: 2,
            state: "WANDERING",
            units: [{ id: "u1", name: "X", type: "soldier", hp: 1, maxHp: 1, x: 5, y: 6 }],
            tx: 5,
            ty: 6,
            path: [],
            pathIdx: 0,
            stateUntilMs: 0,
            lastActionMs: 0,
            restCount: 0,
            fatigue: 0,
          }],
        ]),
        usedBarbarianNames: new Set(),
        playerSquads: new Map(),
        nextId: 1,
      };
      const ctx = buildChronicleContext(state);
      expect(ctx.groupNames.get("g1")).toBe("Test Band");
      expect(ctx.groupPositions.get("g1")).toEqual({ x: 5, y: 6 });
    });
  });
});
