import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets/index.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const SOURCE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const DESTINATION_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

// Policy IDs for test tokens (56 hex chars)
const FUNGIBLE_POLICY_A = "a".repeat(56)
const FUNGIBLE_POLICY_B = "b".repeat(56)
const NFT_POLICY_C = "c".repeat(56)
const NFT_POLICY_D = "d".repeat(56)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert string to hex encoding (for asset names)
 */
function toHex(str: string): string {
  return Buffer.from(str, "utf8").toString("hex")
}

/**
 * Create fragmented wallet with multiple UTxOs containing mixed assets.
 * Simulates a real-world wallet that needs consolidation.
 */
const createFragmentedWallet = (): Array<CoreUTxO.UTxO> => {
  // UTxO 1: Large ADA + some fungible tokens + NFT
  let assets1 = CoreAssets.fromLovelace(150_000_000n)
  assets1 = CoreAssets.addByHex(assets1, FUNGIBLE_POLICY_A, toHex("HOSKY"), 500_000n)
  assets1 = CoreAssets.addByHex(assets1, NFT_POLICY_C, toHex("NFT001"), 1n)
  const utxo1Base = createCoreTestUtxo({
    transactionId: "1".repeat(64),
    index: 0,
    address: SOURCE_ADDRESS,
    lovelace: 150_000_000n
  })
  const utxo1 = new CoreUTxO.UTxO({ ...utxo1Base, assets: assets1 })

  // UTxO 2: Just ADA
  const utxo2 = createCoreTestUtxo({
    transactionId: "2".repeat(64),
    index: 0,
    address: SOURCE_ADDRESS,
    lovelace: 50_000_000n
  })

  // UTxO 3: Mixed tokens from different policies
  let assets3 = CoreAssets.fromLovelace(10_000_000n)
  assets3 = CoreAssets.addByHex(assets3, FUNGIBLE_POLICY_A, toHex("SNEK"), 250_000n)
  assets3 = CoreAssets.addByHex(assets3, FUNGIBLE_POLICY_B, toHex("SUNDAE"), 100_000n)
  assets3 = CoreAssets.addByHex(assets3, NFT_POLICY_C, toHex("NFT002"), 1n)
  assets3 = CoreAssets.addByHex(assets3, NFT_POLICY_C, toHex("NFT003"), 1n)
  const utxo3Base = createCoreTestUtxo({
    transactionId: "3".repeat(64),
    index: 0,
    address: SOURCE_ADDRESS,
    lovelace: 10_000_000n
  })
  const utxo3 = new CoreUTxO.UTxO({ ...utxo3Base, assets: assets3 })

  // UTxO 4: Large ADA only
  const utxo4 = createCoreTestUtxo({
    transactionId: "4".repeat(64),
    index: 0,
    address: SOURCE_ADDRESS,
    lovelace: 300_000_000n
  })

  // UTxO 5: More tokens + NFTs
  let assets5 = CoreAssets.fromLovelace(5_000_000n)
  assets5 = CoreAssets.addByHex(assets5, FUNGIBLE_POLICY_A, toHex("HOSKY"), 300_000n)
  assets5 = CoreAssets.addByHex(assets5, NFT_POLICY_D, toHex("CNFT001"), 1n)
  assets5 = CoreAssets.addByHex(assets5, NFT_POLICY_D, toHex("CNFT002"), 1n)
  const utxo5Base = createCoreTestUtxo({
    transactionId: "5".repeat(64),
    index: 0,
    address: SOURCE_ADDRESS,
    lovelace: 5_000_000n
  })
  const utxo5 = new CoreUTxO.UTxO({ ...utxo5Base, assets: assets5 })

  // UTxO 6: Small ADA
  const utxo6 = createCoreTestUtxo({
    transactionId: "6".repeat(64),
    index: 0,
    address: SOURCE_ADDRESS,
    lovelace: 25_000_000n
  })

  return [utxo1, utxo2, utxo3, utxo4, utxo5, utxo6]
}

/**
 * Create simple ADA-only wallet for basic tests
 */
const createSimpleAdaWallet = (): Array<CoreUTxO.UTxO> => [
  createCoreTestUtxo({
    transactionId: "a".repeat(64),
    index: 0,
    address: SOURCE_ADDRESS,
    lovelace: 200_000_000n // 200 ADA
  }),
  createCoreTestUtxo({
    transactionId: "b".repeat(64),
    index: 0,
    address: SOURCE_ADDRESS,
    lovelace: 150_000_000n // 150 ADA
  })
]

// ============================================================================
// Test Suite
// ============================================================================

describe("TxBuilder Unfrack + DrainTo Integration", () => {
  const baseConfig: TxBuilderConfig = {}

  // ==========================================================================
  // Basic Combination Tests
  // ==========================================================================

  describe("Basic DrainTo + Unfrack Combination", () => {
    // ADA subdivision with drainTo: Subdivision happens when affordable, drainTo is fallback
    it("should drain and consolidate multiple ADA-only UTxOs with subdivision", async () => {
      // Arrange: Simple ADA-only wallet
      const utxos = createSimpleAdaWallet()

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
        assets: CoreAssets.fromLovelace(1_000_000n) // 1 ADA minimum payment
      })

      // Act: Drain to output 0 with ADA subdivision
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          ada: {
            subdivideThreshold: 100_000_000n, // 100 ADA
            subdividePercentages: [50, 30, 20] // Split into 3 outputs
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Coin selection picks only the first UTxO (200 ADA) since it's sufficient
      expect(tx.body.inputs.length).toBe(1)
      expect(tx.body.outputs.length).toBe(4) // Exact: 1 payment + 3 subdivided change outputs
      expect(tx.body.fee).toBe(173_861n) // Exact deterministic fee (420 bytes * 44 + 155_381, 4 outputs save 8 bytes)

      // Verify exact output amounts (from 200 ADA input - 1 ADA payment - fee)
      expect(tx.body.outputs[0].assets.lovelace).toBe(1_000_000n) // Payment
      expect(tx.body.outputs[1].assets.lovelace).toBe(99_413_069n) // 50% of 198,826,139 change
      expect(tx.body.outputs[2].assets.lovelace).toBe(59_647_841n) // 30% of 198,826,139 change (rounding)
      expect(tx.body.outputs[3].assets.lovelace).toBe(39_765_229n) // 20% of 198,826,139 change (rounding)

      // Verify all outputs are ADA-only (no tokens)
      tx.body.outputs.forEach((output) => {
        expect(output.assets.multiAsset).toBeUndefined()
      })
    })

    it("should drain without subdivision when below threshold", async () => {
      // Arrange: Small ADA amounts below subdivision threshold
      const utxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({
          transactionId: "a".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 50_000_000n // 50 ADA
        }),
        createCoreTestUtxo({
          transactionId: "b".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 30_000_000n // 30 ADA
        })
      ]

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
        assets: CoreAssets.fromLovelace(1_000_000n)
      })

      // Act: Drain with subdivision threshold of 100 ADA (total is 80 ADA, below threshold)
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          ada: {
            subdivideThreshold: 100_000_000n // 100 ADA threshold
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Coin selection picks only first UTxO (50 ADA) since it's sufficient
      expect(tx.body.inputs.length).toBe(1)
      expect(tx.body.outputs.length).toBe(2) // Exact: 1 payment + 1 change (no subdivision)
      expect(tx.body.fee).toBe(168_141n) // Exact deterministic fee (290 bytes * 44 + 155_381, 2 outputs save 4 bytes)

      // Verify exact output amounts (from 50 ADA input - 1 ADA payment - fee)
      expect(tx.body.outputs[0].assets.lovelace).toBe(1_000_000n) // Payment
      expect(tx.body.outputs[1].assets.lovelace).toBe(48_831_859n) // Change (50M - 1M - fee)

      // All outputs should be ADA-only
      tx.body.outputs.forEach((output) => {
        expect(output.assets.multiAsset).toBeUndefined()
      })
    })
  })

  // ==========================================================================
  // Token Handling Tests
  // ==========================================================================

  describe("Token Organization with DrainTo + Unfrack", () => {
    it("should consolidate fragmented wallet with mixed tokens", async () => {
      // Arrange: Fragmented wallet with tokens scattered across UTxOs
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n)
        })

      // Act: Drain with token bundling (no isolation or grouping)
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          tokens: {
            bundleSize: 5 // Bundle tokens in groups of 5
          },
          ada: {
            subdivideThreshold: 100_000_000n // 100 ADA
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations
      expect(tx.body.inputs.length).toBe(6)
      expect(tx.body.outputs.length).toBe(12) // Exact: 1 payment + 11 unfracked change outputs
      expect(tx.body.fee).toBe(213_769n) // Exact deterministic fee (1327 bytes * 44 + 155_381, 12 outputs save 24 bytes)

      // Verify we have both token outputs and ADA-only outputs
      const tokenOutputs = tx.body.outputs.filter((output) => output.assets.multiAsset !== undefined)
      expect(tokenOutputs.length).toBe(4) // Exact: 4 token bundle outputs
    })

    it("should isolate fungible tokens from NFTs", async () => {
      // Arrange: Wallet with both fungible tokens and NFTs
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n)
        })

      // Act: Drain with fungible isolation
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          tokens: {
            bundleSize: 5,
            isolateFungibles: true // Separate fungibles from NFTs
          },
          ada: {
            subdivideThreshold: 100_000_000n
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations
      expect(tx.body.inputs.length).toBe(6)
      expect(tx.body.outputs.length).toBe(12) // Exact: 1 payment + 11 unfracked change outputs
      expect(tx.body.fee).toBe(213_769n) // Exact deterministic fee (1327 bytes * 44 + 155_381, 12 outputs save 24 bytes)

      // Verify separate outputs for fungibles vs NFTs
      const tokenOutputs = tx.body.outputs.filter((output) => output.assets.multiAsset !== undefined)
      expect(tokenOutputs.length).toBe(4) // Exact: 4 token bundle outputs
    })

    it("should group NFTs by policy ID", async () => {
      // Arrange: Wallet with NFTs from multiple policies
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n)
        })

      // Act: Drain with NFT policy grouping
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          tokens: {
            bundleSize: 5,
            groupNftsByPolicy: true // Group NFTs by their policy ID
          },
          ada: {
            subdivideThreshold: 100_000_000n
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations
      expect(tx.body.inputs.length).toBe(6)
      expect(tx.body.outputs.length).toBe(12) // Exact: 1 payment + 11 unfracked change outputs
      expect(tx.body.fee).toBe(213_769n) // Exact deterministic fee (1327 bytes * 44 + 155_381, 12 outputs save 24 bytes)

      // NFTs from the same policy should be in the same output
      const tokenOutputs = tx.body.outputs.filter((output) => output.assets.multiAsset !== undefined)
      expect(tokenOutputs.length).toBe(4) // Exact: 4 token bundle outputs
    })

    it("should apply full token optimization (isolate + group)", async () => {
      // Arrange: Complete fragmented wallet
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n)
        })

      // Act: Drain with full Unfrack.It optimization
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          tokens: {
            bundleSize: 5,
            isolateFungibles: true, // Separate fungibles from NFTs
            groupNftsByPolicy: true // Group NFTs by policy
          },
          ada: {
            subdivideThreshold: 100_000_000n,
            subdividePercentages: [40, 25, 15, 10, 10] // Flexible ADA distribution
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - full optimization
      expect(tx.body.inputs.length).toBe(6) // All 6 UTxOs consumed
      expect(tx.body.outputs.length).toBe(10) // Exact: 1 payment + 9 unfracked change outputs
      expect(tx.body.fee).toBe(208_049n) // Exact deterministic fee (1197 bytes * 44 + 155_381, 10 outputs save 20 bytes)

      // Count output types
      const adaOnlyOutputs = tx.body.outputs.filter((output) => output.assets.multiAsset === undefined)
      const tokenOutputs = tx.body.outputs.filter((output) => output.assets.multiAsset !== undefined)

      expect(adaOnlyOutputs.length).toBe(6) // Exact: 1 payment + 5 ADA subdivisions
      expect(tokenOutputs.length).toBe(4) // Exact: 4 token bundles
    })
  })

  // ==========================================================================
  // Edge Cases and Special Scenarios
  // ==========================================================================

  // Edge case tests for drainTo + unfrack combinations
  describe("Edge Cases", () => {
    it("should handle drainTo without unfrack options (standard consolidation)", async () => {
      // Arrange: Simple ADA-only wallet for deterministic drainTo test
      const utxos = createSimpleAdaWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n)
        })

      // Act: Drain without any unfracking (standard consolidation)
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        // No unfrack options
        protocolParameters: PROTOCOL_PARAMS
      })

      const tx = await signBuilder.toTransaction()

      // Verify basic transaction structure
      expect(tx.body.inputs.length).toBe(2) // Both UTxOs from simple wallet
      expect(tx.body.outputs.length).toBeGreaterThanOrEqual(1) // At least payment output
      expect(tx.body.fee).toBeGreaterThan(0n) // Fee must be positive

      const totalInput = utxos.reduce((sum, utxo) => sum + utxo.assets.lovelace, 0n)
      const totalOutput = tx.body.outputs.reduce((sum, output) => sum + output.assets.lovelace, 0n)

      // Verify balance: inputs = outputs + fee
      expect(totalInput).toBe(totalOutput + tx.body.fee)

      // All outputs should be ADA-only in this test
      tx.body.outputs.forEach((output) => {
        expect(output.assets.multiAsset).toBeUndefined()
      })
    })

    it("should handle empty token bundling options", async () => {
      // Arrange: ADA-only wallet
      const utxos = createSimpleAdaWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n)
        })

      // Act: Drain with empty token options (only ADA subdivision active)
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          tokens: {
            bundleSize: 10 // Default value, but no tokens present
          },
          ada: {
            subdivideThreshold: 100_000_000n,
            subdividePercentages: [60, 40]
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - ADA subdivision only (no tokens)
      expect(tx.body.inputs.length).toBe(2)
      expect(tx.body.outputs.length).toBe(3) // Exact: 1 payment + 2 subdivided change outputs (60%, 40%)
      expect(tx.body.fee).toBe(172_585n) // Exact deterministic fee (391 bytes * 44 + 155_381, 3 outputs save 6 bytes)

      // All outputs should be ADA-only
      tx.body.outputs.forEach((output) => {
        expect(output.assets.multiAsset).toBeUndefined()
      })
    })

    it("should handle very small leftover amounts with unfracking", async () => {
      // Arrange: UTxOs with small total that won't subdivide
      const utxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({
          transactionId: "a".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 10_000_000n // 10 ADA
        }),
        createCoreTestUtxo({
          transactionId: "b".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 5_000_000n // 5 ADA
        })
      ]

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(10_000_000n) // 10 ADA payment
        })

      // Act: Drain with subdivision threshold much higher than leftover
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          ada: {
            subdivideThreshold: 100_000_000n // 100 ADA (leftover is ~5 ADA)
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - small leftover, no subdivision
      expect(tx.body.inputs.length).toBe(2)
      expect(tx.body.outputs.length).toBe(2) // Exact: 1 payment + 1 change (no subdivision)
      expect(tx.body.fee).toBe(169_725n) // Exact deterministic fee (326 bytes * 44 + 155_381, 2 outputs save 4 bytes)

      // Verify exact total output
      const totalOutput = tx.body.outputs.reduce((sum, output) => sum + output.assets.lovelace, 0n)
      expect(totalOutput).toBe(14_830_275n) // 15M - fee (15,000,000 - 169,725)
    })

    it("should work with multiple payment outputs and drainTo", async () => {
      // Arrange: Wallet with tokens
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(5_000_000n) // First payment
        })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(3_000_000n) // Second payment
        })

      // Act: Drain to first output with unfracking
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0, // Drain into first payment output
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          tokens: {
            bundleSize: 5
          },
          ada: {
            subdivideThreshold: 100_000_000n
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - multiple payments with unfracked change
      expect(tx.body.inputs.length).toBe(6)
      expect(tx.body.outputs.length).toBe(13) // Exact: 2 payments + 11 unfracked change outputs
      expect(tx.body.fee).toBe(216_629n) // Exact deterministic fee (1392 bytes * 44 + 155_381, 13 outputs save 26 bytes)

      // Verify exact total output
      const totalOutput = tx.body.outputs.reduce((sum, output) => sum + output.assets.lovelace, 0n)
      expect(totalOutput).toBe(539_783_371n) // 540M - fee (540,000,000 - 216,629)
    })

    it("should respect minimum UTxO requirements when subdividing small amounts", async () => {
      // Arrange: Small wallet that would violate min UTxO if subdivided naively
      const utxos = [
        createCoreTestUtxo({
          transactionId: "a".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 3_000_000n // 3 ADA total
        })
      ]

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n) // 1 ADA payment
        })

      // Act: Try to subdivide into percentages that would create tiny outputs
      // After payment + fees, leftover is ~1.83 ADA
      // Subdividing by [25, 25, 25, 25] would create 4 outputs of ~0.46 ADA each
      // which is BELOW minimum UTxO requirement of ~1.72 ADA
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          ada: {
            subdivideThreshold: 500_000n, // 0.5 ADA (very low threshold)
            subdividePercentages: [25, 25, 25, 25]
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - respects min UTxO when subdividing small amounts.
      // With the correct Babbage/Conway min UTxO formula (160-byte overhead + fixed-point),
      // each subdivided output (~0.46 ADA) would be below min UTxO (~0.97 ADA),
      // so the builder correctly falls back to a single change output.
      expect(tx.body.inputs.length).toBe(1)
      expect(tx.body.outputs.length).toBe(2) // Exact: 1 payment + 1 change (subdivision skipped — below min UTxO)
      expect(tx.body.fee).toBe(168_141n) // Exact deterministic fee for 2-output tx

      // Verify change output gets all remaining ADA (3 ADA - 1 ADA payment - fee)
      const changeOutput = tx.body.outputs[1]
      expect(changeOutput.assets.lovelace).toBe(1_831_859n) // 3_000_000 - 1_000_000 - 168_141

      // Payment and change already verified with exact values above
      expect(tx.body.outputs[0].assets.lovelace).toBe(1_000_000n)
      expect(tx.body.outputs[1].assets.lovelace).toBe(1_831_859n)
    })
  })

  // ==========================================================================
  // Real-World Use Cases
  // ==========================================================================

  // Real-world wallet consolidation scenarios
  describe("Real-World Wallet Consolidation Scenarios", () => {
    it("should optimize wallet before major transaction (cleanup)", async () => {
      // Arrange: Heavily fragmented wallet (simulating long-term usage)
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n) // Minimal payment to trigger consolidation
        })

      // Act: Full wallet optimization
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          tokens: {
            bundleSize: 10, // Larger bundles for efficiency
            isolateFungibles: true,
            groupNftsByPolicy: true
          },
          ada: {
            subdivideThreshold: 50_000_000n, // 50 ADA threshold (lower for smaller wallets)
            subdividePercentages: [50, 25, 15, 10] // 4-way split
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - full wallet optimization
      expect(tx.body.inputs.length).toBe(6) // All fragments consumed
      expect(tx.body.outputs.length).toBe(9) // Exact: 1 payment + 8 unfracked change outputs
      expect(tx.body.fee).toBe(205_189n) // Exact deterministic fee (1132 bytes * 44 + 155_381, 9 outputs save 18 bytes)

      // Verify we have a good mix of outputs
      const adaOnly = tx.body.outputs.filter((o) => o.assets.multiAsset === undefined)
      const withTokens = tx.body.outputs.filter((o) => o.assets.multiAsset !== undefined)

      expect(adaOnly.length).toBe(5) // Exact: 1 payment + 4 ADA subdivisions
      expect(withTokens.length).toBe(4) // Exact: 4 token bundles
    })

    it("should handle wallet migration to new address", async () => {
      // Arrange: Complete wallet to migrate
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_000_000n)
        })

      // Act: Migrate everything to destination with optimization
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(SOURCE_ADDRESS),
        availableUtxos: utxos,
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
        unfrack: {
          tokens: {
            bundleSize: 5,
            isolateFungibles: true,
            groupNftsByPolicy: true
          },
          ada: {
            subdivideThreshold: 100_000_000n,
            subdividePercentages: [35, 25, 20, 10, 10] // 5-way split for flexibility
          }
        }
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - wallet migration with full optimization
      expect(tx.body.inputs.length).toBe(6) // All source UTxOs
      expect(tx.body.outputs.length).toBe(10) // Exact: 1 payment + 9 change outputs
      expect(tx.body.fee).toBe(208_049n) // Exact deterministic fee (1197 bytes * 44 + 155_381, 10 outputs save 20 bytes)

      // Verify balance: total input (540M ADA) = outputs + fee
      const totalOutput = tx.body.outputs.reduce((sum, output) => sum + output.assets.lovelace, 0n)

      // Expected: 540M total input = total output + fee
      expect(totalOutput + tx.body.fee).toBe(540_000_000n) // Exact balance: inputs = outputs + fee
    })
  })
})
