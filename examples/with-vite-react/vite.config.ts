import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"

import type * as Payments from "./server/payments.ts"

// Serves the payment API from the dev server, so `pnpm dev` runs the whole app.
// In production, server/index.ts serves the same API.
function paymentApi(mode: string): Plugin {
  return {
    name: "payment-api",
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), "")
      // Loaded through Vite, so the SDK resolves the same way it does in the app.
      const handler = server.ssrLoadModule("/server/payments.ts").then((mod) =>
        (mod as typeof Payments).createPaymentApi({
          network: env.VITE_NETWORK,
          blockfrostProjectId: env.BLOCKFROST_PROJECT_ID
        })
      )
      server.middlewares.use((req, res, next) => {
        handler.then((handle) => handle(req, res)).then((handled) => handled || next(), next)
      })
    }
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), paymentApi(mode)],
  optimizeDeps: {
    exclude: ["@evolution-sdk/evolution"]
  },
  build: {
    target: "esnext"
  }
}))
