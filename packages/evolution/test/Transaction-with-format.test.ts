import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as Ed25519Signature from "../src/Ed25519Signature.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as VKey from "../src/VKey.js"

// fee=0 encoded as 0x1800 (non-canonical uint8) instead of canonical 0x00
// full tx = 84 <body> a0 f5 f6
const NON_CANONICAL_TX_HEX = "84a300d90102800180021800a0f5f6"
const NON_CANONICAL_BODY_HEX = "a300d90102800180021800"

const buildDummyVKeyWitness = (): TransactionWitnessSet.VKeyWitness =>
  new TransactionWitnessSet.VKeyWitness({
    vkey: VKey.fromBytes(new Uint8Array(32).fill(0xaa)),
    signature: Ed25519Signature.fromBytes(new Uint8Array(64).fill(0xbb))
  })

// ---------------------------------------------------------------------------
// Non-canonical encoding preservation
// ---------------------------------------------------------------------------

describe("Transaction WithFormat — non-canonical encoding", () => {
  it("round-trips non-canonical transaction bytes exactly (hex)", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(NON_CANONICAL_TX_HEX)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(NON_CANONICAL_TX_HEX)
  })

  it("round-trips non-canonical transaction bytes exactly (bytes)", () => {
    const bytes = Buffer.from(NON_CANONICAL_TX_HEX, "hex")
    const { format, value: tx } = Transaction.fromCBORBytesWithFormat(new Uint8Array(bytes))
    const reencoded = Transaction.toCBORBytesWithFormat(tx, format)
    expect(Buffer.from(reencoded).toString("hex")).toBe(NON_CANONICAL_TX_HEX)
  })

  it("preserves non-canonical body bytes (txId stable) — verified via CML", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(NON_CANONICAL_TX_HEX)
    const reEncoded = Transaction.toCBORHexWithFormat(tx, format)

    expect(reEncoded).toContain(NON_CANONICAL_BODY_HEX)

    const hashBefore = CML.hash_transaction(CML.Transaction.from_cbor_hex(NON_CANONICAL_TX_HEX).body()).to_hex()
    const hashAfter = CML.hash_transaction(CML.Transaction.from_cbor_hex(reEncoded).body()).to_hex()
    expect(hashAfter).toBe(hashBefore)
  })

  it("addVKeyWitnessesHex preserves non-canonical body (txId stable)", () => {
    const walletWsHex = buildWalletWitnessHex()
    const signedHex = Transaction.addVKeyWitnessesHex(NON_CANONICAL_TX_HEX, walletWsHex)

    expect(signedHex).toContain(NON_CANONICAL_BODY_HEX)

    const hashBefore = CML.hash_transaction(CML.Transaction.from_cbor_hex(NON_CANONICAL_TX_HEX).body()).to_hex()
    const hashAfter = CML.hash_transaction(CML.Transaction.from_cbor_hex(signedHex).body()).to_hex()
    expect(hashAfter).toBe(hashBefore)
  })
})

// ---------------------------------------------------------------------------
// Domain-level modification with WithFormat
// ---------------------------------------------------------------------------

describe("Transaction WithFormat — add witnesses and re-encode", () => {
  it("addVKeyWitnesses + toCBORHexWithFormat preserves non-canonical body encoding", () => {
    const { format, value: decoded } = Transaction.fromCBORHexWithFormat(NON_CANONICAL_TX_HEX)

    const modifiedTx = Transaction.addVKeyWitnesses(decoded, [buildDummyVKeyWitness()])
    const modifiedHex = Transaction.toCBORHexWithFormat(modifiedTx, format)

    expect(modifiedHex).toContain(NON_CANONICAL_BODY_HEX)
  })
})

// ---------------------------------------------------------------------------
// Property: round-trip preserves body bytes regardless of encoding
// ---------------------------------------------------------------------------

describe("Transaction WithFormat — property", () => {
  it("round-trip preserves body bytes for any encoded transaction", () => {
    FastCheck.assert(
      FastCheck.property(Transaction.arbitrary, (tx) => {
        const encoded = Transaction.toCBORBytes(tx, {
          mode: "custom",
          useIndefiniteArrays: true,
          useIndefiniteMaps: true,
          useDefiniteForEmpty: true,
          sortMapKeys: false,
          useMinimalEncoding: true,
          mapsAsObjects: false
        })

        const { format, value: decoded } = Transaction.fromCBORBytesWithFormat(encoded)
        const reEncoded = Transaction.toCBORBytesWithFormat(decoded, format)

        expect(bodyHex(reEncoded)).toBe(bodyHex(encoded))
      }),
      { numRuns: 50 }
    )
  })
})

// ---------------------------------------------------------------------------
// Map-form outputs (#577): an output written in the post-Alonzo map form
// must keep that form on re-encode, or the body bytes and tx id change.
// ---------------------------------------------------------------------------

// One input in a tagged set, fee 172_864, one output of 1_000_000 lovelace
// to a base address (header 0x00, payment hash 0x11…, stake hash 0x22…).
const MAP_FORM_TX_HEX =
  "84a300d9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000181a2005839001111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222011a000f4240021a0002a300a0f5f6"
const MAP_FORM_INDEFINITE_TX_HEX =
  "84a300d9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000181bf005839001111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222011a000f4240ff021a0002a300a0f5f6"
// Map form with a datum hash: key 2 carries the datum_option [0, hash].
const MAP_FORM_DATUM_TX_HEX =
  "84a300d9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000181a3005839001111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222011a000f424002820058203333333333333333333333333333333333333333333333333333333333333333021a0002a300a0f5f6"
const MAP_FORM_DATUM_BODY_HEX =
  "a300d9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000181a3005839001111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222011a000f424002820058203333333333333333333333333333333333333333333333333333333333333333021a0002a300"
// Two outputs: the first in map form, the second in legacy array form.
const MIXED_FORM_TX_HEX =
  "84a300d9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000182a2005839001111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222011a000f42408258390011111111111111111111111111111111111111111111111111111111222222222222222222222222222222222222222222222222222222221a000f4240021a0002a300a0f5f6"
// Array-form output plus a map-form collateral return (body key 16).
const COLLATERAL_RETURN_TX_HEX =
  "84a500d9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0001818258390011111111111111111111111111111111111111111111111111111111222222222222222222222222222222222222222222222222222222221a000f4240021a0002a3000dd9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0010a2005839001111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222011a000f4240a0f5f6"

describe("Transaction WithFormat — map-form outputs (#577)", () => {
  it("round-trips a definite map-form output exactly (WithFormat)", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(MAP_FORM_TX_HEX)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(MAP_FORM_TX_HEX)
  })

  it("round-trips a definite map-form output exactly (cached default path)", () => {
    const tx = Transaction.fromCBORHex(MAP_FORM_TX_HEX)
    expect(Transaction.toCBORHex(tx)).toBe(MAP_FORM_TX_HEX)
  })

  it("round-trips an indefinite map-form output exactly", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(MAP_FORM_INDEFINITE_TX_HEX)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(MAP_FORM_INDEFINITE_TX_HEX)
  })

  it("round-trips a map-form output with a datum hash exactly", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(MAP_FORM_DATUM_TX_HEX)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(MAP_FORM_DATUM_TX_HEX)
  })

  it("round-trips map-form and array-form outputs side by side", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(MIXED_FORM_TX_HEX)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(MIXED_FORM_TX_HEX)
  })

  it("round-trips a map-form collateral return exactly", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(COLLATERAL_RETURN_TX_HEX)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(COLLATERAL_RETURN_TX_HEX)
  })

  it("preserves the body hash of a map-form transaction — verified via CML", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(MAP_FORM_DATUM_TX_HEX)
    const reEncoded = Transaction.toCBORHexWithFormat(tx, format)

    const hashBefore = CML.hash_transaction(CML.Transaction.from_cbor_hex(MAP_FORM_DATUM_TX_HEX).body()).to_hex()
    const hashAfter = CML.hash_transaction(CML.Transaction.from_cbor_hex(reEncoded).body()).to_hex()
    expect(hashAfter).toBe(hashBefore)
  })

  it("addVKeyWitnessesHex leaves a map-form body unchanged", () => {
    const signedHex = Transaction.addVKeyWitnessesHex(MAP_FORM_TX_HEX, buildWalletWitnessHex())
    const body = MAP_FORM_TX_HEX.slice(2, -6)
    expect(signedHex).toContain(body)

    const hashBefore = CML.hash_transaction(CML.Transaction.from_cbor_hex(MAP_FORM_TX_HEX).body()).to_hex()
    const hashAfter = CML.hash_transaction(CML.Transaction.from_cbor_hex(signedHex).body()).to_hex()
    expect(hashAfter).toBe(hashBefore)
  })

  it("round-trips a map-form output at the TransactionBody level", () => {
    const { format, value: body } = TransactionBody.fromCBORHexWithFormat(MAP_FORM_DATUM_BODY_HEX)
    expect(TransactionBody.toCBORHexWithFormat(body, format)).toBe(MAP_FORM_DATUM_BODY_HEX)
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bodyHex(tx: Uint8Array): string {
  const hdr = (tx[0] & 0x1f) < 24 ? 1 : 2
  const { newOffset } = CBOR.decodeItemWithOffset(tx, hdr)
  return Buffer.from(tx.slice(hdr, newOffset)).toString("hex")
}

function buildWalletWitnessHex(): string {
  const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
  wsMap.set(0n, CBOR.Tag.make({ tag: 258, value: [[new Uint8Array(32).fill(0xaa), new Uint8Array(64).fill(0xbb)]] }))
  return Buffer.from(CBOR.toCBORBytes(wsMap)).toString("hex")
}
