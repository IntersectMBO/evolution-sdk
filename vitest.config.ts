import path from "node:path"
import { fileURLToPath } from "node:url"

import { loadEnv } from "vite"
import { defineConfig } from "vitest/config"

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: "node",
    env: loadEnv(mode, workspaceRoot, ""),
    testTimeout: 60000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    pool: "threads",
    retry: 2,
    bail: 1,
    exclude: ["**/node_modules/**", "**/dist/**", "**/temp/**", "**/.direnv/**", "**/.{idea,git,cache,output,temp}/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.ts", "**/*.spec.ts", "examples/", "scripts/", "temp/"]
    }
  }
}))
