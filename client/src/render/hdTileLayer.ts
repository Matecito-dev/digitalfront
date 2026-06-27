import { Assets, Container, Sprite, Texture } from "pixi.js";
import type { Viewport } from "pixi-viewport";

/** Desktop / mobile tile retain — ported from tileLayer.ts (MOBILE_RETAIN, PREWARM_RETAIN). */
const PREWARM_RETAIN = 6;
const MOBILE_RETAIN = 3;
const PREFETCH_D = 3;
const PREFETCH_M = 2;
const MAX_INFLIGHT_DESKTOP = 12;
const MAX_INFLIGHT_MOBILE = 4;
/** Show HD 128×128 tiles when on-screen tile edge exceeds this (matches Phaser TILE_THRESHOLD). */
const TILE_THRESHOLD = 64;

type TileKey = string;

export class HDTileLayer extends Container {
  private tilesX: number;
  private tilesY: number;
  private tileSize: number;
  private worldW: number;
  private worldH: number;
  private seed: string;
  private viewport: Viewport;
  private isMobile: boolean;

  private tiles = new Map<TileKey, { sprite: Sprite; url: string }>();
  private loaded = new Set<TileKey>();
  private inflight = 0;
  private lastSig = "";
  private prevCamX = 0;
  private prevCamY = 0;

  constructor(
    worldW: number,
    worldH: number,
    tilesX: number,
    tilesY: number,
    tileSize: number,
    seed: string,
    viewport: Viewport,
    isMobile: boolean,
  ) {
    super();
    this.worldW = worldW;
    this.worldH = worldH;
    this.tilesX = tilesX;
    this.tilesY = tilesY;
    this.tileSize = tileSize;
    this.seed = seed;
    this.viewport = viewport;
    this.isMobile = isMobile;
  }

  /** Call from ticker at ~8 fps when zoomed in. */
  update() {
    const vp = this.viewport;
    const scale = vp.scale.x;
    const tileScreen = this.tileSize * scale;
    if (tileScreen < TILE_THRESHOLD) {
      this.visible = false;
      return;
    }
    this.visible = true;

    const vis = vp.getVisibleBounds();
    const minWX = vis.x;
    const maxWX = vis.x + vis.width;
    const minWY = vis.y;
    const maxWY = vis.y + vis.height;

    const velX = vp.x - this.prevCamX;
    const velY = vp.y - this.prevCamY;
    this.prevCamX = vp.x;
    this.prevCamY = vp.y;
    const VPAN = this.tileSize * 0.3 * scale;
    const PREF = this.isMobile ? PREFETCH_M : PREFETCH_D;
    const dxL = velX < -VPAN ? 2 : 0;
    const dxR = velX > VPAN ? 2 : 0;
    const dyU = velY < -VPAN ? 2 : 0;
    const dyD = velY > VPAN ? 2 : 0;

    const tx0 = Math.max(0, Math.floor(minWX / this.tileSize) - PREF - dxL);
    const tx1 = Math.min(this.tilesX - 1, Math.floor(maxWX / this.tileSize) + PREF + dxR);
    const ty0 = Math.max(0, Math.floor(minWY / this.tileSize) - PREF - dyU);
    const ty1 = Math.min(this.tilesY - 1, Math.floor(maxWY / this.tileSize) + PREF + dyD);

    const wantedKeys = new Set<TileKey>();
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++)
        wantedKeys.add(`${tx}:${ty}`);

    const complete = [...wantedKeys].every((k) => this.loaded.has(k));
    const sig = `${tx0},${ty0},${tx1},${ty1}:${complete}:${scale.toFixed(3)}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${tx}:${ty}`;
        if (!this.tiles.has(key)) this.scheduleLoad(key, tx, ty);
      }
    }

    const RETAIN = this.isMobile ? MOBILE_RETAIN : PREWARM_RETAIN;
    const rx0 = Math.max(0, tx0 - RETAIN);
    const rx1 = Math.min(this.tilesX - 1, tx1 + RETAIN);
    const ry0 = Math.max(0, ty0 - RETAIN);
    const ry1 = Math.min(this.tilesY - 1, ty1 + RETAIN);

    for (const [key, entry] of this.tiles) {
      const [tx, ty] = key.split(":").map(Number);
      const remove = tx < rx0 || tx > rx1 || ty < ry0 || ty > ry1;
      if (!remove) continue;
      entry.sprite.destroy();
      Assets.unload(entry.url).catch(() => {});
      this.tiles.delete(key);
      this.loaded.delete(key);
    }
  }

  private tileUrl(tx: number, ty: number): string {
    const seedQ = encodeURIComponent(this.seed);
    return `/api/tile.webp?seed=${seedQ}&tx=${tx}&ty=${ty}&waterPercent=0.28`;
  }

  private maxInflight(): number {
    return this.isMobile ? MAX_INFLIGHT_MOBILE : MAX_INFLIGHT_DESKTOP;
  }

  private scheduleLoad(key: TileKey, tx: number, ty: number) {
    if (this.inflight >= this.maxInflight()) return;
    this.inflight++;
    this.loadTile(key, tx, ty).finally(() => {
      this.inflight--;
    });
  }

  private async loadTile(key: TileKey, tx: number, ty: number) {
    const url = this.tileUrl(tx, ty);
    try {
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
      tex.source.scaleMode = "linear";
      const sprite = new Sprite(tex);
      sprite.x = tx * this.tileSize;
      sprite.y = ty * this.tileSize;
      sprite.width = this.tileSize;
      sprite.height = this.tileSize;
      sprite.alpha = 0;
      this.addChild(sprite);
      this.tiles.set(key, { sprite, url });
      this.loaded.add(key);

      const fade = () => {
        if (!sprite.destroyed) {
          sprite.alpha = Math.min(1, sprite.alpha + 0.12);
          if (sprite.alpha < 1) requestAnimationFrame(fade);
        }
      };
      requestAnimationFrame(fade);
    } catch {
      // Overview layer visible below
    }
  }

  destroy(options?: Parameters<Container["destroy"]>[0]) {
    for (const [, entry] of this.tiles) {
      entry.sprite.destroy();
      Assets.unload(entry.url).catch(() => {});
    }
    this.tiles.clear();
    this.loaded.clear();
    super.destroy(options);
  }
}
