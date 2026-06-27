import { describe, it, expect } from "vitest";
import {
  MAX_UNIT_LEVEL,
  maxHpForType,
  armorDamageMult,
  grantUnitXp,
  xpToNextLevel,
  applyDamageWithArmor,
  initUnitProgression,
} from "../unitProgression.js";
import type { PlayerUnit } from "../worldState.js";

function mockUnit(type: "soldier" | "sniper" = "soldier"): PlayerUnit {
  const u: PlayerUnit = {
    id: "s1",
    type,
    name: "Test",
    hp: 120,
    maxHp: 120,
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
  };
  initUnitProgression(u);
  return u;
}

describe("unitProgression", () => {
  it("caps level at 10", () => {
    const u = mockUnit();
    const events: never[] = [];
    for (let i = 0; i < 500; i++) grantUnitXp(u, 200, events);
    expect(u.level).toBe(MAX_UNIT_LEVEL);
  });

  it("increases max HP per level", () => {
    expect(maxHpForType("soldier", 1)).toBe(120);
    expect(maxHpForType("soldier", 10)).toBe(120 + 9 * 4);
    expect(maxHpForType("sniper", 10)).toBe(70 + 9 * 3);
  });

  it("armor reduces damage", () => {
    expect(applyDamageWithArmor(10, 1)).toBe(10);
    expect(applyDamageWithArmor(10, 10)).toBeLessThan(10);
    expect(applyDamageWithArmor(10, 10)).toBeGreaterThanOrEqual(1);
  });

  it("levels up and emits event", () => {
    const u = mockUnit();
    const events: { type: string; level?: number }[] = [];
    const need = xpToNextLevel(1);
    const r = grantUnitXp(u, need, events as never, "p1");
    expect(r.leveledUp).toBe(true);
    expect(u.level).toBe(2);
    expect(events.some(e => e.type === "UNIT_LEVEL_UP" && e.level === 2)).toBe(true);
  });

  it("armor mult scales with level", () => {
    expect(armorDamageMult(1)).toBe(1);
    expect(armorDamageMult(10)).toBeCloseTo(0.82, 2);
  });
});
