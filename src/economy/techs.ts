// @ts-nocheck
import type { TechType, TechConfig, TechEffect, TechBonuses } from '../shared/economy.js';
import { LOCAL_TECH_CONFIGS } from './techConfigData.js';

const techConfigCache = new Map<TechType, TechConfig>();
let techConfigsLoaded = false;

export async function loadTechConfigs(): Promise<void> {
  if (techConfigsLoaded) return;

  for (const c of LOCAL_TECH_CONFIGS) {
    techConfigCache.set(c.techId, c);
  }

  techConfigsLoaded = true;
  console.log(`📚 Loaded ${techConfigCache.size} local tech configs into memory`);
}

export function getTechConfig(techId: TechType): TechConfig {
  if (!techConfigsLoaded) throw new Error('Tech configs not loaded. Call loadTechConfigs() first.');
  const config = techConfigCache.get(techId);
  if (!config) throw new Error(`Tech config not found: ${techId}`);
  return config;
}

export function getAllTechConfigs(): TechConfig[] {
  if (!techConfigsLoaded) throw new Error('Tech configs not loaded. Call loadTechConfigs() first.');
  return Array.from(techConfigCache.values());
}

export function getTechsByCategory(category: string): TechConfig[] {
  return getAllTechConfigs().filter((c) => c.category === category);
}

export function getResearchCost(techId: TechType, targetLevel: number): { gold: number; wood: number; stone: number; food: number; gems: number } {
  const cfg = getTechConfig(techId);
  const multiplier = Math.pow(1.5, targetLevel - 1);
  return {
    gold: Math.floor(cfg.costGold * multiplier),
    wood: Math.floor(cfg.costWood * multiplier),
    stone: Math.floor(cfg.costStone * multiplier),
    food: Math.floor(cfg.costFood * multiplier),
    gems: 0,
  };
}

export function getResearchTime(techId: TechType, targetLevel: number): number {
  const cfg = getTechConfig(techId);
  return Math.floor(cfg.researchTimeSeconds * Math.pow(1.3, targetLevel - 1));
}

export function canResearch(
  techId: TechType,
  targetLevel: number,
  cityTechs: { techId: TechType; level: number }[],
  activeResearch: any | null
): { allowed: boolean; reason?: string } {
  const cfg = getTechConfig(techId);

  // One research at a time
  if (activeResearch) {
    return { allowed: false, reason: 'Another research is already in progress' };
  }

  // Check max level
  const current = cityTechs.find((t) => t.techId === techId);
  const currentLevel = current?.level ?? 0;
  if (currentLevel >= cfg.maxLevel) {
    return { allowed: false, reason: 'Max level reached' };
  }
  if (targetLevel !== currentLevel + 1) {
    return { allowed: false, reason: 'Must research levels sequentially' };
  }

  // Check prerequisites
  for (const prereq of cfg.prerequisites) {
    const prereqTech = cityTechs.find((t) => t.techId === prereq);
    if (!prereqTech || prereqTech.level < 1) {
      return { allowed: false, reason: `Missing prerequisite: ${prereq}` };
    }
  }

  // Check mutually exclusive
  for (const mutex of cfg.mutuallyExclusive) {
    const mutexTech = cityTechs.find((t) => t.techId === mutex);
    if (mutexTech && mutexTech.level >= 1) {
      return { allowed: false, reason: `Mutually exclusive with: ${mutex}` };
    }
  }

  return { allowed: true };
}

export function calculateTechBonuses(cityTechs: { techId: TechType; level: number }[]): TechBonuses {
  const bonuses: TechBonuses = {
    unitAttackBonus: {},
    unitHpBonus: {},
    unitDefenseBonus: {},
    unitSpeedBonus: {},
    unitApBonus: {},
    resourceProdBonus: {},
    trainingCostReduction: 0,
    wallBonusMultiplier: 1,
    towerDamageBonus: 0,
  };

  for (const cityTech of cityTechs) {
    const cfg = techConfigCache.get(cityTech.techId);
    if (!cfg) continue;

    for (const effect of cfg.effects) {
      applyEffect(effect, cityTech.level, bonuses);
    }
  }

  return bonuses;
}

function applyEffect(effect: TechEffect, level: number, bonuses: TechBonuses): void {
  const value = effect.operation === 'ADD' ? effect.value * level : effect.value;

  switch (effect.type) {
    case 'UNIT_STAT':
      if (effect.stat === 'attack') {
        bonuses.unitAttackBonus[effect.target] = (bonuses.unitAttackBonus[effect.target] || 0) + value;
      } else if (effect.stat === 'hp') {
        bonuses.unitHpBonus[effect.target] = (bonuses.unitHpBonus[effect.target] || 0) + value;
      } else if (effect.stat === 'defense') {
        bonuses.unitDefenseBonus[effect.target] = (bonuses.unitDefenseBonus[effect.target] || 0) + value;
      } else if (effect.stat === 'speed') {
        bonuses.unitSpeedBonus[effect.target] = (bonuses.unitSpeedBonus[effect.target] || 0) + value;
      } else if (effect.stat === 'armorPenetration') {
        bonuses.unitApBonus[effect.target] = (bonuses.unitApBonus[effect.target] || 0) + value;
      }
      break;

    case 'RESOURCE_PROD':
      bonuses.resourceProdBonus[effect.target] = (bonuses.resourceProdBonus[effect.target] || 0) + value;
      break;

    case 'GLOBAL_BONUS':
      if (effect.target === 'trainingCostReduction') {
        bonuses.trainingCostReduction += value;
      } else if (effect.target === 'wallBonusMultiplier') {
        bonuses.wallBonusMultiplier = effect.operation === 'MULTIPLY'
          ? bonuses.wallBonusMultiplier * Math.pow(value, level)
          : bonuses.wallBonusMultiplier + value;
      } else if (effect.target === 'towerDamageBonus') {
        bonuses.towerDamageBonus += value;
      }
      break;

    case 'BUILDING_STAT':
      if ((effect.target === 'WALL' || effect.target === 'TOWER') && effect.stat === 'defenseBonus') {
        bonuses.wallBonusMultiplier = effect.operation === 'MULTIPLY'
          ? bonuses.wallBonusMultiplier * Math.pow(value, level)
          : bonuses.wallBonusMultiplier + value;
      } else if (effect.target === 'TOWER' && effect.stat === 'damage') {
        bonuses.towerDamageBonus += value;
      } else if (effect.target === 'STORAGE' && effect.stat === 'capacity') {
        // Store as implicit field on bonuses JSON (not in Zod schema, stored on city)
        (bonuses as any).storageMultiplier = effect.operation === 'MULTIPLY'
          ? ((bonuses as any).storageMultiplier ?? 1) * Math.pow(value, level)
          : ((bonuses as any).storageMultiplier ?? 1) + value;
      }
      break;

    default:
      break;
  }
}

export function getWallBonusMultiplier(wallLevel: number, techBonuses: TechBonuses): number {
  return 1 + wallLevel * 0.08 * techBonuses.wallBonusMultiplier;
}

export function getTowerDamagePerRound(towerLevel: number, techBonuses: TechBonuses): number {
  return towerLevel * 5 + techBonuses.towerDamageBonus;
}
