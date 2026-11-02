import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { Evaluator } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
import * as Text from "../src/Text.js"
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

const loadScript = (title: string) =>
  new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(plutusJson.validators.find((v) => v.title === title)!.compiledCode) })

const script = loadScript("simple_mint.simple_mint.mint")
const unit = ScriptHash.toHex(ScriptHash.fromScript(script)) + Text.toHex("Token")
const emptyUnit =
  ScriptHash.toHex(ScriptHash.fromScript(loadScript("always_succeed.always_succeed.spend"))) + Text.toHex("Token")
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

describe("TxBuilder mint policy with nothing to mint", () => {
  it("takes no redeemer for a policy whose amounts are all zero", async () => {
    const tx = await makeTxBuilder({ chain: mainnet })
      .mintAssets({ assets: CoreAssets.fromRecord({ [unit]: 1n, [emptyUnit]: 0n }), redeemer })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(tx.body.mint?.map.size).toBe(1)
    expect(redeemersOf(tx)).toEqual([{ tag: "mint", index: 0n }])
  })
})
