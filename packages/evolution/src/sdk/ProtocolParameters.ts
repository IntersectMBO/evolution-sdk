/**
 * Protocol Parameters types and utilities for Cardano network configuration.
 *
 * This module provides types and functions for working with Cardano protocol parameters,
 * which define the operational rules and limits of the network.
 */

export type ProtocolParameters = {
  readonly minFeeA: number
  readonly minFeeB: number
  readonly maxTxSize: number
  readonly maxValSize: number
  readonly keyDeposit: bigint
  readonly poolDeposit: bigint
  readonly drepDeposit: bigint
  readonly govActionDeposit: bigint
  readonly priceMem: number
  readonly priceStep: number
  readonly maxTxExMem: bigint
  readonly maxTxExSteps: bigint
  readonly coinsPerUtxoByte: bigint
  readonly collateralPercentage: number
  readonly maxCollateralInputs: number
  readonly minFeeRefScriptCostPerByte: number
  readonly costModels: {
    readonly PlutusV1: Record<string, number>
    readonly PlutusV2: Record<string, number>
    readonly PlutusV3: Record<string, number>
  }
}

/**
 * Calculate the minimum fee for a transaction based on protocol parameters.
 *
 */
export const calculateMinFee = (protocolParams: ProtocolParameters, txSize: number): bigint => {
  return BigInt(protocolParams.minFeeA * txSize + protocolParams.minFeeB)
}

/**
 * Calculate the UTxO cost based on the protocol parameters.
 *
 */
export const calculateUtxoCost = (protocolParams: ProtocolParameters, utxoSize: number): bigint => {
  return protocolParams.coinsPerUtxoByte * BigInt(utxoSize)
}

/**
 * Get the cost model for a specific Plutus version.
 *
 */
export const getCostModel = (
  protocolParams: ProtocolParameters,
  version: "PlutusV1" | "PlutusV2" | "PlutusV3"
): Record<string, number> => {
  return protocolParams.costModels[version]
}

/**
 * Check if the protocol parameters support a specific Plutus version.
 *
 */
export const supportsPlutusVersion = (
  protocolParams: ProtocolParameters,
  version: "PlutusV1" | "PlutusV2" | "PlutusV3"
): boolean => {
  const costModel = protocolParams.costModels[version]
  return costModel && Object.keys(costModel).length > 0
}
