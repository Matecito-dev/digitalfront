import { Assets, Sprite, Container, Texture } from "pixi.js";
import type { Viewport } from "pixi-viewport";

// Tiles are now served at 512×512px (doubled from 256). We keep TILE_PX at 256
// in the z-selection formula so the same number of tiles cover the viewport —
// the tiles are just twice as dense, giving crisp results at high zoom.
const TILE_PX = 256;
const TILE_ZMAX = 10;
const PREWARM_RETAIN = 6; // desktop
const MOBILE_RETAIN = 3;
const PREFETCH_D = 3;
const PREFETCH_M = 2;

type TileKey = string; // "z:x:y"

export class TileLayer extends Container {
  private worldW: number;
  private worldH: number;
  private viewport: Viewport;
  private isMobile: boolean;
  private terrainVersion: string;
  private tiles = new Map<TileKey, { sprite: Sprite; url: string }>();
  private loaded = new Set<TileKey>();
  private lastSig = "";
  private prevCamX = 0;
  private prevCamY = 0;

  constructor(worldW: number, worldH: number, viewport: Viewport, isMobile: boolean, terrainVersion = "") {
    super();
    this.worldW = worldW;
    this.worldH = worldH;
    this.viewport = viewport;
    this.isMobile = isMobile;
    this.terrainVersion = terrainVersion;
  }

  /** Call from ticker at ~8fps. */
  update() {
    const vp = this.viewport;
    const scale = vp.scale.x;
    const worldW = this.worldW;

    const z = Math.max(0, Math.min(TILE_ZMAX, Math.round(Math.log2((worldW * scale) / TILE_PX))));
    const span = 1 << z;
    const tileWorld = worldW / span;

    // Visible world bounds
    const vis = vp.getVisibleBounds();
    const minWX = vis.x - this.worldW / 2;
    const maxWX = vis.x + vis.width - this.worldW / 2;
    const minWY = vis.y - this.worldH / 2;
    const maxWY = vis.y + vis.height - this.worldH / 2;

    // Directional prefetch
    const velX = vp.x - this.prevCamX;
    const velY = vp.y - this.prevCamY;
    this.prevCamX = vp.x;
    this.prevCamY = vp.y;
    const VPAN = tileWorld * 0.3 * scale;
    const PREF = this.isMobile ? PREFETCH_M : PREFETCH_D;
    const dxL = velX < -VPAN ? 2 : 0;
    const dxR = velX > VPAN ? 2 : 0;
    const dyU = velY < -VPAN ? 2 : 0;
    const dyD = velY > VPAN ? 2 : 0;

    const x0 = Math.max(0, Math.floor((minWX + worldW / 2) / tileWorld) - PREF - dxL);
    const x1 = Math.min(span - 1, Math.floor((maxWX + worldW / 2) / tileWorld) + PREF + dxR);
    const y0 = Math.max(0, Math.floor((minWY + worldW / 2) / tileWorld) - PREF - dyU);
    const y1 = Math.min(span - 1, Math.floor((maxWY + worldW / 2) / tileWorld) + PREF + dyD);

    const wantedKeys = new Set<TileKey>();
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        wantedKeys.add(`${z}:${tx}:${ty}`);

    const complete = [...wantedKeys].every(k => this.loaded.has(k));
    const sig = `${z}:${x0},${y0},${x1},${y1}:${complete}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    // Add new tiles
    const halfW = this.worldW / 2;
    const halfH = this.worldH / 2;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const key = `${z}:${tx}:${ty}`;
        if (!this.tiles.has(key)) {
          this.loadTile(key, z, tx, ty, tx * tileWorld - halfW, ty * tileWorld - halfH, tileWorld);
        }
      }
    }

    // Prune
    const RETAIN = this.isMobile ? MOBILE_RETAIN : PREWARM_RETAIN;
    const rx0 = Math.max(0, x0 - RETAIN), rx1 = Math.min(span - 1, x1 + RETAIN);
    const ry0 = Math.max(0, y0 - RETAIN), ry1 = Math.min(span - 1, y1 + RETAIN);

    for (const [key, entry] of this.tiles) {
      const [kz, kx, ky] = key.split(":").map(Number);
      let remove = false;
      if (kz !== z) {
        remove = complete;
      } else {
        remove = (kx < rx0 || kx > rx1 || ky < ry0 || ky > ry1);
      }
      if (remove) {
        // Bug 4 fix: destruir sólo el sprite, no la textura — Assets.unload evicta el cache
        // limpiamente y libera GPU sin dejar entradas destruidas que romperían re-carga.
        entry.sprite.destroy();
        Assets.unload(entry.url).catch(() => {});
        this.tiles.delete(key);
        this.loaded.delete(key);
      }
    }
  }

  private tileUrl(z: number, tx: number, ty: number): string {
    const vParam = this.terrainVersion ? `?v=${encodeURIComponent(this.terrainVersion)}` : "";
    return `/api/world/terrain-tile/${z}/${tx}/${ty}${vParam}`;
  }

  private async loadTile(key: TileKey, z: number, tx: number, ty: number, left: number, top: number, size: number) {
    const url = this.tileUrl(z, tx, ty);
    try {
      // API tile URLs have no file extension — use HTMLImageElement to guarantee image decoding
      const img = new Image();
      img.crossOrigin = "";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`tile load failed: ${url}`));
        img.src = url;
      });
      await img.decode();
      if (this.tiles.has(key)) return;
      const tex = Texture.from(img);
      tex.source.autoGenerateMipmaps = true;
      tex.source.scaleMode = "linear";
      const sprite = new Sprite(tex);
      sprite.x = left;
      sprite.y = top;
      sprite.width = size;
      sprite.height = size;
      sprite.alpha = 0;
      this.addChild(sprite);
      this.tiles.set(key, { sprite, url });
      this.loaded.add(key);
      const fade = () => {
        if (!sprite.destroyed) {
          sprite.alpha = Math.min(1, sprite.alpha + 0.08);
          if (sprite.alpha < 1) requestAnimationFrame(fade);
        }
      };
      requestAnimationFrame(fade);
    } catch {
      // Tile load failed — overview layer visible below
    }
  }
}
