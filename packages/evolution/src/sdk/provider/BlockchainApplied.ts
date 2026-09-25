import { Effect } from "effect"

import * as BlockchainAppliedEffect from "./internal/BlockchainAppliedEffect.js"
import type { Provider, ProviderEffect } from "./Provider.js"

const HOST = "https://api.blockchain-applied.com"

/**
 * Blockchain Applied (BCA) provider for Cardano blockchain data access.
 * Supports Bearer token authentication.
 *
 * @since 2.0.0
 * @category constructors
 */
export class BlockchainAppliedProvider implements Provider {
  readonly effect: ProviderEffect
  readonly baseUrl: string
  readonly token?: string

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl
    this.token = token

    this.effect = {
      getProtocolParameters: () => BlockchainAppliedEffect.getProtocolParameters(baseUrl, token),
      getUtxos: BlockchainAppliedEffect.getUtxos(baseUrl, token),
      getUtxosWithUnit: BlockchainAppliedEffect.getUtxosWithUnit(baseUrl, token),
      getUtxoByUnit: BlockchainAppliedEffect.getUtxoByUnit(baseUrl, token),
      getUtxosByOutRef: BlockchainAppliedEffect.getUtxosByOutRef(baseUrl, token),
      getDelegation: BlockchainAppliedEffect.getDelegation(baseUrl, token),
      getDatum: BlockchainAppliedEffect.getDatum(baseUrl, token),
      awaitTx: BlockchainAppliedEffect.awaitTx(baseUrl, token),
      submitTx: BlockchainAppliedEffect.submitTx(baseUrl, token),
      evaluateTx: BlockchainAppliedEffect.evaluateTx(baseUrl, token)
    }
  }

  getProtocolParameters = () => Effect.runPromise(this.effect.getProtocolParameters())

  getUtxos = (addressOrCredential: Parameters<Provider["getUtxos"]>[0]) =>
    Effect.runPromise(this.effect.getUtxos(addressOrCredential))

  getUtxosWithUnit = (
    addressOrCredential: Parameters<Provider["getUtxosWithUnit"]>[0],
    unit: Parameters<Provider["getUtxosWithUnit"]>[1]
  ) => Effect.runPromise(this.effect.getUtxosWithUnit(addressOrCredential, unit))

  getUtxoByUnit = (unit: Parameters<Provider["getUtxoByUnit"]>[0]) => Effect.runPromise(this.effect.getUtxoByUnit(unit))

  getUtxosByOutRef = (outRefs: Parameters<Provider["getUtxosByOutRef"]>[0]) =>
    Effect.runPromise(this.effect.getUtxosByOutRef(outRefs))

  getDelegation = (rewardAddress: Parameters<Provider["getDelegation"]>[0]) =>
    Effect.runPromise(this.effect.getDelegation(rewardAddress))

  getDatum = (datumHash: Parameters<Provider["getDatum"]>[0]) => Effect.runPromise(this.effect.getDatum(datumHash))

  awaitTx = (
    txHash: Parameters<Provider["awaitTx"]>[0],
    checkInterval?: Parameters<Provider["awaitTx"]>[1],
    timeout?: Parameters<Provider["awaitTx"]>[2]
  ) => Effect.runPromise(this.effect.awaitTx(txHash, checkInterval, timeout))

  submitTx = (tx: Parameters<Provider["submitTx"]>[0]) => Effect.runPromise(this.effect.submitTx(tx))

  evaluateTx = (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
    Effect.runPromise(this.effect.evaluateTx(tx, additionalUTxOs))
}

/**
 * Pre-configured Blockchain Applied provider for Cardano mainnet.
 *
 * @since 2.0.0
 * @category constructors
 */
export const mainnet = (token?: string): BlockchainAppliedProvider =>
  new BlockchainAppliedProvider(`${HOST}/api_ada/v1`, token)

/**
 * Pre-configured Blockchain Applied provider for Cardano preprod testnet.
 *
 * @since 2.0.0
 * @category constructors
 */
export const preprod = (token?: string): BlockchainAppliedProvider =>
  new BlockchainAppliedProvider(`${HOST}/api_preprod/v1`, token)

/**
 * Pre-configured Blockchain Applied provider for Cardano preview testnet.
 *
 * @since 2.0.0
 * @category constructors
 */
export const preview = (token?: string): BlockchainAppliedProvider =>
  new BlockchainAppliedProvider(`${HOST}/api_preview/v1`, token)

/**
 * Create a custom Blockchain Applied provider with a custom base URL.
 *
 * @since 2.0.0
 * @category constructors
 */
export const custom = (baseUrl: string, token?: string): BlockchainAppliedProvider =>
  new BlockchainAppliedProvider(baseUrl, token)
