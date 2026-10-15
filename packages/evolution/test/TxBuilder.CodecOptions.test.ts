import { describe, expect, it } from "@effect/vitest"
import { blake2b } from "@noble/hashes/blake2.js"
import * as Interop from "cardano-hw-interop-lib"
import { Effect } from "effect"

import * as CoreAssets from "../src/Assets.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as CostModel from "../src/CostModel.js"
import * as Redeemers from "../src/Redeemers.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { preprod } from "../src/sdk/client/index.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as TxOut from "../src/TxOut.js"
import * as CoreUTxO from "../src/UTxO.js"
import * as VKey from "../src/VKey.js"
import golden from "./golden/build-codec-default.golden.json"
import {
  bodyId,
  type BuildCase,
  buildCase,
  defaultBuildRecord,
  digest,
  FULL_PP,
  makeCases,
  makeStubEvaluator,
  makeStubProvider,
  wallet,
  walletAddress,
  walletUtxos
} from "./utils/codec-build-helpers.js"

// The goldens were recorded before the build option existed
const CASES = makeCases(585, golden.length)
const PLUTUS_CASES = CASES.filter((c) => c.spend !== undefined || c.mints.length > 0)

const costModels = new CostModel.CostModels({
  PlutusV1: new CostModel.CostModel({ costs: [] }),
  PlutusV2: new CostModel.CostModel({ costs: [] }),
  PlutusV3: new CostModel.CostModel({ costs: Object.values(FULL_PP.costModels.PlutusV3).map(BigInt) })
})

// Byte spans of the items of the array, or the keys and values of the map,
// that starts at `start`
const itemSpans = (bytes: Uint8Array, start: number): Array<Uint8Array> => {
  const info = bytes[start]! & 0x1f
  if (info === 31) {
    // Indefinite length: items up to the break byte
    const spans: Array<Uint8Array> = []
    let offset = start + 1
    while (bytes[offset] !== 0xff) {
      const { newOffset } = CBOR.decodeItemWithOffset(bytes, offset)
      spans.push(bytes.subarray(offset, newOffset))
      offset = newOffset
    }
    return spans
  }
  expect(info).toBeLessThan(28)
  const extra = info < 24 ? 0 : 2 ** (info - 24)
  let length = info < 24 ? info : 0
  for (let i = 1; i <= extra; i++) length = length * 256 + bytes[start + i]!
  const count = bytes[start]! >> 5 === 5 ? 2 * length : length
  const spans: Array<Uint8Array> = []
  let offset = start + 1 + extra
  for (let i = 0; i < count; i++) {
    const { newOffset } = CBOR.decodeItemWithOffset(bytes, offset)
    spans.push(bytes.subarray(offset, newOffset))
    offset = newOffset
  }
  return spans
}

const hex = (bytes: Uint8Array) => Bytes.toHex(bytes)
const concat = (...parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/**
 * Checks bytes written for a canonical build: they are the encoding of their
 * own content, the body hashes cover the written witness set and auxiliary
 * data, and the fee covers the size of `sizedBytes`.
 */
const checkWritten = (bytes: Uint8Array, options: CBOR.TxCodecOptions | CBOR.CodecOptions, sizedBytes = bytes) => {
  const decoded = Transaction.fromCBORBytes(bytes, CBOR.CANONICAL_OPTIONS)
  expect(hex(Transaction.toCBORBytes(decoded, options))).toBe(hex(bytes))

  const [, witnessSetBytes, , auxBytes] = itemSpans(bytes, 0)
  const entries = itemSpans(witnessSetBytes!, 0)
  const field = (key: number) => {
    const i = entries.findIndex((k, j) => j % 2 === 0 && k.length === 1 && k[0] === key)
    return i < 0 ? undefined : entries[i + 1]
  }
  const redeemers = field(5)
  const body = decoded.body
  if (redeemers !== undefined) {
    // The hash the ledger computes over the written redeemers and datums
    const datums = field(4)
    const ledgerHash = blake2b(
      concat(redeemers, datums ?? new Uint8Array(), CostModel.languageViewsEncoding(costModels)),
      { dkLen: 32 }
    )
    expect(hex(body.scriptDataHash!.hash)).toBe(hex(ledgerHash))
    const ws = decoded.witnessSet
    expect(hex(body.scriptDataHash!.hash)).toBe(
      hex(Redeemers.toScriptDataHash(ws.redeemers!, costModels, ws.plutusData, options).hash)
    )
  } else {
    expect(body.scriptDataHash).toBeUndefined()
  }
  if (auxBytes![0] !== 0xf6) {
    expect(hex(body.auxiliaryDataHash!.bytes)).toBe(hex(blake2b(auxBytes!, { dkLen: 32 })))
  }

  let mem = 0
  let steps = 0
  for (const r of decoded.witnessSet.redeemers?.toArray() ?? []) {
    mem += Number(r.exUnits.mem)
    steps += Number(r.exUnits.steps)
  }
  const minFee =
    FULL_PP.minFeeA * sizedBytes.length +
    FULL_PP.minFeeB +
    Math.ceil(FULL_PP.priceMem * mem + FULL_PP.priceStep * steps)
  expect(body.fee >= BigInt(minFee)).toBe(true)
  return decoded
}

// Every vkey witness signs blake2b over the written body bytes
const checkSignatures = (bytes: Uint8Array) => {
  const message = blake2b(Transaction.extractBodyBytes(bytes), { dkLen: 32 })
  const witnesses = Transaction.fromCBORBytes(bytes, CBOR.CANONICAL_OPTIONS).witnessSet.vkeyWitnesses ?? []
  expect(witnesses.length).toBeGreaterThan(0)
  for (const w of witnesses) expect(VKey.verify(w.vkey, message, w.signature.bytes)).toBe(true)
}

const runCanonical = async (c: BuildCase, options: CBOR.TxCodecOptions | CBOR.CodecOptions) => {
  const { provider, submitted } = makeStubProvider()
  const { evaluated, evaluator } = makeStubEvaluator()
  const built = await buildCase(c, provider, evaluator, options)
  const builtBytes = Transaction.toCBORBytes(await built.toTransaction())
  const fakeBytes = Transaction.toCBORBytes(await built.toTransactionWithFakeWitnesses())

  await (await built.sign()).submit()
  const partial = await built.partialSign()
  await (await built.assemble([partial])).submit()
  // signWithWitness replaces the witness set, so it is given the whole set
  const tx = await built.toTransaction()
  const full = new TransactionWitnessSet.TransactionWitnessSet({ ...tx.witnessSet, vkeyWitnesses: partial.vkeyWitnesses })
  await (await built.signWithWitness(full)).submit()

  return { built, builtBytes, evaluated, fakeBytes, submitted }
}

// A canonical build whose bytes differ from the default build of the same case
const changedBuild = async () => {
  for (let i = 0; i < CASES.length; i++) {
    const record = await runCanonical(CASES[i]!, CBOR.TX_CANONICAL_OPTIONS)
    if (digest(record.builtBytes) !== golden[i]!.tx) return record
  }
  throw new Error("no case changes under canonical options")
}

describe("BuildOptions.codecOptions: default options", () => {
  const variants = [
    ["undefined", undefined],
    ["TX_DEFAULT_OPTIONS", CBOR.TX_DEFAULT_OPTIONS],
    ["CML_DEFAULT_OPTIONS", CBOR.CML_DEFAULT_OPTIONS]
  ] as const

  for (const [name, options] of variants) {
    it(`${name} gives the bytes, ids, fees, chain hashes and signatures recorded on main`, async () => {
      expect(CASES.some((c) => c.spend !== undefined)).toBe(true)
      expect(CASES.some((c) => c.mints.length > 0)).toBe(true)
      expect(CASES.some((c) => c.metadata !== undefined)).toBe(true)
      expect(CASES.some((c) => c.payments.some((p) => p.datum !== undefined))).toBe(true)
      for (let i = 0; i < CASES.length; i++) {
        expect(await defaultBuildRecord(CASES[i]!, options)).toEqual(golden[i])
      }
    })
  }
})

describe("BuildOptions.codecOptions: canonical options", () => {
  const variants = [
    ["TX_CANONICAL_OPTIONS", CBOR.TX_CANONICAL_OPTIONS],
    ["CANONICAL_OPTIONS", CBOR.CANONICAL_OPTIONS]
  ] as const

  for (const [name, options] of variants) {
    it(`${name}: built, evaluated, signed and submitted bytes carry hashes over their own encoding`, async () => {
      for (const c of CASES) {
        const { built, builtBytes, evaluated, fakeBytes, submitted } = await runCanonical(c, options)

        checkWritten(builtBytes, options, fakeBytes)
        // The fake witness set only sizes the transaction
        const fake = Transaction.fromCBORBytes(fakeBytes, CBOR.CANONICAL_OPTIONS)
        expect(hex(Transaction.toCBORBytes(fake, options))).toBe(hex(fakeBytes))
        for (const bytes of evaluated) checkWritten(bytes, options)

        expect(submitted).toHaveLength(3)
        for (const bytes of submitted) {
          checkWritten(bytes, options)
          expect(bodyId(bytes)).toBe(bodyId(builtBytes))
          expect(built.chainResult().txHash).toBe(bodyId(bytes))
          checkSignatures(bytes)
        }
      }
    })
  }

  it("changes the bytes of builds whose content the default writes differently", async () => {
    const changed: Array<number> = []
    for (let i = 0; i < CASES.length; i++) {
      const { builtBytes } = await runCanonical(CASES[i]!, CBOR.TX_CANONICAL_OPTIONS)
      if (digest(builtBytes) !== golden[i]!.tx) changed.push(i)
    }
    expect(changed.length).toBeGreaterThan(CASES.length / 2)
  })

  it("passes validateTx of cardano-hw-interop-lib for Plutus builds, built and signed", async () => {
    expect(PLUTUS_CASES.length).toBeGreaterThan(4)
    for (const c of PLUTUS_CASES) {
      const { builtBytes, submitted } = await runCanonical(c, CBOR.TX_CANONICAL_OPTIONS)
      for (const bytes of [builtBytes, ...submitted]) expect(Interop.validateTx(Buffer.from(bytes))).toEqual([])
    }
  })
})

describe("BuildOptions.codecOptions: minimum UTxO", () => {
  it("gives unfracked change outputs the minimum UTxO of their written size", async () => {
    // Indefinite arrays and maps write an output with tokens larger than the default does
    const options = CBOR.CML_DATA_DEFAULT_OPTIONS
    const utxo = new CoreUTxO.UTxO({
      transactionId: TransactionHash.fromHex("d".repeat(64)),
      index: 0n,
      address: walletAddress,
      assets: CoreAssets.fromRecord({
        lovelace: 300_000_000n,
        ["e".repeat(56) + "41"]: 1_000n,
        ["f".repeat(56) + "01"]: 1n,
        ["f".repeat(56) + "02"]: 1n
      })
    })
    const { provider } = makeStubProvider()
    const built = await makeTxBuilder({ chain: preprod, wallet, provider })
      .payToAddress({ address: walletAddress, assets: CoreAssets.fromLovelace(5_000_000n) })
      .build({
        changeAddress: walletAddress,
        availableUtxos: [utxo],
        fullProtocolParameters: FULL_PP,
        codecOptions: options,
        unfrack: {}
      })
    const tx = await built.toTransaction()
    const bytes = Transaction.toCBORBytes(tx)
    expect(hex(bytes)).toBe(hex(Transaction.toCBORBytes(tx, options)))

    // The output bytes as the transaction writes them
    const [bodyBytes] = itemSpans(bytes, 0)
    const entries = itemSpans(bodyBytes!, 0)
    const outputsAt = entries.findIndex((k, j) => j % 2 === 0 && k.length === 1 && k[0] === 1)
    const written = itemSpans(entries[outputsAt + 1]!, 0)
    expect(written).toHaveLength(tx.body.outputs.length)

    const minimum = (size: number) => FULL_PP.coinsPerUtxoByte * (160n + BigInt(size))
    let bundles = 0
    tx.body.outputs.forEach((output, i) => {
      const size = written[i]!.length
      expect(hex(written[i]!)).toBe(hex(TxOut.toCBORBytes(output, options)))
      expect(output.assets.lovelace >= minimum(size)).toBe(true)
      if (!CoreAssets.hasOnlyLovelace(output.assets)) {
        // A bundle holds exactly its minimum, which a size from the default encoding misses
        bundles++
        expect(output.assets.lovelace).toBe(minimum(size))
        expect(TxOut.toCBORBytes(output).length).toBeLessThan(size)
      }
    })
    expect(bundles).toBe(2)
  })
})

describe("Transaction.withCodecOptions", () => {
  it("encodes with the recorded options when none are passed, after explicit options and the decoded format", async () => {
    const { builtBytes } = await changedBuild()
    const tx = Transaction.fromCBORBytes(builtBytes, CBOR.CANONICAL_OPTIONS)
    const canonical = hex(Transaction.toCBORBytes(tx, CBOR.TX_CANONICAL_OPTIONS))
    const plain = Transaction.toCBORHex(tx)
    expect(plain).not.toBe(canonical)

    const recorded = Transaction.withCodecOptions(tx, CBOR.CANONICAL_OPTIONS)
    expect(recorded).toBe(tx)
    expect(Transaction.toCBORHex(tx)).toBe(canonical)
    expect(hex(Transaction.toCBORBytes(tx))).toBe(canonical)
    expect(Transaction.toCBORHex(tx, CBOR.TX_DEFAULT_OPTIONS)).toBe(canonical)
    // Explicit non-default options win
    const custom = CBOR.toTxCodecOptions(CBOR.CML_DEFAULT_OPTIONS)
    expect(Transaction.toCBORHex(tx, custom)).toBe(plain)

    // The format captured on decode wins over recorded options
    const decoded = Transaction.fromCBORHex(plain)
    Transaction.withCodecOptions(decoded, CBOR.TX_CANONICAL_OPTIONS)
    expect(Transaction.toCBORHex(decoded)).toBe(plain)

    // addVKeyWitnesses keeps the recorded options
    const partial = await Effect.runPromise(wallet.effect.signTx(tx, { utxos: walletUtxos }))
    const withWitness = Transaction.addVKeyWitnesses(tx, partial.vkeyWitnesses ?? [])
    expect(Transaction.toCBORHex(withWitness)).toBe(Transaction.toCBORHex(withWitness, CBOR.TX_CANONICAL_OPTIONS))
  })
})

describe("seed wallet signTx with a decoded Transaction", () => {
  it("signs the body bytes the transaction was decoded from", async () => {
    const record = await runCanonical(PLUTUS_CASES[0]!, CBOR.TX_CANONICAL_OPTIONS)
    // A valid encoding the default encoder does not write: indefinite arrays
    const indefinite: CBOR.CodecOptions = {
      mode: "custom",
      useIndefiniteArrays: true,
      useIndefiniteMaps: false,
      useDefiniteForEmpty: true,
      sortMapKeys: false,
      useMinimalEncoding: true
    }
    const original = Transaction.toCBORBytes(
      Transaction.fromCBORBytes(record.builtBytes, CBOR.CANONICAL_OPTIONS),
      indefinite
    )
    const tx = Transaction.fromCBORBytes(original)
    const bodyBytes = Transaction.extractBodyBytes(original)
    expect(hex(bodyBytes)).not.toBe(hex(Transaction.extractBodyBytes(Transaction.toCBORBytes(tx, CBOR.TX_CANONICAL_OPTIONS))))

    const ws = await Effect.runPromise(wallet.effect.signTx(tx, { utxos: walletUtxos }))
    const message = blake2b(bodyBytes, { dkLen: 32 })
    expect(ws.vkeyWitnesses?.length).toBeGreaterThan(0)
    for (const w of ws.vkeyWitnesses ?? []) expect(VKey.verify(w.vkey, message, w.signature.bytes)).toBe(true)
  })
})
