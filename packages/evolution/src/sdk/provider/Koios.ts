import { Effect } from "effect"

import * as KoiosEffect from "./internal/KoiosEffect.js"
import type { Provider, ProviderEffect } from "./Provider.js"

/**
 * Koios provider for Cardano blockchain data access.
 * Provides support for interacting with the Koios API across multiple environments.
 * Supports optional bearer token authentication.
 *
 * @since 2.0.0
 * @category constructors
 */
export class Koios implements Provider {
  private readonly baseUrl: string
  private readonly token?: string

  readonly effect: ProviderEffect

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl
    this.token = token

    this.effect = {
      getProtocolParameters: () => KoiosEffect.getProtocolParameters(this.baseUrl, this.token),
      getUtxos: KoiosEffect.getUtxos(this.baseUrl, this.token),
      getUtxosWithUnit: KoiosEffect.getUtxosWithUnit(this.baseUrl, this.token),
      getUtxoByUnit: KoiosEffect.getUtxoByUnit(this.baseUrl, this.token),
      getUtxosByOutRef: KoiosEffect.getUtxosByOutRef(this.baseUrl, this.token),
      getDelegation: KoiosEffect.getDelegation(this.baseUrl, this.token),
      getDatum: KoiosEffect.getDatum(this.baseUrl, this.token),
      awaitTx: KoiosEffect.awaitTx(this.baseUrl, this.token),
      submitTx: KoiosEffect.submitTx(this.baseUrl, this.token),
      evaluateTx: KoiosEffect.evaluateTx(this.baseUrl, this.token)
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
