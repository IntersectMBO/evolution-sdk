/**
 * Koios provider for the composable client API.
 *
 * Adds query, submission, and await capabilities.
 *
 * @example
 * ```ts
 * import { client, mainnet, koios } from "@evolution-sdk/evolution"
 *
 * const myClient = client(mainnet)
 *   .with(koios({ baseUrl: "https://api.koios.rest/api/v1" }))
 * ```
 *
 * @since 2.1.0
 * @module
 */

import * as KoiosEffect from "../provider/internal/KoiosEffect.js"
import { attachCapabilities } from "./attachCapabilities.js"
import type { KoiosCapabilities } from "./Capabilities.js"
import { type Client } from "./Client.js"

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Configuration for the Koios provider.
 *
 * @since 2.1.0
 * @category model
 */
export interface KoiosConfig {
  readonly baseUrl: string
  readonly token?: string
}

// ── Constructor ───────────────────────────────────────────────────────────────

/**
 * Koios provider constructor.
 *
 * Adds query, submission, and await capabilities.
 *
 * @example
 * ```ts
 * import { client, mainnet, koios } from "@evolution-sdk/evolution"
 *
 * const myClient = client(mainnet)
 *   .with(koios({ baseUrl: "https://api.koios.rest/api/v1" }))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const koios = (cfg: KoiosConfig) =>
  <T extends Client>(
    c: T
  ): T & KoiosCapabilities => {
    return attachCapabilities<T, KoiosCapabilities>(c, {
      getUtxos: KoiosEffect.getUtxos(cfg.baseUrl, cfg.token),
      getUtxosByOutRef: KoiosEffect.getUtxosByOutRef(cfg.baseUrl, cfg.token),
      getUtxosWithUnit: KoiosEffect.getUtxosWithUnit(cfg.baseUrl, cfg.token),
      getUtxoByUnit: KoiosEffect.getUtxoByUnit(cfg.baseUrl, cfg.token),
      getProtocolParameters: () => KoiosEffect.getProtocolParameters(cfg.baseUrl, cfg.token),
      getDelegation: KoiosEffect.getDelegation(cfg.baseUrl, cfg.token),
      submitTx: KoiosEffect.submitTx(cfg.baseUrl, cfg.token),
      getDatum: KoiosEffect.getDatum(cfg.baseUrl, cfg.token),
      awaitTx: KoiosEffect.awaitTx(cfg.baseUrl, cfg.token),
      evaluateTx: KoiosEffect.evaluateTx(cfg.baseUrl, cfg.token)
    })
  }
