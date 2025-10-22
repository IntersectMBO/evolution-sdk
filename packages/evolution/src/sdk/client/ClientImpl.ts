// ClientImpl.ts - Step-by-step implementation starting with MinimalClient

import { Effect, Either } from "effect"

import * as KeyHash from "../../core/KeyHash.js"
import * as PrivateKey from "../../core/PrivateKey.js"
import * as CoreRewardAccount from "../../core/RewardAccount.js"
import * as Transaction from "../../core/Transaction.js"
import * as TransactionHash from "../../core/TransactionHash.js"
import * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import * as VKey from "../../core/VKey.js"
import { hashTransaction } from "../../utils/Hash.js"
import type * as Address from "../Address.js"
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert NetworkId to numeric network ID
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
 * Convert Client NetworkId to Wallet Network type
 * - "mainnet" → "Mainnet"
 * - "preprod" / "preview" → "Testnet"
 * - number: 1 → "Mainnet", otherwise → "Testnet"
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

// ============================================================================
// Step 3: Wallet Creation Functions
// ============================================================================

/**
 * Create a ReadOnlyWallet - provides address and reward address only
 */
const createReadOnlyWallet = (
  network: WalletNew.Network,
  address: string,
  rewardAddress?: string
): WalletNew.ReadOnlyWallet => {
  // Effect interface - methods that return Effects
  const walletEffect: WalletNew.ReadOnlyWalletEffect = {
    address: Effect.succeed(address),
    rewardAddress: Effect.succeed(rewardAddress ?? null)
  }

  return {
    // Promise-based API - these are Promises, not functions
    address: Promise.resolve(address),
    rewardAddress: Promise.resolve(rewardAddress ?? null),
    // Effect namespace
    Effect: walletEffect,
    type: "read-only"
  }
}

/**
 * Create a ReadOnlyWalletClient - wallet with address access only, no provider
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
 * Create a ReadOnlyClient - full client with provider + read-only wallet
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
    // Transaction builder (TODO: implement later)
    newTx: (_utxos?: any): any => {
      throw new Error("newTx not yet implemented")
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

// ============================================================================
// TODO: SigningClient Implementation (placeholder declarations)
// ============================================================================

// ============================================================================
// Step 4: Signing Wallet Creation Functions
// ============================================================================

/**
 * Helper: Compute required key hashes for signing (from old Wallet.ts)
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
 * Create a SigningWallet from seed phrase
 */
const createSigningWallet = (network: WalletNew.Network, config: SeedWalletConfig): WalletNew.SigningWallet => {
  // Derive keys and address from seed
  const derivation = Derivation.walletFromSeed(config.mnemonic, {
    addressType: config.addressType ?? "Base",
    accountIndex: config.accountIndex ?? 0,
    password: config.password,
    network
  }).pipe(Either.getOrThrow)

  // Build keystore: map KeyHash hex -> PrivateKey
  const keyStore = new Map<string, PrivateKey.PrivateKey>()
  const paymentSk = PrivateKey.fromBech32(derivation.paymentKey)
  const paymentKh = KeyHash.fromPrivateKey(paymentSk)
  const paymentKhHex = KeyHash.toHex(paymentKh)
  keyStore.set(paymentKhHex, paymentSk)

  let stakeSk: PrivateKey.PrivateKey | undefined
  let stakeKhHex: string | undefined
  if (derivation.stakeKey) {
    stakeSk = PrivateKey.fromBech32(derivation.stakeKey)
    const stakeKh = KeyHash.fromPrivateKey(stakeSk)
    stakeKhHex = KeyHash.toHex(stakeKh)
    keyStore.set(stakeKhHex, stakeSk)
  }

  // Effect implementations are the source of truth
  const effectInterface: WalletNew.SigningWalletEffect = {
    address: Effect.succeed(derivation.address),
    rewardAddress: Effect.succeed(derivation.rewardAddress ?? null),
    signTx: (txOrHex: Transaction.Transaction | string, context?: { utxos?: ReadonlyArray<UTxO.UTxO> }) =>
      Effect.gen(function* () {
        const tx =
          typeof txOrHex === "string"
            ? yield* Transaction.Either.fromCBORHex(txOrHex).pipe(
                Effect.mapError(
                  (cause) => new WalletNew.WalletError({ message: "Failed to decode transaction", cause })
                )
              )
            : txOrHex
        const utxos = context?.utxos ?? []

        // Determine required key hashes for signing
        const required = computeRequiredKeyHashesSync({
          paymentKhHex,
          rewardAddress: derivation.rewardAddress ?? null,
          stakeKhHex,
          tx,
          utxos
        })

        // Build witnesses for keys we have
        const txHash = hashTransaction(tx.body)
        const msg = txHash.hash

        const witnesses: Array<TransactionWitnessSet.VKeyWitness> = []
        const seenVKeys = new Set<string>()
        for (const khHex of required) {
          const sk = keyStore.get(khHex)
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
      Effect.sync(() => {
        // For now, always use payment key for message signing
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
    address: Effect.runPromise(effectInterface.address),
    rewardAddress: Effect.runPromise(effectInterface.rewardAddress),
    signTx: (txOrHex, context) => Effect.runPromise(effectInterface.signTx(txOrHex, context)),
    signMessage: (address, payload) => Effect.runPromise(effectInterface.signMessage(address, payload)),
    Effect: effectInterface
  }
}

/**
 * Create an ApiWallet from CIP-30 wallet API
 */
const createApiWallet = (_network: WalletNew.Network, config: ApiWalletConfig): WalletNew.ApiWallet => {
  const api = config.api
  let cachedAddress: Address.Address | null = null
  let cachedReward: RewardAddress.RewardAddress | null = null

  const getPrimaryAddress = Effect.gen(function* () {
    if (cachedAddress) return cachedAddress
    const used = yield* Effect.tryPromise({
      try: () => api.getUsedAddresses(),
      catch: (cause) => new WalletNew.WalletError({ message: "Failed to get used addresses", cause })
    })
    const unused = yield* Effect.tryPromise({
      try: () => api.getUnusedAddresses(),
      catch: (cause) => new WalletNew.WalletError({ message: "Failed to get unused addresses", cause })
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
      catch: (cause) => new WalletNew.WalletError({ message: "Failed to get reward addresses", cause })
    })
    cachedReward = rewards[0] ?? null
    return cachedReward
  })

  // Effect implementations are the source of truth
  const effectInterface: WalletNew.ApiWalletEffect = {
    address: getPrimaryAddress,
    rewardAddress: getPrimaryRewardAddress,
    signTx: (txOrHex: Transaction.Transaction | string, _context?: { utxos?: ReadonlyArray<UTxO.UTxO> }) =>
      Effect.gen(function* () {
        const cbor = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        const witnessHex = yield* Effect.tryPromise({
          try: () => api.signTx(cbor, true),
          catch: (cause) => new WalletNew.WalletError({ message: "User rejected transaction signing", cause })
        })
        return yield* TransactionWitnessSet.Either.fromCBORHex(witnessHex).pipe(
          Effect.mapError((cause) => new WalletNew.WalletError({ message: "Failed to decode witness set", cause }))
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
          catch: (cause) => new WalletNew.WalletError({ message: "Failed to submit transaction", cause })
        })
      })
  }

  // Promise API runs the Effect implementations
  return {
    type: "api" as const,
    api,
    address: Effect.runPromise(effectInterface.address),
    rewardAddress: Effect.runPromise(effectInterface.rewardAddress),
    signTx: (txOrHex, context) => Effect.runPromise(effectInterface.signTx(txOrHex, context)),
    signMessage: (address, payload) => Effect.runPromise(effectInterface.signMessage(address, payload)),
    submitTx: (txOrHex) => Effect.runPromise(effectInterface.submitTx(txOrHex)),
    Effect: effectInterface
  }
}

/**
 * Create a SigningWalletClient - signing wallet only, no provider
 */
const createSigningWalletClient = (network: NetworkId, config: SeedWalletConfig): SigningWalletClient => {
  const walletNetwork = toWalletNetwork(network)
  const wallet = createSigningWallet(walletNetwork, config)
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
 * Create an ApiWalletClient - CIP-30 wallet only, no provider
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
 * Create a SigningClient - combines provider + signing wallet (seed or API)
 */
const createSigningClient = (
  network: NetworkId,
  providerConfig: ProviderConfig,
  walletConfig: SeedWalletConfig | ApiWalletConfig
): SigningClient => {
  const provider = createProvider(providerConfig)
  const walletNetwork = toWalletNetwork(network)

  // Create appropriate wallet based on type
  const wallet =
    walletConfig.type === "seed"
      ? createSigningWallet(walletNetwork, walletConfig)
      : createApiWallet(walletNetwork, walletConfig)

  // Effect implementations are the source of truth
  const effectInterface = {
    ...wallet.Effect,
    ...provider.Effect, // Provider methods override wallet methods (e.g., submitTx uses ProviderError not WalletError)
    // Wallet-scoped convenience methods as Effects - expose union types (Effect-TS idiom)
    getWalletUtxos: () =>
      Effect.flatMap(wallet.Effect.address, (addr) => provider.Effect.getUtxos(addr)),
    getWalletDelegation: () =>
      Effect.flatMap(wallet.Effect.rewardAddress, (rewardAddr) => {
        if (!rewardAddr) return Effect.fail(new Provider.ProviderError({ message: "No reward address configured", cause: null }))
        return provider.Effect.getDelegation(rewardAddr)
      }),
    newTx: (_utxos?: any) => {
      return Effect.fail(new Provider.ProviderError({ message: "newTx not yet implemented", cause: null }))
    }
  }

  // Combine provider + signing wallet via spreading
  return {
    ...provider,
    ...wallet,
    // Promise methods call Effect implementations
    getWalletUtxos: () => Effect.runPromise(effectInterface.getWalletUtxos()),
    getWalletDelegation: () => Effect.runPromise(effectInterface.getWalletDelegation()),
    newTx: (_utxos?: any) => Effect.runPromise(effectInterface.newTx(_utxos)),
    // Effect namespace
    Effect: effectInterface
  } 
}

// ============================================================================
// Step 2: Implement ProviderOnlyClient (provider + network)
// ============================================================================

/**
 * Create a ProviderOnlyClient - can query blockchain and submit transactions
 * The provider now has arrow functions as own properties, so spreading works!
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

// ============================================================================
// Step 1: Implement MinimalClient (simplest - just holds network context)
// ============================================================================

/**
 * Create a MinimalClient - the simplest client that only knows about the network
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

// ============================================================================
// Factory Function (overloaded for type safety)
// ============================================================================

// Most specific overloads first - wallet type determines client capability
// Provider + ReadOnly Wallet → ReadOnlyClient
export function createClient(config: {
  network?: NetworkId
  provider: ProviderConfig
  wallet: ReadOnlyWalletConfig
}): ReadOnlyClient

// Provider + Seed Wallet → SigningClient (TODO: implement)
export function createClient(config: {
  network?: NetworkId
  provider: ProviderConfig
  wallet: SeedWalletConfig
}): SigningClient

// Provider + API Wallet → SigningClient (TODO: implement)
export function createClient(config: {
  network?: NetworkId
  provider: ProviderConfig
  wallet: ApiWalletConfig
}): SigningClient

// Provider only → ProviderOnlyClient
export function createClient(config: { network?: NetworkId; provider: ProviderConfig }): ProviderOnlyClient

// ReadOnly Wallet only → ReadOnlyWalletClient
export function createClient(config: { network?: NetworkId; wallet: ReadOnlyWalletConfig }): ReadOnlyWalletClient

// Seed Wallet only → SigningWalletClient (TODO: implement)
export function createClient(config: { network?: NetworkId; wallet: SeedWalletConfig }): SigningWalletClient

// API Wallet only → ApiWalletClient (TODO: implement)
export function createClient(config: { network?: NetworkId; wallet: ApiWalletConfig }): ApiWalletClient

// Network only or minimal → MinimalClient
export function createClient(config?: { network?: NetworkId }): MinimalClient

// Implementation signature - handles all cases
export function createClient(config?: {
  network?: NetworkId
  provider?: ProviderConfig
  wallet?: WalletConfig
}):
  | MinimalClient
  | ProviderOnlyClient
  | ReadOnlyWalletClient
  | ReadOnlyClient
  | SigningClient
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
