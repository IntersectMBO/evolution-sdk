import { blake2b } from "@noble/hashes/blake2.js"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as CostModel from "../src/CostModel.js"
import * as Data from "../src/Data.js"
import * as DatumHash from "../src/DatumHash.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as OriginalBytes from "../src/OriginalBytes.js"
import * as ScriptHash from "../src/ScriptHash.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { preprod } from "../src/sdk/client/index.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as CoreUTxO from "../src/UTxO.js"
import {
  fetchedDatum as fetched,
  FULL_PP,
  makeStubEvaluator,
  makeStubProvider,
  spendScript,
  wallet,
  walletAddress,
  walletUtxos
} from "./utils/codec-build-helpers.js"

const hex = Bytes.toHex
const hashHex = (bytes: Uint8Array) => hex(blake2b(bytes, { dkLen: 32 }))
const datumHashOf = (datumHex: string) =>
  new DatumHash.DatumHash({ hash: blake2b(Bytes.fromHex(datumHex), { dkLen: 32 }) })

const scriptAddress = new CoreAddress.Address({ networkId: 0, paymentCredential: ScriptHash.fromScript(spendScript) })

const lockedUtxo = (datumHex: string, index = 0n, address = scriptAddress) =>
  new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex("c".repeat(64)),
    index,
    address,
    assets: CoreAssets.fromLovelace(10_000_000n),
    datumOption: datumHashOf(datumHex)
  })

const costModels = new CostModel.CostModels({
  PlutusV1: new CostModel.CostModel({ costs: [] }),
  PlutusV2: new CostModel.CostModel({ costs: [] }),
  PlutusV3: new CostModel.CostModel({ costs: Object.values(FULL_PP.costModels.PlutusV3).map(BigInt) })
})

// Byte spans of the entries of the CBOR map or array at `start`
const itemSpans = (bytes: Uint8Array, start: number): Array<Uint8Array> => {
  const info = bytes[start]! & 0x1f
  const spans: Array<Uint8Array> = []
  if (info === 31) {
    let offset = start + 1
    while (bytes[offset] !== 0xff) {
      const { newOffset } = CBOR.decodeItemWithOffset(bytes, offset)
      spans.push(bytes.subarray(offset, newOffset))
      offset = newOffset
    }
    return spans
  }
  const extra = info < 24 ? 0 : 2 ** (info - 24)
  let length = info < 24 ? info : 0
  for (let i = 1; i <= extra; i++) length = length * 256 + bytes[start + i]!
  const count = bytes[start]! >> 5 === 5 ? 2 * length : length
  let offset = start + 1 + extra
  for (let i = 0; i < count; i++) {
    const { newOffset } = CBOR.decodeItemWithOffset(bytes, offset)
    spans.push(bytes.subarray(offset, newOffset))
    offset = newOffset
  }
  return spans
}

// The datum set and redeemers of a written transaction, and the script data
// hash the ledger computes over them
const writtenWitnessData = (txBytes: Uint8Array) => {
  const [, witnessSetBytes] = itemSpans(txBytes, 0)
  const entries = itemSpans(witnessSetBytes!, 0)
  const field = (key: number) => {
    const i = entries.findIndex((k, j) => j % 2 === 0 && k.length === 1 && k[0] === key)
    return i < 0 ? undefined : entries[i + 1]
  }
  const datums = field(4)
  const redeemers = field(5)!
  const parts = [redeemers, datums ?? new Uint8Array(), CostModel.languageViewsEncoding(costModels)]
  const payload = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    payload.set(p, offset)
    offset += p.length
  }
  return { datums: datums === undefined ? undefined : hex(datums), scriptDataHash: hashHex(payload) }
}

const recordedHex = (datum: Data.Data) => {
  const bytes = typeof datum === "bigint" ? undefined : OriginalBytes.get(datum)
  return bytes === undefined ? undefined : hex(bytes)
}

type BuildArgs = {
  readonly inputs: ReadonlyArray<CoreUTxO.UTxO>
  readonly datums?: ReadonlyArray<Data.Data>
  readonly codecOptions?: CBOR.TxCodecOptions | CBOR.CodecOptions
  readonly onMissingDatum?: "error" | "provider"
  readonly served?: Readonly<Record<string, string>>
  readonly referenceInputs?: ReadonlyArray<CoreUTxO.UTxO>
}

const build = ({ codecOptions, datums, inputs, onMissingDatum, referenceInputs, served }: BuildArgs) => {
  const { datumRequests, provider, submitted } = makeStubProvider(served)
  const { evaluated, evaluator } = makeStubEvaluator()
  const builder = makeTxBuilder({ chain: preprod, wallet, provider })
  const withReferences = referenceInputs === undefined ? builder : builder.readFrom({ referenceInputs })
  const built = withReferences
    .collectFrom({ inputs, redeemer: Data.constr(0n, []), datums })
    .attachScript({ script: spendScript })
    .payToAddress({ address: walletAddress, assets: CoreAssets.fromLovelace(2_000_000n) })
    .build({
      changeAddress: walletAddress,
      availableUtxos: walletUtxos,
      fullProtocolParameters: FULL_PP,
      evaluator,
      codecOptions,
      onMissingDatum
    })
  return { built, datumRequests, evaluated, submitted }
}

// Datums as other tools write them; the builder writes none of them this way
const layouts: ReadonlyArray<readonly [string, string]> = [
  ["node layout", "d8799fa101029f03ffff"],
  ["definite", "d87982a101028103"],
  ["indefinite map", "d8799fbf0102ff9f03ffff"],
  ["chunked bytes over 64", `d8799f5f5840${"ab".repeat(64)}46${"ab".repeat(6)}ffff`],
  ["bytes chunked 1 then 64", `5f41225840${"11".repeat(64)}ff`],
  ["non-minimal lengths", "d87998011801"],
  ["bare definite list", "820102"],
  ["bare indefinite map", "bf0102ff"],
  ["bare bytes", "43010203"],
  ["bare integer", "182a"]
]

const optionSets: ReadonlyArray<readonly [string, CBOR.TxCodecOptions | undefined]> = [
  ["default", undefined],
  ["canonical", CBOR.TX_CANONICAL_OPTIONS],
  ["hw-cli", CBOR.TX_HW_CLI_OPTIONS]
]

// The datum set is written byte for byte in the built, fake-witness,
// evaluated and submitted transactions, the script data hash covers it, and
// the fee covers it
const expectWrittenEverywhere = async (args: BuildArgs, datumHex: string) => {
  const datumSet = `d9010281${datumHex}`
  const { built, evaluated, submitted } = build(args)
  const result = await built
  const tx = Transaction.toCBORBytes(await result.toTransaction())
  const fake = Transaction.toCBORBytes(await result.toTransactionWithFakeWitnesses())
  await (await result.sign()).submit()
  await (await result.assemble([await result.partialSign()])).submit()

  expect(evaluated.length).toBeGreaterThan(0)
  for (const bytes of [tx, fake, ...evaluated, ...submitted]) {
    expect(writtenWitnessData(bytes).datums).toBe(datumSet)
  }
  const { body } = await result.toTransaction()
  expect(hex(body.scriptDataHash!.hash)).toBe(writtenWitnessData(tx).scriptDataHash)
  expect(body.fee >= BigInt(FULL_PP.minFeeA * fake.length + FULL_PP.minFeeB)).toBe(true)
  expect(submitted).toHaveLength(2)
}

describe("spending a datum hash output with collectFrom datums", () => {
  it.each(layouts)("a fetched %s datum is written with its own bytes everywhere", async (_, datumHex) => {
    await expectWrittenEverywhere({ inputs: [lockedUtxo(datumHex)], datums: [fetched(datumHex)] }, datumHex)
  })

  it.each(optionSets.slice(1))("a fetched datum keeps its own bytes under %s options", async (_, codecOptions) => {
    const datumHex = "d8799fbf0102ff9f03ffff"
    await expectWrittenEverywhere(
      { inputs: [lockedUtxo(datumHex)], datums: [fetched(datumHex)], codecOptions },
      datumHex
    )
  })

  it("a new datum is written with the build's plutusData options", async () => {
    const datum = Data.constr(0n, [Data.map([[1n, 2n]]), Data.list([3n])])
    for (const [, codecOptions] of optionSets.slice(0, 2)) {
      const datumHex = Data.toCBORHex(datum, CBOR.toTxCodecOptions(codecOptions ?? CBOR.TX_DEFAULT_OPTIONS).plutusData)
      const result = await build({ inputs: [lockedUtxo(datumHex)], datums: [datum], codecOptions }).built
      const tx = Transaction.toCBORBytes(await result.toTransaction())
      expect(writtenWitnessData(tx).datums).toBe(`d9010281${datumHex}`)
    }
  })

  it("two inputs under one datum hash take the datum once", async () => {
    const datumHex = "d87982a101028103"
    const result = await build({
      inputs: [lockedUtxo(datumHex, 0n), lockedUtxo(datumHex, 1n)],
      datums: [fetched(datumHex)]
    }).built
    const tx = Transaction.toCBORBytes(await result.toTransaction())
    expect(writtenWitnessData(tx).datums).toBe(`d9010281${datumHex}`)
  })

  it("fails before selection when an input's datum is not given, and names both ways to give it", async () => {
    const utxo = lockedUtxo("d87982a101028103")
    const { built, datumRequests } = build({ inputs: [utxo] })
    const message = await built.then(
      () => "built",
      (error: unknown) => String(error)
    )
    expect(message).toContain(`Datum required for 1 input(s) that hold a datum hash: ${CoreUTxO.toOutRefString(utxo)}`)
    expect(message).toContain("collectFrom({ datums })")
    expect(message).toContain('onMissingDatum: "provider"')
    expect(datumRequests).toHaveLength(0)
  })

  it("fails when a hand-built datum has other bytes than the hash covers", async () => {
    // The definite layout is locked; the build writes the node layout
    const datum = Data.constr(0n, [Data.map([[1n, 2n]]), Data.list([3n])])
    await expect(build({ inputs: [lockedUtxo("d87982a101028103")], datums: [datum] }).built).rejects.toThrow(
      "hash to none of them: a datum built by hand must be in the layout its hash covers"
    )
  })

  it("a bare integer datum with non-minimal bytes cannot keep them, and the build says so", async () => {
    // 5 written as 1805: a bigint has no object to record bytes against
    await expect(build({ inputs: [lockedUtxo("1805")], datums: [fetched("1805")] }).built).rejects.toThrow(
      "hash to none of them"
    )
  })

  it("fails when a datum is given for a key-address input", async () => {
    const { provider } = makeStubProvider()
    await expect(
      makeTxBuilder({ chain: preprod, wallet, provider })
        .collectFrom({ inputs: [lockedUtxo("d87980", 0n, walletAddress)], datums: [fetched("d87980")] })
        .payToAddress({ address: walletAddress, assets: CoreAssets.fromLovelace(2_000_000n) })
        .build({ changeAddress: walletAddress, availableUtxos: walletUtxos, fullProtocolParameters: FULL_PP })
    ).rejects.toThrow("NotAllowedSupplementalDatums")
  })

  it("fails with a builder limit, not a ledger rule, for the datum of a reference input", async () => {
    const spentHex = "d87982a101028103"
    const referenceHex = "d87981182a"
    await expect(
      build({
        inputs: [lockedUtxo(spentHex)],
        datums: [fetched(spentHex), fetched(referenceHex)],
        referenceInputs: [lockedUtxo(referenceHex, 7n, walletAddress)]
      }).built
    ).rejects.toThrow(
      `Datum(s) ${hex(datumHashOf(referenceHex).hash)} given to collectFrom belong to an output or a reference input`
    )
  })

  it("gives no datum to a native script input that holds a datum hash, and refuses one", async () => {
    const nativeScript = NativeScripts.makeScriptPubKey(new Uint8Array(28).fill(0xaa))
    const nativeAddress = new CoreAddress.Address({
      networkId: 0,
      paymentCredential: ScriptHash.fromScript(nativeScript)
    })
    const utxo = lockedUtxo("d87980", 0n, nativeAddress)
    const spend = (datums?: ReadonlyArray<Data.Data>) => {
      const { datumRequests, provider } = makeStubProvider()
      const built = makeTxBuilder({ chain: preprod, wallet, provider })
        .attachScript({ script: nativeScript })
        .collectFrom({ inputs: [utxo], datums })
        .payToAddress({ address: walletAddress, assets: CoreAssets.fromLovelace(2_000_000n) })
        .build({
          changeAddress: walletAddress,
          availableUtxos: walletUtxos,
          fullProtocolParameters: FULL_PP,
          onMissingDatum: "provider"
        })
      return { built, datumRequests }
    }
    const { built, datumRequests } = spend()
    expect((await (await built).toTransaction()).witnessSet.plutusData ?? []).toHaveLength(0)
    expect(datumRequests).toHaveLength(0)
    await expect(spend([fetched("d87980")]).built).rejects.toThrow("NotAllowedSupplementalDatums")
  })

  it("assemble writes the datum once when a given witness set carries it too", async () => {
    const datumHex = "d87982a101028103"
    const { built, submitted } = build({ inputs: [lockedUtxo(datumHex)], datums: [fetched(datumHex)] })
    const result = await built
    await (await result.assemble([await result.partialSign(), await result.getWitnessSet()])).submit()
    const written = writtenWitnessData(submitted[0]!)
    expect(written.datums).toBe(`d9010281${datumHex}`)
    expect(hex((await result.toTransaction()).body.scriptDataHash!.hash)).toBe(written.scriptDataHash)
  })

  it("fails at assembly when coin selection adds a datum-hash script input", async () => {
    const { provider } = makeStubProvider()
    const { evaluator } = makeStubEvaluator()
    const inline = new CoreUTxO.UTxO({
      transactionId: TransactionHash.fromHex("d".repeat(64)),
      index: 0n,
      address: scriptAddress,
      assets: CoreAssets.fromLovelace(2_000_000n),
      datumOption: new InlineDatum.InlineDatum({ data: Data.int(1n) })
    })
    const hashed = new CoreUTxO.UTxO({
      transactionId: TransactionHash.fromHex("d".repeat(64)),
      index: 1n,
      address: scriptAddress,
      assets: CoreAssets.fromLovelace(900_000_000_000n),
      datumOption: datumHashOf("01")
    })
    const run = makeTxBuilder({ chain: preprod, wallet, provider })
      .collectFrom({ inputs: [inline], redeemer: Data.constr(0n, []) })
      .attachScript({ script: spendScript })
      .payToAddress({ address: walletAddress, assets: CoreAssets.fromLovelace(500_000_000_000n) })
      .build({
        changeAddress: walletAddress,
        availableUtxos: [hashed, ...walletUtxos],
        fullProtocolParameters: FULL_PP,
        evaluator
      })
    await expect(run).rejects.toThrow(/Datum required for 1 input\(s\)/)
  })
})

describe("onMissingDatum: provider", () => {
  for (const [optionsName, codecOptions] of optionSets) {
    it.each(layouts)(`fetches a %s datum and writes its own bytes under ${optionsName} options`, async (_, datumHex) => {
      const datumHash = hex(datumHashOf(datumHex).hash)
      const args: BuildArgs = {
        inputs: [lockedUtxo(datumHex, 0n), lockedUtxo(datumHex, 1n)],
        onMissingDatum: "provider",
        served: { [datumHash]: datumHex },
        codecOptions
      }
      await expectWrittenEverywhere(args, datumHex)
      // Two inputs share the hash: one request
      const { built, datumRequests } = build(args)
      await built
      expect(datumRequests).toStrictEqual([datumHash])
    })
  }

  it("fetches only the datums collectFrom was not given", async () => {
    const givenHex = "d87982a101028103"
    const fetchedHex = "d8799fbf0102ff9f03ffff"
    const fetchedHash = hex(datumHashOf(fetchedHex).hash)
    const { built, datumRequests } = build({
      inputs: [lockedUtxo(givenHex, 0n), lockedUtxo(fetchedHex, 1n)],
      datums: [fetched(givenHex)],
      onMissingDatum: "provider",
      served: { [fetchedHash]: fetchedHex }
    })
    const written = (await (await built).toTransaction()).witnessSet.plutusData ?? []
    expect(datumRequests).toStrictEqual([fetchedHash])
    expect(written.map(recordedHex).sort()).toStrictEqual([givenHex, fetchedHex].sort())
  })

  it("fetches nothing for a key-address input that holds a datum hash", async () => {
    const { datumRequests, provider } = makeStubProvider()
    const sign = await makeTxBuilder({ chain: preprod, wallet, provider })
      .collectFrom({ inputs: [lockedUtxo("05", 0n, walletAddress)] })
      .payToAddress({ address: walletAddress, assets: CoreAssets.fromLovelace(2_000_000n) })
      .build({
        changeAddress: walletAddress,
        availableUtxos: walletUtxos,
        fullProtocolParameters: FULL_PP,
        onMissingDatum: "provider"
      })
    expect(datumRequests).toHaveLength(0)
    expect((await sign.toTransaction()).witnessSet.plutusData ?? []).toHaveLength(0)
  })

  it("fails when the provider has no datum", async () => {
    await expect(
      build({ inputs: [lockedUtxo("d87982a101028103")], onMissingDatum: "provider" }).built
    ).rejects.toThrow("provider.getDatum failed for datum hash")
  })

  it("fails when the fetched datum does not hash to the datum hash", async () => {
    const datumHash = hex(datumHashOf("1805").hash)
    await expect(
      build({ inputs: [lockedUtxo("1805")], onMissingDatum: "provider", served: { [datumHash]: "1805" } }).built
    ).rejects.toThrow(`not to its datum hash ${datumHash}`)
  })

  it("fails when the builder has no provider", async () => {
    const { evaluator } = makeStubEvaluator()
    await expect(
      makeTxBuilder({ chain: preprod, wallet })
        .collectFrom({ inputs: [lockedUtxo("d87982a101028103")], redeemer: Data.constr(0n, []) })
        .attachScript({ script: spendScript })
        .build({
          changeAddress: walletAddress,
          availableUtxos: walletUtxos,
          fullProtocolParameters: FULL_PP,
          evaluator,
          onMissingDatum: "provider"
        })
    ).rejects.toThrow('onMissingDatum: "provider" needs a provider in the builder config')
  })
})

describe("witness set datums", () => {
  it("a witness set built from another keeps each fetched datum's bytes", () => {
    const datumHexes = layouts.map(([, h]) => h)
    const ws = new TransactionWitnessSet.TransactionWitnessSet({ plutusData: datumHexes.map(fetched) })
    const copy = new TransactionWitnessSet.TransactionWitnessSet({ ...ws, vkeyWitnesses: [] })
    for (const set of [ws, copy]) {
      const [, datums] = itemSpans(TransactionWitnessSet.toCBORBytes(set), 0)
      expect(itemSpans(datums!, 3).map(hex)).toStrictEqual(datumHexes)
    }
  })

  it("keeps each datum as the same object, and its Encoded form", () => {
    const map = new Map<Data.Data, Data.Data>([[1n, 2n]])
    const list: ReadonlyArray<Data.Data> = [1n]
    OriginalBytes.record(map, Bytes.fromHex("bf0102ff"))
    const ws = new TransactionWitnessSet.TransactionWitnessSet({ plutusData: [map, list] })
    const again = new TransactionWitnessSet.TransactionWitnessSet({ ...ws })
    expect(again.plutusData![0]).toBe(map)
    expect(again.plutusData![1]).toBe(list)
    expect(Schema.encodeSync(TransactionWitnessSet.TransactionWitnessSet)(ws).plutusData).toEqual([
      [["1", "2"]],
      ["1"]
    ])
    expect(TransactionWitnessSet.toCBORHex(again)).toContain("d9010282bf0102ff")
  })
})
