import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as TransactionBody from "../src/TransactionBody.js"

describe("TransactionBody WithFormat", () => {
  it("round-trips via hex with an explicit format tree", () => {
    FastCheck.assert(
      FastCheck.property(TransactionBody.arbitrary, (body) => {
        const hex = TransactionBody.toCBORHex(body)
        const { format, value } = TransactionBody.fromCBORHexWithFormat(hex)
        expect(TransactionBody.toCBORHexWithFormat(value, format)).toBe(hex)
      }),
      { numRuns: 20 }
    )
  })

  it("round-trips via bytes with an explicit format tree", () => {
    FastCheck.assert(
      FastCheck.property(TransactionBody.arbitrary, (body) => {
        const bytes = TransactionBody.toCBORBytes(body)
        const { format, value } = TransactionBody.fromCBORBytesWithFormat(bytes)
        const reencoded = TransactionBody.toCBORBytesWithFormat(value, format)
        expect(Buffer.from(reencoded).toString("hex")).toBe(Buffer.from(bytes).toString("hex"))
      }),
      { numRuns: 20 }
    )
  })

  it("preserves non-canonical encoding in body fields", () => {
    // fee=0 encoded as 0x1800 (non-canonical), inputs=[] as d9010280
    // body map: {0: d9010280, 1: [], 2: 0x1800}
    const nonCanonicalBodyHex = "a300d90102800180021800"
    const { format, value } = TransactionBody.fromCBORHexWithFormat(nonCanonicalBodyHex)
    expect(TransactionBody.toCBORHexWithFormat(value, format)).toBe(nonCanonicalBodyHex)
  })
})
