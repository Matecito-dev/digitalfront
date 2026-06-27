import type { BarbarianArchetype, ResourceRange } from '../shared/barbarians.js';
import type { Season } from '../shared/world.js';

export interface BarbarianRewardConfig {
  id: string;
  archetype: BarbarianArchetype;
  campLevelMin: number;
  campLevelMax: number;
  resources: ResourceRange;
  overkillPenaltyThreshold: number;
}

// ─── Seasonal Reward Multipliers ───
// Rewards scale by season: winter gives more (risk/reward), spring gives less.

export const SEASONAL_REWARD_MULTIPLIERS: Record<Season, number> = {
  SPRING: 0.85,
  SUMMER: 1.0,
  AUTUMN: 1.15,
  WINTER: 1.3,
};

export const LOCAL_BARBARIAN_REWARD_CONFIGS: BarbarianRewardConfig[] = [
  {
    id: 'reward_raiders_low',
    archetype: 'RAIDERS',
    campLevelMin: 1,
    campLevelMax: 3,
    resources: {
      goldMin: 50, goldMax: 200,
      woodMin: 30, woodMax: 150,
      stoneMin: 20, stoneMax: 100,
      foodMin: 40, foodMax: 180,
    },
    overkillPenaltyThreshold: 5,
  },
  {
    id: 'reward_raiders_mid',
    archetype: 'RAIDERS',
    campLevelMin: 4,
    campLevelMax: 6,
    resources: {
      goldMin: 200, goldMax: 500,
      woodMin: 150, woodMax: 400,
      stoneMin: 100, stoneMax: 300,
      foodMin: 180, foodMax: 450,
    },
    overkillPenaltyThreshold: 4,
  },
  {
    id: 'reward_raiders_high',
    archetype: 'RAIDERS',
    campLevelMin: 7,
    campLevelMax: 10,
    resources: {
      goldMin: 500, goldMax: 1200,
      woodMin: 400, woodMax: 1000,
      stoneMin: 300, stoneMax: 800,
      foodMin: 450, foodMax: 1100,
    },
    overkillPenaltyThreshold: 3,
  },
  {
    id: 'reward_hunters_low',
    archetype: 'HUNTERS',
    campLevelMin: 1,
    campLevelMax: 3,
    resources: {
      goldMin: 30, goldMax: 120,
      woodMin: 20, woodMax: 100,
      stoneMin: 10, stoneMax: 60,
      foodMin: 80, foodMax: 300,
    },
    overkillPenaltyThreshold: 5,
  },
  {
    id: 'reward_hunters_mid',
    archetype: 'HUNTERS',
    campLevelMin: 4,
    campLevelMax: 6,
    resources: {
      goldMin: 120, goldMax: 350,
      woodMin: 100, woodMax: 280,
      stoneMin: 60, stoneMax: 200,
      foodMin: 300, foodMax: 800,
    },
    overkillPenaltyThreshold: 4,
  },
  {
    id: 'reward_hunters_high',
    archetype: 'HUNTERS',
    campLevelMin: 7,
    campLevelMax: 10,
    resources: {
      goldMin: 350, goldMax: 800,
      woodMin: 280, woodMax: 700,
      stoneMin: 200, stoneMax: 500,
      foodMin: 800, foodMax: 2000,
    },
    overkillPenaltyThreshold: 3,
  },
  {
    id: 'reward_marauders_low',
    archetype: 'MARAUDERS',
    campLevelMin: 1,
    campLevelMax: 3,
    resources: {
      goldMin: 80, goldMax: 300,
      woodMin: 60, woodMax: 250,
      stoneMin: 40, stoneMax: 150,
      foodMin: 50, foodMax: 200,
    },
    overkillPenaltyThreshold: 4,
  },
  {
    id: 'reward_marauders_mid',
    archetype: 'MARAUDERS',
    campLevelMin: 4,
    campLevelMax: 6,
    resources: {
      goldMin: 300, goldMax: 700,
      woodMin: 250, woodMax: 600,
      stoneMin: 150, stoneMax: 450,
      foodMin: 200, foodMax: 550,
    },
    overkillPenaltyThreshold: 3,
  },
  {
    id: 'reward_marauders_high',
    archetype: 'MARAUDERS',
    campLevelMin: 7,
    campLevelMax: 10,
    resources: {
      goldMin: 700, goldMax: 1800,
      woodMin: 600, woodMax: 1500,
      stoneMin: 450, stoneMax: 1200,
      foodMin: 550, foodMax: 1400,
    },
    overkillPenaltyThreshold: 3,
  },
  {
    id: 'reward_warhost',
    archetype: 'WARHOST',
    campLevelMin: 1,
    campLevelMax: 10,
    resources: {
      goldMin: 500, goldMax: 3000,
      woodMin: 400, woodMax: 2500,
      stoneMin: 300, stoneMax: 2000,
      foodMin: 400, foodMax: 2500,
    },
    overkillPenaltyThreshold: 2,
  },
  {
    id: 'reward_nomads',
    archetype: 'NOMADS',
    campLevelMin: 1,
    campLevelMax: 5,
    resources: {
      goldMin: 20, goldMax: 100,
      woodMin: 15, woodMax: 80,
      stoneMin: 10, stoneMax: 60,
      foodMin: 30, foodMax: 150,
    },
    overkillPenaltyThreshold: 6,
  },
];

export function getRewardConfig(
  archetype: BarbarianArchetype,
  campLevel: number
): BarbarianRewardConfig {
  const matching = LOCAL_BARBARIAN_REWARD_CONFIGS.filter(
    (c) => c.archetype === archetype && campLevel >= c.campLevelMin && campLevel <= c.campLevelMax
  );
  return matching[0] ?? LOCAL_BARBARIAN_REWARD_CONFIGS[0];
}

export function calculateEstimatedReward(
  archetype: BarbarianArchetype,
  campLevel: number,
  season: Season = 'SUMMER'
): { gold: number; wood: number; stone: number; food: number } {
  const config = getRewardConfig(archetype, campLevel);
  const { resources } = config;
  const multiplier = SEASONAL_REWARD_MULTIPLIERS[season] ?? 1.0;

  return {
    gold: Math.floor((resources.goldMin + resources.goldMax) / 2 * multiplier),
    wood: Math.floor((resources.woodMin + resources.woodMax) / 2 * multiplier),
    stone: Math.floor((resources.stoneMin + resources.stoneMax) / 2 * multiplier),
    food: Math.floor((resources.foodMin + resources.foodMax) / 2 * multiplier),
  };
}

export function calculateActualReward(
  archetype: BarbarianArchetype,
  campLevel: number,
  season: Season = 'SUMMER',
  overkillRatio: number = 1.0
): { gold: number; wood: number; stone: number; food: number } {
  const config = getRewardConfig(archetype, campLevel);
  const { resources } = config;
  const seasonMultiplier = SEASONAL_REWARD_MULTIPLIERS[season] ?? 1.0;

  // Overkill penalty: if player power >> camp power, reward is reduced
  // Threshold from config: e.g., 5x = no penalty, below that scales down
  const overkillThreshold = config.overkillPenaltyThreshold;
  let overkillPenalty = 1.0;
  if (overkillRatio > overkillThreshold) {
    // Linear decay from 1.0 to 0.3 as overkill goes from threshold to threshold*3
    const maxOverkill = overkillThreshold * 3;
    overkillPenalty = Math.max(0.3, 1.0 - (overkillRatio - overkillThreshold) / (maxOverkill - overkillThreshold) * 0.7);
  }

  const finalMultiplier = seasonMultiplier * overkillPenalty;

  return {
    gold: Math.floor(randomInRange(resources.goldMin, resources.goldMax) * finalMultiplier),
    wood: Math.floor(randomInRange(resources.woodMin, resources.woodMax) * finalMultiplier),
    stone: Math.floor(randomInRange(resources.stoneMin, resources.stoneMax) * finalMultiplier),
    food: Math.floor(randomInRange(resources.foodMin, resources.foodMax) * finalMultiplier),
  };
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
