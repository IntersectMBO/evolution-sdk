import { Equal, Hash } from "effect"
import { describe, expect, it } from "vitest"

import * as NativeScripts from "../src/NativeScripts.js"

describe("a slot or `required` the cardano-cli JSON form cannot carry", () => {
  // ⚠️ `toJSON` used to do `Number(slot)`, so a slot above 2^53-1 came back as a DIFFERENT slot
  // with no error. A script decoded from the chain may legitimately carry any uint64, so this is
  // reachable on read, not only when authoring a script.
  const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n

  it("refuses an out-of-range slot instead of truncating it", () => {
    expect(() => NativeScripts.toJSON({ _tag: "InvalidHereafter", slot: tooBig })).toThrow(/exceeds/)
    expect(() => NativeScripts.toJSON({ _tag: "InvalidBefore", slot: tooBig })).toThrow(/exceeds/)
  })

  it("refuses an out-of-range `required` instead of truncating it", () => {
    expect(() => NativeScripts.toJSON({ _tag: "ScriptNOfK", required: tooBig, scripts: [] })).toThrow(/exceeds/)
  })

  // `required` is an int64, and the ledger accepts a negative one, so the lower bound is reachable
  // the same way the upper one is.
  it("refuses a `required` below the negative bound, and carries one inside it", () => {
    expect(() => NativeScripts.toJSON({ _tag: "ScriptNOfK", required: -tooBig, scripts: [] })).toThrow(/exceeds/)
    expect(NativeScripts.toJSON({ _tag: "ScriptNOfK", required: -1n, scripts: [] })).toEqual({
      type: "atLeast",
      required: -1,
      scripts: []
    })
  })

  it("accepts the largest value the form does carry, at either end", () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER)
    expect(NativeScripts.toJSON({ _tag: "InvalidHereafter", slot: max })).toEqual({
      type: "before",
      slot: Number.MAX_SAFE_INTEGER
    })
    expect(NativeScripts.toJSON({ _tag: "ScriptNOfK", required: -max, scripts: [] })).toEqual({
      type: "atLeast",
      required: -Number.MAX_SAFE_INTEGER,
      scripts: []
    })
  })

  it("refuses with the module's error, so callers can catch it by tag", () => {
    expect(() => NativeScripts.toJSON({ _tag: "InvalidHereafter", slot: tooBig })).toThrow(
      NativeScripts.NativeScriptError
    )
  })

  it("still hashes and compares such a script, rather than throwing", () => {
    // `Hash.symbol` must not route through `toJSON`, or putting one of these in a HashSet would
    // throw. Two scripts differing only above the bound must also not hash equal.
    const a = new NativeScripts.NativeScript({ script: { _tag: "InvalidHereafter", slot: tooBig } })
    const b = new NativeScripts.NativeScript({ script: { _tag: "InvalidHereafter", slot: tooBig + 1n } })
    expect(() => Hash.hash(a)).not.toThrow()
    expect(Hash.hash(a)).not.toBe(Hash.hash(b))
    expect(Equal.equals(a, b)).toBe(false)
  })
})

describe("the hash agrees with equality on the bytes, not on their container", () => {
  // `Equal.equals` compares hashes before structure (effect `Equal.ts:47`), so a hash that
  // distinguishes a `Buffer` from a `Uint8Array` over the same bytes makes two equal scripts
  // unequal — which a `JSON.stringify` of the variant did, since it writes a `Buffer` as
  // `{"type":"Buffer","data":[…]}` and a `Uint8Array` as `{"0":…}`.
  const bytes = new Uint8Array(28).fill(7)

  it("hashes a Buffer key hash and a Uint8Array key hash alike", () => {
    const fromBytes = NativeScripts.makeScriptPubKey(bytes)
    const fromBuffer = NativeScripts.makeScriptPubKey(Buffer.from(bytes))
    expect(Hash.hash(fromBytes)).toBe(Hash.hash(fromBuffer))
    expect(Equal.equals(fromBytes, fromBuffer)).toBe(true)
  })

  it("keeps that true for a nested script", () => {
    const nest = (keyHash: Uint8Array) =>
      NativeScripts.makeScriptNOfK(1n, [
        { _tag: "ScriptPubKey", keyHash },
        { _tag: "InvalidHereafter", slot: 42n }
      ])
    expect(Hash.hash(nest(bytes))).toBe(Hash.hash(nest(Buffer.from(bytes))))
    expect(Equal.equals(nest(bytes), nest(Buffer.from(bytes)))).toBe(true)
  })

  it("still separates scripts that differ", () => {
    const other = new Uint8Array(28).fill(8)
    expect(Hash.hash(NativeScripts.makeScriptPubKey(bytes))).not.toBe(
      Hash.hash(NativeScripts.makeScriptPubKey(other))
    )
    // A tag in the hash keeps the two time variants apart, which carry the same payload.
    expect(Hash.hash(NativeScripts.makeInvalidBefore(5n))).not.toBe(Hash.hash(NativeScripts.makeInvalidHereafter(5n)))
  })
})
