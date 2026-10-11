import { BigDecimal } from "effect"
import { describe, expect, it } from "vitest"

import * as UnitInterval from "../src/UnitInterval.js"

const of = (decimal: string) => {
  const i = UnitInterval.fromBigDecimal(BigDecimal.unsafeFromString(decimal))
  return `${i.numerator}/${i.denominator}`
}

describe("UnitInterval.fromBigDecimal", () => {
  it("round-trips the fractional values a protocol parameter actually carries", () => {
    expect(of("0.0577")).toBe("577/10000")
    expect(of("0.51")).toBe("51/100")
    expect(of("0.3")).toBe("3/10")
    expect(of("0.0000721")).toBe("721/10000000")
  })

  // `BigDecimal.normalize` strips trailing zeros by DECREMENTING the scale, so a whole
  // number arrives with a negative scale. Clamping the scale at zero without rescaling the
  // numerator used to read 5000 as 5 — three orders of magnitude, silently.
  it("does not drop the magnitude of a whole number", () => {
    expect(of("5000")).toBe("5000/1")
    expect(of("20")).toBe("20/1")
    expect(of("1")).toBe("1/1")
    expect(of("2")).toBe("2/1")
    expect(of("0")).toBe("0/1")
  })

  it("agrees with its own inverse", () => {
    for (const d of ["0", "1", "0.5", "0.0577", "20", "5000"]) {
      const i = UnitInterval.fromBigDecimal(BigDecimal.unsafeFromString(d))
      expect(BigDecimal.equals(UnitInterval.toBigDecimal(i), BigDecimal.unsafeFromString(d))).toBe(true)
    }
  })
})
