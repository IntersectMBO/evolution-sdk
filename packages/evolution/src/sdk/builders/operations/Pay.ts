/**
 * Pay operation - creates transaction outputs to send assets to addresses.
 *
 * @module operations/Pay
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"

import * as Assets from "../../../Assets/index.js"
import * as Ctx from "../internal/ctx.js"
import { makeTxOutput } from "../internal/txBuilder.js"
import type { PayToAddressParams } from "./Operations.js"

/**
 * Creates a ProgramStep for payToAddress operation.
 * Creates a UTxO output and tracks assets for balancing.
 *
 * Implementation:
 * 1. Creates UTxO output from parameters using helper
 * 2. Adds output to state.outputs array
 * 3. Updates totalOutputAssets for balancing
 *
 * @since 2.0.0
 * @category programs
 */
export const createPayToAddressProgram = (params: PayToAddressParams) =>
  Effect.gen(function* () {
    const ctx = yield* Ctx.TxContext

    // 1. Create Core TransactionOutput from params
    const output = makeTxOutput({
      address: params.address,
      assets: params.assets,
      datum: params.datum,
      scriptRef: params.script // Script is now directly compatible with UTxO.scriptRef
    })

    // 2. Add output to state
    yield* Ref.update(ctx, (state) => ({
      ...state,
      outputs: [...state.outputs, output],
      totalOutputAssets: Assets.merge(state.totalOutputAssets, params.assets)
    }))
  })
