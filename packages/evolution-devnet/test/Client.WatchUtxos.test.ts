import { describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano, client, kupmios, seedWallet } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import { afterAll, beforeAll } from "vitest"

const CoreAssets = Cardano.Assets

/**
 * Streaming capability integration test.
 *
 * Validates that `watchUtxos` (Stream → AsyncIterable)
 * works end-to-end against a real Kupo instance on a local devnet.
 */
describe("Client.watchUtxos with Devnet", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []
  let genesisConfig: Config.ShelleyGenesis

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const KUPO_PORT = 1455
  const OGMIOS_PORT = 1347

  const createTestClient = () =>
    client(Cluster.getChain(devnetCluster!))
      .with(kupmios({ kupoUrl: `http://localhost:${KUPO_PORT}`, ogmiosUrl: `http://localhost:${OGMIOS_PORT}` }))
      .with(seedWallet({ mnemonic: TEST_MNEMONIC, accountIndex: 0 }))

  beforeAll(async () => {
    const testClient = client(Cluster.BOOTSTRAP_CHAIN).with(seedWallet({ mnemonic: TEST_MNEMONIC, accountIndex: 0 }))

    const testAddress = await testClient.getAddress()
    const testAddressHex = CoreAddress.toHex(testAddress)

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: { [testAddressHex]: 900_000_000_000 }
    }

    devnetCluster = await Cluster.make({
      clusterName: "client-watch-utxos-test",
      ports: { node: 6012, submit: 9012 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: KUPO_PORT, logLevel: "Info" },
      ogmios: { enabled: true, port: OGMIOS_PORT, logLevel: "info" }
    })

    await Cluster.start(devnetCluster)
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      await Cluster.stop(devnetCluster)
      await Cluster.remove(devnetCluster)
    }
  }, 60_000)

  it("should log the watchUtxos AsyncIterable and emit the received UTxO", { timeout: 60_000 }, async () => {
    const testClient = createTestClient()
    const address = await testClient.getAddress()

    const receiverAddress = CoreAddress.fromBech32(
      "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
    )

    const genesisUtxo = genesisUtxos.find(
      (utxo) => CoreAddress.toBech32(utxo.address) === CoreAddress.toBech32(address)
    )
    expect(genesisUtxo).toBeDefined()

    const receivedUtxos: Array<Cardano.UTxO.UTxO> = []
    const asyncIter = testClient.watchUtxos(receiverAddress, 500)
    // eslint-disable-next-line no-console
    console.log("asyncIter:", asyncIter)

    const watchPromise = (async () => {
      for await (const utxo of asyncIter) {
        // eslint-disable-next-line no-console
        console.log("received utxo:", utxo)
        receivedUtxos.push(utxo)
        break
      }
    })()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const txHash = await testClient
      .newTx()
      .payToAddress({ address: receiverAddress, assets: CoreAssets.fromLovelace(5_000_000n) })
      .build({ availableUtxos: [genesisUtxo!] })
      .then((signBuilder) => signBuilder.sign())
      .then((submitBuilder) => submitBuilder.submit())

    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)
    expect(await testClient.awaitTx(txHash, 1000)).toBe(true)

    await watchPromise

    expect(receivedUtxos.length).toBe(1)
    expect(receivedUtxos[0].assets.lovelace).toBe(5_000_000n)
    expect(CoreAddress.toBech32(receivedUtxos[0].address)).toBe(CoreAddress.toBech32(receiverAddress))
  })
})
