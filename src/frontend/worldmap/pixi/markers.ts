import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { Viewport } from "pixi-viewport";

const RELATION_COLORS: Record<string, number> = {
  own: 0xe8c468, ally: 0x49f0c5, peace: 0x6fc8ff, hostile: 0xd75f43, neutral: 0xe7d6a8,
};
const ARCHETYPE_COLORS: Record<string, number> = {
  RAIDERS: 0xd75f43, HUNTERS: 0x49f0c5, MARAUDERS: 0xff6b35, WARHOST: 0x9b59b6, NOMADS: 0xf39c12,
};

type WorldCity = {
  id: string; name: string; posX: number; posY: number;
  level?: number; allianceId?: string | null;
  relation?: "ally" | "peace" | "hostile" | "neutral";
};
type BarbarianCamp = {
  id: string; name: string; level: number; archetype: string;
  posX: number; posY: number; status: string; estimatedPower: number;
};

export class MarkersLayer extends Container {
  private viewport: Viewport;
  private myCityId: string | null = null;
  private onSelectCity?: (id: string, pos: { x: number; y: number }) => void;
  private onSelectCamp?: (camp: BarbarianCamp, pos: { x: number; y: number }) => void;
  private onDoubleClickMyCity?: () => void;
  private cityContainers = new Map<string, Container>();
  private campContainers = new Map<string, Container>();
  private campGlows = new Map<string, Graphics>();
  private villageTexture?: Texture;
  private campTexture?: Texture;
  private texturesLoaded = false;

  constructor(viewport: Viewport) {
    super();
    this.viewport = viewport;
    this.eventMode = "static";
  }

  async loadTextures() {
    try {
      this.villageTexture = await Assets.load("/assets/map/player-village.png");
    } catch {}
    try {
      this.campTexture = await Assets.load("/assets/map/barbarian-camp.png");
    } catch {}
    this.texturesLoaded = true;
  }

  setCallbacks(
    myCityId: string | null,
    onSelectCity?: (id: string, pos: { x: number; y: number }) => void,
    onSelectCamp?: (camp: BarbarianCamp, pos: { x: number; y: number }) => void,
    onDoubleClick?: () => void,
  ) {
    this.myCityId = myCityId;
    this.onSelectCity = onSelectCity;
    this.onSelectCamp = onSelectCamp;
    this.onDoubleClickMyCity = onDoubleClick;
  }

  setCities(cities: WorldCity[]) {
    const ids = new Set(cities.map(c => c.id));
    for (const [id, c] of this.cityContainers) {
      if (!ids.has(id)) { c.destroy({ children: true }); this.cityContainers.delete(id); }
    }
    for (const city of cities) {
      const isMe = city.id === this.myCityId;
      const color = RELATION_COLORS[city.relation ?? (isMe ? "own" : "neutral")];
      let container = this.cityContainers.get(city.id);
      if (!container) {
        container = this.buildCityMarker(city, isMe, color);
        this.addChild(container);
        this.cityContainers.set(city.id, container);
      } else {
        container.x = city.posX;
        container.y = city.posY;
      }
    }
  }

  private buildCityMarker(city: WorldCity, isMe: boolean, color: number): Container {
    const c = new Container();
    c.x = city.posX; c.y = city.posY;
    c.eventMode = "static"; c.cursor = "pointer";

    let icon: Sprite | Graphics;
    if (this.villageTexture) {
      icon = new Sprite(this.villageTexture);
      icon.anchor.set(0.5, 0.85);
      icon.width = 80; icon.height = 80;
    } else {
      const g = new Graphics();
      g.circle(0, -12, 14).fill({ color: isMe ? 0xe8c468 : 0xaaaaaa });
      icon = g as unknown as Sprite;
    }
    c.addChild(icon as any);

    if (isMe) {
      const ring = new Graphics();
      ring.circle(0, -68 * 0.85, 45).stroke({ color, width: 2, alpha: 0.7 });
      c.addChild(ring);
    }

    if (city.level != null) {
      const lv = new Text({
        text: `Lv.${city.level}`,
        style: { fontSize: 9, fontWeight: "700", fill: 0xffd700, dropShadow: { color: 0x000000, alpha: 0.95, blur: 3, distance: 0 } }
      });
      lv.anchor.set(0.5, 0); lv.y = 4;
      c.addChild(lv);
    }

    const lbl = new Text({
      text: city.name,
      style: { fontSize: 10, fill: color, dropShadow: { color: 0x000000, alpha: 0.95, blur: 4, distance: 0 } }
    });
    lbl.anchor.set(0.5, 0); lbl.y = 16;
    c.addChild(lbl);

    c.on("pointertap", (e: any) => {
      e.stopPropagation();
      const screen = this.viewport.toScreen(city.posX, city.posY);
      this.onSelectCity?.(city.id, { x: screen.x, y: screen.y });
    });
    if (isMe) {
      let lastTap = 0;
      c.on("pointertap", () => {
        const now = Date.now();
        if (now - lastTap < 350) this.onDoubleClickMyCity?.();
        lastTap = now;
      });
    }
    return c;
  }

  setCamps(camps: BarbarianCamp[]) {
    const ids = new Set(camps.map(c => c.id));
    for (const [id, c] of this.campContainers) {
      if (!ids.has(id)) { c.destroy({ children: true }); this.campContainers.delete(id); this.campGlows.delete(id); }
    }
    for (const camp of camps) {
      if (camp.status !== "ACTIVE") continue;
      let container = this.campContainers.get(camp.id);
      if (!container) {
        container = this.buildCampMarker(camp);
        this.addChild(container);
        this.campContainers.set(camp.id, container);
      } else {
        container.x = camp.posX; container.y = camp.posY;
      }
    }
  }

  private buildCampMarker(camp: BarbarianCamp): Container {
    const c = new Container();
    c.x = camp.posX; c.y = camp.posY;
    c.eventMode = "static"; c.cursor = "pointer";
    const color = ARCHETYPE_COLORS[camp.archetype] ?? 0xd75f43;

    // Campfire glow — pre-drawn warm radial, animated (alpha/scale) in the ticker.
    // Sits behind the icon so the camp looks lived-in and breathing.
    const glow = new Graphics();
    const glowR = 42;
    for (let i = 6; i >= 1; i--) {
      glow.circle(0, -6, (glowR * i) / 6).fill({ color: 0xff8a3d, alpha: 0.06 });
    }
    glow.circle(0, -6, 7).fill({ color: 0xffd27a, alpha: 0.5 });
    c.addChild(glow);
    this.campGlows.set(camp.id, glow);

    let icon: Sprite | Graphics;
    if (this.campTexture) {
      icon = new Sprite(this.campTexture);
      icon.anchor.set(0.5, 0.85);
      icon.width = 130; icon.height = 130;
      icon.tint = color;
    } else {
      const g = new Graphics();
      g.poly([0, -20, 14, 8, -14, 8]).fill({ color });
      icon = g as unknown as Sprite;
    }
    c.addChild(icon as any);

    const lv = new Text({
      text: `Lv.${camp.level}`,
      style: { fontSize: 10, fontWeight: "700", fill: 0xff6b6b, dropShadow: { color: 0x000000, alpha: 0.95, blur: 3, distance: 0 } }
    });
    lv.anchor.set(0.5, 1); lv.y = -16;
    c.addChild(lv);

    const lbl = new Text({
      text: camp.name,
      style: { fontSize: 11, fill: color, dropShadow: { color: 0x000000, alpha: 0.95, blur: 4, distance: 0 } }
    });
    lbl.anchor.set(0.5, 0); lbl.y = 8;
    c.addChild(lbl);

    c.on("pointertap", (e: any) => {
      e.stopPropagation();
      const screen = this.viewport.toScreen(camp.posX, camp.posY);
      this.onSelectCamp?.(camp, { x: screen.x, y: screen.y });
    });
    return c;
  }

  /** Cull + counter-scale. Call from ticker. */
  updateScales(viewportScale: number) {
    const vis = this.viewport.getVisibleBounds();
    const margin = 200;
    const min = 0.42, max = 2.2;
    const s = Math.max(min, Math.min(max, 1 / viewportScale));
    for (const [, c] of this.cityContainers) {
      const inView = c.x >= vis.x - margin && c.x <= vis.x + vis.width + margin
        && c.y >= vis.y - margin && c.y <= vis.y + vis.height + margin;
      c.visible = inView;
      if (inView) c.scale.set(s);
    }
    const now = performance.now();
    for (const [id, c] of this.campContainers) {
      const inView = c.x >= vis.x - margin && c.x <= vis.x + vis.width + margin
        && c.y >= vis.y - margin && c.y <= vis.y + vis.height + margin;
      c.visible = inView;
      if (!inView) continue;
      c.scale.set(s);
      // Flicker the campfire: each camp offset by its id hash so they don't pulse in unison.
      const glow = this.campGlows.get(id);
      if (glow) {
        const phase = (id.charCodeAt(0) + id.charCodeAt(id.length - 1)) * 0.7;
        const flick = Math.sin(now * 0.004 + phase) * 0.5 + Math.sin(now * 0.013 + phase) * 0.5;
        glow.alpha = 0.65 + flick * 0.35;
        const gs = 1 + flick * 0.12;
        glow.scale.set(gs);
      }
    }
  }
}
