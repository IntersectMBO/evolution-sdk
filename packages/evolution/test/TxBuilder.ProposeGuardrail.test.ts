import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as ProtocolParamUpdate from "../src/ProtocolParamUpdate.js"
import * as Redeemer from "../src/Redeemer.js"
import * as RewardAccount from "../src/RewardAccount.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { Evaluator, ScriptFailure } from "../src/sdk/builders/TransactionBuilder.js"
import { EvaluationError, makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type { EvalRedeemer } from "../src/sdk/EvalRedeemer.js"
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
import * as Text from "../src/Text.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as CoreUTxO from "../src/UTxO.js"
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

const TAG_OFFSET: Record<string, bigint> = { spend: 1n, mint: 2n, cert: 3n, reward: 4n, vote: 5n, propose: 6n }

// Distinct ExUnits per (tag, index), so tests can tell whether each result was
// mapped back to the right redeemer.
const unitsFor = (tag: string, index: number) => ({
  mem: 10_000n + TAG_OFFSET[tag]! * 1_000n + BigInt(index),
  steps: 5_000_000n + TAG_OFFSET[tag]! * 100_000n + BigInt(index)
})

// Reports ExUnits for every redeemer in the transaction
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
    expect(redeemers[0]!.exUnits.mem).toBe(unitsFor("propose", 0).mem)
    expect(redeemers[0]!.exUnits.steps).toBe(unitsFor("propose", 0).steps)
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

const loadScript = (title: string) =>
  new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(plutusJson.validators.find((v) => v.title === title)!.compiledCode) })

const parameterChange = () =>
  new GovernanceAction.ParameterChangeAction({
    govActionId: null,
    protocolParamUpdate: new ProtocolParamUpdate.ProtocolParamUpdate({ maxTxSize: 16_385n }),
    policyHash: guardrailHash
  })

const guardedProposal = (governanceAction: GovernanceAction.GovernanceAction, label?: string) => ({
  governanceAction,
  rewardAccount,
  anchor: null,
  redeemer: Data.constr(0n, []),
  ...(label ? { label } : {})
})

// Walk an error's cause chain and return the first enriched failures list
type ErrorLike = { failures?: ReadonlyArray<ScriptFailure>; cause?: unknown }

const findFailures = (error: unknown): ReadonlyArray<ScriptFailure> | undefined => {
  let current: unknown = error
  for (let depth = 0; typeof current === "object" && current !== null && depth < 10; depth++) {
    const { cause, failures } = current as ErrorLike
    if (Array.isArray(failures)) return failures
    current = cause
  }
  return undefined
}

describe("TxBuilder propose with guardrail script: combinations", () => {
  it("keeps propose and mint redeemers apart in one transaction", async () => {
    const { evaluator } = makeEchoEvaluator()
    const mintScript = loadScript("simple_mint.simple_mint.mint")
    const unit = ScriptHash.toHex(ScriptHash.fromScript(mintScript)) + Text.toHex("Token")

    const tx = await makeTxBuilder(baseConfig)
      .mintAssets({ assets: CoreAssets.fromRecord({ [unit]: 1n }), redeemer: Data.constr(0n, []) })
      .attachScript({ script: mintScript })
      .propose(guardedProposal(treasuryWithdrawal(guardrailHash)))
      .attachScript({ script: guardrailScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers.map((r) => `${r.tag}#${r.index}`).sort()).toEqual(["mint#0", "propose#0"])
    for (const r of redeemers) {
      expect(r.exUnits.mem).toBe(unitsFor(r.tag, Number(r.index)).mem)
      expect(r.exUnits.steps).toBe(unitsFor(r.tag, Number(r.index)).steps)
    }
    expect(tx.witnessSet.plutusV3Scripts?.length).toBe(2)
  })

  it("evaluates two guardrail-checked proposals at indices 0 and 1", async () => {
    const { evaluator } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .propose(guardedProposal(treasuryWithdrawal(guardrailHash)))
      .propose(guardedProposal(parameterChange()))
      .attachScript({ script: guardrailScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    const procedures = tx.body.proposalProcedures!.procedures
    expect(procedures.map((p) => p.governanceAction._tag)).toEqual(["TreasuryWithdrawalsAction", "ParameterChangeAction"])
    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers.map((r) => `${r.tag}#${r.index}`).sort()).toEqual(["propose#0", "propose#1"])
    for (const r of redeemers) expect(r.exUnits.mem).toBe(unitsFor("propose", Number(r.index)).mem)
  })

  it("indexes a proposal added through .compose() by its final position", async () => {
    const { evaluator } = makeEchoEvaluator()
    const guarded = makeTxBuilder(baseConfig)
      .propose(guardedProposal(treasuryWithdrawal(guardrailHash)))
      .attachScript({ script: guardrailScript })

    const tx = await makeTxBuilder(baseConfig)
      .propose({ governanceAction: new GovernanceAction.InfoAction({}), rewardAccount, anchor: null })
      .compose(guarded)
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    const procedures = tx.body.proposalProcedures!.procedures
    const guardedIndex = procedures.findIndex((p) => p.governanceAction._tag === "TreasuryWithdrawalsAction")
    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.index).toBe(BigInt(guardedIndex))
  })

  it("takes the guardrail script from a reference input", async () => {
    const { evaluator } = makeEchoEvaluator()
    const refUtxo = new CoreUTxO.UTxO({
      transactionId: TransactionHash.fromHex("c".repeat(64)),
      index: 0n,
      address: CoreAddress.fromBech32(CHANGE_ADDRESS),
      assets: CoreAssets.fromLovelace(20_000_000n),
      scriptRef: guardrailScript
    })

    const tx = await makeTxBuilder(baseConfig)
      .propose(guardedProposal(treasuryWithdrawal(guardrailHash)))
      .readFrom({ referenceInputs: [refUtxo] })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(tx.witnessSet.plutusV3Scripts?.length ?? 0).toBe(0)
    expect(tx.body.referenceInputs?.length).toBe(1)
    expect(tx.witnessSet.redeemers!.toArray()[0]!.tag).toBe("propose")
  })

  it("accepts a batch redeemer built from collected inputs", async () => {
    const { evaluator } = makeEchoEvaluator()
    const [fundingUtxo] = makeUtxos()

    const tx = await makeTxBuilder(baseConfig)
      .collectFrom({ inputs: [fundingUtxo!] })
      .propose({
        governanceAction: treasuryWithdrawal(guardrailHash),
        rewardAccount,
        anchor: null,
        redeemer: { all: (inputs) => Data.constr(0n, [Data.int(BigInt(inputs[0]!.index))]), inputs: [fundingUtxo!] }
      })
      .attachScript({ script: guardrailScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    const [redeemer] = tx.witnessSet.redeemers!.toArray()
    expect(redeemer!.tag).toBe("propose")
    expect(redeemer!.index).toBe(0n)
    expect(redeemer!.data).toEqual(Data.constr(0n, [Data.int(0n)]))
  })

  it("accepts the integer redeemer 0", async () => {
    const { evaluator } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .propose({
        governanceAction: treasuryWithdrawal(guardrailHash),
        rewardAccount,
        anchor: null,
        redeemer: Data.int(0n)
      })
      .attachScript({ script: guardrailScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    const [redeemer] = tx.witnessSet.redeemers!.toArray()
    expect(redeemer!.tag).toBe("propose")
    expect(redeemer!.data).toBe(0n)
  })

  describe("native guardrail carried by a spent input", () => {
    const nativeGuardrail = NativeScripts.makeScriptNOfK(1n, [
      NativeScripts.makeScriptPubKey(new Uint8Array(28).fill(0xcc)).script
    ])
    const scriptUtxo = new CoreUTxO.UTxO({
      transactionId: TransactionHash.fromHex("d".repeat(64)),
      index: 0n,
      address: CoreAddress.fromBech32(CHANGE_ADDRESS),
      assets: CoreAssets.fromLovelace(20_000_000n),
      scriptRef: nativeGuardrail
    })
    const nativeAction = () => treasuryWithdrawal(ScriptHash.fromScript(nativeGuardrail))

    it("needs no redeemer and sizes the fee for the script's signer", async () => {
      const signBuilder = await makeTxBuilder(baseConfig)
        .collectFrom({ inputs: [scriptUtxo] })
        .propose({ governanceAction: nativeAction(), rewardAccount, anchor: null })
        .build(buildOptions())

      const tx = await signBuilder.toTransaction()
      expect(tx.witnessSet.redeemers).toBeUndefined()

      // The wallet key and the guardrail's own signer both need a vkey witness
      const fakeTx = await signBuilder.toTransactionWithFakeWitnesses()
      expect(fakeTx.witnessSet.vkeyWitnesses?.length ?? 0).toBe(2)
    })

    it("drops a supplied redeemer", async () => {
      const tx = await makeTxBuilder(baseConfig)
        .collectFrom({ inputs: [scriptUtxo] })
        .propose({ governanceAction: nativeAction(), rewardAccount, anchor: null, redeemer: Data.constr(0n, []) })
        .build(buildOptions())
        .then((b) => b.toTransaction())

      expect(tx.witnessSet.redeemers).toBeUndefined()
    })
  })
})

describe("TxBuilder propose with guardrail script: errors", () => {
  it("rejects a self redeemer", async () => {
    await expect(
      makeTxBuilder(baseConfig)
        .propose({
          governanceAction: treasuryWithdrawal(guardrailHash),
          rewardAccount,
          anchor: null,
          redeemer: () => Data.constr(0n, [])
        })
        .attachScript({ script: guardrailScript })
        .build(buildOptions())
    ).rejects.toThrow(/Self redeemers are not supported for proposals/)
  })

  it("rejects a redeemer when the guardrail script is not provided", async () => {
    await expect(
      makeTxBuilder(baseConfig)
        .propose(guardedProposal(treasuryWithdrawal(guardrailHash)))
        .build(buildOptions())
    ).rejects.toThrow(/Guardrail script not provided/)
  })

  it("fails when the evaluator reports a propose index without a redeemer", async () => {
    const evaluator: Evaluator = {
      evaluate: () =>
        Effect.succeed([
          { redeemer_tag: "propose", redeemer_index: 0, ex_units: new Redeemer.ExUnits(unitsFor("propose", 0)) },
          { redeemer_tag: "propose", redeemer_index: 5, ex_units: new Redeemer.ExUnits(unitsFor("propose", 5)) }
        ])
    }

    await expect(
      makeTxBuilder(baseConfig)
        .propose(guardedProposal(treasuryWithdrawal(guardrailHash)))
        .attachScript({ script: guardrailScript })
        .build(buildOptions(evaluator))
    ).rejects.toThrow(/propose result at index 5/)
  })

  it("labels a failing guardrail in the evaluation error", async () => {
    const evaluator: Evaluator = {
      evaluate: () =>
        Effect.fail(
          new EvaluationError({
            message: "guardrail rejected",
            failures: [{ purpose: "propose", index: 1, validationError: "rejected", traces: [] }]
          })
        )
    }

    const error = await makeTxBuilder(baseConfig)
      .propose({ governanceAction: new GovernanceAction.InfoAction({}), rewardAccount, anchor: null })
      .propose(guardedProposal(parameterChange(), "params-guardrail"))
      .attachScript({ script: guardrailScript })
      .build(buildOptions(evaluator))
      .then(
        () => undefined,
        (e: unknown) => e
      )

    const failures = findFailures(error)
    expect(failures?.[0]?.purpose).toBe("propose")
    expect(failures?.[0]?.label).toBe("params-guardrail")
  })
})
