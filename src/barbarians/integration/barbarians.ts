import type { BarbarianArchetype, WorldSeasonState, BarbarianCamp } from '@etheria/shared';
import { initializeSeasonState } from './seasons.js';
import { getWorldConfig } from './worldConfig.js';
import { resolveWorldZone } from './worldZoneConfigData.js';
import { isBuildableTerrain } from './worldTerrainConfigData.js';
import {
  LOCAL_BARBARIAN_ZONE_CONFIGS,
  BARBARIAN_ARCHETYPE_CONFIGS,
  LOCAL_SEASONAL_SPAWN_CONFIG,
  getArchetypeConfig,
  calculateCampPower,
} from './barbarianConfigData.js';
import { getRewardConfig, calculateEstimatedReward } from './barbarianRewardConfigData.js';
import { db, COLLECTIONS } from '../infrastructure/matecito.js';
import { prisma } from '@etheria/database';

function assertDbOk(result: unknown, context: string) {
  if (!result) return;
  const err = (result as any).error ?? (result as any).err;
  if (err) {
    const msg = typeof err === 'string' ? err : (err.message ?? JSON.stringify(err));
    throw new Error(`[DB] ${context}: ${msg}`);
  }
}

async function assertRecordExists(
  collection: string,
  key: string,
  value: string,
  context: string
): Promise<void> {
  const res = await db.from(collection).eq(key, value).getFirst() as any;
  assertDbOk(res, `${context}.verify()`);
  if (!res.data) {
    throw new Error(`[DB] ${context}: insert completed but no persisted record was found for ${key}=${value}`);
  }
}

export interface SpawnCandidate {
  posX: number;
  posY: number;
  zoneId: string;
}

export async function fetchCurrentSeasonState(): Promise<WorldSeasonState | null> {
  const res = await db.from(COLLECTIONS.WORLD_SEASON_STATE).getFirst() as any;
  assertDbOk(res, 'WORLD_SEASON_STATE.getFirst()');
  return res.data ?? null;
}

export function pickRandomArchetype(
  zoneId: string,
  seasonState: WorldSeasonState | null
): BarbarianArchetype {
  const zoneConfig = LOCAL_BARBARIAN_ZONE_CONFIGS.find((z) => z.zoneId === zoneId);
  if (!zoneConfig) return 'RAIDERS';

  const allowed = zoneConfig.allowedArchetypes;
  const season = seasonState?.currentSeason ?? 'SPRING';
  const seasonWeights = LOCAL_SEASONAL_SPAWN_CONFIG.archetypeWeights[season];

  const weights = allowed.map((archetype) => seasonWeights[archetype] ?? 1.0);

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < allowed.length; i++) {
    random -= weights[i];
    if (random <= 0) return allowed[i];
  }
  return allowed[0];
}

export function generateBarbarianArmy(
  archetype: BarbarianArchetype,
  level: number
): { units: Record<string, number>; power: number } {
  const config = getArchetypeConfig(archetype);
  const power = calculateCampPower(archetype, level);
  const totalTroops = Math.floor(power / 10);

  const units: Record<string, number> = {};
  let remaining = totalTroops;

  for (const [unitType, ratio] of Object.entries(config.unitComposition)) {
    const count = Math.floor(totalTroops * ratio);
    units[unitType] = count;
    remaining -= count;
  }

  if (remaining > 0) {
    const firstUnit = Object.keys(config.unitComposition)[0];
    units[firstUnit] = (units[firstUnit] ?? 0) + remaining;
  }

  return { units, power };
}

export async function findValidSpawnPosition(
  zoneId: string,
  existingCamps: BarbarianCamp[]
): Promise<SpawnCandidate | null> {
  const zoneConfig = LOCAL_BARBARIAN_ZONE_CONFIGS.find((z) => z.zoneId === zoneId);
  if (!zoneConfig) return null;

  const worldConfig = await getWorldConfig();
  const minDistToCities = zoneConfig.minDistanceToCities;
  const minDistBetweenCamps = zoneConfig.minDistanceBetweenCamps;
  const halfW = Math.floor(worldConfig.map.width / 2);
  const halfH = Math.floor(worldConfig.map.height / 2);
  const edge = Math.max(0, worldConfig.spawn.edgePadding ?? 0);
  const minX = -halfW + edge;
  const maxX = halfW - edge;
  const minY = -halfH + edge;
  const maxY = halfH - edge;

  for (let attempt = 0; attempt < 50; attempt++) {
    const posX = Math.floor(minX + Math.random() * Math.max(1, maxX - minX + 1));
    const posY = Math.floor(minY + Math.random() * Math.max(1, maxY - minY + 1));
    if (!isBuildableTerrain(posX, posY, worldConfig.map.width, worldConfig.map.height)) continue;

    const resolvedZone = resolveWorldZone(posX, posY, worldConfig.map.width, worldConfig.map.height);
    if (resolvedZone.id !== zoneId) continue;

    const nearbyCities = await prisma.city.findMany({
      where: {
        posX: { gte: posX - minDistToCities, lte: posX + minDistToCities },
        posY: { gte: posY - minDistToCities, lte: posY + minDistToCities },
      },
      select: { posX: true, posY: true },
      take: 200,
    });
    const tooCloseToCity = nearbyCities.some(
      (city) => Math.sqrt((city.posX - posX) ** 2 + (city.posY - posY) ** 2) < minDistToCities
    );
    if (tooCloseToCity) continue;

    const tooCloseToCamp = existingCamps.some(
      (camp) => Math.sqrt((camp.posX - posX) ** 2 + (camp.posY - posY) ** 2) < minDistBetweenCamps
    );
    if (tooCloseToCamp) continue;

    return { posX, posY, zoneId };
  }

  return null;
}

export function pickCampLevel(zoneId: string, seasonState: WorldSeasonState | null): number {
  const zoneConfig = LOCAL_BARBARIAN_ZONE_CONFIGS.find((z) => z.zoneId === zoneId);
  if (!zoneConfig) return 1;

  const { levelMin, levelMax } = zoneConfig;
  const level = Math.floor(Math.random() * (levelMax - levelMin + 1)) + levelMin;

  const season = seasonState?.currentSeason ?? 'SPRING';
  const bonus = LOCAL_SEASONAL_SPAWN_CONFIG.levelBonus[season] ?? 0;
  return Math.min(LOCAL_SEASONAL_SPAWN_CONFIG.maxEscalationLevel, level + bonus);
}

export async function countActiveCampsByZone(): Promise<Map<string, number>> {
  const campsRes = await db
    .from(COLLECTIONS.BARBARIAN_CAMPS)
    .eq('status', 'ACTIVE')
    .get() as any;
  assertDbOk(campsRes, 'BARBARIAN_CAMPS.eq(status=ACTIVE).get()');

  const counts = new Map<string, number>();
  for (const camp of campsRes.data ?? []) {
    counts.set(camp.zoneId, (counts.get(camp.zoneId) ?? 0) + 1);
  }
  return counts;
}

export function getEffectiveMaxDensity(zoneId: string, seasonState: WorldSeasonState | null): number {
  const zoneConfig = LOCAL_BARBARIAN_ZONE_CONFIGS.find((z) => z.zoneId === zoneId);
  if (!zoneConfig) return 3;

  const season = seasonState?.currentSeason ?? 'SPRING';
  const multiplier = LOCAL_SEASONAL_SPAWN_CONFIG.densityMultiplier[season] ?? 1.0;
  return Math.ceil(zoneConfig.maxDensity * multiplier);
}

export async function getAllActiveCamps(worldId?: string): Promise<BarbarianCamp[]> {
  let query = db
    .from(COLLECTIONS.BARBARIAN_CAMPS)
    .eq('status', 'ACTIVE');
  if (worldId) {
    query = query.eq('worldId', worldId);
  }
  const campsRes = await query.get() as any;
  assertDbOk(campsRes, 'BARBARIAN_CAMPS.eq(status=ACTIVE).get()');
  return campsRes.data ?? [];
}

export async function spawnBarbarianCamp(
  zoneId: string,
  seasonState: WorldSeasonState | null
): Promise<BarbarianCamp | null> {
  const existingCamps = await getAllActiveCamps();
  const position = await findValidSpawnPosition(zoneId, existingCamps);
  if (!position) return null;

  const archetype = pickRandomArchetype(zoneId, seasonState);
  const level = pickCampLevel(zoneId, seasonState);
  const army = generateBarbarianArmy(archetype, level);

  const now = new Date().toISOString();
  const campId = crypto.randomUUID();

  // Create camp
  const camp: BarbarianCamp = {
    id: campId,
    name: generateCampName(archetype, level),
    level,
    archetype,
    posX: position.posX,
    posY: position.posY,
    zoneId,
    status: 'ACTIVE',
    spawnedAt: now,
    lastActionAt: now,
  };

  const campInsert = await db.from(COLLECTIONS.BARBARIAN_CAMPS).insert(camp) as any;
  assertDbOk(campInsert, `BARBARIAN_CAMPS.insert(${campId})`);
  await assertRecordExists(COLLECTIONS.BARBARIAN_CAMPS, 'id', campId, `BARBARIAN_CAMPS.insert(${campId})`);

  // Create army
  const armyInsert = await db.from(COLLECTIONS.BARBARIAN_ARMIES).insert({
    id: crypto.randomUUID(),
    campId,
    units: army.units,
    power: army.power,
  }) as any;
  assertDbOk(armyInsert, `BARBARIAN_ARMIES.insert(campId=${campId})`);
  await assertRecordExists(COLLECTIONS.BARBARIAN_ARMIES, 'campId', campId, `BARBARIAN_ARMIES.insert(campId=${campId})`);

  return camp;
}

export function generateCampName(archetype: BarbarianArchetype, level: number): string {
  const prefixes: Record<BarbarianArchetype, string[]> = {
    RAIDERS: ['Campamento', 'Refugio', 'Guarida'],
    HUNTERS: ['Coto', 'Trampa', 'Acecho'],
    MARAUDERS: ['Bastion', 'Fortin', 'Plaza'],
    WARHOST: ['Hueste', 'Legion', 'Estandarte'],
    NOMADS: ['Caravana', 'Tribu', 'Campamento Nomada'],
  };

  const suffixes = ['del Norte', 'del Sur', 'Oscuro', 'Salvaje', 'de la Sombra', 'del Bosque', 'de la Montana'];
  const prefixList = prefixes[archetype] ?? prefixes.RAIDERS;
  const prefix = prefixList[Math.floor(Math.random() * prefixList.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];

  return `${prefix} ${suffix} (Nv.${level})`;
}

export async function getBarbarianCampDetail(campId: string): Promise<{
  camp: BarbarianCamp;
  army: { units: Record<string, number>; power: number };
  estimatedReward: { gold: number; wood: number; stone: number; food: number };
} | null> {
  const campRes = await db.from(COLLECTIONS.BARBARIAN_CAMPS).eq('id', campId).getFirst() as any;
  assertDbOk(campRes, `BARBARIAN_CAMPS.eq(id=${campId}).getFirst()`);
  if (!campRes.data) return null;

  const armyRes = await db.from(COLLECTIONS.BARBARIAN_ARMIES).eq('campId', campId).getFirst() as any;
  assertDbOk(armyRes, `BARBARIAN_ARMIES.eq(campId=${campId}).getFirst()`);
  const army = armyRes.data ?? { units: {}, power: 0 };

  const seasonState = await fetchCurrentSeasonState();
  const season = seasonState?.currentSeason ?? 'SUMMER';
  const estimatedReward = calculateEstimatedReward(campRes.data.archetype, campRes.data.level, season);

  return {
    camp: campRes.data,
    army,
    estimatedReward,
  };
}

export async function processBarbarianSpawns(): Promise<void> {
  const seasonState = await fetchCurrentSeasonState() ?? await initializeSeasonState();

  const campCounts = await countActiveCampsByZone();
  const worldConfig = await getWorldConfig();

  for (const zoneConfig of LOCAL_BARBARIAN_ZONE_CONFIGS) {
    const effectiveMax = getEffectiveMaxDensity(zoneConfig.zoneId, seasonState);
    const currentCount = campCounts.get(zoneConfig.zoneId) ?? 0;
    if (currentCount >= effectiveMax) continue;

    const spawnChance = LOCAL_SEASONAL_SPAWN_CONFIG.spawnProbability[seasonState.currentSeason] ?? 0.3;
    if (Math.random() > spawnChance) continue;

    const camp = await spawnBarbarianCamp(zoneConfig.zoneId, seasonState);
    if (camp) {
      campCounts.set(zoneConfig.zoneId, currentCount + 1);
      console.log(`🏕️ Barbarian camp spawned in zone ${zoneConfig.zoneId}: ${camp.id}`);
    }
  }
}

export async function processCampEscalation(): Promise<void> {
  const seasonState = await fetchCurrentSeasonState();
  if (!seasonState) return;

  const camps = await getAllActiveCamps();
  const now = new Date();
  const lifespanMs = LOCAL_SEASONAL_SPAWN_CONFIG.campLifespanHours * 60 * 60 * 1000;

  for (const camp of camps) {
    const spawnedAt = new Date(camp.spawnedAt);
    const elapsed = now.getTime() - spawnedAt.getTime();

    // Check if camp has survived past its lifespan
    if (elapsed >= lifespanMs) {
      const escalationChance = LOCAL_SEASONAL_SPAWN_CONFIG.escalationProbability;
      if (Math.random() < escalationChance && camp.level < LOCAL_SEASONAL_SPAWN_CONFIG.maxEscalationLevel) {
        const newLevel = camp.level + 1;
        const army = generateBarbarianArmy(camp.archetype, newLevel);

        await db.from(COLLECTIONS.BARBARIAN_CAMPS).eq('id', camp.id).merge({
          level: newLevel,
          lastActionAt: now.toISOString(),
        }).execute() as any;

        await db.from(COLLECTIONS.BARBARIAN_ARMIES).eq('campId', camp.id).merge({
          units: army.units,
          power: army.power,
        }).execute() as any;

        console.log(`⚠️ Barbarian camp "${camp.name}" escalated to level ${newLevel}`);
      }

      // Reset spawn time to allow re-escalation check later
      await db.from(COLLECTIONS.BARBARIAN_CAMPS).eq('id', camp.id).merge({
        spawnedAt: now.toISOString(),
      }).execute() as any;
    }
  }
}
