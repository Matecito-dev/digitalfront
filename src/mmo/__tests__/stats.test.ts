import { describe, it, expect } from "vitest";
import { validateMissionComplete } from "../stats.js";

describe("validateMissionComplete", () => {
  const validProfile = { barbarians_killed: 2, explored_pct_max: 20 };

  it("accepts when profile and payload meet all objectives", () => {
    expect(validateMissionComplete(validProfile, {
      exploredPct: 20,
      neutralizedGroupId: "g1",
      interceptDone: true,
    })).toEqual({ ok: true });
  });

  it("rejects when exploration below 15%", () => {
    const result = validateMissionComplete(
      { barbarians_killed: 1, explored_pct_max: 10 },
      { neutralizedGroupId: "g1", interceptDone: true },
    );
    expect(result).toEqual({ ok: false, reason: "requires_explore" });
  });

  it("rejects when no barbarian kills", () => {
    const result = validateMissionComplete(
      { barbarians_killed: 0, explored_pct_max: 20 },
      { neutralizedGroupId: "g1", interceptDone: true },
    );
    expect(result).toEqual({ ok: false, reason: "requires_kill" });
  });

  it("rejects when intercept not done", () => {
    const result = validateMissionComplete(validProfile, {
      neutralizedGroupId: "g1",
      interceptDone: false,
    });
    expect(result).toEqual({ ok: false, reason: "requires_intercept" });
  });

  it("rejects when neutralized group id missing", () => {
    const result = validateMissionComplete(validProfile, { interceptDone: true });
    expect(result).toEqual({ ok: false, reason: "requires_neutralize" });
  });
});
