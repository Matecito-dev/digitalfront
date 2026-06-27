import { getRedis } from "./redis.js";
import { onlineKey, onlinePlayersKey, sessionKey } from "./redisKeys.js";
import { isDevAuthEnabled, validateDevSessionToken } from "./devAuth.js";

export interface SessionPayload {
  profileId: string;
  captainName: string;
  createdAt?: string;
}

export async function validateSessionToken(token: string): Promise<SessionPayload | null> {
  if (isDevAuthEnabled()) {
    return validateDevSessionToken(token);
  }
  const raw = await getRedis().get(sessionKey(token));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SessionPayload;
    if (!data.profileId || !data.captainName) return null;
    return data;
  } catch {
    return null;
  }
}

export async function refreshOnlinePresence(profileId: string): Promise<void> {
  if (isDevAuthEnabled()) return;
  const redis = getRedis();
  await redis
    .multi()
    .set(onlineKey(profileId), "1", "EX", 60)
    .sadd(onlinePlayersKey(), profileId)
    .exec();
}

export async function clearOnlinePresence(profileId: string): Promise<void> {
  if (isDevAuthEnabled()) return;
  const redis = getRedis();
  await redis
    .multi()
    .del(onlineKey(profileId))
    .srem(onlinePlayersKey(), profileId)
    .exec();
}
