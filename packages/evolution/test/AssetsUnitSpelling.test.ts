/**
 * Both spellings of a unit have to round-trip, because both reach this module.
 *
 * ⚠️ The canonical spelling is the concatenation `policyId(56) + assetName`, which `getUnits`
 * emits. `fromUnit` has always also accepted `policyId.assetName`. Before the parse was shared,
 * the two disagreed: a value BUILT from a dotted unit answered `0n` when READ BACK with that same
 * string, because the reader sliced the dotted text at 56. Zero reads as "this asset is not
 * here", so the disagreement was silent -- and silent is how it reaches a balance.
 */
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import * as Assets from "../src/Assets.js"

const POLICY = "b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a7"
const NAME = "6e7574636f696e"
const DOTTED = `${POLICY}.${NAME}`
const JOINED = `${POLICY}${NAME}`

describe("unit spelling", () => {
  it("reads back a dotted unit with the string it was written with", async () => {
    const assets = await Effect.runPromise(Assets.fromUnit(DOTTED, 42n))
    expect(Assets.getByUnit(assets, DOTTED)).toBe(42n)
  })

  it("reads back a joined unit with the string it was written with", async () => {
    const assets = await Effect.runPromise(Assets.fromUnit(JOINED, 42n))
    expect(Assets.getByUnit(assets, JOINED)).toBe(42n)
  })

  it("treats the two spellings as the same asset, whichever built it", async () => {
    const fromDotted = await Effect.runPromise(Assets.fromUnit(DOTTED, 42n))
    const fromJoined = await Effect.runPromise(Assets.fromUnit(JOINED, 42n))
    for (const assets of [fromDotted, fromJoined]) {
      expect(Assets.getByUnit(assets, DOTTED)).toBe(42n)
      expect(Assets.getByUnit(assets, JOINED)).toBe(42n)
    }
  })

  it("emits the canonical joined spelling from getUnits", async () => {
    const assets = await Effect.runPromise(Assets.fromUnit(DOTTED, 7n))
    expect(Assets.getUnits(assets)).toContain(JOINED)
  })

  it("reads a record keyed either way", () => {
    expect(Assets.getByUnit(Assets.fromRecord({ [DOTTED]: 5n }), JOINED)).toBe(5n)
    expect(Assets.getByUnit(Assets.fromRecord({ [JOINED]: 5n }), DOTTED)).toBe(5n)
  })

  /**
   * ⚠️ An EMPTY asset name is a real name, and it is where the two spellings are closest. A bare
   * 56-char policy and that policy with a trailing dot must mean the same asset -- the preprod
   * wallet this is built for holds one.
   */
  it("treats an empty asset name the same either way", async () => {
    const bare = await Effect.runPromise(Assets.fromUnit(POLICY, 3n))
    const trailing = await Effect.runPromise(Assets.fromUnit(`${POLICY}.`, 3n))
    expect(Assets.getByUnit(bare, POLICY)).toBe(3n)
    expect(Assets.getByUnit(trailing, POLICY)).toBe(3n)
    expect(Assets.getByUnit(bare, `${POLICY}.`)).toBe(3n)
  })
})
