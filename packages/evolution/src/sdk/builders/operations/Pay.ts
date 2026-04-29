/**
 * Pay operation - creates transaction outputs to send assets to addresses.
 *
 * @module operations/Pay
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"

import * as CoreAssets from "../../../Assets.js"
import { calculateMinimumUtxoLovelace, makeTxOutput } from "../internal/txBuilder.js"
import type { TransactionBuilderError } from "../TransactionBuilder.js"
import { ProtocolParametersTag, TxBuilderConfigTag, TxContext } from "../TransactionBuilder.js"
import type { PayToAddressParams } from "./Operations.js"

/**
 * Creates a ProgramStep for payToAddress operation.
 * Creates a UTxO output and tracks assets for balancing.
 *
 * When `autoMinUtxo` is enabled (via builder config or per-call override),
 * the output lovelace is automatically bumped up to the protocol minimum
 * if the specified amount is below it. When disabled (the default), the
 * specified lovelace is used as-is.
 *
 * Implementation:
 * 1. Resolves autoMinUtxo from per-call override or builder config (default: off)
 * 2. When enabled, calculates minimum lovelace and uses the higher of specified/required
 * 3. Creates the UTxO output with the effective assets
 * 4. Adds output to state.outputs array
 * 5. Updates totalOutputAssets for balancing
 *
 * @since 2.0.0
 * @category programs
 */
export const createPayToAddressProgram = (params: PayToAddressParams) =>
  Effect.gen(function* () {
    const ctx = yield* TxContext
    const config = yield* TxBuilderConfigTag
    const shouldBump = params.autoMinUtxo ?? config.autoMinUtxo ?? false

    let effectiveAssets = params.assets

    if (shouldBump) {
      const protocolParams = yield* ProtocolParametersTag

      const minLovelace = yield* calculateMinimumUtxoLovelace({
        address: params.address,
        assets: params.assets,
        datum: params.datum,
        scriptRef: params.script,
        coinsPerUtxoByte: protocolParams.coinsPerUtxoByte
      })

      const specifiedLovelace = CoreAssets.lovelaceOf(params.assets)
      if (specifiedLovelace < minLovelace) {
        effectiveAssets = CoreAssets.withLovelace(params.assets, minLovelace)
      }
    }

    const output = makeTxOutput({
      address: params.address,
      assets: effectiveAssets,
      datum: params.datum,
      scriptRef: params.script
    })

    yield* Ref.update(ctx, (state) => ({
      ...state,
      outputs: [...state.outputs, output],
      totalOutputAssets: CoreAssets.merge(state.totalOutputAssets, effectiveAssets)
    }))
  }) satisfies Effect.Effect<
    void,
    TransactionBuilderError,
    ProtocolParametersTag | TxContext | TxBuilderConfigTag
  >
