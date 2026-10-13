/**
 * Evolution's protocol parameters to this engine's.
 *
 * ⚠️ The two conversions that are not renames: `number` → `bigint` for the fee arithmetic, and
 * IEEE doubles → exact `[num, den]` fractions for the execution prices. `0.0577` has no binary
 * representation, and rounding it into a fee is how a transaction comes back one lovelace under
 * the minimum and is rejected.
 */
import type { Provider } from "@evolution-sdk/evolution"
import { describe, expect, it } from "vitest"

import { paramsFromProtocolParameters } from "../src/Plan.js"

/** Real preprod magnitudes, with an empty cost model unless a test supplies one. */
const theirs = (over: Partial<Provider.ProtocolParameters> = {}): Provider.ProtocolParameters =>
  ({
    minFeeA: 44,
    minFeeB: 155_381,
    coinsPerUtxoByte: 4_310n,
    keyDeposit: 2_000_000n,
    poolDeposit: 500_000_000n,
    drepDeposit: 500_000_000n,
    priceMem: 0.0577,
    priceStep: 0.0000721,
    minFeeRefScriptCostPerByte: 15,
    collateralPercentage: 150,
    maxCollateralInputs: 3,
    maxValSize: 5000,
    maxTxSize: 16_384,
    costModels: { PlutusV1: {}, PlutusV2: {}, PlutusV3: {} },
    ...over
  }) as Provider.ProtocolParameters

describe("paramsFromProtocolParameters", () => {
  it("widens the fee inputs to bigint", () => {
    const p = paramsFromProtocolParameters(theirs())
    expect(p.minFeeA).toBe(44n)
    expect(p.minFeeB).toBe(155_381n)
    expect(p.maxValueSize).toBe(5000n)
    expect(p.maxTxSize).toBe(16_384n)
  })

  it("reads the execution prices as EXACT fractions, not as the nearest double", () => {
    const p = paramsFromProtocolParameters(theirs())
    expect(p.priceMem).toEqual([577n, 10_000n])
    expect(p.priceStep).toEqual([721n, 10_000_000n])
    expect(p.minFeeRefScriptCostPerByte).toEqual([15n, 1n])
  })

  it("reads a price in exponent form from its text", () => {
    // `String(1e-7)` is "1e-7"; expanding it through a double is what put a denominator of
    // 5e19 — past uint64 — into a decode that then failed outright.
    const p = paramsFromProtocolParameters(theirs({ priceStep: 1e-7 }))
    expect(p.priceStep).toEqual([1n, 10_000_000n])
  })

  it("flattens the Plutus V3 cost model in index order", () => {
    const costModels = {
      PlutusV1: {},
      PlutusV2: {},
      PlutusV3: { "0": 100, "1": 101, "2": 102, "10": 110, "11": 111 }
    }
    const p = paramsFromProtocolParameters(theirs({ costModels } as Partial<Provider.ProtocolParameters>))
    expect(p.plutusV3CostModel).toEqual([100n, 101n, 102n, 110n, 111n])
  })

  it("refuses a cost-model key that is not an index, rather than silently dropping its entry", () => {
    // ⚠️ The vector that made this worth writing. Removing the sort does NOT break the case
    // above — JavaScript enumerates canonical integer keys in ascending numeric order already.
    // A key like "01" is enumerated in insertion order instead, and the old implementation
    // rebuilt the key from the number (`String(1)`), looked up a key that was not there and
    // called `BigInt(undefined)` — a thrown defect from inside a conversion. A cost model with
    // a hole is a wrong script_data_hash, which the ledger rejects after the user has signed.
    const costModels = { PlutusV1: {}, PlutusV2: {}, PlutusV3: { "2": 102, "01": 101, "0": 100 } }
    expect(() => paramsFromProtocolParameters(theirs({ costModels } as Partial<Provider.ProtocolParameters>))).toThrow(
      /non-index key/
    )
  })

  it("refuses a non-integer cost, which no cost model has", () => {
    const costModels = { PlutusV1: {}, PlutusV2: {}, PlutusV3: { "0": 1.5 } }
    expect(() => paramsFromProtocolParameters(theirs({ costModels } as Partial<Provider.ProtocolParameters>))).toThrow(
      /not an integer/
    )
  })

  it("omits the cost model entirely when the backend reports none", () => {
    // Absent, not empty: the engine reads presence to decide whether a Plutus fee can be
    // computed at all, and `[]` would read as "zero costs".
    expect(paramsFromProtocolParameters(theirs()).plutusV3CostModel).toBeUndefined()
  })

  it("produces params the engine itself accepts", () => {
    // The structural assertion is the engine's own gate; converting into something it rejects
    // would move the failure to the first build rather than to here.
    expect(() => paramsFromProtocolParameters(theirs())).not.toThrow()
    const p = paramsFromProtocolParameters(theirs())
    for (const fraction of [p.priceMem, p.priceStep, p.minFeeRefScriptCostPerByte]) {
      expect(fraction?.[1]).toBeGreaterThan(0n)
    }
  })
})
