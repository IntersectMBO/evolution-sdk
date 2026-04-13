import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Docker container startup can take 30-60s per test file; use a generous timeout
    testTimeout: 120_000,
    hookTimeout: 90_000,
    teardownTimeout: 60_000,
    // globalSetup starts a shared cluster once; most tests connect to it.
    // Isolated tests (Genesis, integration, VoteValidators) still create their own clusters.
    globalSetup: ["./test/global-setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 3
      }
    },
    // Devnet tests are slow but should not be retried — flakiness here is a real infra failure
    retry: 0,
    exclude: ["**/node_modules/**", "**/dist/**", "**/temp/**", "**/.direnv/**", "**/.{idea,git,cache,output,temp}/**"]
  }
})
