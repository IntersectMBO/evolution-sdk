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
// Plutus data encodings (#576) and the empty indefinite witness set (#580.2)
// ---------------------------------------------------------------------------

// Body with one tagged input set, one legacy array-form output and a fee.
const DATUM_BODY_HEX =
  "a300d9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0001818258390011111111111111111111111111111111111111111111111111111111222222222222222222222222222222222222222222222222222222221a000f4240021a0002a300"

// Plutus data encodings the ledger accepts. Each one used to come back from
// a decode/encode round trip in different bytes (the bignum form already
// round-tripped on main; it stays here as a guard).
const PLUTUS_DATA_ENCODINGS = [
  { name: "constructor 0 with an empty indefinite list", hex: "d8799fff" },
  { name: "empty indefinite map", hex: "bfff" },
  { name: "constructor 0 with an empty list in a 2-byte header", hex: "d8799800" },
  { name: "1 written as a bignum", hex: "c24101" },
  { name: "3 bytes in a 2-byte length header", hex: "5803cccccc" },
  { name: "bytes in indefinite chunks", hex: "5f4201024103ff" },
  { name: "control: constructor 0 with a non-empty indefinite list", hex: "d8799f01ff" }
] as const

const witnessDatumTxHex = (datumHex: string): string => `84${DATUM_BODY_HEX}a104d9010281${datumHex}f5f6`

const inlineDatumTxHex = (datumHex: string): string => {
  // Map-form output whose datum option (key 2) is [1, #6.24(datum bytes)].
  const header = (0x40 + datumHex.length / 2).toString(16)
  const output = `a3005839001111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222011a000f4240028201d818${header}${datumHex}`
  const body = `a300d9010281825820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000181${output}021a0002a300`
  return `84${body}a0f5f6`
}

describe("Transaction WithFormat — Plutus data encodings (#576)", () => {
  it.each(PLUTUS_DATA_ENCODINGS)("witness datum round-trips exactly: $name", ({ hex }) => {
    const txHex = witnessDatumTxHex(hex)
    const tx = Transaction.fromCBORHex(txHex)
    expect(Transaction.toCBORHex(tx)).toBe(txHex)
  })

  it.each(PLUTUS_DATA_ENCODINGS)("inline datum round-trips exactly: $name", ({ hex }) => {
    const txHex = inlineDatumTxHex(hex)
    const tx = Transaction.fromCBORHex(txHex)
    expect(Transaction.toCBORHex(tx)).toBe(txHex)
  })

  it("preserves the body hash of a transaction with a chunked inline datum — verified via CML", () => {
    const txHex = inlineDatumTxHex("5f4201024103ff")
    const tx = Transaction.fromCBORHex(txHex)
    const reEncoded = Transaction.toCBORHex(tx)

    const hashBefore = CML.hash_transaction(CML.Transaction.from_cbor_hex(txHex).body()).to_hex()
    const hashAfter = CML.hash_transaction(CML.Transaction.from_cbor_hex(reEncoded).body()).to_hex()
    expect(hashAfter).toBe(hashBefore)
  })

  it("round-trips an empty indefinite witness set exactly (#580 part 2)", () => {
    const txHex = `84${DATUM_BODY_HEX}bffff5f6`
    const tx = Transaction.fromCBORHex(txHex)
    expect(Transaction.toCBORHex(tx)).toBe(txHex)
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
