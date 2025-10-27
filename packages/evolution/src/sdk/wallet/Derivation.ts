import { mnemonicToEntropy } from "@scure/bip39"
import { wordlist as English } from "@scure/bip39/wordlists/english"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import * as AddressEras from "../../core/AddressEras.js"
import * as BaseAddress from "../../core/BaseAddress.js"
import * as Bip32PrivateKey from "../../core/Bip32PrivateKey.js"
import * as EnterpriseAddress from "../../core/EnterpriseAddress.js"
import * as KeyHash from "../../core/KeyHash.js"
import * as PrivateKey from "../../core/PrivateKey.js"
import * as RewardAccount from "../../core/RewardAccount.js"
import type * as SdkAddress from "../Address.js"
import type * as SdkRewardAddress from "../RewardAddress.js"

export class DerivationError extends Data.TaggedError("DerivationError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Result of deriving keys and addresses from a seed or Bip32 root
 * - address: bech32 payment address (addr... / addr_test...)
 * - rewardAddress: bech32 reward address (stake... / stake_test...)
 * - paymentKey / stakeKey: ed25519e_sk bech32 private keys
 * - keyStore: Map of KeyHash hex -> PrivateKey for signing operations
 * - paymentKhHex / stakeKhHex: KeyHash hex strings for quick lookup
 */
export type SeedDerivationResult = {
  address: SdkAddress.Address
  rewardAddress: SdkRewardAddress.RewardAddress | undefined
  paymentKey: string
  stakeKey: string | undefined
  keyStore: Map<string, PrivateKey.PrivateKey>
  paymentKhHex: string
  stakeKhHex: string | undefined
}

export const walletFromSeed = (
  seed: string,
  options: {
    password?: string
    addressType?: "Base" | "Enterprise"
    accountIndex?: number
    network?: "Mainnet" | "Testnet" | "Custom"
  } = {}
): Effect.Effect<SeedDerivationResult, DerivationError | Bip32PrivateKey.Bip32PrivateKeyError> => {
  return Effect.gen(function* () {
    const { accountIndex = 0, addressType = "Base", network = "Mainnet" } = options
    const entropy = yield* Effect.try({
      try: () => mnemonicToEntropy(seed, English),
      catch: (cause) => new DerivationError({ message: "Invalid seed phrase", cause })
    })
    const rootXPrv = yield* Bip32PrivateKey.Either.fromBip39Entropy(entropy, options?.password ?? "")
    const paymentNode = yield* Bip32PrivateKey.Either.derive(
      rootXPrv,
      Bip32PrivateKey.CardanoPath.paymentIndices(accountIndex, 0)
    )
    const stakeNode = yield* Bip32PrivateKey.Either.derive(
      rootXPrv,
      Bip32PrivateKey.CardanoPath.stakeIndices(accountIndex, 0)
    )
    const paymentKey = Bip32PrivateKey.toPrivateKey(paymentNode)
    const stakeKey = Bip32PrivateKey.toPrivateKey(stakeNode)

    const paymentKeyHash = KeyHash.fromPrivateKey(paymentKey)
    const stakeKeyHash = KeyHash.fromPrivateKey(stakeKey)
    const networkId = network === "Mainnet" ? 1 : 0

    const address =
      addressType === "Base"
        ? yield* Effect.try({
            try: () => {
              const result = AddressEras.Either.toBech32(
                new BaseAddress.BaseAddress({
                  networkId,
                  paymentCredential: paymentKeyHash,
                  stakeCredential: stakeKeyHash
                })
              )
              if (result._tag === "Left") throw result.left
              return result.right
            },
            catch: (cause) => new DerivationError({ message: (cause as Error).message, cause: cause as Error })
          })
        : yield* Effect.try({
            try: () => {
              const result = AddressEras.Either.toBech32(
                new EnterpriseAddress.EnterpriseAddress({
                  networkId,
                  paymentCredential: paymentKeyHash
                })
              )
              if (result._tag === "Left") throw result.left
              return result.right
            },
            catch: (cause) => new DerivationError({ message: (cause as Error).message, cause: cause as Error })
          })

    const rewardAddress =
      addressType === "Base"
        ? yield* Effect.try({
            try: () => {
              const result = AddressEras.Either.toBech32(
                new RewardAccount.RewardAccount({
                  networkId,
                  stakeCredential: stakeKeyHash
                })
              )
              if (result._tag === "Left") throw result.left
              return result.right
            },
            catch: (cause) => new DerivationError({ message: (cause as Error).message, cause: cause as Error })
          })
        : undefined

    // Build keyStore: map KeyHash hex -> PrivateKey for signing
    const keyStore = new Map<string, PrivateKey.PrivateKey>()
    const paymentKhHex = KeyHash.toHex(paymentKeyHash)
    keyStore.set(paymentKhHex, paymentKey)

    let stakeKhHex: string | undefined
    if (addressType === "Base") {
      stakeKhHex = KeyHash.toHex(stakeKeyHash)
      keyStore.set(stakeKhHex, stakeKey)
    }

    return {
      address,
      rewardAddress,
      paymentKey: PrivateKey.toBech32(paymentKey),
      stakeKey: addressType === "Base" ? PrivateKey.toBech32(stakeKey) : undefined,
      keyStore,
      paymentKhHex,
      stakeKhHex
    }
  })
}
/**
 * Derive only the bech32 private keys (ed25519e_sk...) from a seed.
 */
export function keysFromSeed(
  seed: string,
  options: {
    password?: string
    accountIndex?: number
  } = {}
): { paymentKey: string; stakeKey: string } {
  const { accountIndex = 0 } = options
  const entropy = mnemonicToEntropy(seed, English)
  const rootXPrv = Bip32PrivateKey.fromBip39Entropy(entropy, options?.password ?? "")
  const paymentNode = Bip32PrivateKey.derive(rootXPrv, Bip32PrivateKey.CardanoPath.paymentIndices(accountIndex, 0))
  const stakeNode = Bip32PrivateKey.derive(rootXPrv, Bip32PrivateKey.CardanoPath.stakeIndices(accountIndex, 0))
  const paymentKey = Bip32PrivateKey.toPrivateKey(paymentNode)
  const stakeKey = Bip32PrivateKey.toPrivateKey(stakeNode)
  return { paymentKey: PrivateKey.toBech32(paymentKey), stakeKey: PrivateKey.toBech32(stakeKey) }
}

/**
 * Derive only addresses (payment and optional reward) from a seed.
 */
export function addressFromSeed(
  seed: string,
  options: {
    password?: string
    addressType?: "Base" | "Enterprise"
    accountIndex?: number
    network?: "Mainnet" | "Testnet" | "Custom"
  } = {}
): { address: SdkAddress.Address; rewardAddress: SdkRewardAddress.RewardAddress | undefined } {
  const { accountIndex = 0, addressType = "Base", network = "Mainnet" } = options
  const entropy = mnemonicToEntropy(seed, English)
  const rootXPrv = Bip32PrivateKey.fromBip39Entropy(entropy, options?.password ?? "")
  const paymentNode = Bip32PrivateKey.derive(rootXPrv, Bip32PrivateKey.CardanoPath.paymentIndices(accountIndex, 0))
  const stakeNode = Bip32PrivateKey.derive(rootXPrv, Bip32PrivateKey.CardanoPath.stakeIndices(accountIndex, 0))
  const paymentKey = Bip32PrivateKey.toPrivateKey(paymentNode)
  const stakeKey = Bip32PrivateKey.toPrivateKey(stakeNode)

  const paymentKeyHash = KeyHash.fromPrivateKey(paymentKey)
  const stakeKeyHash = KeyHash.fromPrivateKey(stakeKey)
  const networkId = network === "Mainnet" ? 1 : 0

  const address =
    addressType === "Base"
      ? AddressEras.toBech32(
          new BaseAddress.BaseAddress({
            networkId,
            paymentCredential: paymentKeyHash,
            stakeCredential: stakeKeyHash
          })
        )
      : AddressEras.toBech32(
          new EnterpriseAddress.EnterpriseAddress({
            networkId,
            paymentCredential: paymentKeyHash
          })
        )

  const rewardAddress =
    addressType === "Base"
      ? AddressEras.toBech32(
          new RewardAccount.RewardAccount({
            networkId,
            stakeCredential: stakeKeyHash
          })
        )
      : undefined

  return { address, rewardAddress }
}

/**
 * Same as walletFromSeed but accepts a Bip32 root key directly.
 */
export function walletFromBip32(
  rootXPrv: Bip32PrivateKey.Bip32PrivateKey,
  options: {
    addressType?: "Base" | "Enterprise"
    accountIndex?: number
    network?: "Mainnet" | "Testnet" | "Custom"
  } = {}
): SeedDerivationResult {
  const { accountIndex = 0, addressType = "Base", network = "Mainnet" } = options
  const paymentNode = Bip32PrivateKey.derive(rootXPrv, Bip32PrivateKey.CardanoPath.paymentIndices(accountIndex, 0))
  const stakeNode = Bip32PrivateKey.derive(rootXPrv, Bip32PrivateKey.CardanoPath.stakeIndices(accountIndex, 0))
  const paymentKey = Bip32PrivateKey.toPrivateKey(paymentNode)
  const stakeKey = Bip32PrivateKey.toPrivateKey(stakeNode)

  const paymentKeyHash = KeyHash.fromPrivateKey(paymentKey)
  const stakeKeyHash = KeyHash.fromPrivateKey(stakeKey)
  const networkId = network === "Mainnet" ? 1 : 0

  const address =
    addressType === "Base"
      ? AddressEras.toBech32(
          new BaseAddress.BaseAddress({
            networkId,
            paymentCredential: paymentKeyHash,
            stakeCredential: stakeKeyHash
          })
        )
      : AddressEras.toBech32(
          new EnterpriseAddress.EnterpriseAddress({
            networkId,
            paymentCredential: paymentKeyHash
          })
        )

  const rewardAddress =
    addressType === "Base"
      ? AddressEras.toBech32(
          new RewardAccount.RewardAccount({
            networkId,
            stakeCredential: stakeKeyHash
          })
        )
      : undefined

  // Build keyStore
  const keyStore = new Map<string, PrivateKey.PrivateKey>()
  const paymentKhHex = KeyHash.toHex(paymentKeyHash)
  keyStore.set(paymentKhHex, paymentKey)

  let stakeKhHex: string | undefined
  if (addressType === "Base") {
    stakeKhHex = KeyHash.toHex(stakeKeyHash)
    keyStore.set(stakeKhHex, stakeKey)
  }

  return {
    address,
    rewardAddress,
    paymentKey: PrivateKey.toBech32(paymentKey),
    stakeKey: addressType === "Base" ? PrivateKey.toBech32(stakeKey) : undefined,
    keyStore,
    paymentKhHex,
    stakeKhHex
  }
}

/**
 * Build an address (enterprise by default) from an already-derived payment private key.
 * Optionally provide a stake private key to get a base address + reward address.
 */
export function walletFromPrivateKey(
  paymentKeyBech32: string,
  options: {
    stakeKeyBech32?: string
    addressType?: "Base" | "Enterprise"
    network?: "Mainnet" | "Testnet" | "Custom"
  } = {}
): Effect.Effect<SeedDerivationResult, DerivationError> {
  return Effect.gen(function* () {
    const { stakeKeyBech32, addressType = stakeKeyBech32 ? "Base" : "Enterprise", network = "Mainnet" } = options
    
    // Use the Effect-based Either API from PrivateKey module - can yield directly on Either
    const paymentKey = yield* Effect.mapError(
      // PrivateKey.Either.fromBech32(paymentKeyBech32),
      Schema.decode(PrivateKey.FromBech32)(paymentKeyBech32),
      (cause) => new DerivationError({ message: cause.message, cause })
    )
    const paymentKeyHash = KeyHash.fromPrivateKey(paymentKey)

    const networkId = network === "Mainnet" ? 1 : 0
    
    let address: string
    let stakeKey: PrivateKey.PrivateKey | undefined
    let stakeKeyHash: KeyHash.KeyHash | undefined
    
    if (addressType === "Base") {
      if (!stakeKeyBech32) {
        return yield* Effect.fail(new DerivationError({ message: "stakeKeyBech32 required for Base address" }))
      }
      stakeKey = yield* Effect.mapError(
        PrivateKey.Either.fromBech32(stakeKeyBech32),
        (cause) => new DerivationError({ message: cause.message, cause })
      )
      stakeKeyHash = KeyHash.fromPrivateKey(stakeKey)
      address = AddressEras.toBech32(
        new BaseAddress.BaseAddress({ networkId, paymentCredential: paymentKeyHash, stakeCredential: stakeKeyHash })
      )
    } else {
      address = AddressEras.toBech32(
        new EnterpriseAddress.EnterpriseAddress({ networkId, paymentCredential: paymentKeyHash })
      )
    }

    const rewardAddress =
      addressType === "Base" && stakeKeyHash
        ? AddressEras.toBech32(new RewardAccount.RewardAccount({ networkId, stakeCredential: stakeKeyHash }))
        : undefined

    // Build keyStore
    const keyStore = new Map<string, PrivateKey.PrivateKey>()
    const paymentKhHex = KeyHash.toHex(paymentKeyHash)
    keyStore.set(paymentKhHex, paymentKey)

    let stakeKhHex: string | undefined
    if (addressType === "Base" && stakeKey && stakeKeyHash) {
      stakeKhHex = KeyHash.toHex(stakeKeyHash)
      keyStore.set(stakeKhHex, stakeKey)
    }

    return {
      address,
      rewardAddress,
      paymentKey: paymentKeyBech32,
      stakeKey: stakeKeyBech32,
      keyStore,
      paymentKhHex,
      stakeKhHex
    }
  })
}
