/**
 * Devnet tests for TxBuilder governance operations (Conway era).
 * Tests DRep registration, updates, and Constitutional Committee operations.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Anchor from "@evolution-sdk/evolution/Anchor"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import * as Credential from "@evolution-sdk/evolution/Credential"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as Url from "@evolution-sdk/evolution/Url"

describe("TxBuilder Governance Operations", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  let conwayGenesis: Config.ConwayGenesis
  const genesisUtxosByAccount: Map<number, Cardano.UTxO.UTxO> = new Map()

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const createTestClient = (accountIndex: number = 0) =>
    createClient({
      network: 0,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1452",
        ogmiosUrl: "http://localhost:1342"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex,
        addressType: "Base"
      }
    })

  beforeAll(async () => {
    // Create clients for governance tests
    const accounts = [0, 1, 2, 3, 4].map((accountIndex) =>
      createClient({
        network: 0,
        wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" }
      })
    )

    const addresses = await Promise.all(accounts.map((client) => client.address()))
    const addressHexes = addresses.map((addr) => Address.toHex(addr))

    // Extract committee member key hashes from payment credentials
    const committeeKeyHash3 = Bytes.toHex(addresses[3].paymentCredential.hash)
    const committeeKeyHash4 = Bytes.toHex(addresses[4].paymentCredential.hash)

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: {
        [addressHexes[0]]: 300_000_000_000,
        [addressHexes[1]]: 300_000_000_000,
        [addressHexes[2]]: 300_000_000_000,
        [addressHexes[3]]: 300_000_000_000,
        [addressHexes[4]]: 300_000_000_000
      }
    }

    conwayGenesis = {
      ...Config.DEFAULT_CONWAY_GENESIS,
      committee: {
        members: {
          [`keyHash-${committeeKeyHash3}`]: 1000,
          [`keyHash-${committeeKeyHash4}`]: 1000
        },
        threshold: 0.66
      }
    }

    const genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    for (let i = 0; i < addresses.length; i++) {
      const utxo = genesisUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(addresses[i]))
      if (utxo) genesisUtxosByAccount.set(i, utxo)
    }

    devnetCluster = await Cluster.make({
      clusterName: "governance-ops-test",
      ports: { node: 6005, submit: 9006 },
      shelleyGenesis: genesisConfig,
      conwayGenesis,
      kupo: { enabled: true, port: 1452, logLevel: "Info" },
      ogmios: { enabled: true, port: 1342, logLevel: "info" }
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

  it("registerDRep - registers a DRep with anchor", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 0
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const drepCredential = walletAddress.paymentCredential

    const anchor = new Anchor.Anchor({
      anchorUrl: new Url.Url({ href: "https://example.com/drep-metadata.json" }),
      anchorDataHash: Bytes32.fromHex("0000000000000000000000000000000000000000000000000000000000000000")
    })
    const registerTxHash = await client
      .newTx()
      .registerDRep({ drepCredential, anchor })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)
  })

  it("updateDRep - updates DRep metadata anchor", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 1
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const drepCredential = walletAddress.paymentCredential

    // Register DRep first
    const initialAnchor = new Anchor.Anchor({
      anchorUrl: new Url.Url({ href: "https://example.com/drep-v1.json" }),
      anchorDataHash: Bytes32.fromHex("1111111111111111111111111111111111111111111111111111111111111111")
    })

    const registerTxHash = await client
      .newTx()
      .registerDRep({ drepCredential, anchor: initialAnchor })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    // Update DRep anchor
    const updatedAnchor = new Anchor.Anchor({
      anchorUrl: new Url.Url({ href: "https://example.com/drep-v2.json" }),
      anchorDataHash: Bytes32.fromHex("2222222222222222222222222222222222222222222222222222222222222222")
    })

    const updateTxHash = await client
      .newTx()
      .updateDRep({ drepCredential, anchor: updatedAnchor })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(updateTxHash, 1000)).toBe(true)
  })

  it("deregisterDRep - deregisters a DRep and reclaims deposit", { timeout: 180_000, retry: 0 }, async () => {
    const ACCOUNT_INDEX = 2
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const drepCredential = walletAddress.paymentCredential

    // Register DRep
    const registerTxHash = await client
      .newTx()
      .registerDRep({ drepCredential })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    // Deregister DRep
    const deregisterTxHash = await client
      .newTx()
      .deregisterDRep({ drepCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("authCommitteeHot - authorizes hot credential for committee", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 3
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const coldCredential = walletAddress.paymentCredential

    const hotKeyHashBytes = KeyHash.fromHex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    const hotCredential = Credential.makeKeyHash(hotKeyHashBytes.hash)
    const authTxHash = await client
      .newTx()
      .authCommitteeHot({ coldCredential, hotCredential })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(authTxHash, 1000)).toBe(true)
  })

  it("resignCommitteeCold - resigns from constitutional committee", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 4
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const coldCredential = walletAddress.paymentCredential

    const anchor = new Anchor.Anchor({
      anchorUrl: new Url.Url({ href: "https://example.com/resignation.json" }),
      anchorDataHash: Bytes32.fromHex("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
    })
    const resignTxHash = await client
      .newTx()
      .resignCommitteeCold({ coldCredential, anchor })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(resignTxHash, 1000)).toBe(true)
  })
})
