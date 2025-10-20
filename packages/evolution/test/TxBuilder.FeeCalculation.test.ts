import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import type * as Assets from "../src/sdk/Assets.js"
import {
  calculateLeftoverAssets,
  calculateMinimumFee,
  validateTransactionBalance
} from "../src/sdk/builders/TxBuilderImpl.js"

/**
 * Unit tests for fee calculation and balance validation functions.
 * Tests the minimal build implementation with accurate fee calculation.
 */
describe("TxBuilder Fee Calculation", () => {
  
  const testProtocolParams = {
    minFeeCoefficient: 44n,
    minFeeConstant: 155381n
  }
  
  // ============================================================================
  // calculateMinimumFee Tests
  // ============================================================================
  
  describe("calculateMinimumFee", () => {
    it("should calculate fee using linear formula", () => {
      const txSize = 300
      const fee = calculateMinimumFee(txSize, testProtocolParams)
      
      // fee = (300 * 44) + 155381 = 13200 + 155381 = 168581
      expect(fee).toBe(168581n)
    })
    
    it("should return constant fee for zero-size transaction", () => {
      const fee = calculateMinimumFee(0, testProtocolParams)
      
      expect(fee).toBe(testProtocolParams.minFeeConstant)
    })
    
    it("should scale linearly with size", () => {
      const fee1 = calculateMinimumFee(100, testProtocolParams)
      const fee2 = calculateMinimumFee(200, testProtocolParams)
      
      // fee2 - fee1 should equal 100 * coefficient
      expect(fee2 - fee1).toBe(100n * testProtocolParams.minFeeCoefficient)
    })
    
    it("should handle large transaction sizes", () => {
      const fee = calculateMinimumFee(16384, testProtocolParams) // Max tx size
      
      // fee = (16384 * 44) + 155381 = 720896 + 155381 = 876277
      expect(fee).toBe(876277n)
    })
    
    it("should handle different protocol parameters", () => {
      const customParams = {
        minFeeCoefficient: 100n,
        minFeeConstant: 200000n
      }
      
      const fee = calculateMinimumFee(500, customParams)
      
      // fee = (500 * 100) + 200000 = 50000 + 200000 = 250000
      expect(fee).toBe(250000n)
    })
  })
  
  // ============================================================================
  // validateTransactionBalance Tests
  // ============================================================================
  
  describe("validateTransactionBalance", () => {
    it("should succeed when inputs cover outputs + fee", async () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const fee = 200_000n
      
      const result = await Effect.runPromise(
        validateTransactionBalance({
          fee,
          totalInputAssets,
          totalOutputAssets
        })
      )
      
      // Should not throw
      expect(result).toBeUndefined()
    })
    
    it("should fail when inputs don't cover lovelace", async () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 1_000_000n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const fee = 200_000n
      
      try {
        await Effect.runPromise(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )
        // Should not reach here
        expect.fail("Expected validation to fail")
      } catch (error) {
        // Check error message contains "Insufficient lovelace"
        expect(String(error)).toMatch(/Insufficient lovelace/)
      }
    })
    
    it("should fail when inputs don't cover native assets", async () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n,
        "policy1.asset1": 100n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n,
        "policy1.asset1": 500n // More than available
      }
      
      const fee = 200_000n
      
      try {
        await Effect.runPromise(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )
        expect.fail("Expected validation to fail")
      } catch (error) {
        expect(String(error)).toMatch(/Insufficient policy1\.asset1/)
      }
    })
    
    it("should account for fee in lovelace requirement", async () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 5_200_000n // Exactly outputs + fee
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const fee = 200_000n
      
      const result = await Effect.runPromise(
        validateTransactionBalance({
          fee,
          totalInputAssets,
          totalOutputAssets
        })
      )
      
      expect(result).toBeUndefined()
    })
    
    it("should fail when inputs are exactly 1 lovelace short", async () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 5_199_999n // 1 short
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const fee = 200_000n
      
      try {
        await Effect.runPromise(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )
        expect.fail("Expected validation to fail")
      } catch (error) {
        expect(String(error)).toMatch(/Insufficient lovelace.*short by 1/)
      }
    })
    
    it("should succeed with zero fee", async () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const fee = 0n
      
      const result = await Effect.runPromise(
        validateTransactionBalance({
          fee,
          totalInputAssets,
          totalOutputAssets
        })
      )
      
      expect(result).toBeUndefined()
    })
    
    it("should handle multiple native assets", async () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n,
        "policy1.asset1": 1000n,
        "policy2.asset2": 500n,
        "policy3.asset3": 250n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n,
        "policy1.asset1": 900n,
        "policy2.asset2": 400n,
        "policy3.asset3": 200n
      }
      
      const fee = 200_000n
      
      const result = await Effect.runPromise(
        validateTransactionBalance({
          fee,
          totalInputAssets,
          totalOutputAssets
        })
      )
      
      expect(result).toBeUndefined()
    })
    
    it("should handle assets that exist in outputs but not inputs", async () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n,
        "policy1.asset1": 100n // Not in inputs
      }
      
      const fee = 200_000n
      
      try {
        await Effect.runPromise(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )
        expect.fail("Expected validation to fail")
      } catch (error) {
        expect(String(error)).toMatch(/Insufficient policy1\.asset1/)
      }
    })
  })
  
  // ============================================================================
  // calculateLeftoverAssets Tests
  // ============================================================================
  
  describe("calculateLeftoverAssets", () => {
    it("should calculate leftover lovelace", () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const fee = 200_000n
      
      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })
      
      // 10M - 5M - 200k = 4.8M
      expect(leftover.lovelace).toBe(4_800_000n)
    })
    
    it("should calculate leftover native assets", () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n,
        "policy1.asset1": 1000n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n,
        "policy1.asset1": 700n
      }
      
      const fee = 200_000n
      
      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })
      
      expect(leftover.lovelace).toBe(4_800_000n)
      expect(leftover["policy1.asset1"]).toBe(300n)
    })
    
    it("should return empty object when exact match", () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 5_200_000n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n
      }
      
      const fee = 200_000n
      
      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })
      
      // Leftover lovelace should be 0 (inputs - outputs - fee = 5.2M - 5M - 0.2M = 0)
      expect(leftover.lovelace).toBe(0n)
      // Should only have lovelace key (no other assets)
      expect(Object.keys(leftover).filter(k => k !== 'lovelace')).toHaveLength(0)
    })
    
    it("should handle zero leftover for native assets", () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n,
        "policy1.asset1": 700n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n,
        "policy1.asset1": 700n
      }
      
      const fee = 200_000n
      
      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })
      
      expect(leftover.lovelace).toBe(4_800_000n)
      expect(leftover["policy1.asset1"]).toBeUndefined()
    })
    
    it("should calculate leftover for multiple assets", () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n,
        "policy1.asset1": 1000n,
        "policy2.asset2": 500n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n,
        "policy1.asset1": 600n,
        "policy2.asset2": 300n
      }
      
      const fee = 200_000n
      
      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })
      
      expect(leftover.lovelace).toBe(4_800_000n)
      expect(leftover["policy1.asset1"]).toBe(400n)
      expect(leftover["policy2.asset2"]).toBe(200n)
    })
    
    it("should only include assets with non-zero leftover", () => {
      const totalInputAssets: Assets.Assets = {
        lovelace: 10_000_000n,
        "policy1.asset1": 1000n,
        "policy2.asset2": 500n,
        "policy3.asset3": 300n
      }
      
      const totalOutputAssets: Assets.Assets = {
        lovelace: 5_000_000n,
        "policy1.asset1": 1000n, // Exact match
        "policy2.asset2": 500n,  // Exact match
        "policy3.asset3": 200n   // Has leftover
      }
      
      const fee = 200_000n
      
      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })
      
      expect(leftover.lovelace).toBe(4_800_000n)
      expect(leftover["policy1.asset1"]).toBeUndefined()
      expect(leftover["policy2.asset2"]).toBeUndefined()
      expect(leftover["policy3.asset3"]).toBe(100n)
    })
  })
})

