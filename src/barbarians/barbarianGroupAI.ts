import type { RNG } from "../sim/rng.js";
import { randInt } from "../sim/rng.js";
import type { WorldState, BarbarianGroup, BarbarianGroupState, BarbarianUnit, BarbarianArchetype } from "../sim/worldState.js";
import { nextId } from "../sim/worldState.js";
import type { SimEvent } from "../sim/events.js";
import type { TerrainKind } from "../worldgen/worldTerrainConfigData.js";
import { GROUP_COMPOSITION, unitHpForType } from "./barbarianConfigData.js";
import { LOCAL_SEASONAL_SPAWN_CONFIG } from "./barbarianConfigData.js";
import { generateGroupName, generateUniqueBarbarianName } from "./barbarianNames.js";
import {
  findPathMacro, getGroupCentroid, isLandCell, issueGroupMove,
  advancePathIndex, initGroupFormation, unitSpeed,
} from "./barbarianPathfinding.js";
import { estimateTravelMs, sampleCell } from "../tactics/terrainTactics.js";
import { getTerrainNavGrid } from "./barbarianPathfinding.js";
import { buildGroupSpatialHash, type GroupSpatialHash } from "./groupSpatialHash.js";

/** @deprecated Use getMaxGroups(playerCount) — kept for tests expecting an upper bound. */
export const MAX_GROUPS = 150;
export const MAX_UNITS_PER_GROUP = 15;

export function countAlivePlayers(state: WorldState): number {
  let n = 0;
  for (const squad of state.playerSquads.values()) {
    if (squad.units.some(u => u.hp > 0)) n++;
  }
  return n;
}

/** Dynamic cap: min(150, 40 + playerCount × 3). */
export function getMaxGroups(playerCount: number): number {
  return Math.min(150, 40 + playerCount * 3);
}

/** Initial band count at sim boot: min(MAX, 30 + playerCount × 2). */
export function getInitialGroupCount(playerCount: number): number {
  return Math.min(getMaxGroups(playerCount), 30 + playerCount * 2);
}
export const MAX_DISTANCE_FROM_ANCHOR = 80;
const ANCHOR_PROXIMITY = 3;

/** Real-time rest durations (milliseconds). −20% vs baseline for livelier patrol. */
const REST_MS: Record<BarbarianArchetype, [number, number]> = {
  NOMADS:    [9_600, 28_000],
  RAIDERS:   [12_000, 36_000],
  HUNTERS:   [16_000, 44_000],
  MARAUDERS: [12_000, 32_000],
  WARHOST:   [20_000, 48_000],
};

const WANDER_RADIUS: Record<BarbarianArchetype, [number, number]> = {
  NOMADS:    [19, 31],
  RAIDERS:   [13, 25],
  HUNTERS:   [12, 28],
  MARAUDERS: [10, 22],
  WARHOST:   [6, 14],
};

const MARCH_RADIUS: Record<BarbarianArchetype, [number, number]> = {
  NOMADS:    [25, 50],
  RAIDERS:   [20, 45],
  HUNTERS:   [12, 30],
  MARAUDERS: [22, 48],
  WARHOST:   [10, 25],
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function groupTotalHp(group: BarbarianGroup): number {
  return group.units.filter(u => u.hp > 0).reduce((s, u) => s + u.hp, 0);
}

function groupMaxHp(group: BarbarianGroup): number {
  return group.units.filter(u => u.hp > 0).reduce((s, u) => s + u.maxHp, 0);
}

export function groupHpRatio(group: BarbarianGroup): number {
  const max = groupMaxHp(group);
  return max > 0 ? groupTotalHp(group) / max : 0;
}

function pickLandNear(
  state: WorldState, cx: number, cy: number, radius: number, rng: RNG,
): [number, number] | null {
  for (let i = 0; i < 24; i++) {
    const angle = rng() * Math.PI * 2;
    const d = radius * (0.3 + rng() * 0.7);
    const x = cx + Math.cos(angle) * d;
    const y = cy + Math.sin(angle) * d;
    if (isLandCell(state.terrain, x, y)) return [x, y];
  }
  return null;
}

function terrainAt(state: WorldState, x: number, y: number): { kind: TerrainKind; height: number } {
  const grid = getTerrainNavGrid(state.terrain);
  const cell = sampleCell(grid, x, y);
  return { kind: cell.kind, height: cell.height };
}

function scoreRestSpot(archetype: BarbarianArchetype, kind: TerrainKind, height: number): number {
  let score = 0;
  if (archetype === "HUNTERS") {
    if (kind === "HILLS" && height >= 45) score += 3;
    if (kind === "FOREST") score += 2;
    if (height >= 50) score += 1;
  } else if (archetype === "WARHOST") {
    if (kind === "HILLS") score += 2;
    if (kind === "PLAINS" || kind === "SAVANNA") score += 1;
  } else if (archetype === "RAIDERS" || archetype === "MARAUDERS") {
    if (kind === "ROAD") score += 2;
    if (kind === "PLAINS") score += 1;
  } else {
    if (kind === "FOREST" || kind === "HILLS") score += 1;
  }
  if (kind === "SWAMP" || kind === "WATER") score -= 5;
  return score;
}

function pickStrategicRestSpot(state: WorldState, group: BarbarianGroup, rng: RNG): [number, number] | null {
  const center = getGroupCentroid(group.units);
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const candidate = pickLandNear(state, center.x, center.y, 6 + rng() * 8, rng);
    if (!candidate) continue;
    const { kind, height } = terrainAt(state, candidate[0], candidate[1]);
    const score = scoreRestSpot(group.archetype, kind, height);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best ?? pickLandNear(state, center.x, center.y, 4, rng);
}

function nearestPlayerDistance(state: WorldState, x: number, y: number): number | null {
  let best: number | null = null;
  for (const squad of state.playerSquads.values()) {
    const alive = squad.units.filter(u => u.hp > 0);
    if (!alive.length) continue;
    let cx = 0, cy = 0;
    for (const u of alive) { cx += u.x; cy += u.y; }
    cx /= alive.length;
    cy /= alive.length;
    const d = dist(cx, cy, x, y);
    if (best === null || d < best) best = d;
  }
  return best;
}

function applyFarSpawnBonus(
  state: WorldState,
  x: number,
  y: number,
  soldiers: number,
  snipers: number,
  rng: RNG,
): { soldiers: number; snipers: number } {
  const nearest = nearestPlayerDistance(state, x, y);
  if (nearest === null || nearest <= 120) return { soldiers, snipers };
  const total = soldiers + snipers;
  if (total >= MAX_UNITS_PER_GROUP) return { soldiers, snipers };
  if (rng() < 0.5 && soldiers < MAX_UNITS_PER_GROUP) {
    return { soldiers: soldiers + 1, snipers };
  }
  return { soldiers, snipers: snipers + 1 };
}

function rollComposition(
  state: WorldState,
  x: number,
  y: number,
  archetype: BarbarianArchetype,
  rng: RNG,
): { soldiers: number; snipers: number } {
  const comp = GROUP_COMPOSITION[archetype];
  let soldiers = randInt(rng, comp.soldiers[1] - comp.soldiers[0] + 1) + comp.soldiers[0];
  let snipers = randInt(rng, comp.snipers[1] - comp.snipers[0] + 1) + comp.snipers[0];
  let total = Math.min(MAX_UNITS_PER_GROUP, soldiers + snipers);
  if (total <= soldiers) return { soldiers: total, snipers: 0 };
  const base = { soldiers, snipers: Math.min(snipers, total - soldiers) };
  return applyFarSpawnBonus(state, x, y, base.soldiers, base.snipers, rng);
}

export const BOSS_SPAWN_CHANCE = 0.05;
export const BOSS_HP_MULTIPLIER = 2;

/** Spawn a roaming barbarian band at world coordinates (no camp). */
export function spawnRoamingGroup(
  state: WorldState,
  x: number,
  y: number,
  archetype: BarbarianArchetype,
  nowMs: number,
  rng: RNG,
  initialState: BarbarianGroupState = "RESTING",
): BarbarianGroup | null {
  if (state.barbarianGroups.size >= getMaxGroups(countAlivePlayers(state))) return null;
  if (!isLandCell(state.terrain, x, y)) return null;

  const { soldiers, snipers } = rollComposition(state, x, y, archetype, rng);
  const units: BarbarianUnit[] = [];
  const base = pickLandNear(state, x, y, 2, rng) ?? [x, y];

  for (let i = 0; i < soldiers; i++) {
    const id = nextId(state);
    units.push({
      id,
      name: generateUniqueBarbarianName(state.usedBarbarianNames, rng, id),
      type: "soldier",
      hp: unitHpForType("soldier"),
      maxHp: unitHpForType("soldier"),
      x: base[0], y: base[1],
    });
  }
  for (let i = 0; i < snipers; i++) {
    const id = nextId(state);
    units.push({
      id,
      name: generateUniqueBarbarianName(state.usedBarbarianNames, rng, id),
      type: "sniper",
      hp: unitHpForType("sniper"),
      maxHp: unitHpForType("sniper"),
      x: base[0], y: base[1],
    });
  }

  const isBoss = rng() < BOSS_SPAWN_CHANCE;
  if (isBoss && units.length > 0) {
    const boss = units[0]!;
    const doubled = boss.maxHp * BOSS_HP_MULTIPLIER;
    boss.hp = doubled;
    boss.maxHp = doubled;
    boss.name = `Jefe ${boss.name}`;
  }

  const [restMin, restMax] = REST_MS[archetype];
  const restDuration = restMin + rng() * (restMax - restMin);

  const group: BarbarianGroup = {
    id: nextId(state),
    name: generateGroupName(archetype, rng),
    archetype,
    isBoss: isBoss || undefined,
    anchorX: base[0],
    anchorY: base[1],
    state: initialState,
    units,
    tx: base[0],
    ty: base[1],
    path: [],
    pathIdx: 0,
    stateUntilMs: nowMs + restDuration,
    lastActionMs: nowMs,
    restCount: 0,
    fatigue: 0,
  };

  state.barbarianGroups.set(group.id, group);
  initGroupFormation(group, base[0], base[1] + 1);
  return group;
}

/** @deprecated Use spawnRoamingGroup */
export const spawnBarbarianGroup = spawnRoamingGroup;

function setGroupState(
  group: BarbarianGroup,
  newState: BarbarianGroupState,
  nowMs: number,
  events: SimEvent[],
): void {
  if (group.state === newState) return;
  const from = group.state;
  group.state = newState;
  events.push({ type: "GROUP_STATE_CHANGED", groupId: group.id, from, to: newState });
}

function pickWanderDest(state: WorldState, group: BarbarianGroup, rng: RNG): [number, number] | null {
  const [rMin, rMax] = WANDER_RADIUS[group.archetype];
  const radius = rMin + rng() * (rMax - rMin);
  const center = getGroupCentroid(group.units);
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 12; i++) {
    const candidate = pickLandNear(state, center.x, center.y, radius, rng);
    if (!candidate) continue;
    const { kind, height } = terrainAt(state, candidate[0], candidate[1]);
    let score = scoreRestSpot(group.archetype, kind, height);
    if (kind === "ROAD") score += 2;
    if (kind === "PLAINS") score += 1;
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best
    ?? pickLandNear(state, center.x, center.y, radius, rng)
    ?? pickLandNear(state, group.anchorX, group.anchorY, radius, rng);
}

function pickMarchDest(state: WorldState, group: BarbarianGroup, rng: RNG): [number, number] | null {
  const [rMin, rMax] = MARCH_RADIUS[group.archetype];
  const radius = rMin + rng() * (rMax - rMin);
  return pickLandNear(state, group.anchorX, group.anchorY, radius, rng);
}

const POI_PATROL_ARCHETYPES: BarbarianArchetype[] = ["NOMADS", "MARAUDERS"];
const POI_PATROL_MAX_DIST = 90;

interface PoiPatrolCircuit {
  poiA: { x: number; y: number };
  poiB: { x: number; y: number };
  leg: 0 | 1;
}

const poiPatrolByGroupId = new Map<string, PoiPatrolCircuit>();

function clearPoiPatrol(groupId: string): void {
  poiPatrolByGroupId.delete(groupId);
}

function pickTwoNearbyPois(
  state: WorldState,
  cx: number,
  cy: number,
  rng: RNG,
): [{ x: number; y: number }, { x: number; y: number }] | null {
  const pois = state.spawnHints?.pois ?? [];
  if (pois.length < 2) return null;

  const ranked = pois
    .map(p => ({ p, d: dist(cx, cy, p.x, p.y) }))
    .filter(e => e.d <= POI_PATROL_MAX_DIST)
    .sort((a, b) => a.d - b.d);
  if (ranked.length < 2) return null;

  const poiA = ranked[0].p;
  let bestB: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let i = 1; i < ranked.length; i++) {
    const poiB = ranked[i].p;
    const legDist = dist(poiA.x, poiA.y, poiB.x, poiB.y);
    if (legDist < 12 || legDist > POI_PATROL_MAX_DIST) continue;
    const score = ranked[i].d + legDist * 0.3;
    if (score < bestScore) { bestScore = score; bestB = poiB; }
  }
  if (!bestB) {
    const idx = 1 + randInt(rng, Math.min(ranked.length - 1, 4));
    bestB = ranked[idx].p;
  }
  return [poiA, bestB];
}

function initPoiPatrolCircuit(
  state: WorldState,
  group: BarbarianGroup,
  rng: RNG,
): PoiPatrolCircuit | null {
  const center = getGroupCentroid(group.units);
  const pair = pickTwoNearbyPois(state, center.x, center.y, rng);
  if (!pair) return null;
  const circuit: PoiPatrolCircuit = { poiA: pair[0], poiB: pair[1], leg: 0 };
  poiPatrolByGroupId.set(group.id, circuit);
  return circuit;
}

function getPoiPatrolDest(group: BarbarianGroup): [number, number] | null {
  const circuit = poiPatrolByGroupId.get(group.id);
  if (!circuit) return null;
  const target = circuit.leg === 0 ? circuit.poiA : circuit.poiB;
  return [target.x, target.y];
}

function advancePoiPatrolLeg(group: BarbarianGroup): void {
  const circuit = poiPatrolByGroupId.get(group.id);
  if (!circuit) return;
  circuit.leg = circuit.leg === 0 ? 1 : 0;
}

function tryStartPoiPatrol(
  state: WorldState,
  group: BarbarianGroup,
  rng: RNG,
  nowMs: number,
  events: SimEvent[],
): boolean {
  if (!POI_PATROL_ARCHETYPES.includes(group.archetype)) return false;
  if (rng() > 0.55) return false;
  const circuit = initPoiPatrolCircuit(state, group, rng);
  if (!circuit) return false;
  const dest = getPoiPatrolDest(group);
  if (!dest) return false;
  return startMove(state, group, dest[0], dest[1], "MARCHING", nowMs, events);
}

function seasonWanderBias(season: string): number {
  const base = season === "SUMMER" ? 0.8 : season === "WINTER" ? 0.5 : 0.7;
  if (season === "SUMMER" || season === "AUTUMN") return Math.max(0.75, base);
  return base;
}

function startMove(
  state: WorldState,
  group: BarbarianGroup,
  destX: number,
  destY: number,
  newState: BarbarianGroupState,
  nowMs: number,
  events: SimEvent[],
): boolean {
  if (!issueGroupMove(group, destX, destY, state.terrain)) return false;
  setGroupState(group, newState, nowMs, events);
  group.lastActionMs = nowMs;
  const center = getGroupCentroid(group.units);
  const d = dist(center.x, center.y, destX, destY);
  const travelMs = estimateTravelMs(d);
  events.push({
    type: "GROUP_DEPARTED",
    groupId: group.id,
    fromX: center.x,
    fromY: center.y,
    toX: destX,
    toY: destY,
  });
  events.push({
    type: "ARMY_MARCHING",
    armyId: group.id,
    campId: group.id,
    groupId: group.id,
    fromX: center.x,
    fromY: center.y,
    toX: destX,
    toY: destY,
    arrivesAtMs: nowMs + travelMs,
  });
  return true;
}

const REPULSION_RADIUS = 3;

function applyRepulsion(group: BarbarianGroup, spatial: GroupSpatialHash): void {
  if (group.state === "ENGAGED") return;
  const alive = group.units.filter(u => u.hp > 0);
  if (!alive.length) return;
  const center = getGroupCentroid(alive);
  let pushX = 0, pushY = 0;
  spatial.forEachInRadius(center.x, center.y, REPULSION_RADIUS, (entry) => {
    if (entry.id === group.id) return;
    const d = dist(center.x, center.y, entry.x, entry.y);
    if (d < REPULSION_RADIUS && d > 0.01) {
      const push = (REPULSION_RADIUS - d) * 0.12;
      pushX += (center.x - entry.x) / d * push;
      pushY += (center.y - entry.y) / d * push;
    }
  });
  if (Math.abs(pushX) < 0.001 && Math.abs(pushY) < 0.001) return;
  const newCx = center.x + pushX;
  const newCy = center.y + pushY;
  for (const u of alive) {
    u.x = newCx + (u.formOX ?? 0);
    u.y = newCy + (u.formOY ?? 0);
  }
}

const ENGAGED_HOLD_DIST = 5;

/** Limpia path y ancla destino al centro actual — evita disparos post-combate. */
export function resetGroupTravelState(group: BarbarianGroup): { x: number; y: number } {
  const alive = group.units.filter(u => u.hp > 0);
  const center = getGroupCentroid(alive);
  group.path = [];
  group.pathIdx = 0;
  group.tx = center.x;
  group.ty = center.y;
  return center;
}

export function tickBarbarianGroupMovement(state: WorldState, dtSimMs: number): void {
  for (const group of state.barbarianGroups.values()) {
    if (group.state === "RESTING") continue;
    const alive = group.units.filter(u => u.hp > 0);
    if (!alive.length) continue;

    if (group.state === "ENGAGED" && group.engageTargetId) {
      const enemy = state.barbarianGroups.get(group.engageTargetId);
      const enemyAlive = enemy?.units.filter(u => u.hp > 0) ?? [];
      if (enemyAlive.length) {
        const center = getGroupCentroid(alive);
        const ec = getGroupCentroid(enemyAlive);
        const d = dist(center.x, center.y, ec.x, ec.y);
        if (d > ENGAGED_HOLD_DIST) {
          const dtSec = dtSimMs / 1000;
          const speed = unitSpeed("soldier", group.fatigue, state.terrain, center.x, center.y) * 0.55;
          const step = Math.min(d - ENGAGED_HOLD_DIST, speed * dtSec);
          const newCx = center.x + (ec.x - center.x) / d * step;
          const newCy = center.y + (ec.y - center.y) / d * step;
          for (const u of alive) {
            u.x = newCx + (u.formOX ?? 0);
            u.y = newCy + (u.formOY ?? 0);
          }
          group.fatigue += dtSimMs / 3_600_000;
        }
      }
      continue;
    }

    advancePathIndex(group, state.terrain);

    let targetX = group.tx;
    let targetY = group.ty;
    if (group.pathIdx < group.path.length) {
      const wp = group.path[group.pathIdx];
      targetX = wp.x;
      targetY = wp.y;
    }

    const center = getGroupCentroid(alive);
    const dx = targetX - center.x;
    const dy = targetY - center.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) continue;

    const dtSec = dtSimMs / 1000;
    const speed = unitSpeed("soldier", group.fatigue, state.terrain, center.x, center.y);
    const step = Math.min(d, speed * dtSec);
    const mx = (dx / d) * step;
    const my = (dy / d) * step;

    const newCx = center.x + mx;
    const newCy = center.y + my;
    for (const u of alive) {
      u.x = newCx + (u.formOX ?? 0);
      u.y = newCy + (u.formOY ?? 0);
    }
    group.fatigue += dtSimMs / 3_600_000;
  }
}

function tickGroupFsm(
  state: WorldState,
  group: BarbarianGroup,
  nowMs: number,
  rng: RNG,
  events: SimEvent[],
): void {
  const alive = group.units.filter(u => u.hp > 0);
  if (!alive.length) return;
  if (group.state === "ENGAGED" || group.state === "HUNTING") return;

  const center = getGroupCentroid(alive);
  const anchorDist = dist(center.x, center.y, group.anchorX, group.anchorY);
  const hpRatio = groupHpRatio(group);

  if (hpRatio < 0.35 && group.state !== "RETURNING") {
    if (startMove(state, group, group.anchorX, group.anchorY, "RETURNING", nowMs, events)) return;
  }

  if (anchorDist > MAX_DISTANCE_FROM_ANCHOR && group.state !== "RETURNING") {
    if (!startMove(state, group, group.anchorX, group.anchorY, "RETURNING", nowMs, events)) {
      setGroupState(group, "RETURNING", nowMs, events);
      group.tx = group.anchorX;
      group.ty = group.anchorY;
      group.path = [];
      group.pathIdx = 0;
    }
    return;
  }

  if (group.state === "RETURNING" && anchorDist < ANCHOR_PROXIMITY) {
    group.path = [];
    group.pathIdx = 0;
    group.tx = group.anchorX;
    group.ty = group.anchorY;
    const [restMin, restMax] = REST_MS[group.archetype];
    group.stateUntilMs = nowMs + (restMin + rng() * (restMax - restMin)) * (hpRatio < 0.5 ? 1.5 : 1);
    group.restCount++;
    group.fatigue = Math.max(0, group.fatigue - 1);
    setGroupState(group, "RESTING", nowMs, events);
    events.push({ type: "GROUP_RESTING", groupId: group.id });
    events.push({ type: "ARMY_ARRIVED", armyId: group.id, campId: group.id, groupId: group.id, x: center.x, y: center.y });
    return;
  }

  const atDest = group.path.length > 0 && group.pathIdx >= group.path.length;
  if ((group.state === "WANDERING" || group.state === "MARCHING") && atDest) {
    const distToTarget = dist(center.x, center.y, group.tx, group.ty);
    if (distToTarget < ANCHOR_PROXIMITY) {
      const restSpot = pickStrategicRestSpot(state, group, rng);
      if (restSpot) {
        group.anchorX = restSpot[0];
        group.anchorY = restSpot[1];
        for (const u of alive) {
          u.x += (restSpot[0] - center.x) * 0.1;
          u.y += (restSpot[1] - center.y) * 0.1;
        }
      }
      if (rng() < 0.35) {
        const [restMin, restMax] = REST_MS[group.archetype];
        group.stateUntilMs = nowMs + restMin + rng() * (restMax - restMin);
        group.fatigue = Math.max(0, group.fatigue - 0.5);
        setGroupState(group, "RESTING", nowMs, events);
        events.push({ type: "GROUP_RESTING", groupId: group.id });
      } else if (poiPatrolByGroupId.has(group.id)) {
        advancePoiPatrolLeg(group);
        const dest = getPoiPatrolDest(group);
        if (dest) startMove(state, group, dest[0], dest[1], "MARCHING", nowMs, events);
        else clearPoiPatrol(group.id);
      } else {
        const dest = pickWanderDest(state, group, rng);
        if (dest) startMove(state, group, dest[0], dest[1], "WANDERING", nowMs, events);
      }
      return;
    }
  }

  if (group.state === "RESTING" && nowMs >= group.stateUntilMs) {
    if (tryStartPoiPatrol(state, group, rng, nowMs, events)) return;
    const wanderChance = seasonWanderBias(state.season.currentSeason);
    if (rng() < wanderChance) {
      const dest = pickWanderDest(state, group, rng);
      if (dest) startMove(state, group, dest[0], dest[1], "WANDERING", nowMs, events);
    } else {
      const dest = pickMarchDest(state, group, rng);
      if (dest) startMove(state, group, dest[0], dest[1], "MARCHING", nowMs, events);
    }
  }
}

export function tickBarbarianGroupLifecycle(state: WorldState, events: SimEvent[]): void {
  const toDelete: string[] = [];
  for (const [id, group] of state.barbarianGroups) {
    if (!group.units.some(u => u.hp > 0)) {
      toDelete.push(id);
      events.push({ type: "GROUP_DISBANDED", groupId: id });
    }
  }
  for (const id of toDelete) {
    clearPoiPatrol(id);
    state.barbarianGroups.delete(id);
  }
}

export function tickBarbarianGroups(
  state: WorldState,
  nowMs: number,
  dtSimMs: number,
  rng: RNG,
): SimEvent[] {
  const events: SimEvent[] = [];
  tickBarbarianGroupMovement(state, dtSimMs);
  const spatial = buildGroupSpatialHash(state.barbarianGroups.values());
  for (const group of state.barbarianGroups.values()) {
    applyRepulsion(group, spatial);
    tickGroupFsm(state, group, nowMs, rng, events);
  }
  tickBarbarianGroupLifecycle(state, events);
  return events;
}

export function hasHostileNearby(
  state: WorldState,
  group: BarbarianGroup,
  detectRadius: number,
  isHostile: (a: BarbarianArchetype, b: BarbarianArchetype) => boolean,
  spatial?: GroupSpatialHash,
): BarbarianGroup | null {
  const center = getGroupCentroid(group.units);
  const hash = spatial ?? buildGroupSpatialHash(state.barbarianGroups.values());
  let found: BarbarianGroup | null = null;
  hash.forEachInRadius(center.x, center.y, detectRadius, (entry) => {
    if (found || entry.id === group.id) return;
    const other = entry.group;
    if (!other.units.some(u => u.hp > 0)) return;
    if (!isHostile(group.archetype, other.archetype)) return;
    if (dist(center.x, center.y, entry.x, entry.y) <= detectRadius) found = other;
  });
  return found;
}

export { findPathMacro, isLandCell, getGroupCentroid };
