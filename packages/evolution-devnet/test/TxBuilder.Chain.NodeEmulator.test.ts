import "@evolution-sdk/scalus-emulator"

import { describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import * as Assets from "@evolution-sdk/evolution/Assets"
import type { SignBuilder } from "@evolution-sdk/evolution/sdk/builders/SignBuilder"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as SlotConfig from "@evolution-sdk/evolution/Time/SlotConfig"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as UTxO from "@evolution-sdk/evolution/UTxO"

const TEST_MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

/**
 * Same chain-submit test as TxBuilder.Chain.test.ts, but backed by the in-process
 * Scalus node-emulator — no docker cluster, no kupo, no ogmios.
 */
describe("TxBuilder.chainResult (node-emulator)", () => {
  it("should chain multiple transactions and submit them all", async () => {
    // Build the wallet's address first (via a no-provider client).
    const tempClient = createClient({
      network: 0,
      wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex: 0, addressType: "Base" }
    })
    const address = await tempClient.address()

    // Seed the emulator with one large UTxO for the wallet.
    const genesisTxId = TransactionHash.fromHex("00".repeat(32))
    const genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = [
      new UTxO.UTxO({
        transactionId: genesisTxId,
        index: 0n,
        address,
        assets: Assets.fromLovelace(500_000_000_000n)
      })
    ]

    const slotConfig = SlotConfig.SLOT_CONFIG_NETWORK.Preprod

    const client = createClient({
      network: 0,
      slotConfig,
      provider: {
        type: "node-emulator",
        slotConfig,
        initialUtxos: genesisUtxos
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0,
        addressType: "Base"
      }
    })

    const TX_COUNT = 5

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

    const txHashes = txs.map((tx) => tx.chainResult().txHash)
    expect(new Set(txHashes).size).toBe(TX_COUNT)

    const submittedHashes: Array<TransactionHash.TransactionHash> = []
    for (const tx of txs) {
      const hash = await tx.signAndSubmit()
      submittedHashes.push(hash)
    }

    for (let i = 0; i < TX_COUNT; i++) {
      expect(TransactionHash.toHex(submittedHashes[i])).toBe(txs[i].chainResult().txHash)
    }

    for (const hash of submittedHashes) {
      expect(await client.awaitTx(hash, 1000)).toBe(true)
    }
  })
})
