/**
 * Transaction builder storing a sequence of deferred operations that assemble and balance a transaction.
 *
 * @module TransactionBuilder
 * @since 2.0.0
 *
 * ## Execution Model
 *
 * The builder pattern:
 * - **Immutable configuration** at construction (protocol params, change address, available UTxOs)
 * - **ProgramSteps array** accumulates deferred effects via chainable API methods
 * - **Fresh state per build()** — each execution creates new Ref instances, runs all programs sequentially
 * - **Deferred composition** — no I/O or state updates occur until build() is invoked
 *
 * Key invariant: calling `build()` twice with the same builder instance produces two independent results
 * with no cross-contamination because fresh state (Refs) is created each time.
 *
 * ## Coin Selection
 *
 * Automatic coin selection selects UTxOs from `availableUtxos` to satisfy transaction outputs and fees.
 * The `collectFrom()` method allows manual input selection; automatic selection excludes these to prevent
 * double-spending. UTxOs can come from any source (wallet, DeFi protocols, other participants, etc.).
 *
 * @since 2.0.0
 */

// Effect-TS imports
import { Context, Data, Effect, Layer, Logger, LogLevel, Ref } from "effect"
import type { Either } from "effect/Either"

import type * as Coin from "../../core/Coin.js"
import * as Transaction from "../../core/Transaction.js"
import { runEffect } from "../../utils/effect-runtime.js"
import type * as Assets from "../Assets.js"
import type { EvalRedeemer } from "../EvalRedeemer.js"
import type * as Provider from "../provider/Provider.js"
import type * as UTxO from "../UTxO.js"
import type * as WalletNew from "../wallet/WalletNew.js"
import type { CoinSelectionAlgorithm, CoinSelectionFunction } from "./CoinSelection.js"
import type { CollectFromParams, PayToAddressParams } from "./operations/Operations.js"
import { executeBalance } from "./phases/Balance.js"
import { executeChangeCreation } from "./phases/ChangeCreation.js"
import { executeFallback } from "./phases/Fallback.js"
import { executeFeeCalculation } from "./phases/FeeCalculation.js"
import { executeSelection } from "./phases/Selection.js"
import type { SignBuilder } from "./SignBuilder.js"
import { makeSignBuilder } from "./SignBuilderImpl.js"
import type { TransactionResultBase } from "./TransactionResult.js"
import { makeTransactionResult } from "./TransactionResult.js"
import {
  assembleTransaction,
  buildFakeWitnessSet,
  buildTransactionInputs,
  calculateTransactionSize,
  createCollectFromProgram,
  createPayToAddressProgram
} from "./TxBuilderImpl.js"

/**
 * Error type for failures occurring during transaction builder operations.
 *
 * @since 2.0.0
 * @category errors
 */
export class TransactionBuilderError extends Data.TaggedError("TransactionBuilderError")<{
  message?: string
  cause?: unknown
}> {}

/**
 * Build phases
 */
type Phase = "selection" | "changeCreation" | "feeCalculation" | "balance" | "fallback" | "complete"

/**
 * BuildContext - state machine context
 */
interface PhaseContext {
  readonly phase: Phase
  readonly attempt: number
  readonly calculatedFee: bigint
  readonly shortfall: bigint
  readonly changeOutputs: ReadonlyArray<UTxO.TxOutput>
  readonly leftoverAfterFee: Assets.Assets
  readonly canUnfrack: boolean
}

// const PhaseContextTag = Context.GenericTag<Ref.Ref<BuildContext>>("PhaseContext")
export class PhaseContextTag extends Context.Tag("PhaseContextTag")<PhaseContextTag, Ref.Ref<PhaseContext>>() {}
// export class TxContext extends Context.Tag("TxContext")<TxContext, TxContextData>() {}

// Initial state for transaction builder
const initialTxBuilderState: TxBuilderState = {
  selectedUtxos: [],
  outputs: [],
  scripts: new Map(),
  totalOutputAssets: { lovelace: 0n },
  totalInputAssets: { lovelace: 0n },
  redeemers: new Map()
}

/**
 * Resolve protocol parameters from options, provider, or fail.
 * Priority: BuildOptions override > provider.getProtocolParameters() > error
 */
const resolveProtocolParameters = (
  config: TxBuilderConfig,
  options?: BuildOptions
): Effect.Effect<ProtocolParameters, TransactionBuilderError | Provider.ProviderError> => {
  if (options?.protocolParameters !== undefined) {
    return Effect.succeed(options.protocolParameters)
  }

  if (config.provider) {
    return Effect.map(
      config.provider.Effect.getProtocolParameters(),
      (params): ProtocolParameters => ({
        minFeeCoefficient: BigInt(params.minFeeA),
        minFeeConstant: BigInt(params.minFeeB),
        coinsPerUtxoByte: params.coinsPerUtxoByte,
        maxTxSize: params.maxTxSize
      })
    )
  }

  return Effect.fail(
    new TransactionBuilderError({
      message:
        "No protocol parameters provided. Either provide protocolParameters in BuildOptions or provider in config.",
      cause: null
    })
  )
}

/**
 * Resolve change address from options, wallet, or fail.
 * Priority: BuildOptions override > wallet.address() > error
 */
const resolveChangeAddress = (
  config: TxBuilderConfig,
  options?: BuildOptions
): Effect.Effect<string, TransactionBuilderError | WalletNew.WalletError> => {
  if (options?.changeAddress) {
    return Effect.succeed(options.changeAddress)
  }

  if (config.wallet) {
    return config.wallet.Effect.address()
  }

  return Effect.fail(
    new TransactionBuilderError({
      message: "No change address provided. Either provide wallet in config or changeAddress in build options.",
      cause: null
    })
  )
}

/**
 * Resolve available UTxOs from options, provider+wallet, or fail.
 * Priority: BuildOptions override > provider.getUtxos(wallet.address) > error
 */
const resolveAvailableUtxos = (
  config: TxBuilderConfig,
  options?: BuildOptions
): Effect.Effect<
  ReadonlyArray<UTxO.UTxO>,
  TransactionBuilderError | WalletNew.WalletError | Provider.ProviderError
> => {
  if (options?.availableUtxos) {
    return Effect.succeed(options.availableUtxos)
  }

  if (config.wallet && config.provider) {
    return Effect.flatMap(config.wallet.Effect.address(), (addr) => config.provider!.Effect.getUtxos(addr))
  }

  return Effect.fail(
    new TransactionBuilderError({
      message:
        "No available UTxOs provided. Either provide wallet+provider in config or availableUtxos in build options.",
      cause: null
    })
  )
}

/**
 * Assemble final builder result based on wallet capabilities.
 * Accesses transaction data from context tags.
 */
const assembleFinalResult = (
  config: TxBuilderConfig,
  transaction: Transaction.Transaction,
  txWithFakeWitnesses: Transaction.Transaction
): Effect.Effect<SignBuilder | TransactionResultBase, never, PhaseContextTag | TxContext> =>
  Effect.gen(function* () {
    const buildCtxRef = yield* PhaseContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)
    const stateRef = yield* TxContext
    const state = yield* Ref.get(stateRef)

    const wallet = config.wallet

    if (wallet?.type === "signing" || wallet?.type === "api") {
      return makeSignBuilder({
        transaction,
        transactionWithFakeWitnesses: txWithFakeWitnesses,
        fee: buildCtx.calculatedFee,
        utxos: state.selectedUtxos,
        provider: config.provider!,
        wallet
      })
    }

    return makeTransactionResult({
      transaction,
      transactionWithFakeWitnesses: txWithFakeWitnesses,
      fee: buildCtx.calculatedFee
    })
  })

/**
 * Phase handler map for routing phase execution.
 * Each handler executes its specific phase logic and returns a PhaseResult indicating the next phase.
 * All phase implementations are now modularized in the phases/ directory.
 */
const phaseMap = {
  selection: executeSelection,
  changeCreation: executeChangeCreation,
  feeCalculation: executeFeeCalculation,
  balance: executeBalance,
  fallback: executeFallback
}

/**
 * Assemble and validate transaction after phase loop completes.
 */
const assembleAndValidateTransaction = Effect.gen(function* () {
  const buildCtxRef = yield* PhaseContextTag
  const buildCtx = yield* Ref.get(buildCtxRef)
  const stateRef = yield* TxContext

  yield* Effect.logDebug(`Build complete - fee: ${buildCtx.calculatedFee}`)

  // Add change outputs to the transaction outputs
  if (buildCtx.changeOutputs.length > 0) {
    yield* Ref.update(stateRef, (s) => ({
      ...s,
      outputs: [...s.outputs, ...buildCtx.changeOutputs]
    }))

    yield* Effect.logDebug(`Added ${buildCtx.changeOutputs.length} change output(s) to transaction`)
  }

  // Get final inputs and outputs for transaction assembly
  const finalState = yield* Ref.get(stateRef)
  const selectedUtxos = finalState.selectedUtxos
  const allOutputs = finalState.outputs

  yield* Effect.logDebug(
    `Assembling transaction: ${selectedUtxos.length} inputs, ${allOutputs.length} outputs, fee: ${buildCtx.calculatedFee}`
  )

  // Build transaction inputs and assemble transaction body
  const inputs = yield* buildTransactionInputs(selectedUtxos)
  const transaction = yield* assembleTransaction(inputs, allOutputs, buildCtx.calculatedFee)

  // SAFETY CHECK: Validate transaction size against protocol limit
  const fakeWitnessSet = yield* buildFakeWitnessSet(selectedUtxos)

  const txWithFakeWitnesses = new Transaction.Transaction({
    body: transaction.body,
    witnessSet: fakeWitnessSet,
    isValid: true,
    auxiliaryData: null
  })

  const txSizeWithWitnesses = yield* calculateTransactionSize(txWithFakeWitnesses)
  const protocolParams = yield* ProtocolParametersTag

  yield* Effect.logDebug(
    `Transaction size: ${txSizeWithWitnesses} bytes ` +
      `(with ${fakeWitnessSet.vkeyWitnesses?.length ?? 0} fake witnesses), ` +
      `max=${protocolParams.maxTxSize} bytes`
  )

  if (txSizeWithWitnesses > protocolParams.maxTxSize) {
    return yield* Effect.fail(
      new TransactionBuilderError({
        message:
          `Transaction size (${txSizeWithWitnesses} bytes) exceeds protocol maximum (${protocolParams.maxTxSize} bytes). ` +
          `Consider splitting into multiple transactions.`
      })
    )
  }

  return { transaction, txWithFakeWitnesses }
})

const phaseStateMachine = Effect.gen(function* () {
  // Get phase context ref once (doesn't change during execution)
  const phaseContextRef = yield* PhaseContextTag

  // Phase loop
  while (true) {
    const phaseContext = yield* Ref.get(phaseContextRef)

    // Terminal state
    if (phaseContext.phase === "complete") {
      break
    }

    // Route to phase handler
    const phase = phaseMap[phaseContext.phase]
    if (!phase) {
      return yield* Effect.fail(new TransactionBuilderError({ message: `Unknown phase: ${phaseContext.phase}` }))
    }

    const result = yield* phase()

    // Update phase
    yield* Ref.update(phaseContextRef, (c) => ({ ...c, phase: result.next }))
  }

  // Assemble and validate transaction
  return yield* assembleAndValidateTransaction
})

/**
 * Default BuildOptions for safe transaction building.
 *
 * **Safety Principles:**
 * - coinSelection: "largest-first" (deterministic, efficient)
 * - onInsufficientChange: "error" (prevents accidental fund loss)
 * - setCollateral: 5_000_000n (5 ADA for script collateral)
 */
const DEFAULT_BUILD_OPTIONS = {
  coinSelection: "largest-first",
  onInsufficientChange: "error",
  setCollateral: 5_000_000n
} as const

const buildEffectCore = (
  config: TxBuilderConfig,
  programs: Array<ProgramStep>,
  options: BuildOptions = DEFAULT_BUILD_OPTIONS
) =>
  Effect.gen(function* () {
    // Resolve all required resources
    const protocolParameters = yield* resolveProtocolParameters(config, options)
    const changeAddress = yield* resolveChangeAddress(config, options)
    const availableUtxos = yield* resolveAvailableUtxos(config, options)

    // Execute all programs
    yield* Effect.all(programs, { concurrency: "unbounded" })

    // Run state machine with resolved services
    const { transaction, txWithFakeWitnesses } = yield* phaseStateMachine.pipe(
      Effect.provideService(ProtocolParametersTag, protocolParameters),
      Effect.provideService(ChangeAddressTag, changeAddress),
      Effect.provideService(AvailableUtxosTag, availableUtxos)
    )

    // Assemble and return final result
    return yield* assembleFinalResult(config, transaction, txWithFakeWitnesses)
  }).pipe(
    Effect.provideServiceEffect(
      TxContext,
      Ref.make(initialTxBuilderState)
    ),
    Effect.provideService(BuildOptionsTag, options),
    Effect.provideServiceEffect(
      PhaseContextTag,
      Ref.make<PhaseContext>({
        phase: "selection",
        attempt: 0,
        calculatedFee: 0n,
        shortfall: 0n,
        changeOutputs: [],
        leftoverAfterFee: { lovelace: 0n },
        canUnfrack: options?.unfrack !== undefined
      })
    )
  )

// Core Effect logic for chaining
const chainEffectCore = (
  config: TxBuilderConfig,
  programs: Array<ProgramStep>,
  _options: BuildOptions = DEFAULT_BUILD_OPTIONS
) =>
  Effect.gen(function* () {
    // Chain logic: Execute programs and return intermediate state
    return {} as ChainResult
  }).pipe(
    Effect.provideServiceEffect(
      TxContext,
      Ref.make(initialTxBuilderState)
    ),
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: "Chain failed",
          cause: error
        })
    )
  )

// Core Effect logic for partial build
const buildPartialEffectCore = (
  config: TxBuilderConfig,
  programs: Array<ProgramStep>,
  _options: BuildOptions = DEFAULT_BUILD_OPTIONS
) =>
  Effect.gen(function* () {
    // Execute all programs
    yield* Effect.all(programs, { concurrency: "unbounded" })

    // Return partial transaction (without evaluation)
    return {} as Transaction.Transaction
  }).pipe(
    Effect.provideServiceEffect(
      TxContext,
      Ref.make(initialTxBuilderState)
    ),
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: "Partial build failed",
          cause: error
        })
    )
  )

/**
 * Result type for transaction chaining operations.
 *
 * **NOTE: NOT YET IMPLEMENTED** - This interface is reserved for future implementation
 * of multi-transaction workflows. Current chain methods return stub implementations.
 *
 * @since 2.0.0
 * @category model
 * @experimental
 */
export interface ChainResult {
  readonly transaction: Transaction.Transaction
  readonly newOutputs: ReadonlyArray<UTxO.UTxO> // UTxOs created by this transaction
  readonly updatedUtxos: ReadonlyArray<UTxO.UTxO> // Available UTxOs for next transaction (original - spent + new)
  readonly spentUtxos: ReadonlyArray<UTxO.UTxO> // UTxOs consumed by this transaction
}

// ============================================================================
// Evaluator Interface - Generic abstraction for script evaluation
// ============================================================================
// NOTE: These interfaces are reserved for future UPLC script evaluation support.
// The createUPLCEvaluator function currently returns dummy data and is not yet implemented.

/**
 * Data required by script evaluators: cost models, execution limits, and slot configuration.
 *
 * **NOTE: NOT YET IMPLEMENTED** - Reserved for future UPLC script evaluation support.
 *
 * @since 2.0.0
 * @category model
 * @experimental
 */
export interface EvaluationContext {
  /** Cost models for script evaluation */
  readonly costModels: Uint8Array
  /** Maximum execution steps allowed */
  readonly maxTxExSteps: bigint
  /** Maximum execution memory allowed */
  readonly maxTxExMem: bigint
  /** Slot configuration for time-based operations */
  readonly slotConfig: {
    readonly zeroTime: bigint
    readonly zeroSlot: bigint
    readonly slotLength: number
  }
}

/**
 * Interface for evaluating transaction scripts and computing execution units.
 *
 * **NOTE: NOT YET IMPLEMENTED** - Reserved for future custom script evaluation support.
 * When implemented, this will enable custom evaluation strategies including local UPLC execution.
 *
 * @since 2.0.0
 * @category model
 * @experimental
 */
export interface Evaluator {
  /**
   * Evaluate transaction scripts and return execution units.
   *
   * @since 2.0.0
   * @category methods
   */
  evaluate: (
    tx: string,
    additionalUtxos: ReadonlyArray<UTxO.UTxO> | undefined,
    context: EvaluationContext
  ) => Effect.Effect<ReadonlyArray<EvalRedeemer>, EvaluationError>
}

/**
 * Error type for failures in script evaluation.
 *
 * **NOTE: NOT YET IMPLEMENTED** - Reserved for future script evaluation error handling.
 *
 * @since 2.0.0
 * @category errors
 * @experimental
 */
export class EvaluationError extends Data.TaggedError("EvaluationError")<{
  readonly cause: unknown
  readonly message?: string
}> {}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Standard UPLC evaluation function signature (matches UPLC.eval_phase_two_raw).
 *
 * **NOTE: NOT YET IMPLEMENTED** - Reserved for future UPLC evaluation support.
 *
 * @since 2.0.0
 * @category types
 * @experimental
 */
export type UPLCEvalFunction = (
  tx_bytes: Uint8Array,
  utxos_bytes_x: Array<Uint8Array>,
  utxos_bytes_y: Array<Uint8Array>,
  cost_mdls_bytes: Uint8Array,
  initial_budget_n: bigint,
  initial_budget_d: bigint,
  slot_config_x: bigint,
  slot_config_y: bigint,
  slot_config_z: number
) => Array<Uint8Array>

/**
 * Creates an evaluator from a standard UPLC evaluation function.
 *
 * **NOTE: NOT YET IMPLEMENTED** - This function currently returns an evaluator
 * that produces dummy data. Reserved for future UPLC script evaluation support.
 *
 * @since 2.0.0
 * @category evaluators
 * @experimental
 */
export const createUPLCEvaluator = (_evalFunction: UPLCEvalFunction): Evaluator => ({
  evaluate: (_tx: string, _additionalUtxos: ReadonlyArray<UTxO.UTxO> | undefined, _context: EvaluationContext) =>
    Effect.gen(function* () {
      // Implementation: Call UPLC evaluation with provided parameters
      // _evalFunction(
      //   fromHex(_tx),
      //   utxosToInputBytes(_additionalUtxos),
      //   utxosToOutputBytes(_additionalUtxos),
      //   _context.costModels,
      //   _context.maxTxExSteps,
      //   _context.maxTxExMem,
      //   _context.slotConfig.zeroTime,
      //   _context.slotConfig.zeroSlot,
      //   _context.slotConfig.slotLength
      // )

      // Return dummy EvalRedeemer for now
      const dummyEvalRedeemer: EvalRedeemer = {
        ex_units: { mem: 1000000, steps: 5000000 },
        redeemer_index: 0,
        redeemer_tag: "spend"
      }

      return [dummyEvalRedeemer] as const
    })
})

// ============================================================================
// Provider Integration
// ============================================================================
// TransactionBuilder uses the Provider interface directly

/**
 * UTxO Optimization Options
 * Based on Unfrack.It principles for efficient wallet structure
 * @see https://unfrack.it
 */
export interface UnfrackTokenOptions {
  /**
   * Bundle Size: Number of tokens to collect per UTxO
   * - Same policy: up to bundleSize tokens together
   * - Multiple policies: up to bundleSize/2 tokens from different policies
   * - Policy exceeds bundle: split into multiple UTxOs
   * @default 10
   */
  readonly bundleSize?: number

  /**
   * Isolate Fungible Behavior: Place each fungible token policy on its own UTxO
   * Decreases fees and makes DEX interactions easier
   * @default false
   */
  readonly isolateFungibles?: boolean

  /**
   * Group NFTs by Policy: Separate NFTs onto policy-specific UTxOs
   * Decreases fees for marketplaces, staking, sending
   * @default false
   */
  readonly groupNftsByPolicy?: boolean
}

export interface UnfrackAdaOptions {
  /**
   * Roll Up ADA-Only: Intentionally collect and consolidate ADA-only UTxOs
   * @default false (only collect when needed for change)
   */
  readonly rollUpAdaOnly?: boolean

  /**
   * Subdivide Leftover ADA: If leftover ADA > threshold, split into multiple UTxOs
   * Creates multiple ADA options for future transactions (parallelism)
   * @default 100_000000 (100 ADA)
   */
  readonly subdivideThreshold?: Coin.Coin

  /**
   * Subdivision percentages for leftover ADA
   * Must sum to 100
   * @default [50, 15, 10, 10, 5, 5, 5]
   */
  readonly subdividePercentages?: ReadonlyArray<number>

  /**
   * Maximum ADA-only UTxOs to consolidate in one transaction
   * @default 20
   */
  readonly maxUtxosToConsolidate?: number
}

/**
 * Unfrack Options: Optimize wallet UTxO structure
 * Named in respect to the Unfrack.It open source community
 */
export interface UnfrackOptions {
  readonly tokens?: UnfrackTokenOptions
  readonly ada?: UnfrackAdaOptions
}

// Build configuration options
export interface BuildOptions {
  /**
   * Override protocol parameters for this specific transaction build.
   *
   * By default, fetches from provider during build().
   * Provide this to use different protocol parameters for testing or special cases.
   *
   * Use cases:
   * - Testing with different fee parameters
   * - Simulating future protocol changes
   * - Using cached parameters to avoid provider fetch
   *
   * Example:
   * ```typescript
   * // Test with custom fee parameters
   * builder.build({
   *   protocolParameters: { ...params, minFeeCoefficient: 50n, minFeeConstant: 200000n }
   * })
   * ```
   *
   * @since 2.0.0
   */
  readonly protocolParameters?: ProtocolParameters

  /**
   * Coin selection strategy for automatic input selection.
   *
   * Options:
   * - `"largest-first"`: Use largest-first algorithm (DEFAULT)
   * - `"random-improve"`: Use random-improve algorithm (not yet implemented)
   * - `"optimal"`: Use optimal algorithm (not yet implemented)
   * - Custom function: Provide your own CoinSelectionFunction
   * - `undefined`: Use default (largest-first)
   *
   * Coin selection runs after programs execute and automatically
   * selects UTxOs to cover required outputs + fees. UTxOs already collected
   * via collectFrom() are excluded to prevent double-spending.
   *
   * To disable coin selection entirely, ensure all inputs are provided via collectFrom().
   *
   * @default "largest-first"
   */
  readonly coinSelection?: CoinSelectionAlgorithm | CoinSelectionFunction

  // ============================================================================
  // Change Handling Configuration
  // ============================================================================

  /**
   * Override the change address for this specific transaction build.
   *
   * By default, uses wallet.Effect.address() from TxBuilderConfig.
   * Provide this to use a different address for change outputs.
   *
   * Use cases:
   * - Multi-address wallet (use account index 5 for change)
   * - Different change address per transaction
   * - Multi-sig workflows where change address varies
   * - Testing with different addresses
   *
   * Example:
   * ```typescript
   * // Use different account for change
   * builder.build({ changeAddress: wallet.addresses[5] })
   *
   * // Custom address
   * builder.build({ changeAddress: "addr_test1..." })
   * ```
   *
   * @since 2.0.0
   */
  readonly changeAddress?: string

  /**
   * Override the available UTxOs for this specific transaction build.
   *
   * By default, fetches UTxOs from provider.Effect.getUtxos(wallet.address).
   * Provide this to use a specific set of UTxOs for coin selection.
   *
   * Use cases:
   * - Use UTxOs from specific account index
   * - Pre-filtered UTxO set
   * - Testing with known UTxO set
   * - Multi-address UTxO aggregation
   *
   * Example:
   * ```typescript
   * // Use UTxOs from specific account
   * builder.build({ availableUtxos: utxosFromAccount5 })
   *
   * // Combine UTxOs from multiple addresses
   * builder.build({ availableUtxos: [...utxos1, ...utxos2] })
   * ```
   *
   * @since 2.0.0
   */
  readonly availableUtxos?: ReadonlyArray<UTxO.UTxO>

  /**
   * # Change Handling Strategy Matrix
   * 
   * | unfrack | drainTo | onInsufficientChange | leftover >= minUtxo | Has Native Assets | Result |
   * |---------|---------|---------------------|---------------------|-------------------|--------|
   * | false   | unset   | 'error' (default)   | true                | any               | Single change output created |
   * | false   | unset   | 'error'             | false               | any               | TransactionBuilderError thrown |
   * | false   | unset   | 'burn'              | false               | false             | Leftover becomes extra fee |
   * | false   | unset   | 'burn'              | false               | true              | TransactionBuilderError thrown |
   * | false   | set     | any                 | true                | any               | Single change output created |
   * | false   | set     | any                 | false               | any               | Assets merged into outputs[drainTo] |
   * | true    | unset   | 'error' (default)   | true                | any               | Multiple optimized change outputs |
   * | true    | unset   | 'error'             | false               | any               | TransactionBuilderError thrown |
   * | true    | unset   | 'burn'              | false               | false             | Leftover becomes extra fee |
   * | true    | unset   | 'burn'              | false               | true              | TransactionBuilderError thrown |
   * | true    | set     | any                 | true                | any               | Multiple optimized change outputs |
   * | true    | set     | any                 | false               | any               | Assets merged into outputs[drainTo] |
   * 
   * **Execution Priority:** unfrack attempt → changeOutput >= minUtxo check → drainTo → onInsufficientChange
   * 
   * **Note:** When drainTo is set, onInsufficientChange is never evaluated (unreachable code path)
   * 

  /**
   * Output index to merge leftover assets into as a fallback when change output cannot be created.
   * 
   * This serves as **Fallback #1** in the change handling strategy:
   * 1. Try to create change output (with optional unfracking)
   * 2. If that fails → Use drainTo (if configured)
   * 3. If drainTo not configured → Use onInsufficientChange strategy
   * 
   * Use cases:
   * - Wallet drain: Send maximum to recipient without leaving dust
   * - Multi-output drain: Choose which output receives leftover
   * - Avoiding minimum UTxO: Merge small leftover that can't create valid change
   * 
   * Example:
   * ```typescript
   * builder
   *   .payToAddress({ address: "recipient", assets: { lovelace: 5_000_000n }})
   *   .build({ drainTo: 0 })  // Fallback: leftover goes to recipient
   * ```
   * 
   * @since 2.0.0
   */
  readonly drainTo?: number

  /**
   * Strategy for handling insufficient leftover assets when change output cannot be created.
   *
   * This serves as **Fallback #2** (final fallback) in the change handling strategy:
   * 1. Try to create change output (with optional unfracking)
   * 2. If that fails AND drainTo configured → Drain to that output
   * 3. If that fails OR drainTo not configured → Use this strategy
   *
   * Options:
   * - `'error'` (DEFAULT): Throw error, transaction fails - **SAFE**, prevents fund loss
   * - `'burn'`: Allow leftover to become extra fee - Requires **EXPLICIT** user consent
   *
   * Default behavior is 'error' to prevent accidental loss of funds.
   *
   * Example:
   * ```typescript
   * // Safe (default): Fail if change insufficient
   * .build({ onInsufficientChange: 'error' })
   *
   * // Explicit consent to burn leftover as fee
   * .build({ onInsufficientChange: 'burn' })
   * ```
   *
   * @default 'error'
   * @since 2.0.0
   */
  readonly onInsufficientChange?: "error" | "burn"

  // Script evaluator - if provided, replaces the default provider-based evaluation
  // Use createUPLCEvaluator() for UPLC libraries, or implement Evaluator directly
  readonly evaluator?: Evaluator

  // Collateral handling
  readonly collateral?: ReadonlyArray<UTxO.UTxO> // Manual collateral (max 3)
  // Amount to set as collateral default 5_000_000n
  readonly setCollateral?: bigint
  // Minimum fee
  readonly minFee?: Coin.Coin

  /**
   * Unfrack: Optimize wallet UTxO structure
   *
   * Implements Unfrack.It principles for efficient wallet management:
   * - Token bundling: Group tokens into optimally-sized UTxOs
   * - ADA optimization: Roll up or subdivide ADA-only UTxOs
   *
   * Works as an **enhancement** to change output creation. When enabled:
   * - Change output will be split into multiple optimized UTxOs
   * - If unfracking fails (insufficient ADA), falls back to drainTo or onInsufficientChange
   *
   * Named in respect to the Unfrack.It open source community
   */
  readonly unfrack?: UnfrackOptions

  /**
   * **EXPERIMENTAL**: Use state machine implementation instead of monolithic buildEffectCore
   *
   * When true, uses the experimental 6-phase state machine:
   * - initialSelection → changeCreation → feeCalculation → balanceVerification → reselection → complete
   *
   * WARNING: Has known Context.Tag type inference issues. Use for testing only.
   *
   * @experimental
   * @default false
   */
  readonly useStateMachine?: boolean
}

// ============================================================================
// Builder Configuration and State - Properly Separated Architecture
// ============================================================================

/**
 * Deferred execution architecture with immutable builder and fresh state per build.
 *
 * ## Components
 *
 * **TxBuilderConfig** (immutable) - provider, protocolParams, costModels, availableUtxos
 * **TxBuilderState** (Ref-based, fresh per build) - selectedUtxos, outputs, scripts, asset totals
 * **ProgramStep** - deferred Effect that modifies Refs via Context
 *
 * ## Execution Flow
 *
 * 1. Chainable methods append ProgramSteps to array
 * 2. `build()` creates fresh TxBuilderState Refs and executes all ProgramSteps sequentially
 * 3. Subsequent `build()` calls create new independent Refs
 *
 * @since 2.0.0
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Protocol parameters required for transaction building.
 * Subset of full protocol parameters, only what's needed for minimal build.
 *
 * @since 2.0.0
 * @category config
 */
export interface ProtocolParameters {
  /** Coefficient for linear fee calculation (minFeeA) */
  minFeeCoefficient: bigint

  /** Constant for linear fee calculation (minFeeB) */
  minFeeConstant: bigint

  /** Minimum ADA per UTxO byte (for future change output validation) */
  coinsPerUtxoByte: bigint

  /** Maximum transaction size in bytes */
  maxTxSize: number

  // Future fields for advanced features:
  // maxBlockHeaderSize?: number
  // maxTxExecutionUnits?: ExUnits
  // maxBlockExecutionUnits?: ExUnits
  // collateralPercentage?: number
  // maxCollateralInputs?: number
  // prices?: Prices
}

/**
 * Configuration for TransactionBuilder.
 * Immutable configuration passed to builder at creation time.
 *
 * Wallet-centric design (when wallet provided):
 * - Wallet provides change address (via wallet.Effect.address())
 * - Provider + Wallet provide available UTxOs (via provider.Effect.getUtxos(wallet.address))
 * - Override per-build via BuildOptions if needed
 *
 * Manual mode (no wallet):
 * - Must provide changeAddress and availableUtxos in BuildOptions for each build
 * - Used for read-only scenarios or advanced use cases
 *
 * @since 2.0.0
 * @category config
 */
export interface TxBuilderConfig {
  /**
   * Optional wallet provides:
   * - Change address via wallet.Effect.address()
   * - Available UTxOs via wallet.Effect.address() + provider.Effect.getUtxos()
   * - Signing capability via wallet.Effect.signTx() (SigningWallet and ApiWallet only)
   *
   * When provided: Automatic change address and UTxO resolution.
   * When omitted: Must provide changeAddress and availableUtxos in BuildOptions.
   *
   * ReadOnlyWallet: For read-only clients that can build but not sign transactions.
   * SigningWallet/ApiWallet: For signing clients with full transaction signing capability.
   *
   * Override per-build via BuildOptions.changeAddress and BuildOptions.availableUtxos.
   */
  readonly wallet?: WalletNew.SigningWallet | WalletNew.ApiWallet | WalletNew.ReadOnlyWallet

  /**
   * Optional provider for:
   * - Fetching UTxOs for the wallet's address (provider.Effect.getUtxos)
   * - Transaction submission (provider.Effect.submitTx)
   * - Protocol parameters
   *
   * Works together with wallet to provide everything needed for transaction building.
   * When wallet is omitted, provider is only used if you call provider methods directly.
   */
  readonly provider?: Provider.Provider

  // Future fields:
  // readonly costModels?: Uint8Array // Cost models for script evaluation
}

/**
 * Mutable state created FRESH on each build() call.
 * Uses Effect Ref for simple, sequential state updates within a single build.
 *
 * State lifecycle:
 * 1. Created fresh when build() is called
 * 2. Modified by ProgramSteps during execution
 * 3. Used to construct final transaction
 * 4. Discarded after build completes
 *
 * State modifications during execution:
 * - UTxOs selected from availableUtxos (config) → selectedUtxos (state)
 * - Outputs added during payToAddress operations
 * - Scripts attached when needed
 * - Assets tracked for balancing
 *
 * @since 2.0.0
 * @category state
 */
/**
 * Mutable state created FRESH on each build() call.
 * Contains all Refs for transaction building state.
 *
 * Design: Stores SDK types (UTxO.UTxO), converts to core types during build.
 * This enables coin selection (needs full UTxO context) while maintaining
 * transaction-native assembly.
 *
 * @since 2.0.0
 * @category state
 */
/**
 * Mutable state for transaction building.
 * Contains all state needed during transaction construction.
 *
 * @since 2.0.0
 * @category state
 */
export interface TxBuilderState {
  readonly selectedUtxos: ReadonlyArray<UTxO.UTxO> // SDK type: Array for ordering, converted at build
  readonly outputs: ReadonlyArray<UTxO.TxOutput> // Transaction outputs (no txHash/outputIndex yet)
  readonly scripts: Map<string, any> // Scripts attached to the transaction
  readonly totalOutputAssets: Assets.Assets // Asset totals for balancing
  readonly totalInputAssets: Assets.Assets // Asset totals for balancing
  readonly redeemers: Map<string, RedeemerData> // Redeemer data for script inputs
}

/**
 * Redeemer data stored during input collection.
 * Index is determined later during witness assembly based on input ordering.
 *
 * @since 2.0.0
 * @category state
 */
export interface RedeemerData {
  readonly tag: "spend" | "mint" | "cert" | "reward"
  readonly data: string // PlutusData CBOR hex
  readonly exUnits?: {
    // Optional: from script evaluation
    readonly mem: bigint
    readonly steps: bigint
  }
}

/**
 * Combined transaction context containing all necessary data for building.
 *
 * @since 2.0.0
 * @category context
 */
/**
 * Combined transaction context containing all necessary data for building.
 *
 * @since 2.0.0
 * @category context
 */
/**
 * Context service providing transaction building state to programs.
 * Directly holds the mutable state Ref - config is passed as a regular parameter.
 *
 * @since 2.0.0
 * @category context
 */
export class TxContext extends Context.Tag("TxContext")<TxContext, Ref.Ref<TxBuilderState>>() {}

/**
 * Resolved change address for the current build.
 * This is resolved once at the start of build() from either:
 * - BuildOptions.changeAddress (per-transaction override)
 * - TxBuilderConfig.wallet.Effect.address() (default from wallet)
 *
 * Available to all phase functions via Effect Context.
 *
 * @since 2.0.0
 * @category context
 */
export class ChangeAddressTag extends Context.Tag("ChangeAddress")<ChangeAddressTag, string>() {}

/**
 * Resolved protocol parameters for the current build.
 * This is resolved once at the start of build() from either:
 * - BuildOptions.protocolParameters (per-transaction override)
 * - provider.Effect.getProtocolParameters() (fetched from provider)
 *
 * Available to all phase functions via Effect Context.
 *
 * @since 2.0.0
 * @category context
 */
export class ProtocolParametersTag extends Context.Tag("ProtocolParameters")<
  ProtocolParametersTag,
  ProtocolParameters
>() {}

/**
 * Resolved available UTxOs for the current build.
 * This is resolved once at the start of build() from either:
 * - BuildOptions.availableUtxos (per-transaction override)
 * - provider.Effect.getUtxos(wallet.address) (default from wallet + provider)
 *
 * Available to all phase functions via Effect Context.
 *
 * @since 2.0.0
 * @category context
 */
export class AvailableUtxosTag extends Context.Tag("AvailableUtxos")<AvailableUtxosTag, ReadonlyArray<UTxO.UTxO>>() {}

/**
 * Context tag providing BuildOptions for the current build.
 * Contains build-specific configuration like unfrack, drainTo, onInsufficientChange, etc.
 *
 * @since 2.0.0
 * @category context
 */
export class BuildOptionsTag extends Context.Tag("BuildOptions")<BuildOptionsTag, BuildOptions>() {}

// ============================================================================
// Program Step Type - Deferred Execution Pattern
// ============================================================================

/**
 * A deferred Effect program that represents a single transaction building operation.
 *
 * ProgramSteps are:
 * - Created when user calls chainable methods (payToAddress, collectFrom, etc.)
 * - Stored in the builder's programs array
 * - Executed later when build() is called
 * - Access TxContext through Effect Context
 *
 * This deferred execution pattern enables:
 * - Builder reusability (same builder, multiple builds)
 * - Fresh state per build (no mutation between builds)
 * - Composable transaction construction
 * - No prop drilling (programs access everything via single Context)
 *
 * Type signature:
 * ```typescript
 * type ProgramStep = Effect.Effect<void, TransactionBuilderError, TxContext>
 * ```
 *
 * Requirements from context:
 * - TxContext: Mutable state Ref (selected UTxOs, outputs, scripts, assets)
 *
 * @since 2.0.0
 * @category types
 */
export type ProgramStep = Effect.Effect<void, TransactionBuilderError, TxContext>

// ============================================================================
// Transaction Builder Interface - Hybrid Effect/Promise API
// ============================================================================

/**
 * TransactionBuilder with hybrid Effect/Promise API following lucid-evolution pattern.
 *
 * Architecture:
 * - Immutable builder instance stores array of ProgramSteps
 * - Chainable methods create ProgramSteps and return same builder instance
 * - Completion methods (build, chain, etc.) execute all stored ProgramSteps with FRESH state
 * - Builder can be reused - each build() call is independent with its own state
 *
 * Key Design Principle:
 * Builder instance never mutates. Programs are deferred Effects that execute later.
 * Each build() creates fresh TxBuilderState, executes programs, returns result.
 *
 * Generic Type Parameter:
 * TResult determines the return type of build() methods:
 * - SignBuilder: When wallet has signing capability (SigningClient)
 * - TransactionResultBase: When wallet is read-only (ReadOnlyClient)
 *
 * Usage Pattern:
 * ```typescript
 * const builder = makeTxBuilder(provider, params, costModels, utxos)
 *   .payToAddress({ address: "addr1...", assets: { lovelace: 5_000_000n } })
 *   .collectFrom({ inputs: [utxo1, utxo2] })
 *
 * // First build - creates fresh state, executes programs
 * const signBuilder1 = await builder.build()
 *
 * // Second build - NEW fresh state, independent execution
 * const signBuilder2 = await builder.build()
 * ```
 *
 * @typeParam TResult - The result type returned by build methods (SignBuilder or TransactionResultBase)
 *
 * @since 2.0.0
 * @category interfaces
 */

/**
 * Conditional type to determine the result type based on wallet capability.
 * - If wallet has signTx method (SigningWallet or ApiWallet): SignBuilder
 * - Otherwise: TransactionResultBase
 *
 * @internal
 */
export type BuildResultType<W extends TxBuilderConfig["wallet"] | undefined> = W extends
  | WalletNew.SigningWallet
  | WalletNew.ApiWallet
  ? SignBuilder
  : TransactionResultBase

/**
 * Base interface for both signing and read-only transaction builders.
 * Provides chainable builder methods common to both.
 *
 * @since 2.0.0
 * @category builder-interfaces
 */
export interface TransactionBuilderBase {
  /**
   * Append a payment output to the transaction.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly payToAddress: (params: PayToAddressParams) => this

  /**
   * Specify transaction inputs from provided UTxOs.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly collectFrom: (params: CollectFromParams) => this
}

/**
 * Transaction builder for signing wallets (SigningWallet or ApiWallet).
 *
 * Builds transactions that can be signed. The build() method returns a SignBuilder
 * which provides sign(), signWithWitness(), and other signing capabilities.
 *
 * This builder type is returned when makeTxBuilder() is called with a signing wallet.
 * Type narrowing happens automatically at construction time - no call-site guards needed.
 *
 * @since 2.0.0
 * @category builder-interfaces
 */
export interface SigningTransactionBuilder extends TransactionBuilderBase {
  /**
   * Execute all queued operations and return a signing-ready transaction via Promise.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Can be called multiple times on the same builder instance with independent results.
   *
   * @returns Promise<SignBuilder> which provides signing capabilities
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly build: (options?: BuildOptions) => Promise<SignBuilder>

  /**
   * Execute all queued operations and return a signing-ready transaction via Effect.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Suitable for Effect-TS compositional workflows and error handling.
   *
   * @returns Effect<SignBuilder, ...> which provides signing capabilities
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEffect: (
    options?: BuildOptions
  ) => Effect.Effect<
    SignBuilder,
    TransactionBuilderError | EvaluationError | WalletNew.WalletError | Provider.ProviderError,
    never
  >

  /**
   * Execute all queued operations with explicit error handling via Either.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Returns Either<Result, Error> for pattern-matched error recovery.
   *
   * @returns Promise<Either<SignBuilder, Error>>
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEither: (
    options?: BuildOptions
  ) => Promise<
    Either<SignBuilder, TransactionBuilderError | EvaluationError | WalletNew.WalletError | Provider.ProviderError>
  >
}

/**
 * Transaction builder for read-only wallets (ReadOnlyWallet or undefined).
 *
 * Builds transactions that cannot be signed. The build() method returns a TransactionResultBase
 * which provides query methods like toTransaction() but NOT signing capabilities.
 *
 * This builder type is returned when makeTxBuilder() is called with a read-only wallet or no wallet.
 * Type narrowing happens automatically at construction time - no call-site guards needed.
 *
 * @since 2.0.0
 * @category builder-interfaces
 */
export interface ReadOnlyTransactionBuilder extends TransactionBuilderBase {
  /**
   * Execute all queued operations and return a transaction result via Promise.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Can be called multiple times on the same builder instance with independent results.
   *
   * @returns Promise<TransactionResultBase> which provides query-only methods
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly build: (options?: BuildOptions) => Promise<TransactionResultBase>

  /**
   * Execute all queued operations and return a transaction result via Effect.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Suitable for Effect-TS compositional workflows and error handling.
   *
   * @returns Effect<TransactionResultBase, ...> which provides query-only methods
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEffect: (
    options?: BuildOptions
  ) => Effect.Effect<
    TransactionResultBase,
    TransactionBuilderError | EvaluationError | WalletNew.WalletError | Provider.ProviderError,
    never
  >

  /**
   * Execute all queued operations with explicit error handling via Either.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Returns Either<Result, Error> for pattern-matched error recovery.
   *
   * @returns Promise<Either<TransactionResultBase, Error>>
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEither: (
    options?: BuildOptions
  ) => Promise<
    Either<
      TransactionResultBase,
      TransactionBuilderError | EvaluationError | WalletNew.WalletError | Provider.ProviderError
    >
  >
}

/**
 * Union type for all transaction builders.
 * Use specific types (SigningTransactionBuilder or ReadOnlyTransactionBuilder) when you know the wallet type.
 *
 * @since 2.0.0
 * @category builder-interfaces
 */
export type TransactionBuilder = SigningTransactionBuilder | ReadOnlyTransactionBuilder

/**
 * Conditional type to determine the correct TransactionBuilder based on wallet type.
 * - If wallet is SigningWallet or ApiWallet: SigningTransactionBuilder
 * - If wallet is ReadOnlyWallet or undefined: ReadOnlyTransactionBuilder
 *
 * @internal
 */
export type TxBuilderResultType<
  W extends WalletNew.SigningWallet | WalletNew.ApiWallet | WalletNew.ReadOnlyWallet | undefined
> = W extends WalletNew.SigningWallet | WalletNew.ApiWallet ? SigningTransactionBuilder : ReadOnlyTransactionBuilder


/**
 * Construct a TransactionBuilder instance from protocol configuration.
 *
 * The builder accumulates chainable method calls as deferred ProgramSteps. Calling build() or chain()
 * creates fresh state (new Refs) and executes all accumulated programs sequentially, ensuring
 * no state pollution between invocations.
 *
 * The return type is determined by the actual wallet provided using conditional types:
 * - SigningTransactionBuilder: When wallet is SigningWallet or ApiWallet
 * - ReadOnlyTransactionBuilder: When wallet is ReadOnlyWallet or undefined
 *
 * Wallet type narrowing happens at construction time based on the wallet's actual type.
 * No call-site type narrowing or type guards needed.
 *
 * Wallet parameter is optional; if omitted, changeAddress and availableUtxos must be
 * provided at build time via BuildOptions.
 *
 * @since 2.0.0
 * @category constructors
 *
 */
export function makeTxBuilder<
  W extends WalletNew.SigningWallet | WalletNew.ApiWallet | WalletNew.ReadOnlyWallet | undefined
>(config: Partial<TxBuilderConfig> & { wallet?: W }): TxBuilderResultType<W>
export function makeTxBuilder(config: TxBuilderConfig) {
  const programs: Array<ProgramStep> = []

  const txBuilder = {
    // ============================================================================
    // Chainable builder methods - Create ProgramSteps, return same instance
    // ============================================================================

    payToAddress: (params: PayToAddressParams) => {
      // Create ProgramStep for deferred execution
      const program = createPayToAddressProgram(params)
      programs.push(program)
      return txBuilder // Return same instance for chaining
    },

    collectFrom: (params: CollectFromParams) => {
      // Create ProgramStep for deferred execution
      const program = createCollectFromProgram(params)
      programs.push(program)
      return txBuilder // Return same instance for chaining
    },

    // ============================================================================
    // Hybrid completion methods - Execute with fresh state
    // ============================================================================

    buildEffect: (options?: BuildOptions) => {
      return buildEffectCore(config, programs, options)
    },

    build: (options?: BuildOptions) => {
      return runEffect(
        buildEffectCore(config, programs, options).pipe(
          Effect.provide(Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug)))
        )
      )
    },
    buildEither: (options?: BuildOptions) => {
      return runEffect(
        buildEffectCore(config, programs, options).pipe(
          Effect.either,
          Effect.provide(Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug)))
        )
      )
    },

    // ============================================================================
    // Transaction chaining methods
    // ============================================================================

    chainEffect: (options?: BuildOptions) => chainEffectCore(config, programs, options),

    chain: (options?: BuildOptions) => runEffect(chainEffectCore(config, programs, options)),

    chainEither: (options?: BuildOptions) => runEffect(chainEffectCore(config, programs, options).pipe(Effect.either)),

    // ============================================================================
    // Debug methods - Execute with fresh state, return partial transaction
    // ============================================================================

    buildPartialEffect: (options?: BuildOptions) => buildPartialEffectCore(config, programs, options),

    buildPartial: (options?: BuildOptions) => runEffect(buildPartialEffectCore(config, programs, options))
  }

  return txBuilder
}
