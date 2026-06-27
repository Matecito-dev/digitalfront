import type { RNG } from "./rng.js";
import type { WorldState, PlayerSquad } from "./worldState.js";
import type { SimEvent } from "./events.js";
import {
  hasLineOfSight,
  getEffectiveSniperRange,
  getEffectiveSoldierRange,
  SUPPRESSION_DURATION_MS,
} from "../tactics/terrainTactics.js";
import { getTerrainNavGrid } from "../barbarians/barbarianPathfinding.js";
import { getPlayerCentroid, isSquadAlive } from "./playerSquad.js";
import {
  ensureUnitProgression,
  grantUnitXp,
  XP_DAMAGE_DEALT,
  XP_PVP_KILL,
} from "./unitProgression.js";
import { isInAnyOutpostSafeZone } from "./outpostCamp.js";
import { isUnitInvulnerable } from "./outpostActions.js";
import { transferPvpGold } from "./playerEconomy.js";
import {
  COMBAT_BURST_THRESHOLD,
  dist,
  findNearestEnemyPlayerTarget,
  rollBaseDamage,
  getCooldownMs,
  tickUnitCooldown,
  resolvePvpDamage,
  recordSquadIntensity,
} from "./combatResolver.js";

export const PVP_SAFE_ZONE_RADIUS = 15;
export const PVP_GRACE_PERIOD_MS = 60_000;
export const PVP_RETREAT_RANGE_MULT = 2;
export const PVP_RETREAT_DURATION_MS = 5000;
export const PVP_RESPAWN_COOLDOWN_MS = 30_000;
export const PVP_MAX_COMBAT_RANGE = 12;

type PvpHitPayload = {
  attackerUnitId: string;
  targetUnitId: string;
  attackerProfileId: string;
  targetProfileId: string;
  damage: number;
  remainingHp: number;
};

export function isInPvpSafeZone(squad: PlayerSquad, x: number, y: number, state?: WorldState): boolean {
  if (state && isInAnyOutpostSafeZone(state, x, y)) return true;
  return dist(x, y, squad.spawnX, squad.spawnY) <= PVP_SAFE_ZONE_RADIUS;
}

export function canInitiatePvp(
  attacker: PlayerSquad,
  defender: PlayerSquad,
  nowWallMs: number,
  nowSimMs = 0,
  state?: WorldState,
): string | null {
  if (!isSquadAlive(attacker) || !isSquadAlive(defender)) return "target_dead";
  if (attacker.profileId === defender.profileId) return "self";
  if (attacker.attackProfileId && attacker.attackProfileId !== defender.profileId) {
    return "already_in_combat";
  }
  if (defender.attackProfileId && defender.attackProfileId !== attacker.profileId) {
    return "target_busy";
  }
  if (nowWallMs - attacker.sessionJoinedAtMs < PVP_GRACE_PERIOD_MS) return "attacker_grace";
  if (nowWallMs - defender.sessionJoinedAtMs < PVP_GRACE_PERIOD_MS) return "defender_grace";
  if (nowSimMs > 0 && attacker.pvpCooldownUntilMs > nowSimMs) return "attacker_cooldown";

  const ac = getPlayerCentroid(attacker.units);
  const dc = getPlayerCentroid(defender.units);
  if (isInPvpSafeZone(attacker, ac.x, ac.y, state)) return "attacker_safe_zone";
  if (isInPvpSafeZone(defender, dc.x, dc.y, state)) return "defender_safe_zone";

  return null;
}

function flushPvpHits(events: SimEvent[], hitBuffer: PvpHitPayload[]): void {
  if (hitBuffer.length === 0) return;
  if (hitBuffer.length > COMBAT_BURST_THRESHOLD) {
    events.push({ type: "PVP_COMBAT_BURST", hits: [...hitBuffer] });
  } else {
    for (const hit of hitBuffer) {
      events.push({ type: "PVP_UNIT_HIT", ...hit });
    }
  }
  hitBuffer.length = 0;
}

function squadCombatCentroidDist(a: PlayerSquad, b: PlayerSquad): number {
  const ac = getPlayerCentroid(a.units.filter(u => u.hp > 0));
  const bc = getPlayerCentroid(b.units.filter(u => u.hp > 0));
  return dist(ac.x, ac.y, bc.x, bc.y);
}

function tickSquadVsSquad(
  state: WorldState,
  squad: PlayerSquad,
  nowMs: number,
  dtSimMs: number,
  rng: RNG,
  events: SimEvent[],
  hitBuffer: PvpHitPayload[],
): void {
  if (!squad.attackProfileId) return;
  if (squad.wiped || isUnitInvulnerable(squad)) return;
  const enemy = state.playerSquads.get(squad.attackProfileId);
  if (!enemy || !isSquadAlive(enemy)) {
    squad.attackProfileId = null;
    squad.pvpRetreatSinceMs = null;
    return;
  }

  const ac = getPlayerCentroid(squad.units.filter(u => u.hp > 0));
  const bc = getPlayerCentroid(enemy.units.filter(u => u.hp > 0));
  if (isInPvpSafeZone(squad, ac.x, ac.y, state) || isInPvpSafeZone(enemy, bc.x, bc.y, state)) {
    squad.attackProfileId = null;
    enemy.attackProfileId = null;
    squad.pvpRetreatSinceMs = null;
    enemy.pvpRetreatSinceMs = null;
    return;
  }

  const centroidDist = squadCombatCentroidDist(squad, enemy);
  const maxRange = PVP_MAX_COMBAT_RANGE * PVP_RETREAT_RANGE_MULT;
  if (centroidDist > maxRange) {
    if (squad.pvpRetreatSinceMs == null) squad.pvpRetreatSinceMs = nowMs;
    else if (nowMs - squad.pvpRetreatSinceMs >= PVP_RETREAT_DURATION_MS) {
      squad.attackProfileId = null;
      enemy.attackProfileId = null;
      squad.pvpRetreatSinceMs = null;
      enemy.pvpRetreatSinceMs = null;
      events.push({
        type: "PVP_COMBAT_END",
        reason: "retreat",
        attackerProfileId: squad.profileId,
        defenderProfileId: enemy.profileId,
      });
    }
    return;
  }
  squad.pvpRetreatSinceMs = null;

  const allies = squad.units.filter(u => u.hp > 0);
  const enemies = enemy.units.filter(u => u.hp > 0);
  if (!allies.length || !enemies.length) return;

  const grid = getTerrainNavGrid(state.terrain);
  const squadIntensity = squad.combatIntensity ?? 0;

  for (const u of allies) {
    ensureUnitProgression(u);
    tickUnitCooldown(u, dtSimMs);
    if (u.cooldownMs! > 0) continue;
    const target = findNearestEnemyPlayerTarget(u, enemies, u.type === "sniper", grid);
    if (!target) continue;
    ensureUnitProgression(target);
    const raw = rollBaseDamage(rng, u.type);
    const dmg = resolvePvpDamage(raw, u, target, grid, rng);
    if (dmg <= 0) continue;
    const prevHp = target.hp;
    target.hp = Math.max(0, target.hp - dmg);
    grantUnitXp(u, dmg * XP_DAMAGE_DEALT, events, squad.profileId);
    if (prevHp > 0 && target.hp <= 0) {
      grantUnitXp(u, XP_PVP_KILL, events, squad.profileId);
    }
    target.suppressionMs = SUPPRESSION_DURATION_MS;
    hitBuffer.push({
      attackerUnitId: u.id,
      targetUnitId: target.id,
      attackerProfileId: squad.profileId,
      targetProfileId: enemy.profileId,
      damage: dmg,
      remainingHp: target.hp,
    });
    u.cooldownMs = getCooldownMs(u.type, squadIntensity);
    recordSquadIntensity(squad, dmg, nowMs, events);
    recordSquadIntensity(enemy, dmg, nowMs, events);
  }

  if (!isSquadAlive(enemy)) {
    squad.attackProfileId = null;
    enemy.attackProfileId = null;
    enemy.pvpCooldownUntilMs = nowMs + PVP_RESPAWN_COOLDOWN_MS;
    transferPvpGold(squad, enemy, rng, events);
    events.push({
      type: "PVP_COMBAT_END",
      reason: "elimination",
      winnerProfileId: squad.profileId,
      loserProfileId: enemy.profileId,
    });
  } else if (!isSquadAlive(squad)) {
    squad.attackProfileId = null;
    enemy.attackProfileId = null;
    squad.pvpCooldownUntilMs = nowMs + PVP_RESPAWN_COOLDOWN_MS;
    transferPvpGold(enemy, squad, rng, events);
    events.push({
      type: "PVP_COMBAT_END",
      reason: "elimination",
      winnerProfileId: enemy.profileId,
      loserProfileId: squad.profileId,
    });
  }
}

export function tickPlayerVsPlayer(
  state: WorldState,
  nowMs: number,
  dtSimMs: number,
  rng: RNG,
): SimEvent[] {
  const events: SimEvent[] = [];
  const hitBuffer: PvpHitPayload[] = [];
  const processed = new Set<string>();

  for (const squad of state.playerSquads.values()) {
    if (!squad.attackProfileId || processed.has(squad.profileId)) continue;
    if (squad.wiped) continue;
    const pairKey = [squad.profileId, squad.attackProfileId].sort().join(":");
    if (processed.has(pairKey)) continue;
    processed.add(squad.profileId);
    processed.add(squad.attackProfileId);

    tickSquadVsSquad(state, squad, nowMs, dtSimMs, rng, events, hitBuffer);

    const enemy = state.playerSquads.get(squad.attackProfileId);
    if (enemy?.attackProfileId === squad.profileId) {
      tickSquadVsSquad(state, enemy, nowMs, dtSimMs, rng, events, hitBuffer);
    }
  }

  flushPvpHits(events, hitBuffer);
  return events;
}

export function getSquadInCombatWith(squad: PlayerSquad): string | null {
  return squad.attackProfileId;
}
