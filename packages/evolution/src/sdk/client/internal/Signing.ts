import { Effect, Equal, ParseResult, Schema } from "effect"

import * as Bytes from "../../../Bytes.js"
import * as Ed25519Signature from "../../../Ed25519Signature.js"
import { runEffectPromise } from "../../../EffectRuntime.js"
import * as KeyHash from "../../../KeyHash.js"
import type * as NativeScripts from "../../../NativeScripts.js"
import * as PoolKeyHash from "../../../PoolKeyHash.js"
import * as PrivateKey from "../../../PrivateKey.js"
import * as CoreRewardAccount from "../../../RewardAccount.js"
import type * as CoreRewardAddress from "../../../RewardAddress.js"
import * as Transaction from "../../../Transaction.js"
import * as TransactionBody from "../../../TransactionBody.js"
import * as TransactionHash from "../../../TransactionHash.js"
import * as TransactionWitnessSet from "../../../TransactionWitnessSet.js"
import * as CoreUTxO from "../../../UTxO.js"
import * as VKey from "../../../VKey.js"
import type * as Provider from "../../provider/Provider.js"
import type * as Derivation from "../../wallet/Derivation.js"
import * as Wallet from "../../wallet/Wallet.js"

export type ResolvedSignerWallet = Wallet.SigningWallet | Wallet.ApiWallet

const extractKeyHashesFromNativeScript = (script: NativeScripts.NativeScriptVariants): Set<string> => {
  const keyHashes = new Set<string>()

  const traverse = (value: NativeScripts.NativeScriptVariants): void => {
    switch (value._tag) {
      case "ScriptPubKey":
        keyHashes.add(Bytes.toHex(value.keyHash))
        break
      case "ScriptAll":
      case "ScriptAny":
      case "ScriptNOfK":
        for (const nested of value.scripts) {
          traverse(nested)
        }
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
    for (const keyHash of params.tx.body.requiredSigners) {
      required.add(KeyHash.toHex(keyHash))
    }
  }

  if (params.tx.witnessSet.nativeScripts) {
    for (const nativeScript of params.tx.witnessSet.nativeScripts) {
      const keyHashes = extractKeyHashesFromNativeScript(nativeScript.script)
      for (const keyHash of keyHashes) {
        required.add(keyHash)
      }
    }
  }

  if (params.referenceUtxos) {
    for (const utxo of params.referenceUtxos) {
      if (utxo.scriptRef && utxo.scriptRef._tag === "NativeScript") {
        const keyHashes = extractKeyHashesFromNativeScript(utxo.scriptRef.script)
        for (const keyHash of keyHashes) {
          required.add(keyHash)
        }
      }
    }
  }

  const ownedRefs = new Set<string>(params.utxos.map((utxo) => CoreUTxO.toOutRefString(utxo)))
  const checkInputs = (inputs?: ReadonlyArray<Transaction.Transaction["body"]["inputs"][number]>) => {
    if (!inputs || !params.paymentKhHex) {
      return
    }

    for (const input of inputs) {
      const txIdHex = TransactionHash.toHex(input.transactionId)
      const key = `${txIdHex}#${Number(input.index)}`
      if (ownedRefs.has(key)) {
        required.add(params.paymentKhHex)
      }
    }
  }

  checkInputs(params.tx.body.inputs)
  if (params.tx.body.collateralInputs) {
    checkInputs(params.tx.body.collateralInputs)
  }

  if (params.tx.body.withdrawals && params.rewardAddress && params.stakeKhHex) {
    const ourReward = Schema.decodeSync(CoreRewardAccount.FromBech32)(params.rewardAddress)
    for (const [rewardAccount] of params.tx.body.withdrawals.withdrawals.entries()) {
      if (Equal.equals(ourReward, rewardAccount)) {
        required.add(params.stakeKhHex)
        break
      }
    }
  }

  if (params.tx.body.certificates && (params.stakeKhHex || params.paymentKhHex)) {
    for (const certificate of params.tx.body.certificates) {
      if (params.stakeKhHex) {
        const stakeCredential =
          certificate._tag === "StakeRegistration" ||
          certificate._tag === "StakeDeregistration" ||
          certificate._tag === "StakeDelegation" ||
          certificate._tag === "RegCert" ||
          certificate._tag === "UnregCert" ||
          certificate._tag === "StakeVoteDelegCert" ||
          certificate._tag === "StakeRegDelegCert" ||
          certificate._tag === "StakeVoteRegDelegCert" ||
          certificate._tag === "VoteDelegCert" ||
          certificate._tag === "VoteRegDelegCert"
            ? certificate.stakeCredential
            : undefined

        if (stakeCredential && stakeCredential._tag === "KeyHash") {
          const keyHashHex = KeyHash.toHex(stakeCredential)
          if (keyHashHex === params.stakeKhHex) {
            required.add(params.stakeKhHex)
          }
        }

        const drepCredential =
          certificate._tag === "RegDrepCert" ||
          certificate._tag === "UnregDrepCert" ||
          certificate._tag === "UpdateDrepCert"
            ? certificate.drepCredential
            : undefined

        if (drepCredential && drepCredential._tag === "KeyHash") {
          const keyHashHex = KeyHash.toHex(drepCredential)
          if (keyHashHex === params.stakeKhHex) {
            required.add(params.stakeKhHex)
          }
        }

        const committeeColdCredential =
          certificate._tag === "AuthCommitteeHotCert" ||
          certificate._tag === "ResignCommitteeColdCert"
            ? certificate.committeeColdCredential
            : undefined

        if (committeeColdCredential && committeeColdCredential._tag === "KeyHash") {
          const keyHashHex = KeyHash.toHex(committeeColdCredential)
          if (keyHashHex === params.stakeKhHex) {
            required.add(params.stakeKhHex)
          }
        }
      }

      if (params.paymentKhHex) {
        if (certificate._tag === "PoolRegistration") {
          const operatorHex = PoolKeyHash.toHex(certificate.poolParams.operator)
          if (operatorHex === params.paymentKhHex) {
            required.add(params.paymentKhHex)
          }
        }

        if (certificate._tag === "PoolRetirement") {
          const poolKeyHashHex = PoolKeyHash.toHex(certificate.poolKeyHash)
          if (poolKeyHashHex === params.paymentKhHex) {
            required.add(params.paymentKhHex)
          }
        }
      }
    }
  }

  return required
}

export const signWithWallet = (
  wallet: ResolvedSignerWallet,
  txOrHex: Parameters<Wallet.SigningWalletEffect["signTx"]>[0],
  context?: Parameters<Wallet.SigningWalletEffect["signTx"]>[1]
): ReturnType<Wallet.SigningWalletEffect["signTx"]> =>
  wallet.type === "api"
    ? wallet.effect.signTx(txOrHex, context ? { utxos: context.utxos } : undefined)
    : wallet.effect.signTx(txOrHex, context)

export const signTxsWithWallet = (
  wallet: ResolvedSignerWallet,
  txs: ReadonlyArray<Parameters<Wallet.SigningWalletEffect["signTx"]>[0]>,
  context?: Parameters<Wallet.SigningWalletEffect["signTx"]>[1]
): Effect.Effect<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>, Wallet.WalletError> =>
  wallet.type === "api"
    ? wallet.effect.signTxs(txs, context ? { utxos: context.utxos } : undefined)
    : wallet.effect.signTxs(txs, context)

export const signTxsWithAutoFetch = (
  provider: Provider.Provider,
  wallet: ResolvedSignerWallet,
  txs: ReadonlyArray<Parameters<Wallet.SigningWalletEffect["signTx"]>[0]>,
  context?: Parameters<Wallet.SigningWalletEffect["signTx"]>[1]
): Effect.Effect<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>, Wallet.WalletError> =>
  Effect.gen(function* () {
    if (wallet.type === "api") {
      return yield* signTxsWithWallet(wallet, txs, context)
    }

    if (context?.referenceUtxos && context.referenceUtxos.length > 0) {
      return yield* wallet.effect.signTxs(txs, context)
    }

    // Collect all reference inputs across all transactions and fetch them once
    const seen = new Set<string>()
    const allRefInputs: Array<TransactionBody.TransactionBody["inputs"][number]> = []
    for (const txOrHex of txs) {
      const tx =
        typeof txOrHex === "string"
          ? yield* ParseResult.decodeUnknownEither(Transaction.FromCBORHex())(txOrHex).pipe(
              Effect.mapError(
                (cause) => new Wallet.WalletError({ message: `Failed to decode transaction: ${cause}`, cause })
              )
            )
          : txOrHex
      if (tx.body.referenceInputs) {
        for (const ref of tx.body.referenceInputs) {
          const key = `${ref.transactionId}#${ref.index}`
          if (!seen.has(key)) {
            seen.add(key)
            allRefInputs.push(ref)
          }
        }
      }
    }

    let referenceUtxos: ReadonlyArray<CoreUTxO.UTxO> = []
    if (allRefInputs.length > 0) {
      referenceUtxos = yield* provider.effect.getUtxosByOutRef(allRefInputs).pipe(
        Effect.mapError(
          (error) =>
            new Wallet.WalletError({
              message: `Failed to fetch reference UTxOs: ${error.message}`,
              cause: error
            })
        )
      )
    }

    return yield* wallet.effect.signTxs(txs, { ...context, referenceUtxos })
  })

export const signWithAutoFetch = (
  provider: Provider.Provider,
  wallet: ResolvedSignerWallet,
  txOrHex: Parameters<Wallet.SigningWalletEffect["signTx"]>[0],
  context?: Parameters<Wallet.SigningWalletEffect["signTx"]>[1]
): ReturnType<Wallet.SigningWalletEffect["signTx"]> =>
  Effect.gen(function* () {
    if (wallet.type === "api") {
      return yield* signWithWallet(wallet, txOrHex, context)
    }

    if (context?.referenceUtxos && context.referenceUtxos.length > 0) {
      return yield* wallet.effect.signTx(txOrHex, context)
    }

    const tx =
      typeof txOrHex === "string"
        ? yield* ParseResult.decodeUnknownEither(Transaction.FromCBORHex())(txOrHex).pipe(
            Effect.mapError(
              (cause) => new Wallet.WalletError({ message: `Failed to decode transaction: ${cause}`, cause })
            )
          )
        : txOrHex

    let referenceUtxos: ReadonlyArray<CoreUTxO.UTxO> = []
    if (tx.body.referenceInputs && tx.body.referenceInputs.length > 0) {
      referenceUtxos = yield* provider.effect.getUtxosByOutRef(tx.body.referenceInputs).pipe(
        Effect.mapError(
          (error) =>
            new Wallet.WalletError({
              message: `Failed to fetch reference UTxOs: ${error.message}`,
              cause: error
            })
        )
      )
    }

    return yield* wallet.effect.signTx(txOrHex, { ...context, referenceUtxos })
  })

export const makeSigningWalletEffect = (
  rawDerivationEffect: Effect.Effect<Derivation.SeedDerivationResult, Wallet.WalletError>
): Wallet.SigningWallet => {
  const derivationEffect = Effect.runSync(Effect.cached(rawDerivationEffect))
  const effectInterface: Wallet.SigningWalletEffect = {
    address: () => Effect.map(derivationEffect, (derivation) => derivation.address),
    rewardAddress: () => Effect.map(derivationEffect, (derivation) => derivation.rewardAddress ?? null),
    signTx: (txOrHex, context) =>
      Effect.gen(function* () {
        const derivation = yield* derivationEffect
        const tx =
          typeof txOrHex === "string"
            ? yield* ParseResult.decodeUnknownEither(Transaction.FromCBORHex())(txOrHex).pipe(
                Effect.mapError(
                  (cause) => new Wallet.WalletError({ message: `Failed to decode transaction: ${cause}`, cause })
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
            ? TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(Bytes.fromHex(txOrHex)))
            : TransactionBody.toHash(tx.body)

        const message = txHash.hash
        const witnesses: Array<TransactionWitnessSet.VKeyWitness> = []
        const seenVKeys = new Set<string>()

        for (const keyHashHex of required) {
          const signingKey = derivation.keyStore.get(keyHashHex)
          if (!signingKey) {
            continue
          }

          const signature = PrivateKey.sign(signingKey, message)
          const verificationKey = VKey.fromPrivateKey(signingKey)
          const verificationKeyHex = VKey.toHex(verificationKey)

          if (seenVKeys.has(verificationKeyHex)) {
            continue
          }

          seenVKeys.add(verificationKeyHex)
          witnesses.push(
            new TransactionWitnessSet.VKeyWitness({
              vkey: verificationKey,
              signature
            })
          )
        }

        return witnesses.length > 0 ? TransactionWitnessSet.fromVKeyWitnesses(witnesses) : TransactionWitnessSet.empty()
      }),
    signTxs: (txs, context) => Effect.all(txs.map((tx) => effectInterface.signTx(tx, context))),
    signMessage: (address, payload) =>
      Effect.gen(function* () {
        const derivation = yield* derivationEffect
        const useStakeKey = typeof address === "string" && derivation.stakeKey !== undefined
        const signingKey = useStakeKey
          ? PrivateKey.fromBech32(derivation.stakeKey!)
          : PrivateKey.fromBech32(derivation.paymentKey)
        const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload
        const signature = PrivateKey.sign(signingKey, bytes)
        return { payload, signature: Ed25519Signature.toHex(signature) }
      })
  }

  return {
    type: "signing",
    address: () => runEffectPromise(effectInterface.address()),
    rewardAddress: () => runEffectPromise(effectInterface.rewardAddress()),
    signTx: (txOrHex, context) => runEffectPromise(effectInterface.signTx(txOrHex, context)),
    signTxs: (txs, context) => runEffectPromise(effectInterface.signTxs(txs, context)),
    signMessage: (address, payload) => runEffectPromise(effectInterface.signMessage(address, payload)),
    effect: effectInterface
  }
}