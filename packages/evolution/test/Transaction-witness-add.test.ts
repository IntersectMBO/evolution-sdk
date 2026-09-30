import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as PlutusData from "../src/Data.js"
import * as Ed25519Signature from "../src/Ed25519Signature.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as VKey from "../src/VKey.js"

// ---------------------------------------------------------------------------
// Domain-level witness addition
//
// Tests that adding vkey witnesses at the domain level (via Transaction.addVKeyWitnesses)
// preserves body bytes so txId remains stable.
// ---------------------------------------------------------------------------

const buildDummyVKeyWitness = (): TransactionWitnessSet.VKeyWitness =>
  new TransactionWitnessSet.VKeyWitness({
    vkey: VKey.fromBytes(new Uint8Array(32).fill(0xaa)),
    signature: Ed25519Signature.fromBytes(new Uint8Array(64).fill(0xbb))
  })

describe("Transaction.addVKeyWitnesses — body byte stability", () => {
  it("preserves body bytes when adding vkey witnesses at domain level", () => {
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const originalBytes = Transaction.toCBORBytes(sampleTx)
    const originalBodyHex = bodyHex(originalBytes)

    const modifiedTx = Transaction.addVKeyWitnesses(Transaction.fromCBORBytes(originalBytes), [buildDummyVKeyWitness()])
    expect(bodyHex(Transaction.toCBORBytes(modifiedTx))).toBe(originalBodyHex)
  })

  it("preserves body bytes — property test (50 random txs)", () => {
    FastCheck.assert(
      FastCheck.property(Transaction.arbitrary, (tx) => {
        const originalBytes = Transaction.toCBORBytes(tx)
        const originalBody = bodyHex(originalBytes)

        const modifiedTx = Transaction.addVKeyWitnesses(Transaction.fromCBORBytes(originalBytes), [buildDummyVKeyWitness()])
        expect(bodyHex(Transaction.toCBORBytes(modifiedTx))).toBe(originalBody)
      }),
      { numRuns: 50 }
    )
  })

  it("preserves redeemers bytes when adding vkeys at domain level", () => {
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

    const modifiedTx = Transaction.addVKeyWitnesses(Transaction.fromCBORBytes(txBytes), [buildDummyVKeyWitness()])
    const modifiedBytes = Transaction.toCBORBytes(modifiedTx)

    const signedWsMap = (CBOR.fromCBORBytes(modifiedBytes) as Array<CBOR.CBOR>)[1] as Map<bigint, CBOR.CBOR>
    expect(signedWsMap.get(5n)).toBeInstanceOf(Map)
    expect(Buffer.from(CBOR.toCBORBytes(signedWsMap.get(5n)!)).toString("hex")).toBe(originalRedeemersHex)
    expect(signedWsMap.get(0n)).toBeDefined()
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
