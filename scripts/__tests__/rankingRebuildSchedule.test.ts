import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleRankingRebuild,
  RANKING_REBUILD_MS,
} from "../mmoRankingSchedule.js";

describe("scheduleRankingRebuild", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses 6 hour interval", () => {
    expect(RANKING_REBUILD_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("skips when PostgreSQL or Redis unavailable", () => {
    const rebuild = vi.fn().mockResolvedValue(0);
    const scheduler = scheduleRankingRebuild({
      dbReady: false,
      redisReady: true,
      rebuild,
      onError: vi.fn(),
    });
    expect(rebuild).not.toHaveBeenCalled();
    expect(scheduler.interval).toBeNull();
  });

  it("runs on startup and every 6 hours when PG+Redis ready", async () => {
    const rebuild = vi.fn().mockResolvedValue(2);
    const scheduler = scheduleRankingRebuild({
      dbReady: true,
      redisReady: true,
      rebuild,
      onError: vi.fn(),
    });

    expect(rebuild).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RANKING_REBUILD_MS);
    expect(rebuild).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(RANKING_REBUILD_MS);
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("forwards rebuild errors to onError", async () => {
    const err = new Error("redis down");
    const rebuild = vi.fn().mockRejectedValue(err);
    const onError = vi.fn();
    scheduleRankingRebuild({
      dbReady: true,
      redisReady: true,
      rebuild,
      onError,
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(err));
  });
});
