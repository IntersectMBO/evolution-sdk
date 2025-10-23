/**
 * @fileoverview Maestro provider implementation
 * Public provider class implementing both Effect and Promise APIs
 */

import { Effect } from "effect"

import * as MaestroEffect from "./internal/MaestroEffect.js"
import type { Provider, ProviderEffect } from "./Provider.js"

/**
 * Maestro provider for Cardano blockchain data access.
 *
 * Supports mainnet and testnet networks with API key authentication.
 * Features cursor-based pagination and optional turbo submit for faster transaction processing.
 * Implements rate limiting to respect Maestro API limits.
 *
 * @example Basic usage with API key:
 * ```typescript
 * const maestro = new MaestroProvider(
 *   "https://api.maestro.org/v1",
 *   "your-api-key"
 * );
 *
 * // Using Promise API
 * const params = await maestro.getProtocolParameters();
 *
 * // Using Effect API
 * const paramsEffect = maestro.Effect.getProtocolParameters;
 * ```
 *
 * @example With turbo submit enabled:
 * ```typescript
 * const maestro = new MaestroProvider(
 *   "https://api.maestro.org/v1",
 *   "your-api-key",
 *   true // Enable turbo submit
 * );
 *
 * // Transactions will use turbo submit endpoint
 * const txHash = await maestro.submitTx(signedTx);
 * ```
 *
 * @example Testnet usage:
 * ```typescript
 * const maestro = new MaestroProvider(
 *   "https://preprod.api.maestro.org/v1",
 *   "your-preprod-api-key"
 * );
 * ```
 */
export class MaestroProvider implements Provider {
  readonly Effect: ProviderEffect

  /**
   * Create a new Maestro provider instance
   *
   * @param baseUrl - The Maestro API base URL (e.g., "https://api.maestro.org/v1")
   * @param apiKey - API key for authenticated requests
   * @param turboSubmit - Optional flag to enable turbo submit (default: false)
   */
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly turboSubmit: boolean = false
  ) {
    // Initialize Effect-based API with curry pattern
    this.Effect = {
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

  // ============================================================================
  // Promise-based API - arrow functions as own properties (spreadable!)
  // ============================================================================

  getProtocolParameters = () => Effect.runPromise(this.Effect.getProtocolParameters())

  getUtxos = (addressOrCredential: Parameters<Provider["getUtxos"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxos(addressOrCredential))

  getUtxosWithUnit = (
    addressOrCredential: Parameters<Provider["getUtxosWithUnit"]>[0],
    unit: Parameters<Provider["getUtxosWithUnit"]>[1]
  ) => Effect.runPromise(this.Effect.getUtxosWithUnit(addressOrCredential, unit))

  getUtxoByUnit = (unit: Parameters<Provider["getUtxoByUnit"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxoByUnit(unit))

  getUtxosByOutRef = (outRefs: Parameters<Provider["getUtxosByOutRef"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxosByOutRef(outRefs))

  getDelegation = (rewardAddress: Parameters<Provider["getDelegation"]>[0]) =>
    Effect.runPromise(this.Effect.getDelegation(rewardAddress))

  getDatum = (datumHash: Parameters<Provider["getDatum"]>[0]) =>
    Effect.runPromise(this.Effect.getDatum(datumHash))

  awaitTx = (txHash: Parameters<Provider["awaitTx"]>[0], checkInterval?: Parameters<Provider["awaitTx"]>[1]) =>
    Effect.runPromise(this.Effect.awaitTx(txHash, checkInterval))

  submitTx = (cbor: Parameters<Provider["submitTx"]>[0]) =>
    Effect.runPromise(this.Effect.submitTx(cbor))

  evaluateTx = (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
    Effect.runPromise(this.Effect.evaluateTx(tx, additionalUTxOs))
}

// ============================================================================
// Network Configuration Helpers
// ============================================================================

/**
 * Pre-configured Maestro provider for Cardano mainnet
 */
export const mainnet = (apiKey: string, turboSubmit: boolean = false): MaestroProvider =>
  new MaestroProvider("https://api.maestro.org/v1", apiKey, turboSubmit)

/**
 * Pre-configured Maestro provider for Cardano preprod testnet
 */
export const preprod = (apiKey: string, turboSubmit: boolean = false): MaestroProvider =>
  new MaestroProvider("https://preprod.api.maestro.org/v1", apiKey, turboSubmit)

/**
 * Pre-configured Maestro provider for Cardano preview testnet
 */
export const preview = (apiKey: string, turboSubmit: boolean = false): MaestroProvider =>
  new MaestroProvider("https://preview.api.maestro.org/v1", apiKey, turboSubmit)

