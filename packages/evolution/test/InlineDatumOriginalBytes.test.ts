import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"
import * as DatumOption from "../src/DatumOption.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as OriginalBytes from "../src/OriginalBytes.js"

/**
 * `datum_option = [1, #6.24(bytes)]` — the CDDL slot IS a byte string, so a decoded inline datum
 * already had its bytes. Re-deriving them from the parsed `data` can change them, and a datum that
 * re-encodes differently hashes differently.
 */
describe("InlineDatum preserves the bytes it was decoded from", () => {
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")
  const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"))

  // `Constr 1 []` indefinite-framed. The encoder writes an empty array definite (`d87a80`)
  // whatever framing it was parsed with, so this is the shape that proves preservation.
  const INDEFINITE_EMPTY_CONSTR = "d87a9fff"

  it("round-trips a datum the Data encoder would reframe", () => {
    const option = CBOR.encodeArrayAsDefinite([
      CBOR.toCBORBytes(1n),
      CBOR.encodeTaggedValue(24, CBOR.toCBORBytes(bytes(INDEFINITE_EMPTY_CONSTR)))
    ])
    const decoded = DatumOption.fromCBORBytes(option)
    expect(decoded._tag).toBe("InlineDatum")
    expect(hex(OriginalBytes.get(decoded as InlineDatum.InlineDatum)!)).toBe(INDEFINITE_EMPTY_CONSTR)
    expect(hex(DatumOption.toCBORBytes(decoded))).toBe(hex(option))

    // `Data` keeps its own arrival bytes now, so the reframing this used to guard against is gone
    // one level down as well. Both records are asserted on purpose: the wrapper's covers a `Data`
    // that was built rather than decoded, and `Data`'s covers a wrapper that was.
    expect(Data.toCBORHex(Data.fromCBORHex(INDEFINITE_EMPTY_CONSTR))).toBe(INDEFINITE_EMPTY_CONSTR)

    // Canonical mode is the one caller that still gets a re-derived representation, because asking
    // to canonicalise IS asking for different bytes.
    expect(Data.toCBORHex(Data.fromCBORHex(INDEFINITE_EMPTY_CONSTR), CBOR.CANONICAL_OPTIONS)).toBe("d87a80")
  })

  it("falls back to the data tree when built from scratch", () => {
    const built = new InlineDatum.InlineDatum({ data: Data.constr(1n, []) })
    expect(OriginalBytes.get(built)).toBeUndefined()
    expect(hex(DatumOption.toCBORBytes(built))).toContain("d87a80")
  })

  it("explicitly recorded bytes win over the tree", () => {
    const supplied = OriginalBytes.record(
      new InlineDatum.InlineDatum({ data: Data.fromCBORHex(INDEFINITE_EMPTY_CONSTR) }),
      bytes(INDEFINITE_EMPTY_CONSTR)
    )
    expect(hex(DatumOption.toCBORBytes(supplied))).toContain(INDEFINITE_EMPTY_CONSTR)
  })
})
