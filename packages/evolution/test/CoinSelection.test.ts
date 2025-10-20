import { describe, expect, it } from "vitest"

import type * as Assets from "../src/sdk/Assets.js"
import { CoinSelectionError, largestFirstSelection } from "../src/sdk/builders/CoinSelection.js"
import type * as UTxO from "../src/sdk/UTxO.js"
import { createTestUtxo } from "./utils/utxo-helpers.js"

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
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 0 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      expect(result.selectedUtxos).toHaveLength(1)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(10_000_000n)
    })
    
    it("should select multiple UTxOs when single is insufficient", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 3_000_000n, outputIndex: 0 }),
        createTestUtxo({ lovelace: 2_000_000n, outputIndex: 1 }),
        createTestUtxo({ lovelace: 1_000_000n, outputIndex: 2 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 5_500_000n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select largest first (3M + 2M + 1M = 6M >= 5.5M)
      expect(result.selectedUtxos).toHaveLength(3)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(3_000_000n)
      expect(result.selectedUtxos[1].assets.lovelace).toBe(2_000_000n)
      expect(result.selectedUtxos[2].assets.lovelace).toBe(1_000_000n)
    })
    
    it("should select exactly enough UTxOs (stops when requirements met)", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 0 }),
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 1 }),
        createTestUtxo({ lovelace: 3_000_000n, outputIndex: 2 }),
        createTestUtxo({ lovelace: 1_000_000n, outputIndex: 3 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 12_000_000n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select 10M + 5M = 15M (stops after 2nd UTxO)
      expect(result.selectedUtxos).toHaveLength(2)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(10_000_000n)
      expect(result.selectedUtxos[1].assets.lovelace).toBe(5_000_000n)
    })
  })
  
  // ============================================================================
  // Sorting Behavior Tests
  // ============================================================================
  
  describe("Sorting Behavior", () => {
    it("should select largest UTxOs first", () => {
      // Intentionally unsorted input
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 2_000_000n, outputIndex: 0 }),
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 1 }),
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 2 }),
        createTestUtxo({ lovelace: 1_000_000n, outputIndex: 3 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 8_000_000n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select 10M first (enough), not 2M
      expect(result.selectedUtxos).toHaveLength(1)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(10_000_000n)
    })
    
    it("should maintain stable sort for equal lovelace values", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 0 }),
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 1 }),
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 2 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 12_000_000n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select 3 UTxOs with equal value
      expect(result.selectedUtxos).toHaveLength(3)
      expect(result.selectedUtxos.every(u => u.assets.lovelace === 5_000_000n)).toBe(true)
    })
  })
  
  // ============================================================================
  // Multi-Asset Tests
  // ============================================================================
  
  describe("Multi-Asset Selection", () => {
    it("should select UTxOs covering multiple required assets", () => {
      const policyId = "a".repeat(56)
      const assetUnit = `${policyId}${"token".split("").map(c => c.charCodeAt(0).toString(16)).join("")}`
      
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 5_000_000n, nativeAssets: { [assetUnit]: 100n }, outputIndex: 0 }),
        createTestUtxo({ lovelace: 3_000_000n, nativeAssets: { [assetUnit]: 50n }, outputIndex: 1 }),
        createTestUtxo({ lovelace: 2_000_000n, outputIndex: 2 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 7_000_000n,
        [assetUnit]: 120n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select first two UTxOs (5M + 3M = 8M lovelace, 100 + 50 = 150 tokens)
      expect(result.selectedUtxos).toHaveLength(2)
      
      const totalLovelace = result.selectedUtxos.reduce((sum, u) => sum + u.assets.lovelace, 0n)
      const totalTokens = result.selectedUtxos.reduce((sum, u) => sum + (u.assets[assetUnit] || 0n), 0n)
      
      expect(totalLovelace).toBeGreaterThanOrEqual(7_000_000n)
      expect(totalTokens).toBeGreaterThanOrEqual(120n)
    })
    
    it("should handle UTxOs with different native assets", () => {
      const policyA = "a".repeat(56)
      const policyB = "b".repeat(56)
      const tokenA = `${policyA}token_a`
      const tokenB = `${policyB}token_b`
      
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 5_000_000n, nativeAssets: { [tokenA]: 100n }, outputIndex: 0 }),
        createTestUtxo({ lovelace: 4_000_000n, nativeAssets: { [tokenB]: 200n }, outputIndex: 1 }),
        createTestUtxo({ lovelace: 3_000_000n, nativeAssets: { [tokenA]: 50n, [tokenB]: 100n }, outputIndex: 2 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 10_000_000n,
        [tokenA]: 120n,
        [tokenB]: 250n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select all 3 UTxOs to meet all requirements
      expect(result.selectedUtxos).toHaveLength(3)
      
      const accumulated = result.selectedUtxos.reduce((acc, utxo) => {
        for (const [unit, amount] of Object.entries(utxo.assets)) {
          acc[unit] = (acc[unit] || 0n) + (amount as bigint)
        }
        return acc
      }, {} as Record<string, bigint>)
      
      expect(accumulated.lovelace).toBeGreaterThanOrEqual(10_000_000n)
      expect(accumulated[tokenA]).toBeGreaterThanOrEqual(120n)
      expect(accumulated[tokenB]).toBeGreaterThanOrEqual(250n)
    })
  })
  
  // ============================================================================
  // Error Cases
  // ============================================================================
  
  describe("Error Handling", () => {
    it("should throw CoinSelectionError when insufficient lovelace", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 1_000_000n, outputIndex: 0 }),
        createTestUtxo({ lovelace: 500_000n, outputIndex: 1 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      expect(() => {
        largestFirstSelection(availableUtxos, requiredAssets)
      }).toThrow(CoinSelectionError)
    })
    
    it("should throw CoinSelectionError with detailed info on insufficient funds", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 2_000_000n, outputIndex: 0 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 10_000_000n
      }
      
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
      const assetUnit = `${policyId}token`
      
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 10_000_000n, nativeAssets: { [assetUnit]: 50n }, outputIndex: 0 }),
        createTestUtxo({ lovelace: 5_000_000n, nativeAssets: { [assetUnit]: 30n }, outputIndex: 1 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 5_000_000n,
        [assetUnit]: 100n
      }
      
      try {
        largestFirstSelection(availableUtxos, requiredAssets)
        expect.fail("Should have thrown CoinSelectionError")
      } catch (error) {
        expect(error).toBeInstanceOf(CoinSelectionError)
        const coinError = error as CoinSelectionError
        expect(coinError.message).toContain("Insufficient")
        expect(coinError.message).toContain(assetUnit)
      }
    })
  })
  
  // ============================================================================
  // Edge Cases
  // ============================================================================
  
  describe("Edge Cases", () => {
    it("should handle empty UTxO list", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = []
      
      const requiredAssets: Assets.Assets = {
        lovelace: 1_000_000n
      }
      
      expect(() => {
        largestFirstSelection(availableUtxos, requiredAssets)
      }).toThrow(CoinSelectionError)
    })
    
    it("should handle zero required lovelace", () => {
      const policyId = "a".repeat(56)
      const assetUnit = `${policyId}token`
      
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 5_000_000n, nativeAssets: { [assetUnit]: 100n }, outputIndex: 0 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 0n,
        [assetUnit]: 50n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      expect(result.selectedUtxos).toHaveLength(1)
    })
    
    it("should handle UTxO with zero lovelace but has native assets", () => {
      const policyId = "a".repeat(56)
      const assetUnit = `${policyId}token`
      
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 0n, nativeAssets: { [assetUnit]: 100n }, outputIndex: 0 }),
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 1 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 2_000_000n,
        [assetUnit]: 50n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select both (second has lovelace, first has tokens)
      expect(result.selectedUtxos.length).toBeGreaterThanOrEqual(2)
    })
    
    it("should handle exact match (no change needed)", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 0 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      expect(result.selectedUtxos).toHaveLength(1)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(5_000_000n)
    })
    
    it("should handle very large lovelace values", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 45_000_000_000_000n, outputIndex: 0 }) // 45 million ADA
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 1_000_000_000_000n // 1 million ADA
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      expect(result.selectedUtxos).toHaveLength(1)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(45_000_000_000_000n)
    })
  })
  
  // ============================================================================
  // Optimization Tests
  // ============================================================================
  
  describe("Algorithm Optimization", () => {
    it("should minimize number of inputs by selecting largest first", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 1_000_000n, outputIndex: 0 }),
        createTestUtxo({ lovelace: 1_000_000n, outputIndex: 1 }),
        createTestUtxo({ lovelace: 1_000_000n, outputIndex: 2 }),
        createTestUtxo({ lovelace: 1_000_000n, outputIndex: 3 }),
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 4 }) // Large UTxO at end
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 8_000_000n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select the single 10M UTxO, not 4x 1M UTxOs
      expect(result.selectedUtxos).toHaveLength(1)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(10_000_000n)
    })
    
    it("should not select more UTxOs than necessary", () => {
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 0 }),
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 1 }),
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 2 }),
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 3 }),
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 4 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 25_000_000n
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select exactly 3 UTxOs (30M >= 25M)
      expect(result.selectedUtxos).toHaveLength(3)
      
      const total = result.selectedUtxos.reduce((sum, u) => sum + u.assets.lovelace, 0n)
      expect(total).toBe(30_000_000n)
    })
  })
  
  // ============================================================================
  // Integration-Ready Tests
  // ============================================================================
  
  describe("Integration Scenarios", () => {
    it("should work with realistic wallet UTxO set", () => {
      // Simulate a typical wallet with mixed UTxO sizes
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 50_000_000n, outputIndex: 0 }),  // 50 ADA
        createTestUtxo({ lovelace: 25_000_000n, outputIndex: 1 }),  // 25 ADA
        createTestUtxo({ lovelace: 10_000_000n, outputIndex: 2 }),  // 10 ADA
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 3 }),   // 5 ADA
        createTestUtxo({ lovelace: 2_000_000n, outputIndex: 4 }),   // 2 ADA
        createTestUtxo({ lovelace: 1_500_000n, outputIndex: 5 })    // 1.5 ADA
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 30_000_000n  // Need 30 ADA
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select 50 ADA UTxO only
      expect(result.selectedUtxos).toHaveLength(1)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(50_000_000n)
    })
    
    it("should handle transaction with fees scenario", () => {
      // User wants to send 10 ADA, fee is ~0.2 ADA
      const availableUtxos: ReadonlyArray<UTxO.UTxO> = [
        createTestUtxo({ lovelace: 15_000_000n, outputIndex: 0 }),
        createTestUtxo({ lovelace: 8_000_000n, outputIndex: 1 }),
        createTestUtxo({ lovelace: 5_000_000n, outputIndex: 2 })
      ]
      
      const requiredAssets: Assets.Assets = {
        lovelace: 10_200_000n  // 10 ADA output + 0.2 ADA fee
      }
      
      const result = largestFirstSelection(availableUtxos, requiredAssets)
      
      // Should select 15 ADA UTxO
      expect(result.selectedUtxos).toHaveLength(1)
      expect(result.selectedUtxos[0].assets.lovelace).toBe(15_000_000n)
    })
  })
})
