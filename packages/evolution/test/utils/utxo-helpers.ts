import type * as Assets from "../../src/sdk/Assets.js"
import type * as Datum from "../../src/sdk/Datum.js"
import type * as UTxO from "../../src/sdk/UTxO.js"

/**
 * Options for creating a test UTxO.
 */
export type CreateTestUtxoOptions = {
  /**
   * The address of the UTxO. Defaults to a test address.
   * @default "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
   */
  address?: string
  /**
   * Optional datum to attach to the UTxO.
   */
  datumOption?: Datum.Datum
  /**
   * The amount of lovelace in the UTxO.
   */
  lovelace: bigint
  /**
   * Optional native assets to include in the UTxO.
   * Map of policyId+assetName (hex encoded) to quantity.
   */
  nativeAssets?: Record<string, bigint>
  /**
   * The output index. Defaults to 0.
   * @default 0
   */
  outputIndex?: number
  /**
   * The transaction hash. Defaults to 64 zeros.
   * @default "0".repeat(64)
   */
  txHash?: string
}

/**
 * Default test address used when no address is provided.
 */
const DEFAULT_TEST_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

/**
 * Counter for generating unique addresses.
 */
let uniqueAddressCounter = 0

/**
 * Creates a test UTxO with the specified parameters.
 * 
 * @example
 * ```typescript
 * import { createTestUtxo } from "../test/utils/utxo-helpers.js"
 * 
 * // Simple UTxO with only lovelace
 * const utxo = createTestUtxo({ lovelace: 5_000_000n })
 * 
 * // UTxO with native assets
 * const utxoWithAssets = createTestUtxo({
 *   lovelace: 2_000_000n,
 *   nativeAssets: {
 *     "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59": 1000n
 *   }
 * })
 * 
 * // UTxO with custom address and transaction details
 * const customUtxo = createTestUtxo({
 *   lovelace: 10_000_000n,
 *   address: "addr_test1...",
 *   txHash: "a".repeat(64),
 *   outputIndex: 5
 * })
 * ```
 * 
 * @since 2.0.0
 * @category test-utils
 */
export const createTestUtxo = (options: CreateTestUtxoOptions): UTxO.UTxO => {
  const {
    address = DEFAULT_TEST_ADDRESS,
    datumOption,
    lovelace,
    nativeAssets,
    outputIndex = 0,
    txHash = "0".repeat(64)
  } = options

  // Ensure txHash is 64 hex characters (convert short IDs to valid hex)
  // For test simplicity, hash the input string to generate a deterministic 64-char hex
  // This matches the original test helper behavior from EdgeCases.P0.test.ts
  const paddedTxHash = txHash.length === 64 && /^[0-9a-fA-F]+$/.test(txHash)
    ? txHash
    : Array.from(txHash)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
        .padEnd(64, '0')

  const assets: Assets.Assets = nativeAssets
    ? { lovelace, ...nativeAssets }
    : { lovelace }

  return {
    address,
    assets,
    datumOption,
    outputIndex,
    txHash: paddedTxHash
  }
}

/**
 * Creates multiple test UTxOs with the same base parameters.
 * Each UTxO will have a unique outputIndex starting from 0.
 * 
 * @example
 * ```typescript
 * import { createTestUtxos } from "../test/utils/utxo-helpers.js"
 * 
 * // Create 5 UTxOs each with 10 ADA
 * const utxos = createTestUtxos(5, { lovelace: 10_000_000n })
 * 
 * // Create 3 UTxOs with custom parameters
 * const customUtxos = createTestUtxos(3, {
 *   lovelace: 5_000_000n,
 *   address: "addr_test1...",
 *   txHash: "abc123..."
 * })
 * ```
 * 
 * @since 2.0.0
 * @category test-utils
 */
export const createTestUtxos = (
  count: number,
  options: CreateTestUtxoOptions
): Array<UTxO.UTxO> => {
  return Array.from({ length: count }, (_, index) =>
    createTestUtxo({ ...options, outputIndex: index })
  )
}

/**
 * Creates a test UTxO with a unique address.
 * Each call generates a new unique address by appending an incrementing counter
 * to the base test address. This is useful for testing scenarios where UTxOs
 * must belong to different addresses.
 * 
 * @example
 * ```typescript
 * import { createUniqueAddressUtxo } from "../test/utils/utxo-helpers.js"
 * 
 * // Create UTxOs with unique addresses
 * const utxo1 = createUniqueAddressUtxo({ lovelace: 5_000_000n })
 * const utxo2 = createUniqueAddressUtxo({ lovelace: 10_000_000n })
 * // utxo1.address !== utxo2.address
 * 
 * // With native assets
 * const utxo3 = createUniqueAddressUtxo({
 *   lovelace: 2_000_000n,
 *   nativeAssets: {
 *     "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59": 500n
 *   }
 * })
 * ```
 * 
 * @since 2.0.0
 * @category test-utils
 */
export const createUniqueAddressUtxo = (
  options: Omit<CreateTestUtxoOptions, "address">
): UTxO.UTxO => {
  const uniqueAddress = `${DEFAULT_TEST_ADDRESS}_${uniqueAddressCounter++}`
  return createTestUtxo({ ...options, address: uniqueAddress })
}

/**
 * Creates multiple test UTxOs, each with a unique address.
 * Combines the functionality of createTestUtxos and createUniqueAddressUtxo.
 * 
 * @example
 * ```typescript
 * import { createUniqueAddressUtxos } from "../test/utils/utxo-helpers.js"
 * 
 * // Create 5 UTxOs, each with unique address and 10 ADA
 * const utxos = createUniqueAddressUtxos(5, { lovelace: 10_000_000n })
 * // All utxos have different addresses
 * ```
 * 
 * @since 2.0.0
 * @category test-utils
 */
export const createUniqueAddressUtxos = (
  count: number,
  options: Omit<CreateTestUtxoOptions, "address">
): Array<UTxO.UTxO> => {
  return Array.from({ length: count }, () => createUniqueAddressUtxo(options))
}

/**
 * Resets the unique address counter.
 * Useful for ensuring consistent addresses across test runs.
 * 
 * @example
 * ```typescript
 * import { resetUniqueAddressCounter, createUniqueAddressUtxo } from "../test/utils/utxo-helpers.js"
 * 
 * beforeEach(() => {
 *   resetUniqueAddressCounter()
 * })
 * ```
 * 
 * @since 2.0.0
 * @category test-utils
 */
export const resetUniqueAddressCounter = (): void => {
  uniqueAddressCounter = 0
}
