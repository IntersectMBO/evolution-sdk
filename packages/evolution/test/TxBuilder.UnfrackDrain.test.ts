import { describe, expect, it } from "@effect/vitest"

import * as Assets from "../src/sdk/Assets.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import type * as UTxO from "../src/sdk/UTxO.js"
import { createTestUtxo } from "./utils/utxo-helpers.js"

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
const createFragmentedWallet = (): Array<UTxO.UTxO> => [
  // UTxO 1: Large ADA + some fungible tokens + NFT
  createTestUtxo({
    txHash: "1".repeat(64),
    outputIndex: 0,
    address: SOURCE_ADDRESS,
    lovelace: 150_000_000n, // 150 ADA
    nativeAssets: {
      [`${FUNGIBLE_POLICY_A}${toHex("HOSKY")}`]: 500_000n,
      [`${NFT_POLICY_C}${toHex("NFT001")}`]: 1n
    }
  }),
  // UTxO 2: Just ADA
  createTestUtxo({
    txHash: "2".repeat(64),
    outputIndex: 0,
    address: SOURCE_ADDRESS,
    lovelace: 50_000_000n // 50 ADA
  }),
  // UTxO 3: Mixed tokens from different policies
  createTestUtxo({
    txHash: "3".repeat(64),
    outputIndex: 0,
    address: SOURCE_ADDRESS,
    lovelace: 10_000_000n, // 10 ADA
    nativeAssets: {
      [`${FUNGIBLE_POLICY_A}${toHex("SNEK")}`]: 250_000n,
      [`${FUNGIBLE_POLICY_B}${toHex("SUNDAE")}`]: 100_000n,
      [`${NFT_POLICY_C}${toHex("NFT002")}`]: 1n,
      [`${NFT_POLICY_C}${toHex("NFT003")}`]: 1n
    }
  }),
  // UTxO 4: Large ADA only
  createTestUtxo({
    txHash: "4".repeat(64),
    outputIndex: 0,
    address: SOURCE_ADDRESS,
    lovelace: 300_000_000n // 300 ADA
  }),
  // UTxO 5: More tokens + NFTs
  createTestUtxo({
    txHash: "5".repeat(64),
    outputIndex: 0,
    address: SOURCE_ADDRESS,
    lovelace: 5_000_000n, // 5 ADA
    nativeAssets: {
      [`${FUNGIBLE_POLICY_A}${toHex("HOSKY")}`]: 300_000n, // More HOSKY (same as UTxO 1)
      [`${NFT_POLICY_D}${toHex("CNFT001")}`]: 1n,
      [`${NFT_POLICY_D}${toHex("CNFT002")}`]: 1n
    }
  }),
  // UTxO 6: Small ADA
  createTestUtxo({
    txHash: "6".repeat(64),
    outputIndex: 0,
    address: SOURCE_ADDRESS,
    lovelace: 25_000_000n // 25 ADA
  })
];

/**
 * Create simple ADA-only wallet for basic tests
 */
const createSimpleAdaWallet = (): Array<UTxO.UTxO> => [
  createTestUtxo({
    txHash: "a".repeat(64),
    outputIndex: 0,
    address: SOURCE_ADDRESS,
    lovelace: 200_000_000n // 200 ADA
  }),
  createTestUtxo({
    txHash: "b".repeat(64),
    outputIndex: 0,
    address: SOURCE_ADDRESS,
    lovelace: 150_000_000n // 150 ADA
  })
];

// ============================================================================
// Test Suite
// ============================================================================

describe("TxBuilder Unfrack + DrainTo Integration", () => {
  const baseConfig: TxBuilderConfig = {
    protocolParameters: PROTOCOL_PARAMS,
    changeAddress: DESTINATION_ADDRESS,
    availableUtxos: []
  }

  // ==========================================================================
  // Basic Combination Tests
  // ==========================================================================

  describe("Basic DrainTo + Unfrack Combination", () => {
    // ADA subdivision with drainTo: Subdivision happens when affordable, drainTo is fallback
    it("should drain and consolidate multiple ADA-only UTxOs with subdivision", async () => {
      // Arrange: Simple ADA-only wallet
      const utxos = createSimpleAdaWallet()

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n) // 1 ADA minimum payment
        })

      // Act: Drain to output 0 with ADA subdivision
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        unfrack: {
          ada: {
            subdivideThreshold: 100_000_000n, // 100 ADA
            subdividePercentages: [50, 30, 20] // Split into 3 outputs
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Coin selection picks only the first UTxO (200 ADA) since it's sufficient
      expect(tx.body.inputs.length).toBe(1)
      expect(tx.body.outputs.length).toBe(4) // Exact: 1 payment + 3 subdivided change outputs
      expect(tx.body.fee).toBe(174_213n) // Exact deterministic fee (428 bytes * 44 + 155_381)
      
      // Verify exact output amounts (from 200 ADA input - 1 ADA payment - fee)
      expect(tx.body.outputs[0].amount.coin).toBe(1_000_000n) // Payment
      expect(tx.body.outputs[1].amount.coin).toBe(99_412_893n) // 50% of 198,825,787 change
      expect(tx.body.outputs[2].amount.coin).toBe(59_647_736n) // 30% of 198,825,787 change
      expect(tx.body.outputs[3].amount.coin).toBe(39_765_158n) // 20% of 198,825,787 change

      // Verify all outputs are ADA-only (no tokens)
      tx.body.outputs.forEach((output) => {
        expect(output.amount._tag).toBe("OnlyCoin")
      })
    })

    it("should drain without subdivision when below threshold", async () => {
      // Arrange: Small ADA amounts below subdivision threshold
      const utxos: Array<UTxO.UTxO> = [
        {
          txHash: "a".repeat(64),
          outputIndex: 0,
          address: SOURCE_ADDRESS,
          assets: { lovelace: 50_000_000n } // 50 ADA
        },
        {
          txHash: "b".repeat(64),
          outputIndex: 0,
          address: SOURCE_ADDRESS,
          assets: { lovelace: 30_000_000n } // 30 ADA
        }
      ]

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n)
        })

      // Act: Drain with subdivision threshold of 100 ADA (total is 80 ADA, below threshold)
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        unfrack: {
          ada: {
            subdivideThreshold: 100_000_000n // 100 ADA threshold
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Coin selection picks only first UTxO (50 ADA) since it's sufficient
      expect(tx.body.inputs.length).toBe(1)
      expect(tx.body.outputs.length).toBe(2) // Exact: 1 payment + 1 change (no subdivision)
      expect(tx.body.fee).toBe(168_317n) // Exact deterministic fee (294 bytes * 44 + 155_381)
      
      // Verify exact output amounts (from 50 ADA input - 1 ADA payment - fee)
      expect(tx.body.outputs[0].amount.coin).toBe(1_000_000n) // Payment
      expect(tx.body.outputs[1].amount.coin).toBe(48_831_683n) // Change (50M - 1M - fee)
      
      // All outputs should be ADA-only
      tx.body.outputs.forEach((output) => {
        expect(output.amount._tag).toBe("OnlyCoin")
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
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n)
        })

      // Act: Drain with token bundling (no isolation or grouping)
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        unfrack: {
          tokens: {
            bundleSize: 5 // Bundle tokens in groups of 5
          },
          ada: {
            subdivideThreshold: 100_000_000n // 100 ADA
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations
      expect(tx.body.inputs.length).toBe(6)
      expect(tx.body.outputs.length).toBe(12) // Exact: 1 payment + 11 unfracked change outputs
      expect(tx.body.fee).toBe(220_281n) // Exact deterministic fee (1475 bytes * 44 + 155_381)

      // Verify we have both token outputs and ADA-only outputs
      const tokenOutputs = tx.body.outputs.filter(
        (output) => output.amount._tag === "WithAssets"
      )
      expect(tokenOutputs.length).toBe(4) // Exact: 4 token bundle outputs
    })

    it("should isolate fungible tokens from NFTs", async () => {
      // Arrange: Wallet with both fungible tokens and NFTs
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n)
        })

      // Act: Drain with fungible isolation
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        unfrack: {
          tokens: {
            bundleSize: 5,
            isolateFungibles: true // Separate fungibles from NFTs
          },
          ada: {
            subdivideThreshold: 100_000_000n
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations
      expect(tx.body.inputs.length).toBe(6)
      expect(tx.body.outputs.length).toBe(12) // Exact: 1 payment + 11 unfracked change outputs
      expect(tx.body.fee).toBe(220_281n) // Exact deterministic fee (1475 bytes * 44 + 155_381)

      // Verify separate outputs for fungibles vs NFTs
      const tokenOutputs = tx.body.outputs.filter(
        (output) => output.amount._tag === "WithAssets"
      )
      expect(tokenOutputs.length).toBe(4) // Exact: 4 token bundle outputs
    })

    it("should group NFTs by policy ID", async () => {
      // Arrange: Wallet with NFTs from multiple policies
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n)
        })

      // Act: Drain with NFT policy grouping
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        unfrack: {
          tokens: {
            bundleSize: 5,
            groupNftsByPolicy: true // Group NFTs by their policy ID
          },
          ada: {
            subdivideThreshold: 100_000_000n
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations
      expect(tx.body.inputs.length).toBe(6)
      expect(tx.body.outputs.length).toBe(12) // Exact: 1 payment + 11 unfracked change outputs
      expect(tx.body.fee).toBe(220_281n) // Exact deterministic fee (1475 bytes * 44 + 155_381)

      // NFTs from the same policy should be in the same output
      const tokenOutputs = tx.body.outputs.filter(
        (output) => output.amount._tag === "WithAssets"
      )
      expect(tokenOutputs.length).toBe(4) // Exact: 4 token bundle outputs
    })

    it("should apply full token optimization (isolate + group)", async () => {
      // Arrange: Complete fragmented wallet
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n)
        })

      // Act: Drain with full Unfrack.It optimization
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
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
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - full optimization
      expect(tx.body.inputs.length).toBe(6) // All 6 UTxOs consumed
      expect(tx.body.outputs.length).toBe(10) // Exact: 1 payment + 9 unfracked change outputs
      expect(tx.body.fee).toBe(214_385n) // Exact deterministic fee (1341 bytes * 44 + 155_381)

      // Count output types
      const adaOnlyOutputs = tx.body.outputs.filter(
        (output) => output.amount._tag === "OnlyCoin"
      )
      const tokenOutputs = tx.body.outputs.filter(
        (output) => output.amount._tag === "WithAssets"
      )

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
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n)
        })

      // Act: Drain without any unfracking (standard consolidation)
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        // No unfrack options
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Verify basic transaction structure
      expect(tx.body.inputs.length).toBe(2) // Both UTxOs from simple wallet
      expect(tx.body.outputs.length).toBeGreaterThanOrEqual(1) // At least payment output
      expect(tx.body.fee).toBeGreaterThan(0n) // Fee must be positive

      const totalInput = utxos.reduce((sum, utxo) => sum + utxo.assets.lovelace, 0n)
      const totalOutput = tx.body.outputs.reduce((sum, output) => sum + output.amount.coin, 0n)
      
      // Verify balance: inputs = outputs + fee
      expect(totalInput).toBe(totalOutput + tx.body.fee)

      // All outputs should be ADA-only in this test
      tx.body.outputs.forEach((output) => {
        expect(output.amount._tag).toBe("OnlyCoin")
      })
    })

    it("should handle empty token bundling options", async () => {
      // Arrange: ADA-only wallet
      const utxos = createSimpleAdaWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n)
        })

      // Act: Drain with empty token options (only ADA subdivision active)
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        unfrack: {
          tokens: {
            bundleSize: 10 // Default value, but no tokens present
          },
          ada: {
            subdivideThreshold: 100_000_000n,
            subdividePercentages: [60, 40]
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - ADA subdivision only (no tokens)
      expect(tx.body.inputs.length).toBe(2)
      expect(tx.body.outputs.length).toBe(3) // Exact: 1 payment + 2 subdivided change outputs (60%, 40%)
      expect(tx.body.fee).toBe(172_849n) // Exact deterministic fee (397 bytes * 44 + 155_381)

      // All outputs should be ADA-only
      tx.body.outputs.forEach((output) => {
        expect(output.amount._tag).toBe("OnlyCoin")
      })
    })

    it("should handle very small leftover amounts with unfracking", async () => {
      // Arrange: UTxOs with small total that won't subdivide
      const utxos: Array<UTxO.UTxO> = [
        {
          txHash: "a".repeat(64),
          outputIndex: 0,
          address: SOURCE_ADDRESS,
          assets: { lovelace: 10_000_000n } // 10 ADA
        },
        {
          txHash: "b".repeat(64),
          outputIndex: 0,
          address: SOURCE_ADDRESS,
          assets: { lovelace: 5_000_000n } // 5 ADA
        }
      ]

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(10_000_000n) // 10 ADA payment
        })

      // Act: Drain with subdivision threshold much higher than leftover
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        unfrack: {
          ada: {
            subdivideThreshold: 100_000_000n // 100 ADA (leftover is ~5 ADA)
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - small leftover, no subdivision
      expect(tx.body.inputs.length).toBe(2)
      expect(tx.body.outputs.length).toBe(2) // Exact: 1 payment + 1 change (no subdivision)
      expect(tx.body.fee).toBe(169_901n) // Exact deterministic fee (330 bytes * 44 + 155_381)

      // Verify exact total output
      const totalOutput = tx.body.outputs.reduce(
        (sum, output) => sum + output.amount.coin,
        0n
      )
      expect(totalOutput).toBe(14_830_099n) // 15M - fee (15,000,000 - 169,901)
    })

    it("should work with multiple payment outputs and drainTo", async () => {
      // Arrange: Wallet with tokens
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(5_000_000n) // First payment
        })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(3_000_000n) // Second payment
        })

      // Act: Drain to first output with unfracking
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0, // Drain into first payment output
        unfrack: {
          tokens: {
            bundleSize: 5
          },
          ada: {
            subdivideThreshold: 100_000_000n
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - multiple payments with unfracked change
      expect(tx.body.inputs.length).toBe(6)
      expect(tx.body.outputs.length).toBe(13) // Exact: 2 payments + 11 unfracked change outputs
      expect(tx.body.fee).toBe(223_229n) // Exact deterministic fee (1542 bytes * 44 + 155_381)

      // Verify exact total output
      const totalOutput = tx.body.outputs.reduce(
        (sum, output) => sum + output.amount.coin,
        0n
      )
      expect(totalOutput).toBe(539_776_771n) // 540M - fee (540,000,000 - 223,229)
    })

    it("should respect minimum UTxO requirements when subdividing small amounts", async () => {
      // Arrange: Small wallet that would violate min UTxO if subdivided naively
      const utxos = [
        {
          txHash: "a".repeat(64),
          outputIndex: 0,
          address: SOURCE_ADDRESS,
          assets: { lovelace: 3_000_000n } // 3 ADA total
        }
      ]

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n) // 1 ADA payment
        })

      // Act: Try to subdivide into percentages that would create tiny outputs
      // After payment + fees, leftover is ~1.83 ADA
      // Subdividing by [25, 25, 25, 25] would create 4 outputs of ~0.46 ADA each
      // which is BELOW minimum UTxO requirement of ~1.72 ADA
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
        unfrack: {
          ada: {
            subdivideThreshold: 500_000n, // 0.5 ADA (very low threshold)
            subdividePercentages: [25, 25, 25, 25]
          }
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - respects min UTxO when subdividing small amounts
      expect(tx.body.inputs.length).toBe(1)
      expect(tx.body.outputs.length).toBe(5) // Exact: 1 payment + 4 subdivided outputs
      expect(tx.body.fee).toBe(177_161n) // Exact deterministic fee (495 bytes * 44 + 155_381)
      
      // Calculate actual minimum UTxO for ADA-only output
      const actualMinUtxo = 172_400n
      
      // All outputs should meet minimum
      tx.body.outputs.forEach((output) => {
        expect(output.amount.coin).toBeGreaterThanOrEqual(actualMinUtxo)
      })
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
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n) // Minimal payment to trigger consolidation
        })

      // Act: Full wallet optimization
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
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
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - full wallet optimization
      expect(tx.body.inputs.length).toBe(6) // All fragments consumed
      expect(tx.body.outputs.length).toBe(9) // Exact: 1 payment + 8 unfracked change outputs
      expect(tx.body.fee).toBe(211_437n) // Exact deterministic fee (1274 bytes * 44 + 155_381)

      // Verify we have a good mix of outputs
      const adaOnly = tx.body.outputs.filter((o) => o.amount._tag === "OnlyCoin")
      const withTokens = tx.body.outputs.filter(
        (o) => o.amount._tag === "WithAssets"
      )

      expect(adaOnly.length).toBe(5) // Exact: 1 payment + 4 ADA subdivisions
      expect(withTokens.length).toBe(4) // Exact: 4 token bundles
    })

    it("should handle wallet migration to new address", async () => {
      // Arrange: Complete wallet to migrate
      const utxos = createFragmentedWallet()

      const builder = makeTxBuilder(baseConfig)
        .collectFrom({ inputs: utxos })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_000_000n)
        })

      // Act: Migrate everything to destination with optimization
      const signBuilder = await builder.build({
        useV3: true,
        drainTo: 0,
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
        },
        useStateMachine: true
      })

      const tx = await signBuilder.toTransaction()

      // Strict deterministic expectations - wallet migration with full optimization
      expect(tx.body.inputs.length).toBe(6) // All source UTxOs
      expect(tx.body.outputs.length).toBe(10) // Exact: 1 payment + 9 change outputs  
      expect(tx.body.fee).toBe(214_385n) // Exact deterministic fee (1341 bytes * 44 + 155_381)

            // Verify balance: total input (540M ADA) = outputs + fee
      const totalOutput = tx.body.outputs.reduce(
        (sum, output) => sum + output.amount.coin,
        0n
      )
      
      // Expected: 540M total input = total output + fee
      expect(totalOutput + tx.body.fee).toBe(540_000_000n) // Exact balance: inputs = outputs + fee
    })
  })
})
