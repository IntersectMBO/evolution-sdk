import { Data } from "effect"

import * as CoreAssets from "../../Assets.js"
import type * as UTxO from "../../UTxO.js"
import * as Cip2 from "./internal/Cip2.js"

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

// Single responsibility: just return which UTxOs to spend
export interface CoinSelectionResult {
  readonly selectedUtxos: ReadonlyArray<UTxO.UTxO>
}

// Custom coin selection function - embeds the algorithm and any options within the function
export type CoinSelectionFunction = (
  availableUtxos: ReadonlyArray<UTxO.UTxO>,
  requiredAssets: CoreAssets.Assets
) => CoinSelectionResult

// Predefined algorithm names (each maps to a concrete CoinSelectionFunction)
export type CoinSelectionAlgorithm = "largest-first" | "random-improve"

/**
 * Convert a UTxO's assets into the flat form CIP-2 selection reasons about.
 */
const toSelValue = (assets: CoreAssets.Assets): Cip2.SelValue => {
  const flat = new Map<string, bigint>()
  for (const unit of CoreAssets.getUnits(assets)) {
    if (unit === "lovelace") continue
    flat.set(unit, CoreAssets.getByUnit(assets, unit))
  }
  return { coin: CoreAssets.lovelaceOf(assets), assets: flat }
}

const runCip2 = (
  availableUtxos: ReadonlyArray<UTxO.UTxO>,
  requiredAssets: CoreAssets.Assets,
  deterministic: boolean,
  opts: { readonly seed?: number; readonly rng?: Cip2.Rng } = {}
): CoinSelectionResult => {
  const target = toSelValue(requiredAssets)
  const multiAsset = target.assets.size > 0
  const strategy: Cip2.Strategy = deterministic
    ? multiAsset
      ? "largest-first-multiasset"
      : "largest-first"
    : multiAsset
      ? "random-improve-multiasset"
      : "random-improve"
  try {
    const { selected } = Cip2.selectCoins(
      availableUtxos.map((u) => ({ id: u, value: toSelValue(u.assets) })),
      target,
      strategy,
      opts
    )
    return { selectedUtxos: selected.map((s) => s.id) }
  } catch (cause) {
    // Reported as this module's error so a caller handles one type, with the CIP-2 message kept.
    throw new CoinSelectionError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause
    })
  }
}

/**
 * Random-improve coin selection (CIP-2), asset-aware.
 *
 * Phase 1 selects at random until the target is covered; phase 2 swaps a chosen input for a
 * remaining one when that moves the per-input contribution closer to twice the target without
 * exceeding three times it. The point is that an observer cannot predict which UTxOs a wallet
 * will combine, so the default randomness is `crypto.getRandomValues` and there is no silent
 * fallback to a predictable PRNG.
 *
 * Use {@link randomImproveSelectionWith} to supply a seed or your own source.
 *
 * @since 2.0.0
 * @category coin-selection
 */
export const randomImproveSelection: CoinSelectionFunction = (availableUtxos, requiredAssets) =>
  runCip2(availableUtxos, requiredAssets, false)

/**
 * {@link randomImproveSelection} with an explicit randomness source.
 *
 * ⚠️ `seed` is for tests and examples only: a fixed seed makes selection identical for every
 * wallet holding the same UTxO set, which is the opposite of the property random-improve exists
 * to provide.
 *
 * @since 2.0.0
 * @category coin-selection
 */
export const randomImproveSelectionWith =
  (opts: { readonly seed?: number; readonly rng?: Cip2.Rng }): CoinSelectionFunction =>
  (availableUtxos, requiredAssets) =>
    runCip2(availableUtxos, requiredAssets, false, opts)

// ============================================================================
// Largest-First Coin Selection Implementation
// ============================================================================

/**
 * Largest-first coin selection algorithm.
 *
 * Strategy:
 * 1. Sort UTxOs by total lovelace value (descending)
 * 2. Select UTxOs one by one until all required assets are covered
 * 3. Return selected UTxOs
 *
 * Advantages:
 * - Simple and predictable
 * - Minimizes number of inputs (uses largest UTxOs first)
 * - Fast execution
 *
 * Disadvantages:
 * - May select more value than needed (more change)
 * - Doesn't optimize for minimum fee
 * - Doesn't consider UTxO fragmentation
 *
 * Use cases:
 * - Default algorithm for simple transactions
 * - When minimizing input count is priority
 * - When speed is more important than optimization
 *
 * @since 2.0.0
 * @category coin-selection
 */
export const largestFirstSelection: CoinSelectionFunction = (
  availableUtxos: ReadonlyArray<UTxO.UTxO>,
  requiredAssets: CoreAssets.Assets
): CoinSelectionResult => {
  // Sort UTxOs by lovelace value (descending)
  const sortedUtxos = [...availableUtxos].sort((a, b) => {
    const aValue = CoreAssets.lovelaceOf(a.assets)
    const bValue = CoreAssets.lovelaceOf(b.assets)
    return bValue > aValue ? 1 : bValue < aValue ? -1 : 0
  })

  const selected: Array<UTxO.UTxO> = []
  let accumulated = CoreAssets.zero

  // Select UTxOs until all requirements met
  for (const utxo of sortedUtxos) {
    // Check if we've met all requirements
    if (CoreAssets.covers(accumulated, requiredAssets)) {
      break
    }

    // Add this UTxO to selection
    selected.push(utxo)

    // Update accumulated assets using merge
    accumulated = CoreAssets.merge(accumulated, utxo.assets)
  }

  // Verify we met all requirements
  for (const unit of CoreAssets.getUnits(requiredAssets)) {
    const have = CoreAssets.getByUnit(accumulated, unit)
    const required = CoreAssets.getByUnit(requiredAssets, unit)
    if (have < required) {
      throw new CoinSelectionError({
        message: `Insufficient ${unit}: need ${required}, have ${have} in available UTxOs`,
        cause: {
          unit,
          required: String(required),
          available: String(have),
          shortfall: String(required - have)
        }
      })
    }
  }

  return { selectedUtxos: selected }
}
