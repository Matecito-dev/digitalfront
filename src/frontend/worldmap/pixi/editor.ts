import { Container, Graphics } from "pixi.js";
import type { Viewport } from "pixi-viewport";
import type { WorldTerrainMaskData } from "@/lib/worldTerrainMask";
import { TERRAIN_COLOR_HEX, type TerrainKind } from "@/lib/worldTerrainMask";

export class EditorLayer extends Container {
  private viewport: Viewport;
  private worldW: number;
  private worldH: number;
  private halfW: number;
  private halfH: number;
  private overlayG = new Graphics();
  private brushG = new Graphics();

  constructor(viewport: Viewport, worldW: number, worldH: number) {
    super();
    this.viewport = viewport;
    this.worldW = worldW;
    this.worldH = worldH;
    this.halfW = worldW / 2;
    this.halfH = worldH / 2;
    this.addChild(this.overlayG, this.brushG);
  }

  redrawOverlay(mask: WorldTerrainMaskData | null, show: boolean) {
    this.overlayG.clear();
    if (!mask || !show) return;
    const cw = this.worldW / mask.columns;
    const ch = this.worldH / mask.rows;
    for (let row = 0; row < mask.rows; row++) {
      for (let col = 0; col < mask.columns; col++) {
        const kind = mask.cells[row * mask.columns + col] as TerrainKind;
        if (!kind || kind === "PLAINS") continue;
        const hexStr = TERRAIN_COLOR_HEX[kind];
        if (!hexStr) continue;
        const color = parseInt(hexStr.replace("#", ""), 16);
        this.overlayG.rect(
          -this.halfW + col * cw,
          -this.halfH + row * ch,
          cw, ch
        ).fill({ color, alpha: 0.44 });
      }
    }
  }

  drawBrushCursor(worldX: number, worldY: number, brushSize: number, mask: WorldTerrainMaskData | null, selectedTerrain?: TerrainKind) {
    this.brushG.clear();
    if (!mask) return;
    const cw = this.worldW / mask.columns;
    const ch = this.worldH / mask.rows;
    const radius = Math.max(0, brushSize - 1);
    const col = Math.floor((worldX + this.halfW) / cw);
    const row = Math.floor((worldY + this.halfH) / ch);
    const hexStr = selectedTerrain ? TERRAIN_COLOR_HEX[selectedTerrain] : "#ffffff";
    const color = parseInt((hexStr ?? "#ffffff").replace("#", ""), 16);
    const bSize = radius * 2 + 1;
    this.brushG
      .rect(-this.halfW + (col - radius) * cw, -this.halfH + (row - radius) * ch, bSize * cw, bSize * ch)
      .stroke({ color, width: 2 / this.viewport.scale.x, alpha: 0.9 });
  }

  paintCell(worldX: number, worldY: number, brushSize: number, mask: WorldTerrainMaskData, selectedTerrain: TerrainKind): WorldTerrainMaskData {
    const cw = this.worldW / mask.columns;
    const ch = this.worldH / mask.rows;
    const centerCol = Math.floor((worldX + this.halfW) / cw);
    const centerRow = Math.floor((worldY + this.halfH) / ch);
    const radius = Math.max(0, brushSize - 1);
    const newCells = [...mask.cells];
    let changed = false;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const col = centerCol + dc, row = centerRow + dr;
        if (col < 0 || row < 0 || col >= mask.columns || row >= mask.rows) continue;
        const idx = row * mask.columns + col;
        if (newCells[idx] !== selectedTerrain) { newCells[idx] = selectedTerrain; changed = true; }
      }
    }
    if (!changed) return mask;
    return { ...mask, cells: newCells };
  }

  floodFill(worldX: number, worldY: number, mask: WorldTerrainMaskData, selectedTerrain: TerrainKind): WorldTerrainMaskData {
    const cw = this.worldW / mask.columns;
    const ch = this.worldH / mask.rows;
    const startCol = Math.floor((worldX + this.halfW) / cw);
    const startRow = Math.floor((worldY + this.halfH) / ch);
    if (startCol < 0 || startRow < 0 || startCol >= mask.columns || startRow >= mask.rows) return mask;
    const startIdx = startRow * mask.columns + startCol;
    const targetKind = mask.cells[startIdx] as TerrainKind;
    if (targetKind === selectedTerrain) return mask;
    const newCells = [...mask.cells];
    const stack = [startIdx];
    const visited = new Set<number>();
    while (stack.length) {
      const idx = stack.pop()!;
      if (visited.has(idx)) continue;
      visited.add(idx);
      if (newCells[idx] !== targetKind) continue;
      newCells[idx] = selectedTerrain;
      const row = Math.floor(idx / mask.columns), col = idx % mask.columns;
      if (col > 0) stack.push(idx - 1);
      if (col < mask.columns - 1) stack.push(idx + 1);
      if (row > 0) stack.push(idx - mask.columns);
      if (row < mask.rows - 1) stack.push(idx + mask.columns);
    }
    return { ...mask, cells: newCells };
  }

  pickTerrain(worldX: number, worldY: number, mask: WorldTerrainMaskData): TerrainKind | null {
    const cw = this.worldW / mask.columns;
    const ch = this.worldH / mask.rows;
    const col = Math.floor((worldX + this.halfW) / cw);
    const row = Math.floor((worldY + this.halfH) / ch);
    if (col < 0 || row < 0 || col >= mask.columns || row >= mask.rows) return null;
    return mask.cells[row * mask.columns + col] as TerrainKind;
  }
}
