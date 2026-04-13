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

import { beforeAll, describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import { inject } from "vitest"

import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

// Alias for readability
const Time = Cardano.UnixTime

describe("TxBuilder Validity Interval", () => {
  let shared: SharedClusterResult

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [26])
  })

  it("should build and submit transaction with TTL", { timeout: 60_000 }, async () => {
    const client = shared.makeClient(26)
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
      .build({ availableUtxos: [...shared.genesisUtxos] })

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
    const client = shared.makeClient(26)
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
    const client = shared.makeClient(26)
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
      .build({ availableUtxos: [...shared.genesisUtxos] })

    const submitBuilder = await signBuilder.sign()

    // Submission should fail due to expired TTL
    await expect(submitBuilder.submit()).rejects.toThrow()
  })

  it("should reject transaction before validity start", { timeout: 60_000 }, async () => {
    const client = shared.makeClient(26)
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
      .build({ availableUtxos: [...shared.genesisUtxos] })

    const submitBuilder = await signBuilder.sign()

    // Submission should fail because tx is not valid yet
    await expect(submitBuilder.submit()).rejects.toThrow()
  })
})
