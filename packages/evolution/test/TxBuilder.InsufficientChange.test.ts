import { describe, expect, it } from "@effect/vitest"
import { FastCheck, Schema } from "effect"

import * as AddressEras from "../src/core/AddressEras.js"
import * as AddressStructure from "../src/core/AddressStructure.js"
import * as KeyHash from "../src/core/KeyHash.js"
import * as Assets from "../src/sdk/Assets.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import type * as UTxO from "../src/sdk/UTxO.js"
import * as FeeValidation from "../src/utils/FeeValidation.js"
import { createTestUtxo } from "./utils/utxo-helpers.js"

/**
 * Integration tests for the three-tier fallback system when handling insufficient change.
 *
 * The transaction builder uses a three-tier approach:
 * 1. STEP 1: Try to create change output (with optional unfracking)
 * 2. STEP 2 (Fallback #1): Use drainTo if configured
 * 3. STEP 3 (Fallback #2): Use onInsufficientChange strategy ('error' or 'burn')
 *
 * These tests verify each tier works correctly and that precedence is maintained.
 */

// Test configuration - Babbage era protocol parameters
const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const RECIPIENT_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

/**
 * Helper: Create UTxO with minimal ADA (insufficient for change output)
 *
 * Calculation:
 * - Input: 2.17 ADA
 * - Payment: 2.0 ADA
 * - Fee: ~0.16 ADA
 * - Leftover: ~0.01 ADA (insufficient for minUtxoValue ~0.172 ADA)
 */
function createMinimalUtxo(): UTxO.UTxO {
  return {
    txHash: "a".repeat(64),
    outputIndex: 0,
    address: CHANGE_ADDRESS,
    assets: {
      lovelace: 2_170_000n // 2.17 ADA - will leave ~0.01 ADA insufficient for change
    }
  }
}

/**
 * Helper: Validate transaction fee matches CBOR size with fake witnesses
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

/**
 * Helper: Create UTxO with plenty of ADA for change output
 */
const createSufficientUtxo = (lovelace: bigint = 100_000_000n): UTxO.UTxO =>
  createTestUtxo({ txHash: "a".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, lovelace })

const baseConfig: TxBuilderConfig = {
  protocolParameters: PROTOCOL_PARAMS,
  changeAddress: CHANGE_ADDRESS,
  availableUtxos: []
}

describe("Fallback Tier 3: onInsufficientChange Strategy", () => {
  it("should throw error by default when change is insufficient (safe default)", async () => {
    // Arrange: UTxO with insufficient leftover for change output
    const utxo = createMinimalUtxo()
    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Act & Assert: Should fail with default 'error' strategy
    // This is the SAFE default - prevents accidental fund loss
    await expect(builder.build({ useV3: true })).rejects.toThrow()
  })

  it("should burn leftover as extra fee when onInsufficientChange='burn'", async () => {
    // Arrange: Same insufficient leftover scenario
    const utxo = createMinimalUtxo()
    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Act: Explicitly consent to burning leftover
    const signBuilder = await builder.build({ onInsufficientChange: "burn", useV3: true })
    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Validate: Fee is correct for transaction size with fake witnesses
    await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

    // Assert: Transaction succeeds with single output (no change)
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBe(1) // Only payment output (no change)

    // Verify: Transaction balances (inputs = outputs + fee)
    // Strict deterministic values
    expect(tx.body.outputs[0].amount.coin).toBe(2_000_000n) // Payment amount
    expect(tx.body.fee).toBe(165_369n) // Deterministic fee for this tx size

    // Verify leftover is burned
    const inputTotal = utxo.assets.lovelace // 2_170_000n
    const outputTotal = tx.body.outputs[0].amount.coin // 2_000_000n
    const leftover = inputTotal - outputTotal - tx.body.fee // 2_170_000 - 2_000_000 - 165_369 = 4_631
    expect(leftover).toBe(4_631n) // Exact leftover amount that was "burned" (becomes excess)
  })
})

describe("Fallback Precedence: drainTo before onInsufficientChange", () => {
  it("should use drainTo (Fallback #1) before checking onInsufficientChange (Fallback #2)", async () => {
    // Arrange: Insufficient change + both fallbacks configured
    const utxo = createMinimalUtxo()
    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Act: Configure both drainTo and onInsufficientChange='error'
    // drainTo should take precedence (Fallback #1 before #2)
    const signBuilder = await builder.build({
      drainTo: 0, // Fallback #1: Drain into first output
      onInsufficientChange: "error", // Fallback #2: Would error, but shouldn't reach here
      useV3: true
    })

    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Validate: Fee is correct for transaction size with fake witnesses
    await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

    // Assert: Transaction succeeds using drainTo
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBe(1) // Leftover merged into payment output
    expect(tx.body.fee).toBe(165_369n) // Deterministic fee

    // Verify: Leftover was drained into first output (not burned)
    const firstOutput = tx.body.outputs[0]
    // Payment (2M) + drained leftover (4_631) = 2_004_631
    expect(firstOutput.amount.coin).toBe(2_004_631n)
  })
})

describe("Normal Path: Sufficient Change (No Fallbacks)", () => {
  it("should create change output when sufficient funds available", async () => {
    // Arrange: UTxO with plenty of ADA
    const utxo = createSufficientUtxo(100_000_000n) // 100 ADA
    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(10_000_000n) // 10 ADA payment
      })

    // Act: Build with fallback configured (shouldn't be needed)
    const signBuilder = await builder.build({
      onInsufficientChange: "error", // Configured but not reached
      useV3: true
    })

    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Validate: Fee is correct for transaction size with fake witnesses
    await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

    // Assert: Change output created successfully
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBe(2) // Payment + change
    expect(tx.body.fee).toBe(168_317n) // Deterministic fee

    // Verify outputs
    const paymentOutput = tx.body.outputs[0]
    const changeOutput = tx.body.outputs[1]

    expect(paymentOutput.amount.coin).toBe(10_000_000n)
    expect(AddressEras.toBech32(changeOutput.address)).toBe(CHANGE_ADDRESS)
    // Change: 100M - 10M payment - 168,317 fee = 89,831,683
    expect(changeOutput.amount.coin).toBe(89_831_683n)
  })

  it("should handle exact amount with drainTo without triggering fallbacks", async () => {
    // Arrange: UTxO with exact amount needed
    const utxo = createMinimalUtxo()
    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Act: Use drainTo for exact amount scenarios
    const signBuilder = await builder.build({ drainTo: 0, useV3: true })
    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Validate: Fee is correct for transaction size with fake witnesses
    await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

    // Assert: Single output with drained leftover
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBe(1) // Payment with drained change
    expect(tx.body.fee).toBe(165_369n) // Deterministic fee

    // Verify: Output has payment + leftover
    const output = tx.body.outputs[0]
    // 2_170_000 - 165_369 = 2_004_631
    expect(output.amount.coin).toBe(2_004_631n)
  })
})

describe("Edge Cases", () => {
  it("should handle multiple small UTxOs with drainTo", async () => {
    // Arrange: Multiple UTxOs with insufficient leftover for change
    const utxos: Array<UTxO.UTxO> = [
      {
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: { lovelace: 1_300_000n } // 1.3 ADA
      },
      {
        txHash: "b".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: { lovelace: 900_000n } // 0.9 ADA
      }
    ]

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: utxos })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Act: Build with drainTo to merge leftover into payment
    // Total: 2.2 ADA - 2.0 payment - 0.17 fee = 0.03 ADA leftover (insufficient for change)
    const signBuilder = await builder.build({ drainTo: 0, useV3: true })
    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Validate: Fee is correct for transaction size with fake witnesses
    await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

    // Assert: Transaction built successfully with drainTo
    expect(tx.body.inputs.length).toBe(2)
    expect(tx.body.outputs.length).toBe(1) // Drained into output[0]
    expect(tx.body.fee).toBe(166_953n) // Deterministic fee for 2 inputs, 1 output (drainTo)

    // Verify the output has the drained amount
    // Total: 2_200_000 - 166_953 fee = 2_033_047
    expect(tx.body.outputs[0].amount.coin).toBe(2_033_047n)
  })

  it("should respect burn strategy with very small leftover amounts", async () => {
    // Arrange: Use the standard minimal UTxO (sufficient for tests)
    const utxo = createMinimalUtxo()

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Act: Burn small leftover
    const signBuilder = await builder.build({ onInsufficientChange: "burn", useV3: true })
    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Validate: Fee is correct for transaction size with fake witnesses
    await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

    // Assert: Success with single output (no change)
    expect(tx.body.outputs.length).toBe(1)
    expect(tx.body.outputs[0].amount.coin).toBe(2_000_000n)

    // Verify: Fee is deterministic
    expect(tx.body.fee).toBe(165_369n)
  })
})

/**
 * Tests accurate CBOR-based minUTxO calculation for multi-asset change outputs.
 * Verifies that change output creation decisions use actual CBOR size instead of estimation.
 */
describe("Multi-Asset minUTxO Calculation", () => {
  it("should handle multi-asset change correctly with accurate CBOR-based minUTxO calculation", async () => {
    // Create UTxO with 10 different native assets + sufficient lovelace
    const policyId = "c".repeat(56) // Valid policy ID (28 bytes hex = 56 chars)

    // Create 10 different asset names as hex-encoded strings
    // Pattern: TOKEN01 = 544f4b454e3031, TOKEN02 = 544f4b454e3032, etc.
    const multiAssetUtxo: UTxO.UTxO = {
      txHash: "b".repeat(64),
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      assets: {
        lovelace: 5_000_000n, // 5 ADA - enough for change with 10 assets
        // 10 different native assets (worst case for estimation accuracy)
        [`${policyId}544f4b454e3031`]: 100n, // "TOKEN01"
        [`${policyId}544f4b454e3032`]: 100n, // "TOKEN02"
        [`${policyId}544f4b454e3033`]: 100n, // "TOKEN03"
        [`${policyId}544f4b454e3034`]: 100n, // "TOKEN04"
        [`${policyId}544f4b454e3035`]: 100n, // "TOKEN05"
        [`${policyId}544f4b454e3036`]: 100n, // "TOKEN06"
        [`${policyId}544f4b454e3037`]: 100n, // "TOKEN07"
        [`${policyId}544f4b454e3038`]: 100n, // "TOKEN08"
        [`${policyId}544f4b454e3039`]: 100n, // "TOKEN09"
        [`${policyId}544f4b454e3130`]: 100n // "TOKEN10"
      }
    }

    // Send most lovelace but keep all native assets
    // This creates leftover with: small lovelace + 10 assets
    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [multiAssetUtxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_500_000n) // Send 2.5 ADA only
      })

    // Act: Build transaction
    const signBuilder = await builder.build({ useV3: true })
    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Validate: Fee is correct for transaction size with fake witnesses
    await assertFeeValid(txWithFakeWitnesses, PROTOCOL_PARAMS)

    // Assert: Transaction should succeed with proper change output handling
    // The builder should either:
    // 1. Create valid change output with sufficient lovelace for all assets, OR
    // 2. Use drainTo to merge assets into payment output if change is insufficient
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(1)

    // Verify: All 10 native assets are accounted for (not lost)
    let totalTokensSeen = 0
    for (const output of tx.body.outputs) {
      // Check if this output has native assets (WithAssets type)
      if (output.amount._tag === "WithAssets") {
        // MultiAsset is a Map<PolicyId, Map<AssetName, Amount>>
        for (const [_policyId, assetMap] of output.amount.assets) {
          totalTokensSeen += assetMap.size
        }
      }
    }

    // All 10 tokens should be preserved across all outputs
    expect(totalTokensSeen).toBe(10)

    // Verify: Change output has sufficient lovelace for all assets
    const changeOutput = tx.body.outputs.find((out) => AddressEras.toBech32(out.address) === CHANGE_ADDRESS)
    if (changeOutput) {
      // Change output exists - verify it has sufficient lovelace for all assets
      const changeLovelace = changeOutput.amount.coin
      expect(changeLovelace).toBeGreaterThan(700_000n)
    }
  })
})

describe("Fee Validation: Multiple Witnesses Edge Case", () => {
  /**
   * CRITICAL TEST: Verify fee validation with many inputs from different addresses
   *
   * Edge case concern: Many inputs from different addresses create many witnesses,
   * which increases transaction size and fee. The test verifies that:
   * 1. Fee calculation includes all witnesses in size estimation
   * 2. Validation uses the same witness set as calculation
   * 3. Fee validation passes despite increased witness count
   *
   * Architecture verification:
   * - Both fee calculation AND validation use buildFakeWitnessSet(selectedUtxos)
   * - Witnesses are deduplicated by address key hash
   * - More unique addresses → more witnesses → larger size → higher fee (correct)
   * - Validation passes because it uses the same transaction with witnesses
   */
  it("should validate fee correctly with 10 inputs from different addresses", async () => {
    // Arrange: Create 10 UTxOs from 10 DIFFERENT addresses
    // Each unique address will create one fake witness (~128 bytes)

    // Generate 10 unique addresses using KeyHash.arbitrary for payment credentials
    const uniqueAddresses = FastCheck.sample(KeyHash.arbitrary, { seed: 123, numRuns: 10 }).map((keyHash) => {
      // Create payment key address structure (enterprise address)
      const addressStruct = AddressStructure.AddressStructure.make({
        networkId: 0, // Testnet
        paymentCredential: keyHash // Payment key credential
        // No staking credential = enterprise address
      })
      // Convert to bech32 string
      return Schema.encodeSync(AddressStructure.FromBech32)(addressStruct)
    })

    // Create one UTxO per unique address
    const utxos: Array<UTxO.UTxO> = uniqueAddresses.map((address, i) => ({
      txHash: i.toString().repeat(64).substring(0, 64),
      outputIndex: i,
      address,
      assets: {
        lovelace: 5_000_000n // 5 ADA each = 50 ADA total
      }
    }))

    // Build transaction that will select all 10 inputs
    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: utxos })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(45_000_000n) // 45 ADA
      })

    // Act: Build transaction
    const signBuilder = await builder.build({ useV3: true })
    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Assert 1: Verify we selected all 10 inputs (triggering 10 witnesses)
    expect(tx.body.inputs.length).toBe(10)

    // Assert 2: Verify witness set has 10 witnesses (one per unique address)
    const witnessSet = txWithFakeWitnesses.witnessSet
    expect(witnessSet.vkeyWitnesses?.length).toBe(10)

    // Assert 3: Fee validation should PASS despite many witnesses
    // This is the critical test - validates the architecture handles edge case
    const validation = FeeValidation.validateTransactionFee(txWithFakeWitnesses, PROTOCOL_PARAMS)

    expect(validation.isValid).toBe(true)
    expect(validation.difference).toBe(0n)

    // Assert 4: Verify fee is appropriately high due to witnesses
    // Each witness ~128 bytes, 10 witnesses = ~1,280 bytes
    // Base tx ~200 bytes, total ~1,500+ bytes
    // Fee should be: 155,381 + (44 × 1,500+) = ~221,000+ lovelace
    expect(validation.actualFee).toBeGreaterThan(200_000n)
    expect(validation.txSizeBytes).toBeGreaterThan(1_400) // At least 1.4 KB with witnesses

    // Assert 5: Verify fee calculation matches what was paid
    expect(tx.body.fee).toBe(validation.actualFee)
  })

  it("should handle deduplication: multiple UTxOs from same address = 1 witness", async () => {
    // Arrange: Create 10 UTxOs from the SAME address
    // Should only create 1 witness due to deduplication by key hash
    const utxos: Array<UTxO.UTxO> = []

    for (let i = 0; i < 10; i++) {
      utxos.push({
        txHash: i.toString().repeat(64).substring(0, 64),
        outputIndex: i,
        address: CHANGE_ADDRESS, // Same address for all
        assets: {
          lovelace: 5_000_000n // 5 ADA each = 50 ADA total
        }
      })
    }

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: utxos })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(45_000_000n)
      })

    // Act
    const signBuilder = await builder.build({ useV3: true })
    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Assert 1: Verify we selected all 10 inputs
    expect(tx.body.inputs.length).toBe(10)

    // Assert 2: Should only have 1 witness (deduplicated by address)
    const witnessSet = txWithFakeWitnesses.witnessSet
    expect(witnessSet.vkeyWitnesses?.length).toBe(1)

    // Assert 3: Fee validation passes
    const validation = FeeValidation.validateTransactionFee(txWithFakeWitnesses, PROTOCOL_PARAMS)

    expect(validation.isValid).toBe(true)
    expect(validation.difference).toBe(0n)

    // Assert 4: Fee should be reasonable for 10 inputs with 1 witness
    // 10 inputs = larger tx body, but only 1 witness
    expect(validation.actualFee).toBeLessThan(200_000n) // Less than 10-witness case
    expect(validation.txSizeBytes).toBeLessThan(900) // Smaller than 10-witness tx

  })
})
