import type { RNG } from "../sim/rng.js";
import { randInt } from "../sim/rng.js";
import type { WorldState, BarbarianArchetype, BarbarianGroup, BarbarianUnit } from "../sim/worldState.js";
import type { SimEvent } from "../sim/events.js";
import { getGroupCentroid, groupHpRatio, resetGroupTravelState } from "./barbarianGroupAI.js";
import { rotateGroupFormation, syncUnitPositionsFromFormation } from "./barbarianPathfinding.js";
import { getTerrainNavGrid } from "./barbarianPathfinding.js";
import { buildGroupSpatialHash } from "./groupSpatialHash.js";
import {
  hasLineOfSight,
  getEffectiveSniperRange,
  getEffectiveSoldierRange,
  SNIPER_RANGE_BASE,
} from "../tactics/terrainTactics.js";

export const RIVAL_OF: Record<BarbarianArchetype, BarbarianArchetype[]> = {
  RAIDERS:   ["MARAUDERS", "NOMADS"],
  MARAUDERS: ["RAIDERS", "WARHOST"],
  WARHOST:   ["MARAUDERS"],
  HUNTERS:   [],
  NOMADS:    ["RAIDERS"],
};

const DETECT_RADIUS = 18;
const COMBAT_RADIUS = 12;
const MAX_ACTIVE_COMBATS = 3;
const DISENGAGE_MS = 30_000;
const RETREAT_HP_RATIO = 0.25;

const SNIPER_RANGE = SNIPER_RANGE_BASE;
const SOLDIER_COOLDOWN_MS = 650;
const SOLDIER_DAMAGE: [number, number] = [6, 11];

const SNIPER_COOLDOWN_MS = 1100;
const SNIPER_DAMAGE: [number, number] = [12, 20];
const COMBAT_BURST_THRESHOLD = 8;
const AMBUSH_DETECT_RADIUS = 25;

type BarbHitPayload = {
  attackerUnitId: string;
  targetUnitId: string;
  damage: number;
  remainingHp: number;
  groupId: string;
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function areHostile(a: BarbarianArchetype, b: BarbarianArchetype): boolean {
  return RIVAL_OF[a].includes(b);
}

function groupDistance(a: BarbarianGroup, b: BarbarianGroup): number {
  const ac = getGroupCentroid(a.units);
  const bc = getGroupCentroid(b.units);
  return dist(ac.x, ac.y, bc.x, bc.y);
}

function findNearestEnemy(
  unit: BarbarianUnit,
  enemies: BarbarianUnit[],
  maxRange: number,
  preferSnipers: boolean,
  grid: ReturnType<typeof getTerrainNavGrid>,
  useLos: boolean,
): BarbarianUnit | null {
  let best: BarbarianUnit | null = null;
  let bestD = Infinity;
  const snipers = enemies.filter(e => e.hp > 0 && e.type === "sniper");
  const pool = preferSnipers && snipers.length ? snipers : enemies.filter(e => e.hp > 0);
  for (const e of pool) {
    const d = dist(unit.x, unit.y, e.x, e.y);
    const range = unit.type === "sniper"
      ? getEffectiveSniperRange(unit.x, unit.y, grid)
      : maxRange;
    if (d > range) continue;
    if (useLos && !hasLineOfSight(grid, unit.x, unit.y, e.x, e.y)) continue;
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

function damageMultiplier(attacker: BarbarianGroup, defender: BarbarianGroup): number {
  let m = 1;
  if (attacker.state === "RETURNING") m *= 0.8;
  if (defender.archetype === "WARHOST") m *= 1.15;
  if (attacker.archetype === "HUNTERS") m *= 1.1;
  return m;
}

function applyDamage(
  attacker: BarbarianUnit,
  target: BarbarianUnit,
  dmg: number,
  hitBuffer: BarbHitPayload[],
  attackerGroupId: string,
): void {
  target.hp = Math.max(0, target.hp - dmg);
  hitBuffer.push({
    attackerUnitId: attacker.id,
    targetUnitId: target.id,
    damage: dmg,
    remainingHp: target.hp,
    groupId: attackerGroupId,
  });
}

function flushHitEvents(events: SimEvent[], hitBuffer: BarbHitPayload[]): void {
  if (hitBuffer.length === 0) return;
  if (hitBuffer.length > COMBAT_BURST_THRESHOLD) {
    events.push({ type: "COMBAT_BURST", hits: [...hitBuffer] });
  } else {
    for (const hit of hitBuffer) {
      events.push({ type: "BARB_UNIT_HIT", ...hit });
    }
  }
  hitBuffer.length = 0;
}

function removeDeadUnits(group: BarbarianGroup, events: SimEvent[], killerUnitId?: string): void {
  const dead = group.units.filter(u => u.hp <= 0);
  for (const u of dead) {
    events.push({
      type: "BARB_UNIT_KILLED",
      unitId: u.id,
      name: u.name,
      groupId: group.id,
      killerUnitId,
    });
  }
  group.units = group.units.filter(u => u.hp > 0);
}

function engageGroups(a: BarbarianGroup, b: BarbarianGroup, nowMs: number, events: SimEvent[]): void {
  a.state = "ENGAGED";
  b.state = "ENGAGED";
  a.engageTargetId = b.id;
  b.engageTargetId = a.id;
  a.lastCombatMs = nowMs;
  b.lastCombatMs = nowMs;
  const ac = getGroupCentroid(a.units);
  const bc = getGroupCentroid(b.units);
  rotateGroupFormation(a, bc.x, bc.y);
  rotateGroupFormation(b, ac.x, ac.y);
  syncUnitPositionsFromFormation(a);
  syncUnitPositionsFromFormation(b);
  resetGroupTravelState(a);
  resetGroupTravelState(b);
  events.push({ type: "GROUP_ENGAGED", groupAId: a.id, groupBId: b.id, nameA: a.name, nameB: b.name });
}

function disengageGroup(group: BarbarianGroup, nowMs: number, events: SimEvent[]): void {
  const prev = group.state;
  group.engageTargetId = undefined;
  group.lastCombatMs = nowMs;
  resetGroupTravelState(group);
  if (groupHpRatio(group) < RETREAT_HP_RATIO) {
    group.state = "RETURNING";
    group.tx = group.anchorX;
    group.ty = group.anchorY;
    group.path = [];
    group.pathIdx = 0;
  } else {
    group.state = "RESTING";
    group.stateUntilMs = nowMs + 6000;
  }
  if (prev === "ENGAGED") {
    events.push({ type: "GROUP_STATE_CHANGED", groupId: group.id, from: "ENGAGED", to: group.state });
  }
}

export function tickBarbarianGroupCombat(
  state: WorldState,
  nowMs: number,
  _dtSimMs: number,
  rng: RNG,
): SimEvent[] {
  const events: SimEvent[] = [];
  const hitBuffer: BarbHitPayload[] = [];
  const groups = [...state.barbarianGroups.values()].filter(g => g.units.some(u => u.hp > 0));
  const grid = getTerrainNavGrid(state.terrain);
  const spatial = buildGroupSpatialHash(groups);

  // Pair hostile groups in combat range
  let combatsStarted = 0;
  const paired = new Set<string>();
  for (const a of groups) {
    if (combatsStarted >= MAX_ACTIVE_COMBATS) break;
    if (a.state === "ENGAGED") continue;
    const ac = getGroupCentroid(a.units);
    spatial.forEachInRadius(ac.x, ac.y, COMBAT_RADIUS, (entry) => {
      if (combatsStarted >= MAX_ACTIVE_COMBATS) return;
      const b = entry.group;
      if (b.id === a.id) return;
      const pairKey = [a.id, b.id].sort().join(":");
      if (paired.has(pairKey)) return;
      if (b.state === "ENGAGED") return;
      if (!areHostile(a.archetype, b.archetype)) return;
      if (groupDistance(a, b) > COMBAT_RADIUS) return;
      if (a.archetype === "HUNTERS" || b.archetype === "HUNTERS") return;
      paired.add(pairKey);
      engageGroups(a, b, nowMs, events);
      combatsStarted++;
    });
  }

  // Disengage after timeout without contact
  for (const group of groups) {
    if (group.state !== "ENGAGED" || !group.engageTargetId) continue;
    const enemy = state.barbarianGroups.get(group.engageTargetId);
    if (!enemy || !enemy.units.some(u => u.hp > 0)) {
      disengageGroup(group, nowMs, events);
      continue;
    }
    if (groupDistance(group, enemy) > COMBAT_RADIUS) {
      if ((group.lastCombatMs ?? 0) + DISENGAGE_MS < nowMs) {
        disengageGroup(group, nowMs, events);
        if (enemy.engageTargetId === group.id) disengageGroup(enemy, nowMs, events);
      }
    }
  }

  // Combat damage per engaged pair
  const processed = new Set<string>();
  for (const group of groups) {
    if (group.state !== "ENGAGED" || !group.engageTargetId) continue;
    const pairKey = [group.id, group.engageTargetId].sort().join(":");
    if (processed.has(pairKey)) continue;
    processed.add(pairKey);

    const enemy = state.barbarianGroups.get(group.engageTargetId);
    if (!enemy) continue;

    const enemyUnits = enemy.units.filter(u => u.hp > 0);
    const allyUnits = group.units.filter(u => u.hp > 0);
    if (!enemyUnits.length || !allyUnits.length) continue;

    for (const unit of allyUnits) {
      unit.cooldownMs = Math.max(0, (unit.cooldownMs ?? 0) - _dtSimMs);
      if (unit.cooldownMs > 0) continue;

      if (unit.type === "soldier") {
        const rifleRange = getEffectiveSoldierRange(unit.x, unit.y, grid);
        const target = findNearestEnemy(unit, enemyUnits, rifleRange, false, grid, true);
        if (!target) continue;
        const base = randInt(rng, SOLDIER_DAMAGE[1] - SOLDIER_DAMAGE[0] + 1) + SOLDIER_DAMAGE[0];
        const dmg = Math.round(base * damageMultiplier(group, enemy));
        applyDamage(unit, target, dmg, hitBuffer, group.id);
        unit.cooldownMs = SOLDIER_COOLDOWN_MS;
        if (target.hp <= 0) removeDeadUnits(enemy, events, unit.id);
      } else {
        const target = findNearestEnemy(unit, enemyUnits, SNIPER_RANGE, true, grid, true);
        if (!target) continue;
        const base = randInt(rng, SNIPER_DAMAGE[1] - SNIPER_DAMAGE[0] + 1) + SNIPER_DAMAGE[0];
        const dmg = Math.round(base * damageMultiplier(group, enemy));
        applyDamage(unit, target, dmg, hitBuffer, group.id);
        unit.cooldownMs = SNIPER_COOLDOWN_MS;
        if (target.hp <= 0) removeDeadUnits(enemy, events, unit.id);
      }
      group.lastCombatMs = nowMs;
      enemy.lastCombatMs = nowMs;
      if (enemy.state === "RESTING") enemy.state = "ENGAGED";
    }

    // Mirror combat from enemy side
    for (const unit of enemyUnits.filter(u => u.hp > 0)) {
      unit.cooldownMs = Math.max(0, (unit.cooldownMs ?? 0) - _dtSimMs);
      if (unit.cooldownMs > 0) continue;
      const liveAllies = group.units.filter(u => u.hp > 0);

      if (unit.type === "soldier") {
        const rifleRange = getEffectiveSoldierRange(unit.x, unit.y, grid);
        const target = findNearestEnemy(unit, liveAllies, rifleRange, false, grid, true);
        if (!target) continue;
        const base = randInt(rng, SOLDIER_DAMAGE[1] - SOLDIER_DAMAGE[0] + 1) + SOLDIER_DAMAGE[0];
        const dmg = Math.round(base * damageMultiplier(enemy, group));
        applyDamage(unit, target, dmg, hitBuffer, enemy.id);
        unit.cooldownMs = SOLDIER_COOLDOWN_MS;
        if (target.hp <= 0) removeDeadUnits(group, events, unit.id);
      } else {
        const target = findNearestEnemy(unit, liveAllies, SNIPER_RANGE, true, grid, true);
        if (!target) continue;
        const base = randInt(rng, SNIPER_DAMAGE[1] - SNIPER_DAMAGE[0] + 1) + SNIPER_DAMAGE[0];
        const dmg = Math.round(base * damageMultiplier(enemy, group));
        applyDamage(unit, target, dmg, hitBuffer, enemy.id);
        unit.cooldownMs = SNIPER_COOLDOWN_MS;
        if (target.hp <= 0) removeDeadUnits(group, events, unit.id);
      }
      group.lastCombatMs = nowMs;
      enemy.lastCombatMs = nowMs;
    }

    // Check defeat / retreat
    for (const g of [group, enemy]) {
      if (!g.units.some(u => u.hp > 0)) {
        const winner = g.id === group.id ? enemy : group;
        const loser = g;
        events.push({
          type: "GROUP_DEFEATED",
          loserGroupId: loser.id,
          winnerGroupId: winner.id,
          survivorCount: winner.units.filter(u => u.hp > 0).length,
        });
        events.push({ type: "GROUP_DISBANDED", groupId: loser.id });
        state.barbarianGroups.delete(loser.id);
        if (winner.engageTargetId === loser.id) {
          winner.engageTargetId = undefined;
          resetGroupTravelState(winner);
          winner.state = "RESTING";
          winner.stateUntilMs = nowMs + 8000;
          events.push({ type: "GROUP_STATE_CHANGED", groupId: winner.id, from: "ENGAGED", to: "RESTING" });
        }
      } else if (groupHpRatio(g) < RETREAT_HP_RATIO && g.state === "ENGAGED") {
        g.state = "RETURNING";
        g.engageTargetId = undefined;
        g.tx = g.anchorX;
        g.ty = g.anchorY;
        g.path = [];
        g.pathIdx = 0;
        events.push({ type: "GROUP_STATE_CHANGED", groupId: g.id, from: "ENGAGED", to: "RETURNING" });
      }
    }
  }

  // Ambush detection: aggressive archetypes spot rivals
  for (const group of groups) {
    if (group.state === "ENGAGED" || group.state === "RETURNING") continue;
    const aggressive = ["RAIDERS", "MARAUDERS"].includes(group.archetype);
    if (!aggressive) continue;
    const center = getGroupCentroid(group.units);
    spatial.forEachInRadius(center.x, center.y, AMBUSH_DETECT_RADIUS, (entry) => {
      const other = entry.group;
      if (other.id === group.id) return;
      if (!areHostile(group.archetype, other.archetype)) return;
      if (dist(center.x, center.y, entry.x, entry.y) > AMBUSH_DETECT_RADIUS) return;
      if (groupDistance(group, other) <= COMBAT_RADIUS) {
        engageGroups(group, other, nowMs, events);
      }
    });
  }

  flushHitEvents(events, hitBuffer);

  return events;
}

export { DETECT_RADIUS, COMBAT_RADIUS };
