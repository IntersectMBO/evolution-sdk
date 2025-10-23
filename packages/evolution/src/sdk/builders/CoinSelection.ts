import { Data } from "effect"

import * as Assets from "../Assets.js"
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

// Single responsibility: just return which UTxOs to spend
export interface CoinSelectionResult {
  readonly selectedUtxos: ReadonlyArray<UTxO.UTxO>
}

// Custom coin selection function - embeds the algorithm and any options within the function
export type CoinSelectionFunction = (
  availableUtxos: ReadonlyArray<UTxO.UTxO>,
  requiredAssets: Assets.Assets
) => CoinSelectionResult

// Predefined algorithm names (each maps to a concrete CoinSelectionFunction)
export type CoinSelectionAlgorithm = "largest-first" | "random-improve" | "optimal"

// Factory functions for built-in algorithms
export declare const randomImproveSelection: CoinSelectionFunction  
export declare const optimalSelection: CoinSelectionFunction

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
  requiredAssets: Assets.Assets
): CoinSelectionResult => {
  // Sort UTxOs by lovelace value (descending)
  const sortedUtxos = [...availableUtxos].sort((a, b) => {
    const aValue = Assets.getAsset(a.assets, "lovelace")
    const bValue = Assets.getAsset(b.assets, "lovelace")
    return bValue > aValue ? 1 : bValue < aValue ? -1 : 0
  })
  
  const selected: Array<UTxO.UTxO> = []
  let accumulated = Assets.empty()
  
  // Select UTxOs until all requirements met
  for (const utxo of sortedUtxos) {
    // Check if we've met all requirements
    const allMet = Assets.getUnits(requiredAssets).every(unit => {
      const have = Assets.getAsset(accumulated, unit)
      const need = Assets.getAsset(requiredAssets, unit)
      return have >= need
    })
    
    if (allMet) {
      break
    }
    
    // Add this UTxO to selection
    selected.push(utxo)
    
    // Update accumulated assets using Assets.add helper
    accumulated = Assets.add(accumulated, utxo.assets)
  }
  
  // Verify we met all requirements
  for (const unit of Assets.getUnits(requiredAssets)) {
    const have = Assets.getAsset(accumulated, unit)
    const required = Assets.getAsset(requiredAssets, unit)
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
