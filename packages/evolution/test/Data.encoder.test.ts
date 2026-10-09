import { FastCheck, Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"
import * as DatumOption from "../src/DatumOption.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as UPLC from "../src/UPLC.js"

// Hex of the bytes from..from+n-1
const seq = (from: number, n: number): string => Bytes.toHex(Uint8Array.from({ length: n }, (_, i) => from + i))

const big65 = BigInt("0x" + seq(1, 65))
const big200 = BigInt("0x" + seq(1, 200))
const bigPayload65 = `5f5840${seq(1, 64)}41${seq(65, 1)}ff`
const bigPayload200 = `5f5840${seq(1, 64)}5840${seq(65, 64)}5840${seq(129, 64)}48${seq(193, 8)}ff`

// Bytes and datum hashes from two independent reference encoders of the node
// layout, which agree on every case
const oracle: ReadonlyArray<{ name: string; data: Data.Data; hex: string; hash: string }> = [
  {
    name: "Constr 128 [1]",
    data: Data.constr(128n, [1n]),
    hex: "d8668218809f01ff",
    hash: "fd05a09eedb9747bc38ac3dcc2eec2f9790f1ddf9dbe125577dea6eba9ce7405"
  },
  {
    name: "Constr 1000 [1]",
    data: Data.constr(1000n, [1n]),
    hex: "d866821903e89f01ff",
    hash: "ba07c7523ca414b7b4a379b8bdf2dd41b47bb1d95cb0ef17bc048b5ed7d48ea8"
  },
  {
    name: "Constr 128 []",
    data: Data.constr(128n, []),
    hex: "d86682188080",
    hash: "e4886280ddea3623dfcce52c34b42d69d7932b6967798a1819442c6d9532c175"
  },
  {
    name: "nested tag 102",
    data: Data.constr(200n, [
      Data.constr(300n, [2n, [3n]]),
      Data.constr(0n, []),
      Data.constr(7n, [Bytes.fromHex("ab")])
    ]),
    hex: "d8668218c89fd8668219012c9f029f03ffffd87980d905009f41abffff",
    hash: "467913537d7e5be4dd016e8bbe0c19aae048a99c6d0ce10b32293ad9486f3993"
  },
  {
    name: "65-byte bignum",
    data: big65,
    hex: `c2${bigPayload65}`,
    hash: "d75c7051c8d273e945ae880b5165f50d0b97f83d492f5c58fbe1c78ab04452bd"
  },
  {
    name: "65-byte negative bignum",
    data: -1n - big65,
    hex: `c3${bigPayload65}`,
    hash: "6952d7f09ded3b1a2011daeef0985493ab1c2ead3f0eec80271d651e42091d3e"
  },
  {
    name: "200-byte bignum",
    data: big200,
    hex: `c2${bigPayload200}`,
    hash: "3bd58ca6d456c55524db48c55479a67d633dca1bd846e1e2365833ffd947a862"
  },
  {
    name: "200-byte negative bignum",
    data: -1n - big200,
    hex: `c3${bigPayload200}`,
    hash: "f83089b61dce7020b3bc2a7d3733ab74f5272e6b674a26b103f195792313d7f6"
  },
  {
    name: "-2^64",
    data: -(2n ** 64n),
    hex: "3bffffffffffffffff",
    hash: "69393b55a0ae218f47bfa0376159277a159c76662f738592c1553e3d904c5ac7"
  },
  {
    name: "2^64 - 1",
    data: 2n ** 64n - 1n,
    hex: "1bffffffffffffffff",
    hash: "3fac877e3f1eaefb3cbb71eb8d49248b51571fd18dc02e74f464f038eb734935"
  },
  {
    name: "2^64",
    data: 2n ** 64n,
    hex: "c249010000000000000000",
    hash: "0b854352f6a4c02db6f13ac878a41f0b11f54950ad9b88170fb509c916ff0a71"
  },
  {
    name: "-2^64 - 1",
    data: -(2n ** 64n) - 1n,
    hex: "c349010000000000000000",
    hash: "42e2692b0e46ba0dc699ee2f1aa07e1bffb800c35c7b138ddb756d8bf998bc89"
  },
  {
    name: "65-byte byte string",
    data: Bytes.fromHex(seq(0, 65)),
    hex: `5f5840${seq(0, 64)}41${seq(64, 1)}ff`,
    hash: "1aeac7f533c4d772fea626e7a9233cb1c58ef171f585c05f3070791ff695b898"
  }
]

const presets: ReadonlyArray<[string, CBOR.CodecOptions]> = [
  ["PLUTUS_DATA_OPTIONS", CBOR.PLUTUS_DATA_OPTIONS],
  ["CML_DATA_DEFAULT_OPTIONS", CBOR.CML_DATA_DEFAULT_OPTIONS],
  ["CML_DATA_DEFINITE_OPTIONS", CBOR.CML_DATA_DEFINITE_OPTIONS],
  ["CANONICAL_OPTIONS", CBOR.CANONICAL_OPTIONS],
  ["CML_DEFAULT_OPTIONS", CBOR.CML_DEFAULT_OPTIONS],
  ["STRUCT_FRIENDLY_OPTIONS", CBOR.STRUCT_FRIENDLY_OPTIONS],
  ["canonical, map as pairs", { mode: "canonical", encodeMapAsPairs: true }],
  [
    "custom, sorted indefinite maps",
    {
      mode: "custom",
      useIndefiniteArrays: true,
      useIndefiniteMaps: true,
      useDefiniteForEmpty: false,
      sortMapKeys: true,
      useMinimalEncoding: true
    }
  ],
  [
    "custom, non-minimal",
    {
      mode: "custom",
      useIndefiniteArrays: false,
      useIndefiniteMaps: false,
      useDefiniteForEmpty: true,
      sortMapKeys: false,
      useMinimalEncoding: false
    }
  ]
]

const indefiniteLists = (options: CBOR.CodecOptions) => options.mode === "custom" && options.useIndefiniteArrays

describe("Data encoder", () => {
  describe("matches the reference encoders", () => {
    it.each(oracle)("$name", ({ data, hash, hex }) => {
      expect(Data.toCBORHex(data, CBOR.PLUTUS_DATA_OPTIONS)).toBe(hex)
      expect(Data.toDatumHash(data, CBOR.PLUTUS_DATA_OPTIONS).hash).toEqual(Bytes.fromHex(hash))
      expect(Data.fromCBORHex(hex)).toEqual(data)
    })

    it("writes the oracle bytes through FromCBORHex and withSchema", () => {
      const codec = Data.withSchema(Schema.typeSchema(Data.DataSchema), CBOR.PLUTUS_DATA_OPTIONS)
      for (const { data, hex } of oracle) {
        expect(Schema.encodeSync(Data.FromCBORHex(CBOR.PLUTUS_DATA_OPTIONS))(data)).toBe(hex)
        expect(codec.toCBORHex(data)).toBe(hex)
      }
    })
  })

  describe("rules that hold under every preset", () => {
    const leaves = oracle.filter(({ data }) => !Data.isConstr(data))

    it.each(presets)("integers and byte strings under %s", (_, options) => {
      for (const { data, hex } of leaves) {
        expect(Data.toCBORHex(data, options)).toBe(hex)
      }
    })

    it.each(presets.filter(([, options]) => options.mode === "canonical" || options.useMinimalEncoding))(
      "tag 102 writes a definite pair under %s",
      (_, options) => {
        const fields = indefiniteLists(options) ? "9f01ff" : "8101"
        expect(Data.toCBORHex(Data.constr(128n, [1n]), options)).toBe(`d866821880${fields}`)
        expect(Data.toCBORHex(Data.constr(1000n, [1n]), options)).toBe(`d866821903e8${fields}`)
        expect(Data.toCBORHex(Data.constr(2n ** 64n - 1n, []), options)).toBe("d866821bffffffffffffffff80")
      }
    )

    it("bignum bytes inside lists, maps and constructors", () => {
      const data = Data.constr(0n, [[big65], new Map<Data.Data, Data.Data>([[big65, -1n - big65]])])
      expect(Data.toCBORHex(data, CBOR.PLUTUS_DATA_OPTIONS)).toBe(
        `d8799f9fc2${bigPayload65}ffa1c2${bigPayload65}c3${bigPayload65}ff`
      )
    })
  })

  describe("matches the CBOR tree encoder outside the rule cases", () => {
    // Integers in (-2^64, 2^64), byte strings up to 64 bytes, indices up to 127
    const leaf = FastCheck.oneof(
      FastCheck.bigInt({ min: -(2n ** 64n) + 1n, max: 2n ** 64n - 1n }),
      FastCheck.constantFrom(0n, 23n, 24n, 255n, 256n, 65535n, 65536n, 2n ** 32n, -1n, -24n, -25n, -(2n ** 64n) + 1n),
      FastCheck.uint8Array({ maxLength: 64 })
    )
    const { tree } = FastCheck.letrec<{ tree: Data.Data; list: Data.List; map: Data.Map; constr: Data.Constr }>(
      (tie) => ({
        tree: FastCheck.oneof({ depthSize: "small", maxDepth: 4 }, leaf, tie("list"), tie("map"), tie("constr")),
        list: FastCheck.array(tie("tree"), { maxLength: 6 }),
        map: FastCheck.array(FastCheck.tuple(tie("tree"), tie("tree")), { maxLength: 6 }).map(
          (entries) => new Map(entries)
        ),
        constr: FastCheck.tuple(FastCheck.bigInt({ min: 0n, max: 127n }), FastCheck.array(tie("tree"), { maxLength: 4 })).map(
          ([index, fields]) => Data.constr(index, fields)
        )
      })
    )
    const samples = FastCheck.sample(tree, { seed: 614, numRuns: 200 })

    const viaTree = (data: Data.Data, options: CBOR.CodecOptions): string => {
      try {
        return CBOR.toCBORHex(Data.plutusDataToCBORValue(data), options)
      } catch {
        return "throws"
      }
    }
    const direct = (data: Data.Data, options: CBOR.CodecOptions): string => {
      try {
        return Data.toCBORHex(data, options)
      } catch {
        return "throws"
      }
    }

    it.each(presets)("%s", (_, options) => {
      for (const data of samples) {
        expect(direct(data, options)).toBe(viaTree(data, options))
      }
    })
  })

  describe("encoders that write Plutus data", () => {
    // Constr 128 [-2^64, 65-byte bignum] in the node layout
    const data = Data.constr(128n, [-(2n ** 64n), big65])
    const dataHex = `d8668218809f3bffffffffffffffffc2${bigPayload65}ff`
    const exUnits = new Redeemer.ExUnits({ mem: 1n, steps: 2n })
    const redeemer = new Redeemer.Redeemer({ tag: "spend", index: 0n, data, exUnits })
    const options = { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.PLUTUS_DATA_OPTIONS }

    it("redeemers and witness datums", () => {
      expect(Redeemer.toCBORHex(redeemer, options)).toBe(`840000${dataHex}820102`)
      expect(Redeemers.toCBORHex(new Redeemers.RedeemerArray({ value: [redeemer] }), options)).toBe(
        `81840000${dataHex}820102`
      )
      expect(Redeemers.toCBORHexMap(Redeemers.makeRedeemerMap([redeemer]), options)).toBe(
        `a182000082${dataHex}820102`
      )
      const witnessSet = new TransactionWitnessSet.TransactionWitnessSet({ plutusData: [data] })
      expect(TransactionWitnessSet.toCBORHex(witnessSet, options)).toBe(`a104d9010281${dataHex}`)
    })

    it("a decoded witness set replays -2^64 in the form it was written", () => {
      const fresh = TransactionWitnessSet.toCBORHex(
        new TransactionWitnessSet.TransactionWitnessSet({ plutusData: [-(2n ** 64n)] })
      )
      expect(fresh).toBe("a104d90102813bffffffffffffffff")
      for (const hex of [
        fresh,
        "a104d9010281c348ffffffffffffffff",
        "a105a1820000823bffffffffffffffff820000",
        "a105a182000082c348ffffffffffffffff820000"
      ]) {
        const decoded = TransactionWitnessSet.fromCBORHexWithFormat(hex)
        expect(TransactionWitnessSet.toCBORHexWithFormat(decoded.value, decoded.format)).toBe(hex)
      }
    })

    it("inline datums and UPLC data constants", () => {
      const inline = new InlineDatum.InlineDatum({ data })
      expect(DatumOption.toCBORHex(inline)).toContain(Data.toCBORHex(data))
      expect(UPLC.dataConstant(data)).toMatchObject({ value: Bytes.fromHex(dataHex) })
    })
  })
})
