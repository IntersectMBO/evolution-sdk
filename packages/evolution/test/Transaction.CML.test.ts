import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { Equal, FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as Transaction from "../src/Transaction.js"

/**
 * CML compatibility tests for Transaction CBOR serialization.
 *
 * Three concerns:
 *  1. Evolution canonical encoding matches CML's canonical encoding.
 *  2. CML baselines for non-canonical body byte preservation (Issue 1).
 *  3. CML baselines for Conway map-format redeemer round-trips (Issue 2).
 */

// ---------------------------------------------------------------------------
// Canonical round-trip
// ---------------------------------------------------------------------------

describe("Transaction CML Compatibility", () => {
  it("property: Evolution Transaction CBOR equals CML and roundtrips", () => {
    FastCheck.assert(
      FastCheck.property(Transaction.arbitrary, (evoTx) => {
        // Evolution -> CBOR hex
        const evoHex = Transaction.toCBORHex(evoTx)
        // CML parses it
        const cmlTx = CML.Transaction.from_cbor_hex(evoHex)
        // CML -> CBOR hex
        const cmlHex = cmlTx.to_cbor_hex()
        // Equality on hex
        expect(cmlHex).toBe(evoHex)
        // Roundtrip back into Evolution and compare
        const evoBack = Transaction.fromCBORHex(cmlHex)
        expect(Equal.equals(evoBack, evoTx)).toBe(true)
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Issue 1 — Body bytes must be preserved to keep txId stable
// ---------------------------------------------------------------------------

describe("CML baseline: non-canonical body byte preservation", () => {
  // Non-canonical CBOR: fee field (key 2) is 0 encoded as 0x1800 (2 bytes)
  // instead of the canonical 0x00 (1 byte).
  // body = a3 00 d9010280 01 80 02 1800
  // full tx = 84 <body> a0 f5 f6
  const NON_CANONICAL_TX_HEX = "84a300d90102800180021800a0f5f6"
  const BODY_HEX = "a300d90102800180021800"

  it("CML baseline: preserves non-canonical body bytes and txId on round-trip", () => {
    const tx = CML.Transaction.from_cbor_hex(NON_CANONICAL_TX_HEX)
    const reEncoded = tx.to_cbor_hex()

    // CML round-trip preserves the exact bytes (including non-canonical 1800)
    expect(reEncoded).toBe(NON_CANONICAL_TX_HEX)

    // Hash is computed over raw body bytes, so it stays stable
    const hashBefore = CML.hash_transaction(tx.body()).to_hex()
    const tx2 = CML.Transaction.from_cbor_hex(reEncoded)
    const hashAfter = CML.hash_transaction(tx2.body()).to_hex()
    expect(hashAfter).toBe(hashBefore)
  })

  it("CML baseline: canonical encoding changes the hash (proving non-canonical matters)", () => {
    const tx = CML.Transaction.from_cbor_hex(NON_CANONICAL_TX_HEX)
    const canonicalHex = tx.to_canonical_cbor_hex()

    // Canonical normalises 0x1800 → 0x00, so the hex differs
    expect(canonicalHex).not.toBe(NON_CANONICAL_TX_HEX)

    // And the txId differs
    const hashOriginal = CML.hash_transaction(
      CML.Transaction.from_cbor_hex(NON_CANONICAL_TX_HEX).body()
    ).to_hex()
    const hashCanonical = CML.hash_transaction(
      CML.Transaction.from_cbor_hex(canonicalHex).body()
    ).to_hex()
    expect(hashCanonical).not.toBe(hashOriginal)
  })

  it("addVKeyWitnessesHex preserves non-canonical body — matching CML behavior", () => {
    const walletWsHex = buildDummyWalletWitnessHex()

    // Byte-level merge
    const signedHex = Transaction.addVKeyWitnessesHex(NON_CANONICAL_TX_HEX, walletWsHex)

    // The non-canonical body bytes are preserved verbatim
    expect(signedHex).toContain(BODY_HEX)

    // CML confirms the txId is stable across both
    const hashOriginal = CML.hash_transaction(
      CML.Transaction.from_cbor_hex(NON_CANONICAL_TX_HEX).body()
    ).to_hex()
    const hashSigned = CML.hash_transaction(
      CML.Transaction.from_cbor_hex(signedHex).body()
    ).to_hex()
    expect(hashSigned).toBe(hashOriginal)
  })
})

// ---------------------------------------------------------------------------
// Issue 2 — Conway map-format redeemers must survive decode→encode
// ---------------------------------------------------------------------------

describe("CML baseline: Conway map-format redeemer round-trips", () => {
  /** Build a full transaction hex with map-format redeemers using CML. */
  const buildCmlTxWithMapRedeemers = () => {
    const body = CML.TransactionBody.from_cbor_hex("a300d901028001800200")
    const exUnits = CML.ExUnits.new(100n, 200n)
    const plutusData = CML.PlutusData.new_integer(CML.BigInteger.from_str("0"))
    const redeemerKey = CML.RedeemerKey.new(CML.RedeemerTag.Spend, 0n)
    const redeemerVal = CML.RedeemerVal.new(plutusData, exUnits)
    const redeemerMap = CML.MapRedeemerKeyToRedeemerVal.new()
    redeemerMap.insert(redeemerKey, redeemerVal)
    const redeemers = CML.Redeemers.new_map_redeemer_key_to_redeemer_val(redeemerMap)
    const ws = CML.TransactionWitnessSet.new()
    ws.set_redeemers(redeemers)
    return CML.Transaction.new(body, ws, true).to_cbor_hex()
  }

  it("CML baseline: map-format redeemers round-trip perfectly", () => {
    const txHex = buildCmlTxWithMapRedeemers()
    const tx2 = CML.Transaction.from_cbor_hex(txHex)
    const reEncoded = tx2.to_cbor_hex()

    // Byte-perfect round-trip
    expect(reEncoded).toBe(txHex)

    // Redeemers are still map-format (major type 5 = 0xa_ prefix)
    const redeemersHex = tx2.witness_set().redeemers().to_cbor_hex()
    const majorType = (parseInt(redeemersHex.substring(0, 2), 16) >> 5) & 0x07
    expect(majorType).toBe(5) // CBOR map
  })

  it("evolution-sdk decodes CML-produced map-format redeemers (not silently dropped)", () => {
    const txHex = buildCmlTxWithMapRedeemers()

    // Decode through evolution-sdk
    const tx = Transaction.fromCBORHex(txHex)

    // Redeemers must exist and contain 1 entry
    expect(tx.witnessSet.redeemers).toBeDefined()
    expect(tx.witnessSet.redeemers!.size).toBe(1)

    // The redeemer must be a spend with index 0
    const r = tx.witnessSet.redeemers!.toArray()[0]
    expect(r.tag).toBe("spend")
    expect(r.index).toBe(0n)
    expect(r.exUnits.mem).toBe(100n)
    expect(r.exUnits.steps).toBe(200n)
  })

  it("evolution-sdk re-encodes map-format redeemers as a CBOR map (not array)", () => {
    const txHex = buildCmlTxWithMapRedeemers()

    // Decode → re-encode via evolution-sdk
    const tx = Transaction.fromCBORHex(txHex)
    const reEncoded = Transaction.toCBORHex(tx)

    // Parse the re-encoded witness set at CBOR level
    const wsBytes = extractWitnessSetBytes(reEncoded)
    const wsMap = CBOR.fromCBORBytes(wsBytes) as Map<bigint, CBOR.CBOR>
    const redeemersRaw = wsMap.get(5n)

    // Must be a Map (CBOR major type 5), not an Array (major type 4)
    expect(redeemersRaw).toBeInstanceOf(Map)

    // CML must also accept the re-encoded transaction and see map-format redeemers
    const cmlTx = CML.Transaction.from_cbor_hex(reEncoded)
    const cmlRedeemers = cmlTx.witness_set().redeemers()
    expect(cmlRedeemers).toBeDefined()
    const cmlRedeemersHex = cmlRedeemers.to_cbor_hex()
    const majorType = (parseInt(cmlRedeemersHex.substring(0, 2), 16) >> 5) & 0x07
    expect(majorType).toBe(5) // still map-format
  })

  it("evolution-sdk still handles CML-produced array-format redeemers correctly", () => {
    // Build a CML transaction with array (legacy) format redeemers
    const body = CML.TransactionBody.from_cbor_hex("a300d901028001800200")
    const exUnits = CML.ExUnits.new(100n, 200n)
    const plutusData = CML.PlutusData.new_integer(CML.BigInteger.from_str("0"))
    const legacyRedeemer = CML.LegacyRedeemer.new(
      CML.RedeemerTag.Spend,
      0n,
      plutusData,
      exUnits
    )
    const legacyList = CML.LegacyRedeemerList.new()
    legacyList.add(legacyRedeemer)
    const redeemers = CML.Redeemers.new_arr_legacy_redeemer(legacyList)
    const ws = CML.TransactionWitnessSet.new()
    ws.set_redeemers(redeemers)
    const txHex = CML.Transaction.new(body, ws, true).to_cbor_hex()

    // Verify CML produced array format
    const cmlRedeemersHex = redeemers.to_cbor_hex()
    const majorType = (parseInt(cmlRedeemersHex.substring(0, 2), 16) >> 5) & 0x07
    expect(majorType).toBe(4) // CBOR array

    // evolution-sdk decodes it
    const evoTx = Transaction.fromCBORHex(txHex)
    expect(evoTx.witnessSet.redeemers).toBeDefined()
    expect(evoTx.witnessSet.redeemers!.size).toBe(1)
    expect(evoTx.witnessSet.redeemers!.toArray()[0].tag).toBe("spend")

    // Re-encode stays array format
    const reEncoded = Transaction.toCBORHex(evoTx)
    const wsBytes = extractWitnessSetBytes(reEncoded)
    const wsMap = CBOR.fromCBORBytes(wsBytes) as Map<bigint, CBOR.CBOR>
    expect(Array.isArray(wsMap.get(5n))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Combined: byte-level merge preserves map-format redeemers
// ---------------------------------------------------------------------------

describe("Combined: addVKeyWitnessesHex preserves map-format redeemers (CML verified)", () => {
  it("merges a vkey witness without disturbing map-format redeemers", () => {
    // CML-built transaction with map-format redeemers
    const body = CML.TransactionBody.from_cbor_hex("a300d901028001800200")
    const exUnits = CML.ExUnits.new(50n, 100n)
    const plutusData = CML.PlutusData.new_integer(CML.BigInteger.from_str("42"))
    const redeemerKey = CML.RedeemerKey.new(CML.RedeemerTag.Spend, 0n)
    const redeemerVal = CML.RedeemerVal.new(plutusData, exUnits)
    const redeemerMap = CML.MapRedeemerKeyToRedeemerVal.new()
    redeemerMap.insert(redeemerKey, redeemerVal)
    const redeemers = CML.Redeemers.new_map_redeemer_key_to_redeemer_val(redeemerMap)
    const ws = CML.TransactionWitnessSet.new()
    ws.set_redeemers(redeemers)
    const txHex = CML.Transaction.new(body, ws, true).to_cbor_hex()

    // Capture CML's raw redeemers CBOR hex
    const originalRedeemersHex = redeemers.to_cbor_hex()

    // Merge a dummy vkey witness using evolution-sdk byte-level merge
    const walletWsHex = buildDummyWalletWitnessHex()
    const signedHex = Transaction.addVKeyWitnessesHex(txHex, walletWsHex)

    // The signed transaction must contain the original redeemers bytes verbatim
    expect(signedHex).toContain(originalRedeemersHex)

    // CML must accept the signed transaction
    const cmlSigned = CML.Transaction.from_cbor_hex(signedHex)

    // Redeemers must still be present and in map format
    const cmlSignedRedeemers = cmlSigned.witness_set().redeemers()
    expect(cmlSignedRedeemers).toBeDefined()
    const signedRedeemersHex = cmlSignedRedeemers.to_cbor_hex()
    const majorType = (parseInt(signedRedeemersHex.substring(0, 2), 16) >> 5) & 0x07
    expect(majorType).toBe(5) // still map

    // Vkey witnesses must have been added
    const signedVkeys = cmlSigned.witness_set().vkeywitnesses()
    expect(signedVkeys).toBeDefined()
    expect(signedVkeys.len()).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a dummy wallet witness set CBOR hex with one vkey witness. */
function buildDummyWalletWitnessHex(): string {
  const vkey = new Uint8Array(32).fill(0xaa)
  const sig = new Uint8Array(64).fill(0xbb)
  const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
  wsMap.set(0n, CBOR.Tag.make({ tag: 258, value: [[vkey, sig]] }))
  return Buffer.from(CBOR.toCBORBytes(wsMap)).toString("hex")
}

/** Extract the raw witness set bytes from a full transaction hex. */
function extractWitnessSetBytes(txHex: string): Uint8Array {
  const txBytes = Buffer.from(txHex, "hex")
  const arrHdr = (txBytes[0] & 0x1f) < 24 ? 1 : 2
  const { newOffset: bodyEnd } = CBOR.decodeItemWithOffset(txBytes, arrHdr)
  const { newOffset: wsEnd } = CBOR.decodeItemWithOffset(txBytes, bodyEnd)
  return new Uint8Array(txBytes.slice(bodyEnd, wsEnd))
}
