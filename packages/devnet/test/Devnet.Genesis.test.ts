import { describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import { afterAll, beforeAll } from "vitest"

/**
 * Tests for Devnet.Genesis module
 * Verifies that calculated genesis UTxOs match actual chain UTxOs
 */
describe("Devnet.Genesis", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis

  beforeAll(async () => {
    const testAddressHex =
      "00813c32c92aad21770ff8001de0918f598df8c06775f77f8e8839d2a0074a515f7f32bf31a4f41c7417a8136e8152bfb42f06d71b389a6896"

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      initialFunds: { [testAddressHex]: 900_000_000_000 }
    }

    devnetCluster = await Cluster.make({
      clusterName: "genesis-utxo-calculation-test",
      ports: { node: 6002, submit: 9003 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: false },
      ogmios: { enabled: false }
    })

    await Cluster.start(devnetCluster)
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      try {
        await Cluster.stop(devnetCluster)
        await Cluster.remove(devnetCluster)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to stop devnet:", error)
      }
    }
  }, 60_000)

  it("should calculate genesis UTxOs from config", { timeout: 10_000 }, async () => {
    const utxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    expect(utxos).toBeDefined()
    expect(utxos.length).toBe(1)

    const utxo = utxos[0]
    expect(utxo.transactionId).toBeDefined()
    expect(Cardano.TransactionHash.toHex(utxo.transactionId).length).toBe(64)
    expect(utxo.index).toBe(0n)
    expect(CoreAddress.toBech32(utxo.address)).toMatch(/^addr_test/)
    expect(utxo.assets).toBeDefined()
  })

  it("should query genesis UTxOs from node", { timeout: 30_000 }, async () => {
    if (!devnetCluster) throw new Error("Devnet not initialized")

    const utxos = await Genesis.queryUtxos(devnetCluster)

    expect(utxos).toBeDefined()
    expect(utxos.length).toBe(1)

    const utxo = utxos[0]
    expect(utxo.transactionId).toBeDefined()
    expect(Cardano.TransactionHash.toHex(utxo.transactionId).length).toBe(64)
    expect(utxo.index).toBe(0n)
    expect(CoreAddress.toBech32(utxo.address)).toMatch(/^addr_test/)
    expect(utxo.assets).toBeDefined()
  })

  it("should match: calculated === queried", { timeout: 30_000 }, async () => {
    if (!devnetCluster) throw new Error("Devnet not initialized")

    const calculated = await Genesis.calculateUtxosFromConfig(genesisConfig)
    const queried = await Genesis.queryUtxos(devnetCluster)

    expect(calculated.length).toBe(queried.length)

    for (let i = 0; i < calculated.length; i++) {
      expect(Cardano.TransactionHash.toHex(calculated[i].transactionId)).toBe(
        Cardano.TransactionHash.toHex(queried[i].transactionId)
      )
      expect(calculated[i].index).toBe(queried[i].index)
      expect(CoreAddress.toBech32(calculated[i].address)).toBe(CoreAddress.toBech32(queried[i].address))
      expect(calculated[i].assets.lovelace).toEqual(queried[i].assets.lovelace)
    }
  })

  it("should be deterministic", { timeout: 10_000 }, async () => {
    const result1 = await Genesis.calculateUtxosFromConfig(genesisConfig)
    const result2 = await Genesis.calculateUtxosFromConfig(genesisConfig)
    const result3 = await Genesis.calculateUtxosFromConfig(genesisConfig)

    expect(result1).toEqual(result2)
    expect(result2).toEqual(result3)
  })

  it("should handle multiple funded addresses", { timeout: 10_000 }, async () => {
    const multiConfig: Config.ShelleyGenesis = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      initialFunds: {
        "00813c32c92aad21770ff8001de0918f598df8c06775f77f8e8839d2a0074a515f7f32bf31a4f41c7417a8136e8152bfb42f06d71b389a6896": 900_000_000_000,
        "0025da24fb5388c16f34c89f5bf92d35cf9d6afcd0f64bd3c9c7ec5a0b074a515f7f32bf31a4f41c7417a8136e8152bfb42f06d71b389a6896": 500_000_000_000,
        "01c8c47610a36034aac6fc58848bdae5c278d994ff502c05455e3b3ee8f8ed3a0eea0ef835ffa7bbfcde55f7fe9d2cc5d55ea62cecb42bab3c": 100_000_000_000
      }
    }

    const utxos = await Genesis.calculateUtxosFromConfig(multiConfig)

    expect(utxos.length).toBe(3)

    // Each genesis UTxO has index 0n
    expect(utxos[0].index).toBe(0n)
    expect(utxos[1].index).toBe(0n)
    expect(utxos[2].index).toBe(0n)

    // Each address gets unique pseudo-TxId
    const txHash0 = Cardano.TransactionHash.toHex(utxos[0].transactionId)
    const txHash1 = Cardano.TransactionHash.toHex(utxos[1].transactionId)
    const txHash2 = Cardano.TransactionHash.toHex(utxos[2].transactionId)
    expect(txHash0).not.toBe(txHash1)
    expect(txHash1).not.toBe(txHash2)
    expect(txHash0).not.toBe(txHash2)
  })
})
