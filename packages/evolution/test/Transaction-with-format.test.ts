import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as Ed25519Signature from "../src/Ed25519Signature.js"
import * as Transaction from "../src/Transaction.js"
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
