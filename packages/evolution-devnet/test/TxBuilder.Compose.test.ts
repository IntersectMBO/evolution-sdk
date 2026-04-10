/**
 * Devnet tests for TxBuilder compose operation.
 *
 * Tests the compose operation which merges multiple transaction builders
 * into a single transaction, enabling modular and reusable transaction patterns.
 */

import { beforeAll, describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import { inject } from "vitest"
import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

// Alias for readability
const Time = Cardano.Time

describe("TxBuilder compose (Devnet Submit)", () => {
  let shared: SharedClusterResult

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [4, 5])
  }, 180_000)

  it("should compose payment with validity constraints", { timeout: 60_000 }, async () => {
    const client = shared.makeClient(4)
    const myAddress = await client.address()

    // Create a payment builder
    const paymentBuilder = client.newTx().payToAddress({
      address: myAddress,
      assets: Cardano.Assets.fromLovelace(5_000_000n)
    })

    // Create a validity builder
    const validityBuilder = client.newTx().setValidity({
      to: Time.now() + 300_000n
    })

    // Compose payment and validity together
    const signBuilder = await client
      .newTx()
      .compose(paymentBuilder)
      .compose(validityBuilder)
      .build({ availableUtxos: [shared.getGenesisUtxo(4)] })

    const tx = await signBuilder.toTransaction()

    // Verify validity interval is set
    expect(tx.body.ttl).toBeDefined()
    expect(tx.body.ttl).toBeGreaterThan(0n)

    // Submit and confirm
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should compose multiple payment builders to different addresses", { timeout: 60_000 }, async () => {
    const client1 = shared.makeClient(4)
    const client2 = shared.makeClient(5)

    const address1 = await client1.address()
    const address2 = await client2.address()

    // Create separate payment builders for different addresses
    const payment1 = client1.newTx().payToAddress({
      address: address1,
      assets: Cardano.Assets.fromLovelace(3_000_000n)
    })

    const payment2 = client1.newTx().payToAddress({
      address: address2,
      assets: Cardano.Assets.fromLovelace(2_000_000n)
    })

    const payment3 = client1.newTx().payToAddress({
      address: address1,
      assets: Cardano.Assets.fromLovelace(4_000_000n)
    })

    // Compose all payments into single transaction
    const signBuilder = await client1.newTx().compose(payment1).compose(payment2).compose(payment3).build()

    const tx = await signBuilder.toTransaction()

    // Should have at least 3 payment outputs (plus change)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(3)

    // Submit and confirm
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should compose builder with addSigner + metadata + payment", { timeout: 60_000 }, async () => {
    const client = shared.makeClient(4)
    const myAddress = await client.address()

    // Extract payment credential
    const paymentCredential = myAddress.paymentCredential
    if (paymentCredential._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credential")
    }

    // Create modular builders
    const signerBuilder = client.newTx().addSigner({ keyHash: paymentCredential })

    const metadataBuilder = client.newTx().attachMetadata({
      label: 674n,
      metadata: "Multi-sig transaction"
    })

    const paymentBuilder = client.newTx().payToAddress({
      address: myAddress,
      assets: Cardano.Assets.fromLovelace(6_000_000n)
    })

    // Compose all together
    const signBuilder = await client
      .newTx()
      .compose(signerBuilder)
      .compose(metadataBuilder)
      .compose(paymentBuilder)
      .build()

    const tx = await signBuilder.toTransaction()

    // Verify all components
    expect(tx.body.requiredSigners?.length).toBe(1)
    expect(tx.auxiliaryData).toBeDefined()
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(1)

    // Submit and confirm
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should compose stake registration with payment and metadata", { timeout: 90_000 }, async () => {
    const client = shared.makeClient(4)
    const myAddress = await client.address()

    // Get stake credential from address
    if (!("stakingCredential" in myAddress) || !myAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }

    const stakeCredential = myAddress.stakingCredential

    // Create separate builders for each operation
    const stakeBuilder = client.newTx().registerStake({ stakeCredential })

    const paymentBuilder = client.newTx().payToAddress({
      address: myAddress,
      assets: Cardano.Assets.fromLovelace(10_000_000n)
    })

    const metadataBuilder = client.newTx().attachMetadata({
      label: 674n,
      metadata: "Stake registration transaction"
    })

    // Compose all operations together
    const signBuilder = await client
      .newTx()
      .compose(stakeBuilder)
      .compose(paymentBuilder)
      .compose(metadataBuilder)
      .build()

    const tx = await signBuilder.toTransaction()

    // Verify all components
    expect(tx.body.certificates).toBeDefined()
    expect(tx.body.certificates?.length).toBe(1)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(1)
    expect(tx.auxiliaryData).toBeDefined()

    // Submit and confirm
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should verify getPrograms returns accumulated operations", { timeout: 30_000 }, async () => {
    const client = shared.makeClient(4)
    const myAddress = await client.address()

    // Build a transaction with multiple operations
    const builder = client
      .newTx()
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(1_000_000n)
      })
      .attachMetadata({
        label: 1n,
        metadata: "Test"
      })

    // Get programs snapshot
    const programs = builder.getPrograms()

    // Should have 2 programs (payToAddress + attachMetadata)
    expect(programs.length).toBe(2)
    expect(Array.isArray(programs)).toBe(true)

    // Add another operation
    builder.payToAddress({
      address: myAddress,
      assets: Cardano.Assets.fromLovelace(2_000_000n)
    })

    // Get programs again - should have 3 now
    const programs2 = builder.getPrograms()
    expect(programs2.length).toBe(3)

    // Original snapshot should still be 2 (immutable)
    expect(programs.length).toBe(2)
  })

  it("should compose builders created from different clients", { timeout: 60_000 }, async () => {
    const client1 = shared.makeClient(4)
    const client2 = shared.makeClient(5)

    const address1 = await client1.address()
    const address2 = await client2.address()

    // Create builders from different clients
    const builder1 = client1.newTx().payToAddress({
      address: address1,
      assets: Cardano.Assets.fromLovelace(5_000_000n)
    })

    const builder2 = client2.newTx().attachMetadata({
      label: 42n,
      metadata: "Cross-client composition"
    })

    // Compose them together using client1
    const signBuilder = await client1
      .newTx()
      .compose(builder1)
      .compose(builder2)
      .payToAddress({
        address: address2,
        assets: Cardano.Assets.fromLovelace(3_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    // Verify combined operations
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(2)
    expect(tx.auxiliaryData).toBeDefined()

    // Submit and confirm
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })
})
