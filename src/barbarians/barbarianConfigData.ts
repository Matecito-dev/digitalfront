import type { BarbarianArchetype } from '../shared/barbarians.js';
import type { BarbarianUnitType } from '../sim/worldState.js';

export const BARB_SOLDIER_HP = 120;
export const BARB_SNIPER_HP = 70;

export interface GroupCompositionRange {
  soldiers: [number, number];
  snipers: [number, number];
}

export const GROUP_COMPOSITION: Record<BarbarianArchetype, GroupCompositionRange> = {
  RAIDERS:   { soldiers: [4, 8],  snipers: [0, 1] },
  HUNTERS:   { soldiers: [2, 4],  snipers: [2, 5] },
  MARAUDERS: { soldiers: [5, 10], snipers: [1, 3] },
  WARHOST:   { soldiers: [8, 14], snipers: [0, 2] },
  NOMADS:    { soldiers: [3, 6],  snipers: [1, 2] },
};

export function unitHpForType(type: BarbarianUnitType): number {
  return type === "sniper" ? BARB_SNIPER_HP : BARB_SOLDIER_HP;
}
import type { Season } from '../shared/world.js';

export interface BarbarianZoneConfig {
  zoneId: string;
  maxDensity: number;
  levelMin: number;
  levelMax: number;
  allowedArchetypes: BarbarianArchetype[];
  minDistanceToCities: number;
  minDistanceBetweenCamps: number;
  spawnIntervalSeconds: number;
}

export interface BarbarianArchetypeConfig {
  archetype: BarbarianArchetype;
  label: string;
  description: string;
  basePower: number;
  powerPerLevel: number;
  unitComposition: Record<string, number>;
  aggressionLevel: number;
  preferredTargets: string[];
  lootMultiplier: number;
}

// ─── Seasonal Spawn Configuration ───
// Controls how seasons affect barbarian spawn rates, archetype weighting, and camp levels.

export interface SeasonalSpawnConfig {
  /** Base spawn probability multiplier per season (0-1) */
  spawnProbability: Record<Season, number>;
  /** Archetype weight multipliers per season */
  archetypeWeights: Record<Season, Record<BarbarianArchetype, number>>;
  /** Camp level bonus per season (added to rolled level) */
  levelBonus: Record<Season, number>;
  /** Max density multiplier per season */
  densityMultiplier: Record<Season, number>;
  /** Camp lifespan in hours before escalation check */
  campLifespanHours: number;
  /** Probability of camp leveling up when it survives past lifespan */
  escalationProbability: number;
  /** Maximum level a camp can escalate to */
  maxEscalationLevel: number;
}

export const LOCAL_SEASONAL_SPAWN_CONFIG: SeasonalSpawnConfig = {
  spawnProbability: {
    SPRING: 0.4,
    SUMMER: 0.35,
    AUTUMN: 0.45,
    WINTER: 0.25,
  },
  archetypeWeights: {
    SPRING: { RAIDERS: 1.0, HUNTERS: 1.0, MARAUDERS: 0.8, WARHOST: 0.5, NOMADS: 1.3 },
    SUMMER: { RAIDERS: 1.2, HUNTERS: 1.0, MARAUDERS: 1.0, WARHOST: 0.7, NOMADS: 0.8 },
    AUTUMN: { RAIDERS: 1.0, HUNTERS: 1.3, MARAUDERS: 1.2, WARHOST: 1.0, NOMADS: 0.7 },
    WINTER: { RAIDERS: 0.8, HUNTERS: 0.7, MARAUDERS: 1.5, WARHOST: 1.5, NOMADS: 0.5 },
  },
  levelBonus: {
    SPRING: 0,
    SUMMER: 0,
    AUTUMN: 1,
    WINTER: 2,
  },
  densityMultiplier: {
    SPRING: 1.2,
    SUMMER: 1.0,
    AUTUMN: 1.3,
    WINTER: 0.7,
  },
  campLifespanHours: 24,
  escalationProbability: 0.3,
  maxEscalationLevel: 10,
};

// Distances are in world-space pixels. Map is 80000×80000px.
// minDistanceToCities: keep camps away from player cities
// minDistanceBetweenCamps: spread camps so they don't cluster visually.
//   Scaled up 1.6× from original values to match the larger 130px camp sprite
//   (was 80px; at zoom 0.16 a 130px sprite covers ~812 world units).
export const LOCAL_BARBARIAN_ZONE_CONFIGS: BarbarianZoneConfig[] = [
  {
    zoneId: 'north_frozen',
    maxDensity: 46,
    levelMin: 4,
    levelMax: 8,
    allowedArchetypes: ['RAIDERS', 'MARAUDERS', 'WARHOST'],
    minDistanceToCities: 1200,
    minDistanceBetweenCamps: 2100,
    spawnIntervalSeconds: 300,
  },
  {
    zoneId: 'center_temperate',
    maxDensity: 56,
    levelMin: 2,
    levelMax: 6,
    allowedArchetypes: ['RAIDERS', 'HUNTERS', 'NOMADS'],
    minDistanceToCities: 1100,
    minDistanceBetweenCamps: 1860,
    spawnIntervalSeconds: 240,
  },
  {
    zoneId: 'south_warm',
    maxDensity: 52,
    levelMin: 1,
    levelMax: 5,
    allowedArchetypes: ['RAIDERS', 'HUNTERS', 'NOMADS'],
    minDistanceToCities: 1100,
    minDistanceBetweenCamps: 1860,
    spawnIntervalSeconds: 240,
  },
  {
    zoneId: 'coast',
    maxDensity: 32,
    levelMin: 2,
    levelMax: 5,
    allowedArchetypes: ['RAIDERS', 'NOMADS'],
    minDistanceToCities: 960,
    minDistanceBetweenCamps: 2100,
    spawnIntervalSeconds: 360,
  },
  {
    zoneId: 'mountain',
    maxDensity: 42,
    levelMin: 3,
    levelMax: 7,
    allowedArchetypes: ['RAIDERS', 'MARAUDERS', 'HUNTERS'],
    minDistanceToCities: 1120,
    minDistanceBetweenCamps: 1950,
    spawnIntervalSeconds: 300,
  },
  {
    zoneId: 'forest',
    maxDensity: 52,
    levelMin: 1,
    levelMax: 5,
    allowedArchetypes: ['HUNTERS', 'RAIDERS', 'NOMADS'],
    minDistanceToCities: 960,
    minDistanceBetweenCamps: 1760,
    spawnIntervalSeconds: 180,
  },
  {
    zoneId: 'plains',
    maxDensity: 48,
    levelMin: 1,
    levelMax: 4,
    allowedArchetypes: ['RAIDERS', 'NOMADS', 'HUNTERS'],
    minDistanceToCities: 960,
    minDistanceBetweenCamps: 1760,
    spawnIntervalSeconds: 200,
  },
];

export const BARBARIAN_ARCHETYPE_CONFIGS: BarbarianArchetypeConfig[] = [
  {
    archetype: 'RAIDERS',
    label: 'Saqueadores',
    description: 'Campamentos comunes con recompensa equilibrada.',
    basePower: 100,
    powerPerLevel: 50,
    unitComposition: { WARRIOR: 0.6, ARCHER: 0.4 },
    aggressionLevel: 0.5,
    preferredTargets: ['low_resources', 'undefended'],
    lootMultiplier: 1.0,
  },
  {
    archetype: 'HUNTERS',
    label: 'Cazadores',
    description: 'Rápidos y escurridizos. Mayor recompensa de comida.',
    basePower: 80,
    powerPerLevel: 40,
    unitComposition: { ARCHER: 0.5, WARRIOR: 0.3, SPY: 0.2 },
    aggressionLevel: 0.3,
    preferredTargets: ['food_rich'],
    lootMultiplier: 0.8,
  },
  {
    archetype: 'MARAUDERS',
    label: 'Merodeadores',
    description: 'Agresivos. Priorizan ciudades ricas sin defensa.',
    basePower: 150,
    powerPerLevel: 70,
    unitComposition: { WARRIOR: 0.4, ARCHER: 0.3, CAVALRY: 0.3 },
    aggressionLevel: 0.8,
    preferredTargets: ['high_resources', 'weak_defense'],
    lootMultiplier: 1.3,
  },
  {
    archetype: 'WARHOST',
    label: 'Hueste de Guerra',
    description: 'Campamento de alto nivel. Requiere alianza o jugador avanzado.',
    basePower: 300,
    powerPerLevel: 120,
    unitComposition: { WARRIOR: 0.3, ARCHER: 0.2, CAVALRY: 0.3, SIEGE: 0.2 },
    aggressionLevel: 0.9,
    preferredTargets: ['cities', 'alliances'],
    lootMultiplier: 2.0,
  },
  {
    archetype: 'NOMADS',
    label: 'Nómadas',
    description: 'Aparecen y desaparecen rápido. Buenos para actividad diaria.',
    basePower: 60,
    powerPerLevel: 30,
    unitComposition: { SPY: 0.4, ARCHER: 0.3, WARRIOR: 0.3 },
    aggressionLevel: 0.2,
    preferredTargets: ['scattered'],
    lootMultiplier: 0.7,
  },
];

export function getArchetypeConfig(archetype: BarbarianArchetype): BarbarianArchetypeConfig {
  return BARBARIAN_ARCHETYPE_CONFIGS.find((c) => c.archetype === archetype) ?? BARBARIAN_ARCHETYPE_CONFIGS[0];
}

export function getZoneConfig(zoneId: string): BarbarianZoneConfig | undefined {
  return LOCAL_BARBARIAN_ZONE_CONFIGS.find((c) => c.zoneId === zoneId);
}

export function calculateCampPower(archetype: BarbarianArchetype, level: number): number {
  const config = getArchetypeConfig(archetype);
  return Math.floor(config.basePower + config.powerPerLevel * (level - 1));
}
