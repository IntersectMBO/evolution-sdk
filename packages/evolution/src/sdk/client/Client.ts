// Client module: extracted from WalletNew during Phase 2
// Provides client effect interfaces and promise-based client interfaces

import { Data, type Effect, type Schedule } from "effect"

import type { TransactionBuilder } from "../builders/TransactionBuilder.js"
import type { TransactionResultBase } from "../builders/TransactionResult.js"
import type * as Delegation from "../Delegation.js"
import type * as Provider from "../provider/Provider.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as UTxO from "../UTxO.js"
// Type-only imports to avoid runtime circular dependency
import type { ApiWalletEffect, ReadOnlyWalletEffect, SigningWalletEffect, WalletApi, WalletError } from "../wallet/WalletNew.js"

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error class for Provider related operations.
 *
 * @since 2.0.0
 * @category errors
 */
export class ProviderError extends Data.TaggedError("ProviderError")<{
  message?: string
  cause?: unknown
}> {}

// ============================================================================
// Basic Client Effect Interfaces (extending from modules)
// ============================================================================

/**
 * MinimalClient Effect - just holds network context
 */
export interface MinimalClientEffect {
  readonly networkId: Effect.Effect<number | string, never>
}

/**
 * ReadOnlyClient Effect - Provider + ReadOnlyWallet + transaction builder
 */
export interface ReadOnlyClientEffect extends Provider.ProviderEffect, ReadOnlyWalletEffect {
  // Note: newTx is defined separately in ReadOnlyClient (not as Effect)
  // Wallet-scoped convenience methods that combine provider + wallet operations
  readonly getWalletUtxos: () => Effect.Effect<ReadonlyArray<UTxO.UTxO>, Provider.ProviderError>
  readonly getWalletDelegation: () => Effect.Effect<Delegation.Delegation, Provider.ProviderError>
}

/**
 * SigningClient Effect - Provider + SigningWallet + transaction builder
 */
export interface SigningClientEffect extends Provider.ProviderEffect, SigningWalletEffect {
  // Note: newTx is defined separately in SigningClient (not as Effect)
  // Wallet-scoped convenience methods that combine provider + wallet operations
  readonly getWalletUtxos: () => Effect.Effect<ReadonlyArray<UTxO.UTxO>, WalletError | Provider.ProviderError>
  readonly getWalletDelegation: () => Effect.Effect<Delegation.Delegation, WalletError | Provider.ProviderError>
}



// ============================================================================
// Promise-based Client Interfaces (using EffectToPromiseAPI)
// ============================================================================

/**
 * MinimalClient - starting point, just knows network
 */
export interface MinimalClient {
  readonly networkId: number | string
  // Combinator methods (pure, no side effects) with type-aware conditional return types
  readonly attachProvider: (config: ProviderConfig) => ProviderOnlyClient
  readonly attachWallet: <T extends WalletConfig>(
    config: T
  ) => T extends SeedWalletConfig
    ? SigningWalletClient
    : T extends PrivateKeyWalletConfig
      ? SigningWalletClient
      : T extends ApiWalletConfig
        ? ApiWalletClient
        : ReadOnlyWalletClient
  readonly attach: <TW extends WalletConfig>(
    providerConfig: ProviderConfig,
    walletConfig: TW
  ) => TW extends SeedWalletConfig
    ? SigningClient
    : TW extends PrivateKeyWalletConfig
      ? SigningClient
      : TW extends ApiWalletConfig
        ? SigningClient
        : ReadOnlyClient
  // Effect namespace for methods with side effects only
  readonly Effect: MinimalClientEffect
}

/**
 * ProviderOnlyClient - can query blockchain and submit transactions
 */
export type ProviderOnlyClient = EffectToPromiseAPI<Provider.ProviderEffect> & {
  // Combinator methods (pure, no side effects) with type-aware conditional return type
  readonly attachWallet: <T extends WalletConfig>(
    config: T
  ) => T extends SeedWalletConfig
    ? SigningClient
    : T extends PrivateKeyWalletConfig
      ? SigningClient
      : T extends ApiWalletConfig
        ? SigningClient
        : ReadOnlyClient
  // Effect namespace - includes all provider methods as Effects
  readonly Effect: Provider.ProviderEffect
}

/**
 * ReadOnlyClient - can query blockchain + wallet address operations
 * 
 * ReadOnlyClient cannot sign transactions, so newTx() returns a TransactionBuilder
 * that yields TransactionResultBase (unsigned transaction only).
 */
export type ReadOnlyClient = EffectToPromiseAPI<ReadOnlyClientEffect> & {
  /**
   * Create a new transaction builder for read-only operations.
   *
   * Returns a TransactionBuilder that builds unsigned transactions.
   * The build() methods return TransactionResultBase which provides:
   * - `.toTransaction()` - Get the unsigned transaction
   * - `.toTransactionWithFakeWitnesses()` - Get transaction with fake witnesses for fee validation
   * - `.estimateFee()` - Get the calculated fee
   *
   * @param utxos - Optional UTxOs to use for coin selection. If not provided, wallet UTxOs will be fetched automatically when build() is called.
   * @returns A new TransactionBuilder instance configured with cached protocol parameters and wallet change address.
   *
   * @example
   * ```typescript
   * // Build unsigned transaction
   * const result = await readOnlyClient.newTx()
   *   .payToAddress({ address: "addr...", lovelace: 5000000n })
   *   .build()
   *
   * // Get unsigned transaction for external signing
   * const unsignedTx = await result.toTransaction()
   * const txCbor = Transaction.toCBORHex(unsignedTx)
   * 
   * // Get fee estimate
   * const fee = await result.estimateFee()
   * ```
   *
   * @since 2.0.0
   * @category transaction-building
   */
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => TransactionBuilder<TransactionResultBase>
  // Effect namespace - includes all provider + wallet methods as Effects
  readonly Effect: ReadOnlyClientEffect
}

/**
 * SigningClient - full functionality: query blockchain + sign + submit
 * 
 * SigningClient has wallet signing capability, so newTx() returns a TransactionBuilder
 * that yields SignBuilder (can sign and submit transactions).
 */
export type SigningClient = EffectToPromiseAPI<SigningClientEffect> & {
  /**
   * Create a new transaction builder with signing capability.
   *
   * Returns a TransactionBuilder that can build and sign transactions.
   * The build() methods return SignBuilder which provides:
   * - `.sign()` - Sign and prepare for submission
   * - `.toTransaction()` - Get the unsigned transaction  
   * - `.toTransactionWithFakeWitnesses()` - Get transaction with fake witnesses for fee validation
   * - `.estimateFee()` - Get the calculated fee
   * - `.partialSign()` - Create partial signature for multi-sig
   * - `.assemble()` - Combine multiple signatures
   *
   * UTxOs for coin selection are fetched automatically from the wallet when build() is called.
   * You can override UTxOs per-build using BuildOptions.availableUtxos.
   *
   * @returns A new TransactionBuilder instance configured with cached protocol parameters and wallet change address.
   *
   * @example
   * ```typescript
   * // Build and sign transaction
   * const signBuilder = await signingClient.newTx()
   *   .payToAddress({ address: "addr...", lovelace: 5000000n })
   *   .build()
   *
   * // Sign and submit
   * const submitBuilder = await signBuilder.sign()
   * const txHash = await submitBuilder.submit()
   * 
   * // Or get unsigned transaction
   * const unsignedTx = await signBuilder.toTransaction()
   * ```
   *
   * @since 2.0.0
   * @category transaction-building
   */
  readonly newTx: () => TransactionBuilder
  // Effect namespace - includes all provider + wallet methods as Effects
  readonly Effect: SigningClientEffect
}

/**
 * ApiWalletClient - can sign and submit via CIP-30, no blockchain queries without provider
 */
export type ApiWalletClient = EffectToPromiseAPI<ApiWalletEffect> & {
  // No newTx method - cannot build transactions without provider for protocol parameters
  // Combinator methods (pure, no side effects)
  readonly attachProvider: (config: ProviderConfig) => SigningClient
  // Effect namespace - includes all wallet methods as Effects
  readonly Effect: ApiWalletEffect
}

/**
 * SigningWalletClient - can sign only, no blockchain access
 */
export type SigningWalletClient = EffectToPromiseAPI<SigningWalletEffect> & {
  readonly networkId: number | string
  // Combinator methods (pure, no side effects)
  readonly attachProvider: (config: ProviderConfig) => SigningClient
  // Effect namespace - includes all wallet methods as Effects
  readonly Effect: SigningWalletEffect
}

/**
 * ReadOnlyWalletClient - address access only, no signing or blockchain access
 */
export type ReadOnlyWalletClient = EffectToPromiseAPI<ReadOnlyWalletEffect> & {
  readonly networkId: number | string
  // Combinator methods (pure, no side effects)
  readonly attachProvider: (config: ProviderConfig) => ReadOnlyClient
  // Effect namespace - includes all wallet methods as Effects
  readonly Effect: ReadOnlyWalletEffect
}

// ============================================================================
// Configuration Types
// ============================================================================

export type NetworkId = "mainnet" | "preprod" | "preview" | number

// ============================================================================
// Retry Policy Configuration
// ============================================================================

/**
 * Preset retry configuration with simple parameters
 */
export interface RetryConfig {
  readonly maxRetries: number
  readonly retryDelayMs: number
  readonly backoffMultiplier: number
  readonly maxRetryDelayMs: number
}

/**
 * Common preset retry configurations
 */
export const RetryPresets = {
  /** No retries - fail immediately */
  none: { maxRetries: 0, retryDelayMs: 0, backoffMultiplier: 1, maxRetryDelayMs: 0 } as const,
  /** Fast retry - good for temporary network issues */
  fast: { maxRetries: 3, retryDelayMs: 500, backoffMultiplier: 1.5, maxRetryDelayMs: 5000 } as const,
  /** Standard retry - balanced approach */
  standard: { maxRetries: 3, retryDelayMs: 1000, backoffMultiplier: 2, maxRetryDelayMs: 10000 } as const,
  /** Aggressive retry - for critical operations */
  aggressive: { maxRetries: 5, retryDelayMs: 1000, backoffMultiplier: 2, maxRetryDelayMs: 30000 } as const
} as const

/**
 * Retry policy can be either a preset config or a custom Effect Schedule
 */
export type RetryPolicy = RetryConfig | Schedule.Schedule<any, any> | { preset: keyof typeof RetryPresets }

// Provider Configs
export interface BlockfrostConfig {
  readonly type: "blockfrost"
  readonly baseUrl: string
  readonly projectId?: string
  readonly retryPolicy?: RetryPolicy
}

export interface KupmiosConfig {
  readonly type: "kupmios"
  readonly kupoUrl: string
  readonly ogmiosUrl: string
  readonly headers?: {
    readonly ogmiosHeader?: Record<string, string>
    readonly kupoHeader?: Record<string, string>
  }
  readonly retryPolicy?: RetryPolicy
}

export interface MaestroConfig {
  readonly type: "maestro"
  readonly baseUrl: string
  readonly apiKey: string
  readonly turboSubmit?: boolean
  readonly retryPolicy?: RetryPolicy
}

export interface KoiosConfig {
  readonly type: "koios"
  readonly baseUrl: string
  readonly token?: string
  readonly retryPolicy?: RetryPolicy
}

export type ProviderConfig = BlockfrostConfig | KupmiosConfig | MaestroConfig | KoiosConfig

// Wallet Configs
export interface SeedWalletConfig {
  readonly type: "seed"
  readonly mnemonic: string
  readonly accountIndex?: number
  readonly paymentIndex?: number
  readonly stakeIndex?: number
  readonly addressType?: "Base" | "Enterprise"
  readonly password?: string
}

export interface PrivateKeyWalletConfig {
  readonly type: "private-key"
  readonly paymentKey: string // bech32 ed25519e_sk
  readonly stakeKey?: string // bech32 ed25519e_sk (optional, for Base addresses)
  readonly addressType?: "Base" | "Enterprise"
}

export interface ReadOnlyWalletConfig {
  readonly type: "read-only"
  readonly address: string
  readonly rewardAddress?: string
}

export interface ApiWalletConfig {
  readonly type: "api"
  readonly api: WalletApi // CIP-30 wallet API interface
}

export type WalletConfig = SeedWalletConfig | PrivateKeyWalletConfig | ReadOnlyWalletConfig | ApiWalletConfig

