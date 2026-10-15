import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"
import * as DRep from "../src/DRep.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { Evaluator } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type { EvalRedeemer } from "../src/sdk/EvalRedeemer.js"
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as VotingProcedures from "../src/VotingProcedures.js"
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
// never executed — only its hash (the credential / voter identity) and its
// presence in the witness set matter.
// always_succeed V3 script hash: a2492486ed656e3fb854a2c240cf16055216c38ec94d166a533c5820
const plutusScript = new PlutusV3.PlutusV3({
  bytes: Bytes.fromHex(
    plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")!.compiledCode
  )
})
const scriptCredential = ScriptHash.fromScript(plutusScript)

// A key hash that sorts BEFORE the script hash bytewise (0x11… < 0xa249…), so
// hash-only ordering and ledger Ord (ScriptHashObj before KeyHashObj) disagree.
const lowKeyHash = new KeyHash.KeyHash({ hash: new Uint8Array(28).fill(0x11) })
// A key hash that sorts AFTER the script hash bytewise (0xee… > 0xa249…), so
// both orderings agree — the control direction.
const highKeyHash = new KeyHash.KeyHash({ hash: new Uint8Array(28).fill(0xee) })

const unitsFor = (tag: string, index: number) => ({
  mem: 10_000n + BigInt(index),
  steps: 5_000_000n + BigInt(index)
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

const govActionId = new GovernanceAction.GovActionId({
  transactionId: new TransactionHash.TransactionHash({ hash: new Uint8Array(32).fill(0xcd) }),
  govActionIndex: 0n
})
const yesProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })

const proceduresFor = (voters: Array<VotingProcedures.Voter>) =>
  new VotingProcedures.VotingProcedures({
    procedures: new Map(voters.map((v) => [v, new Map([[govActionId, yesProcedure]])] as const))
  })

describe("TxBuilder redeemer indices follow ledger Ord (type-first, #404)", () => {
  it("places a script-credential withdrawal redeemer at index 0 ahead of a lower-hash key withdrawal", async () => {
    const { evaluator, seen } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .withdraw({ stakeCredential: lowKeyHash, amount: 1_000_000n })
      .withdraw({ stakeCredential: scriptCredential, amount: 2_000_000n, redeemer: Data.constr(0n, []) })
      .attachScript({ script: plutusScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(tx.body.withdrawals?.withdrawals.size).toBe(2)
    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("reward")
    // Ledger Ord Credential: ScriptHashObj sorts before KeyHashObj, so the
    // script withdrawal is at position 0 even though its hash is larger.
    expect(redeemers[0]!.index).toBe(0n)
    expect(redeemers[0]!.exUnits.mem).toBe(unitsFor("reward", 0).mem)
    expect(redeemers[0]!.exUnits.steps).toBe(unitsFor("reward", 0).steps)
    expect(seen.flat().some((r) => r.redeemer_tag === "reward" && r.redeemer_index === 0)).toBe(true)
  })

  it("keeps a script-credential withdrawal redeemer at index 0 when its hash is also the lower one (control)", async () => {
    const { evaluator } = makeEchoEvaluator()

    const tx = await makeTxBuilder(baseConfig)
      .withdraw({ stakeCredential: scriptCredential, amount: 2_000_000n, redeemer: Data.constr(0n, []) })
      .withdraw({ stakeCredential: highKeyHash, amount: 1_000_000n })
      .attachScript({ script: plutusScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(tx.body.withdrawals?.withdrawals.size).toBe(2)
    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("reward")
    expect(redeemers[0]!.index).toBe(0n)
    expect(redeemers[0]!.exUnits.mem).toBe(unitsFor("reward", 0).mem)
  })

  it("places a script DRep vote redeemer at index 0 ahead of a lower-hash key DRep voter", async () => {
    const { evaluator, seen } = makeEchoEvaluator()

    const scriptVoter = new VotingProcedures.DRepVoter({ drep: DRep.fromScriptHash(scriptCredential) })
    const keyVoter = new VotingProcedures.DRepVoter({ drep: DRep.fromKeyHash(lowKeyHash) })

    const tx = await makeTxBuilder(baseConfig)
      .vote({ votingProcedures: proceduresFor([keyVoter, scriptVoter]), redeemer: Data.constr(0n, []) })
      .attachScript({ script: plutusScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(tx.body.votingProcedures?.procedures.size).toBe(2)
    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("vote")
    expect(redeemers[0]!.index).toBe(0n)
    expect(redeemers[0]!.exUnits.mem).toBe(unitsFor("vote", 0).mem)
    expect(redeemers[0]!.exUnits.steps).toBe(unitsFor("vote", 0).steps)
    expect(seen.flat().some((r) => r.redeemer_tag === "vote" && r.redeemer_index === 0)).toBe(true)
  })

  it("places a script committee vote redeemer at index 0 ahead of a lower-hash key committee voter", async () => {
    const { evaluator } = makeEchoEvaluator()

    const scriptVoter = new VotingProcedures.ConstitutionalCommitteeVoter({ credential: scriptCredential })
    const keyVoter = new VotingProcedures.ConstitutionalCommitteeVoter({ credential: lowKeyHash })

    const tx = await makeTxBuilder(baseConfig)
      .vote({ votingProcedures: proceduresFor([keyVoter, scriptVoter]), redeemer: Data.constr(0n, []) })
      .attachScript({ script: plutusScript })
      .build(buildOptions(evaluator))
      .then((b) => b.toTransaction())

    expect(tx.body.votingProcedures?.procedures.size).toBe(2)
    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("vote")
    expect(redeemers[0]!.index).toBe(0n)
    expect(redeemers[0]!.exUnits.mem).toBe(unitsFor("vote", 0).mem)
    expect(redeemers[0]!.exUnits.steps).toBe(unitsFor("vote", 0).steps)
  })
})
