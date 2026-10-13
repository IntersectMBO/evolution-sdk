/**
 * @fileoverview Blockchain Applied (BCA) API schemas and transformation utilities.
 *
 * Schemas mirror https://api.blockchain-applied.com/api_ada/v1/openapi.json.
 * Swagger UI on https://api.blockchain-applied.com/api_ada/v1/docs/
 * BCA is backed by cardano-db-sync, so field naming (block_index, out_sum, valid_contract, ...)
 * follows db-sync conventions rather than Blockfrost/Koios/Maestro's own vocabularies.
 *
 * HttpUtils hands every JSON number to the schemas as its source text, so integer fields
 * decode with `Schema.BigInt` (from a bare number or a digit string) and decimal fields
 * with `Schema.NumberFromString`.
 */

import { Schema } from "effect"

import * as CoreAssets from "../../../Assets.js"
import * as Bytes from "../../../Bytes.js"
import * as PlutusData from "../../../Data.js"
import * as DatumHash from "../../../DatumHash.js"
import type { DatumOption } from "../../../DatumOption.js"
import * as InlineDatum from "../../../InlineDatum.js"
import * as NativeScripts from "../../../NativeScripts.js"
import * as PlutusV1 from "../../../PlutusV1.js"
import * as PlutusV2 from "../../../PlutusV2.js"
import * as PlutusV3 from "../../../PlutusV3.js"
import * as PoolKeyHash from "../../../PoolKeyHash.js"
import * as Redeemer from "../../../Redeemer.js"
import type { Script } from "../../../Script.js"
import type { EvalRedeemer } from "../../EvalRedeemer.js"
import type * as Provider from "../Provider.js"

// ============================================================================
// Shared envelope
// ============================================================================

/**
 * Some BCA resource endpoints (datum, script) wrap their payload as
 * { summary, details }. `summary` is a resource-category label, not a
 * union discriminator.
 */
export const Envelope = <A, I, R>(details: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    summary: Schema.String,
    details
  })

export const PaginatedResponse = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    data: Schema.Array(item),
    page: Schema.BigInt,
    page_size: Schema.BigInt,
    total_count: Schema.optional(Schema.BigInt),
    total_pages: Schema.optional(Schema.BigInt),
    has_next: Schema.Boolean
  })

// ============================================================================
// UTxOs (GET /utxos/{address}, GET /assets/{unit}/utxos)
// ============================================================================

export const UtxoAsset = Schema.Struct({
  policy_id: Schema.String,
  asset_name: Schema.String,
  quantity: Schema.BigInt
})
export interface UtxoAsset extends Schema.Schema.Type<typeof UtxoAsset> {}

export const UtxoResponse = Schema.Struct({
  tx_hash: Schema.String,
  output_index: Schema.BigInt,
  address: Schema.String,
  lovelace: Schema.BigInt,
  assets: Schema.Array(UtxoAsset),
  datum_hash: Schema.optional(Schema.NullOr(Schema.String)),
  inline_datum: Schema.optional(Schema.NullOr(Schema.String)),
  reference_script_hash: Schema.optional(Schema.NullOr(Schema.String)),
  reference_script_cbor: Schema.optional(Schema.NullOr(Schema.String)),
  reference_script_type: Schema.optional(Schema.NullOr(Schema.String))
})
export interface UtxoResponse extends Schema.Schema.Type<typeof UtxoResponse> {}

export const PaginatedUtxoResponse = PaginatedResponse(UtxoResponse)

// ============================================================================
// Transaction (GET /tx/{hash}) — inputs/outputs are UtxoResponse-shaped, so
// getUtxosByOutRef can reuse the same UTxO resolution path as GET /utxos/{address}.
// ============================================================================

export const TransactionResponse = Schema.Struct({
  hash: Schema.String,
  inputs: Schema.Array(UtxoResponse),
  outputs: Schema.Array(UtxoResponse)
})
export interface TransactionResponse extends Schema.Schema.Type<typeof TransactionResponse> {}

// ============================================================================
// Datum (GET /datum/{datumhash})
// ============================================================================

export const DatumDetails = Schema.Struct({
  hash: Schema.String,
  tx_hash: Schema.String,
  json: Schema.Unknown,
  bytes: Schema.String
})
export interface DatumDetails extends Schema.Schema.Type<typeof DatumDetails> {}

// ============================================================================
// Script (GET /script/{scripthash})
// ============================================================================

export const ScriptDetails = Schema.Struct({
  hash: Schema.String,
  size: Schema.BigInt,
  type: Schema.String,
  json: Schema.Unknown,
  bytes: Schema.String,
  tx_hash: Schema.String
})
export interface ScriptDetails extends Schema.Schema.Type<typeof ScriptDetails> {}

// ============================================================================
// Staking (GET /staking/{stakeaddr}) — current pool delegation and reward
// balance in one flat object.
// ============================================================================

export const StakingResponse = Schema.Struct({
  address: Schema.String,
  pool_id: Schema.optional(Schema.NullOr(Schema.String)),
  total_rewards: Schema.BigInt,
  total_withdrawn: Schema.BigInt,
  withdrawable_rewards: Schema.BigInt,
  active_epoch: Schema.optional(Schema.NullOr(Schema.BigInt)),
  delegation_tx: Schema.optional(Schema.NullOr(Schema.String))
})
export interface StakingResponse extends Schema.Schema.Type<typeof StakingResponse> {}

// ============================================================================
// Protocol parameters (GET /protocol_parameters/latest)
// ============================================================================

export const ProtocolParametersResponse = Schema.Struct({
  epoch_no: Schema.BigInt,
  min_fee_a: Schema.BigInt,
  min_fee_b: Schema.BigInt,
  max_tx_size: Schema.BigInt,
  max_val_size: Schema.BigInt,
  key_deposit: Schema.BigInt,
  pool_deposit: Schema.BigInt,
  price_mem: Schema.NumberFromString,
  price_step: Schema.NumberFromString,
  max_tx_ex_mem: Schema.BigInt,
  max_tx_ex_steps: Schema.BigInt,
  cost_models: Schema.Unknown,
  coins_per_utxo_size: Schema.optional(Schema.NullOr(Schema.BigInt)),
  collateral_percentage: Schema.optional(Schema.NullOr(Schema.BigInt)),
  drep_deposit: Schema.optional(Schema.NullOr(Schema.BigInt)),
  gov_action_deposit: Schema.optional(Schema.NullOr(Schema.BigInt)),
  max_collateral_inputs: Schema.optional(Schema.NullOr(Schema.BigInt)),
  min_fee_ref_script_cost_per_byte: Schema.optional(Schema.NullOr(Schema.NumberFromString))
})
export interface ProtocolParametersResponse extends Schema.Schema.Type<typeof ProtocolParametersResponse> {}

// ============================================================================
// Tx submit / evaluate
// ============================================================================

export const SubmitResponse = Schema.Struct({
  tx_hash: Schema.String
})

export const ExUnits = Schema.Struct({
  mem: Schema.BigInt,
  steps: Schema.BigInt
})

export const EvalRedeemerResponse = Schema.Struct({
  redeemer_tag: Schema.Literal("spend", "mint", "cert", "reward", "vote", "propose"),
  redeemer_index: Schema.BigInt,
  ex_units: ExUnits
})

/**
 * A UTxO as sent in the `additional_utxos` of POST /tx/evaluate
 */
export interface AdditionalUtxo {
  readonly tx_hash: string
  readonly output_index: number
  readonly address: string
  readonly lovelace: string
  readonly assets: ReadonlyArray<{ readonly policy_id: string; readonly asset_name: string; readonly quantity: string }>
  readonly datum_hash?: string
  readonly inline_datum?: string
  readonly reference_script_cbor?: string
  readonly reference_script_type?: string
}

// ============================================================================
// Transformation utilities
// ============================================================================

/** BCA declares `cost_models` as an opaque object — normalize either array or object shapes. */
const normalizeCostModel = (raw: unknown): Record<string, number> => {
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((value, index) => [index.toString(), Number(value)]))
  }
  if (raw && typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, Number(value)])
    )
  }
  return {}
}

const extractCostModel = (costModels: unknown, keys: ReadonlyArray<string>): Record<string, number> => {
  if (costModels && typeof costModels === "object") {
    for (const key of keys) {
      const value = (costModels as Record<string, unknown>)[key]
      if (value !== undefined) return normalizeCostModel(value)
    }
  }
  return {}
}

export const transformProtocolParameters = (response: ProtocolParametersResponse): Provider.ProtocolParameters => ({
  minFeeA: Number(response.min_fee_a),
  minFeeB: Number(response.min_fee_b),
  maxTxSize: Number(response.max_tx_size),
  maxValSize: Number(response.max_val_size),
  keyDeposit: response.key_deposit,
  poolDeposit: response.pool_deposit,
  drepDeposit: response.drep_deposit ?? 0n,
  govActionDeposit: response.gov_action_deposit ?? 0n,
  priceMem: response.price_mem,
  priceStep: response.price_step,
  maxTxExMem: response.max_tx_ex_mem,
  maxTxExSteps: response.max_tx_ex_steps,
  coinsPerUtxoByte: response.coins_per_utxo_size ?? 0n,
  collateralPercentage: Number(response.collateral_percentage ?? 0n),
  maxCollateralInputs: Number(response.max_collateral_inputs ?? 0n),
  minFeeRefScriptCostPerByte: response.min_fee_ref_script_cost_per_byte ?? 0,
  costModels: {
    PlutusV1: extractCostModel(response.cost_models, ["PlutusV1", "plutus_v1"]),
    PlutusV2: extractCostModel(response.cost_models, ["PlutusV2", "plutus_v2"]),
    PlutusV3: extractCostModel(response.cost_models, ["PlutusV3", "plutus_v3"])
  }
})

export const transformAssets = (lovelace: bigint, assets: ReadonlyArray<UtxoAsset>): CoreAssets.Assets => {
  let result = CoreAssets.fromLovelace(lovelace)
  for (const asset of assets) {
    result = CoreAssets.addByHex(result, asset.policy_id, asset.asset_name, asset.quantity)
  }
  return result
}

export const transformScript = (details: { type: string; bytes: string }): Script | undefined => {
  const bytes = Bytes.fromHex(details.bytes)
  switch (details.type) {
    case "plutusV1":
      return new PlutusV1.PlutusV1({ bytes })
    case "plutusV2":
      return new PlutusV2.PlutusV2({ bytes })
    case "plutusV3":
      return new PlutusV3.PlutusV3({ bytes })
    case "timelock":
    case "multisig":
      return NativeScripts.fromCBORHex(details.bytes)
    default:
      return undefined
  }
}

export const transformDelegation = (response: StakingResponse): Provider.Delegation => ({
  poolId: response.pool_id ? PoolKeyHash.fromBech32(response.pool_id) : null,
  rewards: response.withdrawable_rewards
})

export const transformEvalRedeemer = (redeemer: Schema.Schema.Type<typeof EvalRedeemerResponse>): EvalRedeemer => ({
  redeemer_tag: redeemer.redeemer_tag as Redeemer.RedeemerTag,
  redeemer_index: Number(redeemer.redeemer_index),
  ex_units: new Redeemer.ExUnits({
    mem: redeemer.ex_units.mem,
    steps: redeemer.ex_units.steps
  })
})

export const inlineDatumFromCBORHex = (cborHex: string): DatumOption =>
  new InlineDatum.InlineDatum({ data: PlutusData.fromCBORHex(cborHex) })

export const datumHashFromHex = (hex: string): DatumOption => DatumHash.fromHex(hex)
