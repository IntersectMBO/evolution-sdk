/**
 * Devnet tests for TxBuilder addSigner operation.
 *
 * Tests the addSigner operation which adds required signers (key hashes)
 * to the transaction body's requiredSigners field.
 */

import { beforeAll, describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import { inject } from "vitest"
import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

describe("TxBuilder addSigner (Devnet Submit)", () => {
  let shared: SharedClusterResult

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [1, 2])
  }, 180_000)

  it("should include requiredSigners in transaction body and submit successfully", { timeout: 60_000 }, async () => {
    const client = shared.makeClient(1)
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
      .build({ availableUtxos: [...shared.genesisUtxos.filter((u) => u === shared.getGenesisUtxo(1))] })

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
    const client1 = shared.makeClient(1)
    const client2 = shared.makeClient(2)

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
