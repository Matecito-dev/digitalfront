// In-memory combat resolver. Bridges 3-unit barbarian armies and 8-unit bot records.
// Delegates actual damage math to economy/battles.ts (HP pools, armor, walls).

import type { UnitType } from "../shared/economy.js";
import { resolveBattle, calculateLoot } from "../economy/battles.js";
import type { WorldState, City, BarbarianCamp, CityUnit } from "./worldState.js";
import type { SimEvent } from "./events.js";

// ── Unit shims ────────────────────────────────────────────────────────────────

export function barbArmyToUnits(army: { infantry: number; cavalry: number; archers: number }): Record<UnitType, number> {
  return {
    WARRIOR:     army.infantry,
    PIKEMAN:     0,
    SPY:         0,
    CAVALRY:     army.cavalry,
    SIEGE:       0,
    CATAPULT:    0,
    ARCHER:      army.archers,
    CROSSBOWMAN: 0,
  };
}

export function cityUnitsToRecord(units: CityUnit[]): Record<UnitType, number> {
  const r: Record<UnitType, number> = {
    WARRIOR:0, PIKEMAN:0, SPY:0, CAVALRY:0, SIEGE:0, CATAPULT:0, ARCHER:0, CROSSBOWMAN:0,
  };
  for (const u of units) {
    if (u.type in r) (r as any)[u.type] = u.count;
  }
  return r;
}

function wallLevel(city: City): number {
  return city.buildings.find(b => b.type === "WALL")?.level ?? 0;
}

function towerLevel(city: City): number {
  return city.buildings.find(b => b.type === "TOWER")?.level ?? 0;
}

function totalUnits(units: Record<UnitType, number>): number {
  return Object.values(units).reduce((s, n) => s + n, 0);
}

// ── City vs City ──────────────────────────────────────────────────────────────

export function resolveCityAttack(
  state: WorldState,
  attacker: City,
  defender: City,
  attackerUnits: Record<UnitType, number>,
  nowMs: number,
): SimEvent[] {
  const events: SimEvent[] = [];
  const defUnits = cityUnitsToRecord(defender.units);

  const result = resolveBattle(
    attackerUnits, defUnits,
    wallLevel(defender), towerLevel(defender),
    undefined, undefined, 1,
  );

  const outcome: "WIN" | "LOSS" = result.victory ? "WIN" : "LOSS";

  // Apply losses to attacker
  for (const u of attacker.units) {
    const lost = (result.attackerLosses as any)[u.type] ?? 0;
    u.count = Math.max(0, u.count - lost);
  }

  if (result.victory) {
    // Apply losses to defender
    for (const u of defender.units) {
      const lost = (result.defenderLosses as any)[u.type] ?? 0;
      u.count = Math.max(0, u.count - lost);
    }
    // Loot
    const loot = calculateLoot(result.attackerSurvivors, {
      gold: defender.gold, wood: defender.wood, stone: defender.stone, food: defender.food, gems: 0,
    });
    attacker.gold  += loot.gold  ?? 0;
    attacker.wood  += loot.wood  ?? 0;
    attacker.stone += loot.stone ?? 0;
    attacker.food  += loot.food  ?? 0;
    defender.gold  -= Math.min(defender.gold,  loot.gold  ?? 0);
    defender.wood  -= Math.min(defender.wood,  loot.wood  ?? 0);
    defender.stone -= Math.min(defender.stone, loot.stone ?? 0);
    defender.food  -= Math.min(defender.food,  loot.food  ?? 0);
  }

  attacker.lastAttackAt   = nowMs;
  defender.lastAttackedAt = nowMs;

  events.push({
    type: "CITY_ATTACKED",
    attackerId: attacker.id, defenderId: defender.id,
    attackerName: attacker.name, defenderName: defender.name,
    outcome,
  });
  events.push({
    type: "ATTACK_RESOLVED",
    attackerId: attacker.id, defenderId: defender.id,
    attackerKind: "CITY", defenderKind: "CITY",
    attackerName: attacker.name, defenderName: defender.name,
    outcome, x: defender.x, y: defender.y,
  });

  return events;
}

// ── Barbarian Camp vs City ────────────────────────────────────────────────────

export function resolveBarbAttack(
  state: WorldState,
  camp: BarbarianCamp,
  defender: City,
  nowMs: number,
): SimEvent[] {
  const events: SimEvent[] = [];
  const atkUnits = barbArmyToUnits(camp.army);
  const defUnits = cityUnitsToRecord(defender.units);

  const result = resolveBattle(
    atkUnits, defUnits,
    wallLevel(defender), towerLevel(defender),
    undefined, undefined, 1,
  );

  const outcome: "WIN" | "LOSS" = result.victory ? "WIN" : "LOSS";

  // Reduce barbarian army
  camp.army.infantry = Math.max(0, camp.army.infantry - (result.attackerLosses.WARRIOR ?? 0));
  camp.army.cavalry  = Math.max(0, camp.army.cavalry  - (result.attackerLosses.CAVALRY ?? 0));
  camp.army.archers  = Math.max(0, camp.army.archers  - (result.attackerLosses.ARCHER  ?? 0));

  if (result.victory) {
    for (const u of defender.units) {
      const lost = (result.defenderLosses as any)[u.type] ?? 0;
      u.count = Math.max(0, u.count - lost);
    }
    const loot = calculateLoot(result.attackerSurvivors, {
      gold: defender.gold, wood: defender.wood, stone: defender.stone, food: defender.food, gems: 0,
    });
    defender.gold  -= Math.min(defender.gold,  loot.gold  ?? 0);
    defender.wood  -= Math.min(defender.wood,  loot.wood  ?? 0);
    defender.stone -= Math.min(defender.stone, loot.stone ?? 0);
    defender.food  -= Math.min(defender.food,  loot.food  ?? 0);
  }

  // If barbarian army wiped out, remove camp
  if (camp.army.infantry + camp.army.cavalry + camp.army.archers <= 0) {
    state.camps.delete(camp.id);
    events.push({ type: "CAMP_DEFEATED", campId: camp.id, name: camp.name, byId: defender.id });
  }

  camp.lastAttackAt   = nowMs;
  defender.lastAttackedAt = nowMs;

  events.push({
    type: "BARB_ATTACKS_CITY",
    campId: camp.id, cityId: defender.id,
    campName: camp.name, cityName: defender.name,
    outcome,
  });
  events.push({
    type: "ATTACK_RESOLVED",
    attackerId: camp.id, defenderId: defender.id,
    attackerKind: "CAMP", defenderKind: "CITY",
    attackerName: camp.name, defenderName: defender.name,
    outcome, x: defender.x, y: defender.y,
  });

  return events;
}
