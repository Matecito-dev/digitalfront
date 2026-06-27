import { PNG } from "pngjs";
import { generateOverview, type MacroWorld } from "./tiling.js";
import { BIOME_IDS, BIOME_RGB } from "./tileBinary.js";
import type { TerrainParams } from "./terrainParams.js";

const BIOME_IDX_MAP = new Map(BIOME_IDS.map((k, i) => [k, i]));
const SEA_LEVEL = 20;

// Warm sunlight color multipliers and cool shadow multipliers for colored hillshade.
// Blending between these gives a dramatic 3-D look without any extra data.
const WARM = [1.32, 1.08, 0.72] as const;   // golden-orange sun
const COOL = [0.48, 0.58, 0.82] as const;   // blue-grey sky shadow

export function renderOverviewPng(macro: MacroWorld, params: Partial<TerrainParams> = {}, scale = 8): Buffer {
  const ov = generateOverview(macro, params, scale);
  const { cols, rows } = ov;
  const N = cols * rows;

  const png = new PNG({ width: cols, height: rows, colorType: 2 });
  const d = png.data;

  for (let i = 0; i < N; i++) {
    const bi   = BIOME_IDX_MAP.get(ov.cells[i] as any) ?? 0;
    const h    = ov.heights[i];
    const hs   = ov.hillshade[i] / 255;   // 0=shadow, 1=full light
    const cell = ov.cells[i] as string;

    let r: number, g: number, b: number;

    if (cell === 'WATER' || cell === 'COAST') {
      // Depth gradient: deeper = darker navy, shallower = brighter teal
      const depth = Math.max(0, Math.min(1, (SEA_LEVEL - h) / SEA_LEVEL));
      const deep   = [6,  22, 72 ] as const;
      const shallow= [72, 158, 220] as const;
      r = shallow[0] + (deep[0] - shallow[0]) * depth * depth;
      g = shallow[1] + (deep[1] - shallow[1]) * depth * depth;
      b = shallow[2] + (deep[2] - shallow[2]) * depth * depth;
      // Water still gets a gentle hillshade for wave-like effect (subtle)
      const waterLit = 0.72 + hs * 0.28;
      r *= waterLit; g *= waterLit; b *= waterLit;
    } else {
      [r, g, b] = BIOME_RGB[bi];

      // Snow caps: blend toward white above h=80
      if (h > 80) {
        const snow = Math.min(1, (h - 80) / 18);
        r = r + (238 - r) * snow;
        g = g + (244 - g) * snow;
        b = b + (255 - b) * snow;
      }

      // Colored hillshade: interpolate between cool shadow and warm sunlight
      const lr = COOL[0] + (WARM[0] - COOL[0]) * hs;
      const lg = COOL[1] + (WARM[1] - COOL[1]) * hs;
      const lb = COOL[2] + (WARM[2] - COOL[2]) * hs;
      r *= lr; g *= lg; b *= lb;
    }

    const o = i * 4;
    d[o]   = Math.min(255, Math.max(0, r)) & 0xE0;
    d[o+1] = Math.min(255, Math.max(0, g)) & 0xE0;
    d[o+2] = Math.min(255, Math.max(0, b)) & 0xE0;
    d[o+3] = 255;
  }
  return PNG.sync.write(png, { colorType: 2 } as any);
}

export function biomeHistogram(macro: MacroWorld): number[] {
  const hist = new Array(BIOME_IDS.length).fill(0);
  for (const c of macro.cells) hist[BIOME_IDX_MAP.get(c as any) ?? 0]++;
  return hist;
}
