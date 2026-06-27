// World metadata derived from a macro world: POI/region/climate labels (in macro
// col/row coords) + biome histogram. Shared by the server (/api/world) and the
// offline pre-generation script so both produce identical, cacheable metadata.

import { generatePOIs }    from "./worldPOIs.js";
import { generateRegions } from "./worldRegions.js";
import { biomeHistogram }  from "./overviewImage.js";
import { MACRO_COLS, MACRO_ROWS, type MacroWorld } from "./tiling.js";

// World extent in label/world units (matches POI/region generators).
const EXT_X = 80000, EXT_Y = 60000, HALF_X = 40000, HALF_Y = 30000;

const CLIMATE_ZONE_DEFS = [
  { name: "Tierras Heladas",     yMin: 0.00, yMax: 0.15 },
  { name: "Tundra Polar",        yMin: 0.15, yMax: 0.25 },
  { name: "Bosques del Norte",   yMin: 0.25, yMax: 0.40 },
  { name: "Tierras Templadas",   yMin: 0.40, yMax: 0.60 },
  { name: "Sabanas del Sur",     yMin: 0.60, yMax: 0.75 },
  { name: "Tierras Cálidas",     yMin: 0.75, yMax: 0.88 },
  { name: "Junglas del Ecuador", yMin: 0.88, yMax: 1.00 },
];

export interface ClimateLabel { name: string; col: number; row: number; }

export function climateZoneLabels(macro: MacroWorld): ClimateLabel[] {
  const result: ClimateLabel[] = [];
  for (const zone of CLIMATE_ZONE_DEFS) {
    const rowMin = Math.floor(zone.yMin * MACRO_ROWS);
    const rowMax = Math.ceil(zone.yMax  * MACRO_ROWS);
    let sumCol = 0, sumRow = 0, count = 0;
    for (let row = rowMin; row < rowMax; row++)
      for (let col = 0; col < MACRO_COLS; col++)
        if (macro.cells[row * MACRO_COLS + col] !== "WATER") { sumCol += col; sumRow += row; count++; }
    if (count < (rowMax - rowMin) * MACRO_COLS * 0.005) continue;
    let cCol = Math.round(sumCol / count), cRow = Math.round(sumRow / count);
    if (macro.cells[cRow * MACRO_COLS + cCol] === "WATER") {
      outer: for (let r = 1; r < 12; r++)
        for (let dc = -r; dc <= r; dc++)
          for (const dr of [-r, r]) {
            const nr = cRow+dr, nc = cCol+dc;
            if (nr>=rowMin && nr<rowMax && nc>=0 && nc<MACRO_COLS && macro.cells[nr*MACRO_COLS+nc]!=="WATER")
              { cCol = nc; cRow = nr; break outer; }
          }
    }
    result.push({ name: zone.name, col: cCol, row: cRow });
  }
  return result;
}

export interface WorldMeta {
  pois: any[];
  regions: any[];
  climateZones: ClimateLabel[];
  biomeHistogram: number[];
}

export function computeWorldMeta(macro: MacroWorld, seed: number): WorldMeta {
  const rawPois = generatePOIs(macro.cells, macro.heights, MACRO_COLS, MACRO_ROWS, EXT_X, EXT_Y, seed);
  const { regions: rawRegions } = generateRegions(macro.cells, MACRO_COLS, MACRO_ROWS, EXT_X, EXT_Y, seed);
  return {
    pois:    rawPois.map(p => ({ ...p, col: Math.round((p.x+HALF_X)/EXT_X*MACRO_COLS), row: Math.round((p.y+HALF_Y)/EXT_Y*MACRO_ROWS) })),
    regions: rawRegions.map(r => ({ ...r, col: Math.round((r.centroidX+HALF_X)/EXT_X*MACRO_COLS), row: Math.round((r.centroidY+HALF_Y)/EXT_Y*MACRO_ROWS) })),
    climateZones: climateZoneLabels(macro),
    biomeHistogram: biomeHistogram(macro),
  };
}
