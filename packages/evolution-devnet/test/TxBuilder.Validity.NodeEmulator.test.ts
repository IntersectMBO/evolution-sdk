import { describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"

import { createNodeEmulatorSetup } from "./utils/nodeEmulator.js"

const Time = Cardano.Time

describe("TxBuilder Validity Interval (node-emulator)", () => {
  it("should build and submit transaction with TTL", async () => {
    const { client, genesisUtxos } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

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

    expect(tx.body.ttl).toBeDefined()
    expect(typeof tx.body.ttl).toBe("bigint")
    expect(tx.body.ttl! > 0n).toBe(true)
    expect(tx.body.validityIntervalStart).toBeUndefined()

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should build and submit transaction with both validity bounds", async () => {
    const { client } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

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

    expect(tx.body.ttl).toBeDefined()
    expect(tx.body.ttl! > 0n).toBe(true)
    expect(tx.body.validityIntervalStart).toBeDefined()
    expect(tx.body.validityIntervalStart! > 0n).toBe(true)
    expect(tx.body.ttl! > tx.body.validityIntervalStart!).toBe(true)

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should reject expired transaction", async () => {
    const { client, genesisUtxos } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

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

    await expect(submitBuilder.submit()).rejects.toThrow()
  })

  it("should reject transaction before validity start", async () => {
    const { client, genesisUtxos } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

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

    await expect(submitBuilder.submit()).rejects.toThrow()
  })
})
