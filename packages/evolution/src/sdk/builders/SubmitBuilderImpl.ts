/**
 * SubmitBuilder Implementation
 * 
 * Handles transaction submission by delegating to the provider's submitTx method.
 * The SubmitBuilder is responsible for:
 * 1. Converting the signed transaction to CBOR hex format
 * 2. Submitting to the provider's Effect.submitTx
 * 3. Returning the transaction hash
 * 
 * @since 2.0.0
 * @category builders
 */

import { Effect } from "effect"

import * as Transaction from "../../core/Transaction.js"
import type * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import type * as Provider from "../provider/Provider.js"
import type { SubmitBuilder, SubmitBuilderEffect } from "./SubmitBuilder.js"
import { TransactionBuilderError } from "./TransactionBuilder.js"

/**
 * Create a SubmitBuilder instance for a signed transaction.
 * 
 * @since 2.0.0
 * @category constructors
 */
export const makeSubmitBuilder = (
  signedTransaction: Transaction.Transaction,
  witnessSet: TransactionWitnessSet.TransactionWitnessSet,
  provider: Provider.Provider
): SubmitBuilder => {
  const submitEffect: SubmitBuilderEffect = {
    submit: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Submitting transaction to provider")
        
        // Convert transaction to CBOR hex for provider submission
        const txCborHex = Transaction.toCBORHex(signedTransaction)
        
        // Submit via provider's Effect.submitTx
        const txHash = yield* provider.Effect.submitTx(txCborHex).pipe(
          Effect.mapError(
            (providerError) =>
              new TransactionBuilderError({ message: "Failed to submit transaction", cause: providerError })
          )
        )
        
        yield* Effect.logDebug(`Transaction submitted successfully: ${txHash}`)
        
        return txHash
      })
  }
  
  return {
    Effect: submitEffect,
    submit: () => Effect.runPromise(submitEffect.submit()),
    witnessSet
  }
}
