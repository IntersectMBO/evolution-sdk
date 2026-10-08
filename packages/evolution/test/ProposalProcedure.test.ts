import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as Anchor from "../src/Anchor.js"
import { InfoAction } from "../src/GovernanceAction.js"
import * as ProposalProcedure from "../src/ProposalProcedure.js"
import * as ProposalProcedures from "../src/ProposalProcedures.js"
import * as RewardAccount from "../src/RewardAccount.js"

describe("ProposalProcedure anchor", () => {
  const rewardAccount = FastCheck.sample(RewardAccount.arbitrary, { seed: 1, numRuns: 1 })[0]
  const anchor = FastCheck.sample(Anchor.arbitrary, { seed: 1, numRuns: 1 })[0]

  it("rejects CBOR with a null anchor", () => {
    const procedure = new ProposalProcedure.ProposalProcedure({
      deposit: 500_000_000n,
      rewardAccount,
      governanceAction: new InfoAction(),
      anchor
    })
    const hex = ProposalProcedure.toCBORHex(procedure)
    const anchorHex = Anchor.toCBORHex(anchor)
    expect(hex.endsWith(anchorHex)).toBe(true)

    const nullAnchorHex = hex.slice(0, -anchorHex.length) + "f6"
    expect(() => ProposalProcedure.fromCBORHex(nullAnchorHex)).toThrow()
  })

  it("rejects a null anchor at construction", () => {
    expect(
      () =>
        new ProposalProcedure.ProposalProcedure({
          deposit: 500_000_000n,
          rewardAccount,
          governanceAction: new InfoAction(),
          // @ts-expect-error - the ledger requires an anchor on every proposal
          anchor: null
        })
    ).toThrow()
  })

  it("arbitrary always generates an anchor", () => {
    FastCheck.assert(
      FastCheck.property(ProposalProcedures.arbitrary, (procedures) =>
        procedures.procedures.every((procedure) => procedure.anchor instanceof Anchor.Anchor)
      )
    )
  })
})
