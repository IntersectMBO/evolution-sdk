import { Equal } from "effect"
import { describe, expect, it } from "vitest"

import type { HeaderMap } from "../src/cose/Header.js"
import { headerMapNew } from "../src/cose/Header.js"
import { EdDSA25519Key } from "../src/cose/Key.js"
import { labelFromInt, labelFromText } from "../src/cose/Label.js"

// Label uses structural equality, but HeaderMap keyed its internal JS Map by
// Label instances, so Map.get/Map.set compared by reference. Every lookup or
// overwrite below uses a freshly built Label, which is what callers do.
describe("HeaderMap lookups with reference-distinct labels (#482)", () => {
  it("header() returns the value stored under an equal text label", () => {
    const bytes = new Uint8Array([1, 2, 3])
    const hm = headerMapNew().setHeader(labelFromText("address"), bytes)
    expect(hm.header(labelFromText("address"))).toBe(bytes)
  })

  it("header() returns the value stored under an equal int label", () => {
    const hm = headerMapNew().setHeader(labelFromInt(7n), 42n)
    expect(hm.header(labelFromInt(7n))).toBe(42n)
  })

  it("header() returns undefined for a label that was never set", () => {
    const hm = headerMapNew().setHeader(labelFromInt(7n), 42n)
    expect(hm.header(labelFromInt(8n))).toBeUndefined()
    expect(hm.header(labelFromText("7"))).toBeUndefined()
  })

  it("two HeaderMaps built from distinct but equal labels compare equal", () => {
    // The values are shared instances on purpose: this test pins the KEY
    // lookup. (Effect's Equal.equals compares Uint8Array values by
    // reference everywhere in this codebase — pre-existing value semantics,
    // not part of #482.)
    const bytes = new Uint8Array([1, 2, 3])
    const a = headerMapNew().setHeader(labelFromText("address"), bytes).setHeader(labelFromInt(7n), 42n)
    const b = headerMapNew().setHeader(labelFromText("address"), bytes).setHeader(labelFromInt(7n), 42n)
    expect(Equal.equals(a, b)).toBe(true)
    expect(Equal.equals(b, a)).toBe(true)
  })

  it("HeaderMaps with different values under an equal label do not compare equal", () => {
    const a = headerMapNew().setHeader(labelFromInt(7n), 42n)
    const b = headerMapNew().setHeader(labelFromInt(7n), 43n)
    expect(Equal.equals(a, b)).toBe(false)
  })

  it("setHeader overwrites an existing logical key instead of duplicating it", () => {
    const hm = headerMapNew().setHeader(labelFromInt(1n), 10n).setHeader(labelFromInt(1n), 20n)
    expect(hm.headers.size).toBe(1)
    expect(hm.header(labelFromInt(1n))).toBe(20n)
  })

  it("setAlgorithmId followed by setHeader on label 1 leaves a single entry", () => {
    // The exact call sequence EdDSA25519Key.build() performs.
    const hm = headerMapNew().setAlgorithmId(-8).setHeader(labelFromInt(1n), 1n)
    const labelOneEntries = hm.keys().filter((k) => Equal.equals(k, labelFromInt(1n)))
    expect(labelOneEntries).toHaveLength(1)
    expect(hm.header(labelFromInt(1n))).toBe(1n)
  })

  it("EdDSA25519Key.build() produces no duplicate label-1 header entries", () => {
    const key = new EdDSA25519Key({ privateKey: undefined, publicKey: undefined }, { disableValidation: true })
    const headers: HeaderMap = key.build().headers
    const labelOneEntries = headers.keys().filter((k) => Equal.equals(k, labelFromInt(1n)))
    expect(labelOneEntries).toHaveLength(1)
    expect(headers.header(labelFromInt(1n))).toBe(1n)
    expect(headers.header(labelFromInt(-1n))).toBe(6n)
  })
})
