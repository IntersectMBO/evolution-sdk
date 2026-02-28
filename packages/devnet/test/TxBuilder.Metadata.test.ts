/**
 * Devnet tests for TxBuilder attachMetadata operation.
 *
 * Tests the attachMetadata operation which adds transaction metadata
 * to the auxiliary data following CIP-10 standard labels.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import { fromEntries } from "@evolution-sdk/evolution/TransactionMetadatum"

describe("TxBuilder attachMetadata (Devnet Submit)", () => {
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
        kupoUrl: "http://localhost:1450",
        ogmiosUrl: "http://localhost:1345"
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
      clusterName: "metadata-test",
      ports: { node: 6008, submit: 9009 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1450, logLevel: "Info" },
      ogmios: { enabled: true, port: 1345, logLevel: "info" }
    })

    await Cluster.start(devnetCluster)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      await Cluster.stop(devnetCluster)
      await Cluster.remove(devnetCluster)
    }
  }, 60_000)

  it("should attach simple text metadata (CIP-20 message) and submit successfully", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const myAddress = await client.address()

    const signBuilder = await client
      .newTx()
      .attachMetadata({
        label: 674n, // CIP-20 transaction message
        metadata: "Hello from Evolution SDK!"
      })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const tx = await signBuilder.toTransaction()

    // Verify auxiliary data contains metadata
    expect(tx.auxiliaryData).toBeDefined()

    if (tx.auxiliaryData && tx.auxiliaryData._tag === "ConwayAuxiliaryData") {
      expect(tx.auxiliaryData.metadata).toBeDefined()
      expect(tx.auxiliaryData.metadata?.size).toBe(1)
      expect(tx.auxiliaryData.metadata?.has(674n)).toBe(true)

      const metadatum = tx.auxiliaryData.metadata?.get(674n)
      expect(metadatum).toBe("Hello from Evolution SDK!")
    }

    // Submit and verify confirmation
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()

    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should attach multiple metadata entries with different labels", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const myAddress = await client.address()

    const signBuilder = await client
      .newTx()
      .attachMetadata({
        label: 674n, // CIP-20 message
        metadata: "Transaction comment"
      })
      .attachMetadata({
        label: 1n, // Custom label
        metadata: 42n
      })
      .attachMetadata({
        label: 2n, // Custom label
        metadata: new Uint8Array([1, 2, 3, 4])
      })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    // Verify auxiliary data contains all metadata entries
    expect(tx.auxiliaryData).toBeDefined()

    if (tx.auxiliaryData && tx.auxiliaryData._tag === "ConwayAuxiliaryData") {
      expect(tx.auxiliaryData.metadata?.size).toBe(3)
      expect(tx.auxiliaryData.metadata?.has(674n)).toBe(true)
      expect(tx.auxiliaryData.metadata?.has(1n)).toBe(true)
      expect(tx.auxiliaryData.metadata?.has(2n)).toBe(true)

      expect(tx.auxiliaryData.metadata?.get(674n)).toBe("Transaction comment")
      expect(tx.auxiliaryData.metadata?.get(1n)).toBe(42n)

      const bytesMetadata = tx.auxiliaryData.metadata?.get(2n) as Uint8Array
      expect(bytesMetadata).toBeInstanceOf(Uint8Array)
      expect(Array.from(bytesMetadata)).toEqual([1, 2, 3, 4])
    }

    // Submit and verify confirmation
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()

    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should attach complex NFT-like metadata (CIP-25 style)", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const myAddress = await client.address()

    // CIP-25 style NFT metadata
    const nftMetadata = fromEntries([
      ["name", "Evolution SDK Test NFT"],
      ["image", "ipfs://QmTestHash123"],
      ["description", "A test NFT minted with Evolution SDK"],
      [
        "attributes",
        [
          fromEntries([
            ["trait_type", "Rarity"],
            ["value", "Common"]
          ]),
          fromEntries([
            ["trait_type", "Edition"],
            ["value", 1n]
          ])
        ]
      ]
    ])

    const signBuilder = await client
      .newTx()
      .attachMetadata({
        label: 721n, // CIP-25 NFT metadata
        metadata: nftMetadata
      })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    // Verify auxiliary data contains NFT metadata
    expect(tx.auxiliaryData).toBeDefined()

    if (tx.auxiliaryData && tx.auxiliaryData._tag === "ConwayAuxiliaryData") {
      expect(tx.auxiliaryData.metadata?.size).toBe(1)
      expect(tx.auxiliaryData.metadata?.has(721n)).toBe(true)

      const metadata = tx.auxiliaryData.metadata?.get(721n)
      expect(metadata).toBeInstanceOf(Map)

      if (metadata instanceof Map) {
        expect(metadata.get("name")).toBe("Evolution SDK Test NFT")
        expect(metadata.get("image")).toBe("ipfs://QmTestHash123")

        const attributes = metadata.get("attributes")
        expect(Array.isArray(attributes)).toBe(true)
        if (Array.isArray(attributes)) {
          expect(attributes.length).toBe(2)
          expect(attributes[0]).toBeInstanceOf(Map)
        }
      }
    }

    // Submit and verify confirmation
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()

    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })
})
