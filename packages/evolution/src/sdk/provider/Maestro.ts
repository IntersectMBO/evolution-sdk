import { Effect } from "effect"

import * as MaestroEffect from "./internal/MaestroEffect.js"
import type { Provider, ProviderEffect } from "./Provider.js"

/**
 * Maestro provider for Cardano blockchain data access.
 * Supports mainnet and testnet networks with API key authentication.
 * Features cursor-based pagination and optional turbo submit for faster transaction processing.
 * Implements rate limiting to respect Maestro API limits.
 *
 * @since 2.0.0
 * @category constructors
 */
export class MaestroProvider implements Provider {
  readonly effect: ProviderEffect

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly turboSubmit: boolean = false
  ) {
    this.effect = {
      getProtocolParameters: () => MaestroEffect.getProtocolParameters(this.baseUrl, this.apiKey),
      getUtxos: MaestroEffect.getUtxos(this.baseUrl, this.apiKey),
      getUtxosWithUnit: MaestroEffect.getUtxosWithUnit(this.baseUrl, this.apiKey),
      getUtxosByOutRef: MaestroEffect.getUtxosByOutRef(this.baseUrl, this.apiKey),
      getDelegation: MaestroEffect.getDelegation(this.baseUrl, this.apiKey),
      submitTx: MaestroEffect.submitTx(this.baseUrl, this.apiKey, this.turboSubmit),
      evaluateTx: MaestroEffect.evaluateTx(this.baseUrl, this.apiKey),
      getUtxoByUnit: MaestroEffect.getUtxoByUnit(this.baseUrl, this.apiKey),
      getDatum: MaestroEffect.getDatum(this.baseUrl, this.apiKey),
      awaitTx: MaestroEffect.awaitTx(this.baseUrl, this.apiKey)
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

  submitTx = (cbor: Parameters<Provider["submitTx"]>[0]) => Effect.runPromise(this.effect.submitTx(cbor))

  evaluateTx = (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
    Effect.runPromise(this.effect.evaluateTx(tx, additionalUTxOs))
}

/**
 * Pre-configured Maestro provider for Cardano mainnet.
 *
 * @since 2.0.0
 * @category constructors
 */
export const mainnet = (apiKey: string, turboSubmit: boolean = false): MaestroProvider =>
  new MaestroProvider("https://api.maestro.org/v1", apiKey, turboSubmit)

/**
 * Pre-configured Maestro provider for Cardano preprod testnet.
 *
 * @since 2.0.0
 * @category constructors
 */
export const preprod = (apiKey: string, turboSubmit: boolean = false): MaestroProvider =>
  new MaestroProvider("https://preprod.api.maestro.org/v1", apiKey, turboSubmit)

/**
 * Pre-configured Maestro provider for Cardano preview testnet.
 *
 * @since 2.0.0
 * @category constructors
 */
export const preview = (apiKey: string, turboSubmit: boolean = false): MaestroProvider =>
  new MaestroProvider("https://preview.api.maestro.org/v1", apiKey, turboSubmit)
