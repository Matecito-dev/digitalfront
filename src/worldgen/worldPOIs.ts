import type { TerrainKind } from "./worldTerrainConfigData.js";
import type { WorldPOI, WorldPOIType } from "../shared/world.js";

// ─── POI name lists by type ───────────────────────────────────────────────────

const RUINS_NAMES = [
  "Ruinas de Vorethia", "Antiguo Santuario", "Templo Olvidado", "La Ciudad Muerta",
  "Fortaleza Abandonada", "Catacumbas de Ash", "El Ara Rota", "Torre de Ceniza",
  "Osario del Diablo", "Cripta de Olar", "Mausoleo Maldito", "Altar de Piedra",
];

const PEAK_NAMES = [
  "Pico del Águila", "Cima Eterna", "Monte Oscuro", "Cumbre Helada",
  "El Gran Colmillo", "Pico del Trueno", "Cresta del Cuervo", "La Aguja",
  "Monte Gris", "Cumbre del Dragón", "Pico Sangrante", "El Techo del Mundo",
];

const RESOURCE_NAMES = [
  "Vetas de Hierro", "Manantial Sagrado", "Bosque Primigenio", "Pantano de Sal",
  "Mina Perdida", "Oasis del Desierto", "Cantera Antigua", "Tierras Fértiles",
  "Fuente de Azufre", "Reserva de Madera", "Yacimiento de Gemas", "Salinas del Sur",
];

const HARBOR_NAMES = [
  "Puerto Olvidado", "Bahía de los Naufragios", "Ensenada Secreta", "El Muelle Roto",
  "Cala del Pirata", "Puerto de Tormenta", "Rada Tranquila", "Embarcadero Perdido",
];

const LAKE_NAMES = [
  "Lago Argénteo", "Lago de las Sombras", "Mar Interior", "Lago Esmeralda",
  "Aguas Quietas", "Lago Cerúleo", "La Laguna", "Lago Profundo",
];

const RANGE_NAMES = [
  "Cordillera del Trueno", "Sierra Eterna", "Cadena del Dragón", "Montes Grises",
  "Altas Cumbres", "Sierra Oscura", "Picos del Norte", "Cadena Helada",
];

const CAPE_NAMES = [
  "Cabo Tormentoso", "Punta del Halcón", "Cabo Perdido", "Punta Negra",
  "Cabo del Fin", "Punta Árida", "Cabo Dorado", "Extremo del Mundo",
];

const BAY_NAMES = [
  "Bahía Serena", "Golfo de Niebla", "Bahía Oscura", "Cala de las Sirenas",
  "Bahía del Trueno", "Ensenada Dorada", "Golfo Antiguo", "Bahía Olvidada",
];

function seededPick<T>(arr: T[], h: number): T {
  return arr[Math.abs(h) % arr.length];
}

function hashInt(n: number): number {
  let x = n ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function poiName(type: WorldPOIType, idx: number): string {
  const h = hashInt(idx * 37 + 11);
  switch (type) {
    case "RUINS":    return seededPick(RUINS_NAMES, h);
    case "PEAK":     return seededPick(PEAK_NAMES, h);
    case "RESOURCE": return seededPick(RESOURCE_NAMES, h);
    case "HARBOR":   return seededPick(HARBOR_NAMES, h);
    case "LAKE":     return seededPick(LAKE_NAMES, h);
    case "RANGE":    return seededPick(RANGE_NAMES, h);
    case "CAPE":     return seededPick(CAPE_NAMES, h);
    case "BAY":      return seededPick(BAY_NAMES, h);
    default:         return seededPick(RUINS_NAMES, h);
  }
}

// Biome → allowed POI types
function biomePoiType(kind: TerrainKind, height: number): WorldPOIType | null {
  if (kind === "MOUNTAIN") return "PEAK";
  if (kind === "COAST")    return "HARBOR";
  if (kind === "PLAINS" || kind === "TUNDRA" || kind === "SAVANNA") return "RUINS";
  if (kind === "FOREST" || kind === "JUNGLE" || kind === "SWAMP" || kind === "DESERT" || kind === "TAIGA") return "RESOURCE";
  if (kind === "HILLS" && height >= 55) return "RUINS";
  return null;
}

// ─── Geographic feature detection ────────────────────────────────────────────

function detectLakes(
  cells: TerrainKind[],
  heights: Uint8Array,
  cols: number,
  rows: number,
): Array<{ cellIdx: number }> {
  const N = cols * rows;
  const visited = new Uint8Array(N);
  const lakes: Array<{ cellIdx: number; size: number }> = [];

  for (let i = 0; i < N; i++) {
    if (visited[i] || heights[i] >= 20) continue;
    // BFS water component
    const q = [i];
    visited[i] = 1;
    let touchesBorder = false;
    const component: number[] = [];
    let head = 0;
    while (head < q.length) {
      const ci = q[head++];
      const cc = ci % cols, cr = Math.floor(ci / cols);
      if (cc === 0 || cr === 0 || cc === cols - 1 || cr === rows - 1) touchesBorder = true;
      component.push(ci);
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (!visited[ni] && heights[ni] < 20) { visited[ni] = 1; q.push(ni); }
      }
    }
    if (!touchesBorder && component.length >= 20) {
      // Pick centroid cell
      let sumC = 0, sumR = 0;
      for (const ci of component) { sumC += ci % cols; sumR += Math.floor(ci / cols); }
      const avgC = Math.round(sumC / component.length);
      const avgR = Math.round(sumR / component.length);
      lakes.push({ cellIdx: avgR * cols + avgC, size: component.length });
    }
  }

  // Return top 4 lakes by size
  lakes.sort((a, b) => b.size - a.size);
  return lakes.slice(0, 4);
}

function detectRanges(
  cells: TerrainKind[],
  cols: number,
  rows: number,
): Array<{ cellIdx: number }> {
  const N = cols * rows;
  const visited = new Uint8Array(N);
  const ranges: Array<{ cellIdx: number; size: number }> = [];

  for (let i = 0; i < N; i++) {
    if (visited[i] || cells[i] !== "MOUNTAIN") continue;
    const q = [i];
    visited[i] = 1;
    const component: number[] = [];
    let head = 0;
    while (head < q.length) {
      const ci = q[head++];
      component.push(ci);
      const cc = ci % cols, cr = Math.floor(ci / cols);
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]] as const) {
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (!visited[ni] && cells[ni] === "MOUNTAIN") { visited[ni] = 1; q.push(ni); }
      }
    }
    if (component.length >= 30) {
      let sumC = 0, sumR = 0;
      for (const ci of component) { sumC += ci % cols; sumR += Math.floor(ci / cols); }
      const avgC = Math.round(sumC / component.length);
      const avgR = Math.round(sumR / component.length);
      ranges.push({ cellIdx: avgR * cols + avgC, size: component.length });
    }
  }

  ranges.sort((a, b) => b.size - a.size);
  return ranges.slice(0, 5);
}

function detectCapes(
  cells: TerrainKind[],
  heights: Uint8Array,
  cols: number,
  rows: number,
): Array<{ cellIdx: number }> {
  const capes: Array<{ cellIdx: number }> = [];
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const i = row * cols + col;
      if (heights[i] < 20) continue; // must be land
      if (cells[i] !== "COAST") continue; // cape must be coastal
      let waterCount = 0;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
        const ni = (row + dr) * cols + (col + dc);
        if (heights[ni] < 20) waterCount++;
      }
      if (waterCount >= 3) capes.push({ cellIdx: i });
    }
  }
  // Subsample: pick up to 5 well-spaced capes
  const result: Array<{ cellIdx: number }> = [];
  const MIN_DIST = Math.floor(cols * 0.08);
  for (const cape of capes) {
    const cc = cape.cellIdx % cols, cr = Math.floor(cape.cellIdx / cols);
    const tooClose = result.some(p => {
      const pc = p.cellIdx % cols, pr = Math.floor(p.cellIdx / cols);
      return Math.abs(pc - cc) < MIN_DIST && Math.abs(pr - cr) < MIN_DIST;
    });
    if (!tooClose) { result.push(cape); if (result.length >= 5) break; }
  }
  return result;
}

function detectBays(
  cells: TerrainKind[],
  heights: Uint8Array,
  cols: number,
  rows: number,
): Array<{ cellIdx: number }> {
  const bays: Array<{ cellIdx: number }> = [];
  for (let row = 2; row < rows - 2; row++) {
    for (let col = 2; col < cols - 2; col++) {
      const i = row * cols + col;
      if (heights[i] >= 20) continue; // must be water
      let landCount = 0;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
        const ni = (row + dr) * cols + (col + dc);
        if (heights[ni] >= 20) landCount++;
      }
      if (landCount >= 3) bays.push({ cellIdx: i });
    }
  }
  const result: Array<{ cellIdx: number }> = [];
  const MIN_DIST = Math.floor(cols * 0.08);
  for (const bay of bays) {
    const cc = bay.cellIdx % cols, cr = Math.floor(bay.cellIdx / cols);
    const tooClose = result.some(p => {
      const pc = p.cellIdx % cols, pr = Math.floor(p.cellIdx / cols);
      return Math.abs(pc - cc) < MIN_DIST && Math.abs(pr - cr) < MIN_DIST;
    });
    if (!tooClose) { result.push(bay); if (result.length >= 5) break; }
  }
  return result;
}

// ─── POI generation ──────────────────────────────────────────────────────────

export function generatePOIs(
  cells: TerrainKind[],
  heights: Uint8Array,
  cols: number,
  rows: number,
  worldWidth: number,
  worldHeight: number,
  seed: number,
): WorldPOI[] {
  const N = cols * rows;

  // Simple mulberry32 PRNG
  let s = seed ^ 0x9b1ae4c3;
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Candidate pool: eligible cells indexed by type
  const candidatesByType: Record<WorldPOIType, number[]> = {
    RUINS: [], PEAK: [], RESOURCE: [], HARBOR: [], LAKE: [], RANGE: [], CAPE: [], BAY: [],
  };

  for (let i = 0; i < N; i++) {
    const t = biomePoiType(cells[i], heights[i]);
    if (t) candidatesByType[t].push(i);
  }

  // Shuffle each bucket with seeded Fisher-Yates and take up to TARGET each
  const TARGETS: Record<WorldPOIType, number> = {
    RUINS: 8, PEAK: 7, RESOURCE: 8, HARBOR: 5, LAKE: 0, RANGE: 0, CAPE: 0, BAY: 0,
  };

  const MIN_DIST_CELLS = Math.floor(cols * 0.03);

  const placed: Array<{ cellIdx: number; type: WorldPOIType; name: string }> = [];

  for (const type of ["RUINS", "PEAK", "RESOURCE", "HARBOR"] as WorldPOIType[]) {
    const pool = candidatesByType[type];
    const target = TARGETS[type];
    let picked = 0;
    for (let i = pool.length - 1; i > 0 && picked < target * 10; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    for (let k = pool.length - 1; k >= 0 && picked < target; k--) {
      const ci = pool[k];
      const cc = ci % cols, cr = Math.floor(ci / cols);
      let tooClose = false;
      for (const p of placed) {
        const pc = p.cellIdx % cols, pr = Math.floor(p.cellIdx / cols);
        if (Math.abs(pc - cc) < MIN_DIST_CELLS && Math.abs(pr - cr) < MIN_DIST_CELLS) {
          tooClose = true; break;
        }
      }
      if (tooClose) continue;
      placed.push({ cellIdx: ci, type, name: poiName(type, placed.length) });
      picked++;
    }
  }

  // Add geographic features
  const lakes = detectLakes(cells, heights, cols, rows);
  for (const lake of lakes) {
    placed.push({ cellIdx: lake.cellIdx, type: "LAKE", name: poiName("LAKE", placed.length) });
  }

  const ranges = detectRanges(cells, cols, rows);
  for (const range of ranges) {
    placed.push({ cellIdx: range.cellIdx, type: "RANGE", name: poiName("RANGE", placed.length) });
  }

  const capes = detectCapes(cells, heights, cols, rows);
  for (const cape of capes) {
    placed.push({ cellIdx: cape.cellIdx, type: "CAPE", name: poiName("CAPE", placed.length) });
  }

  const bays = detectBays(cells, heights, cols, rows);
  for (const bay of bays) {
    placed.push({ cellIdx: bay.cellIdx, type: "BAY", name: poiName("BAY", placed.length) });
  }

  // ── Convert grid positions to world coords ───────────────────────────────
  const halfW = worldWidth / 2;
  const halfH = worldHeight / 2;

  return placed.map((p, idx) => {
    const c = p.cellIdx % cols;
    const r = Math.floor(p.cellIdx / cols);
    return {
      id: `poi-${idx}`,
      type: p.type,
      name: p.name,
      x: Math.round((c / cols) * worldWidth - halfW),
      y: Math.round((r / rows) * worldHeight - halfH),
    };
  });
}
