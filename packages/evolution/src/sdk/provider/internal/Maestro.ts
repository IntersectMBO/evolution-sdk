/**
 * @fileoverview Maestro API schemas and transformation utilities
 * Internal module for Maestro provider implementation
 */

import { Schema } from "effect"

import * as Assets from "../../Assets.js"
import * as Datum from "../../Datum.js"
import * as Delegation from "../../Delegation.js"
import type { EvalRedeemer } from "../../EvalRedeemer.js"
import type * as ProtocolParameters from "../../ProtocolParameters.js"
import type * as UTxO from "../../UTxO.js"

// ============================================================================
// Maestro API Response Schemas
// ============================================================================

/**
 * Maestro protocol parameters response schema
 */
export const MaestroProtocolParameters = Schema.Struct({
  min_fee_coefficient: Schema.String,
  min_fee_constant: Schema.Struct({
    ada: Schema.Struct({
      lovelace: Schema.String,
    }),
  }),
  max_transaction_size: Schema.Struct({
    bytes: Schema.String,
  }),
  max_value_size: Schema.Struct({
    bytes: Schema.String,
  }),
  stake_credential_deposit: Schema.Struct({
    ada: Schema.Struct({
      lovelace: Schema.String,
    }),
  }),
  stake_pool_deposit: Schema.Struct({
    ada: Schema.Struct({
      lovelace: Schema.String,
    }),
  }),
  delegate_representative_deposit: Schema.Struct({
    ada: Schema.Struct({
      lovelace: Schema.String,
    }),
  }),
  governance_action_deposit: Schema.Struct({
    ada: Schema.Struct({
      lovelace: Schema.String,
    }),
  }),
  script_execution_prices: Schema.Struct({
    memory: Schema.String, // rational format "numerator/denominator"
    cpu: Schema.String, // rational format "numerator/denominator"
  }),
  max_execution_units_per_transaction: Schema.Struct({
    memory: Schema.String,
    cpu: Schema.String,
  }),
  min_utxo_deposit_coefficient: Schema.String,
  collateral_percentage: Schema.String,
  max_collateral_inputs: Schema.String,
  min_fee_reference_scripts: Schema.Struct({
    base: Schema.String,
  }),
  plutus_cost_models: Schema.Struct({
    plutus_v1: Schema.Array(Schema.Number),
    plutus_v2: Schema.Array(Schema.Number),
    plutus_v3: Schema.Array(Schema.Number),
  }),
})

/**
 * Maestro asset schema
 */
export const MaestroAsset = Schema.Struct({
  unit: Schema.String,
  amount: Schema.String,
})

/**
 * Maestro datum option schema
 */
export const MaestroDatumOption = Schema.Struct({
  type: Schema.Literal("hash", "inline"),
  hash: Schema.String,
  bytes: Schema.NullOr(Schema.String),
  json: Schema.NullOr(Schema.Unknown),
})

/**
 * Maestro script schema
 */
export const MaestroScript = Schema.Struct({
  hash: Schema.String,
  type: Schema.Literal("native", "plutusv1", "plutusv2", "plutusv3"),
  bytes: Schema.NullOr(Schema.String),
  json: Schema.NullOr(Schema.Unknown),
})

/**
 * Maestro UTxO schema
 */
export const MaestroUTxO = Schema.Struct({
  tx_hash: Schema.String,
  index: Schema.Number,
  assets: Schema.Array(MaestroAsset),
  address: Schema.String,
  datum: Schema.NullOr(MaestroDatumOption),
  reference_script: Schema.NullOr(MaestroScript),
})

/**
 * Maestro delegation/account response schema
 */
export const MaestroDelegation = Schema.Struct({
  delegated_pool: Schema.NullOr(Schema.String),
  rewards_available: Schema.String,
})

/**
 * Maestro timestamped response wrapper
 */
export const MaestroTimestampedResponse = <A>(dataSchema: Schema.Schema<A>) =>
  Schema.Struct({
    data: dataSchema,
    last_updated: Schema.Struct({
      timestamp: Schema.String,
      block_slot: Schema.Number,
      block_hash: Schema.String,
    }),
  })

/**
 * Maestro paginated response wrapper
 */
export const MaestroPaginatedResponse = <A>(dataSchema: Schema.Schema<A>) =>
  Schema.Struct({
    data: Schema.Array(dataSchema),
    next_cursor: Schema.NullOr(Schema.String),
    last_updated: Schema.Struct({
      timestamp: Schema.String,
      block_slot: Schema.Number,
      block_hash: Schema.String,
    }),
  })

/**
 * Maestro evaluation result schema - simplified for now
 */
export const MaestroEvalResult = Schema.Array(Schema.Unknown)

// ============================================================================
// Transformation Utilities
// ============================================================================

export const parseDecimalFromRational = (rationalStr: string): number => {
  const forwardSlashIndex = rationalStr.indexOf("/")
  if (forwardSlashIndex === -1) {
    throw new Error(`Invalid rational string format: ${rationalStr}`)
  }
  const numerator = parseInt(rationalStr.slice(0, forwardSlashIndex))
  const denominator = parseInt(rationalStr.slice(forwardSlashIndex + 1))

  if (isNaN(numerator) || isNaN(denominator) || denominator === 0) {
    throw new Error(`Invalid rational string format: ${rationalStr}`)
  }

  return numerator / denominator
}

/**
 * Transform Maestro protocol parameters to Evolution SDK format
 */
export const transformProtocolParameters = (
  maestroParams: Schema.Schema.Type<typeof MaestroProtocolParameters>
): ProtocolParameters.ProtocolParameters => {
  return {
    minFeeA: parseInt(maestroParams.min_fee_coefficient),
    minFeeB: parseInt(maestroParams.min_fee_constant.ada.lovelace),
    maxTxSize: parseInt(maestroParams.max_transaction_size.bytes),
    maxValSize: parseInt(maestroParams.max_value_size.bytes),
    keyDeposit: BigInt(maestroParams.stake_credential_deposit.ada.lovelace),
    poolDeposit: BigInt(maestroParams.stake_pool_deposit.ada.lovelace),
    drepDeposit: BigInt(maestroParams.delegate_representative_deposit.ada.lovelace),
    govActionDeposit: BigInt(maestroParams.governance_action_deposit.ada.lovelace),
    priceMem: parseDecimalFromRational(maestroParams.script_execution_prices.memory),
    priceStep: parseDecimalFromRational(maestroParams.script_execution_prices.cpu),
    maxTxExMem: BigInt(maestroParams.max_execution_units_per_transaction.memory),
    maxTxExSteps: BigInt(maestroParams.max_execution_units_per_transaction.cpu),
    coinsPerUtxoByte: BigInt(maestroParams.min_utxo_deposit_coefficient),
    collateralPercentage: parseInt(maestroParams.collateral_percentage),
    maxCollateralInputs: parseInt(maestroParams.max_collateral_inputs),
    minFeeRefScriptCostPerByte: parseInt(maestroParams.min_fee_reference_scripts.base),
    costModels: {
      PlutusV1: Object.fromEntries(
        maestroParams.plutus_cost_models.plutus_v1.map(
          (value: number, index: number) => [index.toString(), value]
        )
      ),
      PlutusV2: Object.fromEntries(
        maestroParams.plutus_cost_models.plutus_v2.map(
          (value: number, index: number) => [index.toString(), value]
        )
      ),
      PlutusV3: Object.fromEntries(
        maestroParams.plutus_cost_models.plutus_v3.map(
          (value: number, index: number) => [index.toString(), value]
        )
      ),
    },
  }
}

/**
 * Transform Maestro datum option to Evolution SDK format
 */
export const transformDatumOption = (
  maestroDatum?: Schema.Schema.Type<typeof MaestroDatumOption> | null
): Datum.Datum | undefined => {
  if (!maestroDatum) return undefined

  if (maestroDatum.type === "inline" && maestroDatum.bytes) {
    return Datum.makeInlineDatum(maestroDatum.bytes)
  } else if (maestroDatum.type === "hash") {
    return Datum.makeDatumHash(maestroDatum.hash)
  }

  return undefined
}

/**
 * Transform Maestro assets array to Evolution SDK assets format
 */
export const transformAssets = (
  maestroAssets: ReadonlyArray<Schema.Schema.Type<typeof MaestroAsset>>
): Assets.Assets => {
  let assets = Assets.empty()

  for (const asset of maestroAssets) {
    if (asset.unit === "lovelace") {
      assets = { ...assets, lovelace: BigInt(asset.amount) }
    } else {
      assets = { ...assets, [asset.unit]: BigInt(asset.amount) }
    }
  }

  return assets
}

/**
 * Transform Maestro script reference to Evolution SDK format
 */
export const transformScriptRef = (
  maestroScript?: Schema.Schema.Type<typeof MaestroScript> | null
) => {
  if (!maestroScript || !maestroScript.bytes) {
    return undefined
  }

  switch (maestroScript.type) {
    case "native":
      return {
        type: "Native" as const,
        script: maestroScript.bytes,
      }
    case "plutusv1":
      return {
        type: "PlutusV1" as const,
        script: maestroScript.bytes,
      }
    case "plutusv2":
      return {
        type: "PlutusV2" as const,
        script: maestroScript.bytes,
      }
    case "plutusv3":
      return {
        type: "PlutusV3" as const,
        script: maestroScript.bytes,
      }
    default:
      return undefined
  }
}

/**
 * Transform Maestro UTxO to Evolution SDK format
 */
export const transformUTxO = (
  maestroUtxo: Schema.Schema.Type<typeof MaestroUTxO>
): UTxO.UTxO => {
  return {
    txHash: maestroUtxo.tx_hash,
    outputIndex: maestroUtxo.index,
    assets: transformAssets(maestroUtxo.assets),
    address: maestroUtxo.address,
    datumOption: transformDatumOption(maestroUtxo.datum),
    scriptRef: transformScriptRef(maestroUtxo.reference_script),
  }
}

/**
 * Transform Maestro delegation response to Evolution SDK format
 */
export const transformDelegation = (
  maestroDelegation: Schema.Schema.Type<typeof MaestroDelegation>
): Delegation.Delegation => {
  return Delegation.make(
    maestroDelegation.delegated_pool || undefined,
    BigInt(maestroDelegation.rewards_available)
  )
}

/**
 * Transform Maestro evaluation result to Evolution SDK format
 */
export const transformEvaluationResult = (
  maestroResult: Schema.Schema.Type<typeof MaestroEvalResult>
): Array<EvalRedeemer> => {
  // For now, return as-is since we don't have the exact Maestro eval format
  // This will need to be updated based on actual Maestro evaluation response
  return maestroResult as Array<EvalRedeemer>
}