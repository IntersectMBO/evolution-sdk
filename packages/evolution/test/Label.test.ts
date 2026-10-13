import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Label from "../src/Label.js"

/**
 * `fromLabel` classifies an asset name read off the chain, so its input is untrusted by
 * construction, and its documented contract is to return `undefined` for anything invalid.
 */
describe("Label.fromLabel", () => {
  it("round-trips every label in range", () => {
    for (let n = 0; n <= 65535; n++) {
      expect(Label.fromLabel(Label.toLabel(n))).toBe(n)
    }
  })

  it("reads the CIP-67 spec vector", () => {
    expect(Label.toLabel(222)).toBe("000de140")
    expect(Label.fromLabel("000de140")).toBe(222)
  })

  it("returns undefined on a checksum mismatch", () => {
    expect(Label.fromLabel("000de141")).toBeUndefined()
  })

  it("returns undefined on the wrong shape", () => {
    expect(Label.fromLabel("")).toBeUndefined()
    expect(Label.fromLabel("000de14")).toBeUndefined()
    expect(Label.fromLabel("000de1400")).toBeUndefined()
    expect(Label.fromLabel("100de140")).toBeUndefined()
    expect(Label.fromLabel("000de141".replace(/0$/, "1"))).toBeUndefined()
  })

  // ⚠️ The bracket characters being "0" does not make the middle hex. These used to THROW a
  // ParseError out of `checksum`, from a function documented to return `undefined` — so a wallet
  // asking "is this a CIP-68 reference NFT?" about an arbitrary on-chain asset name got an
  // exception instead of an answer.
  it("returns undefined, rather than throwing, when the middle is not hex", () => {
    for (const label of ["0zzzz000", "0ZZZZ000", "0gggg000", "0  12000", "0+-*/000", "0e0e0"]) {
      expect(() => Label.fromLabel(label)).not.toThrow()
      expect(Label.fromLabel(label)).toBeUndefined()
    }
  })

  it("accepts upper-case hex, which is still a valid label", () => {
    const upper = Label.toLabel(222).toUpperCase().replace(/^0/, "0").replace(/0$/, "0")
    expect(Label.fromLabel(upper.toLowerCase())).toBe(222)
  })
})

describe("Label.toLabel", () => {
  it("refuses a number outside 0..65535", () => {
    expect(() => Label.toLabel(-1)).toThrow(/out of range/)
    expect(() => Label.toLabel(65536)).toThrow(/out of range/)
  })
})

describe("Label.LabelFromHex", () => {
  it("decodes and encodes through the schema", () => {
    expect(Schema.decodeSync(Label.LabelFromHex)("000de140")).toBe(222)
    expect(Schema.encodeSync(Label.LabelFromHex)(222)).toBe("000de140")
  })

  // The schema's own pattern already rejects a non-hex middle, which is why the defect above was
  // reachable only through the bare function.
  it("rejects a non-hex middle at the pattern, before the checksum", () => {
    expect(() => Schema.decodeSync(Label.LabelFromHex)("0zzzz000")).toThrow()
  })
})
