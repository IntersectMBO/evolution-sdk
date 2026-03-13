/**
 * @fileoverview Maestro Effect-based provider functions
 * Internal module implementing curry pattern with rate limiting
 */

import { Effect, Schema } from "effect"

import * as CoreAddress from "../../../Address.js"
import * as Bytes from "../../../Bytes.js"
import type * as Credential from "../../../Credential.js"
import * as PlutusData from "../../../Data.js"
import type * as DatumHash from "../../../DatumHash.js"
import * as Transaction from "../../../Transaction.js"
import * as TransactionHash from "../../../TransactionHash.js"
import type * as TransactionInput from "../../../TransactionInput.js"
import type * as CoreUTxO from "../../../UTxO.js"
import type { EvalRedeemer } from "../../EvalRedeemer.js"
import { ProviderError } from "../Provider.js"
import * as HttpUtils from "./HttpUtils.js"
import * as Maestro from "./Maestro.js"
import * as Ogmios from "./Ogmios.js"

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
  HttpUtils.get(`${baseUrl}/protocol-parameters`, Maestro.MaestroProtocolParameters, createHeaders(apiKey)).pipe(
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
export const getUtxos =
  (baseUrl: string, apiKey: string) => (addressOrCredential: CoreAddress.Address | Credential.Credential) =>
    Effect.gen(function* () {
      // Extract address string from Address or Credential
      const addressStr =
        addressOrCredential instanceof CoreAddress.Address
          ? CoreAddress.toBech32(addressOrCredential)
          : addressOrCredential.hash // Use credential hash directly

      // Get all pages of UTxOs
      const allUtxos = yield* getUtxosWithPagination(`${baseUrl}/addresses/${addressStr}/utxos`, apiKey)

      return allUtxos.map(Maestro.transformUTxO)
    })

/**
 * Get UTxOs by unit with cursor pagination
 */
export const getUtxosWithUnit =
  (baseUrl: string, apiKey: string) =>
  (addressOrCredential: CoreAddress.Address | Credential.Credential, unit: string) =>
    Effect.gen(function* () {
      // For Maestro, we get UTxOs by unit and then filter by address if needed
      // This is different from address-first approach but matches the API design
      const allUtxos = yield* getUtxosWithPagination(`${baseUrl}/assets/${unit}/utxos`, apiKey)

      // Transform UTxOs first
      const transformedUtxos = allUtxos.map(Maestro.transformUTxO)

      // Filter by address if addressOrCredential is provided
      const addressStr =
        addressOrCredential instanceof CoreAddress.Address
          ? CoreAddress.toBech32(addressOrCredential)
          : addressOrCredential.hash

      // Filter UTxOs that belong to the specified address/credential
      // Use CoreAddress.toBech32 to convert Core Address to string for comparison
      return transformedUtxos.filter((utxo) => CoreAddress.toBech32(utxo.address) === addressStr)
    })

/**
 * Get UTxOs by output references
 */
export const getUtxosByOutRef =
  (baseUrl: string, apiKey: string) => (inputs: ReadonlyArray<TransactionInput.TransactionInput>) =>
    Effect.gen(function* () {
      // Maestro supports batch UTxO resolution via POST with output references
      const outputReferences = Array.from(inputs).map(
        (input) => `${TransactionHash.toHex(input.transactionId)}#${Number(input.index)}`
      )

      const response = yield* HttpUtils.postJson(
        `${baseUrl}/utxos/batch`,
        { output_references: outputReferences },
        Schema.Array(Maestro.MaestroUTxO),
        createHeadersWithAmounts(apiKey)
      ).pipe(Effect.timeout(TIMEOUT), Effect.catchAll(wrapError("get UTxOs by outRef")))

      return response.map(Maestro.transformUTxO)
    })

// ============================================================================
// Delegation
// ============================================================================

/**
 * Get delegation info for a credential
 */
export const getDelegation = (baseUrl: string, apiKey: string) => (rewardAddress: string) =>
  HttpUtils.get(`${baseUrl}/accounts/${rewardAddress}`, Maestro.MaestroDelegation, createHeaders(apiKey)).pipe(
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
export const submitTx = (baseUrl: string, apiKey: string, turboSubmit?: boolean) => (tx: Transaction.Transaction) =>
  Effect.gen(function* () {
    const endpoint = turboSubmit ? "/turbo/submit" : "/submit"

    // Convert Transaction to CBOR bytes for submission
    const txBytes = Transaction.toCBORBytes(tx)

    const response = yield* HttpUtils.postUint8Array(
      `${baseUrl}${endpoint}`,
      txBytes,
      Schema.String, // Expecting transaction hash as response
      createHeaders(apiKey)
    ).pipe(Effect.timeout(TIMEOUT), Effect.catchAll(wrapError("submit transaction")))

    return Schema.decodeSync(TransactionHash.FromHex)(response)
  })

// ============================================================================
// Transaction Evaluation
// ============================================================================

/**
 * Evaluate transaction with Maestro
 */
export const evaluateTx =
  (baseUrl: string, apiKey: string) => (tx: Transaction.Transaction, additionalUTxOs?: Array<CoreUTxO.UTxO>) =>
    Effect.gen(function* () {
      const txCborHex = Transaction.toCBORHex(tx)
      // Use Ogmios format for additional UTxOs
      const ogmiosUtxos = additionalUTxOs ? Ogmios.toOgmiosUTxOs(additionalUTxOs) : undefined

      const requestBody = {
        transaction: txCborHex,
        ...(ogmiosUtxos && {
          additional_utxo_set: ogmiosUtxos.map((utxo) => ({
            txHash: utxo.transaction.id,
            outputIndex: utxo.index
          }))
        })
      }

      const response = yield* HttpUtils.postJson(
        `${baseUrl}/evaluate`,
        requestBody,
        Schema.Array(Schema.Any), // Will need proper evaluation response schema
        createHeaders(apiKey)
      ).pipe(Effect.timeout(TIMEOUT), Effect.catchAll(wrapError("evaluate transaction")))

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
    ).pipe(Effect.timeout(TIMEOUT), Effect.catchAll(wrapError("get UTxO by unit")))

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
export const getDatum = (baseUrl: string, apiKey: string) => (datumHash: DatumHash.DatumHash) =>
  Effect.gen(function* () {
    const datumHashHex = Bytes.toHex(datumHash.hash)
    const response = yield* HttpUtils.get(
      `${baseUrl}/datums/${datumHashHex}`,
      Schema.Struct({
        bytes: Schema.String
      }),
      {
        "api-key": apiKey,
        accept: "application/json"
      }
    ).pipe(Effect.timeout(TIMEOUT), Effect.catchAll(wrapError("get datum")))

    return Schema.decodeSync(PlutusData.FromCBORHex())(response.bytes)
  })

/**
 * Wait for transaction confirmation
 */
export const awaitTx =
  (baseUrl: string, apiKey: string) =>
  (txHash: TransactionHash.TransactionHash, checkInterval?: number, timeout: number = 160_000) => {
    const txHashHex = TransactionHash.toHex(txHash)
    return Effect.gen(function* () {
      const interval = checkInterval || 5000 // Default 5 seconds

      while (true) {
        // Check if transaction exists and is confirmed
        const result = yield* HttpUtils.get(
          `${baseUrl}/transactions/${txHashHex}`,
          Schema.Struct({
            hash: Schema.String,
            block: Schema.optional(
              Schema.Struct({
                hash: Schema.String,
                slot: Schema.Number
              })
            )
          }),
          createHeaders(apiKey)
        ).pipe(Effect.timeout(TIMEOUT), Effect.catchAll(wrapError("await transaction")), Effect.either)

        // If successful and we have a block, transaction is confirmed
        if (result._tag === "Right" && result.right.block) {
          return true
        }

        // Wait before checking again
        yield* Effect.sleep(`${interval} millis`)
      }
    }).pipe(Effect.timeout(timeout), Effect.catchAllCause(
      (cause) => new ProviderError({ cause, message: "Failed to await transaction confirmation" })
    ))
  }

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
      ).pipe(Effect.timeout(TIMEOUT), Effect.catchAll(wrapError("get paginated UTxOs")))

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
