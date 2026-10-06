import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as RewardAccount from "../src/RewardAccount.js"
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

const guardrailScript = new PlutusV3.PlutusV3({
  bytes: Bytes.fromHex(
    plutusJson.validators.find((v) => v.title === "governance_guardrail.always_yes_guardrail.propose")!.compiledCode
  )
})
const guardrailHash = ScriptHash.fromScript(guardrailScript)

const rewardAccount = new RewardAccount.RewardAccount({
  networkId: 1,
  stakeCredential: new ScriptHash.ScriptHash({ hash: new Uint8Array(28).fill(0xab) })
})

const treasuryWithdrawal = (policyHash: ScriptHash.ScriptHash | null) =>
  new GovernanceAction.TreasuryWithdrawalsAction({
    withdrawals: new Map([[rewardAccount, 1_000_000n]]),
    policyHash
  })

const EX_UNITS = { mem: 12_345n, steps: 6_789_000n }

// Reports fixed ExUnits for every redeemer in the transaction, so the test can
// check that results are mapped back to the right proposal.
const makeEchoEvaluator = () => {
  const seen: Array<Array<EvalRedeemer>> = []
  const evaluator: Evaluator = {
    evaluate: (tx) =>
      Effect.sync(() => {
        const redeemers = tx.witnessSet.redeemers?.toArray() ?? []
        const results = redeemers.map((r) => ({
          redeemer_tag: r.tag,
          redeemer_index: Number(r.index),
          ex_units: new Redeemer.ExUnits(EX_UNITS)
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

describe("TxBuilder propose with guardrail script", () => {
  it("adds a propose redeemer, the guardrail script and evaluated ExUnits", async () => {
    const { evaluator, seen } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .propose({
        governanceAction: treasuryWithdrawal(guardrailHash),
        rewardAccount,
        anchor: null,
        redeemer: Data.constr(0n, [])
      })
      .attachScript({ script: guardrailScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(seen.length).toBeGreaterThan(0)
    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("propose")
    expect(redeemers[0]!.index).toBe(0n)
    expect(redeemers[0]!.exUnits.mem).toBe(EX_UNITS.mem)
    expect(redeemers[0]!.exUnits.steps).toBe(EX_UNITS.steps)
    expect(tx.witnessSet.plutusV3Scripts?.length).toBe(1)
    expect(tx.body.scriptDataHash).toBeDefined()
    expect(tx.body.collateralInputs?.length ?? 0).toBeGreaterThan(0)
    expect(tx.body.proposalProcedures?.procedures).toHaveLength(1)
  })

  it("indexes the redeemer by the proposal's position", async () => {
    const { evaluator } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .propose({ governanceAction: new GovernanceAction.InfoAction({}), rewardAccount, anchor: null })
      .propose({
        governanceAction: treasuryWithdrawal(guardrailHash),
        rewardAccount,
        anchor: null,
        redeemer: Data.constr(0n, []),
        label: "guardrail"
      })
      .attachScript({ script: guardrailScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    const procedures = tx.body.proposalProcedures!.procedures
    expect(procedures).toHaveLength(2)
    expect(procedures[1]!.governanceAction._tag).toBe("TreasuryWithdrawalsAction")

    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("propose")
    expect(redeemers[0]!.index).toBe(1n)
  })

  it("builds proposals without a policyHash as before (no redeemer, no script data)", async () => {
    const tx = await makeTxBuilder(baseConfig)
      .propose({ governanceAction: treasuryWithdrawal(null), rewardAccount, anchor: null })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(tx.witnessSet.redeemers).toBeUndefined()
    expect(tx.body.scriptDataHash).toBeUndefined()
  })

  it("rejects a guardrail-checked proposal without a redeemer", async () => {
    await expect(
      makeTxBuilder(baseConfig)
        .propose({ governanceAction: treasuryWithdrawal(guardrailHash), rewardAccount, anchor: null })
        .attachScript({ script: guardrailScript })
        .build(buildOptions())
    ).rejects.toThrow(/[Rr]edeemer required/)
  })

  it("rejects a redeemer for a proposal that runs no guardrail script", async () => {
    await expect(
      makeTxBuilder(baseConfig)
        .propose({
          governanceAction: new GovernanceAction.InfoAction({}),
          rewardAccount,
          anchor: null,
          redeemer: Data.constr(0n, [])
        })
        .build(buildOptions())
    ).rejects.toThrow(/without a guardrail policyHash/)
  })

  it("drops a redeemer supplied for a native-script guardrail", async () => {
    const nativeGuardrail = NativeScripts.makeScriptNOfK(1n, [
      NativeScripts.makeScriptPubKey(new Uint8Array(28).fill(0xcc)).script
    ])
    const nativeHash = ScriptHash.fromScript(nativeGuardrail)

    const tx = await makeTxBuilder(baseConfig)
      .propose({
        governanceAction: treasuryWithdrawal(nativeHash),
        rewardAccount,
        anchor: null,
        redeemer: Data.constr(0n, [])
      })
      .attachScript({ script: nativeGuardrail })
      .build(buildOptions())
      .then((b) => b.toTransaction())

    expect(tx.witnessSet.redeemers).toBeUndefined()
    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
  })
})
