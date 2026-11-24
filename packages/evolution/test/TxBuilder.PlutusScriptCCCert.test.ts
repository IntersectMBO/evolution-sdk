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
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
import type * as Transaction from "../src/Transaction.js"
import plutusJson from "./spec/plutus.json"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

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
  costModels: {
    PlutusV1: {} as Record<string, number>,
    PlutusV2: {} as Record<string, number>,
    PlutusV3: {} as Record<string, number>
  }
} satisfies ProtocolParameters

const script = new PlutusV3.PlutusV3({
  bytes: Bytes.fromHex(
    plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")!.compiledCode
  )
})
const scriptColdCredential = ScriptHash.fromScript(script)
const keyColdCredential = new KeyHash.KeyHash({ hash: new Uint8Array(28).fill(0x22) })
const hotCredential = new KeyHash.KeyHash({ hash: new Uint8Array(28).fill(0x11) })
const redeemer = Data.constr(0n, [])

const evaluator: Evaluator = {
  evaluate: (tx) =>
    Effect.sync(() =>
      (tx.witnessSet.redeemers?.toArray() ?? []).map((r) => ({
        redeemer_tag: r.tag,
        redeemer_index: Number(r.index),
        ex_units: new Redeemer.ExUnits({ mem: 10_000n, steps: 5_000_000n })
      }))
    )
}

const buildOptions = () => ({
  changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
  availableUtxos: [
    createCoreTestUtxo({ transactionId: "a".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 2_000_000_000n }),
    createCoreTestUtxo({ transactionId: "b".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 20_000_000n })
  ],
  fullProtocolParameters: PROTOCOL_PARAMS,
  evaluator
})

const redeemersOf = (tx: Transaction.Transaction) =>
  (tx.witnessSet.redeemers?.toArray() ?? []).map((r) => ({ tag: r.tag, index: r.index }))

describe("TxBuilder Plutus-script CC certificate", () => {
  it("authorizes a hot credential for a Plutus-script cold credential", async () => {
    const tx = await makeTxBuilder({ chain: mainnet })
      .authCommitteeHot({ coldCredential: scriptColdCredential, hotCredential, redeemer })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(redeemersOf(tx)).toEqual([{ tag: "cert", index: 0n }])
    expect(tx.witnessSet.plutusV3Scripts?.length).toBe(1)
    expect(tx.body.scriptDataHash).toBeDefined()
  })

  it("indexes the redeemer at the committee certificate's own position", async () => {
    const tx = await makeTxBuilder({ chain: mainnet })
      .authCommitteeHot({ coldCredential: keyColdCredential, hotCredential })
      .authCommitteeHot({ coldCredential: scriptColdCredential, hotCredential, redeemer })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(tx.body.certificates?.length).toBe(2)
    expect(redeemersOf(tx)).toEqual([{ tag: "cert", index: 1n }])
  })

  it("resigns a Plutus-script cold credential", async () => {
    const tx = await makeTxBuilder({ chain: mainnet })
      .resignCommitteeCold({ coldCredential: scriptColdCredential, anchor: null, redeemer })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(redeemersOf(tx)).toEqual([{ tag: "cert", index: 0n }])
  })

  it("emits no redeemer for a key-hash cold credential", async () => {
    const tx = await makeTxBuilder({ chain: mainnet })
      .authCommitteeHot({ coldCredential: keyColdCredential, hotCredential, redeemer })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(tx.witnessSet.redeemers).toBeUndefined()
  })
})
