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
import type * as Provider from "../provider/Provider.js"
import type * as UTxO from "../UTxO.js"
import type * as WalletNew from "../wallet/WalletNew.js"
import type { CoinSelectionAlgorithm, CoinSelectionFunction } from "./CoinSelection.js"
import { largestFirstSelection } from "./CoinSelection.js"
import type { CollectFromParams, PayToAddressParams } from "./operations/Operations.js"
import type { SignBuilder } from "./SignBuilder.js"
import { makeSignBuilder } from "./SignBuilderImpl.js"
import { makeTransactionResult } from "./TransactionResult.js"
import {
  assembleTransaction,
  buildFakeWitnessSet,
  buildTransactionInputs,
  calculateFeeIteratively,
  calculateMinimumUtxoLovelace,
  calculateTotalAssets,
  calculateTransactionSize,
  createCollectFromProgram,
  createPayToAddressProgram
} from "./TxBuilderImpl.js"
import * as Unfrack from "./Unfrack.js"

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

  /**
   *
   * When true, uses simplified 4-phase state machine:
   * - selection → changeValidation → balanceVerification → fallback → complete
   *
   * shares TxContext with V2 but uses mathematical validation approach.
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
export interface TransactionBuilder<TResult = SignBuilder> {
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
  readonly payToAddress: (params: PayToAddressParams) => TransactionBuilder<TResult>

  /**
   * Specify transaction inputs from provided UTxOs.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly collectFrom: (params: CollectFromParams) => TransactionBuilder<TResult>

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
   * Returns TResult which is:
   * - SignBuilder for SigningClient (can sign transactions)
   * - TransactionResultBase for ReadOnlyClient (unsigned transaction only)
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly build: (options?: BuildOptions) => Promise<TResult>

  /**
   * Execute all queued operations and return a signing-ready transaction via Effect.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Suitable for Effect-TS compositional workflows and error handling.
   *
   * Error types include WalletError and ProviderError from config Effects.
   *
   * Returns TResult which is:
   * - SignBuilder for SigningClient (can sign transactions)
   * - TransactionResultBase for ReadOnlyClient (unsigned transaction only)
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEffect: (
    options?: BuildOptions
  ) => Effect.Effect<
    TResult,
    TransactionBuilderError | EvaluationError | WalletNew.WalletError | Provider.ProviderError,
    unknown
  >

  /**
   * Execute all queued operations with explicit error handling via Either.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Returns Either<TResult, Error> for pattern-matched error recovery.
   *
   * Error types include WalletError and ProviderError from config Effects.
   *
   * Returns TResult which is:
   * - SignBuilder for SigningClient (can sign transactions)
   * - TransactionResultBase for ReadOnlyClient (unsigned transaction only)
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEither: (
    options?: BuildOptions
  ) => Promise<
    Either<TResult, TransactionBuilderError | EvaluationError | WalletNew.WalletError | Provider.ProviderError>
  >

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
 * Generic type parameter TResult determines what build() returns:
 * - SignBuilder (default): When wallet has signing capability
 * - TransactionResultBase: When wallet is read-only
 *
 * @typeParam TResult - The result type for build() methods (SignBuilder or TransactionResultBase)
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeTxBuilder = <TResult = SignBuilder>(config: TxBuilderConfig): TransactionBuilder<TResult> => {
  // Protocol parameters validation is deferred to build time when they are resolved
  // (from BuildOptions > config > provider)

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

  /**
   * Helper: Format assets for logging (BigInt-safe, truncates long unit names)
   */
  const formatAssetsForLog = (assets: Assets.Assets): string => {
    return Object.entries(assets)
      .map(([unit, amount]) => `${unit.substring(0, 16)}...: ${amount.toString()}`)
      .join(", ")
  }

  /**
   * Helper: Create unfracked change outputs (multiple outputs)
   * Only called when unfrack option is enabled.
   * Returns change outputs array or undefined if unfrack is not viable.
   *
   * @param leftoverAfterFee - Tentative leftover calculated with previous fee estimate
   * @param ctx - Transaction context data
   * @param changeAddress - Resolved change address for this build
   * @returns ReadonlyArray<TxOutput> or undefined if not viable
   */
  const createChangeOutputs = (
    leftoverAfterFee: Assets.Assets,
    ctx: TxContextData,
    changeAddress: string,
    coinsPerUtxoByte: bigint
  ): Effect.Effect<ReadonlyArray<UTxO.TxOutput>, TransactionBuilderError> =>
    Effect.gen(function* () {
      // Empty leftover = no change needed
      if (Assets.isEmpty(leftoverAfterFee)) {
        return []
      }

      // Create unfracked outputs with proper minUTxO calculation
      const unfrackOptions = ctx.options!.unfrack! // Safe: only called when unfrack is enabled

      const changeOutputs = yield* Unfrack.createUnfrackedChangeOutputs(
        changeAddress,
        leftoverAfterFee,
        unfrackOptions,
        coinsPerUtxoByte
      ).pipe(
        Effect.mapError(
          (err) =>
            new TransactionBuilderError({
              message: `Failed to create unfracked change outputs: ${err.message}`,
              cause: err
            })
        )
      )

      yield* Effect.logDebug(`[ChangeCreationV2] Created ${changeOutputs.length} unfracked change outputs`)

      return changeOutputs
    })

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

      // Get resolved availableUtxos from context tag
      const allAvailableUtxos = yield* AvailableUtxosTag
      const availableUtxos = getAvailableUtxos(allAvailableUtxos, alreadySelected)
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
  // State Machine Implementation - Mathematical Validation Approach
  // ============================================================================

  /**
   * Build phases
   */
  type Phase = "selection" | "changeCreation" | "feeCalculation" | "balance" | "fallback" | "complete"

  /**
   * BuildContext - state machine context
   */
  interface BuildContext {
    readonly phase: Phase
    readonly attempt: number
    readonly calculatedFee: bigint
    readonly shortfall: bigint
    readonly changeOutputs: ReadonlyArray<UTxO.TxOutput>
    readonly leftoverAfterFee: Assets.Assets
    readonly canUnfrack: boolean
  }

  const BuildContextTag = Context.GenericTag<Ref.Ref<BuildContext>>("V3BuildContext")

  interface PhaseResult {
    readonly next: Phase
  }

  const phaseSelectionV3 = Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
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

    return { next: "changeCreation" as Phase }
  })

  /**
   * Change Creation Phase
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
    const buildCtxRef = yield* BuildContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)
    const changeAddress = yield* ChangeAddressTag

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
      return { next: "selection" as Phase }
    }

    // Step 4: Affordability check - verify minimum (single output) is affordable
    // This pre-flight check ensures we can create at least one valid change output
    // before attempting any unfrack strategies
    const protocolParams = yield* ProtocolParametersTag
    const minLovelaceForSingle = yield* calculateMinimumUtxoLovelace({
      address: changeAddress,
      assets: tentativeLeftover,
      coinsPerUtxoByte: protocolParams.coinsPerUtxoByte
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
      const allAvailableUtxos = yield* AvailableUtxosTag
      const availableUtxos = getAvailableUtxos(allAvailableUtxos, alreadySelected)
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

        return { next: "selection" as Phase }
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
      return { next: "fallback" as Phase }
    }

    // Step 5: Unfrack path (single output IS affordable, try bundles/subdivision)
    if (ctx.options?.unfrack && buildCtx.canUnfrack) {
      const protocolParams = yield* ProtocolParametersTag
      const changeOutputs = yield* createChangeOutputs(
        tentativeLeftover,
        ctx,
        changeAddress,
        protocolParams.coinsPerUtxoByte
      )

      yield* Effect.logDebug(`[ChangeCreationV3] Successfully created ${changeOutputs.length} unfracked outputs`)

      // Store outputs and proceed to fee calculation
      yield* Ref.update(buildCtxRef, (ctx) => ({
        ...ctx,
        changeOutputs
      }))
      return { next: "feeCalculation" as Phase }
    }

    // Step 6: Single output path - create single change output
    // Affordability already verified in Step 4, so we can create output directly
    const singleOutput: UTxO.TxOutput = {
      address: changeAddress,
      assets: tentativeLeftover,
      datumOption: undefined,
      scriptRef: undefined
    }

    yield* Ref.update(buildCtxRef, (ctx) => ({
      ...ctx,
      changeOutputs: [singleOutput]
    }))

    return { next: "feeCalculation" as Phase }
  })

  const phaseFeeCalculationV3 = Effect.gen(function* () {
    // Step 1: Get contexts and current state
    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
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
    const protocolParams = yield* ProtocolParametersTag
    const calculatedFee = yield* calculateFeeIteratively(selectedUtxos, inputs, allOutputs, {
      minFeeCoefficient: protocolParams.minFeeCoefficient,
      minFeeConstant: protocolParams.minFeeConstant
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

    return { next: "balance" as Phase }
  })

  const phaseBalanceV3 = Effect.gen(function* () {
    // Step 1: Get contexts and log start
    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
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
      return { next: "complete" as Phase }
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
    // This should NEVER happen with Option B design, EXCEPT:
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
              message: `Invalid drainTo index: ${drainToIndex}. Must be between 0 and ${outputs.length - 1}`,
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
        const newTotalOutputAssets = newOutputs.reduce((acc, output) => Assets.merge(acc, output.assets), {
          lovelace: 0n
        } as Assets.Assets)
        yield* Ref.set(ctx.state.totalOutputAssets, newTotalOutputAssets)

        yield* Effect.logDebug(
          `[BalanceV3] DrainTo mode: Merged ${deltaLovelace} lovelace into output[${drainToIndex}]. ` +
            `New output value: ${newLovelace}. Transaction balanced.`
        )
        return { next: "complete" as Phase }
      } else if (isBurnMode) {
        // Burn mode: Positive delta is the burned leftover (becomes implicit fee)
        yield* Effect.logDebug(
          `[BalanceV3] Burn mode: ${deltaLovelace} lovelace burned as implicit fee. ` + `Transaction balanced.`
        )
        return { next: "complete" as Phase }
      } else {
        // Not burn mode or drainTo: This is a bug
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              ` CRITICAL BUG: Excess lovelace detected (${deltaLovelace}). ` +
              `s Option B design should never produce positive delta. ` +
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

    return { next: "changeCreation" as Phase }
  })

  // Handles insufficient change scenarios with drain or burn strategies.
  // This phase is reached after MAX_ATTEMPTS exhausted in ChangeCreation.
  // Only applies to ADA-only leftover (native assets cannot be drained/burned).
  // Note: ChangeCreation ensures only ADA-only cases reach this phase.

  const phaseFallbackV3 = Effect.gen(function* () {
    yield* Effect.logDebug("Phase: Fallback")

    const ctx = yield* TxContext
    const buildCtxRef = yield* BuildContextTag
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
      return { next: "feeCalculation" as Phase }
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
      return { next: "feeCalculation" as Phase }
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

  const buildEffectCoreV3 = (options?: BuildOptions) =>
    Effect.gen(function* () {
      const _ctx = yield* TxContext

      // Resolve protocol parameters once at build start
      // Priority: BuildOptions override > provider.Effect.getProtocolParameters() > error
      const protocolParameters: ProtocolParameters = yield* options?.protocolParameters !== undefined
        ? Effect.succeed(options.protocolParameters)
        : _ctx.config.provider
          ? Effect.map(
              _ctx.config.provider.Effect.getProtocolParameters(),
              (params): ProtocolParameters => ({
                minFeeCoefficient: BigInt(params.minFeeA),
                minFeeConstant: BigInt(params.minFeeB),
                coinsPerUtxoByte: params.coinsPerUtxoByte,
                maxTxSize: params.maxTxSize
              })
            )
          : Effect.fail(
              new TransactionBuilderError({
                message:
                  "No protocol parameters provided. Either provide protocolParameters in BuildOptions or provider in config.",
                cause: null
              })
            )

      // Resolve change address once at build start
      // Priority: BuildOptions override > wallet.Effect.address() > error
      const changeAddress: string = yield* options?.changeAddress
        ? Effect.succeed(options.changeAddress)
        : _ctx.config.wallet
          ? _ctx.config.wallet.Effect.address()
          : Effect.fail(
              new TransactionBuilderError({
                message:
                  "No change address provided. Either provide wallet in config or changeAddress in build options.",
                cause: null
              })
            )

      // Resolve available UTxOs once at build start
      // Priority: BuildOptions override > provider.Effect.getUtxos(wallet.address) > error
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = yield* options?.availableUtxos
        ? Effect.succeed(options.availableUtxos)
        : _ctx.config.wallet && _ctx.config.provider
          ? Effect.flatMap(_ctx.config.wallet.Effect.address(), (addr) => _ctx.config.provider!.Effect.getUtxos(addr))
          : Effect.fail(
              new TransactionBuilderError({
                message:
                  "No available UTxOs provided. Either provide wallet+provider in config or availableUtxos in build options.",
                cause: null
              })
            )

      // No need to create resolvedConfig - we provide resolved values via context tags below

      yield* Effect.all(programs, { concurrency: "unbounded" })

      const initialBuildCtx: BuildContext = {
        phase: "selection" as const,
        attempt: 0,
        calculatedFee: 0n,
        shortfall: 0n,
        changeOutputs: [],
        leftoverAfterFee: { lovelace: 0n },
        canUnfrack: options?.unfrack !== undefined
      }

      const ctxRef = yield* Ref.make(initialBuildCtx)

      // Run phase loop and transaction assembly with all services provided
      const { buildCtx, selectedUtxos, transaction, txWithFakeWitnesses } = yield* Effect.gen(function* () {
        // Phase loop
        while (true) {
          const buildCtx = yield* Ref.get(ctxRef)

          // Terminal state
          if (buildCtx.phase === "complete") {
            break
          }

          // Route to phase
          let result: PhaseResult

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
              return yield* Effect.fail(new TransactionBuilderError({ message: `Unknown phase: ${buildCtx.phase}` }))
          }

          // Update phase
          yield* Ref.update(ctxRef, (c) => ({ ...c, phase: result.next }))
        }

        // 4. Add change outputs to transaction and assemble
        const buildCtx = yield* Ref.get(ctxRef)
        const ctx = yield* TxContext

        yield* Effect.logDebug(`Build complete - fee: ${buildCtx.calculatedFee}`)

        // Add change outputs to the transaction outputs
        if (buildCtx.changeOutputs.length > 0) {
          const currentOutputs = yield* Ref.get(ctx.state.outputs)
          yield* Ref.set(ctx.state.outputs, [...currentOutputs, ...buildCtx.changeOutputs])

          yield* Effect.logDebug(`Added ${buildCtx.changeOutputs.length} change output(s) to transaction`)
        }

        // Get final inputs and outputs for transaction assembly
        const selectedUtxos = yield* Ref.get(ctx.state.selectedUtxos)
        const allOutputs = yield* Ref.get(ctx.state.outputs)

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

        // Return data for final result assembly
        return {
          transaction,
          txWithFakeWitnesses,
          buildCtx,
          selectedUtxos
        }
      }).pipe(
        Effect.provideService(BuildContextTag, ctxRef),
        Effect.provideService(ProtocolParametersTag, protocolParameters),
        Effect.provideService(ChangeAddressTag, changeAddress),
        Effect.provideService(AvailableUtxosTag, availableUtxos)
      )

      // Assemble final result based on wallet capabilities
      const ctx = yield* TxContext
      const wallet = ctx.config.wallet

      // Type guard: Check if wallet is signing-capable (has signTx method)
      const isSigningWallet = wallet && "signTx" in wallet

      if (isSigningWallet) {
        // Return SignBuilder for signing-capable wallets
        const signBuilder = makeSignBuilder({
          transaction,
          transactionWithFakeWitnesses: txWithFakeWitnesses,
          fee: buildCtx.calculatedFee,
          utxos: selectedUtxos,
          provider: ctx.config.provider!,
          wallet: wallet as WalletNew.SigningWallet | WalletNew.ApiWallet
        })
        return signBuilder
      } else {
        // Return TransactionResultBase for read-only wallets
        const transactionResult = makeTransactionResult({
          transaction,
          transactionWithFakeWitnesses: txWithFakeWitnesses,
          fee: buildCtx.calculatedFee
        })
        return transactionResult
      }
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

  const txBuilder: TransactionBuilder<TResult> = {
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
      return buildEffectCoreV3(options) as unknown as Effect.Effect<
        TResult,
        TransactionBuilderError | EvaluationError | WalletNew.WalletError | Provider.ProviderError,
        unknown
      >
    },

    build: (options?: BuildOptions) => {
      return Effect.runPromise(
        buildEffectCoreV3(options).pipe(
          Effect.provide(Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug)))
        )
      ) as unknown as Promise<TResult>
    },
    buildEither: (options?: BuildOptions) => {
      return Effect.runPromise(
        buildEffectCoreV3(options).pipe(
          Effect.either,
          Effect.provide(Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug)))
        )
      ) as unknown as Promise<
        Either<TResult, TransactionBuilderError | EvaluationError | WalletNew.WalletError | Provider.ProviderError>
      >
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
