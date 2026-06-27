import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type TerrainKind =
  | "PLAINS" | "FOREST" | "MOUNTAIN" | "WATER" | "ROAD" | "COAST"
  | "DESERT" | "SWAMP" | "TUNDRA" | "HILLS" | "JUNGLE" | "SAVANNA" | "TAIGA";

export type TerrainArea =
  | { id: string; kind: TerrainKind; shape: "rect"; x: number; y: number; w: number; h: number }
  | { id: string; kind: TerrainKind; shape: "circle"; x: number; y: number; r: number };

export type TerrainRule = {
  kind: TerrainKind;
  label: string;
  buildable: boolean;
  walkable: boolean;
  speedMultiplier: number;
};

type WorldTerrainMaskData = {
  columns: number;
  rows: number;
  cells: TerrainKind[];
};

export const TERRAIN_RULES: Record<TerrainKind, TerrainRule> = {
  PLAINS: { kind: "PLAINS", label: "Plains", buildable: true, walkable: true, speedMultiplier: 1 },
  FOREST: { kind: "FOREST", label: "Forest", buildable: true, walkable: true, speedMultiplier: 0.85 },
  MOUNTAIN: { kind: "MOUNTAIN", label: "Mountain", buildable: false, walkable: false, speedMultiplier: 0 },
  WATER: { kind: "WATER", label: "Water", buildable: false, walkable: false, speedMultiplier: 0 },
  ROAD: { kind: "ROAD", label: "Road", buildable: true, walkable: true, speedMultiplier: 1.25 },
  COAST: { kind: "COAST", label: "Coast", buildable: true, walkable: true, speedMultiplier: 0.95 },
  DESERT: { kind: "DESERT", label: "Desert", buildable: true, walkable: true, speedMultiplier: 0.90 },
  SWAMP: { kind: "SWAMP", label: "Swamp", buildable: true, walkable: true, speedMultiplier: 0.70 },
  TUNDRA: { kind: "TUNDRA", label: "Tundra", buildable: true, walkable: true, speedMultiplier: 0.80 },
  HILLS: { kind: "HILLS", label: "Hills", buildable: true, walkable: true, speedMultiplier: 0.80 },
  JUNGLE: { kind: "JUNGLE", label: "Jungle", buildable: true, walkable: true, speedMultiplier: 0.70 },
  SAVANNA: { kind: "SAVANNA", label: "Savanna", buildable: true, walkable: true, speedMultiplier: 0.95 },
  TAIGA: { kind: "TAIGA", label: "Taiga", buildable: true, walkable: true, speedMultiplier: 0.80 },
};

export const LOCAL_TERRAIN_AREAS: TerrainArea[] = [
  { id: "river-west", kind: "WATER", shape: "rect", x: 0, y: 0.08, w: 0.15, h: 0.86 },
  { id: "river-east", kind: "WATER", shape: "rect", x: 0.82, y: 0.05, w: 0.18, h: 0.88 },
  { id: "north-ridge", kind: "MOUNTAIN", shape: "rect", x: 0.05, y: 0, w: 0.9, h: 0.18 },
  { id: "east-ridge", kind: "MOUNTAIN", shape: "rect", x: 0.82, y: 0.22, w: 0.18, h: 0.62 },
  { id: "south-forest", kind: "FOREST", shape: "rect", x: 0.08, y: 0.76, w: 0.84, h: 0.24 },
  { id: "west-forest", kind: "FOREST", shape: "rect", x: 0, y: 0.22, w: 0.22, h: 0.58 },
  { id: "center-road", kind: "ROAD", shape: "circle", x: 0.5, y: 0.5, r: 0.16 },
  { id: "north-road", kind: "ROAD", shape: "rect", x: 0.44, y: 0.18, w: 0.12, h: 0.32 },
  { id: "south-road", kind: "ROAD", shape: "rect", x: 0.45, y: 0.5, w: 0.1, h: 0.32 },
  { id: "west-road", kind: "ROAD", shape: "rect", x: 0.22, y: 0.45, w: 0.28, h: 0.1 },
  { id: "east-road", kind: "ROAD", shape: "rect", x: 0.5, y: 0.45, w: 0.3, h: 0.1 },
  { id: "coast-west", kind: "COAST", shape: "rect", x: 0.12, y: 0.16, w: 0.1, h: 0.72 },
  { id: "coast-east", kind: "COAST", shape: "rect", x: 0.76, y: 0.16, w: 0.08, h: 0.72 },
];

const TERRAIN_KINDS: TerrainKind[] = ["PLAINS", "FOREST", "MOUNTAIN", "WATER", "ROAD", "COAST", "DESERT", "SWAMP", "TUNDRA", "HILLS", "JUNGLE", "SAVANNA", "TAIGA"];
let cachedMask: { mtimeMs: number; data: WorldTerrainMaskData | null } | null = null;

// ── Active procedural terrain ─────────────────────────────────────────────────
// Set by worldTerrainRuntime after generation. Checked first in resolveTerrainAt.
type ProceduralTerrain = { cols: number; rows: number; cells: TerrainKind[] };
let activeProcedural: ProceduralTerrain | null = null;

// ── Navigation grid (pathfinding) ─────────────────────────────────────────────
// A coarse, roughly-square walkability + cost grid downsampled ONCE from the
// procedural terrain (or sampled from resolveTerrainAt when no procedural terrain
// is active, e.g. local dev / tests). A* runs on this with O(1) cell reads, so
// thin rivers and small lakes that sit *between* coarse sample points still block
// movement — fixing routes that used to draw straight lines across water.
type NavGrid = {
  cols: number; rows: number; cellW: number; cellH: number;
  blocked: Uint8Array; cost: Float32Array;
};
let navGrid: NavGrid | null = null;
let navGridDims: { width: number; height: number } | null = null;

// ~300 world-units per nav cell; clamped so A* stays fast on the 80000² world.
const NAV_CELL_TARGET_PX = 300;
const NAV_DIM_MIN = 64;
const NAV_DIM_MAX = 320;
// A nav cell is blocked when this fraction of its sampled sub-tiles is non-walkable.
// 0.4 blocks lakes/oceans/wide rivers (the water players actually see lines cross)
// while letting narrow rivers be forded — avoids stranding camps behind every creek.
const NAV_BLOCK_FRACTION = 0.4;
// ROAD is the fastest terrain; its inverse is the minimum possible cost per world
// unit, which makes the A* heuristic admissible (never over-estimates).
const MAX_SPEED_MULTIPLIER = 1.25;

/** Path cache: keyed by quantized grid coords (static terrain → stable paths). */
const pathCache = new Map<string, { x: number; y: number }[]>();

export function setActiveProceduralTerrain(data: ProceduralTerrain | null) {
  activeProcedural = data;
  // Terrain changed (boot/regeneration/invalidation): drop derived caches so the
  // next path request rebuilds against the new terrain. Single choke point keeps
  // nav grid + cached paths correct across TERRAIN_ALGO_VERSION regenerations.
  navGrid = null;
  navGridDims = null;
  pathCache.clear();
}

function getMaskPath() {
  const candidates = [
    path.resolve(process.cwd(), "src", "data", "world-terrain-mask.json"),
    path.resolve(process.cwd(), "apps", "web", "src", "data", "world-terrain-mask.json"),
    path.resolve(process.cwd(), "..", "web", "src", "data", "world-terrain-mask.json"),
    path.resolve(process.cwd(), "..", "..", "apps", "web", "src", "data", "world-terrain-mask.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function readTerrainMask(): WorldTerrainMaskData | null {
  const maskPath = getMaskPath();
  if (!maskPath) return null;
  const stat = existsSync(maskPath) ? statSync(maskPath) : null;
  if (cachedMask && cachedMask.mtimeMs === stat?.mtimeMs) return cachedMask.data;

  try {
    const raw = JSON.parse(readFileSync(maskPath, "utf8")) as Partial<WorldTerrainMaskData>;
    const columns = Math.max(8, Math.floor(Number(raw.columns) || 0));
    const rows = Math.max(8, Math.floor(Number(raw.rows) || 0));
    const inputCells = Array.isArray(raw.cells) ? raw.cells : [];
    const cells = Array.from({ length: columns * rows }, (_, index) => {
      const value = inputCells[index];
      return TERRAIN_KINDS.includes(value as TerrainKind) ? value as TerrainKind : "PLAINS";
    });
    const data = { columns, rows, cells };
    cachedMask = { mtimeMs: stat?.mtimeMs ?? Date.now(), data };
    return data;
  } catch {
    cachedMask = { mtimeMs: stat?.mtimeMs ?? Date.now(), data: null };
    return null;
  }
}

export function worldToNormalized(x: number, y: number, width: number, height: number) {
  return {
    x: (x + width / 2) / width,
    y: (y + height / 2) / height,
  };
}

export function resolveTerrainAt(x: number, y: number, width: number, height: number): TerrainRule {
  const p = worldToNormalized(x, y, width, height);

  // Check procedural terrain first (registered by worldTerrainRuntime at boot)
  if (activeProcedural) {
    const { cols, rows, cells } = activeProcedural;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(p.x * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(p.y * rows)));
    return TERRAIN_RULES[cells[row * cols + col] ?? "PLAINS"];
  }

  const mask = readTerrainMask();
  if (mask) {
    const col = Math.min(mask.columns - 1, Math.max(0, Math.floor(p.x * mask.columns)));
    const row = Math.min(mask.rows - 1, Math.max(0, Math.floor(p.y * mask.rows)));
    return TERRAIN_RULES[mask.cells[row * mask.columns + col] ?? "PLAINS"];
  }

  for (let i = LOCAL_TERRAIN_AREAS.length - 1; i >= 0; i--) {
    const area = LOCAL_TERRAIN_AREAS[i];
    if (area.shape === "rect") {
      if (p.x >= area.x && p.x <= area.x + area.w && p.y >= area.y && p.y <= area.y + area.h) return TERRAIN_RULES[area.kind];
    } else {
      if (Math.hypot(p.x - area.x, p.y - area.y) <= area.r) return TERRAIN_RULES[area.kind];
    }
  }
  return TERRAIN_RULES.PLAINS;
}

export function isBuildableTerrain(x: number, y: number, width: number, height: number) {
  return resolveTerrainAt(x, y, width, height).buildable;
}

/** Builds the coarse nav grid by downsampling the procedural terrain, or by
 * sampling resolveTerrainAt per cell when no procedural terrain is active. */
function buildNavGrid(width: number, height: number): NavGrid {
  const clamp = (v: number) => Math.max(NAV_DIM_MIN, Math.min(NAV_DIM_MAX, v));
  const cols = clamp(Math.round(width / NAV_CELL_TARGET_PX));
  const rows = clamp(Math.round(height / NAV_CELL_TARGET_PX));
  const cellW = width / cols;
  const cellH = height / rows;
  const blocked = new Uint8Array(cols * rows);
  const cost = new Float32Array(cols * rows);

  if (activeProcedural) {
    // Downsample the high-res procedural grid: a nav cell is blocked when enough
    // of its covered terrain tiles are non-walkable (WATER / MOUNTAIN).
    const { cols: tCols, rows: tRows, cells } = activeProcedural;
    for (let row = 0; row < rows; row++) {
      const r0 = Math.floor((row / rows) * tRows);
      const r1 = Math.max(r0 + 1, Math.floor(((row + 1) / rows) * tRows));
      for (let col = 0; col < cols; col++) {
        const c0 = Math.floor((col / cols) * tCols);
        const c1 = Math.max(c0 + 1, Math.floor(((col + 1) / cols) * tCols));
        let total = 0, blockedCount = 0, minSpeed = Infinity;
        for (let tr = r0; tr < r1 && tr < tRows; tr++) {
          for (let tc = c0; tc < c1 && tc < tCols; tc++) {
            total++;
            const rule = TERRAIN_RULES[cells[tr * tCols + tc] ?? "PLAINS"];
            if (!rule.walkable) blockedCount++;
            else if (rule.speedMultiplier < minSpeed) minSpeed = rule.speedMultiplier;
          }
        }
        const idx = row * cols + col;
        const frac = total > 0 ? blockedCount / total : 1;
        if (total === 0 || frac > NAV_BLOCK_FRACTION || !Number.isFinite(minSpeed)) {
          blocked[idx] = 1; cost[idx] = Infinity;
        } else {
          blocked[idx] = 0; cost[idx] = 1 / Math.max(0.1, minSpeed);
        }
      }
    }
  } else {
    // Fallback: sample resolveTerrainAt at each cell center (local dev / tests).
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = -width / 2 + (col + 0.5) * cellW;
        const y = -height / 2 + (row + 0.5) * cellH;
        const rule = resolveTerrainAt(x, y, width, height);
        const idx = row * cols + col;
        if (!rule.walkable) { blocked[idx] = 1; cost[idx] = Infinity; }
        else { blocked[idx] = 0; cost[idx] = 1 / Math.max(0.1, rule.speedMultiplier); }
      }
    }
  }

  return { cols, rows, cellW, cellH, blocked, cost };
}

/** Returns the cached nav grid, building it if terrain changed or dims differ. */
function getNavGrid(width: number, height: number): NavGrid {
  if (navGrid && navGridDims && navGridDims.width === width && navGridDims.height === height) {
    return navGrid;
  }
  navGrid = buildNavGrid(width, height);
  navGridDims = { width, height };
  return navGrid;
}

function getPathGrid(width: number, height: number) {
  const g = getNavGrid(width, height);
  return { cols: g.cols, rows: g.rows, cellW: g.cellW, cellH: g.cellH };
}

function pointToCell(x: number, y: number, width: number, height: number) {
  const grid = getPathGrid(width, height);
  const normalized = worldToNormalized(x, y, width, height);
  return {
    ...grid,
    col: Math.min(grid.cols - 1, Math.max(0, Math.floor(normalized.x * grid.cols))),
    row: Math.min(grid.rows - 1, Math.max(0, Math.floor(normalized.y * grid.rows))),
  };
}

function cellCenter(col: number, row: number, width: number, height: number) {
  const grid = getPathGrid(width, height);
  return {
    x: -width / 2 + (col + 0.5) * grid.cellW,
    y: -height / 2 + (row + 0.5) * grid.cellH,
  };
}

function findNearestWalkableCell(col: number, row: number, width: number, height: number) {
  const grid = getNavGrid(width, height);
  for (let radius = 0; radius < Math.max(grid.cols, grid.rows); radius++) {
    for (let y = row - radius; y <= row + radius; y++) {
      for (let x = col - radius; x <= col + radius; x++) {
        if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) continue;
        if (Math.abs(x - col) !== radius && Math.abs(y - row) !== radius) continue;
        if (!grid.blocked[y * grid.cols + x]) return { col: x, row: y };
      }
    }
  }
  return null;
}

/** Binary min-heap over (fScore, cellKey) pairs; lazy-deletion friendly. */
class MinHeap {
  private f: number[] = [];
  private k: number[] = [];
  get size() { return this.k.length; }
  push(f: number, k: number) {
    this.f.push(f); this.k.push(k);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): number {
    const topK = this.k[0];
    const lastF = this.f.pop()!, lastK = this.k.pop()!;
    if (this.k.length > 0) {
      this.f[0] = lastF; this.k[0] = lastK;
      const n = this.k.length;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let s = i;
        if (l < n && this.f[l] < this.f[s]) s = l;
        if (r < n && this.f[r] < this.f[s]) s = r;
        if (s === i) break;
        this.swap(i, s); i = s;
      }
    }
    return topK;
  }
  private swap(a: number, b: number) {
    const tf = this.f[a]; this.f[a] = this.f[b]; this.f[b] = tf;
    const tk = this.k[a]; this.k[a] = this.k[b]; this.k[b] = tk;
  }
}

const A_STAR_NEIGHBORS = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
] as const;

/** Core A* on the coarse nav grid. Returns {cost, cameFrom, ...} or null if unreachable. */
function runAStar(fromX: number, fromY: number, toX: number, toY: number, width: number, height: number) {
  const grid = getNavGrid(width, height);
  const startCell = pointToCell(fromX, fromY, width, height);
  const endCell = pointToCell(toX, toY, width, height);
  const start = findNearestWalkableCell(startCell.col, startCell.row, width, height);
  const end = findNearestWalkableCell(endCell.col, endCell.row, width, height);
  if (!start || !end) return null;

  const { cols, rows, cellW, cellH } = grid;
  const n = cols * rows;
  const startKey = start.row * cols + start.col;
  const targetKey = end.row * cols + end.col;

  // Admissible, consistent heuristic in world-cost units: straight-line world
  // distance × the minimum possible cost-per-unit (1 / fastest terrain).
  const MIN_COST = 1 / MAX_SPEED_MULTIPLIER;
  const heuristic = (col: number, row: number) =>
    Math.hypot((end.col - col) * cellW, (end.row - row) * cellH) * MIN_COST;

  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  gScore[startKey] = 0;

  const heap = new MinHeap();
  heap.push(heuristic(start.col, start.row), startKey);

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === targetKey) {
      return { cost: gScore[current], cameFrom, cols, targetKey };
    }
    const col = current % cols;
    const row = (current - col) / cols;
    const curG = gScore[current];

    for (const [dx, dy] of A_STAR_NEIGHBORS) {
      const nc = col + dx, nr = row + dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nextKey = nr * cols + nc;
      if (grid.blocked[nextKey] || closed[nextKey]) continue;
      // No diagonal corner-cutting: a diagonal step is only allowed if both
      // orthogonally-adjacent cells are open, else the straight chord between the
      // two cell centers would clip the water/mountain wedged in the corner.
      if (dx !== 0 && dy !== 0 && (grid.blocked[row * cols + nc] || grid.blocked[nr * cols + col])) continue;
      const stepDist = Math.hypot(dx * cellW, dy * cellH);
      const tentative = curG + stepDist * grid.cost[nextKey];
      if (tentative >= gScore[nextKey]) continue;
      cameFrom[nextKey] = current;
      gScore[nextKey] = tentative;
      heap.push(tentative + heuristic(nc, nr), nextKey);
    }
  }
  return null;
}

function calculateWalkablePathCost(fromX: number, fromY: number, toX: number, toY: number, width: number, height: number) {
  const result = runAStar(fromX, fromY, toX, toY, width, height);
  return result ? result.cost : null;
}

/** True if the straight segment a→b passes through any blocked nav cell — used to
 * keep path simplification (and the rendered line) from cutting across water. */
function segmentCrossesBlocked(ax: number, ay: number, bx: number, by: number, width: number, height: number): boolean {
  const grid = getNavGrid(width, height);
  const dxw = bx - ax, dyw = by - ay;
  const lenCells = Math.hypot(dxw / grid.cellW, dyw / grid.cellH);
  const steps = Math.max(1, Math.ceil(lenCells * 2)); // ~2 samples per cell
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const n = worldToNormalized(ax + dxw * t, ay + dyw * t, width, height);
    const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(n.x * grid.cols)));
    const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(n.y * grid.rows)));
    if (grid.blocked[row * grid.cols + col]) return true;
  }
  return false;
}

/** True when a walkable route exists between the two points (used to gate
 * barbarian destinations so they never march to unreachable / water-locked cells). */
export function isPathReachable(fromX: number, fromY: number, toX: number, toY: number, width: number, height: number) {
  return runAStar(fromX, fromY, toX, toY, width, height) !== null;
}

/**
 * Returns the A* waypoints in world coordinates, routed around WATER and MOUNTAIN.
 * Simplified via Douglas-Peucker (small epsilon → keeps enough waypoints that the
 * client spline can't bow back into water). Falls back to [from, to] on failure.
 */
export function calculateWalkablePath(
  fromX: number, fromY: number, toX: number, toY: number, width: number, height: number
): { x: number; y: number }[] {
  // Quantize to grid cells for cache key
  const grid = getPathGrid(width, height);
  const sc = pointToCell(fromX, fromY, width, height);
  const ec = pointToCell(toX, toY, width, height);
  const cacheKey = `${sc.col},${sc.row}:${ec.col},${ec.row}`;
  if (pathCache.has(cacheKey)) return pathCache.get(cacheKey)!;

  const fallback = [{ x: fromX, y: fromY }, { x: toX, y: toY }];
  const result = runAStar(fromX, fromY, toX, toY, width, height);
  if (!result) { pathCache.set(cacheKey, fallback); return fallback; }

  // Reconstruct grid path from cameFrom
  const { cameFrom, cols, targetKey } = result;
  const rawPath: { x: number; y: number }[] = [];
  let cur = targetKey;
  while (cameFrom[cur] !== -1) {
    const col = cur % cols, row = (cur - col) / cols;
    const c = cellCenter(col, row, width, height);
    rawPath.unshift({ x: Math.round(c.x), y: Math.round(c.y) });
    cur = cameFrom[cur];
  }
  rawPath.unshift({ x: fromX, y: fromY });
  rawPath.push({ x: toX, y: toY });

  // Small epsilon keeps the corridor tight, and the water-aware clear test forbids
  // any simplified chord from cutting across a blocked cell — so neither the line
  // nor the client spline can bow back over a lake.
  const isClear = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    !segmentCrossesBlocked(a.x, a.y, b.x, b.y, width, height);
  const simplified = douglasPeucker(rawPath, Math.min(grid.cellW, grid.cellH) * 0.15, isClear);
  pathCache.set(cacheKey, simplified);
  return simplified;
}

function perpendicularDist(pt: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(pt.x - a.x, pt.y - a.y);
  const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy);
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return Math.hypot(pt.x - cx, pt.y - cy);
}

function douglasPeucker(
  pts: { x: number; y: number }[],
  epsilon: number,
  isClear?: (a: { x: number; y: number }, b: { x: number; y: number }) => boolean
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  // Split when the chord deviates too far OR when collapsing it would cut across
  // blocked terrain. Force a mid split if needed so we always make progress.
  const chordBlocked = isClear ? !isClear(pts[0], pts[pts.length - 1]) : false;
  if (maxDist > epsilon || chordBlocked) {
    if (maxIdx <= 0 || maxIdx >= pts.length - 1) maxIdx = Math.floor((pts.length - 1) / 2);
    const left = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon, isClear);
    const right = douglasPeucker(pts.slice(maxIdx), epsilon, isClear);
    return [...left.slice(0, -1), ...right];
  }
  return [pts[0], pts[pts.length - 1]];
}

export function calculatePathSpeedMultiplier(fromX: number, fromY: number, toX: number, toY: number, width: number, height: number) {
  const straightDistance = Math.max(1, Math.hypot(toX - fromX, toY - fromY));
  const pathCost = calculateWalkablePathCost(fromX, fromY, toX, toY, width, height);
  if (pathCost && Number.isFinite(pathCost)) {
    return Math.max(0.15, Math.min(1.4, straightDistance / pathCost));
  }

  const samples = 12;
  let sum = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    const terrain = resolveTerrainAt(x, y, width, height);
    sum += terrain.walkable ? terrain.speedMultiplier : 0.15;
  }
  return Math.max(0.15, sum / (samples + 1));
}

export function findNearestBuildablePoint(x: number, y: number, width: number, height: number) {
  const start = pointToCell(x, y, width, height);
  const grid = getPathGrid(width, height);
  for (let radius = 0; radius < Math.max(grid.cols, grid.rows); radius++) {
    for (let row = start.row - radius; row <= start.row + radius; row++) {
      for (let col = start.col - radius; col <= start.col + radius; col++) {
        if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
        if (Math.abs(col - start.col) !== radius && Math.abs(row - start.row) !== radius) continue;
        const center = cellCenter(col, row, width, height);
        if (isBuildableTerrain(center.x, center.y, width, height)) return center;
      }
    }
  }
  return { x, y };
}
