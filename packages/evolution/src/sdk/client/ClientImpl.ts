// ClientImpl.ts - Step-by-step implementation starting with MinimalClient

import { Effect } from "effect"

import * as KeyHash from "../../core/KeyHash.js"
import * as PrivateKey from "../../core/PrivateKey.js"
import * as CoreRewardAccount from "../../core/RewardAccount.js"
import * as Transaction from "../../core/Transaction.js"
import * as TransactionHash from "../../core/TransactionHash.js"
import * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import * as VKey from "../../core/VKey.js"
import { runEffect } from "../../utils/effect-runtime.js"
import { hashTransaction } from "../../utils/Hash.js"
import type * as Address from "../Address.js"
import type { SignBuilder } from "../builders/SignBuilder.js"
import { makeTxBuilder, type TransactionBuilder } from "../builders/TransactionBuilder.js"
import type { TransactionResultBase } from "../builders/TransactionResult.js"
import * as Blockfrost from "../provider/Blockfrost.js"
import * as Koios from "../provider/Koios.js"
import * as Kupmios from "../provider/Kupmios.js"
import * as Maestro from "../provider/Maestro.js"
import * as Provider from "../provider/Provider.js"
import * as RewardAddress from "../RewardAddress.js"
import type * as UTxO from "../UTxO.js"
import * as Derivation from "../wallet/Derivation.js"
import * as WalletNew from "../wallet/WalletNew.js"
import {
  type ApiWalletClient,
  type ApiWalletConfig,
  type MinimalClient,
  type MinimalClientEffect,
  type NetworkId,
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
} from "./Client.js"

// ============================================================================
// Helper: Create Provider Instance from Config
// ============================================================================

const createProvider = (config: ProviderConfig): Provider.Provider => {
  switch (config.type) {
    case "blockfrost":
      return Blockfrost.custom(config.baseUrl, config.projectId)
    case "kupmios":
      return new Kupmios.KupmiosProvider(config.kupoUrl, config.ogmiosUrl, config.headers)
    case "maestro":
      return new Maestro.MaestroProvider(config.baseUrl, config.apiKey, config.turboSubmit)
    case "koios":
      return new Koios.Koios(config.baseUrl, config.token)
  }
}

/**
 * Map NetworkId to its numeric representation.
 * 
 * "mainnet" → 1; "preprod" and "preview" → 0; numeric IDs pass through unchanged.
 * 
 * @since 2.0.0
 * @category transformation
 */
const normalizeNetworkId = (network: NetworkId): number => {
  if (typeof network === "number") return network
  switch (network) {
    case "mainnet":
      return 1
    case "preprod":
      return 0
    case "preview":
      return 0
    default:
      return 0
  }
}

/**
 * Convert SDK ProtocolParameters to TransactionBuilder format.
/**
 * Map NetworkId discriminant to wallet network enumeration.
 * 
 * Returns "Mainnet" if numeric 1 or string "mainnet"; returns "Testnet" otherwise.
 * 
 * @since 2.0.0
 * @category transformation
 */
const toWalletNetwork = (networkId: NetworkId): WalletNew.Network => {
  if (typeof networkId === "number") {
    return networkId === 1 ? "Mainnet" : "Testnet"
  }
  switch (networkId) {
    case "mainnet":
      return "Mainnet"
    case "preprod":
    case "preview":
      return "Testnet"
    default:
      return "Testnet"
  }
}


/**
 * Construct a ReadOnlyWallet instance from network, payment address, and optional reward address.
 * 
 * Returns a wallet exposing address properties via both Promise and Effect APIs. No signing or transaction submission capability.
 * 
 * @since 2.0.0
 * @category constructors
 */
const createReadOnlyWallet = (
  network: WalletNew.Network,
  address: string,
  rewardAddress?: string
): WalletNew.ReadOnlyWallet => {
  // Effect interface - methods that return Effects
  const walletEffect: WalletNew.ReadOnlyWalletEffect = {
    address: () => Effect.succeed(address),
    rewardAddress: () => Effect.succeed(rewardAddress ?? null)
  }

  return {
    // Promise-based API - these are functions returning Promises
    address: () => Promise.resolve(address),
    rewardAddress: () => Promise.resolve(rewardAddress ?? null),
    // Effect namespace
    Effect: walletEffect,
    type: "read-only"
  }
}

/**
 * Construct a ReadOnlyWalletClient combining a read-only wallet with network metadata and combinator method.
 * 
 * Returns a client with address access and a method to attach a provider for blockchain queries.
 * 
 * @since 2.0.0
 * @category constructors
 */
const createReadOnlyWalletClient = (network: NetworkId, config: ReadOnlyWalletConfig): ReadOnlyWalletClient => {
  const walletNetwork = toWalletNetwork(network)
  const wallet = createReadOnlyWallet(walletNetwork, config.address, config.rewardAddress)
  const networkId = normalizeNetworkId(network)

  return {
    // Direct Promise properties from wallet
    address: wallet.address,
    rewardAddress: wallet.rewardAddress,
    // Metadata
    networkId,
    // Combinator methods
    attachProvider: (providerConfig) => {
      return createReadOnlyClient(network, providerConfig, config)
    },
    // Effect namespace - wallet's Effect interface
    Effect: wallet.Effect
  }
}

/**
 * Construct a ReadOnlyClient by composing a provider and read-only wallet.
 * 
 * Returns a client with blockchain query methods and address-based wallet convenience methods (getWalletUtxos, getWalletDelegation).
 * 
 * @since 2.0.0
 * @category constructors
 */
const createReadOnlyClient = (
  network: NetworkId,
  providerConfig: ProviderConfig,
  walletConfig: ReadOnlyWalletConfig
): ReadOnlyClient => {
  const provider = createProvider(providerConfig)
  const walletNetwork = toWalletNetwork(network)
  const wallet = createReadOnlyWallet(walletNetwork, walletConfig.address, walletConfig.rewardAddress)

  // Combine provider + wallet via spreading
  // Note: Using satisfies to validate structure without losing the actual object type
  const result = {
    ...provider,
    // Wallet properties
    address: wallet.address,
    rewardAddress: wallet.rewardAddress,
    // Wallet-scoped convenience methods
    getWalletUtxos: () => provider.getUtxos(walletConfig.address),
    getWalletDelegation: async () => {
      const rewardAddr = walletConfig.rewardAddress
      if (!rewardAddr) throw new Error("No reward address configured")
      return provider.getDelegation(rewardAddr)
    },
    // Transaction builder - creates a new builder instance
    newTx: (): TransactionBuilder<TransactionResultBase> => {
      // ReadOnlyWallet provides change address and UTxO fetching via wallet.Effect.address()
      // The wallet is passed to the builder config, which handles address and UTxO resolution automatically
      // Protocol parameters are auto-fetched from provider during build()
      return makeTxBuilder<TransactionResultBase>({
        wallet,
        provider
      })
    },
    // Effect namespace - combined provider + wallet Effects
    Effect: {
      ...provider.Effect,
      ...wallet.Effect,
      // Wallet-scoped convenience methods as Effects
      getWalletUtxos: () => provider.Effect.getUtxos(walletConfig.address),
      getWalletDelegation: () => {
        const rewardAddr = walletConfig.rewardAddress
        if (!rewardAddr) return Effect.fail(new Provider.ProviderError({ message: "No reward address configured", cause: null }))
        return provider.Effect.getDelegation(rewardAddr)
      }
    }
  }

  return result
}

/**
 * Determine key hashes that must sign a transaction based on inputs, withdrawals, and certificates.
 * 
 * Examines transaction body for required signers, owned inputs, reward account withdrawals, and stake credentials
 * in certificates. Returns the set of key hash hex strings that must provide signatures.
 * 
 * @since 2.0.0
 * @category predicates
 */
const computeRequiredKeyHashesSync = (params: {
  paymentKhHex?: string
  rewardAddress?: RewardAddress.RewardAddress | null
  stakeKhHex?: string
  tx: Transaction.Transaction
  utxos: ReadonlyArray<UTxO.UTxO>
}): Set<string> => {
  const required = new Set<string>()

  // 1) Explicit required signers
  if (params.tx.body.requiredSigners) {
    for (const kh of params.tx.body.requiredSigners) required.add(KeyHash.toHex(kh))
  }

  // Build owned refs from provided UTxOs
  const ownedRefs = new Set<string>(params.utxos.map((u) => `${u.txHash}#${u.outputIndex}`))

  // 2) Inputs owned by us imply payment key signature
  const checkInputs = (inputs?: ReadonlyArray<Transaction.Transaction["body"]["inputs"][number]>) => {
    if (!inputs || !params.paymentKhHex) return
    for (const input of inputs) {
      const txIdHex = TransactionHash.toHex(input.transactionId)
      const key = `${txIdHex}#${Number(input.index)}`
      if (ownedRefs.has(key)) required.add(params.paymentKhHex)
    }
  }
  checkInputs(params.tx.body.inputs)
  if (params.tx.body.collateralInputs) checkInputs(params.tx.body.collateralInputs)

  // 3) Withdrawals made by our reward account imply stake key signature
  if (params.tx.body.withdrawals && params.rewardAddress && params.stakeKhHex) {
    const ourReward = RewardAddress.toRewardAccount(params.rewardAddress)
    for (const [rewardAcc] of params.tx.body.withdrawals.withdrawals.entries()) {
      if (CoreRewardAccount.equals(ourReward, rewardAcc)) {
        required.add(params.stakeKhHex)
        break
      }
    }
  }

  // 4) Certificates that reference our stake credential imply stake key signature
  if (params.tx.body.certificates && params.stakeKhHex) {
    for (const cert of params.tx.body.certificates) {
      const cred =
        cert._tag === "StakeRegistration" || cert._tag === "StakeDeregistration" || cert._tag === "StakeDelegation"
          ? cert.stakeCredential
          : cert._tag === "RegCert" || cert._tag === "UnregCert"
            ? cert.stakeCredential
            : cert._tag === "StakeVoteDelegCert" ||
                cert._tag === "StakeRegDelegCert" ||
                cert._tag === "StakeVoteRegDelegCert"
              ? cert.stakeCredential
              : undefined
      if (cred && cred._tag === "KeyHash") {
        const khHex = KeyHash.toHex(cred)
        if (khHex === params.stakeKhHex) required.add(params.stakeKhHex)
      }
    }
  }

  return required
}

/**
 * Create a signing wallet from a seed phrase.
 * 
 * Wallet creation is synchronous - sodium initialization and key derivation
 * happen lazily on first crypto operation (signTx, signMessage).
 *
 * @category constructors
 */
const createSigningWallet = (network: WalletNew.Network, config: SeedWalletConfig): WalletNew.SigningWallet => {
  const derivationEffect = Derivation.walletFromSeed(config.mnemonic, {
    addressType: config.addressType ?? "Base",
    accountIndex: config.accountIndex ?? 0,
    password: config.password,
    network
  }).pipe(
    Effect.mapError(
      (cause) => new WalletNew.WalletError({ message: cause.message, cause })
    )
  )

  // Effect implementations are the source of truth
  const effectInterface: WalletNew.SigningWalletEffect = {
    address: () => Effect.map(derivationEffect, (d) => d.address),
    rewardAddress: () => Effect.map(derivationEffect, (d) => d.rewardAddress ?? null),
    signTx: (txOrHex: Transaction.Transaction | string, context?: { utxos?: ReadonlyArray<UTxO.UTxO> }) =>
      Effect.gen(function* () {
        const derivation = yield* derivationEffect
        
        const tx =
          typeof txOrHex === "string"
            ? yield* Transaction.Either.fromCBORHex(txOrHex).pipe(
                Effect.mapError(
                  (cause) => new WalletNew.WalletError({ message: cause.message, cause })
                )
              )
            : txOrHex
        const utxos = context?.utxos ?? []

        // Determine required key hashes for signing
        const required = computeRequiredKeyHashesSync({
          paymentKhHex: derivation.paymentKhHex,
          rewardAddress: derivation.rewardAddress ?? null,
          stakeKhHex: derivation.stakeKhHex,
          tx,
          utxos
        })

        // Build witnesses for keys we have
        const txHash = hashTransaction(tx.body)
        const msg = txHash.hash

        const witnesses: Array<TransactionWitnessSet.VKeyWitness> = []
        const seenVKeys = new Set<string>()
        for (const khHex of required) {
          const sk = derivation.keyStore.get(khHex)
          if (!sk) continue
          const sig = PrivateKey.sign(sk, msg)
          const vk = VKey.fromPrivateKey(sk)
          const vkHex = VKey.toHex(vk)
          if (seenVKeys.has(vkHex)) continue
          seenVKeys.add(vkHex)
          witnesses.push(new TransactionWitnessSet.VKeyWitness({ vkey: vk, signature: sig }))
        }

        return witnesses.length > 0 ? TransactionWitnessSet.fromVKeyWitnesses(witnesses) : TransactionWitnessSet.empty()
      }),
    signMessage: (_address: Address.Address | RewardAddress.RewardAddress, payload: WalletNew.Payload) =>
      Effect.map(derivationEffect, (derivation) => {
        // For now, always use payment key for message signing
        const paymentSk = PrivateKey.fromBech32(derivation.paymentKey)
        const vk = VKey.fromPrivateKey(paymentSk)
        const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload
        const _sig = PrivateKey.sign(paymentSk, bytes)
        const sigHex = VKey.toHex(vk) // TODO: Convert signature properly
        return { payload, signature: sigHex }
      })
  }

  // Promise API runs the Effect implementations
  return {
    type: "signing",
    address: () => Effect.runPromise(effectInterface.address()),
    rewardAddress: () => Effect.runPromise(effectInterface.rewardAddress()),
    signTx: (txOrHex, context) => Effect.runPromise(effectInterface.signTx(txOrHex, context)),
    signMessage: (address, payload) => Effect.runPromise(effectInterface.signMessage(address, payload)),
    Effect: effectInterface
  }
}

/**
 * Create a signing wallet from private keys.
 * 
 * @category constructors
 */
const createPrivateKeyWallet = (
  network: WalletNew.Network,
  config: PrivateKeyWalletConfig
): WalletNew.SigningWallet => {
  // walletFromPrivateKey now returns an Effect directly
  const derivationEffect = Derivation.walletFromPrivateKey(config.paymentKey, {
    stakeKeyBech32: config.stakeKey,
    addressType: config.addressType ?? (config.stakeKey ? "Base" : "Enterprise"),
    network
  }).pipe(
    Effect.mapError((cause) => new WalletNew.WalletError({ message: cause.message, cause }))
  )

  // Effect implementations are the source of truth
  const effectInterface: WalletNew.SigningWalletEffect = {
    address: () => Effect.map(derivationEffect, (d) => d.address),
    rewardAddress: () => Effect.map(derivationEffect, (d) => d.rewardAddress ?? null),
    signTx: (txOrHex: Transaction.Transaction | string, context?: { utxos?: ReadonlyArray<UTxO.UTxO> }) =>
      Effect.gen(function* () {
        const derivation = yield* derivationEffect
        
        const tx =
          typeof txOrHex === "string"
            ? yield* Transaction.Either.fromCBORHex(txOrHex).pipe(
                Effect.mapError(
                  (cause) => new WalletNew.WalletError({ message: cause.message, cause })
                )
              )
            : txOrHex
        const utxos = context?.utxos ?? []

        // Determine required key hashes for signing
        const required = computeRequiredKeyHashesSync({
          paymentKhHex: derivation.paymentKhHex,
          rewardAddress: derivation.rewardAddress ?? null,
          stakeKhHex: derivation.stakeKhHex,
          tx,
          utxos
        })

        // Build witnesses for keys we have
        const txHash = hashTransaction(tx.body)
        const msg = txHash.hash

        const witnesses: Array<TransactionWitnessSet.VKeyWitness> = []
        const seenVKeys = new Set<string>()
        for (const khHex of required) {
          const sk = derivation.keyStore.get(khHex)
          if (!sk) continue
          const sig = PrivateKey.sign(sk, msg)
          const vk = VKey.fromPrivateKey(sk)
          const vkHex = VKey.toHex(vk)
          if (seenVKeys.has(vkHex)) continue
          seenVKeys.add(vkHex)
          witnesses.push(new TransactionWitnessSet.VKeyWitness({ vkey: vk, signature: sig }))
        }

        return witnesses.length > 0 ? TransactionWitnessSet.fromVKeyWitnesses(witnesses) : TransactionWitnessSet.empty()
      }),
    signMessage: (_address: Address.Address | RewardAddress.RewardAddress, payload: WalletNew.Payload) =>
      Effect.map(derivationEffect, (derivation) => {
        // For now, always use payment key for message signing
        const paymentSk = PrivateKey.fromBech32(derivation.paymentKey)
        const vk = VKey.fromPrivateKey(paymentSk)
        const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload
        const _sig = PrivateKey.sign(paymentSk, bytes)
        const sigHex = VKey.toHex(vk) // TODO: Convert signature properly
        return { payload, signature: sigHex }
      })
  }

  // Promise API runs the Effect implementations
  return {
    type: "signing",
    address: () => runEffect(effectInterface.address()),
    rewardAddress: () => runEffect(effectInterface.rewardAddress()),
    signTx: (txOrHex, context) => runEffect(effectInterface.signTx(txOrHex, context)),
    signMessage: (address, payload) => runEffect(effectInterface.signMessage(address, payload)),
    Effect: effectInterface
  }
}

/**
 * Construct an ApiWallet wrapping a CIP-30 browser wallet API.
 * 
 * Caches addresses and reward addresses retrieved from the wallet. Returns a wallet with signing and message
 * authentication via the CIP-30 standard, plus transaction submission capability.
 * 
 * @since 2.0.0
 * @category constructors
 */
const createApiWallet = (_network: WalletNew.Network, config: ApiWalletConfig): WalletNew.ApiWallet => {
  const api = config.api
  let cachedAddress: Address.Address | null = null
  let cachedReward: RewardAddress.RewardAddress | null = null

  const getPrimaryAddress = Effect.gen(function* () {
    if (cachedAddress) return cachedAddress
    const used = yield* Effect.tryPromise({
      try: () => api.getUsedAddresses(),
      catch: (cause) => new WalletNew.WalletError({ message: (cause as Error).message, cause: cause as Error })
    })
    const unused = yield* Effect.tryPromise({
      try: () => api.getUnusedAddresses(),
      catch: (cause) => new WalletNew.WalletError({ message: (cause as Error).message, cause: cause as Error })
    })
    const addr = used[0] ?? unused[0]
    if (!addr) {
      return yield* Effect.fail(new WalletNew.WalletError({ message: "Wallet API returned no addresses", cause: null }))
    }
    cachedAddress = addr
    return addr
  })

  const getPrimaryRewardAddress = Effect.gen(function* () {
    if (cachedReward !== null) return cachedReward
    const rewards = yield* Effect.tryPromise({
      try: () => api.getRewardAddresses(),
      catch: (cause) => new WalletNew.WalletError({ message: (cause as Error).message, cause: cause as Error })
    })
    cachedReward = rewards[0] ?? null
    return cachedReward
  })

  // Effect implementations are the source of truth
  const effectInterface: WalletNew.ApiWalletEffect = {
    address: () => getPrimaryAddress,
    rewardAddress: () => getPrimaryRewardAddress,
    signTx: (txOrHex: Transaction.Transaction | string, _context?: { utxos?: ReadonlyArray<UTxO.UTxO> }) =>
      Effect.gen(function* () {
        const cbor = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        const witnessHex = yield* Effect.tryPromise({
          try: () => api.signTx(cbor, true),
          catch: (cause) => new WalletNew.WalletError({ message: "User rejected transaction signing", cause })
        })
        return yield* TransactionWitnessSet.Either.fromCBORHex(witnessHex).pipe(
          Effect.mapError((cause) => new WalletNew.WalletError({ message: cause.message, cause }))
        )
      }),
    signMessage: (address: Address.Address | RewardAddress.RewardAddress, payload: WalletNew.Payload) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => api.signData(address, payload),
          catch: (cause) => new WalletNew.WalletError({ message: "User rejected message signing", cause })
        })
        return { payload, signature: result.signature }
      }),
    submitTx: (txOrHex: Transaction.Transaction | string) =>
      Effect.gen(function* () {
        const cbor = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        return yield* Effect.tryPromise({
          try: () => api.submitTx(cbor),
          catch: (cause) => new WalletNew.WalletError({ message: (cause as Error).message, cause: cause as Error })
        })
      })
  }

  // Promise API runs the Effect implementations
  return {
    type: "api" as const,
    api,
    address: () => Effect.runPromise(effectInterface.address()),
    rewardAddress: () => Effect.runPromise(effectInterface.rewardAddress()),
    signTx: (txOrHex, context) => Effect.runPromise(effectInterface.signTx(txOrHex, context)),
    signMessage: (address, payload) => Effect.runPromise(effectInterface.signMessage(address, payload)),
    submitTx: (txOrHex) => Effect.runPromise(effectInterface.submitTx(txOrHex)),
    Effect: effectInterface
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
const createSigningWalletClient = (network: NetworkId, config: SeedWalletConfig | PrivateKeyWalletConfig): SigningWalletClient => {
  const walletNetwork = toWalletNetwork(network)
  const wallet = config.type === "seed"
    ? createSigningWallet(walletNetwork, config)
    : createPrivateKeyWallet(walletNetwork, config)
  const networkId = normalizeNetworkId(network)

  return {
    // Spread all wallet methods (address, rewardAddress, signTx, signData)
    ...wallet,
    // Metadata
    networkId,
    // Combinator method - attach provider to get full SigningClient
    attachProvider: (providerConfig) => {
      return createSigningClient(network, providerConfig, config)
    }
    // Effect namespace is already included via spread
  }
}

/**
 * Construct an ApiWalletClient combining a CIP-30 browser wallet with network metadata and combinator method.
 * 
 * Returns a client with signing and transaction submission via the browser wallet API, plus a method to attach a provider.
 * 
 * @since 2.0.0
 * @category constructors
 */
const createApiWalletClient = (network: NetworkId, config: ApiWalletConfig): ApiWalletClient => {
  const walletNetwork = toWalletNetwork(network)
  const wallet = createApiWallet(walletNetwork, config)

  return {
    // Spread all API wallet methods
    ...wallet,
    // Combinator method - attach provider to get full SigningClient
    attachProvider: (providerConfig) => {
      return createSigningClient(network, providerConfig, config)
    }
    // Effect namespace is already included via spread
  }
}

/**
 * Construct a SigningClient by composing a provider and signing wallet.
 * 
 * Merges blockchain query capabilities with transaction signing, message authentication, and submission.
 * Supports both seed-derived and CIP-30 browser wallets as signing sources.
 * 
 * @since 2.0.0
 * @category constructors
 */
const createSigningClient = (
  network: NetworkId,
  providerConfig: ProviderConfig,
  walletConfig: SeedWalletConfig | PrivateKeyWalletConfig | ApiWalletConfig
): SigningClient => {
  const provider = createProvider(providerConfig)
  const walletNetwork = toWalletNetwork(network)

  // Create appropriate wallet based on type (both are now sync)
  const wallet =
    walletConfig.type === "seed"
      ? createSigningWallet(walletNetwork, walletConfig)
      : walletConfig.type === "private-key"
        ? createPrivateKeyWallet(walletNetwork, walletConfig)
        : createApiWallet(walletNetwork, walletConfig)

  // Effect implementations are the source of truth
  const effectInterface = {
    ...wallet.Effect,
    ...provider.Effect, // Provider methods override wallet methods (e.g., submitTx uses ProviderError not WalletError)
    // Wallet-scoped convenience methods as Effects - expose union types (Effect-TS idiom)
    getWalletUtxos: () =>
      Effect.flatMap(wallet.Effect.address(), (addr) => provider.Effect.getUtxos(addr)),
    getWalletDelegation: () =>
      Effect.flatMap(wallet.Effect.rewardAddress(), (rewardAddr) => {
        if (!rewardAddr) return Effect.fail(new Provider.ProviderError({ message: "No reward address configured", cause: null }))
        return provider.Effect.getDelegation(rewardAddr)
      })
  }

  // Combine provider + signing wallet via spreading
  // Define getWalletUtxos first so we can reference it in newTx
  const getWalletUtxos = () => Effect.runPromise(effectInterface.getWalletUtxos())

  return {
    ...provider,
    ...wallet,
    // Promise methods call Effect implementations
    getWalletUtxos,
    getWalletDelegation: () => Effect.runPromise(effectInterface.getWalletDelegation()),
    // Transaction builder - creates a new builder instance
    newTx: (): TransactionBuilder<SignBuilder> => {
      // Wallet provides change address and UTxO fetching via wallet.Effect.address()
      // The wallet is passed to the builder config, which handles address and UTxO resolution automatically
      // Protocol parameters are auto-fetched from provider during build()
      return makeTxBuilder<SignBuilder>({
        provider, // Pass provider for submission
        wallet // Pass wallet for signing
      })
    },
    // Effect namespace
    Effect: effectInterface
  } 
}

/**
 * Construct a ProviderOnlyClient by pairing a provider with network metadata and combinator method.
 * 
 * Returns a client with blockchain query and transaction submission capabilities, plus a method to attach a wallet for signing.
 * 
 * @since 2.0.0
 * @category constructors
 */
const createProviderOnlyClient = (network: NetworkId, config: ProviderConfig): ProviderOnlyClient => {
  const provider = createProvider(config)

  // Now we can spread! All methods are own properties (arrow functions)
  return {
    ...provider,
    // Combinator method - attaches wallet to create full client
    attachWallet<T extends WalletConfig>(walletConfig: T) {
      // TypeScript cannot narrow conditional return types from runtime discriminants.
      // The conditional type interface provides type safety at call sites.
      switch (walletConfig.type) {
        case "read-only":
          return createReadOnlyClient(network, config, walletConfig) as any
        case "seed":
          return createSigningClient(network, config, walletConfig) as any
        case "api":
          return createSigningClient(network, config, walletConfig) as any
      }
    }
  }
}

/**
 * Construct a MinimalClient holding network metadata and combinator methods.
 * 
 * Returns the simplest client form: a network context with methods to progressively attach provider and/or wallet to build richer clients.
 * 
 * @since 2.0.0
 * @category constructors
 */
const createMinimalClient = (network: NetworkId = "mainnet"): MinimalClient => {
  const networkId = normalizeNetworkId(network)

  // Effect interface - methods that return Effects
  const effectInterface: MinimalClientEffect = {
    networkId: Effect.succeed(networkId)
  }

  return {
    networkId,
    // Combinator methods (pure functions that return new clients)
    attachProvider: (config) => {
      return createProviderOnlyClient(network, config)
    },
    attachWallet<T extends WalletConfig>(walletConfig: T) {
      // TypeScript cannot narrow conditional return types from runtime discriminants.
      // The conditional type interface provides type safety at call sites.
      switch (walletConfig.type) {
        case "read-only":
          return createReadOnlyWalletClient(network, walletConfig) as any
        case "seed":
          return createSigningWalletClient(network, walletConfig) as any
        case "api":
          return createApiWalletClient(network, walletConfig) as any
      }
    },
    attach<TW extends WalletConfig>(providerConfig: ProviderConfig, walletConfig: TW) {
      // TypeScript cannot narrow conditional return types from runtime discriminants.
      // The conditional type interface provides type safety at call sites.
      switch (walletConfig.type) {
        case "read-only":
          return createReadOnlyClient(network, providerConfig, walletConfig) as any
        case "seed":
          return createSigningClient(network, providerConfig, walletConfig) as any
        case "api":
          return createSigningClient(network, providerConfig, walletConfig) as any
      }
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
 * @since 2.0.0
 * @category constructors
 */

// Most specific overloads first - wallet type determines client capability
// Provider + ReadOnly Wallet → ReadOnlyClient
export function createClient(config: {
  network?: NetworkId
  provider: ProviderConfig
  wallet: ReadOnlyWalletConfig
}): ReadOnlyClient

// Provider + Seed Wallet → SigningClient
export function createClient(config: {
  network?: NetworkId
  provider: ProviderConfig
  wallet: SeedWalletConfig
}): SigningClient

// Provider + API Wallet → SigningClient
export function createClient(config: {
  network?: NetworkId
  provider: ProviderConfig
  wallet: ApiWalletConfig
}): SigningClient

// Provider only → ProviderOnlyClient
export function createClient(config: { network?: NetworkId; provider: ProviderConfig }): ProviderOnlyClient

// ReadOnly Wallet only → ReadOnlyWalletClient
export function createClient(config: { network?: NetworkId; wallet: ReadOnlyWalletConfig }): ReadOnlyWalletClient

// Seed Wallet only → SigningWalletClient
export function createClient(config: { network?: NetworkId; wallet: SeedWalletConfig }): SigningWalletClient

// Private Key Wallet only → SigningWalletClient
export function createClient(config: { network?: NetworkId; wallet: PrivateKeyWalletConfig }): SigningWalletClient

// API Wallet only → ApiWalletClient
export function createClient(config: { network?: NetworkId; wallet: ApiWalletConfig }): ApiWalletClient

// Network only or minimal → MinimalClient
export function createClient(config?: { network?: NetworkId }): MinimalClient

// Implementation signature - handles all cases (all synchronous now)
export function createClient(
  config?: {
    network?: NetworkId
    provider?: ProviderConfig
    wallet?: WalletConfig
  },
):
  | MinimalClient
  | ReadOnlyClient
  | SigningClient
  | ProviderOnlyClient
  | ReadOnlyWalletClient
  | SigningWalletClient
  | ApiWalletClient {
  const network = config?.network ?? "mainnet"

  // If both provider and wallet provided, create appropriate client based on wallet type
  if (config?.provider && config?.wallet) {
    switch (config.wallet.type) {
      case "read-only":
        return createReadOnlyClient(network, config.provider, config.wallet)
      case "seed":
        return createSigningClient(network, config.provider, config.wallet)
      case "private-key":
        return createSigningClient(network, config.provider, config.wallet)
      case "api":
        return createSigningClient(network, config.provider, config.wallet)
    }
  }

  // If wallet config provided only, create appropriate wallet client
  if (config?.wallet) {
    switch (config.wallet.type) {
      case "read-only":
        return createReadOnlyWalletClient(network, config.wallet)
      case "seed":
        return createSigningWalletClient(network, config.wallet)
      case "private-key":
        return createSigningWalletClient(network, config.wallet)
      case "api":
        return createApiWalletClient(network, config.wallet)
    }
  }

  // If provider config provided, create ProviderOnlyClient
  if (config?.provider) {
    return createProviderOnlyClient(network, config.provider)
  }

  // Otherwise create MinimalClient
  return createMinimalClient(network)
}
