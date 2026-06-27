import { Container, Sprite, Texture } from "pixi.js";

/** Unit sprite kinds — stub atlas for Phase 2.3 (full art deferred). */
export type UnitKind = "soldier" | "sniper" | "barbarian_melee" | "barbarian_ranged";

const UNIT_COLORS: Record<UnitKind, number> = {
  soldier: 0x3fb950,
  sniper: 0x58a6ff,
  barbarian_melee: 0xd29922,
  barbarian_ranged: 0xf85149,
};

const SIZE = 64;

function colorToRgb(hex: number) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

/**
 * Procedural placeholder atlas — 64×64 cells per unit type.
 * Replace with authored PNG atlas in a later art pass; API stays stable.
 */
export class UnitAtlas {
  private textures = new Map<UnitKind, Texture>();

  getTexture(kind: UnitKind): Texture {
    let tex = this.textures.get(kind);
    if (tex) return tex;
    tex = this.makePlaceholder(kind);
    this.textures.set(kind, tex);
    return tex;
  }

  private makePlaceholder(kind: UnitKind): Texture {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    const { r, g, b } = colorToRgb(UNIT_COLORS[kind]);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.roundRect(4, 8, SIZE - 8, SIZE - 12, 6);
    ctx.fill();
    ctx.fillStyle = "#ffdcc8";
    ctx.beginPath();
    ctx.arc(SIZE / 2, 14, 10, 0, Math.PI * 2);
    ctx.fill();
    if (kind === "sniper") {
      ctx.fillStyle = "#30363d";
      ctx.fillRect(SIZE / 2 - 2, 20, 4, 28);
    }
    return Texture.from(canvas);
  }
}

/** Minimal unit layer — draws atlas sprites at world positions (stub). */
export class UnitLayer extends Container {
  private atlas = new UnitAtlas();
  private sprites = new Map<string, Sprite>();

  setUnits(units: Array<{ id: string; kind: UnitKind; x: number; y: number }>) {
    const seen = new Set<string>();
    for (const u of units) {
      seen.add(u.id);
      let spr = this.sprites.get(u.id);
      if (!spr) {
        spr = new Sprite(this.atlas.getTexture(u.kind));
        spr.anchor.set(0.5, 0.85);
        spr.width = 48;
        spr.height = 48;
        this.addChild(spr);
        this.sprites.set(u.id, spr);
      }
      spr.x = u.x;
      spr.y = u.y;
    }
    for (const [id, spr] of this.sprites) {
      if (!seen.has(id)) {
        spr.destroy();
        this.sprites.delete(id);
      }
    }
  }
}
