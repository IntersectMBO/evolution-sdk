/**
 * Shared evaluator logic - platform agnostic
 *
 * @packageDocumentation
 */

import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as CBOR from "@evolution-sdk/evolution/CBOR"
import * as CostModel from "@evolution-sdk/evolution/CostModel"
import * as Redeemer from "@evolution-sdk/evolution/Redeemer"
import * as Script from "@evolution-sdk/evolution/Script"
import * as ScriptRef from "@evolution-sdk/evolution/ScriptRef"
import * as TransactionBuilder from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder"
import type * as EvalRedeemer from "@evolution-sdk/evolution/sdk/EvalRedeemer"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionInput from "@evolution-sdk/evolution/TransactionInput"
import * as TxOut from "@evolution-sdk/evolution/TxOut"
import type * as UTxO from "@evolution-sdk/evolution/UTxO"
import { Effect } from "effect"

/**
 * WASM module interface for Aiken UPLC evaluator
 */
export interface WasmModule {
  eval_phase_two_raw(
    tx_bytes: Uint8Array,
    utxos_x: Array<Uint8Array>,
    utxos_y: Array<Uint8Array>,
    cost_mdls: Uint8Array,
    initial_budget_n: bigint,
    initial_budget_d: bigint,
    slot_x: bigint,
    slot_y: bigint,
    slot_z: number
  ): Array<Uint8Array>
}

/**
 * Parse Aiken UPLC error string into ScriptFailure array.
 *
 * Aiken errors come as strings like:
 * - "Spend(0): validation failed: ..."
 * - "Mint(1): ..."
 * - "Withdraw(0): ..."
 * - "Publish(0): ..."
 */
function parseAikenError(error: unknown): Array<TransactionBuilder.ScriptFailure> {
  const failures: Array<TransactionBuilder.ScriptFailure> = []

  const errorMessage = error instanceof Error ? error.message : String(error)

  // Pattern: Purpose(index): error message
  // Examples: "Spend(0): validation failed", "Mint(1): budget exceeded"
  const pattern =
    /\b(Spend|Mint|Withdraw|Publish|Reward|Cert)\s*\(\s*(\d+)\s*\)\s*:\s*(.+?)(?=\b(?:Spend|Mint|Withdraw|Publish|Reward|Cert)\s*\(|$)/gi

  let match
  while ((match = pattern.exec(errorMessage)) !== null) {
    const [, purposeRaw, indexStr, validationError] = match
    const purpose = purposeRaw!.toLowerCase()
    const index = parseInt(indexStr!, 10)

    // Normalize purpose names
    const normalizedPurpose = purpose === "reward" ? "withdraw" : purpose === "cert" ? "publish" : purpose

    failures.push({
      purpose: normalizedPurpose,
      index,
      validationError: validationError!.trim(),
      traces: []
    })
  }

  // If no structured errors found, create a generic one
  if (failures.length === 0 && errorMessage) {
    failures.push({
      purpose: "unknown",
      index: 0,
      validationError: errorMessage,
      traces: []
    })
  }

  return failures
}

/**
 * Convert UTxO to input CBOR bytes (transaction hash + index).
 */
function inputCBORFromUtxo(utxo: UTxO.UTxO): Uint8Array {
  const txInput = new TransactionInput.TransactionInput({
    transactionId: utxo.transactionId,
    index: utxo.index
  })
  return TransactionInput.toCBORBytes(txInput)
}

/**
 * Convert UTxO output to CBOR bytes.
 */
function outputCBORFromUtxo(utxo: UTxO.UTxO): Uint8Array {
  const scriptRef = utxo.scriptRef ? new ScriptRef.ScriptRef({ bytes: Script.toCBOR(utxo.scriptRef) }) : undefined

  const txOut = new TxOut.TransactionOutput({
    address: utxo.address,
    assets: utxo.assets,
    datumOption: utxo.datumOption,
    scriptRef
  })

  return TxOut.toCBORBytes(txOut)
}

/**
 * Parse CBOR-encoded EvalRedeemer result from WASM.
 * Uses the official Redeemer.fromCBORBytes which handles the 4-element tuple:
 * [tag, index, data, [mem, steps]]
 */
function evalRedeemerFromCBOR(bytes: Uint8Array): EvalRedeemer.EvalRedeemer {
  // Decode using official Redeemer module
  const redeemer = Redeemer.fromCBORBytes(bytes, CBOR.CML_DEFAULT_OPTIONS)

  // EvalRedeemer uses core RedeemerTag values directly
  return {
    redeemer_tag: redeemer.tag,
    redeemer_index: Number(redeemer.index),
    ex_units: new Redeemer.ExUnits({
      mem: BigInt(redeemer.exUnits.mem),
      steps: BigInt(redeemer.exUnits.steps)
    })
  }
}

/**
 * Create Aiken evaluator - accepts WASM module
 */
export function makeEvaluator(wasmModule: WasmModule): TransactionBuilder.Evaluator {
  return {
    evaluate: (
      tx: Transaction.Transaction,
      additionalUtxos: ReadonlyArray<UTxO.UTxO> | undefined,
      context: TransactionBuilder.EvaluationContext
    ) =>
      Effect.gen(function* () {
        yield* Effect.logDebug("[Aiken UPLC] Starting evaluation")

        // Serialize transaction to CBOR bytes
        const txBytes = Transaction.toCBORBytes(tx)

        yield* Effect.logDebug(`[Aiken UPLC] Transaction CBOR bytes: ${txBytes.length}`)

        const utxos = additionalUtxos ?? []
        yield* Effect.logDebug(`[Aiken UPLC] Additional UTxOs: ${utxos.length}`)

        // Serialize UTxOs to CBOR arrays
        const utxosX = utxos.map(inputCBORFromUtxo)
        const utxosY = utxos.map(outputCBORFromUtxo)

        const { slotLength, zeroSlot, zeroTime } = context.slotConfig

        // Encode cost models to CBOR bytes for WASM evaluator
        const costModelsCBOR = CostModel.toCBOR(context.costModels)

        yield* Effect.logDebug(
          `[Aiken UPLC] Slot config - zeroTime: ${zeroTime}, zeroSlot: ${zeroSlot}, slotLength: ${slotLength}`
        )
        yield* Effect.logDebug(`[Aiken UPLC] Cost models CBOR length: ${costModelsCBOR.length} bytes`)
        yield* Effect.logDebug(`[Aiken UPLC] Cost models hex: ${Bytes.toHex(costModelsCBOR)}`)
        yield* Effect.logDebug(
          `[Aiken UPLC] Max execution - steps: ${context.maxTxExSteps}, mem: ${context.maxTxExMem}`
        )

        // Note: Some protocol parameters (especially cost models) may contain values
        // that overflow i64 during CBOR decoding in the WASM evaluator.
        // This is a known limitation when cost model parameters are set to large values (e.g., 2^63).
        yield* Effect.logDebug("[Aiken UPLC] Calling eval_phase_two_raw...")
        const resultBytes = yield* Effect.try({
          try: () =>
            wasmModule.eval_phase_two_raw(
              txBytes,
              utxosX,
              utxosY,
              costModelsCBOR,
              context.maxTxExSteps,
              context.maxTxExMem,
              BigInt(zeroTime),
              BigInt(zeroSlot),
              slotLength
            ),
          catch: (error) => {
            const message = error instanceof Error ? error.message : "UPLC evaluation failed"
            const failures = parseAikenError(error)
            return new TransactionBuilder.EvaluationError({
              cause: error,
              message,
              failures
            })
          }
        })

        yield* Effect.logDebug(`[Aiken UPLC] Evaluation successful - ${resultBytes.length} redeemer(s) returned`)

        const evalRedeemers = yield* Effect.try({
          try: () => resultBytes.map(evalRedeemerFromCBOR),
          catch: (error) =>
            new TransactionBuilder.EvaluationError({
              cause: error,
              message: error instanceof Error ? error.message : "Failed to parse evaluation results"
            })
        })

        return evalRedeemers
      })
  }
}
