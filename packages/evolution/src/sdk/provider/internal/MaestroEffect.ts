/**
 * @fileoverview Maestro Effect-based provider functions
 * Internal module implementing curry pattern with rate limiting
 */

import { Effect, Schema } from "effect"

import type * as Credential from "../../Credential.js"
import type { EvalRedeemer } from "../../EvalRedeemer.js"
import type * as OutRef from "../../OutRef.js"
import { ProviderError } from "../Provider.js"
import * as HttpUtils from "./HttpUtils.js"
import * as Maestro from "./Maestro.js"

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create common headers for Maestro API requests
 */
const createHeaders = (apiKey: string): Record<string, string> => ({
  "api-key": apiKey,
  "User-Agent": "evolution-sdk"
})

/**
 * Create headers with amounts-as-strings for UTxO queries
 * This is a Maestro-specific optimization for better decimal handling
 */
const createHeadersWithAmounts = (apiKey: string): Record<string, string> => ({
  "api-key": apiKey,
  "User-Agent": "evolution-sdk",
  "amounts-as-strings": "true"
})

/**
 * Wrap HTTP errors into ProviderError following Kupmios pattern
 */
const wrapError = (operation: string) => (error: unknown) =>
  new ProviderError({
    message: `Failed to ${operation}`,
    cause: error
  })

// ============================================================================
// Configuration
// ============================================================================

const TIMEOUT = 10_000 // 10 seconds timeout for requests

// ============================================================================
// Protocol Parameters
// ============================================================================

/**
 * Get protocol parameters from Maestro
 */
export const getProtocolParameters = (baseUrl: string, apiKey: string) =>
  HttpUtils.get(
    `${baseUrl}/protocol-parameters`,
    Maestro.MaestroProtocolParameters,
    createHeaders(apiKey)
  ).pipe(
    Effect.map(Maestro.transformProtocolParameters),
    Effect.timeout(TIMEOUT),
    Effect.catchAll(wrapError("get protocol parameters"))
  )

// ============================================================================
// UTxO Queries
// ============================================================================

/**
 * Get UTxOs by address with cursor pagination
 */
export const getUtxos = (baseUrl: string, apiKey: string) => (addressOrCredential: string | Credential.Credential) =>
  Effect.gen(function* () {
    // Extract address string from Address or Credential
    const addressStr = typeof addressOrCredential === "string" 
      ? addressOrCredential
      : addressOrCredential.hash // Use credential hash directly
    
    // Get all pages of UTxOs
    const allUtxos = yield* getUtxosWithPagination(
      `${baseUrl}/addresses/${addressStr}/utxos`,
      apiKey
    )
    
    return allUtxos.map(Maestro.transformUTxO)
  })

/**
 * Get UTxOs by unit with cursor pagination
 */
export const getUtxosWithUnit = (baseUrl: string, apiKey: string) => (addressOrCredential: string | Credential.Credential, unit: string) =>
  Effect.gen(function* () {
    // For Maestro, we get UTxOs by unit and then filter by address if needed
    // This is different from address-first approach but matches the API design
    const allUtxos = yield* getUtxosWithPagination(
      `${baseUrl}/assets/${unit}/utxos`,
      apiKey
    )
    
    // Transform UTxOs first
    const transformedUtxos = allUtxos.map(Maestro.transformUTxO)
    
    // Filter by address if addressOrCredential is provided
    const addressStr = typeof addressOrCredential === "string" 
      ? addressOrCredential
      : addressOrCredential.hash
    
    // Filter UTxOs that belong to the specified address/credential
    return transformedUtxos.filter(utxo => utxo.address === addressStr)
  })

/**
 * Get UTxOs by output references
 */
export const getUtxosByOutRef = (baseUrl: string, apiKey: string) => (outRefs: ReadonlyArray<OutRef.OutRef>) =>
  Effect.gen(function* () {
    // Maestro supports batch UTxO resolution via POST with output references
    const outputReferences = Array.from(outRefs).map(({ outputIndex, txHash }) => `${txHash}#${outputIndex}`)
    
    const response = yield* HttpUtils.postJson(
      `${baseUrl}/utxos/batch`,
      { output_references: outputReferences },
      Schema.Array(Maestro.MaestroUTxO),
      createHeadersWithAmounts(apiKey)
    ).pipe(
      Effect.timeout(TIMEOUT),
      Effect.catchAll(wrapError("get UTxOs by outRef"))
    )
    
    return response.map(Maestro.transformUTxO)
  })

// ============================================================================
// Delegation
// ============================================================================

/**
 * Get delegation info for a credential
 */
export const getDelegation = (baseUrl: string, apiKey: string) => (rewardAddress: string) =>
  HttpUtils.get(
    `${baseUrl}/accounts/${rewardAddress}`,
    Maestro.MaestroDelegation,
    createHeaders(apiKey)
  ).pipe(
    Effect.map(Maestro.transformDelegation),
    Effect.timeout(TIMEOUT),
    Effect.catchAll(wrapError("get delegation"))
  )

// ============================================================================
// Transaction Submission
// ============================================================================

/**
 * Submit transaction to Maestro
 */
export const submitTx = (baseUrl: string, apiKey: string, turboSubmit?: boolean) => (cbor: string) =>
  Effect.gen(function* () {
    const endpoint = turboSubmit ? "/turbo/submit" : "/submit"
    
    // Convert hex string to Uint8Array for submission
    const txBytes = new Uint8Array(Buffer.from(cbor, "hex"))
    
    const response = yield* HttpUtils.postUint8Array(
      `${baseUrl}${endpoint}`,
      txBytes,
      Schema.String, // Expecting transaction hash as response
      createHeaders(apiKey)
    ).pipe(
      Effect.timeout(TIMEOUT),
      Effect.catchAll(wrapError("submit transaction"))
    )
    
    return response
  })

// ============================================================================
// Transaction Evaluation
// ============================================================================

/**
 * Evaluate transaction with Maestro
 */
export const evaluateTx = (baseUrl: string, apiKey: string) => (tx: string, additionalUTxOs?: Array<{ txHash: string; outputIndex: number }>) =>
  Effect.gen(function* () {
    const requestBody = {
      transaction: tx,
      ...(additionalUTxOs && { 
        additional_utxo_set: additionalUTxOs.map(utxo => ({
          txHash: utxo.txHash,
          outputIndex: utxo.outputIndex
        }))
      })
    }
    
    const response = yield* HttpUtils.postJson(
      `${baseUrl}/evaluate`,
      requestBody,
      Schema.Array(Schema.Any), // Will need proper evaluation response schema
      createHeaders(apiKey)
    ).pipe(
      Effect.timeout(TIMEOUT),
      Effect.catchAll(wrapError("evaluate transaction"))
    )
    
    // Transform response to match Evolution SDK format
    return response as Array<EvalRedeemer>
  })

/**
 * Get single UTxO by unit (asset policy + name)
 */
export const getUtxoByUnit = (baseUrl: string, apiKey: string) => (unit: string) =>
  Effect.gen(function* () {
    // Get first UTxO containing this unit
    const utxos = yield* getUtxosWithPagination(
      `${baseUrl}/assets/${unit}/utxos`,
      apiKey,
      1 // Just get the first one
    ).pipe(
      Effect.timeout(TIMEOUT),
      Effect.catchAll(wrapError("get UTxO by unit"))
    )
    
    if (utxos.length === 0) {
      return yield* Effect.fail(
        new ProviderError({
          cause: new Error("No UTxO found for unit"),
          message: "UTxO not found"
        })
      )
    }
    
    return Maestro.transformUTxO(utxos[0])
  })

/**
 * Get datum by datum hash
 */
export const getDatum = (baseUrl: string, apiKey: string) => (datumHash: string) =>
  Effect.gen(function* () {
    const response = yield* HttpUtils.get(
      `${baseUrl}/datums/${datumHash}`,
      Schema.Struct({
        bytes: Schema.String
      }),
      {
        'api-key': apiKey,
        'accept': 'application/json'
      }
    ).pipe(
      Effect.timeout(TIMEOUT),
      Effect.catchAll(wrapError("get datum"))
    )
    
    return response.bytes
  })

/**
 * Wait for transaction confirmation
 */
export const awaitTx = (baseUrl: string, apiKey: string) => (txHash: string, checkInterval?: number) =>
  Effect.gen(function* () {
    const interval = checkInterval || 5000 // Default 5 seconds
    
    while (true) {
      // Check if transaction exists and is confirmed
      const result = yield* HttpUtils.get(
        `${baseUrl}/transactions/${txHash}`,
        Schema.Struct({
          hash: Schema.String,
          block: Schema.optional(Schema.Struct({
            hash: Schema.String,
            slot: Schema.Number
          }))
        }),
        createHeaders(apiKey)
      ).pipe(
        Effect.timeout(TIMEOUT),
        Effect.catchAll(wrapError("await transaction")),
        Effect.either
      )
      
      // If successful and we have a block, transaction is confirmed
      if (result._tag === "Right" && result.right.block) {
        return true
      }
      
      // Wait before checking again
      yield* Effect.sleep(`${interval} millis`)
    }
  })

// ============================================================================
// Pagination Helpers
// ============================================================================

/**
 * Get all pages of UTxOs using cursor pagination
 */
const getUtxosWithPagination = (url: string, apiKey: string, maxCount?: number) =>
  Effect.gen(function* () {
    let allUtxos: Array<Schema.Schema.Type<typeof Maestro.MaestroUTxO>> = []
    let cursor: string | undefined = undefined
    
    while (true) {
      // Build URL with cursor if available
      const requestUrl: string = cursor ? `${url}?cursor=${cursor}` : url
      
      const page = yield* HttpUtils.get(
        requestUrl,
        Maestro.MaestroPaginatedResponse(Maestro.MaestroUTxO),
        createHeadersWithAmounts(apiKey) // Use amounts-as-strings for better precision
      ).pipe(
        Effect.timeout(TIMEOUT),
        Effect.catchAll(wrapError("get paginated UTxOs"))
      )
      
      allUtxos = [...allUtxos, ...page.data]
      
      // Check if we should stop pagination
      if (!page.next_cursor || (maxCount && allUtxos.length >= maxCount)) {
        break
      }
      
      cursor = page.next_cursor
    }
    
    // Trim to exact count if specified
    return maxCount ? allUtxos.slice(0, maxCount) : allUtxos
  })