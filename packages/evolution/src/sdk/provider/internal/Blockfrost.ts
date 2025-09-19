/**
 * @fileoverview Blockfrost API schemas and transformation utilities
 * Internal module for Blockfrost provider implementation
 */

import { Schema } from "effect"

import * as Assets from "../../Assets.js"
import type * as Datum from "../../Datum.js"
import * as Delegation from "../../Delegation.js"
import type { EvalRedeemer } from "../../EvalRedeemer.js"
import type * as ProtocolParameters from "../../ProtocolParameters.js"
import type * as UTxO from "../../UTxO.js"

// ============================================================================
// Blockfrost API Response Schemas
// ============================================================================

/**
 * Blockfrost protocol parameters response schema
 */
export const BlockfrostProtocolParameters = Schema.Struct({
  min_fee_a: Schema.Number,
  min_fee_b: Schema.Number,
  pool_deposit: Schema.String,
  key_deposit: Schema.String,
  min_utxo: Schema.String,
  max_tx_size: Schema.Number,
  max_val_size: Schema.optional(Schema.String),
  utxo_cost_per_word: Schema.optional(Schema.String),
  cost_models: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  price_mem: Schema.optional(Schema.Number),
  price_step: Schema.optional(Schema.Number),
  max_tx_ex_mem: Schema.optional(Schema.String),
  max_tx_ex_steps: Schema.optional(Schema.String),
  max_block_ex_mem: Schema.optional(Schema.String),
  max_block_ex_steps: Schema.optional(Schema.String),
  max_block_size: Schema.Number,
  collateral_percent: Schema.optional(Schema.Number),
  max_collateral_inputs: Schema.optional(Schema.Number),
  coins_per_utxo_size: Schema.optional(Schema.String),
  min_fee_ref_script_cost_per_byte: Schema.optional(Schema.Number)
})

export type BlockfrostProtocolParameters = Schema.Schema.Type<typeof BlockfrostProtocolParameters>

/**
 * Blockfrost UTxO amount schema (for multi-asset support)
 */
export const BlockfrostAmount = Schema.Struct({
  unit: Schema.String,
  quantity: Schema.String
})

export type BlockfrostAmount = Schema.Schema.Type<typeof BlockfrostAmount>

/**
 * Blockfrost UTxO response schema
 */
export const BlockfrostUTxO = Schema.Struct({
  tx_hash: Schema.String,
  tx_index: Schema.Number,
  output_index: Schema.Number,
  amount: Schema.Array(BlockfrostAmount),
  block: Schema.String,
  data_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(Schema.String),
  reference_script_hash: Schema.NullOr(Schema.String)
})

export type BlockfrostUTxO = Schema.Schema.Type<typeof BlockfrostUTxO>

/**
 * Blockfrost delegation response schema
 */
export const BlockfrostDelegation = Schema.Struct({
  active: Schema.Boolean,
  pool_id: Schema.NullOr(Schema.String),
  live_stake: Schema.String,
  active_stake: Schema.String
})

export type BlockfrostDelegation = Schema.Schema.Type<typeof BlockfrostDelegation>

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
 * Blockfrost transaction evaluation response schema
 */
export const BlockfrostRedeemer = Schema.Struct({
  tx_index: Schema.Number,
  purpose: Schema.Literal("spend", "mint", "cert", "reward"),
  unit_mem: Schema.String,
  unit_steps: Schema.String,
  fee: Schema.String
})

export const BlockfrostEvaluationResponse = Schema.Struct({
  result: Schema.Struct({
    EvaluationResult: Schema.Array(BlockfrostRedeemer)
  })
})

export type BlockfrostEvaluationResponse = Schema.Schema.Type<typeof BlockfrostEvaluationResponse>

// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Transform Blockfrost protocol parameters to Evolution SDK format
 */
export const transformProtocolParameters = (
  blockfrostParams: BlockfrostProtocolParameters
): ProtocolParameters.ProtocolParameters => {
  return {
    minFeeA: blockfrostParams.min_fee_a,
    minFeeB: blockfrostParams.min_fee_b,
    poolDeposit: BigInt(blockfrostParams.pool_deposit),
    keyDeposit: BigInt(blockfrostParams.key_deposit),
    maxTxSize: blockfrostParams.max_tx_size,
    maxValSize: blockfrostParams.max_val_size ? Number(blockfrostParams.max_val_size) : 0,
    priceMem: blockfrostParams.price_mem || 0,
    priceStep: blockfrostParams.price_step || 0,
    maxTxExMem: blockfrostParams.max_tx_ex_mem ? BigInt(blockfrostParams.max_tx_ex_mem) : 0n,
    maxTxExSteps: blockfrostParams.max_tx_ex_steps ? BigInt(blockfrostParams.max_tx_ex_steps) : 0n,
    coinsPerUtxoByte: blockfrostParams.coins_per_utxo_size ? BigInt(blockfrostParams.coins_per_utxo_size) : 0n,
    collateralPercentage: blockfrostParams.collateral_percent || 0,
    maxCollateralInputs: blockfrostParams.max_collateral_inputs || 0,
    minFeeRefScriptCostPerByte: blockfrostParams.min_fee_ref_script_cost_per_byte || 0,
    drepDeposit: 0n, // Not provided by this endpoint
    govActionDeposit: 0n, // Not provided by this endpoint
    costModels: {
      PlutusV1: (blockfrostParams.cost_models?.PlutusV1 as Record<string, number>) || {},
      PlutusV2: (blockfrostParams.cost_models?.PlutusV2 as Record<string, number>) || {},
      PlutusV3: (blockfrostParams.cost_models?.PlutusV3 as Record<string, number>) || {}
    }
  }
}

/**
 * Transform Blockfrost amounts to Evolution SDK Assets
 */
export const transformAmounts = (amounts: ReadonlyArray<BlockfrostAmount>): Assets.Assets => {
  let assets = Assets.empty()
  
  for (const amount of amounts) {
    if (amount.unit === "lovelace") {
      assets = { ...assets, lovelace: BigInt(amount.quantity) }
    } else {
      assets = { ...assets, [amount.unit]: BigInt(amount.quantity) }
    }
  }
  
  return assets
}

/**
 * Transform Blockfrost UTxO to Evolution SDK UTxO
 */
export const transformUTxO = (blockfrostUtxo: BlockfrostUTxO, address: string): UTxO.UTxO => {
  const assets = transformAmounts(blockfrostUtxo.amount)

  let datumOption: Datum.Datum | undefined = undefined
  if (blockfrostUtxo.inline_datum) {
    datumOption = {
      type: "inlineDatum",
      inline: blockfrostUtxo.inline_datum
    }
  } else if (blockfrostUtxo.data_hash) {
    datumOption = {
      type: "datumHash",
      hash: blockfrostUtxo.data_hash
    }
  }

  return {
    txHash: blockfrostUtxo.tx_hash,
    outputIndex: blockfrostUtxo.output_index,
    address,
    assets,
    datumOption,
    scriptRef: undefined // Blockfrost doesn't provide full script data, only hash
  }
}

/**
 * Transform Blockfrost delegation to Evolution SDK delegation
 */
export const transformDelegation = (blockfrostDelegation: BlockfrostDelegation): Delegation.Delegation => {
  if (!blockfrostDelegation.active || !blockfrostDelegation.pool_id) {
    return Delegation.empty()
  }

  return Delegation.make(blockfrostDelegation.pool_id, BigInt(blockfrostDelegation.active_stake))
}

/**
 * Transform Blockfrost evaluation response to Evolution SDK format
 */
export const transformEvaluationResult = (
  blockfrostResponse: BlockfrostEvaluationResponse
): Array<EvalRedeemer> => {
  return blockfrostResponse.result.EvaluationResult.map((redeemer) => ({
    ex_units: {
      mem: Number(redeemer.unit_mem),
      steps: Number(redeemer.unit_steps)
    },
    redeemer_index: redeemer.tx_index,
    redeemer_tag: redeemer.purpose === "cert" ? "publish" : redeemer.purpose === "reward" ? "withdraw" : redeemer.purpose
  }))
}