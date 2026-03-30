import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"

import { resolveConfig, type EvolutionMcpConfig } from "./config.js"
import { createEvolutionMcpServer } from "./server.js"
import { sessionStore } from "./sessions.js"

const respondJson = (res: ServerResponse, statusCode: number, body: unknown): void => {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  })
  res.end(JSON.stringify(body))
}

const isRoute = (req: IncomingMessage, route: string): boolean => {
  const requestUrl = req.url ?? "/"
  const pathname = requestUrl.split("?")[0]
  return pathname === route
}

export interface StartedHttpServer {
  readonly server: Server
  readonly config: EvolutionMcpConfig
}

export const startHttpServer = async (overrides: Partial<EvolutionMcpConfig> = {}): Promise<StartedHttpServer> => {
  const config = resolveConfig(overrides)
  const mcpServer = createEvolutionMcpServer()

  // McpServer supports one transport at a time; serialize MCP requests
  let pending: Promise<void> = Promise.resolve()
  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    const next = pending.then(fn, fn)
    pending = next
    return next
  }

  const server = createServer(async (req, res) => {
    if (!req.url) {
      respondJson(res, 400, { error: "Missing request URL" })
      return
    }

    if (isRoute(req, config.healthPath)) {
      if (req.method !== "GET") {
        respondJson(res, 405, { error: "Method Not Allowed", allow: ["GET"] })
        return
      }

      respondJson(res, 200, {
        ok: true,
        host: config.host,
        port: config.port,
        mcpPath: config.mcpPath,
        sessionStats: sessionStore.stats()
      })
      return
    }

    if (isRoute(req, config.mcpPath)) {
      if (req.method !== "POST") {
        respondJson(res, 405, { error: "Method Not Allowed", allow: ["POST"] })
        return
      }

      await enqueue(async () => {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        })

        try {
          await mcpServer.connect(transport)
          await transport.handleRequest(req, res)
        } catch (error) {
          if (!res.headersSent) {
            respondJson(res, 500, {
              jsonrpc: "2.0",
              error: {
                code: -32_603,
                message: error instanceof Error ? error.message : "Internal server error"
              },
              id: null
            })
          }
        } finally {
          await transport.close().catch(() => undefined)
        }
      })

      return
    }

    respondJson(res, 404, { error: "Not Found" })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.port, config.host, () => {
      server.off("error", reject)
      resolve()
    })
  })

  return { server, config }
}