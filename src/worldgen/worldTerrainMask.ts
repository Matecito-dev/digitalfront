export type TerrainKind =
  | "PLAINS" | "FOREST" | "MOUNTAIN" | "WATER" | "ROAD" | "COAST"
  | "DESERT" | "SWAMP" | "TUNDRA" | "HILLS" | "JUNGLE" | "SAVANNA" | "TAIGA";

export type WorldTerrainMaskData = {
  version: number;
  mapAssetPath: string;
  columns: number;
  rows: number;
  cells: TerrainKind[];
};

export type TerrainRule = {
  buildable: boolean;
  walkable: boolean;
  speedMultiplier: number;
};

export const TERRAIN_RULES: Record<TerrainKind, TerrainRule> = {
  PLAINS: { buildable: true, walkable: true, speedMultiplier: 1 },
  FOREST: { buildable: true, walkable: true, speedMultiplier: 0.85 },
  MOUNTAIN: { buildable: false, walkable: false, speedMultiplier: 0 },
  WATER: { buildable: false, walkable: false, speedMultiplier: 0 },
  ROAD: { buildable: true, walkable: true, speedMultiplier: 1.25 },
  COAST: { buildable: true, walkable: true, speedMultiplier: 0.95 },
  DESERT: { buildable: true, walkable: true, speedMultiplier: 0.90 },
  SWAMP: { buildable: true, walkable: true, speedMultiplier: 0.70 },
  TUNDRA: { buildable: true, walkable: true, speedMultiplier: 0.80 },
  HILLS: { buildable: true, walkable: true, speedMultiplier: 0.80 },
  JUNGLE: { buildable: true, walkable: true, speedMultiplier: 0.70 },
  SAVANNA: { buildable: true, walkable: true, speedMultiplier: 0.95 },
  TAIGA: { buildable: true, walkable: true, speedMultiplier: 0.80 },
};

export const TERRAIN_COLOR_HEX: Record<TerrainKind, string> = {
  PLAINS: "#7fae55",
  FOREST: "#1f6f3a",
  MOUNTAIN: "#8d9298",
  WATER: "#247fc0",
  ROAD: "#c69a53",
  COAST: "#58b6a5",
  DESERT: "#d6c084",
  SWAMP: "#4a5636",
  TUNDRA: "#b0b8b2",
  HILLS: "#8a8a4f",
  JUNGLE: "#1c5a2e",
  SAVANNA: "#c2b257",
  TAIGA: "#3a5a4a",
};

export const TERRAIN_LABELS: Record<TerrainKind, string> = {
  PLAINS: "Plains",
  FOREST: "Forest",
  MOUNTAIN: "Mountain",
  WATER: "Water",
  ROAD: "Road",
  COAST: "Coast",
  DESERT: "Desert",
  SWAMP: "Swamp",
  TUNDRA: "Tundra",
  HILLS: "Hills",
  JUNGLE: "Jungle",
  SAVANNA: "Savanna",
  TAIGA: "Taiga",
};

export const TERRAIN_KINDS: TerrainKind[] = ["PLAINS", "FOREST", "MOUNTAIN", "WATER", "ROAD", "COAST", "DESERT", "SWAMP", "TUNDRA", "HILLS", "JUNGLE", "SAVANNA", "TAIGA"];

export const DEFAULT_WORLD_TERRAIN_MASK: WorldTerrainMaskData = {
  version: 1,
  mapAssetPath: "/assets/backgrounds/world-map-terrain-v2.webp",
  columns: 72,
  rows: 48,
  cells: Array.from({ length: 72 * 48 }, () => "PLAINS" as TerrainKind),
};

export function getTerrainCellIndex(mask: Pick<WorldTerrainMaskData, "columns" | "rows">, x: number, y: number) {
  const col = Math.min(mask.columns - 1, Math.max(0, Math.floor(x * mask.columns)));
  const row = Math.min(mask.rows - 1, Math.max(0, Math.floor(y * mask.rows)));
  return row * mask.columns + col;
}

export function normalizeWorldTerrainMask(input?: Partial<WorldTerrainMaskData> | null): WorldTerrainMaskData {
  const columns = Number.isFinite(Number(input?.columns)) ? Math.max(8, Math.floor(Number(input?.columns))) : DEFAULT_WORLD_TERRAIN_MASK.columns;
  const rows = Number.isFinite(Number(input?.rows)) ? Math.max(8, Math.floor(Number(input?.rows))) : DEFAULT_WORLD_TERRAIN_MASK.rows;
  const cells = Array.isArray(input?.cells) ? input.cells : [];
  const normalizedCells = Array.from({ length: columns * rows }, (_, index) => {
    const value = cells[index];
    return TERRAIN_KINDS.includes(value as TerrainKind) ? value as TerrainKind : "PLAINS";
  });

  return {
    version: Number.isFinite(Number(input?.version)) ? Number(input?.version) : DEFAULT_WORLD_TERRAIN_MASK.version,
    mapAssetPath: typeof input?.mapAssetPath === "string" && input.mapAssetPath.trim()
      ? input.mapAssetPath
      : DEFAULT_WORLD_TERRAIN_MASK.mapAssetPath,
    columns,
    rows,
    cells: normalizedCells,
  };
}
