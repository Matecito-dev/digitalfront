import { Assets, Container, Graphics, Sprite, Texture, Text } from "pixi.js";
import type { Viewport } from "pixi-viewport";
import type { WorldRegion, WorldPOI } from "@etheria/shared";

const GEO_FEATURE_TYPES = new Set(["LAKE", "RANGE", "CAPE", "BAY"]);
const POI_COLORS: Record<string, number> = {
  RUINS: 0xc8a96e, PEAK: 0xb0c4de, RESOURCE: 0x66dda0, HARBOR: 0x5bc8f5,
};
const POI_ICONS: Record<string, string> = {
  RUINS: "🏚", PEAK: "⛰", RESOURCE: "💎", HARBOR: "⚓",
};

export class OverlayLayer extends Container {
  private worldW: number;
  private worldH: number;
  private halfW: number;
  private halfH: number;
  private viewport: Viewport;

  // Sub-containers by z-order
  waterBg: Container;
  overviewSprite?: Sprite;
  regionBorderSprite?: Sprite;
  regionLabels: Container;
  geoLabels: Container;
  poiMarkers: Container;
  weatherRect: Graphics;
  fogRect: Graphics;

  constructor(worldW: number, worldH: number, viewport: Viewport) {
    super();
    this.worldW = worldW;
    this.worldH = worldH;
    this.halfW = worldW / 2;
    this.halfH = worldH / 2;
    this.viewport = viewport;

    this.waterBg = new Container();
    this.regionLabels = new Container();
    this.geoLabels = new Container();
    this.poiMarkers = new Container();
    this.weatherRect = new Graphics();
    this.fogRect = new Graphics();

    this.addChild(this.waterBg, this.regionLabels, this.geoLabels, this.poiMarkers);
  }

  loadWater() {
    // Solid ocean base — the terrain overview image shows oceans correctly once loaded
    const g = new Graphics();
    g.rect(-this.halfW, -this.halfH, this.worldW, this.worldH).fill({ color: 0x1a6fa3 });
    this.waterBg.addChild(g);
  }

  async loadOverview(isMobile: boolean, terrainVersion: string) {
    const vParam = terrainVersion ? `&v=${encodeURIComponent(terrainVersion)}` : "";
    const variant = isMobile ? "mobile" : "default";
    const url = `/api/world/terrain-image?variant=${variant}${vParam}`;
    try {
      // Assets.load detects parser by URL extension — API URLs have no extension,
      // so we load via HTMLImageElement to guarantee image decoding.
      const img = new Image();
      img.crossOrigin = "";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`terrain-image load failed: ${url}`));
        img.src = url;
      });
      await img.decode();
      const tex = Texture.from(img);
      const sprite = new Sprite(tex);
      sprite.x = -this.halfW;
      sprite.y = -this.halfH;
      sprite.width = this.worldW;
      sprite.height = this.worldH;
      sprite.alpha = 0;
      this.overviewSprite = sprite;
      this.addChildAt(sprite, 1);
      const fade = () => {
        if (!sprite.destroyed) {
          sprite.alpha = Math.min(1, sprite.alpha + 0.06);
          if (sprite.alpha < 1) requestAnimationFrame(fade);
        }
      };
      requestAnimationFrame(fade);
    } catch (err) {
      console.error("[WorldMap] terrain overview failed:", err);
    }
  }

  async loadRegionBorders() {
    try {
      const d: { cols: number; rows: number; ids: string } = await fetch("/api/world/region-map").then(r => r.json());
      if (!d.ids) return;
      const bin = atob(d.ids);
      const ids = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) ids[i] = bin.charCodeAt(i);
      const oc = document.createElement("canvas");
      oc.width = d.cols; oc.height = d.rows;
      const ctx = oc.getContext("2d")!;
      ctx.strokeStyle = "rgba(240,220,160,0.22)";
      ctx.lineWidth = 1;
      for (let row = 0; row < d.rows - 1; row++) {
        for (let col = 0; col < d.cols - 1; col++) {
          const id = ids[row * d.cols + col];
          if (id === 255) continue;
          const idR = ids[row * d.cols + col + 1];
          const idD = ids[(row + 1) * d.cols + col];
          if (idR !== id && idR !== 255) { ctx.beginPath(); ctx.moveTo(col + 1, row); ctx.lineTo(col + 1, row + 1); ctx.stroke(); }
          if (idD !== id && idD !== 255) { ctx.beginPath(); ctx.moveTo(col, row + 1); ctx.lineTo(col + 1, row + 1); ctx.stroke(); }
        }
      }
      const tex = Texture.from(oc);
      const sprite = new Sprite(tex);
      sprite.x = -this.halfW; sprite.y = -this.halfH;
      sprite.width = this.worldW; sprite.height = this.worldH;
      sprite.alpha = 0.6;
      this.regionBorderSprite = sprite;
      this.addChildAt(sprite, this.overviewSprite ? 2 : 1);
    } catch {}
  }

  setRegions(regions: WorldRegion[]) {
    this.regionLabels.removeChildren().forEach((c: any) => c.destroy?.());
    for (const r of regions) {
      const t = new Text({
        text: r.name,
        style: {
          fontFamily: "Georgia, serif",
          fontSize: 14,
          fontWeight: "700",
          fill: "rgba(240,225,195,0.82)",
          letterSpacing: 2,
          dropShadow: { color: 0x000000, alpha: 0.9, blur: 6, distance: 0 },
        }
      });
      t.anchor.set(0.5);
      t.x = r.centroidX;
      t.y = r.centroidY;
      this.regionLabels.addChild(t);
    }
  }

  setGeoFeatures(pois: WorldPOI[]) {
    this.geoLabels.removeChildren().forEach((c: any) => c.destroy?.());
    for (const p of pois.filter(p => GEO_FEATURE_TYPES.has(p.type))) {
      const t = new Text({
        text: p.name,
        style: {
          fontFamily: "Georgia, serif",
          fontSize: 12,
          fontStyle: "italic",
          fill: "rgba(200,230,255,0.70)",
          dropShadow: { color: 0x000000, alpha: 0.9, blur: 4, distance: 0 },
        }
      });
      t.anchor.set(0.5);
      t.x = p.x; t.y = p.y;
      this.geoLabels.addChild(t);
    }
  }

  setPOIs(pois: WorldPOI[]) {
    this.poiMarkers.removeChildren().forEach((c: any) => c.destroy?.());
    for (const p of pois.filter(p => !GEO_FEATURE_TYPES.has(p.type))) {
      const icon = POI_ICONS[p.type] ?? "📍";
      const t = new Text({ text: icon, style: { fontSize: 18 } });
      t.anchor.set(0.5, 0.9);
      t.x = p.x; t.y = p.y;
      t.eventMode = "static";
      t.cursor = "pointer";
      this.poiMarkers.addChild(t);
    }
  }

  /** Update label/POI scales against viewport zoom so they stay readable. */
  updateScales(viewportScale: number) {
    const s = Math.max(0.5, Math.min(3, 1 / viewportScale));
    const fadeIn = Math.max(0, Math.min(1, (1 / viewportScale) * 1.5 - 0.5));
    const fadeOut = Math.max(0, Math.min(1, viewportScale * 2 - 0.5));
    for (const child of this.regionLabels.children) {
      (child as Text).scale.set(s);
      (child as Text).alpha = fadeIn;
    }
    for (const child of this.geoLabels.children) {
      (child as Text).scale.set(s);
      (child as Text).alpha = fadeIn;
    }
    for (const child of this.poiMarkers.children) {
      (child as Text).scale.set(Math.max(0.4, Math.min(1.6, 1 / viewportScale)));
      (child as Text).alpha = fadeOut;
    }
  }

  applyWeather(seasonState: any) {
    if (!seasonState) { this.weatherRect.clear(); return; }
    const season = seasonState.currentSeason;
    const intensity = seasonState.intensity ?? 1;
    this.weatherRect.clear();
    let color = 0xffffff, alpha = 0;
    if (season === "WINTER") { color = 0xffffff; alpha = 0.22 * intensity; }
    else if (season === "AUTUMN") { color = 0xffaa66; alpha = 0.12 * intensity; }
    else if (season === "SUMMER") { color = 0xfff0aa; alpha = 0.08 * intensity; }
    else if (season === "SPRING") { color = 0xb4ffa0; alpha = 0.06 * intensity; }
    if (alpha > 0) {
      this.weatherRect.rect(0, 0, 9999, 9999).fill({ color, alpha });
    }
  }
}
