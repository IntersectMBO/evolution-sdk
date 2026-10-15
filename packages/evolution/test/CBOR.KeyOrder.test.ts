import { validateTx } from "cardano-hw-interop-lib"
import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as Assets from "../src/Assets.js"
import * as AuxiliaryData from "../src/AuxiliaryData.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as CostModel from "../src/CostModel.js"
import * as Data from "../src/Data.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionInput from "../src/TransactionInput.js"
import type * as TransactionMetadatum from "../src/TransactionMetadatum.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as TxOut from "../src/TxOut.js"

// keyOrder "lengthFirst", the default, puts the shorter encoded key first and
// orders keys of equal length bytewise. keyOrder "bytewise" orders the encoded
// keys bytewise, as the canonical check of cardano-hw-cli does.

// The three maps whose key orders disagree, keys in the order inserted:
// redeemer keys spend 24 (82001818) and mint 0 (820100), Plutus data keys 1000
// (1903e8) and -1 (20), and metadata keys 1000 (1903e8) and "a" (6161).
const exUnits = new Redeemer.ExUnits({ mem: 1n, steps: 1n })
const spend24 = new Redeemer.Redeemer({ tag: "spend", index: 24n, data: 0n, exUnits })
const mint0 = new Redeemer.Redeemer({ tag: "mint", index: 0n, data: 0n, exUnits })
const redeemers = Redeemers.makeRedeemerMap([spend24, mint0])
const datum = Data.map([
  [1000n, 1n],
  [-1n, 2n]
])
const metadatum = new Map<TransactionMetadatum.TransactionMetadatum, TransactionMetadatum.TransactionMetadatum>([
  [1000n, "x"],
  ["a", "y"]
])
const auxiliaryData = new AuxiliaryData.ConwayAuxiliaryData({ metadata: new Map([[1n, metadatum]]) })

// The same maps with the keys inserted the other way round
const redeemersReversed = Redeemers.makeRedeemerMap([mint0, spend24])
const datumReversed = Data.map([
  [-1n, 2n],
  [1000n, 1n]
])
const auxiliaryDataReversed = new AuxiliaryData.ConwayAuxiliaryData({
  metadata: new Map([
    [
      1n,
      new Map<TransactionMetadatum.TransactionMetadatum, TransactionMetadatum.TransactionMetadatum>([
        ["a", "y"],
        [1000n, "x"]
      ])
    ]
  ])
})

// {0: 258([[h'00' * 32, 0]]), 1: [[addr, 1000000]], 2: 200000}
const bodyHex = `a300d9010281825820${"00".repeat(32)}00018182581d60${"11".repeat(28)}1a000f4240021a00030d40`

const body = new TransactionBody.TransactionBody({
  inputs: [new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex("00".repeat(32)), index: 0n })],
  outputs: [
    new TxOut.TransactionOutput({
      address: Address.fromBytes(Bytes.fromHex("60" + "11".repeat(28))),
      assets: Assets.fromLovelace(1_000_000n)
    })
  ],
  fee: 200_000n
})

const txWith = (
  witnessSet: ConstructorParameters<typeof TransactionWitnessSet.TransactionWitnessSet>[0],
  aux: AuxiliaryData.AuxiliaryData | null = null
) =>
  new Transaction.Transaction({
    body,
    witnessSet: new TransactionWitnessSet.TransactionWitnessSet(witnessSet),
    isValid: true,
    auxiliaryData: aux
  })

const tx = txWith({ redeemers, plutusData: [datum] }, auxiliaryData)

// The canonical check cardano-hw-cli runs before it witnesses a transaction
const hwCheck = (hex: string) => validateTx(Buffer.from(hex, "hex")).map((error) => error.reason)

describe("keyOrder bytewise", () => {
  const cases = [
    ["redeemer map", txWith({ redeemers }), txWith({ redeemers: redeemersReversed })],
    ["witness datum map", txWith({ plutusData: [datum] }), txWith({ plutusData: [datumReversed] })],
    ["metadata map", txWith({}, auxiliaryData), txWith({}, auxiliaryDataReversed)]
  ] as const

  for (const [name, inserted, reversed] of cases) {
    it(`${name}: passes the cardano-hw-cli canonical check under TX_HW_CLI_OPTIONS`, () => {
      const hex = Transaction.toCBORHex(inserted, CBOR.TX_HW_CLI_OPTIONS)
      expect(hwCheck(hex)).toEqual([])
      expect(Transaction.toCBORHex(reversed, CBOR.TX_HW_CLI_OPTIONS)).toBe(hex)
      expect(Transaction.toCBORHex(inserted, CBOR.HW_CLI_OPTIONS)).toBe(hex)
    })

    it(`${name}: fails the check under TX_CANONICAL_OPTIONS, which orders keys length-first`, () => {
      expect(hwCheck(Transaction.toCBORHex(inserted, CBOR.TX_CANONICAL_OPTIONS))).toEqual(["CBOR is not canonical"])
    })
  }

  it("writes each map with its keys in bytewise order", () => {
    for (const map of [redeemers, redeemersReversed]) {
      expect(Redeemers.toCBORHexMap(map, CBOR.TX_HW_CLI_OPTIONS)).toBe("a28200181882008201018201008200820101")
    }
    for (const data of [datum, datumReversed]) {
      expect(Data.toCBORHex(data, CBOR.HW_CLI_OPTIONS)).toBe("a21903e8012002")
    }
    for (const aux of [auxiliaryData, auxiliaryDataReversed]) {
      expect(AuxiliaryData.toCBORHex(aux, CBOR.HW_CLI_OPTIONS)).toBe("d90103a100a101a21903e8617861616179")
    }
  })

  it("passes the check with all three maps in one transaction", () => {
    expect(hwCheck(Transaction.toCBORHex(tx, CBOR.TX_HW_CLI_OPTIONS))).toEqual([])
  })

  it("a byte string over 64 bytes in a witness datum fails the check under every preset", () => {
    const short = txWith({ plutusData: [Bytes.fromHex("ab".repeat(64))] })
    expect(hwCheck(Transaction.toCBORHex(short, CBOR.TX_HW_CLI_OPTIONS))).toEqual([])
    const long = txWith({ plutusData: [Bytes.fromHex("ab".repeat(65))] })
    for (const options of [CBOR.TX_HW_CLI_OPTIONS, CBOR.TX_CANONICAL_OPTIONS, CBOR.TX_DEFAULT_OPTIONS]) {
      expect(hwCheck(Transaction.toCBORHex(long, options))).toEqual(["CBOR is not canonical"])
    }
  })

  it("orders keys bytewise in custom mode when sortMapKeys is true, and ignores keyOrder when it is false", () => {
    const custom = (sortMapKeys: boolean): CBOR.CodecOptions => ({
      mode: "custom",
      useIndefiniteArrays: false,
      useIndefiniteMaps: false,
      useDefiniteForEmpty: true,
      sortMapKeys,
      keyOrder: "bytewise",
      useMinimalEncoding: true
    })
    const reversed = new Map<CBOR.CBOR, CBOR.CBOR>([
      ["a", "y"],
      [1000n, "x"]
    ])
    expect(CBOR.toCBORHex(reversed, custom(true))).toBe("a21903e8617861616179")
    expect(CBOR.toCBORHex(reversed, custom(false))).toBe("a2616161791903e86178")
    expect(Data.toCBORHex(datumReversed, custom(true))).toBe("a21903e8012002")
    expect(Data.toCBORHex(datumReversed, custom(false))).toBe("a220021903e801")
  })

  it("orders the keys of a map written from an object", () => {
    const record = { a: 1n, 1000: 2n }
    expect(CBOR.toCBORHex(record, CBOR.HW_CLI_OPTIONS)).toBe("a21903e802616101")
    expect(CBOR.toCBORHex(record, CBOR.CANONICAL_OPTIONS)).toBe("a26161011903e802")
  })
})

// The bytes each preset wrote before keyOrder existed (commit eb491267). Each
// preset keeps them.
const goldenTx = {
  lengthFirst: `84${bodyHex}a204d9010281a220021903e80105a28201008200820101820018188200820101f5d90103a100a101a2616161791903e86178`,
  inserted: `84${bodyHex}a204d9010281a21903e801200205a28200181882008201018201008200820101f5d90103a100a101a21903e8617861616179`,
  nodeLayout:
    "9fa300d901029f9f5820" +
    "00".repeat(32) +
    "00ffff019f9f581d60" +
    "11".repeat(28) +
    "1a000f4240ffff021a00030d40a204d901029fa21903e8012002ff05a29f001818ff9f009f0101ffff9f0100ff9f009f0101fffff5d90103a100a101a21903e8617861616179ff",
  indefinite:
    "9fbf00d901029f9f5820" +
    "00".repeat(32) +
    "00ffff019f9f581d60" +
    "11".repeat(28) +
    "1a000f4240ffff021a00030d40ffbf04d901029fbf1903e8012002ffff05bf9f001818ff9f009f0101ffff9f0100ff9f009f0101fffffffff5d90103bf00bf01bf1903e8617861616179ffffffff"
}

const golden = {
  lengthFirst: {
    redeemers: "a28201008200820101820018188200820101",
    datum: "a220021903e801",
    auxiliaryData: "d90103a100a101a2616161791903e86178",
    transaction: goldenTx.lengthFirst
  },
  inserted: {
    redeemers: "a28200181882008201018201008200820101",
    datum: "a21903e8012002",
    auxiliaryData: "d90103a100a101a21903e8617861616179",
    transaction: goldenTx.inserted
  },
  nodeLayout: {
    redeemers: "a29f001818ff9f009f0101ffff9f0100ff9f009f0101ffff",
    datum: "a21903e8012002",
    auxiliaryData: "d90103a100a101a21903e8617861616179",
    transaction: goldenTx.nodeLayout
  },
  indefinite: {
    redeemers: "bf9f001818ff9f009f0101ffff9f0100ff9f009f0101ffffff",
    datum: "bf1903e8012002ff",
    auxiliaryData: "d90103bf00bf01bf1903e8617861616179ffffff",
    transaction: goldenTx.indefinite
  }
} as const

describe("existing presets keep their bytes", () => {
  const presets = [
    ["CANONICAL_OPTIONS", CBOR.CANONICAL_OPTIONS, golden.lengthFirst],
    ["CML_DEFAULT_OPTIONS", CBOR.CML_DEFAULT_OPTIONS, golden.inserted],
    ["PLUTUS_DATA_OPTIONS", CBOR.PLUTUS_DATA_OPTIONS, golden.nodeLayout],
    ["CML_DATA_DEFAULT_OPTIONS", CBOR.CML_DATA_DEFAULT_OPTIONS, golden.indefinite],
    ["AIKEN_DEFAULT_OPTIONS", CBOR.AIKEN_DEFAULT_OPTIONS, golden.nodeLayout],
    ["STRUCT_FRIENDLY_OPTIONS", CBOR.STRUCT_FRIENDLY_OPTIONS, golden.inserted],
    ["CML_DATA_DEFINITE_OPTIONS", CBOR.CML_DATA_DEFINITE_OPTIONS, golden.inserted],
    ["CARDANO_NODE_DATA_OPTIONS", CBOR.CARDANO_NODE_DATA_OPTIONS, golden.inserted]
  ] as const

  for (const [name, options, expected] of presets) {
    it(name, () => {
      expect(Redeemers.toCBORHexMap(redeemers, options)).toBe(expected.redeemers)
      expect(Data.toCBORHex(datum, options)).toBe(expected.datum)
      expect(AuxiliaryData.toCBORHex(auxiliaryData, options)).toBe(expected.auxiliaryData)
      expect(Transaction.toCBORHex(tx, options)).toBe(expected.transaction)
    })
  }

  it("TX_DEFAULT_OPTIONS and no options", () => {
    expect(Redeemers.toCBORHexMap(redeemers, CBOR.TX_DEFAULT_OPTIONS)).toBe(golden.inserted.redeemers)
    expect(Redeemers.toCBORHexMap(redeemers)).toBe(golden.inserted.redeemers)
    expect(Transaction.toCBORHex(tx, CBOR.TX_DEFAULT_OPTIONS)).toBe(golden.inserted.transaction)
    expect(Transaction.toCBORHex(tx)).toBe(golden.inserted.transaction)
  })

  it("TX_CANONICAL_OPTIONS", () => {
    expect(Redeemers.toCBORHexMap(redeemers, CBOR.TX_CANONICAL_OPTIONS)).toBe(golden.lengthFirst.redeemers)
    expect(Transaction.toCBORHex(tx, CBOR.TX_CANONICAL_OPTIONS)).toBe(golden.lengthFirst.transaction)
  })

  it("language views stay length-first", () => {
    const costModels = new CostModel.CostModels({
      PlutusV1: new CostModel.CostModel({ costs: [1n, -2n] }),
      PlutusV2: new CostModel.CostModel({ costs: [3n] }),
      PlutusV3: new CostModel.CostModel({ costs: [4n, 5n] })
    })
    expect(Bytes.toHex(CostModel.languageViewsEncoding(costModels))).toBe("a3018103028204054100449f0121ff")
  })
})

// Each map key as the encoder writes it, in the order written
const writtenKeys = (bytes: Uint8Array): Array<string> => {
  const { format } = CBOR.fromCBORBytesWithFormat(bytes)
  if (format._tag !== "map") throw new Error("not a map")
  return (format.keyOrder ?? []).map((key) => Bytes.toHex(key))
}

// The reference orders: bytewise is Buffer.compare; length-first is the
// comparator the encoder used before keyOrder existed
const sortBytewise = (keys: ReadonlyArray<Uint8Array>): Array<string> =>
  [...keys].sort((a, b) => Buffer.compare(a, b)).map((key) => Bytes.toHex(key))
const sortLengthFirst = (keys: ReadonlyArray<Uint8Array>): Array<string> =>
  [...keys].sort((a, b) => a.length - b.length || Buffer.compare(a, b)).map((key) => Bytes.toHex(key))

const cborKey: FastCheck.Arbitrary<CBOR.CBOR> = FastCheck.oneof(
  FastCheck.bigInt({ min: -(2n ** 70n), max: 2n ** 70n }),
  FastCheck.integer({ min: -30, max: 1100 }).map(BigInt),
  FastCheck.uint8Array({ maxLength: 40 }),
  FastCheck.string({ maxLength: 30 }),
  FastCheck.array(
    FastCheck.integer({ min: 0, max: 300 }).map((n): CBOR.CBOR => BigInt(n)),
    { maxLength: 3 }
  )
)

// Distinct keys, so each key is written once
const cborMap = FastCheck.uniqueArray(FastCheck.tuple(cborKey, FastCheck.bigInt({ min: 0n, max: 3n })), {
  maxLength: 8,
  selector: ([key]) => CBOR.toCBORHex(key, CBOR.CANONICAL_OPTIONS)
}).map((entries) => new Map<CBOR.CBOR, CBOR.CBOR>(entries))

const sortedCustom = (keyOrder: "lengthFirst" | "bytewise" | undefined): CBOR.CodecOptions => ({
  mode: "custom",
  useIndefiniteArrays: false,
  useIndefiniteMaps: true,
  useDefiniteForEmpty: true,
  sortMapKeys: true,
  keyOrder,
  useMinimalEncoding: true
})

describe("keyOrder properties", () => {
  it("bytewise writes CBOR map keys in Buffer.compare order", () => {
    FastCheck.assert(
      FastCheck.property(cborMap, (map) => {
        for (const options of [CBOR.HW_CLI_OPTIONS, sortedCustom("bytewise")]) {
          const keys = Array.from(map.keys(), (key) => CBOR.toCBORBytes(key, options))
          expect(writtenKeys(CBOR.toCBORBytes(map, options))).toEqual(sortBytewise(keys))
        }
      })
    )
  })

  it("lengthFirst, set or left out, writes CBOR map keys in the length-first order", () => {
    FastCheck.assert(
      FastCheck.property(cborMap, (map) => {
        const canonical = CBOR.toCBORHex(map, CBOR.CANONICAL_OPTIONS)
        expect(CBOR.toCBORHex(map, { mode: "canonical", keyOrder: "lengthFirst" })).toBe(canonical)
        const keys = Array.from(map.keys(), (key) => CBOR.toCBORBytes(key, CBOR.CANONICAL_OPTIONS))
        expect(writtenKeys(Bytes.fromHex(canonical))).toEqual(sortLengthFirst(keys))
        for (const keyOrder of ["lengthFirst", undefined] as const) {
          const options = sortedCustom(keyOrder)
          const customKeys = Array.from(map.keys(), (key) => CBOR.toCBORBytes(key, options))
          expect(writtenKeys(CBOR.toCBORBytes(map, options))).toEqual(sortLengthFirst(customKeys))
        }
      })
    )
  })

  it("bytewise writes Plutus data map keys in Buffer.compare order", () => {
    const dataKey: FastCheck.Arbitrary<Data.Data> = FastCheck.oneof(
      FastCheck.bigInt({ min: -(2n ** 70n), max: 2n ** 70n }),
      FastCheck.integer({ min: -30, max: 1100 }).map(BigInt),
      FastCheck.uint8Array({ maxLength: 64 }),
      FastCheck.array(
        FastCheck.integer({ min: -5, max: 300 }).map((n): Data.Data => BigInt(n)),
        { maxLength: 3 }
      ).map(Data.list)
    )
    const dataMap = FastCheck.uniqueArray(FastCheck.tuple(dataKey, FastCheck.bigInt({ min: 0n, max: 3n })), {
      maxLength: 8,
      selector: ([key]) => Data.toCBORHex(key, CBOR.HW_CLI_OPTIONS)
    }).map((entries) => Data.map(entries))
    FastCheck.assert(
      FastCheck.property(dataMap, (map) => {
        for (const [options, sort] of [
          [CBOR.HW_CLI_OPTIONS, sortBytewise],
          [CBOR.CANONICAL_OPTIONS, sortLengthFirst]
        ] as const) {
          const keys = Array.from(map.keys(), (key) => Data.toCBORBytes(key, options))
          expect(writtenKeys(Data.toCBORBytes(map, options))).toEqual(sort(keys))
        }
      })
    )
  })

  it("bytewise writes redeemer map keys in Buffer.compare order", () => {
    const tags = ["spend", "mint", "cert", "reward", "vote", "propose"] as const
    const redeemerMap = FastCheck.uniqueArray(
      FastCheck.tuple(FastCheck.integer({ min: 0, max: 5 }), FastCheck.bigInt({ min: 0n, max: 1000n })),
      { minLength: 1, maxLength: 8, selector: ([tag, index]) => `${tag}:${index}` }
    ).map((keys) =>
      Redeemers.makeRedeemerMap(
        keys.map(([tag, index]) => new Redeemer.Redeemer({ tag: tags[tag], index, data: 0n, exUnits }))
      )
    )
    FastCheck.assert(
      FastCheck.property(redeemerMap, (map) => {
        for (const [options, sort] of [
          [CBOR.HW_CLI_OPTIONS, sortBytewise],
          [CBOR.CANONICAL_OPTIONS, sortLengthFirst]
        ] as const) {
          const keys = map
            .toArray()
            .map((r) => CBOR.toCBORBytes([BigInt(tags.indexOf(r.tag)), r.index], options))
          expect(writtenKeys(Redeemers.toCBORBytesMap(map, options))).toEqual(sort(keys))
        }
      })
    )
  })
})
