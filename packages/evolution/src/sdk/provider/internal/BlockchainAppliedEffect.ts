/**
 * @fileoverview Effect-based Blockchain Applied (BCA) provider functions.
 * Internal module implementing all provider operations using the Effect pattern.
 */

import { HttpClientError } from "@effect/platform"
import { Effect, Option, Schedule, Schema } from "effect"

import * as CoreAddress from "../../../Address.js"
import * as AssetName from "../../../AssetName.js"
import * as CoreAssets from "../../../Assets.js"
import * as Bytes from "../../../Bytes.js"
import * as Credential from "../../../Credential.js"
import * as PlutusData from "../../../Data.js"
import type * as DatumHash from "../../../DatumHash.js"
import type * as DatumOption from "../../../DatumOption.js"
import * as NativeScripts from "../../../NativeScripts.js"
import * as PolicyId from "../../../PolicyId.js"
import type * as RewardAddress from "../../../RewardAddress.js"
import type * as Script from "../../../Script.js"
import * as Transaction from "../../../Transaction.js"
import * as TransactionHash from "../../../TransactionHash.js"
import type * as TransactionInput from "../../../TransactionInput.js"
import * as CoreUTxO from "../../../UTxO.js"
import * as Provider from "../Provider.js"
import * as BCA from "./BlockchainApplied.js"
import * as HttpUtils from "./HttpUtils.js"

const PAGE_SIZE = 100
const TIMEOUT = 10_000

const bearerHeaders = (token?: string): Record<string, string> | undefined =>
  token ? { Authorization: `Bearer ${token}` } : undefined

const wrapError = (operation: string) => (cause: unknown) =>
  Effect.fail(
    new Provider.ProviderError({
      message: `BlockchainApplied ${operation} failed`,
      cause
    })
  )

const getAddressPath = (addressOrCredential: CoreAddress.Address | Credential.Credential): string =>
  "hash" in addressOrCredential ? Credential.toBech32(addressOrCredential) : CoreAddress.toBech32(addressOrCredential)

const is404 = (error: unknown): boolean =>
  error instanceof HttpClientError.ResponseError && error.response.status === 404

// ============================================================================
// Script / datum resolution
// ============================================================================
// BCA's UtxoResponse carries inline_datum / reference_script_cbor directly
// when available; only fall back to a separate lookup by hash for older
// rows that predate those fields.

const fetchScript =
  (baseUrl: string, headers: Record<string, string> | undefined) =>
  (scriptHash: string): Effect.Effect<Script.Script | undefined, unknown> =>
    HttpUtils.get(`${baseUrl}/script/${scriptHash}`, BCA.Envelope(BCA.ScriptDetails), headers).pipe(
      Effect.timeout(TIMEOUT),
      Effect.map((response) => BCA.transformScript(response.details))
    )

const fetchDatumOption =
  (baseUrl: string, headers: Record<string, string> | undefined) =>
  (datumHash: string): Effect.Effect<DatumOption.DatumOption, unknown> =>
    HttpUtils.get(`${baseUrl}/datum/${datumHash}`, BCA.Envelope(BCA.DatumDetails), headers).pipe(
      Effect.timeout(TIMEOUT),
      Effect.map((response) => BCA.inlineDatumFromCBORHex(response.details.bytes))
    )

const resolveUtxo =
  (baseUrl: string, headers: Record<string, string> | undefined) =>
  (item: BCA.UtxoResponse): Effect.Effect<CoreUTxO.UTxO, unknown> => {
    const scriptEffect =
      item.reference_script_cbor && item.reference_script_type
        ? Effect.succeed(BCA.transformScript({ type: item.reference_script_type, bytes: item.reference_script_cbor }))
        : item.reference_script_hash
          ? fetchScript(
              baseUrl,
              headers
            )(item.reference_script_hash).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
          : Effect.succeed(undefined)

    const datumEffect = item.inline_datum
      ? Effect.succeed(BCA.inlineDatumFromCBORHex(item.inline_datum))
      : item.datum_hash
        ? fetchDatumOption(
            baseUrl,
            headers
          )(item.datum_hash).pipe(Effect.catchAll(() => Effect.succeed(BCA.datumHashFromHex(item.datum_hash!))))
        : Effect.succeed(undefined)

    return Effect.all([scriptEffect, datumEffect]).pipe(
      Effect.map(
        ([scriptRef, datumOption]) =>
          new CoreUTxO.UTxO({
            transactionId: TransactionHash.fromHex(item.tx_hash),
            index: BigInt(item.output_index),
            address: CoreAddress.fromBech32(item.address),
            assets: BCA.transformAssets(item.lovelace, item.assets),
            datumOption,
            scriptRef
          })
      )
    )
  }

// ============================================================================
// Paginated UTxO fetch (GET /utxos/{address}, GET /assets/{unit}/utxos)
// ============================================================================

const fetchAllUtxoPages = (url: string, headers: Record<string, string> | undefined) =>
  Effect.gen(function* () {
    let all: Array<BCA.UtxoResponse> = []
    // BCA pages are 0-indexed (CIP-30 Paginate convention).
    let page = 0
    while (true) {
      const response = yield* HttpUtils.get(
        `${url}${url.includes("?") ? "&" : "?"}page=${page}&pagesize=${PAGE_SIZE}`,
        BCA.PaginatedUtxoResponse,
        headers
      ).pipe(Effect.timeout(TIMEOUT))
      all = all.concat(response.data)
      if (!response.has_next) break
      page += 1
    }
    return all
  })

// ============================================================================
// Protocol parameters
// ============================================================================

export const getProtocolParameters = (baseUrl: string, token?: string) =>
  HttpUtils.get(`${baseUrl}/protocol_parameters/latest`, BCA.ProtocolParametersResponse, bearerHeaders(token)).pipe(
    Effect.map(BCA.transformProtocolParameters),
    Effect.timeout(TIMEOUT),
    Effect.catchAll(wrapError("getProtocolParameters"))
  )

// ============================================================================
// UTxOs
// ============================================================================

export const getUtxos =
  (baseUrl: string, token?: string) => (addressOrCredential: CoreAddress.Address | Credential.Credential) => {
    const headers = bearerHeaders(token)
    const addressPath = getAddressPath(addressOrCredential)
    return fetchAllUtxoPages(`${baseUrl}/utxos/${addressPath}`, headers).pipe(
      Effect.flatMap((utxos) => Effect.forEach(utxos, resolveUtxo(baseUrl, headers), { concurrency: 10 })),
      Effect.catchAll(wrapError("getUtxos"))
    )
  }

export const getUtxosWithUnit =
  (baseUrl: string, token?: string) =>
  (addressOrCredential: CoreAddress.Address | Credential.Credential, unit: string) => {
    const headers = bearerHeaders(token)
    const addressPath = getAddressPath(addressOrCredential)
    return fetchAllUtxoPages(`${baseUrl}/utxos/${addressPath}`, headers).pipe(
      Effect.map((utxos) => utxos.filter((utxo) => utxo.assets.some((a) => `${a.policy_id}${a.asset_name}` === unit))),
      Effect.flatMap((utxos) => Effect.forEach(utxos, resolveUtxo(baseUrl, headers), { concurrency: 10 })),
      Effect.catchAll(wrapError("getUtxosWithUnit"))
    )
  }

export const getUtxoByUnit = (baseUrl: string, token?: string) => (unit: string) => {
  const headers = bearerHeaders(token)
  return fetchAllUtxoPages(`${baseUrl}/assets/${unit}/utxos`, headers).pipe(
    Effect.flatMap((utxos) => {
      if (utxos.length === 0) {
        return Effect.fail(new Provider.ProviderError({ message: "No UTxO found for unit", cause: "Not found" }))
      }
      if (utxos.length > 1) {
        return Effect.fail(
          new Provider.ProviderError({
            message: "Unit needs to be an NFT or only held by one address.",
            cause: "Multiple UTxOs found"
          })
        )
      }
      return resolveUtxo(baseUrl, headers)(utxos[0])
    }),
    Effect.catchAll(wrapError("getUtxoByUnit"))
  )
}

export const getUtxosByOutRef =
  (baseUrl: string, token?: string) => (inputs: ReadonlyArray<TransactionInput.TransactionInput>) => {
    const headers = bearerHeaders(token)

    return Effect.forEach(
      inputs,
      (input) => {
        const txHash = TransactionHash.toHex(input.transactionId)
        return HttpUtils.get(`${baseUrl}/utxo/${txHash}/${Number(input.index)}`, BCA.UtxoResponse, headers).pipe(
          Effect.timeout(TIMEOUT),
          Effect.flatMap(resolveUtxo(baseUrl, headers)),
          Effect.map((utxo) => Option.some(utxo)),
          Effect.catchIf(is404, () => Effect.succeed(Option.none())),
          Effect.catchAll(wrapError("getUtxosByOutRef"))
        )
      },
      { concurrency: 10 }
    ).pipe(Effect.map((results) => results.filter(Option.isSome).map((result) => result.value)))
  }

// ============================================================================
// Delegation
// ============================================================================

export const getDelegation = (baseUrl: string, token?: string) => (rewardAddress: RewardAddress.RewardAddress) =>
  HttpUtils.get(`${baseUrl}/staking/${rewardAddress}`, BCA.StakingResponse, bearerHeaders(token)).pipe(
    Effect.timeout(TIMEOUT),
    Effect.map(BCA.transformDelegation),
    // 404 — stake address not registered/never delegated.
    Effect.catchIf(is404, () => Effect.succeed({ poolId: null, rewards: 0n } as Provider.Delegation)),
    Effect.catchAll(wrapError("getDelegation"))
  )

// ============================================================================
// Datum
// ============================================================================

export const getDatum = (baseUrl: string, token?: string) => (datumHash: DatumHash.DatumHash) => {
  const datumHashHex = Bytes.toHex(datumHash.hash)
  return HttpUtils.get(`${baseUrl}/datum/${datumHashHex}`, BCA.Envelope(BCA.DatumDetails), bearerHeaders(token)).pipe(
    Effect.timeout(TIMEOUT),
    Effect.flatMap((response) =>
      Effect.try({
        try: () => Schema.decodeSync(PlutusData.FromCBORHex())(response.details.bytes),
        catch: (error) => new Provider.ProviderError({ message: "Failed to parse datum CBOR", cause: error })
      })
    ),
    Effect.catchAll(wrapError("getDatum"))
  )
}

// ============================================================================
// awaitTx
// ============================================================================

export const awaitTx =
  (baseUrl: string, token?: string) =>
  (txHash: TransactionHash.TransactionHash, checkInterval = 20_000, timeout = 160_000) => {
    const txHashHex = TransactionHash.toHex(txHash)
    const headers = bearerHeaders(token)

    // GET /tx/{hash} 404s until the tx is indexed, 200s once confirmed.
    const checkTx = HttpUtils.get(`${baseUrl}/tx/${txHashHex}`, BCA.TransactionResponse, headers).pipe(
      Effect.timeout(TIMEOUT)
    )

    return Effect.retry(checkTx, Schedule.spaced(`${checkInterval} millis`)).pipe(
      Effect.timeout(timeout),
      Effect.as(true),
      Effect.catchAllCause((cause) =>
        Effect.fail(new Provider.ProviderError({ cause, message: "BlockchainApplied awaitTx failed" }))
      )
    )
  }

// ============================================================================
// submitTx / evaluateTx
// ============================================================================

export const submitTx = (baseUrl: string, token?: string) => (tx: Transaction.Transaction) =>
  HttpUtils.postUint8Array(
    `${baseUrl}/tx/submit`,
    Transaction.toCBORBytes(tx),
    BCA.SubmitResponse,
    bearerHeaders(token)
  ).pipe(
    Effect.timeout(TIMEOUT),
    Effect.map((response) => TransactionHash.fromHex(response.tx_hash)),
    Effect.catchAll(wrapError("submitTx"))
  )

const toAdditionalUtxo = (utxo: CoreUTxO.UTxO): BCA.UtxoResponse => ({
  tx_hash: TransactionHash.toHex(utxo.transactionId),
  output_index: Number(utxo.index),
  address: CoreAddress.toBech32(utxo.address),
  lovelace: utxo.assets.lovelace.toString(),
  assets: CoreAssets.flatten(utxo.assets)
    .filter(([, , quantity]) => quantity !== 0n)
    .map(([policyId, assetName, quantity]) => ({
      policy_id: PolicyId.toHex(policyId),
      asset_name: AssetName.toHex(assetName),
      quantity: quantity.toString()
    })),
  datum_hash: utxo.datumOption?._tag === "DatumHash" ? Bytes.toHex(utxo.datumOption.hash) : undefined,
  inline_datum: utxo.datumOption?._tag === "InlineDatum" ? PlutusData.toCBORHex(utxo.datumOption.data) : undefined,
  ...toReferenceScriptFields(utxo.scriptRef)
})

const toReferenceScriptFields = (
  script: Script.Script | undefined
): { reference_script_cbor: string; reference_script_type: string } | Record<string, never> => {
  if (!script) return {}
  switch (script._tag) {
    case "PlutusV1":
      return { reference_script_cbor: Bytes.toHex(script.bytes), reference_script_type: "plutusV1" }
    case "PlutusV2":
      return { reference_script_cbor: Bytes.toHex(script.bytes), reference_script_type: "plutusV2" }
    case "PlutusV3":
      return { reference_script_cbor: Bytes.toHex(script.bytes), reference_script_type: "plutusV3" }
    case "NativeScript":
      return { reference_script_cbor: NativeScripts.toCBORHex(script), reference_script_type: "timelock" }
  }
}

export const evaluateTx =
  (baseUrl: string, token?: string) => (tx: Transaction.Transaction, additionalUTxOs?: Array<CoreUTxO.UTxO>) => {
    const body = {
      cbor: Transaction.toCBORHex(tx),
      ...(additionalUTxOs && additionalUTxOs.length > 0
        ? { additional_utxos: additionalUTxOs.map(toAdditionalUtxo) }
        : {})
    }

    return HttpUtils.postJson(
      `${baseUrl}/tx/evaluate`,
      body,
      Schema.Array(BCA.EvalRedeemerResponse),
      bearerHeaders(token)
    ).pipe(
      Effect.timeout(TIMEOUT),
      Effect.map((response) => response.map(BCA.transformEvalRedeemer)),
      Effect.catchAll(wrapError("evaluateTx"))
    )
  }
