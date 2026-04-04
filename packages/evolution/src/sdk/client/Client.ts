/**
 * Composable client API.
 *
 * Build clients by calling `.with()` on a base `client(chain)` with provider
 * and wallet constructors. Each constructor adds capabilities to the client via
 * intersection types, and TypeScript infers the accumulated type automatically.
 *
 * @example
 * ```ts
 * import { client, preview, blockfrost, seedWallet } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(blockfrost({ baseUrl: "...", projectId: "..." }))
 *   .with(seedWallet({ mnemonic: "..." }))
 *
 * // Promise API
 * await myClient.getUtxos(addr)
 * await myClient.signTx(tx)
 *
 * // Transaction building:
 * myClient.newTx().payToAddress({ address: "addr1...", assets: { lovelace: 5_000_000n } })
 *
 * // Effect API
 * myClient.Effect.getUtxos(addr).pipe(Effect.flatMap(...))
 * ```
 *
 * @since 2.1.0
 * @module
 */

import { Effect } from "effect"

import {
  makeCapabilityTxBuilder,
  type ProviderLike,
  type ReadOnlyWalletLike,
  type SigningWalletLike,
  type TxBuilder,
  type WalletLike,
} from "../builders/TransactionBuilder.js"
import type { Chain } from "./Chain.js"

// Re-export provider constructors for backward compatibility
export {
  blockfrost,
  type BlockfrostConfig,
} from "./Blockfrost.js"
export {
  koios,
  type KoiosConfig,
} from "./Koios.js"
export {
  kupmios,
  type KupmiosConfig,
} from "./Kupmios.js"
export {
  maestro,
  type MaestroConfig,
} from "./Maestro.js"

// Re-export wallet constructors for backward compatibility
export {
  cip30Wallet,
  privateKeyWallet,
  type PrivateKeyWalletConfig,
  readOnlyWallet,
  seedWallet,
  type SeedWalletConfig,
} from "./Wallets.js"

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Base client carrying chain context. All composable clients extend this.
 *
 * @since 2.1.0
 * @category model
 */
export interface Client<C extends Chain = Chain> {
  readonly chain: C
  readonly networkId: C["id"]
  readonly Effect: {}
  readonly newTx: () => TxBuilder<this, {}>
  readonly with: <R>(fn: (c: this) => R) => R
}

/**
 * Create a base client from a chain descriptor.
 *
 * @example
 * ```ts
 * import { client, preview, blockfrost } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(blockfrost({ baseUrl: "...", projectId: "..." }))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const client = <C extends Chain>(chain: C): Client<C> => {
  const result: Client<C> = {
    chain,
    networkId: chain.id,
    Effect: {},
    newTx: () => newTx(result),
    with: <R>(fn: (c: Client<C>) => R): R => fn(result)
  }
  return result
}

// ── Transaction builder ───────────────────────────────────────────────────────

/**
 * Create a TxBuilder from a composable client.
 *
 * Extracts provider and wallet capabilities from the client's Effect namespace
 * and maps them to the builder's expected interfaces using structural typing.
 *
 * The return type `TxBuilder<T, {}>` carries the client's full capability set.
 * At build time, `BuildArgs<T, {}>` computes which `BuildOptions` fields are required
 * based on what T can provide automatically:
 * - `protocolParameters` required unless T extends `QueryProtocolParams`
 * - `changeAddress`       required unless T extends `Addressable`
 * - `availableUtxos`     required unless T extends `QueryUtxos`
 * - `evaluator`          required if R has accumulated `EvaluateTxCapability` AND T doesn't have it
 *
 * `build().then(sb => sb.sign())` is only available when T extends `Signable`.
 *
 * @example
 * ```ts
 * import { client, preview, blockfrost, seedWallet, newTx } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(blockfrost({ baseUrl: "...", projectId: "..." }))
 *   .with(seedWallet({ mnemonic: "..." }))
 *
 * const tx = newTx(myClient)
 *   .payToAddress({ address: "addr1...", assets: { lovelace: 5_000_000n } })
 *
 * const signed = await tx.build()
 *   .then(sb => sb.sign())
 *   .then(sb => sb.submit())
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const newTx = <T extends Client>(client: T): TxBuilder<T, {}> => {
  const eff = client.Effect as Record<string, unknown>

  // Build ProviderLike if client has provider capabilities
  const hasProvider = typeof eff.getProtocolParameters === "function"
  const provider: ProviderLike | undefined = hasProvider ? ({ Effect: eff } as ProviderLike) : undefined

  // Build WalletLike if client has wallet capabilities
  const hasAddress = typeof eff.getAddress === "function"
  const hasSign = typeof eff.signTx === "function"
  const rewardAddress: ReadOnlyWalletLike["Effect"]["rewardAddress"] =
    (eff.getRewardAddress as ReadOnlyWalletLike["Effect"]["rewardAddress"] | undefined) ??
    (() => Effect.succeed(null))

  const wallet: WalletLike | undefined = hasAddress
    ? hasSign
      ? {
          Effect: {
            address: eff.getAddress as ReadOnlyWalletLike["Effect"]["address"],
            rewardAddress,
            signTx: eff.signTx as SigningWalletLike["Effect"]["signTx"],
          },
        }
      : {
          Effect: {
            address: eff.getAddress as ReadOnlyWalletLike["Effect"]["address"],
            rewardAddress,
          },
        }
    : undefined

  return makeCapabilityTxBuilder<T>({
    wallet,
    provider,
    slotConfig: client.chain.slotConfig,
  })
}
