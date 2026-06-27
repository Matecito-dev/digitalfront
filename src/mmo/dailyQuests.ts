import type { SimEvent } from "../sim/events.js";
import { getPool } from "./db.js";
import { getRedis } from "./redis.js";
import { profileCacheKey } from "./redisKeys.js";
import { compositeScoreSql } from "./ranking.js";

export type DailyQuestKind = "kill_barbarians" | "explore_pct" | "pvp_win";

export interface DailyQuestDef {
  kind: DailyQuestKind;
  target: number;
  progress: number;
  completed: boolean;
  rewarded: boolean;
}

export interface DailyQuestState {
  day: string;
  quests: DailyQuestDef[];
}

export interface DailyQuestProgressUpdate {
  state: DailyQuestState;
  completed: DailyQuestDef[];
  goldReward: number;
}

const QUEST_KINDS: DailyQuestKind[] = ["kill_barbarians", "explore_pct", "pvp_win"];

export function utcDayString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function defaultTarget(kind: DailyQuestKind): number {
  switch (kind) {
    case "kill_barbarians":
      return 2;
    case "explore_pct":
      return 10;
    case "pvp_win":
      return 1;
  }
}

export function goldRewardFor(kind: DailyQuestKind): number {
  switch (kind) {
    case "kill_barbarians":
      return 50;
    case "explore_pct":
      return 75;
    case "pvp_win":
      return 100;
  }
}

export function buildFreshDailyQuests(): DailyQuestDef[] {
  return QUEST_KINDS.map(kind => ({
    kind,
    target: defaultTarget(kind),
    progress: 0,
    completed: false,
    rewarded: false,
  }));
}

export function parseDailyQuests(raw: unknown, day: string): DailyQuestState {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { day, quests: buildFreshDailyQuests() };
  }
  const quests: DailyQuestDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = o.kind as DailyQuestKind;
    if (!QUEST_KINDS.includes(kind)) continue;
    quests.push({
      kind,
      target: typeof o.target === "number" ? o.target : defaultTarget(kind),
      progress: typeof o.progress === "number" ? o.progress : 0,
      completed: o.completed === true,
      rewarded: o.rewarded === true,
    });
  }
  if (quests.length !== QUEST_KINDS.length) {
    return { day, quests: buildFreshDailyQuests() };
  }
  return { day, quests };
}

export function applySimEventsToQuests(
  quests: DailyQuestDef[],
  events: SimEvent[],
  exploredPctMax?: number,
): DailyQuestDef[] {
  const next = quests.map(q => ({ ...q }));

  for (const ev of events) {
    if (ev.type === "GROUP_DEFEATED" && ev.winnerGroupId === "player" && ev.profileId) {
      bumpQuest(next, "kill_barbarians", 1);
    }
    if (ev.type === "PVP_COMBAT_END" && ev.reason === "elimination" && ev.winnerProfileId) {
      bumpQuest(next, "pvp_win", 1);
    }
  }

  if (exploredPctMax != null && Number.isFinite(exploredPctMax)) {
    const q = next.find(x => x.kind === "explore_pct");
    if (q) {
      q.progress = Math.max(q.progress, exploredPctMax);
      if (q.progress >= q.target) q.completed = true;
    }
  }

  return next;
}

function bumpQuest(quests: DailyQuestDef[], kind: DailyQuestKind, delta: number): void {
  const q = quests.find(x => x.kind === kind);
  if (!q || q.completed) return;
  q.progress = Math.min(q.target, q.progress + delta);
  if (q.progress >= q.target) q.completed = true;
}

export function collectNewlyRewarded(prev: DailyQuestDef[], next: DailyQuestDef[]): DailyQuestDef[] {
  const out: DailyQuestDef[] = [];
  for (let i = 0; i < next.length; i++) {
    const n = next[i]!;
    const p = prev[i];
    if (n.completed && !n.rewarded && (!p || !p.rewarded)) {
      n.rewarded = true;
      out.push(n);
    }
  }
  return out;
}

export async function loadDailyQuestState(profileId: string): Promise<DailyQuestState> {
  const day = utcDayString();
  const { rows } = await getPool().query<{ daily_quest_day: string | null; daily_quests: unknown }>(
    "SELECT daily_quest_day, daily_quests FROM profiles WHERE id = $1",
    [profileId],
  );
  const row = rows[0];
  if (!row) return { day, quests: buildFreshDailyQuests() };

  const rowDay = row.daily_quest_day
    ? String(row.daily_quest_day).slice(0, 10)
    : null;
  if (rowDay !== day) {
    return { day, quests: buildFreshDailyQuests() };
  }
  return parseDailyQuests(row.daily_quests, day);
}

export async function saveDailyQuestState(
  profileId: string,
  state: DailyQuestState,
  scoreBump: number,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE profiles
     SET daily_quest_day = $2::date,
         daily_quests = $3::jsonb,
         composite_score = ${compositeScoreSql()} + $4,
         last_seen_at = now()
     WHERE id = $1`,
    [profileId, state.day, JSON.stringify(state.quests), scoreBump],
  );
  await getRedis().del(profileCacheKey(profileId));
}

export async function processDailyQuestEvents(
  profileId: string,
  events: SimEvent[],
  exploredPctMax?: number,
): Promise<DailyQuestProgressUpdate | null> {
  if (events.length === 0 && exploredPctMax == null) return null;

  const prev = await loadDailyQuestState(profileId);
  const nextQuests = applySimEventsToQuests(prev.quests, events, exploredPctMax);
  const newlyCompleted = collectNewlyRewarded(prev.quests, nextQuests);
  if (
    newlyCompleted.length === 0
    && JSON.stringify(prev.quests) === JSON.stringify(nextQuests)
    && prev.day === utcDayString()
  ) {
    return null;
  }

  const goldReward = newlyCompleted.reduce((sum, q) => sum + goldRewardFor(q.kind), 0);
  const scoreBump = newlyCompleted.length * 25;
  const state: DailyQuestState = { day: utcDayString(), quests: nextQuests };
  await saveDailyQuestState(profileId, state, scoreBump);
  return { state, completed: newlyCompleted, goldReward };
}
