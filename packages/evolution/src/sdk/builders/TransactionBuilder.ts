// Effect-TS imports
import { Data, type Effect } from "effect"

import type * as AssetName from "../../core/AssetName.js"
import type * as Coin from "../../core/Coin.js"
import type * as PolicyId from "../../core/PolicyId.js"
import type * as Transaction from "../../core/Transaction.js"
import type * as TransactionMetadatum from "../../core/TransactionMetadatum.js"
import type * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import type * as Value from "../../core/Value.js"
import type * as Address from "../Address.js"
import type * as Script from "../Script.js"
import type { EffectToPromiseAPI } from "../Type.js"
import type * as UTxO from "../UTxO.js"
import type { CoinSelectionAlgorithm, CoinSelectionFunction, CoinSelectionOptions } from "./CoinSelection.js"
import type { CollectFromParams, MintTokensParams, PayToAddressParams, ScriptHash } from "./operations/Operations.js"

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error class for TransactionBuilder related operations.
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

export type MetadataLabel = string | number

export type Slot = number

export interface ChainResult {
  readonly transaction: Transaction.Transaction
  readonly newOutputs: ReadonlyArray<UTxO.UTxO> // UTxOs created by this transaction
  readonly updatedUtxos: ReadonlyArray<UTxO.UTxO> // Available UTxOs for next transaction (original - spent + new)
  readonly spentUtxos: ReadonlyArray<UTxO.UTxO> // UTxOs consumed by this transaction
}

export interface UplcEvaluationOptions {
  readonly type: "wasm" | "provider"
  readonly wasmModule?: any // TODO: Define WASM UPLC module interface
  readonly timeout?: number
  readonly maxMemory?: number
  readonly maxCpu?: number
}

// TODO: To be defined - transaction optimization flags
export interface TransactionOptimizations {
  readonly mergeOutputs?: boolean
  readonly consolidateInputs?: boolean
  readonly minimizeFee?: boolean
}

// Transaction cost estimation
export interface TransactionEstimate {
  readonly fee: Coin.Coin
  readonly size: number
  readonly exUnits?: {
    readonly mem: bigint
    readonly steps: bigint
  }
}

// Build Options - Comprehensive configuration for transaction building
export interface BuildOptions {
  // Coin selection strategy
  readonly coinSelection?: CoinSelectionAlgorithm | CoinSelectionFunction
  readonly coinSelectionOptions?: CoinSelectionOptions

  // Script evaluation options
  readonly uplcEval?: UplcEvaluationOptions

  // Collateral handling
  readonly collateral?: ReadonlyArray<UTxO.UTxO> // Manual collateral (max 3)
  readonly autoCollateral?: boolean // Default: true if Plutus scripts present

  // Fee and optimization
  readonly minFee?: Coin.Coin
  readonly feeMultiplier?: number

  // TODO: To be defined - optimization flags, debug options
  readonly debug?: boolean
  readonly optimizations?: TransactionOptimizations
}

// ============================================================================
// Transaction Builder Interface
// ============================================================================

export interface TransactionBuilderEffect {
  // Basic transaction operations
  readonly payToAddress: (params: PayToAddressParams) => TransactionBuilderEffect
  readonly payToScript: (
    scriptHash: ScriptHash.ScriptHash,
    value: Value.Value,
    datum: string
  ) => TransactionBuilderEffect

  // Native token operations
  readonly mintTokens: (params: MintTokensParams) => TransactionBuilderEffect
  readonly burnTokens: (
    policyId: PolicyId.PolicyId,
    assets: Map<AssetName.AssetName, bigint>,
    redeemer?: string
  ) => TransactionBuilderEffect

  // Staking operations
  readonly delegateStake: (poolId: string) => TransactionBuilderEffect
  readonly withdrawRewards: (amount?: Coin.Coin) => TransactionBuilderEffect
  readonly registerStakeKey: () => TransactionBuilderEffect
  readonly deregisterStakeKey: () => TransactionBuilderEffect

  // Governance operations
  readonly vote: (governanceActionId: string, vote: any) => TransactionBuilderEffect
  readonly proposeGovernanceAction: (proposal: any) => TransactionBuilderEffect

  // Transaction metadata and configuration
  readonly addMetadata: (
    label: MetadataLabel,
    metadata: TransactionMetadatum.TransactionMetadatum
  ) => TransactionBuilderEffect
  readonly setValidityInterval: (start?: Slot, end?: Slot) => TransactionBuilderEffect
  readonly addRequiredSigner: (keyHash: string) => TransactionBuilderEffect
  readonly addCollateral: (utxo: UTxO.UTxO) => TransactionBuilderEffect

  // Manual input/output management
  readonly collectFrom: (params: CollectFromParams) => TransactionBuilderEffect
  readonly addChangeOutput: (address: Address.Address) => TransactionBuilderEffect

  // Script operations
  readonly attachScript: (script: Script.Script) => TransactionBuilderEffect

  // Transaction finalization and execution
  readonly build: (options?: BuildOptions) => Effect.Effect<any, TransactionBuilderError> // SignBuilder defined in SignBuilder.ts
  readonly buildAndSign: (
    options?: BuildOptions
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
  readonly buildSignAndSubmit: (options?: BuildOptions) => Effect.Effect<string, TransactionBuilderError>

  // Transaction chaining
  readonly chain: (options?: BuildOptions) => Effect.Effect<ChainResult, TransactionBuilderError>

  // Fee estimation and draft transaction
  readonly estimateFee: (options?: BuildOptions) => Effect.Effect<TransactionEstimate, TransactionBuilderError>
  readonly draftTx: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>
}

export interface TransactionBuilder extends EffectToPromiseAPI<TransactionBuilderEffect> {
  readonly Effect: TransactionBuilderEffect
}