import type { Container } from "pixi.js";

/** Clamp-scaled counter-zoom: keeps a world-space object at a constant screen size. */
export function applyCounterScale(
  obj: Container,
  viewportScale: number,
  multiplier = 1,
  min = 0.42,
  max = 2.2
) {
  const s = Math.max(min, Math.min(max, (1 / viewportScale) * multiplier));
  obj.scale.set(s);
}

/** Returns stroke width in world units that equals `screenPx` pixels at current scale. */
export function screenPxToWorld(screenPx: number, viewportScale: number) {
  return screenPx / viewportScale;
}
