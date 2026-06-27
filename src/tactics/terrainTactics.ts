/**
 * Shared terrain tactics: movement costs, vision, LOS.
 * Used by barbarian sim and viewer (via viewer/terrain-tactics.js mirror).
 */
import type { TerrainKind } from "../worldgen/worldTerrainConfigData.js";
import { TERRAIN_RULES } from "../worldgen/worldTerrainConfigData.js";
import type { TerrainSnapshot } from "../sim/worldState.js";
import { BIOME_IDS } from "../worldgen/tileBinary.js";

export const SEA_LEVEL = 20;
export const PATH_CELL = 2;

/** Tactical march speeds (macro cells / second). */
export const SOLDIER_SPEED = 2.6;
export const SNIPER_SPEED = 2.2;

export const STEALTH_SPEED_MULT = 0.55;
export const STEALTH_DETECT_MULT = 0.65;
export const HIGH_GROUND_DAMAGE_MULT = 1.2;
export const FLANK_DAMAGE_MULT = 1.15;
export const FLANK_ARC_DEG = 120;
export const FATIGUE_MARCH_MS = 60_000;
export const FATIGUE_SPEED_PENALTY = 0.05;
export const SUPPRESSION_DURATION_MS = 2000;
export const SUPPRESSION_ACCURACY_PENALTY = 0.25;

export const ACCEL_TIME_SEC = 0.35;
export const DECEL_TIME_SEC = 0.25;
export const ARRIVE_DIST = 0.12;
/** Below this path length (cells), skip aggressive LOS path skipping. */
export const SHORT_PATH_CELLS = 3;

export const VISION_SOLDIER_BASE = 6;
export const VISION_SNIPER_BASE = 10;
export const SNIPER_RANGE_BASE = 10;
/** Alcance de fusil de asalto (macro celdas). MMORTS moderno — no cuerpo a cuerpo. */
export const SOLDIER_RIFLE_RANGE = 7;
/** @deprecated Alias histórico — usar SOLDIER_RIFLE_RANGE */
export const SOLDIER_MELEE_RANGE = SOLDIER_RIFLE_RANGE;

/** How open the biome is for spotting (observer standing in this biome). */
export const VISION_MULT: Record<TerrainKind, number> = {
  PLAINS: 1.0,
  ROAD: 1.0,
  COAST: 1.0,
  SAVANNA: 1.05,
  DESERT: 1.10,
  FOREST: 0.55,
  TAIGA: 0.70,
  TUNDRA: 0.90,
  HILLS: 1.15,
  JUNGLE: 0.45,
  SWAMP: 0.60,
  MOUNTAIN: 0,
  WATER: 0,
};

/** How visible a unit is when standing in this biome (target concealment). */
export const CONCEAL_MULT: Record<TerrainKind, number> = {
  PLAINS: 1.0,
  ROAD: 1.0,
  COAST: 1.0,
  SAVANNA: 0.95,
  DESERT: 1.05,
  FOREST: 0.85,
  TAIGA: 0.90,
  TUNDRA: 0.95,
  HILLS: 1.0,
  JUNGLE: 0.75,
  SWAMP: 0.80,
  MOUNTAIN: 1.0,
  WATER: 1.0,
};

export const DENSE_VISION_KINDS = new Set<TerrainKind>(["FOREST", "JUNGLE", "SWAMP"]);
export const AMBUSH_KINDS = new Set<TerrainKind>(["FOREST", "JUNGLE"]);

export const SEASON_VISION: Record<string, number> = {
  SPRING: 1, SUMMER: 1.05, AUTUMN: 0.95, WINTER: 0.85,
};
export const PHASE_VISION: Record<string, number> = { START: 1, PEAK: 1, TRANSITION: 0.92 };

export function getSeasonVisionMult(season: string, phase: string): number {
  return (SEASON_VISION[season] ?? 1) * (PHASE_VISION[phase] ?? 1);
}

export function isAmbushTerrain(kind: TerrainKind): boolean {
  return AMBUSH_KINDS.has(kind);
}

export function heightAdvantage(attackerH: number, targetH: number): number {
  const diff = attackerH - targetH;
  if (diff >= 8) return 1.25;
  if (diff >= 4) return 1.12;
  return 1;
}

const NON_WALKABLE = new Set<TerrainKind>(["WATER", "MOUNTAIN"]);

export type MacroNavGrid = {
  cols: number;
  rows: number;
  blocked: Uint8Array;
  moveCost: Float32Array;
  kinds: (TerrainKind | null)[];
  heights: Uint8Array;
};

export function biomeFromOverviewIndex(idx: number): TerrainKind {
  return BIOME_IDS[idx] ?? "PLAINS";
}

export function heightMoveMult(h: number): number {
  if (h >= 70) return 0.65;
  if (h >= 50) return 0.80;
  if (h <= SEA_LEVEL + 5) return 0.95;
  return 1.0;
}

export function getMoveSpeedMultiplier(kind: TerrainKind, height: number): number {
  const rule = TERRAIN_RULES[kind];
  if (!rule?.walkable || rule.speedMultiplier <= 0) return 0;
  return rule.speedMultiplier * heightMoveMult(height);
}

export function getVisionMult(kind: TerrainKind): number {
  return VISION_MULT[kind] ?? 1;
}

export function getConcealMult(kind: TerrainKind): number {
  return CONCEAL_MULT[kind] ?? 1;
}

function cellIndex(grid: MacroNavGrid, col: number, row: number): number {
  return row * grid.cols + col;
}

export function sampleCell(grid: MacroNavGrid, x: number, y: number): {
  col: number;
  row: number;
  kind: TerrainKind;
  height: number;
  blocked: boolean;
  moveCost: number;
} {
  const col = Math.max(0, Math.min(grid.cols - 1, Math.floor(x)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor(y)));
  const i = cellIndex(grid, col, row);
  const kind = grid.kinds[i] ?? "PLAINS";
  const height = grid.heights[i];
  const blocked = grid.blocked[i] === 1;
  const moveCost = grid.moveCost[i];
  return { col, row, kind, height, blocked, moveCost };
}

export function buildMacroNavGrid(terrain: TerrainSnapshot): MacroNavGrid {
  const { cols, rows, cells, heights } = terrain;
  const blocked = new Uint8Array(cols * rows);
  const moveCost = new Float32Array(cols * rows);
  const kinds: (TerrainKind | null)[] = new Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const kind = cells[i];
      const h = heights[i];
      kinds[i] = kind;
      const unwalkable = heights[i] < SEA_LEVEL || NON_WALKABLE.has(kind);
      blocked[i] = unwalkable ? 1 : 0;
      if (unwalkable) {
        moveCost[i] = Infinity;
      } else {
        const speed = getMoveSpeedMultiplier(kind, h);
        moveCost[i] = speed > 0 ? 1 / speed : Infinity;
      }
    }
  }

  return { cols, rows, blocked, moveCost, kinds, heights };
}

/** Build nav grid from overview.bin biome indices mapped to macro resolution. */
export function buildOverviewNavGrid(
  biome: Uint8Array,
  heights: Uint8Array,
  ovCols: number,
  ovRows: number,
  macroCols: number,
  macroRows: number,
): MacroNavGrid {
  const blocked = new Uint8Array(macroCols * macroRows);
  const moveCost = new Float32Array(macroCols * macroRows);
  const kinds: (TerrainKind | null)[] = new Array(macroCols * macroRows);
  const macroHeights = new Uint8Array(macroCols * macroRows);

  for (let row = 0; row < macroRows; row++) {
    for (let col = 0; col < macroCols; col++) {
      const oc = Math.min(ovCols - 1, Math.floor(col * ovCols / macroCols));
      const or = Math.min(ovRows - 1, Math.floor(row * ovRows / macroRows));
      const oi = or * ovCols + oc;
      const kind = biomeFromOverviewIndex(biome[oi]);
      const h = heights[oi];
      const i = row * macroCols + col;
      kinds[i] = kind;
      macroHeights[i] = h;
      const unwalkable = h <= SEA_LEVEL + 2 || NON_WALKABLE.has(kind);
      blocked[i] = unwalkable ? 1 : 0;
      if (unwalkable) {
        moveCost[i] = Infinity;
      } else {
        const speed = getMoveSpeedMultiplier(kind, h);
        moveCost[i] = speed > 0 ? 1 / speed : Infinity;
      }
    }
  }

  return { cols: macroCols, rows: macroRows, blocked, moveCost, kinds, heights: macroHeights };
}

export function marchFatigueFactor(marchMs: number, isHolding: boolean): number {
  if (isHolding) return 0;
  if (marchMs < FATIGUE_MARCH_MS) return 0;
  return FATIGUE_SPEED_PENALTY;
}

export function getEffectiveSpeed(
  unitType: "soldier" | "sniper",
  kind: TerrainKind,
  height: number,
  fatigue = 0,
  velocityFactor = 1,
  opts?: { stealth?: boolean; marchMs?: number; holding?: boolean },
): number {
  const base = unitType === "sniper" ? SNIPER_SPEED : SOLDIER_SPEED;
  const terrain = getMoveSpeedMultiplier(kind, height);
  const fatiguePenalty = 1 - Math.min(0.5, fatigue * 0.1);
  const marchPenalty = 1 - marchFatigueFactor(opts?.marchMs ?? 0, opts?.holding ?? false);
  const stealthMult = opts?.stealth ? STEALTH_SPEED_MULT : 1;
  return base * terrain * fatiguePenalty * marchPenalty * velocityFactor * stealthMult;
}

/** +15% damage when attacker is outside target's frontal 120° arc. */
export function flankDamageMult(
  attackerX: number,
  attackerY: number,
  targetX: number,
  targetY: number,
  facingAngleRad: number,
): number {
  const toAttacker = Math.atan2(attackerY - targetY, attackerX - targetX);
  let diff = Math.abs(toAttacker - facingAngleRad);
  while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
  const halfArc = (FLANK_ARC_DEG / 2) * (Math.PI / 180);
  return diff <= halfArc ? 1 : FLANK_DAMAGE_MULT;
}

export function highGroundDamageMult(attackerH: number, targetH: number): number {
  const adv = heightAdvantage(attackerH, targetH);
  return adv > 1 ? HIGH_GROUND_DAMAGE_MULT * (adv / 1.12) : adv;
}

export function suppressionHitChance(suppressionMs: number): number {
  if (suppressionMs <= 0) return 1;
  return Math.max(0.35, 1 - SUPPRESSION_ACCURACY_PENALTY);
}

/** Ease-in/out velocity factor 0..1 for smooth starts/stops. */
export function updateVelocityFactor(
  current: number,
  moving: boolean,
  dtSec: number,
): number {
  const target = moving ? 1 : 0;
  const rate = moving ? (1 / ACCEL_TIME_SEC) : (1 / DECEL_TIME_SEC);
  if (current < target) return Math.min(target, current + rate * dtSec);
  if (current > target) return Math.max(target, current - rate * dtSec);
  return current;
}

export function estimateTravelMs(distanceCells: number, avgSpeedMult = 1): number {
  const avgSpeed = ((SOLDIER_SPEED + SNIPER_SPEED) / 2) * avgSpeedMult;
  const sec = distanceCells / Math.max(0.5, avgSpeed);
  return Math.max(5_000, Math.round(sec * 1000));
}

export function getVisionRadius(
  unitType: "soldier" | "sniper",
  x: number,
  y: number,
  grid: MacroNavGrid,
  level = 1,
): number {
  const cell = sampleCell(grid, x, y);
  const base = unitType === "sniper" ? VISION_SNIPER_BASE : VISION_SOLDIER_BASE;
  const lvBonus = Math.max(0, Math.min(9, (level || 1) - 1)) * 0.35;
  let radius = (base + lvBonus) * getVisionMult(cell.kind);
  if (cell.kind === "HILLS" && cell.height >= 45) radius += 1.5;
  if (cell.height >= 55) radius += Math.min(4, (cell.height - 55) * 0.08);
  return radius;
}

export function getEffectiveSniperRange(x: number, y: number, grid: MacroNavGrid, level = 1): number {
  const cell = sampleCell(grid, x, y);
  const lvBonus = Math.max(0, Math.min(9, (level || 1) - 1)) * 0.3;
  let range = SNIPER_RANGE_BASE + lvBonus;
  if (cell.kind === "HILLS" && cell.height >= 45) range += 2;
  if (cell.height >= 55) range += Math.min(3, (cell.height - 55) * 0.06);
  return range;
}

export function getEffectiveSoldierRange(x: number, y: number, grid: MacroNavGrid, level = 1): number {
  const cell = sampleCell(grid, x, y);
  const lvBonus = Math.max(0, Math.min(9, (level || 1) - 1)) * 0.25;
  let range = SOLDIER_RIFLE_RANGE + lvBonus;
  if (cell.kind === "HILLS" && cell.height >= 45) range += 1;
  if (cell.kind === "ROAD") range += 0.5;
  return range;
}

export function hasLineOfSight(
  grid: MacroNavGrid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  if (dist < 0.01) return true;

  const steps = Math.max(4, Math.ceil(dist / 0.25));
  const ah = sampleCell(grid, ax, ay).height;
  const bh = sampleCell(grid, bx, by).height;

  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const cell = sampleCell(grid, x, y);
    if (cell.blocked) return false;
    if (DENSE_VISION_KINDS.has(cell.kind)) return false;
    const expectedH = ah + (bh - ah) * t;
    if (cell.height > expectedH + 18) return false;
  }
  return true;
}

export function canDetectTarget(
  observerType: "soldier" | "sniper",
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  grid: MacroNavGrid,
  observerLevel = 1,
): boolean {
  const dist = Math.hypot(tx - ox, ty - oy);
  const vision = getVisionRadius(observerType, ox, oy, grid, observerLevel);
  if (dist > vision) return false;
  const targetCell = sampleCell(grid, tx, ty);
  const effectiveDist = dist / getConcealMult(targetCell.kind);
  if (effectiveDist > vision) return false;
  return hasLineOfSight(grid, ox, oy, tx, ty);
}

export function isVisibleToPlayerSquad(
  tx: number,
  ty: number,
  playerUnits: { type: "soldier" | "sniper"; x: number; y: number; hp: number; player?: boolean; level?: number }[],
  grid: MacroNavGrid,
): boolean {
  for (const p of playerUnits) {
    if (!p.player || p.hp <= 0) continue;
    if (canDetectTarget(p.type, p.x, p.y, tx, ty, grid, p.level ?? 1)) return true;
  }
  return false;
}

export function pathCellCost(
  grid: MacroNavGrid,
  pc: number,
  pr: number,
  pathCellSize: number,
): number {
  let sum = 0;
  let n = 0;
  for (let dr = 0; dr < pathCellSize; dr++) {
    for (let dc = 0; dc < pathCellSize; dc++) {
      const c = pc * pathCellSize + dc;
      const r = pr * pathCellSize + dr;
      if (c >= grid.cols || r >= grid.rows) return Infinity;
      const i = r * grid.cols + c;
      if (grid.blocked[i]) return Infinity;
      sum += grid.moveCost[i];
      n++;
    }
  }
  return n > 0 ? sum / n : Infinity;
}

export { TERRAIN_RULES, BIOME_IDS };
