import type { Effect } from "effect"

import type * as Transaction from "../../Transaction.js"
import type * as TransactionHash from "../../TransactionHash.js"
import type * as TransactionWitnessSet from "../../TransactionWitnessSet.js"
import type { SubmitTx, WalletSubmit } from "../client/Capabilities.js"
import type { SubmitBuilder, SubmitBuilderOf } from "./SubmitBuilder.js"
import type { ChainResult, TransactionBuilderError } from "./TransactionBuilder.js"
import type { TransactionResultBase } from "./TransactionResult.js"

// ============================================================================
// Effect-layer interfaces
// ============================================================================

/**
 * Effect-based API for SignBuilder operations — does not include `signAndSubmit`.
 *
 * `signAndSubmit` lives on SignBuilderSubmittableEffect (added when C has submit capability).
 *
 * @typeParam C - Client capabilities (determines SubmitBuilderOf<C> return type)
 *
 * @since 2.1.0
 * @category interfaces
 */
export interface SignBuilderEffect<C = SubmitTx & WalletSubmit> {
  readonly toTransaction: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>
  readonly toTransactionWithFakeWitnesses: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>
  readonly estimateFee: () => Effect.Effect<bigint, TransactionBuilderError>
  readonly sign: () => Effect.Effect<SubmitBuilderOf<C>, TransactionBuilderError>
  readonly signWithWitness: (
    witnessSet: TransactionWitnessSet.TransactionWitnessSet
  ) => Effect.Effect<SubmitBuilderOf<C>, TransactionBuilderError>
  readonly assemble: (
    witnesses: ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>
  ) => Effect.Effect<SubmitBuilderOf<C>, TransactionBuilderError>
  readonly partialSign: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
  readonly getWitnessSet: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
}

/**
 * Extended Effect-based API adding `signAndSubmit` — only when C has submit capability.
 *
 * Accessible via SignBuilderOf<C> when C extends SubmitTx | WalletSubmit.
 *
 * @typeParam C - Client capabilities
 *
 * @since 2.1.0
 * @category interfaces
 */
export interface SignBuilderSubmittableEffect<C = SubmitTx & WalletSubmit> extends SignBuilderEffect<C> {
  readonly signAndSubmit: () => Effect.Effect<TransactionHash.TransactionHash, TransactionBuilderError>
}

// ============================================================================
// Promise-layer interfaces (explicit listing — conditional types cannot be used in extends)
// ============================================================================

/**
 * Base SignBuilder available whenever the client has Signable capability.
 *
 * `sign()`, `signWithWitness()`, and `assemble()` return `SubmitBuilderOf<C>`:
 * - `SubmitBuilder` (with `.submit()`) when C extends SubmitTx | WalletSubmit
 * - `SubmitBuilderBase` (witness set only) otherwise
 *
 * Does NOT include `signAndSubmit()` — that lives on SignBuilder<C> when C can submit.
 *
 * @typeParam C - Client capabilities
 *
 * @since 2.1.0
 * @category interfaces
 */
export interface SignBuilderBase<C = never> extends TransactionResultBase {
  readonly Effect: SignBuilderEffect<C>
  /**
   * Compute chain result for building dependent transactions.
   * Contains consumed UTxOs, available UTxOs (remaining + created), and txHash.
   *
   * Result is memoized — computed once on first call, cached for subsequent calls.
   */
  readonly chainResult: () => ChainResult
  readonly sign: () => Promise<SubmitBuilderOf<C>>
  readonly signWithWitness: (
    witnessSet: TransactionWitnessSet.TransactionWitnessSet
  ) => Promise<SubmitBuilderOf<C>>
  readonly assemble: (
    witnesses: ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>
  ) => Promise<SubmitBuilderOf<C>>
  readonly partialSign: () => Promise<TransactionWitnessSet.TransactionWitnessSet>
  readonly getWitnessSet: () => Promise<TransactionWitnessSet.TransactionWitnessSet>
}

/**
 * Full SignBuilder — extends SignBuilderBase with `signAndSubmit()`.
 *
 * Only directly accessible when C extends SubmitTx | WalletSubmit, enforced via
 * `SignBuilderOf<C>`. Default `C = SubmitTx & WalletSubmit` preserves backward
 * compatibility for code that uses `SignBuilder` without a type argument.
 *
 * @typeParam C - Client capabilities (defaults to SubmitTx & WalletSubmit for backwards compat)
 *
 * @since 2.0.0
 * @category interfaces
 */
export interface SignBuilder<C = SubmitTx & WalletSubmit> extends SignBuilderBase<C> {
  readonly Effect: SignBuilderSubmittableEffect<C>
  /**
   * Sign and submit the transaction in one step.
   *
   * Convenience method combining sign() + submit().
   * Only available when C has SubmitTx or WalletSubmit capability.
   *
   * @since 2.0.0
   */
  readonly signAndSubmit: () => Promise<TransactionHash.TransactionHash>
}

/**
 * Conditional sign builder type based on client submit capability.
 *
 * - C extends SubmitTx | WalletSubmit → SignBuilder<C> (includes signAndSubmit)
 * - otherwise → SignBuilderBase<C> (no signAndSubmit, sign returns SubmitBuilderBase)
 *
 * Used as the result type of TxBuilder.build() and assembleFinalResult.
 *
 * @since 2.1.0
 * @category builder-types
 */
export type SignBuilderOf<C> = C extends SubmitTx | WalletSubmit ? SignBuilder<C> : SignBuilderBase<C>

// Re-export SubmitBuilder for convenience (used by callers that import from this module)
export type { SubmitBuilder }
