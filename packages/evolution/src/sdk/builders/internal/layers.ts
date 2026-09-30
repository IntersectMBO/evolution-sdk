import { Layer, Ref } from "effect"

import type { BuildOptions, PhaseContext, TxBuilderConfig } from "../TransactionBuilder.js"
import { AvailableUtxosTag, BuildOptionsTag, ChangeAddressTag, FullProtocolParametersTag, PhaseContextTag, ProtocolParametersTag, TxBuilderConfigTag, TxContext } from "../TransactionBuilder.js"
import * as BuilderResolve from "./resolve.js"
import * as BuilderState from "./state.js"

const makeBuildOptions = (config: TxBuilderConfig, options: BuildOptions): BuildOptions => ({
  ...options,
  evaluator: BuilderResolve.resolveEvaluator(config, options),
  slotConfig: BuilderResolve.resolveSlotConfig(config, options)
})

/**
 * Builds the scoped runtime environment required by the main transaction build
 * pipeline.
 */
export const makeBuildRuntimeLayer = (
  config: TxBuilderConfig,
  options: BuildOptions = BuilderState.DEFAULT_BUILD_OPTIONS
) => {
  const buildOptions = makeBuildOptions(config, options)

  return Layer.mergeAll(
    Layer.effect(TxContext, Ref.make(BuilderState.makeInitialTxBuilderState())),
    Layer.effect(
      PhaseContextTag,
      Ref.make<PhaseContext>(BuilderState.makeInitialPhaseContext(buildOptions))
    ),
    Layer.succeed(TxBuilderConfigTag, config),
    Layer.succeed(BuildOptionsTag, buildOptions),
    Layer.effect(ProtocolParametersTag, BuilderResolve.resolveProtocolParameters(config, buildOptions)),
    Layer.effect(FullProtocolParametersTag, BuilderResolve.resolveFullProtocolParameters(config, buildOptions)),
    Layer.effect(ChangeAddressTag, BuilderResolve.resolveChangeAddress(config, buildOptions)),
    Layer.effect(AvailableUtxosTag, BuilderResolve.resolveAvailableUtxos(config, buildOptions))
  )
}
