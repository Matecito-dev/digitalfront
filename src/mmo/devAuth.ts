import crypto from "node:crypto";
import {
  normalizeUsername,
  profileToJson,
  sanitizeCaptainName,
  usernameLower,
  validateUsername,
  type PlayerProfile,
} from "./profile.js";
import type { SessionPayload } from "./session.js";

/** In-memory guest auth when Postgres/Redis are unavailable (local dev). */
let devAuthEnabled = false;

const sessions = new Map<string, SessionPayload>();
const profilesById = new Map<string, PlayerProfile>();
const profilesByUsernameLower = new Map<string, PlayerProfile>();

export function setDevAuthEnabled(enabled: boolean): void {
  devAuthEnabled = enabled;
}

export function isDevAuthEnabled(): boolean {
  return devAuthEnabled;
}

export function createDevGuestSession(rawUsername: string): { token: string; profile: PlayerProfile } {
  const err = validateUsername(rawUsername);
  if (err) throw new Error(err);

  const username = normalizeUsername(rawUsername);
  const lower = usernameLower(username);
  let profile = profilesByUsernameLower.get(lower);
  if (!profile) {
    const id = crypto.randomUUID();
    const now = new Date();
    profile = {
      id,
      username,
      captainName: sanitizeCaptainName(username),
      createdAt: now,
      lastSeenAt: now,
      stats: {
        barbariansKilled: 0,
        exploredPctMax: 0,
        playTimeMs: 0,
        missionsCompleted: 0,
        compositeScore: 0,
      },
    };
    profilesById.set(id, profile);
    profilesByUsernameLower.set(lower, profile);
  } else {
    profile.lastSeenAt = new Date();
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    profileId: profile.id,
    captainName: profile.captainName,
    createdAt: new Date().toISOString(),
  });

  return { token, profile };
}

export function validateDevSessionToken(token: string): SessionPayload | null {
  return sessions.get(token) ?? null;
}

export function getDevProfile(profileId: string): PlayerProfile | null {
  return profilesById.get(profileId) ?? null;
}

export function profileMeJson(profile: PlayerProfile) {
  return profileToJson(profile);
}
