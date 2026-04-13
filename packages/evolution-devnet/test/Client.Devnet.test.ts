import { beforeAll, describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import { inject } from "vitest"
import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

// Alias for Cardano.Assets
const CoreAssets = Cardano.Assets

/**
 * Client integration tests with local Devnet
 */
describe("Client with Devnet", () => {
  let shared: SharedClusterResult

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [0])
  }, 180_000)

  it("should verify genesis UTxOs have expected shape", { timeout: 10_000 }, async () => {
    expect(shared.genesisUtxos).toBeDefined()
    expect(shared.genesisUtxos.length).toBe(1)

    const utxo = shared.genesisUtxos[0]
    expect(utxo.transactionId).toBeDefined()
    expect(Cardano.TransactionHash.toHex(utxo.transactionId).length).toBe(64)
    expect(utxo.index).toBeDefined()
    expect(CoreAddress.toBech32(utxo.address)).toMatch(/^addr_test/)
    expect(utxo.assets.lovelace).toBeGreaterThan(0n)
  })

  it("should create signing client and query wallet address", { timeout: 30_000 }, async () => {
    const client = shared.makeClient(0)

    const address = await client.address()
    expect(address).toBeDefined()
    const addressBech32 = CoreAddress.toBech32(address)
    expect(addressBech32).toMatch(/^addr_test/)
  })

  it("should query wallet UTxOs", { timeout: 30_000 }, async () => {
    const client = shared.makeClient(0)

    const utxos = await client.getWalletUtxos()
    expect(utxos).toEqual([])
  })

  it("should query protocol parameters", { timeout: 10_000 }, async () => {
    const client = shared.makeClient(0)
    const params = await client.getProtocolParameters()

    expect(params).toBeDefined()
    expect(params.minFeeA).toBeGreaterThan(0)
    expect(params.minFeeB).toBeGreaterThan(0)
    expect(params.coinsPerUtxoByte).toBeGreaterThan(0n)
    expect(params.maxTxSize).toBeGreaterThan(0)

    // eslint-disable-next-line no-console
    console.log(`✓ Protocol parameters: minFeeA=${params.minFeeA}, maxTxSize=${params.maxTxSize}`)
  })

  it("should build and submit transaction", { timeout: 30_000 }, async () => {
    const genesisUtxos = shared.genesisUtxos
    if (genesisUtxos.length === 0) {
      throw new Error("Genesis UTxOs not loaded")
    }

    const client = shared.makeClient(0)
    const genesisAddress = await client.address()
    const genesisAddressBech32 = CoreAddress.toBech32(genesisAddress)
    const genesisUtxo = genesisUtxos.find((u) => CoreAddress.toBech32(u.address) === genesisAddressBech32)

    if (!genesisUtxo) {
      throw new Error("Genesis UTxO not found")
    }

    const receiverAddress =
      "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

    const signBuilder = await client
      .newTx()
      .payToAddress({ address: CoreAddress.fromBech32(receiverAddress), assets: CoreAssets.fromLovelace(5_000_000n) })
      .build({ availableUtxos: [genesisUtxo] })

    const tx = await signBuilder.toTransaction()
    expect(tx.body.inputs.length).toBeGreaterThan(0)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(2)

    const submitBuilder = await signBuilder.sign()
    expect(submitBuilder.witnessSet.vkeyWitnesses).toBeDefined()

    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)

    const utxos = await client.getWalletUtxos()
    expect(utxos.length).toBeGreaterThan(0)

    const totalInput = genesisUtxo.assets.lovelace
    const payment = 5_000_000n
    const fee = await signBuilder.estimateFee()
    const expectedChange = totalInput - payment - fee

    const changeUtxo = utxos.find((u) => u.assets.lovelace === expectedChange)
    expect(changeUtxo).toBeDefined()
  })
})
