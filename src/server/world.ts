import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db, COLLECTIONS } from '../infrastructure/matecito.js';
import { getSeasonState, initializeSeasonState, advanceSeason } from '../domain/seasons.js';
import { LOCAL_WORLD_ZONE_CONFIGS, resolveWorldZone } from '../domain/worldZoneConfigData.js';
import { getWorldConfig } from '../domain/worldConfig.js';
import { getSeasonDurationHours, LOCAL_SEASON_CONFIG } from '../domain/seasonConfigData.js';
import type { Season, WorldZoneSnapshot, UnitType } from '@etheria/shared';
import { getAllActiveCamps, getBarbarianCampDetail, fetchCurrentSeasonState } from '../domain/barbarians.js';
import { requireAdmin } from '../infrastructure/adminMiddleware.js';
import { calculateEstimatedReward } from '../domain/barbarianRewardConfigData.js';
import {
  getWinterPressureSummary,
  DEFAULT_WINTER_PRESSURE_CONFIG,
  ZONE_WINTER_INTENSITY,
} from '../domain/winterPressure.js';
import { AttackBarbarianRequestSchema } from '@etheria/shared';
import { ScoutTargetRequestSchema } from '@etheria/shared';
import { requireMatecitoAuth } from '../infrastructure/authMiddleware.js';
import { calculatePathSpeedMultiplier } from '../domain/worldTerrainConfigData.js';
import { ensureWorldTerrain, invalidateWorldTerrain } from '../domain/worldTerrainRuntime.js';
import { renderTileRaw, renderOverviewRaw, KIND_CODE, CODE_KIND, type TerrainSource } from '../domain/terrainRender.js';
import { initTileStore, tileStoreVersion, readTile, writeTile, readOverview, writeOverview, pruneOldVersions, deleteTileCacheVersion } from '../domain/terrainTileStore.js';
import * as pool from '../domain/tileRenderPool.js';
import { repairWorldEntityPlacements } from '../domain/worldTerrainRepair.js';
import { getUnitStats } from '../domain/units.js';
import { calculateTechBonuses } from '../domain/techs.js';
import { calculateEffectiveProduction } from '../domain/production.js';
import { scoutTarget } from '../domain/scouting.js';
import { listActiveWorlds, getWorldById, ensureDefaultWorld } from '../domain/worldService.js';
import { prisma } from '@etheria/database';

const genId = () => crypto.randomUUID();

export const worldRouter = new Hono();

export const worldsRouter = new Hono();

// ─── GET /worlds — list available worlds ───

worldsRouter.get('/', async (c) => {
  const worlds = await listActiveWorlds();
  return c.json({ worlds });
});

// ─── GET /worlds/:id/config — get world config ───

worldsRouter.get('/:id/config', async (c) => {
  const id = c.req.param('id');
  const world = await getWorldById(id);
  if (!world) return c.json({ error: 'World not found' }, 404);
  return c.json({ config: world.config });
});

worldRouter.post('/scout', requireMatecitoAuth(), zValidator('json', ScoutTargetRequestSchema), async (c) => {
  const result = await scoutTarget(c.get('userId'), c.req.valid('json'));
  if ('error' in result) return c.json({ error: result.error }, result.status as any);
  return c.json(result);
});

// ─── GET /world/season ───

worldRouter.get('/season', async (c) => {
  const worldId = c.req.query('worldId');
  let state = worldId ? await getSeasonState(worldId) : await getSeasonState();
  if (!state) {
    state = await initializeSeasonState(worldId);
  }

  return c.json({ season: state });
});

// ─── GET /world/state ───

worldRouter.get('/state', async (c) => {
  const worldId = c.req.query('worldId');
  let state = worldId ? await getSeasonState(worldId) : await getSeasonState();
  if (!state) {
    state = await initializeSeasonState(worldId);
  }

  const worldConfig = await getWorldConfig(worldId);
  const zones: WorldZoneSnapshot[] = LOCAL_WORLD_ZONE_CONFIGS.map((zone) => ({
    id: zone.id,
    name: zone.name,
    currentIntensity: zone.seasonIntensity[state.currentSeason as Season] ?? 1.0,
    terrainTags: zone.terrainTags,
  }));

  const camps = await getAllActiveCamps(worldId);
  const barbarianCamps = camps.map((camp) => ({
    id: camp.id,
    name: camp.name,
    level: camp.level,
    archetype: camp.archetype,
    posX: camp.posX,
    posY: camp.posY,
    status: camp.status,
    estimatedPower: Math.floor(100 + 50 * (camp.level - 1)),
  }));

  return c.json({
    season: state,
    zones,
    barbarianCamps,
  });
});

// ─── POST /admin/world — create world (admin) ───

worldRouter.post('/admin/world', requireAdmin(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : null;
  if (!slug || slug.length < 2) return c.json({ error: 'Invalid slug' }, 400);
  const name = typeof body.name === 'string' ? body.name.trim() : slug;
  const description = typeof body.description === 'string' ? body.description.trim() : null;

  await ensureDefaultWorld();

  const world = await prisma.world.create({
    data: {
      id: crypto.randomUUID(),
      slug,
      name,
      description,
      status: body.status ?? 'ACTIVE',
      config: body.config ?? {},
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 99,
      playerCount: 0,
    },
  });

  return c.json({ world: { id: world.id, slug: world.slug, name: world.name } }, 201);
});

// ─── PUT /admin/world/:id/config — update world config (admin) ───

worldRouter.put('/admin/world/:id/config', requireAdmin(), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  if (!body.config) return c.json({ error: 'Missing config' }, 400);

  const existing = await prisma.world.findUnique({ where: { id } });
  if (!existing) return c.json({ error: 'World not found' }, 404);

  await prisma.world.update({
    where: { id },
    data: {
      config: body.config,
      name: typeof body.name === 'string' ? body.name : existing.name,
      description: typeof body.description === 'string' ? body.description : existing.description,
      status: typeof body.status === 'string' ? body.status : existing.status,
    },
  });

  return c.json({ success: true });
});

// ─── POST /admin/world/season/advance ───

worldRouter.post('/admin/season/advance', requireAdmin(), async (c) => {
  const state = await advanceSeason();
  return c.json({ season: state });
});

// ─── GET /world/config ───

worldRouter.get('/config', async (c) => {
  const worldId = c.req.query('worldId');
  const worldConfig = await getWorldConfig(worldId);

  return c.json({
    worldId: worldId ?? null,
    map: worldConfig.map,
    spawn: worldConfig.spawn,
    seasonConfig: {
      serverSpeed: LOCAL_SEASON_CONFIG.serverSpeed,
      seasonDurationHours: getSeasonDurationHours(),
      transitionDurationHours: LOCAL_SEASON_CONFIG.transitionDurationHours,
      phaseCurve: LOCAL_SEASON_CONFIG.phaseCurve,
      enabled: LOCAL_SEASON_CONFIG.enabled,
    },
    zones: LOCAL_WORLD_ZONE_CONFIGS,
  });
});

// ─── GET /world/regions ───

worldRouter.get('/regions', async (c) => {
  const worldId = c.req.query('worldId');
  const terrain = await ensureWorldTerrain(worldId);
  return c.json({ regions: terrain.regions });
});

// ─── GET /world/region-map ───

worldRouter.get('/region-map', async (c) => {
  const worldId = c.req.query('worldId');
  const terrain = await ensureWorldTerrain(worldId);
  return c.json(terrain.regionMap);
});

// ─── GET /world/points-of-interest ───

worldRouter.get('/points-of-interest', async (c) => {
  const worldId = c.req.query('worldId');
  const terrain = await ensureWorldTerrain(worldId);
  return c.json({ pois: terrain.pois });
});

// ─── GET /world/barbarians ───

worldRouter.get('/barbarians', async (c) => {
  const camps = await getAllActiveCamps();
  const barbarianCamps = camps.map((camp) => ({
    id: camp.id,
    name: camp.name,
    level: camp.level,
    archetype: camp.archetype,
    posX: camp.posX,
    posY: camp.posY,
    zoneId: camp.zoneId,
    status: camp.status,
    estimatedPower: Math.floor(100 + 50 * (camp.level - 1)),
    spawnedAt: camp.spawnedAt,
  }));

  return c.json({ camps: barbarianCamps });
});

// ─── GET /world/barbarians/:id ───

worldRouter.get('/barbarians/:id', async (c) => {
  const id = c.req.param('id');
  const detail = await getBarbarianCampDetail(id);

  if (!detail) {
    return c.json({ error: 'Barbarian camp not found' }, 404);
  }

  return c.json({
    camp: detail.camp,
    army: detail.army,
    estimatedReward: detail.estimatedReward,
  });
});

// ─── POST /world/barbarians/:id/attack ───

worldRouter.post('/barbarians/:id/attack', requireMatecitoAuth(), zValidator('json', AttackBarbarianRequestSchema), async (c) => {
  const campId = c.req.param('id');
  const data = c.req.valid('json');

  // Fetch attacker city
  const cityRes = await db.from(COLLECTIONS.CITIES).eq('id', data.cityId).getFirst() as any;
  const city = cityRes.data;
  if (!city) return c.json({ error: 'City not found' }, 404);
  if (city.userId !== c.get('userId')) return c.json({ error: 'Not your city' }, 403);

  // Fetch barbarian camp
  const campRes = await db.from(COLLECTIONS.BARBARIAN_CAMPS).eq('id', campId).getFirst() as any;
  const camp = campRes.data;
  if (!camp) return c.json({ error: 'Barbarian camp not found' }, 404);
  if (camp.status !== 'ACTIVE') return c.json({ error: 'Camp is not active' }, 400);

  // Fetch barbarian army
  const armyRes = await db.from(COLLECTIONS.BARBARIAN_ARMIES).eq('campId', campId).getFirst() as any;
  const army = armyRes.data;
  if (!army) return c.json({ error: 'Barbarian army not found' }, 404);

  // Fetch attacker units
  const unitsRes = await db.from(COLLECTIONS.UNITS).eq('cityId', data.cityId).get() as any;
  const cityUnits = unitsRes.data ?? [];

  // Validate attacker has enough units
  for (const unit of data.units) {
    const available = cityUnits.find((u: any) => u.type === unit.type);
    if (!available || available.count < unit.count) {
      return c.json({ error: `Not enough ${unit.type}` }, 400);
    }
  }

  // Fetch city tech bonuses for speed calculation
  const cityTechsRes = await db.from(COLLECTIONS.CITY_TECHS).eq('cityId', data.cityId).get() as any;
  const cityTechs = cityTechsRes.data ?? [];
  const techBonuses = calculateTechBonuses(cityTechs.map((tech: any) => ({ techId: tech.techId, level: tech.level })));

  // Calculate travel time (distance from city to camp)
  const speeds = data.units.map((u) => getUnitStats(u.type as UnitType, 1, techBonuses).speed);
  const minSpeed = Math.min(...speeds);
  const distance = Math.sqrt(
    Math.pow(camp.posX - city.posX, 2) + Math.pow(camp.posY - city.posY, 2)
  );
  const world = await getWorldConfig(city.worldId);
  const terrainSpeed = calculatePathSpeedMultiplier(city.posX, city.posY, camp.posX, camp.posY, world.map.width, world.map.height);
  const travelTime = Math.max(10, Math.floor(distance / Math.max(1, minSpeed * terrainSpeed) * 60)); // seconds, min 10s

  const now = new Date();
  const arrivesAt = new Date(now.getTime() + travelTime * 1000).toISOString();
  const battleId = genId();

  // Create barbarian battle
  await db.from(COLLECTIONS.BARBARIAN_BATTLES).insert({
    id: battleId,
    attackerCityId: data.cityId,
    targetCampId: campId,
    status: 'MARCHING',
    startedAt: now.toISOString(),
    arrivesAt,
    units: data.units.map((u) => ({ type: u.type, count: u.count })),
  });

  // Subtract units from attacker city
  for (const unit of data.units) {
    const existing = cityUnits.find((u: any) => u.type === unit.type);
    if (existing) {
      await db.from(COLLECTIONS.UNITS)
        .eq('id', existing.id)
        .merge({ count: existing.count - unit.count })
        .execute();
    }
  }

  return c.json({ battleId, travelTime, arrivesAt });
});

// ─── GET /world/barbarian-alerts/:cityId ───

worldRouter.get('/barbarian-alerts/:cityId', requireMatecitoAuth(), async (c) => {
  const cityId = c.req.param('cityId');

  const ownerRes = await db.from(COLLECTIONS.CITIES).eq('id', cityId).getFirst() as any;
  if (!ownerRes.data) return c.json({ error: 'City not found' }, 404);
  if (ownerRes.data.userId !== c.get('userId')) return c.json({ error: 'Not your city' }, 403);

  const alertsRes = await db.from(COLLECTIONS.BARBARIAN_ATTACK_ALERTS)
    .eq('cityId', cityId)
    .get() as any;

  const alerts = (alertsRes.data ?? []).map((a: any) => ({
    id: a.id,
    cityId: a.cityId,
    campId: a.campId,
    campName: a.campName,
    archetype: a.archetype,
    estimatedPower: a.estimatedPower,
    arrivesAt: a.arrivesAt,
    warnedAt: a.warnedAt,
    read: a.read,
  }));

  return c.json({ alerts });
});

// ─── POST /world/barbarian-alerts/:id/read ───

worldRouter.post('/barbarian-alerts/:id/read', requireMatecitoAuth(), async (c) => {
  const id = c.req.param('id');

  const alertRes = await db.from(COLLECTIONS.BARBARIAN_ATTACK_ALERTS).eq('id', id).getFirst() as any;
  if (!alertRes.data) return c.json({ error: 'Alert not found' }, 404);
  const alertCityRes = await db.from(COLLECTIONS.CITIES).eq('id', alertRes.data.cityId).getFirst() as any;
  if (alertCityRes.data?.userId !== c.get('userId')) return c.json({ error: 'Not your alert' }, 403);

  await db.from(COLLECTIONS.BARBARIAN_ATTACK_ALERTS)
    .eq('id', id)
    .merge({ read: true })
    .execute() as any;

  return c.json({ success: true });
});

// ─── GET /world/winter-pressure/:cityId ───

worldRouter.get('/winter-pressure/:cityId', requireMatecitoAuth(), async (c) => {
  const cityId = c.req.param('cityId');

  const cityRes = await db.from(COLLECTIONS.CITIES).eq('id', cityId).getFirst() as any;
  const city = cityRes.data;
  if (!city) return c.json({ error: 'City not found' }, 404);
  if (city.userId !== c.get('userId')) return c.json({ error: 'Not your city' }, 403);

  const worldConfig = await getWorldConfig();
  const zone = resolveWorldZone(city.posX ?? 0, city.posY ?? 0, worldConfig.map.width, worldConfig.map.height);

  const unitsRes = await db.from(COLLECTIONS.UNITS).eq('cityId', cityId).get() as any;
  const units: Record<string, number> = {};
  for (const u of unitsRes.data ?? []) {
    units[u.type] = (units[u.type] ?? 0) + u.count;
  }

  const seasonState = await fetchCurrentSeasonState();
  const isWinter = seasonState?.currentSeason === 'WINTER';

  const effective = await calculateEffectiveProduction({
    goldPerHour: city.goldPerHour ?? 0,
    woodPerHour: city.woodPerHour ?? 0,
    stonePerHour: city.stonePerHour ?? 0,
    foodPerHour: city.foodPerHour ?? 0,
  }, {
    techBonuses: city.techBonuses,
    allianceEffects: [], // Simplified for summary endpoint
    seasonState,
    cityPosX: city.posX ?? 0,
    cityPosY: city.posY ?? 0,
  });

  const summary = getWinterPressureSummary(
    city,
    effective.production.foodPerHour,
    units as any,
    DEFAULT_WINTER_PRESSURE_CONFIG
  );

  return c.json({
    cityId,
    zone: {
      id: zone.id,
      name: zone.name,
      intensity: ZONE_WINTER_INTENSITY[zone.id] ?? 1.0,
    },
    isWinter,
    currentSeason: seasonState?.currentSeason,
    hourlyConsumption: summary.hourlyConsumption,
    effectiveProduction: summary.effectiveProduction,
    netFoodPerHour: summary.netFoodPerHour,
    hoursUntilStarvation: summary.hoursUntilStarvation,
    currentFood: city.food,
    minimumReserve: DEFAULT_WINTER_PRESSURE_CONFIG.minimumFoodReserve,
    winterState: city.winterState ?? null,
    lastWinterEvaluatedAt: city.lastWinterEvaluatedAt ?? null,
  });
});

worldRouter.post('/admin/repair-terrain', requireAdmin(), async (c) => {
  const result = await repairWorldEntityPlacements();
  return c.json({ ok: true, ...result });
});

// ─── GET /world/terrain — Procedural terrain grid (RLE-compressed + elevation) ───

// Keep export for backward-compat with adminOps (will migrate to invalidateWorldTerrain)
export const terrainCache = { clear: () => {} };

worldRouter.get('/terrain', async (c) => {
  const worldId = c.req.query('worldId') ?? 'local';
  const result = await ensureWorldTerrain(worldId === 'local' ? undefined : worldId);
  return c.json(result);
});

// ─── Terrain source cache (decoded cells + heights as Uint8Arrays) ────────────

const terrainImageCache = new Map<string, Buffer>();
const terrainTileCache = new Map<string, Buffer>(); // LRU memory cache
const TILE_CACHE_MAX = 1200;
const TILE_PX = 256;
const TILE_ZMAX = 9;

const decodedTerrainCache = new Map<string, TerrainSource>();

async function getTerrainSource(worldId: string): Promise<TerrainSource> {
  let src = decodedTerrainCache.get(worldId);
  if (!src) {
    const terrain = await ensureWorldTerrain(worldId === 'local' ? undefined : worldId);
    const cellsArr: number[] = [];
    for (const [kind, count] of terrain.rle) {
      const code = KIND_CODE[kind] ?? 0;
      for (let i = 0; i < count; i++) cellsArr.push(code);
    }
    const cellsCode = new Uint8Array(cellsArr);
    const heightsBuf = Buffer.from(terrain.elev, 'base64');
    const heights = new Uint8Array(heightsBuf);
    const m = terrain as any;
    const seed = m.seed ?? m.terrainSeed ?? 0;
    const version = tileStoreVersion(seed, terrain.cols, terrain.rows, m.width ?? terrain.cols, m.height ?? terrain.rows);
    src = { cellsCode, heights, cols: terrain.cols, rows: terrain.rows, version };
    decodedTerrainCache.set(worldId, src);
  }
  return src;
}

// ─── GET /world/terrain-image ────────────────────────────────────────────────

worldRouter.get('/terrain-image', async (c) => {
  const worldId = c.req.query('worldId') ?? 'local';
  const variant = c.req.query('variant') ?? 'default';
  const memKey = `${worldId}:${variant}`;

  if (terrainImageCache.has(memKey)) {
    const buf = terrainImageCache.get(memKey)!;
    return new Response(buf.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': String(buf.length) },
    });
  }

  await initTileStore();
  const src = await getTerrainSource(worldId);
  pool.ensurePool(src);

  // Disk cache check
  let buf = await readOverview(src.version, variant);

  if (!buf) {
    try {
      buf = await pool.renderOverview(variant);
    } catch (err) {
      // Fallback: render in main thread
      const { default: sharp } = await import('sharp');
      const { raw, imgW, imgH } = renderOverviewRaw(src, variant);
      const targetSize = variant === 'mobile' ? 1600 : 3600;
      const blurAmount = 0.5;
      const quality = variant === 'mobile' ? 72 : 80;
      buf = await sharp(raw, { raw: { width: imgW, height: imgH, channels: 3 } })
        .resize(targetSize, targetSize, { kernel: 'lanczos3' })
        .blur(blurAmount)
        .webp({ quality, effort: 2 })
        .toBuffer();
    }
    writeOverview(src.version, variant, buf).catch(() => {});
  }

  terrainImageCache.set(memKey, buf);
  return new Response(buf.buffer as ArrayBuffer, {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': String(buf.length) },
  });
});

// ─── GET /world/terrain-tile/:z/:x/:y ────────────────────────────────────────

worldRouter.get('/terrain-tile/:z/:x/:y', async (c) => {
  const worldId = c.req.query('worldId') ?? 'local';
  const z = Number(c.req.param('z'));
  const tx = Number(c.req.param('x'));
  const ty = Number(c.req.param('y').replace(/\.webp$/, ''));
  const span = 1 << z;
  if (!Number.isInteger(z) || z < 0 || z > TILE_ZMAX
    || !Number.isInteger(tx) || tx < 0 || tx >= span
    || !Number.isInteger(ty) || ty < 0 || ty >= span) {
    return c.json({ error: 'bad tile coords' }, 400);
  }

  const memKey = `${worldId}:${z}:${tx}:${ty}`;
  let buf = terrainTileCache.get(memKey);
  if (buf) {
    terrainTileCache.delete(memKey);
    terrainTileCache.set(memKey, buf);
    return new Response(buf.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': String(buf.length) },
    });
  }

  await initTileStore();
  const src = await getTerrainSource(worldId);
  pool.ensurePool(src);

  buf = await readTile(src.version, z, tx, ty) ?? undefined;

  if (!buf) {
    try {
      buf = await pool.renderTile(z, tx, ty);
    } catch {
      // Fallback: render in main thread — serve at full 512px, no downscale
      const { default: sharp } = await import('sharp');
      const dim = TILE_PX * 2; // 512
      const raw = renderTileRaw(src, z, tx, ty);
      buf = await sharp(raw, { raw: { width: dim, height: dim, channels: 3 } })
        .webp({ quality: 88, effort: 2 })
        .toBuffer();
    }
    writeTile(src.version, z, tx, ty, buf).catch(() => {});
  }

  terrainTileCache.set(memKey, buf);
  while (terrainTileCache.size > TILE_CACHE_MAX) {
    const oldest = terrainTileCache.keys().next().value;
    if (oldest === undefined) break;
    terrainTileCache.delete(oldest);
  }

  return new Response(buf.buffer as ArrayBuffer, {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': String(buf.length) },
  });
});

// ─── Pre-warm tiles in background ────────────────────────────────────────────

const WATER_CODE = KIND_CODE['WATER'] ?? 0;

function isAllWater(src: TerrainSource, z: number, tx: number, ty: number): boolean {
  const { cellsCode, cols, rows } = src;
  const span = 1 << z;
  const cellsPerTile = cols / span;
  const cell0X = tx * cellsPerTile;
  const cell0Y = ty * cellsPerTile;
  const probeStep = cellsPerTile / 8;
  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 8; px++) {
      const col = Math.floor(cell0X + px * probeStep);
      const row = Math.floor(cell0Y + py * probeStep);
      if (cellsCode[Math.max(0, Math.min(rows - 1, row)) * cols + Math.max(0, Math.min(cols - 1, col))] !== WATER_CODE) return false;
    }
  }
  return true;
}

export async function prewarmTiles(worldId = 'local', opts?: { force?: boolean }): Promise<void> {
  await initTileStore();
  const src = await getTerrainSource(worldId);
  // On force-reset, delete the entire version directory so every tile re-renders.
  if (opts?.force) await deleteTileCacheVersion(src.version);
  pool.ensurePool(src);

  // Overviews first
  for (const variant of ['default', 'mobile']) {
    const existing = await readOverview(src.version, variant);
    if (!existing) {
      try {
        const buf = await pool.renderOverview(variant);
        await writeOverview(src.version, variant, buf);
        terrainImageCache.set(`${worldId}:${variant}`, buf);
      } catch {}
    } else {
      terrainImageCache.set(`${worldId}:${variant}`, existing);
    }
  }

  const PREWARM_ZMAX = 8;
  const CONCURRENCY = 2;

  for (let z = 0; z <= PREWARM_ZMAX; z++) {
    const span = 1 << z;
    const tasks: Array<() => Promise<void>> = [];

    for (let ty = 0; ty < span; ty++) {
      for (let tx = 0; tx < span; tx++) {
        const _tx = tx, _ty = ty;
        tasks.push(async () => {
          const memKey = `${worldId}:${z}:${_tx}:${_ty}`;
          if (terrainTileCache.has(memKey)) return;
          const existing = await readTile(src.version, z, _tx, _ty);
          if (existing) {
            terrainTileCache.set(memKey, existing);
            while (terrainTileCache.size > TILE_CACHE_MAX) {
              const oldest = terrainTileCache.keys().next().value;
              if (oldest === undefined) break;
              terrainTileCache.delete(oldest);
            }
            return;
          }
          if (isAllWater(src, z, _tx, _ty)) return;
          try {
            const buf = await pool.renderTile(z, _tx, _ty);
            await writeTile(src.version, z, _tx, _ty, buf);
            terrainTileCache.set(memKey, buf);
            while (terrainTileCache.size > TILE_CACHE_MAX) {
              const oldest = terrainTileCache.keys().next().value;
              if (oldest === undefined) break;
              terrainTileCache.delete(oldest);
            }
          } catch {}
        });
      }
    }

    // Run in batches of CONCURRENCY
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      await Promise.all(tasks.slice(i, i + CONCURRENCY).map(t => t()));
    }
    console.log(`[prewarm] z=${z} done (${tasks.length} tiles)`);
  }

  console.log('[prewarm] complete');
  pruneOldVersions(2).catch(() => {});
}

export function invalidateTerrainImageCache(worldId?: string) {
  if (worldId) {
    terrainImageCache.delete(`${worldId}:default`);
    terrainImageCache.delete(`${worldId}:mobile`);
    decodedTerrainCache.delete(worldId);
    for (const k of [...terrainTileCache.keys()]) {
      if (k.startsWith(`${worldId}:`)) terrainTileCache.delete(k);
    }
  } else {
    terrainImageCache.clear();
    decodedTerrainCache.clear();
    terrainTileCache.clear();
  }
  pool.disposePool().catch(() => {});
  pruneOldVersions(1).catch(() => {});
}
