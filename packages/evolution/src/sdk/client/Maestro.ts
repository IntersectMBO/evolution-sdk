/**
 * Maestro provider for the composable client API.
 *
 * Adds query, submission, evaluation, and await capabilities.
 *
 * @example
 * ```ts
 * import { client, mainnet, maestro } from "@evolution-sdk/evolution"
 *
 * const myClient = client(mainnet)
 *   .with(maestro({ baseUrl: "https://mainnet.gomaestro-api.org/v1", apiKey: "..." }))
 * ```
 *
 * @since 2.1.0
 * @module
 */

import * as MaestroEffect from "../provider/internal/MaestroEffect.js"
import { attachCapabilities } from "./attachCapabilities.js"
import type { MaestroCapabilities } from "./Capabilities.js"
import { type Client } from "./Client.js"

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Configuration for the Maestro provider.
 *
 * @since 2.1.0
 * @category model
 */
export interface MaestroConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly turboSubmit?: boolean
}

// ── Constructor ───────────────────────────────────────────────────────────────

/**
 * Maestro provider constructor.
 *
 * Adds query, submission, evaluation, and await capabilities.
 *
 * @example
 * ```ts
 * import { client, mainnet, maestro } from "@evolution-sdk/evolution"
 *
 * const myClient = client(mainnet)
 *   .with(maestro({ baseUrl: "https://mainnet.gomaestro-api.org/v1", apiKey: "..." }))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const maestro = (cfg: MaestroConfig) =>
  <T extends Client>(
    c: T
  ): T & MaestroCapabilities => {
    return attachCapabilities<T, MaestroCapabilities>(c, {
      getUtxos: MaestroEffect.getUtxos(cfg.baseUrl, cfg.apiKey),
      getUtxosByOutRef: MaestroEffect.getUtxosByOutRef(cfg.baseUrl, cfg.apiKey),
      getUtxosWithUnit: MaestroEffect.getUtxosWithUnit(cfg.baseUrl, cfg.apiKey),
      getUtxoByUnit: MaestroEffect.getUtxoByUnit(cfg.baseUrl, cfg.apiKey),
      getProtocolParameters: () => MaestroEffect.getProtocolParameters(cfg.baseUrl, cfg.apiKey),
      getDelegation: MaestroEffect.getDelegation(cfg.baseUrl, cfg.apiKey),
      submitTx: MaestroEffect.submitTx(cfg.baseUrl, cfg.apiKey, cfg.turboSubmit),
      evaluateTx: MaestroEffect.evaluateTx(cfg.baseUrl, cfg.apiKey),
      awaitTx: MaestroEffect.awaitTx(cfg.baseUrl, cfg.apiKey),
      getDatum: MaestroEffect.getDatum(cfg.baseUrl, cfg.apiKey)
    })
  }
