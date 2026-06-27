import { z } from "zod";

// ─── Season ───

export const SeasonSchema = z.enum(["SPRING", "SUMMER", "AUTUMN", "WINTER"]);
export type Season = z.infer<typeof SeasonSchema>;

// ─── World Zone ───

export const WorldZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  terrainTags: z.array(z.string()),
  seasonIntensity: z.record(SeasonSchema, z.number()),
  resourceModifiers: z.record(z.string(), z.number()).optional(),
  travelModifiers: z.record(SeasonSchema, z.number()).optional(),
  barbarianSpawnModifier: z.number().optional(),
});

export type WorldZone = z.infer<typeof WorldZoneSchema>;

// ─── World Regions ───

export const WorldRegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  centroidX: z.number(),
  centroidY: z.number(),
});

export type WorldRegion = z.infer<typeof WorldRegionSchema>;

// ─── World POIs ───

export const WorldPOITypeSchema = z.enum(["RUINS", "PEAK", "RESOURCE", "HARBOR", "LAKE", "RANGE", "CAPE", "BAY"]);
export type WorldPOIType = z.infer<typeof WorldPOITypeSchema>;

export const WorldPOISchema = z.object({
  id: z.string(),
  type: WorldPOITypeSchema,
  name: z.string(),
  x: z.number(),
  y: z.number(),
});

export type WorldPOI = z.infer<typeof WorldPOISchema>;
