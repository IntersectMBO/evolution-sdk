import { Effect, Ref } from "effect"

import * as Transaction from "../../../Transaction.js"
import * as CoreUTxO from "../../../UTxO.js"
import * as Balance from "../phases/Balance.js"
import * as ChangeCreation from "../phases/ChangeCreation.js"
import * as Collateral from "../phases/Collateral.js"
import * as Evaluation from "../phases/Evaluation.js"
import * as Fallback from "../phases/Fallback.js"
import * as FeeCalculation from "../phases/FeeCalculation.js"
import * as Selection from "../phases/Selection.js"
import * as SignBuilderImpl from "../SignBuilderImpl.js"
import type { BuildOptions, ProgramStep, TxBuilderConfig } from "../TransactionBuilder.js"
import { AvailableUtxosTag, PhaseContextTag, ProtocolParametersTag, TransactionBuilderError, TxBuilderConfigTag, TxContext } from "../TransactionBuilder.js"
import * as TransactionResult from "../TransactionResult.js"
import * as BuilderLayers from "./layers.js"
import * as BuilderState from "./state.js"
import * as TxBuilderImpl from "./txBuilder.js"

const assembleFinalResult = (
  transaction: Transaction.Transaction,
  txWithFakeWitnesses: Transaction.Transaction
) =>
  Effect.gen(function* () {
    const config = yield* TxBuilderConfigTag
    const buildContextRef = yield* PhaseContextTag
    const buildContext = yield* Ref.get(buildContextRef)
    const stateRef = yield* TxContext
    const state = yield* Ref.get(stateRef)
    const availableUtxos = yield* AvailableUtxosTag

    const wallet = config.wallet
    if (wallet?.type === "signing" || wallet?.type === "api") {
      const provider = config.provider
      if (provider === undefined) {
        return yield* Effect.fail(
          new TransactionBuilderError({ message: "Signing transaction builds require a provider." })
        )
      }

      return SignBuilderImpl.makeSignBuilder({
        transaction,
        transactionWithFakeWitnesses: txWithFakeWitnesses,
        fee: buildContext.calculatedFee,
        utxos: state.selectedUtxos,
        referenceUtxos: state.referenceInputs,
        provider,
        wallet,
        outputs: state.outputs,
        availableUtxos
      })
    }

    return TransactionResult.makeTransactionResult({
      transaction,
      transactionWithFakeWitnesses: txWithFakeWitnesses,
      fee: buildContext.calculatedFee
    })
  })

const phaseMap = {
  selection: Selection.executeSelection,
  changeCreation: ChangeCreation.executeChangeCreation,
  feeCalculation: FeeCalculation.executeFeeCalculation,
  balance: Balance.executeBalance,
  evaluation: Evaluation.executeEvaluation,
  collateral: Collateral.executeCollateral,
  fallback: Fallback.executeFallback
}

const assembleAndValidateTransaction = Effect.gen(function* () {
  const buildContextRef = yield* PhaseContextTag
  const buildContext = yield* Ref.get(buildContextRef)
  const stateRef = yield* TxContext

  yield* Effect.logDebug(`Build complete - fee: ${buildContext.calculatedFee}`)

  if (buildContext.changeOutputs.length > 0) {
    yield* Ref.update(stateRef, (state) => ({
      ...state,
      outputs: [...state.outputs, ...buildContext.changeOutputs]
    }))

    yield* Effect.logDebug(`Added ${buildContext.changeOutputs.length} change output(s) to transaction`)
  }

  const finalState = yield* Ref.get(stateRef)
  const selectedUtxos = finalState.selectedUtxos
  const allOutputs = finalState.outputs

  yield* Effect.logDebug(
    `Assembling transaction: ${selectedUtxos.length} inputs, ${allOutputs.length} outputs, fee: ${buildContext.calculatedFee}`
  )

  const inputs = CoreUTxO.toInputs(selectedUtxos)
  const transaction = yield* TxBuilderImpl.assembleTransaction(inputs, allOutputs, buildContext.calculatedFee)

  const allUtxosForWitnesses = finalState.collateral !== undefined
    ? [...selectedUtxos, ...finalState.collateral.inputs]
    : selectedUtxos
  const fakeWitnessSet = yield* TxBuilderImpl.buildFakeWitnessSet(allUtxosForWitnesses)

  const txWithFakeWitnesses = new Transaction.Transaction({
    body: transaction.body,
    witnessSet: fakeWitnessSet,
    isValid: true,
    auxiliaryData: finalState.auxiliaryData ?? null
  })

  const txSizeWithWitnesses = TxBuilderImpl.calculateTransactionSize(txWithFakeWitnesses)
  const protocolParameters = yield* ProtocolParametersTag

  yield* Effect.logDebug(
    `Transaction size: ${txSizeWithWitnesses} bytes ` +
      `(with ${fakeWitnessSet.vkeyWitnesses?.length ?? 0} fake witnesses), ` +
      `max=${protocolParameters.maxTxSize} bytes`
  )

  if (txSizeWithWitnesses > protocolParameters.maxTxSize) {
    return yield* Effect.fail(
      new TransactionBuilderError({
        message:
          `Transaction size (${txSizeWithWitnesses} bytes) exceeds protocol maximum (${protocolParameters.maxTxSize} bytes). ` +
          `Consider splitting into multiple transactions.`
      })
    )
  }

  return { transaction, txWithFakeWitnesses }
})

const phaseStateMachine = Effect.gen(function* () {
  const phaseContextRef = yield* PhaseContextTag

  while (true) {
    const phaseContext = yield* Ref.get(phaseContextRef)

    if (phaseContext.phase === "complete") {
      break
    }

    const phase = phaseMap[phaseContext.phase]
    if (phase === undefined) {
      return yield* Effect.fail(
        new TransactionBuilderError({ message: `Unknown phase: ${phaseContext.phase}` })
      )
    }

    const result = yield* phase()

    yield* Ref.update(phaseContextRef, (context) => ({ ...context, phase: result.next }))
  }

  return yield* assembleAndValidateTransaction
})

/**
 * Executes the complete transaction build pipeline using a build-scoped Layer
 * environment.
 */
export const makeBuild = (
  config: TxBuilderConfig,
  programs: Array<ProgramStep>,
  options: BuildOptions = BuilderState.DEFAULT_BUILD_OPTIONS
) =>
  Effect.gen(function* () {
    yield* Effect.all(programs, { concurrency: "unbounded" })

    const { transaction, txWithFakeWitnesses } = yield* phaseStateMachine

    return yield* assembleFinalResult(transaction, txWithFakeWitnesses)
  }).pipe(Effect.provide(BuilderLayers.makeBuildRuntimeLayer(config, options)))

// TODO: Add a real "debug build" API that lets developers preview how a transaction
// looks (inputs, outputs, fees, scripts) without requiring a full provider round-trip.
// Useful for local development and troubleshooting transaction assembly issues.