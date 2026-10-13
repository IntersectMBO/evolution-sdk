import { describe, expect, it } from "vitest"

import * as CoreAssets from "../src/Assets.js"
import {
  CoinSelectionError,
  largestFirstSelection,
  randomImproveSelection,
  randomImproveSelectionWith
} from "../src/sdk/builders/CoinSelection.js"
import type * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

/**
 * Unit tests for Largest-First Coin Selection Algorithm
 *
 * Tests the basic implementation of the largest-first coin selection strategy,
 * which selects UTxOs in descending order by lovelace value until all required
 * assets are covered.
 */
describe("Largest-First Coin Selection", () => {
  // ============================================================================
  // Basic Selection Tests
  // ============================================================================

  describe("Basic Selection", () => {
    it("should select single UTxO when sufficient", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [createCoreTestUtxo({ lovelace: 10_000_000n, index: 0 })]

      const requiredAssets = CoreAssets.fromLovelace(5_000_000n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      expect(result.selectedUtxos).toHaveLength(1)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(10_000_000n)
    })

    it("should select multiple UTxOs when single is insufficient", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 3_000_000n, index: 0 }),
        createCoreTestUtxo({ lovelace: 2_000_000n, index: 1 }),
        createCoreTestUtxo({ lovelace: 1_000_000n, index: 2 })
      ]

      const requiredAssets = CoreAssets.fromLovelace(5_500_000n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select largest first (3M + 2M + 1M = 6M >= 5.5M)
      expect(result.selectedUtxos).toHaveLength(3)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(3_000_000n)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[1].assets)).toBe(2_000_000n)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[2].assets)).toBe(1_000_000n)
    })

    it("should select exactly enough UTxOs (stops when requirements met)", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 0 }),
        createCoreTestUtxo({ lovelace: 5_000_000n, index: 1 }),
        createCoreTestUtxo({ lovelace: 3_000_000n, index: 2 }),
        createCoreTestUtxo({ lovelace: 1_000_000n, index: 3 })
      ]

      const requiredAssets = CoreAssets.fromLovelace(12_000_000n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select 10M + 5M = 15M (stops after 2nd UTxO)
      expect(result.selectedUtxos).toHaveLength(2)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(10_000_000n)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[1].assets)).toBe(5_000_000n)
    })
  })

  // ============================================================================
  // Sorting Behavior Tests
  // ============================================================================

  describe("Sorting Behavior", () => {
    it("should select largest UTxOs first", () => {
      // Intentionally unsorted input
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 2_000_000n, index: 0 }),
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 1 }),
        createCoreTestUtxo({ lovelace: 5_000_000n, index: 2 }),
        createCoreTestUtxo({ lovelace: 1_000_000n, index: 3 })
      ]

      const requiredAssets = CoreAssets.fromLovelace(8_000_000n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select 10M first (enough), not 2M
      expect(result.selectedUtxos).toHaveLength(1)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(10_000_000n)
    })

    it("should maintain stable sort for equal lovelace values", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 5_000_000n, index: 0 }),
        createCoreTestUtxo({ lovelace: 5_000_000n, index: 1 }),
        createCoreTestUtxo({ lovelace: 5_000_000n, index: 2 })
      ]

      const requiredAssets = CoreAssets.fromLovelace(12_000_000n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select 3 UTxOs with equal value
      expect(result.selectedUtxos).toHaveLength(3)
      expect(result.selectedUtxos.every((u) => CoreAssets.lovelaceOf(u.assets) === 5_000_000n)).toBe(true)
    })
  })

  // ============================================================================
  // Multi-Asset Tests
  // ============================================================================

  describe("Multi-Asset Selection", () => {
    it("should select UTxOs covering multiple required assets", () => {
      const policyId = "a".repeat(56)
      const assetNameHex = "token"
        .split("")
        .map((c) => c.charCodeAt(0).toString(16))
        .join("")
      const assetUnit = `${policyId}${assetNameHex}`

      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 5_000_000n, nativeAssets: { [assetUnit]: 100n }, index: 0 }),
        createCoreTestUtxo({ lovelace: 3_000_000n, nativeAssets: { [assetUnit]: 50n }, index: 1 }),
        createCoreTestUtxo({ lovelace: 2_000_000n, index: 2 })
      ]

      const requiredAssets = CoreAssets.addByHex(CoreAssets.fromLovelace(7_000_000n), policyId, assetNameHex, 120n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select first two UTxOs (5M + 3M = 8M lovelace, 100 + 50 = 150 tokens)
      expect(result.selectedUtxos).toHaveLength(2)

      const totalAssets = result.selectedUtxos.reduce((acc, u) => CoreAssets.merge(acc, u.assets), CoreAssets.zero)

      expect(CoreAssets.lovelaceOf(totalAssets)).toBeGreaterThanOrEqual(7_000_000n)
    })

    it("should handle UTxOs with different native assets", () => {
      const policyA = "a".repeat(56)
      const policyB = "b".repeat(56)
      const assetNameA = "746f6b656e5f61" // "token_a" hex
      const assetNameB = "746f6b656e5f62" // "token_b" hex
      const tokenA = `${policyA}${assetNameA}`
      const tokenB = `${policyB}${assetNameB}`

      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 5_000_000n, nativeAssets: { [tokenA]: 100n }, index: 0 }),
        createCoreTestUtxo({ lovelace: 4_000_000n, nativeAssets: { [tokenB]: 200n }, index: 1 }),
        createCoreTestUtxo({ lovelace: 3_000_000n, nativeAssets: { [tokenA]: 50n, [tokenB]: 100n }, index: 2 })
      ]

      let requiredAssets = CoreAssets.fromLovelace(10_000_000n)
      requiredAssets = CoreAssets.addByHex(requiredAssets, policyA, assetNameA, 120n)
      requiredAssets = CoreAssets.addByHex(requiredAssets, policyB, assetNameB, 250n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select all 3 UTxOs to meet all requirements
      expect(result.selectedUtxos).toHaveLength(3)

      const totalAssets = result.selectedUtxos.reduce((acc, u) => CoreAssets.merge(acc, u.assets), CoreAssets.zero)

      expect(CoreAssets.lovelaceOf(totalAssets)).toBeGreaterThanOrEqual(10_000_000n)
    })
  })

  // ============================================================================
  // Error Cases
  // ============================================================================

  describe("Error Handling", () => {
    it("should throw CoinSelectionError when insufficient lovelace", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 1_000_000n, index: 0 }),
        createCoreTestUtxo({ lovelace: 500_000n, index: 1 })
      ]

      const requiredAssets = CoreAssets.fromLovelace(5_000_000n)

      expect(() => {
        largestFirstSelection(availableUtxos, requiredAssets)
      }).toThrow(CoinSelectionError)
    })

    it("should throw CoinSelectionError with detailed info on insufficient funds", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [createCoreTestUtxo({ lovelace: 2_000_000n, index: 0 })]

      const requiredAssets = CoreAssets.fromLovelace(10_000_000n)

      try {
        largestFirstSelection(availableUtxos, requiredAssets)
        expect.fail("Should have thrown CoinSelectionError")
      } catch (error) {
        expect(error).toBeInstanceOf(CoinSelectionError)
        const coinError = error as CoinSelectionError
        expect(coinError.message).toContain("Insufficient lovelace")
        expect(coinError.message).toContain("10000000")
        expect(coinError.message).toContain("2000000")
      }
    })

    it("should throw CoinSelectionError when insufficient native assets", () => {
      const policyId = "a".repeat(56)
      const assetNameHex = "746f6b656e" // "token" hex
      const assetUnit = `${policyId}${assetNameHex}`

      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 10_000_000n, nativeAssets: { [assetUnit]: 50n }, index: 0 }),
        createCoreTestUtxo({ lovelace: 5_000_000n, nativeAssets: { [assetUnit]: 30n }, index: 1 })
      ]

      const requiredAssets = CoreAssets.addByHex(CoreAssets.fromLovelace(5_000_000n), policyId, assetNameHex, 100n)

      try {
        largestFirstSelection(availableUtxos, requiredAssets)
        expect.fail("Should have thrown CoinSelectionError")
      } catch (error) {
        expect(error).toBeInstanceOf(CoinSelectionError)
        const coinError = error as CoinSelectionError
        expect(coinError.message).toContain("Insufficient")
      }
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle empty UTxO list", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = []

      const requiredAssets = CoreAssets.fromLovelace(1_000_000n)

      expect(() => {
        largestFirstSelection(availableUtxos, requiredAssets)
      }).toThrow(CoinSelectionError)
    })

    it("should handle zero required lovelace", () => {
      const policyId = "a".repeat(56)
      const assetNameHex = "746f6b656e" // "token" hex
      const assetUnit = `${policyId}${assetNameHex}`

      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 5_000_000n, nativeAssets: { [assetUnit]: 100n }, index: 0 })
      ]

      const requiredAssets = CoreAssets.addByHex(CoreAssets.fromLovelace(0n), policyId, assetNameHex, 50n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      expect(result.selectedUtxos).toHaveLength(1)
    })

    it("should handle UTxO with zero lovelace but has native assets", () => {
      const policyId = "a".repeat(56)
      const assetNameHex = "746f6b656e" // "token" hex
      const assetUnit = `${policyId}${assetNameHex}`

      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 0n, nativeAssets: { [assetUnit]: 100n }, index: 0 }),
        createCoreTestUtxo({ lovelace: 5_000_000n, index: 1 })
      ]

      const requiredAssets = CoreAssets.addByHex(CoreAssets.fromLovelace(2_000_000n), policyId, assetNameHex, 50n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select both (second has lovelace, first has tokens)
      expect(result.selectedUtxos.length).toBeGreaterThanOrEqual(2)
    })

    it("should handle exact match (no change needed)", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [createCoreTestUtxo({ lovelace: 5_000_000n, index: 0 })]

      const requiredAssets = CoreAssets.fromLovelace(5_000_000n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      expect(result.selectedUtxos).toHaveLength(1)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(5_000_000n)
    })

    it("should handle very large lovelace values", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 45_000_000_000_000n, index: 0 }) // 45 million ADA
      ]

      const requiredAssets = CoreAssets.fromLovelace(1_000_000_000_000n) // 1 million ADA

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      expect(result.selectedUtxos).toHaveLength(1)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(45_000_000_000_000n)
    })
  })

  // ============================================================================
  // Optimization Tests
  // ============================================================================

  describe("Algorithm Optimization", () => {
    it("should minimize number of inputs by selecting largest first", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 1_000_000n, index: 0 }),
        createCoreTestUtxo({ lovelace: 1_000_000n, index: 1 }),
        createCoreTestUtxo({ lovelace: 1_000_000n, index: 2 }),
        createCoreTestUtxo({ lovelace: 1_000_000n, index: 3 }),
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 4 }) // Large UTxO at end
      ]

      const requiredAssets = CoreAssets.fromLovelace(8_000_000n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select the single 10M UTxO, not 4x 1M UTxOs
      expect(result.selectedUtxos).toHaveLength(1)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(10_000_000n)
    })

    it("should not select more UTxOs than necessary", () => {
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 0 }),
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 1 }),
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 2 }),
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 3 }),
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 4 })
      ]

      const requiredAssets = CoreAssets.fromLovelace(25_000_000n)

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select exactly 3 UTxOs (30M >= 25M)
      expect(result.selectedUtxos).toHaveLength(3)

      const totalAssets = result.selectedUtxos.reduce((acc, u) => CoreAssets.merge(acc, u.assets), CoreAssets.zero)
      expect(CoreAssets.lovelaceOf(totalAssets)).toBe(30_000_000n)
    })
  })

  // ============================================================================
  // Integration-Ready Tests
  // ============================================================================

  describe("Integration Scenarios", () => {
    it("should work with realistic wallet UTxO set", () => {
      // Simulate a typical wallet with mixed UTxO sizes
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 50_000_000n, index: 0 }), // 50 ADA
        createCoreTestUtxo({ lovelace: 25_000_000n, index: 1 }), // 25 ADA
        createCoreTestUtxo({ lovelace: 10_000_000n, index: 2 }), // 10 ADA
        createCoreTestUtxo({ lovelace: 5_000_000n, index: 3 }), // 5 ADA
        createCoreTestUtxo({ lovelace: 2_000_000n, index: 4 }), // 2 ADA
        createCoreTestUtxo({ lovelace: 1_500_000n, index: 5 }) // 1.5 ADA
      ]

      const requiredAssets = CoreAssets.fromLovelace(30_000_000n) // Need 30 ADA

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select 50 ADA UTxO only
      expect(result.selectedUtxos).toHaveLength(1)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(50_000_000n)
    })

    it("should handle transaction with fees scenario", () => {
      // User wants to send 10 ADA, fee is ~0.2 ADA
      const availableUtxos: ReadonlyArray<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ lovelace: 15_000_000n, index: 0 }),
        createCoreTestUtxo({ lovelace: 8_000_000n, index: 1 }),
        createCoreTestUtxo({ lovelace: 5_000_000n, index: 2 })
      ]

      const requiredAssets = CoreAssets.fromLovelace(10_200_000n) // 10 ADA output + 0.2 ADA fee

      const result = largestFirstSelection(availableUtxos, requiredAssets)

      // Should select 15 ADA UTxO
      expect(result.selectedUtxos).toHaveLength(1)
      expect(CoreAssets.lovelaceOf(result.selectedUtxos[0].assets)).toBe(15_000_000n)
    })
  })
})

/**
 * Random-improve (CIP-2). The algorithm itself is covered in `Cip2.test.ts`; what matters here
 * is the adapter over `UTxO` and `Assets`: that a selection covers the target, that the UTxOs
 * handed back are the ones passed in, and that failures arrive as this module's error.
 */
describe("Random-Improve Coin Selection", () => {
  const pool: ReadonlyArray<CoreUTxO.UTxO> = [
    createCoreTestUtxo({ lovelace: 1_000_000n, index: 0 }),
    createCoreTestUtxo({ lovelace: 5_000_000n, index: 1 }),
    createCoreTestUtxo({ lovelace: 10_000_000n, index: 2 }),
    createCoreTestUtxo({ lovelace: 2_000_000n, index: 3 })
  ]

  const totalLovelace = (utxos: ReadonlyArray<CoreUTxO.UTxO>): bigint =>
    utxos.reduce((acc, u) => acc + CoreAssets.lovelaceOf(u.assets), 0n)

  it("covers the required amount", () => {
    const result = randomImproveSelection(pool, CoreAssets.fromLovelace(6_000_000n))
    expect(totalLovelace(result.selectedUtxos)).toBeGreaterThanOrEqual(6_000_000n)
  })

  it("selects only from the pool it was given, without duplicates", () => {
    const result = randomImproveSelection(pool, CoreAssets.fromLovelace(6_000_000n))
    const keys = result.selectedUtxos.map((u) => `${u.index}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const utxo of result.selectedUtxos) expect(pool).toContain(utxo)
  })

  it("is reproducible under an explicit seed", () => {
    const seeded = randomImproveSelectionWith({ seed: 42 })
    const a = seeded(pool, CoreAssets.fromLovelace(6_000_000n)).selectedUtxos.map((u) => u.index)
    const b = seeded(pool, CoreAssets.fromLovelace(6_000_000n)).selectedUtxos.map((u) => u.index)
    expect(a).toEqual(b)
  })

  it("covers a target naming a native asset as well as lovelace", () => {
    const unit = "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d4484f534b59"
    const withToken: ReadonlyArray<CoreUTxO.UTxO> = [
      ...pool,
      createCoreTestUtxo({ lovelace: 2_000_000n, index: 4, nativeAssets: { [unit]: 50n } })
    ]
    // Built through the same helper as the pool, so the unit key matches what `getUnits` emits.
    const required = createCoreTestUtxo({ lovelace: 3_000_000n, index: 9, nativeAssets: { [unit]: 10n } }).assets

    const result = randomImproveSelection(withToken, required)

    const tokenTotal = result.selectedUtxos.reduce((acc, u) => acc + CoreAssets.getByUnit(u.assets, unit), 0n)
    expect(tokenTotal).toBeGreaterThanOrEqual(10n)
    expect(totalLovelace(result.selectedUtxos)).toBeGreaterThanOrEqual(3_000_000n)
  })

  it("reports an uncoverable target as a CoinSelectionError", () => {
    expect(() => randomImproveSelection(pool, CoreAssets.fromLovelace(999_000_000n))).toThrow(CoinSelectionError)
  })

  it("covers the target across many seeds, not just a lucky one", () => {
    const seeds = Array.from({ length: 50 }, (_, i) => i)
    for (const seed of seeds) {
      const result = randomImproveSelectionWith({ seed })(pool, CoreAssets.fromLovelace(7_000_000n))
      expect(totalLovelace(result.selectedUtxos)).toBeGreaterThanOrEqual(7_000_000n)
    }
  })
})
