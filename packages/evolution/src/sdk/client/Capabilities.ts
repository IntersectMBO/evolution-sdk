/**
 * Fine-grained capability interfaces for the composable client API.
 *
 * Each interface represents a single, composable capability that carries both
 * a Promise method and its Effect counterpart under the `Effect` namespace.
 * TypeScript's intersection merging automatically combines `Effect` properties
 * across capabilities.
 *
 * @example
 * ```ts
 * import type { QueryUtxos, Addressable } from "@evolution-sdk/evolution"
 *
 * const getBalance = async (client: QueryUtxos & Addressable) => {
 *   // Promise API
 *   const utxos = await client.getUtxos(await client.getAddress())
 *   // Effect API
 *   client.Effect.getUtxos(addr)
 * }
 * ```
 *
 * @since 2.1.0
 * @module
 */

import type { Effect, Stream } from "effect"

import type * as CoreAddress from "../../Address.js"
import type * as Credential from "../../Credential.js"
import type * as PlutusData from "../../Data.js"
import type * as DatumHash from "../../DatumHash.js"
import type * as RewardAddress from "../../RewardAddress.js"
import type * as Script from "../../Script.js"
import type * as ScriptHash from "../../ScriptHash.js"
import type * as Transaction from "../../Transaction.js"
import type * as TransactionHash from "../../TransactionHash.js"
import type * as TransactionInput from "../../TransactionInput.js"
import type * as TransactionWitnessSet from "../../TransactionWitnessSet.js"
import type * as CoreUTxO from "../../UTxO.js"
import type { EvalRedeemer } from "../EvalRedeemer.js"
import type { Delegation, ProtocolParameters, ProviderError } from "../provider/Provider.js"
import type { Payload, SignedMessage, WalletError } from "../wallet/Wallet.js"

// ── Provider Capabilities ─────────────────────────────────────────────────────

/**
 * Query UTxOs at an address filtered by a specific asset unit.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface QueryUtxosWithUnit {
  readonly getUtxosWithUnit: (
    addressOrCredential: CoreAddress.Address | Credential.Credential,
    unit: string
  ) => Promise<Array<CoreUTxO.UTxO>>
  readonly Effect: {
    readonly getUtxosWithUnit: (
      addressOrCredential: CoreAddress.Address | Credential.Credential,
      unit: string
    ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  }
}

/**
 * Query a single UTxO by its asset unit (returns the UTxO holding that unit).
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface QueryUtxoByUnit {
  readonly getUtxoByUnit: (unit: string) => Promise<CoreUTxO.UTxO>
  readonly Effect: {
    readonly getUtxoByUnit: (unit: string) => Effect.Effect<CoreUTxO.UTxO, ProviderError>
  }
}

/**
 * Query delegation for the wallet's own reward address.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface WalletDelegation {
  readonly getWalletDelegation: () => Promise<Delegation>
  readonly Effect: {
    readonly getWalletDelegation: () => Effect.Effect<Delegation, WalletError | ProviderError>
  }
}

/**
 * Query UTxOs at an address or by credential.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface QueryUtxos {
  readonly getUtxos: (
    addressOrCredential: CoreAddress.Address | Credential.Credential
  ) => Promise<Array<CoreUTxO.UTxO>>
  readonly Effect: {
    readonly getUtxos: (
      addressOrCredential: CoreAddress.Address | Credential.Credential
    ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  }
}

/**
 * Query UTxOs by their output references (transaction inputs).
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface QueryUtxosByOutRef {
  readonly getUtxosByOutRef: (
    inputs: ReadonlyArray<TransactionInput.TransactionInput>
  ) => Promise<Array<CoreUTxO.UTxO>>
  readonly Effect: {
    readonly getUtxosByOutRef: (
      inputs: ReadonlyArray<TransactionInput.TransactionInput>
    ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  }
}

/**
 * Query current protocol parameters.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface QueryProtocolParams {
  readonly getProtocolParameters: () => Promise<ProtocolParameters>
  readonly Effect: {
    readonly getProtocolParameters: () => Effect.Effect<ProtocolParameters, ProviderError>
  }
}

/**
 * Submit a signed transaction.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface SubmitTx {
  readonly submitTx: (tx: Transaction.Transaction) => Promise<TransactionHash.TransactionHash>
  readonly Effect: {
    readonly submitTx: (tx: Transaction.Transaction) => Effect.Effect<TransactionHash.TransactionHash, ProviderError>
  }
}

/**
 * Evaluate a transaction to determine script execution costs.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface EvaluateTx {
  readonly evaluateTx: (
    tx: Transaction.Transaction,
    additionalUTxOs?: Array<CoreUTxO.UTxO>
  ) => Promise<Array<EvalRedeemer>>
  readonly Effect: {
    readonly evaluateTx: (
      tx: Transaction.Transaction,
      additionalUTxOs?: Array<CoreUTxO.UTxO>
    ) => Effect.Effect<Array<EvalRedeemer>, ProviderError>
  }
}

/**
 * Query delegation info for a reward address.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface QueryDelegation {
  readonly getDelegation: (rewardAddress: RewardAddress.RewardAddress) => Promise<Delegation>
  readonly Effect: {
    readonly getDelegation: (rewardAddress: RewardAddress.RewardAddress) => Effect.Effect<Delegation, ProviderError>
  }
}

/**
 * Wait for a transaction to be confirmed on-chain.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface AwaitTx {
  readonly awaitTx: (
    txHash: TransactionHash.TransactionHash,
    checkInterval?: number,
    timeout?: number
  ) => Promise<boolean>
  readonly Effect: {
    readonly awaitTx: (
      txHash: TransactionHash.TransactionHash,
      checkInterval?: number,
      timeout?: number
    ) => Effect.Effect<boolean, ProviderError>
  }
}

/**
 * Query a datum by its hash.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface QueryDatumByHash {
  readonly getDatum: (datumHash: DatumHash.DatumHash) => Promise<PlutusData.Data>
  readonly Effect: {
    readonly getDatum: (datumHash: DatumHash.DatumHash) => Effect.Effect<PlutusData.Data, ProviderError>
  }
}

/**
 * Query a script by its hash.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface QueryScript {
  readonly getScript: (hash: ScriptHash.ScriptHash) => Promise<Script.Script>
  readonly Effect: {
    readonly getScript: (hash: ScriptHash.ScriptHash) => Effect.Effect<Script.Script, ProviderError>
  }
}

/**
 * Watch UTxOs at an address, emitting new UTxOs as they appear on-chain.
 *
 * Promise side returns an `AsyncIterable` — use `for await` to consume.
 * `break` triggers cleanup automatically.
 *
 * @since 2.2.0
 * @category capabilities
 */
export interface WatchUtxos {
  readonly watchUtxos: (
    addressOrCredential: CoreAddress.Address | Credential.Credential,
    pollInterval?: number
  ) => AsyncIterable<CoreUTxO.UTxO>
  readonly Effect: {
    readonly watchUtxos: (
      addressOrCredential: CoreAddress.Address | Credential.Credential,
      pollInterval?: number
    ) => Stream.Stream<CoreUTxO.UTxO, ProviderError>
  }
}

// ── Wallet Capabilities ───────────────────────────────────────────────────────

/**
 * Get the wallet's primary address.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface Addressable {
  readonly getAddress: () => Promise<CoreAddress.Address>
  readonly Effect: {
    readonly getAddress: () => Effect.Effect<CoreAddress.Address, WalletError>
  }
}

/**
 * Get the wallet's reward (stake) address.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface Stakeable {
  readonly getRewardAddress: () => Promise<RewardAddress.RewardAddress | null>
  readonly Effect: {
    readonly getRewardAddress: () => Effect.Effect<RewardAddress.RewardAddress | null, WalletError>
  }
}

/**
 * Sign a transaction.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface Signable {
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Promise<TransactionWitnessSet.TransactionWitnessSet>
  readonly Effect: {
    readonly signTx: (
      tx: Transaction.Transaction | string,
      context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
    ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  }
}

/**
 * Sign an arbitrary message with a wallet key.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface SignData {
  readonly signMessage: (
    address: CoreAddress.Address | RewardAddress.RewardAddress,
    payload: Payload
  ) => Promise<SignedMessage>
  readonly Effect: {
    readonly signMessage: (
      address: CoreAddress.Address | RewardAddress.RewardAddress,
      payload: Payload
    ) => Effect.Effect<SignedMessage, WalletError>
  }
}

/**
 * Query UTxOs from the wallet itself (CIP-30).
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface WalletUtxos {
  readonly getWalletUtxos: () => Promise<Array<CoreUTxO.UTxO>>
  readonly Effect: {
    readonly getWalletUtxos: () => Effect.Effect<Array<CoreUTxO.UTxO>, WalletError | ProviderError>
  }
}

/**
 * Get collateral UTxOs from the wallet (CIP-30).
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface CollateralSource {
  readonly getCollateral: () => Promise<Array<CoreUTxO.UTxO>>
  readonly Effect: {
    readonly getCollateral: () => Effect.Effect<Array<CoreUTxO.UTxO>, WalletError>
  }
}

/**
 * Submit a transaction through the wallet API (CIP-30).
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface WalletSubmit {
  readonly walletSubmitTx: (tx: Transaction.Transaction | string) => Promise<TransactionHash.TransactionHash>
  readonly Effect: {
    readonly walletSubmitTx: (
      tx: Transaction.Transaction | string
    ) => Effect.Effect<TransactionHash.TransactionHash, WalletError>
  }
}

/**
 * Derive addresses from an HD wallet at arbitrary roles and indices.
 *
 * @since 2.1.0
 * @category capabilities
 */
export interface Derivable {
  readonly deriveAddress: (role: number, index: number) => Promise<CoreAddress.Address>
  readonly Effect: {
    readonly deriveAddress: (role: number, index: number) => Effect.Effect<CoreAddress.Address, WalletError>
  }
}

// ── Aggregate types for convenience ───────────────────────────────────────────

/**
 * All capabilities provided by a full provider.
 *
 * @since 2.1.0
 * @category capabilities
 */
export type FullProviderCapabilities = QueryUtxos &
  QueryUtxosByOutRef &
  QueryUtxosWithUnit &
  QueryUtxoByUnit &
  QueryProtocolParams &
  QueryDelegation &
  SubmitTx &
  EvaluateTx &
  AwaitTx &
  QueryDatumByHash

// ── Per-provider capability types ─────────────────────────────────────────────
//
// Each provider gets its own named type so it can diverge independently.
// Today they all equal FullProviderCapabilities. When a provider gains or
// loses a capability, change that provider's type — no others are affected.

/**
 * Capabilities provided by the Blockfrost provider.
 *
 * @since 2.1.0
 * @category capabilities
 */
export type BlockfrostCapabilities = FullProviderCapabilities

/**
 * Capabilities provided by the Maestro provider.
 *
 * @since 2.1.0
 * @category capabilities
 */
export type MaestroCapabilities = FullProviderCapabilities

/**
 * Capabilities provided by the Koios provider.
 *
 * @since 2.1.0
 * @category capabilities
 */
export type KoiosCapabilities = FullProviderCapabilities

/**
 * Capabilities provided by the Kupmios (Kupo + Ogmios) provider.
 *
 * @since 2.1.0
 * @category capabilities
 */
export type KupmiosCapabilities = FullProviderCapabilities & WatchUtxos

/**
 * All capabilities provided by a signing wallet.
 *
 * @since 2.1.0
 * @category capabilities
 */
export type SigningWalletCapabilities = Addressable & Signable & SignData & Stakeable

/**
 * All capabilities provided by a CIP-30 browser wallet.
 *
 * @since 2.1.0
 * @category capabilities
 */
export type Cip30WalletCapabilities = Addressable & Signable & SignData & Stakeable & WalletSubmit
