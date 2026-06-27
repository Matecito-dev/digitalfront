// Hillshade: compute relief shading from height normals.
// Returns a Uint8Array[N] where 0=shadow, 255=fully lit.
// The browser can multiply this over the biome color to show relief.

export function computeHillshade(
  heights: Uint8Array | Float32Array,
  cols: number,
  rows: number,
  lightAzimuthDeg = 315, // NW light source (standard cartographic convention)
  lightAltitudeDeg = 45,
): Uint8Array {
  const N = cols * rows;
  const out = new Uint8Array(N);

  const azRad = ((lightAzimuthDeg - 90) * Math.PI) / 180;
  const altRad = (lightAltitudeDeg * Math.PI) / 180;

  // Light direction vector
  const lx = Math.cos(altRad) * Math.cos(azRad);
  const ly = Math.cos(altRad) * Math.sin(azRad);
  const lz = Math.sin(altRad);

  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const i = row * cols + col;
      // Sobel-style central differences
      const dzdx = (heights[(row) * cols + (col + 1)] - heights[(row) * cols + (col - 1)]) / 2;
      const dzdy = (heights[(row + 1) * cols + col] - heights[(row - 1) * cols + col]) / 2;

      // Surface normal (un-normalized)
      const nx = -dzdx;
      const ny = -dzdy;
      const nz = 8; // scale z so subtle slopes still get shading

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const dot = (nx / len) * lx + (ny / len) * ly + (nz / len) * lz;
      out[i] = Math.round(Math.max(0, Math.min(255, (dot * 0.5 + 0.5) * 255)));
    }
  }

  // Fill border
  for (let col = 0; col < cols; col++) { out[col] = out[cols + col]; out[(rows-1)*cols+col] = out[(rows-2)*cols+col]; }
  for (let row = 0; row < rows; row++) { out[row*cols] = out[row*cols+1]; out[row*cols+cols-1] = out[row*cols+cols-2]; }

  return out;
}
