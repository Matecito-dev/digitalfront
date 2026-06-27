import type { UnitType, Resources } from '../shared/economy.js';
import { getLocalUnitConfigs, type UnitConfigRecord } from './unitConfigData.js';

const unitConfigCache = new Map<string, UnitConfigRecord>();
let unitConfigsLoaded = false;

export async function loadUnitConfigs(): Promise<void> {
  if (unitConfigsLoaded) return;

  for (const c of getLocalUnitConfigs()) {
    unitConfigCache.set(`${c.type}-${c.level}`, c);
  }

  unitConfigsLoaded = true;
  console.log(`⚔️ Loaded ${unitConfigCache.size} local unit configs into memory`);
}

function getUnitConfig(type: UnitType, level: number): UnitConfigRecord {
  if (!unitConfigsLoaded) throw new Error('Unit configs not loaded. Call loadUnitConfigs() first.');
  const key = `${type}-${level}`;
  const config = unitConfigCache.get(key);
  if (!config) throw new Error(`Unit config not found: ${type} level ${level}`);
  return config;
}

export function getUnitCost(type: UnitType, count: number, level: number = 1): Resources {
  const cfg = getUnitConfig(type, level);
  return {
    gold: cfg.costGold * count,
    wood: cfg.costWood * count,
    stone: cfg.costStone * count,
    food: cfg.costFood * count,
    gems: cfg.costGems * count,
  };
}

export function applyTrainingCostReduction(cost: Resources, reduction: number = 0): Resources {
  const multiplier = Math.max(0, 1 - reduction);
  return {
    gold: Math.floor(cost.gold * multiplier),
    wood: Math.floor(cost.wood * multiplier),
    stone: Math.floor(cost.stone * multiplier),
    food: Math.floor(cost.food * multiplier),
    gems: Math.floor(cost.gems * multiplier),
  };
}

export function getTrainingTime(type: UnitType, count: number, level: number = 1): number {
  return getUnitConfig(type, level).trainingTimeSeconds * count;
}

export function getUnitStats(type: UnitType, level: number = 1, techBonuses?: any) {
  const cfg = getUnitConfig(type, level);
  const bonuses = techBonuses || {};
  
  const attackMult = 1 + (bonuses.unitAttackBonus?.all || 0) + (bonuses.unitAttackBonus?.[type] || 0);
  const hpMult = 1 + (bonuses.unitHpBonus?.all || 0) + (bonuses.unitHpBonus?.[type] || 0);
  const defMult = 1 + (bonuses.unitDefenseBonus?.all || 0) + (bonuses.unitDefenseBonus?.[type] || 0);
  const speedMult = 1 + (bonuses.unitSpeedBonus?.all || 0) + (bonuses.unitSpeedBonus?.[type] || 0);
  const apAdd = (bonuses.unitApBonus?.all || 0) + (bonuses.unitApBonus?.[type] || 0);
  
  return {
    attack: Math.floor(cfg.attack * attackMult),
    defense: Math.floor(cfg.defense * defMult),
    speed: Math.floor(cfg.speed * speedMult),
    carry: cfg.carry,
    hp: Math.floor((cfg.hp ?? 100) * hpMult),
    armorPenetration: (cfg.armorPenetration ?? 0) + apAdd,
  };
}

export function getMaxUnitLevel(type: UnitType): number {
  return getUnitConfig(type, 1).maxLevel;
}

export const UNIT_DEFS: Record<UnitType, { speed: number }> = {
  WARRIOR: { speed: 160 },
  ARCHER: { speed: 130 },
  CAVALRY: { speed: 280 },
  SIEGE: { speed: 70 },
  SPY: { speed: 400 },
  PIKEMAN: { speed: 110 },
  CROSSBOWMAN: { speed: 100 },
  CATAPULT: { speed: 50 },
};

export function isUnitUnlocked(type: UnitType, cityTechs: any[]): boolean {
  const unlockedTechs = new Set(cityTechs.map((t: any) => t.techId));
  
  const unlockRequirements: Record<string, string> = {
    CAVALRY: 'HORSE_BREEDING',
    SIEGE: 'SIEGE_ENGINEERING',
    CROSSBOWMAN: 'REINFORCED_BOWS',
    CATAPULT: 'SIEGE_ENGINEERING',
  };
  
  const required = unlockRequirements[type];
  if (!required) return true; // WARRIOR, ARCHER unlocked by default
  
  return unlockedTechs.has(required);
}

export function getUnlockedUnits(cityTechs: any[]): UnitType[] {
  const allTypes: UnitType[] = ['WARRIOR', 'ARCHER', 'PIKEMAN', 'CAVALRY', 'SIEGE', 'CROSSBOWMAN', 'CATAPULT', 'SPY'];
  return allTypes.filter(type => isUnitUnlocked(type, cityTechs));
}
