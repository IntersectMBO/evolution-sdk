/**
 * @fileoverview Blockfrost API schemas and transformation utilities
 * Internal module for Blockfrost provider implementation
 */

import { Effect, Schema } from "effect"

import * as CoreAssets from "../../../Assets.js"
import * as PoolKeyHash from "../../../PoolKeyHash.js"
import * as Redeemer from "../../../Redeemer.js"
import type { EvalRedeemer } from "../../EvalRedeemer.js"
import type * as Provider from "../Provider.js"
import { ProviderError } from "../Provider.js"
import * as HttpUtils from "./HttpUtils.js"

// ============================================================================
// Blockfrost API Response Schemas
// ============================================================================

/**
 * Blockfrost protocol parameters response schema
 */
export const BlockfrostProtocolParameters = Schema.Struct({
  min_fee_a: Schema.BigInt,
  min_fee_b: Schema.BigInt,
  pool_deposit: Schema.BigInt,
  key_deposit: Schema.BigInt,
  min_utxo: Schema.optional(Schema.BigInt),
  max_tx_size: Schema.BigInt,
  max_val_size: Schema.optional(Schema.BigInt),
  utxo_cost_per_word: Schema.optional(Schema.BigInt),
  cost_models: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Record({ key: Schema.String, value: Schema.BigInt }) })
  ),
  cost_models_raw: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Array(Schema.BigInt) })
  ),
  price_mem: Schema.optional(Schema.NumberFromString),
  price_step: Schema.optional(Schema.NumberFromString),
  max_tx_ex_mem: Schema.optional(Schema.BigInt),
  max_tx_ex_steps: Schema.optional(Schema.BigInt),
  max_block_ex_mem: Schema.optional(Schema.BigInt),
  max_block_ex_steps: Schema.optional(Schema.BigInt),
  max_block_size: Schema.BigInt,
  collateral_percent: Schema.optional(Schema.BigInt),
  max_collateral_inputs: Schema.optional(Schema.BigInt),
  coins_per_utxo_size: Schema.optional(Schema.BigInt),
  min_fee_ref_script_cost_per_byte: Schema.optional(Schema.NumberFromString),
  // Conway era governance parameters
  drep_deposit: Schema.optional(Schema.BigInt),
  gov_action_deposit: Schema.optional(Schema.BigInt)
})

export type BlockfrostProtocolParameters = Schema.Schema.Type<typeof BlockfrostProtocolParameters>

/**
 * Blockfrost UTxO amount schema (for multi-asset support)
 */
export const BlockfrostAmount = Schema.Struct({
  unit: Schema.String,
  quantity: Schema.BigInt
})

export type BlockfrostAmount = Schema.Schema.Type<typeof BlockfrostAmount>

/**
 * Blockfrost UTxO response schema
 */
export const BlockfrostUTxO = Schema.Struct({
  address: Schema.String,
  tx_hash: Schema.String,
  tx_index: Schema.BigInt,
  output_index: Schema.BigInt,
  amount: Schema.Array(BlockfrostAmount),
  block: Schema.String,
  data_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(Schema.String),
  reference_script_hash: Schema.NullOr(Schema.String)
})

export type BlockfrostUTxO = Schema.Schema.Type<typeof BlockfrostUTxO>

/**
 * Blockfrost delegation/account response schema
 * From /accounts/{stake_address} endpoint
 */
export const BlockfrostDelegation = Schema.Struct({
  stake_address: Schema.String,
  active: Schema.Boolean,
  active_epoch: Schema.NullOr(Schema.BigInt),
  pool_id: Schema.NullOr(Schema.String),
  controlled_amount: Schema.BigInt,
  rewards_sum: Schema.BigInt,
  withdrawals_sum: Schema.BigInt,
  reserves_sum: Schema.BigInt,
  treasury_sum: Schema.BigInt,
  withdrawable_amount: Schema.BigInt,
  drep_id: Schema.NullOr(Schema.String)
})

export type BlockfrostDelegation = Schema.Schema.Type<typeof BlockfrostDelegation>

/**
 * Blockfrost asset address response schema (from /assets/{unit}/addresses endpoint)
 */
export const BlockfrostAssetAddress = Schema.Struct({
  address: Schema.String,
  quantity: Schema.BigInt
})

export type BlockfrostAssetAddress = Schema.Schema.Type<typeof BlockfrostAssetAddress>

/**
 * Blockfrost transaction UTxO output schema (from /txs/{hash}/utxos endpoint)
 * Different from regular UTxO - uses output_index instead of tx_index
 */
export const BlockfrostTxUtxoOutput = Schema.Struct({
  address: Schema.String,
  amount: Schema.Array(BlockfrostAmount),
  output_index: Schema.BigInt,
  data_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(Schema.String),
  reference_script_hash: Schema.NullOr(Schema.String),
  collateral: Schema.Boolean,
  consumed_by_tx: Schema.NullOr(Schema.String)
})

export type BlockfrostTxUtxoOutput = Schema.Schema.Type<typeof BlockfrostTxUtxoOutput>

/**
 * Blockfrost transaction UTxOs response schema (from /txs/{hash}/utxos endpoint)
 */
export const BlockfrostTxUtxos = Schema.Struct({
  hash: Schema.String,
  inputs: Schema.Array(Schema.Unknown),
  outputs: Schema.Array(BlockfrostTxUtxoOutput)
})

export type BlockfrostTxUtxos = Schema.Schema.Type<typeof BlockfrostTxUtxos>

/**
 * Blockfrost transaction submit response schema
 */
export const BlockfrostSubmitResponse = Schema.String

export type BlockfrostSubmitResponse = Schema.Schema.Type<typeof BlockfrostSubmitResponse>

/**
 * Blockfrost datum response schema
 */
export const BlockfrostDatum = Schema.Struct({
  json_value: Schema.optional(Schema.Unknown),
  cbor: Schema.String
})

export type BlockfrostDatum = Schema.Schema.Type<typeof BlockfrostDatum>

/**
 * Schema for JSONWSP-wrapped Ogmios evaluation response
 * Used by /utils/txs/evaluate/utxos endpoint
 * Can contain either EvaluationResult (success) or EvaluationFailure (error)
 */
export const JsonwspOgmiosEvaluationResponse = Schema.Struct({
  type: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  servicename: Schema.optional(Schema.String),
  methodname: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Struct({
    EvaluationResult: Schema.optional(
      Schema.Record({
        key: Schema.String, // "spend:0", "mint:1", etc.
        value: Schema.Struct({
          memory: Schema.BigInt,
          steps: Schema.BigInt
        })
      })
    ),
    EvaluationFailure: Schema.optional(Schema.Unknown)
  })),
  fault: Schema.optional(Schema.Struct({
    code: Schema.optional(Schema.String),
    string: Schema.optional(Schema.String)
  })),
  reflection: Schema.optional(Schema.Unknown)
})

export type JsonwspOgmiosEvaluationResponse = Schema.Schema.Type<typeof JsonwspOgmiosEvaluationResponse>

const Amount = HttpUtils.BigIntFromJsonNumber

/**
 * Ogmios v5 value, which Blockfrost evaluates against by default
 */
export const EvaluationValue = Schema.Struct({
  coins: Amount,
  assets: Schema.optional(Schema.Record({ key: Schema.String, value: Amount }))
})

export type EvaluationValue = Schema.Schema.Type<typeof EvaluationValue>

/**
 * Request body for the /utils/txs/evaluate/utxos endpoint
 */
export const EvaluateUtxosRequest = Schema.Struct({
  cbor: Schema.String,
  additionalUtxoSet: Schema.Array(
    Schema.Tuple(
      Schema.Struct({ txId: Schema.String, index: HttpUtils.BigIntFromJsonNumber }),
      Schema.Struct({
        address: Schema.String,
        value: EvaluationValue,
        datumHash: Schema.optional(Schema.String),
        datum: Schema.optional(Schema.String),
        script: Schema.optional(Schema.Unknown)
      })
    )
  )
})

export type EvaluateUtxosRequest = Schema.Schema.Type<typeof EvaluateUtxosRequest>

// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Transform Blockfrost protocol parameters to Evolution SDK format
 */
const costModelFromBlockfrost = (
  params: BlockfrostProtocolParameters,
  lang: "PlutusV1" | "PlutusV2" | "PlutusV3"
): Record<string, number> => {
  const raw = params.cost_models_raw?.[lang]
  if (raw) return Object.fromEntries(raw.map((v, i) => [i.toString(), Number(v)]))
  return Object.fromEntries(Object.entries(params.cost_models?.[lang] ?? {}).map(([k, v]) => [k, Number(v)]))
}

export const transformProtocolParameters = (
  blockfrostParams: BlockfrostProtocolParameters
): Provider.ProtocolParameters => {
  return {
    minFeeA: Number(blockfrostParams.min_fee_a),
    minFeeB: Number(blockfrostParams.min_fee_b),
    poolDeposit: blockfrostParams.pool_deposit,
    keyDeposit: blockfrostParams.key_deposit,
    maxTxSize: Number(blockfrostParams.max_tx_size),
    maxValSize: Number(blockfrostParams.max_val_size ?? 0n),
    priceMem: blockfrostParams.price_mem || 0,
    priceStep: blockfrostParams.price_step || 0,
    maxTxExMem: blockfrostParams.max_tx_ex_mem ?? 0n,
    maxTxExSteps: blockfrostParams.max_tx_ex_steps ?? 0n,
    coinsPerUtxoByte: blockfrostParams.coins_per_utxo_size ?? 0n,
    collateralPercentage: Number(blockfrostParams.collateral_percent ?? 0n),
    maxCollateralInputs: Number(blockfrostParams.max_collateral_inputs ?? 0n),
    minFeeRefScriptCostPerByte: blockfrostParams.min_fee_ref_script_cost_per_byte || 0,
    drepDeposit: blockfrostParams.drep_deposit ?? 0n,
    govActionDeposit: blockfrostParams.gov_action_deposit ?? 0n,
    costModels: {
      PlutusV1: costModelFromBlockfrost(blockfrostParams, "PlutusV1"),
      PlutusV2: costModelFromBlockfrost(blockfrostParams, "PlutusV2"),
      PlutusV3: costModelFromBlockfrost(blockfrostParams, "PlutusV3")
    }
  }
}

/**
 * Transform Blockfrost amounts to Core Assets
 */
export const transformAmounts = (amounts: ReadonlyArray<BlockfrostAmount>): CoreAssets.Assets => {
  let lovelace = 0n
  const multiAssetEntries: Array<[string, bigint]> = []

  for (const amount of amounts) {
    if (amount.unit === "lovelace") {
      lovelace = amount.quantity
    } else {
      multiAssetEntries.push([amount.unit, amount.quantity])
    }
  }

  // Build Core Assets starting with lovelace
  let assets = CoreAssets.fromLovelace(lovelace)

  // Add multi-assets if any using hex strings
  for (const [unit, qty] of multiAssetEntries) {
    // Parse unit - policyId is first 56 chars, assetName is remainder
    const policyIdHex = unit.slice(0, 56)
    const assetNameHex = unit.slice(56)
    assets = CoreAssets.addByHex(assets, policyIdHex, assetNameHex, qty)
  }

  return assets
}

/**
 * Transform Blockfrost delegation to delegation info
 */
export const transformDelegation = (blockfrostDelegation: BlockfrostDelegation): Provider.Delegation => {
  if (!blockfrostDelegation.pool_id) {
    return { poolId: null, rewards: blockfrostDelegation.withdrawable_amount }
  }

  const poolId = Schema.decodeSync(PoolKeyHash.FromBech32)(blockfrostDelegation.pool_id)
  return { poolId, rewards: blockfrostDelegation.withdrawable_amount }
}

/**
 * Transform JSONWSP-wrapped Ogmios evaluation response to Evolution SDK format
 * Used by /utils/txs/evaluate/utxos endpoint
 * Format: { result: { EvaluationResult: { "spend:0": { "memory": 1100, "steps": 160100 }, ... } } }
 */
export const transformJsonwspOgmiosEvaluationResult = (
  jsonwspResponse: JsonwspOgmiosEvaluationResponse
): Effect.Effect<Array<EvalRedeemer>, ProviderError> => {
  // Handle JSONWSP fault response (Ogmios backend error)
  if (jsonwspResponse.type === "jsonwsp/fault") {
    const faultMessage = jsonwspResponse.fault?.string ?? "unknown fault"
    return Effect.fail(
      new ProviderError({
        message: `Blockfrost evaluation fault: ${faultMessage}`,
        cause: jsonwspResponse
      })
    )
  }

  // Handle missing result field
  if (!jsonwspResponse.result) {
    return Effect.fail(
      new ProviderError({
        message: `Blockfrost evaluation returned no result`,
        cause: jsonwspResponse
      })
    )
  }

  // Check for evaluation failure
  if (jsonwspResponse.result.EvaluationFailure) {
    const failure = jsonwspResponse.result.EvaluationFailure
    return Effect.fail(
      new ProviderError({
        message: `Blockfrost script evaluation failed`,
        cause: failure
      })
    )
  }

  // Handle success case
  const evaluationResult = jsonwspResponse.result.EvaluationResult
  if (!evaluationResult) {
    return Effect.fail(
      new ProviderError({
        message: `Blockfrost evaluation returned no result`,
        cause: "No EvaluationResult in response"
      })
    )
  }

  const result: Array<EvalRedeemer> = []

  for (const [key, budget] of Object.entries(evaluationResult)) {
    // Parse "spend:0", "mint:1", "certificate:0", "withdrawal:0", etc.
    // Blockfrost uses Ogmios v5 JSONWSP which returns "certificate" and "withdrawal";
    // normalize to the SDK's canonical tags "cert" and "reward" (Ogmios v6 / CDDL names).
    const [rawTag, indexStr] = key.split(":")
    const index = parseInt(indexStr, 10)
    const tag = rawTag === "certificate" ? "cert" : rawTag === "withdrawal" ? "reward" : rawTag

    result.push({
      ex_units: new Redeemer.ExUnits({
        mem: budget.memory,
        steps: budget.steps
      }),
      redeemer_index: index,
      redeemer_tag: tag as any
    })
  }

  return Effect.succeed(result)
}
