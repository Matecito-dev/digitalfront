// Weighted spawn placement: POI hotspots, player ring, or random land.

import type { RNG } from "../sim/rng.js";
import { randInt } from "../sim/rng.js";
import type { WorldState, BarbarianArchetype } from "../sim/worldState.js";
import type { SimEvent } from "../sim/events.js";
import { isLandCell } from "./barbarianPathfinding.js";
import { getGroupCentroid, spawnRoamingGroup, getMaxGroups, countAlivePlayers } from "./barbarianGroupAI.js";

export const MIN_GROUP_DISTANCE = 18;
export const NEAR_PLAYER_MIN_BAND_DISTANCE = 16;
export const SPAWN_ATTEMPTS = 30;

const HOTSPOT_WEIGHT = 0.40;
const NEAR_PLAYER_WEIGHT = 0.35;

export const HOTSPOT_RADIUS = 25;
export const NEAR_PLAYER_RING: [number, number] = [12, 45];
export const STARTER_RING: [number, number] = [18, 35];
export const TUTORIAL_SAFE_RADIUS = 10;
export const MAX_ACTIVE_STARTERS = 15;
const STARTER_SKIP_RADIUS = 70;

const PASSIVE_STARTER_ARCHETYPES: BarbarianArchetype[] = ["HUNTERS", "NOMADS"];
const AGGRESSIVE_STARTER_ARCHETYPES: BarbarianArchetype[] = ["RAIDERS", "MARAUDERS"];
export const NEAR_PLAYER_AOI_QUOTA = 2;

const starterGroupIdsByWorld = new WeakMap<WorldState, Set<string>>();

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function aliveGroupCentroids(state: WorldState): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const group of state.barbarianGroups.values()) {
    const c = getGroupCentroid(group.units);
    if (group.units.some(u => u.hp > 0)) out.push(c);
  }
  return out;
}

function alivePlayerCentroids(state: WorldState): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const squad of state.playerSquads.values()) {
    const alive = squad.units.filter(u => u.hp > 0);
    if (!alive.length) continue;
    let cx = 0, cy = 0;
    for (const u of alive) { cx += u.x; cy += u.y; }
    out.push({ x: cx / alive.length, y: cy / alive.length });
  }
  return out;
}

function nearestPlayerTo(
  state: WorldState,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const players = alivePlayerCentroids(state);
  if (!players.length) return null;
  let best = players[0];
  let bestD = dist(x, y, best.x, best.y);
  for (let i = 1; i < players.length; i++) {
    const d = dist(x, y, players[i].x, players[i].y);
    if (d < bestD) { bestD = d; best = players[i]; }
  }
  return best;
}

function isValidSpawnCell(
  state: WorldState,
  x: number,
  y: number,
  minDistFromOthers: number,
): boolean {
  if (!isLandCell(state.terrain, x, y)) return false;
  const tooCloseCity = [...state.cities.values()].some(c => dist(c.x, c.y, x, y) < 15);
  if (tooCloseCity) return false;
  const tooCloseGroup = aliveGroupCentroids(state).some(c => dist(c.x, c.y, x, y) < minDistFromOthers);
  return !tooCloseGroup;
}

function pickLandInRing(
  state: WorldState,
  cx: number,
  cy: number,
  minR: number,
  maxR: number,
  rng: RNG,
  minDistFromOthers: number,
): [number, number] | null {
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const angle = rng() * Math.PI * 2;
    const d = minR + rng() * (maxR - minR);
    const x = cx + Math.cos(angle) * d;
    const y = cy + Math.sin(angle) * d;
    if (isValidSpawnCell(state, x, y, minDistFromOthers)) return [x, y];
  }
  return null;
}

function isInNearPlayerRing(x: number, y: number, px: number, py: number): boolean {
  const d = dist(x, y, px, py);
  return d >= NEAR_PLAYER_RING[0] - 0.5 && d <= NEAR_PLAYER_RING[1] + 0.5;
}

/** Uniform random land cell (legacy spawn). */
export function pickRandomLand(
  state: WorldState,
  rng: RNG,
  minDistFromOthers = MIN_GROUP_DISTANCE,
): [number, number] | null {
  const { cols, rows } = state.terrain;
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const x = randInt(rng, cols - 8) + 4 + 0.5;
    const y = randInt(rng, rows - 8) + 4 + 0.5;
    if (isValidSpawnCell(state, x, y, minDistFromOthers)) return [x, y];
  }
  return null;
}

/** Spawn near a POI from WorldMeta (±25 cells). */
export function pickHotspot(
  state: WorldState,
  rng: RNG,
  pois: { x: number; y: number }[],
): [number, number] | null {
  if (!pois.length) return null;
  const poi = pois[randInt(rng, pois.length)];
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const dx = (rng() * 2 - 1) * HOTSPOT_RADIUS;
    const dy = (rng() * 2 - 1) * HOTSPOT_RADIUS;
    const x = poi.x + dx;
    const y = poi.y + dy;
    if (isValidSpawnCell(state, x, y, MIN_GROUP_DISTANCE)) return [x, y];
  }
  return null;
}

/** Count living band centroids within near-player ring around (px, py). */
export function countBandsInNearPlayerRing(state: WorldState, px: number, py: number): number {
  let count = 0;
  for (const c of aliveGroupCentroids(state)) {
    if (isInNearPlayerRing(c.x, c.y, px, py)) count++;
  }
  return count;
}

/** Player with fewest bands in near-player ring (for replenish bias). */
export function findUnderServedPlayer(state: WorldState): { x: number; y: number } | null {
  const players = alivePlayerCentroids(state);
  if (!players.length) return null;
  let best = players[0];
  let bestCount = countBandsInNearPlayerRing(state, best.x, best.y);
  for (let i = 1; i < players.length; i++) {
    const p = players[i];
    const c = countBandsInNearPlayerRing(state, p.x, p.y);
    if (c < bestCount) { bestCount = c; best = p; }
  }
  return bestCount < NEAR_PLAYER_AOI_QUOTA ? best : null;
}

/** Spawn in ring 12–45 cells from nearest living player to the candidate. */
export function pickNearPlayer(
  state: WorldState,
  rng: RNG,
  preferredPlayer?: { x: number; y: number },
): [number, number] | null {
  const players = alivePlayerCentroids(state);
  if (!players.length) return null;

  const anchor = preferredPlayer ?? players[randInt(rng, players.length)];

  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const pos = pickLandInRing(
      state,
      anchor.x,
      anchor.y,
      NEAR_PLAYER_RING[0],
      NEAR_PLAYER_RING[1],
      rng,
      NEAR_PLAYER_MIN_BAND_DISTANCE,
    );
    if (!pos) continue;

    const nearest = nearestPlayerTo(state, pos[0], pos[1]);
    if (!nearest) continue;
    if (!isInNearPlayerRing(pos[0], pos[1], nearest.x, nearest.y)) continue;
    return pos;
  }
  return null;
}

/** Weighted strategy: hotspot 40%, nearPlayer 35%, random 25%. */
export function pickSpawnPosition(state: WorldState, rng: RNG): [number, number] | null {
  const underServed = findUnderServedPlayer(state);
  if (underServed) {
    const pos = pickNearPlayer(state, rng, underServed);
    if (pos) return pos;
  }

  const roll = rng();
  const pois = state.spawnHints?.pois ?? [];

  if (roll < HOTSPOT_WEIGHT) {
    const pos = pois.length ? pickHotspot(state, rng, pois) : null;
    if (pos) return pos;
  } else if (roll < HOTSPOT_WEIGHT + NEAR_PLAYER_WEIGHT) {
    const pos = pickNearPlayer(state, rng);
    if (pos) return pos;
  }
  return pickRandomLand(state, rng);
}

/** True if any living band centroid is within radius of (px, py). */
export function hasBandsInRadius(state: WorldState, px: number, py: number, radius: number): boolean {
  return aliveGroupCentroids(state).some(c => dist(c.x, c.y, px, py) <= radius);
}

function getActiveStarterCount(state: WorldState): number {
  let set = starterGroupIdsByWorld.get(state);
  if (!set) return 0;
  for (const id of set) {
    if (!state.barbarianGroups.has(id)) set.delete(id);
  }
  if (set.size === 0) starterGroupIdsByWorld.delete(state);
  return set?.size ?? 0;
}

function trackStarterGroup(state: WorldState, groupId: string): void {
  let set = starterGroupIdsByWorld.get(state);
  if (!set) {
    set = new Set();
    starterGroupIdsByWorld.set(state, set);
  }
  set.add(groupId);
}

function getStarterBandCount(playerCount: number, rng: RNG): number {
  if (playerCount > 10) return 2;
  return 4 + randInt(rng, 2); // 4–5 for low population
}

function buildStarterArchetypes(count: number, rng: RNG): BarbarianArchetype[] {
  const passiveCount = Math.min(2, count);
  const aggressiveCount = Math.max(1, count - passiveCount);
  const out: BarbarianArchetype[] = [];

  out.push("HUNTERS");
  if (passiveCount > 1) {
    out.push("NOMADS");
  }
  for (let i = 0; i < aggressiveCount; i++) {
    out.push(AGGRESSIVE_STARTER_ARCHETYPES[randInt(rng, AGGRESSIVE_STARTER_ARCHETYPES.length)]);
  }
  while (out.length < count) {
    out.push(PASSIVE_STARTER_ARCHETYPES[randInt(rng, PASSIVE_STARTER_ARCHETYPES.length)]);
  }
  return out.slice(0, count);
}

function pickStarterPosition(
  state: WorldState,
  px: number,
  py: number,
  archetype: BarbarianArchetype,
  rng: RNG,
): [number, number] | null {
  const aggressive = AGGRESSIVE_STARTER_ARCHETYPES.includes(archetype);
  const minR = aggressive
    ? Math.max(STARTER_RING[0], TUTORIAL_SAFE_RADIUS + 2)
    : STARTER_RING[0];
  const maxR = STARTER_RING[1];

  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const pos = pickLandInRing(state, px, py, minR, maxR, rng, NEAR_PLAYER_MIN_BAND_DISTANCE);
    if (!pos) continue;
    if (aggressive && dist(pos[0], pos[1], px, py) < TUTORIAL_SAFE_RADIUS) continue;
    return pos;
  }
  return null;
}

/**
 * Spawn starter bands when a player squad is first created.
 * Low population: 4–5 mixed bands; 20+ players: 2 bands + global budget of 15.
 */
export function spawnStarterBandsNearPlayer(
  state: WorldState,
  px: number,
  py: number,
  nowMs: number,
  rng: RNG,
): SimEvent[] {
  const events: SimEvent[] = [];
  if (hasBandsInRadius(state, px, py, STARTER_SKIP_RADIUS)) return events;

  const playerCount = countAlivePlayers(state);
  const maxGroups = getMaxGroups(playerCount);
  if (state.barbarianGroups.size >= maxGroups) return events;
  if (getActiveStarterCount(state) >= MAX_ACTIVE_STARTERS) return events;

  const count = Math.min(
    getStarterBandCount(playerCount, rng),
    maxGroups - state.barbarianGroups.size,
    MAX_ACTIVE_STARTERS - getActiveStarterCount(state),
  );
  if (count <= 0) return events;

  const archetypes = buildStarterArchetypes(count, rng);

  for (let i = 0; i < count && state.barbarianGroups.size < maxGroups; i++) {
    if (getActiveStarterCount(state) >= MAX_ACTIVE_STARTERS) break;

    const archetype = archetypes[i];
    const pos = pickStarterPosition(state, px, py, archetype, rng);
    if (!pos) continue;

    const group = spawnRoamingGroup(state, pos[0], pos[1], archetype, nowMs, rng);
    if (group) {
      trackStarterGroup(state, group.id);
      events.push({
        type: "GROUP_SPAWNED",
        groupId: group.id,
        unitCount: group.units.length,
        archetype: group.archetype,
      });
      if (group.isBoss) {
        events.push({
          type: "BOSS_SPAWNED",
          groupId: group.id,
          groupName: group.name,
          x: pos[0],
          y: pos[1],
        });
      }
    }
  }
  return events;
}
