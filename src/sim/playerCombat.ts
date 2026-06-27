import type { RNG } from "./rng.js";
import type { WorldState, BarbarianGroup, PlayerSquad } from "./worldState.js";
import type { SimEvent } from "./events.js";
import { getTerrainNavGrid } from "../barbarians/barbarianPathfinding.js";
import {
  grantUnitXp,
  XP_DAMAGE_DEALT,
  xpForBarbKill,
  isPlayerInSpawnGrace,
  ensureUnitProgression,
} from "./unitProgression.js";
import { isUnitInvulnerable } from "./outpostActions.js";
import { awardBarbKillGold, awardGroupDefeatGold } from "./playerEconomy.js";
import {
  COMBAT_BURST_THRESHOLD,
  findNearestBarbTarget,
  findNearestPlayerTarget,
  findFireHoldTargetGroup,
  rollBaseDamage,
  getCooldownMs,
  tickUnitCooldown,
  resolvePlayerDamageOnBarb,
  resolveBarbDamageOnPlayer,
  recordSquadIntensity,
  recordGroupIntensity,
  tickIntensityDecay,
  engagePlayerWithGroup,
} from "./combatResolver.js";

type PveHitPayload = {
  attackerUnitId: string;
  targetUnitId: string;
  damage: number;
  remainingHp: number;
  groupId: string;
};

function flushBarbHits(events: SimEvent[], hitBuffer: PveHitPayload[]): void {
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

function flushPlayerHits(events: SimEvent[], hitBuffer: PveHitPayload[]): void {
  for (const hit of hitBuffer) {
    events.push({ type: "PLAYER_UNIT_HIT", ...hit });
  }
  hitBuffer.length = 0;
}

function isFireHold(squad: PlayerSquad): boolean {
  return squad.unitOrder === "fire_hold" || squad.order === "fire_hold";
}

function resolveCombatGroup(
  state: WorldState,
  squad: PlayerSquad,
  grid: ReturnType<typeof getTerrainNavGrid>,
): { group: BarbarianGroup; enemies: BarbarianGroup["units"] } | null {
  if (squad.attackGroupId) {
    const group = state.barbarianGroups.get(squad.attackGroupId);
    if (!group) {
      squad.attackGroupId = null;
      return null;
    }
    const enemies = group.units.filter(u => u.hp > 0);
    if (!enemies.length) {
      squad.attackGroupId = null;
      return null;
    }
    return { group, enemies };
  }
  if (isFireHold(squad)) {
    return findFireHoldTargetGroup(squad, state, grid);
  }
  return null;
}

function tickSquadVsBarbarians(
  state: WorldState,
  squad: PlayerSquad,
  nowMs: number,
  dtSimMs: number,
  rng: RNG,
  events: SimEvent[],
  barbHitBuffer: PveHitPayload[],
  playerHitBuffer: PveHitPayload[],
): void {
  const allies = squad.units.filter(u => u.hp > 0);
  if (!allies.length) return;
  if (isUnitInvulnerable(squad)) return;

  const grid = getTerrainNavGrid(state.terrain);
  const resolved = resolveCombatGroup(state, squad, grid);
  if (!resolved) return;

  const { group, enemies } = resolved;
  const squadIntensity = squad.combatIntensity ?? 0;

  engagePlayerWithGroup(group, squad.profileId, events);

  for (const u of allies) {
    ensureUnitProgression(u);
    tickUnitCooldown(u, dtSimMs);
    if (u.cooldownMs! > 0) continue;
    const target = findNearestBarbTarget(u, enemies, u.type === "sniper", grid);
    if (!target) continue;
    const raw = rollBaseDamage(rng, u.type);
    const base = resolvePlayerDamageOnBarb(raw, u, target, grid);
    const prevHp = target.hp;
    target.hp = Math.max(0, target.hp - base);
    grantUnitXp(u, base * XP_DAMAGE_DEALT, events, squad.profileId);
    if (prevHp > 0 && target.hp <= 0) {
      grantUnitXp(u, xpForBarbKill(target.type), events, squad.profileId);
      awardBarbKillGold(squad, target.type, rng, events);
    }
    barbHitBuffer.push({
      attackerUnitId: u.id,
      targetUnitId: target.id,
      damage: base,
      remainingHp: target.hp,
      groupId: group.id,
    });
    u.cooldownMs = getCooldownMs(u.type, squadIntensity);
    group.lastCombatMs = nowMs;
    recordSquadIntensity(squad, base, nowMs, events);
    recordGroupIntensity(group, base, nowMs, events);
  }

  for (const bu of enemies) {
    tickUnitCooldown(bu, dtSimMs);
    if (bu.cooldownMs! > 0) continue;
    if (isPlayerInSpawnGrace(squad)) continue;
    const liveAllies = squad.units.filter(u => u.hp > 0);
    const target = findNearestPlayerTarget(bu, liveAllies, bu.type === "sniper", grid);
    if (!target) continue;
    ensureUnitProgression(target);
    const raw = rollBaseDamage(rng, bu.type);
    const base = resolveBarbDamageOnPlayer(raw, bu, target, grid);
    target.hp = Math.max(0, target.hp - base);
    playerHitBuffer.push({
      attackerUnitId: bu.id,
      targetUnitId: target.id,
      damage: base,
      remainingHp: target.hp,
      groupId: group.id,
    });
    const groupIntensity = group.combatIntensity ?? 0;
    bu.cooldownMs = getCooldownMs(bu.type, groupIntensity);
    group.lastCombatMs = nowMs;
    recordSquadIntensity(squad, base, nowMs, events);
    recordGroupIntensity(group, base, nowMs, events);
  }

  const defeatedCount = group.units.length;
  group.units = group.units.filter(u => u.hp > 0);
  if (!group.units.length) {
    awardGroupDefeatGold(squad, { ...group, units: Array.from({ length: defeatedCount }) }, rng, events);
    events.push({
      type: "GROUP_DEFEATED",
      loserGroupId: group.id,
      winnerGroupId: "player",
      survivorCount: allies.length,
      profileId: squad.profileId,
    });
    events.push({ type: "GROUP_DISBANDED", groupId: group.id });
    state.barbarianGroups.delete(group.id);
    squad.attackGroupId = null;
  }
}

function shouldTickSquadCombat(squad: PlayerSquad): boolean {
  return squad.order === "attack"
    || squad.attackGroupId != null
    || isFireHold(squad);
}

export function tickPlayerCombat(
  state: WorldState,
  nowMs: number,
  dtSimMs: number,
  rng: RNG,
): SimEvent[] {
  const events: SimEvent[] = [];
  const barbHitBuffer: PveHitPayload[] = [];
  const playerHitBuffer: PveHitPayload[] = [];

  for (const squad of state.playerSquads.values()) {
    if (squad.wiped || isUnitInvulnerable(squad)) continue;
    if (shouldTickSquadCombat(squad)) {
      tickSquadVsBarbarians(state, squad, nowMs, dtSimMs, rng, events, barbHitBuffer, playerHitBuffer);
    }
    tickIntensityDecay(squad, nowMs, dtSimMs, events);
  }

  flushBarbHits(events, barbHitBuffer);
  flushPlayerHits(events, playerHitBuffer);

  return events;
}
