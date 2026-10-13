import { Equal, FastCheck, Hash } from "effect"
import { describe, expect, it } from "vitest"

import * as NativeScripts from "../src/NativeScripts.js"

const KEY_HASH = "00".repeat(28)

/** The JSON form carries `slot`/`required` as JSON numbers, so it only covers values up to 2^53-1. */
const jsonRepresentable = (v: NativeScripts.NativeScriptVariants): boolean => {
  switch (v._tag) {
    case "InvalidBefore":
    case "InvalidHereafter":
      return v.slot <= BigInt(Number.MAX_SAFE_INTEGER)
    case "ScriptNOfK":
      return v.required <= BigInt(Number.MAX_SAFE_INTEGER) && v.scripts.every(jsonRepresentable)
    case "ScriptAll":
    case "ScriptAny":
      return v.scripts.every(jsonRepresentable)
    case "ScriptPubKey":
      return true
  }
}

describe("NativeScripts JSON representation", () => {
  it("round-trips any script through the cardano-cli JSON form (property)", () => {
    FastCheck.assert(
      FastCheck.property(NativeScripts.arbitrary.filter((ns) => jsonRepresentable(ns.script)), (ns) => {
        const rebuilt = new NativeScripts.NativeScript({
          script: NativeScripts.fromJSON(NativeScripts.toJSON(ns.script))
        })
        return Equal.equals(rebuilt, ns)
      }),
      { numRuns: 200 }
    )
  })

  it("round-trips the JSON itself, so the form is stable and not merely parseable", () => {
    FastCheck.assert(
      FastCheck.property(NativeScripts.arbitrary.filter((ns) => jsonRepresentable(ns.script)), (ns) => {
        const once = NativeScripts.toJSON(ns.script)
        const twice = NativeScripts.toJSON(NativeScripts.fromJSON(once))
        return JSON.stringify(once) === JSON.stringify(twice)
      }),
      { numRuns: 200 }
    )
  })

  describe("`before` and `after` are the opposite way round from the CDDL", () => {
    // ⚠️ The one trap in this mapping. `before` means "valid only before this slot", which is
    // InvalidHereafter; `after` means "valid at or after", which is InvalidBefore. Swapping them
    // builds a script that locks when it should open, and both directions still type-check.
    it("maps JSON `before` to InvalidHereafter", () => {
      expect(NativeScripts.fromJSON({ type: "before", slot: 42 })).toEqual({
        _tag: "InvalidHereafter",
        slot: 42n
      })
    })

    it("maps JSON `after` to InvalidBefore", () => {
      expect(NativeScripts.fromJSON({ type: "after", slot: 42 })).toEqual({
        _tag: "InvalidBefore",
        slot: 42n
      })
    })

    it("maps InvalidHereafter back to `before`, and InvalidBefore back to `after`", () => {
      expect(NativeScripts.toJSON({ _tag: "InvalidHereafter", slot: 7n })).toEqual({ type: "before", slot: 7 })
      expect(NativeScripts.toJSON({ _tag: "InvalidBefore", slot: 7n })).toEqual({ type: "after", slot: 7 })
    })
  })

  it("builds each node type", () => {
    expect(NativeScripts.fromJSON({ type: "sig", keyHash: KEY_HASH })._tag).toBe("ScriptPubKey")
    expect(NativeScripts.fromJSON({ type: "all", scripts: [] })._tag).toBe("ScriptAll")
    expect(NativeScripts.fromJSON({ type: "any", scripts: [] })._tag).toBe("ScriptAny")
    expect(NativeScripts.fromJSON({ type: "atLeast", required: 2, scripts: [] })._tag).toBe("ScriptNOfK")
  })

  it("nests, carrying `required` and the inner nodes", () => {
    const script = NativeScripts.fromJSON({
      type: "atLeast",
      required: 2,
      scripts: [
        { type: "sig", keyHash: KEY_HASH },
        { type: "all", scripts: [{ type: "before", slot: 99 }] }
      ]
    })
    expect(script).toMatchObject({
      _tag: "ScriptNOfK",
      required: 2n,
      scripts: [{ _tag: "ScriptPubKey" }, { _tag: "ScriptAll", scripts: [{ _tag: "InvalidHereafter", slot: 99n }] }]
    })
  })

  it("refuses a keyHash that is not a 28-byte hash, rather than building a script around it", () => {
    // The smart constructors validate through Hash28, so a short or non-hex hash fails here
    // instead of surfacing later as a script whose policy id nobody can explain.
    expect(() => NativeScripts.fromJSON({ type: "sig", keyHash: "00".repeat(27) })).toThrow()
    expect(() => NativeScripts.fromJSON({ type: "sig", keyHash: "00".repeat(29) })).toThrow()
    expect(() => NativeScripts.fromJSON({ type: "sig", keyHash: "zz".repeat(28) })).toThrow()
  })

  it("reaches the same CBOR as building the script directly", () => {
    const fromJson = new NativeScripts.NativeScript({
      script: NativeScripts.fromJSON({ type: "sig", keyHash: KEY_HASH })
    })
    const direct = NativeScripts.makeScriptPubKey(new Uint8Array(28))
    expect(NativeScripts.toCBORHex(fromJson)).toBe(NativeScripts.toCBORHex(direct))
  })

  describe("a uint64 the JSON form cannot carry", () => {
    // ⚠️ Found by writing `fromJSON`: `toJSON` used to do `Number(slot)`, so a slot above
    // 2^53-1 came back as a DIFFERENT slot with no error. A script decoded from the chain may
    // legitimately carry any uint64, so this is reachable on read, not just on authoring.
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
      // `Hash.symbol` must not route through `toJSON`, or putting one of these in a HashSet
      // would throw. Two scripts differing only above the bound must also not hash equal.
      const a = new NativeScripts.NativeScript({ script: { _tag: "InvalidHereafter", slot: tooBig } })
      const b = new NativeScripts.NativeScript({ script: { _tag: "InvalidHereafter", slot: tooBig + 1n } })
      expect(() => Hash.hash(a)).not.toThrow()
      expect(Hash.hash(a)).not.toBe(Hash.hash(b))
      expect(Equal.equals(a, b)).toBe(false)
    })
  })
})
