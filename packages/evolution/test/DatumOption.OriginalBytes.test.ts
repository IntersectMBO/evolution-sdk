import { blake2b } from "@noble/hashes/blake2.js"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as PlutusData from "../src/Data.js"
import * as DatumOption from "../src/DatumOption.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as PrivateKey from "../src/PrivateKey.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionOutput from "../src/TransactionOutput.js"
import * as TxOut from "../src/TxOut.js"
import * as VKey from "../src/VKey.js"

// The ledger keeps the original bytes of every inline datum (MemoBytes), and the
// transaction id is the hash of the body bytes. Decoding a transaction and
// encoding it again must write each inline datum back byte for byte.

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")
const fromHex = (h: string) => new Uint8Array(Buffer.from(h, "hex"))

/** CBOR byte string header for a length below 65536. */
const bstr = (h: string) => {
  const n = h.length / 2
  if (n < 24) return (0x40 + n).toString(16).padStart(2, "0") + h
  if (n < 256) return "58" + n.toString(16).padStart(2, "0") + h
  return "59" + n.toString(16).padStart(4, "0") + h
}

const sixtyFour = "11".repeat(64)

const cases: ReadonlyArray<{ readonly name: string; readonly datum: string }> = [
  { name: "constructor holding a definite map", datum: "d8799fa10102ff" },
  { name: "bare definite map", datum: "a10102" },
  { name: "indefinite map", datum: "bf0102ff" },
  { name: "constructor with indefinite fields", datum: "d8799f0102ff" },
  { name: "constructor with definite fields", datum: "d879820102" },
  { name: "bare integer", datum: "05" },
  { name: "65 bytes chunked 64 then 1", datum: "5f" + bstr(sixtyFour) + "4122ff" },
  { name: "65 bytes chunked 1 then 64", datum: "5f4122" + bstr(sixtyFour) + "ff" }
]

const txId = "aa".repeat(32)
const address = "60" + "bb".repeat(28)

/** Body {0: 258([[txid, 0]]), 1: [{0: addr, 1: 1000000, 2: [1, 24(datum)]}], 2: 200000}. */
const bodyHex = (datum: string) =>
  "a3" +
  "00d901028182" + bstr(txId) + "00" +
  "0181a300" + bstr(address) + "011a000f4240" + "028201d818" + bstr(datum) +
  "021a00030d40"

/** Transaction [body, {}, true, null]. */
const txHex = (datum: string) => "84" + bodyHex(datum) + "a0f5f6"

const bodyOf = (txHexValue: string) => hex(Transaction.extractBodyBytes(fromHex(txHexValue)))
const hashOf = (body: string) => hex(blake2b(fromHex(body), { dkLen: 32 }))

/** Witness set {0: [[vkey, signature]]} signed over the body hash. */
const witnessSetHex = (body: string) => {
  const key = PrivateKey.fromBytes(new Uint8Array(32).fill(7))
  const vkey = VKey.toBytes(PrivateKey.toPublicKey(key))
  const signature = PrivateKey.sign(key, blake2b(fromHex(body), { dkLen: 32 }))
  return "a1008182" + bstr(hex(vkey)) + bstr(hex(signature.bytes))
}

describe("inline datum keeps its original bytes", () => {
  for (const { datum, name } of cases) {
    describe(`${name} (${datum.length > 40 ? datum.slice(0, 40) + "..." : datum})`, () => {
      const tx = txHex(datum)
      const body = bodyHex(datum)

      it("the hand-built transaction carries the datum as given", () => {
        expect(bodyOf(tx)).toBe(body)
      })

      it("Transaction.fromCBORHex then toCBORHex keeps the body and its hash", () => {
        const out = Transaction.toCBORHex(Transaction.fromCBORHex(tx))
        expect(bodyOf(out)).toBe(body)
        expect(hashOf(bodyOf(out))).toBe(hashOf(body))
      })

      it("the WithFormat round trip keeps the body", () => {
        const { format, value } = Transaction.fromCBORHexWithFormat(tx)
        expect(bodyOf(Transaction.toCBORHexWithFormat(value, format))).toBe(body)
      })

      it("the Schema path FromCBORHex keeps the body", () => {
        const schema = Transaction.FromCBORHex()
        const out = Schema.encodeSync(schema)(Schema.decodeSync(schema)(tx))
        expect(bodyOf(out)).toBe(body)
      })

      it("addVKeyWitnessesHex keeps the body hash", () => {
        const signed = Transaction.addVKeyWitnessesHex(tx, witnessSetHex(body))
        expect(signed).not.toBe(tx)
        expect(hashOf(bodyOf(signed))).toBe(hashOf(body))
      })

      it("TransactionOutput and TxOut round trips keep the datum", () => {
        const output = "a300" + bstr(address) + "011a000f4240" + "028201d818" + bstr(datum)
        expect(TransactionOutput.toCBORHex(TransactionOutput.fromCBORHex(output))).toBe(output)
        expect(TxOut.toCBORHex(TxOut.fromCBORHex(output))).toBe(output)
      })

      it("DatumOption round trip keeps the datum", () => {
        const option = "8201d818" + bstr(datum)
        expect(DatumOption.toCBORHex(DatumOption.fromCBORHex(option))).toBe(option)
      })
    })
  }

  it("a new InlineDatum with the same Data uses the default encoding", () => {
    const option = "8201d818" + bstr("d8799fa10102ff")
    const decoded = DatumOption.fromCBORHex(option)
    if (!InlineDatum.isInlineDatum(decoded)) throw new Error("expected an inline datum")
    const edited = new InlineDatum.InlineDatum({ data: decoded.data })
    const expected = "8201d818" + bstr(PlutusData.toCBORHex(decoded.data))
    expect(expected).toBe("8201d818" + bstr("d8799fbf0102ffff"))
    expect(DatumOption.toCBORHex(edited)).toBe(expected)
  })
})
