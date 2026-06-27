import { getTerrainNavGrid } from "../barbarians/barbarianPathfinding.js";
import { deriveRng, randInt } from "./rng.js";
import type { OutpostCamp, TerrainSnapshot, WorldState } from "./worldState.js";
import {
  formationFitsAt,
  MAP_SECTOR_COUNT,
  sectorIndex,
} from "../mmo/spawn.js";
import {
  getMoveSpeedMultiplier,
  getVisionRadius,
  sampleCell,
} from "../tactics/terrainTactics.js";

export const OUTPOST_RADIUS = 4;
export const OUTPOST_SAFE_RADIUS = 6;
export const OUTPOST_MIN_COUNT = 14;
export const OUTPOST_MAX_COUNT = 18;

const OUTPOST_NAMES = [
  "Avanzada del Norte", "Refugio del Este", "Puesto del Sur", "Guarnición del Oeste",
  "Campamento Bruma", "Avanzada del Río", "Refugio del Bosque", "Puesto del Valle",
  "Guarnición del Paso", "Campamento Aurora", "Avanzada del Lago", "Refugio del Acantilado",
  "Puesto del Cruce", "Guarnición del Prado", "Campamento del Eco", "Avanzada del Horizonte",
  "Refugio del Alba", "Puesto del Crepúsculo", "Guarnición del Viento", "Campamento del Eco",
];

function isOutpostWalkable(
  grid: ReturnType<typeof getTerrainNavGrid>,
  x: number,
  y: number,
): boolean {
  const col = Math.floor(x), row = Math.floor(y);
  if (col < 1 || row < 1 || col >= grid.cols - 1 || row >= grid.rows - 1) return false;
  if (grid.blocked[row * grid.cols + col] !== 0) return false;
  const cell = sampleCell(grid, x, y);
  if (cell.kind === "WATER" || cell.kind === "MOUNTAIN") return false;
  if (getMoveSpeedMultiplier(cell.kind, cell.height) <= 0) return false;
  if (getVisionRadius("soldier", x, y, grid) < 2) return false;
  return formationFitsAt(grid, x, y);
}

function scoreOutpostSite(
  grid: ReturnType<typeof getTerrainNavGrid>,
  x: number,
  y: number,
  pois: { x: number; y: number }[],
): number {
  const cell = sampleCell(grid, x, y);
  const kindScore: Partial<Record<string, number>> = {
    PLAINS: 40, ROAD: 45, SAVANNA: 38, TAIGA: 32, FOREST: 24, DESERT: 28,
    HILLS: 18, TUNDRA: 26, JUNGLE: 14, SWAMP: 8, COAST: 6,
  };
  let score = kindScore[cell.kind] ?? 10;
  for (const poi of pois) {
    const d = Math.hypot(poi.x - x, poi.y - y);
    if (d < 20) score += 15 - d * 0.4;
  }
  return score;
}

function pickSiteInSector(
  grid: ReturnType<typeof getTerrainNavGrid>,
  macroCols: number,
  macroRows: number,
  sector: number,
  existing: OutpostCamp[],
  pois: { x: number; y: number }[],
  rng: () => number,
): { x: number; y: number } | null {
  const candidates: { x: number; y: number; score: number }[] = [];
  const minDist = OUTPOST_SAFE_RADIUS * 2.5;

  for (let row = 2; row < macroRows - 2; row++) {
    for (let col = 2; col < macroCols - 2; col++) {
      const si = sectorIndex(col, row, macroCols, macroRows);
      if (si !== sector) continue;
      const x = col + 0.5, y = row + 0.5;
      if (!isOutpostWalkable(grid, x, y)) continue;
      let tooClose = false;
      for (const o of existing) {
        if (Math.hypot(o.x - x, o.y - y) < minDist) { tooClose = true; break; }
      }
      if (tooClose) continue;
      candidates.push({ x, y, score: scoreOutpostSite(grid, x, y, pois) + rng() * 8 });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, Math.min(5, candidates.length));
  return top[randInt(rng, top.length)]!;
}

export function generateOutposts(
  terrain: TerrainSnapshot,
  seed: number,
  spawnHints?: WorldState["spawnHints"],
  nextIdFn?: () => string,
): Map<string, OutpostCamp> {
  const rng = deriveRng(seed, "outposts");
  const grid = getTerrainNavGrid(terrain);
  const macroCols = terrain.cols;
  const macroRows = terrain.rows;
  const pois = spawnHints?.pois ?? [];
  const count = OUTPOST_MIN_COUNT + randInt(rng, OUTPOST_MAX_COUNT - OUTPOST_MIN_COUNT + 1);
  const outposts = new Map<string, OutpostCamp>();
  const existing: OutpostCamp[] = [];
  let nameIdx = 0;

  const idGen = nextIdFn ?? (() => String(existing.length + 1));

  for (let sector = 0; sector < MAP_SECTOR_COUNT; sector++) {
    const site = pickSiteInSector(grid, macroCols, macroRows, sector, existing, pois, rng);
    if (!site) continue;
    const id = idGen();
    const camp: OutpostCamp = {
      id,
      name: OUTPOST_NAMES[nameIdx++ % OUTPOST_NAMES.length]!,
      x: site.x,
      y: site.y,
      radius: OUTPOST_RADIUS,
      safeRadius: OUTPOST_SAFE_RADIUS,
      sectorIndex: sector,
    };
    outposts.set(id, camp);
    existing.push(camp);
  }

  while (existing.length < count) {
    const sector = randInt(rng, MAP_SECTOR_COUNT);
    const site = pickSiteInSector(grid, macroCols, macroRows, sector, existing, pois, rng);
    if (!site) continue;
    const id = idGen();
    const camp: OutpostCamp = {
      id,
      name: OUTPOST_NAMES[nameIdx++ % OUTPOST_NAMES.length]!,
      x: site.x,
      y: site.y,
      radius: OUTPOST_RADIUS,
      safeRadius: OUTPOST_SAFE_RADIUS,
      sectorIndex: sector,
    };
    outposts.set(id, camp);
    existing.push(camp);
  }

  return outposts;
}

export function getOutpostById(state: WorldState, id: string): OutpostCamp | undefined {
  return state.outposts.get(id);
}

export function distanceToOutpost(outpost: OutpostCamp, x: number, y: number): number {
  return Math.hypot(outpost.x - x, outpost.y - y);
}

export function isInsideOutpostRadius(outpost: OutpostCamp, x: number, y: number): boolean {
  return distanceToOutpost(outpost, x, y) <= outpost.radius;
}

export function isInsideOutpostSafeZone(outpost: OutpostCamp, x: number, y: number): boolean {
  return distanceToOutpost(outpost, x, y) <= outpost.safeRadius;
}

export function isInAnyOutpostSafeZone(state: WorldState, x: number, y: number): boolean {
  for (const o of state.outposts.values()) {
    if (isInsideOutpostSafeZone(o, x, y)) return true;
  }
  return false;
}

export function findNearestOutpost(
  outposts: Map<string, OutpostCamp>,
  x: number,
  y: number,
): OutpostCamp | null {
  let best: OutpostCamp | null = null;
  let bestD = Infinity;
  for (const o of outposts.values()) {
    const d = distanceToOutpost(o, x, y);
    if (d < bestD) { best = o; bestD = d; }
  }
  return best;
}

export function countPlayersAtOutpost(state: WorldState, outpostId: string): number {
  let n = 0;
  for (const squad of state.playerSquads.values()) {
    if (squad.insideOutpostId === outpostId && !squad.wiped) n++;
  }
  return n;
}

export function serializeOutposts(state: WorldState): OutpostCamp[] {
  return [...state.outposts.values()];
}
