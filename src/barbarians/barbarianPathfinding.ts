import type { TerrainSnapshot } from "../sim/worldState.js";
import type { BarbarianGroup, BarbarianUnit } from "../sim/worldState.js";
import {
  PATH_CELL,
  ARRIVE_DIST,
  SHORT_PATH_CELLS,
  SOLDIER_SPEED,
  SNIPER_SPEED,
  buildMacroNavGrid,
  pathCellCost,
  sampleCell,
  getEffectiveSpeed,
  type MacroNavGrid,
} from "../tactics/terrainTactics.js";

const FORMATION_SOLDIER: [number, number][] = [[0, 0.2], [-0.7, 0.55], [0.7, 0.55], [-0.45, -0.2], [0.45, -0.2]];
const FORMATION_SNIPER: [number, number][] = [[-0.55, -0.9], [0.55, -0.9]];

const pathCache = new Map<string, { x: number; y: number }[]>();
const PATH_CACHE_MAX = 600;

let navGrid: MacroNavGrid | null = null;
let navGridKey = "";

function getNavGrid(terrain: TerrainSnapshot): MacroNavGrid {
  const key = `${terrain.seed}:${terrain.cols}x${terrain.rows}`;
  if (!navGrid || navGridKey !== key) {
    navGrid = buildMacroNavGrid(terrain);
    navGridKey = key;
    pathCache.clear();
  }
  return navGrid;
}

export function getTerrainNavGrid(terrain: TerrainSnapshot): MacroNavGrid {
  return getNavGrid(terrain);
}

export function isLandCell(terrain: TerrainSnapshot, x: number, y: number): boolean {
  const grid = getNavGrid(terrain);
  const { blocked } = sampleCell(grid, x, y);
  return !blocked;
}

function isWalkableMacro(grid: MacroNavGrid, x: number, y: number): boolean {
  const col = Math.floor(x), row = Math.floor(y);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  return grid.blocked[row * grid.cols + col] === 0;
}

function nearestWalkable(grid: MacroNavGrid, col: number, row: number, maxR = 32): { col: number; row: number } | null {
  if (col >= 0 && row >= 0 && col < grid.cols && row < grid.rows && !grid.blocked[row * grid.cols + col])
    return { col, row };
  for (let r = 1; r <= maxR; r++) {
    for (let dc = -r; dc <= r; dc++) {
      for (let dr = -r; dr <= r; dr++) {
        if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue;
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
        if (!grid.blocked[nr * grid.cols + nc]) return { col: nc, row: nr };
      }
    }
  }
  return null;
}

function snapWalkable(grid: MacroNavGrid, x: number, y: number, maxR = 12): { x: number; y: number; moved: boolean } {
  if (isWalkableMacro(grid, x, y)) return { x, y, moved: false };
  const near = nearestWalkable(grid, Math.floor(x), Math.floor(y), maxR);
  return near ? { x: near.col + 0.5, y: near.row + 0.5, moved: true } : { x, y, moved: false };
}

/** Whether macro cell at (x,y) is walkable (not water/mountain). */
export function isMacroWalkable(grid: MacroNavGrid, x: number, y: number): boolean {
  return isWalkableMacro(grid, x, y);
}

/** Snap unit to nearest walkable macro cell within maxR rings. */
export function snapToWalkableTerrain(
  grid: MacroNavGrid,
  x: number,
  y: number,
  maxR = 12,
): { x: number; y: number; moved: boolean } {
  return snapWalkable(grid, x, y, maxR);
}

function segmentWalkable(grid: MacroNavGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkableMacro(grid, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

function simplifyPath(grid: MacroNavGrid, path: { x: number; y: number }[]): { x: number; y: number }[] {
  if (path.length <= 2) return path.slice();
  const out = [path[0]];
  let anchor = 0;
  for (let i = 2; i < path.length; i++) {
    if (!segmentWalkable(grid, path[anchor].x, path[anchor].y, path[i].x, path[i].y)) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

function pathLengthCells(path: { x: number; y: number }[], fx: number, fy: number): number {
  let len = Math.hypot(path[0]?.x ?? fx - fx, path[0]?.y ?? fy - fy);
  let px = path[0]?.x ?? fx, py = path[0]?.y ?? fy;
  for (const wp of path) {
    len += Math.hypot(wp.x - px, wp.y - py);
    px = wp.x; py = wp.y;
  }
  return len;
}

export function findPathMacro(
  terrain: TerrainSnapshot,
  fx: number, fy: number,
  tx: number, ty: number,
): { x: number; y: number }[] {
  const grid = getNavGrid(terrain);
  const { cols, rows } = grid;
  const pCols = Math.ceil(cols / PATH_CELL);
  const pRows = Math.ceil(rows / PATH_CELL);

  const toPC = (x: number, y: number) => ({
    c: Math.max(0, Math.min(pCols - 1, Math.floor(x / PATH_CELL))),
    r: Math.max(0, Math.min(pRows - 1, Math.floor(y / PATH_CELL))),
  });
  const toWorld = (c: number, r: number) => ({ x: c * PATH_CELL + PATH_CELL * 0.5, y: r * PATH_CELL + PATH_CELL * 0.5 });

  const pBlocked = (pc: number, pr: number) => pathCellCost(grid, pc, pr, PATH_CELL) === Infinity;

  let { c: sc, r: sr } = toPC(fx, fy);
  let { c: ec, r: er } = toPC(tx, ty);

  if (pBlocked(ec, er)) {
    const near = nearestWalkable(grid, Math.floor(tx), Math.floor(ty));
    if (!near) return [];
    ({ c: ec, r: er } = toPC(near.col + 0.5, near.row + 0.5));
  }
  if (pBlocked(sc, sr)) return [];

  const cacheKey = `${sc},${sr}:${ec},${er}`;
  if (pathCache.has(cacheKey)) {
    const cached = pathCache.get(cacheKey)!.map(p => ({ x: p.x, y: p.y }));
    if (cached.length) cached[cached.length - 1] = { x: tx, y: ty };
    return cached;
  }

  const start = sr * pCols + sc;
  const goal = er * pCols + ec;
  if (start === goal) return [{ x: tx, y: ty }];

  const N = pCols * pRows;
  const gScore = new Float32Array(N); gScore.fill(Infinity);
  const fScore = new Float32Array(N); fScore.fill(Infinity);
  const cameFrom = new Int32Array(N); cameFrom.fill(-1);
  const inOpen = new Uint8Array(N);
  const open = [start];
  inOpen[start] = 1;
  gScore[start] = 0;
  fScore[start] = Math.hypot(ec - sc, er - sr);

  const DIRS: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found = false;
  for (let iter = 0; iter < 40000 && open.length; iter++) {
    let bestI = 0;
    for (let i = 1; i < open.length; i++)
      if (fScore[open[i]] < fScore[open[bestI]]) bestI = i;
    const current = open[bestI];
    open[bestI] = open[open.length - 1];
    open.pop();
    inOpen[current] = 0;
    if (current === goal) { found = true; break; }

    const cc = current % pCols, cr = (current / pCols) | 0;
    for (const [dc, dr] of DIRS) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= pCols || nr >= pRows) continue;
      const cellCost = pathCellCost(grid, nc, nr, PATH_CELL);
      if (!Number.isFinite(cellCost)) continue;
      const ni = nr * pCols + nc;
      const step = (dc && dr ? 1.414 : 1) * cellCost;
      const tg = gScore[current] + step;
      if (tg >= gScore[ni]) continue;
      cameFrom[ni] = current;
      gScore[ni] = tg;
      fScore[ni] = tg + Math.hypot(ec - nc, er - nr);
      if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
    }
  }
  if (!found) return [];

  const raw: { x: number; y: number }[] = [];
  let cur = goal;
  while (cur !== -1) {
    const c = cur % pCols, r = (cur / pCols) | 0;
    raw.push(toWorld(c, r));
    if (cur === start) break;
    cur = cameFrom[cur];
  }
  raw.reverse();
  raw[0] = { x: fx, y: fy };
  raw[raw.length - 1] = { x: tx, y: ty };
  const simplified = simplifyPath(grid, raw);
  const result = simplified.length > 1 ? simplified.slice(1) : [{ x: tx, y: ty }];

  if (pathCache.size >= PATH_CACHE_MAX) pathCache.delete(pathCache.keys().next().value!);
  pathCache.set(cacheKey, result.map(p => ({ x: p.x, y: p.y })));

  return result;
}

function rotateFormation(lx: number, ly: number, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: lx * (-sin) + ly * cos, y: lx * cos + ly * sin };
}

export function getGroupCentroid(units: BarbarianUnit[]): { x: number; y: number } {
  const alive = units.filter(u => u.hp > 0);
  if (!alive.length) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (const u of alive) { cx += u.x; cy += u.y; }
  return { x: cx / alive.length, y: cy / alive.length };
}

function assignFormationOffsets(units: BarbarianUnit[], destX: number, destY: number): void {
  const center = getGroupCentroid(units);
  const angle = Math.atan2(destY - center.y, destX - center.x);
  const soldiers = units.filter(u => u.type === "soldier" && u.hp > 0);
  const snipers = units.filter(u => u.type === "sniper" && u.hp > 0);
  soldiers.forEach((u, i) => {
    const [lx, ly] = FORMATION_SOLDIER[Math.min(i, FORMATION_SOLDIER.length - 1)];
    const r = rotateFormation(lx, ly, angle);
    u.formOX = r.x; u.formOY = r.y;
  });
  snipers.forEach((u, i) => {
    const [lx, ly] = FORMATION_SNIPER[Math.min(i, FORMATION_SNIPER.length - 1)];
    const r = rotateFormation(lx, ly, angle);
    u.formOX = r.x; u.formOY = r.y;
  });
}

export function issueGroupMove(
  group: BarbarianGroup,
  destX: number,
  destY: number,
  terrain: TerrainSnapshot,
): boolean {
  const grid = getNavGrid(terrain);
  const alive = group.units.filter(u => u.hp > 0);
  if (!alive.length) return false;

  const dest = snapWalkable(grid, destX, destY);
  group.tx = dest.x;
  group.ty = dest.y;

  if (alive.length === 1) {
    const u = alive[0];
    group.path = findPathMacro(terrain, u.x, u.y, dest.x, dest.y);
    group.pathIdx = 0;
    u.formOX = 0; u.formOY = 0;
    return group.path.length > 0;
  }

  const center = getGroupCentroid(alive);
  const anchorPath = findPathMacro(terrain, center.x, center.y, dest.x, dest.y);
  if (!anchorPath.length) return false;

  assignFormationOffsets(alive, dest.x, dest.y);
  group.path = anchorPath;
  group.pathIdx = 0;
  return true;
}

export function syncUnitPositionsFromFormation(group: BarbarianGroup): void {
  const alive = group.units.filter(u => u.hp > 0);
  if (!alive.length) return;
  const center = getGroupCentroid(alive);
  for (const u of alive) {
    u.x = center.x + (u.formOX ?? 0);
    u.y = center.y + (u.formOY ?? 0);
  }
}

/** Asigna offsets de formación y coloca unidades (spawn / reposicionamiento). */
export function initGroupFormation(group: BarbarianGroup, facingDestX: number, facingDestY: number): void {
  const alive = group.units.filter(u => u.hp > 0);
  if (!alive.length) return;
  assignFormationOffsets(alive, facingDestX, facingDestY);
  syncUnitPositionsFromFormation(group);
}

/** Rota offsets de formación hacia un destino sin cambiar el centro del grupo. */
export function rotateGroupFormation(group: BarbarianGroup, destX: number, destY: number): void {
  const alive = group.units.filter(u => u.hp > 0);
  if (!alive.length) return;
  assignFormationOffsets(alive, destX, destY);
}

export function advancePathIndex(group: BarbarianGroup, terrain: TerrainSnapshot): void {
  if (!group.path.length) return;
  const center = getGroupCentroid(group.units);
  while (group.pathIdx < group.path.length) {
    const wp = group.path[group.pathIdx];
    if (Math.hypot(wp.x - center.x, wp.y - center.y) > ARRIVE_DIST) break;
    group.pathIdx++;
  }
  const totalLen = pathLengthCells(group.path, center.x, center.y);
  if (totalLen >= SHORT_PATH_CELLS) {
    const grid = getNavGrid(terrain);
    for (let i = group.path.length - 1; i > group.pathIdx; i--) {
      if (segmentWalkable(grid, center.x, center.y, group.path[i].x, group.path[i].y)) {
        group.pathIdx = i;
        break;
      }
    }
  }
}

export { SOLDIER_SPEED, SNIPER_SPEED };

export function unitSpeed(
  type: BarbarianUnit["type"],
  fatigue: number,
  terrain: TerrainSnapshot,
  x: number,
  y: number,
): number {
  const grid = getNavGrid(terrain);
  const cell = sampleCell(grid, x, y);
  return getEffectiveSpeed(type, cell.kind, cell.height, fatigue);
}

/** Reset pathfinding cache (for tests). */
export function resetPathfindingCache(): void {
  navGrid = null;
  navGridKey = "";
  pathCache.clear();
}
