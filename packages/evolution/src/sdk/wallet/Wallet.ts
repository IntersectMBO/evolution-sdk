import { Data, type Effect } from "effect"

import type * as CoreAddress from "../../Address.js"
import type * as RewardAddress from "../../RewardAddress.js"
import type * as Transaction from "../../Transaction.js"
import type * as TransactionHash from "../../TransactionHash.js"
import type * as TransactionWitnessSet from "../../TransactionWitnessSet.js"
import type * as CoreUTxO from "../../UTxO.js"
import type { EffectToPromiseAPI } from "../Type.js"

/**
 * Error class for wallet-related operations.
 * Represents failures during wallet address retrieval, transaction signing, or message signing.
 *
 * @since 2.0.0
 * @category errors
 */
export class WalletError extends Data.TaggedError("WalletError")<{
  message?: string
  cause?: unknown
}> {}

/**
 * Payload for message signing - either a string or raw bytes.
 *
 * @since 2.0.0
 * @category model
 */
export type Payload = string | Uint8Array

/**
 * Signed message containing the original payload and its cryptographic signature.
 *
 * @since 2.0.0
 * @category model
 */
export interface SignedMessage {
  readonly payload: Payload
  readonly signature: string
}

/**
 * Network identifier for wallet operations.
 * Mainnet for production, Testnet for testing, or Custom for other networks.
 *
 * @since 2.0.0
 * @category model
 */
export type Network = "Mainnet" | "Testnet" | "Custom"

/**
 * Read-only wallet Effect interface providing access to wallet data without signing capabilities.
 * Suitable for read-only applications that need wallet address information.
 *
 * @since 2.0.0
 * @category model
 */
export interface ReadOnlyWalletEffect {
  readonly address: () => Effect.Effect<CoreAddress.Address, WalletError>
  readonly rewardAddress: () => Effect.Effect<RewardAddress.RewardAddress | null, WalletError>
}

/**
 * Read-only wallet interface providing access to wallet data without signing capabilities.
 * Wraps ReadOnlyWalletEffect with promise-based API for browser and non-Effect contexts.
 *
 * @since 2.0.0
 * @category model
 */
export interface ReadOnlyWallet extends EffectToPromiseAPI<ReadOnlyWalletEffect> {
  readonly effect: ReadOnlyWalletEffect
  readonly type: "read-only"
}

/**
 * Signing wallet Effect interface extending read-only wallet with transaction and message signing.
 * Sign transaction and message operations require wallet authorization.
 *
 * @since 2.0.0
 * @category model
 */
export interface SigningWalletEffect extends ReadOnlyWalletEffect {
  /**
   * Sign a transaction given its structured representation. UTxOs required for correctness
   * (e.g. to determine required signers) must be supplied by the caller (client) and not
   * fetched internally. Reference UTxOs are used to extract required signers from native scripts
   * that are used via reference inputs.
   */
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  /**
   * Sign multiple transactions in batch (CIP-103).
   * Falls back to sequential signTx if the wallet doesn't support batch signing.
   *
   * @since 2.2.0
   */
  readonly signTxs: (
    txs: ReadonlyArray<Transaction.Transaction | string>,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>, WalletError>
  readonly signMessage: (
    address: CoreAddress.Address | RewardAddress.RewardAddress,
    payload: Payload
  ) => Effect.Effect<SignedMessage, WalletError>
}

/**
 * Signing wallet interface with full wallet functionality including transaction signing.
 * Wraps SigningWalletEffect with promise-based API for browser and non-Effect contexts.
 *
 * @since 2.0.0
 * @category model
 */
export interface SigningWallet extends EffectToPromiseAPI<Omit<SigningWalletEffect, "signTxs">> {
  readonly signTxs: (
    txs: ReadonlyArray<Transaction.Transaction | string>,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Promise<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>>
  readonly effect: SigningWalletEffect
  readonly type: "signing"
}

/**
 * CIP-30 compatible wallet API interface representing browser wallet extension methods.
 * Used by browser-based wallet applications to interact with native wallet extensions.
 *
 * @since 2.0.0
 * @category model
 */
/**
 * CIP-103 transaction signature request for batch signing.
 *
 * @since 2.2.0
 * @category model
 */
export interface TransactionSignatureRequest {
  readonly cbor: string
  readonly partialSign: boolean
}

export interface WalletApi {
  getUsedAddresses(): Promise<ReadonlyArray<string>>
  getUnusedAddresses(): Promise<ReadonlyArray<string>>
  getRewardAddresses(): Promise<ReadonlyArray<string>>
  getUtxos(): Promise<ReadonlyArray<string>>
  signTx(txCborHex: string, partialSign: boolean): Promise<string>
  signData(addressHex: string, payload: Payload): Promise<SignedMessage>
  submitTx(txCborHex: string): Promise<string>
  /** CIP-103 standard namespace */
  cip103?: {
    signTxs(requests: ReadonlyArray<TransactionSignatureRequest>): Promise<ReadonlyArray<string>>
  }
  /** Experimental namespace (e.g. Eternl) */
  experimental?: {
    signTxs?(requests: ReadonlyArray<TransactionSignatureRequest>): Promise<ReadonlyArray<string>>
  }
  /** Direct signTxs (some wallets) */
  signTxs?(requests: ReadonlyArray<TransactionSignatureRequest>): Promise<ReadonlyArray<string>>
}

/**
 * API Wallet Effect interface for CIP-30 compatible wallets.
 * Extends signing capabilities with direct transaction submission through wallet API.
 * API wallets handle both signing and submission through the wallet extension.
 *
 * @since 2.0.0
 * @category model
 */
export interface ApiWalletEffect extends ReadOnlyWalletEffect {
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  /**
   * Sign multiple transactions in batch (CIP-103).
   * Falls back to sequential signTx if the wallet doesn't support batch signing.
   *
   * @since 2.2.0
   */
  readonly signTxs: (
    txs: ReadonlyArray<Transaction.Transaction | string>,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>, WalletError>
  readonly signMessage: (
    address: CoreAddress.Address | RewardAddress.RewardAddress,
    payload: Payload
  ) => Effect.Effect<SignedMessage, WalletError>
  /**
   * Submit transaction directly through the wallet API.
   * API wallets can submit without requiring a separate provider.
   */
  readonly submitTx: (
    tx: Transaction.Transaction | string
  ) => Effect.Effect<TransactionHash.TransactionHash, WalletError>
}

/**
 * API Wallet interface for CIP-30 compatible wallets.
 * These wallets handle signing and submission internally through the browser extension.
 * Wraps ApiWalletEffect with promise-based API for browser contexts.
 *
 * @since 2.0.0
 * @category model
 */
export interface ApiWallet extends EffectToPromiseAPI<Omit<ApiWalletEffect, "signTxs">> {
  readonly signTxs: (
    txs: ReadonlyArray<Transaction.Transaction | string>,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Promise<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>>
  readonly effect: ApiWalletEffect
  readonly api: WalletApi
  readonly type: "api"
}