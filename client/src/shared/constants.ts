/** World dimensions — defaults match tiling.ts / viewer Phaser client. */
export const DEFAULT_TILE_SIZE = 128;
export const DEFAULT_TILES_X = 256;
export const DEFAULT_TILES_Y = 192;

export const DEFAULT_WORLD_W = DEFAULT_TILES_X * DEFAULT_TILE_SIZE;
export const DEFAULT_WORLD_H = DEFAULT_TILES_Y * DEFAULT_TILE_SIZE;

export const DEFAULT_SEED = "valle-bruma";
export const DEFAULT_WORLD_NAME = "Valle de Bruma";

export type WorldMeta = {
  seed: string | number;
  cols: number;
  rows: number;
  tilesX: number;
  tilesY: number;
  tileSize: number;
};

export function worldSizeFromMeta(meta: WorldMeta) {
  const tilesX = meta.tilesX ?? DEFAULT_TILES_X;
  const tilesY = meta.tilesY ?? DEFAULT_TILES_Y;
  const tileSize = meta.tileSize ?? DEFAULT_TILE_SIZE;
  return {
    tilesX,
    tilesY,
    tileSize,
    worldW: tilesX * tileSize,
    worldH: tilesY * tileSize,
  };
}
