// Pure barbarian simulation — roaming groups only (no camps).

import type { RNG } from "../sim/rng.js";
import type { WorldState, BarbarianArchetype } from "../sim/worldState.js";
import type { SimEvent } from "../sim/events.js";
import { LOCAL_SEASONAL_SPAWN_CONFIG } from "./barbarianConfigData.js";
import { spawnRoamingGroup, getMaxGroups, getInitialGroupCount, countAlivePlayers } from "./barbarianGroupAI.js";
import {
  pickSpawnPosition,
  pickNearPlayer,
  findUnderServedPlayer,
  NEAR_PLAYER_AOI_QUOTA,
} from "./barbarianSpawnPlacements.js";

const SPAWN_CHANCE_PER_TICK = 0.06;

const AGGRESSIVE_ARCHETYPES: BarbarianArchetype[] = ["RAIDERS", "MARAUDERS", "WARHOST"];
const BARB_ATTACK_RADIUS = 40;
const BARB_ATTACK_COOLDOWN_MS = 120_000; // 2 min real-time

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function pickArchetype(season: string, rng: RNG): BarbarianArchetype {
  const allowed: BarbarianArchetype[] = ["RAIDERS", "HUNTERS", "NOMADS", "MARAUDERS", "WARHOST"];
  const seasonWeights = (LOCAL_SEASONAL_SPAWN_CONFIG as { archetypeWeights?: Record<string, Partial<Record<BarbarianArchetype, number>>> }).archetypeWeights?.[season] ?? {};
  const weights = allowed.map(a => (seasonWeights[a] ?? 1.0) as number);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < allowed.length; i++) {
    r -= weights[i];
    if (r <= 0) return allowed[i];
  }
  return allowed[0];
}

function spawnOneGroup(
  state: WorldState,
  pos: [number, number],
  nowMs: number,
  rng: RNG,
): SimEvent[] {
  const archetype = pickArchetype(state.season.currentSeason, rng);
  const group = spawnRoamingGroup(state, pos[0], pos[1], archetype, nowMs, rng);
  if (!group) return [];
  const events: SimEvent[] = [{
    type: "GROUP_SPAWNED",
    groupId: group.id,
    unitCount: group.units.length,
    archetype: group.archetype,
  }];
  if (group.isBoss) {
    events.push({
      type: "BOSS_SPAWNED",
      groupId: group.id,
      groupName: group.name,
      x: pos[0],
      y: pos[1],
    });
  }
  return events;
}

/** Spawn initial roaming bands + occasional new groups. */
export function tickSpawn(state: WorldState, nowMs: number, rng: RNG): SimEvent[] {
  const events: SimEvent[] = [];
  const playerCount = countAlivePlayers(state);
  const maxGroups = getMaxGroups(playerCount);

  if (state.barbarianGroups.size === 0 && nowMs < 5000) {
    const initialCount = getInitialGroupCount(playerCount);
    for (let i = 0; i < initialCount && state.barbarianGroups.size < maxGroups; i++) {
      const pos = pickSpawnPosition(state, rng);
      if (!pos) continue;
      const evs = spawnOneGroup(state, pos, nowMs, rng);
      if (evs.length) events.push(...evs);
    }
    return events;
  }

  if (state.barbarianGroups.size >= maxGroups) return events;

  const underServed = findUnderServedPlayer(state);
  if (underServed) {
    const pos = pickNearPlayer(state, rng, underServed);
    if (pos) {
      const evs = spawnOneGroup(state, pos, nowMs, rng);
      if (evs.length) {
        events.push(...evs);
        return events;
      }
    }
  }

  if (rng() > SPAWN_CHANCE_PER_TICK) return events;

  const pos = pickSpawnPosition(state, rng);
  if (!pos) return events;
  const evs = spawnOneGroup(state, pos, nowMs, rng);
  if (evs.length) events.push(...evs);
  return events;
}

export { NEAR_PLAYER_AOI_QUOTA };

/** Camps removed — no-op kept for simEngine compat. */
export function tickBarbarians(_state: WorldState, _nowMs: number, _rng: RNG): SimEvent[] {
  return [];
}

/** Aggressive roaming groups march on nearby cities. */
export function tickBarbarianAttacks(state: WorldState, nowMs: number, rng: RNG): SimEvent[] {
  const events: SimEvent[] = [];
  const cities = [...state.cities.values()];
  if (cities.length === 0) return events;

  for (const group of state.barbarianGroups.values()) {
    if (!AGGRESSIVE_ARCHETYPES.includes(group.archetype)) continue;
    if (group.state === "ENGAGED" || group.units.every(u => u.hp <= 0)) continue;
    if ((group as { lastAttackAt?: number }).lastAttackAt !== undefined
      && (group as { lastAttackAt?: number }).lastAttackAt! + BARB_ATTACK_COOLDOWN_MS > nowMs) continue;
    if (rng() > 0.04) continue;

    const center = group.units.reduce((acc, u) => {
      if (u.hp > 0) { acc.x += u.x; acc.y += u.y; acc.n++; }
      return acc;
    }, { x: 0, y: 0, n: 0 });
    if (!center.n) continue;
    center.x /= center.n; center.y /= center.n;

    let bestCity = null, bestDist = Infinity;
    for (const city of cities) {
      const d = dist(city.x, city.y, center.x, center.y);
      if (d <= BARB_ATTACK_RADIUS && d < bestDist) { bestDist = d; bestCity = city; }
    }
    if (!bestCity) continue;

    group.tx = bestCity.x + 0.5;
    group.ty = bestCity.y + 0.5;
    group.state = "MARCHING";
    group.path = [];
    group.pathIdx = 0;
    (group as { lastAttackAt?: number }).lastAttackAt = nowMs;

    events.push({
      type: "GROUP_STATE_CHANGED",
      groupId: group.id,
      from: "RESTING",
      to: "MARCHING",
    });
  }

  return events;
}
