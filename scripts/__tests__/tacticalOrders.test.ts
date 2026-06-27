import { describe, it, expect } from "vitest";
import {
  UnitOrder,
  deriveSquadPosture,
  inferTerrainGesture,
  isNearSquadPosition,
  squadHasActiveRoute,
  resolveTerrainOrder,
} from "../tacticalOrders.js";

describe("deriveSquadPosture", () => {
  it("returns null when no alive units", () => {
    expect(deriveSquadPosture([])).toBeNull();
    expect(deriveSquadPosture([{ hp: 0, unitOrder: UnitOrder.HOLD }])).toBeNull();
  });

  it("defaults to MARCHA for move majority", () => {
    const posture = deriveSquadPosture([
      { hp: 10, unitOrder: UnitOrder.MOVE },
      { hp: 10, unitOrder: UnitOrder.MOVE },
      { hp: 10, unitOrder: UnitOrder.HOLD },
    ]);
    expect(posture).toEqual({ order: UnitOrder.MOVE, label: "MARCHA" });
  });

  it("maps attack_move to MARCHA badge", () => {
    const posture = deriveSquadPosture([{ hp: 10, unitOrder: UnitOrder.ATTACK_MOVE }]);
    expect(posture).toEqual({ order: UnitOrder.ATTACK_MOVE, label: "MARCHA" });
  });

  it("breaks ties by POSTURE_PRIORITY (fire_hold beats hold)", () => {
    const posture = deriveSquadPosture([
      { hp: 10, unitOrder: UnitOrder.HOLD },
      { hp: 10, unitOrder: UnitOrder.FIRE_HOLD },
    ]);
    expect(posture).toEqual({ order: UnitOrder.FIRE_HOLD, label: "FUEGO" });
  });

  it("reports SIGILO when stealth wins", () => {
    const posture = deriveSquadPosture([
      { hp: 10, unitOrder: UnitOrder.STEALTH },
      { hp: 10, unitOrder: UnitOrder.STEALTH },
      { hp: 10, unitOrder: UnitOrder.MOVE },
    ]);
    expect(posture).toEqual({ order: UnitOrder.STEALTH, label: "SIGILO" });
  });
});

describe("inferTerrainGesture", () => {
  it("returns attack_move on plain RMB", () => {
    expect(inferTerrainGesture(false, false)).toBe(UnitOrder.ATTACK_MOVE);
    expect(inferTerrainGesture(false, true)).toBe(UnitOrder.ATTACK_MOVE);
  });

  it("returns fire_hold on shift without active route", () => {
    expect(inferTerrainGesture(true, false)).toBe("fire_hold");
  });

  it("returns waypoint on shift with active route", () => {
    expect(inferTerrainGesture(true, true)).toBe("waypoint");
  });
});

describe("squadHasActiveRoute", () => {
  it("detects queued orders and in-progress paths", () => {
    expect(squadHasActiveRoute([{ hp: 1, orderQueue: [{ x: 1, y: 2 }] }])).toBe(true);
    expect(squadHasActiveRoute([{ hp: 1, path: [1, 2, 3], pathIdx: 0 }])).toBe(true);
    expect(squadHasActiveRoute([{ hp: 1, path: [1, 2], pathIdx: 2 }])).toBe(false);
    expect(squadHasActiveRoute([{ hp: 1 }])).toBe(false);
  });
});

describe("isNearSquadPosition", () => {
  it("holds when click is within threshold of centroid", () => {
    expect(isNearSquadPosition(10.5, 10, 10, 10)).toBe(true);
    expect(isNearSquadPosition(14, 10, 10, 10)).toBe(false);
    expect(isNearSquadPosition(10, 10, null, 10)).toBe(false);
  });
});

describe("resolveTerrainOrder (gesture inference)", () => {
  const center = { centerX: 20, centerY: 20 };

  it("issues hold on RMB near own position", () => {
    expect(
      resolveTerrainOrder({ ...center, shift: false, destX: 20.5, destY: 20, units: [] }),
    ).toBe("hold");
  });

  it("issues attack_move on distant plain RMB", () => {
    expect(
      resolveTerrainOrder({ ...center, shift: false, destX: 50, destY: 50, units: [] }),
    ).toBe(UnitOrder.ATTACK_MOVE);
  });

  it("issues fire_hold on shift+RMB without route", () => {
    expect(
      resolveTerrainOrder({ ...center, shift: true, destX: 50, destY: 50, units: [] }),
    ).toBe("fire_hold");
  });

  it("queues waypoint on shift+RMB with active path", () => {
    expect(
      resolveTerrainOrder({
        ...center,
        shift: true,
        destX: 50,
        destY: 50,
        units: [{ hp: 1, path: [1, 2], pathIdx: 0 }],
      }),
    ).toBe("waypoint");
  });
});
