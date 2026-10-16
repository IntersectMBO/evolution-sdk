import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as BootstrapWitness from "../src/BootstrapWitness.js"
import * as Bytes from "../src/Bytes.js"
import * as CostModel from "../src/CostModel.js"
import * as Data from "../src/Data.js"
import * as Ed25519Signature from "../src/Ed25519Signature.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"
import * as ScriptDataHash from "../src/ScriptDataHash.js"
import * as ScriptHash from "../src/ScriptHash.js"
import { makeSignBuilder } from "../src/sdk/builders/SignBuilderImpl.js"
import type { Evaluator } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { preprod } from "../src/sdk/client/Chain.js"
import { seedWallet } from "../src/sdk/client/internal/Wallets.js"
import type { ProtocolParameters, Provider } from "../src/sdk/provider/Provider.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as CoreUTxO from "../src/UTxO.js"
import * as VKey from "../src/VKey.js"
import plutusJson from "./spec/plutus.json"

const MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

const v3Costs: Record<string, number> = {}
for (let i = 0; i < 30; i++) v3Costs[`c${i}`] = 1000 + i * 7

const PROTOCOL_PARAMS = {
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

const costModels = new CostModel.CostModels({
  PlutusV1: new CostModel.CostModel({ costs: [] }),
  PlutusV2: new CostModel.CostModel({ costs: [] }),
  PlutusV3: new CostModel.CostModel({ costs: Object.values(v3Costs).map((v) => BigInt(v)) })
})

const compiledCode = (title: string): string => {
  const validator = plutusJson.validators.find((v) => v.title === title)
  if (!validator) throw new Error(`${title} not found in plutus.json`)
  return validator.compiledCode
}
const script = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(compiledCode("always_succeed.always_succeed.spend")) })
const otherScript = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(compiledCode("simple_mint.simple_mint.mint")) })
const scriptAddress = new CoreAddress.Address({ networkId: 0, paymentCredential: ScriptHash.fromScript(script) })

const datum = Data.constr(0n, [Data.map([[Data.int(1n), Data.int(2n)]]), Data.list([Data.int(3n)])])

const evaluator: Evaluator = {
  evaluate: (tx) =>
    Effect.sync(() =>
      (tx.witnessSet.redeemers?.toArray() ?? []).map((r) => ({
        redeemer_tag: r.tag,
        redeemer_index: Number(r.index),
        ex_units: new Redeemer.ExUnits({ mem: 100_000n, steps: 50_000_000n })
      }))
    )
}

// A provider that records what it is asked to submit
const makeCapturingProvider = () => {
  const submitted: Array<Transaction.Transaction> = []
  const effect = {
    submitTx: (tx: Transaction.Transaction) =>
      Effect.sync(() => {
        submitted.push(tx)
        return TransactionBody.toHash(tx.body)
      })
  }
  const provider = { effect } as unknown as Provider
  return { provider, submitted }
}

// A Plutus spend of an inline datum output, built by a builder with a seed
// wallet; its witness set holds the script and the redeemer
const buildPlutusSpend = async () => {
  const wallet = seedWallet({ mnemonic: MNEMONIC, addressType: "Base" })(preprod)
  const walletAddress = await wallet.address()
  const walletUtxos = [
    new CoreUTxO.UTxO({
      transactionId: TransactionHash.fromHex("a".repeat(64)),
      index: 0n,
      address: walletAddress,
      assets: CoreAssets.fromLovelace(200_000_000n)
    })
  ]
  const scriptUtxo = new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex("c".repeat(64)),
    index: 0n,
    address: scriptAddress,
    assets: CoreAssets.fromLovelace(10_000_000n),
    datumOption: new InlineDatum.InlineDatum({ data: Data.int(42n) })
  })
  const capture = makeCapturingProvider()
  const signBuilder = await makeTxBuilder({ chain: preprod, wallet, provider: capture.provider })
    .collectFrom({ inputs: [scriptUtxo], redeemer: datum })
    .attachScript({ script })
    .payToAddress({ address: walletAddress, assets: CoreAssets.fromLovelace(5_000_000n) })
    .build({ availableUtxos: walletUtxos, fullProtocolParameters: PROTOCOL_PARAMS, evaluator })
  return { capture, signBuilder, utxos: [...walletUtxos, scriptUtxo], wallet }
}

// The built transaction with a witness datum, under a script data hash that covers it
const withWitnessDatum = (tx: Transaction.Transaction): Transaction.Transaction =>
  new Transaction.Transaction({
    body: new TransactionBody.TransactionBody({
      ...tx.body,
      scriptDataHash: Redeemers.toScriptDataHash(tx.witnessSet.redeemers!, costModels, [datum])
    }),
    witnessSet: new TransactionWitnessSet.TransactionWitnessSet({ ...tx.witnessSet, plutusData: [datum] }),
    isValid: tx.isValid,
    auxiliaryData: tx.auxiliaryData
  })

// A sign builder around `transaction`, as build() makes one
const signBuilderFor = async (transaction: Transaction.Transaction) => {
  const { capture, utxos, wallet } = await buildPlutusSpend()
  const signBuilder = makeSignBuilder({
    transaction,
    transactionWithFakeWitnesses: transaction,
    fee: transaction.body.fee,
    utxos,
    referenceUtxos: [],
    provider: capture.provider,
    wallet,
    outputs: [],
    availableUtxos: []
  })
  return { capture, signBuilder }
}

const witnessSetHex = (ws: TransactionWitnessSet.TransactionWitnessSet): string => TransactionWitnessSet.toCBORHex(ws)

// The transaction's own witness set with `vkeyWitnesses` added
const expectedWitnessSet = (
  tx: Transaction.Transaction,
  vkeyWitnesses: ReadonlyArray<TransactionWitnessSet.VKeyWitness>
): TransactionWitnessSet.TransactionWitnessSet =>
  new TransactionWitnessSet.TransactionWitnessSet({
    ...tx.witnessSet,
    vkeyWitnesses: [...(tx.witnessSet.vkeyWitnesses ?? []), ...vkeyWitnesses]
  })

// The script data hash of the redeemers and datums the submitted bytes hold
const scriptDataHashOfBytes = (tx: Transaction.Transaction): string => {
  const decoded = Transaction.fromCBORHex(Transaction.toCBORHex(tx))
  return ScriptDataHash.toHex(
    Redeemers.toScriptDataHash(decoded.witnessSet.redeemers!, costModels, decoded.witnessSet.plutusData)
  )
}

const fakeVKeyWitness = (fill: number) =>
  new TransactionWitnessSet.VKeyWitness({
    vkey: VKey.fromBytes(new Uint8Array(32).fill(fill)),
    signature: Ed25519Signature.fromBytes(new Uint8Array(64).fill(fill))
  })

describe("SignBuilder.signWithWitness", () => {
  it("keeps the script and redeemer of a built Plutus spend signed with vkey witnesses only", async () => {
    const { capture, signBuilder } = await buildPlutusSpend()
    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.plutusV3Scripts).toHaveLength(1)
    expect(tx.witnessSet.redeemers?.size).toBe(1)

    // The wallet's vkey witnesses alone, as a hardware wallet returns them
    const walletWitnesses = (await signBuilder.partialSign()).vkeyWitnesses ?? []
    expect(walletWitnesses).toHaveLength(1)
    const submitBuilder = await signBuilder.signWithWitness(TransactionWitnessSet.fromVKeyWitnesses([...walletWitnesses]))
    await submitBuilder.submit()

    const [signed] = capture.submitted
    expect(TransactionHash.toHex(TransactionBody.toHash(signed.body))).toBe(
      TransactionHash.toHex(TransactionBody.toHash(tx.body))
    )
    expect(witnessSetHex(signed.witnessSet)).toBe(witnessSetHex(expectedWitnessSet(tx, walletWitnesses)))
    expect(witnessSetHex(submitBuilder.witnessSet)).toBe(witnessSetHex(signed.witnessSet))
    expect(scriptDataHashOfBytes(signed)).toBe(ScriptDataHash.toHex(tx.body.scriptDataHash!))
  })

  it("keeps the scripts, datums and redeemers the transaction holds", async () => {
    const built = await (await buildPlutusSpend()).signBuilder.toTransaction()
    const tx = withWitnessDatum(built)
    const { capture, signBuilder } = await signBuilderFor(tx)

    const walletWitnesses = (await signBuilder.partialSign()).vkeyWitnesses ?? []
    expect(walletWitnesses).toHaveLength(1)
    await (await signBuilder.signWithWitness(TransactionWitnessSet.fromVKeyWitnesses([...walletWitnesses]))).submit()

    const [signed] = capture.submitted
    expect(signed.witnessSet.plutusData).toHaveLength(1)
    expect(signed.witnessSet.plutusV3Scripts).toHaveLength(1)
    expect(signed.witnessSet.redeemers?.size).toBe(1)
    expect(witnessSetHex(signed.witnessSet)).toBe(witnessSetHex(expectedWitnessSet(tx, walletWitnesses)))
    expect(scriptDataHashOfBytes(signed)).toBe(ScriptDataHash.toHex(tx.body.scriptDataHash!))
  })

  it("adds a vkey witness once when the set repeats it", async () => {
    const tx = await (await buildPlutusSpend()).signBuilder.toTransaction()
    const { capture, signBuilder } = await signBuilderFor(tx)
    const a = fakeVKeyWitness(1)
    const b = fakeVKeyWitness(2)

    await (await signBuilder.signWithWitness(TransactionWitnessSet.fromVKeyWitnesses([a, b, a]))).submit()

    expect(witnessSetHex(capture.submitted[0].witnessSet)).toBe(witnessSetHex(expectedWitnessSet(tx, [a, b])))
  })

  it("does not add a vkey witness the transaction already holds", async () => {
    const built = await (await buildPlutusSpend()).signBuilder.toTransaction()
    const held = fakeVKeyWitness(1)
    const tx = new Transaction.Transaction({
      ...built,
      witnessSet: new TransactionWitnessSet.TransactionWitnessSet({ ...built.witnessSet, vkeyWitnesses: [held] })
    })
    const { capture, signBuilder } = await signBuilderFor(tx)
    const added = fakeVKeyWitness(2)

    await (await signBuilder.signWithWitness(TransactionWitnessSet.fromVKeyWitnesses([fakeVKeyWitness(1), added]))).submit()

    const vkeys = capture.submitted[0].witnessSet.vkeyWitnesses ?? []
    expect(vkeys.map((w) => VKey.toHex(w.vkey))).toStrictEqual([VKey.toHex(held.vkey), VKey.toHex(added.vkey)])
  })

  it("adds bootstrap witnesses and ignores the scripts, datums and redeemers of the given set", async () => {
    const tx = withWitnessDatum(await (await buildPlutusSpend()).signBuilder.toTransaction())
    const { capture, signBuilder } = await signBuilderFor(tx)
    const vkeyWitness = fakeVKeyWitness(3)
    const bootstrapWitness = new BootstrapWitness.BootstrapWitness({
      publicKey: VKey.fromBytes(new Uint8Array(32).fill(4)),
      signature: Ed25519Signature.fromBytes(new Uint8Array(64).fill(5)),
      chainCode: new Uint8Array(32).fill(6),
      attributes: new Uint8Array([0xa0])
    })
    const otherRedeemers = Redeemers.makeRedeemerMap([
      new Redeemer.Redeemer({
        tag: "spend",
        index: 0n,
        data: Data.int(7n),
        exUnits: new Redeemer.ExUnits({ mem: 1n, steps: 1n })
      })
    ])

    await (
      await signBuilder.signWithWitness(
        new TransactionWitnessSet.TransactionWitnessSet({
          vkeyWitnesses: [vkeyWitness],
          bootstrapWitnesses: [bootstrapWitness],
          plutusV3Scripts: [otherScript],
          plutusData: [Data.int(8n)],
          redeemers: otherRedeemers
        })
      )
    ).submit()

    const expected = new TransactionWitnessSet.TransactionWitnessSet({
      ...tx.witnessSet,
      vkeyWitnesses: [vkeyWitness],
      bootstrapWitnesses: [bootstrapWitness]
    })
    expect(witnessSetHex(capture.submitted[0].witnessSet)).toBe(witnessSetHex(expected))
  })
})
