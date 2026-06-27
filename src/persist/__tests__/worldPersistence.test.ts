import { describe, it, expect, beforeEach } from "vitest";
import { initSeason } from "../../sim/seasonsMath.js";
import { createPlayerSquad } from "../../sim/playerSquad.js";
import type { WorldState, BarbarianGroup } from "../../sim/worldState.js";
import {
  serializeWorldState,
  applyWorldSnapshot,
  computeCatchUpTicks,
  PERSIST_SCHEMA_VERSION,
  MAX_OFFLINE_SIM_MS,
} from "../worldPersistence.js";
import {
  serializeSquad,
  deserializeSquad,
  restoreOrCreateSquad,
  encodeFogBlob,
  decodeFogBlob,
} from "../playerWorldState.js";

function makeTerrain(cols = 64, rows = 48): WorldState["terrain"] {
  const n = cols * rows;
  return {
    cells: Array.from({ length: n }, () => "PLAINS" as const),
    heights: new Uint8Array(n).fill(40),
    hillshade: new Uint8Array(n),
    cols,
    rows,
    seed: 42,
  };
}

function makeGroup(id: string): BarbarianGroup {
  return {
    id,
    name: "Horda del Norte",
    archetype: "RAIDERS",
    anchorX: 10,
    anchorY: 12,
    state: "WANDERING",
    units: [
      { id: "u1", name: "Bruto", type: "soldier", hp: 80, maxHp: 80, x: 10, y: 12 },
    ],
    tx: 15,
    ty: 18,
    path: [{ x: 15, y: 18 }],
    pathIdx: 0,
    stateUntilMs: 1000,
    lastActionMs: 0,
    restCount: 0,
    fatigue: 0,
  };
}

function makeState(): WorldState {
  const group = makeGroup("g1");
  return {
    seed: 42,
    simTimeMs: 5000,
    realStartMs: Date.now(),
    speedMultiplier: 1,
    paused: false,
    terrain: makeTerrain(),
    season: initSeason(5000),
    camps: new Map(),
    outposts: new Map(),
    cities: new Map(),
    barbarianGroups: new Map([[group.id, group]]),
    usedBarbarianNames: new Set(["Horda del Norte"]),
    playerSquads: new Map(),
    spawnHints: { pois: [{ x: 20, y: 30 }] },
    nextId: 7,
  };
}

describe("worldPersistence", () => {
  let state: WorldState;

  beforeEach(() => {
    state = makeState();
  });

  it("serializes and deserializes world state round-trip", () => {
    const snap = serializeWorldState(state);
    expect(snap.version).toBe(PERSIST_SCHEMA_VERSION);
    expect(snap.simTimeMs).toBe(5000);
    expect(snap.nextId).toBe(7);
    expect(snap.barbarianGroups).toHaveLength(1);
    expect(snap.usedBarbarianNames).toContain("Horda del Norte");

    const target: WorldState = {
      ...makeState(),
      simTimeMs: 0,
      nextId: 1,
      barbarianGroups: new Map(),
      usedBarbarianNames: new Set(),
    };
    applyWorldSnapshot(target, snap);

    expect(target.simTimeMs).toBe(5000);
    expect(target.nextId).toBe(7);
    expect(target.barbarianGroups.size).toBe(1);
    expect(target.barbarianGroups.get("g1")?.name).toBe("Horda del Norte");
    expect(target.usedBarbarianNames.has("Horda del Norte")).toBe(true);
    expect(target.spawnHints?.pois[0]).toEqual({ x: 20, y: 30 });
    expect(target.playerSquads.size).toBe(0);
  });

  it("does not include player squads in snapshot", () => {
    state.playerSquads.set("p1", createPlayerSquad("p1", "Bruma", 5, 5));
    const snap = serializeWorldState(state);
    const json = JSON.stringify(snap);
    expect(json).not.toContain('"profileId":"p1"');
  });

  it("caps offline catch-up at 6 hours sim time", () => {
    const lastTick = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ticks = computeCatchUpTicks(lastTick);
    const maxTicks = Math.floor(MAX_OFFLINE_SIM_MS / 50);
    expect(ticks).toBe(maxTicks);
  });

  it("computes zero ticks when last tick is in the future", () => {
    const lastTick = new Date(Date.now() + 60_000);
    expect(computeCatchUpTicks(lastTick)).toBe(0);
  });
});

describe("playerWorldState squad serialization", () => {
  it("round-trips squad positions and HP", () => {
    const squad = createPlayerSquad("p1", "Bruma", 10, 20);
    squad.units[0]!.hp = 90;
    const restored = deserializeSquad(serializeSquad(squad));
    expect(restored?.profileId).toBe("p1");
    expect(restored?.units[0]?.hp).toBe(90);
    expect(restored?.units[0]?.x).toBeCloseTo(squad.units[0]!.x, 1);
  });

  it("restoreOrCreateSquad preserves wiped state until respawn", () => {
    const dead = createPlayerSquad("p1", "Bruma", 1, 1);
    dead.wiped = true;
    for (const u of dead.units) u.hp = 0;
    const { squad, restored, wiped } = restoreOrCreateSquad(dead, "p1", "Bruma", 5, 5);
    expect(restored).toBe(true);
    expect(wiped).toBe(true);
    expect(squad.units.every(u => u.hp <= 0)).toBe(true);
  });

  it("restoreOrCreateSquad creates fresh squad for dead non-wiped save", () => {
    const dead = createPlayerSquad("p1", "Bruma", 1, 1);
    for (const u of dead.units) u.hp = 0;
    const { squad, wiped } = restoreOrCreateSquad(dead, "p1", "Bruma", 5, 5);
    expect(wiped).toBe(false);
    expect(squad.units.some(u => u.hp > 0)).toBe(true);
  });

  it("encodes fog blob as base64", () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    const encoded = encodeFogBlob(buf.toString("base64"));
    expect(decodeFogBlob(encoded)).toBe(buf.toString("base64"));
  });
});
