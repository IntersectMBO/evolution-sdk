import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 15_000,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/.tsbuildinfo/**"]
  }
})