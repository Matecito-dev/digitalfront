import type { WorldZone, Season } from "../shared/world.js";

export const LOCAL_WORLD_ZONE_CONFIGS: WorldZone[] = [
  {
    id: "north_frozen",
    name: "Norte Helado",
    terrainTags: ["snow", "ice", "tundra"],
    seasonIntensity: {
      SPRING: 0.6,
      SUMMER: 0.4,
      AUTUMN: 0.9,
      WINTER: 1.35,
    },
    resourceModifiers: {
      food: -0.15,
      wood: -0.1,
    },
    travelModifiers: {
      WINTER: 0.7,
      SPRING: 0.85,
      SUMMER: 1.0,
      AUTUMN: 0.9,
    },
    barbarianSpawnModifier: 1.1,
  },
  {
    id: "center_temperate",
    name: "Centro Templado",
    terrainTags: ["grass", "farmland", "village"],
    seasonIntensity: {
      SPRING: 0.8,
      SUMMER: 1.0,
      AUTUMN: 0.8,
      WINTER: 0.9,
    },
    resourceModifiers: {
      food: 0.05,
    },
    travelModifiers: {
      WINTER: 0.85,
      SPRING: 0.95,
      SUMMER: 1.0,
      AUTUMN: 0.95,
    },
    barbarianSpawnModifier: 1.0,
  },
  {
    id: "south_warm",
    name: "Sur Calido",
    terrainTags: ["desert", "savanna", "oasis"],
    seasonIntensity: {
      SPRING: 0.7,
      SUMMER: 1.2,
      AUTUMN: 0.6,
      WINTER: 0.5,
    },
    resourceModifiers: {
      food: -0.05,
      gold: 0.05,
    },
    travelModifiers: {
      WINTER: 1.0,
      SPRING: 1.0,
      SUMMER: 0.85,
      AUTUMN: 1.0,
    },
    barbarianSpawnModifier: 0.9,
  },
  {
    id: "coast",
    name: "Costa",
    terrainTags: ["beach", "port", "water_edge"],
    seasonIntensity: {
      SPRING: 0.7,
      SUMMER: 0.9,
      AUTUMN: 0.7,
      WINTER: 0.75,
    },
    resourceModifiers: {
      food: 0.1,
      gold: 0.05,
    },
    travelModifiers: {
      WINTER: 0.9,
      SPRING: 0.95,
      SUMMER: 1.0,
      AUTUMN: 0.95,
    },
    barbarianSpawnModifier: 0.8,
  },
  {
    id: "mountain",
    name: "Montana",
    terrainTags: ["rock", "peak", "cliff", "mine"],
    seasonIntensity: {
      SPRING: 0.7,
      SUMMER: 0.8,
      AUTUMN: 1.0,
      WINTER: 1.2,
    },
    resourceModifiers: {
      stone: 0.2,
      wood: -0.1,
      food: -0.1,
    },
    travelModifiers: {
      WINTER: 0.6,
      SPRING: 0.75,
      SUMMER: 0.85,
      AUTUMN: 0.8,
    },
    barbarianSpawnModifier: 1.15,
  },
  {
    id: "forest",
    name: "Bosque",
    terrainTags: ["trees", "dense_forest", "woodland"],
    seasonIntensity: {
      SPRING: 0.9,
      SUMMER: 1.0,
      AUTUMN: 0.9,
      WINTER: 1.0,
    },
    resourceModifiers: {
      wood: 0.2,
      food: 0.05,
    },
    travelModifiers: {
      WINTER: 0.8,
      SPRING: 0.9,
      SUMMER: 0.9,
      AUTUMN: 0.85,
    },
    barbarianSpawnModifier: 1.3,
  },
  {
    id: "plains",
    name: "Llanura",
    terrainTags: ["grassland", "open", "field"],
    seasonIntensity: {
      SPRING: 0.85,
      SUMMER: 1.1,
      AUTUMN: 0.85,
      WINTER: 0.85,
    },
    resourceModifiers: {
      food: 0.1,
      wood: -0.05,
    },
    travelModifiers: {
      WINTER: 0.85,
      SPRING: 0.95,
      SUMMER: 1.05,
      AUTUMN: 0.95,
    },
    barbarianSpawnModifier: 1.0,
  },
];

export function resolveWorldZone(
  posX: number,
  posY: number,
  worldWidth: number,
  worldHeight: number
): WorldZone {
  const normalizedX = (posX + worldWidth / 2) / worldWidth;
  const normalizedY = (posY + worldHeight / 2) / worldHeight;

  // Norte: Y < 0.33
  if (normalizedY < 0.33) {
    if (normalizedX < 0.3 || normalizedX > 0.7) return LOCAL_WORLD_ZONE_CONFIGS.find((z) => z.id === "mountain")!;
    return LOCAL_WORLD_ZONE_CONFIGS.find((z) => z.id === "north_frozen")!;
  }

  // Sur: Y > 0.66
  if (normalizedY > 0.66) {
    if (normalizedX < 0.2 || normalizedX > 0.8) return LOCAL_WORLD_ZONE_CONFIGS.find((z) => z.id === "coast")!;
    return LOCAL_WORLD_ZONE_CONFIGS.find((z) => z.id === "south_warm")!;
  }

  // Centro
  if (normalizedX < 0.2 || normalizedX > 0.8) return LOCAL_WORLD_ZONE_CONFIGS.find((z) => z.id === "forest")!;
  if (normalizedX < 0.35 || normalizedX > 0.65) return LOCAL_WORLD_ZONE_CONFIGS.find((z) => z.id === "plains")!;
  return LOCAL_WORLD_ZONE_CONFIGS.find((z) => z.id === "center_temperate")!;
}
