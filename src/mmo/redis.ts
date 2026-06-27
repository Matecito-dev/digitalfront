import { Redis } from "ioredis";

let redis: Redis | null = null;

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

export function getSessionTtlSeconds(): number {
  const days = Number(process.env.DF_SESSION_TTL_DAYS ?? process.env.VELIS_SESSION_TTL_DAYS ?? "30");
  return Math.max(1, Math.floor(days * 86400));
}

export async function initRedis(): Promise<Redis> {
  if (redis) return redis;
  redis = new Redis(getRedisUrl(), { maxRetriesPerRequest: 3, lazyConnect: true });
  await redis.connect();
  await redis.ping();
  return redis;
}

export function getRedis(): Redis {
  if (!redis) throw new Error("Redis not initialized — call initRedis() first");
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

export type { Redis };
