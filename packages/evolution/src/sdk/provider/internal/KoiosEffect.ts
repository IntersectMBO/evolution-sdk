import { FetchHttpClient } from "@effect/platform"
import { Effect, pipe, Schedule, Schema } from "effect"

import * as Bytes from "../../../core/Bytes.js"
import type * as Address from "../../Address.js"
import type * as Credential from "../../Credential.js"
import type * as Delegation from "../../Delegation.js"
import type * as EvalRedeemer from "../../EvalRedeemer.js"
import type * as OutRef from "../../OutRef.js"
import type * as RewardAddress from "../../RewardAddress.js"
import * as Unit from "../../Unit.js"
import type * as UTxO from "../../UTxO.js"
import * as Provider from "../Provider.js"
import * as HttpUtils from "./HttpUtils.js"
import * as _Koios from "./Koios.js"
import * as _Ogmios from "./Ogmios.js"

export const getProtocolParameters = (baseUrl: string, token?: string) =>
  Effect.gen(function* () {
    const url = `${baseUrl}/epoch_params?limit=1`
    const schema = Schema.Array(_Koios.ProtocolParametersSchema)
    const bearerToken = token ? { Authorization: `Bearer ${token}` } : undefined
    const [result] = yield* pipe(
      HttpUtils.get(url, schema, bearerToken),
      // Allows for dependency injection and easier testing
      Effect.timeout(10_000),
      Effect.catchAllCause(
        (cause) => new Provider.ProviderError({ cause, message: "Failed to fetch protocol parameters from Koios" })
      ),
      Effect.provide(FetchHttpClient.layer)
    )

    return {
      minFeeA: result.min_fee_a,
      minFeeB: result.min_fee_b,
      maxTxSize: result.max_tx_size,
      maxValSize: result.max_val_size,
      keyDeposit: result.key_deposit,
      poolDeposit: result.pool_deposit,
      drepDeposit: BigInt(result.drep_deposit),
      govActionDeposit: BigInt(result.gov_action_deposit),
      priceMem: result.price_mem,
      priceStep: result.price_step,
      maxTxExMem: result.max_tx_ex_mem,
      maxTxExSteps: result.max_tx_ex_steps,
      coinsPerUtxoByte: result.coins_per_utxo_size,
      collateralPercentage: result.collateral_percent,
      maxCollateralInputs: result.max_collateral_inputs,
      minFeeRefScriptCostPerByte: result.min_fee_ref_script_cost_per_byte,
      costModels: {
        PlutusV1: Object.fromEntries(result.cost_models.PlutusV1.map((value, index) => [index.toString(), value])),
        PlutusV2: Object.fromEntries(result.cost_models.PlutusV2.map((value, index) => [index.toString(), value])),
        PlutusV3: Object.fromEntries(result.cost_models.PlutusV3.map((value, index) => [index.toString(), value]))
      }
    }
  })

export const getUtxos =
  (baseUrl: string, token?: string) => (addressOrCredential: Address.Address | Credential.Credential) =>
    pipe(
      _Koios.getUtxosEffect(baseUrl, addressOrCredential, token ? { Authorization: `Bearer ${token}` } : undefined),
      Effect.timeout(10_000),
      Effect.catchAllCause(
        (cause) => new Provider.ProviderError({ cause, message: "Failed to fetch UTxOs from Koios" })
      )
    )

export const getUtxosWithUnit =
  (baseUrl: string, token?: string) =>
  (addressOrCredential: Address.Address | Credential.Credential, unit: Unit.Unit) =>
    pipe(
      _Koios.getUtxosEffect(baseUrl, addressOrCredential, token ? { Authorization: `Bearer ${token}` } : undefined),
      Effect.map((utxos) =>
        utxos.filter((utxo) => {
          const keys = Object.keys(utxo.assets)
          return keys.length > 0 && keys.includes(unit)
        })
      ),
      Effect.timeout(10_000),
      Effect.catchAllCause(
        (cause) => new Provider.ProviderError({ cause, message: "Failed to fetch UTxOs with unit from Koios" })
      )
    )

export const getUtxoByUnit = (baseUrl: string, token?: string) => (unit: Unit.Unit) =>
  pipe(
    Effect.sync(() => Unit.fromUnit(unit)),
    Effect.flatMap(({ assetName, policyId }) => {
      const url = `${baseUrl}/asset_addresses?_asset_policy=${policyId}&_asset_name=${assetName}`
      const bearerToken = token ? { Authorization: `Bearer ${token}` } : undefined

      return pipe(
        HttpUtils.get(url, Schema.Array(_Koios.AssetAddressSchema), bearerToken),
        Effect.provide(FetchHttpClient.layer),
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
            const keys = Object.keys(utxo.assets)
            return keys.length > 0 && keys.includes(unit)
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
    Effect.timeout(10_000),
    Effect.catchAllCause(
      (cause) => new Provider.ProviderError({ cause, message: "Failed to fetch UTxO by unit from Koios" })
    )
  )

export const getUtxosByOutRef = (baseUrl: string, token?: string) => (outRefs: ReadonlyArray<OutRef.OutRef>) =>
  Effect.gen(function* () {
    const url = `${baseUrl}/tx_info`
    const body = {
      _tx_hashes: [...new Set(outRefs.map((outRef) => outRef.txHash))],
      _assets: true,
      _scripts: true
    }
    const bearerToken = token ? { Authorization: `Bearer ${token}` } : undefined

    const [result] = yield* pipe(
      HttpUtils.postJson(url, body, Schema.Array(_Koios.TxInfoSchema), bearerToken),
      Effect.provide(FetchHttpClient.layer),
      Effect.timeout(10_000),
      Effect.catchAllCause(
        (cause) => new Provider.ProviderError({ cause, message: "Failed to fetch UTxOs by OutRef from Koios" })
      )
    )

    if (result) {
      const utxos = result.outputs.map((koiosInputOutput: _Koios.InputOutput) =>
        _Koios.toUTxO(
          {
            tx_hash: koiosInputOutput.tx_hash,
            tx_index: koiosInputOutput.tx_index,
            block_time: 0,
            block_height: result.block_height,
            value: koiosInputOutput.value,
            datum_hash: koiosInputOutput.datum_hash,
            inline_datum: koiosInputOutput.inline_datum,
            reference_script: koiosInputOutput.reference_script,
            asset_list: koiosInputOutput.asset_list
          } satisfies _Koios.UTxO,
          koiosInputOutput.payment_addr.bech32
        )
      )
      return utxos.filter((utxo) =>
        outRefs.some((outRef) => utxo.txHash === outRef.txHash && utxo.outputIndex === outRef.outputIndex)
      )
    } else {
      return []
    }
  })

export const getDelegation = (baseUrl: string, token?: string) => (rewardAddress: RewardAddress.RewardAddress) =>
  Effect.gen(function* () {
    const body = {
      _stake_addresses: [rewardAddress]
    }
    const url = `${baseUrl}/account_info`
    const bearerToken = token ? { Authorization: `Bearer ${token}` } : undefined

    const result = yield* pipe(
      HttpUtils.postJson(url, body, Schema.Array(_Koios.AccountInfoSchema), bearerToken),
      Effect.provide(FetchHttpClient.layer),
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
      Effect.timeout(10_000),
      Effect.catchAllCause(
        (cause) => new Provider.ProviderError({ cause, message: "Failed to fetch delegation from Koios" })
      )
    )

    return {
      poolId: result.delegated_pool || undefined,
      rewards: BigInt(result.rewards_available)
    } satisfies Delegation.Delegation
  })

export const getDatum = (baseUrl: string, token?: string) => (datumHash: string) =>
  Effect.gen(function* () {
    const body = {
      _datum_hashes: [datumHash]
    }
    const url = `${baseUrl}/datum_info`
    const bearerToken = token ? { Authorization: `Bearer ${token}` } : undefined

    const result = yield* pipe(
      HttpUtils.postJson(url, body, Schema.Array(_Koios.DatumInfo), bearerToken),
      Effect.provide(FetchHttpClient.layer),
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
      Effect.timeout(10_000),
      Effect.catchAllCause(
        (cause) => new Provider.ProviderError({ cause, message: "Failed to fetch datum from Koios" })
      )
    )

    return result.bytes
  })

export const awaitTx =
  (baseUrl: string, token?: string) =>
  (txHash: string, checkInterval = 20000) =>
    Effect.gen(function* () {
      const body = {
        _tx_hashes: [txHash]
      }
      const url = `${baseUrl}/tx_info`
      const bearerToken = token ? { Authorization: `Bearer ${token}` } : undefined

      const result = yield* pipe(
        HttpUtils.postJson(url, body, Schema.Array(_Koios.TxInfoSchema), bearerToken),
        Effect.provide(FetchHttpClient.layer),
        Effect.repeat({
          schedule: Schedule.exponential(checkInterval),
          until: (result) => result.length > 0
        }),
        Effect.timeout(160_000),
        Effect.catchAllCause(
          (cause) => new Provider.ProviderError({ cause, message: "Failed to await transaction confirmation" })
        ),
        Effect.as(true)
      )

      return result
    })

export const submitTx = (baseUrl: string, token?: string) => (tx: string) =>
  Effect.gen(function* () {
    const url = `${baseUrl}/submittx`
    const bearerToken = token ? { Authorization: `Bearer ${token}` } : undefined

    const result = yield* pipe(
      HttpUtils.postUint8Array(url, Bytes.fromHex(tx), _Koios.TxHashSchema, bearerToken),
      Effect.provide(FetchHttpClient.layer),
      Effect.timeout(10_000),
      Effect.catchAllCause((cause) => new Provider.ProviderError({ cause, message: "Failed to submit transaction" }))
    )

    return result
  })

export const evaluateTx =
  (baseUrl: string, token?: string) =>
  (
    tx: string,
    additionalUTxOs?: Array<UTxO.UTxO>
  ): Effect.Effect<Array<EvalRedeemer.EvalRedeemer>, Provider.ProviderError> =>
    Effect.gen(function* () {
      const url = `${baseUrl}/ogmios`
      const body = {
        jsonrpc: "2.0",
        method: "evaluateTransaction",
        params: {
          transaction: { cbor: tx },
          additionalUtxo: _Ogmios.toOgmiosUTxOs(additionalUTxOs)
        },
        id: null
      }
      const schema = _Ogmios.JSONRPCSchema(Schema.Array(_Ogmios.RedeemerSchema))
      const bearerToken = token ? { Authorization: `Bearer ${token}` } : undefined

      const { result } = yield* pipe(
        HttpUtils.postJson(url, body, schema, bearerToken),
        Effect.provide(FetchHttpClient.layer),
        Effect.timeout(10_000),
        Effect.catchAllCause(
          (cause) => new Provider.ProviderError({ cause, message: "Failed to evaluate transaction" })
        )
      )

      const evalRedeemers = result.map((item) => ({
        ex_units: {
          mem: item.budget.memory,
          steps: item.budget.cpu
        },
        redeemer_index: item.validator.index,
        redeemer_tag: item.validator.purpose
      }))

      return evalRedeemers
    })
