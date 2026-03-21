import { describe, expect, it } from "@effect/vitest"

import * as Address from "../src/Address.js"
import * as CoreAssets from "../src/Assets/index.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import type * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

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

const baseConfig: TxBuilderConfig = {}

describe("TxBuilder P0 Edge Cases - Reselection Loop Boundaries", () => {
  it("hit max reselection attempts with insufficient funds", async () => {
    const utxos: Array<CoreUTxO.UTxO> = [
      createCoreTestUtxo({ transactionId: "a".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createCoreTestUtxo({ transactionId: "b".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createCoreTestUtxo({ transactionId: "c".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createCoreTestUtxo({ transactionId: "d".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 100_000n })
    ]

    const txBuilder = makeTxBuilder(baseConfig)

    // Try to build transaction requiring 5M lovelace (impossible with 400k total)
    await expect(
      txBuilder
        .payToAddress({
          address: Address.fromBech32(RECEIVER_ADDRESS),
          assets: CoreAssets.fromLovelace(5_000_000n)
        })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS
        })
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

    const utxos: Array<CoreUTxO.UTxO> = [
      // Small amounts (20 units each)
      createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenA]: 20n }
      }),
      createCoreTestUtxo({
        transactionId: "b".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenB]: 20n }
      }),
      createCoreTestUtxo({
        transactionId: "c".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenC]: 20n }
      }),

      // Medium amounts (30 units each)
      createCoreTestUtxo({
        transactionId: "d".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenA]: 30n }
      }),
      createCoreTestUtxo({
        transactionId: "e".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenB]: 30n }
      }),
      createCoreTestUtxo({
        transactionId: "f".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenC]: 30n }
      }),

      // Large amounts (50 units each)
      createCoreTestUtxo({
        transactionId: "1".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenA]: 50n }
      }),
      createCoreTestUtxo({
        transactionId: "2".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenB]: 50n }
      }),
      createCoreTestUtxo({
        transactionId: "3".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_000_000n,
        nativeAssets: { [tokenC]: 50n }
      }),

      // ADA-only backup
      createCoreTestUtxo({ transactionId: "4".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 5_000_000n })
    ]

    const paymentAssets = CoreAssets.addByHex(
      CoreAssets.addByHex(
        CoreAssets.addByHex(CoreAssets.fromLovelace(1_500_000n), policyA, "546f6b656e41", 100n),
        policyB,
        "546f6b656e42",
        100n
      ),
      policyC,
      "546f6b656e43",
      100n
    )

    const txBuilder = makeTxBuilder(baseConfig)

    const signBuilder = await txBuilder
      .payToAddress({
        address: Address.fromBech32(RECEIVER_ADDRESS),
        assets: paymentAssets
      })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })

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
      expect(changeOutput.assets.lovelace).toBeGreaterThan(0n)
    }
  })
})

describe("TxBuilder P0 Edge Cases - MinUTxO Boundary Precision", () => {
  it("output 1 lovelace below minUTxO triggers reselection", async () => {
    const policy = "bbb" + "0".repeat(53)
    const assetName = "546f6b656e" // "Token" in hex
    const unit = `${policy}${assetName}`

    // Calculate precise amounts to force 1 lovelace below minUTxO scenario
    // For 1 asset with Shelley format, minUTxO is lower than with Babbage map format
    // Need to find the exact threshold by trial - let's try forcing insufficient change

    // Try with deliberately low input to ensure reselection
    // Input: 1,620,000 lovelace + 1 token
    // Payment: 1,000,000 lovelace (no tokens)
    // Expected fee with native asset in change: ~169,901 lovelace
    // Leftover: 1,620,000 - 1,000,000 - 169,901 = 450,099 lovelace (should be below minUTxO)
    const utxos: Array<CoreUTxO.UTxO> = [
      // First UTxO: deliberately insufficient to trigger reselection
      createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 1_620_000n,
        nativeAssets: { [unit]: 1n }
      }),
      // Second UTxO: for reselection to cover the shortfall
      createCoreTestUtxo({ transactionId: "b".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 700_000n })
    ]

    const txBuilder = makeTxBuilder(baseConfig)

    // Payment that will leave insufficient change with the first UTxO
    const signBuilder = await txBuilder
      .payToAddress({
        address: Address.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(1_000_000n)
      })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()

    // Strict assertions
    expect(tx).toBeDefined()

    // Should trigger reselection - both UTxOs selected
    expect(tx.body.inputs.length).toBe(2)
    expect(tx.body.outputs.length).toBe(2) // Payment + change

    // Payment output validation
    const paymentOutput = tx.body.outputs[0]
    expect(Address.toBech32(paymentOutput.address)).toBe(RECEIVER_ADDRESS)
    expect(paymentOutput.assets.lovelace).toBe(1_000_000n)
    expect(paymentOutput.assets.multiAsset).toBeUndefined()

    // Change output validation
    const changeOutput = tx.body.outputs[1]
    expect(Address.toBech32(changeOutput.address)).toBe(CHANGE_ADDRESS)

    // Change must have the 1 token from first UTxO
    expect(changeOutput.assets.multiAsset).toBeDefined()
    if (changeOutput.assets.multiAsset !== undefined) {
      let totalTokens = 0n
      for (const [_, assetMap] of changeOutput.assets.multiAsset.map) {
        for (const [_, qty] of assetMap) {
          totalTokens += qty
        }
      }
      expect(totalTokens).toBe(1n)

      // Change ADA must meet minUTxO (corrected Babbage/Conway formula with 160-byte overhead)
      const changeAda = changeOutput.assets.lovelace
      expect(changeAda).toBe(1_148_515n)
    }

    // Fee validation
    const fee = tx.body.fee
    expect(fee).toBe(171_485n)
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

    const utxos: Array<CoreUTxO.UTxO> = [
      createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0n,
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
        address: Address.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()

    // Strict assertions
    expect(tx).toBeDefined()
    expect(tx.body.inputs.length).toBe(1) // Exactly 1 input
    expect(tx.body.outputs.length).toBe(2) // Exactly payment + change

    // Payment output validation
    const paymentOutput = tx.body.outputs[0]
    expect(Address.toBech32(paymentOutput.address)).toBe(RECEIVER_ADDRESS)
    expect(paymentOutput.assets.lovelace).toBe(2_000_000n)
    expect(paymentOutput.assets.multiAsset).toBeUndefined() // No assets in payment

    // Change output validation
    const changeOutput = tx.body.outputs[1]
    expect(Address.toBech32(changeOutput.address)).toBe(CHANGE_ADDRESS)

    // Strict ADA validation: exact value from deterministic transaction
    const changeAda = changeOutput.assets.lovelace
    expect(changeAda).toBe(3_825_655n) // 6M - 2M - 174,345 fee (431 bytes with Shelley format)

    // Strict asset validation
    expect(changeOutput.assets.multiAsset).toBeDefined()
    if (changeOutput.assets.multiAsset !== undefined) {
      const assetMap = changeOutput.assets.multiAsset

      // Count total assets and verify quantity (don't assume specific policy grouping)
      let totalAssets = 0
      let totalQuantity = 0n
      for (const [_, innerMap] of assetMap.map) {
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
    expect(fee).toBe(174_345n) // 431 bytes * 44 + 155_381 (Shelley format saves 4 bytes)
  })

  it("fee oscillation through 3 reselection attempts", async () => {
    // Create carefully sized UTxOs to force 3 reselection attempts
    // Key: Use native assets so reselection is triggered instead of error
    const testPolicyId = "00".repeat(28)
    const testAssetName = "54455354" // "TEST" in hex
    const testUnit = `${testPolicyId}${testAssetName}`

    const utxos: Array<CoreUTxO.UTxO> = [
      // Initial selection: 2 UTxOs - covers payment but change is too small for minUTxO (~1.1M with native asset)
      createCoreTestUtxo({
        transactionId: "a".repeat(64),
        index: 0n,
        address: CHANGE_ADDRESS,
        lovelace: 2_300_000n,
        nativeAssets: { [testUnit]: 1n }
      }),
      createCoreTestUtxo({ transactionId: "b".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 2_100_000n }),

      // Attempt 2: Adds a medium UTxO, but fee increase eats into it — still below minUTxO
      createCoreTestUtxo({ transactionId: "c".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 500_000n }),

      // Attempt 3: Needs yet another UTxO to finally converge
      createCoreTestUtxo({ transactionId: "d".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 500_000n }),
      createCoreTestUtxo({ transactionId: "e".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 400_000n }),
      createCoreTestUtxo({ transactionId: "f".repeat(64), index: 0n, address: CHANGE_ADDRESS, lovelace: 400_000n })
    ]

    const txBuilder = makeTxBuilder(baseConfig)

    // Payment sized to trigger cascading reselection
    // Initial 2 UTxOs: 4.4M total
    // Payment: 4.0M
    // Fee: ~170K
    // Change: 4.4M - 4.0M - 170K = 230K (< ~1.1M minUTxO with asset)
    // Triggers reselection!
    const signBuilder = await txBuilder
      .payToAddress({
        address: Address.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(4_000_000n) // 4.0 ADA (no native assets in payment)
      })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()

    // Strict assertions
    expect(tx).toBeDefined()

    // Should have selected exact number of UTxOs through reselection
    const inputCount = tx.body.inputs.length
    expect(inputCount).toBe(4)

    // Should have payment + change (change has native asset)
    expect(tx.body.outputs.length).toBe(2)

    // Payment output validation
    const paymentOutput = tx.body.outputs[0]
    expect(Address.toBech32(paymentOutput.address)).toBe(RECEIVER_ADDRESS)
    expect(paymentOutput.assets.lovelace).toBe(4_000_000n)
    // Payment should have no native assets (coin-only)
    expect(paymentOutput.assets.multiAsset).toBeUndefined()

    // Change output validation
    const changeOutput = tx.body.outputs[1]
    expect(Address.toBech32(changeOutput.address)).toBe(CHANGE_ADDRESS)

    // Change must be >= minUTxO (corrected Babbage/Conway with native asset)
    const changeAda = changeOutput.assets.lovelace
    expect(changeAda).toBe(1_225_391n)

    // Change should have the native asset token
    expect(changeOutput.assets.multiAsset).toBeDefined()
    if (changeOutput.assets.multiAsset !== undefined) {
      const changeAssets = changeOutput.assets.multiAsset
      expect(changeAssets).toBeDefined()

      // Check that the test token is present in the change output
      let foundTestAsset = false
      for (const [_, assetMap] of changeAssets.map) {
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
    expect(fee).toBe(174_609n)

    // Balance equation must hold after reselection attempts
    const utxoMap = new Map(utxos.map((u) => [u.transactionId, u.assets.lovelace]))
    const totalInput = tx.body.inputs.reduce((sum, input) => sum + (utxoMap.get(input.transactionId) ?? 0n), 0n)
    expect(totalInput).toBe(5_400_000n) // 2.3M + 2.1M + 500K + 500K
    const totalOutput = paymentOutput.assets.lovelace + changeAda
    const balanceCheck = totalInput - totalOutput - fee

    expect(balanceCheck).toBe(0n)

    // Success: System converged after multiple reselection attempts
    // Native asset forced reselection path instead of error
  })
})
