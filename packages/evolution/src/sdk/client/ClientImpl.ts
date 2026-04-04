/**
 * Legacy client implementation.
 *
 * This module implements the original `createClient(config)` factory pattern.
 * New code should use the composable `client(chain).with(provider).with(wallet)`
 * API exported from `Client.ts` instead.
 *
 * @deprecated Prefer the composable client API in `Client.ts`.
 * @module
 */

import { Effect, ParseResult, Schema } from "effect"

import * as CoreAddress from "../../Address.js"
import * as CoreRewardAddress from "../../RewardAddress.js"
import * as Transaction from "../../Transaction.js"
import type * as TransactionWitnessSet from "../../TransactionWitnessSet.js"
import { runEffectPromise } from "../../utils/effect-runtime.js"
import type * as CoreUTxO from "../../UTxO.js"
import {
  makeTxBuilder,
  type ReadOnlyTransactionBuilder,
  type SigningTransactionBuilder
} from "../builders/TransactionBuilder.js"
import * as Blockfrost from "../provider/Blockfrost.js"
import * as Koios from "../provider/Koios.js"
import * as Kupmios from "../provider/Kupmios.js"
import * as Maestro from "../provider/Maestro.js"
import * as Provider from "../provider/Provider.js"
import * as Wallet from "../wallet/Wallet.js"
import type { Chain } from "./Chain.js"
import {
  type ApiWalletClient,
  type ApiWalletConfig,
  type MinimalClient,
  type MinimalClientEffect,
  type PrivateKeyWalletConfig,
  type ProviderConfig,
  type ProviderOnlyClient,
  type ReadOnlyClient,
  type ReadOnlyWalletClient,
  type ReadOnlyWalletConfig,
  type SeedWalletConfig,
  type SigningClient,
  type SigningWalletClient,
  type WalletConfig
} from "./ClientLegacy.js"

/**
 * Create a provider instance from configuration.
 *
 * @since 2.0.0
 * @category utilities
 */
const createProvider = (config: ProviderConfig): Provider.Provider => {
  switch (config.type) {
    case "blockfrost":
      return Blockfrost.custom(config.baseUrl, config.projectId)
    case "kupmios":
      return new Kupmios.KupmiosProvider(config.kupoUrl, config.ogmiosUrl, config.headers)
    case "maestro":
      return new Maestro.MaestroProvider(config.baseUrl, config.apiKey, config.turboSubmit)
    case "koios":
      return new Koios.KoiosProvider(config.baseUrl, config.token)
  }
}

/**
 * Construct read-only wallet from a payment address and optional reward address.
 *
 * @since 2.0.0
 * @category constructors
 */
const createReadOnlyWallet = (address: string, rewardAddress?: string): Wallet.ReadOnlyWallet => {
  const coreAddress = CoreAddress.fromBech32(address)
  const coreRewardAddress = rewardAddress ? Schema.decodeSync(CoreRewardAddress.RewardAddress)(rewardAddress) : null
  const effects = Wallet.makeReadOnlyWalletEffect(coreAddress, coreRewardAddress)
  return {
    type: "read-only",
    address: () => runEffectPromise(effects.address()),
    rewardAddress: () => runEffectPromise(effects.rewardAddress()),
    Effect: effects
  }
}

/**
 * Construct read-only wallet client with network metadata and combinator methods.
 *
 * @since 2.0.0
 * @category constructors
 */
const createReadOnlyWalletClient = (chain: Chain, config: ReadOnlyWalletConfig): ReadOnlyWalletClient => {
  const wallet = createReadOnlyWallet(config.address, config.rewardAddress)

  return {
    address: wallet.address,
    rewardAddress: wallet.rewardAddress,
    chain,
    attachProvider: (providerConfig) => {
      return createReadOnlyClient(chain, providerConfig, config)
    },
    Effect: wallet.Effect
  }
}

/**
 * Construct read-only client by composing provider and read-only wallet.
 *
 * @since 2.0.0
 * @category constructors
 */
const createReadOnlyClient = (
  chain: Chain,
  providerConfig: ProviderConfig,
  walletConfig: ReadOnlyWalletConfig
): ReadOnlyClient => {
  const provider = createProvider(providerConfig)
  const wallet = createReadOnlyWallet(walletConfig.address, walletConfig.rewardAddress)
  // Parse the bech32 address to Core Address for provider calls
  const coreAddress = CoreAddress.fromBech32(walletConfig.address)

  const result = {
    ...provider,
    address: wallet.address,
    rewardAddress: wallet.rewardAddress,
    getWalletUtxos: () => provider.getUtxos(coreAddress),
    getWalletDelegation: async () => {
      const rewardAddr = walletConfig.rewardAddress
      if (!rewardAddr) throw new Error("No reward address configured")
      const coreRewardAddr = Schema.decodeSync(CoreRewardAddress.RewardAddress)(rewardAddr)
      return provider.getDelegation(coreRewardAddr)
    },
    newTx: (): ReadOnlyTransactionBuilder => {
      return makeTxBuilder({
        wallet,
        provider,
        slotConfig: chain.slotConfig
      })
    },
    Effect: {
      ...provider.Effect,
      ...wallet.Effect,
      getWalletUtxos: () => provider.Effect.getUtxos(coreAddress),
      getWalletDelegation: () => {
        const rewardAddr = walletConfig.rewardAddress
        if (!rewardAddr)
          return Effect.fail(new Provider.ProviderError({ message: "No reward address configured", cause: null }))
        const coreRewardAddr = Schema.decodeSync(CoreRewardAddress.RewardAddress)(rewardAddr)
        return provider.Effect.getDelegation(coreRewardAddr)
      }
    }
  }

  return result
}

/**
 * Create a signing wallet from a seed phrase config.
 * Delegates signing logic to Wallet.ts — no duplication here.
 *
 * @since 2.0.0
 * @category constructors
 */
const createSigningWallet = (chain: Chain, config: SeedWalletConfig): Wallet.SigningWallet => {
  const effects = Wallet.makeSigningWalletEffect(chain.id, config.mnemonic, {
    accountIndex: config.accountIndex,
    addressType: config.addressType,
    password: config.password
  })
  return {
    type: "signing",
    address: () => runEffectPromise(effects.address()),
    rewardAddress: () => runEffectPromise(effects.rewardAddress()),
    signTx: (txOrHex, context) => runEffectPromise(effects.signTx(txOrHex, context)),
    signMessage: (address, payload) => runEffectPromise(effects.signMessage(address, payload)),
    Effect: effects
  }
}

/**
 * Create a signing wallet from a private key config.
 * Delegates signing logic to Wallet.ts — no duplication here.
 *
 * @since 2.0.0
 * @category constructors
 */
const createPrivateKeyWallet = (chain: Chain, config: PrivateKeyWalletConfig): Wallet.SigningWallet => {
  const effects = Wallet.makePrivateKeyWalletEffect(chain.id, config.paymentKey, {
    stakeKey: config.stakeKey,
    addressType: config.addressType
  })
  return {
    type: "signing",
    address: () => runEffectPromise(effects.address()),
    rewardAddress: () => runEffectPromise(effects.rewardAddress()),
    signTx: (txOrHex, context) => runEffectPromise(effects.signTx(txOrHex, context)),
    signMessage: (address, payload) => runEffectPromise(effects.signMessage(address, payload)),
    Effect: effects
  }
}

/**
 * Create a CIP-30 API wallet.
 * Delegates to Wallet.ts — no duplication here.
 *
 * @since 2.0.0
 * @category constructors
 */
const createApiWallet = (config: ApiWalletConfig): Wallet.ApiWallet => {
  const effects = Wallet.makeApiWalletEffect(config.api)
  return {
    type: "api",
    api: config.api,
    address: () => runEffectPromise(effects.address()),
    rewardAddress: () => runEffectPromise(effects.rewardAddress()),
    signTx: (txOrHex, context) => runEffectPromise(effects.signTx(txOrHex, context)),
    signMessage: (address, payload) => runEffectPromise(effects.signMessage(address, payload)),
    submitTx: (txOrHex) => runEffectPromise(effects.submitTx(txOrHex)),
    Effect: effects
  }
}

/**
 * Construct a SigningWalletClient combining a signing wallet with network metadata and combinator method.
 *
 * Returns a client with transaction signing and address access, plus a method to attach a provider for blockchain queries.
 *
 * @since 2.0.0
 * @category constructors
 */
const createSigningWalletClient = (
  chain: Chain,
  config: SeedWalletConfig | PrivateKeyWalletConfig
): SigningWalletClient => {
  const wallet =
    config.type === "seed" ? createSigningWallet(chain, config) : createPrivateKeyWallet(chain, config)

  return {
    ...wallet,
    chain,
    attachProvider: (providerConfig) => {
      return createSigningClient(chain, providerConfig, config)
    }
  }
}

/**
 * Create an ApiWalletClient combining a CIP-30 browser wallet with network metadata and combinator method.
 *
 * @since 2.0.0
 * @category constructors
 */
const createApiWalletClient = (chain: Chain, config: ApiWalletConfig): ApiWalletClient => {
  const wallet = createApiWallet(config)

  return {
    ...wallet,
    attachProvider: (providerConfig) => {
      return createSigningClient(chain, providerConfig, config)
    }
  }
}

/**
 * Create a SigningClient by composing a provider and signing wallet.
 *
 * @since 2.0.0
 * @category constructors
 */
const createSigningClient = (
  chain: Chain,
  providerConfig: ProviderConfig,
  walletConfig: SeedWalletConfig | PrivateKeyWalletConfig | ApiWalletConfig
): SigningClient => {
  const provider = createProvider(providerConfig)

  const wallet =
    walletConfig.type === "seed"
      ? createSigningWallet(chain, walletConfig)
      : walletConfig.type === "private-key"
        ? createPrivateKeyWallet(chain, walletConfig)
        : createApiWallet(walletConfig)

  // Enhanced signTx that automatically fetches reference UTxOs from the network.
  // Passes the original txOrHex through to wallet.Effect.signTx to preserve CBOR bytes for hashing.
  const signTxWithAutoFetch = (
    txOrHex: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ): Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, Wallet.WalletError> =>
    Effect.gen(function* () {
      // If referenceUtxos already provided, pass original txOrHex through
      if (context?.referenceUtxos && context.referenceUtxos.length > 0) {
        return yield* wallet.Effect.signTx(txOrHex, context)
      }

      // Decode to Transaction only if we need to check for reference inputs
      const tx =
        typeof txOrHex === "string"
          ? yield* ParseResult.decodeUnknownEither(Transaction.FromCBORHex())(txOrHex).pipe(
              Effect.mapError(
                (cause) => new Wallet.WalletError({ message: `Failed to decode transaction: ${cause}`, cause })
              )
            )
          : txOrHex

      // Auto-fetch reference UTxOs from the network if the transaction has reference inputs
      let referenceUtxos: ReadonlyArray<CoreUTxO.UTxO> = []
      if (tx.body.referenceInputs && tx.body.referenceInputs.length > 0) {
        referenceUtxos = yield* provider.Effect.getUtxosByOutRef(tx.body.referenceInputs).pipe(
          Effect.mapError(
            (e) => new Wallet.WalletError({ message: `Failed to fetch reference UTxOs: ${e.message}`, cause: e })
          )
        )
      }

      // Pass original txOrHex through to preserve CBOR bytes for hashing
      return yield* wallet.Effect.signTx(txOrHex, { ...context, referenceUtxos })
    })

  const effectInterface = {
    ...wallet.Effect,
    ...provider.Effect,
    // Override signTx with auto-fetch capability
    signTx: signTxWithAutoFetch,
    getWalletUtxos: () => Effect.flatMap(wallet.Effect.address(), (addr) => provider.Effect.getUtxos(addr)),
    getWalletDelegation: () =>
      Effect.flatMap(wallet.Effect.rewardAddress(), (rewardAddr) => {
        if (!rewardAddr)
          return Effect.fail(new Provider.ProviderError({ message: "No reward address configured", cause: null }))
        const coreRewardAddr = Schema.decodeSync(CoreRewardAddress.RewardAddress)(rewardAddr)
        return provider.Effect.getDelegation(coreRewardAddr)
      })
  }

  // Combine provider + signing wallet via spreading
  // Define getWalletUtxos first so we can reference it in newTx
  const getWalletUtxos = () => Effect.runPromise(effectInterface.getWalletUtxos())

  return {
    ...provider,
    ...wallet,
    // Override signTx with auto-fetch capability (must come after ...wallet to override)
    signTx: (
      txOrHex: Transaction.Transaction | string,
      context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
    ) => Effect.runPromise(signTxWithAutoFetch(txOrHex, context)),
    // Promise methods call Effect implementations
    getWalletUtxos,
    getWalletDelegation: () => Effect.runPromise(effectInterface.getWalletDelegation()),
    // Transaction builder - creates a new builder instance
    newTx: (): SigningTransactionBuilder => {
      // Wallet provides change address and UTxO fetching via wallet.Effect.address()
      // The wallet is passed to the builder config, which handles address and UTxO resolution automatically
      // Protocol parameters are auto-fetched from provider during build()
      return makeTxBuilder({
        provider,
        wallet,
        slotConfig: chain.slotConfig
      })
    },
    // Effect namespace
    Effect: effectInterface
  }
}

type ProviderAttachedClient<T extends WalletConfig> = T extends SeedWalletConfig
  ? SigningClient
  : T extends PrivateKeyWalletConfig
    ? SigningClient
    : T extends ApiWalletConfig
      ? SigningClient
      : ReadOnlyClient

type WalletOnlyAttachedClient<T extends WalletConfig> = T extends SeedWalletConfig
  ? SigningWalletClient
  : T extends PrivateKeyWalletConfig
    ? SigningWalletClient
    : T extends ApiWalletConfig
      ? ApiWalletClient
      : ReadOnlyWalletClient

/**
 * Route a wallet config to the correct provider-backed legacy client constructor.
 *
 * @since 2.0.0
 * @category constructors
 */
const createProviderBackedClient = <T extends WalletConfig>(
  chain: Chain,
  providerConfig: ProviderConfig,
  walletConfig: T
): ProviderAttachedClient<T> => {
  switch (walletConfig.type) {
    case "read-only":
      return createReadOnlyClient(chain, providerConfig, walletConfig) as ProviderAttachedClient<T>
    case "seed":
    case "private-key":
    case "api":
      return createSigningClient(chain, providerConfig, walletConfig) as ProviderAttachedClient<T>
  }
}

/**
 * Route a wallet config to the correct wallet-only legacy client constructor.
 *
 * @since 2.0.0
 * @category constructors
 */
const createWalletOnlyClient = <T extends WalletConfig>(
  chain: Chain,
  walletConfig: T
): WalletOnlyAttachedClient<T> => {
  switch (walletConfig.type) {
    case "read-only":
      return createReadOnlyWalletClient(chain, walletConfig) as WalletOnlyAttachedClient<T>
    case "seed":
    case "private-key":
      return createSigningWalletClient(chain, walletConfig) as WalletOnlyAttachedClient<T>
    case "api":
      return createApiWalletClient(chain, walletConfig) as WalletOnlyAttachedClient<T>
  }
}

/**
 * Create a ProviderOnlyClient by pairing a provider with network metadata and combinator method.
 *
 * @since 2.0.0
 * @category constructors
 */
const createProviderOnlyClient = (chain: Chain, config: ProviderConfig): ProviderOnlyClient => {
  const provider = createProvider(config)

  return {
    ...provider,
    attachWallet<T extends WalletConfig>(walletConfig: T) {
      return createProviderBackedClient(chain, config, walletConfig)
    }
  }
}

/**
 * Create a MinimalClient holding network metadata and combinator methods.
 *
 * @since 2.0.0
 * @category constructors
 */
const createMinimalClient = (chain: Chain): MinimalClient => {
  const effectInterface: MinimalClientEffect = {
    chain
  }

  return {
    chain,
    attachProvider: (config) => {
      return createProviderOnlyClient(chain, config)
    },
    attachWallet<T extends WalletConfig>(walletConfig: T) {
      return createWalletOnlyClient(chain, walletConfig)
    },
    attach<TW extends WalletConfig>(providerConfig: ProviderConfig, walletConfig: TW) {
      return createProviderBackedClient(chain, providerConfig, walletConfig)
    },
    // Effect namespace
    Effect: effectInterface
  }
}

/**
 * Factory function producing a client instance from configuration parameters.
 *
 * Returns different client types depending on what configuration is provided:
 * provider and wallet → full-featured client; provider only → query and submission;
 * wallet only → signing with network metadata; network only → minimal context with combinators.
 *
 * @deprecated Use the composable `client(chain).with(provider).with(wallet)` API instead.
 * See `Client.ts` for the new pattern.
 *
 * @since 2.0.0
 * @category constructors
 */

// Most specific overloads first - wallet type determines client capability
// Provider + ReadOnly Wallet → ReadOnlyClient
export function createClient(config: {
  chain: Chain
  provider: ProviderConfig
  wallet: ReadOnlyWalletConfig
}): ReadOnlyClient

// Provider + Seed Wallet → SigningClient
export function createClient(config: {
  chain: Chain
  provider: ProviderConfig
  wallet: SeedWalletConfig
}): SigningClient

// Provider + PrivateKey Wallet → SigningClient
export function createClient(config: {
  chain: Chain
  provider: ProviderConfig
  wallet: PrivateKeyWalletConfig
}): SigningClient

// Provider + API Wallet → SigningClient
export function createClient(config: {
  chain: Chain
  provider: ProviderConfig
  wallet: ApiWalletConfig
}): SigningClient

// Provider only → ProviderOnlyClient
export function createClient(config: { chain: Chain; provider: ProviderConfig }): ProviderOnlyClient

// ReadOnly Wallet only → ReadOnlyWalletClient
export function createClient(config: { chain: Chain; wallet: ReadOnlyWalletConfig }): ReadOnlyWalletClient

// Seed Wallet only → SigningWalletClient
export function createClient(config: { chain: Chain; wallet: SeedWalletConfig }): SigningWalletClient

// Private Key Wallet only → SigningWalletClient
export function createClient(config: { chain: Chain; wallet: PrivateKeyWalletConfig }): SigningWalletClient

// API Wallet only → ApiWalletClient
export function createClient(config: { chain: Chain; wallet: ApiWalletConfig }): ApiWalletClient

// Chain only → MinimalClient
export function createClient(config: { chain: Chain }): MinimalClient

// Implementation signature - handles all cases (all synchronous now)
export function createClient(config: {
  chain: Chain
  provider?: ProviderConfig
  wallet?: WalletConfig
}):
  | MinimalClient
  | ReadOnlyClient
  | SigningClient
  | ProviderOnlyClient
  | ReadOnlyWalletClient
  | SigningWalletClient
  | ApiWalletClient {
  const chain = config.chain

  if (config.provider && config.wallet) {
    return createProviderBackedClient(chain, config.provider, config.wallet)
  }

  if (config.wallet) {
    return createWalletOnlyClient(chain, config.wallet)
  }

  if (config.provider) {
    return createProviderOnlyClient(chain, config.provider)
  }

  return createMinimalClient(chain)
}
