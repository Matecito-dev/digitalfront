import type { UnitType } from '../shared/economy.js';

export interface UnitConfigRecord {
  id: string;
  type: UnitType;
  level: number;
  costGold: number;
  costWood: number;
  costStone: number;
  costFood: number;
  costGems: number;
  trainingTimeSeconds: number;
  attack: number;
  defense: number;
  speed: number;
  carry: number;
  hp: number;
  armorPenetration: number;
  maxLevel: number;
}

const BASE_UNIT_CONFIGS: {
  type: UnitType;
  maxLevel: number;
  base: Omit<UnitConfigRecord, 'id' | 'type' | 'level' | 'maxLevel'> & {
    costMultiplier: number;
    statMultiplier: number;
    apMultiplier: number;
  };
}[] = [
  {
    type: 'WARRIOR', maxLevel: 20,
    base: {
      costGold: 20, costWood: 30, costStone: 0, costFood: 10, costGems: 0,
      trainingTimeSeconds: 30,
      attack: 18, defense: 15, speed: 160, carry: 20,
      hp: 120, armorPenetration: 0,
      costMultiplier: 1.3, statMultiplier: 1.15, apMultiplier: 1.02,
    },
  },
  {
    type: 'ARCHER', maxLevel: 20,
    base: {
      costGold: 30, costWood: 40, costStone: 0, costFood: 15, costGems: 0,
      trainingTimeSeconds: 40,
      attack: 28, defense: 10, speed: 130, carry: 15,
      hp: 60, armorPenetration: 5,
      costMultiplier: 1.35, statMultiplier: 1.18, apMultiplier: 1.04,
    },
  },
  {
    type: 'CAVALRY', maxLevel: 20,
    base: {
      costGold: 80, costWood: 60, costStone: 20, costFood: 40, costGems: 0,
      trainingTimeSeconds: 120,
      attack: 35, defense: 20, speed: 280, carry: 40,
      hp: 110, armorPenetration: 8,
      costMultiplier: 1.4, statMultiplier: 1.2, apMultiplier: 1.05,
    },
  },
  {
    type: 'SIEGE', maxLevel: 15,
    base: {
      costGold: 200, costWood: 300, costStone: 150, costFood: 50, costGems: 0,
      trainingTimeSeconds: 300,
      attack: 60, defense: 10, speed: 70, carry: 100,
      hp: 80, armorPenetration: 25,
      costMultiplier: 1.5, statMultiplier: 1.25, apMultiplier: 1.08,
    },
  },
  {
    type: 'SPY', maxLevel: 10,
    base: {
      costGold: 100, costWood: 20, costStone: 0, costFood: 10, costGems: 0,
      trainingTimeSeconds: 60,
      attack: 0, defense: 2, speed: 400, carry: 0,
      hp: 30, armorPenetration: 0,
      costMultiplier: 1.45, statMultiplier: 1.1, apMultiplier: 1.0,
    },
  },
  {
    type: 'PIKEMAN', maxLevel: 20,
    base: {
      costGold: 40, costWood: 50, costStone: 10, costFood: 20, costGems: 0,
      trainingTimeSeconds: 50,
      attack: 25, defense: 20, speed: 110, carry: 15,
      hp: 90, armorPenetration: 8,
      costMultiplier: 1.32, statMultiplier: 1.16, apMultiplier: 1.03,
    },
  },
  {
    type: 'CROSSBOWMAN', maxLevel: 20,
    base: {
      costGold: 60, costWood: 70, costStone: 15, costFood: 25, costGems: 0,
      trainingTimeSeconds: 70,
      attack: 35, defense: 6, speed: 100, carry: 12,
      hp: 50, armorPenetration: 15,
      costMultiplier: 1.38, statMultiplier: 1.19, apMultiplier: 1.06,
    },
  },
  {
    type: 'CATAPULT', maxLevel: 15,
    base: {
      costGold: 250, costWood: 350, costStone: 200, costFood: 60, costGems: 0,
      trainingTimeSeconds: 360,
      attack: 65, defense: 5, speed: 50, carry: 120,
      hp: 60, armorPenetration: 35,
      costMultiplier: 1.52, statMultiplier: 1.26, apMultiplier: 1.09,
    },
  },
];

function generateUnitLevelConfig(base: typeof BASE_UNIT_CONFIGS[number], level: number): UnitConfigRecord {
  const costMult = Math.pow(base.base.costMultiplier, level - 1);
  const statMult = Math.pow(base.base.statMultiplier, level - 1);
  const apMult = Math.pow(base.base.apMultiplier, level - 1);

  return {
    id: `local-${base.type}-${level}`,
    type: base.type,
    level,
    costGold: Math.floor(base.base.costGold * costMult),
    costWood: Math.floor(base.base.costWood * costMult),
    costStone: Math.floor(base.base.costStone * costMult),
    costFood: Math.floor(base.base.costFood * costMult),
    costGems: Math.floor(base.base.costGems * costMult),
    trainingTimeSeconds: Math.floor(base.base.trainingTimeSeconds * Math.pow(1.1, level - 1)),
    attack: Math.floor(base.base.attack * statMult),
    defense: Math.floor(base.base.defense * statMult),
    speed: Math.floor(base.base.speed * Math.pow(1.05, level - 1)),
    carry: Math.floor(base.base.carry * statMult),
    hp: Math.floor(base.base.hp * statMult),
    armorPenetration: Math.floor(base.base.armorPenetration * apMult),
    maxLevel: base.maxLevel,
  };
}

export function getLocalUnitConfigs(): UnitConfigRecord[] {
  const rows: UnitConfigRecord[] = [];
  for (const base of BASE_UNIT_CONFIGS) {
    for (let level = 1; level <= base.maxLevel; level++) {
      rows.push(generateUnitLevelConfig(base, level));
    }
  }
  return rows;
}
