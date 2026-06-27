export type WorldMapConfig = {
  width: number;
  height: number;
  cameraMinZoom: number;
  cameraMaxZoom: number;
  cameraInitialZoom: number;
  backgroundAssetPath: string;
  terrainSeed: number;
  decorDensity: number;
  decorSafeRadius: number;
  terrainOverlayEnabled?: boolean;
  // Procedural terrain grid dimensions
  terrainCols: number;
  terrainRows: number;
  tileSize: number; // px per tile in world space
};

export type WorldSpawnConfig = {
  strategy: "soft-clusters";
  minCityDistance: number;
  clusterRadius: number;
  clusterTargetPlayers: number;
  clusterSearchStep: number;
  edgePadding: number;
  maxPlacementAttempts: number;
};

export type WorldConfigDoc = {
  id: string;
  version: number;
  map: WorldMapConfig;
  spawn: WorldSpawnConfig;
  createdAt: string;
  updatedAt: string;
};

const now = new Date().toISOString();

export const LOCAL_WORLD_CONFIG: WorldConfigDoc = {
  id: 'local-world-config',
  version: 1,
  map: {
    width: 80000,
    height: 80000,
    cameraMinZoom: 0.04,
    cameraMaxZoom: 2.2,
    cameraInitialZoom: 0.16,
    backgroundAssetPath: "/assets/backgrounds/world-map-terrain-v2.webp",
    terrainSeed: 1337,
    decorDensity: 0.7,
    decorSafeRadius: 280,
    terrainOverlayEnabled: false,
    terrainCols: 2200,
    terrainRows: 2200,
    tileSize: 36,
  },
  spawn: {
    strategy: "soft-clusters",
    minCityDistance: 960,
    clusterRadius: 4000,
    clusterTargetPlayers: 8,
    clusterSearchStep: 2000,
    edgePadding: 840,
    maxPlacementAttempts: 320,
  },
  createdAt: now,
  updatedAt: now,
};
