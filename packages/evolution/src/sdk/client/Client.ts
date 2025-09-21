// Client module: extracted from WalletNew during Phase 2
// Provides client effect interfaces and promise-based client interfaces

import { Data, type Effect } from "effect"

import type * as Transaction from "../../core/Transaction.js"
import type * as Address from "../Address.js"
import type { ReadOnlyTransactionBuilder, ReadOnlyTransactionBuilderEffect } from "../builders/index.js"
import type * as Delegation from "../Delegation.js"
// (Provider effect already exposes delegation, datum, etc. so we intentionally avoid re-declaring here)
import type * as Provider from "../provider/Provider.js"
import type * as RewardAddress from "../RewardAddress.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as UTxO from "../UTxO.js"
// Type-only imports to avoid runtime circular dependency
import type { ApiWallet,ReadOnlyWallet, SigningWallet, SigningWalletEffect, WalletApi } from "../wallet/WalletNew.js"

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

/**
 * Error class for multi-provider failover operations.
 *
 * @since 2.0.0 
 * @category errors
 */
export class MultiProviderError extends Data.TaggedError("MultiProviderError")<{
  message?: string
  cause?: unknown
  failedProviders?: ReadonlyArray<{
    provider: string
    error: unknown
  }>
  allProvidersFailed?: boolean
}> {}

// ============================================================================
// Provider Health Types
// ============================================================================

export interface ProviderHealthStatus {
  readonly healthy: boolean
  readonly latency: number
  readonly lastCheck: Date
  readonly consecutiveFailures: number
  readonly lastError?: unknown
}

export interface MultiProviderState {
  readonly currentProvider: number
  readonly providers: ReadonlyArray<{
    config: KupmiosProviderConfig | BlockfrostProviderConfig
    health: ProviderHealthStatus
  }>
  readonly failoverStrategy: "round-robin" | "priority" | "random"
}

// ============================================================================
// Shared Types
// ============================================================================

export type Payload = string | Uint8Array

export interface SignedMessage {
  readonly payload: Payload
  readonly signature: string
}

// ============================================================================
// Effect-based Client Interfaces
// ============================================================================

// ReadOnly client effect surface = full provider effect + newTx builder entry point
export interface ReadOnlyClientEffect extends Provider.ProviderEffect {
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilderEffect
  // Wallet-scoped convenience (derive address/rewardAddress from attached wallet)
  readonly getWalletUtxos: () => Effect.Effect<ReadonlyArray<UTxO.UTxO>, ProviderError>
  readonly getWalletDelegation: () => Effect.Effect<Delegation.Delegation, ProviderError>
}

// ============================================================================
// Refactored ProviderOnlyClientEffect (provider-only client can submitTx)
// ============================================================================
// Effect surface excludes structural composition helpers.
export interface ProviderOnlyClientEffect extends Provider.ProviderEffect {}

// Full client effect surface = read-only client + wallet signing capabilities (provider already covers submitTx)
export interface ClientEffect extends ReadOnlyClientEffect, SigningWalletEffect {}

export interface MinimalClientEffect {}

// ============================================================================
// Wallet-Only Client (for API wallets without provider)
// ============================================================================

export interface WalletAPIClientEffect extends SigningWalletEffect {
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilderEffect
}

// ============================================================================
// Promise-based Client Interfaces
// ============================================================================

export type ReadOnlyClient = EffectToPromiseAPI<ReadOnlyClientEffect> & {
  // Wallet-facing convenience (addresses) surfaced directly
  readonly address: () => Promise<Address.Address>
  readonly rewardAddress: () => Promise<RewardAddress.RewardAddress | null>
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilder
  readonly getWalletUtxos: () => Promise<ReadonlyArray<UTxO.UTxO>>
  readonly getWalletDelegation: () => Promise<Delegation.Delegation>
  readonly provider: Provider.Provider
  readonly wallet: ReadOnlyWallet
  readonly Effect: ReadOnlyClientEffect
}

export type SigningClient = EffectToPromiseAPI<ClientEffect> & {
  readonly address: () => Promise<Address.Address>
  readonly rewardAddress: () => Promise<RewardAddress.RewardAddress | null>
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilder
  readonly getWalletUtxos: () => Promise<ReadonlyArray<UTxO.UTxO>>
  readonly getWalletDelegation: () => Promise<Delegation.Delegation>
  readonly provider: Provider.Provider
  readonly wallet: SigningWallet
  readonly Effect: ClientEffect
}

export type Client = SigningClient

export type WalletAPIClient = EffectToPromiseAPI<WalletAPIClientEffect> & {
  readonly address: () => Promise<Address.Address>
  readonly rewardAddress: () => Promise<RewardAddress.RewardAddress | null>
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilder
  readonly submitTx: (tx: Transaction.Transaction | string) => Promise<string>
  readonly wallet: ApiWallet
  readonly attachProvider: {
    (provider: Provider.Provider): SigningClient
    (config: ProviderConfig): SigningClient
  }
  readonly Effect: WalletAPIClientEffect
}

export type ProviderOnlyClient = EffectToPromiseAPI<ProviderOnlyClientEffect> & {
  readonly attachWallet: {
    (wallet: SigningWallet): SigningClient
    (wallet: ReadOnlyWallet): ReadOnlyClient
    (config: SeedWalletConfig): SigningClient
    (config: ReadOnlyWalletConfig): ReadOnlyClient
    (config: ApiWalletConfig): SigningClient
    (api: WalletApi): SigningClient
  }
  readonly Effect: ProviderOnlyClientEffect
  readonly provider: Provider.Provider
  readonly isMultiProvider: boolean
  readonly getActiveProvider?: () => Provider.Provider
  readonly getProviderHealth?: () => Promise<ReadonlyArray<{
    provider: Provider.Provider
    healthy: boolean
    latency: number
    lastCheck: Date
  }>>
}

export interface MinimalClient {
  readonly networkId: number | string // Simplified network reference
  readonly attachProvider: {
    (provider: Provider.Provider): ProviderOnlyClient
    (config: ProviderConfig): ProviderOnlyClient
  }
  readonly attachMultiProvider: {
    (config: MultiProviderConfig): ProviderOnlyClient
  }
  readonly attach: {
    (provider: Provider.Provider, wallet: SigningWallet): SigningClient
    (provider: Provider.Provider, wallet: ReadOnlyWallet): ReadOnlyClient
    (provider: Provider.Provider, wallet: SeedWalletConfig): SigningClient
    (provider: Provider.Provider, wallet: ReadOnlyWalletConfig): ReadOnlyClient
    (provider: Provider.Provider, wallet: ApiWalletConfig): SigningClient
    (config: ProviderConfig, wallet: SigningWallet): SigningClient
    (config: ProviderConfig, wallet: ReadOnlyWallet): ReadOnlyClient
    (config: ProviderConfig, wallet: SeedWalletConfig): SigningClient
    (config: ProviderConfig, wallet: ReadOnlyWalletConfig): ReadOnlyClient
    (config: ProviderConfig, wallet: ApiWalletConfig): SigningClient
    // API wallet can work without a separate provider (uses CIP-30 submitTx)
    (wallet: ApiWalletConfig): WalletAPIClient
    (api: WalletApi): WalletAPIClient
  }
  readonly Effect: MinimalClientEffect
}

// ============================================================================
// Unified createClient Config Types (Approved Interface Shape)
// ============================================================================

export type NetworkId = "mainnet" | "preprod" | "preview" | number

// Provider Configs
export interface KupmiosProviderConfig {
  readonly type: "kupmios"
  readonly apiKey: string
  readonly ogmiosUrl?: string
  readonly kupoUrl?: string
  readonly priority?: number
}

export interface BlockfrostProviderConfig {
  readonly type: "blockfrost"
  readonly apiKey: string
  readonly url?: string
  readonly priority?: number
}

export interface MultiProviderConfig {
  readonly type: "multi"
  readonly providers: ReadonlyArray<KupmiosProviderConfig | BlockfrostProviderConfig>
  readonly failoverStrategy?: "round-robin" | "priority" | "random"
  readonly healthCheck?: {
    readonly enabled?: boolean
    readonly intervalMs?: number
    readonly timeoutMs?: number
  }
  readonly retryConfig?: {
    readonly maxRetries?: number
    readonly retryDelayMs?: number
    readonly backoffMultiplier?: number
  }
}

export type ProviderConfig = KupmiosProviderConfig | BlockfrostProviderConfig | MultiProviderConfig

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
  // API wallets handle submission internally - no provider needed for transactions
  // Optional provider only for enhanced blockchain queries if needed
  readonly provider?: ProviderConfig
}

export type WalletConfig = SeedWalletConfig | ReadOnlyWalletConfig | ApiWalletConfig

export type CreateClientConfig =
  | { network: NetworkId }
  | { network: NetworkId; provider: ProviderConfig }
  | { network: NetworkId; provider: ProviderConfig; wallet: WalletConfig }

// ============================================================================
// createClient Overloads (Stubs)
// ============================================================================

// ============================================================================
// Factory Declarations (implementation provided in build output or later phase)
// ============================================================================
export declare function createClient(): MinimalClient
export declare function createClient(config: { network: NetworkId }): MinimalClient
export declare function createClient(config: { network: NetworkId; provider: ProviderConfig }): ProviderOnlyClient
export declare function createClient(config: { network: NetworkId; provider: ProviderConfig; wallet: SeedWalletConfig }): SigningClient
export declare function createClient(config: { network: NetworkId; provider: ProviderConfig; wallet: ReadOnlyWalletConfig }): ReadOnlyClient
export declare function createClient(config: { network: NetworkId; provider: ProviderConfig; wallet: ApiWalletConfig }): SigningClient
export declare function createClient(config: { network: NetworkId; wallet: ApiWalletConfig }): WalletAPIClient // API wallet without separate provider
export declare function createClient(
  config?: CreateClientConfig
): MinimalClient | ProviderOnlyClient | SigningClient | ReadOnlyClient | WalletAPIClient

// Helper factory declarations (not yet implemented in this module)
export declare function providerFromConfig(config: ProviderConfig, network: NetworkId): Provider.Provider
export declare function multiProviderFromConfig(config: MultiProviderConfig, network: NetworkId): Provider.Provider
export declare function seedWalletFromConfig(config: SeedWalletConfig, network: NetworkId): SigningWallet
export declare function readOnlyWalletFromConfig(config: ReadOnlyWalletConfig, network: NetworkId): ReadOnlyWallet
export declare function apiWalletFromConfig(config: ApiWalletConfig, network: NetworkId): ApiWallet
export declare function walletFromCip30Api(api: WalletApi): ApiWallet

// Example (non-executable) usage:
const minimalClient = createClient()
const providerOnlyClient = minimalClient.attachProvider({ type: "blockfrost", apiKey: "xxx" })

// API wallet client upgrade path:
const apiWalletClient = createClient({ network: "mainnet", wallet: { type: "api", api: {} as WalletApi } })
// apiWalletClient: WalletAPIClient (can sign/submit, but no blockchain queries)

const _fullSigningClient = apiWalletClient.attachProvider({ type: "blockfrost", apiKey: "xxx" })
// _fullSigningClient: SigningClient (full capabilities: query + sign + submit)
const _readOnlyClient = providerOnlyClient.attachWallet({ type: "read-only", address: "test" })
const _signingClient = providerOnlyClient.attachWallet({ type: "seed", mnemonic: "..." })

// Multi-provider examples:
const _multiProviderClient = createClient({
  network: "mainnet",
  provider: {
    type: "multi",
    providers: [
      {
        type: "kupmios",
        apiKey: "primary-key",
        priority: 1
      },
      {
        type: "blockfrost", 
        apiKey: "fallback-key",
        priority: 2
      }
    ],
    failoverStrategy: "priority",
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000
    },
    retryConfig: {
      maxRetries: 3,
      retryDelayMs: 1000,
      backoffMultiplier: 2
    }
  }
})

const _roundRobinClient = createClient({
  network: "mainnet", 
  provider: {
    type: "multi",
    providers: [
      { type: "kupmios", apiKey: "key1" },
      { type: "kupmios", apiKey: "key2" },
      { type: "blockfrost", apiKey: "key3" }
    ],
    failoverStrategy: "round-robin"
  }
})

// Advanced multi-provider with wallet attachment:
const _fullClient = createClient({
  network: "mainnet",
  provider: {
    type: "multi", 
    providers: [
      {
        type: "kupmios",
        apiKey: "primary-key",
        ogmiosUrl: "wss://ogmios.example.com",
        kupoUrl: "https://kupo.example.com",
        priority: 1
      },
      {
        type: "blockfrost",
        apiKey: "backup-key", 
        url: "https://blockfrost.example.com",
        priority: 2
      }
    ],
    failoverStrategy: "priority",
    healthCheck: {
      enabled: true,
      intervalMs: 15000, // Check every 15 seconds
      timeoutMs: 3000    // 3 second timeout
    },
    retryConfig: {
      maxRetries: 2,
      retryDelayMs: 500,
      backoffMultiplier: 1.5
    }
  },
  wallet: {
    type: "seed",
    mnemonic: "abandon abandon abandon...",
    accountIndex: 0
  }
})
