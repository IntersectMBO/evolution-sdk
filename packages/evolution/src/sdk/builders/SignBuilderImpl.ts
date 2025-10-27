/**
 * SignBuilder Implementation
 * 
 * Handles transaction signing by delegating to the wallet's signTx Effect method.
 * The SignBuilder is responsible for:
 * 1. Providing the transaction and UTxO context to the wallet
 * 2. Managing the transition from unsigned to signed transaction
 * 3. Creating the SubmitBuilder for transaction submission
 * 
 * The actual signing logic (determining required signers, creating witnesses) 
 * is the wallet's responsibility.
 * 
 * @since 2.0.0
 * @category builders
 */

import { Effect } from "effect"

import * as Transaction from "../../core/Transaction.js"
import type * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import type * as Provider from "../provider/Provider.js"
import type * as UTxO from "../UTxO.js"
import type * as WalletNew from "../wallet/WalletNew.js"
import type { SignBuilder, SignBuilderEffect } from "./SignBuilder.js"
import { makeSubmitBuilder } from "./SubmitBuilderImpl.js"
import { TransactionBuilderError } from "./TransactionBuilder.js"

// ============================================================================
// SignBuilder Factory
// ============================================================================

/**
 * Wallet type - can be SigningWallet or ApiWallet (both have Effect.signTx)
 */
type Wallet = WalletNew.SigningWallet | WalletNew.ApiWallet

/**
 * Create a SignBuilder instance for a built transaction.
 * 
 * @param transaction - The unsigned transaction (body only, no witnesses)
 * @param transactionWithFakeWitnesses - The transaction with fake witnesses for size validation
 * @param fee - The calculated transaction fee in lovelace
 * @param utxos - The UTxOs that were used as inputs (for wallet to determine required signers)
 * @param wallet - The wallet that will sign the transaction
 * @param provider - The provider to submit the transaction to
 * 
 * @since 2.0.0
 * @category constructors
 */
export const makeSignBuilder = (params: {
  transaction: Transaction.Transaction
  transactionWithFakeWitnesses: Transaction.Transaction
  fee: bigint
  utxos: ReadonlyArray<UTxO.UTxO>
  provider: Provider.Provider
  wallet: Wallet
}): SignBuilder => {
  const { fee, provider, transaction, transactionWithFakeWitnesses, utxos, wallet } = params

  // ============================================================================
  // Effect Namespace Implementation
  // ============================================================================

  const signEffect: SignBuilderEffect = {
    /**
     * Sign the transaction by delegating to the wallet's Effect.signTx method.
     * 
     * The wallet will:
     * 1. Determine which keys are required based on transaction inputs/outputs
     * 2. Create VKey witnesses for each required signature
     * 3. Return the witness set
     * 
     * SignBuilder then assembles the signed transaction and returns SubmitBuilder.
     */
    sign: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Starting transaction signing (delegating to wallet Effect)")

        // Delegate to wallet's Effect.signTx with UTxO context
        const witnessSet = yield* wallet.Effect.signTx(transaction, { utxos }).pipe(
          Effect.mapError(
            (walletError) =>
              new TransactionBuilderError({ message: "Failed to sign transaction", cause: walletError })
          )
        )

        yield* Effect.logDebug(`Received witness set from wallet: ${witnessSet.vkeyWitnesses?.length ?? 0} VKey witnesses`)

        // Create signed transaction by combining transaction body with witness set
        const signedTransaction = new Transaction.Transaction({
          body: transaction.body,
          witnessSet,
          isValid: transaction.isValid,
          auxiliaryData: transaction.auxiliaryData
        })

        yield* Effect.logDebug("Transaction signed successfully")

        // Return SubmitBuilder
        return makeSubmitBuilder(signedTransaction, witnessSet, provider)
      }),

    // TODO: Implement these methods
    signWithWitness: (_witnessSet: TransactionWitnessSet.TransactionWitnessSet) =>
      Effect.fail(new TransactionBuilderError({ message: "signWithWitness not yet implemented" })),

    assemble: (_witnesses: ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>) =>
      Effect.fail(new TransactionBuilderError({ message: "assemble not yet implemented" })),

    partialSign: () => Effect.fail(new TransactionBuilderError({ message: "partialSign not yet implemented" })),

    getWitnessSet: () => Effect.succeed(transaction.witnessSet),

    toTransaction: () => Effect.succeed(transaction),

    toTransactionWithFakeWitnesses: () => Effect.succeed(transactionWithFakeWitnesses),

    estimateFee: () => Effect.succeed(fee)
  }

  // ============================================================================
  // Promise-based API (using Effect.runPromise)
  // ============================================================================

  return {
    Effect: signEffect,
    sign: () => Effect.runPromise(signEffect.sign()),
    signWithWitness: (witnessSet: TransactionWitnessSet.TransactionWitnessSet) =>
      Effect.runPromise(signEffect.signWithWitness(witnessSet)),
    assemble: (witnesses: ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>) =>
      Effect.runPromise(signEffect.assemble(witnesses)),
    partialSign: () => Effect.runPromise(signEffect.partialSign()),
    getWitnessSet: () => Effect.runPromise(signEffect.getWitnessSet()),
    toTransaction: () => Effect.runPromise(signEffect.toTransaction()),
    toTransactionWithFakeWitnesses: () => Effect.runPromise(signEffect.toTransactionWithFakeWitnesses()),
    estimateFee: () => Effect.runPromise(signEffect.estimateFee())
  }
}
