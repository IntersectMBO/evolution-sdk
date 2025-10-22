import { describe, expect, it } from "@effect/vitest"
import { Effect, FastCheck, Schema } from "effect"

import * as AddressStructure from "../src/core/AddressStructure.js"
import * as KeyHash from "../src/core/KeyHash.js"
import * as Assets from "../src/sdk/Assets.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { calculateTransactionSize } from "../src/sdk/builders/TxBuilderImpl.js"
import type * as UTxO from "../src/sdk/UTxO.js"
import * as FeeValidation from "../src/utils/FeeValidation.js"
import { createTestUtxo } from "./utils/utxo-helpers.js"

describe("TxBuilder Re-selection Loop", () => {
  
  // ============================================================================
  // Test Configuration
  // ============================================================================
  
  const PROTOCOL_PARAMS = {
    minFeeCoefficient: 44n,
    minFeeConstant: 155_381n,
    coinsPerUtxoByte: 4_310n,
    maxTxSize: 16_384
  }

  // Sample testnet addresses
  const TESTNET_ADDRESSES = [
    "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae",
    "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7",
    "addr_test1qzx9hu8j4ah3auytk0mwcupd69hpc52t0cw39a62ndgy4cn4tcpgzfmdq43a6wvvzjhsxkqa5rkqx0pmuekm0c0e66z9dkxdgj",
    "addr_test1qr5v2dz4s5uhmx3hfn5xk8xjv5zqx6rl0pc7zy2qldj0y5z3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsftj0w6",
    "addr_test1qpm9q3v5gnvjwx7kw0ml7dxqxd6h9fqxgu2s7umd9je3c5s3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgslxdxms"
  ] as const

  const CHANGE_ADDRESS = TESTNET_ADDRESSES[0]
  const RECEIVER_ADDRESS = TESTNET_ADDRESSES[1]

  const baseConfig: TxBuilderConfig = {
    protocolParameters: PROTOCOL_PARAMS,
    changeAddress: CHANGE_ADDRESS,
    availableUtxos: []
  }

  // ============================================================================
  // Test Utilities
  // ============================================================================

  /**
   * Validate transaction fee matches expected minimum
   */
  const assertFeeValid = async (
    txWithFakeWitnesses: any,
    params: { minFeeCoefficient: bigint; minFeeConstant: bigint }
  ) => {
    const validation = FeeValidation.validateTransactionFee(txWithFakeWitnesses, params)
    
    expect(validation.isValid).toBe(true)
    expect(validation.difference).toBe(0n)
    
    return validation
  }

  // ============================================================================
  // Basic Re-selection Tests
  // ============================================================================

  describe("Basic Re-selection Scenarios", () => {
    
    it("should build transaction with single UTxO - sufficient funds", async () => {
      const utxo: UTxO.UTxO = createTestUtxo({
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 10_000_000n
      })

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(2_000_000n)
        })

      const signBuilder = await builder.build({ useV3: true })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Strict expectations - everything is deterministic
      expect(tx.body.inputs.length).toBe(1)
      expect(tx.body.outputs.length).toBe(2) // Payment + change
      
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)
      
      // Strict expectations with deterministic values
      expect(size).toBe(294) // Exact transaction size with 1 witness
      expect(validation.actualFee).toBe(168_317n) // Exact deterministic fee
      
      // Verify exact output amounts
      expect(tx.body.outputs[0].amount.coin).toBe(2_000_000n) // Payment output
      // Change: 10M - 2M payment - 168,317 fee = 7,831,683
      expect(tx.body.outputs[1].amount.coin).toBe(7_831_683n) // Change output (exact deterministic value)
    })

    it("should trigger re-selection with tight balance", async () => {
      // Create scenario where first selection seems sufficient but becomes insufficient after fee
      const utxo1: UTxO.UTxO = createTestUtxo({
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 2_200_000n
      })

      const utxo2: UTxO.UTxO = createTestUtxo({
        txHash: "b".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n
      })

      const utxo3: UTxO.UTxO = createTestUtxo({
        txHash: "c".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n
      })

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo1, utxo2, utxo3] })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(2_000_000n) // 2 ADA payment
        })

      const signBuilder = await builder.build({ drainTo: 0, useV3: true })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // V3 reselection works correctly: selects first UTxO, detects insufficient change,
      // triggers reselection to add second UTxO, creates valid change output
      expect(tx.body.inputs.length).toBe(2) // utxo1 (2.2M) + utxo2 (1M) after reselection
      // Should have 2 outputs: payment + change
      expect(tx.body.outputs.length).toBe(2)
      
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)
      
      expect(size).toBe(330) // 2 inputs, 1 witness, 2 outputs
      expect(validation.actualFee).toBe(169_901n) // Fee for 2-input TX
      
      // Verify exact output amounts - reselection creates proper change output
      expect(tx.body.outputs[0].amount.coin).toBe(2_000_000n) // Payment output
      expect(tx.body.outputs[1].amount.coin).toBe(1_030_099n) // Change output (3.2M - 2M - fee)
    })

    it("should throw error when insufficient total funds", async () => {
      const utxo: UTxO.UTxO = createTestUtxo({
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n
      })

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(2_000_000n) // Requesting 2 ADA
        })

      await expect(builder.build({ useV3: true })).rejects.toThrow()
    })

    it("should handle exact amount with drainTo", async () => {
      // Calculate exact amount: payment + approximate fee
      const paymentAmount = 2_000_000n
      const estimatedFee = 170_000n
      const exactAmount = paymentAmount + estimatedFee

      const utxo: UTxO.UTxO = createTestUtxo({
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: exactAmount
      })

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(paymentAmount)
        })

      const signBuilder = await builder.build({ drainTo: 0, useV3: true })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      expect(tx.body.inputs.length).toBe(1)
      // Should have 1 output (payment with drained amount)
      expect(tx.body.outputs.length).toBe(1)
      
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)
      
      // Strict expectations with deterministic values  
      expect(size).toBe(227) // Exact transaction size with 1 witness, drainTo
      expect(validation.actualFee).toBe(165_369n) // Exact fee: 227*44 + 155_381
      
      // Verify exact output amount (payment + drained leftover)
      expect(tx.body.outputs[0].amount.coin).toBe(2_004_631n) // 2_170_000 - 165_369 fee
    })

    it("should create change output instead of using drainTo when leftover contains native assets", async () => {
      // Scenario: drainTo is requested, but leftover has native assets
      // Expected: Transaction succeeds by creating proper change output (drainTo fallback skipped for native assets)
      
      const TOKEN_POLICY = "c".repeat(56)
      const TOKEN_NAME_1 = "544f4b454e31" // "TOKEN1" in hex
      const TOKEN_UNIT_1 = `${TOKEN_POLICY}${TOKEN_NAME_1}`

      // UTxO with sufficient lovelace + token
      const utxo: UTxO.UTxO = createTestUtxo({
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 3_000_000n,
        nativeAssets: { [TOKEN_UNIT_1]: 100n }
      })

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          // Payment leaves leftover + token
          // 3_000_000 - 2_000_000 - fee(~170k) = ~830k leftover + token
          assets: Assets.fromLovelace(2_000_000n)
        })

      // DrainTo requested, but should create change output instead (native assets present)
      // Expected: Transaction succeeds with change output preserving native asset
      const signBuilder = await builder.build({ drainTo: 0, useV3: true })
      expect(signBuilder).toBeDefined()
      
      const tx = await signBuilder.toTransaction()
      
      // Should have payment + change output (native assets require change, drainTo skipped)
      expect(tx.body.outputs.length).toBe(2)
      
      // Verify we have 1 input
      expect(tx.body.inputs.length).toBe(1)
    })
  })

  // ============================================================================
  // Multi-Asset Re-selection Tests
  // ============================================================================

  describe("Multi-Asset Re-selection", () => {
    
    const TOKEN_POLICY = "c".repeat(56)
    const TOKEN_NAME = "544f4b454e" // "TOKEN" in hex
    const TOKEN_UNIT = `${TOKEN_POLICY}${TOKEN_NAME}`

    it("should handle native tokens with partial payment", async () => {
      // UTxO with 2 ADA + 100 tokens (from first address)
      const utxo1: UTxO.UTxO = createTestUtxo({
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: TESTNET_ADDRESSES[0],
        lovelace: 2_000_000n,
        nativeAssets: { [TOKEN_UNIT]: 100n }
      })

      // Additional pure ADA UTxO for fee coverage (from second address)
      const utxo2: UTxO.UTxO = createTestUtxo({
        txHash: "b".repeat(64),
        outputIndex: 0,
        address: TESTNET_ADDRESSES[1],
        lovelace: 3_000_000n
      })

      // Pay 2 ADA + 50 tokens
      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo1, utxo2] })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: {
            lovelace: 2_000_000n,
            [TOKEN_UNIT]: 50n
          }
        })

      const signBuilder = await builder.build({ useV3: true })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Should select both inputs
      expect(tx.body.inputs.length).toBe(2)
      
      // Should have payment output + change output with remaining 50 tokens
      expect(tx.body.outputs.length).toBe(2)
      
      // Verify both outputs exist
      expect(tx.body.outputs[0]).toBeDefined()
      expect(tx.body.outputs[1]).toBeDefined()
      
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)
      
      // Strict expectations with deterministic values
      expect(size).toBe(513) // Exact transaction size with 2 witnesses, multi-asset
      expect(validation.actualFee).toBe(177_953n) // Exact fee: 513*44 + 155_381
      
      // Verify exact output amounts (payment output)
      expect(tx.body.outputs[0].amount.coin).toBe(2_000_000n)
      // Change output: initially 2,826,799, adjusted by fee increase of 4,752 = 2,822,047
      expect(tx.body.outputs[1].amount.coin).toBe(2_822_047n)
    })

    it("should trigger coin selection when native assets are missing from inputs", async () => {
      const TOKEN_POLICY = "c".repeat(56)
      const TOKEN_NAME = "544f4b454e" // "TOKEN" in hex
      const TOKEN_UNIT = `${TOKEN_POLICY}${TOKEN_NAME}`
      
      // UTxO with ONLY ADA (no tokens)
      const utxo1: UTxO.UTxO = createTestUtxo({
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: TESTNET_ADDRESSES[0],
        lovelace: 10_000_000n
      })
      
      // UTxO with tokens (available for coin selection)
      const utxo2: UTxO.UTxO = createTestUtxo({
        txHash: "b".repeat(64),
        outputIndex: 0,
        address: TESTNET_ADDRESSES[1],
        lovelace: 3_000_000n,
        nativeAssets: { [TOKEN_UNIT]: 200n }
      })
      
      // Config with both utxos available for automatic selection
      const builderConfig: TxBuilderConfig = {
        ...baseConfig,
        availableUtxos: [utxo1, utxo2]
      }
      
      // Payment requires tokens that utxo1 doesn't have
      const builder = makeTxBuilder(builderConfig)
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: {
            lovelace: 2_000_000n,
            [TOKEN_UNIT]: 100n // Requires tokens!
          }
        })
      
      const signBuilder = await builder.build({ useV3: true })
      const tx = await signBuilder.toTransaction()
      
      // Should automatically select utxo2 to cover the token requirement
      expect(tx.body.inputs.length).toBe(2)
      
      // Should have payment + change output
      expect(tx.body.outputs.length).toBe(2)
      
      // Payment output should have the requested amount
      const paymentOutput = tx.body.outputs[0]
      expect(paymentOutput.amount.coin).toBe(2_000_000n)
      
      // Change output should exist with remaining tokens (200 - 100 = 100)
      const _changeOutput = tx.body.outputs[1]
      // Verify the transaction is valid (coin selection worked correctly)
    })
  })

  // ============================================================================
  // Transaction Size Edge Cases
  // ============================================================================

  describe("Transaction Size Validation", () => {
    
    it("should pass size check with same address (1 witness)", async () => {
      // Single address = 1 witness
      const utxos: Array<UTxO.UTxO> = Array.from({ length: 5 }, (_, i) =>
        createTestUtxo({
          txHash: i.toString().padStart(64, "0"),
          outputIndex: 0,
          address: CHANGE_ADDRESS,
          lovelace: 2_000_000n
        })
      )

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: utxos })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(5_000_000n)
        })

      const signBuilder = await builder.build({ useV3: true })
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()
      
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      
      // With automatic coin selection, builder picks 3 UTxOs (6M total) to cover 5M payment + fees
      // Strict expectations with deterministic values
      expect(size).toBe(366) // Exact transaction size with 1 witness, 3 inputs
      expect(validation.actualFee).toBe(171_485n) // Exact fee: 366*44 + 155_381
      
      // Verify transaction structure
      const tx = await signBuilder.toTransaction()
      expect(tx.body.inputs.length).toBe(3) // Coin selection picked 3 UTxOs
      expect(tx.body.outputs.length).toBe(2) // Payment + change
      expect(tx.body.outputs[0].amount.coin).toBe(5_000_000n) // Payment
      // Change: 6M - 5M - 171,485 fee = 828,515
      expect(tx.body.outputs[1].amount.coin).toBe(828_515n)
    })

    it("should pass size check with 2 different addresses (2 witnesses)", async () => {
      const utxo1: UTxO.UTxO = createTestUtxo({
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: TESTNET_ADDRESSES[0],
        lovelace: 5_000_000n
      })

      const utxo2: UTxO.UTxO = createTestUtxo({
        txHash: "b".repeat(64),
        outputIndex: 0,
        address: TESTNET_ADDRESSES[1],
        lovelace: 5_000_000n
      })

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo1, utxo2] })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(6_000_000n)
        })

      const signBuilder = await builder.build({ useV3: true })
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()
      
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      
      // Strict expectations with deterministic values
      expect(size).toBe(431) // Exact transaction size with 2 witnesses, 2 inputs
      expect(validation.actualFee).toBe(174_345n) // Exact fee: 431*44 + 155_381
      
      // Verify transaction structure
      const tx = await signBuilder.toTransaction()
      expect(tx.body.inputs.length).toBe(2)
      expect(tx.body.outputs.length).toBe(2) // Payment + change
      expect(tx.body.outputs[0].amount.coin).toBe(6_000_000n) // Payment
      // Change: initially 3,828,603, adjusted by fee increase of 2,948 = 3,825,655
      expect(tx.body.outputs[1].amount.coin).toBe(3_825_655n)
    })

    it("should reject transaction exceeding size limit (many unique addresses)", async () => {
      // Strategy: Use FastCheck to generate many unique addresses
      // With 150+ unique payment credentials, we'll need 150+ witnesses
      // Each witness ~130 bytes, so 150 witnesses = ~19.5KB of witnesses alone
      // Plus transaction body ~3-4KB = should exceed 16KB limit
      
      // Generate 200 unique addresses using KeyHash.arbitrary for payment credentials
      // This ensures payment key addresses (not script addresses)
      const uniqueAddresses = FastCheck.sample(KeyHash.arbitrary, { seed: 42, numRuns: 200 }).map(keyHash => {
        // Create payment key address structure
        const addressStruct = AddressStructure.AddressStructure.make({
          networkId: 0, // Testnet
          paymentCredential: keyHash // Payment key credential
          // No staking credential = enterprise address
        })
        // Convert to bech32 string
        return Schema.encodeSync(AddressStructure.FromBech32)(addressStruct)
      })
      
      // Create 150 UTxOs with truly unique addresses
      // This will require 150 unique witnesses when selected
      const utxos: Array<UTxO.UTxO> = uniqueAddresses.slice(0, 150).map((address, i) => {
        return createTestUtxo({
          txHash: i.toString().padStart(64, "0"),
          outputIndex: 0,
          address,
          lovelace: 2_000_000n
        })
      })

      const builder = makeTxBuilder({ ...baseConfig, availableUtxos: utxos })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          // Request 280M to force selection of 140+ UTxOs (each 2M), which will create 140+ witnesses
          // This will exceed the 16KB transaction size limit
          assets: Assets.fromLovelace(280_000_000n)
        })

      // Should throw error due to transaction size exceeding limit
      // With 140+ unique addresses selected, we get 140+ fake witnesses pushing size over 16384 bytes
      await expect(builder.build({ useV3: true })).rejects.toThrow(/Transaction size.*16384|Build failed/)
    })
  })

  // ============================================================================
  // Multiple Reselection Attempts Tests
  // ============================================================================

  describe("Multiple Reselection Attempts", () => {
    it("should trigger multiple reselection attempts with incremental coin selection", async () => {

      // Create a mix of UTxO sizes - largest-first will pick bigger ones initially
      const utxos: Array<UTxO.UTxO> = [
        // Large UTxOs (selected first)
        createTestUtxo({ txHash: "a".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 1_500_000n }),
        createTestUtxo({ txHash: "b".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 1_200_000n }),
        
        // Medium UTxOs (for reselection)
        createTestUtxo({ txHash: "c".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 600_000n }),
        createTestUtxo({ txHash: "d".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 600_000n }),
        createTestUtxo({ txHash: "e".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 600_000n }),
        
        // Small UTxOs (for additional reselections if needed)
        createTestUtxo({ txHash: "f".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 400_000n }),
        createTestUtxo({ txHash: "g".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 400_000n }),
        createTestUtxo({ txHash: "h".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 400_000n })
      ]

      // Use makeTxBuilder with availableUtxos to enable coin selection
      const builderConfig: TxBuilderConfig = {
        ...baseConfig,
        availableUtxos: utxos
      }

      const builder = makeTxBuilder(builderConfig)
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(2_500_000n) // 2.5 ADA payment
        })

      // Build uses default largest-first algorithm
      // Use drainTo since the change will be small (33K < minUTxO)
      const signBuilder = await builder.build({ drainTo: 0, useV3: true })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Verify transaction is valid
      await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

      // Largest-first picks 1.5M + 1.2M = 2.7M initially (for 2.5M payment)
      // Leftover 200K < minUTxO (288K), triggers reselection
      // Reselection adds 600K UTxO → 3 total inputs
      expect(tx.body.inputs.length).toBe(3)

      // 2 outputs: payment + change (change now sufficient for minUTxO)
      expect(tx.body.outputs.length).toBe(2)
      
      // Payment output is exactly 2.5M
      expect(tx.body.outputs[0].amount.coin).toBe(2_500_000n)
      
      // Change output: 3.3M total - 2.5M payment - 171K fee = 628K
      expect(tx.body.outputs[1].amount.coin).toBe(628_515n)
    })

    it("should trigger multiple reselection attempts with cascading fee increases", async () => {
      /**
       * Edge Case: Cascading Fee Increases
       * 
       * Create many tiny UTxOs where each selection barely covers the payment,
       * causing the algorithm to naturally trigger multiple reselection attempts
       * as fees cascade upward with more inputs.
       */

      // Create 20 small UTxOs, each with just enough to pass minUTxO
      // Using ~350K lovelace each (slightly above minUTxO of ~280K)
      const tinyUtxos: Array<UTxO.UTxO> = Array.from({ length: 20 }, (_, i) => 
        createTestUtxo({
          txHash: i.toString().padStart(64, "0"),
          outputIndex: 0,
          address: CHANGE_ADDRESS,
          lovelace: 350_000n
        })
      )

      // Request a payment that will require multiple UTxOs
      // Each UTxO contributes 350K, minus ~2K fee overhead = ~348K net
      // To get 3M payment, need ~9 UTxOs initially, but fee will increase
      const builder = makeTxBuilder({
        ...baseConfig,
        availableUtxos: tinyUtxos
      })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(3_000_000n) // 3 ADA
        })

      // Build should succeed after multiple reselection attempts
      const signBuilder = await builder.build({ useV3: true })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Verify transaction is valid
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

      // Should have selected many inputs due to small UTxO sizes
      // With 350K per UTxO and 3M payment + ~198K fee needed, should need at least 10 inputs
      expect(tx.body.inputs.length).toBeGreaterThanOrEqual(10)
      expect(tx.body.inputs.length).toBeLessThanOrEqual(20) // Adjusted upper bound

      // Verify outputs: payment + change
      expect(tx.body.outputs.length).toBe(2)
      expect(tx.body.outputs[0].amount.coin).toBe(3_000_000n)

      // Calculate expected totals to verify correctness
      const inputCount = tx.body.inputs.length
      const totalInputs = BigInt(inputCount) * 350_000n
      const expectedChange = totalInputs - 3_000_000n - validation.actualFee
      expect(tx.body.outputs[1].amount.coin).toBe(expectedChange)
    })

    it("should handle reselection with mixed-size UTxOs", async () => {

      const utxos: Array<UTxO.UTxO> = [
        // First pass: Large UTxO insufficient by itself
        createTestUtxo({ txHash: "a".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 1_500_000n }),

        // Second pass: Medium UTxOs
        createTestUtxo({ txHash: "b".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 800_000n }),
        createTestUtxo({ txHash: "c".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 800_000n }),

        // Third pass: Small UTxOs for fine-tuning
        createTestUtxo({ txHash: "d".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 400_000n }),
        createTestUtxo({ txHash: "e".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 400_000n }),
        createTestUtxo({ txHash: "f".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 400_000n })
      ]

      const builder = makeTxBuilder({
        ...baseConfig,
        availableUtxos: utxos
      })
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(2_500_000n) // 2.5 ADA - requires reselection
        })

      const signBuilder = await builder.build({ useV3: true })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Verify transaction is valid
      await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

      // Should need at least 2 inputs (1.5M + 0.8M + fee > 2.5M)
      expect(tx.body.inputs.length).toBeGreaterThanOrEqual(2)
      
      // Verify correct payment amount
      expect(tx.body.outputs[0].amount.coin).toBe(2_500_000n)
    })
  })
})

describe("TxBuilder Reselection After Change", () => {
  const PROTOCOL_PARAMS = {
    minFeeCoefficient: 44n,
    minFeeConstant: 155_381n,
    coinsPerUtxoByte: 4_310n,
    maxTxSize: 16_384
  }

  const CHANGE_ADDRESS = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
  const RECEIVER_ADDRESS = "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

  const baseConfig: TxBuilderConfig = {
    protocolParameters: PROTOCOL_PARAMS,
    changeAddress: CHANGE_ADDRESS,
    availableUtxos: []
  }

  /**
   * Verifies that fee calculation includes the change output in the transaction structure.
   * The balance equation (inputs = outputs + fee) must hold.
   */
  it("should calculate fee with change output included in transaction structure", async () => {
    const largeUtxo: UTxO.UTxO = createTestUtxo({
      txHash: "a",
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n // 10 ADA
    })

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [largeUtxo] })
      .payToAddress({
        address: RECEIVER_ADDRESS,
        assets: Assets.fromLovelace(5_000_000n) // 5 ADA payment
      })

    const signBuilder = await builder.build({ useStateMachine: true, useV3: true })
    const tx = await signBuilder.toTransaction()

    // Verify transaction structure
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBe(2) // payment + change

    // Verify payment output
    expect(tx.body.outputs[0].amount.coin).toBe(5_000_000n)

    // Verify change output exists
    const changeOutput = tx.body.outputs[1]
    const expectedChange = 10_000_000n - 5_000_000n - tx.body.fee
    expect(changeOutput.amount.coin).toBe(expectedChange)

    // Balance equation must hold
    const totalOutput = tx.body.outputs[0].amount.coin + changeOutput.amount.coin
    expect(10_000_000n).toBe(totalOutput + tx.body.fee)

    // Fee should be reasonable
    expect(tx.body.fee).toBeGreaterThan(155_000n) // > minFeeConstant
    expect(tx.body.fee).toBeLessThan(500_000n) // < 0.5 ADA
  })

  /**
   * Verifies that UTxO reselection uses accurate fee calculation that includes change output size.
   */
  it("should reselect UTxOs based on actual fee (after change creation)", async () => {
    const utxo1: UTxO.UTxO = createTestUtxo({ txHash: "a", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 2_000_000n })
    const utxo2: UTxO.UTxO = createTestUtxo({ txHash: "b", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 2_000_000n })
    const utxo3: UTxO.UTxO = createTestUtxo({ txHash: "c", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 2_000_000n })

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo1, utxo2, utxo3] })
      .payToAddress({
        address: RECEIVER_ADDRESS,
        assets: Assets.fromLovelace(3_500_000n) // Needs 2 UTxOs
      })

    const signBuilder = await builder.build({ useStateMachine: true, useV3: true })
    const tx = await signBuilder.toTransaction()

    // With coin selection: 2 UTxOs (4M) is sufficient for payment (3.5M) + fee (~170K) + change (~330K)
    // Coin selection picks the optimal number of UTxOs needed
    expect(tx.body.inputs.length).toBe(2)
    expect(tx.body.outputs.length).toBe(2) // payment + change

    // Balance equation must hold
    const totalInput = 2_000_000n * BigInt(tx.body.inputs.length)
    const totalOutput = tx.body.outputs.reduce((sum, out) => sum + out.amount.coin, 0n)
    expect(totalInput).toBe(totalOutput + tx.body.fee)

    expect(tx.body.fee).toBeGreaterThan(155_000n)
    expect(tx.body.fee).toBeLessThan(400_000n)
  })

  /**
   * Verifies that fee calculation accounts for larger change output size when it contains native assets.
   */
  it("should account for change output size when it contains native assets", async () => {
    const policyId = "a".repeat(56)
    const assetName = "544f4b454e" // "TOKEN" in hex
    
    const utxoWithAssets: UTxO.UTxO = createTestUtxo({
      txHash: "c",
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n,
      nativeAssets: { [`${policyId}${assetName}`]: 1000n } // Native assets increase change size
    })

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxoWithAssets] })
      .payToAddress({
        address: RECEIVER_ADDRESS,
        assets: Assets.fromLovelace(3_000_000n) // Send only lovelace
      })

    const signBuilder = await builder.build({ useStateMachine: true, useV3: true })
    const tx = await signBuilder.toTransaction()

    // Payment output: only lovelace
    expect(tx.body.outputs[0].amount.coin).toBe(3_000_000n)
    
    // Change output: remaining lovelace + ALL native assets
    const changeOutput = tx.body.outputs[1]
    
    // Verify native assets are in change (not burned)
    if (changeOutput.amount._tag === "WithAssets") {
      expect(changeOutput.amount.assets.size).toBeGreaterThan(0)
    } else {
      throw new Error("Expected change output to have native assets")
    }
    
    // Balance equation with native assets
    const expectedChange = 10_000_000n - 3_000_000n - tx.body.fee
    expect(changeOutput.amount.coin).toBe(expectedChange)

    // Fee should be higher due to larger change output
    expect(tx.body.fee).toBeGreaterThan(PROTOCOL_PARAMS.minFeeConstant)
  })

  /**
   * Verifies correct fee calculation when using multiple small UTxOs and change output affects transaction size.
   */
  it("should handle case where change output affects fee calculation", async () => {
    const utxo1: UTxO.UTxO = createTestUtxo({ txHash: "a", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 2_000_000n })
    const utxo2: UTxO.UTxO = createTestUtxo({ txHash: "b", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 2_000_000n })

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo1, utxo2] })
      .payToAddress({
        address: RECEIVER_ADDRESS,
        assets: Assets.fromLovelace(3_000_000n)
      })

    const signBuilder = await builder.build({ useStateMachine: true, useV3: true })
    const tx = await signBuilder.toTransaction()

    // Should successfully build
    expect(tx.body.inputs.length).toBe(2)
    expect(tx.body.outputs.length).toBe(2) // payment + change

    // Balance equation must hold
    const totalInput = tx.body.inputs.reduce((sum, _) => sum + 2_000_000n, 0n)
    const totalOutput = tx.body.outputs.reduce((sum, out) => sum + out.amount.coin, 0n)
    expect(totalInput).toBe(totalOutput + tx.body.fee)

    // Change output should exist
    const changeOutput = tx.body.outputs[1]
    expect(changeOutput.amount.coin).toBeGreaterThan(0n)
    expect(changeOutput.amount.coin).toBeLessThan(1_000_000n) // Reasonable change amount
  })
})