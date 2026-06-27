import { computeCompositeScore } from "./ranking.js";

export { computeCompositeScore } from "./ranking.js";

export interface PlayerProfileStats {
  barbariansKilled: number;
  exploredPctMax: number;
  playTimeMs: number;
  missionsCompleted: number;
  compositeScore: number;
}

export interface PlayerProfile {
  id: string;
  username: string;
  captainName: string;
  createdAt: Date;
  lastSeenAt: Date;
  stats: PlayerProfileStats;
}

export interface ProfileRow {
  id: string;
  username: string;
  username_lower: string;
  captain_name: string;
  barbarians_killed: number;
  explored_pct_max: number;
  play_time_ms: string | number;
  missions_completed: number;
  composite_score: number;
  created_at: Date;
  last_seen_at: Date;
}

export type UsernameValidationError =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "blocked";

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;

/** Letras (incl. acentos), números, guion y underscore. */
const USERNAME_REGEX = /^[\p{L}\p{N}_-]+$/u;

const BLOCKLIST = [
  "admin",
  "moderator",
  "mod",
  "staff",
  "support",
  "hitler",
  "nazi",
  "nigger",
  "negro",
  "faggot",
  "maricon",
  "puta",
  "mierda",
];

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function usernameLower(username: string): string {
  return username.toLocaleLowerCase("es");
}

export function sanitizeCaptainName(username: string): string {
  return normalizeUsername(username).slice(0, USERNAME_MAX);
}

export function validateUsername(raw: string): UsernameValidationError | null {
  const username = normalizeUsername(raw);
  if (!username) return "empty";
  if (username.length < USERNAME_MIN) return "too_short";
  if (username.length > USERNAME_MAX) return "too_long";
  if (!USERNAME_REGEX.test(username)) return "invalid_chars";
  const lower = usernameLower(username);
  if (BLOCKLIST.some(w => lower === w)) return "blocked";
  return null;
}

export function usernameErrorMessage(code: UsernameValidationError): string {
  switch (code) {
    case "empty":
      return "El nombre del capitán es obligatorio.";
    case "too_short":
      return `Mínimo ${USERNAME_MIN} caracteres.`;
    case "too_long":
      return `Máximo ${USERNAME_MAX} caracteres.`;
    case "invalid_chars":
      return "Solo letras, números, guion (-) y guion bajo (_).";
    case "blocked":
      return "Ese nombre no está permitido.";
  }
}

export function profileFromRow(row: ProfileRow): PlayerProfile {
  const statsBase = {
    barbariansKilled: row.barbarians_killed,
    exploredPctMax: row.explored_pct_max,
    playTimeMs: Number(row.play_time_ms),
    missionsCompleted: row.missions_completed,
  };
  return {
    id: row.id,
    username: row.username,
    captainName: row.captain_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    stats: {
      ...statsBase,
      compositeScore: row.composite_score || computeCompositeScore(statsBase),
    },
  };
}

export function profileToJson(profile: PlayerProfile) {
  return {
    id: profile.id,
    username: profile.username,
    captainName: profile.captainName,
    createdAt: profile.createdAt.toISOString(),
    lastSeenAt: profile.lastSeenAt.toISOString(),
    stats: profile.stats,
  };
}

export type RankingSort = "score" | "kills" | "explored" | "playtime";

export function rankingOrderColumn(sort: RankingSort): string {
  switch (sort) {
    case "kills":
      return "barbarians_killed";
    case "explored":
      return "explored_pct_max";
    case "playtime":
      return "play_time_ms";
    case "score":
    default:
      return "composite_score";
  }
}

export function rankingRedisKey(sort: RankingSort): string {
  switch (sort) {
    case "kills":
      return "velis:rank:kills";
    case "explored":
      return "velis:rank:explored";
    case "playtime":
      return "velis:rank:playtime";
    case "score":
    default:
      return "velis:rank:score";
  }
}
