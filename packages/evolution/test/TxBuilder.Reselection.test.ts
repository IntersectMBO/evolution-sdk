import { describe, expect, it } from "@effect/vitest"
import { Effect, FastCheck, Schema } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets/index.js"
import * as KeyHash from "../src/KeyHash.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { calculateTransactionSize } from "../src/sdk/builders/TxBuilderImpl.js"
import * as FeeValidation from "../src/utils/FeeValidation.js"
import * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

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

  // Sample testnet addresses (bech32 strings)
  const TESTNET_ADDRESSES = [
    "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae",
    "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7",
    "addr_test1qzx9hu8j4ah3auytk0mwcupd69hpc52t0cw39a62ndgy4cn4tcpgzfmdq43a6wvvzjhsxkqa5rkqx0pmuekm0c0e66z9dkxdgj",
    "addr_test1qr5v2dz4s5uhmx3hfn5xk8xjv5zqx6rl0pc7zy2qldj0y5z3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsftj0w6",
    "addr_test1qpm9q3v5gnvjwx7kw0ml7dxqxd6h9fqxgu2s7umd9je3c5s3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgslxdxms"
  ] as const

  // Keep as bech32 strings - use CoreAddress.fromBech32() at point of use
  const CHANGE_ADDRESS = TESTNET_ADDRESSES[0]
  const RECEIVER_ADDRESS = TESTNET_ADDRESSES[1]

  const baseConfig: TxBuilderConfig = {
    // No wallet/provider - using manual mode
    // changeAddress and availableUtxos provided via build options
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
  } // ============================================================================
  // Basic Re-selection Tests
  // ============================================================================

  describe("Basic Re-selection Scenarios", () => {
    it("should build transaction with single UTxO - sufficient funds", async () => {
      const utxo = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 10_000_000n
      })

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [utxo],
        protocolParameters: PROTOCOL_PARAMS
      })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Strict expectations - everything is deterministic
      expect(tx.body.inputs.length).toBe(1)
      expect(tx.body.outputs.length).toBe(2) // Payment + change

      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

      // Strict expectations with deterministic values
      expect(size).toBe(290) // Exact transaction size with 1 witness (Shelley format saves 4 bytes)
      expect(validation.actualFee).toBe(168_141n) // Exact deterministic fee

      // Verify exact output amounts
      expect(tx.body.outputs[0].assets.lovelace).toBe(2_000_000n) // Payment output
      // Change: 10M - 2M payment - 168,141 fee = 7,831,859
      expect(tx.body.outputs[1].assets.lovelace).toBe(7_831_859n) // Change output (exact deterministic value)
    })

    it("should trigger re-selection with tight balance", async () => {
      // Create scenario where first selection seems sufficient but becomes insufficient after fee
      const utxo1 = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 2_200_000n
      })

      const utxo2 = createCoreTestUtxo({
        transactionId: "b".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n
      })

      const utxo3 = createCoreTestUtxo({
        transactionId: "c".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n
      })

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n) // 2 ADA payment
      })

      const signBuilder = await builder.build({
        drainTo: 0,
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [utxo1, utxo2, utxo3],
        protocolParameters: PROTOCOL_PARAMS
      })
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

      expect(size).toBe(326) // 2 inputs, 1 witness, 2 outputs (Shelley format saves 4 bytes)
      expect(validation.actualFee).toBe(169_725n) // Fee for 2-input TX

      // Verify exact output amounts - reselection creates proper change output
      expect(tx.body.outputs[0].assets.lovelace).toBe(2_000_000n) // Payment output
      expect(tx.body.outputs[1].assets.lovelace).toBe(1_030_275n) // Change output (3.2M - 2M - 169,725 fee)
    })

    it("should throw error when insufficient total funds", async () => {
      const utxo = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n
      })

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n) // Requesting 2 ADA
      })

      await expect(
        builder.build({
          changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
          availableUtxos: [utxo],
          protocolParameters: PROTOCOL_PARAMS
        })
      ).rejects.toThrow()
    })

    it("should handle exact amount with drainTo", async () => {
      // Calculate exact amount: payment + approximate fee
      const paymentAmount = 2_000_000n
      const estimatedFee = 170_000n
      const exactAmount = paymentAmount + estimatedFee

      const utxo = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: exactAmount
      })

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(paymentAmount)
      })

      const signBuilder = await builder.build({
        drainTo: 0,
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [utxo],
        protocolParameters: PROTOCOL_PARAMS
      })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      expect(tx.body.inputs.length).toBe(1)
      // Should have 1 output (payment with drained amount)
      expect(tx.body.outputs.length).toBe(1)

      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

      // Strict expectations with deterministic values
      expect(size).toBe(225) // Exact transaction size with 1 witness, drainTo (Shelley format saves 2 bytes)
      expect(validation.actualFee).toBe(165_281n) // Exact fee: 225*44 + 155_381

      // Verify exact output amount (payment + drained leftover)
      expect(tx.body.outputs[0].assets.lovelace).toBe(2_004_719n) // 2_170_000 - 165_281 fee
    })

    it("should create change output instead of using drainTo when leftover contains native assets", async () => {
      // Scenario: drainTo is requested, but leftover has native assets
      // Expected: Transaction succeeds by creating proper change output (drainTo fallback skipped for native assets)

      const TOKEN_POLICY = "c".repeat(56)
      const TOKEN_NAME_1 = "544f4b454e31" // "TOKEN1" in hex

      // UTxO with sufficient lovelace + token
      let assets = CoreAssets.fromLovelace(5_000_000n)
      assets = CoreAssets.addByHex(assets, TOKEN_POLICY, TOKEN_NAME_1, 100n)
      const utxo = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 5_000_000n
      })
      const utxoWithTokens = new CoreUTxO.UTxO({ ...utxo, assets })

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        // Payment leaves leftover + token
        // 3_000_000 - 2_000_000 - fee(~170k) = ~830k leftover + token
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

      // DrainTo requested, but should create change output instead (native assets present)
      // Expected: Transaction succeeds with change output preserving native asset
      const signBuilder = await builder.build({
        drainTo: 0,
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [utxoWithTokens],
        protocolParameters: PROTOCOL_PARAMS
      })
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

    it("should handle native tokens with partial payment", async () => {
      // UTxO with 2 ADA + 100 tokens (from first address)
      let assets1 = CoreAssets.fromLovelace(2_000_000n)
      assets1 = CoreAssets.addByHex(assets1, TOKEN_POLICY, TOKEN_NAME, 100n)
      const utxo1Base = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: TESTNET_ADDRESSES[0],
        lovelace: 2_000_000n
      })
      const utxo1 = new CoreUTxO.UTxO({ ...utxo1Base, assets: assets1 })

      // Additional pure ADA UTxO for fee coverage (from second address)
      const utxo2 = createCoreTestUtxo({
        transactionId: "b".repeat(64),
        index: 0,
        address: TESTNET_ADDRESSES[1],
        lovelace: 3_000_000n
      })

      // Pay 2 ADA + 50 tokens
      let paymentAssets = CoreAssets.fromLovelace(2_000_000n)
      paymentAssets = CoreAssets.addByHex(paymentAssets, TOKEN_POLICY, TOKEN_NAME, 50n)
      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: paymentAssets
      })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [utxo1, utxo2],
        protocolParameters: PROTOCOL_PARAMS
      })
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
      expect(size).toBe(509) // Exact transaction size with 2 witnesses, multi-asset (Shelley format saves 4 bytes)
      expect(validation.actualFee).toBe(177_777n) // Exact fee: 509*44 + 155_381

      // Verify exact output amounts (payment output)
      expect(tx.body.outputs[0].assets.lovelace).toBe(2_000_000n)
      // Change output: 5M - 2M - 177,777 fee = 2,822,223
      expect(tx.body.outputs[1].assets.lovelace).toBe(2_822_223n)
    })

    it("should trigger coin selection when native assets are missing from inputs", async () => {
      const TOKEN_POLICY = "c".repeat(56)
      const TOKEN_NAME = "544f4b454e" // "TOKEN" in hex

      // UTxO with ONLY ADA (no tokens)
      const utxo1 = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: TESTNET_ADDRESSES[0],
        lovelace: 10_000_000n
      })

      // UTxO with tokens (available for coin selection)
      let assets2 = CoreAssets.fromLovelace(3_000_000n)
      assets2 = CoreAssets.addByHex(assets2, TOKEN_POLICY, TOKEN_NAME, 200n)
      const utxo2Base = createCoreTestUtxo({
        transactionId: "b".repeat(64),
        index: 0,
        address: TESTNET_ADDRESSES[1],
        lovelace: 3_000_000n
      })
      const utxo2 = new CoreUTxO.UTxO({ ...utxo2Base, assets: assets2 })

      // Config with both utxos available for automatic selection
      const builderConfig: TxBuilderConfig = {
        ...baseConfig
      }

      // Payment requires tokens that utxo1 doesn't have
      let paymentAssets = CoreAssets.fromLovelace(2_000_000n)
      paymentAssets = CoreAssets.addByHex(paymentAssets, TOKEN_POLICY, TOKEN_NAME, 100n)
      const builder = makeTxBuilder(builderConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: paymentAssets // Requires tokens!
      })

      const signBuilder = await builder.build({
        availableUtxos: [utxo1, utxo2],
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        protocolParameters: PROTOCOL_PARAMS
      })
      const tx = await signBuilder.toTransaction()

      // Should automatically select utxo2 to cover the token requirement
      expect(tx.body.inputs.length).toBe(2)

      // Should have payment + change output
      expect(tx.body.outputs.length).toBe(2)

      // Payment output should have the requested amount
      const paymentOutput = tx.body.outputs[0]
      expect(paymentOutput.assets.lovelace).toBe(2_000_000n)

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
      const utxos: Array<CoreUTxO.UTxO> = Array.from({ length: 5 }, (_, i) =>
        createCoreTestUtxo({
          transactionId: i.toString().padStart(64, "0"),
          index: 0,
          address: CHANGE_ADDRESS,
          lovelace: 2_000_000n
        })
      )

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(5_000_000n) // 5 ADA
      })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

      // With corrected minUTxO calculation, builder picks 4 UTxOs (8M total)
      // to cover 5M payment, fees, and valid change output requirements
      // Strict expectations with deterministic values
      expect(size).toBe(398) // Exact transaction size with 1 witness, 4 inputs
      expect(validation.actualFee).toBe(172_893n) // Exact fee: 398*44 + 155_381

      // Verify transaction structure
      const tx = await signBuilder.toTransaction()
      expect(tx.body.inputs.length).toBe(4) // Coin selection picked 4 UTxOs
      expect(tx.body.outputs.length).toBe(2) // Payment + change
      expect(tx.body.outputs[0].assets.lovelace).toBe(5_000_000n) // Payment
      // Change: 8M - 5M - 172,893 fee = 2,827,107
      expect(tx.body.outputs[1].assets.lovelace).toBe(2_827_107n)
    })

    it("should pass size check with 2 different addresses (2 witnesses)", async () => {
      const utxo1 = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: TESTNET_ADDRESSES[0],
        lovelace: 5_000_000n
      })

      const utxo2 = createCoreTestUtxo({
        transactionId: "b".repeat(64),
        index: 0,
        address: TESTNET_ADDRESSES[1],
        lovelace: 5_000_000n
      })

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(6_000_000n)
      })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [utxo1, utxo2],
        protocolParameters: PROTOCOL_PARAMS
      })
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

      // Strict expectations with deterministic values
      expect(size).toBe(427) // Exact transaction size with 2 witnesses, 2 inputs (2 outputs save 4 bytes)
      expect(validation.actualFee).toBe(174_169n) // Exact fee: 427*44 + 155_381

      // Verify transaction structure
      const tx = await signBuilder.toTransaction()
      expect(tx.body.inputs.length).toBe(2)
      expect(tx.body.outputs.length).toBe(2) // Payment + change
      expect(tx.body.outputs[0].assets.lovelace).toBe(6_000_000n) // Payment
      // Change: 10M total - 6M payment - 174,169 fee = 3,825,831
      expect(tx.body.outputs[1].assets.lovelace).toBe(3_825_831n)
    })

    it("should reject transaction exceeding size limit (many unique addresses)", async () => {
      // Strategy: Use FastCheck to generate many unique addresses
      // With 150+ unique payment credentials, we'll need 150+ witnesses
      // Each witness ~130 bytes, so 150 witnesses = ~19.5KB of witnesses alone
      // Plus transaction body ~3-4KB = should exceed 16KB limit

      // Generate 200 unique addresses using KeyHash.arbitrary for payment credentials
      // This ensures payment key addresses (not script addresses)
      const uniqueAddresses = FastCheck.sample(KeyHash.arbitrary, { seed: 42, numRuns: 200 }).map((keyHash) => {
        // Create payment key address structure
        const addressStruct = CoreAddress.Address.make({
          networkId: 0, // Testnet
          paymentCredential: keyHash // Payment key credential
          // No staking credential = enterprise address
        })
        // Convert to bech32 string
        return Schema.encodeSync(CoreAddress.FromBech32)(addressStruct)
      })

      // Create 150 UTxOs with truly unique addresses
      // This will require 150 unique witnesses when selected
      const utxos: Array<CoreUTxO.UTxO> = uniqueAddresses.slice(0, 150).map((address, i) => {
        return createCoreTestUtxo({
          transactionId: i.toString().padStart(64, "0"),
          index: 0,
          address,
          lovelace: 2_000_000n
        })
      })

      const builder = makeTxBuilder({ ...baseConfig }).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        // Request 280M to force selection of 140+ UTxOs (each 2M), which will create 140+ witnesses
        // This will exceed the 16KB transaction size limit
        assets: CoreAssets.fromLovelace(280_000_000n)
      })

      // Should throw error due to transaction size exceeding limit
      // With 140+ unique addresses selected, we get 140+ fake witnesses pushing size over 16384 bytes
      await expect(
        builder.build({
          changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS
        })
      ).rejects.toThrow(/Transaction size.*16384|Build failed/)
    })
  })

  // ============================================================================
  // Multiple Reselection Attempts Tests
  // ============================================================================

  describe("Multiple Reselection Attempts", () => {
    it("should trigger multiple reselection attempts with incremental coin selection", async () => {
      // Create a mix of UTxO sizes - largest-first will pick bigger ones initially
      const utxos: Array<CoreUTxO.UTxO> = [
        // Large UTxOs (selected first)
        createCoreTestUtxo({ transactionId: "a".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 1_500_000n }),
        createCoreTestUtxo({ transactionId: "b".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 1_200_000n }),

        // Medium UTxOs (for reselection)
        createCoreTestUtxo({ transactionId: "c".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 600_000n }),
        createCoreTestUtxo({ transactionId: "d".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 600_000n }),
        createCoreTestUtxo({ transactionId: "e".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 600_000n }),

        // Small UTxOs (for additional reselections if needed) - using valid hex chars 1, 2, 3
        createCoreTestUtxo({ transactionId: "1".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 400_000n }),
        createCoreTestUtxo({ transactionId: "2".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 400_000n }),
        createCoreTestUtxo({ transactionId: "3".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 400_000n })
      ]

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_500_000n) // 2.5 ADA payment
      })

      // Build uses default largest-first algorithm
      // Use drainTo since the change will be small (33K < minUTxO)
      const signBuilder = await builder.build({
        drainTo: 0,
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Verify transaction is valid
      await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

      // Largest-first picks 1.5M + 1.2M = 2.7M initially (for 2.5M payment)
      // Correct minUTxO calculation triggers additional reselection steps
      // and selects one more input for valid change
      expect(tx.body.inputs.length).toBe(4)

      // 2 outputs: payment + change (change now sufficient for minUTxO)
      expect(tx.body.outputs.length).toBe(2)

      // Payment output is exactly 2.5M
      expect(tx.body.outputs[0].assets.lovelace).toBe(2_500_000n)

      // Change output: 3.9M total - 2.5M payment - actual fee = change
      expect(tx.body.outputs[1].assets.lovelace).toBe(1_227_107n)
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
      const tinyUtxos: Array<CoreUTxO.UTxO> = Array.from({ length: 20 }, (_, i) =>
        createCoreTestUtxo({
          transactionId: i.toString().padStart(64, "0"),
          index: 0,
          address: CHANGE_ADDRESS,
          lovelace: 350_000n
        })
      )

      // Request a payment that will require multiple UTxOs
      // Each UTxO contributes 350K, minus ~2K fee overhead = ~348K net
      // To get 3M payment, need ~9 UTxOs initially, but fee will increase
      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(3_000_000n) // 3 ADA
      })

      // Build should succeed after multiple reselection attempts
      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: tinyUtxos,
        protocolParameters: PROTOCOL_PARAMS
      })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Verify transaction is valid
      const validation = await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

      // Should have selected many inputs due to small UTxO sizes
      // With 350K per UTxO and 3M payment + ~198K fee needed, should need at least 10 inputs
      expect(tx.body.inputs.length).toBe(12)

      // Verify outputs: payment + change
      expect(tx.body.outputs.length).toBe(2)
      expect(tx.body.outputs[0].assets.lovelace).toBe(3_000_000n)

      // Calculate expected totals to verify correctness
      const inputCount = tx.body.inputs.length
      const totalInputs = BigInt(inputCount) * 350_000n
      const expectedChange = totalInputs - 3_000_000n - validation.actualFee
      expect(tx.body.outputs[1].assets.lovelace).toBe(expectedChange)
    })

    it("should handle reselection with mixed-size UTxOs", async () => {
      const utxos: Array<CoreUTxO.UTxO> = [
        // First pass: Large UTxO insufficient by itself
        createCoreTestUtxo({ transactionId: "a".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 1_500_000n }),

        // Second pass: Medium UTxOs
        createCoreTestUtxo({ transactionId: "b".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 800_000n }),
        createCoreTestUtxo({ transactionId: "c".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 800_000n }),

        // Third pass: Small UTxOs for fine-tuning
        createCoreTestUtxo({ transactionId: "d".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 400_000n }),
        createCoreTestUtxo({ transactionId: "e".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 400_000n }),
        createCoreTestUtxo({ transactionId: "f".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 400_000n })
      ]

      const builder = makeTxBuilder(baseConfig).payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_500_000n) // 2.5 ADA - requires reselection
      })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })
      const tx = await signBuilder.toTransaction()
      const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

      // Verify transaction is valid
      await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)
      const size = await Effect.runPromise(calculateTransactionSize(txWithFakeWitnesses))
      expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

      // Should need at least 2 inputs (1.5M + 0.8M + fee > 2.5M)
      expect(tx.body.inputs.length).toBe(5)

      // Verify correct payment amount
      expect(tx.body.outputs[0].assets.lovelace).toBe(2_500_000n)
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

  const CHANGE_ADDRESS =
    "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
  const RECEIVER_ADDRESS =
    "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

  const baseConfig: TxBuilderConfig = {
    // No wallet/provider - using manual mode
    // changeAddress and availableUtxos provided via build options
  }

  /**
   * Verifies that fee calculation includes the change output in the transaction structure.
   * The balance equation (inputs = outputs + fee) must hold.
   */
  it("should calculate fee with change output included in transaction structure", async () => {
    const largeUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n // 10 ADA
    })

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
      assets: CoreAssets.fromLovelace(5_000_000n) // 5 ADA payment
    })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [largeUtxo],
      protocolParameters: PROTOCOL_PARAMS
    })
    const tx = await signBuilder.toTransaction()

    // Verify transaction structure
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBe(2) // payment + change

    // Verify payment output
    expect(tx.body.outputs[0].assets.lovelace).toBe(5_000_000n)

    // Verify change output exists
    const changeOutput = tx.body.outputs[1]
    const expectedChange = 10_000_000n - 5_000_000n - tx.body.fee
    expect(changeOutput.assets.lovelace).toBe(expectedChange)

    // Balance equation must hold
    const totalOutput = tx.body.outputs[0].assets.lovelace + changeOutput.assets.lovelace
    expect(10_000_000n).toBe(totalOutput + tx.body.fee)

    // Fee should be exact
    expect(tx.body.fee).toBe(168_141n)
  })

  /**
   * Verifies that UTxO reselection uses accurate fee calculation that includes change output size.
   */
  it("should reselect UTxOs based on actual fee (after change creation)", async () => {
    const utxo1 = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n
    })
    const utxo2 = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n
    })
    const utxo3 = createCoreTestUtxo({
      transactionId: "c".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n
    })

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
      assets: CoreAssets.fromLovelace(3_500_000n) // Needs 2 UTxOs
    })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [utxo1, utxo2, utxo3],
      protocolParameters: PROTOCOL_PARAMS
    })
    const tx = await signBuilder.toTransaction()

    // With corrected minUTxO calculation, 2 UTxOs no longer leave enough valid change,
    // so reselection adds one more input.
    expect(tx.body.inputs.length).toBe(3)
    expect(tx.body.outputs.length).toBe(2) // payment + change

    // Balance equation must hold
    const totalInput = 2_000_000n * BigInt(tx.body.inputs.length)
    const totalOutput = tx.body.outputs.reduce((sum, out) => sum + out.assets.lovelace, 0n)
    expect(totalInput).toBe(totalOutput + tx.body.fee)

    expect(tx.body.fee).toBe(171_309n)
  })

  /**
   * Verifies that fee calculation accounts for larger change output size when it contains native assets.
   */
  it("should account for change output size when it contains native assets", async () => {
    const policyId = "a".repeat(56)
    const assetName = "544f4b454e" // "TOKEN" in hex

    let assets = CoreAssets.fromLovelace(10_000_000n)
    assets = CoreAssets.addByHex(assets, policyId, assetName, 1000n)
    const utxoBase = createCoreTestUtxo({
      transactionId: "c".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })
    const utxoWithAssets = new CoreUTxO.UTxO({ ...utxoBase, assets })

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
      assets: CoreAssets.fromLovelace(3_000_000n) // Send only lovelace
    })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [utxoWithAssets],
      protocolParameters: PROTOCOL_PARAMS
    })
    const tx = await signBuilder.toTransaction()

    // Payment output: only lovelace
    expect(tx.body.outputs[0].assets.lovelace).toBe(3_000_000n)

    // Change output: remaining lovelace + ALL native assets
    const changeOutput = tx.body.outputs[1]

    // Verify native assets are in change (not burned)
    if (changeOutput.assets.multiAsset !== undefined) {
      expect(changeOutput.assets.multiAsset.map.size).toBe(1)
    } else {
      throw new Error("Expected change output to have native assets")
    }

    // Balance equation with native assets
    const expectedChange = 10_000_000n - 3_000_000n - tx.body.fee
    expect(changeOutput.assets.lovelace).toBe(expectedChange)

    // Fee should be exact (larger than minFeeConstant due to change output with native assets)
    expect(tx.body.fee).toBe(169_989n)
  })

  /**
   * Verifies correct fee calculation when using multiple small UTxOs and change output affects transaction size.
   */
  it("should handle case where change output affects fee calculation", async () => {
    const utxo1 = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n
    })
    const utxo2 = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 2_400_000n
    })

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
      assets: CoreAssets.fromLovelace(3_000_000n)
    })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [utxo1, utxo2],
      protocolParameters: PROTOCOL_PARAMS
    })
    const tx = await signBuilder.toTransaction()

    // Should successfully build
    expect(tx.body.inputs.length).toBe(2)
    expect(tx.body.outputs.length).toBe(2) // payment + change

    // Balance equation must hold
    const totalInput = tx.body.inputs.reduce((sum, input) => {
      if (input.transactionId === utxo1.transactionId) return sum + utxo1.assets.lovelace
      if (input.transactionId === utxo2.transactionId) return sum + utxo2.assets.lovelace
      return sum
    }, 0n)
    const totalOutput = tx.body.outputs.reduce((sum, out) => sum + out.assets.lovelace, 0n)
    expect(totalInput).toBe(totalOutput + tx.body.fee)

    // Change output should exist with exact value
    const changeOutput = tx.body.outputs[1]
    expect(changeOutput.assets.lovelace).toBe(1_230_275n)
  })
})
