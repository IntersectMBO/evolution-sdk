import { describe, expect, it } from "@effect/vitest"

import * as CBOR from "../src/CBOR.js"
import { cborHeaderSize } from "../src/Transaction.js"

/** Element `index` of a CBOR array, as its own exact bytes — the slice a wallet review needs. */
const sliceElement = (data: Uint8Array, index: number): Uint8Array => {
  let offset = cborHeaderSize(data, 0)
  for (let i = 0; i < index; i++) offset = CBOR.decodeItemWithOffset(data, offset).newOffset
  const { newOffset } = CBOR.decodeItemWithOffset(data, offset)
  return data.subarray(offset, newOffset)
}

const hex = (u8: Uint8Array) => Buffer.from(u8).toString("hex")

describe("cborHeaderSize", () => {
  it("measures every header width the spec defines", () => {
    // [0, 24, 1000, 100000, 10000000000] — one element per additional-info encoding.
    const data = CBOR.toCBORBytes([0n, 24n, 1000n, 100_000n, 10_000_000_000n])
    expect(cborHeaderSize(data, 0)).toBe(1)
    const widths = [1, 2, 3, 5, 9]
    let offset = cborHeaderSize(data, 0)
    for (const want of widths) {
      expect(cborHeaderSize(data, offset)).toBe(want)
      offset = CBOR.decodeItemWithOffset(data, offset).newOffset
    }
  })

  it("slices an array element byte-exactly, which a re-encode cannot promise", () => {
    const parts = [new Uint8Array([1, 2, 3]), "text", 42n]
    const data = CBOR.toCBORBytes(parts)

    for (const [i, part] of parts.entries()) {
      const slice = sliceElement(data, i)
      expect(hex(slice)).toBe(hex(CBOR.toCBORBytes(part)))
    }
  })

  it("is the start of the body that `extractBodyBytes` already relies on", () => {
    // A two-element array whose first element is itself an array: the slice must stop at the
    // inner array's end, not run on into the second element.
    const data = CBOR.toCBORBytes([[1n, 2n], 9n])
    expect(hex(sliceElement(data, 0))).toBe(hex(CBOR.toCBORBytes([1n, 2n])))
    expect(hex(sliceElement(data, 1))).toBe(hex(CBOR.toCBORBytes(9n)))
  })
})
