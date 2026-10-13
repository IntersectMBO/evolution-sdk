import { Effect, pipe, Schedule, Schema } from "effect"

import * as CoreAddress from "../../../Address.js"
import * as CoreAssets from "../../../Assets.js"
import * as Bytes from "../../../Bytes.js"
import * as Credential from "../../../Credential.js"
import * as PlutusData from "../../../Data.js"
import type * as DatumHash from "../../../DatumHash.js"
import * as PolicyId from "../../../PolicyId.js"
import * as PoolKeyHash from "../../../PoolKeyHash.js"
import * as Redeemer from "../../../Redeemer.js"
import type * as CoreRewardAddress from "../../../RewardAddress.js"
import * as Transaction from "../../../Transaction.js"
import * as TransactionHash from "../../../TransactionHash.js"
import type * as TransactionInput from "../../../TransactionInput.js"
import * as AssetsUnit from "../../../Unit.js"
import type * as CoreUTxO from "../../../UTxO.js"
import type * as EvalRedeemer from "../../EvalRedeemer.js"
import * as Provider from "../Provider.js"
import * as HttpUtils from "./HttpUtils.js"
import * as _Koios from "./Koios.js"
import * as _Ogmios from "./Ogmios.js"

/** Re-exported from the leaf both query tiers import, so neither has to reach for the other. */
export const DEFAULT_REQUEST_TIMEOUT_MS = _Koios.DEFAULT_REQUEST_TIMEOUT_MS

/**
 * Wrap errors into ProviderError
 */
const wrapError = (operation: string) => (cause: unknown) =>
  Effect.fail(
    new Provider.ProviderError({
      message: `Koios ${operation} failed`,
      cause
    })
  )

export const getProtocolParameters = (
  baseUrl: string,
  token?: _Koios.TokenSource,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
) =>
  Effect.gen(function* () {
    const url = `${baseUrl}/epoch_params?limit=1&order=epoch_no.desc`
    const schema = Schema.Array(_Koios.ProtocolParametersSchema)
    const bearerToken = _Koios.authHeader(token)
    const [result] = yield* pipe(
      HttpUtils.get(url, schema, bearerToken, timeoutMs),
      Effect.catchAll(wrapError("getProtocolParameters"))
    )

    return _Koios.toProtocolParameters(result)
  })

export const getTip =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  () =>
    pipe(
      HttpUtils.get(`${baseUrl}/tip`, Schema.Array(_Koios.TipSchema), _Koios.authHeader(token), timeoutMs),
      Effect.flatMap((rows) =>
        rows.length === 0
          ? Effect.fail(new Provider.ProviderError({ cause: "Empty tip", message: "Koios returned no tip" }))
          : Effect.succeed(rows[0])
      ),
      Effect.map((row): Provider.Tip => ({
        slot: row.abs_slot,
        blockHash: row.hash,
        epoch: row.epoch_no,
        blockHeight: row.block_no ?? undefined,
        blockTime: row.block_time ?? undefined
      })),
      Effect.catchAll(wrapError("getTip"))
    )

const getUtxosForAddressOrCredential = (
  baseUrl: string,
  addressOrCredential: CoreAddress.Address | Credential.Credential,
  token?: _Koios.TokenSource,
  timeoutMs?: number
) => {
  const headers = _Koios.authHeader(token)
  if (!("hash" in addressOrCredential)) {
    return _Koios.getUtxosEffect(baseUrl, CoreAddress.toBech32(addressOrCredential), headers, timeoutMs)
  }
  // ⚠️ This arm PAGES. The ceiling has to reach the per-page request, which is why it travels
  // down rather than being wrapped around the call: one address is one request, one credential
  // can be several, and the old whole-operation timeout treated them the same.
  return _Koios.getCredentialUtxosEffect(baseUrl, Credential.toHex(addressOrCredential), headers, timeoutMs)
}

export const getUtxos =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (addressOrCredential: CoreAddress.Address | Credential.Credential) =>
    pipe(
      getUtxosForAddressOrCredential(baseUrl, addressOrCredential, token, timeoutMs),
      Effect.catchAll(wrapError("getUtxos"))
    )

export const getUtxosWithUnit =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (addressOrCredential: CoreAddress.Address | Credential.Credential, unit: string) =>
    pipe(
      getUtxosForAddressOrCredential(baseUrl, addressOrCredential, token, timeoutMs),
      Effect.map((utxos) =>
        utxos.filter((utxo) => {
          const units = CoreAssets.getUnits(utxo.assets)
          return units.length > 0 && units.includes(unit)
        })
      ),
      Effect.catchAll(wrapError("getUtxosWithUnit"))
    )

export const getUtxoByUnit =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (unit: string) =>
    pipe(
      Effect.sync(() => AssetsUnit.fromUnit(unit)),
      Effect.flatMap(({ assetName, policyId }) => {
        const policyIdHex = PolicyId.toHex(policyId)
        const assetNameHex = assetName ? Bytes.toHex(assetName.bytes) : ""
        const url = `${baseUrl}/asset_addresses?_asset_policy=${policyIdHex}&_asset_name=${assetNameHex}`
        const bearerToken = _Koios.authHeader(token)

        return pipe(
          HttpUtils.get(url, Schema.Array(_Koios.AssetAddressSchema), bearerToken, timeoutMs),
          Effect.flatMap((addresses) =>
            addresses.length === 0
              ? Effect.fail(new Provider.ProviderError({ cause: "Unit not found", message: "Unit not found" }))
              : Effect.succeed(addresses)
          ),
          Effect.flatMap((addresses) =>
            addresses.length > 1
              ? Effect.fail(
                  new Provider.ProviderError({
                    cause: "Multiple addresses found",
                    message: "Unit needs to be an NFT or only held by one address."
                  })
                )
              : Effect.succeed(addresses[0])
          ),
          Effect.flatMap((address) => _Koios.getUtxosEffect(baseUrl, address.payment_address, bearerToken)),
          Effect.map((utxos) =>
            utxos.filter((utxo) => {
              const units = CoreAssets.getUnits(utxo.assets)
              return units.length > 0 && units.includes(unit)
            })
          ),
          Effect.flatMap((utxos) =>
            utxos.length > 1
              ? Effect.fail(
                  new Provider.ProviderError({
                    cause: "Multiple UTxOs found",
                    message: "Unit needs to be an NFT or only held by one address."
                  })
                )
              : Effect.succeed(utxos[0])
          )
        )
      }),
      Effect.catchAll(wrapError("getUtxoByUnit"))
    )

/**
 * `/utxo_info`, as the indexer answers it: every requested outpoint it can resolve, with the
 * `is_spent` flag intact.
 *
 * This is the read both outpoint members are built from — {@link getUtxosByOutRef} filters it
 * and {@link resolveOutRefs} does not, so the request and its decoding exist once.
 */
const utxoInfoRows =
  (operation: string) =>
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (inputs: ReadonlyArray<TransactionInput.TransactionInput>) =>
    pipe(
      HttpUtils.postJson(
        `${baseUrl}/utxo_info`,
        {
          _utxo_refs: [
            ...new Set(inputs.map((input) => `${TransactionHash.toHex(input.transactionId)}#${input.index}`))
          ],
          _extended: true
        },
        Schema.Array(_Koios.CredentialUTxOSchema),
        _Koios.authHeader(token),
        timeoutMs
      ),
      Effect.catchAll(wrapError(operation))
    )

export const getUtxosByOutRef =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (inputs: ReadonlyArray<TransactionInput.TransactionInput>) =>
    Effect.map(
      utxoInfoRows("getUtxosByOutRef")(baseUrl, token, timeoutMs)(inputs),
      // ⚠️ `/utxo_info` resolves SPENT outputs as readily as unspent ones, so the rows
      // have to be filtered: this method's name promises UTxOs, and handing a consumed
      // output to the builder produces a transaction the node rejects. An outpoint that
      // is gone is simply absent from the answer, which the builder reports as a missing
      // input rather than discovering at submit time. A caller asking about liveness wants
      // `resolveOutRefs`, which keeps the row and the flag.
      (rows) => rows.filter((u) => u.is_spent !== true).map(_Koios.extendedRowToUTxO)
    )

/**
 * The same resolution, unfiltered and flagged — see `ProviderEffect.resolveOutRefs`.
 *
 * `is_spent` is optional on the row shape because `/credential_utxos` only carries it with
 * `_extended`; this request always asks for it, so an absent flag here means the indexer did
 * not answer the question rather than that the output is live.
 */
export const resolveOutRefs =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (inputs: ReadonlyArray<TransactionInput.TransactionInput>) =>
    Effect.map(utxoInfoRows("resolveOutRefs")(baseUrl, token, timeoutMs)(inputs), (rows) =>
      rows.map((row) => ({
        utxo: _Koios.extendedRowToUTxO(row),
        ...(row.is_spent === undefined ? {} : { spent: row.is_spent })
      }))
    )

export const getDelegation =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (rewardAddress: CoreRewardAddress.RewardAddress) =>
    Effect.gen(function* () {
      const body = {
        _stake_addresses: [rewardAddress]
      }
      const url = `${baseUrl}/account_info`
      const bearerToken = _Koios.authHeader(token)

      const result = yield* pipe(
        HttpUtils.postJson(url, body, Schema.Array(_Koios.AccountInfoSchema), bearerToken, timeoutMs),
        Effect.flatMap((result) =>
          result.length === 0
            ? Effect.fail(
                new Provider.ProviderError({
                  cause: "No delegation found",
                  message: "No Delegation Found by Reward Address"
                })
              )
            : Effect.succeed(result[0])
        ),
        Effect.catchAll(wrapError("getDelegation"))
      )

      return {
        poolId: result.delegated_pool ? Schema.decodeSync(PoolKeyHash.FromBech32)(result.delegated_pool) : null,
        rewards: result.rewards_available,
        // Koios reports `registered` / `not registered`. Absent rather than guessed if a deployment
        // does not send the field at all.
        registered: result.status === undefined ? undefined : result.status === "registered"
      } satisfies Provider.Delegation
    })

export const getDatum =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (datumHash: DatumHash.DatumHash) =>
    Effect.gen(function* () {
      const datumHashHex = Bytes.toHex(datumHash.hash)
      const body = {
        _datum_hashes: [datumHashHex]
      }
      const url = `${baseUrl}/datum_info`
      const bearerToken = _Koios.authHeader(token)

      const result = yield* pipe(
        HttpUtils.postJson(url, body, Schema.Array(_Koios.DatumInfo), bearerToken, timeoutMs),
        Effect.flatMap((result) =>
          result.length === 0
            ? Effect.fail(
                new Provider.ProviderError({
                  cause: "No datum found",
                  message: "No Datum Found by Datum Hash"
                })
              )
            : Effect.succeed(result[0])
        ),
        Effect.catchAll(wrapError("getDatum"))
      )

      return Schema.decodeSync(PlutusData.FromCBORHex())(result.bytes)
    })

/**
 * ⚠️ **Two different ceilings, and they are not interchangeable.** `timeoutMs` bounds each poll's
 * request; `timeout` bounds the whole wait across many polls. Folding one into the other would
 * either cap a confirmation wait at a single request's worth — reporting an unconfirmed
 * transaction as a provider failure — or leave each poll able to hang for the entire wait.
 */
export const awaitTx =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (txHash: TransactionHash.TransactionHash, checkInterval = 20000, timeout = 160_000) =>
    Effect.gen(function* () {
      const txHashHex = TransactionHash.toHex(txHash)
      const body = {
        _tx_hashes: [txHashHex]
      }
      const url = `${baseUrl}/tx_info`
      const bearerToken = _Koios.authHeader(token)

      const result = yield* pipe(
        HttpUtils.postJson(url, body, Schema.Array(_Koios.TxConfirmationSchema), bearerToken, timeoutMs),
        Effect.repeat({
          schedule: Schedule.exponential(checkInterval),
          until: (result) => result.length > 0
        }),
        Effect.timeout(timeout),
        Effect.catchAllCause((cause) =>
          Effect.fail(new Provider.ProviderError({ cause, message: "Koios awaitTx failed" }))
        ),
        Effect.as(true)
      )

      return result
    })

export const submitTx =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (tx: Transaction.Transaction) =>
    Effect.gen(function* () {
      const txCborBytes = Transaction.toCBORBytes(tx)
      const url = `${baseUrl}/submittx`
      const bearerToken = _Koios.authHeader(token)

      const result = yield* pipe(
        HttpUtils.postUint8Array(url, txCborBytes, _Koios.TxHashSchema, bearerToken, timeoutMs),
        Effect.catchAll(wrapError("submitTx"))
      )

      return Schema.decodeSync(TransactionHash.FromHex)(result)
    })

export const evaluateTx =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) =>
  (
    tx: Transaction.Transaction,
    additionalUTxOs?: Array<CoreUTxO.UTxO>
  ): Effect.Effect<Array<EvalRedeemer.EvalRedeemer>, Provider.ProviderError> =>
    Effect.gen(function* () {
      const txCborHex = Transaction.toCBORHex(tx)
      const url = `${baseUrl}/ogmios`
      // Use Core UTxOs directly with Ogmios format
      const data: _Ogmios.EvaluateTransaction = {
        jsonrpc: "2.0",
        method: "evaluateTransaction",
        params: {
          transaction: { cbor: txCborHex },
          additionalUtxo: _Ogmios.toOgmiosUTxOs(additionalUTxOs)
        },
        id: null
      }
      const schema = _Ogmios.JSONRPCSchema(Schema.Array(_Ogmios.RedeemerSchema))
      const bearerToken = _Koios.authHeader(token)

      const { result } = yield* pipe(
        Schema.encode(_Ogmios.EvaluateTransactionSchema)(data),
        Effect.flatMap((body) => HttpUtils.postJson(url, body, schema, bearerToken, timeoutMs)),
        Effect.catchAll(wrapError("evaluateTx"))
      )

      const evalRedeemers = result.map((item) => {
        // Map Ogmios terminology to Core terminology
        const purpose = item.validator.purpose as string
        let tag: Redeemer.RedeemerTag
        if (purpose === "publish") tag = "cert"
        else if (purpose === "withdraw") tag = "reward"
        else tag = purpose as Redeemer.RedeemerTag

        return {
          ex_units: new Redeemer.ExUnits({
            mem: item.budget.memory,
            steps: item.budget.cpu
          }),
          redeemer_index: Number(item.validator.index),
          redeemer_tag: tag
        }
      })

      return evalRedeemers
    })
