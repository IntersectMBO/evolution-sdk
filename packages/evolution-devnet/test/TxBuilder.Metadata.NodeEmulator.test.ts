import { describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import { fromEntries } from "@evolution-sdk/evolution/TransactionMetadatum"

import { createNodeEmulatorSetup } from "./utils/nodeEmulator.js"

describe("TxBuilder attachMetadata (node-emulator)", () => {
  it("should attach simple text metadata (CIP-20 message) and submit successfully", async () => {
    const { client, genesisUtxos } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

    const signBuilder = await client
      .newTx()
      .attachMetadata({
        label: 674n,
        metadata: "Hello from Evolution SDK!"
      })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const tx = await signBuilder.toTransaction()

    expect(tx.auxiliaryData).toBeDefined()
    if (tx.auxiliaryData && tx.auxiliaryData._tag === "ConwayAuxiliaryData") {
      expect(tx.auxiliaryData.metadata?.size).toBe(1)
      expect(tx.auxiliaryData.metadata?.has(674n)).toBe(true)
      expect(tx.auxiliaryData.metadata?.get(674n)).toBe("Hello from Evolution SDK!")
    }

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should attach multiple metadata entries with different labels", async () => {
    const { client } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

    const signBuilder = await client
      .newTx()
      .attachMetadata({ label: 674n, metadata: "Transaction comment" })
      .attachMetadata({ label: 1n, metadata: 42n })
      .attachMetadata({ label: 2n, metadata: new Uint8Array([1, 2, 3, 4]) })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    expect(tx.auxiliaryData).toBeDefined()
    if (tx.auxiliaryData && tx.auxiliaryData._tag === "ConwayAuxiliaryData") {
      expect(tx.auxiliaryData.metadata?.size).toBe(3)
      expect(tx.auxiliaryData.metadata?.get(674n)).toBe("Transaction comment")
      expect(tx.auxiliaryData.metadata?.get(1n)).toBe(42n)
      const bytesMetadata = tx.auxiliaryData.metadata?.get(2n) as Uint8Array
      expect(bytesMetadata).toBeInstanceOf(Uint8Array)
      expect(Array.from(bytesMetadata)).toEqual([1, 2, 3, 4])
    }

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should attach complex NFT-like metadata (CIP-25 style)", async () => {
    const { client } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

    const nftMetadata = fromEntries([
      ["name", "Evolution SDK Test NFT"],
      ["image", "ipfs://QmTestHash123"],
      ["description", "A test NFT minted with Evolution SDK"],
      [
        "attributes",
        [
          fromEntries([["trait_type", "Rarity"], ["value", "Common"]]),
          fromEntries([["trait_type", "Edition"], ["value", 1n]])
        ]
      ]
    ])

    const signBuilder = await client
      .newTx()
      .attachMetadata({ label: 721n, metadata: nftMetadata })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    expect(tx.auxiliaryData).toBeDefined()
    if (tx.auxiliaryData && tx.auxiliaryData._tag === "ConwayAuxiliaryData") {
      expect(tx.auxiliaryData.metadata?.size).toBe(1)
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

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })
})
