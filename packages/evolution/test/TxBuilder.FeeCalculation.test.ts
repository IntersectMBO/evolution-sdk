import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type * as Assets from "../src/sdk/Assets.js"
import {
  calculateLeftoverAssets,
  calculateMinimumFee,
  validateTransactionBalance
} from "../src/sdk/builders/TxBuilderImpl.js"

describe("TxBuilder Fee Calculation", () => {
  const testProtocolParams = {
    minFeeCoefficient: 44n,
    minFeeConstant: 155381n
  }

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
    it.effect("should succeed when inputs cover outputs + fee", () =>
      Effect.gen(function* () {
        const totalInputAssets: Assets.Assets = {
          lovelace: 10_000_000n
        }

        const totalOutputAssets: Assets.Assets = {
          lovelace: 5_000_000n
        }

        const fee = 200_000n

        const result = yield* validateTransactionBalance({
          fee,
          totalInputAssets,
          totalOutputAssets
        })

        // Should not throw
        expect(result).toBeUndefined()
      })
    )

    it.effect("should fail when inputs don't cover lovelace", () =>
      Effect.gen(function* () {
        const totalInputAssets: Assets.Assets = {
          lovelace: 1_000_000n
        }

        const totalOutputAssets: Assets.Assets = {
          lovelace: 5_000_000n
        }

        const fee = 200_000n

        const result = yield* Effect.flip(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )

        // Check error message contains "Insufficient lovelace"
        expect(String(result)).toMatch(/Insufficient lovelace/)
      })
    )

    it.effect("should fail when inputs don't cover native assets", () =>
      Effect.gen(function* () {
        const totalInputAssets: Assets.Assets = {
          lovelace: 10_000_000n,
          "policy1.asset1": 100n
        }

        const totalOutputAssets: Assets.Assets = {
          lovelace: 5_000_000n,
          "policy1.asset1": 500n // More than available
        }

        const fee = 200_000n

        const result = yield* Effect.flip(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )

        expect(String(result)).toMatch(/Insufficient policy1\.asset1/)
      })
    )

    it.effect("should account for fee in lovelace requirement", () =>
      Effect.gen(function* () {
        const totalInputAssets: Assets.Assets = {
          lovelace: 5_200_000n // Exactly outputs + fee
        }

        const totalOutputAssets: Assets.Assets = {
          lovelace: 5_000_000n
        }

        const fee = 200_000n

        const result = yield* validateTransactionBalance({
          fee,
          totalInputAssets,
          totalOutputAssets
        })

        expect(result).toBeUndefined()
      })
    )

    it.effect("should fail when inputs are exactly 1 lovelace short", () =>
      Effect.gen(function* () {
        const totalInputAssets: Assets.Assets = {
          lovelace: 5_199_999n // 1 short
        }

        const totalOutputAssets: Assets.Assets = {
          lovelace: 5_000_000n
        }

        const fee = 200_000n

        const result = yield* Effect.flip(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )

        expect(String(result)).toMatch(/Insufficient lovelace.*short by 1/)
      })
    )

    it.effect("should succeed with zero fee", () =>
      Effect.gen(function* () {
        const totalInputAssets: Assets.Assets = {
          lovelace: 5_000_000n
        }

        const totalOutputAssets: Assets.Assets = {
          lovelace: 5_000_000n
        }

        const fee = 0n

        const result = yield* validateTransactionBalance({
          fee,
          totalInputAssets,
          totalOutputAssets
        })

        expect(result).toBeUndefined()
      })
    )

    it.effect("should handle multiple native assets", () =>
      Effect.gen(function* () {
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

        const result = yield* validateTransactionBalance({
          fee,
          totalInputAssets,
          totalOutputAssets
        })

        expect(result).toBeUndefined()
      })
    )

    it.effect("should handle assets that exist in outputs but not inputs", () =>
      Effect.gen(function* () {
        const totalInputAssets: Assets.Assets = {
          lovelace: 10_000_000n
        }

        const totalOutputAssets: Assets.Assets = {
          lovelace: 5_000_000n,
          "policy1.asset1": 100n // Not in inputs
        }

        const fee = 200_000n

        const result = yield* Effect.flip(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )

        expect(String(result)).toMatch(/Insufficient policy1\.asset1/)
      })
    )
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
      expect(Object.keys(leftover).filter((k) => k !== "lovelace")).toHaveLength(0)
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
        "policy2.asset2": 500n, // Exact match
        "policy3.asset3": 200n // Has leftover
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
