import { describe, expect, it, beforeEach } from "vitest";
import { mulberry32 } from "../../sim/rng.js";
import { initSeason } from "../../sim/seasonsMath.js";
import type { WorldState, BarbarianGroup } from "../../sim/worldState.js";
import { ensurePlayerSquad } from "../../sim/playerSquad.js";
import {
  pickRandomLand,
  pickHotspot,
  pickNearPlayer,
  pickSpawnPosition,
  hasBandsInRadius,
  spawnStarterBandsNearPlayer,
  countBandsInNearPlayerRing,
  NEAR_PLAYER_RING,
  STARTER_RING,
  HOTSPOT_RADIUS,
  TUTORIAL_SAFE_RADIUS,
} from "../barbarianSpawnPlacements.js";
import { getGroupCentroid, getMaxGroups, countAlivePlayers, spawnRoamingGroup, BOSS_HP_MULTIPLIER } from "../barbarianGroupAI.js";
import { BARB_SOLDIER_HP } from "../barbarianConfigData.js";
import { isPlayerHunterArchetype } from "../barbarianPlayerAI.js";

function makeTerrain(cols = 128, rows = 96): WorldState["terrain"] {
  const n = cols * rows;
  const heights = new Uint8Array(n);
  const cells = Array.from({ length: n }, () => "PLAINS" as const);
  for (let i = 0; i < n; i++) heights[i] = 40;
  return { cells, heights, hillshade: new Uint8Array(n), cols, rows, seed: 42 };
}

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    seed: 42,
    simTimeMs: 0,
    realStartMs: Date.now(),
    speedMultiplier: 1,
    paused: false,
    terrain: makeTerrain(),
    season: initSeason(0),
    camps: new Map(),
    outposts: new Map(),
    cities: new Map(),
    barbarianGroups: new Map(),
    usedBarbarianNames: new Set(),
    playerSquads: new Map(),
    nextId: 1,
    ...overrides,
  };
}

function placeGroup(state: WorldState, x: number, y: number, id = "g1"): BarbarianGroup {
  const group: BarbarianGroup = {
    id,
    name: "Test Band",
    archetype: "HUNTERS",
    anchorX: x,
    anchorY: y,
    state: "RESTING",
    units: [
      { id: "u1", name: "A", type: "soldier", hp: 120, maxHp: 120, x, y },
    ],
    tx: x,
    ty: y,
    path: [],
    pathIdx: 0,
    stateUntilMs: 0,
    lastActionMs: 0,
    restCount: 0,
    fatigue: 0,
  };
  state.barbarianGroups.set(id, group);
  return group;
}

describe("barbarianSpawnPlacements", () => {
  let state: WorldState;
  let rng: ReturnType<typeof mulberry32>;

  beforeEach(() => {
    state = makeState();
    rng = mulberry32(12345);
  });

  it("pickRandomLand returns a valid land cell", () => {
    const pos = pickRandomLand(state, rng);
    expect(pos).not.toBeNull();
    const [x, y] = pos!;
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(x).toBeLessThan(state.terrain.cols);
    expect(y).toBeLessThan(state.terrain.rows);
  });

  it("pickHotspot places within POI radius", () => {
    const poi = { x: 60, y: 48 };
    state.spawnHints = { pois: [poi] };
    const pos = pickHotspot(state, rng, [poi]);
    expect(pos).not.toBeNull();
    const [x, y] = pos!;
    expect(Math.abs(x - poi.x)).toBeLessThanOrEqual(HOTSPOT_RADIUS + 0.5);
    expect(Math.abs(y - poi.y)).toBeLessThanOrEqual(HOTSPOT_RADIUS + 0.5);
  });

  it("pickNearPlayer places in player ring", () => {
    ensurePlayerSquad(state, "p1", "Cap", 50, 50);
    const pos = pickNearPlayer(state, rng);
    expect(pos).not.toBeNull();
    const [x, y] = pos!;
    const d = Math.hypot(x - 50, y - 50);
    expect(d).toBeGreaterThanOrEqual(NEAR_PLAYER_RING[0] - 1);
    expect(d).toBeLessThanOrEqual(NEAR_PLAYER_RING[1] + 1);
  });

  it("pickSpawnPosition uses weighted strategies without throwing", () => {
    state.spawnHints = { pois: [{ x: 30, y: 30 }] };
    ensurePlayerSquad(state, "p1", "Cap", 80, 60);
    for (let i = 0; i < 20; i++) {
      const pos = pickSpawnPosition(state, rng);
      expect(pos).not.toBeNull();
    }
  });

  it("hasBandsInRadius detects nearby groups", () => {
    placeGroup(state, 50, 50);
    expect(hasBandsInRadius(state, 50, 50, 5)).toBe(true);
    expect(hasBandsInRadius(state, 10, 10, 5)).toBe(false);
  });

  it("spawnStarterBandsNearPlayer spawns within starter ring with at least one aggressive band", () => {
    const events = spawnStarterBandsNearPlayer(state, 64, 48, 0, mulberry32(99));
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.length).toBeLessThanOrEqual(5);

    let hasAggressive = false;
    for (const group of state.barbarianGroups.values()) {
      const c = getGroupCentroid(group.units);
      const d = Math.hypot(c.x - 64, c.y - 48);
      expect(d).toBeGreaterThanOrEqual(STARTER_RING[0] - 1);
      expect(d).toBeLessThanOrEqual(STARTER_RING[1] + 1);
      if (isPlayerHunterArchetype(group.archetype)) hasAggressive = true;
      if (isPlayerHunterArchetype(group.archetype)) {
        expect(d).toBeGreaterThanOrEqual(TUTORIAL_SAFE_RADIUS);
      }
    }
    expect(hasAggressive).toBe(true);
  });

  it("spawnStarterBandsNearPlayer skips when bands already in radius", () => {
    placeGroup(state, 64, 48);
    const before = state.barbarianGroups.size;
    const events = spawnStarterBandsNearPlayer(state, 64, 48, 0, rng);
    expect(events).toHaveLength(0);
    expect(state.barbarianGroups.size).toBe(before);
  });

  it("density: random land points often have a band within 45 cells after initial fill", () => {
    state = makeState({ terrain: makeTerrain(200, 150) });
    const fillRng = mulberry32(777);
    for (let i = 0; i < 55; i++) {
      const pos = pickSpawnPosition(state, fillRng);
      if (!pos) continue;
      placeGroup(state, pos[0], pos[1], `g${i}`);
    }
    let hits = 0;
    const sampleRng = mulberry32(888);
    for (let s = 0; s < 40; s++) {
      const x = 20 + sampleRng() * (state.terrain.cols - 40);
      const y = 20 + sampleRng() * (state.terrain.rows - 40);
      if (hasBandsInRadius(state, x, y, 45)) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(20);
  });

  it("countBandsInNearPlayerRing tracks AOI quota", () => {
    ensurePlayerSquad(state, "p1", "Cap", 50, 50);
    placeGroup(state, 62, 50, "g1");
    placeGroup(state, 70, 50, "g2");
    expect(countBandsInNearPlayerRing(state, 50, 50)).toBe(2);
  });

  it("getMaxGroups scales with 20 alive players", () => {
    for (let i = 0; i < 20; i++) {
      ensurePlayerSquad(state, `p${i}`, `Cap${i}`, 10 + i, 10 + i);
    }
    expect(countAlivePlayers(state)).toBe(20);
    expect(getMaxGroups(20)).toBe(100);
  });

  it("spawnRoamingGroup creates boss bands with doubled lead HP", () => {
    let bosses = 0;
    for (let seed = 0; seed < 400; seed++) {
      const s = makeState();
      const group = spawnRoamingGroup(s, 30, 30, "RAIDERS", 0, mulberry32(seed));
      if (!group?.isBoss) continue;
      bosses++;
      expect(group.units[0]!.maxHp).toBe(BARB_SOLDIER_HP * BOSS_HP_MULTIPLIER);
    }
    expect(bosses).toBeGreaterThan(5);
  });
});
