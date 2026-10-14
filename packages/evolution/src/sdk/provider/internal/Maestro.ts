/**
 * @fileoverview Maestro API schemas and transformation utilities
 * Internal module for Maestro provider implementation
 */

import { Schema } from "effect"

import * as CoreAddress from "../../../Address.js"
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
import * as TransactionHash from "../../../TransactionHash.js"
import * as CoreUTxO from "../../../UTxO.js"
import type { EvalRedeemer } from "../../EvalRedeemer.js"
import type * as Provider from "../Provider.js"

// ============================================================================
// Maestro API Response Schemas
// ============================================================================

/**
 * Maestro protocol parameters response schema
 */
export const MaestroProtocolParameters = Schema.Struct({
  min_fee_coefficient: Schema.BigInt,
  min_fee_constant: Schema.Struct({
    ada: Schema.Struct({
      lovelace: Schema.BigInt
    })
  }),
  max_transaction_size: Schema.Struct({
    bytes: Schema.BigInt
  }),
  max_value_size: Schema.Struct({
    bytes: Schema.BigInt
  }),
  stake_credential_deposit: Schema.Struct({
    ada: Schema.Struct({
      lovelace: Schema.BigInt
    })
  }),
  stake_pool_deposit: Schema.Struct({
    ada: Schema.Struct({
      lovelace: Schema.BigInt
    })
  }),
  // The Maestro spec marks these two deposits optional/nullable (#570); the public
  // ProtocolParameters type requires them, so transformProtocolParameters fails with
  // a clear error naming the field when one arrives null or missing (no default exists)
  delegate_representative_deposit: Schema.optionalWith(
    Schema.Struct({
      ada: Schema.Struct({
        lovelace: Schema.BigInt
      })
    }),
    { nullable: true }
  ),
  governance_action_deposit: Schema.optionalWith(
    Schema.Struct({
      ada: Schema.Struct({
        lovelace: Schema.BigInt
      })
    }),
    { nullable: true }
  ),
  script_execution_prices: Schema.Struct({
    memory: Schema.String, // rational format "numerator/denominator"
    cpu: Schema.String // rational format "numerator/denominator"
  }),
  max_execution_units_per_transaction: Schema.Struct({
    memory: Schema.BigInt,
    cpu: Schema.BigInt
  }),
  min_utxo_deposit_coefficient: Schema.BigInt,
  collateral_percentage: Schema.BigInt,
  max_collateral_inputs: Schema.BigInt,
  min_fee_reference_scripts: Schema.optionalWith(
    Schema.Struct({
      base: Schema.NumberFromString
    }),
    { nullable: true }
  ),
  plutus_cost_models: Schema.Struct({
    plutus_v1: Schema.Array(Schema.BigInt),
    plutus_v2: Schema.Array(Schema.BigInt),
    // The spec requires only plutus_v1 and plutus_v2 (#570); a missing/null v3
    // maps to an empty cost model in transformProtocolParameters
    plutus_v3: Schema.optionalWith(Schema.Array(Schema.BigInt), { nullable: true })
  })
})

/**
 * Maestro asset schema
 */
export const MaestroAsset = Schema.Struct({
  unit: Schema.String,
  amount: Schema.BigInt
})

/**
 * Maestro datum option schema
 */
export const MaestroDatumOption = Schema.Struct({
  type: Schema.Literal("hash", "inline"),
  hash: Schema.String,
  // The spec marks datum bytes (and its json rendering) optional/nullable (#570)
  bytes: Schema.optionalWith(Schema.String, { nullable: true }),
  json: Schema.optionalWith(Schema.Unknown, { nullable: true })
})

/**
 * Maestro script schema
 */
export const MaestroScript = Schema.Struct({
  hash: Schema.String,
  type: Schema.Literal("native", "plutusv1", "plutusv2", "plutusv3"),
  bytes: Schema.NullOr(Schema.String),
  json: Schema.NullOr(Schema.Unknown)
})

/**
 * Maestro asset UTxO reference schema (simplified response from /assets/{unit}/utxos)
 */
export const MaestroAssetUTxORef = Schema.Struct({
  tx_hash: Schema.String,
  index: Schema.BigInt,
  address: Schema.String,
  amount: Schema.BigInt
})

/**
 * Maestro UTxO schema
 */
export const MaestroUTxO = Schema.Struct({
  tx_hash: Schema.String,
  index: Schema.BigInt,
  assets: Schema.Array(MaestroAsset),
  address: Schema.String,
  // Both are optional/nullable in the spec (#570); the transforms already accept null
  datum: Schema.optionalWith(MaestroDatumOption, { nullable: true }),
  reference_script: Schema.optionalWith(MaestroScript, { nullable: true })
})

/**
 * Maestro delegation/account response schema
 */
export const MaestroDelegation = Schema.Struct({
  // Optional/nullable in the spec (#570); transformDelegation already maps null to poolId: null
  delegated_pool: Schema.optionalWith(Schema.String, { nullable: true }),
  rewards_available: Schema.BigInt
})

/**
 * Maestro transaction response schema (subset needed for output resolution)
 */
export const MaestroTransaction = Schema.Struct({
  outputs: Schema.Array(MaestroUTxO)
})

/**
 * Maestro timestamped response wrapper
 */
export const MaestroTimestampedResponse = <A, I>(dataSchema: Schema.Schema<A, I>) =>
  Schema.Struct({
    data: dataSchema,
    last_updated: Schema.Struct({
      timestamp: Schema.String,
      block_slot: Schema.BigInt,
      block_hash: Schema.String
    })
  })

/**
 * Maestro paginated response wrapper
 */
export const MaestroPaginatedResponse = <A, I>(dataSchema: Schema.Schema<A, I>) =>
  Schema.Struct({
    data: Schema.Array(dataSchema),
    // Optional/nullable in the spec (#570); the pagination loop already stops on a falsy cursor
    next_cursor: Schema.optionalWith(Schema.String, { nullable: true }),
    last_updated: Schema.Struct({
      timestamp: Schema.String,
      block_slot: Schema.BigInt,
      block_hash: Schema.String
    })
  })

export const MaestroEvaluateRedeemer = Schema.Struct({
  redeemer_tag: Schema.Literal("spend", "mint", "cert", "wdrl", "vote", "propose"),
  redeemer_index: Schema.BigInt,
  ex_units: Schema.Struct({
    mem: Schema.BigInt,
    steps: Schema.BigInt
  })
})

export const MaestroEvalResult = Schema.Array(MaestroEvaluateRedeemer)

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
 * The Maestro spec marks these protocol parameters optional/nullable, but the public
 * ProtocolParameters type requires them and no honest default exists (a deposit of 0
 * would be a silent wrong value). Fail with a clear error naming the field, per #570;
 * MaestroEffect.getProtocolParameters converts this throw into a ProviderError.
 */
const requireProtocolParameter = <T>(value: T | null | undefined, field: string): T => {
  if (value === null || value === undefined) {
    throw new Error(
      `Maestro protocol parameters: required field "${field}" arrived null or missing, and the public ProtocolParameters type has no default for it`
    )
  }
  return value
}

/**
 * Transform Maestro protocol parameters to Evolution SDK format
 */
export const transformProtocolParameters = (
  maestroParams: Schema.Schema.Type<typeof MaestroProtocolParameters>
): Provider.ProtocolParameters => {
  return {
    minFeeA: Number(maestroParams.min_fee_coefficient),
    minFeeB: Number(maestroParams.min_fee_constant.ada.lovelace),
    maxTxSize: Number(maestroParams.max_transaction_size.bytes),
    maxValSize: Number(maestroParams.max_value_size.bytes),
    keyDeposit: maestroParams.stake_credential_deposit.ada.lovelace,
    poolDeposit: maestroParams.stake_pool_deposit.ada.lovelace,
    drepDeposit: requireProtocolParameter(
      maestroParams.delegate_representative_deposit,
      "delegate_representative_deposit"
    ).ada.lovelace,
    govActionDeposit: requireProtocolParameter(maestroParams.governance_action_deposit, "governance_action_deposit").ada
      .lovelace,
    priceMem: parseDecimalFromRational(maestroParams.script_execution_prices.memory),
    priceStep: parseDecimalFromRational(maestroParams.script_execution_prices.cpu),
    maxTxExMem: maestroParams.max_execution_units_per_transaction.memory,
    maxTxExSteps: maestroParams.max_execution_units_per_transaction.cpu,
    coinsPerUtxoByte: maestroParams.min_utxo_deposit_coefficient,
    collateralPercentage: Number(maestroParams.collateral_percentage),
    maxCollateralInputs: Number(maestroParams.max_collateral_inputs),
    minFeeRefScriptCostPerByte: requireProtocolParameter(
      maestroParams.min_fee_reference_scripts,
      "min_fee_reference_scripts"
    ).base,
    costModels: {
      PlutusV1: Object.fromEntries(
        maestroParams.plutus_cost_models.plutus_v1.map((value, index) => [index.toString(), Number(value)])
      ),
      PlutusV2: Object.fromEntries(
        maestroParams.plutus_cost_models.plutus_v2.map((value, index) => [index.toString(), Number(value)])
      ),
      PlutusV3: Object.fromEntries(
        (maestroParams.plutus_cost_models.plutus_v3 ?? []).map((value, index) => [index.toString(), Number(value)])
      )
    }
  }
}

/**
 * Transform Maestro datum option to Evolution SDK format
 */
export const transformDatumOption = (
  maestroDatum?: Schema.Schema.Type<typeof MaestroDatumOption> | null
): DatumOption | undefined => {
  if (!maestroDatum) return undefined
  if (maestroDatum.type === "inline" && maestroDatum.bytes) {
    return new InlineDatum.InlineDatum({ data: PlutusData.fromCBORHex(maestroDatum.bytes) })
  }
  return DatumHash.fromHex(maestroDatum.hash)
}

/**
 * Transform Maestro assets array to Core Assets format
 */
export const transformAssets = (
  maestroAssets: ReadonlyArray<Schema.Schema.Type<typeof MaestroAsset>>
): CoreAssets.Assets => {
  let lovelace = 0n
  const multiAssetEntries: Array<[string, bigint]> = []

  for (const asset of maestroAssets) {
    if (asset.unit === "lovelace") {
      lovelace = asset.amount
    } else {
      multiAssetEntries.push([asset.unit, asset.amount])
    }
  }

  // Build Core Assets starting with lovelace
  let assets = CoreAssets.fromLovelace(lovelace)

  // Add multi-assets using hex strings
  for (const [unit, qty] of multiAssetEntries) {
    // Parse unit - policyId is first 56 chars, assetName is remainder
    const policyIdHex = unit.slice(0, 56)
    const assetNameHex = unit.slice(56)
    assets = CoreAssets.addByHex(assets, policyIdHex, assetNameHex, qty)
  }

  return assets
}

/**
 * Transform Maestro script reference to Evolution SDK format
 */
export const transformScriptRef = (
  maestroScript?: Schema.Schema.Type<typeof MaestroScript> | null
): Script | undefined => {
  if (!maestroScript?.bytes) return undefined
  const scriptBytes = Bytes.fromHex(maestroScript.bytes)
  switch (maestroScript.type) {
    case "plutusv1":
      return new PlutusV1.PlutusV1({ bytes: scriptBytes })
    case "plutusv2":
      return new PlutusV2.PlutusV2({ bytes: scriptBytes })
    case "plutusv3":
      return new PlutusV3.PlutusV3({ bytes: scriptBytes })
    case "native":
      return NativeScripts.fromCBORHex(maestroScript.bytes)
  }
}

/**
 * Transform Maestro UTxO to Core UTxO format
 */
export const transformUTxO = (maestroUtxo: Schema.Schema.Type<typeof MaestroUTxO>): CoreUTxO.UTxO => {
  const assets = transformAssets(maestroUtxo.assets)
  const address = CoreAddress.fromBech32(maestroUtxo.address)
  const transactionId = TransactionHash.fromHex(maestroUtxo.tx_hash)
  const datumOption = transformDatumOption(maestroUtxo.datum)
  const scriptRef = transformScriptRef(maestroUtxo.reference_script)

  return new CoreUTxO.UTxO({
    transactionId,
    index: maestroUtxo.index,
    address,
    assets,
    ...(datumOption && { datumOption }),
    ...(scriptRef && { scriptRef })
  })
}

/**
 * Transform Maestro delegation response to Evolution SDK format
 */
export const transformDelegation = (
  maestroDelegation: Schema.Schema.Type<typeof MaestroDelegation>
): Provider.Delegation => {
  return {
    poolId: maestroDelegation.delegated_pool
      ? PoolKeyHash.fromBech32(maestroDelegation.delegated_pool)
      : null,
    rewards: maestroDelegation.rewards_available
  }
}

/**
 * Transform Maestro evaluation result to Evolution SDK format
 */
export const transformEvaluationResult = (
  maestroResult: Schema.Schema.Type<typeof MaestroEvalResult>
): Array<EvalRedeemer> => {
  return maestroResult.map((redeemer) => ({
    redeemer_tag: (redeemer.redeemer_tag === "wdrl" ? "reward" : redeemer.redeemer_tag) as Redeemer.RedeemerTag,
    redeemer_index: Number(redeemer.redeemer_index),
    ex_units: new Redeemer.ExUnits({
      mem: redeemer.ex_units.mem,
      steps: redeemer.ex_units.steps
    })
  }))
}
