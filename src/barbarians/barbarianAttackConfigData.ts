import type { BarbarianArchetype } from "../shared/barbarians.js";
import type { Season } from "../shared/world.js";

// ─── Barbarian Attack Configuration ───
// All values configurable here, never hardcoded in workers/routes.

export interface BarbarianAttackConfig {
  /** Minimum city age (hours) before it can be targeted */
  minCityAgeHours: number;
  /** Minimum city power to be targeted (prevents attacking empty cities) */
  minCityPower: number;
  /** Cooldown (hours) before same camp can attack same city again */
  attackCooldownHours: number;
  /** Cooldown (hours) before same city can be attacked by any camp */
  cityDefenseCooldownHours: number;
  /** Maximum number of simultaneous attacks a camp can have */
  maxSimultaneousAttacksPerCamp: number;
  /** Maximum number of simultaneous attacks targeting a single city */
  maxSimultaneousAttacksPerCity: number;
  /** Minimum resources a city keeps even after a successful barbarian loot */
  minSurvivalResources: Record<"gold" | "wood" | "stone" | "food", number>;
  /** Maximum percentage of resources that can be looted in a single attack */
  maxLootPercentage: number;
  /** Warning time (seconds) before attack arrives */
  warningTimeSeconds: number;
  /** Target selection radius (pixels) */
  targetRadius: number;
  /** Archetype-specific attack frequency (attacks per day) */
  archetypeFrequency: Record<BarbarianArchetype, number>;
  /** Season multipliers for attack frequency */
  seasonFrequencyMultiplier: Record<Season, number>;
  /** Season multipliers for army size */
  seasonArmySizeMultiplier: Record<Season, number>;
  /** Fraction of camp army sent per attack (rest stays to defend) */
  armyFractionPerAttack: number;
  /** Minimum army fraction (always send at least this much) */
  minArmyFraction: number;
}

export const LOCAL_BARBARIAN_ATTACK_CONFIG: BarbarianAttackConfig = {
  minCityAgeHours: 2,
  minCityPower: 50,
  attackCooldownHours: 12,
  cityDefenseCooldownHours: 6,
  maxSimultaneousAttacksPerCamp: 1,
  maxSimultaneousAttacksPerCity: 2,
  minSurvivalResources: { gold: 100, wood: 100, stone: 100, food: 100 },
  maxLootPercentage: 0.3,
  warningTimeSeconds: 120,
  targetRadius: 400,
  archetypeFrequency: {
    RAIDERS: 4,
    HUNTERS: 3,
    MARAUDERS: 2,
    WARHOST: 1,
    NOMADS: 5,
  },
  seasonFrequencyMultiplier: {
    SPRING: 0.7,
    SUMMER: 1.0,
    AUTUMN: 1.3,
    WINTER: 1.5,
  },
  seasonArmySizeMultiplier: {
    SPRING: 0.8,
    SUMMER: 1.0,
    AUTUMN: 1.2,
    WINTER: 1.4,
  },
  armyFractionPerAttack: 0.6,
  minArmyFraction: 0.3,
};

/**
 * Calculate target score for a city given a barbarian camp.
 * Higher score = more likely to be attacked.
 */
export function calculateTargetScore(params: {
  cityResources: { gold: number; wood: number; stone: number; food: number };
  cityPower: number;
  cityDefense: number;
  distance: number;
  cityLastAttackedAt?: string;
  season: Season;
  campLevel: number;
}): number {
  const { cityResources, cityPower, cityDefense, distance, season, campLevel } = params;

  // Resource attractiveness (total weighted value)
  const resourceScore =
    cityResources.gold * 0.4 +
    cityResources.wood * 0.2 +
    cityResources.stone * 0.2 +
    cityResources.food * 0.3;

  // Defense weakness (lower defense = higher score)
  const defenseScore = Math.max(0, 1 - cityDefense / (campLevel * 100));

  // Distance penalty (closer = more likely)
  const distanceScore = Math.max(0, 1 - distance / LOCAL_BARBARIAN_ATTACK_CONFIG.targetRadius);

  // Season aggression bonus
  const seasonAggression = LOCAL_BARBARIAN_ATTACK_CONFIG.seasonFrequencyMultiplier[season];

  // Power ratio (camp prefers weaker targets but not too weak)
  const powerRatio = Math.min(1, cityPower / (campLevel * 200));
  const powerScore = powerRatio > 0.1 && powerRatio < 0.8 ? 1 : 0.3;

  return (
    resourceScore * 0.3 +
    defenseScore * 0.25 +
    distanceScore * 0.2 +
    seasonAggression * 0.1 +
    powerScore * 0.15
  );
}

/**
 * Get the fraction of army to send for an attack based on archetype.
 */
export function getArmyFractionForArchetype(archetype: BarbarianArchetype): number {
  const fractions: Record<BarbarianArchetype, number> = {
    RAIDERS: 0.6,
    HUNTERS: 0.4,
    MARAUDERS: 0.7,
    WARHOST: 0.8,
    NOMADS: 0.5,
  };
  return Math.max(
    LOCAL_BARBARIAN_ATTACK_CONFIG.minArmyFraction,
    fractions[archetype] ?? LOCAL_BARBARIAN_ATTACK_CONFIG.armyFractionPerAttack
  );
}
