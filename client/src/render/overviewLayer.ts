import { Assets, Container, Sprite, Texture } from "pixi.js";

/** Full-world overview PNG from server — shown at far zoom, HD tiles on top when near. */
export class OverviewLayer extends Container {
  private sprite: Sprite | null = null;
  private url = "";

  async load(seed: string, worldW: number, worldH: number): Promise<void> {
    const seedQ = encodeURIComponent(seed);
    this.url = `/api/overview.png?seed=${seedQ}&waterPercent=0.28&v=10`;

    const img = new Image();
    img.crossOrigin = "";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("overview load failed"));
      img.src = this.url;
    });
    await img.decode();

    if (this.sprite) {
      this.sprite.destroy();
      if (this.url) Assets.unload(this.url).catch(() => {});
    }

    const tex = Texture.from(img);
    tex.source.scaleMode = "linear";
    const sprite = new Sprite(tex);
    sprite.x = 0;
    sprite.y = 0;
    sprite.width = worldW;
    sprite.height = worldH;
    sprite.alpha = 0.85;
    this.addChild(sprite);
    this.sprite = sprite;
  }

  destroy(options?: Parameters<Container["destroy"]>[0]) {
    if (this.sprite) {
      this.sprite.destroy();
      if (this.url) Assets.unload(this.url).catch(() => {});
      this.sprite = null;
    }
    super.destroy(options);
  }
}
