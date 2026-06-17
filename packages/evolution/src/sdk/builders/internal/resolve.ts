import { Effect } from "effect"

import type * as CoreAddress from "../../../Address.js"
import type * as Transaction from "../../../Transaction.js"
import type * as CoreUTxO from "../../../UTxO.js"
import type * as Provider from "../../provider/Provider.js"
import type * as Wallet from "../../wallet/Wallet.js"
import type { BuildOptions, EvaluationContext, Evaluator, ProtocolParameters, TxBuilderConfig } from "../TransactionBuilder.js"
import { EvaluationError, TransactionBuilderError } from "../TransactionBuilder.js"
import { parseProviderError } from "./providerErrorParser.js"

/**
 * Resolve protocol parameters for a build invocation.
 *
 * @since 2.0.0
 * @category builders
 */
export const resolveProtocolParameters = (
  config: TxBuilderConfig,
  options?: BuildOptions
): Effect.Effect<ProtocolParameters, TransactionBuilderError | Provider.ProviderError> => {
  if (options?.fullProtocolParameters !== undefined) {
    const p = options.fullProtocolParameters
    return Effect.succeed({
      minFeeCoefficient: BigInt(p.minFeeA),
      minFeeConstant: BigInt(p.minFeeB),
      coinsPerUtxoByte: p.coinsPerUtxoByte,
      maxTxSize: p.maxTxSize,
      priceMem: p.priceMem,
      priceStep: p.priceStep,
      minFeeRefScriptCostPerByte: p.minFeeRefScriptCostPerByte
    })
  }

  if (options?.protocolParameters !== undefined) {
    return Effect.succeed(options.protocolParameters)
  }

  const provider = config.provider
  if (provider !== undefined) {
    return Effect.map(
      provider.effect.getProtocolParameters(),
      (params): ProtocolParameters => ({
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
    new TransactionBuilderError({
      message:
        "No protocol parameters provided. Either provide protocolParameters in BuildOptions or provider in config."
    })
  )
}

/**
 * Resolve full protocol parameters once for the build layer.
 *
 * Returns `undefined` when neither `fullProtocolParameters` nor a provider is available.
 * Operations that need it check for `undefined` and fail with a descriptive error.
 *
 * @since 2.0.0
 * @category builders
 */
export const resolveFullProtocolParameters = (
  config: TxBuilderConfig,
  options?: BuildOptions
): Effect.Effect<Provider.ProtocolParameters | undefined, TransactionBuilderError> => {
  if (options?.fullProtocolParameters) {
    return Effect.succeed(options.fullProtocolParameters)
  }

  if (config.provider) {
    return config.provider.effect.getProtocolParameters().pipe(
      Effect.mapError(
        (err) =>
          new TransactionBuilderError({
            message: `Failed to fetch protocol parameters: ${err.message}`
          })
      )
    )
  }

  return Effect.succeed(undefined)
}

/**
 * Resolve the build change address.
 *
 * @since 2.0.0
 * @category builders
 */
export const resolveChangeAddress = (
  config: TxBuilderConfig,
  options?: BuildOptions
): Effect.Effect<CoreAddress.Address, TransactionBuilderError | Wallet.WalletError> => {
  if (options?.changeAddress !== undefined) {
    return Effect.succeed(options.changeAddress)
  }

  const wallet = config.wallet
  if (wallet !== undefined) {
    return wallet.effect.address()
  }

  return Effect.fail(
    new TransactionBuilderError({
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
  config: TxBuilderConfig,
  options?: BuildOptions
): Effect.Effect<
  ReadonlyArray<CoreUTxO.UTxO>,
  TransactionBuilderError | Wallet.WalletError | Provider.ProviderError
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
    new TransactionBuilderError({
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
  config: TxBuilderConfig,
  options?: BuildOptions
): Evaluator | undefined => {
  if (options?.evaluator !== undefined) {
    return options.evaluator
  }

  const provider = config.provider
  if (provider !== undefined) {
    return {
      evaluate: (
        tx: Transaction.Transaction,
        additionalUtxos: ReadonlyArray<CoreUTxO.UTxO> | undefined,
        _context: EvaluationContext
      ) => {
        const utxosToPass = options?.passAdditionalUtxos === true
          ? (additionalUtxos === undefined ? undefined : [...additionalUtxos])
          : undefined

        return provider.effect.evaluateTx(tx, utxosToPass).pipe(
          Effect.mapError((providerError) =>
            new EvaluationError({
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
export const resolveSlotConfig = (config: TxBuilderConfig, options?: BuildOptions) =>
  options?.slotConfig ?? config.chain.slotConfig