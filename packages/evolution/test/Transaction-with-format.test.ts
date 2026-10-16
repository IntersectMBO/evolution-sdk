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

// ---------------------------------------------------------------------------
// Untagged sets (#574): a set decoded without tag 258 must not gain it on
// re-encode — the body bytes change, so the tx id changes and witnesses
// already collected no longer verify.
// ---------------------------------------------------------------------------

const HASH32 = "00".repeat(32)
// One input: [bstr(32 zero bytes), index 0 written as 0x1800]
const INPUT_1800 = `825820${HASH32}1800`
const UNTAGGED_BODY_DEFINITE = `a30081${INPUT_1800}01800200`
const UNTAGGED_BODY_INDEFINITE = `a3009f${INPUT_1800}ff01800200`
const UNTAGGED_TX_DEFINITE = `84${UNTAGGED_BODY_DEFINITE}a0f5f6`
const UNTAGGED_TX_INDEFINITE = `84${UNTAGGED_BODY_INDEFINITE}a0f5f6`

describe("Transaction WithFormat — untagged sets (#574)", () => {
  it("round-trips an untagged definite inputs set byte for byte (WithFormat)", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(UNTAGGED_TX_DEFINITE)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(UNTAGGED_TX_DEFINITE)
  })

  it("round-trips an untagged definite inputs set byte for byte (cached default path)", () => {
    const tx = Transaction.fromCBORHex(UNTAGGED_TX_DEFINITE)
    expect(Transaction.toCBORHex(tx)).toBe(UNTAGGED_TX_DEFINITE)
  })

  it("round-trips an untagged indefinite inputs set byte for byte", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(UNTAGGED_TX_INDEFINITE)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(UNTAGGED_TX_INDEFINITE)
  })

  it("keeps the body hash of an untagged transaction — verified via CML", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(UNTAGGED_TX_DEFINITE)
    const reEncoded = Transaction.toCBORHexWithFormat(tx, format)
    const hashBefore = CML.hash_transaction(CML.Transaction.from_cbor_hex(UNTAGGED_TX_DEFINITE).body()).to_hex()
    const hashAfter = CML.hash_transaction(CML.Transaction.from_cbor_hex(reEncoded).body()).to_hex()
    expect(hashAfter).toBe(hashBefore)
  })

  it("round-trips untagged collateral, required-signer, reference-input and certificate sets", () => {
    const collateralInput = `825820${"33".repeat(32)}01`
    const signer = `581c${"22".repeat(28)}`
    const referenceInput = `825820${"44".repeat(32)}02`
    // Stake registration certificate: [0, [0, key hash]]
    const certificate = `82008200581c${"11".repeat(28)}`
    const body =
      `a70081${INPUT_1800}01800200` +
      `0481${certificate}` +
      `0d81${collateralInput}` +
      `0e81${signer}` +
      `1281${referenceInput}`
    const txHex = `84${body}a0f5f6`
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(txHex)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(txHex)
  })

  it("round-trips an untagged vkey witness set byte for byte", () => {
    const witness = `a10081825820${"aa".repeat(32)}5840${"bb".repeat(64)}`
    const txHex = `84${NON_CANONICAL_BODY_HEX}${witness}f5f6`
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(txHex)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(txHex)
  })

  it("addVKeyWitnessesHex leaves an untagged transaction's body bytes unchanged", () => {
    const signedHex = Transaction.addVKeyWitnessesHex(UNTAGGED_TX_DEFINITE, buildWalletWitnessHex())
    expect(signedHex).toContain(UNTAGGED_BODY_DEFINITE)
    const hashBefore = CML.hash_transaction(CML.Transaction.from_cbor_hex(UNTAGGED_TX_DEFINITE).body()).to_hex()
    const hashAfter = CML.hash_transaction(CML.Transaction.from_cbor_hex(signedHex).body()).to_hex()
    expect(hashAfter).toBe(hashBefore)
  })

  it("a witness appended to an untagged witness set keeps the untagged form", () => {
    const first = `825820${"aa".repeat(32)}5840${"bb".repeat(64)}`
    const txHex = `84${NON_CANONICAL_BODY_HEX}a10081${first}f5f6`
    const walletWsHex = `a100d9010281825820${"cc".repeat(32)}5840${"dd".repeat(64)}`
    const signedHex = Transaction.addVKeyWitnessesHex(txHex, walletWsHex)
    const second = `825820${"cc".repeat(32)}5840${"dd".repeat(64)}`
    expect(signedHex).toBe(`84${NON_CANONICAL_BODY_HEX}a10082${first}${second}f5f6`)
  })

  it("control: tagged sets keep the tag, and a freshly built transaction is unchanged", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(NON_CANONICAL_TX_HEX)
    expect(Transaction.toCBORHexWithFormat(tx, format)).toBe(NON_CANONICAL_TX_HEX)
    const fresh = Transaction.fromCBORHex(NON_CANONICAL_TX_HEX)
    expect(Transaction.toCBORHex(fresh)).toBe(NON_CANONICAL_TX_HEX)
  })
})
