/**
 * Blockfrost provider for the composable client API.
 *
 * Adds query, submission, evaluation, and await capabilities.
 *
 * @example
 * ```ts
 * import { client, preview, blockfrost } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(blockfrost({ baseUrl: "https://cardano-preview.blockfrost.io/api/v0", projectId: "..." }))
 * ```
 *
 * @since 2.1.0
 * @module
 */

import * as BlockfrostEffect from "../provider/internal/BlockfrostEffect.js"
import { attachCapabilities } from "./attachCapabilities.js"
import type { BlockfrostCapabilities } from "./Capabilities.js"
import { type Client } from "./Client.js"

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Configuration for the Blockfrost provider.
 *
 * @since 2.1.0
 * @category model
 */
export interface BlockfrostConfig {
  readonly baseUrl: string
  readonly projectId?: string
}

// ── Constructor ───────────────────────────────────────────────────────────────

/**
 * Blockfrost provider constructor.
 *
 * Adds query, submission, evaluation, and await capabilities.
 *
 * @example
 * ```ts
 * import { client, preview, blockfrost } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(blockfrost({ baseUrl: "https://cardano-preview.blockfrost.io/api/v0", projectId: "..." }))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const blockfrost = (cfg: BlockfrostConfig) =>
  <T extends Client>(
    c: T
  ): T & BlockfrostCapabilities => {
    return attachCapabilities<T, BlockfrostCapabilities>(c, {
      getUtxos: BlockfrostEffect.getUtxos(cfg.baseUrl, cfg.projectId),
      getUtxosByOutRef: BlockfrostEffect.getUtxosByOutRef(cfg.baseUrl, cfg.projectId),
      getProtocolParameters: () => BlockfrostEffect.getProtocolParameters(cfg.baseUrl, cfg.projectId),
      getDelegation: BlockfrostEffect.getDelegation(cfg.baseUrl, cfg.projectId),
      submitTx: BlockfrostEffect.submitTx(cfg.baseUrl, cfg.projectId),
      awaitTx: BlockfrostEffect.awaitTx(cfg.baseUrl, cfg.projectId),
      getDatum: BlockfrostEffect.getDatum(cfg.baseUrl, cfg.projectId),
      evaluateTx: BlockfrostEffect.evaluateTx(cfg.baseUrl, cfg.projectId)
    })
  }
