import type { Effect } from "effect"

import type * as Transaction from "../../core/Transaction.js"
import type * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type { SubmitBuilder } from "./SubmitBuilder.js"
import type { TransactionBuilderError } from "./TransactionBuilder.js"
import type { TransactionResultBase } from "./TransactionResult.js"

// ============================================================================
// Progressive Builder Interfaces
// ============================================================================

/**
 * Effect-based API for SignBuilder operations.
 * 
 * Includes all TransactionResultBase.Effect methods plus signing-specific operations.
 * 
 * @since 2.0.0
 * @category interfaces
 */
export interface SignBuilderEffect {
  // Base transaction methods (from TransactionResultBase)
  readonly toTransaction: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>
  readonly toTransactionWithFakeWitnesses: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>
  readonly estimateFee: () => Effect.Effect<bigint, TransactionBuilderError>

  // Signing methods
  readonly sign: () => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  readonly signWithWitness: (
    witnessSet: TransactionWitnessSet.TransactionWitnessSet
  ) => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  readonly assemble: (
    witnesses: ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>
  ) => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  readonly partialSign: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
  readonly getWitnessSet: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
}

/**
 * SignBuilder extends TransactionResultBase with signing capabilities.
 * 
 * Only available when the client has a signing wallet (seed, private key, or API wallet).
 * Provides access to unsigned transaction (via base interface) and signing operations.
 * 
 * @since 2.0.0
 * @category interfaces
 */
export interface SignBuilder extends TransactionResultBase, EffectToPromiseAPI<SignBuilderEffect> {
  readonly Effect: SignBuilderEffect
}
