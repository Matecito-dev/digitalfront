import { describe, it, expect } from "vitest";
import { parsePlayerOrderMessage, isCoordInBounds } from "../playerOrders.js";

const bounds = { cols: 512, rows: 384 };

describe("parsePlayerOrderMessage", () => {
  it("parses move order with clamped coords", () => {
    const r = parsePlayerOrderMessage({ type: "order", order: "move", x: 100, y: 50 }, bounds);
    expect(r).toEqual({ order: "move", x: 100, y: 50, groupId: null, targetProfileId: null, appendWaypoint: false });
  });

  it("parses hold order", () => {
    const r = parsePlayerOrderMessage({ type: "order", order: "hold", x: 10, y: 20 }, bounds);
    expect(r?.order).toBe("hold");
    expect(r?.groupId).toBeNull();
  });

  it("requires groupId for attack", () => {
    expect(parsePlayerOrderMessage({ type: "order", order: "attack", x: 1, y: 2 }, bounds)).toBeNull();
    const r = parsePlayerOrderMessage(
      { type: "order", order: "attack", x: 1, y: 2, groupId: "g42" },
      bounds,
    );
    expect(r).toEqual({ order: "attack", x: 1, y: 2, groupId: "g42", targetProfileId: null, appendWaypoint: false });
  });

  it("parses attack_pvp with targetProfileId", () => {
    const r = parsePlayerOrderMessage(
      { type: "order", order: "attack_pvp", x: 10, y: 20, targetProfileId: "uuid-1" },
      bounds,
    );
    expect(r).toEqual({
      order: "attack_pvp", x: 10, y: 20, groupId: null, targetProfileId: "uuid-1", appendWaypoint: false,
    });
  });

  it("parses tactical orders fire_hold and stealth", () => {
    expect(parsePlayerOrderMessage({ type: "order", order: "fire_hold", x: 5, y: 5 }, bounds)?.order).toBe("fire_hold");
    expect(parsePlayerOrderMessage({ type: "order", order: "stealth", x: 5, y: 5 }, bounds)?.order).toBe("stealth");
  });

  it("parses waypoint append flag", () => {
    const r = parsePlayerOrderMessage(
      { type: "order", order: "move", x: 1, y: 2, appendWaypoint: true },
      bounds,
    );
    expect(r?.appendWaypoint).toBe(true);
  });

  it("rejects invalid order type", () => {
    expect(parsePlayerOrderMessage({ type: "order", order: "fly", x: 1, y: 1 }, bounds)).toBeNull();
    expect(parsePlayerOrderMessage({ type: "pos", x: 1, y: 1 }, bounds)).toBeNull();
  });

  it("clamps out-of-bounds coordinates", () => {
    const r = parsePlayerOrderMessage({ type: "order", order: "move", x: 9999, y: -5 }, bounds);
    expect(r?.x).toBeLessThan(bounds.cols);
    expect(r?.y).toBe(0);
  });
});

describe("isCoordInBounds", () => {
  it("validates macro cell bounds", () => {
    expect(isCoordInBounds(0, 0, bounds)).toBe(true);
    expect(isCoordInBounds(bounds.cols - 0.5, bounds.rows - 0.5, bounds)).toBe(true);
    expect(isCoordInBounds(bounds.cols, 0, bounds)).toBe(false);
  });
});
