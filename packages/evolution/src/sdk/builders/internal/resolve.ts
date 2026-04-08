import { Effect } from "effect"

import type * as Address from "../../../Address.js"
import type * as Transaction from "../../../Transaction.js"
import type * as UTxO from "../../../UTxO.js"
import type * as Provider from "../../provider/Provider.js"
import type * as Wallet from "../../wallet/Wallet.js"
import * as Ctx from "./ctx.js"
import { parseProviderError } from "./providerErrorParser.js"

/**
 * Resolve protocol parameters for a build invocation.
 *
 * @since 2.0.0
 * @category builders
 */
export const resolveProtocolParameters = (
  config: Ctx.TxBuilderConfig,
  options?: Ctx.BuildOptions
): Effect.Effect<Ctx.ProtocolParameters, Ctx.TransactionBuilderError | Provider.ProviderError> => {
  if (options?.protocolParameters !== undefined) {
    return Effect.succeed(options.protocolParameters)
  }

  const provider = config.provider
  if (provider !== undefined) {
    return Effect.map(
      provider.effect.getProtocolParameters(),
      (params): Ctx.ProtocolParameters => ({
        minFeeCoefficient: BigInt(params.minFeeA),
        minFeeConstant: BigInt(params.minFeeB),
        coinsPerUtxoByte: params.coinsPerUtxoByte,
        maxTxSize: params.maxTxSize,
        priceMem: params.priceMem,
        priceStep: params.priceStep,
        minFeeRefScriptCostPerByte: params.minFeeRefScriptCostPerByte
      })
    )
  }

  return Effect.fail(
    new Ctx.TransactionBuilderError({
      message:
        "No protocol parameters provided. Either provide protocolParameters in BuildOptions or provider in config."
    })
  )
}

/**
 * Resolve the build change address.
 *
 * @since 2.0.0
 * @category builders
 */
export const resolveChangeAddress = (
  config: Ctx.TxBuilderConfig,
  options?: Ctx.BuildOptions
): Effect.Effect<Address.Address, Ctx.TransactionBuilderError | Wallet.WalletError> => {
  if (options?.changeAddress !== undefined) {
    return Effect.succeed(options.changeAddress)
  }

  const wallet = config.wallet
  if (wallet !== undefined) {
    return wallet.effect.address()
  }

  return Effect.fail(
    new Ctx.TransactionBuilderError({
      message: "No change address provided. Either provide wallet in config or changeAddress in build options."
    })
  )
}

/**
 * Resolve the UTxO set available to the build.
 *
 * @since 2.0.0
 * @category builders
 */
export const resolveAvailableUtxos = (
  config: Ctx.TxBuilderConfig,
  options?: Ctx.BuildOptions
): Effect.Effect<
  ReadonlyArray<UTxO.UTxO>,
  Ctx.TransactionBuilderError | Wallet.WalletError | Provider.ProviderError
> => {
  if (options?.availableUtxos !== undefined) {
    return Effect.succeed(options.availableUtxos)
  }

  const wallet = config.wallet
  const provider = config.provider
  if (wallet !== undefined && provider !== undefined) {
    return Effect.flatMap(wallet.effect.address(), (address) => provider.effect.getUtxos(address))
  }

  return Effect.fail(
    new Ctx.TransactionBuilderError({
      message:
        "No available UTxOs provided. Either provide wallet+provider in config or availableUtxos in build options."
    })
  )
}

/**
 * Resolve the evaluator used by the build.
 *
 * @since 2.0.0
 * @category builders
 */
export const resolveEvaluator = (
  config: Ctx.TxBuilderConfig,
  options?: Ctx.BuildOptions
): Ctx.Evaluator | undefined => {
  if (options?.evaluator !== undefined) {
    return options.evaluator
  }

  const provider = config.provider
  if (provider !== undefined) {
    return {
      evaluate: (
        tx: Transaction.Transaction,
        additionalUtxos: ReadonlyArray<UTxO.UTxO> | undefined,
        _context: Ctx.EvaluationContext
      ) => {
        const utxosToPass = options?.passAdditionalUtxos === true
          ? (additionalUtxos === undefined ? undefined : [...additionalUtxos])
          : undefined

        return provider.effect.evaluateTx(tx, utxosToPass).pipe(
          Effect.mapError((providerError) =>
            new Ctx.EvaluationError({
              message: `Provider evaluation failed: ${providerError.message}`,
              cause: providerError,
              failures: parseProviderError(providerError)
            })
          )
        )
      }
    }
  }

  return undefined
}

/**
 * Resolve the slot configuration used by the build.
 *
 * @since 2.0.0
 * @category builders
 */
export const resolveSlotConfig = (config: Ctx.TxBuilderConfig, options?: Ctx.BuildOptions) =>
  options?.slotConfig ?? config.chain.slotConfig