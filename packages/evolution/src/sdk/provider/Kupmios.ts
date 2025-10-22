import { Effect } from "effect"

import type * as Unit from "../Unit.js"
import * as KupmiosEffects from "./internal/KupmiosEffects.js"
import type { Provider, ProviderEffect } from "./Provider.js"

/**
 * Provides support for interacting with both Kupo and Ogmios APIs.
 *
 * @example Using Local URLs (No Authentication):
 * ```typescript
 * const kupmios = new KupmiosProvider(
 *   "http://localhost:1442", // Kupo API URL
 *   "http://localhost:1337"  // Ogmios API URL
 * );
 * ```
 *
 * @example Using Authenticated URLs (No Custom Headers):
 * ```typescript
 * const kupmios = new KupmiosProvider(
 *   "https://dmtr_kupoXXX.preprod-v2.kupo-m1.demeter.run", // Kupo Authenticated URL
 *   "https://dmtr_ogmiosXXX.preprod-v6.ogmios-m1.demeter.run" // Ogmios Authenticated URL
 * );
 * ```
 *
 * @example Using Public URLs with Custom Headers:
 * ```typescript
 * const kupmios = new KupmiosProvider(
 *   "https://preprod-v2.kupo-m1.demeter.run", // Kupo API URL
 *   "https://preprod-v6.ogmios-m1.demeter.run", // Ogmios API URL
 *   {
 *     kupoHeader: { "dmtr-api-key": "dmtr_kupoXXX" }, // Custom header for Kupo
 *     ogmiosHeader: { "dmtr-api-key": "dmtr_ogmiosXXX" } // Custom header for Ogmios
 *   }
 * );
 */
export class KupmiosProvider implements Provider {
  private readonly kupoUrl: string
  private readonly ogmiosUrl: string
  private readonly headers?: {
    readonly ogmiosHeader?: Record<string, string>
    readonly kupoHeader?: Record<string, string>
  }

  // Effect property for Provider interface
  readonly Effect: ProviderEffect

  constructor(
    kupoUrl: string,
    ogmiosUrl: string,
    headers?: {
      ogmiosHeader?: Record<string, string>
      kupoHeader?: Record<string, string>
    }
  ) {
    this.kupoUrl = kupoUrl
    this.ogmiosUrl = ogmiosUrl
    this.headers = headers

    // Initialize Effect property
    this.Effect = {
      getProtocolParameters: () => KupmiosEffects.getProtocolParametersEffect(this.ogmiosUrl, this.headers?.ogmiosHeader),
      getUtxos: KupmiosEffects.getUtxosEffect(this.kupoUrl, this.headers?.kupoHeader),
      getUtxosWithUnit: KupmiosEffects.getUtxosWithUnitEffect(this.kupoUrl, this.headers?.kupoHeader),
      getUtxoByUnit: KupmiosEffects.getUtxoByUnitEffect(this.kupoUrl, this.headers?.kupoHeader),
      getUtxosByOutRef: KupmiosEffects.getUtxosByOutRefEffect(this.kupoUrl, this.headers?.kupoHeader),
      getDelegation: KupmiosEffects.getDelegationEffect(this.ogmiosUrl, this.headers?.ogmiosHeader),
      getDatum: KupmiosEffects.getDatumEffect(this.kupoUrl, this.headers?.kupoHeader),
      awaitTx: KupmiosEffects.awaitTxEffect(this.kupoUrl, this.headers?.kupoHeader),
      evaluateTx: KupmiosEffects.evaluateTxEffect(this.ogmiosUrl, this.headers?.ogmiosHeader),
      submitTx: KupmiosEffects.submitTxEffect(this.ogmiosUrl, this.headers?.ogmiosHeader)
    }
  }

  // ============================================================================
  // Promise-based API - arrow functions as own properties (spreadable!)
  // ============================================================================

  getProtocolParameters = () => Effect.runPromise(this.Effect.getProtocolParameters())

  getUtxos = (addressOrCredential: Parameters<Provider["getUtxos"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxos(addressOrCredential))

  getUtxosWithUnit = (
    addressOrCredential: Parameters<Provider["getUtxosWithUnit"]>[0],
    unit: Parameters<Provider["getUtxosWithUnit"]>[1]
  ) => Effect.runPromise(this.Effect.getUtxosWithUnit(addressOrCredential, unit as Unit.Unit))

  getUtxoByUnit = (unit: Parameters<Provider["getUtxoByUnit"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxoByUnit(unit as Unit.Unit))

  getUtxosByOutRef = (outRefs: Parameters<Provider["getUtxosByOutRef"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxosByOutRef(outRefs))

  getDelegation = (rewardAddress: Parameters<Provider["getDelegation"]>[0]) =>
    Effect.runPromise(this.Effect.getDelegation(rewardAddress))

  getDatum = (datumHash: Parameters<Provider["getDatum"]>[0]) =>
    Effect.runPromise(this.Effect.getDatum(datumHash))

  awaitTx = (txHash: Parameters<Provider["awaitTx"]>[0], checkInterval?: Parameters<Provider["awaitTx"]>[1]) =>
    Effect.runPromise(this.Effect.awaitTx(txHash, checkInterval))

  evaluateTx = (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
    Effect.runPromise(this.Effect.evaluateTx(tx, additionalUTxOs))

  submitTx = (tx: Parameters<Provider["submitTx"]>[0]) =>
    Effect.runPromise(this.Effect.submitTx(tx))
}
