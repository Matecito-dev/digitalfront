import type http from "node:http";

export interface AuthenticatedClientLike {
  authenticated: boolean;
  profileId: string | null;
}

const GUEST_AUTH_LIMIT = 10;
const GUEST_AUTH_WINDOW_MS = 60_000;
const guestAuthBuckets = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** Returns false when IP exceeded 10 guest auth attempts per minute. */
export function checkGuestAuthRateLimit(ip: string, nowMs = Date.now()): boolean {
  let bucket = guestAuthBuckets.get(ip);
  if (!bucket || nowMs >= bucket.resetAt) {
    bucket = { count: 0, resetAt: nowMs + GUEST_AUTH_WINDOW_MS };
    guestAuthBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= GUEST_AUTH_LIMIT;
}

export function getMaxPlayers(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DF_MAX_PLAYERS ?? env.VELIS_MAX_PLAYERS;
  const n = raw ? Number.parseInt(raw, 10) : 500;
  if (!Number.isFinite(n) || n < 1) return 500;
  return n;
}

/** Unique authenticated profileIds (one tab reconnect replaces same profile). */
export function countAuthenticatedPlayers(clients: Iterable<AuthenticatedClientLike>): number {
  const ids = new Set<string>();
  for (const c of clients) {
    if (c.authenticated && c.profileId) ids.add(c.profileId);
  }
  return ids.size;
}

export function canAcceptPlayerAuth(
  clients: Iterable<AuthenticatedClientLike>,
  profileId: string,
  maxPlayers: number,
): boolean {
  const ids = new Set<string>();
  for (const c of clients) {
    if (c.authenticated && c.profileId) ids.add(c.profileId);
  }
  if (ids.has(profileId)) return true;
  return ids.size < maxPlayers;
}

export function parseWsAuthToken(msg: unknown): string | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { type?: unknown; token?: unknown };
  if (m.type !== "auth" || typeof m.token !== "string") return null;
  const token = m.token.trim();
  return token.length > 0 ? token : null;
}
