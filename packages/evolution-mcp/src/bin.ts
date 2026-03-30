#!/usr/bin/env node

import { once } from "node:events"

import { resolveConfig } from "./config.js"
import { startHttpServer } from "./http.js"
import { startStdioServer } from "./stdio.js"

const args = process.argv.slice(2)
const command = args[0] ?? "serve"

const readFlag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  if (index === -1) {
    return undefined
  }

  return args[index + 1]
}

const usage = (): void => {
  process.stdout.write(
    [
      "Usage:",
      "  evolution-mcp serve  [--host HOST] [--port PORT] [--path /mcp] [--health-path /health]",
      "  evolution-mcp stdio",
      "",
      "Commands:",
      "  serve   Start HTTP server (default)",
      "  stdio   Start JSON-RPC stdio transport (stdin/stdout)",
      "",
      "Defaults (serve):",
      "  host=127.0.0.1 port=10000 path=/mcp health-path=/health"
    ].join("\n") + "\n"
  )
}

const main = async (): Promise<void> => {
  if (command === "help" || command === "--help" || command === "-h") {
    usage()
    return
  }

  if (command === "stdio") {
    await startStdioServer()
    return
  }

  if (command !== "serve" && command !== "start") {
    usage()
    throw new Error(`Unsupported command: ${command}`)
  }

  const config = resolveConfig({
    host: readFlag("--host"),
    port: readFlag("--port") ? Number.parseInt(readFlag("--port") as string, 10) : undefined,
    mcpPath: readFlag("--path"),
    healthPath: readFlag("--health-path")
  })

  const { server } = await startHttpServer(config)
  process.stdout.write(`Evolution MCP listening on http://${config.host}:${config.port}${config.mcpPath}\n`)
  process.stdout.write(`Health endpoint: http://${config.host}:${config.port}${config.healthPath}\n`)

  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0))
  })

  await once(server, "close")
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})