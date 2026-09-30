import { describe, expect, it } from "@effect/vitest"

import * as CBOR from "../src/CBOR.js"

// ---------------------------------------------------------------------------
// Encoding vectors — every non-canonical encoding the CBOR layer can capture
// ---------------------------------------------------------------------------

const ENCODING_VECTORS = [
  { name: "uint non-minimal width (0 encoded as uint8)", hex: "1800" },
  { name: "nint non-minimal width (-1 encoded as uint8)", hex: "3800" },
  { name: "bytes indefinite chunks", hex: "5f4201024103ff" },
  { name: "text indefinite chunks", hex: "7f6161626263ff" },
  { name: "array indefinite length", hex: "9f0102ff" },
  { name: "map indefinite length", hex: "bf01020304ff" },
  { name: "tag non-minimal width (tag 24 as uint8)", hex: "d81800" },
  { name: "map non-canonical key order", hex: "a2036163016161" },
  { name: "nested mixed encodings", hex: "a205a182000082d8798082186418c803d901028143010203" }
] as const

describe("CBOR WithFormat — round-trips (hex)", () => {
  it.each(ENCODING_VECTORS)("hex: $name", ({ hex }) => {
    const { format, value } = CBOR.fromCBORHexWithFormat(hex)
    expect(CBOR.toCBORHexWithFormat(value, format)).toBe(hex)
  })
})

describe("CBOR WithFormat — round-trips (bytes)", () => {
  it.each(ENCODING_VECTORS)("bytes: $name", ({ hex }) => {
    const bytes = Buffer.from(hex, "hex")
    const { format, value } = CBOR.fromCBORBytesWithFormat(new Uint8Array(bytes))
    const reencoded = CBOR.toCBORBytesWithFormat(value, format)
    expect(Buffer.from(reencoded).toString("hex")).toBe(hex)
  })
})

describe("CBOR WithFormat — format tree is the complete specification", () => {
  it("WithFormat always applies regardless of what plain encode would produce", () => {
    const hex = "1800" // non-canonical: 0 encoded as uint8

    const { format, value } = CBOR.fromCBORHexWithFormat(hex)

    // WithFormat always preserves — no options can override it
    expect(CBOR.toCBORHexWithFormat(value, format)).toBe(hex)

    // Plain encode normalises (format tree is ignored, as expected)
    expect(CBOR.toCBORHex(value, CBOR.CANONICAL_OPTIONS)).not.toBe(hex)
    expect(CBOR.toCBORHex(value, CBOR.CML_DEFAULT_OPTIONS)).not.toBe(hex)
  })

  it("WithFormat is independent of plain decode (plain decode never captures format)", () => {
    const hex = "a218186162016161" // map with non-canonical key order
    const { format, value: withFmtValue } = CBOR.fromCBORHexWithFormat(hex)
    const plainValue = CBOR.fromCBORHex(hex)

    // WithFormat round-trip preserves byte-exact hex
    expect(CBOR.toCBORHexWithFormat(withFmtValue, format)).toBe(hex)

    // Plain round-trip canonicalises
    expect(CBOR.toCBORHex(plainValue, CBOR.CANONICAL_OPTIONS)).not.toBe(hex)
  })
})

describe("CBOR WithFormat — hand-crafted format injection", () => {
  it("explicit uint format with byteSize:1 forces non-minimal encoding", () => {
    const fmt: CBOR.CBORFormat = { _tag: "uint", byteSize: 1 }
    // 0n would normally encode as 0x00; byteSize:1 forces 0x1800
    expect(CBOR.toCBORHexWithFormat(0n, fmt)).toBe("1800")
  })

  it("explicit nint format with byteSize:1 forces non-minimal encoding", () => {
    const fmt: CBOR.CBORFormat = { _tag: "nint", byteSize: 1 }
    // -1n would normally encode as 0x20; byteSize:1 forces 0x3800
    expect(CBOR.toCBORHexWithFormat(-1n, fmt)).toBe("3800")
  })

  it("explicit array format with indefinite length produces indefinite encoding", () => {
    const fmt: CBOR.CBORFormat = {
      _tag: "array",
      length: { tag: "indefinite" },
      children: [{ _tag: "uint" }, { _tag: "uint" }]
    }
    // Definite [1, 2] = 0x820102; indefinite = 0x9f0102ff
    expect(CBOR.toCBORHexWithFormat([1n, 2n], fmt)).toBe("9f0102ff")
  })

  it("captured format round-trips correctly for map with non-canonical key order", () => {
    // key 3 (0x03) before key 1 (0x01) — non-canonical order
    const hex = "a2036163016161"
    const { format, value } = CBOR.fromCBORHexWithFormat(hex)

    // Captured format preserves the key order
    expect(CBOR.toCBORHexWithFormat(value, format)).toBe(hex)

    // Plain encode (no format) preserves JS Map insertion order — key 3 first
    expect(CBOR.toCBORHex(value)).toBe(hex)
  })
})
