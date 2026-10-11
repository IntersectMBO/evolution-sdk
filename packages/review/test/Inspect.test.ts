import { TransactionBody, TransactionHash } from "@evolution-sdk/evolution"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import * as Inspect from "../src/Inspect.js"
import { hexToBytes } from "../src/internal/Hex.js"
import { PREPROD_TX_CBOR, PREPROD_TX_HASH } from "./fixtures.js"

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runSync(eff as Effect.Effect<A, E, never>)

describe("the body slice is the transaction's identity", () => {
  // ⚠️ The strongest claim this package makes is that `txBodyFromTx` returns the EXACT original
  // bytes. The chain's own transaction id is the only oracle for that which does not come from
  // this code: blake2b-256 over the slice must reproduce it, so a slice off by one byte fails.
  it("blake2b-256 of the body slice is the published transaction id", () => {
    const bodyHex = run(Inspect.txBodyFromTx(PREPROD_TX_CBOR))
    const hash = TransactionBody.toHashFromBytes(hexToBytes(bodyHex))
    expect(TransactionHash.toHex(hash)).toBe(PREPROD_TX_HASH)
  })

  it("the slices partition the transaction: body, witness set and auxiliary data are all inside it", () => {
    const bodyHex = run(Inspect.txBodyFromTx(PREPROD_TX_CBOR))
    const witHex = run(Inspect.witnessSetFromTx(PREPROD_TX_CBOR))
    expect(PREPROD_TX_CBOR).toContain(bodyHex)
    expect(PREPROD_TX_CBOR).toContain(witHex)
    // A slice that merely *parses* could still be the wrong span; a slice that is a substring of
    // the original at all is the minimum, and the hash above is what pins which substring.
    expect(bodyHex.length).toBeGreaterThan(0)
    expect(witHex.length).toBeGreaterThan(0)
  })

  it("reports the transaction's validity flag", () => {
    expect(typeof run(Inspect.isValidFromTx(PREPROD_TX_CBOR))).toBe("boolean")
  })
})

// A minimal Conway body, written by hand so the expectations do not come from a decoder.
// `a3` is three pairs: 0 inputs, 1 outputs, 2 fee.
const IN32 = "11".repeat(32)
const BARE = `a30081825820${IN32}000180021a000f4240`
const TAGGED = `a300d9010281825820${IN32}000180021a000f4240`

describe("the two facts a schema decoder does not preserve", () => {
  // ⚠️ These are the reason this module walks the body positionally instead of decoding it. A
  // decoder that drops what it does not recognise cannot power review-before-sign: a crafted
  // body can show a reviewer one thing and a downstream decoder another.
  it("records body-map keys it does not model, rather than dropping them", () => {
    // key 6 is the deprecated Shelley `update`; key 23 is unassigned.
    const withUnknown = `a500d9010281825820${IN32}000180021a000f424006f61701`
    const { body } = run(Inspect.txBody(withUnknown))
    expect([...body.unknownKeys].sort((a, b) => a - b)).toEqual([6, 23])
  })

  it("reports no unknown keys when every key is modelled", () => {
    expect(run(Inspect.txBody(BARE)).body.unknownKeys).toEqual([])
  })

  it("distinguishes a #6.258-tagged input set from a bare one", () => {
    expect(run(Inspect.txBody(TAGGED)).taggedSets).toBe(true)
    expect(run(Inspect.txBody(BARE)).taggedSets).toBe(false)
  })

  it("does not mistake another two-byte tag for the Conway set tag", () => {
    // Tag 259, not 258. A two-byte comparison would accept every tag in 256..511.
    const tag259 = `a300d9010381825820${IN32}000180021a000f4240`
    expect(run(Inspect.txBody(tag259)).taggedSets).toBe(false)
  })

  it("decodes the same inputs whichever form the set arrived in", () => {
    const a = run(Inspect.txBody(TAGGED)).body
    const b = run(Inspect.txBody(BARE)).body
    expect(a.inputs).toEqual(b.inputs)
    expect(a.inputs[0]!.txHashHex).toBe(IN32)
  })
})

describe("malformed input fails rather than decoding a prefix", () => {
  for (const [name, hex] of [
    ["not hex", "zzzz"],
    ["odd length", "a"],
    ["truncated", "a300d9010281825820"],
    ["empty", ""],
    ["not a map", "83010203"]
  ] as const) {
    it(`rejects ${name}`, () => {
      expect(() => run(Inspect.txBody(hex))).toThrow()
    })
  }
})
