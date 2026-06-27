export function sessionKey(token: string): string {
  return `velis:session:${token}`;
}

export function onlineKey(profileId: string): string {
  return `velis:online:${profileId}`;
}

export function onlinePlayersKey(): string {
  return "velis:online:players";
}

export function rankScoreKey(): string {
  return "velis:rank:score";
}

export function rankKillsKey(): string {
  return "velis:rank:kills";
}

export function rankExploredKey(): string {
  return "velis:rank:explored";
}

export function rankPlaytimeKey(): string {
  return "velis:rank:playtime";
}

export function statsRateLimitKey(profileId: string): string {
  return `velis:stats:rl:${profileId}`;
}

export function profileCacheKey(profileId: string): string {
  return `velis:profile:${profileId}`;
}
