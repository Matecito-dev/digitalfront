import { db, COLLECTIONS } from "../infrastructure/matecito.js";
import { getWorldConfig } from "./worldConfig.js";
import { findNearestBuildablePoint, isBuildableTerrain } from "./worldTerrainConfigData.js";

export async function repairWorldEntityPlacements() {
  const world = await getWorldConfig();
  const width = world.map.width;
  const height = world.map.height;
  const [citiesRes, campsRes] = await Promise.all([
    db.from(COLLECTIONS.CITIES).get() as any,
    db.from(COLLECTIONS.BARBARIAN_CAMPS).eq("status", "ACTIVE").get() as any,
  ]);

  const cities = citiesRes.data ?? [];
  const camps = campsRes.data ?? [];
  const changes: Array<{ type: "city" | "camp"; id: string; from: { x: number; y: number }; to: { x: number; y: number } }> = [];

  for (const city of cities) {
    const posX = Number(city.posX ?? 0);
    const posY = Number(city.posY ?? 0);
    if (isBuildableTerrain(posX, posY, width, height)) continue;
    const next = findNearestBuildablePoint(posX, posY, width, height);
    await db.from(COLLECTIONS.CITIES).eq("id", city.id).merge({ posX: next.x, posY: next.y }).execute() as any;
    changes.push({ type: "city", id: city.id, from: { x: posX, y: posY }, to: next });
  }

  for (const camp of camps) {
    const posX = Number(camp.posX ?? 0);
    const posY = Number(camp.posY ?? 0);
    if (isBuildableTerrain(posX, posY, width, height)) continue;
    const next = findNearestBuildablePoint(posX, posY, width, height);
    await db.from(COLLECTIONS.BARBARIAN_CAMPS).eq("id", camp.id).merge({ posX: next.x, posY: next.y }).execute() as any;
    changes.push({ type: "camp", id: camp.id, from: { x: posX, y: posY }, to: next });
  }

  return {
    citiesMoved: changes.filter((item) => item.type === "city").length,
    campsMoved: changes.filter((item) => item.type === "camp").length,
    changes,
  };
}

