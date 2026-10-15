import { blake2b } from "@noble/hashes/blake2.js"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"

// #397 part 2: toDatumHash must hash the bytes a datum was decoded from, not a
// re-encode — the ledger hashes the original bytes. The re-encode column below
// is the Plutus layout this module writes (indefinite lists, definite maps,
// minimal integers), probed on main for each vector.
const hashHex = (hex: string): string => Bytes.toHex(blake2b(Bytes.fromHex(hex), { dkLen: 32 }))

describe("Data.toDatumHash over original bytes (#397)", () => {
  it("hashes a list holding a non-minimally encoded integer from its original bytes", () => {
    const original = "811a0000000a" // [10], definite, 10 in a 4-byte integer header
    const data = Data.fromCBORHex(original)
    expect(Data.toCBORHex(data)).toBe("9f0aff") // the re-encode really is different
    expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hashHex(original))
  })

  it("hashes a definite-length list from its original bytes", () => {
    const original = "820102" // [1, 2] definite; the Plutus layout writes lists indefinite
    const data = Data.fromCBORHex(original)
    expect(Data.toCBORHex(data)).toBe("9f0102ff")
    expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hashHex(original))
  })

  it("hashes a byte string with a non-minimal length header from its original bytes", () => {
    const original = "5802aabb" // bytes(2) written with a 1-byte length header
    const data = Data.fromCBORHex(original)
    expect(Data.toCBORHex(data)).toBe("42aabb")
    expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hashHex(original))
  })

  it("hashes a map with a non-minimally encoded value from its original bytes", () => {
    const original = "a1011a00000002" // {1: 2} with 2 in a 4-byte integer header
    const data = Data.fromCBORHex(original)
    expect(Data.toCBORHex(data)).toBe("a10102")
    expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hashHex(original))
  })

  it("hashes an indefinite-length map from its original bytes", () => {
    const original = "bf0102ff" // {1: 2} indefinite; the Plutus layout writes maps definite
    const data = Data.fromCBORHex(original)
    expect(Data.toCBORHex(data)).toBe("a10102")
    expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hashHex(original))
  })

  it("hashes bytes decoded through fromCBORBytes from their original bytes", () => {
    const original = "811a0000000a"
    const data = Data.fromCBORBytes(Bytes.fromHex(original))
    expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hashHex(original))
  })

  it("a datum already in the Plutus layout hashes the same decoded and rebuilt", () => {
    const layout = "9f0aff" // [10] as this module writes it
    const decoded = Data.fromCBORHex(layout)
    expect(Bytes.toHex(Data.toDatumHash(decoded).hash)).toBe(hashHex(layout))
    expect(Bytes.toHex(Data.toDatumHash([10n]).hash)).toBe(hashHex(layout))
  })

  it("a locally built datum still hashes its own encoding", () => {
    const data = Data.constr(0n, [1n, 2n])
    expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hashHex(Data.toCBORHex(data)))
  })

  it("a bare integer datum falls back to its re-encode (bigint cannot be WeakMap-keyed)", () => {
    const data = Data.fromCBORHex("1a0000000a") // 10 as a bare top-level integer
    expect(data).toBe(10n)
    expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hashHex("0a"))
  })

  it("a non-default codec option re-encodes instead of replaying the original bytes", () => {
    const original = "811a0000000a"
    const data = Data.fromCBORHex(original)
    const custom = { ...Data.DEFAULT_CBOR_OPTIONS }
    expect(Bytes.toHex(Data.toDatumHash(data, custom).hash)).toBe(hashHex("9f0aff"))
  })
})
