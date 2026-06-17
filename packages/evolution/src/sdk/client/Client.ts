import { type Effect } from "effect"

import type * as CoreUTxO from "../../UTxO.js"
import type { ReadOnlyTransactionBuilder, SigningTransactionBuilder } from "../builders/TransactionBuilder.js"
import type * as Provider from "../provider/Provider.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as Wallet from "../wallet/Wallet.js"
import type { Chain } from "./Chain.js"
import * as internal from "./internal/Client.js"

/**
 * Address capability Effect surface.
 *
 * @since 2.1.0
 * @category model
 */
export interface AddressClientEffect extends Wallet.ReadOnlyWalletEffect {}

/**
 * Offline signing capability Effect surface.
 *
 * @since 2.1.0
 * @category model
 */
export interface OfflineSignerClientEffect extends AddressClientEffect {
  readonly signTx: (
    tx: Parameters<Wallet.SigningWalletEffect["signTx"]>[0],
    context?: Parameters<Wallet.SigningWalletEffect["signTx"]>[1]
  ) => ReturnType<Wallet.SigningWalletEffect["signTx"]>
  /**
   * Sign multiple transactions in batch (CIP-103).
   * Falls back to sequential signTx if the wallet doesn't support batch signing.
   *
   * @since 2.2.0
   */
  readonly signTxs: (
    txs: Parameters<Wallet.SigningWalletEffect["signTxs"]>[0],
    context?: Parameters<Wallet.SigningWalletEffect["signTxs"]>[1]
  ) => ReturnType<Wallet.SigningWalletEffect["signTxs"]>
  readonly signMessage: Wallet.SigningWalletEffect["signMessage"]
}

/**
 * Read-only client Effect surface.
 *
 * @since 2.1.0
 * @category model
 */
export interface ReadOnlyClientEffect extends Provider.ProviderEffect, AddressClientEffect {
  readonly getWalletUtxos: () => Effect.Effect<
    ReadonlyArray<CoreUTxO.UTxO>,
    Wallet.WalletError | Provider.ProviderError
  >
  readonly getWalletDelegation: () => Effect.Effect<Provider.Delegation, Wallet.WalletError | Provider.ProviderError>
}

/**
 * Signing client Effect surface.
 *
 * @since 2.1.0
 * @category model
 */
export interface SigningClientEffect extends Provider.ProviderEffect, OfflineSignerClientEffect {
  readonly getWalletUtxos: () => Effect.Effect<
    ReadonlyArray<CoreUTxO.UTxO>,
    Wallet.WalletError | Provider.ProviderError
  >
  readonly getWalletDelegation: () => Effect.Effect<Provider.Delegation, Wallet.WalletError | Provider.ProviderError>
}

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

/**
 * Configuration for the Koios provider.
 *
 * @since 2.1.0
 * @category model
 */
export interface KoiosConfig {
  readonly baseUrl: string
  readonly token?: string
}

/**
 * Configuration for the Kupmios provider (Kupo + Ogmios).
 *
 * @since 2.1.0
 * @category model
 */
export interface KupmiosConfig {
  readonly kupoUrl: string
  readonly ogmiosUrl: string
  readonly headers?: {
    readonly ogmiosHeader?: Record<string, string>
    readonly kupoHeader?: Record<string, string>
  }
}

/**
 * Configuration for the Maestro provider.
 *
 * @since 2.1.0
 * @category model
 */
export interface MaestroConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly turboSubmit?: boolean
}

/**
 * Configuration for the seed phrase wallet.
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
 * Configuration for the private key wallet.
 *
 * @since 2.1.0
 * @category model
 */
export interface PrivateKeyWalletConfig {
  readonly paymentKey: string
  readonly stakeKey?: string
  readonly addressType?: "Base" | "Enterprise"
}

/**
 * Client assembly stage scoped to a chain.
 *
 * @since 2.1.0
 * @category model
 */
export interface ClientAssembly {
  readonly chain: Chain
  readonly withBlockfrost: (config: BlockfrostConfig) => ReadClient
  readonly withKoios: (config: KoiosConfig) => ReadClient
  readonly withKupmios: (config: KupmiosConfig) => ReadClient
  readonly withMaestro: (config: MaestroConfig) => ReadClient
  readonly withAddress: (address: string, rewardAddress?: string) => AddressClient
  readonly withSeed: (config: SeedWalletConfig) => OfflineSignerClient
  readonly withPrivateKey: (config: PrivateKeyWalletConfig) => OfflineSignerClient
  readonly withCip30: (api: Wallet.WalletApi) => OfflineSignerClient
}

/**
 * Read-capable client.
 *
 * @since 2.1.0
 * @category model
 */
export type ReadClient = EffectToPromiseAPI<Provider.ProviderEffect> & {
  readonly chain: Chain
  readonly withAddress: (address: string, rewardAddress?: string) => ReadOnlyClient
  readonly withSeed: (config: SeedWalletConfig) => SigningClient
  readonly withPrivateKey: (config: PrivateKeyWalletConfig) => SigningClient
  readonly withCip30: (api: Wallet.WalletApi) => SigningClient
  readonly newTx: () => ReadOnlyTransactionBuilder
  readonly effect: Provider.ProviderEffect
}

/**
 * Address-capable client.
 *
 * @since 2.1.0
 * @category model
 */
export type AddressClient = EffectToPromiseAPI<AddressClientEffect> & {
  readonly chain: Chain
  readonly withBlockfrost: (config: BlockfrostConfig) => ReadOnlyClient
  readonly withKoios: (config: KoiosConfig) => ReadOnlyClient
  readonly withKupmios: (config: KupmiosConfig) => ReadOnlyClient
  readonly withMaestro: (config: MaestroConfig) => ReadOnlyClient
  readonly effect: AddressClientEffect
}

/**
 * Signing-capable client without read capability.
 *
 * @since 2.1.0
 * @category model
 */
export type OfflineSignerClient = EffectToPromiseAPI<OfflineSignerClientEffect> & {
  readonly chain: Chain
  readonly withBlockfrost: (config: BlockfrostConfig) => SigningClient
  readonly withKoios: (config: KoiosConfig) => SigningClient
  readonly withKupmios: (config: KupmiosConfig) => SigningClient
  readonly withMaestro: (config: MaestroConfig) => SigningClient
  readonly effect: OfflineSignerClientEffect
}

/**
 * Read-capable client with address resolution.
 *
 * @since 2.1.0
 * @category model
 */
export type ReadOnlyClient = EffectToPromiseAPI<ReadOnlyClientEffect> & {
  readonly chain: Chain
  readonly newTx: () => ReadOnlyTransactionBuilder
  readonly effect: ReadOnlyClientEffect
}

/**
 * Full signing client.
 *
 * @since 2.1.0
 * @category model
 */
export type SigningClient = EffectToPromiseAPI<SigningClientEffect> & {
  readonly chain: Chain
  readonly newTx: () => SigningTransactionBuilder
  readonly effect: SigningClientEffect
}

/**
 * Chain-scoped client namespace.
 *
 * @since 2.1.0
 * @category constructors
 */
/**
 * Construct a chain-scoped client assembly stage.
 *
 * @since 2.1.0
 * @category constructors
 */
export const make: (chain?: Chain) => ClientAssembly = internal.client
