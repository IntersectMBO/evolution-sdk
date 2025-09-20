import { Data, type Effect } from "effect"

import type * as Coin from "../../core/Coin.js"
import type * as TransactionOutput from "../../core/TransactionOutput.js"
import type * as Assets from "../Assets.js"
import type * as UTxO from "../UTxO.js"

// ============================================================================
// Error Types
// ============================================================================

export class CoinSelectionError extends Data.TaggedError("CoinSelectionError")<{
  message?: string
  cause?: unknown
}> {}

// ============================================================================
// Coin Selection Types
// ============================================================================

export interface CoinSelectionOptions {
  readonly maxInputs?: number
  readonly includeUtxos?: ReadonlyArray<UTxO.UTxO> // UTxOs that must be included
  readonly excludeUtxos?: ReadonlyArray<UTxO.UTxO> // UTxOs that must be excluded
  readonly strategy?: "largest-first" | "random-improve" | "optimal"
  readonly allowPartialSpend?: boolean // For large UTxOs
}

export interface CoinSelectionResult {
  readonly selectedUtxos: ReadonlyArray<UTxO.UTxO>
  readonly changeOutput?: TransactionOutput.TransactionOutput
  readonly totalFee: Coin.Coin
  readonly excessAssets?: Assets.Assets // Assets that couldn't be included in change
}

// Custom coin selection function type
export type CoinSelectionFunction = (
  availableUtxos: ReadonlyArray<UTxO.UTxO>,
  requiredAssets: Assets.Assets,
  options: CoinSelectionOptions
) => Effect.Effect<CoinSelectionResult, CoinSelectionError>

// TODO: Define specific coin selection algorithms
export type CoinSelectionAlgorithm = "auto" | "largest-first" | "random-improve" | "optimal"