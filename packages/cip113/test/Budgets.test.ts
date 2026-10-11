/**
 * The budget ARITHMETIC. The measurements themselves want a live run, not a vector.
 *
 * ⚠️ Underestimate a Plutus budget and the node rejects the transaction; overestimate and the
 * sender overpays. Nothing about either is visible at build time, which is why the two mistakes
 * this module has already made are pinned here as cases:
 *
 *  - inputs and outputs were ONE axis until 2026-08-16, because every shape had been measured
 *    with one output per input. The first transfer to break that ratio underspent and was
 *    rejected. So a 1-in-2-out transfer must NOT cost what a 2-in-1-out one costs.
 *  - `measurement` used to default to "whatever LATEST is", which became a live under-budget the
 *    moment upstream made the scripts cheaper. The numbers in that story are asserted below, so
 *    the prose cannot quietly stop being true.
 */
import { applyMargin } from "@evolution-sdk/plan/ExUnits"
import { describe, expect, it } from "vitest"

import {
  maxPlbInputsPerTx,
  measurementFor,
  REFERENCE_ALPHA2_MEASUREMENT,
  REFERENCE_ALPHA4_MEASUREMENT,
  REFERENCE_MAIN_MEASUREMENT,
  REFERENCE_V0_0_1_MEASUREMENT,
  transferBudgets,
  type TransferMeasurement,
  TX_EXECUTION_LIMITS,
} from "../src/Budgets.js"
import { LATEST, V0_0_1, V0_3_0, V0_4_0, V0_5_0_ALPHA_2, V0_5_0_ALPHA_4 } from "../src/Versions.js"

const NO_MARGIN = [10n, 10n] as const

/**
 * Round numbers, so the arithmetic is visible rather than inferred from measured data — but of
 * the same ORDER as the real ones, because `maxPlbInputsPerTx` searches against the real
 * per-transaction limit and toy numbers would only ever reach its pathological guard.
 */
const SYNTHETIC: TransferMeasurement = {
  deploymentId: "synthetic",
  measuredAt: "2026-10-11",
  source: "this test — round numbers, so a wrong term is readable in the result",
  plbSpendPerInput: { mem: 100_000n, steps: 30_000_000n },
  plgDispatch: { mem: 10_000n, steps: 3_000_000n },
  transferBase: { mem: 200_000n, steps: 60_000_000n },
  transferPerInput: { mem: 30_000n, steps: 9_000_000n },
  transferPerOutput: { mem: 5_000n, steps: 1_500_000n },
}

describe("the budget for one transfer", () => {
  it("is base + per-input × inputs + per-output × outputs, and the margin is multiplicative", () => {
    const b = transferBudgets(2, 3, SYNTHETIC, NO_MARGIN)
    expect(b.plbSpend).toEqual({ mem: 100_000n, steps: 30_000_000n })
    // 200,000 + 30,000×2 + 5,000×3
    expect(b.transferDelegate).toEqual({ mem: 275_000n, steps: 82_500_000n })
    expect(b.plgDispatch).toEqual({ mem: 10_000n, steps: 3_000_000n })
    // PLB is charged PER INPUT; the delegate and the dispatcher once each.
    expect(b.frameworkTotal).toEqual({
      mem: 100_000n * 2n + 275_000n + 10_000n,
      steps: 30_000_000n * 2n + 82_500_000n + 3_000_000n,
    })
  })

  it("applies the default +20% to every term, not only the total", () => {
    const b = transferBudgets(1, 1, SYNTHETIC)
    expect(b.plbSpend).toEqual(applyMargin(SYNTHETIC.plbSpendPerInput, [12n, 10n]))
    expect(b.plgDispatch).toEqual(applyMargin(SYNTHETIC.plgDispatch!, [12n, 10n]))
    expect(b.transferDelegate).toEqual(applyMargin({ mem: 235_000n, steps: 70_500_000n }, [12n, 10n]))
  })

  it("⚠️ charges inputs and outputs on SEPARATE axes", () => {
    // The 2026-08-16 bug in one assertion: folded into one axis these two are equal, and the
    // cheaper reading is the one that gets rejected by the node.
    const oneInTwoOut = transferBudgets(1, 2, SYNTHETIC, NO_MARGIN)
    const twoInOneOut = transferBudgets(2, 1, SYNTHETIC, NO_MARGIN)
    expect(oneInTwoOut.transferDelegate).not.toEqual(twoInOneOut.transferDelegate)
    expect(oneInTwoOut.transferDelegate.mem).toBe(200_000n + 30_000n + 10_000n)
    expect(twoInOneOut.transferDelegate.mem).toBe(200_000n + 60_000n + 5_000n)
  })

  it("has no dispatcher slot at all on a pre-alpha.4 measurement", () => {
    // Not a zero: the pre-split shapes have no such redeemer, and a budget carrying a zero for
    // one would describe a transaction shape that does not exist.
    const { plgDispatch: _absent, ...noDispatch } = SYNTHETIC
    const b = transferBudgets(1, 1, noDispatch, NO_MARGIN)
    expect("plgDispatch" in b).toBe(false)
    expect(b.frameworkTotal.mem).toBe(100_000n + 235_000n)
  })

  it("reports exceeding the per-transaction limit instead of letting submit find out", () => {
    const huge: TransferMeasurement = {
      ...SYNTHETIC,
      transferBase: { mem: TX_EXECUTION_LIMITS.mem, steps: 1_000_000n },
    }
    const b = transferBudgets(1, 1, huge, NO_MARGIN)
    expect(b.exceedsTxLimit).toBe(true)
    expect(transferBudgets(1, 1, SYNTHETIC, NO_MARGIN).exceedsTxLimit).toBe(false)
  })

  it("refuses a zero or fractional input or output count", () => {
    // Zero outputs was the old DEFAULT (outputs were assumed equal to inputs); requiring it is
    // what makes the omission a compile error rather than a silent under-budget.
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => transferBudgets(bad, 1, SYNTHETIC)).toThrow(/plbInputCount must be a positive integer/)
      expect(() => transferBudgets(1, bad, SYNTHETIC)).toThrow(/plbOutputCount must be a positive integer/)
    }
  })
})

describe("how many PLB inputs fit in one transaction", () => {
  it("returns the largest count that fits, and one more does not", () => {
    // The boundary IS the contract; asserting a particular number would only restate the data.
    const n = maxPlbInputsPerTx(SYNTHETIC, NO_MARGIN)
    expect(transferBudgets(n, n, SYNTHETIC, NO_MARGIN).frameworkTotal.steps).toBeLessThanOrEqual(
      TX_EXECUTION_LIMITS.steps
    )
    const over = transferBudgets(n + 1, n + 1, SYNTHETIC, NO_MARGIN).frameworkTotal
    expect(over.mem > TX_EXECUTION_LIMITS.mem || over.steps > TX_EXECUTION_LIMITS.steps).toBe(true)
  })

  it("fits fewer inputs when budget is reserved for the substandards", () => {
    const free = maxPlbInputsPerTx(SYNTHETIC, NO_MARGIN)
    const reserved = maxPlbInputsPerTx(SYNTHETIC, NO_MARGIN, { mem: TX_EXECUTION_LIMITS.mem / 2n, steps: 0n })
    expect(reserved).toBeLessThan(free)
    expect(maxPlbInputsPerTx(SYNTHETIC, NO_MARGIN, TX_EXECUTION_LIMITS)).toBe(0)
  })

  it("fits fewer inputs when each one is expected to produce more outputs", () => {
    expect(maxPlbInputsPerTx(SYNTHETIC, NO_MARGIN, { mem: 0n, steps: 0n }, 2)).toBeLessThan(
      maxPlbInputsPerTx(SYNTHETIC, NO_MARGIN, { mem: 0n, steps: 0n }, 1)
    )
  })

  it("fits fewer inputs with the default margin than with none", () => {
    expect(maxPlbInputsPerTx(SYNTHETIC)).toBeLessThan(maxPlbInputsPerTx(SYNTHETIC, NO_MARGIN))
  })
})

describe("which measurement describes which version", () => {
  it("answers for the three measured revisions", () => {
    expect(measurementFor(V0_0_1)).toBe(REFERENCE_V0_0_1_MEASUREMENT)
    expect(measurementFor(LATEST)).toBe(REFERENCE_V0_0_1_MEASUREMENT)
    expect(measurementFor(V0_5_0_ALPHA_4)).toBe(REFERENCE_ALPHA4_MEASUREMENT)
    expect(measurementFor(V0_5_0_ALPHA_2)).toBe(REFERENCE_ALPHA2_MEASUREMENT)
  })

  it("answers undefined — honestly — for the revisions nobody measured", () => {
    expect(measurementFor(V0_4_0)).toBeUndefined()
    expect(measurementFor(V0_3_0)).toBeUndefined()
    expect(measurementFor({ id: "v9.9.9" })).toBeUndefined()
  })

  it("keeps v0.0.1 and alpha.4 on SEPARATE numbers, though the scripts are near-identical", () => {
    // They were briefly assumed to share a measurement. The scripts are byte-identical bar
    // `protocol_params` and the numbers still moved, so each revision carries its own.
    expect(REFERENCE_V0_0_1_MEASUREMENT).not.toEqual(REFERENCE_ALPHA4_MEASUREMENT)
  })

  it("keeps REFERENCE_MAIN_MEASUREMENT an alias of the alpha.2 record", () => {
    expect(REFERENCE_MAIN_MEASUREMENT).toBe(REFERENCE_ALPHA2_MEASUREMENT)
  })

  it("has a dispatcher term exactly where the version's shape has a dispatcher", () => {
    expect(REFERENCE_V0_0_1_MEASUREMENT.plgDispatch).toBeDefined()
    expect(REFERENCE_ALPHA4_MEASUREMENT.plgDispatch).toBeDefined()
    expect(REFERENCE_ALPHA2_MEASUREMENT.plgDispatch).toBeUndefined()
    expect(V0_0_1.dispatch).toBe("plg-dispatcher")
    expect(V0_5_0_ALPHA_2.dispatch).toBe("plb-direct")
  })

  it("⚠️ still under-budgets alpha.2 if alpha.4's numbers are used, margin and all", () => {
    // The reason `measurement` is a required argument. These are the numbers from that story,
    // asserted so the prose cannot quietly stop being true as the records are refreshed.
    const wrong = transferBudgets(1, 1, REFERENCE_ALPHA4_MEASUREMENT).plbSpend
    expect(wrong.mem).toBeLessThan(REFERENCE_ALPHA2_MEASUREMENT.plbSpendPerInput.mem)
    expect(transferBudgets(1, 1, REFERENCE_ALPHA2_MEASUREMENT).plbSpend.mem).toBeGreaterThan(
      REFERENCE_ALPHA2_MEASUREMENT.plbSpendPerInput.mem
    )
  })

  it("keeps every recorded measurement positive on every axis", () => {
    // A zero term reads as "free" and silently removes that script from the budget.
    for (const m of [REFERENCE_V0_0_1_MEASUREMENT, REFERENCE_ALPHA4_MEASUREMENT, REFERENCE_ALPHA2_MEASUREMENT]) {
      for (const units of [m.plbSpendPerInput, m.transferBase, m.transferPerInput, m.transferPerOutput, m.plgDispatch]) {
        if (units === undefined) continue
        expect(units.mem).toBeGreaterThan(0n)
        expect(units.steps).toBeGreaterThan(0n)
      }
      expect(m.deploymentId.length).toBeGreaterThan(0)
      expect(m.source.length).toBeGreaterThan(0)
    }
  })
})
