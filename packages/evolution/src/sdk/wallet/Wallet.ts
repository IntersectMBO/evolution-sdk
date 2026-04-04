/**
 * @todo Once `ClientImpl.ts` (the legacy client path) is removed, this module
 * should be refactored:
 *
 * - Rename to `Signing.ts` — the core concern is signing logic, not "wallet" as
 *   an abstraction.
 * - Drop the `SigningWallet`, `ReadOnlyWallet`, and `ApiWallet` typed objects
 *   (with their Promise wrappers and `.type` discriminants) — these only exist
 *   to serve `ClientImpl.ts`. In the new composable client, capabilities are
 *   what matter and the wallet-as-object pattern is not needed.
 * - Keep: `WalletError`, `Payload`, `SignedMessage`, `WalletApi`, the `*Effect`
 *   interfaces, and the Effect-only factories (`makeSigningWalletEffect`, etc.).
 * - `Wallets.ts` would then import from `Signing.ts` directly.
 */
import { Data, Effect, Equal, ParseResult, Schema } from "effect"

import * as CoreAddress from "../../Address.js"
import * as Bytes from "../../Bytes.js"
import * as KeyHash from "../../KeyHash.js"
import { COSESign1FromCBORBytes } from "../../message-signing/CoseSign1.js"
import * as MessageSignData from "../../message-signing/SignData.js"
import type * as NativeScripts from "../../NativeScripts.js"
import * as PrivateKey from "../../PrivateKey.js"
import * as CoreRewardAccount from "../../RewardAccount.js"
import * as CoreRewardAddress from "../../RewardAddress.js"
import * as Transaction from "../../Transaction.js"
import * as TransactionHash from "../../TransactionHash.js"
import * as TransactionWitnessSet from "../../TransactionWitnessSet.js"
import { hashTransaction, hashTransactionRaw } from "../../utils/Hash.js"
import * as CoreUTxO from "../../UTxO.js"
import * as VKey from "../../VKey.js"
import type { EffectToPromiseAPI } from "../Type.js"
import * as Derivation from "./Derivation.js"

/**
 * Error class for wallet-related operations.
 *
 * @since 2.0.0
 * @category errors
 */
export class WalletError extends Data.TaggedError("WalletError")<{
  message?: string
  cause?: unknown
}> {}

/**
 * Payload for message signing - either a string or raw bytes.
 *
 * @since 2.0.0
 * @category model
 */
export type Payload = string | Uint8Array

/**
 * Signed message containing the original payload and its cryptographic signature.
 *
 * @since 2.0.0
 * @category model
 */
export interface SignedMessage {
  readonly payload: Payload
  readonly signature: string
}

/**
 * Network identifier for wallet operations.
 *
 * @since 2.0.0
 * @category model
 */
export type Network = "Mainnet" | "Testnet" | "Custom"

/**
 * Read-only wallet Effect interface.
 *
 * @since 2.0.0
 * @category model
 */
export interface ReadOnlyWalletEffect {
  readonly address: () => Effect.Effect<CoreAddress.Address, WalletError>
  readonly rewardAddress: () => Effect.Effect<CoreRewardAddress.RewardAddress | null, WalletError>
}

/**
 * Read-only wallet interface (Promise + Effect dual API).
 * Used by the legacy client path.
 *
 * @since 2.0.0
 * @category model
 */
export interface ReadOnlyWallet extends EffectToPromiseAPI<ReadOnlyWalletEffect> {
  readonly Effect: ReadOnlyWalletEffect
  readonly type: "read-only"
}

/**
 * Signing wallet Effect interface.
 *
 * @since 2.0.0
 * @category model
 */
export interface SigningWalletEffect extends ReadOnlyWalletEffect {
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  readonly signMessage: (
    address: CoreAddress.Address | CoreRewardAddress.RewardAddress,
    payload: Payload
  ) => Effect.Effect<SignedMessage, WalletError>
}

/**
 * Signing wallet interface (Promise + Effect dual API).
 * Used by the legacy client path.
 *
 * @since 2.0.0
 * @category model
 */
export interface SigningWallet extends EffectToPromiseAPI<SigningWalletEffect> {
  readonly Effect: SigningWalletEffect
  readonly type: "signing"
}

/**
 * CIP-30 compatible wallet API interface.
 *
 * @since 2.0.0
 * @category model
 */
export interface WalletApi {
  getUsedAddresses(): Promise<ReadonlyArray<string>>
  getUnusedAddresses(): Promise<ReadonlyArray<string>>
  getRewardAddresses(): Promise<ReadonlyArray<string>>
  getUtxos(): Promise<ReadonlyArray<string>>
  signTx(txCborHex: string, partialSign: boolean): Promise<string>
  signData(addressHex: string, payload: Payload): Promise<SignedMessage>
  submitTx(txCborHex: string): Promise<string>
}

/**
 * API wallet Effect interface for CIP-30 compatible wallets.
 *
 * @since 2.0.0
 * @category model
 */
export interface ApiWalletEffect extends ReadOnlyWalletEffect {
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  readonly signMessage: (
    address: CoreAddress.Address | CoreRewardAddress.RewardAddress,
    payload: Payload
  ) => Effect.Effect<SignedMessage, WalletError>
  readonly submitTx: (
    tx: Transaction.Transaction | string
  ) => Effect.Effect<TransactionHash.TransactionHash, WalletError>
}

/**
 * API wallet interface (Promise + Effect dual API).
 * Used by the legacy client path.
 *
 * @since 2.0.0
 * @category model
 */
export interface ApiWallet extends EffectToPromiseAPI<ApiWalletEffect> {
  readonly Effect: ApiWalletEffect
  readonly api: WalletApi
  readonly type: "api"
}

// ── Private helpers ───────────────────────────────────────────────────────────

const toSignDataAddressHex = (address: CoreAddress.Address | CoreRewardAddress.RewardAddress): string =>
  address instanceof CoreAddress.Address
    ? CoreAddress.toHex(address)
    : CoreRewardAccount.toHex(CoreRewardAccount.fromBech32(address))

const signPayload = (
  address: CoreAddress.Address | CoreRewardAddress.RewardAddress,
  payload: Payload,
  paymentSigningKeyBech32: string
): SignedMessage => {
  const paymentSigningKey = PrivateKey.fromBech32(paymentSigningKeyBech32)
  const payloadBytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload
  const signed = MessageSignData.signData(toSignDataAddressHex(address), payloadBytes, paymentSigningKey)
  const coseSign1 = Schema.decodeSync(COSESign1FromCBORBytes())(signed.signature)
  return { payload, signature: coseSign1.toUserFacingEncoding() }
}

const extractKeyHashesFromNativeScript = (script: NativeScripts.NativeScriptVariants): Set<string> => {
  const keyHashes = new Set<string>()
  const traverse = (current: NativeScripts.NativeScriptVariants): void => {
    switch (current._tag) {
      case "ScriptPubKey":
        keyHashes.add(Bytes.toHex(current.keyHash))
        break
      case "ScriptAll":
      case "ScriptAny":
      case "ScriptNOfK":
        for (const nested of current.scripts) traverse(nested)
        break
      case "InvalidBefore":
      case "InvalidHereafter":
        break
    }
  }
  traverse(script)
  return keyHashes
}

const computeRequiredKeyHashes = (params: {
  paymentKhHex?: string
  rewardAddress?: CoreRewardAddress.RewardAddress | null
  stakeKhHex?: string
  tx: Transaction.Transaction
  utxos: ReadonlyArray<CoreUTxO.UTxO>
  referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO>
}): Set<string> => {
  const required = new Set<string>()

  if (params.tx.body.requiredSigners) {
    for (const keyHash of params.tx.body.requiredSigners) required.add(KeyHash.toHex(keyHash))
  }

  if (params.tx.witnessSet.nativeScripts) {
    for (const ns of params.tx.witnessSet.nativeScripts) {
      for (const kh of extractKeyHashesFromNativeScript(ns.script)) required.add(kh)
    }
  }

  if (params.referenceUtxos) {
    for (const utxo of params.referenceUtxos) {
      if (utxo.scriptRef?._tag === "NativeScript") {
        for (const kh of extractKeyHashesFromNativeScript(utxo.scriptRef.script)) required.add(kh)
      }
    }
  }

  const ownedRefs = new Set<string>(params.utxos.map(CoreUTxO.toOutRefString))

  const checkInputs = (inputs?: ReadonlyArray<Transaction.Transaction["body"]["inputs"][number]>) => {
    if (!inputs || !params.paymentKhHex) return
    for (const input of inputs) {
      const key = `${TransactionHash.toHex(input.transactionId)}#${Number(input.index)}`
      if (ownedRefs.has(key)) required.add(params.paymentKhHex)
    }
  }
  checkInputs(params.tx.body.inputs)
  if (params.tx.body.collateralInputs) checkInputs(params.tx.body.collateralInputs)

  if (params.tx.body.withdrawals && params.rewardAddress && params.stakeKhHex) {
    const ourReward = Schema.decodeSync(CoreRewardAccount.FromBech32)(params.rewardAddress)
    for (const [rewardAccount] of params.tx.body.withdrawals.withdrawals.entries()) {
      if (Equal.equals(ourReward, rewardAccount)) {
        required.add(params.stakeKhHex)
        break
      }
    }
  }

  if (params.tx.body.certificates && params.stakeKhHex) {
    for (const cert of params.tx.body.certificates) {
      const credential =
        cert._tag === "StakeRegistration" ||
        cert._tag === "StakeDeregistration" ||
        cert._tag === "StakeDelegation" ||
        cert._tag === "RegCert" ||
        cert._tag === "UnregCert" ||
        cert._tag === "StakeVoteDelegCert" ||
        cert._tag === "StakeRegDelegCert" ||
        cert._tag === "StakeVoteRegDelegCert" ||
        cert._tag === "VoteDelegCert" ||
        cert._tag === "VoteRegDelegCert"
          ? cert.stakeCredential
          : undefined
      if (credential?._tag === "KeyHash" && KeyHash.toHex(credential) === params.stakeKhHex) {
        required.add(params.stakeKhHex)
      }
    }
  }

  return required
}

/**
 * Shared signTx + signMessage Effect implementation built from a derivation result.
 * Both seed and private-key wallets use this — the only difference is how derivation is obtained.
 */
const buildSigningWalletEffect = (
  derivationEffect: Effect.Effect<Derivation.SeedDerivationResult, WalletError>
): SigningWalletEffect => ({
  address: () => Effect.map(derivationEffect, (d) => d.address),
  rewardAddress: () => Effect.map(derivationEffect, (d) => d.rewardAddress ?? null),
  signTx: (txOrHex, context) =>
    Effect.gen(function* () {
      const derivation = yield* derivationEffect
      const tx =
        typeof txOrHex === "string"
          ? yield* ParseResult.decodeUnknownEither(Transaction.FromCBORHex())(txOrHex).pipe(
              Effect.mapError((cause) => new WalletError({ message: `Failed to decode transaction: ${cause}`, cause }))
            )
          : txOrHex

      const required = computeRequiredKeyHashes({
        paymentKhHex: derivation.paymentKhHex,
        rewardAddress: derivation.rewardAddress ?? null,
        stakeKhHex: derivation.stakeKhHex,
        tx,
        utxos: context?.utxos ?? [],
        referenceUtxos: context?.referenceUtxos ?? []
      })

      const txHash =
        typeof txOrHex === "string"
          ? hashTransactionRaw(Transaction.extractBodyBytes(Bytes.fromHex(txOrHex)))
          : hashTransaction(tx.body)

      const witnesses: Array<TransactionWitnessSet.VKeyWitness> = []
      const seenVKeys = new Set<string>()
      for (const keyHash of required) {
        const signingKey = derivation.keyStore.get(keyHash)
        if (!signingKey) continue
        const vk = VKey.fromPrivateKey(signingKey)
        const vkHex = VKey.toHex(vk)
        if (seenVKeys.has(vkHex)) continue
        seenVKeys.add(vkHex)
        witnesses.push(
          new TransactionWitnessSet.VKeyWitness({ vkey: vk, signature: PrivateKey.sign(signingKey, txHash.hash) })
        )
      }

      return witnesses.length > 0
        ? TransactionWitnessSet.fromVKeyWitnesses(witnesses)
        : TransactionWitnessSet.empty()
    }),
  signMessage: (address, payload) =>
    Effect.map(derivationEffect, (d) => signPayload(address, payload, d.paymentKey))
})

// ── Effect-only factories (new client API) ────────────────────────────────────

/**
 * Create a signing wallet Effect interface from a mnemonic seed phrase.
 * Returns the Effect interface only — no Promise wrapping.
 *
 * @since 2.1.0
 * @category constructors
 */
export const makeSigningWalletEffect = (
  networkId: 0 | 1,
  seed: string,
  options: {
    accountIndex?: number
    paymentIndex?: number
    stakeIndex?: number
    addressType?: "Base" | "Enterprise"
    password?: string
  } = {}
): SigningWalletEffect => {
  const derivationEffect = Derivation.walletFromSeed(seed, { ...options, networkId }).pipe(
    Effect.mapError((cause) => new WalletError({ message: cause.message, cause }))
  )
  return buildSigningWalletEffect(derivationEffect)
}

/**
 * Create a signing wallet Effect interface from a bech32 private key.
 * Returns the Effect interface only — no Promise wrapping.
 *
 * @since 2.1.0
 * @category constructors
 */
export const makePrivateKeyWalletEffect = (
  networkId: 0 | 1,
  paymentKey: string,
  options: {
    stakeKey?: string
    addressType?: "Base" | "Enterprise"
  } = {}
): SigningWalletEffect => {
  const derivationEffect = Derivation.walletFromPrivateKey(paymentKey, {
    stakeKeyBech32: options.stakeKey,
    addressType: options.addressType,
    networkId
  }).pipe(Effect.mapError((cause) => new WalletError({ message: cause.message, cause })))
  return buildSigningWalletEffect(derivationEffect)
}

/**
 * Create a CIP-30 API wallet Effect interface.
 * Returns the Effect interface only — no Promise wrapping.
 *
 * @since 2.1.0
 * @category constructors
 */
export const makeApiWalletEffect = (api: WalletApi): ApiWalletEffect => {
  let cachedAddress: CoreAddress.Address | null = null
  let cachedRewardAddress: CoreRewardAddress.RewardAddress | null = null
  let hasLoadedRewardAddress = false

  const getPrimaryAddress = Effect.gen(function* () {
    if (cachedAddress) return cachedAddress
    const usedAddresses = yield* Effect.tryPromise({
      try: () => api.getUsedAddresses(),
      catch: (cause) => new WalletError({ message: (cause as Error).message, cause })
    })
    const unusedAddresses = yield* Effect.tryPromise({
      try: () => api.getUnusedAddresses(),
      catch: (cause) => new WalletError({ message: (cause as Error).message, cause })
    })
    const addressString = usedAddresses[0] ?? unusedAddresses[0]
    if (!addressString) {
      return yield* Effect.fail(new WalletError({ message: "Wallet API returned no addresses", cause: undefined }))
    }
    try {
      cachedAddress = CoreAddress.fromBech32(addressString)
    } catch {
      try {
        cachedAddress = CoreAddress.fromHex(addressString)
      } catch (cause) {
        return yield* Effect.fail(
          new WalletError({ message: `Invalid address format from wallet: ${addressString}`, cause })
        )
      }
    }
    return cachedAddress
  })

  const getPrimaryRewardAddress = Effect.gen(function* () {
    if (hasLoadedRewardAddress) return cachedRewardAddress
    const rewardAddresses = yield* Effect.tryPromise({
      try: () => api.getRewardAddresses(),
      catch: (cause) => new WalletError({ message: (cause as Error).message, cause })
    })
    cachedRewardAddress = rewardAddresses[0]
      ? Schema.decodeSync(CoreRewardAddress.RewardAddress)(rewardAddresses[0])
      : null
    hasLoadedRewardAddress = true
    return cachedRewardAddress
  })

  return {
    address: () => getPrimaryAddress,
    rewardAddress: () => getPrimaryRewardAddress,
    signTx: (txOrHex) =>
      Effect.gen(function* () {
        const cborHex = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        const witnessHex = yield* Effect.tryPromise({
          try: () => api.signTx(cborHex, true),
          catch: (cause) => new WalletError({ message: "User rejected transaction signing", cause })
        })
        return yield* ParseResult.decodeUnknownEither(TransactionWitnessSet.FromCBORHex())(witnessHex).pipe(
          Effect.mapError((cause) => new WalletError({ message: `Failed to decode witness set: ${cause}`, cause }))
        )
      }),
    signMessage: (address, payload) =>
      Effect.gen(function* () {
        const addressString = address instanceof CoreAddress.Address ? CoreAddress.toBech32(address) : address
        const result = yield* Effect.tryPromise({
          try: () => api.signData(addressString, payload),
          catch: (cause) => new WalletError({ message: "User rejected message signing", cause })
        })
        return { payload, signature: result.signature }
      }),
    submitTx: (txOrHex) =>
      Effect.gen(function* () {
        const cborHex = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        const txHashHex = yield* Effect.tryPromise({
          try: () => api.submitTx(cborHex),
          catch: (cause) => new WalletError({ message: (cause as Error).message, cause })
        })
        return Schema.decodeSync(TransactionHash.FromHex)(txHashHex)
      })
  }
}

/**
 * Create a read-only wallet Effect interface from a pre-parsed address.
 * Returns the Effect interface only — no Promise wrapping.
 *
 * @since 2.1.0
 * @category constructors
 */
export const makeReadOnlyWalletEffect = (
  address: CoreAddress.Address,
  rewardAddress: CoreRewardAddress.RewardAddress | null = null
): ReadOnlyWalletEffect => ({
  address: () => Effect.succeed(address),
  rewardAddress: () => Effect.succeed(rewardAddress)
})
