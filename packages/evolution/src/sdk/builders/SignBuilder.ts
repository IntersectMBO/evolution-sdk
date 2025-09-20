import type { Effect } from "effect"

import type * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type { TransactionBuilderError } from "./TransactionBuilder.js"

// ============================================================================
// Progressive Builder Interfaces
// ============================================================================

export interface SignBuilderEffect {
  // Main signing method - produces a fully signed transaction ready for submission
  readonly sign: () => Effect.Effect<SubmitBuilder, TransactionBuilderError>

  // Add external witness and proceed to submission
  readonly signWithWitness: (
    witnessSet: TransactionWitnessSet.TransactionWitnessSet
  ) => Effect.Effect<SubmitBuilder, TransactionBuilderError>

  // Assemble multiple witnesses into a complete transaction ready for submission
  readonly assemble: (
    witnesses: ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>
  ) => Effect.Effect<SubmitBuilder, TransactionBuilderError>

  // Partial signing - creates witness without advancing to submission (useful for multi-sig)
  readonly partialSign: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>

  // Get witness set without signing (for inspection)
  readonly getWitnessSet: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
}

export interface SignBuilder extends EffectToPromiseAPI<SignBuilderEffect> {
  readonly Effect: SignBuilderEffect
}

export interface SubmitBuilderEffect {
  readonly submit: () => Effect.Effect<string, TransactionBuilderError>
}

export interface SubmitBuilder extends EffectToPromiseAPI<SubmitBuilderEffect> {
  readonly Effect: SubmitBuilderEffect
  readonly witnessSet: TransactionWitnessSet.TransactionWitnessSet
}