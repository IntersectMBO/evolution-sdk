import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"
import * as OriginalBytes from "../src/OriginalBytes.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionHash from "../src/TransactionHash.js"

/**
 * The ledger hashes the bytes a value arrived as, not a fresh encoding of it.
 *
 * Several encoding choices are not recoverable from a decoded value: an empty indefinite array
 * (`9fff`) decodes to the same `[]` as `80`, a chunked byte string to the same bytes as an
 * unchunked one, a `#6.258`-tagged input set to the same inputs as a bare array. Re-deriving any
 * of them changes a hash, and for `plutus_data` inside a redeemer that changes `script_data_hash`
 * -- a PHASE-2 FAILURE on chain, not a cosmetic byte difference.
 */
describe("Plutus data keeps the bytes it arrived as", () => {
  // Every row is a decode/encode round trip that the structural encoder alone would not survive.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["empty indefinite list (ledger D10)", "9fff"],
    ["empty definite list", "80"],
    ["nested empty indefinite", "9f9fffff"],
    ["constr 0 over empty indefinite fields", "d8799fff"],
    ["constr 1 over empty indefinite fields", "d87a9fff"],
    ["constr 0 over definite fields", "d87980"],
    ["minimal int", "182a"],
    ["bytes, unchunked", "43010203"],
    ["bytes, 64-byte chunked", `5f58400102${"03".repeat(62)}4104ff`],
    ["map, indefinite", "bf0001ff"],
    ["map, definite", "a10001"],
    ["map with a non-minimal key header", "a119002a01"],
    ["constr 102, indefinite fields", "d866821a000f423f9f01ff"],
    ["constr 102, definite fields", "d866821a000f423f8101"],
    ["constr 7 (tag 1280)", "d905009f01ff"],
    ["big_uint (tag 2)", "c249010000000000000000"],
    ["big_nint (tag 3)", "c349010000000000000000"],
    ["non-minimal int nested in a constr", "d8799f19002aff"],
    ["deep mix of all of the above", "d8799f9fff43aabbccbf014100ffff"]
  ]

  for (const [name, hex] of cases) {
    it(`round-trips ${name}`, () => {
      expect(Data.toCBORHex(Data.fromCBORHex(hex))).toBe(hex)
    })
  }

  it("splices decoded children into a list built here", () => {
    // This is what a caller assembling a Plutus list out of wire items used to do by hand, byte by
    // byte, because decoding lost the children's framing. The list itself is new, so it takes the
    // default framing; each child is the one that arrived.
    const indefiniteEmpty = Data.fromCBORHex("9fff")
    const definiteEmpty = Data.fromCBORHex("80")
    expect(Data.toCBORHex([indefiniteEmpty, definiteEmpty])).toBe("9f9fff80ff")
  })

  it("gives a value built here the default framing", () => {
    // The channel is a record of arrival, not a sticky preference: nothing was decoded, so there
    // is nothing to replay.
    expect(Data.toCBORHex([])).toBe("80")
    expect(Data.toCBORHex(Data.constr(1n, []))).toBe("d87a80")
  })

  it("lets canonical mode re-derive, because that is what asking for it means", () => {
    const decoded = Data.fromCBORHex("d87a9fff")
    expect(Data.toCBORHex(decoded)).toBe("d87a9fff")
    expect(Data.toCBORHex(decoded, CBOR.CANONICAL_OPTIONS)).toBe("d87a80")
  })

  // ⚠️ The one arrival detail still lost, recorded so it is a known boundary rather than a
  // surprise. `OriginalBytes` is a WeakMap and a `bigint` is not an object, so a non-minimally
  // encoded integer that IS the whole value has nowhere to carry its header width. Nested, its
  // container replays it -- which is the case the rows above cover and the case that occurs, since
  // `plutus_data` reaching a redeemer or a datum is a constructor, list or map in practice.
  it("cannot keep the header width of a bare root integer", () => {
    expect(Data.toCBORHex(Data.fromCBORHex("19002a"))).toBe("182a")
  })
})

describe("a redeemer keeps its datum's framing", () => {
  const exUnits = new Redeemer.ExUnits({ mem: 1_000_000n, steps: 500_000_000n })

  it("through a redeemer built around a decoded datum", () => {
    // ⚠️ The class field is `Data.DataValue`, not the transforming schema: validating through the
    // latter returns a structural COPY, and the provenance record keys on identity. Before that
    // change the bytes were dropped at this constructor.
    const data = Data.fromCBORHex("9fff")
    const redeemer = Redeemer.spend(0n, data, exUnits)
    expect(redeemer.data).toBe(data)
    expect(OriginalBytes.get(redeemer.data as object)).toBeDefined()
    expect(Redeemers.toCBORHex(new Redeemers.RedeemerArray({ value: [redeemer] }))).toBe(
      "818400009fff821a000f42401a1dcd6500"
    )
  })

  // ⚠️ Both a LIST and a CONSTR root, because they fail differently and only one of them catches
  // the class-field regression. `Schema.Array` rebuilds an array, so a list datum loses its record
  // at the constructor; a `Constr` is a class instance and passes through by identity, so a constr
  // datum survives even the transforming schema. A test written only over constrs stays green with
  // the defect reinstated -- it was, and this is why there are two rows.
  for (const [shape, arrivedHex, built] of [
    ["list", "9fff", [] as Data.Data],
    ["constr", "d87a9fff", Data.constr(1n, [])]
  ] as const) {
    it(`keeps the bytes a ${shape} datum arrived as, so the hash follows the chain`, () => {
      const arrived = Redeemer.spend(0n, Data.fromCBORHex(arrivedHex), exUnits)
      const rebuilt = Redeemer.spend(0n, built, exUnits)
      const encode = (r: Redeemer.Redeemer) => Redeemers.toCBORHex(new Redeemers.RedeemerArray({ value: [r] }))
      // The two datums are equal as values and different as bytes, which is the whole problem.
      expect(Data.equals(arrived.data, rebuilt.data)).toBe(true)
      expect(encode(arrived)).toContain(arrivedHex)
      expect(encode(arrived)).not.toBe(encode(rebuilt))
    })
  }
})

describe("splitArrayItems returns slices, never re-encodings", () => {
  const hx = (b: Uint8Array) => Bytes.toHex(b)
  const split = (hex: string) => CBOR.splitArrayItems(Bytes.fromHex(hex)).map(hx)

  it("steps over a #6.258 set tag", () => {
    expect(split("d9010281d8799f182aff")).toEqual(["d8799f182aff"])
  })

  it("reads a bare definite array", () => {
    expect(split("82182a44deadbeef")).toEqual(["182a", "44deadbeef"])
  })

  it("reads an indefinite array", () => {
    expect(split("9fd8799f182affff")).toEqual(["d8799f182aff"])
  })

  it("reads the empty forms", () => {
    expect(split("80")).toEqual([])
    expect(split("9fff")).toEqual([])
    expect(split("d901029fff")).toEqual([])
  })

  it("reads a non-minimal count header", () => {
    expect(split("98011820")).toEqual(["1820"])
  })

  it("refuses a value that is not an array", () => {
    expect(() => split("a10001")).toThrow(/expected an array/)
  })

  it("refuses a tag that is not 258", () => {
    expect(() => split("d9010181")).toThrow(/expected the set tag 258/)
  })

  it("refuses trailing bytes", () => {
    expect(() => split("8001" + "01")).toThrow(/expected to consume/)
  })
})

describe("a transaction body keeps the form its input set arrived in", () => {
  // A real transaction whose input set is `#6.258`-tagged, and the same one with the tag removed.
  // Conway writes the tagged form; Babbage wrote a bare array and the ledger still accepts it, so
  // a wallet co-signing someone else's transaction does not get to choose which it is handed.
  const TAGGED =
    "84a400d9010281825820" +
    "11".repeat(32) +
    "000181825839" +
    "22".repeat(57) +
    "1a001e8480021a00030d40031903e8a0f5f6"
  const BARE = TAGGED.replace("84a400d9010281", "84a40081")

  const bodyHexOf = (tx: string) => Bytes.toHex(Transaction.extractBodyBytes(Bytes.fromHex(tx)))

  for (const [name, tx] of [
    ["tagged", TAGGED],
    ["bare", BARE]
  ] as const) {
    it(`round-trips a ${name} input set`, () => {
      const body = bodyHexOf(tx)
      expect(TransactionBody.toCBORHex(TransactionBody.fromCBORHex(body))).toBe(body)
    })

    it(`hashes a ${name} input set as the bytes that arrived`, () => {
      // ⚠️ `toHash` used to hash a re-encoding, so for the bare form it returned the transaction
      // id of a DIFFERENT transaction -- three bytes longer, under a signature already attached to
      // the other one.
      const body = bodyHexOf(tx)
      expect(TransactionHash.toHex(TransactionBody.toHash(TransactionBody.fromCBORHex(body)))).toBe(
        TransactionHash.toHex(TransactionBody.toHashFromBytes(Bytes.fromHex(body)))
      )
    })
  }

  it("the two forms are genuinely different bytes, so the pairs above are real tests", () => {
    expect(bodyHexOf(BARE)).not.toBe(bodyHexOf(TAGGED))
    expect(bodyHexOf(TAGGED).length - bodyHexOf(BARE).length).toBe(6)
  })

  it("encodes a body built here structurally, with the tagged set Conway writes", () => {
    const decoded = TransactionBody.fromCBORHex(bodyHexOf(BARE))
    const rebuilt = new TransactionBody.TransactionBody({ ...decoded })
    expect(TransactionBody.toCBORHex(rebuilt)).toBe(bodyHexOf(TAGGED))
  })
})
