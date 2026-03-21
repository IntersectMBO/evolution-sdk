import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets/index.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

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

const _token1 = `${POLICY_A}${toHex("TOKEN1")}`
const _token2 = `${POLICY_B}${toHex("TOKEN2")}`
const _token3 = `${POLICY_C}${toHex("TOKEN3")}`

// ============================================================================
// TEST SUITE: Unfrack Change Handling Integration
// ============================================================================

describe("TxBuilder: Unfrack Change Handling Integration", () => {
  describe("Re-selection when token bundles unaffordable", () => {
    it("should trigger re-selection and add more UTxOs when initial funds insufficient for token bundles", async () => {
      // Build initial UTxO with tokens
      let initialAssets = CoreAssets.fromLovelace(1_000_000n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_A, toHex("TOKEN1"), 100n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_B, toHex("TOKEN2"), 200n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_C, toHex("TOKEN3"), 300n)
      const initialUtxoBase = createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n
      })
      const initialUtxo = new CoreUTxO.UTxO({ ...initialUtxoBase, assets: initialAssets })

      // Additional UTxOs available for re-selection
      const additionalUtxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({
          transactionId: "b".repeat(64),
          index: 0,
          address: CHANGE_ADDRESS,
          lovelace: 5_000_000n // 5 ADA to make bundles affordable (corrected minUTxO ~1.1M per token output)
        })
      ]

      const builder = makeTxBuilder({})
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(100_000n) // Small payment to maximize leftover
        })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: additionalUtxos, // Available for re-selection
        protocolParameters: PROTOCOL_PARAMS,
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
      expect(paymentOutput.assets.lovelace).toBe(100_000n)

      // Verify all change outputs meet minUTxO (corrected Babbage/Conway formula)
      const changeOutputs = tx.body.outputs.slice(1)
      expect(changeOutputs[0].assets.lovelace).toBe(1_150_770n)
      expect(changeOutputs[1].assets.lovelace).toBe(1_150_770n)
      expect(changeOutputs[2].assets.lovelace).toBe(1_155_080n)
      expect(changeOutputs[3].assets.lovelace).toBe(2_259_487n)

      // Verify token distribution: all 3 tokens should be preserved in change outputs
      let totalTokenTypes = 0

      for (const output of changeOutputs) {
        // Check if this output has native assets
        if (output.assets.multiAsset !== undefined) {
          // MultiAsset is a Map<PolicyId, Map<AssetName, Amount>>
          for (const [_policyId, assetMap] of output.assets.multiAsset.map) {
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
      let initialAssets = CoreAssets.fromLovelace(2_500_000n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_A, toHex("TOKEN1"), 100n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_B, toHex("TOKEN2"), 200n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_C, toHex("TOKEN3"), 300n)
      const initialUtxoBase = createCoreTestUtxo({
        transactionId: "c".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 2_500_000n
      })
      const initialUtxo = new CoreUTxO.UTxO({ ...initialUtxoBase, assets: initialAssets })

      // Add tiny UTxOs that won't help (testing that no reselection occurs)
      const tinyUtxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({ transactionId: "d".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 100_000n }),
        createCoreTestUtxo({ transactionId: "e".repeat(64), index: 0, address: CHANGE_ADDRESS, lovelace: 100_000n })
      ]

      const builder = makeTxBuilder({})
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(100_000n)
        })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: tinyUtxos, // Available but won't be used
        protocolParameters: PROTOCOL_PARAMS,
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
      expect(paymentOutput.assets.lovelace).toBe(100_000n)

      // Verify change output has correct amount after fee convergence
      // Input: 2,500,000, Payment: 100,000, Fee: exact
      // Expected change: 2,500,000 - 100,000 - fee
      const changeOutput = tx.body.outputs[1]
      expect(changeOutput.assets.lovelace).toBe(2_226_447n)

      // Verify fee is exact for single-output transaction
      expect(tx.body.fee).toBe(173_553n)

      // Balance equation must hold
      expect(changeOutput.assets.lovelace + paymentOutput.assets.lovelace + tx.body.fee).toBe(2_500_000n)

      // Verify all 3 tokens are in the single change output
      let totalTokenTypes = 0
      if (changeOutput.assets.multiAsset !== undefined) {
        for (const [_policyId, assetMap] of changeOutput.assets.multiAsset.map) {
          totalTokenTypes += assetMap.size
        }
      }

      expect(totalTokenTypes).toBe(3)
    })
  })

  describe("Error handling: Tokens + insufficient lovelace", () => {
    it("should throw clear error when tokens present but change below minUTxO and no UTxOs available", async () => {
      let initialAssets = CoreAssets.fromLovelace(500_000n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_A, toHex("TOKEN1"), 100n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_B, toHex("TOKEN2"), 200n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_C, toHex("TOKEN3"), 300n)
      const initialUtxoBase = createCoreTestUtxo({
        transactionId: "1".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 500_000n
      })
      const initialUtxo = new CoreUTxO.UTxO({ ...initialUtxoBase, assets: initialAssets })

      const builder = makeTxBuilder({})
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(200_000n)
        })

      // Expect build to throw error
      await expect(async () => {
        await builder.build({
          changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
          availableUtxos: [], // No more UTxOs available
          protocolParameters: PROTOCOL_PARAMS,
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
      let initialAssets = CoreAssets.fromLovelace(7_000_000n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_A, toHex("TOKEN1"), 100n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_B, toHex("TOKEN2"), 200n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_C, toHex("TOKEN3"), 300n)
      const initialUtxoBase = createCoreTestUtxo({
        transactionId: "2".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 7_000_000n
      })
      const initialUtxo = new CoreUTxO.UTxO({ ...initialUtxoBase, assets: initialAssets })

      const builder = makeTxBuilder({})
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(2_000_000n)
        })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [],
        protocolParameters: PROTOCOL_PARAMS,
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
      let initialAssets = CoreAssets.fromLovelace(5_000_000n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_A, toHex("TOKEN1"), 100n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_B, toHex("TOKEN2"), 200n)
      initialAssets = CoreAssets.addByHex(initialAssets, POLICY_C, toHex("TOKEN3"), 300n)
      const initialUtxoBase = createCoreTestUtxo({
        transactionId: "3".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 5_000_000n
      })
      const initialUtxo = new CoreUTxO.UTxO({ ...initialUtxoBase, assets: initialAssets })

      const builder = makeTxBuilder({})
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(1_200_000n)
        })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [],
        protocolParameters: PROTOCOL_PARAMS,
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
      const initialUtxo = createCoreTestUtxo({
        transactionId: "6".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 350_000n
      })

      const builder = makeTxBuilder({})
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(100_000n)
        })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [],
        drainTo: 0,
        protocolParameters: PROTOCOL_PARAMS,
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
      expect(tx.body.outputs[0].assets.lovelace).toBeGreaterThan(100_000n) // Has drained amount
    })
  })

  describe("Burn fallback when change below minUTxO", () => {
    it("should burn leftover as extra fee when change unaffordable and no drainTo", async () => {
      const initialUtxo = createCoreTestUtxo({
        transactionId: "7".repeat(64),
        index: 0,
        address: CHANGE_ADDRESS,
        lovelace: 350_000n
      })

      const builder = makeTxBuilder({})
        .collectFrom({ inputs: [initialUtxo] })
        .payToAddress({
          address: CoreAddress.fromBech32(DESTINATION_ADDRESS),
          assets: CoreAssets.fromLovelace(100_000n)
        })

      const signBuilder = await builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [],
        onInsufficientChange: "burn",
        protocolParameters: PROTOCOL_PARAMS,
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
      expect(tx.body.outputs[0].assets.lovelace).toBe(100_000n) // Payment unchanged (leftover burned as fee)
    })
  })
})
