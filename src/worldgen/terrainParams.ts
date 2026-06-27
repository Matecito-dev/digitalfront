// TerrainParams: controls all tunable knobs in the generation pipeline.
// Pass to generateTerrainData; defaults replicate the original hardcoded values.

export type WorldSizePreset = "small" | "medium" | "large" | "huge";

export interface TerrainParams {
  // Land/water ratio
  waterPercent: number;      // 0–1, fraction of cells that will be water (default 0.12)

  // Plate tectonics
  numPlates: number;         // number of tectonic plates (default 12)
  upliftStrength: number;    // multiplier on convergent-border height boost (default 1.0)
  riftDepth: number;         // multiplier on divergent-border height reduction (default 1.0)

  // Hydraulic erosion
  erosionIterations: number; // droplet passes (default 0 = disabled; 30000 = subtle)
  erosionStrength: number;   // how much each droplet erodes (default 0.08)
  depositionRate: number;    // fraction of carried sediment deposited (default 0.3)

  // Climate / orographic rain
  windAngleDeg: number;      // prevailing wind direction (0 = east→west, 90 = south→north, default 45)
  moistureScale: number;     // overall moisture multiplier (default 1.0)
  orographicStrength: number;// how strongly mountains block moisture (default 1.0)

  // Biome thresholds
  mountainThreshold: number; // height above which terrain is MOUNTAIN (default 75)
  hillsThreshold: number;    // height above which terrain is HILLS (default 60)

  // Map size (used by tiling)
  worldSizePreset: WorldSizePreset;
}

export const DEFAULT_PARAMS: TerrainParams = {
  waterPercent: 0.30,       // 30% water → clear oceans between continents
  numPlates: 8,             // fewer plates → bigger continents
  upliftStrength: 2.0,      // stronger uplift → more dramatic mountain ranges
  riftDepth: 1.5,
  erosionIterations: 0,
  erosionStrength: 0.08,
  depositionRate: 0.3,
  windAngleDeg: 45,
  moistureScale: 1.0,
  orographicStrength: 1.2,
  mountainThreshold: 72,
  hillsThreshold: 58,
  worldSizePreset: "medium",
};

export function worldSizeDims(preset: WorldSizePreset): { cols: number; rows: number; tileSize: number } {
  switch (preset) {
    case "small":  return { cols: 200,  rows: 200,  tileSize: 50 };
    case "medium": return { cols: 400,  rows: 400,  tileSize: 100 };
    case "large":  return { cols: 1000, rows: 1000, tileSize: 200 };
    case "huge":   return { cols: 4000, rows: 4000, tileSize: 200 };
  }
}
