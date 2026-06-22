import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests sequentially to avoid API rate limiting
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 120000,
  },
});
