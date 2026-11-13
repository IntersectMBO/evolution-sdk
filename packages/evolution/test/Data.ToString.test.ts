import { inspect } from "node:util"

import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as AddressEras from "../src/AddressEras.js"
import * as AssetName from "../src/AssetName.js"
import * as Assets from "../src/Assets.js"
import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as MultiAsset from "../src/MultiAsset.js"
import * as PolicyId from "../src/PolicyId.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionOutput from "../src/TransactionOutput.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as TxOut from "../src/TxOut.js"
import * as UTxO from "../src/UTxO.js"
import * as Value from "../src/Value.js"

const data = Data.constr(0n, [Data.int(42n), Data.bytearray("ab"), Data.map([[Data.int(1n), Data.int(2n)]])])
const rendered = { index: "0", fields: ["42", "ab", [["1", "2"]]] }

const addressHex = "60" + "11".repeat(28)
const address = Address.fromBytes(Bytes.fromHex(addressHex))
const datumOption = new InlineDatum.InlineDatum({ data })
const exUnits = new Redeemer.ExUnits({ mem: 1n, steps: 1n })
const redeemer = new Redeemer.Redeemer({ tag: "spend", index: 0n, data, exUnits })

const values = {
  InlineDatum: datumOption,
  TxOut: new TxOut.TransactionOutput({ address, assets: Assets.fromLovelace(1_000_000n), datumOption }),
  UTxO: new UTxO.UTxO({
    transactionId: TransactionHash.fromHex("00".repeat(32)),
    index: 0n,
    address,
    assets: Assets.fromLovelace(1_000_000n),
    datumOption
  }),
  BabbageTransactionOutput: new TransactionOutput.BabbageTransactionOutput({
    address: AddressEras.fromHex(addressHex),
    amount: Value.onlyCoin(1_000_000n),
    datumOption
  }),
  Redeemer: redeemer,
  RedeemerMap: Redeemers.makeRedeemerMap([redeemer]),
  RedeemerValue: new Redeemers.RedeemerValue({ data, exUnits }),
  RedeemerArray: new Redeemers.RedeemerArray({ value: [redeemer] }),
  TransactionWitnessSet: new TransactionWitnessSet.TransactionWitnessSet({ plutusData: [data] })
}

describe("toString on values holding Plutus data", () => {
  it.each(Object.entries(values))("%s renders its data", (_, value) => {
    expect(() => value.toString()).not.toThrow()
    expect(() => `${value}`).not.toThrow()
    expect(JSON.stringify(value)).toContain(JSON.stringify(rendered))
  })

  it.each(Object.entries(values))("%s inspects its data as bigints and bytes", (_, value) => {
    expect(inspect(value, { depth: null })).toContain("42n")
  })

  it("renders a bare integer datum", () => {
    expect(new InlineDatum.InlineDatum({ data: Data.int(1n) }).toJSON()).toEqual({ _tag: "InlineDatum", data: "1" })
  })
})

describe("Data.toJSON", () => {
  it.each([
    ["an integer", Data.int(1n), "1"],
    ["a negative integer", Data.int(-5n), "-5"],
    ["an integer past 2^64", Data.int(2n ** 70n), (2n ** 70n).toString()],
    ["a byte string", Data.bytearray("ab"), "ab"],
    ["an empty byte string", Data.bytearray(""), ""],
    ["a list", Data.list([Data.int(1n), Data.bytearray("ab")]), ["1", "ab"]],
    ["a map", Data.map([[Data.bytearray("ab"), Data.int(2n)]]), [["ab", "2"]]],
    ["a constructor", Data.constr(7n, [Data.int(1n)]), { index: "7", fields: ["1"] }]
  ])("renders %s", (_, data, expected) => {
    expect(Data.toJSON(data)).toEqual(expected)
  })
})

describe("Value.toJSON", () => {
  const assets = MultiAsset.singleton(PolicyId.fromHex("0".repeat(56)), AssetName.fromHex("4d79546f6b656e"), 3n)

  it.each([
    ["OnlyCoin", Value.onlyCoin(5n)],
    ["WithAssets", Value.withAssets(5n, assets)]
  ])("%s writes coin as a string and inspects it as a bigint", (_, value) => {
    expect(value.toJSON().coin).toBe("5")
    expect(() => value.toString()).not.toThrow()
    expect(inspect(value)).toContain("coin: 5n")
  })
})
