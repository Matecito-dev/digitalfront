// Server-side tile color bake — pixel-equivalent to paintTileBin in viewer/index.html.
import { PNG } from "pngjs";
import sharp from "sharp";
import { BIOME_RGB, HEADER } from "./tileBinary.js";

const SEA_LEVEL = 20;
const WARM = [1.32, 1.08, 0.72] as const;
const COOL = [0.48, 0.58, 0.82] as const;
const WATER_BIOME = 0;
const COAST_BIOME = 1;
export const TILE_WEBP_QUALITY = 92;

/** Paint RGBA buffer from WGLT binary — matches client paintTileBin exactly. */
export function bakeTileRgbaFromBin(raw: Buffer): Buffer {
  const TS = raw.readUInt16LE(4);
  const N = TS * TS;
  const biome = raw.subarray(HEADER, HEADER + N);
  const heights = raw.subarray(HEADER + N, HEADER + N * 2);
  const hsArr = raw.subarray(HEADER + N * 2, HEADER + N * 3);

  const png = new PNG({ width: TS, height: TS, colorType: 2 });
  const d = png.data;

  for (let i = 0; i < N; i++) {
    const bi = biome[i];
    let r = BIOME_RGB[bi]?.[0] ?? 200;
    let g = BIOME_RGB[bi]?.[1] ?? 0;
    let b = BIOME_RGB[bi]?.[2] ?? 200;
    const h = heights[i];
    const hs = hsArr[i] / 255;
    const o = i * 4;

    if (bi === WATER_BIOME || bi === COAST_BIOME) {
      const depth = Math.max(0, Math.min(1, (SEA_LEVEL - h) / SEA_LEVEL));
      const dd = depth * depth;
      r = 72 + (6 - 72) * dd;
      g = 158 + (22 - 158) * dd;
      b = 220 + (72 - 220) * dd;
      const wl = 0.72 + hs * 0.28;
      d[o] = Math.min(255, r * wl) | 0;
      d[o + 1] = Math.min(255, g * wl) | 0;
      d[o + 2] = Math.min(255, b * wl) | 0;
    } else {
      if (h > 80) {
        const sn = Math.min(1, (h - 80) / 18);
        r = r + (238 - r) * sn;
        g = g + (244 - g) * sn;
        b = b + (255 - b) * sn;
      }
      const lr = COOL[0] + (WARM[0] - COOL[0]) * hs;
      const lg = COOL[1] + (WARM[1] - COOL[1]) * hs;
      const lb = COOL[2] + (WARM[2] - COOL[2]) * hs;
      d[o] = Math.min(255, r * lr) | 0;
      d[o + 1] = Math.min(255, g * lg) | 0;
      d[o + 2] = Math.min(255, b * lb) | 0;
    }
    d[o + 3] = 255;
  }

  return PNG.sync.write(png);
}

export function bakeTilePngFromBin(raw: Buffer): Buffer {
  return bakeTileRgbaFromBin(raw);
}

export async function bakeTileWebpFromBin(
  raw: Buffer,
  quality = TILE_WEBP_QUALITY,
): Promise<Buffer> {
  const png = bakeTilePngFromBin(raw);
  return sharp(png).webp({ quality, effort: 4 }).toBuffer();
}
