// Effect-TS imports
import { Data, type Effect } from "effect"

import type * as Transaction from "../../core/Transaction.js"
import type * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import type * as Address from "../Address.js"
// Removed Delegation / Provider dependency for single-responsibility wallet
// import type * as Delegation from "../Delegation.js"
// import type { Provider } from "../provider/Provider.js"
import type * as RewardAddress from "../RewardAddress.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as UTxO from "../UTxO.js"
// Imported public interfaces from builders & client modules
// (Client factory declarations moved out; client types no longer needed directly here)

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error class for WalletNew related operations.
 *
 * @since 2.0.0
 * @category errors
 */
export class WalletError extends Data.TaggedError("WalletError")<{
  message?: string
  cause?: unknown
}> {}

/**
 * Error class for Provider related operations.
 *
 * @since 2.0.0
 * @category errors
 */
// External errors (ProviderError, TransactionBuilderError, CoinSelectionError) are defined in their modules

export type Payload = string | Uint8Array
export interface SignedMessage {
  readonly payload: Payload
  readonly signature: string
}

/**
 * Read-only wallet interface providing access to wallet data without signing capabilities.
 * Suitable for read-only applications that need wallet information.
 *
 * @since 2.0.0
 * @category interfaces
 */
export interface ReadOnlyWalletEffect {
  readonly address: Effect.Effect<Address.Address, WalletError>
  readonly rewardAddress: Effect.Effect<RewardAddress.RewardAddress | null, WalletError>
}

export interface ReadOnlyWallet extends EffectToPromiseAPI<ReadOnlyWalletEffect> {
  readonly Effect: ReadOnlyWalletEffect
  readonly type: "read-only" // Read-only wallet
}

/**
 * Full wallet interface with signing capabilities extending ReadOnlyWallet.
 * Provides complete wallet functionality including transaction signing and submission.
 *
 * @since 2.0.0
 * @category interfaces
 */
export interface SigningWalletEffect extends ReadOnlyWalletEffect {
  /**
   * Sign a transaction given its structured representation. UTxOs required for correctness
   * (e.g. to determine required signers) must be supplied by the caller (client) and not
   * fetched internally.
   */
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<UTxO.UTxO> }
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  readonly signMessage: (
    address: Address.Address | RewardAddress.RewardAddress,
    payload: Payload
  ) => Effect.Effect<SignedMessage, WalletError>
}

export interface SigningWallet extends EffectToPromiseAPI<SigningWalletEffect> {
  readonly Effect: SigningWalletEffect
  readonly type: "signing" // Local signing wallet (seed/private key)
}

// ============================================================================
// API Wallet Types (CIP-30 Compatible)
// ============================================================================

/**
 * API Wallet Effect interface for CIP-30 compatible wallets.
 * API wallets handle both signing and submission through the wallet extension,
 * eliminating the need for a separate provider in browser environments.
 *
 * @since 2.0.0
 * @category interfaces
 */
export interface ApiWalletEffect extends ReadOnlyWalletEffect {
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<UTxO.UTxO> }
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  readonly signMessage: (
    address: Address.Address | RewardAddress.RewardAddress,
    payload: Payload
  ) => Effect.Effect<SignedMessage, WalletError>
  /**
   * Submit transaction directly through the wallet API.
   * API wallets can submit without requiring a separate provider.
   */
  readonly submitTx: (tx: Transaction.Transaction | string) => Effect.Effect<string, WalletError>
}

/**
 * API Wallet interface for CIP-30 compatible wallets.
 * These wallets handle signing and submission internally through the browser extension.
 *
 * @since 2.0.0
 * @category interfaces
 */
export interface ApiWallet extends EffectToPromiseAPI<ApiWalletEffect> {
  readonly Effect: ApiWalletEffect
  readonly api: WalletApi
  readonly type: "api" // CIP-30 API wallet
}

// Transaction builder interfaces moved to sdk/builders module (Phase 1)
// (duplicate builder imports removed)

// Builder & operation related types removed (sourced from builders module)

// Build Options - Comprehensive configuration for transaction building
// BuildOptions and TransactionEstimate moved to builders/TransactionBuilder (Phase 1)

// TransactionBuilderEffect moved to builders/TransactionBuilder (Phase 1)

// Progressive Builder Interfaces
// SignBuilder / SubmitBuilder moved to builders/SignBuilder (Phase 1)
// Client effect interfaces moved to sdk/client (Phase 2)
// (client effect interfaces imported from dedicated module, not needed here directly)

// ============================================================================
// Client Interfaces
// ============================================================================

/**
 * Read-only client interface providing blockchain data access and read-only wallet operations.
 *
 * @since 2.0.0
 * @category clients
 */
// Client promise-based interfaces moved to sdk/client (Phase 2)
// (client promise interfaces already imported at top)

// ============================================================================
// Factory Function Types (to be implemented)
// ============================================================================

/**
 * Network type for wallet creation.
 *
 * @since 2.0.0
 * @category types
 */
export type Network = "Mainnet" | "Testnet" | "Custom"

/**
 * CIP-30 compatible wallet API interface.
 *
 * @since 2.0.0
 * @category interfaces
 */
export interface WalletApi {
  getUsedAddresses(): Promise<ReadonlyArray<string>>
  getUnusedAddresses(): Promise<ReadonlyArray<string>>
  getRewardAddresses(): Promise<ReadonlyArray<string>>
  getUtxos(): Promise<ReadonlyArray<string>> // CBOR hex
  signTx(txCborHex: string, partialSign: boolean): Promise<string> // CBOR hex witness set
  signData(addressHex: string, payload: Payload): Promise<SignedMessage>
  submitTx(txCborHex: string): Promise<string>
}

// Factory function signatures (implementations would be added in future)
export declare function makeWalletFromSeed(
  network: Network,
  seed: string,
  options?: {
    addressType?: "Base" | "Enterprise"
    accountIndex?: number
    password?: string
  }
): SigningWallet

export declare function makeWalletFromPrivateKey(
  network: Network,
  privateKeyBech32: string
): SigningWallet

export declare function makeWalletFromAPI(api: WalletApi): ApiWallet

export declare function makeWalletFromAddress(
  network: Network,
  address: Address.Address,
): ReadOnlyWallet
// NOTE: Client factory declarations were moved to sdk/client/Client.ts.
// If you were importing them from the wallet module previously, update your imports to:
//   import { makeClient, makeReadOnlyClient, makeProviderOnlyClient, makeMinimalClient } from "../client/Client.js"
// (Left intentionally absent here to keep wallet surface focused.)
