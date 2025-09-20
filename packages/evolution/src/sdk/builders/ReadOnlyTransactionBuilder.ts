import type { Effect } from "effect"

import type * as Transaction from "../../core/Transaction.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as UTxO from "../UTxO.js"
import type { BuildOptions, TransactionBuilderEffect, TransactionBuilderError, TransactionEstimate } from "./TransactionBuilder.js"

// ============================================================================
// Read-Only Transaction Builder Interfaces
// ============================================================================

/**
 * Generic utility type to transform a transaction builder interface into a read-only version.
 * Automatically converts all methods that return the original builder type to return the read-only version.
 *
 * Benefits:
 * - Eliminates manual duplication of all builder methods
 * - Automatically stays in sync when TransactionBuilderEffect changes
 * - Type-safe transformation with zero runtime overhead
 * - Maintainable and DRY (Don't Repeat Yourself)
 *
 * @since 2.0.0
 * @category type-utils
 */
type ToReadOnlyBuilder<TBuilder, TReadOnlyBuilder> = {
  [K in keyof TBuilder]: TBuilder[K] extends (...args: infer Args) => TBuilder
    ? (...args: Args) => TReadOnlyBuilder
    : TBuilder[K]
}

/**
 * Read-only transaction builder interface automatically derived from TransactionBuilderEffect.
 * Uses TypeScript generics to avoid manual duplication and automatically stays in sync with changes.
 *
 * This interface inherits ALL methods from TransactionBuilderEffect automatically:
 * - payToAddress, payToScript, mintTokens, burnTokens, etc. (automatically included)
 * - All methods return ReadOnlyTransactionBuilderEffect for fluent chaining
 * - Removes signing methods (buildAndSign, buildSignAndSubmit)
 * - Overrides build methods to return read-only transaction data
 *
 * @since 2.0.0
 * @category builders
 */
export interface ReadOnlyTransactionBuilderEffect
  extends Omit<
    ToReadOnlyBuilder<TransactionBuilderEffect, ReadOnlyTransactionBuilderEffect>,
    "buildAndSign" | "buildSignAndSubmit" | "build" | "chain" | "estimateFee" | "draftTx"
  > {
  // Override build methods to return read-only results instead of signing capabilities
  readonly build: (
    options?: BuildOptions
  ) => Effect.Effect<{ transaction: Transaction.Transaction; cost: TransactionEstimate }, TransactionBuilderError>

  readonly estimateFee: (options?: BuildOptions) => Effect.Effect<TransactionEstimate, TransactionBuilderError>

  readonly draftTx: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>

  // Read-only chain method returns transaction data without signing capabilities
  readonly chain: (
    options?: BuildOptions
  ) => Effect.Effect<
    { transaction: Transaction.Transaction; newUtxos: ReadonlyArray<UTxO.UTxO> },
    TransactionBuilderError
  >
}

/**
 * Promise-based read-only transaction builder interface.
 *
 * @since 2.0.0
 * @category builders
 */
export interface ReadOnlyTransactionBuilder extends EffectToPromiseAPI<ReadOnlyTransactionBuilderEffect> {
  readonly Effect: ReadOnlyTransactionBuilderEffect
}