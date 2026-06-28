import { describe, it, expect, vi } from "vitest";
import type pg from "pg";
import {
  computeCompositeScore,
  rebuildRankingFromPg,
} from "../ranking.js";
import type { Redis } from "../redis.js";
import {
  rankExploredKey,
  rankKillsKey,
  rankPlaytimeKey,
  rankScoreKey,
} from "../redisKeys.js";

describe("computeCompositeScore", () => {
  it("weights kills, exploration, play time and missions", () => {
    const score = computeCompositeScore({
      barbariansKilled: 3,
      exploredPctMax: 12.5,
      playTimeMs: 120_000,
      missionsCompleted: 1,
    });
    // 3*100 + floor(12.5*10) + floor(120000/60000)*2 + 1*500
    expect(score).toBe(300 + 125 + 4 + 500);
  });

  it("returns zero for empty stats", () => {
    expect(computeCompositeScore({
      barbariansKilled: 0,
      exploredPctMax: 0,
      playTimeMs: 0,
      missionsCompleted: 0,
    })).toBe(0);
  });

  it("floors exploration and play-time contributions", () => {
    const score = computeCompositeScore({
      barbariansKilled: 0,
      exploredPctMax: 9.9,
      playTimeMs: 59_999,
      missionsCompleted: 0,
    });
    expect(score).toBe(99);
  });
});

describe("rebuildRankingFromPg", () => {
  it("clears and repopulates ranking zsets from profile rows", async () => {
    const exec = vi.fn().mockResolvedValue([]);
    const multi = {
      del: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      exec,
    };
    const redis = { multi: vi.fn(() => multi) } as unknown as Redis;
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          id: "p1",
          username: "Hero",
          username_lower: "hero",
          captain_name: "Hero",
          barbarians_killed: 5,
          explored_pct_max: 10,
          play_time_ms: "60000",
          missions_completed: 1,
          composite_score: 900,
          created_at: new Date(),
          last_seen_at: new Date(),
          auth_provider: "guest",
        }],
      }),
    } as unknown as pg.Pool;

    const count = await rebuildRankingFromPg(pool, redis);

    expect(count).toBe(1);
    expect(multi.del).toHaveBeenCalledWith(
      rankScoreKey(),
      rankKillsKey(),
      rankExploredKey(),
      rankPlaytimeKey(),
    );
    expect(multi.zadd).toHaveBeenCalledWith(rankScoreKey(), 900, "p1");
    expect(exec).toHaveBeenCalled();
  });

  it("returns 0 when no profiles exist", async () => {
    const redis = { multi: vi.fn() } as unknown as Redis;
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as pg.Pool;

    expect(await rebuildRankingFromPg(pool, redis)).toBe(0);
    expect(redis.multi).not.toHaveBeenCalled();
  });
});
