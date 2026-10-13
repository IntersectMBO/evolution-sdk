import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { describe, expect, it } from "vitest"

import * as CostModel from "../src/CostModel.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as Evolution from "../src/index.js"
import * as PoolKeyHash from "../src/PoolKeyHash.js"
import * as Redeemers from "../src/Redeemers.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as UnitInterval from "../src/UnitInterval.js"
import * as VotingProcedures from "../src/VotingProcedures.js"

/**
 * Types that are reachable from the package entry point must be CONSTRUCTIBLE from it, and
 * values that are addressable on their own must have a codec of their own.
 */
describe("public codec surface", () => {
  it("CostModels can be built from the package entry point", () => {
    // `Redeemers.toScriptDataHash` takes a `CostModels`, and `Redeemers` is exported — but the
    // module holding `CostModels` was not, so the function could not be called through the
    // entry point at all. Only the deep subpath worked.
    const costModels = new Evolution.CostModel.CostModels({
      PlutusV1: new Evolution.CostModel.CostModel({ costs: [] }),
      PlutusV2: new Evolution.CostModel.CostModel({ costs: [] }),
      PlutusV3: new Evolution.CostModel.CostModel({ costs: [1n, 2n, 3n] })
    })
    expect(Evolution.CostModel).toBe(CostModel)
    const hash = Redeemers.toScriptDataHash(Redeemers.makeRedeemerMap([]), costModels, undefined)
    expect(Evolution.ScriptDataHash.toHex(hash)).toHaveLength(64)
  })

  it("UnitInterval has the codec pair its siblings have, and CML agrees on the bytes", () => {
    const margin = new UnitInterval.UnitInterval({ numerator: 3n, denominator: 100n })
    const hex = UnitInterval.toCBORHex(margin)
    expect(hex).toBe(CML.UnitInterval.new(3n, 100n).to_cbor_hex())
    expect(UnitInterval.fromCBORHex(hex)).toStrictEqual(margin)
  })

  it("a Voter, a VotingProcedure and a GovActionId each encode on their own", () => {
    const voter = new VotingProcedures.StakePoolVoter({ poolKeyHash: PoolKeyHash.fromHex("09".repeat(28)) })
    const voterHex = VotingProcedures.voterToCBORHex(voter)
    expect(VotingProcedures.voterFromCBORHex(voterHex)).toStrictEqual(voter)

    const procedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    const procedureHex = VotingProcedures.votingProcedureToCBORHex(procedure)
    expect(VotingProcedures.votingProcedureFromCBORHex(procedureHex)).toStrictEqual(procedure)

    const govActionId = new GovernanceAction.GovActionId({
      transactionId: TransactionHash.fromHex("11".repeat(32)),
      govActionIndex: 3n
    })
    const govActionIdHex = GovernanceAction.govActionIdToCBORHex(govActionId)
    expect(GovernanceAction.govActionIdFromCBORHex(govActionIdHex)).toStrictEqual(govActionId)
  })
})
