import type { RNG } from "./rng.js";
import type { WorldState, BarbarianGroup, PlayerUnit, PlayerSquad } from "./worldState.js";
import type { SimEvent } from "./events.js";
import { hasLineOfSight } from "../tactics/terrainTactics.js";
import { getTerrainNavGrid } from "../barbarians/barbarianPathfinding.js";
import { getGroupCentroid } from "../barbarians/barbarianGroupAI.js";
import { squadCentroid, PLAYER_COMBAT_ENGAGE_RADIUS } from "../barbarians/barbarianPlayerAI.js";
import { ensureUnitProgression, isPlayerInSpawnGrace } from "./unitProgression.js";
import { isInAnyOutpostSafeZone } from "./outpostCamp.js";
import { isUnitInvulnerable } from "./outpostActions.js";
import {
  COMBAT_BURST_THRESHOLD,
  dist,
  findNearestPlayerTarget,
  rollBaseDamage,
  getCooldownMs,
  tickUnitCooldown,
  resolveBarbDamageOnPlayer,
  recordSquadIntensity,
  recordGroupIntensity,
  isGroupResolvedByPlayerCombat,
  engagePlayerWithGroup,
  tickGroupIntensityDecay,
} from "./combatResolver.js";

const PLAYER_COMBAT_STATES = new Set<BarbarianGroup["state"]>(["HUNTING", "ENGAGED"]);

type PlayerHitPayload = {
  attackerUnitId: string;
  targetUnitId: string;
  damage: number;
  remainingHp: number;
  groupId: string;
};

function flushPlayerHits(events: SimEvent[], hitBuffer: PlayerHitPayload[]): void {
  if (hitBuffer.length === 0) return;
  if (hitBuffer.length > COMBAT_BURST_THRESHOLD) {
    events.push({ type: "COMBAT_BURST", hits: [...hitBuffer] });
  } else {
    for (const hit of hitBuffer) {
      events.push({ type: "PLAYER_UNIT_HIT", ...hit });
    }
  }
  hitBuffer.length = 0;
}

function groupInPlayerCombatRange(
  state: WorldState,
  group: BarbarianGroup,
): { squadProfileId: string; playerUnits: PlayerUnit[]; squad: PlayerSquad } | null {
  const center = getGroupCentroid(group.units);
  const grid = getTerrainNavGrid(state.terrain);

  if (group.state === "HUNTING" && group.huntProfileId) {
    const squad = state.playerSquads.get(group.huntProfileId);
    const target = squad ? squadCentroid(squad) : null;
    const allies = squad?.units.filter(u => u.hp > 0) ?? [];
    if (target && allies.length && squad) {
      const d = dist(center.x, center.y, target.x, target.y);
      if (d <= PLAYER_COMBAT_ENGAGE_RADIUS) {
        return { squadProfileId: group.huntProfileId, playerUnits: allies, squad };
      }
    }
  }

  for (const [profileId, squad] of state.playerSquads) {
    if (squad.wiped || isUnitInvulnerable(squad)) continue;
    const target = squadCentroid(squad);
    const allies = squad.units.filter(u => u.hp > 0);
    if (!target || !allies.length) continue;
    const d = dist(center.x, center.y, target.x, target.y);
    if (d > PLAYER_COMBAT_ENGAGE_RADIUS) continue;
    if (isInAnyOutpostSafeZone(state, target.x, target.y)) continue;
    if (!hasLineOfSight(grid, center.x, center.y, target.x, target.y)) continue;
    return { squadProfileId: profileId, playerUnits: allies, squad };
  }
  return null;
}

function tickGroupVsPlayer(
  state: WorldState,
  group: BarbarianGroup,
  nowMs: number,
  dtSimMs: number,
  rng: RNG,
  events: SimEvent[],
  playerHitBuffer: PlayerHitPayload[],
): void {
  const contact = groupInPlayerCombatRange(state, group);
  if (!contact) return;

  const enemies = group.units.filter(u => u.hp > 0);
  if (!enemies.length) return;

  engagePlayerWithGroup(group, contact.squadProfileId, events);

  const grid = getTerrainNavGrid(state.terrain);
  const groupIntensity = group.combatIntensity ?? 0;

  for (const bu of enemies) {
    tickUnitCooldown(bu, dtSimMs);
    if (bu.cooldownMs! > 0) continue;
    if (isPlayerInSpawnGrace(contact.squad)) continue;
    if (isUnitInvulnerable(contact.squad)) continue;
    const liveAllies = contact.playerUnits.filter(u => u.hp > 0);
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
    bu.cooldownMs = getCooldownMs(bu.type, groupIntensity);
    group.lastCombatMs = nowMs;
    recordSquadIntensity(contact.squad, base, nowMs, events);
    recordGroupIntensity(group, base, nowMs, events);
  }
}

export function tickBarbarianVsPlayer(
  state: WorldState,
  nowMs: number,
  dtSimMs: number,
  rng: RNG,
): SimEvent[] {
  const events: SimEvent[] = [];
  const playerHitBuffer: PlayerHitPayload[] = [];

  for (const group of state.barbarianGroups.values()) {
    if (!PLAYER_COMBAT_STATES.has(group.state)) continue;
    if (isGroupResolvedByPlayerCombat(state, group.id)) continue;
    tickGroupVsPlayer(state, group, nowMs, dtSimMs, rng, events, playerHitBuffer);
    tickGroupIntensityDecay(group, nowMs, dtSimMs, events);
  }

  flushPlayerHits(events, playerHitBuffer);
  return events;
}
