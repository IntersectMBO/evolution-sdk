import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"
import * as DRep from "../src/DRep.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { Evaluator } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
import * as Text from "../src/Text.js"
import type * as Transaction from "../src/Transaction.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as VotingProcedures from "../src/VotingProcedures.js"
import plutusJson from "./spec/plutus.json"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

// A Plutus integer is a bigint, so the redeemer Data.int(0n) is 0n, which is
// falsy. Each operation must still treat it as a redeemer.

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

const ZERO = Data.int(0n)

const loadScript = (title: string) =>
  new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(plutusJson.validators.find((v) => v.title === title)!.compiledCode) })

// Reports fixed ExUnits for every redeemer in the transaction
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
  (tx.witnessSet.redeemers?.toArray() ?? []).map((r) => ({ tag: r.tag, data: r.data }))

describe("TxBuilder redeemer Data.int(0n)", () => {
  it("collectFrom spends a script UTxO with it", async () => {
    const script = loadScript("always_succeed.always_succeed.spend")
    const scriptAddress = new CoreAddress.Address({ networkId: 0, paymentCredential: ScriptHash.fromScript(script) })
    const scriptUtxo = createCoreTestUtxo({
      transactionId: "c".repeat(64),
      index: 0n,
      address: CoreAddress.toBech32(scriptAddress),
      lovelace: 10_000_000n
    })

    const tx = await makeTxBuilder({ chain: mainnet })
      .collectFrom({ inputs: [scriptUtxo], redeemer: ZERO })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(redeemersOf(tx)).toEqual([{ tag: "spend", data: 0n }])
  })

  it("mintAssets mints under a Plutus policy with it", async () => {
    const script = loadScript("simple_mint.simple_mint.mint")
    const unit = ScriptHash.toHex(ScriptHash.fromScript(script)) + Text.toHex("Token")

    const tx = await makeTxBuilder({ chain: mainnet })
      .mintAssets({ assets: CoreAssets.fromRecord({ [unit]: 1n }), redeemer: ZERO })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(redeemersOf(tx)).toEqual([{ tag: "mint", data: 0n }])
  })

  it("withdraw takes rewards from a script credential with it", async () => {
    const script = loadScript("simple_mint.simple_mint.withdraw")

    const tx = await makeTxBuilder({ chain: mainnet })
      .withdraw({ stakeCredential: ScriptHash.fromScript(script), amount: 0n, redeemer: ZERO })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(redeemersOf(tx)).toEqual([{ tag: "reward", data: 0n }])
  })

  it("registerDRep registers a script DRep with it", async () => {
    const script = loadScript("governance_voting.always_yes_drep.publish")

    const tx = await makeTxBuilder({ chain: mainnet })
      .registerDRep({ drepCredential: ScriptHash.fromScript(script), redeemer: ZERO })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(redeemersOf(tx)).toEqual([{ tag: "cert", data: 0n }])
  })

  it("vote casts a script DRep's vote with it", async () => {
    const script = loadScript("governance_voting.always_yes_drep.vote")
    const voter = new VotingProcedures.DRepVoter({ drep: DRep.fromScriptHash(ScriptHash.fromScript(script)) })
    const govActionId = new GovernanceAction.GovActionId({
      transactionId: new TransactionHash.TransactionHash({ hash: new Uint8Array(32).fill(0xcd) }),
      govActionIndex: 0n
    })
    const procedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })

    const tx = await makeTxBuilder({ chain: mainnet })
      .vote({ votingProcedures: VotingProcedures.singleVote(voter, govActionId, procedure), redeemer: ZERO })
      .attachScript({ script })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(redeemersOf(tx)).toEqual([{ tag: "vote", data: 0n }])
  })
})
