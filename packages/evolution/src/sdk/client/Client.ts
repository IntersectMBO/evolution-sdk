// Client module: extracted from WalletNew during Phase 2
// Provides client effect interfaces and promise-based client interfaces

import { Data, type Effect } from "effect"

import type * as Address from "../Address.js"
import type { ReadOnlyTransactionBuilder, ReadOnlyTransactionBuilderEffect } from "../builders/index.js"
import type * as Delegation from "../Delegation.js"
// (Provider effect already exposes delegation, datum, etc. so we intentionally avoid re-declaring here)
import type * as Provider from "../provider/Provider.js"
import type * as RewardAddress from "../RewardAddress.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as UTxO from "../UTxO.js"
// Type-only imports to avoid runtime circular dependency
import type { ReadOnlyWallet, SigningWallet, SigningWalletEffect } from "../wallet/WalletNew.js"

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

export type ProviderOnlyClient = EffectToPromiseAPI<ProviderOnlyClientEffect> & {
  readonly attachWallet: {
    (wallet: SigningWallet): SigningClient
    (wallet: ReadOnlyWallet): ReadOnlyClient
    (config: SeedWalletConfig): SigningClient
    (config: ReadOnlyWalletConfig): ReadOnlyClient
  }
  readonly Effect: ProviderOnlyClientEffect
  readonly provider: Provider.Provider
}

export interface MinimalClient {
  readonly networkId: number | string // Simplified network reference
  readonly attachProvider: {
    (provider: Provider.Provider): ProviderOnlyClient
    (config: ProviderConfig): ProviderOnlyClient
  }
  readonly attach: {
    (provider: Provider.Provider, wallet: SigningWallet): SigningClient
    (provider: Provider.Provider, wallet: ReadOnlyWallet): ReadOnlyClient
    (provider: Provider.Provider, wallet: SeedWalletConfig): SigningClient
    (provider: Provider.Provider, wallet: ReadOnlyWalletConfig): ReadOnlyClient
    (config: ProviderConfig, wallet: SigningWallet): SigningClient
    (config: ProviderConfig, wallet: ReadOnlyWallet): ReadOnlyClient
    (config: ProviderConfig, wallet: SeedWalletConfig): SigningClient
    (config: ProviderConfig, wallet: ReadOnlyWalletConfig): ReadOnlyClient
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
}

export interface BlockfrostProviderConfig {
  readonly type: "blockfrost"
  readonly apiKey: string
  readonly url?: string
}

export type ProviderConfig = KupmiosProviderConfig | BlockfrostProviderConfig

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

export type WalletConfig = SeedWalletConfig | ReadOnlyWalletConfig

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
export declare function createClient(
  config?: CreateClientConfig
): MinimalClient | ProviderOnlyClient | SigningClient | ReadOnlyClient

// Helper factory declarations (not yet implemented in this module)
export declare function providerFromConfig(config: ProviderConfig, network: NetworkId): Provider.Provider
export declare function seedWalletFromConfig(config: SeedWalletConfig, network: NetworkId): SigningWallet
export declare function readOnlyWalletFromConfig(config: ReadOnlyWalletConfig, network: NetworkId): ReadOnlyWallet

// Example (non-executable) usage:
const minimalClient = createClient()
const providerOnlyClient = minimalClient.attachProvider({ type: "blockfrost", apiKey: "xxx" })
const readOnlyClient = providerOnlyClient.attachWallet({ type: "read-only", address: "test" })
const signingClient = providerOnlyClient.attachWallet({ type: "seed", mnemonic: "..." })
