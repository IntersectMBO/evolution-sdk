/**
 * Wallet constructors for the client API.
 *
 * `readOnlyWallet` and `cip30Wallet` return wallet instances directly.
 * `seedWallet` and `privateKeyWallet` return chain-aware factories —
 * pass them to `createClient` and chain context is injected automatically.
 *
 * @since 2.1.0
 * @module
 */

import { Effect, Equal, ParseResult, Schema } from "effect"

import * as CoreAddress from "../../Address.js"
import * as Bytes from "../../Bytes.js"
import * as Ed25519Signature from "../../Ed25519Signature.js"
import * as KeyHash from "../../KeyHash.js"
import type * as NativeScripts from "../../NativeScripts.js"
import * as PoolKeyHash from "../../PoolKeyHash.js"
import * as PrivateKey from "../../PrivateKey.js"
import * as CoreRewardAccount from "../../RewardAccount.js"
import * as CoreRewardAddress from "../../RewardAddress.js"
import * as Transaction from "../../Transaction.js"
import * as TransactionHash from "../../TransactionHash.js"
import * as TransactionWitnessSet from "../../TransactionWitnessSet.js"
import { runEffectPromise } from "../../utils/effect-runtime.js"
import { hashTransaction, hashTransactionRaw } from "../../utils/Hash.js"
import * as CoreUTxO from "../../UTxO.js"
import * as VKey from "../../VKey.js"
import * as Derivation from "../wallet/Derivation.js"
import * as WalletNew from "../wallet/WalletNew.js"
import type { Chain } from "./Chain.js"

// ── Internal helpers ──────────────────────────────────────────────────────────

const extractKeyHashesFromNativeScript = (script: NativeScripts.NativeScriptVariants): Set<string> => {
  const keyHashes = new Set<string>()
  const traverse = (s: NativeScripts.NativeScriptVariants): void => {
    switch (s._tag) {
      case "ScriptPubKey":
        keyHashes.add(Bytes.toHex(s.keyHash))
        break
      case "ScriptAll":
      case "ScriptAny":
        for (const nested of s.scripts) traverse(nested)
        break
      case "ScriptNOfK":
        for (const nested of s.scripts) traverse(nested)
        break
    }
  }
  traverse(script)
  return keyHashes
}

const computeRequiredKeyHashesSync = (params: {
  paymentKhHex?: string
  rewardAddress?: CoreRewardAddress.RewardAddress | null
  stakeKhHex?: string
  tx: Transaction.Transaction
  utxos: ReadonlyArray<CoreUTxO.UTxO>
  referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO>
}): Set<string> => {
  const required = new Set<string>()

  if (params.tx.body.requiredSigners) {
    for (const kh of params.tx.body.requiredSigners) required.add(KeyHash.toHex(kh))
  }

  if (params.tx.witnessSet.nativeScripts) {
    for (const nativeScript of params.tx.witnessSet.nativeScripts) {
      const scriptKeyHashes = extractKeyHashesFromNativeScript(nativeScript.script)
      for (const kh of scriptKeyHashes) required.add(kh)
    }
  }

  if (params.referenceUtxos) {
    for (const utxo of params.referenceUtxos) {
      if (utxo.scriptRef && utxo.scriptRef._tag === "NativeScript") {
        const scriptKeyHashes = extractKeyHashesFromNativeScript(utxo.scriptRef.script)
        for (const kh of scriptKeyHashes) required.add(kh)
      }
    }
  }

  const ownedRefs = new Set<string>(params.utxos.map((u) => CoreUTxO.toOutRefString(u)))
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

  if (params.tx.body.withdrawals && params.rewardAddress && params.stakeKhHex) {
    const ourReward = Schema.decodeSync(CoreRewardAccount.FromBech32)(params.rewardAddress)
    for (const [rewardAcc] of params.tx.body.withdrawals.withdrawals.entries()) {
      if (Equal.equals(ourReward, rewardAcc)) {
        required.add(params.stakeKhHex)
        break
      }
    }
  }

  if (params.tx.body.certificates && (params.stakeKhHex || params.paymentKhHex)) {
    for (const cert of params.tx.body.certificates) {
      // Stake credential certs — require stake key
      if (params.stakeKhHex) {
        const stakeCred =
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
        if (stakeCred && stakeCred._tag === "KeyHash") {
          const khHex = KeyHash.toHex(stakeCred)
          if (khHex === params.stakeKhHex) required.add(params.stakeKhHex)
        }

        // DRep credential certs — DRep key is typically the stake key
        const drepCred =
          cert._tag === "RegDrepCert" || cert._tag === "UnregDrepCert" || cert._tag === "UpdateDrepCert"
            ? cert.drepCredential
            : undefined
        if (drepCred && drepCred._tag === "KeyHash") {
          const khHex = KeyHash.toHex(drepCred)
          if (khHex === params.stakeKhHex) required.add(params.stakeKhHex)
        }

        // Committee cold credential certs — cold key is typically the stake key
        const committeeColdCred =
          cert._tag === "AuthCommitteeHotCert" || cert._tag === "ResignCommitteeColdCert"
            ? cert.committeeColdCredential
            : undefined
        if (committeeColdCred && committeeColdCred._tag === "KeyHash") {
          const khHex = KeyHash.toHex(committeeColdCred)
          if (khHex === params.stakeKhHex) required.add(params.stakeKhHex)
        }
      }

      // Pool certs — pool operator key is typically the payment key
      if (params.paymentKhHex) {
        if (cert._tag === "PoolRegistration") {
          const operatorHex = PoolKeyHash.toHex(cert.poolParams.operator)
          if (operatorHex === params.paymentKhHex) required.add(params.paymentKhHex)
        }
        if (cert._tag === "PoolRetirement") {
          const poolKhHex = PoolKeyHash.toHex(cert.poolKeyHash)
          if (poolKhHex === params.paymentKhHex) required.add(params.paymentKhHex)
        }
      }
    }
  }

  return required
}

const makeSigningWalletEffect = (
  derivationEffect: Effect.Effect<Derivation.SeedDerivationResult, WalletNew.WalletError>
): WalletNew.SigningWallet => {
  const effectInterface: WalletNew.SigningWalletEffect = {
    address: () => Effect.map(derivationEffect, (d) => d.address),
    rewardAddress: () => Effect.map(derivationEffect, (d) => d.rewardAddress ?? null),
    signTx: (
      txOrHex: Transaction.Transaction | string,
      context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
    ) =>
      Effect.gen(function* () {
        const derivation = yield* derivationEffect
        const tx =
          typeof txOrHex === "string"
            ? yield* ParseResult.decodeUnknownEither(Transaction.FromCBORHex())(txOrHex).pipe(
                Effect.mapError(
                  (cause) => new WalletNew.WalletError({ message: `Failed to decode transaction: ${cause}`, cause })
                )
              )
            : txOrHex
        const utxos = context?.utxos ?? []
        const referenceUtxos = context?.referenceUtxos ?? []
        const required = computeRequiredKeyHashesSync({
          paymentKhHex: derivation.paymentKhHex,
          rewardAddress: derivation.rewardAddress ?? null,
          stakeKhHex: derivation.stakeKhHex,
          tx,
          utxos,
          referenceUtxos
        })
        const txHash =
          typeof txOrHex === "string"
            ? hashTransactionRaw(Transaction.extractBodyBytes(Bytes.fromHex(txOrHex)))
            : hashTransaction(tx.body)
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
    signMessage: (address: CoreAddress.Address | CoreRewardAddress.RewardAddress, payload: WalletNew.Payload) =>
      Effect.gen(function* () {
        const derivation = yield* derivationEffect
        // Use stake key when signing for a reward address, payment key otherwise.
        // Reward addresses require the stake credential key per CIP-0008.
        const useStakeKey =
          typeof address === "string" && // RewardAddress is a branded string
          derivation.stakeKey !== undefined
        const sk = useStakeKey
          ? PrivateKey.fromBech32(derivation.stakeKey!)
          : PrivateKey.fromBech32(derivation.paymentKey)
        const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload
        const sig = PrivateKey.sign(sk, bytes)
        return { payload, signature: Ed25519Signature.toHex(sig) }
      })
  }
  return {
    type: "signing",
    address: () => runEffectPromise(effectInterface.address()),
    rewardAddress: () => runEffectPromise(effectInterface.rewardAddress()),
    signTx: (txOrHex, context) => runEffectPromise(effectInterface.signTx(txOrHex, context)),
    signMessage: (address, payload) => runEffectPromise(effectInterface.signMessage(address, payload)),
    Effect: effectInterface
  }
}

// ── Public wallet types ───────────────────────────────────────────────────────

/**
 * A chain-aware wallet factory — receives chain context at client construction time.
 * Returned by `seedWallet` and `privateKeyWallet`.
 *
 * @since 2.1.0
 * @category model
 */
export type WalletFactory = (chain: Chain) => WalletNew.SigningWallet

/**
 * Any wallet instance or factory accepted by `createClient`.
 *
 * @since 2.1.0
 * @category model
 */
export type AnyWallet = WalletNew.ReadOnlyWallet | WalletNew.SigningWallet | WalletNew.ApiWallet | WalletFactory

// ── Config types ──────────────────────────────────────────────────────────────

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

// ── Constructors ──────────────────────────────────────────────────────────────

/**
 * Read-only wallet — no signing capability.
 *
 * @example
 * ```ts
 * const c = createClient({ chain: mainnet, provider: blockfrost({...}), wallet: readOnlyWallet("addr1...") })
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const readOnlyWallet = (address: string, rewardAddress?: string): WalletNew.ReadOnlyWallet => {
  const coreAddress = CoreAddress.fromBech32(address)
  const coreRewardAddress = rewardAddress ? Schema.decodeSync(CoreRewardAddress.RewardAddress)(rewardAddress) : null
  const effectInterface: WalletNew.ReadOnlyWalletEffect = {
    address: () => Effect.succeed(coreAddress),
    rewardAddress: () => Effect.succeed(coreRewardAddress)
  }
  return {
    type: "read-only",
    address: () => Promise.resolve(coreAddress),
    rewardAddress: () => Promise.resolve(coreRewardAddress),
    Effect: effectInterface
  }
}

/**
 * Seed phrase wallet — returns a chain-aware factory.
 * Chain context (networkId) is injected automatically by `createClient`.
 *
 * @example
 * ```ts
 * const c = createClient({ chain: preview, provider: blockfrost({...}), wallet: seedWallet({ mnemonic: "..." }) })
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const seedWallet =
  (config: SeedWalletConfig): WalletFactory =>
  (chain: Chain): WalletNew.SigningWallet => {
    const network: WalletNew.Network = chain.id === 1 ? "Mainnet" : "Testnet"
    const derivationEffect = Derivation.walletFromSeed(config.mnemonic, {
      addressType: config.addressType ?? "Base",
      accountIndex: config.accountIndex ?? 0,
      paymentIndex: config.paymentIndex ?? 0,
      stakeIndex: config.stakeIndex ?? 0,
      password: config.password,
      network
    }).pipe(Effect.mapError((cause) => new WalletNew.WalletError({ message: cause.message, cause })))
    return makeSigningWalletEffect(derivationEffect)
  }

/**
 * Private key wallet — returns a chain-aware factory.
 * Chain context (networkId) is injected automatically by `createClient`.
 *
 * @example
 * ```ts
 * const c = createClient({ chain: mainnet, provider: blockfrost({...}), wallet: privateKeyWallet({ paymentKey: "ed25519e_sk..." }) })
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const privateKeyWallet =
  (config: PrivateKeyWalletConfig): WalletFactory =>
  (chain: Chain): WalletNew.SigningWallet => {
    const network: WalletNew.Network = chain.id === 1 ? "Mainnet" : "Testnet"
    const derivationEffect = Derivation.walletFromPrivateKey(config.paymentKey, {
      stakeKeyBech32: config.stakeKey,
      addressType: config.addressType ?? (config.stakeKey ? "Base" : "Enterprise"),
      network
    }).pipe(Effect.mapError((cause) => new WalletNew.WalletError({ message: cause.message, cause })))
    return makeSigningWalletEffect(derivationEffect)
  }

/**
 * CIP-30 browser wallet — wraps a wallet API (e.g. from `window.cardano.nami.enable()`).
 *
 * @example
 * ```ts
 * const api = await window.cardano.nami.enable()
 * const c = createClient({ chain: mainnet, wallet: cip30Wallet(api) })
 * ```
 *
 * @since 2.1.0
 * @category constructors
 */
export const cip30Wallet = (api: WalletNew.WalletApi): WalletNew.ApiWallet => {
  // Cache the address fetch as a single Promise so concurrent callers share the
  // same in-flight request and subsequent calls reuse the settled result.
  let addressPromise: Promise<CoreAddress.Address> | null = null
  let rewardAddressPromise: Promise<CoreRewardAddress.RewardAddress | null> | null = null

  const fetchPrimaryAddress = (): Promise<CoreAddress.Address> => {
    if (!addressPromise) {
      addressPromise = (async () => {
        const used = await api.getUsedAddresses()
        const unused = await api.getUnusedAddresses()
        const addrStr = used[0] ?? unused[0]
        if (!addrStr) throw new WalletNew.WalletError({ message: "Wallet API returned no addresses", cause: null })
        try {
          return CoreAddress.fromBech32(addrStr)
        } catch {
          try {
            return CoreAddress.fromHex(addrStr)
          } catch (error) {
            throw new WalletNew.WalletError({
              message: `Invalid address format from wallet: ${addrStr}`,
              cause: error as Error
            })
          }
        }
      })()
    }
    return addressPromise
  }

  const fetchPrimaryRewardAddress = (): Promise<CoreRewardAddress.RewardAddress | null> => {
    if (!rewardAddressPromise) {
      rewardAddressPromise = api
        .getRewardAddresses()
        .then((rewards) => (rewards[0] ? Schema.decodeSync(CoreRewardAddress.RewardAddress)(rewards[0]) : null))
    }
    return rewardAddressPromise
  }

  const getPrimaryAddress = Effect.tryPromise({
    try: fetchPrimaryAddress,
    catch: (cause) =>
      cause instanceof WalletNew.WalletError
        ? cause
        : new WalletNew.WalletError({ message: (cause as Error).message, cause: cause as Error })
  })

  const getPrimaryRewardAddress = Effect.tryPromise({
    try: fetchPrimaryRewardAddress,
    catch: (cause) => new WalletNew.WalletError({ message: (cause as Error).message, cause: cause as Error })
  })

  const effectInterface: WalletNew.ApiWalletEffect = {
    address: () => getPrimaryAddress,
    rewardAddress: () => getPrimaryRewardAddress,
    signTx: (txOrHex: Transaction.Transaction | string, _context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }) =>
      Effect.gen(function* () {
        const cbor = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        const witnessHex = yield* Effect.tryPromise({
          try: () => api.signTx(cbor, true),
          catch: (cause) =>
            new WalletNew.WalletError({
              message: `Failed to sign transaction: ${(cause as Error).message ?? cause}`,
              cause
            })
        })
        return yield* ParseResult.decodeUnknownEither(TransactionWitnessSet.FromCBORHex())(witnessHex).pipe(
          Effect.mapError(
            (cause) => new WalletNew.WalletError({ message: `Failed to decode witness set: ${cause}`, cause })
          )
        )
      }),
    signMessage: (address: CoreAddress.Address | CoreRewardAddress.RewardAddress, payload: WalletNew.Payload) =>
      Effect.gen(function* () {
        const addressHex =
          address instanceof CoreAddress.Address
            ? CoreAddress.toHex(address)
            : CoreRewardAccount.toHex(CoreRewardAccount.fromBech32(address))
        const result = yield* Effect.tryPromise({
          try: () => api.signData(addressHex, payload),
          catch: (cause) => new WalletNew.WalletError({ message: "User rejected message signing", cause })
        })
        return { payload, signature: result.signature }
      }),
    submitTx: (txOrHex: Transaction.Transaction | string) =>
      Effect.gen(function* () {
        const cbor = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        const txHashHex = yield* Effect.tryPromise({
          try: () => api.submitTx(cbor),
          catch: (cause) => new WalletNew.WalletError({ message: (cause as Error).message, cause: cause as Error })
        })
        return Schema.decodeSync(TransactionHash.FromHex)(txHashHex)
      })
  }

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
