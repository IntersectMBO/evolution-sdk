import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { describe, expect, it } from "vitest"

import * as AuxiliaryData from "../src/AuxiliaryData.js"
import * as AuxiliaryDataHash from "../src/AuxiliaryDataHash.js"
import * as CBOR from "../src/CBOR.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"

// Synthetic metadata with deliberately reversed equal-length keys.
const auxiliary = () => AuxiliaryData.fromCBORHex("d90103a100a11902a2a2616202616101")

const options: Array<{ name: string; codec: CBOR.CodecOptions }> = [
  { name: "canonical", codec: CBOR.CANONICAL_OPTIONS },
  { name: "custom sorted", codec: { ...CBOR.CML_DEFAULT_OPTIONS, sortMapKeys: true } },
  { name: "custom indefinite", codec: { ...CBOR.CML_DEFAULT_OPTIONS, useIndefiniteMaps: true } }
]

describe("AuxiliaryData hash encoding options", () => {
  it.each(options)("hashes the actual $name encoding", ({ codec }) => {
    const aux = auxiliary()
    const hex = AuxiliaryData.toCBORHex(aux, codec)
    const expected = CML.hash_auxiliary_data(CML.AuxiliaryData.from_cbor_hex(hex)).to_hex()
    expect(hex).not.toBe(AuxiliaryData.toCBORHex(aux))
    expect(AuxiliaryDataHash.toHex(AuxiliaryData.toHash(aux, codec))).toBe(expected)
  })

  it("keeps default hashing backward compatible", () => {
    const aux = auxiliary()
    const expected = CML.hash_auxiliary_data(CML.AuxiliaryData.from_cbor_hex(AuxiliaryData.toCBORHex(aux))).to_hex()
    expect(AuxiliaryDataHash.toHex(AuxiliaryData.toHash(aux))).toBe(expected)
    expect(AuxiliaryDataHash.toHex(AuxiliaryData.toHash(aux, CBOR.CML_DEFAULT_OPTIONS))).toBe(expected)
  })

  it("produces a matching commitment in the final canonical transaction", () => {
    const aux = auxiliary()
    const originalBody = TransactionBody.fromCBORHex("a300d901028001800200")
    const body = new TransactionBody.TransactionBody({
      ...originalBody,
      auxiliaryDataHash: AuxiliaryData.toHash(aux, CBOR.CANONICAL_OPTIONS)
    })
    const tx = new Transaction.Transaction({
      body,
      witnessSet: TransactionWitnessSet.fromCBORHex("a0"),
      isValid: true,
      auxiliaryData: aux
    })
    const encoded = Transaction.toCBORHex(tx, CBOR.CANONICAL_OPTIONS)
    const cml = CML.Transaction.from_cbor_hex(encoded)
    expect(cml.body().auxiliary_data_hash()!.to_hex()).toBe(CML.hash_auxiliary_data(cml.auxiliary_data()!).to_hex())
    expect(AuxiliaryData.toCBORHex(aux)).toBe("d90103a100a11902a2a2616202616101")
  })
})
