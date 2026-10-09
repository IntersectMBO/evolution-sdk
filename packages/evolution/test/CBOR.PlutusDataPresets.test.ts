import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { blake2b } from "@noble/hashes/blake2.js"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"

// Oracle vectors from `cardano-cli 10.5.1 hash-script-data`: the bytes are the
// node encoding of each value, and the hash is blake2b-256 of those bytes.
const oracles: ReadonlyArray<{ name: string; data: Data.Data; bytes: string; hash: string }> = [
  {
    name: "list [1, 2]",
    data: Data.list([1n, 2n]),
    bytes: "9f0102ff",
    hash: "ed33125018c5cbc9ae1b242a3ff8f3db2e108e4a63866d0b5238a34502c723ed"
  },
  {
    name: "map {1: 2}",
    data: Data.map([[1n, 2n]]),
    bytes: "a10102",
    hash: "83eeb4193576c3f615697a300067662b2154b6753a3c6596eda5822a2d658dc0"
  },
  {
    name: "constr 0 [1]",
    data: Data.constr(0n, [1n]),
    bytes: "d8799f01ff",
    hash: "58b85f4b6b8f3d8e62f406ee77f09afc99a9e1b959389367969bcce3c485c6ad"
  },
  {
    name: "constr 0 [1, [2]]",
    data: Data.constr(0n, [1n, Data.list([2n])]),
    bytes: "d8799f019f02ffff",
    hash: "568f77b14e62b9cbe3528ad268f33ec71a3929809c38905f8a8ce1933568ad28"
  },
  {
    // Also equals Aiken v1.1.24 blake2b_256(serialise_data(datum)) inside a validator.
    name: "datum constr 0 [h'aa', {h'01': 5, h'02': 7}, [[h'01', 5], [h'02', 7]]]",
    data: Data.constr(0n, [
      Bytes.fromHex("aa"),
      Data.map([
        [Bytes.fromHex("01"), 5n],
        [Bytes.fromHex("02"), 7n]
      ]),
      Data.list([Data.list([Bytes.fromHex("01"), 5n]), Data.list([Bytes.fromHex("02"), 7n])])
    ]),
    bytes: "d8799f41aaa24101054102079f9f410105ff9f410207ffffff",
    hash: "609906c41d57c561f14f46944f4cd699ee8c316054583decedd5489df8395084"
  }
]

describe("PLUTUS_DATA_OPTIONS matches the node encoding", () => {
  for (const { bytes, data, hash, name } of oracles) {
    it(`${name}: encodes as ${bytes}`, () => {
      expect(Data.toCBORHex(data, CBOR.PLUTUS_DATA_OPTIONS)).toBe(bytes)
    })

    it(`${name}: hash of the encoding matches cardano-cli`, () => {
      const encoded = Data.toCBORBytes(data, CBOR.PLUTUS_DATA_OPTIONS)
      expect(Bytes.toHex(blake2b(encoded, { dkLen: 32 }))).toBe(hash)
    })

    it(`${name}: the Data default writes the same bytes and datum hash`, () => {
      expect(Data.toCBORHex(data)).toBe(Data.toCBORHex(data, CBOR.PLUTUS_DATA_OPTIONS))
      expect(Bytes.toHex(Data.toDatumHash(data).hash)).toBe(hash)
    })
  }

  it("encodes the empty list as 80 and the empty map as a0", () => {
    expect(Data.toCBORHex(Data.list([]), CBOR.PLUTUS_DATA_OPTIONS)).toBe("80")
    expect(Data.toCBORHex(Data.map([]), CBOR.PLUTUS_DATA_OPTIONS)).toBe("a0")
  })

  it("keeps the deprecated aliases pointing at the new presets", () => {
    expect(CBOR.AIKEN_DEFAULT_OPTIONS).toBe(CBOR.PLUTUS_DATA_OPTIONS)
    expect(CBOR.CARDANO_NODE_DATA_OPTIONS).toBe(CBOR.CML_DATA_DEFINITE_OPTIONS)
  })

  it("is the Data default", () => {
    expect(Data.DEFAULT_CBOR_OPTIONS).toBe(CBOR.PLUTUS_DATA_OPTIONS)
    expect(Data.toCBORHex(Data.map([[1n, 2n]]))).toBe("a10102")
  })

  it("leaves CML_DATA_DEFAULT_OPTIONS writing maps indefinite", () => {
    expect(Data.toCBORHex(Data.map([[1n, 2n]]), CBOR.CML_DATA_DEFAULT_OPTIONS)).toBe("bf0102ff")
  })
})

describe("CML data presets match CML", () => {
  const cmlInt = (n: number) => CML.PlutusData.new_integer(CML.BigInteger.from_str(String(n)))
  const cmlBytes = (hex: string) => CML.PlutusData.new_bytes(Bytes.fromHex(hex))
  const cmlList = (items: ReadonlyArray<CML.PlutusData>) => {
    const list = CML.PlutusDataList.new()
    for (const item of items) list.add(item)
    return CML.PlutusData.new_list(list)
  }
  const cmlMap = (entries: ReadonlyArray<readonly [CML.PlutusData, CML.PlutusData]>) => {
    const map = CML.PlutusMap.new()
    for (const [k, v] of entries) map.set(k, v)
    return CML.PlutusData.new_map(map)
  }
  const cmlConstr = (index: bigint, fields: ReadonlyArray<CML.PlutusData>) => {
    const list = CML.PlutusDataList.new()
    for (const field of fields) list.add(field)
    return CML.PlutusData.new_constr_plutus_data(CML.ConstrPlutusData.new(index, list))
  }

  // Each case is built fresh in both libraries, so neither side carries a
  // decoded encoding. Map keys are already in sorted order, because
  // to_cardano_node_format() sorts map keys and CML_DATA_DEFAULT_OPTIONS keeps
  // insertion order.
  const cases: ReadonlyArray<{ name: string; build: () => [Data.Data, CML.PlutusData] }> = [
    { name: "list [1, 2]", build: () => [Data.list([1n, 2n]), cmlList([cmlInt(1), cmlInt(2)])] },
    { name: "map {1: 2}", build: () => [Data.map([[1n, 2n]]), cmlMap([[cmlInt(1), cmlInt(2)]])] },
    { name: "constr 0 [1]", build: () => [Data.constr(0n, [1n]), cmlConstr(0n, [cmlInt(1)])] },
    {
      name: "datum constr 0 [h'aa', {h'01': 5, h'02': 7}, [[h'01', 5], [h'02', 7]]]",
      build: () => [
        Data.constr(0n, [
          Bytes.fromHex("aa"),
          Data.map([
            [Bytes.fromHex("01"), 5n],
            [Bytes.fromHex("02"), 7n]
          ]),
          Data.list([Data.list([Bytes.fromHex("01"), 5n]), Data.list([Bytes.fromHex("02"), 7n])])
        ]),
        cmlConstr(0n, [
          cmlBytes("aa"),
          cmlMap([
            [cmlBytes("01"), cmlInt(5)],
            [cmlBytes("02"), cmlInt(7)]
          ]),
          cmlList([cmlList([cmlBytes("01"), cmlInt(5)]), cmlList([cmlBytes("02"), cmlInt(7)])])
        ])
      ]
    }
  ]

  for (const { build, name } of cases) {
    it(`${name}: CML_DATA_DEFAULT_OPTIONS equals to_cardano_node_format().to_cbor_hex()`, () => {
      const [data, cml] = build()
      expect(Data.toCBORHex(data, CBOR.CML_DATA_DEFAULT_OPTIONS)).toBe(cml.to_cardano_node_format().to_cbor_hex())
    })

    it(`${name}: CML_DATA_DEFINITE_OPTIONS equals to_cbor_hex()`, () => {
      const [data, cml] = build()
      expect(Data.toCBORHex(data, CBOR.CML_DATA_DEFINITE_OPTIONS)).toBe(cml.to_cbor_hex())
    })
  }
})
