import { describe, expect, it } from "@effect/vitest"

import * as Address from "../src/core/AddressEras.js"
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

const TESTNET_ADDRESSES = [
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae",
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"
] as const

const CHANGE_ADDRESS = TESTNET_ADDRESSES[0]
const RECEIVER_ADDRESS = TESTNET_ADDRESSES[1]

const baseConfig: TxBuilderConfig = {
}

describe("TxBuilder P0 Edge Cases - Reselection Loop Boundaries", () => {
  it("hit max reselection attempts with insufficient funds", async () => {
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({ txHash: "tx1", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createTestUtxo({ txHash: "tx2", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createTestUtxo({ txHash: "tx3", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createTestUtxo({ txHash: "tx4", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n })
    ]

    const txBuilder = makeTxBuilder(baseConfig)

    // Try to build transaction requiring 5M lovelace (impossible with 400k total)
    await expect(
      txBuilder
        .payToAddress({
          address: RECEIVER_ADDRESS,
          assets: Assets.fromLovelace(5_000_000n)
        })
        .build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useV3: true, protocolParameters: PROTOCOL_PARAMS })
    ).rejects.toThrow()
  })

  it("asset fragmentation requires multiple selections", async () => {
    const policyA = "aaa" + "0".repeat(53)
    const policyB = "bbb" + "0".repeat(53)
    const policyC = "ccc" + "0".repeat(53)
    // Asset names in hex (no dot separator in unit format)
    const tokenA = `${policyA}546f6b656e41` // "TokenA" in hex
    const tokenB = `${policyB}546f6b656e42` // "TokenB" in hex
    const tokenC = `${policyC}546f6b656e43` // "TokenC" in hex

    const utxos: Array<UTxO.UTxO> = [
      // Small amounts (20 units each)
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenA]: 20n }
      }),
      createTestUtxo({
        txHash: "tx2",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenB]: 20n }
      }),
      createTestUtxo({
        txHash: "tx3",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenC]: 20n }
      }),

      // Medium amounts (30 units each)
      createTestUtxo({
        txHash: "tx4",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenA]: 30n }
      }),
      createTestUtxo({
        txHash: "tx5",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenB]: 30n }
      }),
      createTestUtxo({
        txHash: "tx6",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenC]: 30n }
      }),

      // Large amounts (50 units each)
      createTestUtxo({
        txHash: "tx7",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenA]: 50n }
      }),
      createTestUtxo({
        txHash: "tx8",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenB]: 50n }
      }),
      createTestUtxo({
        txHash: "tx9",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenC]: 50n }
      }),

      // ADA-only backup
      createTestUtxo({ txHash: "tx10", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 5_000_000n })
    ]

    const paymentAssets: Assets.Assets = {
      lovelace: 1_500_000n,
      [tokenA]: 100n,
      [tokenB]: 100n,
      [tokenC]: 100n
    }

    const txBuilder = makeTxBuilder(baseConfig)

    const signBuilder = await txBuilder
      .payToAddress({
        address: RECEIVER_ADDRESS,
        assets: paymentAssets
      })
      .build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useV3: true, protocolParameters: PROTOCOL_PARAMS })

    const tx = await signBuilder.toTransaction()

    expect(tx).toBeDefined()

    // Should select multiple UTxOs to gather sufficient assets
    const inputs = tx.body.inputs.length
    expect(inputs).toBeGreaterThanOrEqual(3) // At least 3 for the 3 tokens

    // Verify change output exists if there are leftover tokens
    const outputs = tx.body.outputs
    expect(outputs.length).toBeGreaterThanOrEqual(1)

    if (outputs.length > 1) {
      const changeOutput = outputs[1]
      expect(changeOutput.amount.coin).toBeGreaterThan(0n)
    }
  })
})

describe("TxBuilder P0 Edge Cases - MinUTxO Boundary Precision", () => {
  it("output 1 lovelace below minUTxO triggers reselection", async () => {
    const policy = "bbb" + "0".repeat(53)
    const assetName = "546f6b656e" // "Token" in hex
    const unit = `${policy}${assetName}`

    // Calculate precise amounts to force 1 lovelace below minUTxO scenario
    // For 1 asset, minUTxO ≈ 461,170 lovelace (from actual CBOR calculation)
    // We want change to be exactly 461,169 lovelace (1 below minUTxO) before reselection

    // Target: Input - Payment - Fee ≈ 461,169 lovelace with 1 token
    // Input: 1,626,539 lovelace + 1 token
    // Payment: 1,000,000 lovelace (no tokens)
    // Expected base fee (no change): ~165,369 lovelace
    // Leftover: 1,626,539 - 1,000,000 - 165,369 = 461,170 lovelace (exactly at minUTxO)
    // But we want 1 lovelace LESS, so reduce input by 1
    const utxos: Array<UTxO.UTxO> = [
      // First UTxO: precisely calculated to leave 1 lovelace below minUTxO
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 1_626_538n,
        nativeAssets: { [unit]: 1n }
      }),
      // Second UTxO: for reselection to cover the shortfall
      createTestUtxo({ txHash: "tx2", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 500_000n })
    ]

    const txBuilder = makeTxBuilder(baseConfig)

    // Payment that will leave insufficient change with the first UTxO
    const signBuilder = await txBuilder
      .payToAddress({
        address: RECEIVER_ADDRESS,
        assets: { lovelace: 1_000_000n }
      })
      .build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useV3: true, protocolParameters: PROTOCOL_PARAMS })

    const tx = await signBuilder.toTransaction()

    // Strict assertions
    expect(tx).toBeDefined()

    // Should trigger reselection - both UTxOs selected
    expect(tx.body.inputs.length).toBe(2)
    expect(tx.body.outputs.length).toBe(2) // Payment + change

    // Payment output validation
    const paymentOutput = tx.body.outputs[0]
    expect(Address.toBech32(paymentOutput.address)).toBe(RECEIVER_ADDRESS)
    expect(paymentOutput.amount.coin).toBe(1_000_000n)
    expect(paymentOutput.amount._tag).toBe("OnlyCoin")

    // Change output validation
    const changeOutput = tx.body.outputs[1]
    expect(Address.toBech32(changeOutput.address)).toBe(CHANGE_ADDRESS)

    // Change must have the 1 token from first UTxO
    expect(changeOutput.amount._tag).toBe("WithAssets")
    if (changeOutput.amount._tag === "WithAssets") {
      let totalTokens = 0n
      for (const [_, assetMap] of changeOutput.amount.assets) {
        for (const [_, qty] of assetMap) {
          totalTokens += qty
        }
      }
      expect(totalTokens).toBe(1n)

      // Change ADA must be >= minUTxO (should be ~961k after adding 2nd UTxO)
      const changeAda = changeOutput.amount.coin
      expect(changeAda).toBeGreaterThanOrEqual(461_170n) // Must meet minUTxO
    }

    // Fee validation - should be reasonable for 2-input, 2-output tx
    const fee = tx.body.fee
    expect(fee).toBeGreaterThan(155_381n) // > minFeeConstant
    expect(fee).toBeLessThan(200_000n) // < reasonable upper bound
  })

  it("maximum asset name lengths at minUTxO boundary", async () => {
    const policy = "ccc" + "0".repeat(53)

    // Create assets with maximum-length names (32 bytes = 64 hex chars)
    const maxLengthName1 = "a".repeat(64) // 32 bytes
    const maxLengthName2 = "b".repeat(64) // 32 bytes
    const maxLengthName3 = "c".repeat(64) // 32 bytes

    const unit1 = `${policy}${maxLengthName1}`
    const unit2 = `${policy}${maxLengthName2}`
    const unit3 = `${policy}${maxLengthName3}`

    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 6_000_000n,
        nativeAssets: {
          [unit1]: 100n,
          [unit2]: 100n,
          [unit3]: 100n
        }
      })
    ]

    const txBuilder = makeTxBuilder(baseConfig)

    // Small payment to leave change with max-length asset names
    const signBuilder = await txBuilder
      .payToAddress({
        address: RECEIVER_ADDRESS,
        assets: { lovelace: 2_000_000n }
      })
      .build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useV3: true, protocolParameters: PROTOCOL_PARAMS })

    const tx = await signBuilder.toTransaction()

    // Strict assertions
    expect(tx).toBeDefined()
    expect(tx.body.inputs.length).toBe(1) // Exactly 1 input
    expect(tx.body.outputs.length).toBe(2) // Exactly payment + change

    // Payment output validation
    const paymentOutput = tx.body.outputs[0]
    expect(Address.toBech32(paymentOutput.address)).toBe(RECEIVER_ADDRESS)
    expect(paymentOutput.amount.coin).toBe(2_000_000n)
    expect(paymentOutput.amount._tag).toBe("OnlyCoin") // No assets in payment

    // Change output validation
    const changeOutput = tx.body.outputs[1]
    expect(Address.toBech32(changeOutput.address)).toBe(CHANGE_ADDRESS)

    // Strict ADA validation: exact value from deterministic transaction
    const changeAda = changeOutput.amount.coin
    expect(changeAda).toBe(3_822_751n)

    // Strict asset validation
    expect(changeOutput.amount._tag).toBe("WithAssets")
    if (changeOutput.amount._tag === "WithAssets") {
      const assetMap = changeOutput.amount.assets

      // Count total assets and verify quantity (don't assume specific policy grouping)
      let totalAssets = 0
      let totalQuantity = 0n
      for (const [_, innerMap] of assetMap) {
        totalAssets += innerMap.size
        for (const [_, qty] of innerMap) {
          totalQuantity += qty
        }
      }

      expect(totalAssets).toBe(3) // Exactly 3 assets
      expect(totalQuantity).toBe(300n) // 3 assets * 100 quantity each
    }

    // Fee validation
    const fee = tx.body.fee
    expect(fee).toBe(177_249n)
  })

  it("fee oscillation through 3 reselection attempts", async () => {
    // Create carefully sized UTxOs to force 3 reselection attempts
    // Key: Use native assets so reselection is triggered instead of error
    const testPolicyId = "00".repeat(28)
    const testAssetName = "54455354" // "TEST" in hex
    const testUnit = `${testPolicyId}${testAssetName}`

    const utxos: Array<UTxO.UTxO> = [
      // Initial selection: 2 UTxOs - covers payment but change is too small
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 2_300_000n,
        nativeAssets: { [testUnit]: 1n }
      }),
      createTestUtxo({ txHash: "tx2", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 2_100_000n }),

      // Attempt 2: Adds a small UTxO, but fee increase eats most of it
      createTestUtxo({ txHash: "tx3", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 250_000n }),

      // Attempt 3: Needs yet another small UTxO to finally converge
      createTestUtxo({ txHash: "tx4", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 250_000n }),
      createTestUtxo({ txHash: "tx5", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 200_000n }),
      createTestUtxo({ txHash: "tx6", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 200_000n })
    ]

    const txBuilder = makeTxBuilder(baseConfig)

    // Payment sized to trigger cascading reselection
    // Initial 2 UTxOs: 4.4M total
    // Payment: 4.0M
    // Fee: ~170K
    // Change: 4.4M - 4.0M - 170K = 230K (< 457K minUTxO with asset)
    // Triggers reselection!
    const signBuilder = await txBuilder
      .payToAddress({
        address: RECEIVER_ADDRESS,
        assets: { lovelace: 4_000_000n } // 4.0 ADA (no native assets in payment)
      })
      .build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useV3: true, protocolParameters: PROTOCOL_PARAMS })

    const tx = await signBuilder.toTransaction()

    // Strict assertions
    expect(tx).toBeDefined()

    // Should have selected 3-4 UTxOs through multiple reselection attempts
    const inputCount = tx.body.inputs.length
    expect(inputCount).toBeGreaterThanOrEqual(3)
    expect(inputCount).toBeLessThanOrEqual(4)

    // Should have payment + change (change has native asset)
    expect(tx.body.outputs.length).toBe(2)

    // Payment output validation
    const paymentOutput = tx.body.outputs[0]
    expect(Address.toBech32(paymentOutput.address)).toBe(RECEIVER_ADDRESS)
    expect(paymentOutput.amount.coin).toBe(4_000_000n)
    // Payment should have no native assets (coin-only)
    if ("assets" in paymentOutput.amount) {
      expect(paymentOutput.amount.assets).toBeUndefined()
    }

    // Change output validation
    const changeOutput = tx.body.outputs[1]
    expect(Address.toBech32(changeOutput.address)).toBe(CHANGE_ADDRESS)

    // Change must be >= minUTxO (with 1 native asset ~457K)
    const changeAda = changeOutput.amount.coin
    expect(changeAda).toBeGreaterThanOrEqual(456_000n)

    // Change should have the native asset token
    expect("assets" in changeOutput.amount).toBe(true)
    if ("assets" in changeOutput.amount && changeOutput.amount._tag === "WithAssets") {
      const changeAssets = changeOutput.amount.assets
      expect(changeAssets).toBeDefined()

      // Check that the test token is present in the change output
      let foundTestAsset = false
      for (const [_, assetMap] of changeAssets) {
        for (const [_, qty] of assetMap) {
          if (qty === 1n) {
            foundTestAsset = true
          }
        }
      }
      expect(foundTestAsset).toBe(true)
    }

    // Fee validation
    const fee = tx.body.fee
    expect(fee).toBeGreaterThan(165_000n)
    expect(fee).toBeLessThan(250_000n)

    // Balance equation must hold after reselection attempts
    const totalInput =
      inputCount === 3 ? 2_300_000n + 2_100_000n + 250_000n : 2_300_000n + 2_100_000n + 250_000n + 250_000n
    const totalOutput = paymentOutput.amount.coin + changeAda
    const balanceCheck = totalInput - totalOutput - fee

    expect(balanceCheck).toBe(0n)

    // Success: System converged after multiple reselection attempts
    // Native asset forced reselection path instead of error
  })
})
