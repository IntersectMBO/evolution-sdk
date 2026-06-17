/**
 * Propose operation - submit governance action proposals.
 *
 * @module operations/Propose
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"

import * as ProposalProcedure from "../../../ProposalProcedure.js"
import * as ProposalProcedures from "../../../ProposalProcedures.js"
import { FullProtocolParametersTag, TransactionBuilderError, type TxBuilderConfigTag,TxContext } from "../TransactionBuilder.js"
import type { ProposeParams } from "./Operations.js"

/**
 * Creates a ProgramStep for propose operation.
 * Fetches govActionDeposit from protocol parameters and constructs ProposalProcedure.
 *
 * Implementation:
 * 1. Fetches govActionDeposit from protocol parameters (like registerStake)
 * 2. Constructs ProposalProcedure with the fetched deposit
 * 3. Merges with existing proposal procedures if any
 * 4. No redeemers needed - proposing is not script-controlled
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
        proposalProcedures: mergedProposalProcedures
      }
    })

    yield* Effect.logDebug(`[Propose] Added governance proposal with deposit ${govActionDeposit}`)
  })
