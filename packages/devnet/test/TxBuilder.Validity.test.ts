/**
 * Devnet tests for TxBuilder validity interval (setValidity).
 *
 * Tests the setValidity operation which sets transaction validity bounds:
 * - `from`: Transaction valid after this Unix time (validityIntervalStart slot)
 * - `to`: Transaction expires after this Unix time (ttl slot)
 *
 * Test scenarios:
 * 1. Build and submit a transaction with only TTL (to)
 * 2. Build and submit a transaction with both bounds (from + to)
 * 3. Verify expired transaction is rejected
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"

// Alias for readability
const Time = Cardano.Time

describe("TxBuilder Validity Interval", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  // Creates a client with correct slot config for devnet
  const createTestClient = (accountIndex: number = 0) => {
    if (!devnetCluster) throw new Error("Cluster not initialized")
    const slotConfig = Cluster.getSlotConfig(devnetCluster)
    return createClient({
      network: 0,
      slotConfig,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1448",
        ogmiosUrl: "http://localhost:1343"
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
    // Create a minimal client just to get the address (before cluster is ready)
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
      clusterName: "validity-test",
      ports: { node: 6006, submit: 9007 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1448, logLevel: "Info" },
      ogmios: { enabled: true, port: 1343, logLevel: "info" }
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

  it("should build and submit transaction with TTL", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const myAddress = await client.address()

    // Set TTL to 5 minutes from now
    const ttl = Time.now() + 300_000n

    const signBuilder = await client
      .newTx()
      .setValidity({ to: ttl })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const tx = await signBuilder.toTransaction()

    // Verify TTL is set in transaction body and converted to a slot number
    expect(tx.body.ttl).toBeDefined()
    expect(typeof tx.body.ttl).toBe("bigint")
    expect(tx.body.ttl! > 0n).toBe(true)
    expect(tx.body.validityIntervalStart).toBeUndefined()

    // Submit and confirm
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should build and submit transaction with both validity bounds", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const myAddress = await client.address()

    // Valid from now until 5 minutes from now
    const from = Time.now()
    const to = Time.now() + 300_000n

    const signBuilder = await client
      .newTx()
      .setValidity({ from, to })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    // Verify both bounds are set as slot numbers
    expect(tx.body.ttl).toBeDefined()
    expect(typeof tx.body.ttl).toBe("bigint")
    expect(tx.body.ttl! > 0n).toBe(true)

    expect(tx.body.validityIntervalStart).toBeDefined()
    expect(typeof tx.body.validityIntervalStart).toBe("bigint")
    expect(tx.body.validityIntervalStart! > 0n).toBe(true)

    // TTL should be after validity start
    expect(tx.body.ttl! > tx.body.validityIntervalStart!).toBe(true)

    // Submit and confirm
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should reject expired transaction", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const myAddress = await client.address()

    // Set TTL to 1 second ago (already expired)
    const expiredTtl = Time.now() - 1_000n

    const signBuilder = await client
      .newTx()
      .setValidity({ to: expiredTtl })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const submitBuilder = await signBuilder.sign()

    // Submission should fail due to expired TTL
    await expect(submitBuilder.submit()).rejects.toThrow()
  })

  it("should reject transaction before validity start", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const myAddress = await client.address()

    // Valid starting 5 minutes from now (not valid yet)
    const from = Time.now() + 300_000n
    const to = Time.now() + 600_000n

    const signBuilder = await client
      .newTx()
      .setValidity({ from, to })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const submitBuilder = await signBuilder.sign()

    // Submission should fail because tx is not valid yet
    await expect(submitBuilder.submit()).rejects.toThrow()
  })
})
