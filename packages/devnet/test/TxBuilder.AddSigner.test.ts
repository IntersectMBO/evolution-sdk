/**
 * Devnet tests for TxBuilder addSigner operation.
 *
 * Tests the addSigner operation which adds required signers (key hashes)
 * to the transaction body's requiredSigners field.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"

describe("TxBuilder addSigner (Devnet Submit)", () => {
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
      clusterName: "addsigner-test",
      ports: { node: 6007, submit: 9008 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1449, logLevel: "Info" },
      ogmios: { enabled: true, port: 1344, logLevel: "info" }
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

  it("should include requiredSigners in transaction body and submit successfully", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const myAddress = await client.address()

    // Extract payment key hash from address credential
    const paymentCredential = myAddress.paymentCredential
    if (paymentCredential._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credential")
    }

    const signBuilder = await client
      .newTx()
      .addSigner({ keyHash: paymentCredential })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const tx = await signBuilder.toTransaction()

    // Verify requiredSigners is set
    expect(tx.body.requiredSigners).toBeDefined()
    expect(tx.body.requiredSigners?.length).toBe(1)
    expect(tx.body.requiredSigners?.[0]._tag).toBe("KeyHash")
    expect(KeyHash.toHex(tx.body.requiredSigners![0])).toBe(KeyHash.toHex(paymentCredential))

    // Submit and verify confirmation
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()

    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should support multi-sig with partial signing and assembly", { timeout: 60_000 }, async () => {
    // Create two clients with different account indices (different key pairs)
    const client1 = createTestClient(0)
    const client2 = createTestClient(1)

    const address1 = await client1.address()
    const address2 = await client2.address()

    // Extract payment key hashes from both addresses
    const credential1 = address1.paymentCredential
    const credential2 = address2.paymentCredential

    if (credential1._tag !== "KeyHash" || credential2._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credentials")
    }

    // Fetch fresh UTxOs from the provider (after first test has run)
    const freshUtxos = await client1.getUtxos(address1)

    // Build a transaction requiring BOTH signers
    // Client1 builds and pays to self, but we require both keys
    const signBuilder = await client1
      .newTx()
      .addSigner({ keyHash: credential1 })
      .addSigner({ keyHash: credential2 })
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...freshUtxos] })

    const tx = await signBuilder.toTransaction()

    // Verify both requiredSigners are set
    expect(tx.body.requiredSigners).toBeDefined()
    expect(tx.body.requiredSigners?.length).toBe(2)

    const requiredHashes = tx.body.requiredSigners!.map((k) => KeyHash.toHex(k))
    expect(requiredHashes).toContain(KeyHash.toHex(credential1))
    expect(requiredHashes).toContain(KeyHash.toHex(credential2))

    // Client1 creates a partial signature
    const witness1 = await signBuilder.partialSign()
    expect(witness1.vkeyWitnesses?.length).toBe(1)

    // Client2 signs the SAME transaction (not rebuilding it)
    // Use the client's signTx method directly with the transaction object
    const witness2 = await client2.signTx(tx)
    expect(witness2.vkeyWitnesses?.length).toBe(1)

    // Assemble both witnesses into the final transaction
    const submitBuilder = await signBuilder.assemble([witness1, witness2])

    // Submit and verify confirmation
    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })
})
