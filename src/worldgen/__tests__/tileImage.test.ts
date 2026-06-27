import { describe, expect, it } from "vitest";
import { encodeTile, BIOME_IDS } from "../tileBinary.js";
import { bakeTilePngFromBin } from "../tileImage.js";

describe("tileImage bake", () => {
  it("produces 128×128 PNG from binary tile", () => {
    const cols = 128, rows = 128;
    const N = cols * rows;
    const cells = new Array(N).fill("PLAINS" satisfies typeof BIOME_IDS[number]);
    const heights = new Uint8Array(N);
    const hillshade = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      heights[i] = 40;
      hillshade[i] = 180;
    }
    cells[0] = "WATER";
    heights[0] = 10;

    const raw = encodeTile(cells, heights, hillshade, cols, rows);
    const png = bakeTilePngFromBin(raw);

    expect(png.length).toBeGreaterThan(100);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // PNG signature
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
  });
});
