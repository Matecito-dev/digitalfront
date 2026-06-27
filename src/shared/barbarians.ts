import { z } from "zod";
import { SeasonSchema } from "./world.js";

const UnitTypeSchema = z.enum(["WARRIOR", "ARCHER", "CAVALRY", "SIEGE", "SPY", "PIKEMAN", "CROSSBOWMAN", "CATAPULT"]);

// ─── Barbarian Archetypes ───

export const BarbarianArchetypeSchema = z.enum([
  "RAIDERS",
  "HUNTERS",
  "MARAUDERS",
  "WARHOST",
  "NOMADS",
]);

export type BarbarianArchetype = z.infer<typeof BarbarianArchetypeSchema>;

// ─── Barbarian Camp ───

export const BarbarianCampSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().optional(),
  name: z.string(),
  level: z.number().int().min(1).max(10),
  archetype: BarbarianArchetypeSchema,
  posX: z.number().int(),
  posY: z.number().int(),
  zoneId: z.string(),
  status: z.enum(["ACTIVE", "DEFEATED", "DESPAWNING"]),
  spawnedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  lastActionAt: z.string().datetime().optional(),
  nextAttackAt: z.string().datetime().optional(),
  ownerEventId: z.string().optional(),
});

export type BarbarianCamp = z.infer<typeof BarbarianCampSchema>;

// ─── Barbarian Army ───

export const BarbarianArmySchema = z.object({
  id: z.string().uuid(),
  campId: z.string().uuid(),
  units: z.record(UnitTypeSchema, z.number().int().min(0)),
  power: z.number().int().min(0),
});

export type BarbarianArmy = z.infer<typeof BarbarianArmySchema>;

// ─── Barbarian Reward Table ───

export const ResourceRangeSchema = z.object({
  goldMin: z.number().int().min(0),
  goldMax: z.number().int().min(0),
  woodMin: z.number().int().min(0),
  woodMax: z.number().int().min(0),
  stoneMin: z.number().int().min(0),
  stoneMax: z.number().int().min(0),
  foodMin: z.number().int().min(0),
  foodMax: z.number().int().min(0),
});

export type ResourceRange = z.infer<typeof ResourceRangeSchema>;

export const BarbarianRewardTableSchema = z.object({
  id: z.string().uuid(),
  campLevelMin: z.number().int().min(1),
  campLevelMax: z.number().int().min(1),
  season: SeasonSchema.optional(),
  zoneId: z.string().optional(),
  resources: ResourceRangeSchema,
  dropChance: z.record(z.string(), z.number().min(0).max(1)).optional(),
});

export type BarbarianRewardTable = z.infer<typeof BarbarianRewardTableSchema>;

// ─── Barbarian Camp Map Item (lightweight for map rendering) ───

export const BarbarianCampMapItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  level: z.number().int().min(1).max(10),
  archetype: BarbarianArchetypeSchema,
  posX: z.number().int(),
  posY: z.number().int(),
  status: z.enum(["ACTIVE", "DEFEATED", "DESPAWNING"]),
  estimatedPower: z.number().int().min(0),
  spawnedAt: z.string().datetime().optional(),
});

export type BarbarianCampMapItem = z.infer<typeof BarbarianCampMapItemSchema>;

// ─── Barbarian Camp Detail (for modal) ───

export const BarbarianCampDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  level: z.number().int().min(1).max(10),
  archetype: BarbarianArchetypeSchema,
  posX: z.number().int(),
  posY: z.number().int(),
  zoneId: z.string(),
  status: z.enum(["ACTIVE", "DEFEATED", "DESPAWNING"]),
  army: z.object({
    units: z.record(UnitTypeSchema, z.number().int().min(0)),
    power: z.number().int().min(0),
  }),
  estimatedReward: z.object({
    gold: z.number().int().min(0),
    wood: z.number().int().min(0),
    stone: z.number().int().min(0),
    food: z.number().int().min(0),
  }),
});

export type BarbarianCampDetail = z.infer<typeof BarbarianCampDetailSchema>;

// ─── World State with Barbarians ───

export const WorldStateWithBarbariansSchema = z.object({
  season: z.object({
    currentSeason: SeasonSchema,
    phase: z.enum(["START", "PEAK", "TRANSITION"]),
    intensity: z.number().min(0).max(1),
    endsAt: z.string().datetime(),
  }),
  zones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      currentIntensity: z.number(),
      terrainTags: z.array(z.string()),
    })
  ),
  barbarianCamps: z.array(BarbarianCampMapItemSchema),
});

export type WorldStateWithBarbarians = z.infer<typeof WorldStateWithBarbariansSchema>;

// ─── Attack Barbarian ───

export const AttackBarbarianRequestSchema = z.object({
  cityId: z.string().uuid(),
  units: z.array(
    z.object({
      type: z.enum(["WARRIOR", "ARCHER", "CAVALRY", "SIEGE", "SPY"]),
      count: z.number().int().min(1),
    })
  ),
});

export type AttackBarbarianRequest = z.infer<typeof AttackBarbarianRequestSchema>;

export const BarbarianBattleResultSchema = z.object({
  victory: z.boolean(),
  attackerLosses: z.record(z.string(), z.number().int()),
  attackerSurvivors: z.record(z.string(), z.number().int()),
  defenderLosses: z.record(z.string(), z.number().int()),
  roundsFought: z.number(),
});

export type BarbarianBattleResult = z.infer<typeof BarbarianBattleResultSchema>;

export const BarbarianBattleSchema = z.object({
  id: z.string().uuid(),
  attackerCityId: z.string().uuid(),
  targetCampId: z.string().uuid(),
  units: z.array(
    z.object({ type: z.string(), count: z.number().int().min(1) })
  ),
  status: z.enum(["MARCHING", "RETURNING", "VICTORY", "DEFEAT"]),
  startedAt: z.string().datetime(),
  arrivesAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  returnsAt: z.string().datetime().optional(),
  result: BarbarianBattleResultSchema.optional(),
  loot: z.object({
    gold: z.number().int(),
    wood: z.number().int(),
    stone: z.number().int(),
    food: z.number().int(),
  }).optional(),
});

export type BarbarianBattle = z.infer<typeof BarbarianBattleSchema>;

// ─── Barbarian Attack (Barbarian → Player) ───

export const BarbarianAttackSchema = z.object({
  id: z.string().uuid(),
  campId: z.string().uuid(),
  targetCityId: z.string().uuid(),
  units: z.array(
    z.object({ type: z.string(), count: z.number().int().min(1) })
  ),
  status: z.enum(["MARCHING", "ARRIVED", "RETURNING", "VICTORY", "DEFEAT"]),
  startedAt: z.string().datetime(),
  arrivesAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  returnsAt: z.string().datetime().optional(),
  result: BarbarianBattleResultSchema.optional(),
  loot: z.object({
    gold: z.number().int(),
    wood: z.number().int(),
    stone: z.number().int(),
    food: z.number().int(),
  }).optional(),
});

export type BarbarianAttack = z.infer<typeof BarbarianAttackSchema>;

// ─── Barbarian Attack Alert ───

export const BarbarianAttackAlertSchema = z.object({
  id: z.string().uuid(),
  cityId: z.string().uuid(),
  campId: z.string().uuid(),
  campName: z.string(),
  archetype: BarbarianArchetypeSchema,
  estimatedPower: z.number().int(),
  arrivesAt: z.string().datetime(),
  warnedAt: z.string().datetime(),
  read: z.boolean().default(false),
});

export type BarbarianAttackAlert = z.infer<typeof BarbarianAttackAlertSchema>;
