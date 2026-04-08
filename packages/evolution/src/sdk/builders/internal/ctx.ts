/**
 * Shared context contracts for the transaction builder.
 *
 * Defines:
 * - Type definitions shared across all builder modules
 * - Tagged errors
 * - Context.Tag services for the builder's Effect context
 * - ProgramStep type alias
 *
 * @internal
 */

import { Context, Data } from "effect"
import type * as Effect from "effect/Effect"
import type * as Ref from "effect/Ref"

import type * as Address from "../../../Address.js"
import type * as Assets from "../../../Assets/index.js"
import type * as AuxiliaryData from "../../../AuxiliaryData.js"
import * as Bytes from "../../../Bytes.js"
import type * as Certificate from "../../../Certificate.js"
import type * as Coin from "../../../Coin.js"
import type * as CostModel from "../../../CostModel.js"
import type * as PlutusData from "../../../Data.js"
import type * as KeyHash from "../../../KeyHash.js"
import type * as Mint from "../../../Mint.js"
import type * as ProposalProcedures from "../../../ProposalProcedures.js"
import type * as RewardAccount from "../../../RewardAccount.js"
import type * as Script from "../../../Script.js"
import type * as Time from "../../../Time/index.js"
import type * as Transaction from "../../../Transaction.js"
import type * as TxOut from "../../../TxOut.js"
import type * as UTxO from "../../../UTxO.js"
import type * as VotingProcedures from "../../../VotingProcedures.js"
import type { Chain } from "../../client/Chain.js"
import type { EvalRedeemer } from "../../EvalRedeemer.js"
import type * as Provider from "../../provider/Provider.js"
import type * as Wallet from "../../wallet/Wallet.js"
import type { CoinSelectionAlgorithm, CoinSelectionFunction } from "../CoinSelection.js"
import type { DeferredRedeemer } from "../RedeemerBuilder.js"

// ============================================================================
// Phase State Machine
// ============================================================================

/**
 * Build phases
 */
type Phase =
  | "selection"
  | "changeCreation"
  | "feeCalculation"
  | "balance"
  | "evaluation"
  | "collateral"
  | "fallback"
  | "complete"

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * BuildContext - state machine context
 */
export interface PhaseContext {
  readonly phase: Phase
  readonly attempt: number
  readonly calculatedFee: bigint
  readonly shortfall: bigint
  readonly changeOutputs: ReadonlyArray<TxOut.TransactionOutput>
  readonly leftoverAfterFee: Assets.Assets
  readonly canUnfrack: boolean
}

/**
 * Data required by script evaluators: cost models, execution limits, and slot configuration.
 *
 * Used by custom evaluators for local UPLC script evaluation.
 *
 * @since 2.0.0
 * @category model
 */
export interface EvaluationContext {
  /** Cost models for script evaluation */
  readonly costModels: CostModel.CostModels
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
 * Represents a single script failure from Ogmios evaluation.
 *
 * Contains all available information about which script failed and why,
 * including optional labels from the user's operation definitions.
 *
 * @since 2.0.0
 * @category errors
 */
export interface ScriptFailure {
  /** Redeemer purpose: "spend", "mint", "withdraw", "publish" */
  readonly purpose: string
  /** Index within the purpose category */
  readonly index: number
  /** User-provided label for debugging (from operation params) */
  readonly label?: string
  /** Key used internally to track this redeemer (e.g., "txHash#index" for spend) */
  readonly redeemerKey?: string
  /** Script hash if available */
  readonly scriptHash?: string
  /** UTxO reference for spend redeemers */
  readonly utxoRef?: string
  /** Credential hash for withdraw/cert redeemers */
  readonly credential?: string
  /** Policy ID for mint redeemers */
  readonly policyId?: string
  /** Validation error message from the script */
  readonly validationError: string
  /** Execution traces emitted by the script */
  readonly traces: ReadonlyArray<string>
}

/**
 * Interface for evaluating transaction scripts and computing execution units.
 *
 * Implement this interface to provide custom script evaluation strategies, such as local UPLC execution.
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
    tx: Transaction.Transaction,
    additionalUtxos: ReadonlyArray<UTxO.UTxO> | undefined,
    context: EvaluationContext
  ) => Effect.Effect<ReadonlyArray<EvalRedeemer>, EvaluationError>
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
   * Maximum ADA-only UTxOs to consolidate in one transaction.
   * NOTE: Not yet implemented. Will hook into coin selection to merge dust UTxOs.
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

  /** Price per memory unit for script execution (optional, for ExUnits cost calculation) */
  priceMem?: number

  /** Price per CPU step for script execution (optional, for ExUnits cost calculation) */
  priceStep?: number

  /** Cost per byte for reference scripts (Conway-era, default 44) */
  minFeeRefScriptCostPerByte?: number

  // Future fields for advanced features:
  // maxBlockHeaderSize?: number
  // maxTxExecutionUnits?: ExUnits
  // maxBlockExecutionUnits?: ExUnits
  // collateralPercentage?: number
  // maxCollateralInputs?: number
}

/**
 * Redeemer data stored during input collection.
 * Index is determined later during witness assembly based on input ordering.
 *
 * @since 2.0.0
 * @category state
 */
export interface RedeemerData {
  readonly tag: "spend" | "mint" | "cert" | "reward" | "vote"
  readonly data: PlutusData.Data
  readonly exUnits?: {
    // Optional: from script evaluation
    readonly mem: bigint
    readonly steps: bigint
  }
  /** Optional label for debugging - identifies this redeemer in error messages */
  readonly label?: string
}

/**
 * Deferred redeemer data for RedeemerBuilder patterns.
 * Contains callback that will be resolved after coin selection completes.
 *
 * @since 2.0.0
 * @category state
 */
export interface DeferredRedeemerData {
  readonly tag: "spend" | "mint" | "cert" | "reward" | "vote"
  readonly deferred: DeferredRedeemer
  readonly exUnits?: {
    readonly mem: bigint
    readonly steps: bigint
  }
  /** Optional label for debugging - identifies this redeemer in error messages */
  readonly label?: string
}

/**
 * Configuration for TransactionBuilder.
 * Immutable configuration passed to builder at creation time.
 *
 * Wallet-centric design (when wallet provided):
 * - Wallet provides change address (via wallet.effect.address())
 * - Provider + Wallet provide available UTxOs (via provider.effect.getUtxos(wallet.address))
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
   * - Change address via wallet.effect.address()
   * - Available UTxOs via wallet.effect.address() + provider.effect.getUtxos()
   * - Signing capability via wallet.effect.signTx() (SigningWallet and ApiWallet only)
   *
   * When provided: Automatic change address and UTxO resolution.
   * When omitted: Must provide changeAddress and availableUtxos in BuildOptions.
   *
   * ReadOnlyWallet: For read-only clients that can build but not sign transactions.
   * SigningWallet/ApiWallet: For signing clients with full transaction signing capability.
   *
   * Override per-build via BuildOptions.changeAddress and BuildOptions.availableUtxos.
   */
  readonly wallet?: Wallet.SigningWallet | Wallet.ApiWallet | Wallet.ReadOnlyWallet

  /**
   * Optional provider for:
   * - Fetching UTxOs for the wallet's address (provider.effect.getUtxos)
   * - Transaction submission (provider.effect.submitTx)
   * - Protocol parameters
   *
   * Works together with wallet to provide everything needed for transaction building.
   * When wallet is omitted, provider is only used if you call provider methods directly.
   */
  readonly provider?: Provider.Provider

  /**
   * Chain descriptor — network identity and slot timing parameters.
   *
   * Provides:
   * - `id`: Network id (1 = mainnet, 0 = testnet) for address and reward account encoding
   * - `slotConfig`: Slot timing required for validity interval conversion and script evaluation
   * - `networkMagic`, `epochLength`, `name`: Additional network metadata
   *
   * Use the presets `mainnet`, `preprod`, `preview` from the client module, or define a
   * custom Chain for private networks and devnets.
   *
   * The per-build `BuildOptions.slotConfig` override takes priority over `chain.slotConfig`.
   *
   * @since 2.0.0
   */
  readonly chain: Chain

  // Future fields:
  // readonly costModels?: Uint8Array // Cost models for script evaluation
}

/**
 * Mutable state created FRESH on each build() call.
 * Contains all state needed during transaction construction.
 *
 * State lifecycle:
 * 1. Created fresh when build() is called
 * 2. Modified by ProgramSteps during execution
 * 3. Used to construct final transaction
 * 4. Discarded after build completes
 *
 * @since 2.0.0
 * @category state
 */
export interface TxBuilderState {
  readonly selectedUtxos: ReadonlyArray<UTxO.UTxO> // Core UTxO type
  readonly outputs: ReadonlyArray<TxOut.TransactionOutput> // Transaction outputs (no txHash/outputIndex yet)
  readonly scripts: Map<string, Script.Script> // Scripts attached to the transaction
  readonly totalOutputAssets: Assets.Assets // Asset totals for balancing
  readonly totalInputAssets: Assets.Assets // Asset totals for balancing
  readonly redeemers: Map<string, RedeemerData> // Resolved redeemer data (static mode)
  readonly deferredRedeemers: Map<string, DeferredRedeemerData> // Deferred redeemers (self/batch mode)
  readonly referenceInputs: ReadonlyArray<UTxO.UTxO> // Reference inputs (UTxOs with reference scripts)
  readonly certificates: ReadonlyArray<Certificate.Certificate> // Certificates for staking operations
  readonly withdrawals: Map<RewardAccount.RewardAccount, bigint> // Withdrawal amounts by reward account
  readonly poolDeposits: Map<string, bigint> // Pool deposits keyed by pool key hash
  readonly mint?: Mint.Mint // Assets being minted/burned (positive = mint, negative = burn)
  readonly votingProcedures?: VotingProcedures.VotingProcedures // Voting procedures for governance actions (Conway)
  readonly proposalProcedures?: ProposalProcedures.ProposalProcedures // Proposal procedures for governance actions (Conway)
  readonly collateral?: {
    // Collateral data for script transactions
    readonly inputs: ReadonlyArray<UTxO.UTxO>
    readonly totalAmount: bigint
    readonly returnOutput?: TxOut.TransactionOutput // Optional: only if there are leftover assets
  }
  readonly validity?: {
    // Transaction validity interval (Unix times, converted to slots during assembly)
    readonly from?: Time.UnixTime // validityIntervalStart
    readonly to?: Time.UnixTime // ttl
  }
  readonly requiredSigners: ReadonlyArray<KeyHash.KeyHash> // Extra signers required (for script validation)
  readonly auxiliaryData?: AuxiliaryData.AuxiliaryData // Auxiliary data (metadata, scripts, etc.)
  readonly sendAllTo?: Address.Address // Target address for sendAll operation
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
   * By default, uses wallet.effect.address() from TxBuilderConfig.
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
   * // Custom Core Address
   * builder.build({ changeAddress: Core.Address.fromBech32("addr_test1...") })
   * ```
   *
   * @since 2.0.0
   */
  readonly changeAddress?: Address.Address

  /**
   * Override the available UTxOs for this specific transaction build.
   *
   * By default, fetches UTxOs from provider.effect.getUtxos(wallet.address).
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
   */

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

  /**
   * Script evaluator for Plutus script execution costs.
   *
   * If provided, replaces the default provider-based evaluation.
   * Use `createUPLCEvaluator()` for UPLC libraries, or implement `Evaluator` directly.
   *
   * @since 2.0.0
   */
  readonly evaluator?: Evaluator

  /**
   * Pass additional UTxOs to provider-based evaluators.
   *
   * By default, provider evaluators (Ogmios, Blockfrost) don't receive additionalUtxos
   * because they can resolve UTxOs from the chain, and passing them causes
   * "OverlappingAdditionalUtxo" errors.
   *
   * Set to `true` for edge cases where you need to evaluate with UTxOs that
   * are not yet on chain (e.g., chained transactions, emulator scenarios).
   *
   * Note: This option has no effect on custom evaluators (Aiken, Scalus) which
   * always receive additionalUtxos since they cannot resolve from chain.
   *
   * @default false
   * @since 2.0.0
   */
  readonly passAdditionalUtxos?: boolean

  /**
   * Format for encoding redeemers in the script data hash.
   *
   * @deprecated Redeemer format is now determined by the concrete `Redeemers` type
   * (`RedeemerMap` or `RedeemerArray`). This option is ignored.
   *
   * @since 2.0.0
   */
  readonly scriptDataFormat?: "array" | "map"

  /**
   * Custom slot configuration for script evaluation.
   *
   * By default, slot config is determined from the network (mainnet/preview/preprod).
   * Provide this to override for custom networks (emulator, devnet, etc.).
   *
   * The slot configuration defines the relationship between slots and Unix time,
   * which is required for UPLC evaluation of time-based validators.
   *
   * Use cases:
   * - Emulator with custom genesis time
   * - Development network with different slot configuration
   * - Testing with specific time scenarios
   *
   * Example:
   * ```typescript
   * // For custom emulator
   * builder.build({
   *   slotConfig: {
   *     zeroTime: 1234567890000n,
   *     zeroSlot: 0n,
   *     slotLength: 1000
   *   }
   * })
   * ```
   *
   * @since 2.0.0
   */
  readonly slotConfig?: Time.SlotConfig

  /**
   * Amount to set as collateral return output (in lovelace).
   *
   * Used for Plutus script transactions to cover potential script execution failures.
   * If not provided, defaults to 5 ADA (5_000_000 lovelace).
   *
   * @default 5_000_000n
   * @since 2.0.0
   */
  readonly setCollateral?: bigint

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
   * Enable debug logging during transaction build.
   *
   * When `true`, applies pretty logger with DEBUG level:
   * - Coin selection details
   * - Change creation steps
   * - Fee calculation progress
   * - Fiber termination messages with stack traces
   *
   * When `false` or `undefined` (default), no log layer is applied:
   * - Effect.logDebug calls are not visible
   * - Fiber termination logs are suppressed
   * - Clean output for production use
   *
   * @default false
   * @since 2.0.0
   */
  readonly debug?: boolean
}

// ============================================================================
// Errors
// ============================================================================

export class TransactionBuilderError extends Data.TaggedError("TransactionBuilderError")<{
  message?: string
  cause?: unknown
}> {}

export class EvaluationError extends Data.TaggedError("EvaluationError")<{
  readonly cause?: unknown
  readonly message?: string
  readonly failures?: ReadonlyArray<ScriptFailure>
}> {}

// ============================================================================
// Context Tags
// ============================================================================

export class PhaseContextTag extends Context.Tag("PhaseContextTag")<PhaseContextTag, Ref.Ref<PhaseContext>>() {}

export class TxContext extends Context.Tag("TxContext")<TxContext, Ref.Ref<TxBuilderState>>() {}

export class ChangeAddressTag extends Context.Tag("ChangeAddress")<ChangeAddressTag, Address.Address>() {}

export class ProtocolParametersTag extends Context.Tag("ProtocolParameters")<
  ProtocolParametersTag,
  ProtocolParameters
>() {}

export class TxBuilderConfigTag extends Context.Tag("TxBuilderConfig")<TxBuilderConfigTag, TxBuilderConfig>() {}

export class AvailableUtxosTag extends Context.Tag("AvailableUtxos")<
  AvailableUtxosTag,
  ReadonlyArray<UTxO.UTxO>
>() {}

export class BuildOptionsTag extends Context.Tag("BuildOptions")<BuildOptionsTag, BuildOptions>() {}

// ============================================================================
// Program Step
// ============================================================================

export type ProgramStep = Effect.Effect<void, TransactionBuilderError, TxContext | TxBuilderConfigTag>

// ============================================================================
// Phase Result
// ============================================================================

/**
 * Result returned by a phase indicating the next phase to execute.
 *
 * @since 2.0.0
 * @category model
 */
export interface PhaseResult {
  readonly next: Phase
}

// ============================================================================
// Voter Key
// ============================================================================

/**
 * Convert a Voter to a unique string key for redeemer tracking.
 *
 * Key formats:
 * - Constitutional Committee: `cc:{credentialHex}`
 * - DRep (KeyHash): `drep:{keyHashHex}`
 * - DRep (ScriptHash): `drep:{scriptHashHex}`
 * - DRep (Special): `drep:AlwaysAbstainDRep` or `drep:AlwaysNoConfidenceDRep`
 * - Stake Pool: `pool:{poolKeyHashHex}`
 *
 * This is used for:
 * 1. Tracking redeemers by voter in Vote.ts
 * 2. Computing vote redeemer indices in TxBuilderImpl.ts (assembly)
 * 3. Mapping evaluation results back to voters in Evaluation.ts
 *
 * The key format must match the sorting order used by Cardano ledger for
 * redeemer indexing (lexicographic sort of voter keys).
 *
 * @since 2.0.0
 * @category utilities
 */
export const voterToKey = (voter: VotingProcedures.Voter): string => {
  switch (voter._tag) {
    case "ConstitutionalCommitteeVoter":
      return `cc:${Bytes.toHex(voter.credential.hash)}`
    case "DRepVoter":
      switch (voter.drep._tag) {
        case "KeyHashDRep":
          return `drep:${Bytes.toHex(voter.drep.keyHash.hash)}`
        case "ScriptHashDRep":
          return `drep:${Bytes.toHex(voter.drep.scriptHash.hash)}`
        default:
          // AlwaysAbstain or AlwaysNoConfidence - shouldn't need redeemers
          return `drep:${voter.drep._tag}`
      }
    case "StakePoolVoter":
      return `pool:${Bytes.toHex(voter.poolKeyHash.hash)}`
  }
}
