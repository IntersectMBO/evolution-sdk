export interface EvolutionMcpConfig {
  readonly host: string
  readonly port: number
  readonly mcpPath: string
  readonly healthPath: string
}

const normalizePath = (value: string | undefined, fallback: string): string => {
  const candidate = (value ?? fallback).trim()
  if (candidate.length === 0) {
    return fallback
  }

  return candidate.startsWith("/") ? candidate : `/${candidate}`
}

const parsePort = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    return fallback
  }

  return parsed
}

export const resolveConfig = (overrides: Partial<EvolutionMcpConfig> = {}): EvolutionMcpConfig => ({
  host: overrides.host ?? process.env.EVOLUTION_MCP_HOST ?? "127.0.0.1",
  port: overrides.port ?? parsePort(process.env.EVOLUTION_MCP_PORT, 10_000),
  mcpPath: normalizePath(overrides.mcpPath ?? process.env.EVOLUTION_MCP_PATH, "/mcp"),
  healthPath: normalizePath(overrides.healthPath ?? process.env.EVOLUTION_MCP_HEALTH_PATH, "/health")
})