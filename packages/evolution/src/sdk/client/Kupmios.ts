/**
 * Kupmios provider (Kupo + Ogmios) for the composable client API.
 *
 * Adds query, submission, evaluation, and await capabilities.
 *
 * @example
 * ```ts
 * import { client, preview, kupmios } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(kupmios({ kupoUrl: "http://localhost:1442", ogmiosUrl: "ws://localhost:1337" }))
 * ```
 *
 * @since 2.1.0
 * @module
 */

import * as KupmiosEffects from "../provider/internal/KupmiosEffects.js"
import { attachCapabilities } from "./attachCapabilities.js"
import type { KupmiosCapabilities } from "./Capabilities.js"
import { type Client } from "./Client.js"

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Configuration for the Kupmios provider (Kupo + Ogmios).
 *
 * @since 2.1.0
 * @category model
 */
export interface KupmiosConfig {
  readonly kupoUrl: string
  readonly ogmiosUrl: string
  readonly headers?: {
    readonly ogmiosHeader?: Record<string, string>
    readonly kupoHeader?: Record<string, string>
  }
}

// ── Constructor ───────────────────────────────────────────────────────────────

/**
 * Kupmios provider constructor (Kupo + Ogmios combined).
 *
 * Adds query, submission, evaluation, and await capabilities.
 *
 * @example
 * ```ts
 * import { client, preview, kupmios } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(kupmios({ kupoUrl: "http://localhost:1442", ogmiosUrl: "ws://localhost:1337" }))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const kupmios = (cfg: KupmiosConfig) =>
  <T extends Client>(
    c: T
  ): T & KupmiosCapabilities => {
    return attachCapabilities<T, KupmiosCapabilities>(c, {
      getUtxos: KupmiosEffects.getUtxosEffect(cfg.kupoUrl, cfg.headers),
      getUtxosByOutRef: KupmiosEffects.getUtxosByOutRefEffect(cfg.kupoUrl, cfg.headers),
      getUtxosWithUnit: KupmiosEffects.getUtxosWithUnitEffect(cfg.kupoUrl, cfg.headers),
      getUtxoByUnit: KupmiosEffects.getUtxoByUnitEffect(cfg.kupoUrl, cfg.headers),
      getProtocolParameters: () => KupmiosEffects.getProtocolParametersEffect(cfg.ogmiosUrl, cfg.headers),
      getDelegation: KupmiosEffects.getDelegationEffect(cfg.ogmiosUrl, cfg.headers),
      submitTx: KupmiosEffects.submitTxEffect(cfg.ogmiosUrl, cfg.headers),
      evaluateTx: KupmiosEffects.evaluateTxEffect(cfg.ogmiosUrl, cfg.headers),
      awaitTx: KupmiosEffects.awaitTxEffect(cfg.kupoUrl, cfg.headers),
      getDatum: KupmiosEffects.getDatumEffect(cfg.kupoUrl, cfg.headers),
      watchUtxos: KupmiosEffects.watchUtxosEffect(cfg.kupoUrl, cfg.headers)
    })
  }
