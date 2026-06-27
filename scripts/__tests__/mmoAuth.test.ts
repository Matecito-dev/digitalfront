import { describe, it, expect } from "vitest";
import {
  getMaxPlayers,
  countAuthenticatedPlayers,
  canAcceptPlayerAuth,
  parseWsAuthToken,
  checkGuestAuthRateLimit,
} from "../../src/mmo/wsLimits.js";

describe("mmo WS auth helpers", () => {
  it("parseWsAuthToken extracts token from auth message", () => {
    expect(parseWsAuthToken({ type: "auth", token: "abc123" })).toBe("abc123");
    expect(parseWsAuthToken({ type: "pos", x: 1 })).toBeNull();
    expect(parseWsAuthToken({ type: "auth", token: "  " })).toBeNull();
  });

  it("getMaxPlayers reads env with fallback", () => {
    expect(getMaxPlayers({ DF_MAX_PLAYERS: "100" })).toBe(100);
    expect(getMaxPlayers({ VELIS_MAX_PLAYERS: "100" })).toBe(100);
    expect(getMaxPlayers({})).toBe(500);
    expect(getMaxPlayers({ DF_MAX_PLAYERS: "bad" })).toBe(500);
  });

  it("countAuthenticatedPlayers counts unique profileIds", () => {
    const clients = [
      { authenticated: true, profileId: "a" },
      { authenticated: true, profileId: "b" },
      { authenticated: false, profileId: null },
      { authenticated: true, profileId: "a" },
    ];
    expect(countAuthenticatedPlayers(clients)).toBe(2);
  });

  it("canAcceptPlayerAuth allows reconnect, blocks when full", () => {
    const full = [
      { authenticated: true, profileId: "p1" },
      { authenticated: true, profileId: "p2" },
    ];
    expect(canAcceptPlayerAuth(full, "p1", 2)).toBe(true);
    expect(canAcceptPlayerAuth(full, "p3", 2)).toBe(false);
    expect(canAcceptPlayerAuth(full, "p3", 3)).toBe(true);
  });

  it("checkGuestAuthRateLimit allows 10 per minute per IP", () => {
    const ip = "203.0.113.1";
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(checkGuestAuthRateLimit(ip, t0 + i)).toBe(true);
    }
    expect(checkGuestAuthRateLimit(ip, t0 + 10)).toBe(false);
    expect(checkGuestAuthRateLimit(ip, t0 + 60_001)).toBe(true);
  });
});
