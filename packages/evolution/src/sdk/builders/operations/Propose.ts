/**
 * Propose operation - submit governance action proposals.
 *
 * @module operations/Propose
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"

import * as ProposalProcedure from "../../../ProposalProcedure.js"
import * as ProposalProcedures from "../../../ProposalProcedures.js"
import * as RedeemerBuilder from "../RedeemerBuilder.js"
import {
  FullProtocolParametersTag,
  proposalToKey,
  TransactionBuilderError,
  type TxBuilderConfigTag,
  TxContext
} from "../TransactionBuilder.js"
import type { ProposeParams } from "./Operations.js"

/**
 * Creates a ProgramStep for propose operation.
 * Fetches govActionDeposit from protocol parameters and constructs ProposalProcedure.
 *
 * Implementation:
 * 1. Fetches govActionDeposit from protocol parameters (like registerStake)
 * 2. Constructs ProposalProcedure with the fetched deposit
 * 3. Merges with existing proposal procedures if any
 * 4. Tracks the guardrail redeemer (propose purpose) if provided, keyed by the
 *    proposal's position in proposalProcedures
 *
 * Note: The deposit is deducted from transaction inputs during balancing.
 *
 * @since 2.0.0
 * @category programs
 */
export const createProposeProgram = (
  params: ProposeParams
): Effect.Effect<void, TransactionBuilderError, TxContext | TxBuilderConfigTag | FullProtocolParametersTag> =>
  Effect.gen(function* () {
    const ctx = yield* TxContext
    const fullParams = yield* FullProtocolParametersTag

    if (!fullParams) {
      return yield* Effect.fail(
        new TransactionBuilderError({ message: "Provider required to fetch protocol parameters for governance proposal" })
      )
    }
    const govActionDeposit = fullParams.govActionDeposit

    // A redeemer may be the integer 0, so test for presence rather than truthiness
    const deferred = params.redeemer !== undefined ? RedeemerBuilder.toDeferredRedeemer(params.redeemer) : undefined
    if (deferred?._tag === "self") {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message:
            "Self redeemers are not supported for proposals: a proposal spends no input. " +
            "Pass static redeemer data or a batch redeemer instead."
        })
      )
    }

    // 2. Construct ProposalProcedure with fetched deposit
    const proposalProcedure = new ProposalProcedure.ProposalProcedure({
      deposit: govActionDeposit,
      rewardAccount: params.rewardAccount,
      governanceAction: params.governanceAction,
      anchor: params.anchor
    })

    // 3. Update state: merge proposal procedures
    yield* Ref.update(ctx, (state) => {
      let mergedProposalProcedures = state.proposalProcedures
      const proposalIndex = mergedProposalProcedures?.procedures.length ?? 0

      // Track guardrail redeemer for script-checked actions (propose purpose)
      let newRedeemers = state.redeemers
      let newDeferredRedeemers = state.deferredRedeemers

      if (deferred) {
        const proposalKey = proposalToKey(proposalIndex)

        if (deferred._tag === "static") {
          newRedeemers = new Map(state.redeemers)
          newRedeemers.set(proposalKey, {
            tag: "propose",
            data: deferred.data,
            exUnits: undefined,
            label: params.label
          })
        } else {
          newDeferredRedeemers = new Map(state.deferredRedeemers)
          newDeferredRedeemers.set(proposalKey, {
            tag: "propose",
            deferred,
            exUnits: undefined,
            label: params.label
          })
        }
      }

      if (mergedProposalProcedures) {
        // Merge with existing proposals
        mergedProposalProcedures = new ProposalProcedures.ProposalProcedures({
          procedures: [...mergedProposalProcedures.procedures, proposalProcedure]
        })
      } else {
        // First proposal
        mergedProposalProcedures = new ProposalProcedures.ProposalProcedures({
          procedures: [proposalProcedure]
        })
      }

      return {
        ...state,
        proposalProcedures: mergedProposalProcedures,
        redeemers: newRedeemers,
        deferredRedeemers: newDeferredRedeemers
      }
    })

    yield* Effect.logDebug(`[Propose] Added governance proposal with deposit ${govActionDeposit}`)
  })
