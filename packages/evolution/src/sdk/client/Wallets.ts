/**
 * Wallet constructors for the composable client API.
 *
 * Provides wallet constructors that add wallet capabilities to a base
 * `client(chain)`. Each constructor returns a function that intersects
 * wallet capabilities onto the client type.
 *
 * @example
 * ```ts
 * import { client, preview, blockfrost, seedWallet } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(blockfrost({ baseUrl: "...", projectId: "..." }))
 *   .with(seedWallet({ mnemonic: "..." }))
 * ```
 *
 * @since 2.1.0
 * @module
 */

import { Effect, ParseResult, Schema } from "effect"

import * as Address from "../../Address.js"
import * as CoreRewardAddress from "../../RewardAddress.js"
import * as Transaction from "../../Transaction.js"
import type * as TransactionWitnessSet from "../../TransactionWitnessSet.js"
import type * as CoreUTxO from "../../UTxO.js"
import type { ProviderError } from "../provider/Provider.js"
import type { WalletApi, WalletError } from "../wallet/Wallet.js"
import * as Wallet from "../wallet/Wallet.js"
import { attachCapabilities } from "./attachCapabilities.js"
import type {
  Addressable,
  Cip30WalletCapabilities,
  QueryDelegation,
  QueryUtxos,
  QueryUtxosByOutRef,
  SigningWalletCapabilities,
  Stakeable,
  WalletDelegation,
  WalletUtxos
} from "./Capabilities.js"
import { type Client } from "./Client.js"

// ── Wallet configs ────────────────────────────────────────────────────────────

/**
 * Configuration for the seed wallet constructor.
 *
 * @since 2.1.0
 * @category model
 */
export interface SeedWalletConfig {
  readonly mnemonic: string
  readonly accountIndex?: number
  readonly paymentIndex?: number
  readonly stakeIndex?: number
  readonly addressType?: "Base" | "Enterprise"
  readonly password?: string
}

/**
 * Configuration for the private key wallet constructor.
 *
 * @since 2.1.0
 * @category model
 */
export interface PrivateKeyWalletConfig {
  readonly paymentKey: string
  readonly stakeKey?: string
  readonly addressType?: "Base" | "Enterprise"
}

// ── Wallet capability type aliases ────────────────────────────────────────────

type SigningCaps<T extends Client> = SigningWalletCapabilities &
  (T extends { Effect: { getUtxos: unknown } } ? WalletUtxos : {}) &
  (T extends { Effect: { getDelegation: unknown } } ? WalletDelegation : {})

type ReadOnlyWalletCaps = Addressable & Stakeable

type Cip30WalletCaps = Cip30WalletCapabilities

// ── Wallet constructors ───────────────────────────────────────────────────────

/**
 * Seed phrase wallet constructor.
 *
 * Adds address, signing, staking, and (when a provider is present) wallet UTxO capabilities.
 *
 * @example
 * ```ts
 * import { client, preview, blockfrost, seedWallet } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(blockfrost({ baseUrl: "...", projectId: "..." }))
 *   .with(seedWallet({ mnemonic: "your 24 word mnemonic ..." }))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const seedWallet = (cfg: SeedWalletConfig) =>
  <T extends Client>(c: T): T & SigningCaps<T> => {
    const effects = Wallet.makeSigningWalletEffect(c.chain.id, cfg.mnemonic, {
      accountIndex: cfg.accountIndex,
      paymentIndex: cfg.paymentIndex,
      stakeIndex: cfg.stakeIndex,
      addressType: cfg.addressType,
      password: cfg.password
    })

    const providerEffect = c.Effect as Partial<QueryUtxos["Effect"] & QueryUtxosByOutRef["Effect"] & QueryDelegation["Effect"]>
    const caps: Record<string, (...args: Array<never>) => Effect.Effect<unknown, unknown>> = {
      getAddress: effects.address,
      getRewardAddress: effects.rewardAddress,
      signMessage: effects.signMessage as never
    }

    // Auto-fetch reference UTxOs before signing when a provider is present
    if (typeof providerEffect.getUtxosByOutRef === "function") {
      const getUtxosByOutRef = providerEffect.getUtxosByOutRef
      caps.signTx = ((
        txOrHex: Transaction.Transaction | string,
        context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
      ) =>
        Effect.gen(function* () {
          if (!context?.referenceUtxos?.length) {
            const tx =
              typeof txOrHex === "string"
                ? yield* ParseResult.decodeUnknownEither(Transaction.FromCBORHex())(txOrHex).pipe(
                    Effect.mapError(
                      (cause) => new Wallet.WalletError({ message: `Failed to decode transaction: ${cause}`, cause })
                    )
                  )
                : txOrHex
            if (tx.body.referenceInputs && tx.body.referenceInputs.length > 0) {
              const fetched = yield* (getUtxosByOutRef(tx.body.referenceInputs) as Effect.Effect<ReadonlyArray<CoreUTxO.UTxO>, ProviderError>).pipe(
                Effect.orElseSucceed(() => [] as ReadonlyArray<CoreUTxO.UTxO>)
              )
              return yield* (effects.signTx(txOrHex, { ...context, referenceUtxos: fetched }) as Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>)
            }
          }
          return yield* (effects.signTx(txOrHex, context) as Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>)
        })) as never
    } else {
      caps.signTx = effects.signTx as never
    }

    if (typeof providerEffect.getUtxos === "function") {
      const getUtxos = providerEffect.getUtxos
      caps.getWalletUtxos = () => Effect.flatMap(effects.address(), (addr) => getUtxos(addr))
    }
    if (typeof providerEffect.getDelegation === "function") {
      const getDelegation = providerEffect.getDelegation
      caps.getWalletDelegation = () =>
        Effect.flatMap(effects.rewardAddress(), (rewardAddr) => {
          if (!rewardAddr) return Effect.fail(new Wallet.WalletError({ message: "No reward address", cause: null }))
          return getDelegation(rewardAddr) as Effect.Effect<unknown, unknown>
        })
    }

    return attachCapabilities<T, SigningCaps<T>>(c, caps)
  }

/**
 * Private key wallet constructor.
 *
 * Adds address, signing, staking, and (when a provider is present) wallet UTxO capabilities.
 *
 * @example
 * ```ts
 * import { client, preview, blockfrost, privateKeyWallet } from "@evolution-sdk/evolution"
 *
 * const myClient = client(preview)
 *   .with(blockfrost({ baseUrl: "...", projectId: "..." }))
 *   .with(privateKeyWallet({ paymentKey: "ed25519e_sk..." }))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const privateKeyWallet = (cfg: PrivateKeyWalletConfig) =>
  <T extends Client>(c: T): T & SigningCaps<T> => {
    const effects = Wallet.makePrivateKeyWalletEffect(c.chain.id, cfg.paymentKey, {
      stakeKey: cfg.stakeKey,
      addressType: cfg.addressType
    })

    const providerEffect = c.Effect as Partial<QueryUtxos["Effect"] & QueryUtxosByOutRef["Effect"] & QueryDelegation["Effect"]>
    const caps: Record<string, (...args: Array<never>) => Effect.Effect<unknown, unknown>> = {
      getAddress: effects.address,
      getRewardAddress: effects.rewardAddress,
      signMessage: effects.signMessage as never
    }

    // Auto-fetch reference UTxOs before signing when a provider is present
    if (typeof providerEffect.getUtxosByOutRef === "function") {
      const getUtxosByOutRef = providerEffect.getUtxosByOutRef
      caps.signTx = ((
        txOrHex: Transaction.Transaction | string,
        context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
      ) =>
        Effect.gen(function* () {
          if (!context?.referenceUtxos?.length) {
            const tx =
              typeof txOrHex === "string"
                ? yield* ParseResult.decodeUnknownEither(Transaction.FromCBORHex())(txOrHex).pipe(
                    Effect.mapError(
                      (cause) => new Wallet.WalletError({ message: `Failed to decode transaction: ${cause}`, cause })
                    )
                  )
                : txOrHex
            if (tx.body.referenceInputs && tx.body.referenceInputs.length > 0) {
              const fetched = yield* (getUtxosByOutRef(tx.body.referenceInputs) as Effect.Effect<ReadonlyArray<CoreUTxO.UTxO>, ProviderError>).pipe(
                Effect.orElseSucceed(() => [] as ReadonlyArray<CoreUTxO.UTxO>)
              )
              return yield* (effects.signTx(txOrHex, { ...context, referenceUtxos: fetched }) as Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>)
            }
          }
          return yield* (effects.signTx(txOrHex, context) as Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>)
        })) as never
    } else {
      caps.signTx = effects.signTx as never
    }

    if (typeof providerEffect.getUtxos === "function") {
      const getUtxos = providerEffect.getUtxos
      caps.getWalletUtxos = () => Effect.flatMap(effects.address(), (addr) => getUtxos(addr))
    }
    if (typeof providerEffect.getDelegation === "function") {
      const getDelegation = providerEffect.getDelegation
      caps.getWalletDelegation = () =>
        Effect.flatMap(effects.rewardAddress(), (rewardAddr) => {
          if (!rewardAddr) return Effect.fail(new Wallet.WalletError({ message: "No reward address", cause: null }))
          return getDelegation(rewardAddr) as Effect.Effect<unknown, unknown>
        })
    }

    return attachCapabilities<T, SigningCaps<T>>(c, caps)
  }

/**
 * Read-only wallet constructor.
 *
 * Adds address and reward address capabilities — no signing.
 *
 * @example
 * ```ts
 * import { client, mainnet, blockfrost, readOnlyWallet } from "@evolution-sdk/evolution"
 *
 * const myClient = client(mainnet)
 *   .with(blockfrost({ baseUrl: "...", projectId: "..." }))
 *   .with(readOnlyWallet("addr1..."))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const readOnlyWallet = (address: string, rewardAddress?: string) =>
  <T extends Client>(c: T): T & ReadOnlyWalletCaps => {
    const parsed = Address.fromBech32(address)
    const parsedReward = rewardAddress
      ? Schema.decodeSync(CoreRewardAddress.RewardAddress)(rewardAddress)
      : null
    const effects = Wallet.makeReadOnlyWalletEffect(parsed, parsedReward)

    return attachCapabilities<T, ReadOnlyWalletCaps>(c, {
      getAddress: effects.address,
      getRewardAddress: effects.rewardAddress
    })
  }

/**
 * CIP-30 browser wallet constructor.
 *
 * Adds address, signing, staking, and wallet-based submission capabilities.
 *
 * @example
 * ```ts
 * import { client, mainnet, cip30Wallet } from "@evolution-sdk/evolution"
 *
 * const api = await window.cardano.nami.enable()
 * const myClient = client(mainnet)
 *   .with(cip30Wallet(api))
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const cip30Wallet = (api: WalletApi) =>
  <T extends Client>(c: T): T & Cip30WalletCaps => {
    const effects = Wallet.makeApiWalletEffect(api)

    return attachCapabilities<T, Cip30WalletCaps>(c, {
      getAddress: effects.address,
      getRewardAddress: effects.rewardAddress,
      signTx: effects.signTx,
      signMessage: effects.signMessage,
      walletSubmitTx: effects.submitTx
    })
  }
