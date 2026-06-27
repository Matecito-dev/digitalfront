// Serialize the MacroWorld so it can be cached to disk and loaded in ~ms instead
// of re-running the 8.6s geological pipeline. This is what lets a "serve-only"
// production server answer /api/world (metadata + sim terrain) instantly for any
// pre-generated seed without ever generating on the fly.
//
// Binary layout (little-endian):
//   0:  uint32 magic = 0x57474D43 ("WGMC")
//   4:  uint16 cols
//   6:  uint16 rows
//   8:  int32  seed
//   12: N×uint8   biome index (BIOME_IDS order)
//   12+N:   N×uint8   heights
//   12+2N:  N×uint8   hillshade
//   12+3N:  N×float32 moisture
//   12+3N+4N: N×float32 temperature

import type { TerrainKind } from "./worldTerrainConfigData.js";
import { BIOME_IDS } from "./tileBinary.js";
import {
  WORLD_TILES_X, WORLD_TILES_Y, type MacroWorld,
} from "./tiling.js";

const MAGIC = 0x57474d43;
const HEADER = 12;
const BIOME_IDX = new Map<TerrainKind, number>(BIOME_IDS.map((k, i) => [k, i]));

export function encodeMacro(macro: MacroWorld): Buffer {
  const { cols, rows } = macro;
  const N = cols * rows;
  const buf = Buffer.allocUnsafe(HEADER + N * 3 + N * 8);
  buf.writeUInt32LE(MAGIC, 0);
  buf.writeUInt16LE(cols, 4);
  buf.writeUInt16LE(rows, 6);
  buf.writeInt32LE(macro.seed, 8);
  let o = HEADER;
  for (let i = 0; i < N; i++) buf[o + i] = BIOME_IDX.get(macro.cells[i]) ?? 0;
  o += N;
  for (let i = 0; i < N; i++) buf[o + i] = macro.heights[i];
  o += N;
  for (let i = 0; i < N; i++) buf[o + i] = macro.hillshade[i];
  o += N;
  for (let i = 0; i < N; i++) { buf.writeFloatLE(macro.moisture[i], o); o += 4; }
  for (let i = 0; i < N; i++) { buf.writeFloatLE(macro.temperature[i], o); o += 4; }
  return buf;
}

export function decodeMacro(buf: Buffer): MacroWorld {
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error("bad macro magic");
  const cols = buf.readUInt16LE(4);
  const rows = buf.readUInt16LE(6);
  const seed = buf.readInt32LE(8);
  const N = cols * rows;
  const cells: TerrainKind[] = new Array(N);
  const heights = new Uint8Array(N);
  const hillshade = new Uint8Array(N);
  const moisture = new Float32Array(N);
  const temperature = new Float32Array(N);
  let o = HEADER;
  for (let i = 0; i < N; i++) cells[i] = BIOME_IDS[buf[o + i]] ?? "WATER";
  o += N;
  for (let i = 0; i < N; i++) heights[i] = buf[o + i];
  o += N;
  for (let i = 0; i < N; i++) hillshade[i] = buf[o + i];
  o += N;
  for (let i = 0; i < N; i++) { moisture[i] = buf.readFloatLE(o); o += 4; }
  for (let i = 0; i < N; i++) { temperature[i] = buf.readFloatLE(o); o += 4; }
  return {
    seed, tilesX: WORLD_TILES_X, tilesY: WORLD_TILES_Y,
    cols, rows, cells, heights, hillshade, moisture, temperature,
  };
}
