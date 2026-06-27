import { getWorldConfig } from "./worldConfig.js";
import { generateTerrainData } from "./worldTerrainGenerator.js";
import { rleEncode } from "./worldTerrainGenerator.js";
import { setActiveProceduralTerrain } from "./worldTerrainConfigData.js";
import type { TerrainKind } from "./worldTerrainConfigData.js";
import type { WorldRegion, WorldPOI } from "@etheria/shared";
import { generateRegions, type RegionMapData } from "./worldRegions.js";
import { generatePOIs } from "./worldPOIs.js";

type TerrainCache = {
  rle: Array<[TerrainKind, number]>;
  elev: string; // base64-encoded Uint8Array heights 0–100
  cols: number;
  rows: number;
  regions: WorldRegion[];
  pois: WorldPOI[];
  regionMap: RegionMapData;
};

const cache = new Map<string, TerrainCache>();

export async function ensureWorldTerrain(worldId?: string): Promise<TerrainCache> {
  const key = worldId ?? "local";
  if (cache.has(key)) return cache.get(key)!;

  const worldConfig = await getWorldConfig(worldId);
  const mapCfg = worldConfig.map as any;
  const cols: number = mapCfg.terrainCols ?? 200;
  const rows: number = mapCfg.terrainRows ?? 200;
  const seed: number = mapCfg.terrainSeed ?? 1337;
  const worldWidth: number = mapCfg.width ?? 20000;
  const worldHeight: number = mapCfg.height ?? 20000;

  const { cells, heights } = generateTerrainData(seed, cols, rows);
  const rle = rleEncode(cells);
  const elev = Buffer.from(heights).toString("base64");

  // Register with terrain config so resolveTerrainAt uses the real map
  setActiveProceduralTerrain({ cols, rows, cells });

  const { regions, regionMap } = generateRegions(cells, cols, rows, worldWidth, worldHeight, seed);
  const pois = generatePOIs(cells, heights, cols, rows, worldWidth, worldHeight, seed);

  const entry: TerrainCache = { rle, elev, cols, rows, regions, pois, regionMap };
  cache.set(key, entry);
  return entry;
}

export function invalidateWorldTerrain(worldId?: string) {
  if (worldId) {
    cache.delete(worldId);
  } else {
    cache.clear();
    setActiveProceduralTerrain(null);
  }
}
