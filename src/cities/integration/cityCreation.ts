import { db, COLLECTIONS } from "../infrastructure/matecito.js";
import { mergeRecordByLogicalId } from "../infrastructure/matecitoRecord.js";
import { STARTER_BUILDING_LAYOUT, type BuildingType, type UnitType } from "@etheria/shared";
import { calculateCityStats } from "./buildings.js";
import { getWorldConfig, type WorldSpawnConfig } from "./worldConfig.js";
import type { WorldConfigDoc } from "./worldConfigData.js";
import { isBuildableTerrain } from "./worldTerrainConfigData.js";
import { prisma } from "@etheria/database";
import { RACES, type RaceId } from "./raceConfigData.js";
import { ensureDefaultWorld } from "./worldService.js";

const genId = () => crypto.randomUUID();

type WorldPoint = { x: number; y: number };

function assertDbOk(result: unknown, context: string) {
  if (!result) return;
  const err = (result as any).error ?? (result as any).err;
  if (err) {
    const msg = typeof err === "string" ? err : (err.message ?? JSON.stringify(err));
    throw new Error(`[DB] ${context}: ${msg}`);
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function withDbRetry<T>(fn: () => Promise<T>, context: string, attempts: number = 3): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res: any = await fn();
      const err = res?.error ?? res?.err;
      if (err) {
        const msg = typeof err === "string" ? err : (err.message ?? JSON.stringify(err));
        throw new Error(msg);
      }
      return res as T;
    } catch (e) {
      lastErr = e;
      await sleep(150 * (i + 1));
    }
  }
  throw new Error(`[DB] ${context}: ${String((lastErr as any)?.message ?? lastErr)}`);
}

export const STARTER_BUILDINGS: { type: BuildingType; x: number; y: number }[] = [...STARTER_BUILDING_LAYOUT];

export const STARTER_UNITS: { type: UnitType; count: number }[] = [
  { type: "WARRIOR", count: 10 },
  { type: "ARCHER", count: 5 },
];

function clampPoint(point: WorldPoint, width: number, height: number, padding: number): WorldPoint {
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  return {
    x: Math.max(-halfW + padding, Math.min(halfW - padding, Math.round(point.x))),
    y: Math.max(-halfH + padding, Math.min(halfH - padding, Math.round(point.y))),
  };
}

function distance(a: WorldPoint, b: WorldPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Rejects spawn points that are on tiny islands: samples a ring of 16 points
// at radius 600px and requires ≥60% to be buildable (enough surrounding land).
function hasSufficientLand(x: number, y: number, mapWidth: number, mapHeight: number): boolean {
  const samples = 16;
  const radius = 600;
  let ok = 0;
  for (let i = 0; i < samples; i++) {
    const angle = (Math.PI * 2 * i) / samples;
    if (isBuildableTerrain(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, mapWidth, mapHeight)) ok++;
  }
  return ok / samples >= 0.6;
}

function isValidCitySpawn(candidate: WorldPoint, occupied: WorldPoint[], minDistance: number, mapWidth: number, mapHeight: number) {
  return isBuildableTerrain(candidate.x, candidate.y, mapWidth, mapHeight)
    && hasSufficientLand(candidate.x, candidate.y, mapWidth, mapHeight)
    && occupied.every((city) => distance(candidate, city) >= minDistance);
}

function hashSeed(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getFallbackSpawn(seed: string, world: WorldConfigDoc): WorldPoint {
  const padding = world.spawn.edgePadding;
  const minX = -Math.floor(world.map.width / 2) + padding;
  const maxX = Math.floor(world.map.width / 2) - padding;
  const minY = -Math.floor(world.map.height / 2) + padding;
  const maxY = Math.floor(world.map.height / 2) - padding;
  const xRange = Math.max(1, maxX - minX + 1);
  const yRange = Math.max(1, maxY - minY + 1);
  const hash = hashSeed(seed);

  const initial = {
    x: minX + (hash % xRange),
    y: minY + (Math.floor(hash / 97) % yRange),
  };
  if (isBuildableTerrain(initial.x, initial.y, world.map.width, world.map.height)) return initial;

  const attempts = Math.max(24, Math.ceil(Math.min(world.map.width, world.map.height) / Math.max(1, world.spawn.clusterSearchStep)));
  for (let i = 1; i <= attempts; i++) {
    const angle = (Math.PI * 2 * ((hash + i * 37) % attempts)) / attempts;
    const radius = Math.min(world.spawn.clusterRadius, world.spawn.clusterSearchStep * i);
    const candidate = clampPoint(
      {
        x: initial.x + Math.cos(angle) * radius,
        y: initial.y + Math.sin(angle) * radius,
      },
      world.map.width,
      world.map.height,
      world.spawn.edgePadding
    );
    if (isBuildableTerrain(candidate.x, candidate.y, world.map.width, world.map.height)) return candidate;
  }

  return isBuildableTerrain(0, 0, world.map.width, world.map.height) ? { x: 0, y: 0 } : initial;
}

function getClusterCenters(occupied: WorldPoint[], config: WorldSpawnConfig) {
  const centers: Array<{ center: WorldPoint; members: WorldPoint[] }> = [];
  for (const point of occupied) {
    const existing = centers.find((cluster) => distance(cluster.center, point) <= config.clusterRadius);
    if (existing) {
      existing.members.push(point);
      existing.center = {
        x: Math.round(existing.members.reduce((sum, p) => sum + p.x, 0) / existing.members.length),
        y: Math.round(existing.members.reduce((sum, p) => sum + p.y, 0) / existing.members.length),
      };
      continue;
    }
    centers.push({ center: { ...point }, members: [point] });
  }
  return centers;
}

function pickClusterSpawn(occupied: WorldPoint[], mapWidth: number, mapHeight: number, config: WorldSpawnConfig): WorldPoint | null {
  const clusters = getClusterCenters(occupied, config)
    .sort((a, b) => a.members.length - b.members.length);

  for (const cluster of clusters) {
    if (cluster.members.length >= config.clusterTargetPlayers) continue;
    for (let i = 0; i < config.maxPlacementAttempts; i++) {
      const angle = (Math.PI * 2 * i) / Math.max(10, config.maxPlacementAttempts);
      const radius = Math.min(config.clusterRadius, config.minCityDistance + i * config.clusterSearchStep * 0.12);
      const candidate = clampPoint(
        {
          x: cluster.center.x + Math.cos(angle) * radius,
          y: cluster.center.y + Math.sin(angle) * radius,
        },
        mapWidth,
        mapHeight,
        config.edgePadding
      );
      if (isValidCitySpawn(candidate, occupied, config.minCityDistance, mapWidth, mapHeight)) return candidate;
    }
  }

  return null;
}

function pickNewClusterSpawn(occupied: WorldPoint[], mapWidth: number, mapHeight: number, config: WorldSpawnConfig): WorldPoint | null {
  const halfW = Math.floor(mapWidth / 2) - config.edgePadding;
  const halfH = Math.floor(mapHeight / 2) - config.edgePadding;
  const rings = Math.max(6, Math.ceil(Math.min(mapWidth, mapHeight) / config.clusterSearchStep));

  for (let ring = 1; ring <= rings; ring++) {
    const radius = ring * config.clusterSearchStep;
    const samples = Math.max(8, ring * 6);
    for (let i = 0; i < samples; i++) {
      const angle = (Math.PI * 2 * i) / samples;
      const candidate = clampPoint(
        {
          x: Math.cos(angle) * Math.min(radius, halfW),
          y: Math.sin(angle) * Math.min(radius, halfH),
        },
        mapWidth,
        mapHeight,
        config.edgePadding
      );
      if (isValidCitySpawn(candidate, occupied, config.minCityDistance, mapWidth, mapHeight)) return candidate;
    }
  }

  return null;
}

export async function allocatePositionForCity(seed: string, worldId?: string): Promise<WorldPoint | null> {
  const world = await getWorldConfig(worldId);
  let occupied: WorldPoint[] = [];

  try {
    const cities = await prisma.city.findMany({
      select: { posX: true, posY: true },
      take: 3000,
    });
    occupied = cities.map((city) => ({ x: city.posX ?? 0, y: city.posY ?? 0 }));
  } catch (error) {
    console.warn(`[cityCreation] Falling back to deterministic spawn because cities lookup failed: ${String((error as any)?.message ?? error)}`);
    return getFallbackSpawn(seed, world);
  }

  if (occupied.length === 0 && isBuildableTerrain(0, 0, world.map.width, world.map.height)) return { x: 0, y: 0 };

  const clusterPoint = pickClusterSpawn(occupied, world.map.width, world.map.height, world.spawn);
  if (clusterPoint) return clusterPoint;

  const newClusterPoint = pickNewClusterSpawn(occupied, world.map.width, world.map.height, world.spawn);
  if (newClusterPoint) return newClusterPoint;

  return null;
}

export async function createStarterCityForUser({
  userId,
  cityName,
  race,
  worldId,
}: {
  userId: string;
  cityName: string;
  race?: string;
  worldId?: string;
}) {
  // Ensure default world exists before creating cities
  await ensureDefaultWorld();

  // Resolve worldId
  let resolvedWorldId = worldId;
  if (!resolvedWorldId) {
    const defaultWorld = await prisma.world.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { sortOrder: "asc" },
    });
    resolvedWorldId = defaultWorld?.id ?? "default";
  }

  const raceConfig = race && race in RACES ? RACES[race as RaceId] : null;
  const now = new Date().toISOString();
  const cityId = genId();

  const position = await allocatePositionForCity(userId, resolvedWorldId);
  if (!position) {
    return { error: "No available world positions" as const };
  }

  const baseGold = 500 + (raceConfig?.bonuses.startingResources.gold ?? 0);
  const baseWood = 500 + (raceConfig?.bonuses.startingResources.wood ?? 0);
  const baseStone = 200 + (raceConfig?.bonuses.startingResources.stone ?? 0);
  const baseFood = 200 + (raceConfig?.bonuses.startingResources.food ?? 0);

  const cityInsert = await db.from(COLLECTIONS.CITIES).insert({
    id: cityId,
    name: cityName,
    userId,
    posX: position.x,
    posY: position.y,
    islandId: null,
    slotId: null,
    worldId: resolvedWorldId,
    gold: baseGold,
    wood: baseWood,
    stone: baseStone,
    food: baseFood,
    gems: 0,
    goldPerHour: 0,
    woodPerHour: 0,
    stonePerHour: 0,
    foodPerHour: 0,
    maxGold: 1000,
    maxWood: 1000,
    maxStone: 500,
    maxFood: 500,
    lastResourceUpdate: now,
    createdAt: now,
    race: raceConfig?.id ?? null,
  });
  assertDbOk(cityInsert, "CITIES.insert()");

  // Insert race bonus buildings first so they take priority on tile positions
  const placedTiles = new Set<string>();
  for (const b of raceConfig?.bonuses.extraBuildings ?? []) {
    const tileKey = `${b.type}`;
    if (placedTiles.has(tileKey)) continue;
    placedTiles.add(tileKey);
    await withDbRetry(
      () =>
        db.from(COLLECTIONS.BUILDINGS).insert({
          id: genId(),
          cityId,
          type: b.type,
          level: b.level,
          positionX: 0,
          positionY: 0,
          createdAt: now,
          upgradedAt: now,
        }) as any,
      "BUILDINGS.insert(race)"
    );
  }

  // Place the tile from STARTER_BUILDINGS for race-upgraded types to avoid duplicates
  const raceUpgradedTypes = new Set((raceConfig?.bonuses.extraBuildings ?? []).map((b) => b.type));
  for (const b of STARTER_BUILDINGS) {
    if (raceUpgradedTypes.has(b.type)) continue;
    await withDbRetry(
      () =>
        db.from(COLLECTIONS.BUILDINGS).insert({
          id: genId(),
          cityId,
          type: b.type,
          level: 1,
          positionX: b.x,
          positionY: b.y,
          createdAt: now,
          upgradedAt: now,
        }) as any,
      "BUILDINGS.insert(starter)"
    );
  }

  const unitMap = new Map<string, number>();
  for (const u of STARTER_UNITS) {
    unitMap.set(u.type, (unitMap.get(u.type) ?? 0) + u.count);
  }
  for (const u of raceConfig?.bonuses.extraUnits ?? []) {
    unitMap.set(u.type, (unitMap.get(u.type) ?? 0) + u.count);
  }
  for (const [type, count] of unitMap) {
    await withDbRetry(
      () =>
        db.from(COLLECTIONS.UNITS).insert({
          id: genId(),
          cityId,
          type,
          count,
        }) as any,
      "UNITS.insert(starter)"
    );
  }

  const buildingsRes = await db.from(COLLECTIONS.BUILDINGS).eq("cityId", cityId).get() as any;
  const stats = calculateCityStats(buildingsRes.data ?? []);

  const prodBonus = raceConfig?.bonuses.productionBonus;
  await mergeRecordByLogicalId(COLLECTIONS.CITIES, cityId, {
    goldPerHour: Math.floor(stats.production.goldPerHour * (prodBonus?.gold ?? 1)),
    woodPerHour: Math.floor(stats.production.woodPerHour * (prodBonus?.wood ?? 1)),
    stonePerHour: Math.floor(stats.production.stonePerHour * (prodBonus?.stone ?? 1)),
    foodPerHour: Math.floor(stats.production.foodPerHour * (prodBonus?.food ?? 1)),
    maxGold: stats.storage.maxGold,
    maxWood: stats.storage.maxWood,
    maxStone: stats.storage.maxStone,
    maxFood: stats.storage.maxFood,
  });

  return { cityId };
}
