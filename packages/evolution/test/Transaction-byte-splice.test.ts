import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as PlutusData from "../src/Data.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"

// ---------------------------------------------------------------------------
// addVKeyWitnessesBytes — byte-level witness merging
//
// Operates directly on raw CBOR bytes. Only the vkey witnesses value (key 0)
// in the witness set map is modified. Everything else — body, redeemers,
// datums, scripts, isValid, auxData, map entry ordering — is preserved
// byte-for-byte.
// ---------------------------------------------------------------------------

const buildWalletWitnessBytes = (): Uint8Array => {
  const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
  wsMap.set(0n, CBOR.Tag.make({ tag: 258, value: [[new Uint8Array(32).fill(0xaa), new Uint8Array(64).fill(0xbb)]] }))
  return CBOR.toCBORBytes(wsMap)
}

describe("addVKeyWitnessesBytes", () => {
  it("preserves body and tail bytes — only vkey witnesses value changes", () => {
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const txBytes = Transaction.toCBORBytes(sampleTx)
    const txHex = Buffer.from(txBytes).toString("hex")

    const walletWsBytes = buildWalletWitnessBytes()
    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, walletWsBytes)
    const signedHex = Buffer.from(signedBytes).toString("hex")

    const hdr = (txBytes[0] & 0x1f) < 24 ? 1 : 2
    const { newOffset: bodyEnd } = CBOR.decodeItemWithOffset(txBytes, hdr)
    expect(signedHex.slice(hdr * 2, bodyEnd * 2)).toBe(txHex.slice(hdr * 2, bodyEnd * 2))

    const { newOffset: wsEnd } = CBOR.decodeItemWithOffset(txBytes, bodyEnd)
    const hdr2 = (signedBytes[0] & 0x1f) < 24 ? 1 : 2
    const { newOffset: bodyEnd2 } = CBOR.decodeItemWithOffset(signedBytes, hdr2)
    const { newOffset: wsEnd2 } = CBOR.decodeItemWithOffset(signedBytes, bodyEnd2)
    // tail bytes (isValid + auxData) must be identical in both
    expect(signedHex.slice(wsEnd2 * 2)).toBe(txHex.slice(wsEnd * 2))
  })

  it("preserves non-canonical body encoding (txId stable)", () => {
    // fee=0 encoded as 0x1800 (non-canonical)
    const nonCanonicalHex = "84a300d90102800180021800a0f5f6"
    const txBytes = Buffer.from(nonCanonicalHex, "hex")
    const signedBytes = Transaction.addVKeyWitnessesBytes(new Uint8Array(txBytes), buildWalletWitnessBytes())
    expect(Buffer.from(signedBytes).toString("hex")).toContain("a300d90102800180021800")
  })

  it("preserves redeemers bytes verbatim (scriptDataHash stable)", () => {
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const bodyBytes = TransactionBody.toCBORBytes(sampleTx.body)

    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)
    const witnessMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    witnessMap.set(5n, redeemersMap)
    const witnessBytes = CBOR.toCBORBytes(witnessMap)

    const wsParsed = CBOR.fromCBORBytes(witnessBytes) as Map<bigint, CBOR.CBOR>
    const originalRedeemersHex = Buffer.from(CBOR.toCBORBytes(wsParsed.get(5n)!)).toString("hex")

    const txBytes = CBOR.encodeArrayAsDefinite([
      bodyBytes, witnessBytes, CBOR.internalEncodeSync(true), CBOR.internalEncodeSync(null)
    ])

    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, buildWalletWitnessBytes())
    const signedWsMap = (CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>)[1] as Map<bigint, CBOR.CBOR>

    expect(signedWsMap.get(5n)).toBeInstanceOf(Map)
    expect(Buffer.from(CBOR.toCBORBytes(signedWsMap.get(5n)!)).toString("hex")).toBe(originalRedeemersHex)
    expect(signedWsMap.get(0n)).toBeDefined()
  })

  it("preserves map entry ordering — new key 0 appended at end", () => {
    const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    wsMap.set(3n, CBOR.Tag.make({ tag: 258, value: [new Uint8Array([1, 2, 3])] }))
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)
    wsMap.set(5n, redeemersMap)
    const wsBytes = CBOR.toCBORBytes(wsMap)

    const { count, hdrSize } = readMapHeader(wsBytes)
    let off = hdrSize
    const entryHexes: Array<string> = []
    for (let i = 0; i < count; i++) {
      const start = off
      const { newOffset: kEnd } = CBOR.decodeItemWithOffset(wsBytes, off)
      const { newOffset: vEnd } = CBOR.decodeItemWithOffset(wsBytes, kEnd)
      entryHexes.push(Buffer.from(wsBytes.slice(start, vEnd)).toString("hex"))
      off = vEnd
    }

    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const txBytes = CBOR.encodeArrayAsDefinite([
      TransactionBody.toCBORBytes(sampleTx.body),
      wsBytes,
      CBOR.internalEncodeSync(true),
      CBOR.internalEncodeSync(null)
    ])

    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, buildWalletWitnessBytes())
    const signedHex = Buffer.from(signedBytes).toString("hex")

    for (const entry of entryHexes) {
      expect(signedHex).toContain(entry)
    }

    const signedWsMap = (CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>)[1] as Map<bigint, CBOR.CBOR>
    expect([...signedWsMap.keys()]).toContain(0n)
    expect([...signedWsMap.keys()]).toContain(3n)
    expect([...signedWsMap.keys()]).toContain(5n)
  })

  it("splices in-place when key 0 already exists — merges witness arrays", () => {
    const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    wsMap.set(0n, CBOR.Tag.make({ tag: 258, value: [[new Uint8Array(32).fill(0x11), new Uint8Array(64).fill(0x22)]] }))
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [50n, 100n]] as unknown as CBOR.CBOR)
    wsMap.set(5n, redeemersMap)
    const wsBytes = CBOR.toCBORBytes(wsMap)

    const { count, hdrSize } = readMapHeader(wsBytes)
    let off = hdrSize
    let redeemersEntryHex = ""
    for (let i = 0; i < count; i++) {
      const start = off
      const { item: k, newOffset: kEnd } = CBOR.decodeItemWithOffset(wsBytes, off)
      const { newOffset: vEnd } = CBOR.decodeItemWithOffset(wsBytes, kEnd)
      if (k === 5n) redeemersEntryHex = Buffer.from(wsBytes.slice(start, vEnd)).toString("hex")
      off = vEnd
    }

    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const txBytes = CBOR.encodeArrayAsDefinite([
      TransactionBody.toCBORBytes(sampleTx.body),
      wsBytes,
      CBOR.internalEncodeSync(true),
      CBOR.internalEncodeSync(null)
    ])

    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, buildWalletWitnessBytes())
    const signedHex = Buffer.from(signedBytes).toString("hex")

    expect(signedHex).toContain(redeemersEntryHex)

    const signedWsMap = (CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>)[1] as Map<bigint, CBOR.CBOR>
    const vkeys = unwrapVkeyArray(signedWsMap.get(0n))
    expect(vkeys.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readMapHeader(data: Uint8Array): { count: number; hdrSize: number } {
  const ai = data[0] & 0x1f
  if (ai < 24) return { count: ai, hdrSize: 1 }
  if (ai === 24) return { count: data[1], hdrSize: 2 }
  if (ai === 25) return { count: (data[1] << 8) | data[2], hdrSize: 3 }
  throw new Error(`Unsupported map header additionalInfo: ${ai}`)
}

function unwrapVkeyArray(val: CBOR.CBOR | undefined): Array<CBOR.CBOR> {
  if (val === undefined) return []
  if (CBOR.isTag(val)) {
    const tag = val as { _tag: "Tag"; tag: number; value: unknown }
    if (tag.tag === 258 && Array.isArray(tag.value)) return tag.value as Array<CBOR.CBOR>
  }
  if (Array.isArray(val)) return val as Array<CBOR.CBOR>
  return []
}
