import type { HttpBody, HttpClientError } from "@effect/platform"
import { FetchHttpClient } from "@effect/platform"
import { Effect, pipe, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"

import type * as Address from "../../Address.js"
import type * as Assets from "../../Assets.js"
import type * as Credential from "../../Credential.js"
import * as Script from "../../Script.js"
import type * as UtxO from "../../UTxO.js"
import * as HttpUtils from "./HttpUtils.js"

export const ProtocolParametersSchema = Schema.Struct({
  pvt_motion_no_confidence: Schema.Number,
  pvt_committee_normal: Schema.Number,
  pvt_committee_no_confidence: Schema.Number,
  pvt_hard_fork_initiation: Schema.Number,
  pvtpp_security_group: Schema.Number,
  dvt_motion_no_confidence: Schema.Number,
  dvt_committee_normal: Schema.Number,
  dvt_committee_no_confidence: Schema.Number,
  dvt_update_to_constitution: Schema.Number,
  dvt_hard_fork_initiation: Schema.Number,
  dvt_p_p_network_group: Schema.Number,
  dvt_p_p_economic_group: Schema.Number,
  dvt_p_p_technical_group: Schema.Number,
  dvt_p_p_gov_group: Schema.Number,
  dvt_treasury_withdrawal: Schema.Number,
  committee_min_size: Schema.Number,
  committee_max_term_length: Schema.Number,
  gov_action_lifetime: Schema.Number,
  gov_action_deposit: Schema.NumberFromString,
  drep_deposit: Schema.NumberFromString,
  drep_activity: Schema.Number,
  min_fee_ref_script_cost_per_byte: Schema.Number,
  epoch_no: Schema.Number,
  min_fee_a: Schema.Number,
  min_fee_b: Schema.Number,
  max_block_size: Schema.Number,
  max_tx_size: Schema.Number,
  max_bh_size: Schema.Number,
  key_deposit: Schema.BigInt,
  pool_deposit: Schema.BigInt,
  max_epoch: Schema.Number,
  optimal_pool_count: Schema.Number,
  influence: Schema.Number,
  monetary_expand_rate: Schema.Number,
  treasury_growth_rate: Schema.Number,
  decentralisation: Schema.Number,
  extra_entropy: Schema.NullOr(Schema.String),
  protocol_major: Schema.Number,
  protocol_minor: Schema.Number,
  min_utxo_value: Schema.String,
  min_pool_cost: Schema.String,
  nonce: Schema.String,
  block_hash: Schema.NullOr(Schema.String),
  cost_models: Schema.Struct({
    PlutusV1: Schema.Array(Schema.Number),
    PlutusV2: Schema.Array(Schema.Number),
    PlutusV3: Schema.Array(Schema.Number)
  }),
  price_mem: Schema.Number,
  price_step: Schema.Number,
  max_tx_ex_mem: Schema.BigIntFromNumber,
  max_tx_ex_steps: Schema.BigIntFromNumber,
  max_block_ex_mem: Schema.Number,
  max_block_ex_steps: Schema.Number,
  max_val_size: Schema.Number,
  collateral_percent: Schema.Number,
  max_collateral_inputs: Schema.Number,
  coins_per_utxo_size: Schema.BigInt
})
export interface ProtocolParameters extends Schema.Schema.Type<typeof ProtocolParametersSchema> {}

export const AssetSchema = Schema.Struct({
  policy_id: Schema.String,
  asset_name: Schema.NullOr(Schema.String),
  fingerprint: Schema.String,
  decimals: Schema.Number,
  quantity: Schema.String
})

export interface Asset extends Schema.Schema.Type<typeof AssetSchema> {}

const ReferenceScriptSchema = Schema.Struct({
  hash: Schema.NullOr(Schema.String),
  size: Schema.NullOr(Schema.Number),
  type: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.String),
  value: Schema.NullOr(Schema.Object)
})

export interface ReferenceScript extends Schema.Schema.Type<typeof ReferenceScriptSchema> {}

export const UTxOSchema = Schema.Struct({
  tx_hash: Schema.String,
  tx_index: Schema.Number,
  block_time: Schema.Number,
  block_height: Schema.NullOr(Schema.Number),
  value: Schema.String,
  datum_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(
    Schema.Struct({
      bytes: Schema.String,
      value: Schema.Object
    })
  ),
  reference_script: Schema.NullOr(ReferenceScriptSchema),
  asset_list: Schema.NullOr(Schema.Array(AssetSchema))
})

export interface UTxO extends Schema.Schema.Type<typeof UTxOSchema> {}

export const AddressInfoSchema = Schema.Array(
  Schema.NullishOr(
    Schema.Struct({
      address: Schema.String,
      balance: Schema.String,
      stake_address: Schema.NullOr(Schema.String),
      script_address: Schema.Boolean,
      utxo_set: Schema.Array(UTxOSchema)
    })
  )
)

export interface AddressInfo extends Schema.Schema.Type<typeof AddressInfoSchema> {}

export const InputOutputSchema = Schema.Struct({
  payment_addr: Schema.Struct({
    bech32: Schema.String,
    cred: Schema.String
  }),
  stake_addr: Schema.NullOr(Schema.String),
  tx_hash: Schema.String,
  tx_index: Schema.Number,
  value: Schema.String,
  datum_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(
    Schema.Struct({
      bytes: Schema.String,
      value: Schema.Object
    })
  ),
  reference_script: Schema.NullOr(ReferenceScriptSchema),
  asset_list: Schema.Array(AssetSchema)
})

export interface InputOutput extends Schema.Schema.Type<typeof InputOutputSchema> {}

export const TxInfoSchema = Schema.Struct({
  tx_hash: Schema.String,
  block_hash: Schema.String,
  block_height: Schema.Number,
  epoch_no: Schema.Number,
  epoch_slot: Schema.Number,
  absolute_slot: Schema.Number,
  tx_timestamp: Schema.Number,
  tx_block_index: Schema.Number,
  tx_size: Schema.Number,
  total_output: Schema.String,
  fee: Schema.String,
  treasury_donation: Schema.String,
  deposit: Schema.String,
  invalid_before: Schema.NullOr(Schema.String),
  invalid_after: Schema.NullOr(Schema.String),
  collateral_inputs: Schema.NullOr(Schema.Array(InputOutputSchema)),
  collateral_output: Schema.NullOr(InputOutputSchema),
  reference_inputs: Schema.NullOr(Schema.Array(InputOutputSchema)),
  inputs: Schema.Array(InputOutputSchema),
  outputs: Schema.Array(InputOutputSchema),
  withdrawals: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        amount: Schema.String,
        stake_addr: Schema.String
      })
    )
  ),
  assets_minted: Schema.NullOr(Schema.Array(AssetSchema)),
  metadata: Schema.NullOr(Schema.Object),
  certificates: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        index: Schema.Number,
        type: Schema.String,
        info: Schema.NullOr(Schema.Object)
      })
    )
  ),
  native_scripts: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        script_hash: Schema.String,
        script_json: Schema.Object
      })
    )
  ),
  plutus_contracts: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        address: Schema.String,
        spends_input: Schema.NullOr(
          Schema.Struct({
            tx_hash: Schema.String,
            tx_index: Schema.Number
          })
        ),
        script_hash: Schema.String,
        bytecode: Schema.String,
        size: Schema.Number,
        valid_contract: Schema.Boolean,
        input: Schema.Struct({
          redeemer: Schema.Struct({
            purpose: Schema.Literal("spend", "mint", "cert", "reward"),
            fee: Schema.String,
            unit: Schema.Struct({
              steps: Schema.String,
              mem: Schema.String
            }),
            datum: Schema.Struct({
              hash: Schema.NullOr(Schema.String),
              value: Schema.NullOr(Schema.Object)
            })
          }),
          datum: Schema.Struct({
            hash: Schema.NullOr(Schema.String),
            value: Schema.NullOr(Schema.Object)
          })
        })
      })
    )
  ),
  //TODO: add Schema.Struct
  // https://preprod.koios.rest/#post-/tx_info
  voting_procedures: Schema.Array(Schema.Object),
  //TODO: add Schema.Struct
  // https://preprod.koios.rest/#post-/tx_info
  proposal_procedures: Schema.Object
})

export interface TxInfo extends Schema.Schema.Type<typeof TxInfoSchema> {}

export const TxHashSchema = Schema.String

export const AssetAddressSchema = Schema.Struct({
  payment_address: Schema.String,
  stake_address: Schema.NullOr(Schema.String),
  quantity: Schema.String
})

export interface AssetAddress extends Schema.Schema.Type<typeof AssetAddressSchema> {}

//NOTE: account_info schema is not complete
// https://preprod.koios.rest/#post-/account_info
export const AccountInfoSchema = Schema.Struct({
  delegated_pool: Schema.NullOr(Schema.String),
  rewards_available: Schema.NumberFromString
})

//NOTE: datum_info schema is not complete
// https://preprod.koios.rest/#post-/datum_info
export const DatumInfo = Schema.Struct({
  bytes: Schema.String
})

export const getHeadersWithToken = (token?: string, headers: Record<string, string> = {}): Record<string, string> => {
  if (token) {
    return {
      ...headers,
      Authorization: `Bearer ${token}`
    }
  }
  return headers
}

export const toUTxO = (koiosUTxO: UTxO, address: string): UtxO.UTxO => ({
  txHash: koiosUTxO.tx_hash,
  outputIndex: koiosUTxO.tx_index,
  assets: (() => {
    const a: Assets.Assets = { lovelace: BigInt(koiosUTxO.value) }
    if (koiosUTxO.asset_list) {
      koiosUTxO.asset_list.forEach((am: Asset) => {
        a[am.policy_id + am.asset_name] = BigInt(am.quantity)
      })
    }
    return a
  })(),
  address,
  datumOption: koiosUTxO.inline_datum
    ? { type: "inlineDatum", inline: koiosUTxO.inline_datum.bytes }
    : koiosUTxO.datum_hash
      ? { type: "datumHash", hash: koiosUTxO.datum_hash }
      : undefined,
  scriptRef: toScriptRef(koiosUTxO.reference_script)
})

const toScriptRef = (reference_script: ReferenceScript | null): Script.Script | undefined => {
  if (reference_script && reference_script.bytes && reference_script.type) {
    switch (reference_script.type) {
      case "plutusV1":
        return {
          type: "PlutusV1" as const,
          script: Script.applyDoubleCborEncoding(reference_script.bytes)
        }
      case "plutusV2":
        return {
          type: "PlutusV2" as const,
          script: Script.applyDoubleCborEncoding(reference_script.bytes)
        }
      case "plutusV3":
        return {
          type: "PlutusV3" as const,
          script: Script.applyDoubleCborEncoding(reference_script.bytes)
        }
      default:
        return undefined
    }
  }
}

export const getUtxosEffect = (
  baseUrl: string,
  addressOrCredential: Address.Address | Credential.Credential,
  headers: Record<string, string> | undefined
): Effect.Effect<
  Array<UtxO.UTxO>,
  string | HttpBody.HttpBodyError | HttpClientError.HttpClientError | ParseError,
  never
> => {
  const url = `${baseUrl}/address_info`
  const body = {
    _addresses: [addressOrCredential]
  }
  const schema = AddressInfoSchema
  const result = pipe(
    Effect.if(typeof addressOrCredential === "string", {
      onFalse: () => Effect.fail("Credential Type is not supported in Koios yet."),
      onTrue: () => HttpUtils.postJson(url, body, schema, headers)
    }),
    Effect.map(([result]) => (result ? result.utxo_set.map((koiosUtxo) => toUTxO(koiosUtxo, result.address)) : [])),
    Effect.provide(FetchHttpClient.layer)
  )
  return result
}
