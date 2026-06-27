import type pg from "pg";
import type { Redis } from "./redis.js";
import {
  rankExploredKey,
  rankKillsKey,
  rankPlaytimeKey,
  rankScoreKey,
} from "./redisKeys.js";
import {
  profileFromRow,
  type PlayerProfile,
  type PlayerProfileStats,
  type ProfileRow,
} from "./profile.js";

export function computeCompositeScore(stats: Omit<PlayerProfileStats, "compositeScore">): number {
  return (
    stats.barbariansKilled * 100
    + Math.floor(stats.exploredPctMax * 10)
    + Math.floor(Number(stats.playTimeMs) / 60000) * 2
    + stats.missionsCompleted * 500
  );
}

export async function syncRankingZsets(redis: Redis, profile: PlayerProfile): Promise<void> {
  const id = profile.id;
  const s = profile.stats;
  await redis
    .multi()
    .zadd(rankScoreKey(), s.compositeScore, id)
    .zadd(rankKillsKey(), s.barbariansKilled, id)
    .zadd(rankExploredKey(), s.exploredPctMax, id)
    .zadd(rankPlaytimeKey(), s.playTimeMs, id)
    .exec();
}

export function compositeScoreSql(): string {
  return `(
    barbarians_killed * 100
    + floor(explored_pct_max * 10)
    + floor(play_time_ms / 60000) * 2
    + missions_completed * 500
  )`;
}

/** Rebuild all ranking ZSETs from PostgreSQL (consistency job stub). */
export async function rebuildRankingFromPg(pool: pg.Pool, redis: Redis): Promise<number> {
  const { rows } = await pool.query<ProfileRow>("SELECT * FROM profiles");
  if (rows.length === 0) return 0;

  const multi = redis.multi();
  multi.del(rankScoreKey(), rankKillsKey(), rankExploredKey(), rankPlaytimeKey());
  for (const row of rows) {
    const p = profileFromRow(row);
    multi.zadd(rankScoreKey(), p.stats.compositeScore, p.id);
    multi.zadd(rankKillsKey(), p.stats.barbariansKilled, p.id);
    multi.zadd(rankExploredKey(), p.stats.exploredPctMax, p.id);
    multi.zadd(rankPlaytimeKey(), p.stats.playTimeMs, p.id);
  }
  await multi.exec();
  return rows.length;
}
