import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { createEvolutionMcpServer } from "./server.js"

export const startStdioServer = async (): Promise<void> => {
  const transport = new StdioServerTransport()
  const server = createEvolutionMcpServer()

  await server.connect(transport)

  const shutdown = async (): Promise<void> => {
    await transport.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0))
  })
}
