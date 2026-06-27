import { db, COLLECTIONS } from '../infrastructure/matecito.js';
import type { BarbarianArchetype, Season } from '@etheria/shared';
import {
  LOCAL_BARBARIAN_ATTACK_CONFIG,
  calculateTargetScore,
  getArmyFractionForArchetype,
} from './barbarianAttackConfigData.js';
import { getSeasonState } from './seasons.js';
import { calculateTravelTimeWithMultiplier } from './battles.js';
import { getUnitStats } from './units.js';
import { getWorldConfig } from './worldConfig.js';
import { calculatePathSpeedMultiplier } from './worldTerrainConfigData.js';
import { prisma } from '@etheria/database';

const genId = () => crypto.randomUUID();

export interface CityTargetCandidate {
  city: any;
  score: number;
  distance: number;
}

/**
 * Get all active barbarian camps that can attack.
 */
export async function getAttackableCamps(): Promise<any[]> {
  const camps = await prisma.barbarianCamp.findMany({
    where: { status: "ACTIVE" as any },
    select: { id: true, archetype: true, level: true, name: true, posX: true, posY: true, lastActionAt: true },
  });
  const armies = camps.length > 0
    ? await prisma.barbarianArmy.findMany({
        where: { campId: { in: camps.map((camp) => camp.id) } },
      })
    : [];
  const armyByCampId = new Map(armies.map((army) => [army.campId, army]));
  const now = new Date();

  // Filter camps that have army and are not on cooldown
  const result: any[] = [];
  for (const camp of camps) {
    // Check cooldown
    if (camp.lastActionAt) {
      const hoursSinceLastAction = (now.getTime() - new Date(camp.lastActionAt).getTime()) / (1000 * 60 * 60);
      const cooldownHours = LOCAL_BARBARIAN_ATTACK_CONFIG.attackCooldownHours;
      if (hoursSinceLastAction < cooldownHours) continue;
    }

    // Check if camp has army
    const army = armyByCampId.get(camp.id);
    if (!army) continue;
    const totalUnits = Object.values(army.units as Record<string, number>)
      .reduce((sum: number, count: number) => sum + count, 0);

    if (totalUnits < 5) continue; // Minimum army size

    result.push({ camp, army });
  }

  return result;
}

/**
 * Get potential target cities for a barbarian camp.
 */
export async function getTargetCandidates(
  camp: any,
  season: Season
): Promise<CityTargetCandidate[]> {
  const config = LOCAL_BARBARIAN_ATTACK_CONFIG;
  const minPosX = Math.floor(camp.posX - config.targetRadius);
  const maxPosX = Math.ceil(camp.posX + config.targetRadius);
  const minPosY = Math.floor(camp.posY - config.targetRadius);
  const maxPosY = Math.ceil(camp.posY + config.targetRadius);

  const allCities = await prisma.city.findMany({
    where: {
      posX: { gte: minPosX, lte: maxPosX },
      posY: { gte: minPosY, lte: maxPosY },
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      posX: true,
      posY: true,
      goldPerHour: true,
      woodPerHour: true,
      stonePerHour: true,
      foodPerHour: true,
      gold: true,
      wood: true,
      stone: true,
      food: true,
    },
  });
  const now = new Date();
  const incomingAttacks = await prisma.barbarianAttack.findMany({
    where: {
      status: "MARCHING" as any,
      OR: [
        { targetCityId: { in: allCities.map((city) => city.id) } },
        { campId: camp.id },
      ],
    },
    select: { targetCityId: true, campId: true },
  });
  const buildings = await prisma.building.findMany({
    where: {
      cityId: { in: allCities.map((city) => city.id) },
      type: "TOWER" as any,
    },
    select: { cityId: true, level: true },
  });
  const incomingByCity = new Map<string, number>();
  const incomingByCampAndCity = new Map<string, number>();
  for (const attack of incomingAttacks) {
    incomingByCity.set(attack.targetCityId, (incomingByCity.get(attack.targetCityId) ?? 0) + 1);
    if (attack.campId === camp.id) {
      const key = `${attack.campId}:${attack.targetCityId}`;
      incomingByCampAndCity.set(key, (incomingByCampAndCity.get(key) ?? 0) + 1);
    }
  }
  const towerByCity = new Map<string, number>();
  for (const building of buildings) towerByCity.set(building.cityId, building.level);

  const candidates: CityTargetCandidate[] = [];

  for (const city of allCities) {
    // Skip if city is too new
    const cityAgeHours = (now.getTime() - new Date(city.createdAt).getTime()) / (1000 * 60 * 60);
    if (cityAgeHours < config.minCityAgeHours) continue;

    // Skip if city power is too low
    const cityPower = calculateCityPower(city);
    if (cityPower < config.minCityPower) continue;

    // Calculate distance
    const distance = Math.sqrt(
      Math.pow(city.posX - camp.posX, 2) + Math.pow(city.posY - camp.posY, 2)
    );
    if (distance > config.targetRadius) continue;

    // Check city defense cooldown
    const lastBarbarianAttackAt = (city as any).lastBarbarianAttackAt;
    if (lastBarbarianAttackAt) {
      const hoursSinceAttack = (now.getTime() - new Date(lastBarbarianAttackAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceAttack < config.cityDefenseCooldownHours) continue;
    }

    // Check if city already has max incoming attacks
    if ((incomingByCity.get(city.id) ?? 0) >= config.maxSimultaneousAttacksPerCity) continue;

    // Check if camp already attacking this city
    if ((incomingByCampAndCity.get(`${camp.id}:${city.id}`) ?? 0) >= config.maxSimultaneousAttacksPerCamp) continue;

    // Calculate defense score
    const defenseScore = (towerByCity.get(city.id) ?? 0) * 50;

    // Calculate target score
    const score = calculateTargetScore({
      cityResources: {
        gold: city.gold ?? 0,
        wood: city.wood ?? 0,
        stone: city.stone ?? 0,
        food: city.food ?? 0,
      },
      cityPower,
      cityDefense: defenseScore,
      distance,
      cityLastAttackedAt: lastBarbarianAttackAt,
      season,
      campLevel: camp.level,
    });

    candidates.push({ city, score, distance });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Select units from barbarian army for an attack.
 */
export function selectAttackUnits(
  army: any,
  archetype: BarbarianArchetype,
  season: Season
): { type: string; count: number }[] {
  const fraction = getArmyFractionForArchetype(archetype);
  const seasonMult = LOCAL_BARBARIAN_ATTACK_CONFIG.seasonArmySizeMultiplier[season];
  const effectiveFraction = Math.min(1, fraction * seasonMult);

  const units: { type: string; count: number }[] = [];

  for (const [type, count] of Object.entries(army.units as Record<string, number>)) {
    const sendCount = Math.max(1, Math.floor(count * effectiveFraction));
    if (sendCount > 0) {
      units.push({ type, count: sendCount });
    }
  }

  return units;
}

/**
 * Create a barbarian attack march.
 */
export async function createBarbarianAttack(params: {
  camp: any;
  army: any;
  targetCity: any;
  units: { type: string; count: number }[];
  season: Season;
}): Promise<{ attackId: string; arrivesAt: string; warningSent: boolean }> {
  const { camp, army, targetCity, units, season } = params;
  const now = new Date();
  const config = LOCAL_BARBARIAN_ATTACK_CONFIG;

  // Calculate travel time based on slowest unit
  let minSpeed = 60;
  for (const unit of units) {
    const stats = getUnitStats(unit.type as any, 1);
    if (stats.speed < minSpeed) minSpeed = stats.speed;
  }

  const world = await getWorldConfig();
  const terrainSpeed = calculatePathSpeedMultiplier(
    camp.posX, camp.posY,
    targetCity.posX, targetCity.posY,
    world.map.width,
    world.map.height
  );
  const travelTime = calculateTravelTimeWithMultiplier(
    camp.posX, camp.posY,
    targetCity.posX, targetCity.posY,
    minSpeed,
    terrainSpeed
  );

  const arrivesAt = new Date(now.getTime() + travelTime * 1000).toISOString();
  const warningTime = new Date(now.getTime() + Math.max(0, travelTime - config.warningTimeSeconds) * 1000).toISOString();

  const attackId = genId();

  // Create the attack record
  await db.from(COLLECTIONS.BARBARIAN_ATTACKS).insert({
    id: attackId,
    campId: camp.id,
    targetCityId: targetCity.id,
    units,
    status: 'MARCHING',
    startedAt: now.toISOString(),
    arrivesAt,
    archetype: camp.archetype,
    campName: camp.name,
    campLevel: camp.level,
  });

  // Update camp last action time
  await db.from(COLLECTIONS.BARBARIAN_CAMPS)
    .eq('id', camp.id)
    .merge({ lastActionAt: now.toISOString() })
    .execute() as any;

  // Update city last attack time
  await db.from(COLLECTIONS.CITIES)
    .eq('id', targetCity.id)
    .merge({ lastBarbarianAttackAt: now.toISOString() })
    .execute() as any;

  // Create attack alert for the target city
  const alertId = genId();
  await db.from(COLLECTIONS.BARBARIAN_ATTACK_ALERTS).insert({
    id: alertId,
    cityId: targetCity.id,
    campId: camp.id,
    campName: camp.name,
    archetype: camp.archetype,
    estimatedPower: Math.floor(100 + 50 * (camp.level - 1)),
    arrivesAt,
    warnedAt: warningTime,
    read: false,
  });

  return {
    attackId,
    arrivesAt,
    warningSent: travelTime > config.warningTimeSeconds,
  };
}

/**
 * Calculate approximate city power for target selection.
 */
function calculateCityPower(city: any): number {
  const buildingPower = (city.goldPerHour ?? 0) + (city.woodPerHour ?? 0) +
    (city.stonePerHour ?? 0) + (city.foodPerHour ?? 0);
  const resourcePower = ((city.gold ?? 0) + (city.wood ?? 0) +
    (city.stone ?? 0) + (city.food ?? 0)) / 100;
  return Math.floor(buildingPower * 2 + resourcePower);
}

/**
 * Process barbarian attacks: select targets and create marches.
 */
export async function processBarbarianAttacks(): Promise<number> {
  const seasonState = await getSeasonState();
  if (!seasonState) return 0;

  const season = seasonState.currentSeason as Season;
  const camps = await getAttackableCamps();
  let attacksCreated = 0;

  for (const { camp, army } of camps) {
    // Check archetype frequency for this season
    const baseFrequency = LOCAL_BARBARIAN_ATTACK_CONFIG.archetypeFrequency[camp.archetype as BarbarianArchetype] ?? 2;
    const seasonMult = LOCAL_BARBARIAN_ATTACK_CONFIG.seasonFrequencyMultiplier[season];
    const effectiveFrequency = baseFrequency * seasonMult;

    // Random chance based on frequency (frequency = expected attacks per day)
    // Check every 5 seconds, so probability per tick = frequency / (24 * 60 * 60 / 5)
    const probabilityPerTick = effectiveFrequency / (24 * 60 * 60 / 5);
    if (Math.random() > probabilityPerTick) continue;

    const candidates = await getTargetCandidates(camp, season);
    if (candidates.length === 0) continue;

    // Pick the best target
    const bestTarget = candidates[0];
    const attackUnits = selectAttackUnits(army, camp.archetype as BarbarianArchetype, season);

    if (attackUnits.length === 0) continue;

    const result = await createBarbarianAttack({
      camp,
      army,
      targetCity: bestTarget.city,
      units: attackUnits,
      season,
    });

    attacksCreated++;
    console.log(
      `🏹 Barbarian attack: ${camp.name} (${camp.archetype}) → ${bestTarget.city.name} | ` +
      `Units: ${attackUnits.map(u => `${u.count} ${u.type}`).join(', ')} | ` +
      `Arrives: ${result.arrivesAt}`
    );
  }

  return attacksCreated;
}
