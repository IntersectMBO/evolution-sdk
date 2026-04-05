import { type Effect } from "effect"

import type * as CoreUTxO from "../../UTxO.js"
import type { ReadOnlyTransactionBuilder, SigningTransactionBuilder } from "../builders/TransactionBuilder.js"
import type * as Provider from "../provider/Provider.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as WalletNew from "../wallet/WalletNew.js"
import type { Chain } from "./Chain.js"
import type { AnyWallet } from "./Wallets.js"

/**
 * MinimalClient Effect - holds chain context.
 *
 * @since 2.0.0
 * @category model
 */
export interface MinimalClientEffect {
  readonly chain: Chain
}

/**
 * ReadOnlyClient Effect - provider, read-only wallet, and utility methods.
 *
 * @since 2.0.0
 * @category model
 */
export interface ReadOnlyClientEffect extends Provider.ProviderEffect, WalletNew.ReadOnlyWalletEffect {
  readonly getWalletUtxos: () => Effect.Effect<ReadonlyArray<CoreUTxO.UTxO>, Provider.ProviderError>
  readonly getWalletDelegation: () => Effect.Effect<Provider.Delegation, Provider.ProviderError>
}

/**
 * SigningClient Effect - provider, signing wallet, and utility methods.
 *
 * @since 2.0.0
 * @category model
 */
export interface SigningClientEffect extends Provider.ProviderEffect, WalletNew.SigningWalletEffect {
  readonly getWalletUtxos: () => Effect.Effect<
    ReadonlyArray<CoreUTxO.UTxO>,
    WalletNew.WalletError | Provider.ProviderError
  >
  readonly getWalletDelegation: () => Effect.Effect<Provider.Delegation, WalletNew.WalletError | Provider.ProviderError>
}

/**
 * MinimalClient - network context with combinator methods to attach provider and/or wallet.
 *
 * @since 2.0.0
 * @category model
 */
export interface MinimalClient {
  readonly chain: Chain
  readonly attachProvider: (provider: Provider.Provider) => ProviderOnlyClient
  readonly attachWallet: <T extends AnyWallet>(
    wallet: T
  ) => T extends WalletNew.ReadOnlyWallet
    ? ReadOnlyWalletClient
    : T extends WalletNew.ApiWallet
      ? ApiWalletClient
      : SigningWalletClient
  readonly Effect: MinimalClientEffect
}

/**
 * ProviderOnlyClient - blockchain queries and transaction submission.
 *
 * @since 2.0.0
 * @category model
 */
export type ProviderOnlyClient = EffectToPromiseAPI<Provider.ProviderEffect> & {
  readonly chain: Chain
  readonly attachWallet: <T extends AnyWallet>(
    wallet: T
  ) => T extends WalletNew.ReadOnlyWallet ? ReadOnlyClient : SigningClient
  readonly Effect: Provider.ProviderEffect
}

/**
 * ReadOnlyClient - blockchain queries and wallet address operations without signing.
 * Use newTx() to build unsigned transactions.
 *
 * @since 2.0.0
 * @category model
 */
export type ReadOnlyClient = EffectToPromiseAPI<ReadOnlyClientEffect> & {
  readonly newTx: () => ReadOnlyTransactionBuilder
  readonly Effect: ReadOnlyClientEffect
}

/**
 * SigningClient - full functionality: blockchain queries, transaction signing, and submission.
 * Use newTx() to build, sign, and submit transactions.
 *
 * @since 2.0.0
 * @category model
 */
export type SigningClient = EffectToPromiseAPI<SigningClientEffect> & {
  readonly newTx: () => SigningTransactionBuilder
  readonly Effect: SigningClientEffect
}

/**
 * ApiWalletClient - CIP-30 wallet signing and submission without blockchain queries.
 * Requires attachProvider() to access blockchain data.
 *
 * @since 2.0.0
 * @category model
 */
export type ApiWalletClient = EffectToPromiseAPI<WalletNew.ApiWalletEffect> & {
  readonly chain: Chain
  readonly attachProvider: (provider: Provider.Provider) => SigningClient
  readonly Effect: WalletNew.ApiWalletEffect
}

/**
 * SigningWalletClient - transaction signing without blockchain queries.
 * Requires attachProvider() to access blockchain data.
 *
 * @since 2.0.0
 * @category model
 */
export type SigningWalletClient = EffectToPromiseAPI<WalletNew.SigningWalletEffect> & {
  readonly chain: Chain
  readonly attachProvider: (provider: Provider.Provider) => SigningClient
  readonly Effect: WalletNew.SigningWalletEffect
}

/**
 * ReadOnlyWalletClient - wallet address access without signing or blockchain queries.
 * Requires attachProvider() to access blockchain data.
 *
 * @since 2.0.0
 * @category model
 */
export type ReadOnlyWalletClient = EffectToPromiseAPI<WalletNew.ReadOnlyWalletEffect> & {
  readonly chain: Chain
  readonly attachProvider: (provider: Provider.Provider) => ReadOnlyClient
  readonly Effect: WalletNew.ReadOnlyWalletEffect
}

export type { Chain } from "./Chain.js"
export { mainnet, preprod, preview } from "./Chain.js"
export type { AnyWallet, WalletFactory } from "./Wallets.js"
