import { blake2b } from "@noble/hashes/blake2.js"
import { Effect } from "effect"

import * as CoreAddress from "../../src/Address.js"
import * as CoreAssets from "../../src/Assets.js"
import * as Bytes from "../../src/Bytes.js"
import type * as CBOR from "../../src/CBOR.js"
import * as Data from "../../src/Data.js"
import * as InlineDatum from "../../src/InlineDatum.js"
import * as PlutusV3 from "../../src/PlutusV3.js"
import * as Redeemer from "../../src/Redeemer.js"
import * as ScriptHash from "../../src/ScriptHash.js"
import type { SignBuilder } from "../../src/sdk/builders/SignBuilder.js"
import { type Evaluator, makeTxBuilder } from "../../src/sdk/builders/TransactionBuilder.js"
import { preprod } from "../../src/sdk/client/index.js"
import { seedWallet } from "../../src/sdk/client/internal/Wallets.js"
import type { ProtocolParameters, Provider } from "../../src/sdk/provider/Provider.js"
import * as Transaction from "../../src/Transaction.js"
import * as TransactionHash from "../../src/TransactionHash.js"
import type * as TransactionMetadatum from "../../src/TransactionMetadatum.js"
import * as CoreUTxO from "../../src/UTxO.js"
import plutusJson from "../spec/plutus.json"

export const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

const v3Costs: Record<string, number> = {}
for (let i = 0; i < 30; i++) v3Costs[`c${i}`] = 1000 + i * 7

export const FULL_PP = {
  minFeeA: 44,
  minFeeB: 155_381,
  maxTxSize: 16_384,
  maxValSize: 5_000,
  keyDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  govActionDeposit: 100_000_000_000n,
  priceMem: 0.0577,
  priceStep: 0.0000721,
  maxTxExMem: 14_000_000n,
  maxTxExSteps: 10_000_000_000n,
  coinsPerUtxoByte: 4_310n,
  collateralPercentage: 150,
  maxCollateralInputs: 3,
  minFeeRefScriptCostPerByte: 15,
  costModels: { PlutusV1: {}, PlutusV2: {}, PlutusV3: v3Costs }
} satisfies ProtocolParameters

const script = (title: string) => {
  const validator = plutusJson.validators.find((v) => v.title === title)
  if (validator === undefined) throw new Error(`missing validator ${title}`)
  return new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(validator.compiledCode) })
}

export const spendScript = script("always_succeed.always_succeed.spend")
export const mintScripts = [script("simple_mint.simple_mint.mint"), script("mint.mint_policy.mint")]

export const wallet = seedWallet({ mnemonic: MNEMONIC })(preprod)
export const walletAddress = await Effect.runPromise(wallet.effect.address())

export const digest = (bytes: Uint8Array): string => Bytes.toHex(blake2b(bytes, { dkLen: 32 }))
export const bodyId = (txBytes: Uint8Array): string => digest(Transaction.extractBodyBytes(txBytes))

/** A seeded generator, so a case list is the same on every run. */
export const makeRandom = (seed: number) => {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const hex = (length: number) => Array.from({ length }, () => int(0, 255).toString(16).padStart(2, "0")).join("")
  return { next, int, hex }
}

type Random = ReturnType<typeof makeRandom>

/**
 * Random Plutus data with lists and maps, which the default and the
 * canonical options write differently. Map keys are distinct byte strings
 * shorter than 24 bytes, so both canonical sort orders agree on them.
 */
export const randomData = (random: Random, depth: number): Data.Data => {
  switch (random.int(0, depth > 0 ? 4 : 1)) {
    case 0:
      return Data.int(BigInt(random.int(-1_000_000, 1_000_000)))
    case 1:
      return Data.bytearray(random.hex(random.int(0, 32)))
    case 2:
      return Data.list(Array.from({ length: random.int(1, 3) }, () => randomData(random, depth - 1)))
    case 3: {
      const keys = new Set<string>()
      while (keys.size < random.int(1, 3)) keys.add(random.hex(random.int(1, 8)))
      return Data.map([...keys].map((key) => [Data.bytearray(key), randomData(random, depth - 1)]))
    }
    default:
      return Data.constr(
        BigInt(random.int(0, 8)),
        Array.from({ length: random.int(1, 3) }, () => randomData(random, depth - 1))
      )
  }
}

const randomMetadata = (random: Random): TransactionMetadatum.TransactionMetadatum =>
  new Map<TransactionMetadatum.TransactionMetadatum, TransactionMetadatum.TransactionMetadatum>([
    ["msg", Array.from({ length: random.int(1, 3) }, () => random.hex(random.int(1, 10)))],
    ["n", BigInt(random.int(0, 100_000))]
  ])

export type BuildCase = {
  readonly payments: ReadonlyArray<{ readonly lovelace: bigint; readonly datum?: Data.Data }>
  readonly spend?: { readonly datum: Data.Data; readonly redeemer: Data.Data }
  readonly mints: ReadonlyArray<{ readonly script: number; readonly amount: bigint; readonly redeemer: Data.Data }>
  readonly metadata?: TransactionMetadatum.TransactionMetadatum
}

const randomCase = (random: Random, kind: number): BuildCase => {
  const feature = (k: number) => kind === k || (kind >= 5 && random.next() < 0.5)
  const payments = Array.from({ length: random.int(1, 3) }, (_, i) => ({
    lovelace: BigInt(random.int(2_000_000, 9_000_000)),
    datum: i === 0 && feature(4) ? randomData(random, 3) : undefined
  }))
  const spend = feature(1) ? { datum: randomData(random, 3), redeemer: randomData(random, 2) } : undefined
  const mints = feature(2)
    ? (random.next() < 0.5 ? [0] : [0, 1]).map((s) => ({
        script: s,
        amount: BigInt(random.int(1, 1_000)),
        redeemer: randomData(random, 2)
      }))
    : []
  const metadata = feature(3) ? randomMetadata(random) : undefined
  return { payments, spend, mints, metadata }
}

/**
 * Seeded cases: one payment, one Plutus spend, one mint, one metadata and
 * one inline datum case, then random combinations of them.
 */
export const makeCases = (seed: number, count: number): ReadonlyArray<BuildCase> => {
  const random = makeRandom(seed)
  return Array.from({ length: count }, (_, i) => randomCase(random, i))
}

const policyOf = (s: number) => ScriptHash.toHex(ScriptHash.fromScript(mintScripts[s]!))

export const scriptUtxo = (datum: Data.Data) =>
  new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex("c".repeat(64)),
    index: 0n,
    address: new CoreAddress.Address({ networkId: 0, paymentCredential: ScriptHash.fromScript(spendScript) }),
    assets: CoreAssets.fromLovelace(10_000_000n),
    datumOption: new InlineDatum.InlineDatum({ data: datum })
  })

export const walletUtxos = [
  new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex("a".repeat(64)),
    index: 0n,
    address: walletAddress,
    assets: CoreAssets.fromLovelace(200_000_000n)
  }),
  new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex("b".repeat(64)),
    index: 1n,
    address: walletAddress,
    assets: CoreAssets.fromLovelace(20_000_000n)
  })
]

/** A provider that records the bytes `submitTx` writes, as a provider does. */
export const makeStubProvider = () => {
  const submitted: Array<Uint8Array> = []
  const notImplemented = (name: string) => () => Effect.die(new Error(`StubProvider.${name}`))
  const effect = {
    getProtocolParameters: () => Effect.succeed(FULL_PP),
    getUtxos: notImplemented("getUtxos"),
    getUtxosWithUnit: notImplemented("getUtxosWithUnit"),
    getUtxoByUnit: notImplemented("getUtxoByUnit"),
    getUtxosByOutRef: notImplemented("getUtxosByOutRef"),
    getDelegation: notImplemented("getDelegation"),
    getDatum: notImplemented("getDatum"),
    awaitTx: notImplemented("awaitTx"),
    evaluateTx: notImplemented("evaluateTx"),
    submitTx: (tx: Transaction.Transaction) =>
      Effect.sync(() => {
        const bytes = Transaction.toCBORBytes(tx)
        submitted.push(bytes)
        return TransactionHash.fromHex(bodyId(bytes))
      })
  }
  const provider = { effect } as unknown as Provider
  return { provider, submitted }
}

/** An evaluator that records the bytes it is given, as the UPLC evaluators write them. */
export const makeStubEvaluator = () => {
  const evaluated: Array<Uint8Array> = []
  const evaluator: Evaluator = {
    evaluate: (tx) =>
      Effect.sync(() => {
        evaluated.push(Transaction.toCBORBytes(tx))
        return (tx.witnessSet.redeemers?.toArray() ?? []).map((r) => ({
          redeemer_tag: r.tag,
          redeemer_index: Number(r.index),
          ex_units: new Redeemer.ExUnits({ mem: 100_000n + r.index, steps: 50_000_000n + r.index })
        }))
      })
  }
  return { evaluator, evaluated }
}

export const buildCase = (
  c: BuildCase,
  provider: Provider,
  evaluator: Evaluator,
  codecOptions: CBOR.TxCodecOptions | CBOR.CodecOptions | undefined
): Promise<SignBuilder> => {
  let builder = makeTxBuilder({ chain: preprod, wallet, provider })
  if (c.spend !== undefined) {
    builder = builder
      .collectFrom({ inputs: [scriptUtxo(c.spend.datum)], redeemer: c.spend.redeemer })
      .attachScript({ script: spendScript })
  }
  for (const mint of c.mints) {
    builder = builder.attachScript({ script: mintScripts[mint.script]! }).mintAssets({
      assets: CoreAssets.fromRecord({ [policyOf(mint.script) + "41"]: mint.amount }),
      redeemer: mint.redeemer
    })
  }
  for (const payment of c.payments) {
    builder = builder.payToAddress({
      address: walletAddress,
      assets: CoreAssets.fromLovelace(payment.lovelace),
      datum: payment.datum === undefined ? undefined : new InlineDatum.InlineDatum({ data: payment.datum })
    })
  }
  if (c.metadata !== undefined) builder = builder.attachMetadata({ label: 674n, metadata: c.metadata })
  return builder.build({
    changeAddress: walletAddress,
    availableUtxos: walletUtxos,
    fullProtocolParameters: FULL_PP,
    evaluator,
    codecOptions
  })
}

/** What a default build must keep: bytes, ids, fees, chain hash and signatures. */
export const defaultBuildRecord = async (
  c: BuildCase,
  codecOptions: CBOR.TxCodecOptions | CBOR.CodecOptions | undefined
) => {
  const { provider, submitted } = makeStubProvider()
  const { evaluator } = makeStubEvaluator()
  const built = await buildCase(c, provider, evaluator, codecOptions)
  const tx = Transaction.toCBORBytes(await built.toTransaction())
  const fake = Transaction.toCBORBytes(await built.toTransactionWithFakeWitnesses())
  await (await built.sign()).submit()
  const partial = await built.partialSign()
  await (await built.assemble([partial])).submit()
  return {
    tx: digest(tx),
    fake: digest(fake),
    txId: bodyId(tx),
    fee: (await built.estimateFee()).toString(),
    chainTxHash: built.chainResult().txHash,
    signed: digest(submitted[0]!),
    assembled: digest(submitted[1]!)
  }
}
