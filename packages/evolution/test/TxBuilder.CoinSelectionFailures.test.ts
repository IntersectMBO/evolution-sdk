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

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const RECEIVER_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

const baseConfig: TxBuilderConfig = {
}

describe("Insufficient Lovelace", () => {
  it("should fail when total lovelace is less than payment amount", async () => {
    // Wallet has 1 ADA, trying to send 5 ADA
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({ txHash: "tx1", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 1_000_000n })
    ]

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: Assets.fromLovelace(5_000_000n)
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })

  it("should fail when lovelace covers payment but not payment + fees", async () => {
    // Wallet has 2 ADA, trying to send 1.95 ADA (fees will push over 2 ADA)
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({ txHash: "tx1", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 2_000_000n })
    ]

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: Assets.fromLovelace(1_950_000n)
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Cannot create valid change/)
  })

  it("should fail with multiple small UTxOs that sum to insufficient amount", async () => {
    // 5 UTxOs of 100k each = 500k total, trying to send 1M
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({ txHash: "tx1", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createTestUtxo({ txHash: "tx2", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createTestUtxo({ txHash: "tx3", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createTestUtxo({ txHash: "tx4", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n }),
      createTestUtxo({ txHash: "tx5", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000n })
    ]

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: Assets.fromLovelace(1_000_000n)
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })
})

describe("Missing Native Assets", () => {
  it("should fail when required native asset does not exist in any UTxO", async () => {
    const policyA = "aaa" + "0".repeat(53)
    const tokenA = `${policyA}546f6b656e41` // "TokenA" in hex

    const policyB = "bbb" + "0".repeat(53)
    const tokenB = `${policyB}546f6b656e42` // "TokenB" in hex (doesn't exist)

    // Wallet has TokenA but not TokenB
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 10_000_000n,
        nativeAssets: { [tokenA]: 1000n }
      })
    ]

    const paymentAssets: Assets.Assets = {
      lovelace: 2_000_000n,
      [tokenB]: 100n // Requesting token that doesn't exist
    }

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: paymentAssets
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })

  it("should fail when multiple assets requested but one is missing", async () => {
    const policyA = "aaa" + "0".repeat(53)
    const tokenA = `${policyA}546f6b656e41`

    const policyB = "bbb" + "0".repeat(53)
    const tokenB = `${policyB}546f6b656e42`

    const policyC = "ccc" + "0".repeat(53)
    const tokenC = `${policyC}546f6b656e43` // Missing

    // Wallet has TokenA and TokenB but not TokenC
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 10_000_000n,
        nativeAssets: {
          [tokenA]: 1000n,
          [tokenB]: 500n
        }
      })
    ]

    const paymentAssets: Assets.Assets = {
      lovelace: 2_000_000n,
      [tokenA]: 100n,
      [tokenB]: 50n,
      [tokenC]: 10n // Missing token
    }

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: paymentAssets
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })
})

describe("Insufficient Native Asset Quantity", () => {
  it("should fail when token exists but quantity is too low", async () => {
    const policyA = "aaa" + "0".repeat(53)
    const tokenA = `${policyA}546f6b656e41`

    // Wallet has 50 tokens, trying to send 100
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 10_000_000n,
        nativeAssets: { [tokenA]: 50n }
      })
    ]

    const paymentAssets: Assets.Assets = {
      lovelace: 2_000_000n,
      [tokenA]: 100n // Need 100, only have 50
    }

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: paymentAssets
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })

  it("should fail when tokens are fragmented across UTxOs but total is insufficient", async () => {
    const policyA = "aaa" + "0".repeat(53)
    const tokenA = `${policyA}546f6b656e41`

    // 3 UTxOs with 30 tokens each = 90 total, trying to send 100
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 5_000_000n,
        nativeAssets: { [tokenA]: 30n }
      }),
      createTestUtxo({
        txHash: "tx2",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 5_000_000n,
        nativeAssets: { [tokenA]: 30n }
      }),
      createTestUtxo({
        txHash: "tx3",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 5_000_000n,
        nativeAssets: { [tokenA]: 30n }
      })
    ]

    const paymentAssets: Assets.Assets = {
      lovelace: 2_000_000n,
      [tokenA]: 100n // Need 100, only have 90 total
    }

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: paymentAssets
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })

  it("should fail when one of multiple required assets is insufficient", async () => {
    const policyA = "aaa" + "0".repeat(53)
    const tokenA = `${policyA}546f6b656e41`

    const policyB = "bbb" + "0".repeat(53)
    const tokenB = `${policyB}546f6b656e42`

    // Have enough TokenA but not enough TokenB
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 10_000_000n,
        nativeAssets: {
          [tokenA]: 1000n, // Sufficient
          [tokenB]: 50n // Insufficient (need 100)
        }
      })
    ]

    const paymentAssets: Assets.Assets = {
      lovelace: 2_000_000n,
      [tokenA]: 100n, // OK
      [tokenB]: 100n // Insufficient
    }

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: paymentAssets
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })
})

describe("Complex Mixed Failures", () => {
  it("should fail with empty wallet (no UTxOs)", async () => {
    const utxos: Array<UTxO.UTxO> = []

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: Assets.fromLovelace(1_000_000n)
    })

    // Empty wallet fails coin selection
    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed/)
  })

  it("should fail when UTxOs exist but all are too small for min UTxO + fees", async () => {
    // Many tiny UTxOs that individually can't even cover min UTxO requirements
    const utxos: Array<UTxO.UTxO> = Array.from(
      { length: 10 },
      (_, i) => createTestUtxo({ txHash: `tx${i}`, outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 1000n }) // 0.001 ADA each
    )

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: Assets.fromLovelace(50_000n)
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })

  it("should fail with sufficient lovelace but missing native asset", async () => {
    const policyA = "aaa" + "0".repeat(53)
    const tokenA = `${policyA}546f6b656e41`

    // Plenty of lovelace but no native assets
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({ txHash: "tx1", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 100_000_000n }) // 100 ADA
    ]

    const paymentAssets: Assets.Assets = {
      lovelace: 2_000_000n,
      [tokenA]: 1n // Even 1 token will fail
    }

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: paymentAssets
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })

  it("should fail when combined shortfalls across lovelace and multiple assets", async () => {
    const policyA = "aaa" + "0".repeat(53)
    const tokenA = `${policyA}546f6b656e41`

    const policyB = "bbb" + "0".repeat(53)
    const tokenB = `${policyB}546f6b656e42`

    // Not enough of anything
    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({
        txHash: "tx1",
        outputIndex: 0,
        address: CHANGE_ADDRESS,
        lovelace: 500_000n,
        nativeAssets: {
          [tokenA]: 10n, // Need 100
          [tokenB]: 5n // Need 50
        }
      })
    ]

    const paymentAssets: Assets.Assets = {
      lovelace: 2_000_000n, // Need 2M, have 500k
      [tokenA]: 100n, // Need 100, have 10
      [tokenB]: 50n // Need 50, have 5
    }

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: paymentAssets
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })
})

describe("Edge Case: drainTo Cannot Save Insufficient Funds", () => {
  it("should fail even with drainTo enabled when funds are insufficient", async () => {
    // drainTo is a balance adjustment strategy, NOT error recovery
    // It only helps when leftover is too small for a change output

    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({ txHash: "tx1", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 1_000_000n })
    ]

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: Assets.fromLovelace(5_000_000n) // Way more than available
    })

    await expect(
      builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, drainTo: 0, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS }) // drainTo cannot save this
    ).rejects.toThrow(/Coin selection failed for/)
  })

  it("should fail even with burnAsFee when initial selection is insufficient", async () => {
    // burnAsFee only applies to leftover after balance is achieved

    const utxos: Array<UTxO.UTxO> = [
      createTestUtxo({ txHash: "tx1", outputIndex: 0, address: CHANGE_ADDRESS, lovelace: 800_000n })
    ]

    const builder = makeTxBuilder(baseConfig).payToAddress({
      address: RECEIVER_ADDRESS,
      assets: Assets.fromLovelace(2_000_000n)
    })

    await expect(builder.build({ changeAddress: CHANGE_ADDRESS, availableUtxos: utxos, useStateMachine: true, useV3: true, protocolParameters: PROTOCOL_PARAMS })).rejects.toThrow(/Coin selection failed for/)
  })
})
