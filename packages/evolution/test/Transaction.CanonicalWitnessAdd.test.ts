import { describe, expect, it } from "@effect/vitest"
import { validateTx } from "cardano-hw-interop-lib"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as CostModel from "../src/CostModel.js"
import * as Data from "../src/Data.js"
import * as Ed25519Signature from "../src/Ed25519Signature.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { Evaluator } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { preprod } from "../src/sdk/client/Chain.js"
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as CoreUTxO from "../src/UTxO.js"
import * as VKey from "../src/VKey.js"
import plutusJson from "./spec/plutus.json"

// ---------------------------------------------------------------------------
// A transaction that passes the canonical check cardano-hw-cli runs
// (cardano-hw-interop-lib validateTx) must still pass it after vkey
// witnesses are added, so that a second hardware wallet can witness it.
// The witness set gains key 0 at its ascending position.
// ---------------------------------------------------------------------------

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

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

const validator = plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")
if (!validator) throw new Error("always_succeed.always_succeed.spend not found in plutus.json")
const script = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(validator.compiledCode) })

// Data the default and canonical encodings write differently
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

// A Plutus spend of an inline datum output; its witness set holds keys 5 and 7
const buildPlutusSpend = async (): Promise<Transaction.Transaction> => {
  const scriptUtxo = new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex("c".repeat(64)),
    index: 0n,
    address: new CoreAddress.Address({ networkId: 0, paymentCredential: ScriptHash.fromScript(script) }),
    assets: CoreAssets.fromLovelace(10_000_000n),
    datumOption: new InlineDatum.InlineDatum({ data: Data.int(42n) })
  })
  const walletUtxo = new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex("a".repeat(64)),
    index: 0n,
    address: CoreAddress.fromBech32(CHANGE_ADDRESS),
    assets: CoreAssets.fromLovelace(200_000_000n)
  })
  const built = await makeTxBuilder({ chain: preprod })
    .collectFrom({ inputs: [scriptUtxo], redeemer: datum })
    .attachScript({ script })
    .payToAddress({ address: CoreAddress.fromBech32(CHANGE_ADDRESS), assets: CoreAssets.fromLovelace(5_000_000n) })
    .build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [walletUtxo],
      fullProtocolParameters: PROTOCOL_PARAMS,
      evaluator
    })
  return built.toTransaction()
}

// `tx` with `witnessSet`, encoded canonically under a script data hash over
// the canonical bytes
const canonicalHex = (tx: Transaction.Transaction, witnessSet: TransactionWitnessSet.TransactionWitnessSet): string => {
  const scriptDataHash =
    witnessSet.redeemers === undefined
      ? undefined
      : Redeemers.toScriptDataHash(witnessSet.redeemers, costModels, witnessSet.plutusData, CBOR.TX_CANONICAL_OPTIONS)
  const canonical = new Transaction.Transaction({
    body: new TransactionBody.TransactionBody({ ...tx.body, scriptDataHash }),
    witnessSet,
    isValid: tx.isValid,
    auxiliaryData: tx.auxiliaryData
  })
  return Transaction.toCBORHex(canonical, CBOR.TX_CANONICAL_OPTIONS)
}

const vkeyWitness = (fill: number) =>
  new TransactionWitnessSet.VKeyWitness({
    vkey: VKey.fromBytes(new Uint8Array(32).fill(fill)),
    signature: Ed25519Signature.fromBytes(new Uint8Array(64).fill(fill))
  })
const walletWitnessSetHex = (fill: number): string =>
  TransactionWitnessSet.toCBORHex(TransactionWitnessSet.fromVKeyWitnesses([vkeyWitness(fill)]))

const hwErrors = (hex: string) => validateTx(Buffer.from(hex, "hex"))

// The body and witness set bytes of a transaction with a one byte array header
const parts = (hex: string) => {
  const bytes = Bytes.fromHex(hex)
  const body = Transaction.extractBodyBytes(bytes)
  const start = 1 + body.length
  const { newOffset } = CBOR.decodeItemWithOffset(bytes, start)
  return { body: Bytes.toHex(body), witnessSet: Bytes.toHex(bytes.subarray(start, newOffset)) }
}

const txId = (hex: string): string =>
  TransactionHash.toHex(TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(Bytes.fromHex(hex))))

const witnessSetKeys = (hex: string): Array<bigint> => {
  const ws = CBOR.fromCBORHex(parts(hex).witnessSet)
  if (!(ws instanceof Map)) throw new Error("witness set is not a map")
  return Array.from(ws.keys(), (key) => {
    if (typeof key !== "bigint") throw new Error("witness set key is not an integer")
    return key
  })
}

describe("Transaction.addVKeyWitnessesHex on a canonical transaction", () => {
  it("a Plutus spend with keys 5 and 7 stays canonical after one and two additions", async () => {
    const tx = await buildPlutusSpend()
    const hex = canonicalHex(tx, tx.witnessSet)
    expect(witnessSetKeys(hex)).toStrictEqual([5n, 7n])
    expect(hwErrors(hex)).toStrictEqual([])

    const once = Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex(1))
    expect(witnessSetKeys(once)).toStrictEqual([0n, 5n, 7n])
    expect(hwErrors(once)).toStrictEqual([])
    expect(parts(once).body).toBe(parts(hex).body)
    expect(txId(once)).toBe(txId(hex))
    // The decoded entries keep their bytes; key 0 goes before them
    const vkeyEntry = `00d9010281825820${"01".repeat(32)}5840${"01".repeat(64)}`
    expect(parts(once).witnessSet).toBe(`a3${vkeyEntry}${parts(hex).witnessSet.slice(2)}`)

    const twice = Transaction.addVKeyWitnessesHex(once, walletWitnessSetHex(2))
    expect(witnessSetKeys(twice)).toStrictEqual([0n, 5n, 7n])
    expect(Transaction.fromCBORHex(twice).witnessSet.vkeyWitnesses).toHaveLength(2)
    expect(hwErrors(twice)).toStrictEqual([])
    expect(parts(twice).body).toBe(parts(hex).body)
    expect(txId(twice)).toBe(txId(hex))
  })

  it("a Plutus spend with a witness datum keeps its script data hash", async () => {
    const tx = await buildPlutusSpend()
    const witnessSet = new TransactionWitnessSet.TransactionWitnessSet({ ...tx.witnessSet, plutusData: [datum] })
    const hex = canonicalHex(tx, witnessSet)
    expect(witnessSetKeys(hex)).toStrictEqual([4n, 5n, 7n])
    expect(hwErrors(hex)).toStrictEqual([])

    const signed = Transaction.addVKeyWitnessesHex(
      Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex(1)),
      walletWitnessSetHex(2)
    )
    expect(witnessSetKeys(signed)).toStrictEqual([0n, 4n, 5n, 7n])
    expect(hwErrors(signed)).toStrictEqual([])
    expect(txId(signed)).toBe(txId(hex))
    // The datum and redeemer bytes are those the body's script data hash covers
    const decoded = Transaction.fromCBORHex(signed, CBOR.CANONICAL_OPTIONS)
    expect(
      Redeemers.toScriptDataHash(
        decoded.witnessSet.redeemers!,
        costModels,
        decoded.witnessSet.plutusData,
        CBOR.TX_CANONICAL_OPTIONS
      ).hash
    ).toStrictEqual(decoded.body.scriptDataHash!.hash)
  })

  it("a native script transaction with key 1 stays canonical", async () => {
    const tx = await buildPlutusSpend()
    const nativeScript = NativeScripts.makeScriptPubKey(new Uint8Array(28).fill(0xab))
    const hex = canonicalHex(tx, new TransactionWitnessSet.TransactionWitnessSet({ nativeScripts: [nativeScript] }))
    expect(witnessSetKeys(hex)).toStrictEqual([1n])

    const twice = Transaction.addVKeyWitnessesHex(
      Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex(1)),
      walletWitnessSetHex(2)
    )
    expect(witnessSetKeys(twice)).toStrictEqual([0n, 1n])
    expect(hwErrors(twice)).toStrictEqual([])
    expect(parts(twice).body).toBe(parts(hex).body)
  })

  it("Transaction.addVKeyWitnesses on the decoded transaction writes the same bytes", async () => {
    const tx = await buildPlutusSpend()
    const hex = canonicalHex(tx, tx.witnessSet)
    const added = Transaction.addVKeyWitnesses(Transaction.fromCBORHex(hex), [vkeyWitness(1)])
    expect(Transaction.toCBORHex(added)).toBe(Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex(1)))
  })
})

describe("Transaction.addVKeyWitnessesHex key order", () => {
  it("a default-encoded transaction with keys 1 and 5 gets key 0 first and keeps its id", async () => {
    const tx = await buildPlutusSpend()
    const nativeScript = NativeScripts.makeScriptPubKey(new Uint8Array(28).fill(0xab))
    const hex = Transaction.toCBORHex(
      new Transaction.Transaction({
        ...tx,
        witnessSet: new TransactionWitnessSet.TransactionWitnessSet({
          nativeScripts: [nativeScript],
          redeemers: tx.witnessSet.redeemers
        })
      })
    )
    expect(witnessSetKeys(hex)).toStrictEqual([1n, 5n])

    const signed = Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex(1))
    expect(witnessSetKeys(signed)).toStrictEqual([0n, 1n, 5n])
    expect(parts(signed).body).toBe(parts(hex).body)
    expect(txId(signed)).toBe(txId(hex))
  })

  // Decoded keys out of ascending order keep the added key after them
  const scriptEntry = "07d901028146450101002499"
  it.each([
    ["with a redeemer", `a2${scriptEntry}05a18200008200820101`],
    ["with a native script", `a2${scriptEntry}01d9010281820181820400`]
  ])("a witness set with keys 7 and another %s keeps key 0 last", async (_, witnessSetHex) => {
    const bodyHex = parts(canonicalHex(await buildPlutusSpend(), TransactionWitnessSet.empty())).body
    const hex = `84${bodyHex}${witnessSetHex}f5f6`
    const signed = Transaction.addVKeyWitnessesHex(hex, walletWitnessSetHex(1))
    const vkeyEntry = `00d9010281825820${"01".repeat(32)}5840${"01".repeat(64)}`
    expect(parts(signed).witnessSet).toBe(`a3${witnessSetHex.slice(2)}${vkeyEntry}`)
    expect(parts(signed).body).toBe(bodyHex)
  })
})
