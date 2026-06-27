import type { RNG } from "../sim/rng.js";
import type { WorldState, BarbarianArchetype, BarbarianGroup, PlayerSquad } from "../sim/worldState.js";
import type { SimEvent } from "../sim/events.js";
import { getGroupCentroid } from "./barbarianGroupAI.js";
import { issueGroupMove } from "./barbarianPathfinding.js";
import { getTerrainNavGrid } from "./barbarianPathfinding.js";
import { hasLineOfSight } from "../tactics/terrainTactics.js";
import { isInAnyOutpostSafeZone } from "../sim/outpostCamp.js";
import { isUnitInvulnerable } from "../sim/outpostActions.js";

export const PLAYER_HUNTER_ARCHETYPES: BarbarianArchetype[] = ["RAIDERS", "MARAUDERS", "WARHOST"];

/** Per-archetype player detection radius (macro cells). */
export const PLAYER_DETECT_RADIUS: Record<"RAIDERS" | "MARAUDERS" | "WARHOST", number> = {
  RAIDERS: 22,
  MARAUDERS: 25,
  WARHOST: 28,
};

export const PLAYER_COMBAT_ENGAGE_RADIUS = 12;
const REPATH_THRESHOLD = 8;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function isPlayerHunterArchetype(archetype: BarbarianArchetype): boolean {
  return PLAYER_HUNTER_ARCHETYPES.includes(archetype);
}

export function getPlayerDetectRadius(archetype: BarbarianArchetype): number | null {
  if (archetype === "RAIDERS" || archetype === "MARAUDERS" || archetype === "WARHOST") {
    return PLAYER_DETECT_RADIUS[archetype];
  }
  return null;
}

/** Hunt transition probability scales with proximity (15% at detect edge → 100% near engage). */
export function huntTransitionProbability(distance: number, detectRadius: number): number {
  if (distance <= PLAYER_COMBAT_ENGAGE_RADIUS) return 1;
  const span = Math.max(1, detectRadius - PLAYER_COMBAT_ENGAGE_RADIUS);
  const t = (detectRadius - distance) / span;
  return 0.15 + Math.max(0, Math.min(1, t)) * 0.85;
}

export interface PlayerSquadCentroid {
  profileId: string;
  x: number;
  y: number;
}

export function getAlivePlayerCentroids(state: WorldState): PlayerSquadCentroid[] {
  const out: PlayerSquadCentroid[] = [];
  for (const [profileId, squad] of state.playerSquads) {
    if (squad.wiped || isUnitInvulnerable(squad)) continue;
    const c = squadCentroid(squad);
    if (c) out.push({ profileId, ...c });
  }
  return out;
}

export function squadCentroid(squad: PlayerSquad): { x: number; y: number } | null {
  const alive = squad.units.filter(u => u.hp > 0);
  if (!alive.length) return null;
  let cx = 0, cy = 0;
  for (const u of alive) { cx += u.x; cy += u.y; }
  return { x: cx / alive.length, y: cy / alive.length };
}

export function findNearestDetectablePlayer(
  state: WorldState,
  group: BarbarianGroup,
  detectRadius: number,
): PlayerSquadCentroid | null {
  const center = getGroupCentroid(group.units);
  const grid = getTerrainNavGrid(state.terrain);
  let best: PlayerSquadCentroid | null = null;
  let bestD = Infinity;

  for (const player of getAlivePlayerCentroids(state)) {
    if (isInAnyOutpostSafeZone(state, player.x, player.y)) continue;
    const d = dist(center.x, center.y, player.x, player.y);
    if (d > detectRadius || d >= bestD) continue;
    if (!hasLineOfSight(grid, center.x, center.y, player.x, player.y)) continue;
    best = player;
    bestD = d;
  }
  return best;
}

function setHuntingState(
  group: BarbarianGroup,
  profileId: string,
  nowMs: number,
  events: SimEvent[],
): void {
  const from = group.state;
  group.state = "HUNTING";
  group.huntProfileId = profileId;
  group.lastActionMs = nowMs;
  if (from !== "HUNTING") {
    events.push({ type: "GROUP_STATE_CHANGED", groupId: group.id, from, to: "HUNTING" });
  }
}

function clearHunt(group: BarbarianGroup, nowMs: number, events: SimEvent[]): void {
  if (group.state !== "HUNTING" && !group.huntProfileId) return;
  const from = group.state;
  group.huntProfileId = undefined;
  if (from === "HUNTING") {
    group.state = "WANDERING";
    group.lastActionMs = nowMs;
    events.push({ type: "GROUP_STATE_CHANGED", groupId: group.id, from, to: "WANDERING" });
  }
}

function marchToward(
  state: WorldState,
  group: BarbarianGroup,
  destX: number,
  destY: number,
): void {
  const center = getGroupCentroid(group.units);
  const d = dist(center.x, center.y, group.tx, group.ty);
  if (group.path.length === 0 || d > REPATH_THRESHOLD) {
    issueGroupMove(group, destX, destY, state.terrain);
  }
}

export function tickBarbarianPlayerAI(
  state: WorldState,
  nowMs: number,
  rng: RNG,
): SimEvent[] {
  const events: SimEvent[] = [];

  for (const group of state.barbarianGroups.values()) {
    if (!isPlayerHunterArchetype(group.archetype)) continue;
    if (group.state === "ENGAGED") continue;
    const alive = group.units.filter(u => u.hp > 0);
    if (!alive.length) continue;

    const detectRadius = getPlayerDetectRadius(group.archetype)!;
    const center = getGroupCentroid(alive);

    if (group.state === "HUNTING" && group.huntProfileId) {
      const squad = state.playerSquads.get(group.huntProfileId);
      const target = squad ? squadCentroid(squad) : null;
      if (!target || isInAnyOutpostSafeZone(state, target.x, target.y)) {
        clearHunt(group, nowMs, events);
        continue;
      }

      const d = dist(center.x, center.y, target.x, target.y);
      if (d > detectRadius * 1.5) {
        clearHunt(group, nowMs, events);
        continue;
      }

      if (d > PLAYER_COMBAT_ENGAGE_RADIUS) {
        marchToward(state, group, target.x, target.y);
      } else {
        group.tx = target.x;
        group.ty = target.y;
        group.path = [];
        group.pathIdx = 0;
      }
      continue;
    }

    const prey = findNearestDetectablePlayer(state, group, detectRadius);
    if (!prey) continue;

    const d = dist(center.x, center.y, prey.x, prey.y);
    const huntProb = huntTransitionProbability(d, detectRadius);
    if (rng() > huntProb) continue;

    setHuntingState(group, prey.profileId, nowMs, events);
    marchToward(state, group, prey.x, prey.y);
  }

  return events;
}
