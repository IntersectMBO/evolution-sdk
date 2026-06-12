import { describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"

import { createNodeEmulatorSetup } from "./utils/nodeEmulator.js"

describe("TxBuilder addSigner (node-emulator)", () => {
  it("should include requiredSigners in transaction body and submit successfully", async () => {
    const { client, genesisUtxos } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

    const paymentCredential = myAddress.paymentCredential
    if (paymentCredential._tag !== "KeyHash") throw new Error("Expected KeyHash credential")

    const signBuilder = await client
      .newTx()
      .addSigner({ keyHash: paymentCredential })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const tx = await signBuilder.toTransaction()

    expect(tx.body.requiredSigners).toBeDefined()
    expect(tx.body.requiredSigners?.length).toBe(1)
    expect(tx.body.requiredSigners?.[0]._tag).toBe("KeyHash")
    expect(KeyHash.toHex(tx.body.requiredSigners![0])).toBe(KeyHash.toHex(paymentCredential))

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should support multi-sig with partial signing and assembly", async () => {
    const { client: client1, genesisUtxos } = await createNodeEmulatorSetup({ accountIndex: 0 })
    const setup2 = await createNodeEmulatorSetup({ accountIndex: 1 })
    const client2 = setup2.client

    const address1 = await client1.address()
    const address2 = await client2.address()

    const credential1 = address1.paymentCredential
    const credential2 = address2.paymentCredential
    if (credential1._tag !== "KeyHash" || credential2._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credentials")
    }

    const signBuilder = await client1
      .newTx()
      .addSigner({ keyHash: credential1 })
      .addSigner({ keyHash: credential2 })
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const tx = await signBuilder.toTransaction()

    expect(tx.body.requiredSigners).toBeDefined()
    expect(tx.body.requiredSigners?.length).toBe(2)

    const requiredHashes = tx.body.requiredSigners!.map((k) => KeyHash.toHex(k))
    expect(requiredHashes).toContain(KeyHash.toHex(credential1))
    expect(requiredHashes).toContain(KeyHash.toHex(credential2))

    const witness1 = await signBuilder.partialSign()
    expect(witness1.vkeyWitnesses?.length).toBe(1)

    const witness2 = await client2.signTx(tx)
    expect(witness2.vkeyWitnesses?.length).toBe(1)

    const submitBuilder = await signBuilder.assemble([witness1, witness2])

    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })
})
