import { describe, expect, it } from "vitest"

import * as NonnegativeInterval from "../src/NonnegativeInterval.js"

/**
 * The exactness this constructor exists for. Every protocol parameter below is a rational in
 * the ledger and a decimal on the wire, and none of them is representable in binary floating
 * point — so a value that went through a `number` is not the value the chain specified.
 */
describe("NonnegativeInterval.fromDecimal", () => {
  const asPair = (value: number | string) => {
    const i = NonnegativeInterval.fromDecimal(value)
    return [i.numerator, i.denominator] as const
  }

  it("reads the Conway execution prices exactly", () => {
    expect(asPair(0.0577)).toEqual([577n, 10_000n])
    expect(asPair("0.0577")).toEqual([577n, 10_000n])
    expect(asPair(0.0000721)).toEqual([721n, 10_000_000n])
  })

  it("recovers the decimal that was written, not the double it became", () => {
    // 1.2 as a double is 1.1999999999999999555910790149937383830547332763671875. The ledger's
    // reference-script multiplier is six fifths, and that is what a caller passing 1.2 means.
    expect(asPair(1.2)).toEqual([6n, 5n])
    expect(asPair(0.1)).toEqual([1n, 10n])
    expect(asPair(0.3)).toEqual([3n, 10n])
  })

  it("reduces to lowest terms", () => {
    expect(asPair(0.5)).toEqual([1n, 2n])
    expect(asPair(0.25)).toEqual([1n, 4n])
    expect(asPair(0.2)).toEqual([1n, 5n])
  })

  it("takes a whole number as itself over one", () => {
    expect(asPair(15)).toEqual([15n, 1n])
    expect(asPair("44")).toEqual([44n, 1n])
    expect(asPair(0)).toEqual([0n, 1n])
  })

  it("expands exponent notation rather than splitting on a decimal point that is not there", () => {
    expect(asPair(1e-7)).toEqual([1n, 10_000_000n])
    expect(asPair("1e-3")).toEqual([1n, 1000n])
  })

  it("refuses what is not a non-negative decimal, rather than yielding a wrong rational", () => {
    expect(() => NonnegativeInterval.fromDecimal("garbage")).toThrow()
    expect(() => NonnegativeInterval.fromDecimal(Number.NaN)).toThrow()
    expect(() => NonnegativeInterval.fromDecimal(Number.POSITIVE_INFINITY)).toThrow()
    // A negative rational is a different type in the ledger, and this one is non-negative.
    expect(() => NonnegativeInterval.fromDecimal(-0.5)).toThrow()
  })

  it("divides toward the ceiling, exactly", () => {
    expect(NonnegativeInterval.ceilDiv(10n, 5n)).toBe(2n)
    expect(NonnegativeInterval.ceilDiv(11n, 5n)).toBe(3n)
    expect(NonnegativeInterval.ceilDiv(1n, 1_000_000n)).toBe(1n)
    expect(NonnegativeInterval.ceilDiv(0n, 7n)).toBe(0n)
  })
})
