import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as AddressEras from "../src/AddressEras.js"
import * as Assets from "../src/Assets.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionOutput from "../src/TransactionOutput.js"
import * as TxOut from "../src/TxOut.js"
import * as Value from "../src/Value.js"

/**
 * The two output models are not interchangeable, which is what the deprecation on
 * `TransactionOutput` is about: a body takes `TxOut`, and nothing else.
 */
const keyHash = KeyHash.fromPrivateKey(PrivateKey.fromBytes(PrivateKey.generate()))
const address = new CoreAddress.Address({ networkId: 0, paymentCredential: keyHash })

describe("TransactionOutput and TxOut are two models of one thing", () => {
  it("a TransactionBody takes a TxOut output", () => {
    const body = new TransactionBody.TransactionBody({
      inputs: [],
      outputs: [new TxOut.TransactionOutput({ address, assets: Assets.fromLovelace(2_000_000n) })],
      fee: 200_000n
    })
    expect(body.outputs).toHaveLength(1)
  })

  it("refuses a TransactionOutput in a TransactionBody, which is why new code wants TxOut", () => {
    const legacy = new TransactionOutput.BabbageTransactionOutput({
      address: AddressEras.fromHex(CoreAddress.toHex(address)),
      amount: Value.onlyCoin(2_000_000n)
    })
    const decode = Schema.decodeUnknownEither(TransactionBody.TransactionBody)
    const result = decode({ inputs: [], outputs: [legacy], fee: 200_000n })
    expect(result._tag).toBe("Left")
  })
})
