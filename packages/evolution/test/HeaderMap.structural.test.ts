import { describe, expect, it } from "vitest"

import { headerMapNew } from "../src/cose/Header.js"
import { labelFromInt, labelFromText } from "../src/cose/Label.js"

/**
 * `HeaderMap` holds a `Map` keyed by the Label OBJECT, and every `labelFromInt(n)` /
 * `labelFromText(s)` call builds a fresh one — so both of its accessors used to answer by
 * identity, which no caller can satisfy.
 */
describe("HeaderMap is keyed structurally, not by object identity", () => {
  // Setting the same label twice used to APPEND, leaving a COSE header map with a duplicate
  // key: both values encoded, and a receiver reads whichever it reaches first.
  it("setHeader replaces a label that is already present", () => {
    const m = headerMapNew()
      .setHeader(labelFromInt(7n), new Uint8Array([1]))
      .setHeader(labelFromInt(7n), new Uint8Array([2]))
    expect(m.headers.size).toBe(1)
    expect(m.header(labelFromInt(7n))).toEqual(new Uint8Array([2]))
  })

  // `headers.get(label)` answered `undefined` for a label that IS present, which is why every
  // reader in this package hand-walked `entries()` instead of calling this.
  it("header reads back what setHeader wrote", () => {
    const m = headerMapNew()
      .setHeader(labelFromInt(-2n), new Uint8Array([9]))
      .setHeader(labelFromText("address"), new Uint8Array([3]))
    expect(m.header(labelFromInt(-2n))).toEqual(new Uint8Array([9]))
    expect(m.header(labelFromText("address"))).toEqual(new Uint8Array([3]))
    expect(m.headers.size).toBe(2)
  })

  it("distinct labels stay distinct, and an absent one is undefined", () => {
    const m = headerMapNew()
      .setHeader(labelFromInt(1n), new Uint8Array([1]))
      .setHeader(labelFromInt(-1n), new Uint8Array([2]))
      .setHeader(labelFromText("1"), new Uint8Array([3]))
    expect(m.headers.size).toBe(3)
    expect(m.header(labelFromInt(1n))).toEqual(new Uint8Array([1]))
    expect(m.header(labelFromInt(-1n))).toEqual(new Uint8Array([2]))
    // An int label and a text label that print the same are NOT the same COSE label.
    expect(m.header(labelFromText("1"))).toEqual(new Uint8Array([3]))
    expect(m.header(labelFromInt(99n))).toBeUndefined()
  })

  it("keys() reports each label once after a repeated set", () => {
    const m = headerMapNew()
      .setHeader(labelFromInt(4n), new Uint8Array([1]))
      .setHeader(labelFromInt(4n), new Uint8Array([2]))
      .setHeader(labelFromInt(5n), new Uint8Array([3]))
    expect(m.keys()).toHaveLength(2)
  })
})
