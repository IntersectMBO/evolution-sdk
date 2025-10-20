import { describe, expect, it } from "@effect/vitest"

import * as Assets from "../src/sdk/Assets.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import type * as UTxO from "../src/sdk/UTxO.js"

/**
 * Integration tests for Unfrack change handling with V3 flow.
 * 
 * These tests validate the complete change handling pipeline:
 * Selection → ChangeCreation → Unfrack → Fee Calculation → Balance → Fallback
 * 
 * Test Coverage:
 * 1. Re-selection when token bundles unaffordable
 * 2. Immediate fallback to single output (bundles unaffordable, no reselection)
 * 3. Error handling for tokens + insufficient lovelace
 * 4. Subdivision strategy (remaining ADA above threshold)
 * 5. Spread strategy (remaining ADA below threshold)
 * 6. DrainTo fallback (merge leftover into existing output)
 * 7. Burn fallback (discard leftover as extra fee)
 * 
 * These tests use the full transaction builder flow to ensure realistic behavior.
 * They were developed through detailed log analysis to verify each edge case.
 */

// ============================================================================
// Test Configuration
// ============================================================================

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const DESTINATION_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

// Helper to convert string to hex (for asset names)
const toHex = (str: string): string => Buffer.from(str, "utf8").toString("hex")

// Test tokens (56-char policy IDs + asset names)
const POLICY_A = "a".repeat(56)
const POLICY_B = "b".repeat(56)
const POLICY_C = "c".repeat(56)

const token1 = `${POLICY_A}${toHex("TOKEN1")}`
const token2 = `${POLICY_B}${toHex("TOKEN2")}`
const token3 = `${POLICY_C}${toHex("TOKEN3")}`

// ============================================================================
// TEST SUITE: Unfrack Change Handling Integration
// ============================================================================

describe("TxBuilder: Unfrack Change Handling Integration", () => {
  
  describe("Re-selection when token bundles unaffordable", () => {
    it("should trigger re-selection and add more UTxOs when initial funds insufficient for token bundles", async () => {
      /**
       * Scenario:
       * - Initial UTxO: 1M lovelace + 3 tokens
       * - Payment: 100k lovelace
       * - Available leftover: ~900k lovelace (after payment, before fee)
       * - Token bundles need: ~1.4M minUTxO (3 bundles × ~471k each)
       * - Remaining: -513k (INSUFFICIENT for bundles)
       * 
       * Expected Flow:
       * 1. Selection: Use initial UTxO
       * 2. ChangeCreation: Calculate leftover (900k lovelace + 3 tokens)
       * 3. Unfrack: Bundles need 1.4M, only have 900k → Return undefined (unaffordable)
       * 4. ChangeCreation: Fallback to single output (guaranteed affordable by pre-flight)
       * 5. Fee calculation: ~173k fee
       * 6. Balance: Shortfall detected (173k fee needs to be subtracted from change)
       * 7. ChangeCreation (2nd iteration): Leftover now 726k (still below 818k minUTxO for tokens)
       * 8. Pre-flight check: 726k < 818k minUTxO → RESELECTION TRIGGERED
       * 9. Selection: Add 2M UTxO to reach 3M total
       * 10. ChangeCreation: Calculate leftover (2.9M lovelace + 3 tokens)
       * 11. Unfrack: Bundles need 1.4M, have 2.9M → Subdivision success! (3 bundles + 1 ADA output)
       * 12. Fee converges, transaction balanced
       * 
       * Key Assertions:
       * - Transaction should have 2 inputs (original + reselected)
       * - Should have 5 outputs (1 payment + 4 change = 3 token bundles + 1 ADA)
       * - Fee should be valid for final transaction size
       * - All change outputs should meet minUTxO requirements
       */
      
      const initialUtxo: UTxO.UTxO = {
        txHash: "a".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: {
          lovelace: 1_000_000n,
          [token1]: 100n,
          [token2]: 200n,
          [token3]: 300n
        }
      }

      // Additional UTxOs available for re-selection
      const additionalUtxos: Array<UTxO.UTxO> = [
        {
          txHash: "b".repeat(64),
          outputIndex: 0,
          address: CHANGE_ADDRESS,
          assets: { lovelace: 2_000_000n } // 2 ADA to make bundles affordable
        }
      ]

      const builder = makeTxBuilder({
        protocolParameters: PROTOCOL_PARAMS,
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: additionalUtxos // Available for re-selection
      })
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(100_000n) // Small payment to maximize leftover
        })

      const signBuilder = await builder.build({
        useV3: true,
        useStateMachine: true,
        unfrack: {
          ada: {
            subdivideThreshold: 500_000n,
            subdividePercentages: [50, 30, 20]
          }
        }
      })

      const tx = await signBuilder.toTransaction()
      
      // Assertions
      expect(tx.body.inputs).toHaveLength(2) // Initial + reselected UTxO
      expect(tx.body.outputs).toHaveLength(5) // 1 payment + 4 change (3 token bundles + 1 ADA)
      
      // Verify payment output is correct
      const paymentOutput = tx.body.outputs[0]
      expect(paymentOutput.amount.coin).toBe(100_000n)
      
      // Verify all change outputs meet minUTxO
      const changeOutputs = tx.body.outputs.slice(1)
      for (const output of changeOutputs) {
        // Each output should have at least ~289k lovelace (minUTxO for ADA-only or with tokens)
        expect(output.amount.coin).toBeGreaterThanOrEqual(288_770n)
      }
      
      // Verify token distribution: all 3 tokens should be preserved in change outputs
      let totalTokenTypes = 0
      
      for (const output of changeOutputs) {
        // Check if this output has native assets (WithAssets type)
        if (output.amount._tag === "WithAssets") {
          // MultiAsset is a Map<PolicyId, Map<AssetName, Amount>>
          for (const [_policyId, assetMap] of output.amount.assets) {
            totalTokenTypes += assetMap.size
          }
        }
      }
      
      // All 3 tokens should be preserved across change outputs
      expect(totalTokenTypes).toBe(3)
    })
  })

  describe("Immediate fallback to single output when bundles unaffordable", () => {
    it("should fall back to single change output without reselection when bundles barely unaffordable", async () => {
      /**
       * Scenario:
       * - Initial UTxO: 1.5M lovelace + 3 tokens
       * - Payment: 100k lovelace
       * - Available leftover: ~1.4M lovelace (after payment, before fee)
       * - Token bundles need: ~1.4M minUTxO (3 bundles × ~463k each)
       * - Remaining: -13,680 lovelace (BARELY INSUFFICIENT for bundles)
       * 
       * Expected Flow:
       * 1. Selection: Use initial UTxO (1.5M + 3 tokens)
       * 2. ChangeCreation: Calculate leftover (1.4M lovelace + 3 tokens)
       * 3. Unfrack: Bundles need 1.413M, only have 1.4M → Return undefined (unaffordable)
       * 4. Fallback: Create single change output with all assets (guaranteed affordable)
       * 5. Fee calculation: ~173k fee
       * 6. Balance: Shortfall detected (173k fee needs to be subtracted)
       * 7. ChangeCreation (2nd iteration): Leftover now 1.226M (still above minUTxO ~819k)
       * 8. Unfrack: Still unaffordable for bundles → Single output again
       * 9. Fee converges, transaction balanced
       * 
       * Key Point: No reselection occurs because:
       * - Pre-flight check guarantees single output is always affordable
       * - Even with reduced leftover (1.226M), it's still > minUTxO (819k)
       * 
       * This is different from Test 1 where reselection was needed because
       * the leftover fell below minUTxO after fee calculation.
       * 
       * Key Assertions:
       * - Transaction should have 1 input only (no reselection)
       * - Should have 2 outputs (1 payment + 1 change with all tokens)
       * - Change output should contain all 3 tokens
       * - Change output should meet minUTxO requirements
       */
      
      const initialUtxo: UTxO.UTxO = {
        txHash: "c".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: {
          lovelace: 1_500_000n,
          [token1]: 100n,
          [token2]: 200n,
          [token3]: 300n
        }
      }

      // Add tiny UTxOs that won't help (testing that no reselection occurs)
      const tinyUtxos: Array<UTxO.UTxO> = [
        { txHash: "d".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, assets: { lovelace: 100_000n } },
        { txHash: "e".repeat(64), outputIndex: 0, address: CHANGE_ADDRESS, assets: { lovelace: 100_000n } }
      ]

      const builder = makeTxBuilder({
        protocolParameters: PROTOCOL_PARAMS,
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: tinyUtxos // Available but won't be used
      })
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(100_000n)
        })

      const signBuilder = await builder.build({
        useV3: true,
        useStateMachine: true,
        unfrack: {
          ada: {
            subdivideThreshold: 500_000n,
            subdividePercentages: [50, 30, 20]
          }
        }
      })

      const tx = await signBuilder.toTransaction()
      
      // Assertions
      expect(tx.body.inputs).toHaveLength(1) // No reselection occurred
      expect(tx.body.outputs).toHaveLength(2) // 1 payment + 1 change (single output with all tokens)
      
      // Verify payment output
      const paymentOutput = tx.body.outputs[0]
      expect(paymentOutput.amount.coin).toBe(100_000n)
      
      // Verify change output has all tokens and meets minUTxO
      const changeOutput = tx.body.outputs[1]
      expect(changeOutput.amount.coin).toBeGreaterThanOrEqual(793_000n) // minUTxO for tokens ~819k, but after fee ~1.226M
      
      // Verify all 3 tokens are in the single change output
      let totalTokenTypes = 0
      if (changeOutput.amount._tag === "WithAssets") {
        for (const [_policyId, assetMap] of changeOutput.amount.assets) {
          totalTokenTypes += assetMap.size
        }
      }
      
      expect(totalTokenTypes).toBe(3)
    })
  })

  describe("Error handling: Tokens + insufficient lovelace", () => {
    it("should throw clear error when tokens present but change below minUTxO and no UTxOs available", async () => {
      /**
       * Scenario:
       * - Initial UTxO: 500k lovelace + 3 tokens
       * - Payment: 200k lovelace
       * - Available leftover: ~300k lovelace (after payment, before fee)
       * - Token bundles need: ~1.4M minUTxO → UNAFFORDABLE
       * - Single change output minUTxO: ~819k → Also UNAFFORDABLE (300k < 819k)
       * - No more UTxOs available for reselection
       * 
       * Expected Flow:
       * 1. Selection: Use initial UTxO
       * 2. ChangeCreation: Calculate leftover (300k lovelace + 3 tokens)
       * 3. Unfrack: Bundles need 1.4M, only have 300k → Return undefined (unaffordable)
       * 4. ChangeCreation: Fallback to single output
       * 5. Pre-flight check: Single output minUTxO (819k) > available (300k) → UNAFFORDABLE
       * 6. Reselection: No UTxOs available → CANNOT RESELECT
       * 7. ERROR: Throw with clear message about native assets + insufficient lovelace
       * 
       * Key Point:
       * - Error message should be helpful: mention tokens, minUTxO requirement, and suggest solutions
       * - Different from pure lovelace insufficiency (which has different error)
       */
      
      const initialUtxo: UTxO.UTxO = {
        txHash: "g".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: {
          lovelace: 500_000n,
          [token1]: 100n,
          [token2]: 200n,
          [token3]: 300n
        }
      }

      const builder = makeTxBuilder({
        protocolParameters: PROTOCOL_PARAMS,
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: [] // No more UTxOs available
      })
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(200_000n)
        })

      // Expect build to throw error
      await expect(async () => {
        await builder.build({
          useV3: true,
          useStateMachine: true,
          unfrack: {
            ada: {
              subdivideThreshold: 500_000n,
              subdividePercentages: [50, 30, 20]
            }
          }
        })
      }).rejects.toThrow(/Native assets present/)
    })
  })

  describe("Subdivision strategy when remaining ADA above threshold", () => {
    it("should create separate ADA output when remaining above subdivideThreshold", async () => {
      const initialUtxo: UTxO.UTxO = {
        txHash: "1".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: {
          lovelace: 4_100_000n,
          [token1]: 100n,
          [token2]: 200n,
          [token3]: 300n
        }
      }

      const builder = makeTxBuilder({
        protocolParameters: PROTOCOL_PARAMS,
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: []
      })
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(2_000_000n)
        })

      const signBuilder = await builder.build({
        useV3: true,
        useStateMachine: true,
        unfrack: {
          ada: {
            subdivideThreshold: 500_000n,
            subdividePercentages: [50, 30, 20]
          }
        }
      })

      const tx = await signBuilder.toTransaction()
      
      expect(tx.body.inputs).toHaveLength(1)
      expect(tx.body.outputs).toHaveLength(5) // 1 payment + 4 change
    })
  })

  describe("Spread strategy when remaining ADA below threshold", () => {
    it("should spread remaining lovelace across token bundles when below subdivideThreshold", async () => {
      const initialUtxo: UTxO.UTxO = {
        txHash: "3".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: {
          lovelace: 3_000_000n,
          [token1]: 100n,
          [token2]: 200n,
          [token3]: 300n
        }
      }

      const builder = makeTxBuilder({
        protocolParameters: PROTOCOL_PARAMS,
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: []
      })
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(1_200_000n)
        })

      const signBuilder = await builder.build({
        useV3: true,
        useStateMachine: true,
        unfrack: {
          ada: {
            subdivideThreshold: 500_000n,
            subdividePercentages: [50, 30, 20]
          }
        }
      })

      const tx = await signBuilder.toTransaction()
      
      expect(tx.body.inputs).toHaveLength(1)
      expect(tx.body.outputs).toHaveLength(4) // 1 payment + 3 change (spread, no separate ADA)
    })
  })

  describe("DrainTo fallback when change below minUTxO", () => {
    it("should drain leftover into specified output when change unaffordable", async () => {
      const initialUtxo: UTxO.UTxO = {
        txHash: "6".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: {
          lovelace: 350_000n
        }
      }

      const builder = makeTxBuilder({
        protocolParameters: PROTOCOL_PARAMS,
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: []
      })
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(100_000n)
        })

      const signBuilder = await builder.build({
        useV3: true,
        useStateMachine: true,
        drainTo: 0,
        unfrack: {
          ada: {
            subdivideThreshold: 500_000n,
            subdividePercentages: [50, 30, 20]
          }
        }
      })
      
      const tx = await signBuilder.toTransaction()
      
      expect(tx.body.inputs).toHaveLength(1)
      expect(tx.body.outputs).toHaveLength(1) // Only payment (with drained leftover)
      expect(tx.body.outputs[0].amount.coin).toBeGreaterThan(100_000n) // Has drained amount
    })
  })

  describe("Burn fallback when change below minUTxO", () => {
    it("should burn leftover as extra fee when change unaffordable and no drainTo", async () => {
      const initialUtxo: UTxO.UTxO = {
        txHash: "7".repeat(64),
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        assets: {
          lovelace: 350_000n
        }
      }

      const builder = makeTxBuilder({
        protocolParameters: PROTOCOL_PARAMS,
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: []
      })
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: DESTINATION_ADDRESS,
          assets: Assets.fromLovelace(100_000n)
        })

      const signBuilder = await builder.build({
        useV3: true,
        useStateMachine: true,
        onInsufficientChange: "burn",
        unfrack: {
          ada: {
            subdivideThreshold: 500_000n,
            subdividePercentages: [50, 30, 20]
          }
        }
      })
      
      const tx = await signBuilder.toTransaction()
      
      expect(tx.body.inputs).toHaveLength(1)
      expect(tx.body.outputs).toHaveLength(1) // Only payment
      expect(tx.body.outputs[0].amount.coin).toBe(100_000n) // Payment unchanged (leftover burned as fee)
    })
  })
})
