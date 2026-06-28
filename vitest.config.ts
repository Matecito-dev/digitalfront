import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
    teardownTimeout: 15_000,
    globalTeardown: ["scripts/__tests__/globalTeardown.ts"],
  },
});
