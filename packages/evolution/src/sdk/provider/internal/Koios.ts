import { Effect, pipe, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"

import * as CoreAddress from "../../../Address.js"
import * as CoreAssets from "../../../Assets.js"
import * as Bytes from "../../../Bytes.js"
import * as PlutusData from "../../../Data.js"
import * as DatumHash from "../../../DatumHash.js"
import type * as DatumOption from "../../../DatumOption.js"
import * as InlineDatum from "../../../InlineDatum.js"
import * as NativeScripts from "../../../NativeScripts.js"
import * as PlutusV1 from "../../../PlutusV1.js"
import * as PlutusV2 from "../../../PlutusV2.js"
import * as PlutusV3 from "../../../PlutusV3.js"
import type * as Script from "../../../Script.js"
import * as TransactionHash from "../../../TransactionHash.js"
import * as CoreUTxO from "../../../UTxO.js"
import * as HttpUtils from "./HttpUtils.js"

export const ProtocolParametersSchema = Schema.Struct({
  pvt_motion_no_confidence: Schema.NumberFromString,
  pvt_committee_normal: Schema.NumberFromString,
  pvt_committee_no_confidence: Schema.NumberFromString,
  pvt_hard_fork_initiation: Schema.NumberFromString,
  pvtpp_security_group: Schema.NumberFromString,
  dvt_motion_no_confidence: Schema.NumberFromString,
  dvt_committee_normal: Schema.NumberFromString,
  dvt_committee_no_confidence: Schema.NumberFromString,
  dvt_update_to_constitution: Schema.NumberFromString,
  dvt_hard_fork_initiation: Schema.NumberFromString,
  dvt_p_p_network_group: Schema.NumberFromString,
  dvt_p_p_economic_group: Schema.NumberFromString,
  dvt_p_p_technical_group: Schema.NumberFromString,
  dvt_p_p_gov_group: Schema.NumberFromString,
  dvt_treasury_withdrawal: Schema.NumberFromString,
  committee_min_size: Schema.BigInt,
  committee_max_term_length: Schema.BigInt,
  gov_action_lifetime: Schema.BigInt,
  gov_action_deposit: Schema.BigInt,
  drep_deposit: Schema.BigInt,
  drep_activity: Schema.BigInt,
  min_fee_ref_script_cost_per_byte: Schema.NumberFromString,
  epoch_no: Schema.BigInt,
  min_fee_a: Schema.BigInt,
  min_fee_b: Schema.BigInt,
  max_block_size: Schema.BigInt,
  max_tx_size: Schema.BigInt,
  max_bh_size: Schema.BigInt,
  key_deposit: Schema.BigInt,
  pool_deposit: Schema.BigInt,
  max_epoch: Schema.BigInt,
  optimal_pool_count: Schema.BigInt,
  influence: Schema.NumberFromString,
  monetary_expand_rate: Schema.NumberFromString,
  treasury_growth_rate: Schema.NumberFromString,
  decentralisation: Schema.NumberFromString,
  extra_entropy: Schema.NullOr(Schema.String),
  protocol_major: Schema.BigInt,
  protocol_minor: Schema.BigInt,
  min_utxo_value: Schema.BigInt,
  min_pool_cost: Schema.BigInt,
  nonce: Schema.NullOr(Schema.String),
  block_hash: Schema.NullOr(Schema.String),
  cost_models: Schema.Struct({
    PlutusV1: Schema.Array(Schema.BigInt),
    PlutusV2: Schema.Array(Schema.BigInt),
    PlutusV3: Schema.Array(Schema.BigInt)
  }),
  price_mem: Schema.NumberFromString,
  price_step: Schema.NumberFromString,
  max_tx_ex_mem: Schema.BigInt,
  max_tx_ex_steps: Schema.BigInt,
  max_block_ex_mem: Schema.BigInt,
  max_block_ex_steps: Schema.BigInt,
  max_val_size: Schema.BigInt,
  collateral_percent: Schema.BigInt,
  max_collateral_inputs: Schema.BigInt,
  coins_per_utxo_size: Schema.BigInt
})
export interface ProtocolParameters extends Schema.Schema.Type<typeof ProtocolParametersSchema> {}

export const AssetSchema = Schema.Struct({
  policy_id: Schema.String,
  asset_name: Schema.NullOr(Schema.String),
  fingerprint: Schema.String,
  decimals: Schema.BigInt,
  quantity: Schema.BigInt
})

export interface Asset extends Schema.Schema.Type<typeof AssetSchema> {}

const ReferenceScriptSchema = Schema.Struct({
  hash: Schema.NullOr(Schema.String),
  size: Schema.NullOr(Schema.BigInt),
  type: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.String),
  value: Schema.Unknown
})

export interface ReferenceScript extends Schema.Schema.Type<typeof ReferenceScriptSchema> {}

export const UTxOSchema = Schema.Struct({
  tx_hash: Schema.String,
  tx_index: Schema.BigInt,
  block_time: Schema.BigInt,
  block_height: Schema.NullOr(Schema.BigInt),
  value: Schema.BigInt,
  datum_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(
    Schema.Struct({
      bytes: Schema.NullOr(Schema.String),
      value: Schema.Unknown
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
      balance: Schema.BigInt,
      stake_address: Schema.NullOr(Schema.String),
      script_address: Schema.Boolean,
      utxo_set: Schema.Array(UTxOSchema)
    })
  )
)

export interface AddressInfo extends Schema.Schema.Type<typeof AddressInfoSchema> {}

/**
 * The part of a `/tx_info` row that `awaitTx` reads: a row exists once the transaction is on chain
 */
export const TxConfirmationSchema = Schema.Struct({
  tx_hash: Schema.String
})

export const TxHashSchema = Schema.String

export const AssetAddressSchema = Schema.Struct({
  payment_address: Schema.String,
  stake_address: Schema.NullOr(Schema.String),
  quantity: Schema.BigInt
})

export interface AssetAddress extends Schema.Schema.Type<typeof AssetAddressSchema> {}

//NOTE: account_info schema is not complete
// https://preprod.koios.rest/#post-/account_info
export const AccountInfoSchema = Schema.Struct({
  delegated_pool: Schema.NullOr(Schema.String),
  rewards_available: Schema.BigInt
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

export const toUTxO = (koiosUTxO: UTxO, addressStr: string): CoreUTxO.UTxO => {
  // Build Core Assets
  let assets = CoreAssets.fromLovelace(koiosUTxO.value)

  if (koiosUTxO.asset_list) {
    for (const am of koiosUTxO.asset_list) {
      // policy_id is hex (56 chars), asset_name is hex
      assets = CoreAssets.addByHex(assets, am.policy_id, am.asset_name || "", am.quantity)
    }
  }

  const address = CoreAddress.fromBech32(addressStr)
  const transactionId = TransactionHash.fromHex(koiosUTxO.tx_hash)

  let datumOption: DatumOption.DatumOption | undefined
  if (koiosUTxO.inline_datum?.bytes) {
    datumOption = new InlineDatum.InlineDatum({ data: PlutusData.fromCBORHex(koiosUTxO.inline_datum.bytes) })
  } else if (koiosUTxO.datum_hash) {
    datumOption = DatumHash.fromHex(koiosUTxO.datum_hash)
  }

  let scriptRef: Script.Script | undefined
  const rs = koiosUTxO.reference_script
  if (rs?.bytes && rs.type) {
    const scriptBytes = Bytes.fromHex(rs.bytes)
    switch (rs.type) {
      case "plutusV1":
        scriptRef = new PlutusV1.PlutusV1({ bytes: scriptBytes })
        break
      case "plutusV2":
        scriptRef = new PlutusV2.PlutusV2({ bytes: scriptBytes })
        break
      case "plutusV3":
        scriptRef = new PlutusV3.PlutusV3({ bytes: scriptBytes })
        break
      case "timelock":
        scriptRef = NativeScripts.fromCBORHex(rs.bytes)
        break
    }
  }

  return new CoreUTxO.UTxO({
    transactionId,
    index: koiosUTxO.tx_index,
    address,
    assets,
    datumOption,
    scriptRef
  })
}

export const CredentialUTxOSchema = Schema.Struct({
  tx_hash: Schema.String,
  tx_index: Schema.BigInt,
  address: Schema.String,
  value: Schema.BigInt,
  datum_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(
    Schema.Struct({
      bytes: Schema.NullOr(Schema.String),
      value: Schema.Unknown
    })
  ),
  reference_script: Schema.NullOr(ReferenceScriptSchema),
  asset_list: Schema.NullOr(Schema.Array(AssetSchema))
})

export const getUtxosEffect = (
  baseUrl: string,
  address: string,
  headers: Record<string, string> | undefined
): Effect.Effect<Array<CoreUTxO.UTxO>, string | HttpUtils.HttpError | ParseError, never> => {
  const url = `${baseUrl}/address_info`
  const body = {
    _addresses: [address]
  }
  const result = pipe(
    HttpUtils.postJson(url, body, AddressInfoSchema, headers),
    Effect.map(([result]) => (result ? result.utxo_set.map((koiosUtxo) => toUTxO(koiosUtxo, result.address)) : []))
  )
  return result
}

export const getCredentialUtxosEffect = (
  baseUrl: string,
  credentialHash: string,
  headers: Record<string, string> | undefined
): Effect.Effect<Array<CoreUTxO.UTxO>, string | HttpUtils.HttpError | ParseError, never> => {
  const url = `${baseUrl}/credential_utxos`
  const body = {
    _payment_credentials: [credentialHash],
    _extended: true
  }
  const result = pipe(
    HttpUtils.postJson(url, body, Schema.Array(CredentialUTxOSchema), headers),
    Effect.map((utxos) =>
      utxos.map((u) => toUTxO(
        {
          tx_hash: u.tx_hash,
          tx_index: u.tx_index,
          block_time: 0n,
          block_height: null,
          value: u.value,
          datum_hash: u.datum_hash,
          inline_datum: u.inline_datum,
          reference_script: u.reference_script,
          asset_list: u.asset_list
        },
        u.address
      ))
    )
  )
  return result
}
