/** Browser mirror of src/tactics/terrainTactics.ts — keep in sync. */
(function (global) {
  const SEA_LEVEL = 20;
  const PATH_CELL = 2;
  const SOLDIER_SPEED = 2.6;
  const SNIPER_SPEED = 2.2;
  const STEALTH_SPEED_MULT = 0.55;
  const ACCEL_TIME_SEC = 0.35;
  const DECEL_TIME_SEC = 0.25;
  const ARRIVE_DIST = 0.12;
  const SHORT_PATH_CELLS = 3;
  const VISION_SOLDIER_BASE = 6;
  const VISION_SNIPER_BASE = 10;
  const SNIPER_RANGE_BASE = 10;
  const SOLDIER_RIFLE_RANGE = 7;
  const SOLDIER_MELEE_RANGE = SOLDIER_RIFLE_RANGE;

  const TERRAIN_SPEED = {
    PLAINS: 1, FOREST: 0.85, MOUNTAIN: 0, WATER: 0, ROAD: 1.25, COAST: 0.95,
    DESERT: 0.9, SWAMP: 0.7, TUNDRA: 0.8, HILLS: 0.8, JUNGLE: 0.7, SAVANNA: 0.95, TAIGA: 0.8,
  };
  const VISION_MULT = {
    PLAINS: 1, ROAD: 1, COAST: 1, SAVANNA: 1.05, DESERT: 1.1, FOREST: 0.55, TAIGA: 0.7,
    TUNDRA: 0.9, HILLS: 1.15, JUNGLE: 0.45, SWAMP: 0.6, MOUNTAIN: 0, WATER: 0,
  };
  const CONCEAL_MULT = {
    PLAINS: 1, ROAD: 1, COAST: 1, SAVANNA: 0.95, DESERT: 1.05, FOREST: 0.85, TAIGA: 0.9,
    TUNDRA: 0.95, HILLS: 1, JUNGLE: 0.75, SWAMP: 0.8, MOUNTAIN: 1, WATER: 1,
  };
  const DENSE = new Set(['FOREST', 'JUNGLE', 'SWAMP']);
  const NON_WALK = new Set(['WATER', 'MOUNTAIN']);

  function heightMoveMult(h) {
    if (h >= 70) return 0.65;
    if (h >= 50) return 0.8;
    if (h <= SEA_LEVEL + 5) return 0.95;
    return 1;
  }

  function biomeFromOverviewIndex(idx, BIOME_IDS) {
    return BIOME_IDS[idx] ?? 'PLAINS';
  }

  function getMoveSpeedMultiplier(kind, height) {
    const base = TERRAIN_SPEED[kind] ?? 1;
    if (base <= 0) return 0;
    return base * heightMoveMult(height);
  }

  function buildOverviewNavGrid(biome, heights, ovCols, ovRows, macroCols, macroRows, BIOME_IDS) {
    const blocked = new Uint8Array(macroCols * macroRows);
    const moveCost = new Float32Array(macroCols * macroRows);
    const kinds = new Array(macroCols * macroRows);
    const macroHeights = new Uint8Array(macroCols * macroRows);
    for (let row = 0; row < macroRows; row++) {
      for (let col = 0; col < macroCols; col++) {
        const oc = Math.min(ovCols - 1, Math.floor(col * ovCols / macroCols));
        const or = Math.min(ovRows - 1, Math.floor(row * ovRows / macroRows));
        const oi = or * ovCols + oc;
        const kind = biomeFromOverviewIndex(biome[oi], BIOME_IDS);
        const h = heights[oi];
        const i = row * macroCols + col;
        kinds[i] = kind;
        macroHeights[i] = h;
        const unwalkable = h <= SEA_LEVEL + 2 || NON_WALK.has(kind);
        blocked[i] = unwalkable ? 1 : 0;
        if (unwalkable) moveCost[i] = Infinity;
        else {
          const speed = getMoveSpeedMultiplier(kind, h);
          moveCost[i] = speed > 0 ? 1 / speed : Infinity;
        }
      }
    }
    return { cols: macroCols, rows: macroRows, blocked, moveCost, kinds, heights: macroHeights };
  }

  function sampleCell(grid, x, y) {
    const col = Math.max(0, Math.min(grid.cols - 1, Math.floor(x)));
    const row = Math.max(0, Math.min(grid.rows - 1, Math.floor(y)));
    const i = row * grid.cols + col;
    const kind = grid.kinds[i] ?? 'PLAINS';
    const height = grid.heights[i];
    return { col, row, kind, height, blocked: grid.blocked[i] === 1, moveCost: grid.moveCost[i] };
  }

  function pathCellCost(grid, pc, pr, pathCellSize) {
    let sum = 0, n = 0;
    for (let dr = 0; dr < pathCellSize; dr++) {
      for (let dc = 0; dc < pathCellSize; dc++) {
        const c = pc * pathCellSize + dc, r = pr * pathCellSize + dr;
        if (c >= grid.cols || r >= grid.rows) return Infinity;
        const i = r * grid.cols + c;
        if (grid.blocked[i]) return Infinity;
        sum += grid.moveCost[i]; n++;
      }
    }
    return n > 0 ? sum / n : Infinity;
  }

  function getEffectiveSpeed(unitType, kind, height, fatigue, velocityFactor, opts) {
    fatigue = fatigue ?? 0;
    velocityFactor = velocityFactor ?? 1;
    opts = opts ?? {};
    const base = unitType === 'sniper' ? SNIPER_SPEED : SOLDIER_SPEED;
    const terrain = getMoveSpeedMultiplier(kind, height);
    const fatiguePenalty = 1 - Math.min(0.5, fatigue * 0.1);
    const marchMs = opts.marchMs ?? 0;
    const marchPenalty = (!opts.holding && marchMs >= 60000) ? 0.95 : 1;
    const stealthMult = opts.stealth ? STEALTH_SPEED_MULT : 1;
    return base * terrain * fatiguePenalty * marchPenalty * velocityFactor * stealthMult;
  }

  function updateVelocityFactor(current, moving, dtSec) {
    const target = moving ? 1 : 0;
    const rate = moving ? (1 / ACCEL_TIME_SEC) : (1 / DECEL_TIME_SEC);
    if (current < target) return Math.min(target, current + rate * dtSec);
    if (current > target) return Math.max(target, current - rate * dtSec);
    return current;
  }

  function getVisionRadius(unitType, x, y, grid, level) {
    const cell = sampleCell(grid, x, y);
    const base = unitType === 'sniper' ? VISION_SNIPER_BASE : VISION_SOLDIER_BASE;
    const lv = Math.max(1, Math.min(10, level || 1));
    const lvBonus = (lv - 1) * 0.35;
    let radius = (base + lvBonus) * (VISION_MULT[cell.kind] ?? 1);
    if (cell.kind === 'HILLS' && cell.height >= 45) radius += 1.5;
    if (cell.height >= 55) radius += Math.min(4, (cell.height - 55) * 0.08);
    return radius;
  }

  function getEffectiveSniperRange(x, y, grid, level) {
    const cell = sampleCell(grid, x, y);
    const lv = Math.max(1, Math.min(10, level || 1));
    let range = SNIPER_RANGE_BASE + (lv - 1) * 0.3;
    if (cell.kind === 'HILLS' && cell.height >= 45) range += 2;
    if (cell.height >= 55) range += Math.min(3, (cell.height - 55) * 0.06);
    return range;
  }

  function getEffectiveSoldierRange(x, y, grid, level) {
    const cell = sampleCell(grid, x, y);
    const lv = Math.max(1, Math.min(10, level || 1));
    let range = SOLDIER_RIFLE_RANGE + (lv - 1) * 0.25;
    if (cell.kind === 'HILLS' && cell.height >= 45) range += 1;
    if (cell.kind === 'ROAD') range += 0.5;
    return range;
  }

  function hasLineOfSight(grid, ax, ay, bx, by) {
    const dist = Math.hypot(bx - ax, by - ay);
    if (dist < 0.01) return true;
    const steps = Math.max(4, Math.ceil(dist / 0.25));
    const ah = sampleCell(grid, ax, ay).height;
    const bh = sampleCell(grid, bx, by).height;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const cell = sampleCell(grid, x, y);
      if (cell.blocked) return false;
      if (DENSE.has(cell.kind)) return false;
      const expectedH = ah + (bh - ah) * t;
      if (cell.height > expectedH + 18) return false;
    }
    return true;
  }

  function terrainLabel(kind) {
    const labels = {
      PLAINS: 'Llanura', FOREST: 'Bosque', MOUNTAIN: 'Montaña', WATER: 'Agua', ROAD: 'Camino',
      COAST: 'Costa', DESERT: 'Desierto', SWAMP: 'Pantano', TUNDRA: 'Tundra', HILLS: 'Colinas',
      JUNGLE: 'Jungla', SAVANNA: 'Sabana', TAIGA: 'Taiga',
    };
    return labels[kind] ?? kind;
  }

  function canDetectTarget(observerType, ox, oy, tx, ty, grid, observerLevel) {
    const dist = Math.hypot(tx - ox, ty - oy);
    const vision = getVisionRadius(observerType, ox, oy, grid, observerLevel || 1);
    if (dist > vision) return false;
    const targetCell = sampleCell(grid, tx, ty);
    const effectiveDist = dist / (CONCEAL_MULT[targetCell.kind] ?? 1);
    if (effectiveDist > vision) return false;
    return hasLineOfSight(grid, ox, oy, tx, ty);
  }

  function isVisibleToPlayerSquad(tx, ty, playerUnits, grid) {
    for (const p of playerUnits) {
      if (!p.player || p.hp <= 0) continue;
      if (canDetectTarget(p.type, p.x, p.y, tx, ty, grid, p.level || 1)) return true;
    }
    return false;
  }

  const SEASON_VISION = {
    SPRING: 1, SUMMER: 1.05, AUTUMN: 0.95, WINTER: 0.85,
  };
  const PHASE_VISION = { START: 1, PEAK: 1, TRANSITION: 0.92 };
  const AMBUSH_KINDS = new Set(['FOREST', 'JUNGLE']);

  function getSeasonVisionMult(season, phase) {
    const s = SEASON_VISION[season] ?? 1;
    const p = PHASE_VISION[phase] ?? 1;
    return s * p;
  }

  function getConcealMult(kind) {
    return CONCEAL_MULT[kind] ?? 1;
  }

  function isAmbushTerrain(kind) {
    return AMBUSH_KINDS.has(kind);
  }

  function heightAdvantage(attackerH, targetH) {
    const diff = attackerH - targetH;
    if (diff >= 8) return 1.25;
    if (diff >= 4) return 1.12;
    return 1;
  }

  global.TerrainTactics = {
    SEA_LEVEL, PATH_CELL, SOLDIER_SPEED, SNIPER_SPEED, ACCEL_TIME_SEC, DECEL_TIME_SEC,
    ARRIVE_DIST, SHORT_PATH_CELLS, VISION_SOLDIER_BASE, VISION_SNIPER_BASE,
    SNIPER_RANGE_BASE, SOLDIER_RIFLE_RANGE, SOLDIER_MELEE_RANGE, TERRAIN_SPEED, VISION_MULT, CONCEAL_MULT,
    SEASON_VISION, PHASE_VISION, AMBUSH_KINDS,
    buildOverviewNavGrid, sampleCell, pathCellCost, getEffectiveSpeed,
    updateVelocityFactor, getVisionRadius, getEffectiveSniperRange, getEffectiveSoldierRange, hasLineOfSight,
    getMoveSpeedMultiplier, terrainLabel, canDetectTarget, isVisibleToPlayerSquad,
    getSeasonVisionMult, getConcealMult, isAmbushTerrain, heightAdvantage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
