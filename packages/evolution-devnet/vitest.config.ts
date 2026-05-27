import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Docker container startup can take 30-60s per test file; use a generous timeout
    testTimeout: 120_000,
    hookTimeout: 90_000,
    teardownTimeout: 60_000,
    // Pre-pull images before any test forks start, otherwise concurrent pulls of
    // the same image race dockerode's pull stream.
    globalSetup: ["./test/globalSetup.ts"],
    // Each test file creates its own cluster (cardano-node + kupo + ogmios).
    // Cap parallelism so total RAM stays within typical 7-8GB CI runner budget.
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 2
      }
    },
    // Devnet tests are slow but should not be retried — flakiness here is a real infra failure
    retry: 0,
    exclude: ["**/node_modules/**", "**/dist/**", "**/temp/**", "**/.direnv/**", "**/.{idea,git,cache,output,temp}/**"]
  }
})
