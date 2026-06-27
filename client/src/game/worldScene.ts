import { Application, Container } from "pixi.js";
import { Viewport } from "pixi-viewport";
import { HDTileLayer } from "../render/hdTileLayer.js";
import { OverviewLayer } from "../render/overviewLayer.js";
import { UnitLayer } from "../render/unitAtlas.js";
import { DEFAULT_SEED, worldSizeFromMeta, type WorldMeta } from "../shared/constants.js";
import { getIsMobileNow } from "../shared/isMobile.js";

export class WorldScene {
  private app: Application;
  private viewport: Viewport;
  private overview: OverviewLayer;
  private tiles: HDTileLayer;
  private units: UnitLayer;
  private worldW: number;
  private worldH: number;
  private lastTileTick = 0;

  constructor(
    app: Application,
    meta: WorldMeta,
    seedLabel: string,
    mountEl: HTMLElement,
  ) {
    this.app = app;
    const { worldW, worldH, tilesX, tilesY, tileSize } = worldSizeFromMeta(meta);
    this.worldW = worldW;
    this.worldH = worldH;
    const isMobile = getIsMobileNow();

    this.viewport = new Viewport({
      screenWidth: mountEl.clientWidth,
      screenHeight: mountEl.clientHeight,
      worldWidth: worldW,
      worldHeight: worldH,
      events: app.renderer.events,
    });
    this.viewport
      .drag({ mouseButtons: "left-middle-right" })
      .pinch()
      .wheel({ smooth: 5 })
      .decelerate({ friction: 0.92 })
      .clamp({ left: 0, right: worldW, top: 0, bottom: worldH })
      .clampZoom({ minScale: 0.02, maxScale: 8 });
    this.viewport.moveCenter(worldW / 2, worldH / 2);
    app.stage.addChild(this.viewport);

    this.overview = new OverviewLayer();
    this.tiles = new HDTileLayer(
      worldW, worldH, tilesX, tilesY, tileSize, seedLabel, this.viewport, isMobile,
    );
    this.units = new UnitLayer();

    this.viewport.addChild(this.overview);
    this.viewport.addChild(this.tiles);
    this.viewport.addChild(this.units);
    this.overview.zIndex = 0;
    this.tiles.zIndex = 5;
    this.units.zIndex = 20;
    this.viewport.sortableChildren = true;

    // Demo unit markers at world center (stub — wired to sim in Phase 3)
    const msx = worldW / meta.cols;
    const msy = worldH / meta.rows;
    this.units.setUnits([
      { id: "demo-s1", kind: "soldier", x: meta.cols * 0.5 * msx, y: meta.rows * 0.5 * msy },
      { id: "demo-s2", kind: "sniper", x: meta.cols * 0.5 * msx + 80, y: meta.rows * 0.5 * msy },
    ]);

    this.overview.load(seedLabel, worldW, worldH).catch(() => {});

    app.ticker.add(this.onTick, this);
    window.addEventListener("resize", this.onResize);
    this.applyBatteryProfile();
    document.addEventListener("visibilitychange", this.applyBatteryProfile);
  }

  private applyBatteryProfile = () => {
    this.app.ticker.maxFPS = document.hidden ? 30 : 60;
  };

  private onTick = () => {
    if (document.hidden) return;
    const now = performance.now();
    if (now - this.lastTileTick >= 125) {
      this.lastTileTick = now;
      this.tiles.update();
    }
  };

  private onResize = () => {
    const el = this.app.canvas.parentElement;
    if (!el) return;
    this.viewport.resize(el.clientWidth, el.clientHeight);
  };

  destroy() {
    this.app.ticker.remove(this.onTick, this);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.applyBatteryProfile);
    this.units.destroy({ children: true });
    this.tiles.destroy({ children: true });
    this.overview.destroy({ children: true });
    this.viewport.destroy({ children: true });
  }
}

export async function bootWorldScene(mountEl: HTMLElement, seed = DEFAULT_SEED): Promise<WorldScene> {
  const seedQ = encodeURIComponent(seed);
  const res = await fetch(`/api/world?seed=${seedQ}&waterPercent=0.28`);
  if (!res.ok) throw new Error(`world meta ${res.status}`);
  const meta = (await res.json()) as WorldMeta;

  const app = new Application();
  await app.init({
    resizeTo: mountEl,
    backgroundColor: 0x050810,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  mountEl.appendChild(app.canvas as HTMLCanvasElement);

  return new WorldScene(app, meta, seed, mountEl);
}
