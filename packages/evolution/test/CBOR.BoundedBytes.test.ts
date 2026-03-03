import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"

/**
 * Tests for CBOR bounded_bytes chunked encoding.
 *
 * The Conway CDDL specification mandates:
 *   bounded_bytes = bytes .size (0..64)
 *
 * Any Plutus data byte string longer than 64 bytes MUST be encoded as a
 * CBOR indefinite-length chunked byte string (0x5f [chunk]* 0xff) where
 * each chunk is at most 64 bytes.
 */
describe("CBOR Bounded Bytes Chunked Encoding", () => {
  const CHUNK_LIMIT = 64
  const DATA_OPTIONS = CBOR.CML_DATA_DEFAULT_OPTIONS
  const AIKEN_OPTIONS = CBOR.AIKEN_DEFAULT_OPTIONS

  // --- BoundedBytes node encoding tests ---

  describe("BoundedBytes.make encoding", () => {
    it("should encode <= 64 bytes as definite-length", () => {
      const value = new Uint8Array(64).fill(0xab)
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))
      // Definite-length: 0x58 0x40 (2-byte header for 64 bytes) + 64 bytes = 66 bytes
      expect(encoded[0]).toBe(0x58)
      expect(encoded[1]).toBe(0x40)
      expect(encoded.length).toBe(2 + 64)
    })

    it("should encode > 64 bytes as indefinite-length chunked", () => {
      const value = new Uint8Array(65).fill(0xcd)
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))
      expect(encoded[0]).toBe(0x5f)
      expect(encoded[encoded.length - 1]).toBe(0xff)
    })

    it("should produce correct chunk structure for 65 bytes (64+1)", () => {
      const value = new Uint8Array(65)
      for (let i = 0; i < 65; i++) value[i] = i & 0xff
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))

      // Structure: 0x5f | chunk1(64 bytes) | chunk2(1 byte) | 0xff
      expect(encoded[0]).toBe(0x5f)

      // Chunk 1: 0x58 0x40 + 64 bytes
      expect(encoded[1]).toBe(0x58)
      expect(encoded[2]).toBe(0x40)
      for (let i = 0; i < 64; i++) {
        expect(encoded[3 + i]).toBe(i)
      }

      // Chunk 2: 0x41 + 1 byte
      expect(encoded[67]).toBe(0x41)
      expect(encoded[68]).toBe(64)

      expect(encoded[69]).toBe(0xff)
      expect(encoded.length).toBe(70)
    })

    it("should produce correct chunk structure for 128 bytes (2x64)", () => {
      const value = new Uint8Array(128).fill(0xee)
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))

      // Structure: 0x5f | chunk1(64) | chunk2(64) | 0xff
      expect(encoded[0]).toBe(0x5f)
      expect(encoded[1]).toBe(0x58)
      expect(encoded[2]).toBe(64)
      expect(encoded[67]).toBe(0x58)
      expect(encoded[68]).toBe(64)
      expect(encoded[133]).toBe(0xff)
      expect(encoded.length).toBe(134)
    })

    it("should produce correct chunk structure for 200 bytes (3x64+8)", () => {
      const value = new Uint8Array(200).fill(0xaa)
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))

      expect(encoded[0]).toBe(0x5f)
      expect(encoded[encoded.length - 1]).toBe(0xff)
      // Final chunk header at offset 1 + (2+64)*3 = 199
      expect(encoded[199]).toBe(0x48) // 0x40 + 8
    })

    it("should encode empty bytes as 0x40", () => {
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(new Uint8Array(0)))
      expect(encoded).toEqual(new Uint8Array([0x40]))
    })
  })

  // --- Round-trip tests ---

  describe("round-trip: encode then decode", () => {
    it("should round-trip a 65-byte BoundedBytes value", () => {
      const value = new Uint8Array(65)
      for (let i = 0; i < 65; i++) value[i] = i & 0xff
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))
      const decoded = CBOR.fromCBORBytes(encoded, DATA_OPTIONS)
      expect(decoded).toEqual(value)
    })

    it("should round-trip a 128-byte BoundedBytes value", () => {
      const value = new Uint8Array(128).fill(0xab)
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))
      const decoded = CBOR.fromCBORBytes(encoded, DATA_OPTIONS)
      expect(decoded).toEqual(value)
    })

    it("should round-trip a 256-byte BoundedBytes value", () => {
      const value = new Uint8Array(256)
      for (let i = 0; i < 256; i++) value[i] = i & 0xff
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))
      const decoded = CBOR.fromCBORBytes(encoded, DATA_OPTIONS)
      expect(decoded).toEqual(value)
    })

    it("should round-trip a 1024-byte BoundedBytes value", () => {
      const value = new Uint8Array(1024)
      for (let i = 0; i < 1024; i++) value[i] = i & 0xff
      const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))
      const decoded = CBOR.fromCBORBytes(encoded, DATA_OPTIONS)
      expect(decoded).toEqual(value)
    })
  })

  // --- Data-level (PlutusData) tests ---

  describe("PlutusData byte arrays > 64 bytes", () => {
    it("should encode a large ByteArray field inside a Constr (redeemer shape)", () => {
      // Simulates a wormhole VAA message as redeemer data
      const largeMessage = new Uint8Array(543)
      for (let i = 0; i < 543; i++) largeMessage[i] = i & 0xff

      const redeemer = Data.constr(0n, [largeMessage])
      const encoded = Data.toCBORHex(redeemer)
      const decoded = Data.fromCBORHex(encoded)

      expect(Data.isConstr(decoded)).toBe(true)
      const decodedConstr = decoded as Data.Constr
      expect(decodedConstr.index).toBe(0n)
      expect(decodedConstr.fields.length).toBe(1)
      expect(decodedConstr.fields[0]).toEqual(largeMessage)
    })

    it("should encode a large ByteArray in a nested datum structure", () => {
      const largeBytes = new Uint8Array(200).fill(0xde)
      const datum = Data.constr(0n, [42n, Data.constr(1n, [largeBytes, Bytes.fromHex("cafe")])])

      const encoded = Data.toCBORHex(datum)
      const decoded = Data.fromCBORHex(encoded)
      expect(decoded).toEqual(datum)
    })

    it("should produce no chunk containing > 64 bytes in hex output", () => {
      const largeMessage = new Uint8Array(300).fill(0xab)
      const redeemer = Data.constr(0n, [largeMessage])
      const encodedBytes = Data.toCBORBytes(redeemer)

      // Walk CBOR and verify no definite byte string chunk > 64 bytes
      verifyNoBytestringExceeds(encodedBytes, CHUNK_LIMIT)
    })
  })

  describe("PlutusData byte arrays > 64 bytes (Aiken options)", () => {
    it("should chunk large byte arrays when encoded as PlutusData with Aiken options", () => {
      const largeBytes = new Uint8Array(100).fill(0xfe)
      // BoundedBytes encoding is unconditional — codec options don't affect it
      const encoded = Data.toCBORBytes(largeBytes, AIKEN_OPTIONS)
      expect(encoded[0]).toBe(0x5f)
      expect(encoded[encoded.length - 1]).toBe(0xff)
    })

    it("should round-trip large byte arrays through Aiken options", () => {
      const largeBytes = new Uint8Array(200).fill(0xab)
      const redeemer = Data.constr(0n, [largeBytes])
      const encoded = Data.toCBORHex(redeemer, AIKEN_OPTIONS)
      const decoded = Data.fromCBORHex(encoded, AIKEN_OPTIONS)
      expect(decoded).toEqual(redeemer)
    })
  })

  // --- Property-based tests ---

  describe("property-based bounded_bytes verification", () => {
    it("should round-trip arbitrary byte arrays of any size (0..1024)", () => {
      FastCheck.assert(
        FastCheck.property(FastCheck.uint8Array({ minLength: 0, maxLength: 1024 }), (value) => {
          const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))
          const decoded = CBOR.fromCBORBytes(encoded, DATA_OPTIONS) as Uint8Array
          expect(decoded).toEqual(value)
        }),
        { numRuns: 200 }
      )
    })

    it("should round-trip arbitrary large ByteArrays through PlutusData", () => {
      FastCheck.assert(
        FastCheck.property(FastCheck.uint8Array({ minLength: 65, maxLength: 512 }), (value) => {
          const encoded = Data.toCBORHex(value)
          const decoded = Data.fromCBORHex(encoded)
          expect(decoded).toEqual(value)
        }),
        { numRuns: 100 }
      )
    })

    it("should produce no > 64-byte definite bytestring in any PlutusData encoding", () => {
      FastCheck.assert(
        FastCheck.property(FastCheck.uint8Array({ minLength: 65, maxLength: 512 }), (value) => {
          const redeemer = Data.constr(0n, [value])
          const encodedBytes = Data.toCBORBytes(redeemer)
          verifyNoBytestringExceeds(encodedBytes, CHUNK_LIMIT)
        }),
        { numRuns: 100 }
      )
    })

    it("should match: <= 64 bytes -> definite, > 64 bytes -> chunked", () => {
      FastCheck.assert(
        FastCheck.property(FastCheck.uint8Array({ minLength: 1, maxLength: 256 }), (value) => {
          const encoded = CBOR.toCBORBytes(CBOR.BoundedBytes.make(value))
          if (value.length <= 64) {
            expect(encoded[0]).not.toBe(0x5f)
          } else {
            expect(encoded[0]).toBe(0x5f)
            expect(encoded[encoded.length - 1]).toBe(0xff)
          }
        }),
        { numRuns: 500 }
      )
    })
  })
})

// --- Helper: walk CBOR bytes and assert no definite byte string chunk > limit ---

const verifyNoBytestringExceeds = (data: Uint8Array, limit: number): void => {
  let offset = 0

  const walk = (): void => {
    if (offset >= data.length) return
    const byte = data[offset]
    const major = (byte >> 5) & 0x07
    const additional = byte & 0x1f

    switch (major) {
      case 0: // uint
      case 1: // nint
        offset += additional < 24 ? 1 : additional === 24 ? 2 : additional === 25 ? 3 : additional === 26 ? 5 : 9
        break
      case 2: // byte string
        if (additional === 31) {
          // Indefinite — walk inner chunks
          offset++ // skip 0x5f
          while (data[offset] !== 0xff) walk()
          offset++ // skip 0xff
        } else {
          const len = readLength(data, offset)
          if (len > limit) {
            throw new Error(`Found definite byte string of ${len} bytes, exceeds limit of ${limit}`)
          }
          offset += headerSize(additional) + len
        }
        break
      case 3: // text string
        if (additional === 31) {
          offset++
          while (data[offset] !== 0xff) walk()
          offset++
        } else {
          const len = readLength(data, offset)
          offset += headerSize(additional) + len
        }
        break
      case 4: // array
        if (additional === 31) {
          offset++
          while (data[offset] !== 0xff) walk()
          offset++
        } else {
          const len = readLength(data, offset)
          offset += headerSize(additional)
          for (let i = 0; i < len; i++) walk()
        }
        break
      case 5: // map
        if (additional === 31) {
          offset++
          while (data[offset] !== 0xff) {
            walk()
            walk()
          }
          offset++
        } else {
          const len = readLength(data, offset)
          offset += headerSize(additional)
          for (let i = 0; i < len; i++) {
            walk()
            walk()
          }
        }
        break
      case 6: // tag
        offset += headerSize(additional)
        walk()
        break
      case 7: // simple/float
        offset += additional < 24 ? 1 : additional === 24 ? 2 : additional === 25 ? 3 : additional === 26 ? 5 : 9
        break
    }
  }

  walk()
}

const readLength = (data: Uint8Array, offset: number): number => {
  const additional = data[offset] & 0x1f
  if (additional < 24) return additional
  if (additional === 24) return data[offset + 1]
  if (additional === 25) return (data[offset + 1] << 8) | data[offset + 2]
  if (additional === 26)
    return (data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4]
  return 0
}

const headerSize = (additional: number): number => {
  if (additional < 24) return 1
  if (additional === 24) return 2
  if (additional === 25) return 3
  if (additional === 26) return 5
  return 9
}
