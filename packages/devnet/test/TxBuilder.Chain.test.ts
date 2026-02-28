import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import type { SignBuilder } from "@evolution-sdk/evolution/sdk/builders/SignBuilder"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"

describe("TxBuilder.chainResult", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const createTestClient = (accountIndex: number = 0) => {
    if (!devnetCluster) throw new Error("Cluster not initialized")
    const slotConfig = Cluster.getSlotConfig(devnetCluster)
    return createClient({
      network: 0,
      slotConfig,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1449",
        ogmiosUrl: "http://localhost:1344"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex,
        addressType: "Base"
      }
    })
  }

  beforeAll(async () => {
    const tempClient = createClient({
      network: 0,
      wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex: 0, addressType: "Base" }
    })

    const testAddress = await tempClient.address()
    const testAddressHex = Address.toHex(testAddress)

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: { [testAddressHex]: 500_000_000_000 }
    }

    genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    devnetCluster = await Cluster.make({
      clusterName: "chain-test",
      ports: { node: 6008, submit: 9009 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1449, logLevel: "Info" },
      ogmios: { enabled: true, port: 1344, logLevel: "info" }
    })

    await Cluster.start(devnetCluster)
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      await Cluster.stop(devnetCluster)
      await Cluster.remove(devnetCluster)
    }
  }, 60_000)

  it("should chain multiple transactions and submit them all", { timeout: 90_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()
    const TX_COUNT = 5

    // Build chained transactions using build() + chainResult
    let available = [...genesisUtxos]
    const txs: Array<SignBuilder> = []

    for (let i = 0; i < TX_COUNT; i++) {
      const tx = await client
        .newTx()
        .payToAddress({ address, assets: Cardano.Assets.fromLovelace(10_000_000n) })
        .build({ availableUtxos: available })
      txs.push(tx)
      available = [...tx.chainResult().available]
    }

    // Verify all txHashes are unique
    const txHashes = txs.map((tx) => tx.chainResult().txHash)
    expect(new Set(txHashes).size).toBe(TX_COUNT)

    // Submit all transactions
    const submittedHashes: Array<TransactionHash.TransactionHash> = []
    for (const tx of txs) {
      const hash = await tx.signAndSubmit()
      submittedHashes.push(hash)
    }

    // Verify computed hashes match submitted hashes
    for (let i = 0; i < TX_COUNT; i++) {
      expect(TransactionHash.toHex(submittedHashes[i])).toBe(txs[i].chainResult().txHash)
    }

    // Wait for all to confirm
    for (const hash of submittedHashes) {
      expect(await client.awaitTx(hash, 1000)).toBe(true)
    }
  })
})
