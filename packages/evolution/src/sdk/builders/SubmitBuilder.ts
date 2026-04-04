/**
 * SubmitBuilder - Final stage of transaction lifecycle
 *
 * Represents a signed transaction ready for submission to the blockchain.
 * Provides the submit() method to broadcast the transaction and retrieve the transaction hash.
 *
 * @since 2.0.0
 * @category builders
 */

import type { Effect } from "effect"

import type * as TransactionHash from "../../TransactionHash.js"
import type * as TransactionWitnessSet from "../../TransactionWitnessSet.js"
import type { SubmitTx, WalletSubmit } from "../client/Capabilities.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type { TransactionBuilderError } from "./TransactionBuilder.js"

/**
 * Base result after signing — always available regardless of submit capability.
 *
 * Provides access to the witness set for multi-party signing, hardware wallet
 * workflows, and other scenarios where submission happens separately.
 *
 * @since 2.1.0
 * @category interfaces
 */
export interface SubmitBuilderBase {
  /**
   * The witness set containing all signatures for this transaction.
   *
   * Can be used to inspect the signatures or combine with other witness sets
   * for multi-party signing scenarios.
   *
   * @since 2.0.0
   */
  readonly witnessSet: TransactionWitnessSet.TransactionWitnessSet
}

/**
 * Effect-based API for SubmitBuilder operations.
 *
 * @since 2.0.0
 * @category interfaces
 */
export interface SubmitBuilderEffect {
  /**
   * Submit the signed transaction to the blockchain via the provider.
   *
   * @returns Effect resolving to the transaction hash
   * @since 2.0.0
   */
  readonly submit: () => Effect.Effect<TransactionHash.TransactionHash, TransactionBuilderError>
}

/**
 * SubmitBuilder - represents a signed transaction ready for submission.
 *
 * Extends SubmitBuilderBase with submit capability. Only accessible when the
 * client has SubmitTx or WalletSubmit capability (enforced via SubmitBuilderOf<C>).
 *
 * @since 2.0.0
 * @category interfaces
 */
export interface SubmitBuilder extends SubmitBuilderBase, EffectToPromiseAPI<SubmitBuilderEffect> {
  /**
   * Effect-based API for compositional workflows.
   *
   * @since 2.0.0
   */
  readonly Effect: SubmitBuilderEffect
}

/**
 * Conditional submit builder: includes submit() when C has SubmitTx or WalletSubmit capability.
 *
 * Used as the return type of SignBuilder.sign(), SignBuilder.signWithWitness(), and
 * SignBuilder.assemble() to enforce capability constraints at compile time.
 *
 * @since 2.1.0
 * @category builder-types
 */
export type SubmitBuilderOf<C> = C extends SubmitTx | WalletSubmit ? SubmitBuilder : SubmitBuilderBase
