import { BuildingTypeSchema, type BuildingType } from '../shared/economy.js';

export interface BaseBuildingConfig {
  type: BuildingType;
  maxLevel: number;
  baseCost: { gold: number; wood: number; stone: number; food: number; gems: number };
  baseBuildTimeSeconds: number;
  costMultiplier: number;
  timeMultiplier: number;
  prodMultiplier: number;
  storageMultiplier: number;
  prodGold?: number;
  prodWood?: number;
  prodStone?: number;
  prodFood?: number;
  storageGold?: number;
  storageWood?: number;
  storageStone?: number;
  storageFood?: number;
}

export const EXPECTED_BUILDING_TYPES = BuildingTypeSchema.options;

export const BASE_BUILDING_CONFIGS: BaseBuildingConfig[] = [
  {
    type: 'TOWN_HALL', maxLevel: 25,
    baseCost: { gold: 100, wood: 80, stone: 60, food: 40, gems: 0 },
    baseBuildTimeSeconds: 420, costMultiplier: 1.5, timeMultiplier: 1.35,
    storageGold: 500, storageWood: 500, storageStone: 300, storageFood: 300,
    storageMultiplier: 1.4, prodMultiplier: 1.0,
  },
  {
    type: 'GOLD_MINE', maxLevel: 25,
    baseCost: { gold: 50, wood: 100, stone: 20, food: 0, gems: 0 },
    baseBuildTimeSeconds: 30, costMultiplier: 1.45, timeMultiplier: 1.3,
    prodGold: 100, storageMultiplier: 1.0, prodMultiplier: 1.20,
  },
  {
    type: 'LUMBER_MILL', maxLevel: 25,
    baseCost: { gold: 50, wood: 50, stone: 20, food: 0, gems: 0 },
    baseBuildTimeSeconds: 30, costMultiplier: 1.45, timeMultiplier: 1.3,
    prodWood: 100, storageMultiplier: 1.0, prodMultiplier: 1.20,
  },
  {
    type: 'QUARRY', maxLevel: 25,
    baseCost: { gold: 100, wood: 150, stone: 0, food: 0, gems: 0 },
    baseBuildTimeSeconds: 45, costMultiplier: 1.5, timeMultiplier: 1.35,
    prodStone: 60, storageMultiplier: 1.0, prodMultiplier: 1.18,
  },
  {
    type: 'FARM', maxLevel: 25,
    baseCost: { gold: 40, wood: 80, stone: 10, food: 0, gems: 0 },
    baseBuildTimeSeconds: 30, costMultiplier: 1.45, timeMultiplier: 1.3,
    prodFood: 60, storageMultiplier: 1.0, prodMultiplier: 1.18,
  },
  {
    type: 'BARRACKS', maxLevel: 25,
    baseCost: { gold: 200, wood: 200, stone: 100, food: 50, gems: 0 },
    baseBuildTimeSeconds: 60, costMultiplier: 1.5, timeMultiplier: 1.4,
    storageMultiplier: 1.0, prodMultiplier: 1.0,
  },
  {
    type: 'STABLE', maxLevel: 25,
    baseCost: { gold: 250, wood: 300, stone: 150, food: 100, gems: 0 },
    baseBuildTimeSeconds: 90, costMultiplier: 1.55, timeMultiplier: 1.4,
    storageMultiplier: 1.0, prodMultiplier: 1.0,
  },
  {
    type: 'ALLIANCE_CENTER', maxLevel: 25,
    baseCost: { gold: 500, wood: 400, stone: 200, food: 100, gems: 0 },
    baseBuildTimeSeconds: 300, costMultiplier: 1.6, timeMultiplier: 1.5,
    storageMultiplier: 1.0, prodMultiplier: 1.0,
  },
  {
    type: 'LIBRARY', maxLevel: 25,
    baseCost: { gold: 300, wood: 400, stone: 300, food: 50, gems: 0 },
    baseBuildTimeSeconds: 120, costMultiplier: 1.55, timeMultiplier: 1.45,
    storageMultiplier: 1.0, prodMultiplier: 1.0,
  },
  {
    type: 'STORAGE', maxLevel: 25,
    baseCost: { gold: 100, wood: 200, stone: 100, food: 0, gems: 0 },
    baseBuildTimeSeconds: 60, costMultiplier: 1.5, timeMultiplier: 1.35,
    storageGold: 500, storageWood: 500, storageStone: 300, storageFood: 300,
    storageMultiplier: 1.4, prodMultiplier: 1.0,
  },
  {
    type: 'TOWER', maxLevel: 25,
    baseCost: { gold: 150, wood: 200, stone: 200, food: 0, gems: 0 },
    baseBuildTimeSeconds: 180, costMultiplier: 1.5, timeMultiplier: 1.4,
    storageMultiplier: 1.0, prodMultiplier: 1.0,
  },
  {
    type: 'MARKET', maxLevel: 25,
    baseCost: { gold: 300, wood: 250, stone: 150, food: 50, gems: 0 },
    baseBuildTimeSeconds: 240, costMultiplier: 1.55, timeMultiplier: 1.45,
    storageMultiplier: 1.0, prodMultiplier: 1.0,
  },
];

export function generateBuildingLevelConfig(base: BaseBuildingConfig, level: number) {
  const costMult = Math.pow(base.costMultiplier, level - 1);
  const timeMult = Math.pow(base.timeMultiplier, level - 1);
  const prodMult = Math.pow(base.prodMultiplier, level - 1);
  const storageMult = level * base.storageMultiplier;

  return {
    type: base.type,
    level,
    costGold: Math.floor(base.baseCost.gold * costMult),
    costWood: Math.floor(base.baseCost.wood * costMult),
    costStone: Math.floor(base.baseCost.stone * costMult),
    costFood: Math.floor(base.baseCost.food * costMult),
    costGems: Math.floor(base.baseCost.gems * costMult),
    buildTimeSeconds: Math.floor(base.baseBuildTimeSeconds * timeMult),
    prodGoldPerHour: Math.floor((base.prodGold ?? 0) * prodMult),
    prodWoodPerHour: Math.floor((base.prodWood ?? 0) * prodMult),
    prodStonePerHour: Math.floor((base.prodStone ?? 0) * prodMult),
    prodFoodPerHour: Math.floor((base.prodFood ?? 0) * prodMult),
    storageGold: Math.floor((base.storageGold ?? 0) * storageMult),
    storageWood: Math.floor((base.storageWood ?? 0) * storageMult),
    storageStone: Math.floor((base.storageStone ?? 0) * storageMult),
    storageFood: Math.floor((base.storageFood ?? 0) * storageMult),
    maxLevel: base.maxLevel,
  };
}
