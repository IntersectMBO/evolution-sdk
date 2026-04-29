/**
 * Pay operation - creates transaction outputs to send assets to addresses.
 *
 * @module operations/Pay
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"

import * as CoreAssets from "../../../Assets.js"
import { calculateMinimumUtxoLovelace, makeTxOutput } from "../internal/txBuilder.js"
import { ProtocolParametersTag, TransactionBuilderError, TxContext } from "../TransactionBuilder.js"
import type { PayToAddressParams } from "./Operations.js"

/**
 * Creates a ProgramStep for payToAddress operation.
 * Creates a UTxO output and tracks assets for balancing.
 *
 * Automatically enforces the minimum UTxO lovelace requirement: if the caller
 * provides lovelace below the protocol-parameter minimum (or omits it entirely),
 * the output is silently bumped up to the required minimum.  This mirrors the
 * behaviour of the change-creation phase and prevents on-chain rejections due
 * to dust outputs.
 *
 * Implementation:
 * 1. Calculates the minimum lovelace for the requested output
 * 2. Uses the higher of the specified and required lovelace
 * 3. Creates the UTxO output with the effective assets
 * 4. Adds output to state.outputs array
 * 5. Updates totalOutputAssets for balancing (using the effective amount)
 *
 * @since 2.0.0
 * @category programs
 */
export const createPayToAddressProgram = (params: PayToAddressParams) =>
  Effect.gen(function* () {
    const ctx = yield* TxContext
    const protocolParams = yield* ProtocolParametersTag

    // 1. Calculate the minimum lovelace required for this output
    const minLovelace = yield* calculateMinimumUtxoLovelace({
      address: params.address,
      assets: params.assets,
      datum: params.datum,
      scriptRef: params.script,
      coinsPerUtxoByte: protocolParams.coinsPerUtxoByte
    })

    // 2. Enforce minimum: silently bump lovelace up if below minimum
    const specifiedLovelace = CoreAssets.lovelaceOf(params.assets)
    const effectiveLovelace = specifiedLovelace < minLovelace ? minLovelace : specifiedLovelace
    const effectiveAssets =
      effectiveLovelace !== specifiedLovelace
        ? CoreAssets.withLovelace(params.assets, effectiveLovelace)
        : params.assets

    // 3. Create Core TransactionOutput from effective params
    const output = makeTxOutput({
      address: params.address,
      assets: effectiveAssets,
      datum: params.datum,
      scriptRef: params.script
    })

    // 4. Add output to state (totalOutputAssets uses effective lovelace for accurate balancing)
    yield* Ref.update(ctx, (state) => ({
      ...state,
      outputs: [...state.outputs, output],
      totalOutputAssets: CoreAssets.merge(state.totalOutputAssets, effectiveAssets)
    }))
  }) satisfies Effect.Effect<void, TransactionBuilderError, ProtocolParametersTag | TxContext>
