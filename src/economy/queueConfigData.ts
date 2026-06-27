export type CityQueueKind = "construction" | "training" | "research";

export type CityQueueConfig = {
  maxSlots: Record<CityQueueKind, number>;
  activeSlots: Record<CityQueueKind, number>;
};

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function getCityQueueConfig(): CityQueueConfig {
  const maxSlots = {
    construction: readPositiveInt("CITY_QUEUE_CONSTRUCTION_MAX_SLOTS", 3),
    training: readPositiveInt("CITY_QUEUE_TRAINING_MAX_SLOTS", 3),
    research: readPositiveInt("CITY_QUEUE_RESEARCH_MAX_SLOTS", 3),
  };
  return {
    maxSlots,
    activeSlots: {
      construction: Math.min(maxSlots.construction, readPositiveInt("CITY_QUEUE_CONSTRUCTION_ACTIVE_SLOTS", 1)),
      training: Math.min(maxSlots.training, readPositiveInt("CITY_QUEUE_TRAINING_ACTIVE_SLOTS", 1)),
      research: Math.min(maxSlots.research, readPositiveInt("CITY_QUEUE_RESEARCH_ACTIVE_SLOTS", 1)),
    },
  };
}

