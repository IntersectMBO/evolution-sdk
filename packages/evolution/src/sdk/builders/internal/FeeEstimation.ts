/**
 * Transaction fee estimation utilities.
 *
 * Implements the full fee calculation pipeline:
 *  1. Build a fake witness set (placeholder signatures + attached scripts)
 *     sized to match the real witness set for accurate CBOR size estimation.
 *  2. Iteratively compute the minimum fee until the value stabilises.
 *  3. Add tiered reference-script fees on top of the base size-based fee.
 *
 * All functions are side-effect-free with respect to external I/O; they
 * operate only on builder state read from the Effect context.
 *
 * @module FeeEstimation
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"
import type * as Array from "effect/Array"

import type * as CoreAddress from "../../../Address.js"
import * as Bytes from "../../../Bytes.js"
import type * as Certificate from "../../../Certificate.js"
import type * as PlutusData from "../../../Data.js"
import * as Ed25519Signature from "../../../Ed25519Signature.js"
import type * as KeyHash from "../../../KeyHash.js"
import * as NativeScripts from "../../../NativeScripts.js"
import type * as PlutusV1 from "../../../PlutusV1.js"
import type * as PlutusV2 from "../../../PlutusV2.js"
import type * as PlutusV3 from "../../../PlutusV3.js"
import * as Redeemer from "../../../Redeemer.js"
import * as Redeemers from "../../../Redeemers.js"
import * as CoreScript from "../../../Script.js"
import * as ScriptDataHash from "../../../ScriptDataHash.js"
import * as Time from "../../../Time/index.js"
import * as Transaction from "../../../Transaction.js"
import * as Transaction_ from "../../../Transaction.js"
import * as TransactionBody from "../../../TransactionBody.js"
import type * as TransactionInput from "../../../TransactionInput.js"
import * as TransactionWitnessSet from "../../../TransactionWitnessSet.js"
import type * as TxOut from "../../../TxOut.js"
import {
  calculateMinimumFee,
  calculateTransactionSize,
  tierRefScriptFee
} from "../../../utils/FeeValidation.js"
import { hashAuxiliaryData } from "../../../utils/Hash.js"
import type * as CoreUTxO from "../../../UTxO.js"
import * as VKey from "../../../VKey.js"
import * as Withdrawals from "../../../Withdrawals.js"
import { BuildOptionsTag, TransactionBuilderError, TxContext } from "../TransactionBuilder.js"
import { buildTransactionInputs } from "./TxAssembly.js"

// ============================================================================
// Internal helpers
// ============================================================================

/** Extract the key hash from a Core Address payment credential, or null for script addresses. */
const extractPaymentKeyHashFromCore = (address: CoreAddress.Address): Uint8Array | null => {
  if (address.paymentCredential._tag === "KeyHash" && address.paymentCredential.hash) {
    return address.paymentCredential.hash
  }
  return null
}

/** Build a fake VKeyWitness for fee-size estimation (all zeros, correct byte lengths). */
const buildFakeVKeyWitness = (
  keyHash: Uint8Array
): Effect.Effect<TransactionWitnessSet.VKeyWitness, TransactionBuilderError> =>
  Effect.gen(function* () {
    const vkeyBytes = new Uint8Array(32)
    vkeyBytes.set(keyHash.slice(0, Math.min(keyHash.length, 32)))

    const vkey = yield* Effect.try({
      try: () => new VKey.VKey({ bytes: vkeyBytes }),
      catch: (error) => new TransactionBuilderError({ message: "Failed to create fake VKey", cause: error })
    })

    const signature = yield* Effect.try({
      try: () => new Ed25519Signature.Ed25519Signature({ bytes: new Uint8Array(64) }),
      catch: (error) => new TransactionBuilderError({ message: "Failed to create fake signature", cause: error })
    })

    return new TransactionWitnessSet.VKeyWitness({ vkey, signature })
  })

// ============================================================================
// Fake witness set
// ============================================================================

/**
 * Build a fake `TransactionWitnessSet` sized to match the real one.
 *
 * Extracts unique payment key hashes from the provided input UTxOs, adds
 * dummy witnesses for native-script required signers and for certificates /
 * withdrawals / explicit required-signer entries, and populates script lists
 * from builder state.  Used exclusively for fee calculation — never signed.
 *
 * @since 2.0.0
 * @category fee-estimation
 */
export const buildFakeWitnessSet = (
  inputUtxos: ReadonlyArray<CoreUTxO.UTxO>
): Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError, TxContext> =>
  Effect.gen(function* () {
    const stateRef = yield* TxContext
    const state = yield* Ref.get(stateRef)

    const keyHashesSet = new Set<string>()
    const keyHashes: Array<Uint8Array> = []

    for (const utxo of inputUtxos) {
      const keyHash = extractPaymentKeyHashFromCore(utxo.address)
      if (keyHash) {
        const hex = Bytes.toHex(keyHash)
        if (!keyHashesSet.has(hex)) {
          keyHashesSet.add(hex)
          keyHashes.push(keyHash)
        }
      }
    }

    const nativeScripts: Array<NativeScripts.NativeScript> = []
    const plutusV1Scripts: Array<PlutusV1.PlutusV1> = []
    const plutusV2Scripts: Array<PlutusV2.PlutusV2> = []
    const plutusV3Scripts: Array<PlutusV3.PlutusV3> = []

    /** Add dummy witnesses for every required signer in a native script. */
    const addNativeScriptWitnesses = (script: NativeScripts.NativeScript) => {
      const requiredSigners = NativeScripts.countRequiredSigners(script.script)
      for (let i = 0; i < requiredSigners; i++) {
        const dummyKeyHash = new Uint8Array(28)
        dummyKeyHash[0] = 0xff
        dummyKeyHash[1] = (keyHashesSet.size + i) & 0xff
        const dummyHex = Bytes.toHex(dummyKeyHash)
        if (!keyHashesSet.has(dummyHex)) {
          keyHashesSet.add(dummyHex)
          keyHashes.push(dummyKeyHash)
        }
      }
      return requiredSigners
    }

    for (const script of state.scripts.values()) {
      switch (script._tag) {
        case "NativeScript": {
          nativeScripts.push(script)
          const n = addNativeScriptWitnesses(script)
          yield* Effect.logDebug(`[buildFakeWitnessSet] Native script requires ${n} signers`)
          break
        }
        case "PlutusV1": plutusV1Scripts.push(script); break
        case "PlutusV2": plutusV2Scripts.push(script); break
        case "PlutusV3": plutusV3Scripts.push(script); break
      }
    }

    for (const refUtxo of state.referenceInputs) {
      if (refUtxo.scriptRef?._tag === "NativeScript") {
        const n = addNativeScriptWitnesses(refUtxo.scriptRef)
        yield* Effect.logDebug(`[buildFakeWitnessSet] Reference native script requires ${n} signers`)
      }
    }

    const vkeyWitnesses: Array<TransactionWitnessSet.VKeyWitness> = []
    for (const keyHash of keyHashes) {
      vkeyWitnesses.push(yield* buildFakeVKeyWitness(keyHash))
    }

    // Certificates that require stake-key signatures
    for (const cert of state.certificates) {
      let credentialHash: Uint8Array | undefined
      if ("stakeCredential" in cert && cert.stakeCredential._tag === "KeyHash") {
        credentialHash = cert.stakeCredential.hash
      }
      if (credentialHash) {
        const hex = Bytes.toHex(credentialHash)
        if (!keyHashesSet.has(hex)) {
          keyHashesSet.add(hex)
          vkeyWitnesses.push(yield* buildFakeVKeyWitness(credentialHash))
        }
      }
    }

    // Withdrawals that require stake-key signatures
    for (const [rewardAccount] of state.withdrawals) {
      const credential = rewardAccount.stakeCredential
      if (credential._tag === "KeyHash") {
        const hex = Bytes.toHex(credential.hash)
        if (!keyHashesSet.has(hex)) {
          keyHashesSet.add(hex)
          vkeyWitnesses.push(yield* buildFakeVKeyWitness(credential.hash))
        }
      }
    }

    // Explicit required signers (addSigner operation)
    for (const keyHash of state.requiredSigners) {
      const hex = Bytes.toHex(keyHash.hash)
      if (!keyHashesSet.has(hex)) {
        keyHashesSet.add(hex)
        vkeyWitnesses.push(yield* buildFakeVKeyWitness(keyHash.hash))
      }
    }

    // Fake redeemers for accurate size estimation
    const fakeRedeemers: Array<Redeemer.Redeemer> = []
    let fakeIndex = 0n
    for (const [_key, redeemerData] of state.redeemers) {
      const exUnits = redeemerData.exUnits ?? { mem: 0n, steps: 0n }
      fakeRedeemers.push(
        new Redeemer.Redeemer({
          tag: redeemerData.tag,
          index: fakeIndex++,
          data: redeemerData.data,
          exUnits: new Redeemer.ExUnits({ mem: exUnits.mem, steps: exUnits.steps })
        })
      )
    }

    return new TransactionWitnessSet.TransactionWitnessSet({
      vkeyWitnesses,
      nativeScripts,
      bootstrapWitnesses: [],
      plutusV1Scripts,
      plutusData: [],
      redeemers: fakeRedeemers.length > 0 ? Redeemers.makeRedeemerMap(fakeRedeemers) : undefined,
      plutusV2Scripts,
      plutusV3Scripts
    })
  })

// ============================================================================
// Iterative fee calculation
// ============================================================================

/**
 * Calculate the minimum transaction fee by iterating until the value
 * stabilises.
 *
 * Algorithm:
 * 1. Build a fake witness set from input UTxOs for accurate CBOR-size estimation.
 * 2. Build a transaction body with `fee = 0`.
 * 3. Serialise, measure size, compute fee.
 * 4. Rebuild with the computed fee.
 * 5. Repeat until both fee and size are stable (typically 1–2 iterations).
 *
 * @since 2.0.0
 * @category fee-estimation
 */
export const calculateFeeIteratively = (
  inputUtxos: ReadonlyArray<CoreUTxO.UTxO>,
  inputs: ReadonlyArray<TransactionInput.TransactionInput>,
  outputs: ReadonlyArray<TxOut.TransactionOutput>,
  redeemers: Map<
    string,
    {
      readonly tag: "spend" | "mint" | "cert" | "reward" | "vote"
      readonly data: PlutusData.Data
      readonly exUnits?: { readonly mem: bigint; readonly steps: bigint }
    }
  >,
  protocolParams: {
    minFeeCoefficient: bigint
    minFeeConstant: bigint
    priceMem?: number
    priceStep?: number
  }
): Effect.Effect<bigint, TransactionBuilderError, TxContext | BuildOptionsTag> =>
  Effect.gen(function* () {
    const stateRef = yield* TxContext
    const state = yield* Ref.get(stateRef)

    // Include collateral UTxOs — they also need VKey witnesses
    const allUtxosForWitnesses = state.collateral
      ? [...inputUtxos, ...state.collateral.inputs]
      : inputUtxos

    const fakeWitnessSet = yield* buildFakeWitnessSet(allUtxosForWitnesses)

    const transactionOutputs = outputs as Array<TxOut.TransactionOutput>
    const mint = state.mint && state.mint.map.size > 0 ? state.mint : undefined

    let collateralInputs: Array.NonEmptyReadonlyArray<TransactionInput.TransactionInput> | undefined
    let collateralReturn: TxOut.TransactionOutput | undefined
    let totalCollateral: bigint | undefined

    if (state.collateral) {
      const builtCollateral = buildTransactionInputs(state.collateral.inputs)
      if (builtCollateral.length > 0) {
        collateralInputs = builtCollateral as Array.NonEmptyReadonlyArray<TransactionInput.TransactionInput>
      }
      collateralReturn = state.collateral.returnOutput
      totalCollateral = state.collateral.totalAmount
    }

    // Placeholder scriptDataHash keeps size accurate when Plutus scripts are present
    const hasPlutusScripts =
      (fakeWitnessSet.plutusV1Scripts && fakeWitnessSet.plutusV1Scripts.length > 0) ||
      (fakeWitnessSet.plutusV2Scripts && fakeWitnessSet.plutusV2Scripts.length > 0) ||
      (fakeWitnessSet.plutusV3Scripts && fakeWitnessSet.plutusV3Scripts.length > 0) ||
      state.redeemers.size > 0

    const placeholderScriptDataHash = hasPlutusScripts
      ? new ScriptDataHash.ScriptDataHash({ hash: new Uint8Array(32) })
      : undefined

    const placeholderAuxiliaryDataHash = state.auxiliaryData ? hashAuxiliaryData(state.auxiliaryData) : undefined

    const certificates =
      state.certificates.length > 0
        ? (state.certificates as [Certificate.Certificate, ...Array<Certificate.Certificate>])
        : undefined

    const withdrawals =
      state.withdrawals.size > 0
        ? new Withdrawals.Withdrawals({ withdrawals: state.withdrawals })
        : undefined

    const requiredSigners =
      state.requiredSigners.length > 0
        ? (state.requiredSigners as [KeyHash.KeyHash, ...Array<KeyHash.KeyHash>])
        : undefined

    let referenceInputsForFee:
      | readonly [TransactionInput.TransactionInput, ...Array<TransactionInput.TransactionInput>]
      | undefined
    if (state.referenceInputs.length > 0) {
      const refInputs = buildTransactionInputs(state.referenceInputs)
      referenceInputsForFee = refInputs as readonly [
        TransactionInput.TransactionInput,
        ...Array<TransactionInput.TransactionInput>
      ]
    }

    const buildOptions = yield* BuildOptionsTag
    const slotConfig = buildOptions.slotConfig!

    let ttl: bigint | undefined
    let validityIntervalStart: bigint | undefined

    if (state.validity?.to !== undefined) {
      ttl = Time.unixTimeToSlot(state.validity.to, slotConfig)
    }
    if (state.validity?.from !== undefined) {
      validityIntervalStart = Time.unixTimeToSlot(state.validity.from, slotConfig)
    }

    let currentFee = 0n
    let previousSize = 0
    let previousFee = 0n
    let iterations = 0
    const maxIterations = 10

    while (iterations < maxIterations) {
      const body = new TransactionBody.TransactionBody({
        inputs: inputs as Array<TransactionInput.TransactionInput>,
        outputs: transactionOutputs,
        fee: currentFee,
        ttl,
        validityIntervalStart,
        mint,
        scriptDataHash: placeholderScriptDataHash,
        auxiliaryDataHash: placeholderAuxiliaryDataHash,
        collateralInputs,
        collateralReturn,
        totalCollateral,
        certificates,
        withdrawals,
        requiredSigners,
        referenceInputs: referenceInputsForFee,
        votingProcedures: state.votingProcedures,
        proposalProcedures: state.proposalProcedures
      })

      const transaction = new Transaction.Transaction({
        body,
        witnessSet: fakeWitnessSet,
        isValid: true,
        auxiliaryData: state.auxiliaryData ?? null
      })

      const size = calculateTransactionSize(transaction)

      const baseFee = calculateMinimumFee(size, {
        minFeeCoefficient: protocolParams.minFeeCoefficient,
        minFeeConstant: protocolParams.minFeeConstant
      })

      let exUnitsCost = 0n
      if (protocolParams.priceMem && protocolParams.priceStep) {
        for (const [, redeemerData] of redeemers) {
          if (redeemerData.exUnits) {
            exUnitsCost +=
              BigInt(Math.ceil(protocolParams.priceMem * Number(redeemerData.exUnits.mem))) +
              BigInt(Math.ceil(protocolParams.priceStep * Number(redeemerData.exUnits.steps)))
          }
        }
      }

      const calculatedFee = baseFee + exUnitsCost

      if (currentFee === previousFee && size === previousSize && currentFee >= calculatedFee) {
        if (iterations > 1) {
          yield* Effect.logDebug(
            `Fee converged after ${iterations} iterations: ${currentFee} lovelace (tx size: ${size} bytes)`
          )
        }
        return currentFee
      }

      previousFee = currentFee
      currentFee = calculatedFee
      previousSize = size
      iterations++
    }

    yield* Effect.logDebug(`Fee calculation reached max iterations (${maxIterations}): ${currentFee} lovelace`)
    return currentFee
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: `Fee calculation failed to converge: ${error.message}`,
          cause: error
        })
    )
  )
