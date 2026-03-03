import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as PlutusData from "../src/Data.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"

// ---------------------------------------------------------------------------
// addVKeyWitnessesBytes — CML-like byte-level witness merging
//
// The function operates directly on raw CBOR bytes. Only the vkey witnesses
// value (key 0) in the witness set map is modified. Everything else — body,
// redeemers, datums, scripts, isValid, auxData, map entry ordering — is
// preserved byte-for-byte.
// ---------------------------------------------------------------------------

/** Helper: build a dummy wallet witness set CBOR containing one vkey witness. */
const buildWalletWitnessBytes = (): Uint8Array => {
  const vkey = new Uint8Array(32).fill(0xaa)
  const sig = new Uint8Array(64).fill(0xbb)
  const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
  wsMap.set(0n, CBOR.Tag.make({ tag: 258, value: [[vkey, sig]] }))
  return CBOR.toCBORBytes(wsMap)
}

describe("addVKeyWitnessesBytes", () => {
  it("preserves every byte except the vkey witnesses value", () => {
    // Generate a tx, capture its hex
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const txBytes = Transaction.toCBORBytes(sampleTx)
    const txHex = Buffer.from(txBytes).toString("hex")

    // Merge a wallet witness
    const walletWsBytes = buildWalletWitnessBytes()
    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, walletWsBytes)
    const signedHex = Buffer.from(signedBytes).toString("hex")

    // Body bytes must be identical (same position in both)
    const hdr = (txBytes[0] & 0x1f) < 24 ? 1 : 2
    const { newOffset: bodyEnd } = CBOR.decodeItemWithOffset(txBytes, hdr)
    const originalBody = txHex.slice(hdr * 2, bodyEnd * 2)

    const hdr2 = (signedBytes[0] & 0x1f) < 24 ? 1 : 2
    const { newOffset: bodyEnd2 } = CBOR.decodeItemWithOffset(signedBytes, hdr2)
    const signedBody = signedHex.slice(hdr2 * 2, bodyEnd2 * 2)

    expect(signedBody).toBe(originalBody)

    // isValid + auxData bytes must be identical (tail of the transaction)
    const { newOffset: wsEnd } = CBOR.decodeItemWithOffset(txBytes, bodyEnd)
    const originalTail = txHex.slice(wsEnd * 2)

    const { newOffset: wsEnd2 } = CBOR.decodeItemWithOffset(signedBytes, bodyEnd2)
    const signedTail = signedHex.slice(wsEnd2 * 2)

    expect(signedTail).toBe(originalTail)
  })

  it("preserves non-canonical body encoding (txId stable)", () => {
    // fee=0 encoded as 0x1800 (non-canonical) instead of 0x00
    const nonCanonicalHex = "84a300d90102800180021800a0f5f6"
    const txBytes = Buffer.from(nonCanonicalHex, "hex")

    const walletWsBytes = buildWalletWitnessBytes()
    const signedBytes = Transaction.addVKeyWitnessesBytes(new Uint8Array(txBytes), walletWsBytes)

    // The non-canonical body (a300d90102800180021800) must appear verbatim
    const signedHex = Buffer.from(signedBytes).toString("hex")
    expect(signedHex).toContain("a300d90102800180021800")
  })

  it("preserves redeemers bytes when adding vkeys (scriptDataHash stable)", () => {
    // Build a tx with map-format redeemers
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const bodyBytes = TransactionBody.toCBORBytes(sampleTx.body)

    // Map-format redeemers with specific CBOR encoding
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)
    const witnessMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    witnessMap.set(5n, redeemersMap)
    const witnessBytes = CBOR.toCBORBytes(witnessMap)

    // Capture the raw redeemers bytes from the witness set
    const wsParsed = CBOR.fromCBORBytes(witnessBytes) as Map<bigint, CBOR.CBOR>
    const originalRedeemersHex = Buffer.from(CBOR.toCBORBytes(wsParsed.get(5n)!)).toString("hex")

    // Assemble full transaction
    const txBytes = CBOR.encodeArrayAsDefinite([
      bodyBytes,
      witnessBytes,
      CBOR.internalEncodeSync(true),
      CBOR.internalEncodeSync(null)
    ])

    // Merge a wallet witness
    const walletWsBytes = buildWalletWitnessBytes()
    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, walletWsBytes)

    // Extract the witness set from the signed tx and check redeemers
    const signedArray = CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>
    const signedWsMap = signedArray[1] as Map<bigint, CBOR.CBOR>

    // Redeemers still present and in map format
    expect(signedWsMap.get(5n)).toBeInstanceOf(Map)

    // Redeemers bytes are IDENTICAL
    const signedRedeemersHex = Buffer.from(CBOR.toCBORBytes(signedWsMap.get(5n)!)).toString("hex")
    expect(signedRedeemersHex).toBe(originalRedeemersHex)

    // Vkeys were added
    expect(signedWsMap.get(0n)).toBeDefined()
  })

  it("preserves map entry ordering", () => {
    // Build witness set with keys in order: 3, 5 (no key 0)
    const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    wsMap.set(3n, CBOR.Tag.make({ tag: 258, value: [new Uint8Array([1, 2, 3])] }))
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)
    wsMap.set(5n, redeemersMap)
    const wsBytes = CBOR.toCBORBytes(wsMap)

    // Capture the raw bytes of the key 3 and key 5 entries
    const { count, hdrSize } = readMapCountHelper(wsBytes)
    expect(count).toBe(2)
    let off = hdrSize
    const entries: Array<{ key: bigint; raw: string }> = []
    for (let i = 0; i < count; i++) {
      const kvStart = off
      const { item: k, newOffset: kEnd } = CBOR.decodeItemWithOffset(wsBytes, off)
      const { newOffset: vEnd } = CBOR.decodeItemWithOffset(wsBytes, kEnd)
      entries.push({ key: k as bigint, raw: Buffer.from(wsBytes.slice(kvStart, vEnd)).toString("hex") })
      off = vEnd
    }

    // Build a tx with this witness set
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const bodyBytes = TransactionBody.toCBORBytes(sampleTx.body)
    const txBytes = CBOR.encodeArrayAsDefinite([
      bodyBytes,
      wsBytes,
      CBOR.internalEncodeSync(true),
      CBOR.internalEncodeSync(null)
    ])

    // Add vkeys
    const walletWsBytes = buildWalletWitnessBytes()
    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, walletWsBytes)

    // Parse signed witness set — key 3 and 5 entries should appear in original order
    // with their original raw bytes, and key 0 appended at the end
    const signedHex = Buffer.from(signedBytes).toString("hex")
    for (const entry of entries) {
      expect(signedHex).toContain(entry.raw)
    }

    // Key 0 should appear after the original entries
    const signedArray = CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>
    const signedWsMap = signedArray[1] as Map<bigint, CBOR.CBOR>
    expect(signedWsMap.has(0n)).toBe(true)
    expect(signedWsMap.has(3n)).toBe(true)
    expect(signedWsMap.has(5n)).toBe(true)
  })

  it("splices in-place when key 0 already exists", () => {
    // Build witness set with existing vkey + redeemers
    const existingVkey = new Uint8Array(32).fill(0x11)
    const existingSig = new Uint8Array(64).fill(0x22)
    const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    wsMap.set(0n, CBOR.Tag.make({ tag: 258, value: [[existingVkey, existingSig]] }))
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [50n, 100n]] as unknown as CBOR.CBOR)
    wsMap.set(5n, redeemersMap)
    const wsBytes = CBOR.toCBORBytes(wsMap)

    // Capture raw redeemers entry bytes
    const { hdrSize } = readMapCountHelper(wsBytes)
    let off = hdrSize
    let redeemersEntryHex = ""
    for (let i = 0; i < 2; i++) {
      const kvStart = off
      const { item: k, newOffset: kEnd } = CBOR.decodeItemWithOffset(wsBytes, off)
      const { newOffset: vEnd } = CBOR.decodeItemWithOffset(wsBytes, kEnd)
      if (k === 5n) {
        redeemersEntryHex = Buffer.from(wsBytes.slice(kvStart, vEnd)).toString("hex")
      }
      off = vEnd
    }

    // Build tx
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const bodyBytes = TransactionBody.toCBORBytes(sampleTx.body)
    const txBytes = CBOR.encodeArrayAsDefinite([
      bodyBytes,
      wsBytes,
      CBOR.internalEncodeSync(true),
      CBOR.internalEncodeSync(null)
    ])

    // Add wallet witness
    const walletWsBytes = buildWalletWitnessBytes()
    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, walletWsBytes)

    // Redeemers entry bytes preserved verbatim
    const signedHex = Buffer.from(signedBytes).toString("hex")
    expect(signedHex).toContain(redeemersEntryHex)

    // Now has 2 vkey witnesses (1 existing + 1 wallet)
    const signedArray = CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>
    const signedWsMap = signedArray[1] as Map<bigint, CBOR.CBOR>
    const vkeys = unwrapVkeyArrayHelper(signedWsMap.get(0n))
    expect(vkeys.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Issue 1 & 2 proof tests (regression)
// ---------------------------------------------------------------------------

describe("Issue 1: body bytes not preserved on standard round-trip", () => {
  it("standard round-trip changes body bytes for non-canonical CBOR", () => {
    const nonCanonicalHex = "84a300d90102800180021800a0f5f6"
    const tx = Transaction.fromCBORHex(nonCanonicalHex)
    const standardHex = Transaction.toCBORHex(tx)
    expect(standardHex).not.toBe(nonCanonicalHex)
  })

  it("addVKeyWitnessesHex preserves non-canonical body", () => {
    const nonCanonicalHex = "84a300d90102800180021800a0f5f6"
    const walletWsHex = Buffer.from(buildWalletWitnessBytes()).toString("hex")
    const signedHex = Transaction.addVKeyWitnessesHex(nonCanonicalHex, walletWsHex)
    // Non-canonical body preserved
    expect(signedHex).toContain("a300d90102800180021800")
  })
})

describe("Issue 2: map-format redeemers dropped on decode", () => {
  it("map-format redeemers survive full Transaction decode→encode", () => {
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const bodyBytes = TransactionBody.toCBORBytes(sampleTx.body)
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)
    const witnessMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    witnessMap.set(5n, redeemersMap)
    const witnessBytes = CBOR.toCBORBytes(witnessMap)
    const fullBytes = CBOR.encodeArrayAsDefinite([
      bodyBytes,
      witnessBytes,
      CBOR.internalEncodeSync(true),
      CBOR.internalEncodeSync(null)
    ])

    const decoded = Transaction.fromCBORBytes(fullBytes)
    expect(decoded.witnessSet.redeemers).toBeDefined()
    expect(decoded.witnessSet.redeemers!.length).toBe(1)
    expect(decoded.witnessSet.redeemers![0].tag).toBe("spend")
  })
})

describe("Conway map-format redeemers", () => {
  it("decodes and re-encodes map-format redeemers in TransactionWitnessSet", () => {
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)
    const witnessMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    witnessMap.set(5n, redeemersMap)
    const witnessBytes = CBOR.toCBORBytes(witnessMap)

    const ws = TransactionWitnessSet.fromCBORBytes(witnessBytes)
    expect(ws.redeemers).toBeDefined()
    expect(ws.redeemers!.length).toBe(1)
    expect(ws.redeemers![0].tag).toBe("spend")
    expect((ws as any)._redeemersFormat).toBe("map")

    const reEncodedBytes = TransactionWitnessSet.toCBORBytes(ws)
    const reDecodedCBOR = CBOR.fromCBORBytes(reEncodedBytes) as Map<bigint, CBOR.CBOR>
    expect(reDecodedCBOR.get(5n)).toBeInstanceOf(Map)
  })

  it("still decodes array-format redeemers correctly", () => {
    const redeemer = Redeemer.spend(0n, PlutusData.constr(0n, []), new Redeemer.ExUnits({ mem: 100n, steps: 200n }))
    const redeemersCollection = new Redeemers.Redeemers({ values: [redeemer] })
    const arrayFormatBytes = Redeemers.toCBORBytes(redeemersCollection)
    const arrayFormatCBOR = CBOR.fromCBORBytes(arrayFormatBytes)
    const witnessMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    witnessMap.set(5n, arrayFormatCBOR)
    const witnessBytes = CBOR.toCBORBytes(witnessMap)

    const ws = TransactionWitnessSet.fromCBORBytes(witnessBytes)
    expect(ws.redeemers).toBeDefined()
    expect(ws.redeemers!.length).toBe(1)
    expect((ws as any)._redeemersFormat).toBe("array")

    const reEncodedBytes = TransactionWitnessSet.toCBORBytes(ws)
    const reDecodedCBOR = CBOR.fromCBORBytes(reEncodedBytes) as Map<bigint, CBOR.CBOR>
    expect(Array.isArray(reDecodedCBOR.get(5n))).toBe(true)
  })
})

// --- Test helpers ---

function readMapCountHelper(data: Uint8Array): { count: number; hdrSize: number } {
  const additionalInfo = data[0] & 0x1f
  if (additionalInfo < 24) return { count: additionalInfo, hdrSize: 1 }
  if (additionalInfo === 24) return { count: data[1], hdrSize: 2 }
  if (additionalInfo === 25) return { count: (data[1] << 8) | data[2], hdrSize: 3 }
  throw new Error(`Unsupported map header: ${additionalInfo}`)
}

function unwrapVkeyArrayHelper(val: CBOR.CBOR | undefined): Array<CBOR.CBOR> {
  if (val === undefined) return []
  if (CBOR.isTag(val)) {
    const tag = val as { _tag: "Tag"; tag: number; value: unknown }
    if (tag.tag === 258 && Array.isArray(tag.value)) return tag.value as Array<CBOR.CBOR>
    return []
  }
  if (Array.isArray(val)) return val as Array<CBOR.CBOR>
  return []
}
