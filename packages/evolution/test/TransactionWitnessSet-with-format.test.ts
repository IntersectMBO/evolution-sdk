import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as PlutusData from "../src/Data.js"
import * as Ed25519Signature from "../src/Ed25519Signature.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as VKey from "../src/VKey.js"

const buildWitnessSetHex = (): string => {
  const data = PlutusData.constr(0n, [])
  const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(data))
  const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
  redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)

  const witnessMap = new Map<CBOR.CBOR, CBOR.CBOR>()
  witnessMap.set(5n, redeemersMap)
  witnessMap.set(3n, CBOR.Tag.make({ tag: 258, value: [new Uint8Array([1, 2, 3])] }))

  return CBOR.toCBORHex(witnessMap)
}

describe("TransactionWitnessSet WithFormat", () => {
  it("round-trips a witness set with an explicit format tree (hex)", () => {
    const hex = buildWitnessSetHex()
    const { format, value } = TransactionWitnessSet.fromCBORHexWithFormat(hex)
    expect(TransactionWitnessSet.toCBORHexWithFormat(value, format)).toBe(hex)
  })

  it("round-trips a witness set with an explicit format tree (bytes)", () => {
    const hex = buildWitnessSetHex()
    const bytes = Buffer.from(hex, "hex")
    const { format, value } = TransactionWitnessSet.fromCBORBytesWithFormat(new Uint8Array(bytes))
    const reencoded = TransactionWitnessSet.toCBORBytesWithFormat(value, format)
    expect(Buffer.from(reencoded).toString("hex")).toBe(hex)
  })

  it("reconciles stale key order metadata when new witness-set fields are added", () => {
    const { format, value: decoded } = TransactionWitnessSet.fromCBORHexWithFormat(buildWitnessSetHex())

    const witness = new TransactionWitnessSet.VKeyWitness({
      vkey: VKey.fromBytes(new Uint8Array(32).fill(0xaa)),
      signature: Ed25519Signature.fromBytes(new Uint8Array(64).fill(0xbb))
    })

    const updated = new TransactionWitnessSet.TransactionWitnessSet(
      {
        vkeyWitnesses: [witness],
        redeemers: decoded.redeemers,
        plutusV1Scripts: decoded.plutusV1Scripts
      },
      { disableValidation: true }
    )

    const reencoded = TransactionWitnessSet.toCBORHexWithFormat(updated, format)
    const redecoded = CBOR.fromCBORHex(reencoded) as Map<bigint, CBOR.CBOR>

    // Key order from the original format is respected; new key 0 appended at end
    expect(Array.from(redecoded.keys())).toEqual([5n, 3n, 0n])
  })
})
