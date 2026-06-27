import { describe, it, expect, beforeEach } from "vitest";
import { ChatService } from "../chat.js";
import { initSeason } from "../../sim/seasonsMath.js";
import type { WorldState } from "../../sim/worldState.js";
import { createPlayerSquad } from "../../sim/playerSquad.js";

function makeState(): WorldState {
  const n = 64 * 48;
  return {
    seed: 1,
    simTimeMs: 0,
    realStartMs: Date.now(),
    speedMultiplier: 1,
    paused: false,
    terrain: {
      cells: Array.from({ length: n }, () => "PLAINS" as const),
      heights: new Uint8Array(n).fill(40),
      hillshade: new Uint8Array(n),
      cols: 64,
      rows: 48,
      seed: 1,
    },
    season: initSeason(0),
    camps: new Map(),
    outposts: new Map(),
    cities: new Map(),
    barbarianGroups: new Map(),
    usedBarbarianNames: new Set(),
    playerSquads: new Map(),
    nextId: 1,
  };
}

describe("chat", () => {
  let chat: ChatService;
  let state: WorldState;

  beforeEach(() => {
    chat = new ChatService();
    state = makeState();
    const s1 = createPlayerSquad("p1", "Alpha", 10, 10);
    const s2 = createPlayerSquad("p2", "Beta", 50, 40);
    state.playerSquads.set("p1", s1);
    state.playerSquads.set("p2", s2);
  });

  it("sanitizes HTML in messages", () => {
    const r = chat.trySend(state, "p1", "Alpha", "global", "<script>alert(1)</script>");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg.text).not.toContain("<script>");
  });

  it("enforces rate limit", () => {
    const first = chat.trySend(state, "p1", "Alpha", "global", "hola");
    const second = chat.trySend(state, "p1", "Alpha", "global", "otra");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("rate_limit");
  });

  it("routes sector messages to same-sector players", () => {
    const r = chat.trySend(state, "p1", "Alpha", "sector", "sector msg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const recipients = chat.getRecipients(state, r.msg, ["p1", "p2"]);
    expect(recipients).toContain("p1");
    const sector1 = chat.getSquadSector(state, state.playerSquads.get("p1"));
    const sector2 = chat.getSquadSector(state, state.playerSquads.get("p2"));
    if (sector1 !== sector2) {
      expect(recipients).not.toContain("p2");
    }
  });

  it("global messages reach all recipients", () => {
    const r = chat.trySend(state, "p1", "Alpha", "global", "hello all");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const recipients = chat.getRecipients(state, r.msg, ["p1", "p2"]);
    expect(recipients).toEqual(["p1", "p2"]);
  });
});
