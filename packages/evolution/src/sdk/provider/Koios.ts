import { Effect } from "effect"

import * as KoiosEffect from "./internal/KoiosEffect.js"
import type { Provider, ProviderEffect } from "./Provider.js"

/**
 *  Provides support for interacting with the Koios API
 *
 * @example Using the Preprod API URL:
 * ```typescript
 * const koios = new Koios(
 *   "https://preview.koios.rest/api/v1", // Preprod Preview Environment
 *   "optional-bearer-token" // Optional Bearer Token for authentication
 * );
 * ```
 *
 * @example Using the Preprod Stable API URL:
 * ```typescript
 * const koios = new Koios(
 *   "https://preprod.koios.rest/api/v1", // Preprod Stable Environment
 *   "optional-bearer-token" // Optional Bearer Token for authentication
 * );
 * ```
 *
 * @example Using the Mainnet API URL:
 * ```typescript
 * const koios = new Koios(
 *   "https://api.koios.rest/api/v1", // Mainnet Environment
 *   "optional-bearer-token" // Optional Bearer Token for authentication
 * );
 * ```
 *
 */
export class Koios implements Provider {
  private readonly baseUrl: string
  private readonly token?: string

  // Effect property for Provider interface
  readonly Effect: ProviderEffect

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl
    this.token = token

    // Initialize Effect property
    this.Effect = {
      getProtocolParameters: KoiosEffect.getProtocolParameters(this.baseUrl, this.token),
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

  get getProtocolParameters(): Provider["getProtocolParameters"] {
    return Effect.runPromise(this.Effect.getProtocolParameters)
  }

  async getUtxos(
    addressOrCredential: Parameters<Provider["getUtxos"]>[0]
  ): Promise<Awaited<ReturnType<Provider["getUtxos"]>>> {
    return Effect.runPromise(this.Effect.getUtxos(addressOrCredential))
  }

  async getUtxosWithUnit(
    addressOrCredential: Parameters<Provider["getUtxosWithUnit"]>[0],
    unit: Parameters<Provider["getUtxosWithUnit"]>[1]
  ): Promise<Awaited<ReturnType<Provider["getUtxosWithUnit"]>>> {
    return Effect.runPromise(this.Effect.getUtxosWithUnit(addressOrCredential, unit))
  }

  async getUtxoByUnit(
    unit: Parameters<Provider["getUtxoByUnit"]>[0]
  ): Promise<Awaited<ReturnType<Provider["getUtxoByUnit"]>>> {
    return Effect.runPromise(this.Effect.getUtxoByUnit(unit))
  }

  async getUtxosByOutRef(
    outRefs: Parameters<Provider["getUtxosByOutRef"]>[0]
  ): Promise<Awaited<ReturnType<Provider["getUtxosByOutRef"]>>> {
    return Effect.runPromise(this.Effect.getUtxosByOutRef(outRefs))
  }

  async getDelegation(
    rewardAddress: Parameters<Provider["getDelegation"]>[0]
  ): Promise<Awaited<ReturnType<Provider["getDelegation"]>>> {
    return Effect.runPromise(this.Effect.getDelegation(rewardAddress))
  }

  async getDatum(datumHash: Parameters<Provider["getDatum"]>[0]): Promise<Awaited<ReturnType<Provider["getDatum"]>>> {
    return Effect.runPromise(this.Effect.getDatum(datumHash))
  }

  async awaitTx(
    txHash: Parameters<Provider["awaitTx"]>[0],
    checkInterval?: Parameters<Provider["awaitTx"]>[1]
  ): Promise<Awaited<ReturnType<Provider["awaitTx"]>>> {
    return Effect.runPromise(this.Effect.awaitTx(txHash, checkInterval))
  }

  async evaluateTx(
    tx: Parameters<Provider["evaluateTx"]>[0],
    additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]
  ): Promise<Awaited<ReturnType<Provider["evaluateTx"]>>> {
    return Effect.runPromise(this.Effect.evaluateTx(tx, additionalUTxOs))
  }

  async submitTx(tx: Parameters<Provider["submitTx"]>[0]): Promise<Awaited<ReturnType<Provider["submitTx"]>>> {
    return Effect.runPromise(this.Effect.submitTx(tx))
  }
}
