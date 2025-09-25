// Client module: extracted from WalletNew during Phase 2
// Provides client effect interfaces and promise-based client interfaces

import { Data, type Effect, type Schedule } from "effect"

import type { ReadOnlyTransactionBuilder, ReadOnlyTransactionBuilderEffect } from "../builders/index.js"
import type * as Delegation from "../Delegation.js"
import type * as Provider from "../provider/Provider.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as UTxO from "../UTxO.js"
// Type-only imports to avoid runtime circular dependency
import type { ApiWalletEffect, ReadOnlyWalletEffect, SigningWalletEffect, WalletApi } from "../wallet/WalletNew.js"

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
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilderEffect
  // Wallet-scoped convenience methods that combine provider + wallet operations
  readonly getWalletUtxos: () => Effect.Effect<ReadonlyArray<UTxO.UTxO>, ProviderError>
  readonly getWalletDelegation: () => Effect.Effect<Delegation.Delegation, ProviderError>
}

/**
 * SigningClient Effect - Provider + SigningWallet + transaction builder
 */
export interface SigningClientEffect extends Provider.ProviderEffect, SigningWalletEffect {
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilderEffect
  // Wallet-scoped convenience methods that combine provider + wallet operations
  readonly getWalletUtxos: () => Effect.Effect<ReadonlyArray<UTxO.UTxO>, ProviderError>
  readonly getWalletDelegation: () => Effect.Effect<Delegation.Delegation, ProviderError>
}



// ============================================================================
// Promise-based Client Interfaces (using EffectToPromiseAPI)
// ============================================================================

/**
 * MinimalClient - starting point, just knows network
 */
export interface MinimalClient {
  readonly networkId: number | string
  // Combinator methods (pure, no side effects) with type-aware overloads
  readonly attachProvider: (config: ProviderConfig) => ProviderOnlyClient
  readonly attachWallet: {
    (config: SeedWalletConfig): SigningWalletClient
    (config: ReadOnlyWalletConfig): ReadOnlyWalletClient
    (config: ApiWalletConfig): ApiWalletClient
  }
  readonly attach: {
    (providerConfig: ProviderConfig, walletConfig: SeedWalletConfig): SigningClient
    (providerConfig: ProviderConfig, walletConfig: ReadOnlyWalletConfig): ReadOnlyClient
    (providerConfig: ProviderConfig, walletConfig: ApiWalletConfig): SigningClient
  }
  // Effect namespace for methods with side effects only
  readonly Effect: MinimalClientEffect
}

/**
 * ProviderOnlyClient - can query blockchain and submit transactions
 */
export type ProviderOnlyClient = EffectToPromiseAPI<Provider.ProviderEffect> & {
  // Combinator methods (pure, no side effects) with type-aware overloads
  readonly attachWallet: {
    (config: SeedWalletConfig): SigningClient
    (config: ReadOnlyWalletConfig): ReadOnlyClient
    (config: ApiWalletConfig): SigningClient
  }
  // Effect namespace - includes all provider methods as Effects
  readonly Effect: Provider.ProviderEffect
}

/**
 * ReadOnlyClient - can query blockchain + wallet address operations
 */
export type ReadOnlyClient = EffectToPromiseAPI<ReadOnlyClientEffect> & {
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilder
  // Effect namespace - includes all provider + wallet methods as Effects
  readonly Effect: ReadOnlyClientEffect
}

/**
 * SigningClient - full functionality: query blockchain + sign + submit
 */
export type SigningClient = EffectToPromiseAPI<SigningClientEffect> & {
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilder
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

export type WalletConfig = SeedWalletConfig | ReadOnlyWalletConfig | ApiWalletConfig

// ============================================================================
// Factory Functions
// ============================================================================

export declare function createClient(): MinimalClient
export declare function createClient(config: { network: NetworkId }): MinimalClient
export declare function createClient(config: { network: NetworkId; provider: ProviderConfig }): ProviderOnlyClient
export declare function createClient(config: { network: NetworkId; wallet: SeedWalletConfig }): SigningWalletClient
export declare function createClient(config: { network: NetworkId; wallet: ReadOnlyWalletConfig }): ReadOnlyWalletClient
export declare function createClient(config: { network: NetworkId; wallet: ApiWalletConfig }): ApiWalletClient
export declare function createClient(config: {
  network: NetworkId
  provider: ProviderConfig
  wallet: SeedWalletConfig
}): SigningClient
export declare function createClient(config: {
  network: NetworkId
  provider: ProviderConfig
  wallet: ReadOnlyWalletConfig
}): ReadOnlyClient
export declare function createClient(config: {
  network: NetworkId
  provider: ProviderConfig
  wallet: ApiWalletConfig
}): SigningClient
