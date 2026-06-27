import { describe, it, expect } from "vitest";
import {
  validateUsername,
  normalizeUsername,
  usernameLower,
  sanitizeCaptainName,
  usernameErrorMessage,
} from "../profile.js";

describe("validateUsername", () => {
  it("accepts valid names", () => {
    expect(validateUsername("Capitán_1")).toBeNull();
    expect(validateUsername("José-López")).toBeNull();
    expect(validateUsername("abc")).toBeNull();
  });

  it("rejects empty and whitespace-only", () => {
    expect(validateUsername("")).toBe("empty");
    expect(validateUsername("   ")).toBe("empty");
  });

  it("rejects too short and too long", () => {
    expect(validateUsername("ab")).toBe("too_short");
    expect(validateUsername("a".repeat(21))).toBe("too_long");
  });

  it("rejects invalid characters", () => {
    expect(validateUsername("capitan!")).toBe("invalid_chars");
    expect(validateUsername("foo bar")).toBe("invalid_chars");
  });

  it("rejects blocklisted names case-insensitively", () => {
    expect(validateUsername("Admin")).toBe("blocked");
    expect(validateUsername("MOD")).toBe("blocked");
  });
});

describe("username helpers", () => {
  it("normalizes trim and double spaces", () => {
    expect(normalizeUsername("  foo   bar  ")).toBe("foo bar");
  });

  it("lowercases with Spanish locale", () => {
    expect(usernameLower("Álvaro")).toBe("álvaro");
  });

  it("sanitizes captain name to max length", () => {
    expect(sanitizeCaptainName("  TestName  ")).toBe("TestName");
    expect(sanitizeCaptainName("x".repeat(25)).length).toBe(20);
  });

  it("maps error codes to messages", () => {
    expect(usernameErrorMessage("too_short")).toContain("3");
    expect(usernameErrorMessage("blocked")).toContain("permitido");
  });
});
