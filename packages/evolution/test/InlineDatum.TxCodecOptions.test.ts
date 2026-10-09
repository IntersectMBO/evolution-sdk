import { blake2b } from "@noble/hashes/blake2.js"
import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as Assets from "../src/Assets.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"
import * as DatumOption from "../src/DatumOption.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as OriginalBytes from "../src/OriginalBytes.js"
import * as PrivateKey from "../src/PrivateKey.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionInput from "../src/TransactionInput.js"
import * as TransactionOutput from "../src/TransactionOutput.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as TxOut from "../src/TxOut.js"
import * as VKey from "../src/VKey.js"

// A new inline datum is written with the plutusData options, the rest of the
// transaction with the ledger options. A decoded inline datum keeps its bytes.

/** CBOR byte string header for a length below 65536, then the bytes. */
const bstr = (hex: string) => {
  const n = hex.length / 2
  if (n < 24) return (0x40 + n).toString(16).padStart(2, "0") + hex
  if (n < 256) return "58" + n.toString(16).padStart(2, "0") + hex
  return "59" + n.toString(16).padStart(4, "0") + hex
}

// [1, 24(datum bytes)]
const inlineHex = (datumHex: string) => "8201d818" + bstr(datumHex)

const datums: ReadonlyArray<readonly [string, Data.Data]> = [
  ["fields", Data.constr(0n, [Data.int(1n), Bytes.fromHex("abcd"), Data.constr(1n, [Data.int(-5n)])])],
  ["a list", Data.list([Data.int(1n), Data.list([Data.int(2n), Data.int(3n)]), Data.list([])])],
  [
    "a map",
    Data.map([
      [Data.int(3n), Data.list([Data.int(4n)])],
      [Bytes.fromHex("01"), Data.map([[Data.int(1n), Data.int(2n)]])]
    ])
  ]
]

// Each option set and the options its Plutus data is written with
const optionSets: ReadonlyArray<
  readonly [string, CBOR.TxCodecOptions | CBOR.CodecOptions | undefined, CBOR.CodecOptions]
> = [
  ["no options", undefined, Data.DEFAULT_CBOR_OPTIONS],
  ["CBOR.CML_DEFAULT_OPTIONS", CBOR.CML_DEFAULT_OPTIONS, Data.DEFAULT_CBOR_OPTIONS],
  ["CBOR.TX_DEFAULT_OPTIONS", CBOR.TX_DEFAULT_OPTIONS, Data.DEFAULT_CBOR_OPTIONS],
  ["CBOR.TX_CANONICAL_OPTIONS", CBOR.TX_CANONICAL_OPTIONS, CBOR.CANONICAL_OPTIONS],
  [
    "plutusData CML_DATA_DEFAULT_OPTIONS",
    { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.CML_DATA_DEFAULT_OPTIONS },
    CBOR.CML_DATA_DEFAULT_OPTIONS
  ],
  [
    "plutusData CML_DATA_DEFINITE_OPTIONS",
    { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.CML_DATA_DEFINITE_OPTIONS },
    CBOR.CML_DATA_DEFINITE_OPTIONS
  ]
]

const address = Address.fromBytes(Bytes.fromHex("60" + "bb".repeat(28)))

const outputWith = (data: Data.Data) =>
  new TxOut.TransactionOutput({
    address,
    assets: Assets.fromLovelace(2_000_000n),
    datumOption: new InlineDatum.InlineDatum({ data })
  })

const bodyWith = (outputs: ReadonlyArray<Data.Data>, collateralReturn?: Data.Data) =>
  new TransactionBody.TransactionBody({
    inputs: [
      new TransactionInput.TransactionInput({
        transactionId: TransactionHash.fromHex("aa".repeat(32)),
        index: 0n
      })
    ],
    outputs: outputs.map(outputWith),
    fee: 200_000n,
    collateralReturn: collateralReturn === undefined ? undefined : outputWith(collateralReturn)
  })

const txWith = (body: TransactionBody.TransactionBody) =>
  new Transaction.Transaction({
    body,
    witnessSet: new TransactionWitnessSet.TransactionWitnessSet({}),
    isValid: true,
    auxiliaryData: null
  })

// The bytes inside tag 24 of each inline datum of a decoded body
const writtenDatums = (body: TransactionBody.TransactionBody): Array<string> =>
  [...body.outputs, ...(body.collateralReturn ? [body.collateralReturn] : [])].map((output) =>
    Bytes.toHex(OriginalBytes.get(output.datumOption!)!)
  )

describe.each(optionSets)("under %s", (_, options, plutusData) => {
  const ledger = CBOR.toTxCodecOptions(options ?? CBOR.TX_DEFAULT_OPTIONS).ledger
  // The same ledger options with Plutus data in the default layout
  const ledgerOnly: CBOR.TxCodecOptions = { ledger, plutusData: Data.DEFAULT_CBOR_OPTIONS }

  it.each(datums)("DatumOption writes a new inline datum with %s as Data does", (_, data) => {
    const datum = new InlineDatum.InlineDatum({ data })
    const expected = inlineHex(Data.toCBORHex(data, plutusData))
    expect(DatumOption.toCBORHex(datum, options)).toBe(expected)
    expect(Bytes.toHex(DatumOption.toCBORBytes(datum, options))).toBe(expected)
  })

  it.each(datums)("TxOut writes a new inline datum with %s as Data does", (_, data) => {
    const output = TxOut.fromCBORHex(TxOut.toCBORHex(outputWith(data), options), ledger)
    expect(Bytes.toHex(OriginalBytes.get(output.datumOption!)!)).toBe(Data.toCBORHex(data, plutusData))
  })

  it.each(datums)("TransactionOutput writes a new inline datum with %s as Data does", (_, data) => {
    // A new datum in an output decoded by the era-split module
    const decoded = TransactionOutput.fromCBORHex(TxOut.toCBORHex(outputWith(data)))
    const output = new TransactionOutput.BabbageTransactionOutput({
      ...decoded,
      datumOption: new InlineDatum.InlineDatum({ data })
    })
    expect(TransactionOutput.toCBORHex(output, options)).toContain("d818" + bstr(Data.toCBORHex(data, plutusData)))
  })

  it("TransactionBody and Transaction write every new inline datum as Data does", () => {
    const body = bodyWith(
      datums.map(([, data]) => data),
      datums[2][1]
    )
    const expected = [...datums.map(([, data]) => data), datums[2][1]].map((data) => Data.toCBORHex(data, plutusData))
    const bodyHex = TransactionBody.toCBORHex(body, options)
    expect(writtenDatums(TransactionBody.fromCBORHex(bodyHex, ledger))).toEqual(expected)

    const txBytes = Transaction.toCBORBytes(txWith(body), options)
    expect(Bytes.toHex(Transaction.toCBORBytes(txWith(body), options))).toBe(
      Transaction.toCBORHex(txWith(body), options)
    )
    expect(Bytes.toHex(Transaction.extractBodyBytes(txBytes))).toBe(bodyHex)
    expect(writtenDatums(TransactionBody.fromCBORHex(bodyHex, ledger))).toEqual(expected)
  })

  it("the body differs from the default layout only inside tag 24", () => {
    const body = bodyWith(
      datums.map(([, data]) => data),
      datums[0][1]
    )
    // Cut the default body at each tag 24 and put the datums written with
    // plutusData in the cuts
    const written = [...datums, datums[0]].map(([, data]) => data)
    const parts = TransactionBody.toCBORHex(body, ledgerOnly).split(
      new RegExp(written.map((data) => "d818" + bstr(Data.toCBORHex(data))).join("|"))
    )
    expect(parts).toHaveLength(written.length + 1)
    const expected = parts.reduce(
      (hex, part, i) => hex + "d818" + bstr(Data.toCBORHex(written[i - 1], plutusData)) + part
    )
    expect(TransactionBody.toCBORHex(body, options)).toBe(expected)
    expect(Bytes.toHex(Transaction.extractBodyBytes(Transaction.toCBORBytes(txWith(body), options)))).toBe(expected)
  })

  it("a decoded inline datum keeps its bytes", () => {
    // An indefinite map, which no option set here writes for this datum
    const decoded = TxOut.fromCBORHex(
      TxOut.toCBORHex(outputWith(Data.int(0n))).replace("d81841" + "00", "d81844bf0102ff")
    )
    const tx = txWith(new TransactionBody.TransactionBody({ ...bodyWith([]), outputs: [decoded] }))
    expect(Transaction.toCBORHex(tx, options)).toContain("d81844bf0102ff")
  })
})

describe("under the default options", () => {
  it("a new inline datum keeps the bytes it had before plutusData reached it", () => {
    const body = bodyWith([datums[2][1]])
    const bodyHex =
      "a300d9010281825820" +
      "aa".repeat(32) +
      "000181a300581d60" +
      "bb".repeat(28) +
      "011a001e8480028201d8184aa2039f04ff4101a10102021a00030d40"
    expect(TransactionBody.toCBORHex(body)).toBe(bodyHex)
    expect(TransactionBody.toCBORHex(body, CBOR.CML_DEFAULT_OPTIONS)).toBe(bodyHex)
    expect(Bytes.toHex(Transaction.extractBodyBytes(Transaction.toCBORBytes(txWith(body))))).toBe(bodyHex)
    expect(
      Bytes.toHex(Transaction.extractBodyBytes(Transaction.toCBORBytes(txWith(body), CBOR.TX_DEFAULT_OPTIONS)))
    ).toBe(bodyHex)
  })
})

describe("a decoded transaction", () => {
  // {0: 258([[txid, 0]]), 1: [{0: addr, 1: 1000000, 2: [1, 24(indefinite map {1: 2})]}], 2: 200000}
  const bodyHex =
    "a300d9010281825820" +
    "aa".repeat(32) +
    "000181a300581d60" +
    "bb".repeat(28) +
    "011a000f4240028201d81844bf0102ff021a00030d40"
  const txHex = "84" + bodyHex + "a0f5f6"

  const witnessSetHex = () => {
    const key = PrivateKey.fromBytes(new Uint8Array(32).fill(7))
    const vkey = VKey.toBytes(PrivateKey.toPublicKey(key))
    const signature = PrivateKey.sign(key, blake2b(Bytes.fromHex(bodyHex), { dkLen: 32 }))
    return "a1008182" + bstr(Bytes.toHex(vkey)) + bstr(Bytes.toHex(signature.bytes))
  }

  it("keeps an inline datum's bytes through addVKeyWitnessesHex", () => {
    const signed = Transaction.addVKeyWitnessesHex(txHex, witnessSetHex())
    expect(signed).not.toBe(txHex)
    expect(Bytes.toHex(Transaction.extractBodyBytes(Bytes.fromHex(signed)))).toBe(bodyHex)
  })

  it.each(optionSets)("keeps an inline datum's bytes when encoded under %s", (_, options) => {
    const tx = Transaction.fromCBORHex(txHex)
    expect(Transaction.toCBORHex(tx, options)).toContain("d81844bf0102ff")
    expect(Bytes.toHex(Transaction.toCBORBytesWithFormat(tx, Transaction.fromCBORHexWithFormat(txHex).format))).toBe(
      txHex
    )
  })

  it("writes an inline datum added to it with the default plutusData", () => {
    const tx = Transaction.fromCBORHex(txHex)
    const data = datums[1][1]
    const edited = new Transaction.Transaction({
      ...tx,
      body: new TransactionBody.TransactionBody({ ...tx.body, outputs: [...tx.body.outputs, outputWith(data)] })
    })
    const { format } = Transaction.fromCBORHexWithFormat(txHex)
    for (const hex of [Transaction.toCBORHexWithFormat(edited, format), Transaction.toCBORHex(edited)]) {
      const body = Transaction.fromCBORHex(hex).body
      expect(writtenDatums(body)).toEqual(["bf0102ff", Data.toCBORHex(data)])
    }
  })
})
