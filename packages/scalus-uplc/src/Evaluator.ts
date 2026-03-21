import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as CBOR from "@evolution-sdk/evolution/CBOR"
import type * as CostModel from "@evolution-sdk/evolution/CostModel"
import * as Redeemer from "@evolution-sdk/evolution/Redeemer"
import * as Script from "@evolution-sdk/evolution/Script"
import * as ScriptRef from "@evolution-sdk/evolution/ScriptRef"
import * as TransactionBuilder from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder"
import type * as EvalRedeemer from "@evolution-sdk/evolution/sdk/EvalRedeemer"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionInput from "@evolution-sdk/evolution/TransactionInput"
import * as TxOut from "@evolution-sdk/evolution/TxOut"
import type * as UTxO from "@evolution-sdk/evolution/UTxO"
import { Effect, Schema } from "effect"
import ScalusLib from "scalus"

/**
 * Build CBOR-encoded map of TransactionInput → TransactionOutput from UTxOs.
 *
 * Uses FromCDDL schemas to get CBOR values directly, avoiding wasteful
 * bytes → CBOR → bytes roundtrip encoding.
 */
function buildUtxoMapCBOR(utxos: ReadonlyArray<UTxO.UTxO>): Uint8Array {
  const utxoMap = new Map<CBOR.CBOR, CBOR.CBOR>()

  for (const utxo of utxos) {
    // Use FromCDDL to get CBOR values directly (no double encoding)
    const txInput = new TransactionInput.TransactionInput({
      transactionId: utxo.transactionId,
      index: utxo.index
    })
    const inputCBOR = Schema.encodeSync(TransactionInput.FromCDDL)(txInput)

    const scriptRef = utxo.scriptRef ? new ScriptRef.ScriptRef({ bytes: Script.toCBOR(utxo.scriptRef) }) : undefined
    const txOut = new TxOut.TransactionOutput({
      address: utxo.address,
      assets: utxo.assets,
      datumOption: utxo.datumOption,
      scriptRef
    })
    const outputCBOR = Schema.encodeSync(TxOut.FromCDDL)(txOut)

    utxoMap.set(inputCBOR, outputCBOR)
  }

  return CBOR.toCBORBytes(utxoMap, CBOR.CML_DEFAULT_OPTIONS)
}

function decodeCostModels(costModels: CostModel.CostModels): Array<Array<number>> {
  // Scalus expects a flattened representation of the cost models as number arrays
  const plutusV1 = costModels.PlutusV1.costs.map((c: bigint) => Number(c))
  const plutusV2 = costModels.PlutusV2.costs.map((c: bigint) => Number(c))
  const plutusV3 = costModels.PlutusV3.costs.map((c: bigint) => Number(c))
  return [plutusV1, plutusV2, plutusV3]
}

export function makeEvaluator(): TransactionBuilder.Evaluator {
  return {
    evaluate: (
      tx: Transaction.Transaction,
      additionalUtxos: ReadonlyArray<UTxO.UTxO> | undefined,
      context: TransactionBuilder.EvaluationContext
    ) =>
      Effect.gen(function* () {
        yield* Effect.logDebug("[Scalus UPLC] Starting evaluation")

        // Serialize transaction to CBOR bytes
        const txBytes = Transaction.toCBORBytes(tx)

        yield* Effect.logDebug(`[Scalus UPLC] Transaction CBOR bytes: ${txBytes.length}`)

        const utxos = additionalUtxos ?? []
        yield* Effect.logDebug(`[Scalus UPLC] Additional UTxOs: ${utxos.length}`)

        // Build UTxO map CBOR
        const utxosBytes = buildUtxoMapCBOR(utxos)
        yield* Effect.logDebug(`[Scalus UPLC] UTxO map CBOR bytes: ${utxosBytes.length}`)
        yield* Effect.logDebug(`[Scalus UPLC] UTxO map CBOR hex: ${Bytes.toHex(utxosBytes)}`)

        const { slotLength, zeroSlot, zeroTime } = context.slotConfig

        yield* Effect.logDebug(
          `[Scalus UPLC] Slot config - zeroTime: ${zeroTime}, zeroSlot: ${zeroSlot}, slotLength: ${slotLength}`
        )

        const costModels: Array<Array<number>> = decodeCostModels(context.costModels)
        yield* Effect.logDebug(
          `[Scalus UPLC] Cost models - V1: ${costModels[0].length}, V2: ${costModels[1].length}, V3: ${costModels[2].length} costs`
        )
        yield* Effect.logDebug(
          `[Scalus UPLC] Max execution - steps: ${context.maxTxExSteps}, mem: ${context.maxTxExMem}`
        )

        // Scalus-specific slot config
        const slotConfig = new ScalusLib.SlotConfig(Number(zeroTime), Number(zeroSlot), slotLength)

        yield* Effect.logDebug("[Scalus UPLC] Calling evalPlutusScripts...")
        const redeemers = yield* Effect.try({
          try: () => ScalusLib.Scalus.evalPlutusScripts(txBytes, utxosBytes, slotConfig, costModels),
          catch: (error) => {
            // Scalus error messages and evaluation logs, if any, are available to form an exception
            const errorObj = error as any
            const msg: string = errorObj?.message ?? "Unknown evaluation error"

            return new TransactionBuilder.EvaluationError({
              cause: error,
              message: msg,
              failures: []
            })
          }
        })

        yield* Effect.logDebug(`[Scalus UPLC] Evaluation successful - ${redeemers.length} redeemer(s) returned`)

        // Check if redeemers array is empty
        if (redeemers.length === 0) {
          return yield* new TransactionBuilder.EvaluationError({
            message: "Scalus evaluation returned no redeemers",
            failures: []
          })
        }

        // Transform Scalus redeemers to Evolution format and check for zero execution units
        const evalRedeemers: Array<EvalRedeemer.EvalRedeemer> = []
        for (const r of redeemers) {
          const mem = BigInt(r.budget.memory)
          const steps = BigInt(r.budget.steps)

          // Check if execution units are zero (indicates evaluation failure)
          if (mem === 0n && steps === 0n) {
            return yield* Effect.fail(
              new TransactionBuilder.EvaluationError({
                message: `Scalus evaluation returned zero execution units for redeemer ${r.tag}:${r.index}`,
                failures: []
              })
            )
          }

          const tagMap: Record<string, Redeemer.RedeemerTag> = {
            Spend: "spend",
            Mint: "mint",
            Cert: "cert",
            Reward: "reward",
            Voting: "vote",
            Proposing: "propose"
          }

          evalRedeemers.push({
            redeemer_tag: tagMap[r.tag] || "spend",
            redeemer_index: r.index,
            ex_units: new Redeemer.ExUnits({ mem, steps })
          })
        }

        return evalRedeemers
      })
  }
}
