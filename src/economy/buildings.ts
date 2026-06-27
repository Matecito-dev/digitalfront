import { BuildingTypeSchema, type BuildingType, type Resources } from '../shared/economy.js';
import { BASE_BUILDING_CONFIGS, generateBuildingLevelConfig } from './buildingConfigSeedData.js';
import { CITY_BASE_CONFIG } from '../cities/cityBaseConfig.js';

interface ConfigRecord {
  id: string;
  type: BuildingType;
  level: number;
  costGold: number;
  costWood: number;
  costStone: number;
  costFood: number;
  costGems: number;
  buildTimeSeconds: number;
  prodGoldPerHour: number;
  prodWoodPerHour: number;
  prodStonePerHour: number;
  prodFoodPerHour: number;
  storageGold: number;
  storageWood: number;
  storageStone: number;
  storageFood: number;
  maxLevel: number;
}

const configCache = new Map<string, ConfigRecord>();
let configsLoaded = false;
let validatedCoverage = false;

const EXPECTED_BUILDING_TYPES = BuildingTypeSchema.options;

function getKey(type: BuildingType, level: number) {
  return `${type}-${level}`;
}

function validateLoadedConfigs() {
  const missingLevelOne = EXPECTED_BUILDING_TYPES.filter((type) => !configCache.has(getKey(type, 1)));
  if (missingLevelOne.length > 0) {
    throw new Error(`[buildings] Missing level 1 configs for: ${missingLevelOne.join(', ')}`);
  }

  const missingLevels: string[] = [];
  for (const type of EXPECTED_BUILDING_TYPES) {
    const levelOne = configCache.get(getKey(type, 1));
    if (!levelOne) continue;
    for (let level = 1; level <= levelOne.maxLevel; level++) {
      if (!configCache.has(getKey(type, level))) {
        missingLevels.push(`${type} L${level}`);
      }
    }
  }

  if (missingLevels.length > 0) {
    throw new Error(`[buildings] Incomplete config coverage: ${missingLevels.join(', ')}`);
  }

  validatedCoverage = true;
}

function loadLocalGeneratedConfigs() {
  configCache.clear();
  for (const base of BASE_BUILDING_CONFIGS) {
    for (let level = 1; level <= base.maxLevel; level++) {
      const cfg = generateBuildingLevelConfig(base, level);
      configCache.set(getKey(cfg.type, cfg.level), {
        id: `local-${cfg.type}-${cfg.level}`,
        ...cfg,
      });
    }
  }
  validateLoadedConfigs();
  configsLoaded = true;
}

export async function loadBuildingConfigs(): Promise<void> {
  if (configsLoaded) return;
  loadLocalGeneratedConfigs();
  console.log(`🏗️ Loaded ${configCache.size} local building configs into memory (${EXPECTED_BUILDING_TYPES.length} active types validated)`);
}

function getConfig(type: BuildingType, level: number): ConfigRecord {
  if (!configsLoaded) throw new Error('Configs not loaded. Call loadBuildingConfigs() first.');
  if (!validatedCoverage) throw new Error('[buildings] Config coverage was not validated.');
  const key = getKey(type, level);
  const config = configCache.get(key);
  if (!config) {
    throw new Error(`[buildings] Config not found: ${type} level ${level}`);
  }
  return config;
}

export function getBuildingCost(type: BuildingType, level: number): Resources {
  const cfg = getConfig(type, level);
  return {
    gold: cfg.costGold,
    wood: cfg.costWood,
    stone: cfg.costStone,
    food: cfg.costFood,
    gems: cfg.costGems,
  };
}

export function getBuildingTime(type: BuildingType, level: number): number {
  return getConfig(type, level).buildTimeSeconds;
}

export function getMaxBuildingLevel(type: BuildingType): number {
  return getConfig(type, 1).maxLevel;
}

export function getProductionRates(type: BuildingType, level: number) {
  const cfg = getConfig(type, level);
  return {
    goldPerHour: cfg.prodGoldPerHour,
    woodPerHour: cfg.prodWoodPerHour,
    stonePerHour: cfg.prodStonePerHour,
    foodPerHour: cfg.prodFoodPerHour,
  };
}

export function getStorageBonus(type: BuildingType, level: number) {
  const cfg = getConfig(type, level);
  return {
    maxGold: cfg.storageGold,
    maxWood: cfg.storageWood,
    maxStone: cfg.storageStone,
    maxFood: cfg.storageFood,
  };
}

export function calculateCityStats(buildings: { type: BuildingType; level: number }[], options?: { storageMultiplier?: number }) {
  const storageMult = options?.storageMultiplier ?? 1;
  let goldPerHour = 0;
  let woodPerHour = 0;
  let stonePerHour = 0;
  let foodPerHour = 0;

  let maxGold = CITY_BASE_CONFIG.baseStorage.maxGold;
  let maxWood = CITY_BASE_CONFIG.baseStorage.maxWood;
  let maxStone = CITY_BASE_CONFIG.baseStorage.maxStone;
  let maxFood = CITY_BASE_CONFIG.baseStorage.maxFood;

  for (const b of buildings) {
    const prod = getProductionRates(b.type, b.level);
    goldPerHour += prod.goldPerHour;
    woodPerHour += prod.woodPerHour;
    stonePerHour += prod.stonePerHour;
    foodPerHour += prod.foodPerHour;

    const storage = getStorageBonus(b.type, b.level);
    maxGold += storage.maxGold;
    maxWood += storage.maxWood;
    maxStone += storage.maxStone;
    maxFood += storage.maxFood;
  }

  return {
    production: { goldPerHour, woodPerHour, stonePerHour, foodPerHour },
    storage: { maxGold: Math.round(maxGold * storageMult), maxWood: Math.round(maxWood * storageMult), maxStone: Math.round(maxStone * storageMult), maxFood: Math.round(maxFood * storageMult) },
  };
}

export function getBuildingMaxLevelForTownHall(townHallLevel: number, type: BuildingType): number {
  const buildingMax = getMaxBuildingLevel(type);
  if (type === 'TOWN_HALL') return buildingMax;
  return Math.min(buildingMax, townHallLevel + 1);
}
