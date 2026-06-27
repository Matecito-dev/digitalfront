// Economy types extracted from @etheria/shared — portable, no DB deps.
import { z } from "zod";

export const ResourcesSchema = z.object({
  gold: z.number().default(0),
  wood: z.number().default(0),
  stone: z.number().default(0),
  food: z.number().default(0),
  gems: z.number().default(0),
});
export type Resources = z.infer<typeof ResourcesSchema>;

export const BuildingTypeSchema = z.enum([
  "TOWN_HALL", "GOLD_MINE", "LUMBER_MILL", "QUARRY", "FARM",
  "BARRACKS", "STABLE", "ALLIANCE_CENTER", "LIBRARY", "STORAGE",
  "TOWER", "MARKET",
]);
export type BuildingType = z.infer<typeof BuildingTypeSchema>;

export const UnitTypeSchema = z.enum([
  "WARRIOR", "ARCHER", "CAVALRY", "SIEGE", "SPY",
  "PIKEMAN", "CROSSBOWMAN", "CATAPULT",
]);
export type UnitType = z.infer<typeof UnitTypeSchema>;

export const TechTypeSchema = z.enum([
  "COLLECTION_EFFICIENT_I", "COLLECTION_EFFICIENT_II", "COLLECTION_EFFICIENT_III",
  "ADVANCED_STORAGE", "WARTIME_ECONOMY", "TRADE",
  "WEAPON_FORGE_I", "WEAPON_FORGE_II", "REINFORCED_BOWS",
  "HORSE_BREEDING", "HEAVY_CAVALRY", "SIEGE_ENGINEERING", "BALLISTICS",
  "GUERRILLA_TACTICS", "MASONRY", "STONE_WALLS", "WATCHTOWER",
  "POISONED_ARROWS", "FORTIFICATIONS", "SPY_NETWORK", "SPEC_SIEGE", "SPEC_CAVALRY",
]);
export type TechType = z.infer<typeof TechTypeSchema>;

export interface TechEffect {
  type: "UNIT_STAT" | "BUILDING_STAT" | "RESOURCE_PROD" | "UNLOCK_UNIT" | "UNLOCK_BUILDING" | "GLOBAL_BONUS";
  target: string;
  stat: string;
  value: number;
  operation: "ADD" | "MULTIPLY";
}


export interface TechBonuses {
  unitAttackBonus?: Record<string, number>;
  unitHpBonus?: Record<string, number>;
  unitDefenseBonus?: Record<string, number>;
  unitSpeedBonus?: Record<string, number>;
  unitApBonus?: Record<string, number>;
  resourceProdBonus?: Record<string, number>;
  trainingCostReduction?: number;
  wallBonusMultiplier?: number;
  towerDamageBonus?: number;
  unlockUnits?: UnitType[];
}

export interface TechConfig {
  id: string;
  techId: TechType;
  name: string;
  description: string;
  category: "ECONOMY" | "MILITARY" | "DEFENSE";
  maxLevel: number;
  costGold: number;
  costWood: number;
  costStone: number;
  costFood: number;
  researchTimeSeconds: number;
  prerequisites: TechType[];
  effects: TechEffect[];
  mutuallyExclusive?: TechType[];
}
