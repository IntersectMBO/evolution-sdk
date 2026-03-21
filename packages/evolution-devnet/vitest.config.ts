import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Docker container startup can take 30-60s per test file; use a generous timeout
    testTimeout: 120_000,
    hookTimeout: 90_000,
    teardownTimeout: 60_000,
    // Serialize all test files — each file creates its own cluster (cardano-node + kupo + ogmios)
    // Running them concurrently exhausts Docker resources on CI / local machines
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    // Devnet tests are slow but should not be retried — flakiness here is a real infra failure
    retry: 0,
    exclude: ["**/node_modules/**", "**/dist/**", "**/temp/**", "**/.direnv/**", "**/.{idea,git,cache,output,temp}/**"]
  }
})
