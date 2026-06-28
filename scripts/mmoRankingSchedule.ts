/** Periodic ranking rebuild from PostgreSQL → Redis (6 h). */
export const RANKING_REBUILD_MS = 6 * 60 * 60 * 1000;

export type RankingRebuildScheduler = {
  interval: ReturnType<typeof setInterval> | null;
  stop: () => void;
};

export function scheduleRankingRebuild(options: {
  dbReady: boolean;
  redisReady: boolean;
  rebuild: () => Promise<unknown>;
  onError: (err: unknown) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): RankingRebuildScheduler {
  if (!options.dbReady || !options.redisReady) {
    return { interval: null, stop: () => {} };
  }

  const run = (): void => {
    void options.rebuild().catch(options.onError);
  };

  run();

  const setIv = options.setIntervalFn ?? setInterval;
  const clearIv = options.clearIntervalFn ?? clearInterval;
  const interval = setIv(run, RANKING_REBUILD_MS);

  return {
    interval,
    stop: () => {
      if (interval) clearIv(interval);
    },
  };
}
