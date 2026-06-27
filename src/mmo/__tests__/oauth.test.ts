import { describe, it, expect } from "vitest";
import { generateGuestKey, isValidGuestKey } from "../oauth.js";

describe("oauth guest key helpers", () => {
  it("generateGuestKey returns 64-char hex", () => {
    const key = generateGuestKey();
    expect(key).toHaveLength(64);
    expect(isValidGuestKey(key)).toBe(true);
  });

  it("isValidGuestKey rejects invalid values", () => {
    expect(isValidGuestKey("")).toBe(false);
    expect(isValidGuestKey("not-hex")).toBe(false);
    expect(isValidGuestKey("abc")).toBe(false);
    expect(isValidGuestKey(null)).toBe(false);
  });
});
