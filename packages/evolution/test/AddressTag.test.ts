import { describe, expect, it } from "vitest"

import * as AddressEras from "../src/AddressEras.js"
import * as AddressTag from "../src/AddressTag.js"

/**
 * `AddressTag` reads a header without validating the address. The contract has two halves: on a
 * well-formed address it must agree with `AddressEras`, and on a malformed one it must still
 * answer where `AddressEras` throws.
 */
describe("AddressTag reads a header without validating", () => {
  const pay = new Uint8Array(28).fill(0xab)
  const stake = new Uint8Array(28).fill(0xcd)
  const bytes = (header: number, ...rest: Array<Uint8Array>) => {
    const out = new Uint8Array(1 + rest.reduce((n, r) => n + r.length, 0))
    out[0] = header
    let at = 1
    for (const r of rest) {
      out.set(r, at)
      at += r.length
    }
    return out
  }

  // ⚠️ The hash alone is not the credential: a script hash and a key hash of the same bytes name
  // DIFFERENT owners. Inverting the script bit survived a hash-only comparison, so the tag is part
  // of what is asserted.
  const credOf = (c: { readonly _tag: string; readonly hash: Uint8Array } | undefined) =>
    c === undefined ? undefined : `${c._tag}:${Buffer.from(c.hash).toString("hex")}`
  const keyHash = (b: Uint8Array) => `KeyHash:${Buffer.from(b).toString("hex")}`

  it.each([
    ["base key/key", bytes(0x00, pay, stake), "Base", 0],
    ["base script/key", bytes(0x10, pay, stake), "Base", 0],
    ["base key/script", bytes(0x21, pay, stake), "Base", 1],
    ["pointer", bytes(0x40, pay, Uint8Array.from([1, 2, 3])), "Pointer", 0],
    ["enterprise", bytes(0x61, pay), "Enterprise", 1],
    ["reward key", bytes(0xe0, stake), "Reward", 0],
    ["reward script", bytes(0xf0, stake), "Reward", 0],
    ["base script/script", bytes(0x30, pay, stake), "Base", 0],
    ["enterprise script", bytes(0x71, pay), "Enterprise", 1],
    ["pointer script", bytes(0x50, pay, Uint8Array.from([1, 2, 3])), "Pointer", 0]
  ])("agrees with AddressEras on %s", (_name, addr, tag, network) => {
    // AddressEras is the oracle: it decodes these, so the two must say the same thing.
    const decoded = AddressEras.fromBytes(addr) as any
    expect(AddressTag.fromBytes(addr)).toBe(tag)
    expect(AddressTag.networkId(addr)).toBe(network)
    expect(decoded.networkId).toBe(network)
    expect(credOf(AddressTag.paymentCredential(addr))).toBe(credOf(decoded.paymentCredential))
    expect(credOf(AddressTag.stakeCredential(addr))).toBe(credOf(decoded.stakeCredential))
  })

  it.each([
    ["trailing junk", bytes(0x61, pay, Uint8Array.from([0xde, 0xad]))],
    ["truncated base", bytes(0x00, pay)],
    ["undefined header kind 0x90", bytes(0x90, pay)],
    ["empty", new Uint8Array(0)]
  ])("still answers where AddressEras throws: %s", (_name, addr) => {
    expect(() => AddressEras.fromBytes(addr)).toThrow()
    // The point of the surface: no throw, and `undefined` for what the bytes do not support.
    expect(() => {
      AddressTag.fromBytes(addr)
      AddressTag.networkId(addr)
      AddressTag.paymentCredential(addr)
      AddressTag.stakeCredential(addr)
    }).not.toThrow()
  })

  it("derives what it can from a malformed address rather than nothing", () => {
    const junk = bytes(0x61, pay, Uint8Array.from([0xde, 0xad]))
    expect(AddressTag.fromBytes(junk)).toBe("Enterprise")
    expect(AddressTag.networkId(junk)).toBe(1)
    expect(credOf(AddressTag.paymentCredential(junk))).toBe(keyHash(pay))
    expect(AddressTag.stakeCredential(junk)).toBeUndefined()

    const truncated = bytes(0x00, pay)
    expect(AddressTag.fromBytes(truncated)).toBe("Base")
    expect(credOf(AddressTag.paymentCredential(truncated))).toBe(keyHash(pay))
    // The stake credential is simply not there; that is `undefined`, not a throw and not zeros.
    expect(AddressTag.stakeCredential(truncated)).toBeUndefined()
  })

  it("answers undefined for a header kind CIP-19 does not define", () => {
    // 1001-1101 are reserved. The commented-out original threw here, which is what made it
    // unusable for an inspector: an unknown kind is exactly what review has to render.
    for (const type of [0b1001, 0b1010, 0b1011, 0b1100, 0b1101]) {
      expect(AddressTag.fromHeader(type << 4)).toBeUndefined()
    }
  })

  it("reports no network for Byron, which carries none", () => {
    const byron = bytes(0x82, pay)
    expect(AddressTag.fromBytes(byron)).toBe("Byron")
    expect(AddressTag.networkId(byron)).toBeUndefined()
    expect(AddressTag.paymentCredential(byron)).toBeUndefined()
  })
})
