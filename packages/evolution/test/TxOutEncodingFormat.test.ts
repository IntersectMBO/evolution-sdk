import { describe, expect, it } from "vitest"

import * as TransactionBody from "../src/TransactionBody.js"
import * as TxOut from "../src/TxOut.js"

/**
 * Conway accepts two shapes for a transaction output -- the legacy Shelley array and the
 * Babbage map -- and a node takes either, so this is not about validity. It is about fidelity:
 * the two are different bytes, so they are a different transaction id, a different min-ada, and
 * a different body for a hardware wallet to reconstruct in chunks.
 *
 * The form used to be inferred on every encode, which made decode lossy: a Babbage map read off
 * the wire came back out as a Shelley array. TransactionBody.toHash hashes a RE-ENCODING, so it
 * returned the wrong transaction id for any transaction whose outputs were Babbage maps -- which
 * is most transactions built by a modern wallet.
 */
describe("transaction output encoding format", () => {
  const ADDRESS = "010fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42e557890352095f1cf6fd2b7d1a28e3c3cb029f48cf34ff890a28d176"
  const BABBAGE = `a2005839${ADDRESS}011a001e8480`
  const SHELLEY = `825839${ADDRESS}1a001e8480`
  const body = (outputHex: string) =>
    `a400d90102818258201111111111111111111111111111111111111111111111111111111111111111000181${outputHex}021a00030d40031903e8`

  it("round-trips each form to the bytes it arrived as", () => {
    for (const hex of [BABBAGE, SHELLEY]) {
      expect(TxOut.toCBORHex(TxOut.fromCBORHex(hex))).toBe(hex)
    }
  })

  it("a body keeps its outputs' form, so toHash agrees with toHashFromBytes", () => {
    for (const outputHex of [BABBAGE, SHELLEY]) {
      const hex = body(outputHex)
      const decoded = TransactionBody.fromCBORHex(hex)
      expect(TransactionBody.toCBORHex(decoded)).toBe(hex)
      expect(TransactionBody.toHash(decoded).hash).toStrictEqual(
        TransactionBody.toHashFromBytes(Buffer.from(hex, "hex")).hash
      )
    }
  })

  it("the form can be asked for when building, and is otherwise unchanged", () => {
    const shelley = TxOut.fromCBORHex(SHELLEY)
    // Default is still Shelley where the output allows it, matching CSL and CML.
    const rebuilt = new TxOut.TransactionOutput({ address: shelley.address, assets: shelley.assets })
    expect(TxOut.toCBORHex(rebuilt)).toBe(SHELLEY)
    const asBabbage = new TxOut.TransactionOutput({
      address: shelley.address,
      assets: shelley.assets,
      encodingFormat: "babbage"
    })
    expect(TxOut.toCBORHex(asBabbage)).toBe(BABBAGE)
  })
})
