/**
 * Pool operations - stake pool registration and retirement.
 *
 * @module operations/Pool
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"

import * as Certificate from "../../../Certificate.js"
import * as PoolKeyHash from "../../../PoolKeyHash.js"
import { FullProtocolParametersTag, TransactionBuilderError, type TxBuilderConfigTag,TxContext } from "../TransactionBuilder.js"
import type { RegisterPoolParams, RetirePoolParams } from "./Operations.js"

// ============================================================================
// Pool Operations
// ============================================================================

/**
 * Creates a ProgramStep for registerPool operation.
 * Adds a PoolRegistration certificate to the transaction.
 * Used for both new pool registration and updating existing pool parameters.
 *
 * @since 2.0.0
 * @category programs
 */
export const createRegisterPoolProgram = (
  params: RegisterPoolParams
): Effect.Effect<void, TransactionBuilderError, TxContext | TxBuilderConfigTag | FullProtocolParametersTag> =>
  Effect.gen(function* () {
    const ctx = yield* TxContext
    const fullParams = yield* FullProtocolParametersTag

    if (!fullParams) {
      return yield* Effect.fail(
        new TransactionBuilderError({ message: "Provider required to fetch protocol parameters for pool registration" })
      )
    }
    const poolDeposit = fullParams.poolDeposit

    // Create PoolRegistration certificate
    const certificate = new Certificate.PoolRegistration({
      poolParams: params.poolParams
    })

    yield* Ref.update(ctx, (state) => {
      const newPoolDeposits = new Map(state.poolDeposits)
      const operatorHex = PoolKeyHash.toHex(params.poolParams.operator)
      newPoolDeposits.set(operatorHex, poolDeposit)

      return {
        ...state,
        certificates: [...state.certificates, certificate],
        poolDeposits: newPoolDeposits
      }
    })

    yield* Effect.logDebug(`[RegisterPool] Added PoolRegistration certificate with deposit ${poolDeposit}`)
  })

/**
 * Creates a ProgramStep for retirePool operation.
 * Adds a PoolRetirement certificate to the transaction.
 * Announces pool retirement effective at the specified epoch.
 *
 * @since 2.0.0
 * @category programs
 */
export const createRetirePoolProgram = (params: RetirePoolParams): Effect.Effect<void, never, TxContext> =>
  Effect.gen(function* () {
    const ctx = yield* TxContext

    // Create PoolRetirement certificate
    const certificate = new Certificate.PoolRetirement({
      poolKeyHash: params.poolKeyHash,
      epoch: params.epoch
    })

    yield* Ref.update(ctx, (state) => ({
      ...state,
      certificates: [...state.certificates, certificate]
    }))

    yield* Effect.logDebug(
      `[RetirePool] Added PoolRetirement certificate for pool ${PoolKeyHash.toHex(params.poolKeyHash)} at epoch ${params.epoch}`
    )
  })
