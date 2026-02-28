import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import type * as CoreDatumOption from "@evolution-sdk/evolution/DatumOption"
import type * as CoreScript from "@evolution-sdk/evolution/Script"
import * as CoreTransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as CoreUTxO from "@evolution-sdk/evolution/UTxO"

// Alias for Cardano.Assets
const CoreAssets = Cardano.Assets

/**
 * Default test address used when no address is provided.
 */
const DEFAULT_TEST_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

/**
 * Options for creating a Core test UTxO.
 */
export type CreateCoreTestUtxoOptions = {
  /**
   * The bech32 address of the UTxO. Defaults to a test address.
   */
  address?: string
  /**
   * The amount of lovelace in the UTxO.
   */
  lovelace: bigint
  /**
   * Optional native assets to include in the UTxO.
   * Map of "policyIdHex + assetNameHex" (56 hex chars policyId + rest is assetName) to quantity.
   */
  nativeAssets?: Record<string, bigint>
  /**
   * The output index. Defaults to 0.
   */
  index?: number | bigint
  /**
   * The transaction hash (64 hex chars). Defaults to 64 zeros.
   */
  transactionId?: string
  /**
   * Optional datum option for the UTxO (Core DatumOption type: DatumHash | InlineDatum).
   */
  datumOption?: CoreDatumOption.DatumOption
  /**
   * Optional reference script (Core Script type).
   */
  scriptRef?: CoreScript.Script
}

/**
 * Creates a Core UTxO with the specified parameters.
 */
export const createCoreTestUtxo = (options: CreateCoreTestUtxoOptions): CoreUTxO.UTxO => {
  const {
    address = DEFAULT_TEST_ADDRESS,
    datumOption,
    index: rawIndex = 0,
    lovelace,
    nativeAssets,
    scriptRef,
    transactionId = "0".repeat(64)
  } = options

  // Convert bigint to number if needed
  const index = typeof rawIndex === "bigint" ? Number(rawIndex) : rawIndex

  // Ensure transactionId is 64 hex characters
  const paddedTxId =
    transactionId.length === 64 && /^[0-9a-fA-F]+$/.test(transactionId)
      ? transactionId
      : Array.from(transactionId)
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("")
          .padEnd(64, "0")

  // Build Core Assets
  let assets = CoreAssets.fromLovelace(lovelace)

  if (nativeAssets) {
    for (const [unit, quantity] of Object.entries(nativeAssets)) {
      // Parse unit: first 56 chars are policy ID, rest is asset name
      const policyIdHex = unit.slice(0, 56)
      const assetNameHex = unit.slice(56)
      assets = CoreAssets.addByHex(assets, policyIdHex, assetNameHex, quantity)
    }
  }

  return new CoreUTxO.UTxO({
    transactionId: CoreTransactionHash.fromHex(paddedTxId),
    index: BigInt(index),
    address: CoreAddress.fromBech32(address),
    assets,
    scriptRef,
    datumOption
  })
}
