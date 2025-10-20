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

import * as Transaction from "../core/Transaction.js"
import type * as TransactionWitnessSet from "../core/TransactionWitnessSet.js"

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
 * @example
 * ```typescript
 * import * as FeeValidation from "./utils/FeeValidation.js"
 * 
 * const tx = await signBuilder.toTransaction()
 * 
 * // For unsigned transactions, include fake witnesses
 * const result = FeeValidation.validateTransactionFee(tx, {
 *   minFeeCoefficient: 44n,
 *   minFeeConstant: 155_381n
 * }, fakeWitnessSet)
 * 
 * if (!result.isValid) {
 *   console.error(`Fee too low! Need at least ${result.minRequiredFee} lovelace`)
 * } else {
 *   console.log(`Fee valid. Overpaying by ${result.difference} lovelace`)
 * }
 * ```
 * 
 * @param transaction - The transaction to validate
 * @param protocolParams - Protocol parameters for fee calculation
 * @param fakeWitnessSet - Optional witness set to use for size calculation (for unsigned tx)
 * @returns Validation result with detailed fee information
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
  const minRequiredFee = protocolParams.minFeeConstant + 
                         (protocolParams.minFeeCoefficient * BigInt(txSizeBytes))
  
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
 * @example
 * ```typescript
 * import * as FeeValidation from "./utils/FeeValidation.js"
 * 
 * const tx = await signBuilder.toTransaction()
 * 
 * // Throws if fee is invalid
 * FeeValidation.assertValidFee(tx, {
 *   minFeeCoefficient: 44n,
 *   minFeeConstant: 155_381n
 * }, fakeWitnessSet)
 * ```
 * 
 * @param transaction - The transaction to validate
 * @param protocolParams - Protocol parameters for fee calculation
 * @param fakeWitnessSet - Optional witness set to use for size calculation (for unsigned tx)
 * @throws {Error} If the fee is invalid
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
