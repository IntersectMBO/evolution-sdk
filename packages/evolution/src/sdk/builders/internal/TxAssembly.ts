/**
 * Low-level transaction assembly utilities.
 *
 * Converts builder state into the concrete CBOR-ready transaction types
 * used by the Cardano ledger.  This layer owns the mapping from Effect-TS
 * builder state (TxContext / BuildOptionsTag) to `Transaction` and
 * `TransactionInput` values — nothing above this level should touch raw
 * CBOR serialisation.
 *
 * @module TxAssembly
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"
import type * as Array from "effect/Array"

import * as Bytes from "../../../Bytes.js"
import type * as Certificate from "../../../Certificate.js"
import * as CostModel from "../../../CostModel.js"
import type * as PlutusData from "../../../Data.js"
import type * as KeyHash from "../../../KeyHash.js"
import type * as PlutusV1 from "../../../PlutusV1.js"
import type * as PlutusV2 from "../../../PlutusV2.js"
import type * as PlutusV3 from "../../../PlutusV3.js"
import * as PolicyId from "../../../PolicyId.js"
import * as Redeemer from "../../../Redeemer.js"
import * as Redeemers from "../../../Redeemers.js"
import type * as RewardAccount from "../../../RewardAccount.js"
import * as Time from "../../../Time/index.js"
import * as Transaction from "../../../Transaction.js"
import * as TransactionBody from "../../../TransactionBody.js"
import * as TransactionHash from "../../../TransactionHash.js"
import * as TransactionInput from "../../../TransactionInput.js"
import * as TransactionWitnessSet from "../../../TransactionWitnessSet.js"
import type * as TxOut from "../../../TxOut.js"
import { hashAuxiliaryData, hashScriptData } from "../../../utils/Hash.js"
import type * as CoreUTxO from "../../../UTxO.js"
import * as Withdrawals from "../../../Withdrawals.js"
import { voterToKey } from "../phases/Calculations.js"
import { BuildOptionsTag, TransactionBuilderError, TxBuilderConfigTag, TxContext } from "../TransactionBuilder.js"

// ============================================================================
// Input Construction
// ============================================================================

/**
 * Convert UTxOs to sorted `TransactionInput` values.
 *
 * Inputs are sorted by (txHash, outputIndex) for deterministic ordering,
 * matching the Cardano ledger's canonical form.
 *
 * @since 2.0.0
 * @category assembly
 */
export const buildTransactionInputs = (
  utxos: ReadonlyArray<CoreUTxO.UTxO>
): ReadonlyArray<TransactionInput.TransactionInput> => {
  const inputs: Array<TransactionInput.TransactionInput> = []

  for (const utxo of utxos) {
    inputs.push(
      new TransactionInput.TransactionInput({
        transactionId: utxo.transactionId,
        index: utxo.index
      })
    )
  }

  // Deterministic ordering required by the ledger
  inputs.sort((a, b) => {
    const hashA = a.transactionId.hash
    const hashB = b.transactionId.hash
    for (let i = 0; i < hashA.length; i++) {
      if (hashA[i] !== hashB[i]) return hashA[i] - hashB[i]
    }
    return Number(a.index - b.index)
  })

  return inputs
}

// ============================================================================
// Transaction Assembly
// ============================================================================

/**
 * Assemble a fully-formed `Transaction` from inputs, outputs, and a
 * pre-calculated fee.
 *
 * Reads all required state (scripts, redeemers, certificates, withdrawals,
 * validity intervals, collateral, reference inputs, voting/proposal
 * procedures, auxiliary data) from the Effect context and produces a
 * CBOR-ready `Transaction` with a correctly computed `scriptDataHash`.
 *
 * @since 2.0.0
 * @category assembly
 */
export const assembleTransaction = (
  inputs: ReadonlyArray<TransactionInput.TransactionInput>,
  outputs: ReadonlyArray<TxOut.TransactionOutput>,
  fee: bigint
): Effect.Effect<Transaction.Transaction, TransactionBuilderError, TxContext | TxBuilderConfigTag | BuildOptionsTag> =>
  Effect.gen(function* () {
    const stateRef = yield* TxContext
    const state = yield* Ref.get(stateRef)

    yield* Effect.logDebug(`[Assembly] Building transaction with ${inputs.length} inputs, ${outputs.length} outputs`)
    yield* Effect.logDebug(`[Assembly] Reference inputs in state: ${state.referenceInputs.length}`)
    yield* Effect.logDebug(`[Assembly] Scripts in state: ${state.scripts.size}`)
    yield* Effect.logDebug(`[Assembly] Redeemers in state: ${state.redeemers.size}`)

    const transactionOutputs = outputs as Array<TxOut.TransactionOutput>

    // ── Collateral ───────────────────────────────────────────────────────────

    let collateralInputs: Array.NonEmptyReadonlyArray<TransactionInput.TransactionInput> | undefined
    let collateralReturn: TxOut.TransactionOutput | undefined
    let totalCollateral: bigint | undefined

    if (state.collateral) {
      yield* Effect.logDebug(
        `[Assembly] Adding collateral: ${state.collateral.inputs.length} inputs, ` +
          `total ${state.collateral.totalAmount} lovelace`
      )
      collateralInputs = buildTransactionInputs(
        state.collateral.inputs
      ) as Array.NonEmptyReadonlyArray<TransactionInput.TransactionInput>
      totalCollateral = state.collateral.totalAmount

      if (state.collateral.returnOutput) {
        yield* Effect.logDebug(
          `[Assembly] Collateral return lovelace: ${state.collateral.returnOutput.assets.lovelace}`
        )
        collateralReturn = state.collateral.returnOutput
      }
    }

    // ── Reference inputs ─────────────────────────────────────────────────────

    let referenceInputs:
      | readonly [TransactionInput.TransactionInput, ...Array<TransactionInput.TransactionInput>]
      | undefined
    if (state.referenceInputs.length > 0) {
      const refInputs = buildTransactionInputs(state.referenceInputs)
      referenceInputs = refInputs as readonly [
        TransactionInput.TransactionInput,
        ...Array<TransactionInput.TransactionInput>
      ]
    }

    // ── Scripts ───────────────────────────────────────────────────────────────

    const plutusV1Scripts: Array<PlutusV1.PlutusV1> = []
    const plutusV2Scripts: Array<PlutusV2.PlutusV2> = []
    const plutusV3Scripts: Array<PlutusV3.PlutusV3> = []
    const nativeScripts: Array<any> = []

    for (const [scriptHash, coreScript] of state.scripts) {
      yield* Effect.logDebug(`[Assembly] Processing script: hash=${scriptHash}, type=${coreScript._tag}`)
      switch (coreScript._tag) {
        case "PlutusV1": plutusV1Scripts.push(coreScript); break
        case "PlutusV2": plutusV2Scripts.push(coreScript); break
        case "PlutusV3": plutusV3Scripts.push(coreScript); break
        case "NativeScript": nativeScripts.push(coreScript); break
      }
    }

    // ── Redeemers ─────────────────────────────────────────────────────────────

    const redeemers: Array<Redeemer.Redeemer> = []

    // Build lookup maps for redeemer index resolution
    const inputIndexMap = new Map<string, number>()
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!
      const key = `${TransactionHash.toHex(input.transactionId)}#${input.index}`
      yield* Effect.logDebug(`[Assembly] Input ${i}: ${key}`)
      inputIndexMap.set(key, i)
    }

    const mintIndexMap = new Map<string, number>()
    if (state.mint && state.mint.map.size > 0) {
      const sortedPolicyIds = globalThis.Array.from(state.mint.map.keys())
        .map((pid) => PolicyId.toHex(pid))
        .sort()
      for (let i = 0; i < sortedPolicyIds.length; i++) {
        mintIndexMap.set(sortedPolicyIds[i]!, i)
        yield* Effect.logDebug(`[Assembly] Mint policy ${i}: ${sortedPolicyIds[i]}`)
      }
    }

    yield* Effect.logDebug(`[Assembly] Input index map: ${inputIndexMap.size} entries`)
    yield* Effect.logDebug(`[Assembly] Redeemer map keys: ${globalThis.Array.from(state.redeemers.keys()).join(", ")}`)

    for (const [key, redeemerData] of state.redeemers) {
      yield* Effect.logDebug(`[Assembly] Processing redeemer: key=${key}, tag=${redeemerData.tag}`)

      let redeemerIndex: number | undefined

      if (redeemerData.tag === "mint") {
        redeemerIndex = mintIndexMap.get(key)
        if (redeemerIndex === undefined) {
          yield* Effect.logWarning(`[Assembly] Could not find mint index for policy: ${key}`)
          continue
        }
      } else if (redeemerData.tag === "cert") {
        const credentialHex = key.slice(5) // Remove "cert:" prefix
        for (let i = 0; i < state.certificates.length; i++) {
          const cert = state.certificates[i]!
          if ("stakeCredential" in cert && cert.stakeCredential) {
            const certCredHex = Bytes.toHex((cert.stakeCredential as { hash: Uint8Array }).hash)
            if (certCredHex === credentialHex) { redeemerIndex = i; break }
          }
          if ("drepCredential" in cert && cert.drepCredential) {
            const certCredHex = Bytes.toHex((cert.drepCredential as { hash: Uint8Array }).hash)
            if (certCredHex === credentialHex) { redeemerIndex = i; break }
          }
        }
        if (redeemerIndex === undefined) {
          yield* Effect.logWarning(`[Assembly] Could not find cert index for key: ${key}`)
          continue
        }
      } else if (redeemerData.tag === "reward") {
        const credentialHex = key.slice(7) // Remove "reward:" prefix
        const sortedWithdrawals = globalThis.Array.from(state.withdrawals.entries()).sort((a, b) => {
          const aHex = Bytes.toHex(a[0].stakeCredential.hash)
          const bHex = Bytes.toHex(b[0].stakeCredential.hash)
          return aHex.localeCompare(bHex)
        })
        for (let i = 0; i < sortedWithdrawals.length; i++) {
          const [rewardAccount] = sortedWithdrawals[i]!
          if (Bytes.toHex(rewardAccount.stakeCredential.hash) === credentialHex) {
            redeemerIndex = i
            break
          }
        }
        if (redeemerIndex === undefined) {
          yield* Effect.logWarning(`[Assembly] Could not find withdrawal index for key: ${key}`)
          continue
        }
      } else if (redeemerData.tag === "vote") {
        if (!state.votingProcedures) {
          yield* Effect.logWarning(`[Assembly] Vote redeemer found but no votingProcedures in state`)
          continue
        }
        const sortedVoterKeys: Array<string> = []
        for (const voter of state.votingProcedures.procedures.keys()) {
          sortedVoterKeys.push(voterToKey(voter))
        }
        sortedVoterKeys.sort()
        for (let i = 0; i < sortedVoterKeys.length; i++) {
          if (sortedVoterKeys[i] === key) { redeemerIndex = i; break }
        }
        if (redeemerIndex === undefined) {
          yield* Effect.logWarning(`[Assembly] Could not find voter index for key: ${key}`)
          continue
        }
      } else {
        // spend redeemer — look up by UTxO ref key
        redeemerIndex = inputIndexMap.get(key)
        if (redeemerIndex === undefined) {
          yield* Effect.logWarning(`[Assembly] Could not find input index for redeemer key: ${key}`)
          continue
        }
      }

      yield* Effect.logDebug(
        `[Assembly] Redeemer exUnits: mem=${redeemerData.exUnits?.mem ?? 0n}, steps=${redeemerData.exUnits?.steps ?? 0n}`
      )

      redeemers.push(
        new Redeemer.Redeemer({
          tag: redeemerData.tag,
          index: BigInt(redeemerIndex),
          data: redeemerData.data,
          exUnits: redeemerData.exUnits
            ? new Redeemer.ExUnits({ mem: redeemerData.exUnits.mem, steps: redeemerData.exUnits.steps })
            : new Redeemer.ExUnits({ mem: 0n, steps: 0n })
        })
      )
    }

    // ── Plutus data ───────────────────────────────────────────────────────────

    // Only datum-hash UTxOs need datum resolution in the witness set.
    // Inline datums are already embedded in the UTxO and must NOT be
    // re-included (would cause "extraneous datums" ledger error).
    const plutusDataArray: Array<PlutusData.Data> = []
    for (const utxo of state.selectedUtxos) {
      if (utxo.datumOption?._tag === "DatumHash") {
        yield* Effect.logDebug(`[Assembly] Found datum hash UTxO (resolution not yet implemented)`)
      }
    }

    // ── scriptDataHash ────────────────────────────────────────────────────────

    let scriptDataHash: ReturnType<typeof hashScriptData> | undefined
    let redeemersConcrete: Redeemers.RedeemerMap | undefined

    if (redeemers.length > 0) {
      const config = yield* TxBuilderConfigTag

      if (!config.provider) {
        throw new TransactionBuilderError({
          message:
            "Script transactions require a provider to fetch full protocol parameters for scriptDataHash calculation",
          cause: { redeemerCount: redeemers.length }
        })
      }

      const fullProtocolParams = yield* config.provider.Effect.getProtocolParameters().pipe(
        Effect.mapError(
          (providerError) =>
            new TransactionBuilderError({
              message: `Failed to fetch protocol parameters for scriptDataHash: ${providerError.message}`,
              cause: providerError
            })
        )
      )

      let hasPlutusV1 = plutusV1Scripts.length > 0
      let hasPlutusV2 = plutusV2Scripts.length > 0
      let hasPlutusV3 = plutusV3Scripts.length > 0

      for (const refUtxo of state.referenceInputs) {
        if (refUtxo.scriptRef) {
          switch (refUtxo.scriptRef._tag) {
            case "PlutusV1": hasPlutusV1 = true; break
            case "PlutusV2": hasPlutusV2 = true; break
            case "PlutusV3": hasPlutusV3 = true; break
          }
        }
      }

      for (const utxo of state.selectedUtxos) {
        if (utxo.scriptRef) {
          switch (utxo.scriptRef._tag) {
            case "PlutusV1": hasPlutusV1 = true; break
            case "PlutusV2": hasPlutusV2 = true; break
            case "PlutusV3": hasPlutusV3 = true; break
          }
        }
      }

      yield* Effect.logDebug(`[Assembly] Cost models included: V1=${hasPlutusV1}, V2=${hasPlutusV2}, V3=${hasPlutusV3}`)

      const costModels = new CostModel.CostModels({
        PlutusV1: new CostModel.CostModel({
          costs: hasPlutusV1
            ? Object.values(fullProtocolParams.costModels.PlutusV1).map((v) => BigInt(v))
            : []
        }),
        PlutusV2: new CostModel.CostModel({
          costs: hasPlutusV2
            ? Object.values(fullProtocolParams.costModels.PlutusV2).map((v) => BigInt(v))
            : []
        }),
        PlutusV3: new CostModel.CostModel({
          costs: hasPlutusV3
            ? Object.values(fullProtocolParams.costModels.PlutusV3).map((v) => BigInt(v))
            : []
        })
      })

      redeemersConcrete = Redeemers.makeRedeemerMap(redeemers)
      scriptDataHash = hashScriptData(
        redeemersConcrete,
        costModels,
        plutusDataArray.length > 0 ? plutusDataArray : undefined
      )
      yield* Effect.logDebug(`[Assembly] scriptDataHash: ${scriptDataHash.hash.toString()}`)
    }

    yield* Effect.logDebug(`[Assembly] WitnessSet: V1=${plutusV1Scripts.length}, V2=${plutusV2Scripts.length}, V3=${plutusV3Scripts.length}, redeemers=${redeemers.length}`)

    // ── Transaction body ──────────────────────────────────────────────────────

    const certificates =
      state.certificates.length > 0
        ? (state.certificates as [Certificate.Certificate, ...Array<Certificate.Certificate>])
        : undefined

    const withdrawals =
      state.withdrawals.size > 0
        ? new Withdrawals.Withdrawals({ withdrawals: state.withdrawals as Map<RewardAccount.RewardAccount, bigint> })
        : undefined

    const buildOptions = yield* BuildOptionsTag
    const slotConfig = buildOptions.slotConfig!

    let ttl: bigint | undefined
    let validityIntervalStart: bigint | undefined

    if (state.validity?.to !== undefined) {
      ttl = Time.unixTimeToSlot(state.validity.to, slotConfig)
      yield* Effect.logDebug(`[Assembly] TTL: ${ttl}`)
    }
    if (state.validity?.from !== undefined) {
      validityIntervalStart = Time.unixTimeToSlot(state.validity.from, slotConfig)
      yield* Effect.logDebug(`[Assembly] Validity start: ${validityIntervalStart}`)
    }

    const requiredSigners =
      state.requiredSigners.length > 0
        ? (state.requiredSigners as [KeyHash.KeyHash, ...Array<KeyHash.KeyHash>])
        : undefined

    let auxiliaryDataHash: ReturnType<typeof hashAuxiliaryData> | undefined
    if (state.auxiliaryData) {
      auxiliaryDataHash = hashAuxiliaryData(state.auxiliaryData)
      yield* Effect.logDebug(`[Assembly] auxiliaryDataHash: ${auxiliaryDataHash.toString()}`)
    }

    const body = new TransactionBody.TransactionBody({
      inputs: inputs as Array<TransactionInput.TransactionInput>,
      outputs: transactionOutputs,
      fee,
      ttl,
      validityIntervalStart,
      collateralInputs,
      collateralReturn,
      totalCollateral,
      referenceInputs,
      mint: state.mint && state.mint.map.size > 0 ? state.mint : undefined,
      scriptDataHash,
      auxiliaryDataHash,
      certificates,
      withdrawals,
      requiredSigners,
      votingProcedures: state.votingProcedures,
      proposalProcedures: state.proposalProcedures
    })

    const witnessSet = new TransactionWitnessSet.TransactionWitnessSet({
      vkeyWitnesses: [],
      nativeScripts,
      bootstrapWitnesses: [],
      plutusV1Scripts,
      plutusData: plutusDataArray,
      redeemers: redeemers.length > 0 ? redeemersConcrete : undefined,
      plutusV2Scripts,
      plutusV3Scripts
    })

    return new Transaction.Transaction({
      body,
      witnessSet,
      isValid: true,
      auxiliaryData: state.auxiliaryData ?? null
    })
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: `Failed to assemble transaction: ${error.message}`,
          cause: error
        })
    )
  )
