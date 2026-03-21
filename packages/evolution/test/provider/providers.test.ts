/**
 * Provider integration tests — all 4 providers in one place.
 *
 * Koios: opt-in via `KOIOS_ENABLED` env var (public endpoint, no key needed).
 * Blockfrost / Maestro: auto-skipped unless the API key env var is set.
 * Kupmios: auto-skipped unless both KUPO + OGMIOS URLs are set.
 *
 * Add keys to `.env.test.local` at the workspace root (gitignored).
 * See `.env.test.local.example` for available variables.
 */
import { describe, expect, it } from "vitest"

import { BlockfrostProvider } from "../../src/sdk/provider/Blockfrost.js"
import { Koios } from "../../src/sdk/provider/Koios.js"
import { KupmiosProvider } from "../../src/sdk/provider/Kupmios.js"
import { MaestroProvider } from "../../src/sdk/provider/Maestro.js"
import { registerConformanceTests } from "./conformance.js"
import { previewTxHash } from "./fixtures/constants.js"

const isConfigured = (value: string | undefined, placeholder?: string) =>
  Boolean(value && value.trim() !== "" && value !== placeholder)

const parseHeaderJson = (value: string | undefined) => {
  if (!value || value.trim() === "") return undefined
  try {
    return JSON.parse(value) as Record<string, string>
  } catch {
    return undefined
  }
}

const KOIOS_URL = process.env.KOIOS_PREPROD_URL ?? "https://preprod.koios.rest/api/v1"
const KOIOS_PREVIEW_URL = process.env.KOIOS_PREVIEW_URL ?? "https://preview.koios.rest/api/v1"
const BLOCKFROST_URL = process.env.BLOCKFROST_PREPROD_URL ?? "https://cardano-preprod.blockfrost.io/api/v0"
const BLOCKFROST_KEY = process.env.BLOCKFROST_PREPROD_KEY
const MAESTRO_URL = process.env.MAESTRO_PREPROD_URL ?? "https://preprod.gomaestro-api.org/v1"
const MAESTRO_KEY = process.env.MAESTRO_PREPROD_KEY
const KUPO_URL = process.env.KUPMIOS_KUPO_URL
const OGMIOS_URL = process.env.KUPMIOS_OGMIOS_URL
const KUPMIOS_KUPO_KEY = process.env.KUPMIOS_KUPO_KEY
const KUPMIOS_OGMIOS_KEY = process.env.KUPMIOS_OGMIOS_KEY
const defaultKupoHeader = KUPMIOS_KUPO_KEY ? { "dmtr-api-key": KUPMIOS_KUPO_KEY } : undefined
const defaultOgmiosHeader = KUPMIOS_OGMIOS_KEY ? { "dmtr-api-key": KUPMIOS_OGMIOS_KEY } : undefined
const KUPO_HEADER = parseHeaderJson(process.env.KUPMIOS_KUPO_HEADER_JSON) ?? defaultKupoHeader
const OGMIOS_HEADER = parseHeaderJson(process.env.KUPMIOS_OGMIOS_HEADER_JSON) ?? defaultOgmiosHeader

// ── Koios (no API key) ────────────────────────────────────────────────────────
describe.skipIf(!process.env.KOIOS_ENABLED)("Koios", () => {
  registerConformanceTests(() => new Koios(KOIOS_URL))
})

// ── Koios preview: awaitTx with Haskell show string asset_list ────────────────
// Opt-in via KOIOS_PREVIEW_ENABLED. The tx is confirmed on preview and Koios returns
// a Haskell show string for the collateral output's asset_list. This test fails
// without the InputOutputSchema fix.
describe.skipIf(!process.env.KOIOS_PREVIEW_ENABLED)("Koios (preview)", () => {
  it("awaitTx succeeds for tx with Haskell show string asset_list", { timeout: 200_000 }, async () => {
    const koios = new Koios(KOIOS_PREVIEW_URL)
    const confirmed = await koios.awaitTx(previewTxHash())
    expect(confirmed).toBe(true)
  })
})

// ── Blockfrost ────────────────────────────────────────────────────────────────
describe.skipIf(!isConfigured(BLOCKFROST_KEY, "preprodXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"))("Blockfrost", () => {
  registerConformanceTests(() => new BlockfrostProvider(BLOCKFROST_URL, BLOCKFROST_KEY))
})

// ── Maestro ───────────────────────────────────────────────────────────────────
describe.skipIf(!isConfigured(MAESTRO_KEY, "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"))("Maestro", () => {
  registerConformanceTests(() => new MaestroProvider(MAESTRO_URL, MAESTRO_KEY!))
})

// ── Kupmios (self-hosted or Demeter) ──────────────────────────────────────────
describe.skipIf(
  !isConfigured(KUPO_URL, "https://your-kupo-endpoint") ||
    !isConfigured(OGMIOS_URL, "https://your-ogmios-endpoint")
)("Kupmios", () => {
  registerConformanceTests(
    () =>
      new KupmiosProvider(KUPO_URL!, OGMIOS_URL!, {
        kupoHeader: KUPO_HEADER,
        ogmiosHeader: OGMIOS_HEADER
      })
  )
})
