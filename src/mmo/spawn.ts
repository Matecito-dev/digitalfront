import { getTerrainNavGrid } from "../barbarians/barbarianPathfinding.js";
import { getPlayerCentroid } from "../sim/playerSquad.js";
import type { OutpostCamp, PlayerSquad, TerrainSnapshot, WorldState } from "../sim/worldState.js";
import {
  getMoveSpeedMultiplier,
  getVisionRadius,
  sampleCell,
  type MacroNavGrid,
} from "../tactics/terrainTactics.js";

const FORMATION: [number, number][] = [
  [0, 0], [-0.75, 0.55], [0.75, 0.55], [-0.45, -0.65], [0.45, -0.65],
];

export const MIN_SPAWN_DISTANCE = 24;
export const MIN_SPAWN_DISTANCE_HIGH_POP = 32;

const SECTOR_COLS = 4;
const SECTOR_ROWS = 2;
export const MAP_SECTOR_COUNT = SECTOR_COLS * SECTOR_ROWS;

export function getMinSpawnDistance(playerCount: number): number {
  return playerCount > 10 ? MIN_SPAWN_DISTANCE_HIGH_POP : MIN_SPAWN_DISTANCE;
}

export function sectorIndex(col: number, row: number, macroCols: number, macroRows: number): number {
  const sc = Math.min(SECTOR_COLS - 1, Math.floor(col / (macroCols / SECTOR_COLS)));
  const sr = Math.min(SECTOR_ROWS - 1, Math.floor(row / (macroRows / SECTOR_ROWS)));
  return sr * SECTOR_COLS + sc;
}

export function countAliveSquadsBySector(
  squads: Iterable<PlayerSquad>,
  macroCols: number,
  macroRows: number,
): number[] {
  const counts = new Array<number>(MAP_SECTOR_COUNT).fill(0);
  for (const squad of squads) {
    if (!squad.units.some(u => u.hp > 0)) continue;
    const c = getPlayerCentroid(squad.units);
    const col = Math.floor(c.x);
    const row = Math.floor(c.y);
    counts[sectorIndex(col, row, macroCols, macroRows)]++;
  }
  return counts;
}

export function leastPopulatedSectors(sectorCounts: number[]): number[] {
  const min = Math.min(...sectorCounts);
  const out: number[] = [];
  for (let i = 0; i < sectorCounts.length; i++) {
    if (sectorCounts[i] === min) out.push(i);
  }
  return out.length ? out : [0];
}

function isWalkableMacro(grid: MacroNavGrid, x: number, y: number): boolean {
  const col = Math.floor(x), row = Math.floor(y);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  return grid.blocked[row * grid.cols + col] === 0;
}

function isSpawnWalkable(grid: MacroNavGrid, x: number, y: number): boolean {
  if (!isWalkableMacro(grid, x, y)) return false;
  const cell = sampleCell(grid, x, y);
  if (cell.kind === "WATER" || cell.kind === "MOUNTAIN") return false;
  if (getMoveSpeedMultiplier(cell.kind, cell.height) <= 0) return false;
  if (getVisionRadius("soldier", x, y, grid) < 2) return false;
  return true;
}

export function formationFitsAt(grid: MacroNavGrid, cx: number, cy: number): boolean {
  for (const [ox, oy] of FORMATION) {
    if (!isSpawnWalkable(grid, cx + ox, cy + oy)) return false;
  }
  return true;
}

function scoreSpawnPoint(
  grid: MacroNavGrid,
  x: number,
  y: number,
  macroCols: number,
  macroRows: number,
): number {
  const cell = sampleCell(grid, x, y);
  const kindScore: Partial<Record<string, number>> = {
    PLAINS: 50, ROAD: 55, SAVANNA: 42, TAIGA: 36, FOREST: 28, DESERT: 32,
    HILLS: 22, TUNDRA: 30, JUNGLE: 18, SWAMP: 12, COAST: 8,
  };
  let score = kindScore[cell.kind] ?? 15;
  const mc = Math.floor(x), mr = Math.floor(y);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const c = mc + dx, r = mr + dy;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) { score -= 4; continue; }
      const k = grid.kinds[r * grid.cols + c];
      if (k === "WATER") score -= 12;
      else if (k === "COAST") score -= 4;
      else if (k === "MOUNTAIN") score -= 8;
      else score += 1;
    }
  }
  const cc = macroCols / 2, cr = macroRows / 2;
  score -= Math.hypot(x - cc, y - cr) * 0.08;
  return score;
}

function distanceToOtherSquads(
  x: number,
  y: number,
  squads: Iterable<PlayerSquad>,
  excludeProfileId?: string,
): number {
  let minDist = Infinity;
  for (const squad of squads) {
    if (excludeProfileId && squad.profileId === excludeProfileId) continue;
    if (!squad.units.some(u => u.hp > 0)) continue;
    const c = getPlayerCentroid(squad.units);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function snapWalkable(grid: MacroNavGrid, x: number, y: number): { x: number; y: number } {
  if (isSpawnWalkable(grid, x, y)) return { x, y };
  for (let r = 1; r <= 12; r++) {
    for (let dc = -r; dc <= r; dc++) {
      for (let dr = -r; dr <= r; dr++) {
        if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue;
        const tx = x + dc, ty = y + dr;
        if (isSpawnWalkable(grid, tx, ty)) return { x: tx, y: ty };
      }
    }
  }
  return { x, y };
}

function searchSpawnCandidates(
  grid: MacroNavGrid,
  macroCols: number,
  macroRows: number,
  squads: Iterable<PlayerSquad>,
  excludeProfileId: string | undefined,
  minDistance: number,
  preferredSectors?: number[],
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  const cc = Math.floor(macroCols / 2), cr = Math.floor(macroRows / 2);
  const maxR = Math.max(macroCols, macroRows);
  const sectorSet = preferredSectors ? new Set(preferredSectors) : null;

  const tryPoint = (x: number, y: number): void => {
    if (sectorSet) {
      const si = sectorIndex(Math.floor(x), Math.floor(y), macroCols, macroRows);
      if (!sectorSet.has(si)) return;
    }
    if (!formationFitsAt(grid, x, y)) return;
    if (distanceToOtherSquads(x, y, squads, excludeProfileId) < minDistance) return;
    const score = scoreSpawnPoint(grid, x, y, macroCols, macroRows);
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  };

  for (let ring = 0; ring < maxR; ring++) {
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (ring > 0 && Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue;
        const col = cc + dc, row = cr + dr;
        if (col < 2 || row < 2 || col >= macroCols - 2 || row >= macroRows - 2) continue;
        tryPoint(col + 0.5, row + 0.5);
      }
    }
    if (best && bestScore >= 55) return best;
  }

  if (best) return best;

  for (let row = 2; row < macroRows - 2; row++) {
    for (let col = 2; col < macroCols - 2; col++) {
      tryPoint(col + 0.5, row + 0.5);
    }
  }
  return best;
}

/** Safe spawn for a new player squad, away from other active squads. */
export function findMultiplayerSpawn(
  terrain: TerrainSnapshot,
  playerSquads: Map<string, PlayerSquad>,
  excludeProfileId?: string,
): { x: number; y: number } {
  const grid = getTerrainNavGrid(terrain);
  const squads = playerSquads.values();
  const macroCols = terrain.cols;
  const macroRows = terrain.rows;

  const aliveCount = [...playerSquads.values()].filter(s =>
    s.units.some(u => u.hp > 0) && s.profileId !== excludeProfileId,
  ).length;
  const minDistance = getMinSpawnDistance(aliveCount + 1);

  const sectorCounts = countAliveSquadsBySector(squads, macroCols, macroRows);
  const preferred = leastPopulatedSectors(sectorCounts);

  const sectorSpawn = searchSpawnCandidates(
    grid, macroCols, macroRows, squads, excludeProfileId, minDistance, preferred,
  );
  if (sectorSpawn) return sectorSpawn;

  const strict = searchSpawnCandidates(
    grid, macroCols, macroRows, squads, excludeProfileId, minDistance,
  );
  if (strict) return strict;

  const relaxed = searchSpawnCandidates(
    grid, macroCols, macroRows, squads, excludeProfileId, minDistance * 0.5,
  );
  if (relaxed) return relaxed;

  for (let row = 0; row < macroRows; row++) {
    for (let col = 0; col < macroCols; col++) {
      const x = col + 0.5, y = row + 0.5;
      if (formationFitsAt(grid, x, y)) return { x, y };
    }
  }

  return snapWalkable(grid, macroCols / 2, macroRows / 2);
}

export interface SpawnOutpostResult {
  outpostId: string;
  x: number;
  y: number;
}

/** Pick outpost for new player or respawn. */
export function pickSpawnOutpost(
  state: WorldState,
  excludeProfileId?: string,
  preferOutpostId?: string | null,
  lastX?: number | null,
  lastY?: number | null,
): SpawnOutpostResult | null {
  const outposts = [...state.outposts.values()];
  if (!outposts.length) {
    const fallback = findMultiplayerSpawn(state.terrain, state.playerSquads, excludeProfileId);
    return { outpostId: "", x: fallback.x, y: fallback.y };
  }

  if (preferOutpostId) {
    const preferred = state.outposts.get(preferOutpostId);
    if (preferred) {
      return { outpostId: preferred.id, x: preferred.x, y: preferred.y };
    }
  }

  if (lastX != null && lastY != null) {
    let best: OutpostCamp | null = null;
    let bestD = Infinity;
    for (const o of outposts) {
      const d = Math.hypot(o.x - lastX, o.y - lastY);
      if (d < bestD) { best = o; bestD = d; }
    }
    if (best) return { outpostId: best.id, x: best.x, y: best.y };
  }

  const macroCols = state.terrain.cols;
  const macroRows = state.terrain.rows;
  const sectorCounts = new Array<number>(MAP_SECTOR_COUNT).fill(0);
  for (const squad of state.playerSquads.values()) {
    if (excludeProfileId && squad.profileId === excludeProfileId) continue;
    if (squad.wiped) continue;
    const c = getPlayerCentroid(squad.units);
    if (!squad.units.some(u => u.hp > 0) && !squad.insideOutpostId) continue;
    const x = squad.insideOutpostId
      ? (state.outposts.get(squad.insideOutpostId)?.x ?? c.x)
      : c.x;
    const y = squad.insideOutpostId
      ? (state.outposts.get(squad.insideOutpostId)?.y ?? c.y)
      : c.y;
    sectorCounts[sectorIndex(Math.floor(x), Math.floor(y), macroCols, macroRows)]++;
  }

  const preferredSectors = leastPopulatedSectors(sectorCounts);
  const candidates = outposts.filter(o => preferredSectors.includes(o.sectorIndex));
  const pool = candidates.length ? candidates : outposts;
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  return { outpostId: pick.id, x: pick.x, y: pick.y };
}
