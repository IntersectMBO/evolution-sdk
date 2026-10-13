import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as TransactionMetadatum from "../src/TransactionMetadatum.js"

/**
 * The CDDL is `transaction_metadatum = ... / int / ...` where `int = uint / nint`, so the range
 * is -2^64 .. 2^64-1 and NOT a signed 64-bit integer.
 *
 * This was `Numeric.Int64`. The encode direction could not build a metadatum in
 * [2^63, 2^64-1]; the decode direction could not READ one, which is the half that matters,
 * because that is valid CBOR a transaction on chain can carry.
 */
describe("TransactionMetadatum integers cover the CDDL range", () => {
  const UINT64_MAX = 18446744073709551615n
  const NINT_MIN = -18446744073709551616n

  const roundTrips = (value: bigint, hex: string) => {
    expect(TransactionMetadatum.toCBORHex(value, CBOR.CANONICAL_OPTIONS)).toBe(hex)
    expect(TransactionMetadatum.fromCBORHex(hex, CBOR.CANONICAL_OPTIONS)).toBe(value)
  }

  it("round-trips the unsigned ceiling", () => {
    roundTrips(UINT64_MAX, "1bffffffffffffffff")
  })

  it("round-trips 2^63, which a signed 64-bit range excludes", () => {
    roundTrips(9223372036854775808n, "1b8000000000000000")
  })

  it("round-trips the last value the nint form reaches", () => {
    roundTrips(-18446744073709551615n, "3bfffffffffffffffe")
  })

  /**
   * ⚠️ -2^64 is the CDDL's nint floor and it used to be ASYMMETRIC: it decoded correctly and
   * re-encoded as a **tag-3 bignum** (`c348ffffffffffffffff`), which `transaction_metadatum`
   * does not permit -- the CDDL lists maps, arrays, int, bytes and text, and no tags. The cause
   * was an off-by-one in `encodeNintSync`, whose bound was -(2^64 - 1): major type 1 encodes
   * `-1 - argument`, and an 8-byte argument reaches 2^64 - 1, so this value fits the nint form.
   *
   * Fixed in the encoder, which is where the note here said it belonged. The round trip is
   * byte-for-byte now, and the bignum form is no longer emitted for any in-range value.
   */
  it("round-trips the nint floor, the last value the form reaches", () => {
    expect(TransactionMetadatum.fromCBORHex("3bffffffffffffffff", CBOR.CANONICAL_OPTIONS)).toBe(NINT_MIN)
    expect(TransactionMetadatum.toCBORHex(NINT_MIN, CBOR.CANONICAL_OPTIONS)).toBe("3bffffffffffffffff")
  })

  it("round-trips just past the signed minimum", () => {
    roundTrips(-9223372036854775809n, "3b8000000000000000")
  })

  it("still round-trips the signed bounds and small values", () => {
    roundTrips(0n, "00")
    roundTrips(1n, "01")
    roundTrips(9223372036854775807n, "1b7fffffffffffffff")
    roundTrips(-9223372036854775808n, "3b7fffffffffffffff")
  })

  // The range is a range, not an absence of one: a value outside the CDDL is still refused.
  it("refuses a value outside the CDDL range", () => {
    expect(() => TransactionMetadatum.toCBORHex(UINT64_MAX + 1n, CBOR.CANONICAL_OPTIONS)).toThrow()
    expect(() => TransactionMetadatum.toCBORHex(NINT_MIN - 1n, CBOR.CANONICAL_OPTIONS)).toThrow()
    expect(() => TransactionMetadatum.fromCBORHex("c249010000000000000000", CBOR.CANONICAL_OPTIONS)).toThrow()
  })

  it("carries a large integer inside a map and a list", () => {
    const list = [UINT64_MAX, -18446744073709551615n]
    expect(
      TransactionMetadatum.fromCBORHex(
        TransactionMetadatum.toCBORHex(list, CBOR.CANONICAL_OPTIONS),
        CBOR.CANONICAL_OPTIONS
      )
    ).toEqual(list)
    const map = new Map<TransactionMetadatum.TransactionMetadatum, TransactionMetadatum.TransactionMetadatum>([
      [0n, UINT64_MAX]
    ])
    expect(
      TransactionMetadatum.fromCBORHex(
        TransactionMetadatum.toCBORHex(map, CBOR.CANONICAL_OPTIONS),
        CBOR.CANONICAL_OPTIONS
      )
    ).toEqual(map)
  })
})
