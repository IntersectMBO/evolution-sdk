/**
 * @fileoverview Blockfrost provider implementation
 * Public provider class implementing both Effect and Promise APIs
 */

import { Effect } from "effect"

import * as BlockfrostEffect from "./internal/BlockfrostEffect.js"
import type { Provider, ProviderEffect } from "./Provider.js"

/**
 * Blockfrost provider for Cardano blockchain data access.
 * 
 * Supports both mainnet and testnet networks with project-based authentication.
 * Implements rate limiting to respect Blockfrost API limits.
 * 
 * @example Basic usage with project ID:
 * ```typescript
 * const blockfrost = new BlockfrostProvider(
 *   "https://cardano-mainnet.blockfrost.io/api/v0",
 *   "your-project-id"
 * );
 * 
 * // Using Promise API
 * const params = await blockfrost.getProtocolParameters();
 * 
 * // Using Effect API  
 * const paramsEffect = blockfrost.Effect.getProtocolParameters;
 * ```
 * 
 * @example Testnet usage:
 * ```typescript
 * const blockfrost = new BlockfrostProvider(
 *   "https://cardano-preprod.blockfrost.io/api/v0",
 *   "your-preprod-project-id"
 * );
 * ```
 * 
 * @example Using without project ID (for public endpoints):
 * ```typescript
 * const blockfrost = new BlockfrostProvider(
 *   "https://cardano-mainnet.blockfrost.io/api/v0"
 * );
 * ```
 */
export class BlockfrostProvider implements Provider {
  readonly Effect: ProviderEffect

  /**
   * Create a new Blockfrost provider instance
   * 
   * @param baseUrl - The Blockfrost API base URL (e.g., "https://cardano-mainnet.blockfrost.io/api/v0")
   * @param projectId - Optional project ID for authenticated requests
   */
  constructor(
    private readonly baseUrl: string,
    private readonly projectId?: string
  ) {
    // Initialize Effect-based API with curry pattern
    this.Effect = {
      getProtocolParameters: BlockfrostEffect.getProtocolParameters(this.baseUrl, this.projectId),
      getUtxos: BlockfrostEffect.getUtxos(this.baseUrl, this.projectId),
      getUtxosWithUnit: BlockfrostEffect.getUtxosWithUnit(this.baseUrl, this.projectId),
      getUtxoByUnit: BlockfrostEffect.getUtxoByUnit(this.baseUrl, this.projectId),
      getUtxosByOutRef: BlockfrostEffect.getUtxosByOutRef(this.baseUrl, this.projectId),
      getDelegation: BlockfrostEffect.getDelegation(this.baseUrl, this.projectId),
      getDatum: BlockfrostEffect.getDatum(this.baseUrl, this.projectId),
      awaitTx: BlockfrostEffect.awaitTx(this.baseUrl, this.projectId),
      submitTx: BlockfrostEffect.submitTx(this.baseUrl, this.projectId),
      evaluateTx: BlockfrostEffect.evaluateTx(this.baseUrl, this.projectId)
    }
  }

  // ============================================================================
  // Promise-based API (Auto-generated from Effect API)
  // ============================================================================

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

  async getDatum(
    datumHash: Parameters<Provider["getDatum"]>[0]
  ): Promise<Awaited<ReturnType<Provider["getDatum"]>>> {
    return Effect.runPromise(this.Effect.getDatum(datumHash))
  }

  async awaitTx(
    txHash: Parameters<Provider["awaitTx"]>[0],
    checkInterval?: Parameters<Provider["awaitTx"]>[1]
  ): Promise<Awaited<ReturnType<Provider["awaitTx"]>>> {
    return Effect.runPromise(this.Effect.awaitTx(txHash, checkInterval))
  }

  async submitTx(
    cbor: Parameters<Provider["submitTx"]>[0]
  ): Promise<Awaited<ReturnType<Provider["submitTx"]>>> {
    return Effect.runPromise(this.Effect.submitTx(cbor))
  }

  async evaluateTx(
    tx: Parameters<Provider["evaluateTx"]>[0],
    additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]
  ): Promise<Awaited<ReturnType<Provider["evaluateTx"]>>> {
    return Effect.runPromise(this.Effect.evaluateTx(tx, additionalUTxOs))
  }
}

// ============================================================================
// Network Configuration Helpers
// ============================================================================

/**
 * Pre-configured Blockfrost provider for Cardano mainnet
 * @param projectId - Your Blockfrost project ID
 * @returns Configured BlockfrostProvider for mainnet
 */
export const mainnet = (projectId: string): BlockfrostProvider =>
  new BlockfrostProvider("https://cardano-mainnet.blockfrost.io/api/v0", projectId)

/**
 * Pre-configured Blockfrost provider for Cardano preprod testnet
 * @param projectId - Your Blockfrost project ID for preprod
 * @returns Configured BlockfrostProvider for preprod
 */
export const preprod = (projectId: string): BlockfrostProvider =>
  new BlockfrostProvider("https://cardano-preprod.blockfrost.io/api/v0", projectId)

/**
 * Pre-configured Blockfrost provider for Cardano preview testnet
 * @param projectId - Your Blockfrost project ID for preview
 * @returns Configured BlockfrostProvider for preview
 */
export const preview = (projectId: string): BlockfrostProvider =>
  new BlockfrostProvider("https://cardano-preview.blockfrost.io/api/v0", projectId)

/**
 * Create a custom Blockfrost provider with custom base URL
 * @param baseUrl - Custom Blockfrost API base URL
 * @param projectId - Optional project ID
 * @returns Configured BlockfrostProvider
 */
export const custom = (baseUrl: string, projectId?: string): BlockfrostProvider =>
  new BlockfrostProvider(baseUrl, projectId)