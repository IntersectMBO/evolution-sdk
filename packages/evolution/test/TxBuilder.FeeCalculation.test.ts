import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Fees from "../src/Fees.js"
import * as NonnegativeInterval from "../src/NonnegativeInterval.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as CoreScript from "../src/Script.js"
import {
  calculateLeftoverAssets,
  calculateMinimumFee,
  calculateReferenceScriptFee,
  tierRefScriptFee,
  validateTransactionBalance
} from "../src/sdk/builders/internal/txBuilder.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as CoreUTxO from "../src/UTxO.js"

// Test policy IDs (56 hex chars = 28 bytes each)
const POLICY1 = "aa".repeat(28) // aaaa...aa (56 chars)
const POLICY2 = "bb".repeat(28) // bbbb...bb (56 chars)
const POLICY3 = "cc".repeat(28) // cccc...cc (56 chars)

// Test asset names (hex encoded)
const ASSET1 = "617373657431" // "asset1" in hex
const ASSET2 = "617373657432" // "asset2" in hex
const ASSET3 = "617373657433" // "asset3" in hex

// Full unit strings (policyId + assetName)
const UNIT1 = `${POLICY1}${ASSET1}`
const UNIT2 = `${POLICY2}${ASSET2}`
const UNIT3 = `${POLICY3}${ASSET3}`

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
        const totalInputAssets = CoreAssets.fromRecord({
          lovelace: 10_000_000n
        })

        const totalOutputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n
        })

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
        const totalInputAssets = CoreAssets.fromRecord({
          lovelace: 1_000_000n
        })

        const totalOutputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n
        })

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
        const totalInputAssets = CoreAssets.fromRecord({
          lovelace: 10_000_000n,
          [UNIT1]: 100n
        })

        const totalOutputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n,
          [UNIT1]: 500n // More than available
        })

        const fee = 200_000n

        const result = yield* Effect.flip(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )

        // The unit name will be the full hex policyId+assetName, not the dot format
        expect(String(result)).toMatch(/Insufficient/)
      })
    )

    it.effect("should account for fee in lovelace requirement", () =>
      Effect.gen(function* () {
        const totalInputAssets = CoreAssets.fromRecord({
          lovelace: 5_200_000n // Exactly outputs + fee
        })

        const totalOutputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n
        })

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
        const totalInputAssets = CoreAssets.fromRecord({
          lovelace: 5_199_999n // 1 short
        })

        const totalOutputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n
        })

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
        const totalInputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n
        })

        const totalOutputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n
        })

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
        const totalInputAssets = CoreAssets.fromRecord({
          lovelace: 10_000_000n,
          [UNIT1]: 1000n,
          [UNIT2]: 500n,
          [UNIT3]: 250n
        })

        const totalOutputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n,
          [UNIT1]: 900n,
          [UNIT2]: 400n,
          [UNIT3]: 200n
        })

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
        const totalInputAssets = CoreAssets.fromRecord({
          lovelace: 10_000_000n
        })

        const totalOutputAssets = CoreAssets.fromRecord({
          lovelace: 5_000_000n,
          [UNIT1]: 100n // Not in inputs
        })

        const fee = 200_000n

        const result = yield* Effect.flip(
          validateTransactionBalance({
            fee,
            totalInputAssets,
            totalOutputAssets
          })
        )

        // The unit name will be the full hex policyId+assetName, not the dot format
        expect(String(result)).toMatch(/Insufficient/)
      })
    )
  })

  // ============================================================================
  // calculateLeftoverAssets Tests
  // ============================================================================

  describe("calculateLeftoverAssets", () => {
    it("should calculate leftover lovelace", () => {
      const totalInputAssets = CoreAssets.fromRecord({
        lovelace: 10_000_000n
      })

      const totalOutputAssets = CoreAssets.fromRecord({
        lovelace: 5_000_000n
      })

      const fee = 200_000n

      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })

      // 10M - 5M - 200k = 4.8M
      expect(CoreAssets.lovelaceOf(leftover)).toBe(4_800_000n)
    })

    it("should calculate leftover native assets", () => {
      const totalInputAssets = CoreAssets.fromRecord({
        lovelace: 10_000_000n,
        [UNIT1]: 1000n
      })

      const totalOutputAssets = CoreAssets.fromRecord({
        lovelace: 5_000_000n,
        [UNIT1]: 700n
      })

      const fee = 200_000n

      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })

      expect(CoreAssets.lovelaceOf(leftover)).toBe(4_800_000n)
      // Native asset leftover: 1000 - 700 = 300
      const units = CoreAssets.getUnits(leftover)
      expect(units.length).toBe(2) // lovelace + 1 native asset
    })

    it("should return empty object when exact match", () => {
      const totalInputAssets = CoreAssets.fromRecord({
        lovelace: 5_200_000n
      })

      const totalOutputAssets = CoreAssets.fromRecord({
        lovelace: 5_000_000n
      })

      const fee = 200_000n

      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })

      // Leftover lovelace should be 0 (inputs - outputs - fee = 5.2M - 5M - 0.2M = 0)
      expect(CoreAssets.lovelaceOf(leftover)).toBe(0n)
      // Should only have lovelace unit (no native assets)
      expect(CoreAssets.getUnits(leftover).length).toBe(1)
    })

    it("should handle zero leftover for native assets", () => {
      const totalInputAssets = CoreAssets.fromRecord({
        lovelace: 10_000_000n,
        [UNIT1]: 700n
      })

      const totalOutputAssets = CoreAssets.fromRecord({
        lovelace: 5_000_000n,
        [UNIT1]: 700n
      })

      const fee = 200_000n

      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })

      expect(CoreAssets.lovelaceOf(leftover)).toBe(4_800_000n)
      // Native asset is exact match so should be filtered out
      expect(CoreAssets.getUnits(leftover).length).toBe(1) // only lovelace
    })

    it("should calculate leftover for multiple assets", () => {
      const totalInputAssets = CoreAssets.fromRecord({
        lovelace: 10_000_000n,
        [UNIT1]: 1000n,
        [UNIT2]: 500n
      })

      const totalOutputAssets = CoreAssets.fromRecord({
        lovelace: 5_000_000n,
        [UNIT1]: 600n,
        [UNIT2]: 300n
      })

      const fee = 200_000n

      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })

      expect(CoreAssets.lovelaceOf(leftover)).toBe(4_800_000n)
      // Both native assets have leftover: 1000-600=400, 500-300=200
      expect(CoreAssets.getUnits(leftover).length).toBe(3) // lovelace + 2 native assets
    })

    it("should only include assets with non-zero leftover", () => {
      const totalInputAssets = CoreAssets.fromRecord({
        lovelace: 10_000_000n,
        [UNIT1]: 1000n,
        [UNIT2]: 500n,
        [UNIT3]: 300n
      })

      const totalOutputAssets = CoreAssets.fromRecord({
        lovelace: 5_000_000n,
        [UNIT1]: 1000n, // Exact match
        [UNIT2]: 500n, // Exact match
        [UNIT3]: 200n // Has leftover
      })

      const fee = 200_000n

      const leftover = calculateLeftoverAssets({
        fee,
        totalInputAssets,
        totalOutputAssets
      })

      expect(CoreAssets.lovelaceOf(leftover)).toBe(4_800_000n)
      // Only policy3.asset3 has leftover (300-200=100), others are exact match
      expect(CoreAssets.getUnits(leftover).length).toBe(2) // lovelace + policy3.asset3
    })
  })

  // ---------------------------------------------------------------------------
  // tierRefScriptFee — direct port of cardano-ledger's tierRefScriptFee
  // ---------------------------------------------------------------------------
  describe("scriptExecutionFee", () => {
    // The Conway prices, exactly: neither is representable in binary floating point.
    const priceMem = NonnegativeInterval.fromDecimal(0.0577)
    const priceStep = NonnegativeInterval.fromDecimal(0.0000721)

    it("combines the two prices BEFORE the single ceiling", () => {
      // 0.0577 × 1,500,000 + 0.0000721 × 300,000,000 = 86,550 + 21,630 = 108,180 exactly.
      expect(Fees.scriptExecutionFee(priceMem, priceStep, 1_500_000n, 300_000_000n)).toBe(108_180n)
    })

    it("rounds the combined total up once, not each term", () => {
      // 0.0577 × 1 + 0.0000721 × 1 = 0.0577721 → 1. Ceiling each term separately gives 2.
      expect(Fees.scriptExecutionFee(priceMem, priceStep, 1n, 1n)).toBe(1n)
    })

    it("charges a transaction's TOTAL units, not each redeemer separately", () => {
      // ⚠️ The shape that was wrong before. Three redeemers, ceiling applied per term per
      // redeemer, came out four lovelace above the ledger's figure for the same transaction —
      // the ledger charges `ceiling(priceMem × totalMem + priceStep × totalSteps)` over the
      // summed execution units.
      const redeemers = [
        { mem: 1_400_001n, steps: 300_000_001n },
        { mem: 500_003n, steps: 120_000_007n },
        { mem: 7_777n, steps: 9_999_991n }
      ]
      const totalMem = redeemers.reduce((sum, r) => sum + r.mem, 0n)
      const totalSteps = redeemers.reduce((sum, r) => sum + r.steps, 0n)

      const overTheTotal = Fees.scriptExecutionFee(priceMem, priceStep, totalMem, totalSteps)
      const perRedeemerPerTerm = redeemers.reduce(
        (sum, r) => sum + BigInt(Math.ceil(0.0577 * Number(r.mem))) + BigInt(Math.ceil(0.0000721 * Number(r.steps))),
        0n
      )

      expect(overTheTotal).toBe(141_082n)
      expect(perRedeemerPerTerm - overTheTotal).toBe(4n)
    })

    it("charges nothing for a transaction that runs no scripts", () => {
      expect(Fees.scriptExecutionFee(priceMem, priceStep, 0n, 0n)).toBe(0n)
    })
  })

  describe("tierRefScriptFee", () => {
    const MULTIPLIER = 1.2
    const STRIDE = 25_600
    const BASE = 44 // minFeeRefScriptCostPerByte on devnet

    it("should return 0 for 0 bytes", () => {
      expect(tierRefScriptFee(MULTIPLIER, STRIDE, BASE, 0)).toBe(0n)
    })

    it("should use base price for scripts within first tier", () => {
      // 132 bytes × 44 = 5808
      expect(tierRefScriptFee(MULTIPLIER, STRIDE, BASE, 132)).toBe(5808n)
    })

    it("should handle exactly one full tier", () => {
      // 25600 × 44 = 1,126,400
      expect(tierRefScriptFee(MULTIPLIER, STRIDE, BASE, 25_600)).toBe(1_126_400n)
    })

    it("should apply 1.2× multiplier for second tier", () => {
      // tier1: 25600 × 44 = 1,126,400
      // tier2: 1 × 52.8 = 52.8
      // floor(1,126,452.8) = 1,126,452
      expect(tierRefScriptFee(MULTIPLIER, STRIDE, BASE, 25_601)).toBe(1_126_452n)
    })

    it("should handle two full tiers", () => {
      // tier1: 25600 × 44 = 1,126,400
      // tier2: 25600 × 52.8 = 1,351,680
      // floor(2,478,080) = 2,478,080
      expect(tierRefScriptFee(MULTIPLIER, STRIDE, BASE, 51_200)).toBe(2_478_080n)
    })

    it("accumulates the tiers EXACTLY, where a double accumulation lands a lovelace low", () => {
      // ⚠️ The reason this is rational arithmetic and not `number` arithmetic. From the third
      // tier on the per-byte price stops being an integer (44 × 1.2 × 1.2 = 63.36), and a
      // double accumulation drifts off the exact value. At the cost-per-byte this module
      // defaults to when the protocol parameter is absent — 44 — it came out ONE LOVELACE
      // BELOW the exact figure at 51 of the 204,800 permitted sizes. Below a fee minimum is a
      // rejected transaction, not a rounding curiosity.
      //
      // Reproduced 2026-10-09: exact 6,057,920 vs 6,057,919 from the double accumulation.
      expect(tierRefScriptFee(1.2, STRIDE, 44, 102_525)).toBe(6_057_920n)
      // Two more of the 51, at other cost-per-byte values.
      expect(tierRefScriptFee(1.2, STRIDE, 44.123, 66_950)).toBe(3_485_717n)
      expect(tierRefScriptFee(1.2, STRIDE, 0.0577, 60_700)).toBe(4_039n)
    })

    it("reads the multiplier as the decimal it was given, not as the double it became", () => {
      // 1.2 as a double is 1.19999999999999995559…, and the ledger's multiplier is six fifths.
      // Over eight tiers the difference compounds, so the price is built from 6/5.
      expect(tierRefScriptFee(1.2, STRIDE, 1, 25_600 * 2)).toBe(tierRefScriptFee("1.2" as never, STRIDE, 1, 25_600 * 2))
      // tier1: 25600 × 1 = 25,600; tier2: 25600 × 6/5 = 30,720.
      expect(tierRefScriptFee(1.2, STRIDE, 1, 25_600 * 2)).toBe(56_320n)
    })

    it("charges nothing for no reference scripts, rather than a base-rate minimum", () => {
      expect(tierRefScriptFee(MULTIPLIER, STRIDE, BASE, 0)).toBe(0n)
    })

    it("keeps a fractional cost-per-byte exact", () => {
      // A third of a lovelace per byte over 300 bytes is exactly 100 — not a float's 99.999…
      expect(
        Fees.refScriptFee(300n, new NonnegativeInterval.NonnegativeInterval({ numerator: 1n, denominator: 3n }))
      ).toBe(100n)
    })

    it("is monotonic across a tier boundary", () => {
      // A fee that dips as the size grows is the signature of a tier applied to the wrong chunk.
      const rate = NonnegativeInterval.fromDecimal(15)
      let previous = -1n
      for (const size of [25_598n, 25_599n, 25_600n, 25_601n, 25_602n]) {
        const fee = Fees.refScriptFee(size, rate)
        expect(fee).toBeGreaterThan(previous)
        previous = fee
      }
    })

    it("refuses a size the ledger forbids rather than pricing it", () => {
      // maxRefScriptSizePerTx is 200 KiB in Conway. Above it there is no valid transaction to
      // charge for, so reporting a number would be answering a question that cannot arise.
      const rate = NonnegativeInterval.fromDecimal(15)
      expect(() => Fees.refScriptFee(Fees.MAX_REF_SCRIPT_SIZE, rate)).not.toThrow()
      expect(() => Fees.refScriptFee(Fees.MAX_REF_SCRIPT_SIZE + 1n, rate)).toThrow(/Conway maximum/)
    })

    it("should handle four tiers with partial last", () => {
      // tier1: 25600 × 44       = 1,126,400
      // tier2: 25600 × 52.8     = 1,351,680
      // tier3: 25600 × 63.36    = 1,622,016
      // tier4: 23200 × 76.032   = 1,763,942.4
      // floor(5,864,038.4) = 5,864,038
      expect(tierRefScriptFee(MULTIPLIER, STRIDE, BASE, 100_000)).toBe(5_864_038n)
    })
  })

  describe("calculateReferenceScriptFee size limit", () => {
    // Conway ledger: totalRefScriptSize <= 200 * 1024 (ppMaxRefScriptSizePerTxG)
    const ADDRESS = CoreAddress.fromBech32(
      "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"
    )

    // A PlutusV3 script whose serialized size, as the fee function counts it, is exactly `size`
    const scriptOfSize = (size: number) => {
      for (let length = size - 8; length <= size; length++) {
        const script = new PlutusV3.PlutusV3({ bytes: new Uint8Array(length).fill(0xab) })
        if (CoreScript.toCBOR(script).length === size) return script
      }
      throw new Error(`no script of size ${size}`)
    }

    const utxosTotalling = (total: number) =>
      [51_200, 51_200, 51_200, total - 3 * 51_200].map(
        (size, index) =>
          new CoreUTxO.UTxO({
            transactionId: TransactionHash.fromHex("a".repeat(64)),
            index: BigInt(index),
            address: ADDRESS,
            assets: CoreAssets.fromLovelace(5_000_000n),
            scriptRef: scriptOfSize(size)
          })
      )

    it.effect("accepts exactly 204,800 bytes", () =>
      Effect.gen(function* () {
        const fee = yield* calculateReferenceScriptFee(utxosTotalling(204_800), 15)
        expect(fee).toBeGreaterThan(0n)
      })
    )

    it.effect("rejects 204,801 bytes", () =>
      Effect.gen(function* () {
        const result = yield* Effect.either(calculateReferenceScriptFee(utxosTotalling(204_801), 15))
        expect(result._tag).toBe("Left")
      })
    )
  })
})
