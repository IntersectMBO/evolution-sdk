import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Bip32PrivateKey from "../src/Bip32PrivateKey.js"
import * as Bip32PublicKey from "../src/Bip32PublicKey.js"
import * as TransactionHash from "../src/TransactionHash.js"

/**
 * The hex boundary carries a brand as well as a value.
 *
 * Leaving the typed domain used to discard what a string was: `toHex` returned a bare `string`,
 * so a transaction hash and a key were interchangeable from that point on. These brands say
 * which kind of hex it is, and — unlike a nominal brand — the schema checks the claim.
 *
 * The separation itself is a compile-time property and cannot be asserted at runtime; what is
 * asserted here is that each brand validates, which is the half a nominal brand never had.
 */

const TX = "aa".repeat(32)
const XPUB = "bb".repeat(64)
const XPRV = Bip32PrivateKey.toHex(Bip32PrivateKey.fromBip39Entropy(new Uint8Array(16)))

describe("TransactionHash.Hex", () => {
  it("is what toHex returns", () => {
    const hash = TransactionHash.fromHex(TX)
    expect(TransactionHash.toHex(hash)).toBe(TX)
  })

  it("accepts a 32-byte hex string", () => {
    expect(TransactionHash.Hex.make(TX)).toBe(TX)
  })

  it("refuses a string of the wrong length, which a nominal brand would have accepted", () => {
    expect(() => TransactionHash.Hex.make("aa")).toThrow()
    expect(() => TransactionHash.Hex.make("aa".repeat(33))).toThrow()
  })

  it("refuses a non-hex string", () => {
    expect(() => TransactionHash.Hex.make("zz".repeat(32))).toThrow()
  })

  it("accepts either case, because both are the same hash", () => {
    expect(() => TransactionHash.Hex.make("AA".repeat(32))).not.toThrow()
  })
})

describe("the extended key pair", () => {
  it("brands the public key at 64 bytes", () => {
    expect(Bip32PublicKey.Hex.make(XPUB)).toBe(XPUB)
    expect(() => Bip32PublicKey.Hex.make(XPRV)).toThrow()
  })

  it("brands the private key at 96 bytes", () => {
    expect(XPRV.length / 2).toBe(96)
    expect(Bip32PrivateKey.Hex.make(XPRV)).toBe(XPRV)
  })

  it("refuses the extended public key where the private one belongs, and the reverse", () => {
    // The lengths differ, so the schema catches the swap even before the brands do. That matters
    // because the two directions are not equally bad: publishing where a private key was expected
    // is wrong, while signing with what you believed was public is a leaked key.
    expect(() => Bip32PrivateKey.Hex.make(XPUB)).toThrow()
    expect(() => Bip32PublicKey.Hex.make(XPRV)).toThrow()
  })

  it("round-trips a private key through its branded hex", () => {
    expect(Bip32PrivateKey.toHex(Bip32PrivateKey.fromHex(XPRV))).toBe(XPRV)
  })
})

describe("the brands are schemas, not assertions", () => {
  it("decodes through the schema as well as the constructor", () => {
    expect(Schema.decodeSync(TransactionHash.Hex)(TX)).toBe(TX)
    expect(() => Schema.decodeSync(TransactionHash.Hex)("nope")).toThrow()
  })
})
