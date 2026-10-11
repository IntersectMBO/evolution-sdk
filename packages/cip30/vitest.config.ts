import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/temp/**", "**/.direnv/**", "**/.{idea,git,cache,output,temp}/**"]
  }
})
