/**
 * @fileoverview Blockchain Applied (BCA) API schemas and transformation utilities.
 *
 * Schemas mirror https://api.blockchain-applied.com/api_ada/v1/openapi.json.
 * Swagger UI on https://api.blockchain-applied.com/api_ada/v1/docs/
 * BCA is backed by cardano-db-sync, so field naming (block_index, out_sum, valid_contract, ...)
 * follows db-sync conventions rather than Blockfrost/Koios/Maestro's own vocabularies.
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
    page: Schema.Number,
    page_size: Schema.Number,
    total_count: Schema.Number,
    total_pages: Schema.Number,
    has_next: Schema.Boolean
  })

// ============================================================================
// UTxOs (GET /utxos/{address}, GET /assets/{unit}/utxos)
// ============================================================================

export const UtxoAsset = Schema.Struct({
  policy_id: Schema.String,
  asset_name: Schema.String,
  quantity: Schema.String
})
export interface UtxoAsset extends Schema.Schema.Type<typeof UtxoAsset> {}

export const UtxoResponse = Schema.Struct({
  tx_hash: Schema.String,
  output_index: Schema.Number,
  address: Schema.String,
  lovelace: Schema.String,
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
  size: Schema.Number,
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
  total_rewards: Schema.String,
  total_withdrawn: Schema.String,
  withdrawable_rewards: Schema.String,
  active_epoch: Schema.optional(Schema.NullOr(Schema.Number)),
  delegation_tx: Schema.optional(Schema.NullOr(Schema.String))
})
export interface StakingResponse extends Schema.Schema.Type<typeof StakingResponse> {}

// ============================================================================
// Protocol parameters (GET /protocol_parameters/latest)
// ============================================================================

export const ProtocolParametersResponse = Schema.Struct({
  epoch_no: Schema.Number,
  min_fee_a: Schema.Number,
  min_fee_b: Schema.Number,
  max_tx_size: Schema.Number,
  max_val_size: Schema.Number,
  key_deposit: Schema.String,
  pool_deposit: Schema.String,
  price_mem: Schema.Number,
  price_step: Schema.Number,
  max_tx_ex_mem: Schema.String,
  max_tx_ex_steps: Schema.String,
  cost_models: Schema.Unknown,
  coins_per_utxo_size: Schema.optional(Schema.NullOr(Schema.String)),
  collateral_percentage: Schema.optional(Schema.NullOr(Schema.Number)),
  drep_deposit: Schema.optional(Schema.NullOr(Schema.String)),
  gov_action_deposit: Schema.optional(Schema.NullOr(Schema.String)),
  max_collateral_inputs: Schema.optional(Schema.NullOr(Schema.Number)),
  min_fee_ref_script_cost_per_byte: Schema.optional(Schema.NullOr(Schema.Number))
})
export interface ProtocolParametersResponse extends Schema.Schema.Type<typeof ProtocolParametersResponse> {}

// ============================================================================
// Tx submit / evaluate
// ============================================================================

export const SubmitResponse = Schema.Struct({
  tx_hash: Schema.String
})

export const ExUnits = Schema.Struct({
  mem: Schema.String,
  steps: Schema.String
})

export const EvalRedeemerResponse = Schema.Struct({
  redeemer_tag: Schema.Literal("spend", "mint", "cert", "reward", "vote", "propose"),
  redeemer_index: Schema.Number,
  ex_units: ExUnits
})

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
  minFeeA: response.min_fee_a,
  minFeeB: response.min_fee_b,
  maxTxSize: response.max_tx_size,
  maxValSize: response.max_val_size,
  keyDeposit: BigInt(response.key_deposit),
  poolDeposit: BigInt(response.pool_deposit),
  drepDeposit: BigInt(response.drep_deposit ?? "0"),
  govActionDeposit: BigInt(response.gov_action_deposit ?? "0"),
  priceMem: response.price_mem,
  priceStep: response.price_step,
  maxTxExMem: BigInt(response.max_tx_ex_mem),
  maxTxExSteps: BigInt(response.max_tx_ex_steps),
  coinsPerUtxoByte: BigInt(response.coins_per_utxo_size ?? "0"),
  collateralPercentage: response.collateral_percentage ?? 0,
  maxCollateralInputs: response.max_collateral_inputs ?? 0,
  minFeeRefScriptCostPerByte: response.min_fee_ref_script_cost_per_byte ?? 0,
  costModels: {
    PlutusV1: extractCostModel(response.cost_models, ["PlutusV1", "plutus_v1"]),
    PlutusV2: extractCostModel(response.cost_models, ["PlutusV2", "plutus_v2"]),
    PlutusV3: extractCostModel(response.cost_models, ["PlutusV3", "plutus_v3"])
  }
})

export const transformAssets = (lovelace: string, assets: ReadonlyArray<UtxoAsset>): CoreAssets.Assets => {
  let result = CoreAssets.fromLovelace(BigInt(lovelace))
  for (const asset of assets) {
    result = CoreAssets.addByHex(result, asset.policy_id, asset.asset_name, BigInt(asset.quantity))
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
  rewards: BigInt(response.withdrawable_rewards)
})

export const transformEvalRedeemer = (redeemer: Schema.Schema.Type<typeof EvalRedeemerResponse>): EvalRedeemer => ({
  redeemer_tag: redeemer.redeemer_tag as Redeemer.RedeemerTag,
  redeemer_index: redeemer.redeemer_index,
  ex_units: new Redeemer.ExUnits({
    mem: BigInt(redeemer.ex_units.mem),
    steps: BigInt(redeemer.ex_units.steps)
  })
})

export const inlineDatumFromCBORHex = (cborHex: string): DatumOption =>
  new InlineDatum.InlineDatum({ data: PlutusData.fromCBORHex(cborHex) })

export const datumHashFromHex = (hex: string): DatumOption => DatumHash.fromHex(hex)
