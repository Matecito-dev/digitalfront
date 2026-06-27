import { describe, it, expect } from "vitest";
import { computeCompositeScore } from "../ranking.js";

describe("computeCompositeScore", () => {
  it("weights kills, exploration, play time and missions", () => {
    const score = computeCompositeScore({
      barbariansKilled: 3,
      exploredPctMax: 12.5,
      playTimeMs: 120_000,
      missionsCompleted: 1,
    });
    // 3*100 + floor(12.5*10) + floor(120000/60000)*2 + 1*500
    expect(score).toBe(300 + 125 + 4 + 500);
  });

  it("returns zero for empty stats", () => {
    expect(computeCompositeScore({
      barbariansKilled: 0,
      exploredPctMax: 0,
      playTimeMs: 0,
      missionsCompleted: 0,
    })).toBe(0);
  });

  it("floors exploration and play-time contributions", () => {
    const score = computeCompositeScore({
      barbariansKilled: 0,
      exploredPctMax: 9.9,
      playTimeMs: 59_999,
      missionsCompleted: 0,
    });
    expect(score).toBe(99);
  });
});
