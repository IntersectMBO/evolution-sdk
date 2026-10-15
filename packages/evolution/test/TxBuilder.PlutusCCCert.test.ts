import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { Evaluator } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type { EvalRedeemer } from "../src/sdk/EvalRedeemer.js"
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
import plutusJson from "./spec/plutus.json"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

const FULL_PROTOCOL_PARAMS = {
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
  costModels: {
    PlutusV1: {} as Record<string, number>,
    PlutusV2: {} as Record<string, number>,
    PlutusV3: {} as Record<string, number>
  }
} satisfies ProtocolParameters

const baseConfig = { chain: mainnet }

// Any Plutus V3 script works here: the evaluator is a stub, so the script is
// never executed — only its hash (the committee cold credential) and its
// presence in the witness set matter.
const plutusScript = new PlutusV3.PlutusV3({
  bytes: Bytes.fromHex(
    plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")!.compiledCode
  )
})
const plutusColdCredential = ScriptHash.fromScript(plutusScript)

const hotCredential = new KeyHash.KeyHash({ hash: new Uint8Array(28).fill(0x11) })
const keyColdCredential = new KeyHash.KeyHash({ hash: new Uint8Array(28).fill(0x22) })

// Distinct ExUnits per (tag, index), so tests can tell whether each result was
// mapped back to the right redeemer.
const unitsFor = (tag: string, index: number) => ({
  mem: 10_000n + BigInt(index),
  steps: 5_000_000n + BigInt(index)
})

const makeEchoEvaluator = () => {
  const seen: Array<Array<EvalRedeemer>> = []
  const evaluator: Evaluator = {
    evaluate: (tx) =>
      Effect.sync(() => {
        const redeemers = tx.witnessSet.redeemers?.toArray() ?? []
        const results = redeemers.map((r) => ({
          redeemer_tag: r.tag,
          redeemer_index: Number(r.index),
          ex_units: new Redeemer.ExUnits(unitsFor(r.tag, Number(r.index)))
        }))
        seen.push(results)
        return results
      })
  }
  return { evaluator, seen }
}

const makeUtxos = () => [
  createCoreTestUtxo({ transactionId: "a".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 200_000_000_000n }),
  createCoreTestUtxo({ transactionId: "b".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 20_000_000n })
]

const buildOptions = (evaluator?: Evaluator) => ({
  changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
  availableUtxos: makeUtxos(),
  fullProtocolParameters: FULL_PROTOCOL_PARAMS,
  ...(evaluator ? { evaluator } : {})
})

describe("TxBuilder Plutus CC certificate (script committee cold credential redeemer index)", () => {
  it("emits a cert redeemer at index 0 for a Plutus-script authCommitteeHot", async () => {
    const { evaluator, seen } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .authCommitteeHot({
        coldCredential: plutusColdCredential,
        hotCredential,
        redeemer: Data.constr(0n, [])
      })
      .attachScript({ script: plutusScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(tx.body.certificates?.length).toBe(1)
    expect(tx.body.certificates![0]!._tag).toBe("AuthCommitteeHotCert")

    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("cert")
    expect(redeemers[0]!.index).toBe(0n)
    expect(redeemers[0]!.exUnits.mem).toBe(unitsFor("cert", 0).mem)
    expect(redeemers[0]!.exUnits.steps).toBe(unitsFor("cert", 0).steps)
    expect(seen.flat().some((r) => r.redeemer_tag === "cert" && r.redeemer_index === 0)).toBe(true)
    expect(tx.witnessSet.plutusV3Scripts?.length).toBe(1)
    expect(tx.body.scriptDataHash).toBeDefined()
  })

  it("emits the cert redeemer at the committee certificate's own index, not the first certificate's", async () => {
    const { evaluator } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .authCommitteeHot({ coldCredential: keyColdCredential, hotCredential })
      .authCommitteeHot({
        coldCredential: plutusColdCredential,
        hotCredential,
        redeemer: Data.constr(0n, [])
      })
      .attachScript({ script: plutusScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(tx.body.certificates?.length).toBe(2)

    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("cert")
    expect(redeemers[0]!.index).toBe(1n)
    expect(redeemers[0]!.exUnits.mem).toBe(unitsFor("cert", 1).mem)
    expect(redeemers[0]!.exUnits.steps).toBe(unitsFor("cert", 1).steps)
  })

  it("emits a cert redeemer at index 0 for a Plutus-script resignCommitteeCold", async () => {
    const { evaluator } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .resignCommitteeCold({
        coldCredential: plutusColdCredential,
        anchor: null,
        redeemer: Data.constr(0n, [])
      })
      .attachScript({ script: plutusScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(tx.body.certificates?.length).toBe(1)
    expect(tx.body.certificates![0]!._tag).toBe("ResignCommitteeColdCert")

    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("cert")
    expect(redeemers[0]!.index).toBe(0n)
    expect(redeemers[0]!.exUnits.mem).toBe(unitsFor("cert", 0).mem)
  })

  it("emits no redeemer for a key-hash cold credential, even when one is supplied", async () => {
    const tx = await makeTxBuilder(baseConfig)
      .authCommitteeHot({
        coldCredential: keyColdCredential,
        hotCredential,
        redeemer: Data.constr(0n, [])
      })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(tx.body.certificates?.length).toBe(1)
    expect(tx.witnessSet.redeemers).toBeUndefined()
    expect(tx.body.scriptDataHash).toBeUndefined()
  })
})
