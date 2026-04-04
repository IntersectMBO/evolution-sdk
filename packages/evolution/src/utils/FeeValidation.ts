/**
 * Fee Validation Utilities
 *
 * Independent validation of transaction fees using the Cardano protocol fee formula.
 * This validation is external to the transaction builder and can be used to verify
 * that fees meet the minimum requirements according to ledger rules.
 *
 * @since 2.0.0
 * @category validation
 */

import { Data, Effect } from "effect"

import * as Assets from "../Assets/index.js"
import * as Script from "../Script.js"
import { TransactionBuilderError } from "../sdk/builders/TransactionBuilder.js"
import * as Transaction from "../Transaction.js"
import type * as TransactionWitnessSet from "../TransactionWitnessSet.js"
import type * as UTxO from "../UTxO.js"

/**
 * Protocol parameters required for fee calculation.
 *
 * @since 2.0.0
 * @category model
 */
export interface FeeProtocolParams {
  /**
   * Fee coefficient (a) in the linear fee formula: fee = a × tx_size + b
   */
  readonly minFeeCoefficient: bigint

  /**
   * Fee constant (b) in the linear fee formula: fee = a × tx_size + b
   */
  readonly minFeeConstant: bigint
}

/**
 * Result of transaction fee validation.
 *
 * @since 2.0.0
 * @category model
 */
export interface FeeValidationResult {
  /**
   * Whether the transaction fee is valid (actualFee >= minRequiredFee)
   */
  readonly isValid: boolean

  /**
   * The actual fee in the transaction (in lovelace)
   */
  readonly actualFee: bigint

  /**
   * The minimum required fee according to protocol parameters (in lovelace)
   */
  readonly minRequiredFee: bigint

  /**
   * The transaction size in bytes
   */
  readonly txSizeBytes: number

  /**
   * The difference between actual and minimum fee (in lovelace)
   * Positive = overpayment, Negative = underpayment
   */
  readonly difference: bigint
}

/**
 * Validate that a transaction's fee meets the minimum requirements.
 *
 * Uses the Cardano protocol fee formula:
 * ```
 * min_fee = minFeeConstant + (minFeeCoefficient × tx_size_bytes)
 * ```
 *
 * The ledger rule is: `actualFee >= minFee`
 *
 * This function is independent of the transaction builder and provides external
 * verification of fee correctness. It serializes the transaction to CBOR to get
 * the exact size and calculates the minimum fee according to protocol parameters.
 *
 * **Important:** When validating unsigned transactions, you should provide a
 * `fakeWitnessSet` parameter to estimate the size with witnesses included. This
 * ensures the fee validation matches what the final signed transaction will be.
 *
 * @since 2.0.0
 * @category validation
 */
export const validateTransactionFee = (
  transaction: Transaction.Transaction,
  protocolParams: FeeProtocolParams,
  fakeWitnessSet?: TransactionWitnessSet.TransactionWitnessSet
): FeeValidationResult => {
  // 1. Get actual fee from transaction body
  const actualFee = transaction.body.fee

  // 2. Create transaction with witnesses if provided (for accurate size)
  const txToMeasure = fakeWitnessSet
    ? new Transaction.Transaction({
        body: transaction.body,
        witnessSet: fakeWitnessSet,
        isValid: transaction.isValid,
        auxiliaryData: transaction.auxiliaryData
      })
    : transaction

  // 3. Serialize transaction to CBOR to get exact size
  const cborBytes = Transaction.toCBORBytes(txToMeasure)
  const txSizeBytes = cborBytes.length

  // 4. Calculate minimum required fee using Cardano protocol formula
  // Formula: min_fee = minFeeConstant + (minFeeCoefficient × tx_size_bytes)
  const minRequiredFee = protocolParams.minFeeConstant + protocolParams.minFeeCoefficient * BigInt(txSizeBytes)

  // 5. Calculate difference (positive = overpayment, negative = underpayment)
  const difference = actualFee - minRequiredFee

  // 6. Validate according to ledger rule: actualFee >= minRequiredFee
  const isValid = actualFee >= minRequiredFee

  return {
    isValid,
    actualFee,
    minRequiredFee,
    txSizeBytes,
    difference
  }
}

/**
 * Assert that a transaction's fee is valid, throwing an error if not.
 *
 * Useful for tests where you want to ensure fee validity.
 *
 * @since 2.0.0
 * @category validation
 */
export const assertValidFee = (
  transaction: Transaction.Transaction,
  protocolParams: FeeProtocolParams,
  fakeWitnessSet?: TransactionWitnessSet.TransactionWitnessSet
): void => {
  const result = validateTransactionFee(transaction, protocolParams, fakeWitnessSet)

  if (!result.isValid) {
    throw new Error(
      `Transaction fee is invalid. ` +
        `Actual: ${result.actualFee} lovelace, ` +
        `Minimum required: ${result.minRequiredFee} lovelace, ` +
        `Underpayment: ${-result.difference} lovelace ` +
        `(Transaction size: ${result.txSizeBytes} bytes)`
    )
  }
}

// ============================================================================
// Fee calculation primitives
// ============================================================================

/**
 * Error raised when a fee calculation fails.
 *
 * @since 2.0.0
 * @category errors
 */
export class FeeCalculationError extends Data.TaggedError("FeeCalculationError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Calculate the CBOR-serialised byte length of a transaction.
 *
 * @since 2.0.0
 * @category fee-calculation
 */
export const calculateTransactionSize = (
  transaction: Transaction.Transaction
): number =>
  Transaction.toCBORBytes(transaction).length

/**
 * Calculate the minimum fee from transaction size and protocol parameters.
 *
 * Formula: `txSize × minFeeCoefficient + minFeeConstant`
 *
 * @since 2.0.0
 * @category fee-calculation
 */
export const calculateMinimumFee = (
  transactionSizeBytes: number,
  protocolParams: {
    minFeeCoefficient: bigint
    minFeeConstant: bigint
  }
): bigint =>
  BigInt(transactionSizeBytes) * protocolParams.minFeeCoefficient + protocolParams.minFeeConstant

/**
 * Tiered reference-script fee: direct port of the Cardano ledger's
 * `tierRefScriptFee` function.
 *
 * Each `sizeIncrement`-byte chunk is priced at `curTierPrice` per byte,
 * then `curTierPrice *= multiplier` for the next chunk.
 * Final result: `floor(total)`.
 *
 * @since 2.0.0
 * @category reference-scripts
 */
export const tierRefScriptFee = (
  multiplier: number,
  sizeIncrement: number,
  baseFee: number,
  totalSize: number
): bigint => {
  let acc = 0
  let curTierPrice = baseFee
  let remaining = totalSize

  while (remaining >= sizeIncrement) {
    acc += sizeIncrement * curTierPrice
    curTierPrice *= multiplier
    remaining -= sizeIncrement
  }
  acc += remaining * curTierPrice

  return BigInt(Math.floor(acc))
}

/**
 * Calculate the total reference-script fee for a set of UTxOs.
 *
 * Matches the Cardano node's Conway-era rules:
 * - Stride: 25,600 bytes
 * - Multiplier: 1.2× per tier
 * - Base: `minFeeRefScriptCostPerByte` protocol parameter
 * - Maximum total script size: 200,000 bytes
 *
 * Callers must pass both spent inputs and reference inputs, since the node
 * sums all `txNonDistinctRefScriptsSize` together.
 *
 * @since 2.0.0
 * @category reference-scripts
 */
export const calculateReferenceScriptFee = (
  utxos: ReadonlyArray<UTxO.UTxO>,
  costPerByte: number
): Effect.Effect<bigint, FeeCalculationError> =>
  Effect.gen(function* () {
    let totalScriptSize = 0

    for (const utxo of utxos) {
      if (utxo.scriptRef) {
        const scriptBytes = Script.toCBOR(utxo.scriptRef).length
        totalScriptSize += scriptBytes
        const scriptType = utxo.scriptRef._tag === "NativeScript" ? "Native" : "Plutus"
        yield* Effect.logDebug(`[RefScriptFee] ${scriptType} script: ${scriptBytes} bytes`)
      }
    }

    if (totalScriptSize === 0) return 0n

    yield* Effect.logDebug(`[RefScriptFee] Total reference script size: ${totalScriptSize} bytes`)

    if (totalScriptSize > 200_000) {
      return yield* Effect.fail(
        new FeeCalculationError({
          message: `Total reference script size (${totalScriptSize} bytes) exceeds maximum limit of 200,000 bytes`
        })
      )
    }

    const fee = tierRefScriptFee(1.2, 25_600, costPerByte, totalScriptSize)
    yield* Effect.logDebug(`[RefScriptFee] Tiered fee: ${fee} lovelace`)
    return fee
  })

/**
 * Validate that transaction inputs cover all outputs plus fee.
 *
 * Checks lovelace and every native asset unit. Fails with a detailed
 * TransactionBuilderError when any required asset is short.
 *
 * @since 2.0.0
 * @category validation
 */
export const validateTransactionBalance = (params: {
  totalInputAssets: Assets.Assets
  totalOutputAssets: Assets.Assets
  fee: bigint
}): Effect.Effect<void, TransactionBuilderError> =>
  Effect.gen(function* () {
    const totalRequired = Assets.withLovelace(params.totalOutputAssets, params.totalOutputAssets.lovelace + params.fee)

    for (const unit of Assets.getUnits(totalRequired)) {
      const requiredAmount = Assets.getByUnit(totalRequired, unit)
      const availableAmount = Assets.getByUnit(params.totalInputAssets, unit)

      if (availableAmount < requiredAmount) {
        const shortfall = requiredAmount - availableAmount

        return yield* Effect.fail(
          new TransactionBuilderError({
            message: `Insufficient ${unit}: need ${requiredAmount}, have ${availableAmount} (short by ${shortfall})`,
            cause: {
              unit,
              required: String(requiredAmount),
              available: String(availableAmount),
              shortfall: String(shortfall)
            }
          })
        )
      }
    }
  })

/**
 * Calculate leftover assets after paying outputs and fee.
 *
 * Filters out any zero or negative balances from the result.
 *
 * @since 2.0.0
 * @category fee-calculation
 */
export const calculateLeftoverAssets = (params: {
  totalInputAssets: Assets.Assets
  totalOutputAssets: Assets.Assets
  fee: bigint
}): Assets.Assets => {
  const afterOutputs = Assets.subtract(params.totalInputAssets, params.totalOutputAssets)
  const leftover = Assets.withLovelace(afterOutputs, afterOutputs.lovelace - params.fee)
  return Assets.filter(leftover, (_unit, amount) => amount > 0n)
}
