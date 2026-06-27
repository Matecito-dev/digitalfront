// Binary tile encoding — compact format for disk cache and HTTP serving.
//
// Format (little-endian):
//   Offset  0: uint32  magic = 0x57474C54 ("WGLT")
//   Offset  4: uint16  cols
//   Offset  6: uint16  rows
//   Offset  8: uint8   version = 1
//   Offset  9: uint8   flags (0 = raw, 1 = reserved)
//   Offset 10: uint16  reserved
//   Offset 12: N bytes biome_index (uint8 per cell)
//   Offset 12+N: N bytes height (uint8, 0-100)
//   Offset 12+2N: N bytes hillshade (uint8, 0-255)
//
// The file is gzip-compressed on disk and served with Content-Encoding: gzip.
// Typical sizes: tile (128×128) ~49KB raw → ~5KB gzip
//                overview (512×384) ~590KB raw → ~80KB gzip

import type { TerrainKind } from './worldTerrainConfigData.js';

export const MAGIC   = 0x57474c54;
export const VERSION = 1;
export const HEADER  = 12;

// Stable biome index — NEVER reorder; existing caches depend on this order.
export const BIOME_IDS: TerrainKind[] = [
  'WATER', 'COAST', 'PLAINS', 'FOREST', 'HILLS', 'MOUNTAIN',
  'DESERT', 'SWAMP', 'TUNDRA', 'JUNGLE', 'SAVANNA', 'TAIGA', 'ROAD',
];

const BIOME_IDX = new Map<TerrainKind, number>(BIOME_IDS.map((k, i) => [k, i]));

// RGB per biome, indexed by BIOME_IDS order. Must match the client's BIOME_RGB so
// the server-rendered overview PNG looks identical to client-painted tiles.
export const BIOME_RGB: [number, number, number][] = [
  [ 18,  62, 145],  // WATER     — deep midnight blue
  [ 65, 145, 215],  // COAST     — clear coastal blue
  [108, 185,  48],  // PLAINS    — vivid spring green
  [ 22,  88,  22],  // FOREST    — rich dark forest
  [138, 112,  58],  // HILLS     — warm earthy brown
  [168, 158, 148],  // MOUNTAIN  — cool grey rock
  [235, 215,  95],  // DESERT    — golden sand
  [ 52, 108,  48],  // SWAMP     — murky deep green
  [205, 228, 242],  // TUNDRA    — pale icy blue-white
  [ 10, 130,  18],  // JUNGLE    — intense tropical green
  [210, 182,  52],  // SAVANNA   — dry golden grass
  [ 45,  98,  68],  // TAIGA     — muted boreal green
  [100, 100, 100],  // ROAD
];

export function encodeTile(
  cells:     readonly TerrainKind[] | TerrainKind[],
  heights:   Uint8Array | readonly number[],
  hillshade: Uint8Array | readonly number[],
  cols: number,
  rows: number,
): Buffer {
  const N   = cols * rows;
  const buf = Buffer.allocUnsafe(HEADER + N * 3);
  buf.writeUInt32LE(MAGIC,   0);
  buf.writeUInt16LE(cols,    4);
  buf.writeUInt16LE(rows,    6);
  buf.writeUInt8(VERSION,    8);
  buf.writeUInt8(0,          9);
  buf.writeUInt16LE(0,      10);
  for (let i = 0; i < N; i++) buf[HEADER + i]       = BIOME_IDX.get(cells[i] as TerrainKind) ?? 0;
  for (let i = 0; i < N; i++) buf[HEADER + N + i]   = (heights   as any)[i] ?? 0;
  for (let i = 0; i < N; i++) buf[HEADER + N*2 + i] = (hillshade as any)[i] ?? 0;
  return buf;
}
