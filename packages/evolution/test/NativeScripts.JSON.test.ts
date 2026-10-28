import { Equal, Hash } from "effect"
import { describe, expect, it } from "vitest"

import * as NativeScripts from "../src/NativeScripts.js"

describe("a uint64 the cardano-cli JSON form cannot carry", () => {
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

  it("accepts the largest value the form does carry", () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER)
    expect(NativeScripts.toJSON({ _tag: "InvalidHereafter", slot: max })).toEqual({
      type: "before",
      slot: Number.MAX_SAFE_INTEGER
    })
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
