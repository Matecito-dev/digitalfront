import crypto from "node:crypto";
import type pg from "pg";
import {
  normalizeUsername,
  profileFromRow,
  profileToJson,
  sanitizeCaptainName,
  type PlayerProfile,
  type ProfileRow,
  validateUsername,
} from "./profile.js";
import type { OAuthSecrets } from "./oauthConfig.js";

export interface OAuthExchangeResult {
  token: string;
  profile: ReturnType<typeof profileToJson>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`oauth_http_${res.status}:${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function oauthUsername(provider: "github" | "x", login: string, subject: string): string {
  const base = normalizeUsername(login.replace(/[^_\p{L}\p{N}-]/gu, "")).slice(0, 14);
  const suffix = subject.slice(-4);
  const candidate = base.length >= 3 ? base : `${provider}${suffix}`;
  return candidate.slice(0, 20);
}

async function findByOAuth(
  pool: pg.Pool,
  provider: string,
  subject: string,
): Promise<PlayerProfile | null> {
  const { rows } = await pool.query<ProfileRow>(
    "SELECT * FROM profiles WHERE auth_provider = $1 AND oauth_subject = $2",
    [provider, subject],
  );
  return rows[0] ? profileFromRow(rows[0]) : null;
}

async function upsertOAuthProfile(
  pool: pg.Pool,
  provider: "github" | "x",
  subject: string,
  login: string,
  captainName: string,
  avatarUrl: string | null,
): Promise<PlayerProfile> {
  const existing = await findByOAuth(pool, provider, subject);
  if (existing) {
    await pool.query(
      `UPDATE profiles SET last_seen_at = now(), captain_name = $2, avatar_url = COALESCE($3, avatar_url) WHERE id = $1`,
      [existing.id, sanitizeCaptainName(captainName || existing.captainName), avatarUrl],
    );
    const refreshed = await pool.query<ProfileRow>("SELECT * FROM profiles WHERE id = $1", [existing.id]);
    return profileFromRow(refreshed.rows[0]!);
  }

  const username = oauthUsername(provider, login, subject);
  const captain = sanitizeCaptainName(captainName || username);
  let uname = username;
  for (let i = 0; i < 5; i++) {
    const lower = uname.toLocaleLowerCase("es");
    try {
      const { rows } = await pool.query<ProfileRow>(
        `INSERT INTO profiles (username, username_lower, captain_name, auth_provider, oauth_subject, avatar_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [uname, lower, captain, provider, subject, avatarUrl],
      );
      return profileFromRow(rows[0]!);
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "23505") {
        uname = `${username.slice(0, 12)}_${subject.slice(-4)}${i}`.slice(0, 20);
        continue;
      }
      throw err;
    }
  }
  throw new Error("oauth_username_conflict");
}

export async function exchangeGitHubCode(
  pool: pg.Pool,
  secrets: OAuthSecrets,
  code: string,
  createSession: (profile: PlayerProfile) => Promise<string>,
): Promise<OAuthExchangeResult> {
  const cfg = secrets.github;
  if (!cfg) throw new Error("github_not_configured");

  const tokenRes = await fetchJson<{ access_token?: string; error?: string }>(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: cfg.redirectUri,
      }),
    },
  );
  if (!tokenRes.access_token) throw new Error(tokenRes.error ?? "github_token_failed");

  const user = await fetchJson<{ id: number; login: string; name?: string; avatar_url?: string }>(
    "https://api.github.com/user",
    { headers: { Authorization: `Bearer ${tokenRes.access_token}`, Accept: "application/json" } },
  );

  const profile = await upsertOAuthProfile(
    pool,
    "github",
    String(user.id),
    user.login,
    user.name ?? user.login,
    user.avatar_url ?? null,
  );
  const token = await createSession(profile);
  return { token, profile: profileToJson(profile) };
}

export async function exchangeXCode(
  pool: pg.Pool,
  secrets: OAuthSecrets,
  code: string,
  codeVerifier: string,
  createSession: (profile: PlayerProfile) => Promise<string>,
): Promise<OAuthExchangeResult> {
  const cfg = secrets.x;
  if (!cfg) throw new Error("x_not_configured");
  if (!codeVerifier) throw new Error("missing_code_verifier");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    code_verifier: codeVerifier,
  });

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const tokenRes = await fetchJson<{ access_token?: string; error?: string }>(
    "https://api.twitter.com/2/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body,
    },
  );
  if (!tokenRes.access_token) throw new Error(tokenRes.error ?? "x_token_failed");

  const me = await fetchJson<{ data?: { id: string; username: string; name?: string; profile_image_url?: string } }>(
    "https://api.twitter.com/2/users/me?user.fields=profile_image_url",
    { headers: { Authorization: `Bearer ${tokenRes.access_token}` } },
  );
  const u = me.data;
  if (!u?.id) throw new Error("x_user_failed");

  const profile = await upsertOAuthProfile(
    pool,
    "x",
    u.id,
    u.username,
    u.name ?? u.username,
    u.profile_image_url ?? null,
  );
  const token = await createSession(profile);
  return { token, profile: profileToJson(profile) };
}

export function generateGuestKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function isValidGuestKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-f0-9]{32,64}$/i.test(key);
}

export async function findProfileByGuestKey(pool: pg.Pool, guestKey: string): Promise<PlayerProfile | null> {
  const { rows } = await pool.query<ProfileRow>(
    "SELECT * FROM profiles WHERE guest_key = $1",
    [guestKey],
  );
  return rows[0] ? profileFromRow(rows[0]) : null;
}

export async function createGuestProfile(
  pool: pg.Pool,
  rawUsername: string,
  guestKey: string | null,
): Promise<PlayerProfile> {
  const err = validateUsername(rawUsername);
  if (err) throw new Error(err);

  const username = normalizeUsername(rawUsername);
  const lower = username.toLocaleLowerCase("es");
  const captainName = sanitizeCaptainName(username);

  const { rows } = await pool.query<ProfileRow>(
    `INSERT INTO profiles (username, username_lower, captain_name, auth_provider, guest_key)
     VALUES ($1, $2, $3, 'guest', $4)
     RETURNING *`,
    [username, lower, captainName, guestKey],
  );
  return profileFromRow(rows[0]!);
}

export async function attachGuestKeyToProfile(
  pool: pg.Pool,
  profileId: string,
  guestKey: string,
): Promise<void> {
  await pool.query(
    "UPDATE profiles SET guest_key = $2 WHERE id = $1 AND guest_key IS NULL",
    [profileId, guestKey],
  );
}
