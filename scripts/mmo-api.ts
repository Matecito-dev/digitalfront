import type http from "node:http";
import crypto from "node:crypto";
import type pg from "pg";
import type { Redis } from "../src/mmo/redis.js";
import { getPool } from "../src/mmo/db.js";
import { getRedis, getSessionTtlSeconds } from "../src/mmo/redis.js";
import {
  sessionKey,
} from "../src/mmo/redisKeys.js";
import {
  profileFromRow,
  profileToJson,
  rankingOrderColumn,
  rankingRedisKey,
  type PlayerProfile,
  type ProfileRow,
  type RankingSort,
  usernameErrorMessage,
  validateUsername,
} from "../src/mmo/profile.js";
import { syncRankingZsets } from "../src/mmo/ranking.js";
import { updateExploredPctMax } from "../src/mmo/stats.js";
import {
  createDevGuestSession,
  findDevProfileByGuestKey,
  getDevProfile,
  isDevAuthEnabled,
  profileMeJson,
  validateDevSessionToken,
} from "../src/mmo/devAuth.js";
import {
  createGuestProfile,
  exchangeGitHubCode,
  exchangeXCode,
  findProfileByGuestKey,
  generateGuestKey,
  isValidGuestKey,
} from "../src/mmo/oauth.js";
import { oauthPublicConfig, readOAuthSecrets } from "../src/mmo/oauthConfig.js";
import { BRAND } from "../src/shared/branding.js";
import { getShardId } from "../src/persist/worldPersistence.js";
import {
  fetchPlayerChronicle,
  fetchPublicChronicle,
} from "../src/persist/chronicleRecorder.js";
import { corsHeaders } from "../src/mmo/cors.js";
import { checkGuestAuthRateLimit, clientIp } from "../src/mmo/wsLimits.js";

export interface MmoApiContext {
  dbReady: boolean;
  redisReady: boolean;
}

function parseBearer(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(req: http.IncomingMessage, res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(data));
}

function mmoErrorMessage(code: string): string {
  switch (code) {
    case "mmo_services_unavailable":
      return "Servidor MMO no disponible. Ejecuta: npm run infra:up && npm run db:migrate";
    default:
      return code;
  }
}

async function handleDevGuestAuth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!checkGuestAuthRateLimit(clientIp(req))) {
    sendJson(req, res, 429, { error: "rate_limited", message: "Demasiados intentos. Espera un minuto." });
    return;
  }
  const body = await readBody(req);
  let username: string | undefined;
  let guestKey: string | undefined;
  try {
    const parsed = JSON.parse(body) as { username?: string; guestKey?: string };
    username = parsed.username;
    guestKey = parsed.guestKey;
  } catch {
    sendJson(req, res, 400, { error: "invalid_json" });
    return;
  }

  if (guestKey && isValidGuestKey(guestKey)) {
    const existing = findDevProfileByGuestKey(guestKey);
    if (existing) {
      const { token, profile } = createDevGuestSession(undefined, guestKey);
      sendJson(req, res, 200, { token, profile: profileToJson(profile) });
      return;
    }
  }

  const validation = validateUsername(username ?? "");
  if (validation) {
    sendJson(req, res, 400, { error: validation, message: usernameErrorMessage(validation) });
    return;
  }

  try {
    const { token, profile, guestKey: newKey } = createDevGuestSession(username);
    sendJson(req, res, 200, { token, profile: profileToJson(profile), guestKey: newKey });
  } catch (err: unknown) {
    const code = err instanceof Error ? err.message : "invalid_request";
    sendJson(req, res, 400, { error: code });
  }
}

async function handleDevProfileMe(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const token = parseBearer(req);
  if (!token) {
    sendJson(req, res, 401, { error: "missing_token" });
    return;
  }
  const session = validateDevSessionToken(token);
  if (!session) {
    sendJson(req, res, 401, { error: "invalid_token" });
    return;
  }
  const profile = getDevProfile(session.profileId);
  if (!profile) {
    sendJson(req, res, 401, { error: "invalid_token" });
    return;
  }
  sendJson(req, res, 200, profileMeJson(profile));
}

async function findProfileById(pool: pg.Pool, id: string): Promise<PlayerProfile | null> {
  const { rows } = await pool.query<ProfileRow>(
    "SELECT * FROM profiles WHERE id = $1",
    [id],
  );
  return rows[0] ? profileFromRow(rows[0]) : null;
}

async function syncProfileRanking(redis: Redis, profile: PlayerProfile): Promise<void> {
  await syncRankingZsets(redis, profile);
}

async function createSession(redis: Redis, profile: PlayerProfile): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const ttl = getSessionTtlSeconds();
  await redis.set(
    sessionKey(token),
    JSON.stringify({
      profileId: profile.id,
      captainName: profile.captainName,
      createdAt: new Date().toISOString(),
    }),
    "EX",
    ttl,
  );
  return token;
}

async function resolveSession(
  redis: Redis,
  pool: pg.Pool,
  token: string,
): Promise<PlayerProfile | null> {
  const raw = await redis.get(sessionKey(token));
  if (!raw) return null;
  let profileId: string;
  try {
    profileId = (JSON.parse(raw) as { profileId: string }).profileId;
  } catch {
    return null;
  }
  const profile = await findProfileById(pool, profileId);
  if (profile) {
    await pool.query("UPDATE profiles SET last_seen_at = now() WHERE id = $1", [profileId]);
  }
  return profile;
}

async function handleGuestAuth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!checkGuestAuthRateLimit(clientIp(req))) {
    sendJson(req, res, 429, { error: "rate_limited", message: "Demasiados intentos. Espera un minuto." });
    return;
  }
  const pool = getPool();
  const redis = getRedis();
  const body = await readBody(req);
  let username: string | undefined;
  let guestKey: string | undefined;
  try {
    const parsed = JSON.parse(body) as { username?: string; guestKey?: string };
    username = parsed.username;
    guestKey = parsed.guestKey;
  } catch {
    sendJson(req, res, 400, { error: "invalid_json" });
    return;
  }

  if (guestKey && isValidGuestKey(guestKey)) {
    const existing = await findProfileByGuestKey(pool, guestKey);
    if (existing) {
      const token = await createSession(redis, existing);
      await syncProfileRanking(redis, existing);
      sendJson(req, res, 200, { token, profile: profileToJson(existing) });
      return;
    }
  }

  const validation = validateUsername(username ?? "");
  if (validation) {
    sendJson(req, res, 400, { error: validation, message: usernameErrorMessage(validation) });
    return;
  }

  try {
    const newGuestKey = generateGuestKey();
    const profile = await createGuestProfile(pool, username!, newGuestKey);
    const token = await createSession(redis, profile);
    await syncProfileRanking(redis, profile);
    sendJson(req, res, 200, { token, profile: profileToJson(profile), guestKey: newGuestKey });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") {
      sendJson(req, res, 409, { error: "username_taken", message: "Ese nombre ya está en uso." });
      return;
    }
    const code = err instanceof Error ? err.message : "invalid_request";
    if (code === "empty" || code === "too_short" || code === "too_long" || code === "invalid_chars" || code === "blocked") {
      sendJson(req, res, 400, { error: code, message: usernameErrorMessage(code as Parameters<typeof usernameErrorMessage>[0]) });
      return;
    }
    throw err;
  }
}

async function handleAuthProviders(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const secrets = readOAuthSecrets();
  sendJson(req, res, 200, oauthPublicConfig(secrets));
}

async function handleOAuthGitHub(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!checkGuestAuthRateLimit(clientIp(req))) {
    sendJson(req, res, 429, { error: "rate_limited", message: "Demasiados intentos. Espera un minuto." });
    return;
  }
  const body = await readBody(req);
  let code: string;
  try {
    code = (JSON.parse(body) as { code?: string }).code ?? "";
  } catch {
    sendJson(req, res, 400, { error: "invalid_json" });
    return;
  }
  if (!code) {
    sendJson(req, res, 400, { error: "missing_code" });
    return;
  }

  const pool = getPool();
  const redis = getRedis();
  const secrets = readOAuthSecrets();
  try {
    const result = await exchangeGitHubCode(pool, secrets, code, p => createSession(redis, p));
    const profile = await findProfileById(pool, result.profile.id);
    if (profile) await syncProfileRanking(redis, profile);
    sendJson(req, res, 200, result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "oauth_failed";
    if (msg === "github_not_configured") {
      sendJson(req, res, 503, { error: msg, message: "GitHub OAuth no configurado en el servidor." });
      return;
    }
    console.error("[oauth/github]", err);
    sendJson(req, res, 400, { error: "oauth_failed", message: "No se pudo completar el inicio con GitHub." });
  }
}

async function handleOAuthX(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!checkGuestAuthRateLimit(clientIp(req))) {
    sendJson(req, res, 429, { error: "rate_limited", message: "Demasiados intentos. Espera un minuto." });
    return;
  }
  const body = await readBody(req);
  let code: string;
  let codeVerifier: string;
  try {
    const parsed = JSON.parse(body) as { code?: string; codeVerifier?: string };
    code = parsed.code ?? "";
    codeVerifier = parsed.codeVerifier ?? "";
  } catch {
    sendJson(req, res, 400, { error: "invalid_json" });
    return;
  }
  if (!code) {
    sendJson(req, res, 400, { error: "missing_code" });
    return;
  }

  const pool = getPool();
  const redis = getRedis();
  const secrets = readOAuthSecrets();
  try {
    const result = await exchangeXCode(pool, secrets, code, codeVerifier, p => createSession(redis, p));
    const profile = await findProfileById(pool, result.profile.id);
    if (profile) await syncProfileRanking(redis, profile);
    sendJson(req, res, 200, result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "oauth_failed";
    if (msg === "x_not_configured") {
      sendJson(req, res, 503, { error: msg, message: "X OAuth no configurado en el servidor." });
      return;
    }
    if (msg === "missing_code_verifier") {
      sendJson(req, res, 400, { error: msg, message: "Falta code_verifier (PKCE)." });
      return;
    }
    console.error("[oauth/x]", err);
    sendJson(req, res, 400, { error: "oauth_failed", message: "No se pudo completar el inicio con X." });
  }
}

async function handleProfileMe(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const token = parseBearer(req);
  if (!token) {
    sendJson(req, res, 401, { error: "missing_token" });
    return;
  }
  const profile = await resolveSession(getRedis(), getPool(), token);
  if (!profile) {
    sendJson(req, res, 401, { error: "invalid_token" });
    return;
  }
  sendJson(req, res, 200, profileToJson(profile));
}

async function handleRanking(req: http.IncomingMessage, url: URL, res: http.ServerResponse): Promise<void> {
  const sort = (url.searchParams.get("sort") ?? "score") as RankingSort;
  const validSorts: RankingSort[] = ["score", "kills", "explored", "playtime"];
  const sortKey = validSorts.includes(sort) ? sort : "score";
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "50")));
  const selfProfileId = url.searchParams.get("profileId") ?? undefined;

  const pool = getPool();
  const redis = getRedis();
  const zkey = rankingRedisKey(sortKey);

  let profileIds: string[] = [];
  try {
    const zmembers = await redis.zrevrange(zkey, 0, limit - 1);
    if (zmembers.length > 0) profileIds = zmembers;
  } catch { /* fallback to PG */ }

  let rows: ProfileRow[];
  if (profileIds.length > 0) {
    const { rows: dbRows } = await pool.query<ProfileRow>(
      `SELECT * FROM profiles WHERE id = ANY($1::uuid[])`,
      [profileIds],
    );
    const byId = new Map(dbRows.map(r => [r.id, r]));
    rows = profileIds.map(id => byId.get(id)).filter(Boolean) as ProfileRow[];
  } else {
    const col = rankingOrderColumn(sortKey);
    const { rows: dbRows } = await pool.query<ProfileRow>(
      `SELECT * FROM profiles ORDER BY ${col} DESC, last_seen_at DESC LIMIT $1`,
      [limit],
    );
    rows = dbRows;
  }

  const entries = rows.map((row, i) => {
    const p = profileFromRow(row);
    return {
      rank: i + 1,
      profileId: p.id,
      username: p.username,
      captainName: p.captainName,
      stats: p.stats,
      lastSeenAt: p.lastSeenAt.toISOString(),
    };
  });

  let self: {
    rank: number;
    profileId: string;
    username: string;
    captainName: string;
    stats: PlayerProfile["stats"];
    lastSeenAt: string;
  } | null = null;

  if (selfProfileId) {
    try {
      const rankIdx = await redis.zrevrank(zkey, selfProfileId);
      if (rankIdx != null) {
        const { rows: selfRows } = await pool.query<ProfileRow>(
          "SELECT * FROM profiles WHERE id = $1",
          [selfProfileId],
        );
        if (selfRows[0]) {
          const p = profileFromRow(selfRows[0]);
          self = {
            rank: rankIdx + 1,
            profileId: p.id,
            username: p.username,
            captainName: p.captainName,
            stats: p.stats,
            lastSeenAt: p.lastSeenAt.toISOString(),
          };
        }
      } else {
        const { rows: selfRows } = await pool.query<ProfileRow>(
          "SELECT * FROM profiles WHERE id = $1",
          [selfProfileId],
        );
        if (selfRows[0]) {
          const p = profileFromRow(selfRows[0]);
          self = {
            rank: 0,
            profileId: p.id,
            username: p.username,
            captainName: p.captainName,
            stats: p.stats,
            lastSeenAt: p.lastSeenAt.toISOString(),
          };
        }
      }
    } catch { /* non-fatal */ }
  }

  sendJson(req, res, 200, { sort: sortKey, entries, self });
}

async function handleStatsSync(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const token = parseBearer(req);
  if (!token) {
    sendJson(req, res, 401, { error: "missing_token" });
    return;
  }

  const pool = getPool();
  const redis = getRedis();
  const profile = await resolveSession(redis, pool, token);
  if (!profile) {
    sendJson(req, res, 401, { error: "invalid_token" });
    return;
  }

  const body = await readBody(req);
  let exploredPct: number;
  try {
    exploredPct = Number((JSON.parse(body) as { exploredPct?: number }).exploredPct);
  } catch {
    sendJson(req, res, 400, { error: "invalid_json" });
    return;
  }
  if (!Number.isFinite(exploredPct) || exploredPct < 0 || exploredPct > 100) {
    sendJson(req, res, 400, { error: "invalid_explored_pct" });
    return;
  }

  const result = await updateExploredPctMax(profile.id, exploredPct);
  if (!result.ok) {
    sendJson(req, res, 429, { error: "rate_limited", message: "Espera antes de sincronizar de nuevo." });
    return;
  }

  sendJson(req, res, 200, { profile: profileToJson(result.profile) });
}

async function resolveWorldId(pool: pg.Pool, seedParam?: string | null): Promise<string | null> {
  const seed = seedParam?.trim() || BRAND.defaultWorldSeed;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM worlds WHERE seed = $1 AND shard_id = $2`,
    [seed, getShardId()],
  );
  return rows[0]?.id ?? null;
}

async function handleWorldChronicle(req: http.IncomingMessage, url: URL, res: http.ServerResponse): Promise<void> {
  const pool = getPool();
  const worldId = await resolveWorldId(pool, url.searchParams.get("seed"));
  if (!worldId) {
    sendJson(req, res, 200, { entries: [] });
    return;
  }
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "50")));
  const after = url.searchParams.get("after") ?? undefined;
  const entries = await fetchPublicChronicle(pool, worldId, limit, after);
  sendJson(req, res, 200, { entries });
}

async function handleProfileChronicle(req: http.IncomingMessage, url: URL, res: http.ServerResponse): Promise<void> {
  const token = parseBearer(req);
  if (!token) {
    sendJson(req, res, 401, { error: "missing_token" });
    return;
  }

  const pool = getPool();
  const redis = getRedis();
  const profile = await resolveSession(redis, pool, token);
  if (!profile) {
    sendJson(req, res, 401, { error: "invalid_token" });
    return;
  }

  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "50")));
  const after = url.searchParams.get("after") ?? undefined;
  const entries = await fetchPlayerChronicle(pool, profile.id, limit, after);
  sendJson(req, res, 200, { entries });
}

export async function handleMmoApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ctx: MmoApiContext,
): Promise<boolean> {
  const path = url.pathname;

  if (req.method === "OPTIONS" && path.startsWith("/api/")) {
    res.writeHead(204, {
      ...corsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });
    res.end();
    return true;
  }

  const isMmoRoute =
    path === "/api/auth/guest"
    || path === "/api/auth/providers"
    || path === "/api/auth/oauth/github"
    || path === "/api/auth/oauth/x"
    || path === "/api/profile/me"
    || path === "/api/ranking"
    || path === "/api/profile/stats"
    || path === "/api/world/chronicle"
    || path === "/api/profile/chronicle";

  if (!isMmoRoute) return false;

  if (path === "/api/auth/providers" && req.method === "GET") {
    await handleAuthProviders(req, res);
    return true;
  }

  if (!ctx.dbReady || !ctx.redisReady) {
    if (isDevAuthEnabled()) {
      if (path === "/api/auth/guest" && req.method === "POST") {
        await handleDevGuestAuth(req, res);
        return true;
      }
      if (path === "/api/profile/me" && req.method === "GET") {
        await handleDevProfileMe(req, res);
        return true;
      }
      if (path === "/api/ranking" && req.method === "GET") {
        sendJson(req, res, 200, { entries: [], self: null });
        return true;
      }
      if (path === "/api/profile/stats" && req.method === "POST") {
        sendJson(req, res, 200, { ok: true });
        return true;
      }
      if (path === "/api/world/chronicle" && req.method === "GET") {
        sendJson(req, res, 200, { entries: [] });
        return true;
      }
      if (path === "/api/profile/chronicle" && req.method === "GET") {
        sendJson(req, res, 200, { entries: [] });
        return true;
      }
    }
    sendJson(req, res, 503, {
      error: "mmo_services_unavailable",
      message: mmoErrorMessage("mmo_services_unavailable"),
    });
    return true;
  }

  try {
    if (path === "/api/auth/guest" && req.method === "POST") {
      await handleGuestAuth(req, res);
      return true;
    }
    if (path === "/api/auth/oauth/github" && req.method === "POST") {
      await handleOAuthGitHub(req, res);
      return true;
    }
    if (path === "/api/auth/oauth/x" && req.method === "POST") {
      await handleOAuthX(req, res);
      return true;
    }
    if (path === "/api/profile/me" && req.method === "GET") {
      await handleProfileMe(req, res);
      return true;
    }
    if (path === "/api/ranking" && req.method === "GET") {
      await handleRanking(req, url, res);
      return true;
    }
    if (path === "/api/profile/stats" && req.method === "POST") {
      await handleStatsSync(req, res);
      return true;
    }
    if (path === "/api/world/chronicle" && req.method === "GET") {
      await handleWorldChronicle(req, url, res);
      return true;
    }
    if (path === "/api/profile/chronicle" && req.method === "GET") {
      await handleProfileChronicle(req, url, res);
      return true;
    }

    sendJson(req, res, 405, { error: "method_not_allowed" });
    return true;
  } catch (err) {
    console.error("[mmo-api]", err);
    sendJson(req, res, 500, { error: "internal_error" });
    return true;
  }
}
