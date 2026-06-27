import { prisma } from "@etheria/database";
import { LOCAL_WORLD_CONFIG, type WorldConfigDoc } from "./worldConfigData.js";

export type WorldListItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  playerCount: number;
  sortOrder: number;
  currentSeason: string | null;
};

type WorldRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  playerCount: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  config: any;
};

function serializeWorld(w: any): WorldRecord {
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    description: w.description,
    status: w.status,
    playerCount: w.playerCount,
    sortOrder: w.sortOrder,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    config: typeof w.config === "string" ? JSON.parse(w.config) : w.config,
  };
}

export async function listActiveWorlds(): Promise<WorldListItem[]> {
  const [worlds, cityCounts, seasons] = await Promise.all([
    prisma.world.findMany({
      where: { status: "ACTIVE" },
      orderBy: { sortOrder: "asc" },
    }),
    // The stored playerCount column was never updated (always 0); derive the
    // real population from cities instead.
    prisma.city.groupBy({ by: ["worldId"], _count: { _all: true } }),
    prisma.worldSeasonState.findMany({ select: { worldId: true, currentSeason: true } }),
  ]);
  const countByWorld = new Map(cityCounts.map((c) => [c.worldId, c._count._all]));
  const seasonByWorld = new Map(seasons.map((s) => [s.worldId, s.currentSeason]));
  return worlds.map((w) => ({
    id: w.id,
    slug: w.slug,
    name: w.name,
    description: w.description,
    status: w.status,
    playerCount: countByWorld.get(w.id) ?? 0,
    sortOrder: w.sortOrder,
    currentSeason: seasonByWorld.get(w.id) ?? null,
  }));
}

export async function getWorldById(id: string): Promise<WorldRecord | null> {
  const world = await prisma.world.findUnique({ where: { id } });
  return world ? serializeWorld(world) : null;
}

export async function getWorldBySlug(slug: string): Promise<WorldRecord | null> {
  const world = await prisma.world.findUnique({ where: { slug } });
  return world ? serializeWorld(world) : null;
}

export async function getWorldConfig(worldId?: string): Promise<WorldConfigDoc> {
  let raw: any = null;

  if (!worldId) {
    const defaultWorld = await prisma.world.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { sortOrder: "asc" },
    });
    raw = defaultWorld;
  } else {
    raw = await prisma.world.findUnique({ where: { id: worldId } });
  }

  const stored = raw ? (typeof raw.config === "string" ? JSON.parse(raw.config) : raw.config) : null;
  if (!stored || !stored.map) return { ...LOCAL_WORLD_CONFIG };
  const mergedMap = { ...LOCAL_WORLD_CONFIG.map, ...stored.map };
  // Normalize legacy .png extension — the actual asset is .webp
  if (mergedMap.backgroundAssetPath?.endsWith(".png")) {
    mergedMap.backgroundAssetPath = mergedMap.backgroundAssetPath.replace(/\.png$/, ".webp");
  }
  return { ...LOCAL_WORLD_CONFIG, ...stored, map: mergedMap, spawn: { ...LOCAL_WORLD_CONFIG.spawn, ...stored.spawn } };
}

export async function ensureDefaultWorld(): Promise<void> {
  const existing = await prisma.world.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return;

  const now = new Date().toISOString();
  const config: WorldConfigDoc = {
    ...LOCAL_WORLD_CONFIG,
    id: "etheria-1",
    createdAt: now,
    updatedAt: now,
  };

  await prisma.world.create({
    data: {
      id: "default",
      slug: "etheria-1",
      name: "Etheria I",
      description: "El mundo original de Etheria. Estrategia medieval asincrónica con temporadas, bárbaros y alianzas.",
      status: "ACTIVE",
      config: JSON.parse(JSON.stringify(config)),
      sortOrder: 0,
      playerCount: 0,
    },
  });

  console.log("[worldService] Created default world 'Etheria I'");
}
