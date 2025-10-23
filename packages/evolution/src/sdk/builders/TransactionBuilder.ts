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
import * as Assets from "../Assets.js"
import type { EvalRedeemer } from "../EvalRedeemer.js"
import type * as UTxO from "../UTxO.js"
import type { CoinSelectionAlgorithm, CoinSelectionFunction } from "./CoinSelection.js"
import { largestFirstSelection } from "./CoinSelection.js"
import type { CollectFromParams, PayToAddressParams } from "./operations/Operations.js"
import type { SignBuilder } from "./SignBuilder.js"
import {
  assembleTransaction,
  buildFakeWitnessSet,
  buildTransactionInputs,
  calculateFeeIteratively,
  calculateMinimumUtxoLovelace,
  calculateTotalAssets,
  calculateTransactionSize,
  createChangeOutput,
  createCollectFromProgram,
  createPayToAddressProgram,
  makeTxOutput,
  verifyTransactionBalance
} from "./TxBuilderImpl.js"
import * as Unfrack from "./Unfrack.js"

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of re-selection attempts when balancing transaction.
 *
 * During transaction building, if the actual fee (calculated with fake witnesses)
 * exceeds the initial estimate and causes insufficient balance, the builder will
 * retry coin selection up to this many times with updated fee estimates.
 *
 * @since 2.0.0
 */
const MAX_RESELECTION_ATTEMPTS = 3

// ============================================================================
// Error Types
// ============================================================================

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

// ============================================================================
// Transaction Types
// ============================================================================

export interface ChainResult {
  readonly transaction: Transaction.Transaction
  readonly newOutputs: ReadonlyArray<UTxO.UTxO> // UTxOs created by this transaction
  readonly updatedUtxos: ReadonlyArray<UTxO.UTxO> // Available UTxOs for next transaction (original - spent + new)
  readonly spentUtxos: ReadonlyArray<UTxO.UTxO> // UTxOs consumed by this transaction
}

// ============================================================================
// Evaluator Interface - Generic abstraction for script evaluation
// ============================================================================

/**
 * Data required by script evaluators: cost models, execution limits, and slot configuration.
 *
 * @since 2.0.0
 * @category model
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
 * When provided to builder configuration, replaces default provider-based evaluation.
 * Enables custom evaluation strategies including local UPLC execution.
 *
 * @since 2.0.0
 * @category model
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
 * @since 2.0.0
 * @category errors
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
 * @since 2.0.0
 * @category types
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
 * The TxBuilder provides protocol parameters and cost models when calling evaluate.
 *
 * @since 2.0.0
 * @category evaluators
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

      return [dummyEvalRedeemer] as ReadonlyArray<EvalRedeemer>
    })
})

// ============================================================================
// Provider Integration
// ============================================================================
// TransactionBuilder uses the Provider interface directly

/**
 * Transaction optimization flags for controlling builder behavior.
 *
 * @since 2.0.0
 * @category options
 */
export interface TransactionOptimizations {
  readonly mergeOutputs?: boolean
  readonly consolidateInputs?: boolean
  readonly minimizeFee?: boolean
}

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

  /**
   * **EXPERIMENTAL**: Use V3 4-phase state machine
   *
   * When true, uses V3's simplified 4-phase state machine:
   * - selection → changeValidation → balanceVerification → fallback → complete
   *
   * V3 shares TxContext with V2 but uses mathematical validation approach.
   *
   * @experimental
   * @default false
   */
  readonly useV3?: boolean
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
 * Contains:
 * - Protocol parameters for fee calculation
 * - Change address for leftover funds
 * - Available UTxOs for coin selection
 *
 * @since 2.0.0
 * @category config
 */
export interface TxBuilderConfig {
  readonly protocolParameters: ProtocolParameters

  /**
   * Address to send change (leftover assets) to.
   * This is required for proper transaction balancing.
   */
  readonly changeAddress: string

  /**
   * UTxOs available for coin selection.
   * These can be from a wallet, another user, or any other source.
   * Coin selection will automatically select from these UTxOs to cover
   * required outputs + fees, excluding any already collected via collectFrom().
   */
  readonly availableUtxos: ReadonlyArray<UTxO.UTxO>

  // Future fields:
  // readonly provider?: any // Provider interface for blockchain communication
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
export interface TxBuilderState {
  readonly selectedUtxos: Ref.Ref<ReadonlyArray<UTxO.UTxO>> // SDK type: Array for ordering, converted at build
  readonly outputs: Ref.Ref<ReadonlyArray<UTxO.TxOutput>> // Transaction outputs (no txHash/outputIndex yet)
  readonly scripts: Ref.Ref<Map<string, any>> // Scripts attached to the transaction
  readonly totalOutputAssets: Ref.Ref<Assets.Assets> // Asset totals for balancing
  readonly totalInputAssets: Ref.Ref<Assets.Assets> // Asset totals for balancing
  readonly redeemers: Ref.Ref<Map<string, RedeemerData>> // Redeemer data for script inputs
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
export interface TxContextData {
  readonly config: TxBuilderConfig // Immutable: provider, params, available UTxOs
  readonly state: TxBuilderState // Mutable: selected UTxOs, outputs, scripts
  readonly options: BuildOptions // Build-specific: coin selection, evaluator, etc.
}

/**
 * Single Context service providing all transaction building data to programs.
 * Combines config (immutable), state (mutable), and options (build-specific).
 *
 * @since 2.0.0
 * @category context
 */
export class TxContext extends Context.Tag("TxContext")<TxContext, TxContextData>() {}

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
 * - TxContext.config: Immutable configuration (provider, protocol params, available UTxOs)
 * - TxContext.state: Mutable state (selected UTxOs, outputs, scripts, assets)
 * - TxContext.options: Build options (coin selection, evaluator, collateral, etc.)
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
 * @since 2.0.0
 * @category interfaces
 */
export interface TransactionBuilder {
  // ============================================================================
  // Chainable Builder Methods - Create ProgramSteps, return same builder
  // ============================================================================

  /**
   * Append a payment output to the transaction.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly payToAddress: (params: PayToAddressParams) => TransactionBuilder

  /**
   * Specify transaction inputs from provided UTxOs.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly collectFrom: (params: CollectFromParams) => TransactionBuilder

  // Future expansion points for other operations:
  // readonly mintTokens: (params: MintTokensParams) => TransactionBuilder
  // readonly delegateStake: (poolId: string) => TransactionBuilder
  // readonly withdrawRewards: (amount?: Coin.Coin) => TransactionBuilder
  // readonly addMetadata: (label: string | number, metadata: any) => TransactionBuilder
  // readonly setValidityInterval: (start?: number, end?: number) => TransactionBuilder

  // ============================================================================
  // Hybrid Completion Methods - Execute Programs with Fresh State
  // ============================================================================

  /**
   * Execute all queued operations and return a signing-ready transaction via Promise.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Can be called multiple times on the same builder instance with independent results.
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
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEffect: (
    options?: BuildOptions
  ) => Effect.Effect<SignBuilder, TransactionBuilderError | EvaluationError, unknown>

  /**
   * Execute all queued operations with explicit error handling via Either.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Returns Either<SignBuilder, Error> for pattern-matched error recovery.
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEither: (
    options?: BuildOptions
  ) => Promise<Either<SignBuilder, TransactionBuilderError | EvaluationError>>

  // ============================================================================
  // Transaction Chaining Methods - Multi-transaction workflows
  // ============================================================================

  /**
   * Execute queued operations and return result for multi-transaction workflows via Promise.
   *
   * Creates fresh state and runs all ProgramSteps. Returns ChainResult containing the transaction,
   * new UTxOs, and updated available UTxOs for subsequent transactions.
   *
   * @since 2.0.0
   * @category chaining-methods
   */
  readonly chain: (options?: BuildOptions) => Promise<ChainResult>

  /**
   * Execute queued operations and return result for multi-transaction workflows via Effect.
   *
   * Creates fresh state and runs all ProgramSteps. Returns ChainResult for Effect-TS workflows
   * and composable error handling.
   *
   * @since 2.0.0
   * @category chaining-methods
   */
  readonly chainEffect: (
    options?: BuildOptions
  ) => Effect.Effect<ChainResult, TransactionBuilderError | EvaluationError>

  /**
   * Execute queued operations with explicit error handling via Either for multi-transaction workflows.
   *
   * Creates fresh state and runs all ProgramSteps. Returns Either<ChainResult, Error>
   * for pattern-matched error recovery in transaction sequences.
   *
   * @since 2.0.0
   * @category chaining-methods
   */
  readonly chainEither: (
    options?: BuildOptions
  ) => Promise<Either<ChainResult, TransactionBuilderError | EvaluationError>>

  // ============================================================================
  // Debug Methods - Inspect transaction state during development
  // ============================================================================

  /**
   * Execute queued operations without script evaluation or finalization; return partial transaction via Promise.
   *
   * Creates fresh state and runs all ProgramSteps. Returns intermediate transaction for inspection.
   * Useful for debugging transaction assembly and coin selection logic.
   *
   * @since 2.0.0
   * @category debug-methods
   */
  readonly buildPartial: () => Promise<Transaction.Transaction>

  /**
   * Execute queued operations without script evaluation or finalization; return partial transaction via Effect.
   *
   * Creates fresh state and runs all ProgramSteps. Returns intermediate transaction for inspection.
   * Suitable for Effect-TS workflows requiring transaction debugging.
   *
   * @since 2.0.0
   * @category debug-methods
   */
  readonly buildPartialEffect: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError, unknown>
}

// ============================================================================
// Factory Function - Creates TransactionBuilder instances
// ============================================================================

/**
 * Construct a TransactionBuilder instance from protocol configuration.
 * 
 * The builder accumulates chainable method calls as deferred ProgramSteps. Calling build() or chain()
 * creates fresh state (new Refs) and executes all accumulated programs sequentially, ensuring
 * no state pollution between invocations.
 * 
 * @since 2.0.0
 * @category constructors
 */
export const makeTxBuilder = (config: TxBuilderConfig): TransactionBuilder => {
  // Validate protocol parameters
  if (config.protocolParameters.minFeeCoefficient < 0n) {
    throw new Error("minFeeCoefficient must be non-negative")
  }

  if (config.protocolParameters.minFeeConstant < 0n) {
    throw new Error("minFeeConstant must be non-negative")
  }

  if (config.protocolParameters.coinsPerUtxoByte < 0n) {
    throw new Error("coinsPerUtxoByte must be non-negative")
  }

  if (config.protocolParameters.maxTxSize <= 0) {
    throw new Error("maxTxSize must be positive")
  }

  // ProgramSteps array - stores deferred operations
  // NO state created here - state is fresh per build()
  const programs: Array<ProgramStep> = []

  // Helper: Get coin selection algorithm function from name
  const getCoinSelectionAlgorithm = (algorithm: CoinSelectionAlgorithm): CoinSelectionFunction => {
    switch (algorithm) {
      case "largest-first":
        return largestFirstSelection
      case "random-improve":
        throw new TransactionBuilderError({
          message: "random-improve algorithm not yet implemented",
          cause: { algorithm }
        })
      case "optimal":
        throw new TransactionBuilderError({
          message: "optimal algorithm not yet implemented",
          cause: { algorithm }
        })
      default:
        throw new TransactionBuilderError({
          message: `Unknown coin selection algorithm: ${algorithm}`,
          cause: { algorithm }
        })
    }
  }

  // Helper: Create fresh state Effect
  const createFreshState = () =>
    Effect.gen(function* () {
      return {
        selectedUtxos: yield* Ref.make<ReadonlyArray<UTxO.UTxO>>([]), // Array for ordering
        outputs: yield* Ref.make<ReadonlyArray<any>>([]),
        scripts: yield* Ref.make(new Map<string, any>()),
        totalOutputAssets: yield* Ref.make<Assets.Assets>({ lovelace: 0n }),
        totalInputAssets: yield* Ref.make<Assets.Assets>({ lovelace: 0n }),
        redeemers: yield* Ref.make(new Map<string, RedeemerData>())
      }
    })

  // Core Effect logic for building transaction
  const buildEffectCore = (options?: BuildOptions) =>
    Effect.gen(function* () {
      const ctx = yield* TxContext

      // 1. Execute all programs to populate state
      yield* Effect.all(programs, { concurrency: "unbounded" })

      // 2. Initial Coin Selection Phase
      // collectFrom = explicit selection (user-specified inputs)
      // availableUtxos = pool for automatic balancing (wallet UTxOs)
      yield* Effect.logDebug("Starting initial coin selection phase")

      // Get current input and output assets
      const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
      const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)
      const estimatedFee = 200_000n // Conservative initial estimate

      // Calculate asset delta: (outputs + estimated fee) - inputs
      const assetDelta: Assets.Assets = { lovelace: 0n }
      let hasPositiveDelta = false

      // Calculate required assets (outputs + estimated fee)
      const outputLovelace = outputAssets.lovelace || 0n
      const requiredAssets: Assets.Assets = {
        ...outputAssets,
        lovelace: outputLovelace + estimatedFee
      }

      // Calculate delta for each asset unit
      for (const [unit, required] of Object.entries(requiredAssets)) {
        const available = (inputAssets[unit] as bigint) || 0n
        const delta = required - available

        if (delta > 0n) {
          assetDelta[unit] = delta
          hasPositiveDelta = true
        }
      }

      // Run initial coin selection if we have positive asset delta
      if (hasPositiveDelta) {
        const assetDeltaStr = Object.entries(assetDelta)
          .map(([unit, amount]) => `${unit}:${amount.toString()}`)
          .join(", ")

        yield* Effect.logDebug(`Initial coin selection for: {${assetDeltaStr}}`)

        // Get available UTxOs from config for automatic balancing
        const configUtxos = ctx.config.availableUtxos

        // Get already-collected UTxOs to prevent double-spending
        const alreadyCollected = yield* Ref.get(ctx.state.selectedUtxos)

        // Filter out already-collected UTxOs
        const availableUtxos = configUtxos.filter(
          (utxo) =>
            !alreadyCollected.some(
              (collected) => collected.txHash === utxo.txHash && collected.outputIndex === utxo.outputIndex
            )
        )

        // Determine coin selection function
        const coinSelectionFn = options?.coinSelection
          ? typeof options.coinSelection === "function"
            ? options.coinSelection
            : getCoinSelectionAlgorithm(options.coinSelection)
          : largestFirstSelection // Default: largest-first

        const { selectedUtxos: additionalUtxos } = yield* Effect.try({
          try: () => coinSelectionFn(availableUtxos, assetDelta),
          catch: (error) =>
            new TransactionBuilderError({
              message: "Initial coin selection failed",
              cause: error
            })
        })

        yield* Effect.logDebug(
          `Initial coin selection added ${additionalUtxos.length} UTxOs ` + `(${availableUtxos.length} available)`
        )

        // Add selected UTxOs to state
        yield* Ref.update(ctx.state.selectedUtxos, (current) => [...current, ...additionalUtxos])

        // Update total input assets
        for (const utxo of additionalUtxos) {
          yield* Ref.update(ctx.state.totalInputAssets, (current) => {
            const updated = { ...current }
            for (const [unit, amount] of Object.entries(utxo.assets)) {
              updated[unit] = (updated[unit] || 0n) + (amount as bigint)
            }
            return updated
          })
        }

        yield* Effect.logDebug(`Initial coin selection added ${additionalUtxos.length} UTxOs`)
      } else {
        yield* Effect.logDebug("Inputs already cover outputs + estimated fee, skipping initial coin selection")
      }

      // 3. Reselection Loop: Create change, calculate actual fee, verify balance
      // Now that we have initial coin selection, we iteratively:
      // 1. Create change outputs from leftover assets
      // 2. Calculate actual fee with complete output set
      // 3. Verify balance is sufficient
      // 4. If insufficient, select more UTxOs and retry
      yield* Effect.logDebug("Starting reselection loop with change creation")

      let attempt = 0
      let calculatedFee = 0n
      let balanceVerificationPassed = false

      while (attempt < MAX_RESELECTION_ATTEMPTS && !balanceVerificationPassed) {
        attempt++

        yield* Effect.logDebug(`Reselection attempt ${attempt}/${MAX_RESELECTION_ATTEMPTS}`)

        // Get current state
        const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
        const baseOutputs = yield* Ref.get(ctx.state.outputs)
        const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
        const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)

        yield* Effect.logDebug(
          `Reselection state: ${selectedUtxos.length} UTxOs selected, ` +
            `inputs: ${inputAssets.lovelace || 0n} lovelace, ` +
            `outputs: ${outputAssets.lovelace || 0n} lovelace`
        )

        // Convert UTxOs to TransactionInputs for fee calculation
        const inputs = yield* Effect.catchAll(buildTransactionInputs(selectedUtxos), (error) =>
          Effect.gen(function* () {
            yield* Effect.logError(`Failed to build transaction inputs: ${JSON.stringify(error, null, 2)}`)
            return yield* Effect.fail(error)
          })
        )

        yield* Effect.logDebug(`Successfully built ${inputs.length} transaction inputs`)

        // Estimate fee for current transaction WITHOUT change outputs
        // This gives us a baseline fee to reserve from leftover
        const baseFee = yield* calculateFeeIteratively(selectedUtxos, inputs, baseOutputs, {
          minFeeCoefficient: ctx.config.protocolParameters.minFeeCoefficient,
          minFeeConstant: ctx.config.protocolParameters.minFeeConstant
        })

        yield* Effect.logDebug(`Base fee (without change): ${baseFee} lovelace`)

        // Calculate leftover assets (inputs - outputs - estimatedFee)
        // Reserve estimated fee so change outputs don't consume it
        const leftoverAssets: Assets.Assets = { ...inputAssets, lovelace: 0n }
        for (const [unit, amount] of Object.entries(outputAssets)) {
          const current = leftoverAssets[unit] || 0n
          const remaining = current - (amount as bigint)
          if (remaining > 0n) {
            leftoverAssets[unit] = remaining
          } else {
            delete leftoverAssets[unit]
          }
        }

        // Subtract base fee from lovelace leftover
        leftoverAssets.lovelace = Assets.getAsset(leftoverAssets, "lovelace") - baseFee

        // Attempt to create change output(s) from leftover assets
        let changeOutputs: Array<UTxO.TxOutput> = []

        const leftoverLovelace = Assets.getAsset(leftoverAssets, "lovelace")

        // BUG FIX: Check if leftover lovelace is negative BEFORE attempting change creation
        // If we have insufficient funds (negative lovelace), skip change creation entirely
        // and let balance verification trigger reselection
        if (leftoverLovelace < 0n) {
          yield* Effect.logDebug(
            `Insufficient lovelace for fee: leftover is ${leftoverLovelace}. ` +
              `Skipping change creation, balance verification will trigger reselection.`
          )
          // Set leftover to empty to skip change creation
          // Native assets (if any) will be included in next reselection iteration
        } else if (leftoverLovelace > 0n || Object.keys(leftoverAssets).length > 1) {
          yield* Effect.logDebug("Attempting to create change output from leftover assets")

          // Calculate actual minimum UTxO requirement using CBOR encoding
          // This ensures accurate decision-making for complex asset bundles
          const nativeAssetCount = Object.keys(leftoverAssets).length - 1 // Exclude 'lovelace'
          yield* Effect.logDebug(`Change calculation: ${leftoverLovelace} lovelace + ${nativeAssetCount} native assets`)

          const minUtxo = yield* calculateMinimumUtxoLovelace({
            address: ctx.config.changeAddress,
            assets: leftoverAssets,
            coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte
          })

          yield* Effect.logDebug(`MinUTxO requirement: ${minUtxo} lovelace (via actual CBOR calculation)`)

          if (leftoverLovelace >= minUtxo) {
            // SUCCESS: Leftover is sufficient for change output(s)

            // Priority 1: Apply unfracking if configured
            if (options?.unfrack) {
              yield* Effect.logDebug("Applying unfrack optimization to change outputs")
              const unfrackedOutputs = yield* createChangeOutput({
                leftoverAssets,
                changeAddress: ctx.config.changeAddress,
                coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte,
                unfrackOptions: options.unfrack
              })
              changeOutputs = [...unfrackedOutputs]
              yield* Effect.logDebug(`Created ${unfrackedOutputs.length} unfracked change outputs`)
            } else {
              // Priority 2: Create simple change output (no unfracking)
              changeOutputs.push({
                address: ctx.config.changeAddress,
                assets: leftoverAssets
              })
              yield* Effect.logDebug(
                `Created change output: ${leftoverLovelace} lovelace + ${Object.keys(leftoverAssets).length - 1} asset units`
              )
            }
          } else {
            // INSUFFICIENT: Try fallback strategies
            yield* Effect.logDebug(`Change too small (${leftoverLovelace} < ${minUtxo}), attempting fallback`)

            // Strategy 1: drainTo (merge with existing output)
            if (options?.drainTo !== undefined) {
              const drainToIndex = options.drainTo
              const targetOutput = baseOutputs[drainToIndex]

              if (!targetOutput) {
                return yield* Effect.fail(
                  new TransactionBuilderError({
                    message: `drainTo index ${drainToIndex} out of bounds (${baseOutputs.length} outputs)`
                  })
                )
              }

              yield* Effect.logDebug(`Merging leftover into output #${drainToIndex} (drainTo strategy)`)

              // Merge leftover into target output
              const updatedAssets = Assets.add(targetOutput.assets, leftoverAssets)

              const updatedOutput: UTxO.TxOutput = {
                ...targetOutput,
                assets: updatedAssets
              }

              // Validate that the merged output meets minimum UTxO requirements
              const mergedMinUtxo = yield* calculateMinimumUtxoLovelace({
                address: updatedOutput.address,
                assets: updatedAssets,
                datum: updatedOutput.datumOption,
                scriptRef: updatedOutput.scriptRef,
                coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte
              })

              const updatedLovelace = Assets.getAsset(updatedAssets, "lovelace")

              yield* Effect.logDebug(
                `drainTo validation: Merged output has ${updatedLovelace} lovelace ` + `(minUTxO: ${mergedMinUtxo})`
              )

              if (updatedLovelace < mergedMinUtxo) {
                return yield* Effect.fail(
                  new TransactionBuilderError({
                    message:
                      `drainTo validation failed: Merged output at index ${drainToIndex} ` +
                      `has ${updatedLovelace} lovelace but requires minimum ${mergedMinUtxo}. ` +
                      `The target output has too many assets to absorb the small leftover. ` +
                      `Consider using a different drainTo target or adding more funds.`
                  })
                )
              }

              // Replace the target output in base outputs
              const updatedBaseOutputs = [...baseOutputs]
              updatedBaseOutputs[drainToIndex] = updatedOutput

              yield* Ref.set(ctx.state.outputs, updatedBaseOutputs)
              yield* Effect.logDebug(
                `Successfully merged leftover via drainTo (validated: ${updatedLovelace} >= ${mergedMinUtxo})`
              )

              // No change outputs needed (merged into existing)
              changeOutputs = []
            } else {
              // Strategy 2: Check onInsufficientChange option
              const hasNativeAssets = Object.keys(leftoverAssets).length > 1

              if (hasNativeAssets) {
                // Native assets cannot be burned as fee - they would be lost forever
                // STRATEGY: Create a change output with minUTxO requirement even though
                // we don't have enough lovelace yet. This will cause balance verification
                // to detect the shortfall and trigger reselection for more lovelace.
                const lovelaceShortfall = minUtxo - leftoverLovelace

                yield* Effect.logDebug(
                  `Insufficient change with native assets: ${leftoverLovelace} < ${minUtxo}. ` +
                    `Shortfall: ${lovelaceShortfall} lovelace. ` +
                    `Creating change output with minUTxO requirement to trigger reselection.`
                )

                // Create change output with the REQUIRED minUTxO amount (not what we have)
                // This will cause balance verification to see we're short on lovelace
                changeOutputs.push({
                  address: ctx.config.changeAddress,
                  assets: {
                    ...leftoverAssets,
                    lovelace: minUtxo // Use required amount, not available amount
                  }
                })

                // Balance verification will detect:
                // - We need minUtxo lovelace for change
                // - We only have leftoverLovelace available
                // - Shortfall = minUtxo - leftoverLovelace
                // This will trigger reselection to add more UTxOs
              } else {
                // Only lovelace left and it's below minUtxo
                const insufficientChangeStrategy = options?.onInsufficientChange ?? "error"

                if (insufficientChangeStrategy === "burn") {
                  // User explicitly consented to burn leftover lovelace as extra fee
                  yield* Effect.logWarning(
                    `Burning ${leftoverLovelace} lovelace as extra fee (below minUtxo ${minUtxo})`
                  )
                  // Leftover becomes extra fee (not added to outputs)
                  changeOutputs = []
                } else {
                  // Default: Error to prevent accidental loss
                  return yield* Effect.fail(
                    new TransactionBuilderError({
                      message:
                        `Insufficient change: ${leftoverLovelace} lovelace is below ` +
                        `minimum UTxO (${minUtxo}). Configure drainTo to merge with an existing output, ` +
                        `or set onInsufficientChange: 'burn' to explicitly allow burning as extra fee.`
                    })
                  )
                }
              }
            }
          }
        } else {
          yield* Effect.logDebug("No leftover assets, skipping change creation")
        }

        // Build complete output set: base outputs + change outputs
        const currentBaseOutputs = yield* Ref.get(ctx.state.outputs) // Re-fetch in case drainTo modified it
        const allOutputs = [...currentBaseOutputs, ...changeOutputs]

        // Calculate actual fee with complete outputs (including change)
        calculatedFee = yield* calculateFeeIteratively(selectedUtxos, inputs, allOutputs, {
          minFeeCoefficient: ctx.config.protocolParameters.minFeeCoefficient,
          minFeeConstant: ctx.config.protocolParameters.minFeeConstant
        })

        yield* Effect.logDebug(`Calculated fee with ${allOutputs.length} outputs: ${calculatedFee} lovelace`)

        // Check if actual fee differs from base fee
        // Recalculation needed when: (1) change outputs exist, OR (2) drainTo was used
        const needsRecalculation = changeOutputs.length > 0 || options?.drainTo !== undefined
        if (calculatedFee !== baseFee && needsRecalculation) {
          const feeDelta = calculatedFee - baseFee
          yield* Effect.logDebug(
            `Fee adjustment triggered: ${baseFee} → ${calculatedFee} (Δ +${feeDelta} lovelace). ` +
              `Recalculating change outputs with correct fee.`
          )

          // Recalculate leftover with ACTUAL fee
          const correctedLeftover: Assets.Assets = { ...inputAssets, lovelace: 0n }
          for (const [unit, amount] of Object.entries(outputAssets)) {
            const current = correctedLeftover[unit] || 0n
            const remaining = current - (amount as bigint)
            if (remaining > 0n) {
              correctedLeftover[unit] = remaining
            } else {
              delete correctedLeftover[unit]
            }
          }

          // Subtract ACTUAL fee from lovelace leftover
          const feeUsedForLeftover = calculatedFee // Track which fee we used
          const currentCorrectedLovelace = Assets.getAsset(correctedLeftover, "lovelace")
          correctedLeftover.lovelace = currentCorrectedLovelace - calculatedFee

          const correctedLovelace = Assets.getAsset(correctedLeftover, "lovelace")
          if (correctedLovelace >= 0n && (correctedLovelace > 0n || Object.keys(correctedLeftover).length > 1)) {
            // Recreate change outputs with corrected leftover
            if (options?.unfrack) {
              yield* Effect.logDebug("Applying unfrack to corrected change outputs")
              const recalculatedOutputs = yield* createChangeOutput({
                leftoverAssets: correctedLeftover,
                changeAddress: ctx.config.changeAddress,
                coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte,
                unfrackOptions: options.unfrack
              })
              changeOutputs = [...recalculatedOutputs]

              // Rebuild complete output set with corrected change
              const updatedAllOutputs = [...currentBaseOutputs, ...changeOutputs]

              // Recalculate fee with corrected outputs
              const recalculatedFee = yield* calculateFeeIteratively(selectedUtxos, inputs, updatedAllOutputs, {
                minFeeCoefficient: ctx.config.protocolParameters.minFeeCoefficient,
                minFeeConstant: ctx.config.protocolParameters.minFeeConstant
              })

              calculatedFee = recalculatedFee
              // Update allOutputs for balance verification
              let allOutputsFixed = updatedAllOutputs

              yield* Effect.logDebug(`Recalculated fee after correction: ${calculatedFee} lovelace`)

              // If fee changed during recalculation, adjust the outputs again
              if (recalculatedFee !== feeUsedForLeftover) {
                const feeAdjustment = feeUsedForLeftover - recalculatedFee
                yield* Effect.logDebug(
                  `Fee changed during unfrack recalculation. Adjusting outputs by ${feeAdjustment} lovelace`
                )

                // Add the fee difference to the first change output
                if (allOutputsFixed.length > currentBaseOutputs.length) {
                  const firstChangeIndex = currentBaseOutputs.length
                  allOutputsFixed = [...allOutputsFixed]
                  allOutputsFixed[firstChangeIndex] = {
                    ...allOutputsFixed[firstChangeIndex],
                    assets: {
                      ...allOutputsFixed[firstChangeIndex].assets,
                      lovelace: allOutputsFixed[firstChangeIndex].assets.lovelace + feeAdjustment
                    }
                  }
                }
              }

              // Use corrected outputs for balance check
              const balanceCheckCorrected = verifyTransactionBalance(selectedUtxos, allOutputsFixed, calculatedFee)

              if (balanceCheckCorrected.sufficient) {
                // ✅ SUCCESS with corrected change
                balanceVerificationPassed = true
                yield* Ref.set(ctx.state.outputs, allOutputsFixed)
                yield* Effect.logDebug(
                  `Balance verification passed after correction on attempt ${attempt}. ` +
                    `Fee: ${calculatedFee}, Change: ${balanceCheckCorrected.change} lovelace`
                )
                continue // Skip to next iteration (which will exit since balanceVerificationPassed = true)
              }
            } else if (options?.drainTo !== undefined) {
              // Handle drainTo without unfrack: merge corrected leftover into target output
              const drainToIndex = options.drainTo
              const targetOutput = baseOutputs[drainToIndex] // Use ORIGINAL base outputs, not modified ones

              if (!targetOutput) {
                return yield* Effect.fail(
                  new TransactionBuilderError({
                    message: `drainTo index ${drainToIndex} out of bounds after recalculation`
                  })
                )
              }

              // Merge corrected leftover into target output
              const updatedAssets = Assets.add(targetOutput.assets, correctedLeftover)

              const updatedOutput: UTxO.TxOutput = {
                ...targetOutput,
                assets: updatedAssets
              }

              // Validate that the merged output meets minimum UTxO requirements
              const mergedMinUtxo = yield* calculateMinimumUtxoLovelace({
                address: updatedOutput.address,
                assets: updatedAssets,
                datum: updatedOutput.datumOption,
                scriptRef: updatedOutput.scriptRef,
                coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte
              })

              const recalcUpdatedLovelace = Assets.getAsset(updatedAssets, "lovelace")
              if (recalcUpdatedLovelace < mergedMinUtxo) {
                return yield* Effect.fail(
                  new TransactionBuilderError({
                    message:
                      `drainTo validation failed after fee recalculation: Merged output at index ${drainToIndex} ` +
                      `has ${recalcUpdatedLovelace} lovelace but requires minimum ${mergedMinUtxo}. ` +
                      `The target output has too many assets to absorb the corrected leftover. ` +
                      `Consider using a different drainTo target or adding more funds.`
                  })
                )
              }

              // Replace the target output
              const updatedBaseOutputs = [...baseOutputs] // Start from ORIGINAL outputs
              updatedBaseOutputs[drainToIndex] = updatedOutput

              // Recalculate fee with corrected drainTo output
              const recalculatedFee = yield* calculateFeeIteratively(selectedUtxos, inputs, updatedBaseOutputs, {
                minFeeCoefficient: ctx.config.protocolParameters.minFeeCoefficient,
                minFeeConstant: ctx.config.protocolParameters.minFeeConstant
              })

              calculatedFee = recalculatedFee

              yield* Effect.logDebug(`Recalculated fee after drainTo correction: ${calculatedFee} lovelace`)

              // If fee changed during recalculation, adjust the output again
              if (recalculatedFee !== feeUsedForLeftover) {
                const feeAdjustment = feeUsedForLeftover - recalculatedFee
                yield* Effect.logDebug(
                  `Fee changed during recalculation. Adjusting output by ${feeAdjustment} lovelace`
                )
                const currentDrainToLovelace = Assets.getAsset(updatedBaseOutputs[drainToIndex].assets, "lovelace")
                updatedBaseOutputs[drainToIndex] = {
                  ...updatedBaseOutputs[drainToIndex],
                  assets: {
                    ...updatedBaseOutputs[drainToIndex].assets,
                    lovelace: currentDrainToLovelace + feeAdjustment
                  }
                }

                // Re-validate after fee adjustment
                const adjustedMinUtxo = yield* calculateMinimumUtxoLovelace({
                  address: updatedBaseOutputs[drainToIndex].address,
                  assets: updatedBaseOutputs[drainToIndex].assets,
                  datum: updatedBaseOutputs[drainToIndex].datumOption,
                  scriptRef: updatedBaseOutputs[drainToIndex].scriptRef,
                  coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte
                })

                const adjustedLovelace = Assets.getAsset(updatedBaseOutputs[drainToIndex].assets, "lovelace")
                if (adjustedLovelace < adjustedMinUtxo) {
                  return yield* Effect.fail(
                    new TransactionBuilderError({
                      message:
                        `drainTo validation failed after fee adjustment: Output at index ${drainToIndex} ` +
                        `has ${adjustedLovelace} lovelace but requires minimum ${adjustedMinUtxo}.`
                    })
                  )
                }
              }

              // Use corrected outputs for balance check
              const balanceCheckCorrected = verifyTransactionBalance(selectedUtxos, updatedBaseOutputs, calculatedFee)

              if (balanceCheckCorrected.sufficient) {
                // ✅ SUCCESS with corrected drainTo
                balanceVerificationPassed = true
                yield* Ref.set(ctx.state.outputs, updatedBaseOutputs)
                yield* Effect.logDebug(
                  `Balance verification passed after drainTo correction on attempt ${attempt}. ` +
                    `Fee: ${calculatedFee}, Change: ${balanceCheckCorrected.change} lovelace`
                )
                continue // Skip to next iteration (which will exit since balanceVerificationPassed = true)
              } else {
                yield* Effect.logWarning(
                  `Balance check failed after drainTo correction. Shortfall: ${balanceCheckCorrected.shortfall}`
                )
              }
            } else {
              // Handle simple change output (no unfrack, no drainTo)
              // Just update the change output's lovelace with the corrected amount
              if (changeOutputs.length > 0) {
                const feeDifference = calculatedFee - baseFee
                yield* Effect.logDebug(`Adjusting simple change output by -${feeDifference} lovelace (fee increased)`)

                changeOutputs = changeOutputs.map((output) => {
                  const currentOutputLovelace = Assets.getAsset(output.assets, "lovelace")
                  return {
                    ...output,
                    assets: {
                      ...output.assets,
                      lovelace: currentOutputLovelace - feeDifference
                    }
                  }
                })

                // Rebuild complete output set with adjusted change
                const adjustedAllOutputs = [...currentBaseOutputs, ...changeOutputs]

                // Verify the adjusted outputs meet balance
                const balanceCheckAdjusted = verifyTransactionBalance(selectedUtxos, adjustedAllOutputs, calculatedFee)

                if (balanceCheckAdjusted.sufficient) {
                  // ✅ SUCCESS with adjusted change
                  balanceVerificationPassed = true
                  yield* Ref.set(ctx.state.outputs, adjustedAllOutputs)
                  yield* Effect.logDebug(
                    `Balance verification passed after simple change adjustment on attempt ${attempt}. ` +
                      `Fee: ${calculatedFee}, Adjusted change: ${changeOutputs[0].assets.lovelace} lovelace`
                  )
                  continue // Skip to next iteration (which will exit since balanceVerificationPassed = true)
                } else {
                  yield* Effect.logWarning(
                    `Balance check failed after simple change adjustment. Shortfall: ${balanceCheckAdjusted.shortfall}`
                  )
                }
              }
            }
          }
        }

        // Verify balance with actual fee
        const balanceCheck = verifyTransactionBalance(selectedUtxos, allOutputs, calculatedFee)

        if (balanceCheck.sufficient) {
          // ✅ SUCCESS: Balance is sufficient
          balanceVerificationPassed = true

          // Update outputs in state (base + change)
          yield* Ref.set(ctx.state.outputs, allOutputs)

          yield* Effect.logDebug(
            `Balance verification passed on attempt ${attempt}. ` +
              `Fee: ${calculatedFee}, Change: ${balanceCheck.change} lovelace`
          )
        } else {
          // ❌ INSUFFICIENT: Need more UTxOs
          const shortfall = balanceCheck.shortfall

          if (attempt < MAX_RESELECTION_ATTEMPTS) {
            yield* Effect.logWarning(
              `Balance verification failed on attempt ${attempt}. ` +
                `Shortfall: ${shortfall} lovelace. Selecting more UTxOs...`
            )

            // Get available UTxOs for reselection
            const configUtxos = ctx.config.availableUtxos
            const alreadyCollected = yield* Ref.get(ctx.state.selectedUtxos)

            const availableUtxos = configUtxos.filter(
              (utxo) =>
                !alreadyCollected.some(
                  (collected) => collected.txHash === utxo.txHash && collected.outputIndex === utxo.outputIndex
                )
            )

            // Select more UTxOs to cover shortfall
            const coinSelectionFn = options?.coinSelection
              ? typeof options.coinSelection === "function"
                ? options.coinSelection
                : getCoinSelectionAlgorithm(options.coinSelection)
              : largestFirstSelection

            const { selectedUtxos: additionalUtxos } = yield* Effect.try({
              try: () => coinSelectionFn(availableUtxos, { lovelace: shortfall }),
              catch: (error) =>
                new TransactionBuilderError({
                  message: `Reselection failed to cover ${shortfall} lovelace shortfall`,
                  cause: error
                })
            })

            const totalInputsBefore = alreadyCollected.reduce((sum, u) => sum + u.assets.lovelace, 0n)
            const additionalLovelace = additionalUtxos.reduce((sum, u) => sum + u.assets.lovelace, 0n)

            yield* Effect.logDebug(
              `Reselection added ${additionalUtxos.length} UTxOs ` +
                `(${availableUtxos.length} available). ` +
                `Total inputs: ${totalInputsBefore} → ${totalInputsBefore + additionalLovelace} lovelace`
            )

            // Add selected UTxOs to state
            yield* Ref.update(ctx.state.selectedUtxos, (current) => [...current, ...additionalUtxos])

            // Update total input assets
            for (const utxo of additionalUtxos) {
              yield* Ref.update(ctx.state.totalInputAssets, (current) => {
                const updated = { ...current }
                for (const [unit, amount] of Object.entries(utxo.assets)) {
                  updated[unit] = (updated[unit] || 0n) + (amount as bigint)
                }
                return updated
              })
            }

            yield* Effect.logDebug(`Reselection added ${additionalUtxos.length} UTxOs`)
          } else {
            // Max attempts reached - fail with detailed error
            return yield* Effect.fail(
              new TransactionBuilderError({
                message:
                  `Cannot balance transaction after ${MAX_RESELECTION_ATTEMPTS} attempts. ` +
                  `Final shortfall: ${shortfall} lovelace. ` +
                  `This may indicate insufficient funds in available UTxOs.`,
                cause: {
                  attempts: MAX_RESELECTION_ATTEMPTS,
                  finalShortfall: shortfall.toString(),
                  calculatedFee: calculatedFee.toString(),
                  selectedUtxos: selectedUtxos.length
                }
              })
            )
          }
        }
      }

      // 4. Fee Assignment and Final Assembly
      // After reselection loop, we have final outputs (with change) and calculated fee
      const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
      const finalOutputs = yield* Ref.get(ctx.state.outputs)
      const fee = calculatedFee

      // 5. Convert UTxOs to TransactionInputs (sorted deterministically)
      const inputs = yield* buildTransactionInputs(selectedUtxos)

      // 6. Assemble final transaction with calculated fee and final outputs
      const transaction = yield* assembleTransaction(inputs, finalOutputs, fee)

      // 10. Validate transaction size against protocol limit
      // Build transaction WITH fake witnesses (same as fee calculation does) for accurate size check
      const fakeWitnessSet = yield* buildFakeWitnessSet(selectedUtxos)

      yield* Effect.logDebug(
        `Fake witness set: ${fakeWitnessSet.vkeyWitnesses?.length ?? 0} vkey witnesses, ` + `${inputs.length} inputs`
      )

      const txWithWitnesses = new Transaction.Transaction({
        body: transaction.body,
        witnessSet: fakeWitnessSet,
        isValid: true,
        auxiliaryData: null
      })

      // Get actual CBOR size with fake witnesses
      const txSizeWithWitnesses = yield* calculateTransactionSize(txWithWitnesses)

      yield* Effect.logDebug(
        `Transaction size check: ${txSizeWithWitnesses} bytes ` +
          `(with ${fakeWitnessSet.vkeyWitnesses?.length ?? 0} fake witnesses), max=${ctx.config.protocolParameters.maxTxSize} bytes`
      )

      if (txSizeWithWitnesses > ctx.config.protocolParameters.maxTxSize) {
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              `Transaction size (${txSizeWithWitnesses} bytes) exceeds maximum ` +
              `allowed (${ctx.config.protocolParameters.maxTxSize} bytes). ` +
              `Try reducing inputs (${inputs.length}) or outputs (${finalOutputs.length}).`,
            cause: {
              txSizeBytes: txSizeWithWitnesses,
              maxTxSize: ctx.config.protocolParameters.maxTxSize,
              inputCount: inputs.length,
              outputCount: finalOutputs.length,
              suggestion: "Use larger UTxOs or consolidate outputs to reduce transaction size"
            }
          })
        )
      }

      // TODO Step 4: Build witness set with redeemers and detect required signers
      // TODO Step 5: Run script evaluation to fill ExUnits
      // TODO Step 6: Add change output (balancing)

      // Build transaction with fake witnesses for validation
      const txWithFakeWitnesses = new Transaction.Transaction({
        body: transaction.body,
        witnessSet: fakeWitnessSet,
        isValid: true,
        auxiliaryData: null
      })

      // 10. Return minimal SignBuilder stub
      const signBuilder: SignBuilder = {
        Effect: {
          sign: () => Effect.fail(new TransactionBuilderError({ message: "Signing not yet implemented" })),
          signWithWitness: () =>
            Effect.fail(new TransactionBuilderError({ message: "Witness signing not yet implemented" })),
          assemble: () => Effect.fail(new TransactionBuilderError({ message: "Assemble not yet implemented" })),
          partialSign: () =>
            Effect.fail(new TransactionBuilderError({ message: "Partial signing not yet implemented" })),
          getWitnessSet: () => Effect.succeed(transaction.witnessSet),
          toTransaction: () => Effect.succeed(transaction),
          toTransactionWithFakeWitnesses: () => Effect.succeed(txWithFakeWitnesses)
        },
        sign: () => Promise.reject(new Error("Signing not yet implemented")),
        signWithWitness: () => Promise.reject(new Error("Witness signing not yet implemented")),
        assemble: () => Promise.reject(new Error("Assemble not yet implemented")),
        partialSign: () => Promise.reject(new Error("Partial signing not yet implemented")),
        getWitnessSet: () => Promise.resolve(transaction.witnessSet),
        toTransaction: () => Promise.resolve(transaction),
        toTransactionWithFakeWitnesses: () => Promise.resolve(txWithFakeWitnesses)
      }

      return signBuilder
    }).pipe(
      Effect.provideServiceEffect(
        TxContext,
        Effect.gen(function* () {
          return {
            config,
            state: yield* createFreshState(),
            options: options ?? {}
          }
        })
      ),
      Effect.mapError(
        (error) =>
          new TransactionBuilderError({
            message: "Build failed",
            cause: error
          })
      )
    )

  // ============================================================================
  // State Machine Implementation (Parallel/Experimental)
  // ============================================================================

  // ============================================================================
  // EXPERIMENTAL STATE MACHINE IMPLEMENTATION
  // ============================================================================
  // This is a parallel implementation to buildEffectCore using state machine pattern.
  // NOT YET ACTIVE in production - has Context.Tag type system issues to resolve.
  // TypeScript errors suppressed below as this is experimental/WIP code.
  // ============================================================================

  // @ts-nocheck - Experimental state machine code below

  /**
   * Build phases representing the transaction building lifecycle
   *
   * Context-driven state machine:
   * - Being IN a phase means DO that work
   * - Phases read/write context, return next phase
   * - selection is reusable (called initially or for reselection)
   * - Fallbacks (drainTo, burnAsFee) only when attempts exhausted
   */
  type BuildPhase =
    | "selection" // Select coins if needed (checks context)
    | "changeCreation" // Create change outputs
    | "feeCalculation" // Calculate fee with change
    | "balanceVerification" // Verify balance, decide next
    | "drainTo" // Fallback: merge to existing output
    | "burnAsFee" // Fallback: burn remaining as fee
    | "complete" // Done

  /**
   * Build context carrying state machine execution state
   * Note: Removed duplication - selectedUtxos/baseOutputs read from TxContext.state
   */
  interface BuildContext {
    /**
     * Current state machine phase
     *
     * Determines which phase executes next:
     * - `selection`: Select UTxOs to cover outputs + fee
     * - `changeCreation`: Create change outputs from leftover
     * - `feeCalculation`: Calculate actual fee with change included
     * - `balanceVerification`: Verify balance and route to completion/retry/fallback
     * - `drainTo`: Fallback to merge small leftover into existing output
     * - `burnAsFee`: Fallback to burn small leftover as extra fee
     * - `complete`: Terminal state - transaction successfully built
     */
    readonly phase: BuildPhase

    /**
     * Current reselection attempt number (1-based)
     *
     * Tracks how many times we've tried to select UTxOs and create change.
     * Used to prevent infinite loops (MAX_ATTEMPTS = 3).
     *
     * Example flow:
     * - Attempt 1: Select 3 ADA, need change but insufficient → shortfall
     * - Attempt 2: Select more UTxOs (5 ADA total), create change → success
     */
    readonly attempt: number

    /**
     * Final calculated transaction fee in lovelace
     *
     * Fee includes:
     * - Base transaction structure
     * - All inputs (from selected UTxOs)
     * - All outputs (user outputs + change outputs)
     * - Witness estimates
     *
     * Updated after:
     * - Fee calculation phase (includes change outputs)
     * - Fee adjustment (when change affects fee)
     */
    readonly calculatedFee: bigint

    /**
     * Amount of lovelace we're short when inputs insufficient
     *
     * Calculated by balance verification as the total deficit:
     * shortfall = (outputs + changeOutputs + fee) - inputs
     *
     * This represents ALL missing lovelace, including:
     * - Output requirements
     * - Fee payment
     * - Change output minUTxO needs (for both single and unfrack bundles)
     *
     * Used to:
     * - Trigger reselection (select more UTxOs to cover shortfall)
     * - Single source of truth for deficit during reselection
     * - Debug insufficient balance errors
     * - Track progress across attempts
     *
     * Set by: Balance verification when inputs < outputs
     * Used by: Selection phase during reselection attempts
     * Reset to: 0n after selection completes
     */
    readonly shortfall: bigint

    /**
     * Change outputs created from leftover assets
     *
     * Created in changeCreation phase when:
     * - Leftover has native assets (MUST create change - ledger rule)
     * - Leftover ADA >= minUTxO (can create valid change)
     *
     * Empty array when:
     * - Leftover too small (triggers drainTo or burnAsFee)
     * - No leftover after paying outputs + fee
     *
     * Used in:
     * - Fee calculation (affects transaction size)
     * - Balance verification (check if change created)
     */
    readonly changeOutputs: ReadonlyArray<UTxO.TxOutput>

    /**
     * Leftover assets AFTER subtracting the fee
     *
     * Calculated as: leftoverBeforeFee - calculatedFee
     * Set in Phase 2 (Change Creation), used in Phase 4+ (Balance Verification, DrainTo, BurnAsFee)
     *
     * Purpose:
     * - Single source of truth for what's available after fee payment
     * - Eliminates redundant calculations across phases
     * - Used for minUTxO checks, drainTo validation, burn decisions
     *
     * Example: leftoverBeforeFee = 5 ADA, calculatedFee = 0.17 ADA
     *   → leftoverAfterFee = 4.83 ADA
     *
     * Initialized to zero assets before Phase 2 completes
     *
     * @since 2.0.0
     */
    readonly leftoverAfterFee: Assets.Assets

    /**
     * Index of output modified by drainTo fallback (optional)
     *
     * When leftover < minUTxO and ADA-only:
     * - DrainTo merges leftover into existing output
     * - This index tracks which output was modified
     *
     * Purpose:
     * - Validation: Ensure merged output still meets minUTxO
     * - Debugging: Track which output received extra funds
     *
     * Example: drainToIndex = 0 means leftover merged into first output
     *
     * Only set when:
     * - drainTo configured in options
     * - Leftover < minUTxO
     * - Leftover is ADA-only (no native assets)
     */
    readonly drainToIndex?: number

    /**
     * Whether unfrack optimization is allowed for this build
     *
     * Controls whether ChangeCreation should attempt to create unfracked
     * change outputs (splitting tokens into multiple bundles).
     *
     * Initialized based on options:
     * - true: If unfrack option is configured
     * - false: If unfrack option is not configured
     *
     * Can be set to false during build if:
     * - Unfrack attempted but failed due to insufficient lovelace
     * - Fallback to single change output triggered
     *
     * Purpose:
     * - Allow precise fallback without heuristics
     * - Try unfrack, detect failure, retry without it
     * - Prevent re-attempting unfrack after it fails
     *
     * @since 2.0.0
     */
    readonly canUnfrack: boolean
  }

  /**
   * Phase result - describes what to do next.
   *
   * Each phase has ONE responsibility: decide what to do next.
   * Phases read context, do their work, update context, return next phase.
   *
   * This pattern enables:
   * - Single Responsibility: Phases do one thing
   * - State Reuse: Selection logic reusable from different contexts
   * - Context-driven: All state in context, no data passing
   * - Effect-idiomatic: Composable state machine
   */
  type PhaseResult = {
    readonly next: BuildPhase
  }

  /**
   * BuildContext service tag
   */
  class BuildContextTag extends Context.Tag("BuildContextTag")<BuildContextTag, Ref.Ref<BuildContext>>() {}

  // ============================================================================
  // V2: CLEAN STATE MACHINE IMPLEMENTATION
  // ============================================================================

  /**
   * NEW State Machine V2 - Clean context-driven implementation
   *
   * Key principles:
   * - Start with fee = 0, let balance verification drive everything
   * - Phases read context, do work, return next phase
   * - Trust fee convergence (usually 1-2 iterations)
   * - Selection is reusable
   * - Fallbacks only when attempts exhausted
   */
  const buildEffectCoreStateMachineV2 = (options?: BuildOptions) =>
    Effect.gen(function* () {
      const ctx = yield* TxContext

      // Execute all programs to populate initial state
      yield* Effect.all(programs, { concurrency: "unbounded" })

      // Create initial build context
      const initialBuildCtx: BuildContext = {
        phase: "selection" as const,
        attempt: 0,
        calculatedFee: 0n, // Start with 0!
        shortfall: 0n,
        changeOutputs: [],
        leftoverAfterFee: { lovelace: 0n },
        canUnfrack: ctx.options?.unfrack !== undefined
      }

      const buildCtxRef = yield* Ref.make(initialBuildCtx)

      return yield* Effect.gen(function* () {
        // State machine loop
        while (true) {
          const buildCtx = yield* Ref.get(buildCtxRef)

          if (buildCtx.phase === "complete") {
            break
          }

          yield* Effect.logDebug(
            `[StateMachineV2] Phase: ${buildCtx.phase}, Attempt: ${buildCtx.attempt}, Fee: ${buildCtx.calculatedFee}`
          )

          // Execute phase
          yield* executePhaseV2
        }

        // Build final transaction
        const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
        const baseOutputs = yield* Ref.get(ctx.state.outputs)
        const finalBuildCtx = yield* Ref.get(buildCtxRef)

        yield* Effect.logDebug(
          `[buildEffectCoreStateMachineV2] Base outputs: ${baseOutputs.length}, ` +
            `Change outputs: ${finalBuildCtx.changeOutputs.length}`
        )

        const inputs = yield* buildTransactionInputs(selectedUtxos)
        const allOutputs = [...baseOutputs, ...finalBuildCtx.changeOutputs]

        yield* Effect.logDebug(`[buildEffectCoreStateMachineV2] Total outputs: ${allOutputs.length}`)

        const transaction = yield* assembleTransaction(inputs, allOutputs, finalBuildCtx.calculatedFee)

        // SAFETY CHECK: Validate transaction size against protocol limit
        // Build transaction WITH fake witnesses for accurate size check (same as old impl)
        const fakeWitnessSet = yield* buildFakeWitnessSet(selectedUtxos)

        yield* Effect.logDebug(
          `[StateMachineV2] Fake witness set: ${fakeWitnessSet.vkeyWitnesses?.length ?? 0} vkey witnesses, ` +
            `${inputs.length} inputs`
        )

        const txWithFakeWitnesses = new Transaction.Transaction({
          body: transaction.body,
          witnessSet: fakeWitnessSet,
          isValid: true,
          auxiliaryData: null
        })

        // Get actual CBOR size with fake witnesses
        const txSizeWithWitnesses = yield* calculateTransactionSize(txWithFakeWitnesses)

        yield* Effect.logDebug(
          `[StateMachineV2] Transaction size: ${txSizeWithWitnesses} bytes ` +
            `(with ${fakeWitnessSet.vkeyWitnesses?.length ?? 0} fake witnesses), ` +
            `max=${ctx.config.protocolParameters.maxTxSize} bytes`
        )

        if (txSizeWithWitnesses > ctx.config.protocolParameters.maxTxSize) {
          return yield* Effect.fail(
            new TransactionBuilderError({
              message:
                `Transaction size (${txSizeWithWitnesses} bytes) exceeds maximum ` +
                `allowed (${ctx.config.protocolParameters.maxTxSize} bytes). ` +
                `Try reducing inputs (${inputs.length}) or outputs (${allOutputs.length}).`,
              cause: {
                txSizeBytes: txSizeWithWitnesses,
                maxTxSize: ctx.config.protocolParameters.maxTxSize,
                inputCount: inputs.length,
                outputCount: allOutputs.length,
                suggestion: "Use larger UTxOs or consolidate outputs to reduce transaction size"
              }
            })
          )
        }

        // Log final build summary
        yield* Effect.logDebug(
          `[StateMachineV2] Build complete: ${inputs.length} input(s), ${allOutputs.length} output(s) ` +
            `(${baseOutputs.length} base + ${finalBuildCtx.changeOutputs.length} change), ` +
            `Fee: ${finalBuildCtx.calculatedFee} lovelace, Size: ${txSizeWithWitnesses} bytes, Attempts: ${finalBuildCtx.attempt}`
        )

        // Return SignBuilder (matching old implementation)
        const signBuilder: SignBuilder = {
          Effect: {
            sign: () => Effect.fail(new TransactionBuilderError({ message: "Signing not yet implemented" })),
            signWithWitness: () =>
              Effect.fail(new TransactionBuilderError({ message: "Witness signing not yet implemented" })),
            assemble: () => Effect.fail(new TransactionBuilderError({ message: "Assemble not yet implemented" })),
            partialSign: () =>
              Effect.fail(new TransactionBuilderError({ message: "Partial signing not yet implemented" })),
            getWitnessSet: () => Effect.succeed(transaction.witnessSet),
            toTransaction: () => Effect.succeed(transaction),
            toTransactionWithFakeWitnesses: () => Effect.succeed(txWithFakeWitnesses)
          },
          sign: () => Promise.reject(new Error("Signing not yet implemented")),
          signWithWitness: () => Promise.reject(new Error("Witness signing not yet implemented")),
          assemble: () => Promise.reject(new Error("Assemble not yet implemented")),
          partialSign: () => Promise.reject(new Error("Partial signing not yet implemented")),
          getWitnessSet: () => Promise.resolve(transaction.witnessSet),
          toTransaction: () => Promise.resolve(transaction),
          toTransactionWithFakeWitnesses: () => Promise.resolve(txWithFakeWitnesses)
        }

        return signBuilder
      }).pipe(Effect.provideService(BuildContextTag, buildCtxRef))
    }).pipe(
      Effect.provideServiceEffect(
        TxContext,
        createFreshState().pipe(Effect.map((state) => ({ config, options: options ?? {}, state })))
      )
    )

  /**
   * Helper: Format assets for logging (BigInt-safe, truncates long unit names)
   */
  const formatAssetsForLog = (assets: Assets.Assets): string => {
    return Object.entries(assets)
      .map(([unit, amount]) => `${unit.substring(0, 16)}...: ${amount.toString()}`)
      .join(", ")
  }

  /**
   * Phase executor V2 - simpler, just updates phase in context
   */
  const executePhaseV2 = Effect.gen(function* () {
    const buildCtxRef = yield* BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    let result: PhaseResult

    switch (buildCtx.phase) {
      case "selection":
        result = yield* phaseSelectionV2
        break

      case "changeCreation":
        result = yield* phaseChangeCreationV2
        break

      case "feeCalculation":
        result = yield* phaseFeeCalculationV2
        break

      case "balanceVerification":
        result = yield* phaseBalanceVerificationV2
        break

      case "drainTo":
        result = yield* phaseDrainToV2
        break

      case "burnAsFee":
        result = yield* phaseBurnAsFeeV2
        break

      case "complete":
        return
    }

    // Update phase
    yield* Ref.update(buildCtxRef, (ctx) => ({ ...ctx, phase: result.next }))
  })

  /**
   * V2 Phase 1: Selection
   * Precisely calculates what's needed based on outputs + calculatedFee
   */
  const phaseSelectionV2 = Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    yield* Effect.logDebug(`[SelectionV2] Attempt ${buildCtx.attempt + 1}`)

    // Check max attempts
    if (buildCtx.attempt >= MAX_RESELECTION_ATTEMPTS) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message: `Cannot balance after ${MAX_RESELECTION_ATTEMPTS} attempts`,
          cause: { attempts: buildCtx.attempt, shortfall: buildCtx.shortfall.toString() }
        })
      )
    }

    const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
    const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)

    // Ensure lovelace field exists for Assets utilities
    const inputAssetsWithLovelace: Assets.Assets = {
      ...inputAssets,
      lovelace: inputAssets.lovelace || 0n
    }

    // PRECISE calculation: what we need = outputs + fee + shortfall (if retrying)
    // On first attempt (attempt=0): shortfall is 0n
    // On retry (attempt>0): shortfall is set by balance verification with the TOTAL deficit
    //
    // NOTE: We use ONLY shortfall during reselection, NOT requiredChangeMinUTxO.
    // The shortfall already accounts for ALL missing lovelace (including change minUTxO needs).
    // Adding both would double-count!
    yield* Effect.logDebug(
      `[SelectionV2] buildCtx.shortfall: ${buildCtx.shortfall}, buildCtx.calculatedFee: ${buildCtx.calculatedFee}`
    )
    const totalNeeded: Assets.Assets = {
      ...outputAssets,
      lovelace: (outputAssets.lovelace || 0n) + buildCtx.calculatedFee + buildCtx.shortfall
    }

    // Calculate precise asset delta: needed - available
    // Positive values = shortfalls (need more), Negative = excess (have more)
    const assetDelta = Assets.subtract(totalNeeded, inputAssetsWithLovelace)

    // Extract only the shortfalls (positive values)
    const assetShortfalls = Assets.filter(assetDelta, (_unit, amount) => amount > 0n)

    const needsSelection = !Assets.isEmpty(assetShortfalls)

    yield* Effect.logDebug(
      `[SelectionV2] Needed: {${formatAssetsForLog(totalNeeded)}}, ` +
        `Available: {${formatAssetsForLog(inputAssetsWithLovelace)}}, ` +
        `Shortfalls: {${formatAssetsForLog(assetShortfalls)}}`
    )

    if (!needsSelection) {
      yield* Effect.logDebug("[SelectionV2] Assets sufficient")
      const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
      yield* Effect.logDebug(
        `[SelectionV2] Selection complete: ${selectedUtxos.length} UTxO(s) selected, ` +
          `Total lovelace: ${inputAssets.lovelace || 0n}`
      )
    } else {
      // Perform selection for precise shortfall
      const shortfallStr = Object.entries(assetShortfalls)
        .map(([_unit, amount]) => amount.toString())
        .join(", ")
      yield* Effect.logDebug(`[SelectionV2] Selecting for shortfall: ${shortfallStr}`)

      const beforeCount = (yield* Ref.get(ctx.state.selectedUtxos)).length
      yield* performCoinSelectionUpdateState(assetShortfalls)
      const afterCount = (yield* Ref.get(ctx.state.selectedUtxos)).length
      const addedCount = afterCount - beforeCount

      const updatedInputAssets = yield* Ref.get(ctx.state.totalInputAssets)
      yield* Effect.logDebug(
        `[SelectionV2] Added ${addedCount} UTxO(s), ` +
          `Total selected: ${afterCount}, ` +
          `New total lovelace: ${updatedInputAssets.lovelace || 0n}`
      )
    }

    // Common path: increment attempt, clear shortfall (we've accounted for it), and proceed to change creation
    yield* Ref.update(buildCtxRef, (ctx) => ({ ...ctx, attempt: ctx.attempt + 1, shortfall: 0n }))
    return { next: "changeCreation" as const }
  })

  /**
   * V2 Phase 2: Change Creation
   *
   * Creates change outputs using tentative leftover (inputs - outputs - fee).
   * Each output created is valid (meets minUTxO). Balance phase verifies total sufficiency.
   */
  const phaseChangeCreationV2 = Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    yield* Effect.logDebug(`[ChangeCreationV2] Fee from context: ${buildCtx.calculatedFee}`)

    // Calculate tentative leftover after fee
    const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
    const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)
    const leftoverBeforeFee = calculateLeftoverAssets(inputAssets, outputAssets)

    const tentativeLeftover: Assets.Assets = {
      ...leftoverBeforeFee,
      lovelace: leftoverBeforeFee.lovelace - buildCtx.calculatedFee
    }

    // Early exit if negative - balance phase will trigger reselection
    if (tentativeLeftover.lovelace < 0n) {
      yield* Effect.logDebug(
        `[ChangeCreationV2] Insufficient lovelace for fee: ${tentativeLeftover.lovelace}. ` +
          `Skipping change, balance verification will trigger reselection.`
      )

      yield* Ref.update(buildCtxRef, (ctx) => ({
        ...ctx,
        changeOutputs: []
      }))
      return { next: "feeCalculation" as const }
    }

    // Unfrack path: Create multiple outputs
    if (ctx.options?.unfrack && buildCtx.canUnfrack) {
      const changeOutputs = yield* createChangeOutputs(tentativeLeftover, ctx)

      yield* Effect.logDebug(`[ChangeCreationV2] Successfully created ${changeOutputs.length} unfracked outputs`)

      // Store outputs and proceed to fee calculation
      yield* Ref.update(buildCtxRef, (ctx) => ({
        ...ctx,
        changeOutputs
      }))
      return { next: "feeCalculation" as const }
    }

    // Single output path: Validate minUTxO requirement
    const minLovelace = yield* calculateMinimumUtxoLovelace({
      address: ctx.config.changeAddress,
      assets: tentativeLeftover,
      coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte
    })

    if (tentativeLeftover.lovelace < minLovelace) {
      const hasNativeAssets = Object.keys(tentativeLeftover).length > 1

      if (hasNativeAssets) {
        // Native assets MUST go in change output (ledger rule)
        // Create placeholder with required minUTxO - balance will detect shortfall
        yield* Effect.logDebug(
          `[ChangeCreationV2] Native assets need ${minLovelace} lovelace, only have ${tentativeLeftover.lovelace}. ` +
            `Creating placeholder change to trigger reselection.`
        )

        const changeOutputs = [
          {
            address: ctx.config.changeAddress,
            assets: { ...tentativeLeftover, lovelace: minLovelace }
          }
        ]

        yield* Ref.update(buildCtxRef, (ctx) => ({
          ...ctx,
          changeOutputs
        }))
        return { next: "feeCalculation" as const }
      }

      // Insufficient ADA-only leftover - return empty, balance will handle (drainTo/burn)
      yield* Effect.logDebug(
        `[ChangeCreationV2] Insufficient lovelace for change (${tentativeLeftover.lovelace} < ${minLovelace}), returning empty change`
      )

      yield* Ref.update(buildCtxRef, (ctx) => ({ ...ctx, changeOutputs: [] }))
      return { next: "feeCalculation" as const }
    }

    // Create valid single change output
    const changeOutput = yield* makeTxOutput({
      address: ctx.config.changeAddress,
      assets: tentativeLeftover
    })

    yield* Effect.logDebug(`[ChangeCreationV2] Created 1 change output with ${tentativeLeftover.lovelace} lovelace`)

    yield* Ref.update(buildCtxRef, (ctx) => ({
      ...ctx,
      changeOutputs: [changeOutput]
    }))
    return { next: "feeCalculation" as const }
  })

  /**
   * Helper: Create unfracked change outputs (multiple outputs)
   * Only called when unfrack option is enabled.
   * Returns change outputs array or undefined if unfrack is not viable.
   *
   * @param leftoverAfterFee - Tentative leftover calculated with previous fee estimate
   * @param ctx - Transaction context data
   * @returns ReadonlyArray<TxOutput> or undefined if not viable
   */
  const createChangeOutputs = (
    leftoverAfterFee: Assets.Assets,
    ctx: TxContextData
  ): Effect.Effect<
    ReadonlyArray<UTxO.TxOutput>,
    TransactionBuilderError
  > =>
    Effect.gen(function* () {
      // Empty leftover = no change needed
      if (Assets.isEmpty(leftoverAfterFee)) {
        return []
      }

      // Create unfracked outputs with proper minUTxO calculation
      const unfrackOptions = ctx.options!.unfrack! // Safe: only called when unfrack is enabled
      
      const changeOutputs = yield* Unfrack.createUnfrackedChangeOutputs(
        ctx.config.changeAddress,
        leftoverAfterFee,
        unfrackOptions,
        ctx.config.protocolParameters.coinsPerUtxoByte
      ).pipe(
        Effect.mapError(
          (err) =>
            new TransactionBuilderError({
              message: `Failed to create unfracked change outputs: ${err.message}`,
              cause: err
            })
        )
      )

      yield* Effect.logDebug(
        `[ChangeCreationV2] Created ${changeOutputs.length} unfracked change outputs`
      )

      return changeOutputs
    })

  /**
   * V2 Phase 3: Fee Calculation
   */
  const phaseFeeCalculationV2 = Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
    const baseOutputs = yield* Ref.get(ctx.state.outputs)
    const inputs = yield* buildTransactionInputs(selectedUtxos)

    yield* Effect.logDebug(
      `[FeeCalculationV2] Starting fee calculation with ${baseOutputs.length} base outputs + ${buildCtx.changeOutputs.length} change outputs`
    )

    // Calculate fee WITH change outputs
    const allOutputs = [...baseOutputs, ...buildCtx.changeOutputs]
    const calculatedFee = yield* calculateFeeIteratively(selectedUtxos, inputs, allOutputs, {
      minFeeCoefficient: ctx.config.protocolParameters.minFeeCoefficient,
      minFeeConstant: ctx.config.protocolParameters.minFeeConstant
    })

    yield* Effect.logDebug(`[FeeCalculationV2] Calculated fee: ${calculatedFee}`)

    // Calculate leftover after fee NOW (after fee is known)
    const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
    const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)
    const leftoverBeforeFee = calculateLeftoverAssets(inputAssets, outputAssets)

    const leftoverAfterFee: Assets.Assets = {
      ...leftoverBeforeFee,
      lovelace: leftoverBeforeFee.lovelace - calculatedFee
    }

    // Store both fee and leftoverAfterFee in context
    yield* Ref.update(buildCtxRef, (ctx) => ({
      ...ctx,
      calculatedFee,
      leftoverAfterFee
    }))

    return { next: "balanceVerification" as const }
  })

  /**
   * V2 Phase 4: Balance Verification - Decides what to do next
   */
  const phaseBalanceVerificationV2 = Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    yield* Effect.logDebug(`[BalanceVerificationV2] Starting balance verification (attempt ${buildCtx.attempt})`)

    const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
    const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)

    // Calculate total output (outputs + change + fee)
    const changeTotal = buildCtx.changeOutputs.reduce(
      (sum, output) => sum + Assets.getAsset(output.assets, "lovelace"),
      0n
    )

    const totalOut = outputAssets.lovelace + changeTotal + buildCtx.calculatedFee
    const totalIn = inputAssets.lovelace
    const difference = totalOut - totalIn

    yield* Effect.logDebug(`[BalanceVerificationV2] In: ${totalIn}, Out: ${totalOut}, Diff: ${difference}`)

    // Balanced!
    if (difference === 0n) {
      yield* Effect.logDebug("[BalanceVerificationV2] Transaction balanced!")
      return { next: "complete" as const }
    }

    // Not balanced - decide strategy
    if (difference < 0n) {
      // Too much leftover (excess)
      const excessAmount = -difference

      // Get leftover assets after fee from context
      const leftoverAssets = buildCtx.leftoverAfterFee

      // Calculate actual minUTxO requirement for these assets
      const minUtxo = yield* calculateMinimumUtxoLovelace({
        address: ctx.config.changeAddress,
        assets: leftoverAssets,
        coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte
      })

      yield* Effect.logDebug(`[BalanceVerificationV2] Excess: ${excessAmount}, MinUTxO: ${minUtxo} for leftover`)

      // If excess is less than minUTxO, can't create valid change output
      // Use drainTo to merge into existing output
      if (excessAmount < minUtxo && ctx.options?.drainTo !== undefined) {
        // MANDATORY: drainTo ONLY works with ADA-only leftover
        const hasNativeAssets = Object.keys(leftoverAssets).some((k) => k !== "lovelace")
        if (hasNativeAssets) {
          return yield* Effect.fail(
            new TransactionBuilderError({
              message: `drainTo cannot be used with native assets in leftover. Use change output or unfrack instead.`
            })
          )
        }
        yield* Effect.logDebug(`[BalanceVerificationV2] Excess < minUTxO, using drainTo`)
        return { next: "drainTo" as const }
      }

      // If excess is too small and burn is explicitly allowed
      if (excessAmount < minUtxo && ctx.options?.onInsufficientChange === "burn") {
        yield* Effect.logDebug(`[BalanceVerificationV2] Excess < minUTxO, burning as fee`)
        return { next: "burnAsFee" as const }
      }

      // If excess is too small but no fallback configured, fail
      if (excessAmount < minUtxo) {
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              `Change output insufficient: ${excessAmount} lovelace < ${minUtxo} minUTxO. ` +
              `Configure drainTo to merge with an existing output, or set onInsufficientChange: 'burn' ` +
              `to explicitly allow burning as extra fee.`,
            cause: { excessAmount: excessAmount.toString(), minUtxo: minUtxo.toString() }
          })
        )
      }

      // Otherwise recreate change with correct amount
      yield* Effect.logDebug(`[BalanceVerificationV2] Excess >= minUTxO, recreating change`)
      return { next: "changeCreation" as const }
    }

    // Short on lovelace (difference > 0)

    // Strategy 1: Try reselection if attempts remaining
    if (buildCtx.attempt < MAX_RESELECTION_ATTEMPTS) {
      yield* Effect.logDebug(`[BalanceVerificationV2] Shortfall: ${difference}, triggering reselection`)
      yield* Ref.update(buildCtxRef, (ctx) => ({ ...ctx, shortfall: difference }))
      return { next: "selection" as const }
    }

    // Attempts exhausted - try fallbacks

    // Strategy 2: DrainTo if configured
    if (ctx.options?.drainTo !== undefined) {
      // MANDATORY: drainTo ONLY works with ADA-only leftover
      const leftoverAssets = buildCtx.leftoverAfterFee
      const hasNativeAssets = Object.keys(leftoverAssets).some((k) => k !== "lovelace")
      if (hasNativeAssets) {
        return yield* Effect.fail(
          new TransactionBuilderError({
            message: `drainTo cannot be used with native assets in leftover. Use change output or unfrack instead.`
          })
        )
      }
      yield* Effect.logDebug("[BalanceVerificationV2] Attempts exhausted, trying drainTo")
      return { next: "drainTo" as const }
    }

    // Strategy 3: Burn as fee (TODO: add allowBurnAsFee to BuildOptions)
    // if (ctx.options?.allowBurnAsFee && difference < 10_000n) {
    //   yield* Effect.logDebug("[BalanceVerificationV2] Attempts exhausted, burning as fee")
    //   return { next: "burnAsFee" as const }
    // }

    // No fallbacks available
    return yield* Effect.fail(
      new TransactionBuilderError({
        message: `Cannot balance transaction after ${buildCtx.attempt} attempts`,
        cause: { shortfall: difference.toString(), noFallbacksAvailable: true }
      })
    )
  })

  /**
   * V2 Phase 5: DrainTo Fallback
   */
  const phaseDrainToV2 = Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    yield* Effect.logDebug(`[DrainToV2] Starting drainTo fallback (attempt ${buildCtx.attempt})`)

    const drainToIndex = ctx.options?.drainTo
    if (drainToIndex === undefined) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message: "drainTo index not configured"
        })
      )
    }
    const baseOutputs = yield* Ref.get(ctx.state.outputs)
    const targetOutput = baseOutputs[drainToIndex]

    if (!targetOutput) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message: `drainTo index ${drainToIndex} out of bounds`
        })
      )
    }

    // Get leftover after fee from context
    const leftoverAfterFee = buildCtx.leftoverAfterFee

    // MANDATORY: drainTo ONLY works with ADA-only leftover
    // Native assets would increase CBOR size -> fee increase -> potential imbalance
    const hasNativeAssets = Object.keys(leftoverAfterFee).some((k) => k !== "lovelace")
    if (hasNativeAssets) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message: `drainTo cannot be used with native assets in leftover. Use change output or unfrack instead.`
        })
      )
    }

    // Merge leftover into target output
    const mergedAssets = Assets.add(targetOutput.assets, leftoverAfterFee)

    const mergedOutput: UTxO.TxOutput = {
      ...targetOutput,
      assets: mergedAssets
    }

    // SAFETY CHECK: Validate merged output meets minUTxO requirement
    // This is critical - the old implementation validates this 3 times!
    const mergedMinUtxo = yield* calculateMinimumUtxoLovelace({
      address: mergedOutput.address,
      assets: mergedAssets,
      datum: mergedOutput.datumOption,
      scriptRef: mergedOutput.scriptRef,
      coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte
    })

    const mergedLovelace = Assets.getAsset(mergedAssets, "lovelace")

    yield* Effect.logDebug(
      `[DrainToV2] Merged output validation: ${mergedLovelace} lovelace ` + `(minUTxO: ${mergedMinUtxo})`
    )

    if (mergedLovelace < mergedMinUtxo) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message:
            `drainTo validation failed: Merged output at index ${drainToIndex} ` +
            `has ${mergedLovelace} lovelace but requires minimum ${mergedMinUtxo}. ` +
            `The target output has too many assets to absorb the leftover. ` +
            `Consider using a different drainTo target or adding more funds.`,
          cause: {
            drainToIndex,
            mergedLovelace: mergedLovelace.toString(),
            requiredMinUtxo: mergedMinUtxo.toString()
          }
        })
      )
    }

    // Update outputs
    yield* Ref.update(ctx.state.outputs, (outputs) => outputs.map((o, i) => (i === drainToIndex ? mergedOutput : o)))

    // Clear change outputs
    yield* Ref.update(buildCtxRef, (ctx) => ({ ...ctx, changeOutputs: [] }))

    yield* Effect.logDebug(`[DrainToV2] Successfully merged leftover (validated: ${mergedLovelace} >= ${mergedMinUtxo})`)
    return { next: "complete" as const }
  })

  /**
   * V2 Phase 6: BurnAsFee Fallback
   */
  const phaseBurnAsFeeV2 = Effect.gen(function* () {
    const buildCtxRef = yield* BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    // Get leftover after fee from context
    const leftoverAfterFee = buildCtx.leftoverAfterFee

    // SAFETY CHECK: Cannot burn leftover when native assets present
    // Native assets can only be transferred to outputs (ledger rules enforce this)
    // Attempting to burn without including them in outputs would result in a rejected transaction
    const hasNativeAssets = Object.keys(leftoverAfterFee).some((k) => k !== "lovelace")
    if (hasNativeAssets) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message:
            `Cannot burn leftover as fee: Native assets present and must be transferred to outputs. ` +
            `Leftover contains: ${JSON.stringify(leftoverAfterFee)}. ` +
            `Transaction would be rejected by ledger. ` +
            `Use change output, drainTo, or unfrack to preserve native assets.`
        })
      )
    }

    yield* Effect.logDebug(
      `[BurnAsFeeV2] Burning ${leftoverAfterFee.lovelace} lovelace as extra fee ` + `(below minUTxO, no native assets)`
    )

    // Just accept the higher fee, no adjustment needed
    return { next: "complete" as const }
  })

  // ============================================================================
  // END V2 IMPLEMENTATION
  // ============================================================================

  /**
   * Helper: Calculate leftover assets (inputs - outputs)
   */
  const calculateLeftoverAssets = (
    inputAssets: Record<string, bigint>,
    outputAssets: Record<string, bigint>
  ): Assets.Assets => {
    const leftover: Assets.Assets = { ...inputAssets, lovelace: inputAssets.lovelace || 0n }
    for (const [unit, amount] of Object.entries(outputAssets)) {
      const current = leftover[unit] || 0n
      const remaining = current - (amount as bigint)
      if (remaining > 0n) {
        leftover[unit] = remaining
      } else {
        delete leftover[unit]
      }
    }
    return leftover
  }

  // ============================================================================
  // Coin Selection Helper Functions
  // ============================================================================

  /**
   * Get UTxOs that haven't been selected yet.
   * Uses Set for O(1) lookup instead of O(n) for better performance.
   */
  const getAvailableUtxos = (
    allUtxos: ReadonlyArray<UTxO.UTxO>,
    selectedUtxos: ReadonlyArray<UTxO.UTxO>
  ): ReadonlyArray<UTxO.UTxO> => {
    const selectedKeys = new Set(selectedUtxos.map((u) => `${u.txHash}:${u.outputIndex}`))
    return allUtxos.filter((utxo) => !selectedKeys.has(`${utxo.txHash}:${utxo.outputIndex}`))
  }

  /**
   * Resolve coin selection function from options.
   * Returns the configured algorithm or defaults to largest-first.
   */
  const resolveCoinSelectionFn = (
    coinSelection?: CoinSelectionAlgorithm | CoinSelectionFunction
  ): CoinSelectionFunction => {
    if (!coinSelection) return largestFirstSelection
    if (typeof coinSelection === "function") return coinSelection
    return getCoinSelectionAlgorithm(coinSelection)
  }

  /**
   * Add selected UTxOs to transaction context state.
   * Updates both the selected UTxOs list and total input assets.
   */
  const addUtxosToState = (selectedUtxos: ReadonlyArray<UTxO.UTxO>): Effect.Effect<void, never, TxContext> =>
    Effect.gen(function* () {
      const ctx = yield* TxContext

      // Log each UTxO being added
      for (const utxo of selectedUtxos) {
        const txHash = utxo.txHash
        const outputIndex = utxo.outputIndex
        yield* Effect.logDebug(`[Selection] Adding UTxO: ${txHash}#${outputIndex}, ${formatAssetsForLog(utxo.assets)}.`)
      }

      // Add to selected UTxOs list
      yield* Ref.update(ctx.state.selectedUtxos, (current) => [...current, ...selectedUtxos])

      // Calculate total assets from selected UTxOs and add to input assets
      const additionalAssets = calculateTotalAssets(selectedUtxos)
      yield* Ref.update(ctx.state.totalInputAssets, (current) => {
        return Assets.add(current, additionalAssets)
      })
    })

  /**
   * Helper: Perform coin selection and update TxContext.state
   */
  const performCoinSelectionUpdateState = (assetShortfalls: Assets.Assets) =>
    Effect.gen(function* () {
      const ctx = yield* TxContext
      const alreadySelected = yield* Ref.get(ctx.state.selectedUtxos)

      const availableUtxos = getAvailableUtxos(ctx.config.availableUtxos, alreadySelected)
      const coinSelectionFn = resolveCoinSelectionFn(ctx.options?.coinSelection)

      const { selectedUtxos } = yield* Effect.try({
        try: () => coinSelectionFn(availableUtxos, assetShortfalls),
        catch: (error) => {
          // Custom serialization for Assets (handles BigInt)
          return new TransactionBuilderError({
            message: `Coin selection failed for ${formatAssetsForLog(assetShortfalls)}`,
            cause: error
          })
        }
      })

      yield* addUtxosToState(selectedUtxos)
    })

  // ============================================================================
  // End of State Machine V2 Implementation
  // ============================================================================

  // ============================================================================
  // V3 State Machine Implementation - Mathematical Validation Approach
  // ============================================================================

  /**
   * V3 Build phases
   */
  type V3Phase = "selection" | "changeCreation" | "feeCalculation" | "balance" | "fallback" | "complete"

  /**
   * V3 BuildContext - state machine context
   */
  interface V3BuildContext {
    readonly phase: V3Phase
    readonly attempt: number
    readonly calculatedFee: bigint
    readonly shortfall: bigint
    readonly changeOutputs: ReadonlyArray<UTxO.TxOutput>
    readonly leftoverAfterFee: Assets.Assets
    readonly canUnfrack: boolean
  }

  /**
   * V3 BuildContext Tag for Effect Context
   */
  const V3BuildContextTag = Context.GenericTag<Ref.Ref<V3BuildContext>>("V3BuildContext")

  /**
   * V3 Phase result
   */
  interface V3PhaseResult {
    readonly next: V3Phase
  }

  // ============================================================================
  // V3 PHASE: Selection
  // ============================================================================

  const phaseSelectionV3 = Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* V3BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
    const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)

    // Step 3: Calculate total needed (outputs + shortfall)
    // Shortfall contains fee + any missing lovelace for change outputs
    const totalNeeded: Assets.Assets = {
      ...outputAssets,
      lovelace: outputAssets.lovelace + buildCtx.shortfall
    }

    // Step 4: Calculate asset delta & extract shortfalls
    const assetDelta = Assets.subtract(totalNeeded, inputAssets)
    const assetShortfalls = Assets.filter(assetDelta, (_unit, amount) => amount > 0n)
    
    // During reselection (shortfall > 0), we need to select MORE lovelace
    // even if inputAssets >= totalNeeded, because the shortfall indicates
    // insufficient lovelace for change output minUTxO requirement
    const isReselection = buildCtx.shortfall > 0n
    const needsSelection = !Assets.isEmpty(assetShortfalls) || isReselection

    yield* Effect.logDebug(
      `[SelectionV3] Needed: {${formatAssetsForLog(totalNeeded)}}, ` +
        `Available: {${formatAssetsForLog(inputAssets)}}, ` +
        `Delta: {${formatAssetsForLog(assetDelta)}}` +
        (isReselection ? `, Reselection: shortfall=${buildCtx.shortfall}` : "")
    )

    // Step 5: Perform selection or skip
    if (!needsSelection) {
      yield* Effect.logDebug("[SelectionV3] Assets sufficient")
      const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
      yield* Effect.logDebug(
        `[SelectionV3] No selection needed: ${selectedUtxos.length} UTxO(s) already available from explicit inputs (collectFrom), ` +
          `Total lovelace: ${inputAssets.lovelace || 0n}`
      )
    } else {
      if (isReselection) {
        yield* Effect.logDebug(
          `[SelectionV3] Reselection attempt ${buildCtx.attempt + 1}: ` +
            `Need ${buildCtx.shortfall} more lovelace for change minUTxO`
        )
        // During reselection, select for the shortfall amount only
        const reselectionShortfall: Assets.Assets = { lovelace: buildCtx.shortfall }
        yield* performCoinSelectionUpdateState(reselectionShortfall)
      } else {
        yield* Effect.logDebug(`[SelectionV3] Selecting for shortfall: ${formatAssetsForLog(assetShortfalls)}`)
        yield* performCoinSelectionUpdateState(assetShortfalls)
      }
    }

    // Step 6: Update context and proceed
    yield* Ref.update(buildCtxRef, (ctx) => ({ ...ctx, attempt: ctx.attempt + 1, shortfall: 0n }))

    return { next: "changeCreation" as V3Phase }
  })

  // ============================================================================
  // V3 PHASE: Change Creation
  // ============================================================================
  
  /**
   * V3 Change Creation Phase
   * 
   * Creates change outputs from leftover assets using a cascading retry strategy.
   * Both unfrack (N outputs) and single output follow the same retry pattern:
   * try with available funds → if insufficient, reselect (up to MAX_ATTEMPTS) → fallback.
   * 
   * **Symmetric Retry Flow (Unfrack vs Single Output):**
   * ```
   * UNFRACK (N outputs)                    SINGLE OUTPUT (1 output)
   * ─────────────────────────────────────────────────────────────────
   * 
   * Try: Create N outputs                  Try: Create 1 output
   * ↓                                      ↓
   * Check: leftover >= (minUTxO × N)?      Check: leftover >= minUTxO?
   * ↓                                      ↓
   * If NO (not affordable):                If NO (insufficient):
   *   ├─ attempt < MAX? → Reselect           ├─ attempt < MAX? → Reselect
   *   └─ attempt >= MAX? → Fallback          └─ attempt >= MAX? → Fallback
   *                                                               ↓
   * Fallback:                              Fallback:
   *   └─ Single output                       ├─ drainTo (merge into output)
   *       ├─ (retry/fallback)                ├─ burn (leftover → fee)
   *       └─ ...                             └─ error
   * ```
   * 
   * **Detailed Flow:**
   * ```
   * 1. Calculate tentative leftover (inputs - outputs - contextFee)
   * 
   * 2. If unfrack enabled and canUnfrack=true:
   *    → Try createUnfrackedChangeOutputs() (N outputs)
   *    → Success: store N outputs, goto FeeCalculation
   *    → Not affordable:
   *       ├─ If attempt < MAX_ATTEMPTS: reselect (add more UTxOs)
   *       └─ If attempt >= MAX_ATTEMPTS: canUnfrack=false, goto step 3
   * 
   * 3. Single output approach:
   *    → Create 1 change output with leftover
   *    → Success: store 1 output, goto FeeCalculation
   *    → Not affordable:
   *       ├─ If attempt < MAX_ATTEMPTS: reselect (add more UTxOs)
   *       └─ If attempt >= MAX_ATTEMPTS: goto step 4
   * 
   * 4. Insufficient change fallbacks (single-output only):
   *    a. If drainTo specified: merge into existing output
   *    b. If onInsufficientChange="burn": leftover becomes fee
   *    c. If onInsufficientChange="error": throw error
   * ```
   * 
   * **Key Principles:**
   * - Unfrack and single output use SAME retry mechanism (reselection up to MAX_ATTEMPTS)
   * - Phase loop handles fee convergence (leftover recalculated each iteration)
   * - Last subdivision output absorbs remainder for exact balance
   * - canUnfrack flag prevents retry loops (once false, stays false)
   * - drainTo and burn are terminal fallbacks (single-output only)
   * - Unfrack outputs bypass drainTo/burn (they're already valid)
   * 
   * @returns Next phase to transition to
   */
  const phaseChangeCreationV3 = Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* V3BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    yield* Effect.logDebug(`[ChangeCreationV3] Fee from context: ${buildCtx.calculatedFee}`)

    // Step 2: Calculate leftover assets
    const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
    const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)
    const leftoverBeforeFee = Assets.subtract(inputAssets, outputAssets)

    const tentativeLeftover: Assets.Assets = {
      ...leftoverBeforeFee,
      lovelace: leftoverBeforeFee.lovelace - buildCtx.calculatedFee
    }

    // Step 3: Check if negative - return to selection immediately
    // TODO: Verify this scenario is tested - negative tentativeLeftover on attempt > 0
    if (tentativeLeftover.lovelace < 0n) {
      const shortfall = -tentativeLeftover.lovelace

      yield* Effect.logDebug(
        `[ChangeCreationV3] Insufficient lovelace for fee: ${tentativeLeftover.lovelace}. ` +
          `Shortfall: ${shortfall}. Returning to selection.`
      )

      yield* Ref.update(buildCtxRef, (ctx) => ({
        ...ctx,
        shortfall,
        changeOutputs: []
      }))
      return { next: "selection" as V3Phase }
    }

    // Step 4: Affordability check - verify minimum (single output) is affordable
    // This pre-flight check ensures we can create at least one valid change output
    // before attempting any unfrack strategies
    const minLovelaceForSingle = yield* calculateMinimumUtxoLovelace({
      address: ctx.config.changeAddress,
      assets: tentativeLeftover,
      coinsPerUtxoByte: ctx.config.protocolParameters.coinsPerUtxoByte
    })

    if (tentativeLeftover.lovelace < minLovelaceForSingle) {
      // Not even affordable for single output - trigger reselection
      const shortfall = minLovelaceForSingle - tentativeLeftover.lovelace
      const buildCtx = yield* Ref.get(buildCtxRef)
      const MAX_ATTEMPTS = 3

      // Check if leftover is ADA-only (no native assets)
      const isAdaOnlyLeftover = Object.keys(tentativeLeftover).length === 1 // Only "lovelace" key

      // Check if we have available UTxOs for reselection
      const alreadySelected = yield* Ref.get(ctx.state.selectedUtxos)
      const availableUtxos = getAvailableUtxos(ctx.config.availableUtxos, alreadySelected)
      const hasMoreUtxos = availableUtxos.length > 0

      // Try reselection up to MAX_ATTEMPTS (if UTxOs available)
      if (hasMoreUtxos && buildCtx.attempt < MAX_ATTEMPTS) {
        yield* Effect.logDebug(
          `[ChangeCreationV3] Leftover ${tentativeLeftover.lovelace} < ${minLovelaceForSingle} minUTxO ` +
            `(shortfall: ${shortfall}${isAdaOnlyLeftover ? ", ADA-only" : ", with native assets"}). ` +
            `Attempting reselection (${buildCtx.attempt + 1}/${MAX_ATTEMPTS})`
        )

        yield* Ref.update(buildCtxRef, (ctx) => ({
          ...ctx,
          shortfall,
          changeOutputs: []
        }))

        return { next: "selection" as V3Phase }
      }

      // No more UTxOs OR MAX_ATTEMPTS exhausted - check fallback options
      yield* Effect.logDebug(
        `[ChangeCreationV3] Cannot reselect: ${!hasMoreUtxos ? "No more UTxOs available" : `MAX_ATTEMPTS (${MAX_ATTEMPTS}) exhausted`}. ` +
          `Leftover (before fee): ${formatAssetsForLog(tentativeLeftover)}, minUTxO: ${minLovelaceForSingle}`
      )

      // CASE 1: Native assets present - cannot use drain/burn fallback
      if (!isAdaOnlyLeftover) {
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              `Cannot balance transaction: Native assets present in leftover ` +
              `but insufficient lovelace (${tentativeLeftover.lovelace} < ${minLovelaceForSingle} minUTxO) ` +
              `after ${buildCtx.attempt} selection attempts.\n\n` +
              `Your leftover includes native assets (tokens) which require at least ` +
              `${minLovelaceForSingle} lovelace to create a valid change output, but only ` +
              `${tentativeLeftover.lovelace} lovelace remains.\n\n` +
              `Solutions:\n` +
              `1. Include the native assets in your payment outputs\n` +
              `2. Add more lovelace to your wallet\n` +
              `3. Use fewer/smaller outputs to reduce fees`,
            cause: undefined
          })
        )
      }

      // CASE 2: ADA-only leftover - check if fallback strategies are configured
      const hasFallbackStrategy = ctx.options?.drainTo !== undefined || ctx.options?.onInsufficientChange === "burn"

      if (!hasFallbackStrategy) {
        // No fallback configured - fail with clear user-facing error
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              `Cannot create valid change: Insufficient funds to cover payment, fees, and minimum UTxO requirements.\n\n` +
              `Available: ${tentativeLeftover.lovelace} lovelace\n` +
              `Required: At least ${minLovelaceForSingle} lovelace for change output\n\n` +
              `Solutions:\n` +
              `1. Add more funds to your wallet\n` +
              `2. Reduce payment amounts or number of outputs\n` +
              `3. Use drainTo(index) to merge leftover with an existing output\n` +
              `4. Use onInsufficientChange: 'burn' to explicitly burn leftover as extra fee`,
            cause: undefined
          })
        )
      }

      // Fallback strategies configured - proceed to Fallback phase
      return { next: "fallback" as V3Phase }
    }

    // Step 5: Unfrack path (single output IS affordable, try bundles/subdivision)
    if (ctx.options?.unfrack && buildCtx.canUnfrack) {
      const changeOutputs = yield* createChangeOutputs(tentativeLeftover, ctx)

      yield* Effect.logDebug(`[ChangeCreationV3] Successfully created ${changeOutputs.length} unfracked outputs`)

      // Store outputs and proceed to fee calculation
      yield* Ref.update(buildCtxRef, (ctx) => ({
        ...ctx,
        changeOutputs
      }))
      return { next: "feeCalculation" as V3Phase }
    }

    // Step 6: Single output path - create single change output
    // Affordability already verified in Step 4, so we can create output directly
    const singleOutput: UTxO.TxOutput = {
      address: ctx.config.changeAddress,
      assets: tentativeLeftover,
      datumOption: undefined,
      scriptRef: undefined
    }

    yield* Ref.update(buildCtxRef, (ctx) => ({
      ...ctx,
      changeOutputs: [singleOutput]
    }))

    return { next: "feeCalculation" as V3Phase }
  })

  // ============================================================================
  // V3 PHASE: Fee Calculation
  // ============================================================================

  const phaseFeeCalculationV3 = Effect.gen(function* () {
    // Step 1: Get contexts and current state
    const ctx = yield* TxContext
    const buildCtxRef = yield* V3BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
    const baseOutputs = yield* Ref.get(ctx.state.outputs)

    // Step 2: Build transaction inputs
    const inputs = yield* buildTransactionInputs(selectedUtxos)

    // Step 3: Combine base outputs + change outputs
    yield* Effect.logDebug(
      `[FeeCalculationV3] Starting fee calculation with ${baseOutputs.length} base outputs + ${buildCtx.changeOutputs.length} change outputs`
    )

    const allOutputs = [...baseOutputs, ...buildCtx.changeOutputs]

    // Step 4: Calculate fee WITH change outputs
    const calculatedFee = yield* calculateFeeIteratively(selectedUtxos, inputs, allOutputs, {
      minFeeCoefficient: ctx.config.protocolParameters.minFeeCoefficient,
      minFeeConstant: ctx.config.protocolParameters.minFeeConstant
    })

    yield* Effect.logDebug(`[FeeCalculationV3] Calculated fee: ${calculatedFee}`)

    // Step 5: Calculate leftover after fee NOW (after fee is known)
    const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
    const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)
    const leftoverBeforeFee = Assets.subtract(inputAssets, outputAssets)

    const leftoverAfterFee: Assets.Assets = {
      ...leftoverBeforeFee,
      lovelace: leftoverBeforeFee.lovelace - calculatedFee
    }

    // Step 6: Store both fee and leftoverAfterFee in context
    yield* Ref.update(buildCtxRef, (ctx) => ({
      ...ctx,
      calculatedFee,
      leftoverAfterFee
    }))

    return { next: "balance" as V3Phase }
  })

  // ============================================================================
  // V3 PHASE: Balance Verification
  // ============================================================================

  const phaseBalanceV3 = Effect.gen(function* () {
    // Step 1: Get contexts and log start
    const ctx = yield* TxContext
    const buildCtxRef = yield* V3BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    yield* Effect.logDebug(`[BalanceV3] Starting balance verification (attempt ${buildCtx.attempt})`)

    // Step 2: Calculate delta = inputs - outputs - change - fee
    const inputAssets = yield* Ref.get(ctx.state.totalInputAssets)
    const outputAssets = yield* Ref.get(ctx.state.totalOutputAssets)

    // Calculate total change assets
    const changeAssets = buildCtx.changeOutputs.reduce((acc, output) => Assets.merge(acc, output.assets), {
      lovelace: 0n
    } as Assets.Assets)

    // Delta = inputs - outputs - change - fee
    let delta = Assets.subtract(inputAssets, outputAssets)
    delta = Assets.subtract(delta, changeAssets)
    delta = { ...delta, lovelace: delta.lovelace - buildCtx.calculatedFee }

    // Check if balanced: lovelace must be exactly 0 and all native assets must be 0
    const isBalanced = delta.lovelace === 0n

    yield* Effect.logDebug(
      `[BalanceV3] Inputs: ${formatAssetsForLog(inputAssets)}, ` +
        `Outputs: ${formatAssetsForLog(outputAssets)}, ` +
        `Change: ${formatAssetsForLog(changeAssets)}, ` +
        `Fee: ${buildCtx.calculatedFee}, ` +
        `Delta: ${formatAssetsForLog(delta)}, ` +
        `Balanced: ${isBalanced}`
    )

    // Step 3: Check if balanced (delta is empty) → complete
    if (isBalanced) {
      yield* Effect.logDebug("[BalanceV3] Transaction balanced!")
      return { next: "complete" as V3Phase }
    }

    // Step 4: Not balanced - check for native assets in delta (shouldn't happen)
    const hasNativeAssets = Object.keys(delta).some((key) => key !== "lovelace")
    if (hasNativeAssets) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message: `Balance verification failed: Delta contains native assets. This indicates a bug in change creation logic.`,
          cause: { delta: formatAssetsForLog(delta) }
        })
      )
    }

    // Step 5: Handle imbalance (excess or shortfall)
    const deltaLovelace = delta.lovelace

    // Excess: inputs > outputs + change + fee
    // This should NEVER happen with V3's Option B design, EXCEPT:
    // - Burn strategy: Positive delta is the burned leftover (expected and correct!)
    // - ChangeCreation creates change = tentativeLeftover (when sufficient)
    // - ChangeCreation routes to selection (when insufficient, never returns empty)
    // - Balance should only see: delta = 0 (balanced) or delta < 0 (shortfall) or delta > 0 (burn mode)
    
    if (deltaLovelace > 0n) {
      // Check if this is expected from burn strategy
      const isBurnMode = ctx.options?.onInsufficientChange === "burn" && buildCtx.changeOutputs.length === 0
      
      // Check if this is expected from drainTo strategy
      const isDrainToMode = ctx.options?.drainTo !== undefined && buildCtx.changeOutputs.length === 0
      
      if (isDrainToMode) {
        // DrainTo mode: Merge positive delta (leftover after fee) into target output
        const drainToIndex = ctx.options.drainTo!
        const outputs = yield* Ref.get(ctx.state.outputs)
        
        // Validate drainTo index (should already be validated in Fallback, but double-check)
        if (drainToIndex < 0 || drainToIndex >= outputs.length) {
          return yield* Effect.fail(
            new TransactionBuilderError({
              message: `[V3 Balance] Invalid drainTo index: ${drainToIndex}. Must be between 0 and ${outputs.length - 1}`,
              cause: { drainToIndex, outputCount: outputs.length }
            })
          )
        }
        
        // Merge delta into target output
        const targetOutput = outputs[drainToIndex]
        const newLovelace = targetOutput.assets.lovelace + deltaLovelace
        const newAssets = { ...targetOutput.assets, lovelace: newLovelace }
        const updatedOutput = { ...targetOutput, assets: newAssets }
        
        // Update outputs
        const newOutputs = [...outputs]
        newOutputs[drainToIndex] = updatedOutput
        yield* Ref.set(ctx.state.outputs, newOutputs)
        
        // Recalculate totalOutputAssets
        const newTotalOutputAssets = newOutputs.reduce(
          (acc, output) => Assets.merge(acc, output.assets),
          { lovelace: 0n } as Assets.Assets
        )
        yield* Ref.set(ctx.state.totalOutputAssets, newTotalOutputAssets)
        
        yield* Effect.logDebug(
          `[BalanceV3] DrainTo mode: Merged ${deltaLovelace} lovelace into output[${drainToIndex}]. ` +
            `New output value: ${newLovelace}. Transaction balanced.`
        )
        return { next: "complete" as V3Phase }
      } else if (isBurnMode) {
        // Burn mode: Positive delta is the burned leftover (becomes implicit fee)
        yield* Effect.logDebug(
          `[BalanceV3] Burn mode: ${deltaLovelace} lovelace burned as implicit fee. ` +
            `Transaction balanced.`
        )
        return { next: "complete" as V3Phase }
      } else {
        // Not burn mode or drainTo: This is a bug
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              `[V3 Balance] CRITICAL BUG: Excess lovelace detected (${deltaLovelace}). ` +
              `V3's Option B design should never produce positive delta. ` +
              `This indicates incorrect change creation or fee calculation logic.`,
            cause: {
              delta: formatAssetsForLog(delta),
              attempt: buildCtx.attempt,
              calculatedFee: buildCtx.calculatedFee.toString(),
              changeOutputs: buildCtx.changeOutputs.length,
              totalInputs: formatAssetsForLog(inputAssets),
              totalOutputs: formatAssetsForLog(outputAssets),
              changeTotal: formatAssetsForLog(changeAssets)
            }
          })
        )
      }
    }

    // Shortfall: inputs < outputs + change + fee
    // Return to changeCreation to recreate change with correct fee
    // If leftover < minLovelace, changeCreation will trigger selection
    
    yield* Effect.logDebug(
      `[BalanceV3] Shortfall detected: ${-deltaLovelace} lovelace. ` +
        `Returning to changeCreation to adjust change output.`
    )

    return { next: "changeCreation" as V3Phase }
  })

  // ============================================================================
  // V3 PHASE: Fallback
  // ============================================================================
  // Handles insufficient change scenarios with drain or burn strategies.
  // This phase is reached after MAX_ATTEMPTS exhausted in ChangeCreation.
  // Only applies to ADA-only leftover (native assets cannot be drained/burned).
  // Note: ChangeCreation ensures only ADA-only cases reach this phase.

  const phaseFallbackV3 = Effect.gen(function* () {
    yield* Effect.logDebug("[V3] Phase: Fallback")

    const ctx = yield* TxContext
    const buildCtxRef = yield* V3BuildContextTag
    // Note: We don't merge the leftover here. Instead, we just clear change outputs
    // and let the balance phase handle the merge after fee calculation.
    // This avoids circular dependency: fee depends on outputs, but drain amount depends on fee.

    // ---------------------------------------------------------------
    // Strategy 1: drainTo - Merge leftover into existing output
    // ---------------------------------------------------------------

    if (ctx.options?.drainTo !== undefined) {
      // Validate drainTo index
      const outputs = yield* Ref.get(ctx.state.outputs)
      const drainToIndex = ctx.options.drainTo

      if (drainToIndex < 0 || drainToIndex >= outputs.length) {
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              `Invalid drainTo index: ${drainToIndex}. ` +
              `Transaction has ${outputs.length} output(s), valid indices are 0-${outputs.length - 1}.`,
            cause: {
              drainToIndex,
              totalOutputs: outputs.length
            }
          })
        )
      }

      // Clear change outputs - leftover will be merged in Balance phase
      yield* Ref.update(buildCtxRef, (ctx) => ({
        ...ctx,
        changeOutputs: []
      }))

      yield* Effect.logDebug(
        `[Fallback] DrainTo strategy: Change outputs cleared. ` +
          `Leftover will be merged into output[${drainToIndex}] after fee calculation.`
      )

      // Go to fee calculation to recalculate without change outputs
      return { next: "feeCalculation" as V3Phase }
    }

    // ---------------------------------------------------------------
    // Strategy 2: burn - Allow leftover as implicit fee
    // ---------------------------------------------------------------

    if (ctx.options?.onInsufficientChange === "burn") {
      // Clear change outputs (leftover becomes part of fee)
      yield* Ref.update(buildCtxRef, (ctx) => ({
        ...ctx,
        changeOutputs: []
      }))

      yield* Effect.logDebug(
        `[Fallback] Burn strategy: Leftover will be burned as implicit fee ` +
          `(recalculating fee without change outputs).`
      )

      // Go to fee calculation to recalculate fee for transaction without change outputs
      return { next: "feeCalculation" as V3Phase }
    }

    // ---------------------------------------------------------------
    // Should never reach here
    // ---------------------------------------------------------------
    // ChangeCreation should only route to fallback if drainTo or burn is configured

    return yield* Effect.fail(
      new TransactionBuilderError({
        message:
          `[Fallback] CRITICAL BUG: Fallback phase reached without drainTo or burn configured. ` +
          `ChangeCreation should have prevented this.`,
        cause: {
          hasDrainTo: ctx.options?.drainTo !== undefined,
          hasOnInsufficientChange: ctx.options?.onInsufficientChange !== undefined
        }
      })
    )
  })

  // ============================================================================
  // V3 Main Build Loop
  // ============================================================================

  const buildEffectCoreV3 = (options?: BuildOptions) =>
    Effect.gen(function* () {
      const _ctx = yield* TxContext

      // 1. Execute all programs to populate state
      yield* Effect.all(programs, { concurrency: "unbounded" })

      // 2. Create initial V3 build context
      const initialBuildCtx: V3BuildContext = {
        phase: "selection" as const,
        attempt: 0,
        calculatedFee: 0n,
        shortfall: 0n,
        changeOutputs: [],
        leftoverAfterFee: { lovelace: 0n },
        canUnfrack: options?.unfrack !== undefined
      }

      const ctxRef = yield* Ref.make(initialBuildCtx)

      // 3. Run V3 state machine
      yield* Effect.gen(function* () {
        while (true) {
          const buildCtx = yield* Ref.get(ctxRef)

          // Terminal state
          if (buildCtx.phase === "complete") {
            break
          }

          // Route to phase
          let result: V3PhaseResult

          switch (buildCtx.phase) {
            case "selection": {
              result = yield* phaseSelectionV3
              break
            }

            case "changeCreation": {
              result = yield* phaseChangeCreationV3
              break
            }

            case "feeCalculation": {
              result = yield* phaseFeeCalculationV3
              break
            }

            case "balance": {
              result = yield* phaseBalanceV3
              break
            }

            case "fallback": {
              result = yield* phaseFallbackV3
              break
            }

            default:
              return yield* Effect.fail(
                new TransactionBuilderError({ message: `V3: Unknown phase: ${buildCtx.phase}` })
              )
          }

          // Update phase
          yield* Ref.update(ctxRef, (c) => ({ ...c, phase: result.next }))
        }
      }).pipe(Effect.provideService(V3BuildContextTag, ctxRef))

      // 4. Add change outputs to transaction and assemble
      const buildCtx = yield* Ref.get(ctxRef)
      const ctx = yield* TxContext

      yield* Effect.logDebug(`[V3] Build complete - fee: ${buildCtx.calculatedFee}`)

      // Add change outputs to the transaction outputs
      if (buildCtx.changeOutputs.length > 0) {
        const currentOutputs = yield* Ref.get(ctx.state.outputs)
        yield* Ref.set(ctx.state.outputs, [...currentOutputs, ...buildCtx.changeOutputs])

        yield* Effect.logDebug(`[V3] Added ${buildCtx.changeOutputs.length} change output(s) to transaction`)
      }

      // Get final inputs and outputs for transaction assembly
      const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
      const allOutputs = yield* Ref.get(ctx.state.outputs)

      yield* Effect.logDebug(
        `[V3] Assembling transaction: ${selectedUtxos.length} inputs, ${allOutputs.length} outputs, fee: ${buildCtx.calculatedFee}`
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

      yield* Effect.logDebug(
        `[V3] Transaction size: ${txSizeWithWitnesses} bytes ` +
          `(with ${fakeWitnessSet.vkeyWitnesses?.length ?? 0} fake witnesses), ` +
          `max=${ctx.config.protocolParameters.maxTxSize} bytes`
      )

      if (txSizeWithWitnesses > ctx.config.protocolParameters.maxTxSize) {
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              `Transaction size (${txSizeWithWitnesses} bytes) exceeds protocol maximum (${ctx.config.protocolParameters.maxTxSize} bytes). ` +
              `Consider splitting into multiple transactions.`
          })
        )
      }

      // Return SignBuilder with the assembled transaction
      const signBuilder: SignBuilder = {
        Effect: {
          sign: () => Effect.fail(new TransactionBuilderError({ message: "[V3] Signing not yet implemented" })),
          signWithWitness: () =>
            Effect.fail(new TransactionBuilderError({ message: "[V3] Witness signing not yet implemented" })),
          assemble: () => Effect.fail(new TransactionBuilderError({ message: "[V3] Assemble not yet implemented" })),
          partialSign: () =>
            Effect.fail(new TransactionBuilderError({ message: "[V3] Partial signing not yet implemented" })),
          getWitnessSet: () => Effect.succeed(transaction.witnessSet),
          toTransaction: () => Effect.succeed(transaction),
          toTransactionWithFakeWitnesses: () => Effect.succeed(txWithFakeWitnesses)
        },
        sign: () => Promise.reject(new Error("[V3] Signing not yet implemented")),
        signWithWitness: () => Promise.reject(new Error("[V3] Witness signing not yet implemented")),
        assemble: () => Promise.reject(new Error("[V3] Assemble not yet implemented")),
        partialSign: () => Promise.reject(new Error("[V3] Partial signing not yet implemented")),
        getWitnessSet: () => Promise.resolve(transaction.witnessSet),
        toTransaction: () => Promise.resolve(transaction),
        toTransactionWithFakeWitnesses: () => Promise.resolve(txWithFakeWitnesses)
      }

      return signBuilder
    }).pipe(
      Effect.provideServiceEffect(
        TxContext,
        Effect.gen(function* () {
          return {
            config,
            state: yield* createFreshState(),
            options: options ?? {}
          }
        })
      )
    )

  // ============================================================================
  // End of V3 State Machine Implementation
  // ============================================================================

  // Core Effect logic for chaining
  const chainEffectCore = (options?: BuildOptions) =>
    Effect.gen(function* () {
      // Chain logic: Execute programs and return intermediate state
      return {} as ChainResult
    }).pipe(
      Effect.provideServiceEffect(
        TxContext,
        Effect.gen(function* () {
          return {
            config,
            state: yield* createFreshState(),
            options: options ?? {}
          }
        })
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
  const buildPartialEffectCore = (options?: BuildOptions) =>
    Effect.gen(function* () {
      // Execute all programs
      yield* Effect.all(programs, { concurrency: "unbounded" })

      // Return partial transaction (without evaluation)
      return {} as Transaction.Transaction
    }).pipe(
      Effect.provideServiceEffect(
        TxContext,
        Effect.gen(function* () {
          return {
            config,
            state: yield* createFreshState(),
            options: options ?? {}
          }
        })
      ),
      Effect.mapError(
        (error) =>
          new TransactionBuilderError({
            message: "Partial build failed",
            cause: error
          })
      )
    )

  const txBuilder: TransactionBuilder = {
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
      if (options?.useV3) {
        return buildEffectCoreV3(options)
      }
      const buildFn = options?.useStateMachine ? buildEffectCoreStateMachineV2 : buildEffectCore
      return buildFn(options)
    },

    build: (options?: BuildOptions) => {
      if (options?.useV3) {
        return Effect.runPromise(
          buildEffectCoreV3(options).pipe(
            Effect.provide(Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug)))
          )
        )
      }
      const buildFn = options?.useStateMachine ? buildEffectCoreStateMachineV2 : buildEffectCore
      return Effect.runPromise(
        buildFn(options).pipe(Effect.provide(Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug))))
      )
    },

    buildEither: (options?: BuildOptions) => {
      if (options?.useV3) {
        return Effect.runPromise(
          buildEffectCoreV3(options).pipe(
            Effect.either,
            Effect.provide(Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug)))
          )
        )
      }
      const buildFn = options?.useStateMachine ? buildEffectCoreStateMachineV2 : buildEffectCore
      return Effect.runPromise(
        buildFn(options).pipe(
          Effect.either,
          Effect.provide(Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug)))
        )
      )
    },

    // ============================================================================
    // Transaction chaining methods
    // ============================================================================

    chainEffect: (options?: BuildOptions) => chainEffectCore(options),

    chain: (options?: BuildOptions) => Effect.runPromise(chainEffectCore(options)),

    chainEither: (options?: BuildOptions) => Effect.runPromise(chainEffectCore(options).pipe(Effect.either)),

    // ============================================================================
    // Debug methods - Execute with fresh state, return partial transaction
    // ============================================================================

    buildPartialEffect: (options?: BuildOptions) => buildPartialEffectCore(options),

    buildPartial: (options?: BuildOptions) => Effect.runPromise(buildPartialEffectCore(options))
  }

  return txBuilder
}

// ============================================================================
// Helper Functions - To be implemented
// ============================================================================

// Implementation functions are imported from TxBuilderImpl.js at top of file
