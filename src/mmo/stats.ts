import { getPool } from "./db.js";
import { getRedis } from "./redis.js";
import { profileCacheKey, statsRateLimitKey } from "./redisKeys.js";
import { profileFromRow, type PlayerProfile, type ProfileRow } from "./profile.js";
import { compositeScoreSql, syncRankingZsets } from "./ranking.js";

async function persistProfileRow(row: ProfileRow): Promise<PlayerProfile> {
  const profile = profileFromRow(row);
  const redis = getRedis();
  await syncRankingZsets(redis, profile);
  await redis.del(profileCacheKey(profile.id));
  return profile;
}

export async function incrementBarbariansKilled(profileId: string, count = 1): Promise<PlayerProfile | null> {
  const { rows } = await getPool().query<ProfileRow>(
    `UPDATE profiles
     SET barbarians_killed = barbarians_killed + $2,
         composite_score = ${compositeScoreSql()},
         last_seen_at = now()
     WHERE id = $1
     RETURNING *`,
    [profileId, count],
  );
  return rows[0] ? persistProfileRow(rows[0]) : null;
}

export async function flushPlayTimeMs(profileId: string, deltaMs: number): Promise<PlayerProfile | null> {
  if (deltaMs <= 0) return null;
  const { rows } = await getPool().query<ProfileRow>(
    `UPDATE profiles
     SET play_time_ms = play_time_ms + $2,
         composite_score = ${compositeScoreSql()},
         last_seen_at = now()
     WHERE id = $1
     RETURNING *`,
    [profileId, Math.floor(deltaMs)],
  );
  return rows[0] ? persistProfileRow(rows[0]) : null;
}

export async function updateExploredPctMax(
  profileId: string,
  exploredPct: number,
): Promise<{ ok: true; profile: PlayerProfile } | { ok: false; rateLimited: true }> {
  const redis = getRedis();
  const rlKey = statsRateLimitKey(profileId);
  const hits = await redis.incr(rlKey);
  if (hits === 1) await redis.expire(rlKey, 60);
  if (hits > 1) return { ok: false, rateLimited: true };

  const { rows } = await getPool().query<ProfileRow>(
    `UPDATE profiles
     SET explored_pct_max = GREATEST(explored_pct_max, $2),
         composite_score = ${compositeScoreSql()},
         last_seen_at = now()
     WHERE id = $1
     RETURNING *`,
    [profileId, exploredPct],
  );
  if (!rows[0]) return { ok: false, rateLimited: true };
  const profile = await persistProfileRow(rows[0]);
  return { ok: true, profile };
}

export async function incrementPvpKill(profileId: string): Promise<PlayerProfile | null> {
  const { rows } = await getPool().query<ProfileRow>(
    `UPDATE profiles
     SET pvp_kills = pvp_kills + 1,
         pvp_elo = pvp_elo + 25,
         last_seen_at = now()
     WHERE id = $1
     RETURNING *`,
    [profileId],
  );
  return rows[0] ? persistProfileRow(rows[0]) : null;
}

export async function incrementPvpDeath(profileId: string): Promise<PlayerProfile | null> {
  const { rows } = await getPool().query<ProfileRow>(
    `UPDATE profiles
     SET pvp_deaths = pvp_deaths + 1,
         pvp_elo = GREATEST(0, pvp_elo - 15),
         last_seen_at = now()
     WHERE id = $1
     RETURNING *`,
    [profileId],
  );
  return rows[0] ? persistProfileRow(rows[0]) : null;
}

export interface MissionCompletePayload {
  exploredPct?: number;
  neutralizedGroupId?: string;
  interceptDone?: boolean;
}

export function validateMissionComplete(
  profile: { barbarians_killed: number; explored_pct_max: number },
  payload: MissionCompletePayload,
): { ok: true } | { ok: false; reason: string } {
  if (profile.explored_pct_max < 15) {
    return { ok: false, reason: "requires_explore" };
  }
  if (profile.barbarians_killed < 1) {
    return { ok: false, reason: "requires_kill" };
  }
  if (!payload.interceptDone) {
    return { ok: false, reason: "requires_intercept" };
  }
  if (!payload.neutralizedGroupId || typeof payload.neutralizedGroupId !== "string") {
    return { ok: false, reason: "requires_neutralize" };
  }
  return { ok: true };
}

export async function completeMission(
  profileId: string,
  payload: MissionCompletePayload = {},
): Promise<{ ok: true; profile: PlayerProfile } | { ok: false; reason: string }> {
  const pool = getPool();
  const { rows: check } = await pool.query<{ barbarians_killed: number; explored_pct_max: number }>(
    "SELECT barbarians_killed, explored_pct_max FROM profiles WHERE id = $1",
    [profileId],
  );
  if (!check[0]) return { ok: false, reason: "profile_not_found" };
  const validation = validateMissionComplete(check[0], payload);
  if (!validation.ok) return validation;

  const { rows } = await pool.query<ProfileRow>(
    `UPDATE profiles
     SET missions_completed = missions_completed + 1,
         composite_score = ${compositeScoreSql()},
         last_seen_at = now()
     WHERE id = $1
     RETURNING *`,
    [profileId],
  );
  if (!rows[0]) return { ok: false, reason: "profile_not_found" };
  const profile = await persistProfileRow(rows[0]);
  return { ok: true, profile };
}
