// @ts-nocheck
import type { UnitType, Resources, TechBonuses } from "../shared/economy.js";
import { getUnitStats } from "./units.js";
import { getWallBonusMultiplier, getTowerDamagePerRound } from "./techs.js";
import { BATTLE_CONFIG } from "./battleConfigData.js";

export interface BattleResult {
  victory: boolean;
  attackerLosses: Record<UnitType, number>;
  defenderLosses: Record<UnitType, number>;
  attackerSurvivors: Record<UnitType, number>;
  loot: Resources;
}

interface ArmyStats {
  totalHp: number;
  damagePerRound: number;
  units: Record<string, { count: number; hp: number }>;
}

function calculateArmyStats(
  units: Record<UnitType, number>,
  enemyUnits: Record<UnitType, number>,
  ownTechBonuses?: TechBonuses,
  enemyTechBonuses?: TechBonuses,
  attackMultiplier: number = 1
): ArmyStats {
  // Calculate weighted average defense of the enemy (for damage calculation)
  let enemyTotalCount = 0;
  let enemyDefenseSum = 0;
  for (const [type, count] of Object.entries(enemyUnits)) {
    const stats = getUnitStats(type as UnitType, 1, enemyTechBonuses);
    enemyTotalCount += count;
    enemyDefenseSum += stats.defense * count;
  }
  const avgEnemyDefense = enemyTotalCount > 0 ? enemyDefenseSum / enemyTotalCount : 0;

  let totalHp = 0;
  let damagePerRound = 0;
  const unitStats: Record<string, { count: number; hp: number }> = {};

  for (const [type, count] of Object.entries(units)) {
    const stats = getUnitStats(type as UnitType, 1, ownTechBonuses);
    const effectiveDefense = Math.max(0, avgEnemyDefense - stats.armorPenetration);
    const damagePerUnit = Math.max(1, (stats.attack * attackMultiplier) - effectiveDefense);

    totalHp += stats.hp * count;
    damagePerRound += damagePerUnit * count;
    unitStats[type] = { count, hp: stats.hp };
  }

  return { totalHp, damagePerRound, units: unitStats };
}

/**
 * Resolve a battle using HP pools, armor penetration, and damage-per-round.
 *
 * Each army deals damage based on: attack - max(0, enemyDefense - armorPenetration),
 * with a minimum of 1 damage per unit. The battle is decided by who destroys the
 * enemy's total HP pool first (fewer rounds to kill = winner).
 *
 * Both sides suffer proportional losses based on the damage received.
 */
export function resolveBattle(
  attackerUnits: Record<UnitType, number>,
  defenderUnits: Record<UnitType, number>,
  defenseStructureLevel: number = 0,
  towerLevel: number = 0,
  attackerTechBonuses?: TechBonuses,
  defenderTechBonuses?: TechBonuses,
  attackerAttackMultiplier: number = 1
): Omit<BattleResult, "loot"> {
  const attacker = calculateArmyStats(attackerUnits, defenderUnits, attackerTechBonuses, defenderTechBonuses, attackerAttackMultiplier);
  const defender = calculateArmyStats(defenderUnits, attackerUnits, defenderTechBonuses, attackerTechBonuses);

  // Wall bonus: defender gets effective HP multiplier based on wall level + tech
  const wallMult = getWallBonusMultiplier(defenseStructureLevel, defenderTechBonuses ?? {
    unitAttackBonus: {}, unitHpBonus: {}, unitDefenseBonus: {}, unitSpeedBonus: {}, unitApBonus: {},
    resourceProdBonus: {}, trainingCostReduction: 0, wallBonusMultiplier: 1, towerDamageBonus: 0,
  });
  const defenderEffectiveHp = defender.totalHp * wallMult;

  // Tower damage: applied each round to attacker
  const towerDmg = getTowerDamagePerRound(towerLevel, defenderTechBonuses ?? {
    unitAttackBonus: {}, unitHpBonus: {}, unitDefenseBonus: {}, unitSpeedBonus: {}, unitApBonus: {},
    resourceProdBonus: {}, trainingCostReduction: 0, wallBonusMultiplier: 1, towerDamageBonus: 0,
  });
  const totalTowerDamage = towerDmg * Math.ceil(
    (defenderEffectiveHp / (attacker.damagePerRound || 1))
  );

  // Rounds each side needs to wipe the other
  const roundsToKillDefender = attacker.damagePerRound > 0 ? defenderEffectiveHp / attacker.damagePerRound : Infinity;
  const roundsToKillAttacker = defender.damagePerRound > 0 ? attacker.totalHp / defender.damagePerRound : Infinity;

  // Attacker wins if they kill faster. If equal, defender wins (home advantage).
  const victory = roundsToKillDefender < roundsToKillAttacker;

  // Simulate the actual number of rounds fought
  const roundsFought = victory ? roundsToKillDefender : roundsToKillAttacker;

  // Damage received by each side (tower damage added to attacker's losses)
  const attackerHpLost = Math.min(attacker.totalHp, defender.damagePerRound * roundsFought + totalTowerDamage);
  const defenderHpLost = Math.min(defenderEffectiveHp, attacker.damagePerRound * roundsFought);

  // Calculate losses proportionally by HP contribution of each unit type
  const attackerLosses: Record<string, number> = {};
  const defenderLosses: Record<string, number> = {};
  const attackerSurvivors: Record<string, number> = {};

  for (const [type, data] of Object.entries(attacker.units)) {
    const typeHpPool = data.hp * data.count;
    const typeHpLost = data.count > 0 ? (typeHpPool / attacker.totalHp) * attackerHpLost : 0;
    const deaths = Math.min(data.count, Math.floor(typeHpLost / data.hp));
    attackerLosses[type] = deaths;
    attackerSurvivors[type] = data.count - deaths;
  }

  for (const [type, data] of Object.entries(defender.units)) {
    const typeHpPool = data.hp * data.count;
    const typeHpLost = data.count > 0 ? (typeHpPool / defender.totalHp) * defenderHpLost : 0;
    const deaths = Math.min(data.count, Math.floor(typeHpLost / data.hp));
    defenderLosses[type] = deaths;
  }

  return {
    victory,
    attackerLosses: attackerLosses as Record<UnitType, number>,
    defenderLosses: defenderLosses as Record<UnitType, number>,
    attackerSurvivors: attackerSurvivors as Record<UnitType, number>,
  };
}

/**
 * Calculate loot based on surviving attacker's carry capacity.
 * Cannot take more than defender has, and cannot exceed total carry.
 */
export function calculateLoot(
  attackerSurvivors: Record<UnitType, number>,
  defenderResources: Resources
): Resources {
  let totalCarry = 0;

  for (const [type, count] of Object.entries(attackerSurvivors)) {
    const stats = getUnitStats(type as UnitType);
    totalCarry += stats.carry * count;
  }

  // Loot distribution loaded from config
  const weights = BATTLE_CONFIG.lootWeights;
  const weightedTotal =
    defenderResources.gold * weights.gold +
    defenderResources.wood * weights.wood +
    defenderResources.stone * weights.stone +
    defenderResources.food * weights.food;

  // Cannot loot more than total carry, and cannot loot more than defender has
  const lootFactor = totalCarry / (weightedTotal || 1);
  const clampFactor = Math.min(1, lootFactor);

  return {
    gold: Math.min(defenderResources.gold, Math.floor(defenderResources.gold * weights.gold * clampFactor)),
    wood: Math.min(defenderResources.wood, Math.floor(defenderResources.wood * weights.wood * clampFactor)),
    stone: Math.min(defenderResources.stone, Math.floor(defenderResources.stone * weights.stone * clampFactor)),
    food: Math.min(defenderResources.food, Math.floor(defenderResources.food * weights.food * clampFactor)),
    gems: 0, // Cannot loot gems
  };
}

/**
 * Calculate travel time in seconds based on distance and unit speed.
 */
export function calculateTravelTime(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  speed: number
): number {
  const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
  return Math.floor((distance / speed) * 3600); // seconds
}

export function calculateTravelTimeWithMultiplier(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  speed: number,
  speedMultiplier: number
): number {
  const effectiveSpeed = Math.max(1, speed * Math.max(0.1, speedMultiplier));
  return calculateTravelTime(fromX, fromY, toX, toY, effectiveSpeed);
}
