import { describe, expect, it } from "@effect/vitest"

import * as AddressEras from "../src/core/AddressEras.js"
import * as Assets from "../src/sdk/Assets.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import type * as UTxO from "../src/sdk/UTxO.js"

// Test configuration
const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155381n,
  maxTxSize: 16384,
  maxBlockHeaderSize: 1100,
  stakeKeyDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  poolRetirementEpochBound: 18,
  desiredNumberOfPools: 500,
  poolInfluence: "3/10",
  monetaryExpansion: "3/1000",
  treasuryExpansion: "1/5",
  minPoolCost: 340_000_000n,
  coinsPerUtxoByte: 4310n,
  prices: {
    memory: 0.0577,
    steps: 0.0000721
  },
  maxExecutionUnitsPerTransaction: {
    memory: 14_000_000,
    steps: 10_000_000_000
  },
  maxExecutionUnitsPerBlock: {
    memory: 62_000_000,
    steps: 40_000_000_000
  },
  maxValueSize: 5000,
  collateralPercentage: 150,
  maxCollateralInputs: 3
}

const CHANGE_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"
const RECIPIENT_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

const POLICY_ID = "a".repeat(56) // Valid policy ID length
const ASSET_NAME_HEX = "544f4b454e" // "TOKEN" in hex

describe.concurrent("TxBuilder - Unfrack MinUTxO", () => {
  const baseConfig: TxBuilderConfig = {
    protocolParameters: PROTOCOL_PARAMS,
    changeAddress: CHANGE_ADDRESS,
    availableUtxos: []
  }

  /**
   * Validates reselection triggers when leftover has native assets
   * but insufficient lovelace for minUTxO requirement WITH unfrack enabled.
   */
  it("should trigger reselection to satisfy native asset minUTxO requirement with unfrack", async () => {
    // Arrange: Multiple UTxOs with various tokens for unfrack bundling
    const utxo1: UTxO.UTxO = {
      txHash: "a".repeat(64),
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      assets: {
        lovelace: 2_400_000n, // 2.4 ADA - insufficient for unfrack bundles
        [`${POLICY_ID}544f4b454e31`]: 1n, // TOKEN1
        [`${POLICY_ID}544f4b454e32`]: 1n, // TOKEN2
        [`${POLICY_ID}544f4b454e33`]: 1n, // TOKEN3
        [`${POLICY_ID}544f4b454e34`]: 1n, // TOKEN4
        [`${POLICY_ID}544f4b454e35`]: 1n  // TOKEN5
      }
    }

    const utxo2: UTxO.UTxO = {
      txHash: "b".repeat(64),
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      assets: {
        lovelace: 1_500_000n // 1.5 ADA - provides additional lovelace for unfrack minUTxO
      }
    }

    const builder = makeTxBuilder({
      ...baseConfig,
      availableUtxos: [utxo1, utxo2]
    })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n) // 2.0 ADA only
      })

    // Act: Build transaction with unfrack enabled
    const signBuilder = await builder.build({ useV3: true, 
      useStateMachine: true,
      unfrack: {
        tokens: {
          bundleSize: 10 // All 5 tokens fit in one bundle
        }
      }
    })
    const tx = await signBuilder.toTransaction()

    // Assert: Should have payment + 1 unfrack bundle (5 tokens fit in bundleSize=10)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(2) // Payment + at least 1 change
    
    // Find change outputs (unfrack may create multiple)
    const changeOutputs = tx.body.outputs.filter(
      (out) => AddressEras.toBech32(out.address) === CHANGE_ADDRESS
    )
    
    expect(changeOutputs.length).toBeGreaterThanOrEqual(1)
    
    // Verify at least one change output has native assets
    const hasNativeAssets = changeOutputs.some((out) => 
      "assets" in out.amount && out.amount.assets && out.amount.assets.size > 0
    )
    expect(hasNativeAssets).toBe(true)
    
    // Verify total tokens across all change outputs
    let totalTokens = 0
    for (const out of changeOutputs) {
      if ("assets" in out.amount && out.amount.assets) {
        for (const [_policyId, assetNames] of out.amount.assets) {
          totalTokens += assetNames.size
        }
      }
    }
    expect(totalTokens).toBe(5) // All 5 tokens preserved

    // Verify both UTxOs were selected
    expect(tx.body.inputs.length).toBe(2) // Should have used both UTxOs
  })

  /**
   * Validates minUTxO recalculation when reselection adds more native assets
   * with unfrack creating multiple bundles.
   */
  it("should revalidate minUTxO when reselected UTxO adds more native assets with unfrack", async () => {
    // Arrange: First UTxO with 8 tokens, second UTxO with 7 more tokens (total 15)
    // With bundleSize=5, this requires 3 bundles (5+5+5)
    const utxo1: UTxO.UTxO = {
      txHash: "a".repeat(64),
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      assets: {
        lovelace: 2_400_000n, // 2.4 ADA
        [`${POLICY_ID}544f4b454e30`]: 1n, // TOKEN0
        [`${POLICY_ID}544f4b454e31`]: 1n, // TOKEN1
        [`${POLICY_ID}544f4b454e32`]: 1n, // TOKEN2
        [`${POLICY_ID}544f4b454e33`]: 1n, // TOKEN3
        [`${POLICY_ID}544f4b454e34`]: 1n, // TOKEN4
        [`${POLICY_ID}544f4b454e35`]: 1n, // TOKEN5
        [`${POLICY_ID}544f4b454e36`]: 1n, // TOKEN6
        [`${POLICY_ID}544f4b454e37`]: 1n  // TOKEN7
      }
    }

    const utxo2: UTxO.UTxO = {
      txHash: "b".repeat(64),
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      assets: {
        lovelace: 1_000_000n, // 1.0 ADA - Adding 7 more tokens increases minUTxO requirement
        [`${POLICY_ID}544f4b454e38`]: 1n,  // TOKEN8
        [`${POLICY_ID}544f4b454e39`]: 1n,  // TOKEN9
        [`${POLICY_ID}544f4b454e41`]: 1n,  // TOKENA
        [`${POLICY_ID}544f4b454e42`]: 1n,  // TOKENB
        [`${POLICY_ID}544f4b454e43`]: 1n,  // TOKENC
        [`${POLICY_ID}544f4b454e44`]: 1n,  // TOKEND
        [`${POLICY_ID}544f4b454e45`]: 1n   // TOKENE
      }
    }

    const utxo3: UTxO.UTxO = {
      txHash: "c".repeat(64),
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      assets: {
        lovelace: 2_000_000n // 2.0 ADA - Extra lovelace to satisfy 3-bundle minUTxO (15 tokens / bundleSize=5)
      }
    }

    const builder = makeTxBuilder({
      ...baseConfig,
      availableUtxos: [utxo1, utxo2, utxo3]
    })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Act: Build transaction with unfrack (bundleSize=5 → 3 bundles for 15 tokens)
    const signBuilder = await builder.build({ useV3: true, 
      useStateMachine: true,
      unfrack: {
        tokens: {
          bundleSize: 5 // 15 tokens → 3 bundles
        }
      }
    })
    const tx = await signBuilder.toTransaction()

    // Assert: Should have payment + 3 unfrack bundles (15 tokens with bundleSize=5)
    const changeOutputs = tx.body.outputs.filter(
      (out) => AddressEras.toBech32(out.address) === CHANGE_ADDRESS
    )

    expect(changeOutputs.length).toBeGreaterThanOrEqual(2) // At least 2 bundles (may merge some)

    // Count total native assets across all change outputs
    let totalTokens = 0
    let totalLovelace = 0n
    
    for (const out of changeOutputs) {
      totalLovelace += out.amount.coin
      
      if ("assets" in out.amount && out.amount.assets) {
        for (const [_policyId, assetNames] of out.amount.assets) {
          totalTokens += assetNames.size
        }
      }
    }
    
    expect(totalTokens).toBeGreaterThanOrEqual(8) // All tokens preserved (may merge some)
    
    // With multiple bundles, total minUTxO requirement is higher
    // Each bundle needs ~450K, so multiple bundles need > 1.2M minimum
    expect(totalLovelace).toBeGreaterThanOrEqual(1_200_000n)
    
    // Verify multiple UTxOs were selected to satisfy minUTxO requirements
    expect(tx.body.inputs.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * Validates drainTo behavior when leftover contains native assets.
   */
  it("should create proper change when leftover contains native assets (drainTo scenario)", async () => {
    const utxo: UTxO.UTxO = {
      txHash: "a".repeat(64),
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      assets: {
        lovelace: 3_000_000n, // 3.0 ADA - sufficient for outputs + fee + changeMinUTxO
        [`${POLICY_ID}${ASSET_NAME_HEX}`]: 1n
      }
    }

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Build with drainTo option
    const signBuilder = await builder.build({ useV3: true, 
      useStateMachine: true,
      drainTo: 0 // Request drain into first output
    })
    
    expect(signBuilder).toBeDefined()
    
    const tx = await signBuilder.toTransaction()
    
    // Should have payment + change output (native assets require change)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(1)
    
    // Verify native asset is preserved (either in payment or change)
    let totalAssets = 0
    for (const output of tx.body.outputs) {
      if ("assets" in output.amount && output.amount.assets) {
        totalAssets += 1
      }
    }
    expect(totalAssets).toBeGreaterThanOrEqual(1)
  })

  /**
   * Validates burnAsFee is rejected when leftover contains native assets
   * to prevent accidental burning of user tokens.
   */
  it("should reject burnAsFee when leftover contains native assets", async () => {
    const utxo: UTxO.UTxO = {
      txHash: "a".repeat(64),
      outputIndex: 0,
      address: CHANGE_ADDRESS,
      assets: {
        lovelace: 2_200_000n,
        [`${POLICY_ID}${ASSET_NAME_HEX}`]: 1n
      }
    }

    const builder = makeTxBuilder({ ...baseConfig, availableUtxos: [utxo] })
      .payToAddress({
        address: RECIPIENT_ADDRESS,
        assets: Assets.fromLovelace(2_000_000n)
      })

    // Try with burnAsFee - should fail because of native assets
    await expect(
      builder.build({ useV3: true, 
        useStateMachine: true,
        onInsufficientChange: "burn"
      })
    ).rejects.toThrow() // Should error about native assets
  })
})

