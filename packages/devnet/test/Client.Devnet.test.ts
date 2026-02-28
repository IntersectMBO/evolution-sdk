import { describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import type { ProtocolParameters } from "@evolution-sdk/evolution/sdk/ProtocolParameters"
import { afterAll, beforeAll } from "vitest"

// Alias for Cardano.Assets
const CoreAssets = Cardano.Assets

/**
 * Client integration tests with local Devnet
 */
describe("Client with Devnet", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: Array<Cardano.UTxO.UTxO> = []
  let genesisConfig: Config.ShelleyGenesis

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const createTestClient = () =>
    createClient({
      network: 0,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1443",
        ogmiosUrl: "http://localhost:1338"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0
      }
    })

  beforeAll(async () => {
    const testClient = createClient({
      network: 0,
      wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex: 0 }
    })

    const testAddress = await testClient.address()
    const testAddressHex = CoreAddress.toHex(testAddress)

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: { [testAddressHex]: 900_000_000_000 }
    }

    devnetCluster = await Cluster.make({
      clusterName: "client-kupmios-wallet-test",
      ports: { node: 6001, submit: 9002 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1443, logLevel: "Info" },
      ogmios: { enabled: true, port: 1338, logLevel: "info" }
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

  it("should calculate genesis UTxOs from config", { timeout: 10_000 }, async () => {
    const calculatedUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    expect(calculatedUtxos).toBeDefined()
    expect(calculatedUtxos.length).toBe(1)

    const utxo = calculatedUtxos[0]
    expect(utxo.transactionId).toBeDefined()
    expect(Cardano.TransactionHash.toHex(utxo.transactionId).length).toBe(64)
    expect(utxo.index).toBe(0n)
    expect(CoreAddress.toBech32(utxo.address)).toMatch(/^addr_test/)
    expect(utxo.assets.lovelace).toBe(900_000_000_000n)

    genesisUtxos = [...calculatedUtxos]
  })

  it("should create signing client and query wallet address", { timeout: 30_000 }, async () => {
    const client = createTestClient()

    const address = await client.address()
    expect(address).toBeDefined()
    const addressBech32 = CoreAddress.toBech32(address)
    expect(addressBech32).toMatch(/^addr_test/)
  })

  it("should query wallet UTxOs", { timeout: 30_000 }, async () => {
    const client = createTestClient()

    const utxos = await client.getWalletUtxos()
    expect(utxos).toEqual([])
  })

  it("should query protocol parameters", { timeout: 10_000 }, async () => {
    const client = createTestClient()
    const params: ProtocolParameters = await client.getProtocolParameters()

    expect(params).toBeDefined()
    expect(params.minFeeA).toBeGreaterThan(0)
    expect(params.minFeeB).toBeGreaterThan(0)
    expect(params.coinsPerUtxoByte).toBeGreaterThan(0n)
    expect(params.maxTxSize).toBeGreaterThan(0)

    // eslint-disable-next-line no-console
    console.log(`✓ Protocol parameters: minFeeA=${params.minFeeA}, maxTxSize=${params.maxTxSize}`)
  })

  it("should build and submit transaction", { timeout: 30_000 }, async () => {
    if (genesisUtxos.length === 0) {
      throw new Error("Genesis UTxOs not loaded")
    }

    const client = createTestClient()
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
