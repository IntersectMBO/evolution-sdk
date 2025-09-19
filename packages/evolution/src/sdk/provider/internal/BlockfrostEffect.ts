/**
 * @fileoverview Effect-based Blockfrost provider functions
 * Internal module implementing all provider operations using Effect pattern
 */

import { Effect, Schedule, Schema } from "effect"

import type * as Address from "../../Address.js"
import type * as Credential from "../../Credential.js"
import type * as OutRef from "../../OutRef.js"
import type * as RewardAddress from "../../RewardAddress.js"
import type { UTxO } from "../../UTxO.js"
import { ProviderError } from "../Provider.js"
import * as Blockfrost from "./Blockfrost.js"
import * as HttpUtils from "./HttpUtils.js"

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

/**
 * Apply rate limiting to an Effect by delaying execution
 */
const withRateLimit = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.delay(effect, "100 millis")

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create Blockfrost API headers with project ID
 */
const createHeaders = (projectId?: string) => ({
  ...(projectId ? { "project_id": projectId } : {}),
  "Content-Type": "application/json"
})

/**
 * Wrap HTTP errors into ProviderError
 */
const wrapError = (operation: string) => (error: unknown) =>
  new ProviderError({
    message: `Blockfrost ${operation} failed`,
    cause: error
  })

/**
 * Convert address or credential to appropriate Blockfrost endpoint path
 */
const getAddressPath = (addressOrCredential: Address.Address | Credential.Credential): string => {
  // For now, assume it's an address string
  // In a full implementation, you'd need to handle credential conversion
  return typeof addressOrCredential === "string" ? addressOrCredential : addressOrCredential.toString()
}

// ============================================================================
// Blockfrost Effect Functions (Curry Pattern)
// ============================================================================

/**
 * Get protocol parameters from Blockfrost API
 * Returns: (baseUrl, projectId?) => Effect<ProtocolParameters, ProviderError>
 */
export const getProtocolParameters = (baseUrl: string, projectId?: string) =>
  withRateLimit(
    HttpUtils.get(
      `${baseUrl}/epochs/latest/parameters`,
      Blockfrost.BlockfrostProtocolParameters,
      createHeaders(projectId)
    ).pipe(
      Effect.map(Blockfrost.transformProtocolParameters),
      Effect.mapError(wrapError("getProtocolParameters"))
    )
  )

/**
 * Get UTxOs for an address or credential
 * Returns: (baseUrl, projectId?) => (addressOrCredential) => Effect<UTxO[], ProviderError>
 */
export const getUtxos = (baseUrl: string, projectId?: string) => 
  (addressOrCredential: Address.Address | Credential.Credential) => {
    const addressPath = getAddressPath(addressOrCredential)
    
    return withRateLimit(
      HttpUtils.get(
        `${baseUrl}/addresses/${addressPath}/utxos`,
        Schema.Array(Blockfrost.BlockfrostUTxO),
        createHeaders(projectId)
      ).pipe(
        Effect.map((utxos) => 
          utxos.map((utxo) => Blockfrost.transformUTxO(utxo, addressPath))
        ),
        Effect.mapError(wrapError("getUtxos"))
      )
    )
  }

/**
 * Get UTxOs with a specific unit (asset)
 * Returns: (baseUrl, projectId?) => (addressOrCredential, unit) => Effect<UTxO[], ProviderError>
 */
export const getUtxosWithUnit = (baseUrl: string, projectId?: string) =>
  (addressOrCredential: Address.Address | Credential.Credential, unit: string) => {
    const addressPath = getAddressPath(addressOrCredential)
    
    return withRateLimit(
      HttpUtils.get(
        `${baseUrl}/addresses/${addressPath}/utxos/${unit}`,
        Schema.Array(Blockfrost.BlockfrostUTxO),
        createHeaders(projectId)
      ).pipe(
        Effect.map((utxos) => 
          utxos.map((utxo) => Blockfrost.transformUTxO(utxo, addressPath))
        ),
        Effect.mapError(wrapError("getUtxosWithUnit"))
      )
    )
  }

/**
 * Get UTxO by unit (first occurrence)
 * Returns: (baseUrl, projectId?) => (unit) => Effect<UTxO, ProviderError>
 */
export const getUtxoByUnit = (baseUrl: string, projectId?: string) =>
  (unit: string) =>
    withRateLimit(
      HttpUtils.get(
        `${baseUrl}/assets/${unit}/addresses`,
        Schema.Array(Blockfrost.BlockfrostUTxO),
        createHeaders(projectId)
      ).pipe(
        Effect.flatMap((utxos) => {
          if (utxos.length === 0) {
            return Effect.fail(new ProviderError({
              message: `No UTxO found for unit ${unit}`,
              cause: "No UTxO found"
            }))
          }
          // Use the first address for the UTxO transformation
          const firstUtxo = utxos[0]
          return Effect.succeed(Blockfrost.transformUTxO(firstUtxo, "unknown"))
        }),
        Effect.mapError(wrapError("getUtxoByUnit"))
      )
    )

/**
 * Get UTxOs by output references
 * Returns: (baseUrl, projectId?) => (outRefs) => Effect<UTxO[], ProviderError>
 */
export const getUtxosByOutRef = (baseUrl: string, projectId?: string) =>
  (outRefs: ReadonlyArray<OutRef.OutRef>) => {
    // Blockfrost doesn't have a bulk endpoint, so we need to make individual calls
    const effects = outRefs.map((outRef) =>
      withRateLimit(
        HttpUtils.get(
          `${baseUrl}/txs/${outRef.txHash}/utxos`,
          Schema.Array(Blockfrost.BlockfrostUTxO),
          createHeaders(projectId)
        ).pipe(
          Effect.map((utxos) => 
            utxos
              .filter((utxo) => utxo.output_index === outRef.outputIndex)
              .map((utxo) => Blockfrost.transformUTxO(utxo, "unknown"))
          ),
          Effect.mapError(wrapError("getUtxosByOutRef"))
        )
      )
    )
    
    return Effect.all(effects).pipe(
      Effect.map((arrays) => arrays.flat())
    )
  }

/**
 * Get delegation information for a reward address
 * Returns: (baseUrl, projectId?) => (rewardAddress) => Effect<Delegation, ProviderError>
 */
export const getDelegation = (baseUrl: string, projectId?: string) =>
  (rewardAddress: RewardAddress.RewardAddress) => {
    // Assume RewardAddress has a string representation
    const rewardAddressStr = String(rewardAddress)
    
    return withRateLimit(
      HttpUtils.get(
        `${baseUrl}/accounts/${rewardAddressStr}`,
        Blockfrost.BlockfrostDelegation,
        createHeaders(projectId)
      ).pipe(
        Effect.map(Blockfrost.transformDelegation),
        Effect.mapError(wrapError("getDelegation"))
      )
    )
  }

/**
 * Get datum by hash
 * Returns: (baseUrl, projectId?) => (datumHash) => Effect<string, ProviderError>
 */
export const getDatum = (baseUrl: string, projectId?: string) =>
  (datumHash: string) =>
    withRateLimit(
      HttpUtils.get(
        `${baseUrl}/scripts/datum/${datumHash}`,
        Blockfrost.BlockfrostDatum,
        createHeaders(projectId)
      ).pipe(
        Effect.map((datum) => datum.cbor),
        Effect.mapError(wrapError("getDatum"))
      )
    )

/**
 * Await transaction confirmation
 * Returns: (baseUrl, projectId?) => (txHash, checkInterval?) => Effect<boolean, ProviderError>
 */
export const awaitTx = (baseUrl: string, projectId?: string) =>
  (txHash: string, checkInterval: number = 5000) => {
    const checkTx = withRateLimit(
      HttpUtils.get(
        `${baseUrl}/txs/${txHash}`,
        Schema.Struct({ hash: Schema.String }),
        createHeaders(projectId)
      ).pipe(
        Effect.map(() => true),
        Effect.mapError(wrapError("awaitTx"))
      )
    )

    // Poll every checkInterval milliseconds until transaction is found
    const pollSchedule = Schedule.fixed(`${checkInterval} millis`).pipe(
      Schedule.compose(Schedule.recurs(60)) // Max 60 attempts (5 minutes with 5s interval)
    )

    return Effect.retry(checkTx, pollSchedule).pipe(
      Effect.orElse(() => Effect.succeed(false)) // Return false if not found after max attempts
    )
  }

/**
 * Submit transaction
 * Returns: (baseUrl, projectId?) => (cbor) => Effect<string, ProviderError>
 */
export const submitTx = (baseUrl: string, projectId?: string) =>
  (cbor: string) =>
    withRateLimit(
      HttpUtils.postJson(
        `${baseUrl}/tx/submit`,
        { cbor },
        Blockfrost.BlockfrostSubmitResponse,
        createHeaders(projectId)
      ).pipe(
        Effect.mapError(wrapError("submitTx"))
      )
    )

/**
 * Evaluate transaction
 * Returns: (baseUrl, projectId?) => (tx, additionalUTxOs?) => Effect<EvalRedeemer[], ProviderError>
 */
export const evaluateTx = (baseUrl: string, projectId?: string) =>
  (tx: string, additionalUTxOs?: Array<UTxO>) => {
    // Blockfrost evaluation API expects transaction CBOR
    const requestBody = {
      cbor: tx,
      ...(additionalUTxOs ? { additional_utxo_set: additionalUTxOs } : {})
    }
    
    return withRateLimit(
      HttpUtils.postJson(
        `${baseUrl}/utils/txs/evaluate`,
        requestBody,
        Blockfrost.BlockfrostEvaluationResponse,
        createHeaders(projectId)
      ).pipe(
        Effect.map(Blockfrost.transformEvaluationResult),
        Effect.mapError(wrapError("evaluateTx"))
      )
    )
  }