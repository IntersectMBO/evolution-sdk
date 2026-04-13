import { beforeAll, describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import type { SignBuilder } from "@evolution-sdk/evolution/sdk/builders/SignBuilder"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import { inject } from "vitest"

import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

describe("TxBuilder.chainResult", () => {
  let shared: SharedClusterResult

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [3])
  })

  it("should chain multiple transactions and submit them all", { timeout: 90_000 }, async () => {
    const client = shared.makeClient(3)
    const address = await client.address()
    const TX_COUNT = 5

    // Build chained transactions using build() + chainResult
    let available = [...shared.genesisUtxos]
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
