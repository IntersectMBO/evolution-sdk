import { describe, expect, it } from "@effect/vitest"

import * as CBOR from "../src/CBOR.js"
import * as Transaction from "../src/Transaction.js"

// A definite array or map header declares how many items follow. The decoder
// must not read past the end of the input or trust a length the input cannot hold.

const decoders = [
  ["CBOR.fromCBORHex", (hex: string) => CBOR.fromCBORHex(hex)],
  ["CBOR.fromCBORHexWithFormat", (hex: string) => CBOR.fromCBORHexWithFormat(hex)],
  ["Transaction.fromCBORHex", (hex: string) => Transaction.fromCBORHex(hex)]
] as const

const decodeError = (decode: (hex: string) => unknown, hex: string): unknown => {
  try {
    decode(hex)
  } catch (error) {
    return error
  }
  return undefined
}

describe("CBOR decoding of declared lengths", () => {
  const cases = [
    { name: "an array declaring 2^31 - 1 items with none present", hex: "9a7fffffff", message: "Insufficient data for array" },
    { name: "a map declaring 2^31 - 1 entries with none present", hex: "ba7fffffff", message: "Insufficient data for map" },
    { name: "an array missing its last item", hex: "8201", message: "Insufficient data for array" },
    { name: "a map missing its value", hex: "a101", message: "Insufficient data for map" },
    { name: "a tag with no content", hex: "d818", message: "Insufficient data for CBOR item" }
  ]

  for (const [label, decode] of decoders) {
    it.each(cases)(`${label} throws CBORError for $name`, ({ hex, message }) => {
      const error = decodeError(decode, hex)
      expect(error).toBeInstanceOf(CBOR.CBORError)
      expect((error as CBOR.CBORError).message).toContain(message)
    })
  }

  it("decodes arrays and maps whose items fill the input exactly", () => {
    expect(CBOR.fromCBORHex("83010203")).toEqual([1n, 2n, 3n])
    expect(CBOR.fromCBORHex("a201020304")).toEqual(
      new Map([
        [1n, 2n],
        [3n, 4n]
      ])
    )
    expect(CBOR.fromCBORHex("8180")).toEqual([[]])
    expect(CBOR.fromCBORHex("9f0102ff")).toEqual([1n, 2n])
  })
})
