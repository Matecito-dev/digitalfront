import type { RNG } from "./rng.js";
import { randInt } from "./rng.js";
import type { WorldState, BarbarianGroup, BarbarianUnit, PlayerUnit, PlayerSquad } from "./worldState.js";
import type { SimEvent } from "./events.js";
import {
  hasLineOfSight,
  getEffectiveSniperRange,
  getEffectiveSoldierRange,
  sampleCell,
  highGroundDamageMult,
  flankDamageMult,
  suppressionHitChance,
} from "../tactics/terrainTactics.js";
import { getTerrainNavGrid } from "../barbarians/barbarianPathfinding.js";
import { applyDamageWithArmor } from "./unitProgression.js";
import {
  COMBAT_INTENSITY_MAX,
  INTENSITY_BUILDING_MIN,
  INTENSITY_PEAK_MIN,
  INTENSITY_COOLDOWN_MAX,
  INTENSITY_PER_DAMAGE,
  INTENSITY_DECAY_PER_TICK,
  FRENZY_COOLDOWN_MULT,
} from "./combatConfig.js";

export const SOLDIER_COOLDOWN_MS = 650;
export const SOLDIER_DAMAGE: [number, number] = [6, 11];
export const SNIPER_COOLDOWN_MS = 1100;
export const SNIPER_DAMAGE: [number, number] = [12, 20];
export const COMBAT_BURST_THRESHOLD = 8;

export type UnitCombatType = "soldier" | "sniper";
export type CombatIntensityPhase = "building" | "peak" | "cooldown";

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function getDamageRange(type: UnitCombatType): [number, number] {
  return type === "sniper" ? SNIPER_DAMAGE : SOLDIER_DAMAGE;
}

export function rollBaseDamage(rng: RNG, type: UnitCombatType): number {
  const [lo, hi] = getDamageRange(type);
  return randInt(rng, hi - lo + 1) + lo;
}

export function getCooldownMs(type: UnitCombatType, combatIntensity = 0): number {
  const base = type === "sniper" ? SNIPER_COOLDOWN_MS : SOLDIER_COOLDOWN_MS;
  if (combatIntensity >= INTENSITY_PEAK_MIN) {
    return Math.max(1, Math.round(base * FRENZY_COOLDOWN_MULT));
  }
  return base;
}

export function tickUnitCooldown(unit: { cooldownMs?: number }, dtSimMs: number): void {
  unit.cooldownMs = Math.max(0, (unit.cooldownMs ?? 0) - dtSimMs);
}

export function applyTerrainFlankMods(
  baseDmg: number,
  atkX: number,
  atkY: number,
  tgtX: number,
  tgtY: number,
  grid: ReturnType<typeof getTerrainNavGrid>,
  targetFacingAngle = 0,
): number {
  const atkCell = sampleCell(grid, atkX, atkY);
  const tgtCell = sampleCell(grid, tgtX, tgtY);
  let dmg = baseDmg;
  dmg *= highGroundDamageMult(atkCell.height, tgtCell.height);
  dmg *= flankDamageMult(atkX, atkY, tgtX, tgtY, targetFacingAngle);
  return Math.round(dmg);
}

export function resolveBarbDamageOnPlayer(
  rawDmg: number,
  attacker: BarbarianUnit,
  target: PlayerUnit,
  grid: ReturnType<typeof getTerrainNavGrid>,
): number {
  const mod = applyTerrainFlankMods(
    rawDmg,
    attacker.x, attacker.y,
    target.x, target.y,
    grid,
    target.facingAngle ?? 0,
  );
  return applyDamageWithArmor(mod, target.level ?? 1);
}

export function resolvePlayerDamageOnBarb(
  rawDmg: number,
  attacker: PlayerUnit,
  target: BarbarianUnit,
  grid: ReturnType<typeof getTerrainNavGrid>,
): number {
  return applyTerrainFlankMods(
    rawDmg,
    attacker.x, attacker.y,
    target.x, target.y,
    grid,
    0,
  );
}

export function resolvePvpDamage(
  rawDmg: number,
  attacker: PlayerUnit,
  target: PlayerUnit,
  grid: ReturnType<typeof getTerrainNavGrid>,
  rng: RNG,
): number {
  let dmg = applyTerrainFlankMods(
    rawDmg,
    attacker.x, attacker.y,
    target.x, target.y,
    grid,
    target.facingAngle ?? 0,
  );
  if ((target.suppressionMs ?? 0) > 0) {
    if (rng() > suppressionHitChance(target.suppressionMs ?? 0)) return 0;
  }
  return Math.max(1, Math.round(applyDamageWithArmor(dmg, target.level ?? 1)));
}

export function getIntensityPhase(intensity: number): CombatIntensityPhase {
  if (intensity >= INTENSITY_PEAK_MIN) return "peak";
  if (intensity >= INTENSITY_BUILDING_MIN) return "building";
  return "cooldown";
}

export function bumpCombatIntensity(current: number, damage: number): number {
  const gain = Math.max(1, Math.round(damage * INTENSITY_PER_DAMAGE));
  return Math.min(COMBAT_INTENSITY_MAX, current + gain);
}

export function decayCombatIntensity(current: number, dtSimMs: number): number {
  const ticks = dtSimMs / 50;
  const decay = INTENSITY_DECAY_PER_TICK * ticks;
  return Math.max(0, current - decay);
}

export function recordSquadIntensity(
  squad: PlayerSquad,
  damage: number,
  nowMs: number,
  events: SimEvent[],
): void {
  const prev = squad.combatIntensity ?? 0;
  const prevPhase = getIntensityPhase(prev);
  squad.combatIntensity = bumpCombatIntensity(prev, damage);
  squad.lastHitMs = nowMs;
  const phase = getIntensityPhase(squad.combatIntensity);
  if (squad.combatIntensity !== prev || phase !== prevPhase) {
    events.push({
      type: "COMBAT_INTENSITY",
      profileId: squad.profileId,
      intensity: squad.combatIntensity,
      phase,
    });
  }
}

export function recordGroupIntensity(
  group: BarbarianGroup,
  damage: number,
  nowMs: number,
  events: SimEvent[],
): void {
  const prev = group.combatIntensity ?? 0;
  const prevPhase = getIntensityPhase(prev);
  group.combatIntensity = bumpCombatIntensity(prev, damage);
  group.lastHitMs = nowMs;
  const phase = getIntensityPhase(group.combatIntensity);
  if (group.combatIntensity !== prev || phase !== prevPhase) {
    events.push({
      type: "COMBAT_INTENSITY",
      groupId: group.id,
      intensity: group.combatIntensity,
      phase,
    });
  }
}

export function tickIntensityDecay(
  squad: PlayerSquad,
  nowMs: number,
  dtSimMs: number,
  events: SimEvent[],
): void {
  const current = squad.combatIntensity ?? 0;
  if (current <= 0) return;
  const sinceHit = nowMs - (squad.lastHitMs ?? 0);
  if (sinceHit < 200) return;
  const prevPhase = getIntensityPhase(current);
  squad.combatIntensity = decayCombatIntensity(current, dtSimMs);
  const phase = getIntensityPhase(squad.combatIntensity);
  if (squad.combatIntensity <= INTENSITY_COOLDOWN_MAX && phase === "cooldown") {
    squad.combatIntensity = 0;
  }
  if (squad.combatIntensity !== current) {
    events.push({
      type: "COMBAT_INTENSITY",
      profileId: squad.profileId,
      intensity: squad.combatIntensity,
      phase: getIntensityPhase(squad.combatIntensity),
    });
  } else if (phase !== prevPhase) {
    events.push({
      type: "COMBAT_INTENSITY",
      profileId: squad.profileId,
      intensity: squad.combatIntensity,
      phase,
    });
  }
}

export function tickGroupIntensityDecay(
  group: BarbarianGroup,
  nowMs: number,
  dtSimMs: number,
  events: SimEvent[],
): void {
  const current = group.combatIntensity ?? 0;
  if (current <= 0) return;
  const sinceHit = nowMs - (group.lastHitMs ?? 0);
  if (sinceHit < 200) return;
  const prevPhase = getIntensityPhase(current);
  group.combatIntensity = decayCombatIntensity(current, dtSimMs);
  const phase = getIntensityPhase(group.combatIntensity);
  if (group.combatIntensity <= INTENSITY_COOLDOWN_MAX && phase === "cooldown") {
    group.combatIntensity = 0;
  }
  if (group.combatIntensity !== current || phase !== prevPhase) {
    events.push({
      type: "COMBAT_INTENSITY",
      groupId: group.id,
      intensity: group.combatIntensity,
      phase: getIntensityPhase(group.combatIntensity),
    });
  }
}

export function isGroupResolvedByPlayerCombat(state: WorldState, groupId: string): boolean {
  for (const squad of state.playerSquads.values()) {
    if (squad.attackGroupId === groupId) return true;
  }
  return false;
}

export function engagePlayerWithGroup(
  group: BarbarianGroup,
  profileId: string,
  events: SimEvent[],
): void {
  if (group.engagedPlayerProfileId === profileId) return;
  const prevState = group.state;
  group.engagedPlayerProfileId = profileId;
  if (group.state === "HUNTING") {
    group.state = "ENGAGED";
    events.push({
      type: "GROUP_STATE_CHANGED",
      groupId: group.id,
      from: prevState,
      to: "ENGAGED",
    });
  }
  events.push({
    type: "PLAYER_ENGAGED_GROUP",
    profileId,
    groupId: group.id,
    groupName: group.name,
  });
}

export function findNearestBarbTarget(
  attacker: PlayerUnit,
  enemies: BarbarianUnit[],
  preferSnipers: boolean,
  grid: ReturnType<typeof getTerrainNavGrid>,
): BarbarianUnit | null {
  let best: BarbarianUnit | null = null;
  let bestD = Infinity;
  const snipers = enemies.filter(e => e.hp > 0 && e.type === "sniper");
  const pool = preferSnipers && snipers.length ? snipers : enemies.filter(e => e.hp > 0);
  const lv = attacker.level ?? 1;
  for (const e of pool) {
    const d = dist(attacker.x, attacker.y, e.x, e.y);
    const range = attacker.type === "sniper"
      ? getEffectiveSniperRange(attacker.x, attacker.y, grid, lv)
      : getEffectiveSoldierRange(attacker.x, attacker.y, grid, lv);
    if (d > range) continue;
    if (!hasLineOfSight(grid, attacker.x, attacker.y, e.x, e.y)) continue;
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

export function findNearestPlayerTarget(
  attacker: BarbarianUnit,
  playerUnits: PlayerUnit[],
  preferSnipers: boolean,
  grid: ReturnType<typeof getTerrainNavGrid>,
): PlayerUnit | null {
  let best: PlayerUnit | null = null;
  let bestD = Infinity;
  const snipers = playerUnits.filter(u => u.hp > 0 && u.type === "sniper");
  const pool = preferSnipers && snipers.length ? snipers : playerUnits.filter(u => u.hp > 0);
  for (const p of pool) {
    const d = dist(attacker.x, attacker.y, p.x, p.y);
    const range = attacker.type === "sniper"
      ? getEffectiveSniperRange(attacker.x, attacker.y, grid)
      : getEffectiveSoldierRange(attacker.x, attacker.y, grid);
    if (d > range) continue;
    if (!hasLineOfSight(grid, attacker.x, attacker.y, p.x, p.y)) continue;
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

export function findNearestEnemyPlayerTarget(
  attacker: PlayerUnit,
  enemies: PlayerUnit[],
  preferSnipers: boolean,
  grid: ReturnType<typeof getTerrainNavGrid>,
): PlayerUnit | null {
  let best: PlayerUnit | null = null;
  let bestD = Infinity;
  const snipers = enemies.filter(e => e.hp > 0 && e.type === "sniper");
  const pool = preferSnipers && snipers.length ? snipers : enemies.filter(e => e.hp > 0);
  const lv = attacker.level ?? 1;
  for (const e of pool) {
    const d = dist(attacker.x, attacker.y, e.x, e.y);
    const range = attacker.type === "sniper"
      ? getEffectiveSniperRange(attacker.x, attacker.y, grid, lv)
      : getEffectiveSoldierRange(attacker.x, attacker.y, grid, lv);
    if (d > range) continue;
    if (!hasLineOfSight(grid, attacker.x, attacker.y, e.x, e.y)) continue;
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

/** Nearest barbarian group with at least one unit in firing range of any ally (fire_hold). */
export function findFireHoldTargetGroup(
  squad: PlayerSquad,
  state: WorldState,
  grid: ReturnType<typeof getTerrainNavGrid>,
): { group: BarbarianGroup; enemies: BarbarianUnit[] } | null {
  const allies = squad.units.filter(u => u.hp > 0);
  if (!allies.length) return null;

  let bestGroup: BarbarianGroup | null = null;
  let bestD = Infinity;
  let bestEnemies: BarbarianUnit[] = [];

  for (const group of state.barbarianGroups.values()) {
    const enemies = group.units.filter(u => u.hp > 0);
    if (!enemies.length) continue;
    for (const ally of allies) {
      const target = findNearestBarbTarget(ally, enemies, ally.type === "sniper", grid);
      if (!target) continue;
      const d = dist(ally.x, ally.y, target.x, target.y);
      if (d < bestD) {
        bestD = d;
        bestGroup = group;
        bestEnemies = enemies;
      }
    }
  }

  if (!bestGroup) return null;
  return { group: bestGroup, enemies: bestEnemies };
}
