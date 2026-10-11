import { describe, expect, it } from "vitest"

import * as Cip116 from "../src/Cip116.js"
import { jcs, jcsBytes } from "../src/Jcs.js"

const ch = (n: number) => String.fromCharCode(n)

/**
 * Each case states one RFC 8785 rule, with its expected output written out rather than computed.
 *
 * The RFC's full worked example is deliberately NOT transcribed here: it is a dense mix of
 * escapes whose correct form is easy to get wrong by hand, and a hand-written oracle that is
 * wrong is worse than no oracle. The composed behaviour is pinned instead by
 * `harness/canonical-port-differential.mjs`, against an implementation already verified against
 * the RFC.
 */
describe("Jcs", () => {
  it("sorts object keys by UTF-16 code unit, not by locale", () => {
    expect(jcs({ b: 1, a: 2, A: 3 })).toBe(`{"A":3,"a":2,"b":1}`)
    // Locale collation would put "a" beside "A"; code-unit order puts every upper-case first.
    expect(jcs({ a: 1, B: 2 })).toBe(`{"B":2,"a":1}`)
  })

  it("sorts nested objects too", () => {
    expect(jcs({ z: { b: 1, a: 2 }, a: 3 })).toBe(`{"a":3,"z":{"a":2,"b":1}}`)
  })

  it("preserves array order, which is not a set", () => {
    expect(jcs([3, 1, 2])).toBe(`[3,1,2]`)
  })

  // DEL is deliberately NOT escaped: RFC 8785 defers to RFC 8259, which requires escaping only
  // below 0x20. Escaping it would produce a digest nobody else computes.
  it("leaves DEL literal and escapes the C0 controls", () => {
    expect(jcs(ch(0x7f))).toBe(`"${ch(0x7f)}"`)
    expect(jcs(ch(0x00))).toBe(`"\\u0000"`)
    expect(jcs(ch(0x01))).toBe(`"\\u0001"`)
    expect(jcs(ch(0x1f))).toBe(`"\\u001f"`)
  })

  it("uses the five short escapes rather than the numeric form for them", () => {
    expect(jcs(ch(0x08))).toBe(`"\\b"`)
    expect(jcs(ch(0x0c))).toBe(`"\\f"`)
    expect(jcs(ch(0x0a))).toBe(`"\\n"`)
    expect(jcs(ch(0x0d))).toBe(`"\\r"`)
    expect(jcs(ch(0x09))).toBe(`"\\t"`)
  })

  it("escapes only the two mandatory characters, and leaves the solidus alone", () => {
    expect(jcs(`"`)).toBe(`"\\""`)
    expect(jcs("\\")).toBe(`"\\\\"`)
    expect(jcs("/")).toBe(`"/"`)
  })

  it("leaves non-ASCII literal rather than escaping it", () => {
    expect(jcs("é")).toBe(`"é"`)
    expect(jcs("日本")).toBe(`"日本"`)
  })

  it("formats numbers the way ECMAScript does, including the exponent threshold", () => {
    expect(jcs(1e21)).toBe("1e+21")
    expect(jcs(1e20)).toBe("100000000000000000000")
    expect(jcs(1e-7)).toBe("1e-7")
    expect(jcs(0.002)).toBe("0.002")
    expect(jcs(4.5)).toBe("4.5")
    expect(jcs(-0)).toBe("0")
    expect(jcs(0)).toBe("0")
  })

  it("emits the literals and the empty containers", () => {
    expect(jcs(null)).toBe("null")
    expect(jcs(true)).toBe("true")
    expect(jcs(false)).toBe("false")
    expect(jcs({})).toBe("{}")
    expect(jcs([])).toBe("[]")
  })

  // These have no canonical form. Guessing one produces a digest that is WRONG rather than one
  // that is missing, which is the failure a canonicalizer exists to prevent.
  it("refuses what cannot be canonicalized", () => {
    for (const v of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1n]) {
      expect(() => jcs(v)).toThrow()
    }
  })

  it("jcsBytes is the UTF-8 encoding of jcs", () => {
    expect(jcsBytes({ a: 1 })).toEqual(new TextEncoder().encode(`{"a":1}`))
    expect(jcsBytes("é")).toEqual(new TextEncoder().encode(`"é"`))
  })
})

describe("Cip116", () => {
  const POLICY = "aa".repeat(28)

  // The scalar conventions are the easy thing to get wrong: `index` is a NUMBER; `coin`, asset
  // amounts and `alternative` are decimal STRINGS. A number for an amount would also silently
  // truncate past 2^53.
  it("puts index in a number and coin in a string", () => {
    expect(Cip116.transactionInput("ab".repeat(32), 7)).toEqual({ transaction_id: "ab".repeat(32), index: 7 })
    expect(Cip116.value(1000000n, []).coin).toBe("1000000")
  })

  it("carries an amount past 2^53 without losing it", () => {
    const big = 9007199254740993n // Number.MAX_SAFE_INTEGER + 2
    const v = Cip116.value(big, [{ policyHex: POLICY, nameHex: "41", quantity: big }])
    expect(v.coin).toBe("9007199254740993")
    expect(v.assets?.[POLICY]?.["41"]).toBe("9007199254740993")
  })

  // PosInt64 is zero-EXCLUSIVE, so a zero-quantity entry cannot be represented at all. It is
  // dropped rather than emitted as a zero string the schema cannot carry.
  it("drops a zero-quantity asset", () => {
    const v = Cip116.value(1n, [
      { policyHex: POLICY, nameHex: "41", quantity: 0n },
      { policyHex: POLICY, nameHex: "42", quantity: 3n }
    ])
    expect(v.assets?.[POLICY]?.["41"]).toBeUndefined()
    expect(v.assets?.[POLICY]?.["42"]).toBe("3")
  })

  it("omits the asset map entirely when there are no assets", () => {
    expect(Cip116.value(1n, [])).toEqual({ coin: "1" })
  })

  it("sums two entries naming the same asset", () => {
    const v = Cip116.value(1n, [
      { policyHex: POLICY, nameHex: "41", quantity: 2n },
      { policyHex: POLICY, nameHex: "41", quantity: 3n }
    ])
    expect(v.assets?.[POLICY]?.["41"]).toBe("5")
  })

  it("encodes a constructor's alternative as a string", () => {
    expect(Cip116.plutusData({ type: "constr", alt: 2n, fields: [] })).toEqual({
      tag: "constr",
      alternative: "2",
      data: []
    })
  })

  it("encodes integers unbounded, so a datum's values survive", () => {
    expect(Cip116.plutusData({ type: "int", value: -9007199254740993n })).toEqual({
      tag: "integer",
      value: "-9007199254740993"
    })
  })

  it("encodes bytes as lower-case hex", () => {
    expect(Cip116.plutusData({ type: "bytes", bytes: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) })).toEqual({
      tag: "bytes",
      value: "deadbeef"
    })
  })

  it("composes with JCS, which is how a digest sees it", () => {
    const u = Cip116.transactionUnspentOutput(Cip116.transactionInput("ab".repeat(32), 0), {
      address: "addr1xyz",
      amount: Cip116.value(1000000n, [])
    })
    expect(() => jcs(u)).not.toThrow()
    // Stable: the same value canonicalizes the same way however its keys arrived ordered.
    const shuffled = { output: u.output, input: u.input }
    expect(jcs(shuffled)).toBe(jcs(u))
  })

  // WARNING: `datum_hex` is an EXTENSION, not CIP-116. `plutus_data` is information-complete but
  // not byte-exact -- the JSON tree does not capture CBOR encoding choices -- so any consumer
  // that must hash or re-submit the datum needs the original bytes.
  it("carries the inline datum's original bytes alongside the parsed form", () => {
    const u = Cip116.transactionUnspentOutput(Cip116.transactionInput("ab".repeat(32), 0), {
      address: "addr1xyz",
      amount: Cip116.value(1n, []),
      datum_hex: "d87980"
    })
    expect(u.output.datum_hex).toBe("d87980")
  })
})
