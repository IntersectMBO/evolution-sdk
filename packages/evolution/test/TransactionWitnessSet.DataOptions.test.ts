import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { blake2b } from "@noble/hashes/blake2.js"
import { FastCheck, Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as CostModel from "../src/CostModel.js"
import * as Data from "../src/Data.js"
import * as Ed25519Signature from "../src/Ed25519Signature.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"
import * as ScriptDataHash from "../src/ScriptDataHash.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as VKey from "../src/VKey.js"

// Witness datums and redeemer data are written with the plutusData options,
// the rest of the witness set with the ledger options.
// Redeemers.toScriptDataHash hashes them the same way. A decoded datum or
// redeemer keeps its bytes.

const datumHashHex = (datumHex: string): string => Bytes.toHex(blake2b(Bytes.fromHex(datumHex), { dkLen: 32 }))

// Key 4 value: tag 258 over a definite array of fewer than 24 datums
const witnessDatumsHex = (datumsHex: ReadonlyArray<string>): string =>
  `d90102${(0x80 + datumsHex.length).toString(16)}${datumsHex.join("")}`

// A witness set holding only these datums
const datumsOnlyWitnessSetHex = (datumsHex: ReadonlyArray<string>): string => `a104${witnessDatumsHex(datumsHex)}`

const exUnitsHex = "821903e81907d0"

// A witness set holding only a spend 0 redeemer in a map, with this data
const redeemerOnlyWitnessSetHex = (dataHex: string): string => `a105a182000082${dataHex}${exUnitsHex}`

const datums: ReadonlyArray<Data.Data> = [
  Data.constr(0n, [Data.map([[1n, 2n]]), Data.list([3n])]),
  Data.constr(0n, [1n]),
  Data.map([
    [Bytes.fromHex("01"), 2n],
    [Bytes.fromHex("0203"), Data.list([])]
  ]),
  Data.constr(1n, [Data.constr(0n, [Bytes.fromHex("ab".repeat(70)), -5n]), Data.constr(2n, [])]),
  Data.list([]),
  Data.map([])
]
const datum = datums[0]

const exUnits = new Redeemer.ExUnits({ mem: 1000n, steps: 2000n })
const redeemerList = [
  new Redeemer.Redeemer({ tag: "spend", index: 0n, data: datum, exUnits }),
  new Redeemer.Redeemer({ tag: "mint", index: 1n, data: datums[2], exUnits })
]
const redeemerMap = Redeemers.makeRedeemerMap(redeemerList)
const redeemerArray = new Redeemers.RedeemerArray({ value: redeemerList })

const costModels = new CostModel.CostModels({
  PlutusV1: new CostModel.CostModel({ costs: [] }),
  PlutusV2: new CostModel.CostModel({ costs: [] }),
  PlutusV3: new CostModel.CostModel({ costs: [1n, 2n, 3n] })
})

// CML hashes the redeemers and datums as the witness set holds them
const cmlScriptDataHash = (witnessSetHex: string): string => {
  const ws = CML.TransactionWitnessSet.from_cbor_hex(witnessSetHex)
  return CML.hash_script_data(
    ws.redeemers()!,
    CML.CostModels.from_cbor_hex(CostModel.toCBORHex(costModels)),
    ws.plutus_datums()
  ).to_hex()
}

const vkeyWitness = new TransactionWitnessSet.VKeyWitness({
  vkey: VKey.fromBytes(new Uint8Array(32).fill(0xaa)),
  signature: Ed25519Signature.fromBytes(new Uint8Array(64).fill(0xbb))
})
const vkeyEntryHex = `00d9010281825820${"aa".repeat(32)}5840${"bb".repeat(64)}`

const walletWitnessSetHex = TransactionWitnessSet.toCBORHex(
  new TransactionWitnessSet.TransactionWitnessSet({ vkeyWitnesses: [vkeyWitness] })
)

// {0: 258([[h'00' * 32, 0]]), 1: [[addr, 1000000]], 2: 200000}
const bodyHex = `a300d9010281825820${"00".repeat(32)}00018182581d60${"11".repeat(28)}1a000f4240021a00030d40`

const txHex = (witnessSetHex: string): string => `84${bodyHex}${witnessSetHex}f5f6`

const withWitnessSet = (
  tx: Transaction.Transaction,
  fields: ConstructorParameters<typeof TransactionWitnessSet.TransactionWitnessSet>[0]
): Transaction.Transaction =>
  new Transaction.Transaction({
    ...tx,
    witnessSet: new TransactionWitnessSet.TransactionWitnessSet({ ...tx.witnessSet, ...fields })
  })

// Each option set, and the options its Plutus data is written with. The plain
// CBOR options are still accepted.
const optionSets: ReadonlyArray<
  readonly [string, CBOR.TxCodecOptions | CBOR.CodecOptions | undefined, CBOR.CodecOptions]
> = [
  ["no options", undefined, Data.DEFAULT_CBOR_OPTIONS],
  ["CBOR.CML_DEFAULT_OPTIONS", CBOR.CML_DEFAULT_OPTIONS, Data.DEFAULT_CBOR_OPTIONS],
  ["CBOR.TX_DEFAULT_OPTIONS", CBOR.TX_DEFAULT_OPTIONS, Data.DEFAULT_CBOR_OPTIONS],
  ["CBOR.CANONICAL_OPTIONS", CBOR.CANONICAL_OPTIONS, CBOR.CANONICAL_OPTIONS],
  ["CBOR.TX_CANONICAL_OPTIONS", CBOR.TX_CANONICAL_OPTIONS, CBOR.CANONICAL_OPTIONS],
  [
    "plutusData PLUTUS_DATA_OPTIONS",
    { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.PLUTUS_DATA_OPTIONS },
    CBOR.PLUTUS_DATA_OPTIONS
  ],
  [
    "plutusData CML_DATA_DEFINITE_OPTIONS",
    { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.CML_DATA_DEFINITE_OPTIONS },
    CBOR.CML_DATA_DEFINITE_OPTIONS
  ]
]

describe("CBOR.TxCodecOptions", () => {
  it("the default writes ledger structures as CBOR.CML_DEFAULT_OPTIONS and Plutus data as Data does", () => {
    expect(CBOR.TX_DEFAULT_OPTIONS.ledger).toBe(CBOR.CML_DEFAULT_OPTIONS)
    expect(CBOR.TX_DEFAULT_OPTIONS.plutusData).toBe(Data.DEFAULT_CBOR_OPTIONS)
  })

  it("the canonical preset writes both with CBOR.CANONICAL_OPTIONS", () => {
    expect(CBOR.TX_CANONICAL_OPTIONS).toStrictEqual({
      ledger: CBOR.CANONICAL_OPTIONS,
      plutusData: CBOR.CANONICAL_OPTIONS
    })
  })

  it.each(optionSets)("CBOR.toTxCodecOptions under %s", (_, options, plutusData) => {
    expect(CBOR.toTxCodecOptions(options ?? CBOR.TX_DEFAULT_OPTIONS).plutusData).toBe(plutusData)
  })

  it("transaction options pass through and other plain options write Plutus data with themselves", () => {
    expect(CBOR.toTxCodecOptions(CBOR.TX_DEFAULT_OPTIONS)).toBe(CBOR.TX_DEFAULT_OPTIONS)
    expect(CBOR.toTxCodecOptions(CBOR.CML_DEFAULT_OPTIONS)).toStrictEqual(CBOR.TX_DEFAULT_OPTIONS)
    const copy = { ...CBOR.CML_DEFAULT_OPTIONS }
    expect(CBOR.toTxCodecOptions(copy)).toStrictEqual({ ledger: copy, plutusData: copy })
    expect(CBOR.toTxCodecOptions(CBOR.CML_DATA_DEFAULT_OPTIONS).plutusData).toBe(CBOR.CML_DATA_DEFAULT_OPTIONS)
  })
})

describe.each(optionSets)("under %s", (_, options, plutusData) => {
  const dataHex = (data: Data.Data) => Data.toCBORHex(data, plutusData)
  const redeemerMapHex = `a282000082${dataHex(datum)}${exUnitsHex}82010182${dataHex(datums[2])}${exUnitsHex}`
  const redeemerArrayHex = `82840000${dataHex(datum)}${exUnitsHex}840101${dataHex(datums[2])}${exUnitsHex}`

  it("a redeemer writes its data with the Plutus data options", () => {
    expect(Redeemer.toCBORHex(redeemerList[0], options)).toBe(`840000${dataHex(datum)}${exUnitsHex}`)
    expect(Bytes.toHex(Redeemer.toCBORBytes(redeemerList[0], options))).toBe(`840000${dataHex(datum)}${exUnitsHex}`)
  })

  it("redeemers write their data with the Plutus data options", () => {
    expect(Redeemers.toCBORHexMap(redeemerMap, options)).toBe(redeemerMapHex)
    expect(Bytes.toHex(Redeemers.toCBORBytesMap(redeemerMap, options))).toBe(redeemerMapHex)
    expect(Redeemers.toCBORHex(redeemerArray, options)).toBe(redeemerArrayHex)
    expect(Bytes.toHex(Redeemers.toCBORBytes(redeemerArray, options))).toBe(redeemerArrayHex)
  })

  it("the witness set and transaction write datums and redeemer data with the Plutus data options", () => {
    const ws = new TransactionWitnessSet.TransactionWitnessSet({
      vkeyWitnesses: [vkeyWitness],
      plutusData: datums,
      redeemers: redeemerMap,
      plutusV3Scripts: [new PlutusV3.PlutusV3({ bytes: Bytes.fromHex("450101002499") })]
    })
    const expected =
      `a4${vkeyEntryHex}04${witnessDatumsHex(datums.map(dataHex))}05${redeemerMapHex}` + `07d901028146450101002499`
    expect(TransactionWitnessSet.toCBORHex(ws, options)).toBe(expected)
    expect(Bytes.toHex(TransactionWitnessSet.toCBORBytes(ws, options))).toBe(expected)
    const tx = withWitnessSet(Transaction.fromCBORHex(txHex("a0")), ws)
    expect(Transaction.toCBORHex(tx, options)).toBe(txHex(expected))
    expect(Bytes.toHex(Transaction.toCBORBytes(tx, options))).toBe(txHex(expected))
  })

  it("each datum hashes as it is written", () => {
    for (const d of datums) {
      expect(datumHashHex(dataHex(d))).toBe(Bytes.toHex(Data.toDatumHash(d, plutusData).hash))
    }
  })

  it.each([
    ["map", redeemerMap],
    ["array", redeemerArray]
  ])("toScriptDataHash with %s redeemers matches the hash over the witness set as written", (_, redeemers) => {
    for (const plutusDatums of [undefined, datums]) {
      const ws = new TransactionWitnessSet.TransactionWitnessSet({ plutusData: plutusDatums, redeemers })
      expect(ScriptDataHash.toHex(Redeemers.toScriptDataHash(redeemers, costModels, plutusDatums, options))).toBe(
        cmlScriptDataHash(TransactionWitnessSet.toCBORHex(ws, options))
      )
    }
  })

  it("toScriptDataHash with datums and no redeemers hashes the datums as written", () => {
    const ws = new TransactionWitnessSet.TransactionWitnessSet({ plutusData: datums })
    const setHex = witnessDatumsHex(datums.map(dataHex))
    expect(TransactionWitnessSet.toCBORHex(ws, options)).toBe(`a104${setHex}`)
    const empty = new Redeemers.RedeemerArray({ value: [] })
    expect(ScriptDataHash.toHex(Redeemers.toScriptDataHash(empty, costModels, datums, options))).toBe(
      Bytes.toHex(blake2b(Bytes.fromHex(`a0${setHex}a0`), { dkLen: 32 }))
    )
  })

  it("the schemas write what the functions write", () => {
    const ws = new TransactionWitnessSet.TransactionWitnessSet({ plutusData: datums, redeemers: redeemerMap })
    const tx = withWitnessSet(Transaction.fromCBORHex(txHex("a0")), ws)
    expect(Schema.encodeSync(Redeemer.FromCBORHex(options))(redeemerList[0])).toBe(
      Redeemer.toCBORHex(redeemerList[0], options)
    )
    expect(Schema.encodeSync(Redeemers.FromCBORHexMap(options))(redeemerMap)).toBe(redeemerMapHex)
    expect(Schema.encodeSync(Redeemers.FromCBORHex(options))(redeemerArray)).toBe(redeemerArrayHex)
    expect(Schema.encodeSync(TransactionWitnessSet.FromCBORBytes(options))(ws)).toStrictEqual(
      TransactionWitnessSet.toCBORBytes(ws, options)
    )
    expect(Schema.encodeSync(TransactionWitnessSet.FromCBORHex(options))(ws)).toBe(
      TransactionWitnessSet.toCBORHex(ws, options)
    )
    expect(Schema.encodeSync(Transaction.FromCBORBytes(options))(tx)).toStrictEqual(
      Transaction.toCBORBytes(tx, options)
    )
    expect(Schema.encodeSync(Transaction.FromCBORHex(options))(tx)).toBe(Transaction.toCBORHex(tx, options))
  })
})

describe("byte identity with the single-options encoder", () => {
  // CBOR.toCBORBytes writes the whole tree with one set of options, as every
  // encoder did before CBOR.TxCodecOptions
  const presets: ReadonlyArray<readonly [string, CBOR.CodecOptions]> = [
    ["CML_DEFAULT_OPTIONS", CBOR.CML_DEFAULT_OPTIONS],
    ["STRUCT_FRIENDLY_OPTIONS", CBOR.STRUCT_FRIENDLY_OPTIONS],
    ["CML_DATA_DEFAULT_OPTIONS", CBOR.CML_DATA_DEFAULT_OPTIONS],
    ["PLUTUS_DATA_OPTIONS", CBOR.PLUTUS_DATA_OPTIONS],
    ["CML_DATA_DEFINITE_OPTIONS", CBOR.CML_DATA_DEFINITE_OPTIONS],
    ["CANONICAL_OPTIONS", CBOR.CANONICAL_OPTIONS],
    ["sorted map keys", { ...CBOR.CML_DEFAULT_OPTIONS, sortMapKeys: true }],
    ["indefinite maps", { ...CBOR.CML_DEFAULT_OPTIONS, useIndefiniteMaps: true }],
    ["canonical map pairs", { mode: "canonical", encodeMapAsPairs: true }]
  ]

  // The tree writes a constructor index above 127 and an integer outside
  // (-2^64, 2^64) as the Plutus data encoder does not, so the sampled data
  // stays inside those ranges
  const inTreeRange = (data: Data.Data): Data.Data => {
    if (typeof data === "bigint") return data % 2n ** 64n
    if (data instanceof Uint8Array) return data
    if (Array.isArray(data)) return data.map(inTreeRange)
    if (data instanceof Map) return new Map(Array.from(data, ([k, v]) => [inTreeRange(k), inTreeRange(v)]))
    const constr = data as Data.Constr
    return Data.constr(constr.index % 128n, constr.fields.map(inTreeRange))
  }
  const withDataInTreeRange = (tx: Transaction.Transaction): Transaction.Transaction => {
    const { plutusData, redeemers } = tx.witnessSet
    const mapped = redeemers
      ?.toArray()
      .map((r) => new Redeemer.Redeemer({ tag: r.tag, index: r.index, data: inTreeRange(r.data), exUnits: r.exUnits }))
    return withWitnessSet(tx, {
      plutusData: plutusData?.map(inTreeRange),
      redeemers:
        mapped === undefined
          ? undefined
          : redeemers?._tag === "RedeemerMap"
            ? Redeemers.makeRedeemerMap(mapped)
            : new Redeemers.RedeemerArray({ value: mapped })
    })
  }

  // Each sampled transaction, and the same transaction without datums and redeemers
  const txs = FastCheck.sample(Transaction.arbitrary, { seed: 604, numRuns: 20 }).flatMap((tx) => [
    withDataInTreeRange(tx),
    withWitnessSet(tx, { plutusData: undefined, redeemers: undefined })
  ])
  const holdsPlutusData = (tx: Transaction.Transaction) =>
    (tx.witnessSet.plutusData ?? []).length > 0 || (tx.witnessSet.redeemers?.size ?? 0) > 0
  const single = (tx: Transaction.Transaction, options: CBOR.CodecOptions) =>
    CBOR.toCBORBytes(Schema.encodeSync(Transaction.FromCDDL)(tx) as unknown as CBOR.CBOR, options)

  it("the sample covers datums and both redeemer formats", () => {
    expect(txs.filter((tx) => (tx.witnessSet.plutusData ?? []).length > 0).length).toBeGreaterThan(3)
    expect(txs.filter((tx) => tx.witnessSet.redeemers?._tag === "RedeemerMap").length).toBeGreaterThan(2)
    expect(txs.filter((tx) => tx.witnessSet.redeemers?._tag === "RedeemerArray").length).toBeGreaterThan(2)
  })

  it.each(presets)("%s: without Plutus data, or with plutusData set to the same options", (_, options) => {
    for (const tx of txs) {
      const txOptions = holdsPlutusData(tx) ? { ledger: options, plutusData: options } : options
      expect(Transaction.toCBORBytes(tx, txOptions)).toStrictEqual(single(tx, options))
      expect(TransactionWitnessSet.toCBORBytes(tx.witnessSet, txOptions)).toStrictEqual(
        CBOR.toCBORBytes(Schema.encodeSync(TransactionWitnessSet.FromCDDL)(tx.witnessSet), options)
      )
    }
  })

  // The single-options format of a transaction, with each datum and redeemer
  // data given the format of its bytes under the data default
  const withDataDefaultFormats = (tx: Transaction.Transaction, format: CBOR.CBORFormat.Array): CBOR.CBORFormat => {
    const dataFormat = (data: Data.Data) => CBOR.fromCBORBytesWithFormat(Data.toCBORBytes(data)).format
    const redeemers = tx.witnessSet.redeemers?.toArray() ?? []
    const ws = format.children[1] as CBOR.CBORFormat.Map
    const entries = ws.entries.map(([keyFormat, valueFormat], i): readonly [CBOR.CBORFormat, CBOR.CBORFormat] => {
      const key = CBOR.fromCBORBytes(ws.keyOrder![i])
      if (key === 4n) {
        const set = valueFormat as CBOR.CBORFormat.Tag
        return [keyFormat, { ...set, child: { ...set.child, children: tx.witnessSet.plutusData!.map(dataFormat) } }]
      }
      if (key === 5n && valueFormat._tag === "map") {
        const entryFormats = valueFormat.entries.map(([redeemerKeyFormat, pair], j) => {
          const [tag, index] = CBOR.fromCBORBytes(valueFormat.keyOrder![j]) as [bigint, bigint]
          const redeemer = redeemers.find((r) => r.tag === Redeemer.integerToTag(tag) && r.index === index)!
          const children = (pair as CBOR.CBORFormat.Array).children
          return [redeemerKeyFormat, { ...pair, children: [dataFormat(redeemer.data), children[1]] }] as const
        })
        return [keyFormat, { ...valueFormat, entries: entryFormats }]
      }
      if (key === 5n && valueFormat._tag === "array") {
        const children = valueFormat.children.map((tuple, j) => {
          const [tag, index, , exUnitsFormat] = (tuple as CBOR.CBORFormat.Array).children
          return { ...tuple, children: [tag, index, dataFormat(redeemers[j].data), exUnitsFormat] }
        })
        return [keyFormat, { ...valueFormat, children }]
      }
      return [keyFormat, valueFormat]
    })
    return { ...format, children: [format.children[0], { ...ws, entries }, ...format.children.slice(2)] }
  }

  it("with Plutus data, the default changes only the datum and redeemer data bytes", () => {
    for (const tx of txs.filter(holdsPlutusData)) {
      const { format, value } = CBOR.fromCBORBytesWithFormat(single(tx, CBOR.CML_DEFAULT_OPTIONS))
      const expected = CBOR.toCBORBytesWithFormat(value, withDataDefaultFormats(tx, format as CBOR.CBORFormat.Array))
      expect(Transaction.toCBORBytes(tx)).toStrictEqual(expected)
      expect(Transaction.toCBORBytes(tx, CBOR.CML_DEFAULT_OPTIONS)).toStrictEqual(expected)
      expect(Transaction.toCBORBytes(tx, CBOR.TX_DEFAULT_OPTIONS)).toStrictEqual(expected)
    }
  })

  // A transaction written with maps as pairs does not decode
  it.each(presets.slice(0, -1))("decoded from %s, replayed with its format", (_, options) => {
    for (const tx of txs) {
      const bytes = single(tx, options)
      const { format, value } = Transaction.fromCBORBytesWithFormat(bytes)
      const expected = CBOR.toCBORBytesWithFormat(
        Schema.encodeSync(Transaction.FromCDDL)(value) as unknown as CBOR.CBOR,
        format
      )
      expect(Transaction.toCBORBytesWithFormat(value, format)).toStrictEqual(expected)
      expect(Transaction.toCBORBytes(Transaction.fromCBORBytes(bytes))).toStrictEqual(expected)
    }
  })
})

// Each layout of Constr 0 [{1: 2}, [3]] and friends, as another tool may have written it
const decodedLayouts: ReadonlyArray<readonly [string, string]> = [
  ["definite", "d87982a101028103"],
  ["indefinite", "d8799fbf0102ff9f03ffff"],
  ["indefinite fields, definite map and list", "d8799fa101028103ff"],
  ["definite fields, indefinite map and list", "d87982bf0102ff9f03ff"],
  ["byte-keyed definite map", "a241010242020380"],
  ["byte-keyed indefinite map", "bf41010242020380ff"],
  ["chunked bytes over 64", `d8799f5f5840${"ab".repeat(64)}46${"ab".repeat(6)}ffff`],
  ["non-minimal lengths", "d87998011801"]
]

// Redeemer containers as another tool may have written them, around the data
const redeemerContainers: ReadonlyArray<readonly [string, (dataHex: string) => string]> = [
  ["definite map", (d) => `a182000082${d}${exUnitsHex}`],
  ["indefinite map", (d) => `bf82000082${d}${exUnitsHex}ff`],
  ["indefinite map entry", (d) => `a19f0000ff9f${d}9f1903e81907d0ffff`],
  ["definite array", (d) => `81840000${d}${exUnitsHex}`],
  ["indefinite array", (d) => `9f9f0000${d}${exUnitsHex}ffff`]
]

describe("datums and redeemers in a decoded transaction", () => {
  it.each(decodedLayouts)("a %s datum keeps its bytes through toCBORHex and addVKeyWitnessesHex", (_, datumHex) => {
    const hex = txHex(datumsOnlyWitnessSetHex([datumHex]))
    expect(Transaction.toCBORHex(Transaction.fromCBORHex(hex))).toBe(hex)
    // The vkey key is new, so it follows the decoded keys
    expect(Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex)).toBe(
      txHex(`a204${witnessDatumsHex([datumHex])}${vkeyEntryHex}`)
    )
  })

  it.each(decodedLayouts)("a %s redeemer keeps its bytes in every container", (_, dataHex) => {
    for (const [name, container] of redeemerContainers) {
      const hex = txHex(`a105${container(dataHex)}`)
      expect(Transaction.toCBORHex(Transaction.fromCBORHex(hex)), name).toBe(hex)
      expect(Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex), name).toBe(
        txHex(`a205${container(dataHex)}${vkeyEntryHex}`)
      )
    }
  })

  it("every layout together keeps its bytes", () => {
    const all = decodedLayouts.map(([, h]) => h)
    const redeemersHex = `a${all.length}${all.map((d, i) => `82000${i}82${d}${exUnitsHex}`).join("")}`
    const hex = txHex(`a204${witnessDatumsHex(all)}05${redeemersHex}`)
    expect(Transaction.toCBORHex(Transaction.fromCBORHex(hex))).toBe(hex)
    expect(Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex)).toBe(
      txHex(`a304${witnessDatumsHex(all)}05${redeemersHex}${vkeyEntryHex}`)
    )
  })

  it.each([
    ["non-minimal root length", "9804"],
    ["indefinite root", "9f"]
  ])("a %s keeps its bytes", (_, header) => {
    const inner = `${bodyHex}${redeemerOnlyWitnessSetHex("d8799fbf0102ff9f03ffff")}f5f6`
    const hex = header === "9f" ? `9f${inner}ff` : `${header}${inner}`
    expect(Transaction.toCBORHex(Transaction.fromCBORHex(hex))).toBe(hex)
  })

  // Matching the decoded map keys must stay linear: a quadratic match takes
  // tens of seconds on a map of this size
  it("a datum and redeemer holding a 1000 entry map keep their bytes", () => {
    const big = Data.map(Array.from({ length: 1000 }, (_, i) => [BigInt(i), 1n] as const))
    const dataHex = Data.toCBORHex(big, CBOR.CML_DATA_DEFINITE_OPTIONS)
    const redeemersHex = `a182000082${dataHex}${exUnitsHex}`
    const hex = txHex(`a204${witnessDatumsHex([dataHex])}05${redeemersHex}`)
    const start = performance.now()
    expect(Transaction.toCBORHex(Transaction.fromCBORHex(hex))).toBe(hex)
    expect(Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex)).toBe(
      txHex(`a304${witnessDatumsHex([dataHex])}05${redeemersHex}${vkeyEntryHex}`)
    )
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it("addVKeyWitnesses on a cached transaction keeps the datums and redeemers", () => {
    const hex = txHex(`a204${witnessDatumsHex(["d87982a101028103"])}05a182000082d87982a101028103${exUnitsHex}`)
    const signed = Transaction.addVKeyWitnesses(Transaction.fromCBORHex(hex), [vkeyWitness])
    expect(Transaction.toCBORHex(signed)).toBe(Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex))
  })
})

describe("a datum or redeemer added to a decoded transaction", () => {
  const decodedHex = "d87982a101028103"
  const added = new Redeemer.Redeemer({ tag: "mint", index: 0n, data: datum, exUnits })
  const addedEntryHex = `82010082${Data.toCBORHex(datum)}${exUnitsHex}`

  it("a datum is written in the data layout and the decoded ones keep theirs", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(txHex(datumsOnlyWitnessSetHex([decodedHex])))
    const extended = withWitnessSet(tx, { plutusData: [...tx.witnessSet.plutusData!, Data.constr(0n, [1n])] })
    expect(Transaction.toCBORHexWithFormat(extended, format)).toBe(
      txHex(datumsOnlyWitnessSetHex([decodedHex, "d8799f01ff"]))
    )
  })

  it("a datum added to an untagged datum set is written in the data layout", () => {
    // The set is written tagged, as the encoder writes every datum set
    const untaggedHex = "d8799f0102ff"
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(txHex(`a10481${untaggedHex}`))
    const extended = withWitnessSet(tx, { plutusData: [...tx.witnessSet.plutusData!, datum] })
    expect(Transaction.toCBORHexWithFormat(extended, format)).toBe(
      txHex(datumsOnlyWitnessSetHex([untaggedHex, Data.toCBORHex(datum)]))
    )
  })

  it.each([
    ["definite map", `a182000082${decodedHex}${exUnitsHex}`, `a282000082${decodedHex}${exUnitsHex}${addedEntryHex}`],
    [
      "indefinite map",
      `bf82000082${decodedHex}${exUnitsHex}ff`,
      `bf82000082${decodedHex}${exUnitsHex}${addedEntryHex}ff`
    ],
    [
      "indefinite map entry",
      `a19f0000ff9f${decodedHex}9f1903e81907d0ffff`,
      `a29f0000ff9f${decodedHex}9f1903e81907d0ffff${addedEntryHex}`
    ]
  ])("a redeemer added to a %s is written with its data in the data layout", (_, decoded, expected) => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(txHex(`a105${decoded}`))
    const redeemers = Redeemers.makeRedeemerMap([...tx.witnessSet.redeemers!.toArray(), added])
    expect(Transaction.toCBORHexWithFormat(withWitnessSet(tx, { redeemers }), format)).toBe(txHex(`a105${expected}`))
  })

  it("a redeemer added to a redeemer array is written with its data in the data layout", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(txHex(`a10581840000${decodedHex}${exUnitsHex}`))
    const redeemers = new Redeemers.RedeemerArray({ value: [...tx.witnessSet.redeemers!.toArray(), added] })
    expect(Transaction.toCBORHexWithFormat(withWitnessSet(tx, { redeemers }), format)).toBe(
      txHex(`a10582840000${decodedHex}${exUnitsHex}840100${Data.toCBORHex(datum)}${exUnitsHex}`)
    )
  })

  it("datums and redeemers added to a transaction without them are written in the data layout", () => {
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(txHex(walletWitnessSetHex))
    const extended = withWitnessSet(tx, { plutusData: datums, redeemers: redeemerMap })
    expect(Transaction.toCBORHexWithFormat(extended, format)).toBe(
      txHex(
        `a3${vkeyEntryHex}04${witnessDatumsHex(datums.map((d) => Data.toCBORHex(d)))}` +
          `05${Redeemers.toCBORHexMap(redeemerMap)}`
      )
    )
  })

  it("added keys keep the order the encoder gives them", () => {
    // Decoded {5: ...}; added keys 0 and 4 follow it in ascending order
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(txHex(redeemerOnlyWitnessSetHex(decodedHex)))
    const extended = withWitnessSet(tx, { vkeyWitnesses: [vkeyWitness], plutusData: [datums[1]] })
    expect(Transaction.toCBORHexWithFormat(extended, format)).toBe(
      txHex(`a305a182000082${decodedHex}${exUnitsHex}${vkeyEntryHex}04d9010281d8799f01ff`)
    )
  })

  it("through the witness set format functions", () => {
    const { format, value: ws } = TransactionWitnessSet.fromCBORHexWithFormat(redeemerOnlyWitnessSetHex(decodedHex))
    const extended = new TransactionWitnessSet.TransactionWitnessSet({
      ...ws,
      redeemers: Redeemers.makeRedeemerMap([...ws.redeemers!.toArray(), added])
    })
    const expected = `a105a282000082${decodedHex}${exUnitsHex}${addedEntryHex}`
    expect(TransactionWitnessSet.toCBORHexWithFormat(extended, format)).toBe(expected)
    expect(Bytes.toHex(TransactionWitnessSet.toCBORBytesWithFormat(extended, format))).toBe(expected)
  })

  it("random datums and redeemer data are written exactly as Data.toCBORBytes writes them", () => {
    const hex = txHex(`a204${witnessDatumsHex([decodedHex])}05a182000082${decodedHex}${exUnitsHex}`)
    const { format, value: tx } = Transaction.fromCBORHexWithFormat(hex)
    const decoded = tx.witnessSet.redeemers!.toArray()
    for (const data of FastCheck.sample(Data.arbitrary, { seed: 604, numRuns: 300 })) {
      const extended = withWitnessSet(tx, {
        plutusData: [...tx.witnessSet.plutusData!, data],
        redeemers: Redeemers.makeRedeemerMap([...decoded, new Redeemer.Redeemer({ tag: "mint", index: 0n, data, exUnits })])
      })
      expect(Transaction.toCBORHexWithFormat(extended, format)).toBe(
        txHex(
          `a204${witnessDatumsHex([decodedHex, Data.toCBORHex(data)])}` +
            `05a282000082${decodedHex}${exUnitsHex}82010082${Data.toCBORHex(data)}${exUnitsHex}`
        )
      )
    }
  })
})

describe("the schemas round trip", () => {
  const ws = new TransactionWitnessSet.TransactionWitnessSet({ plutusData: [5n, ...datums], redeemers: redeemerMap })

  it("bytes written by toCBORBytes decode back to the witness set", () => {
    const bytes = TransactionWitnessSet.toCBORBytes(ws)
    expect(TransactionWitnessSet.fromCBORBytes(bytes)).toStrictEqual(ws)
    expect(Schema.decodeSync(TransactionWitnessSet.FromCBORBytes())(bytes)).toStrictEqual(ws)
  })

  it("the bytes schemas round trip", () => {
    const wsSchema = TransactionWitnessSet.FromCBORBytes()
    expect(Schema.decodeSync(wsSchema)(Schema.encodeSync(wsSchema)(ws))).toStrictEqual(ws)
    const redeemerSchema = Redeemer.FromCBORBytes()
    expect(Schema.decodeSync(redeemerSchema)(Schema.encodeSync(redeemerSchema)(redeemerList[0]))).toStrictEqual(
      redeemerList[0]
    )
    const mapSchema = Redeemers.FromCBORBytesMap()
    expect(Schema.decodeSync(mapSchema)(Schema.encodeSync(mapSchema)(redeemerMap))).toStrictEqual(redeemerMap)
    const arraySchema = Redeemers.FromCBORBytes()
    expect(Schema.decodeSync(arraySchema)(Schema.encodeSync(arraySchema)(redeemerArray))).toStrictEqual(redeemerArray)
  })
})
