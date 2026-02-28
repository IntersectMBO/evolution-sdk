/**
 * Devnet tests for TxBuilder pool operations.
 * Tests stake pool registration and retirement.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import type * as EpochNo from "@evolution-sdk/evolution/EpochNo"
import * as IPv4 from "@evolution-sdk/evolution/IPv4"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as PoolKeyHash from "@evolution-sdk/evolution/PoolKeyHash"
import * as PoolMetadata from "@evolution-sdk/evolution/PoolMetadata"
import * as PoolParams from "@evolution-sdk/evolution/PoolParams"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as SingleHostAddr from "@evolution-sdk/evolution/SingleHostAddr"
import * as UnitInterval from "@evolution-sdk/evolution/UnitInterval"
import * as Url from "@evolution-sdk/evolution/Url"
import * as VrfKeyHash from "@evolution-sdk/evolution/VrfKeyHash"

describe("TxBuilder Pool Operations", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  const genesisUtxosByAccount: Map<number, Cardano.UTxO.UTxO> = new Map()

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const createTestClient = (accountIndex: number = 0) =>
    createClient({
      network: 0,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1453",
        ogmiosUrl: "http://localhost:1343"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex,
        addressType: "Base"
      }
    })

  beforeAll(async () => {
    // Create clients for pool tests
    const accounts = [0, 1].map((accountIndex) =>
      createClient({
        network: 0,
        wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" }
      })
    )

    const addresses = await Promise.all(accounts.map((client) => client.address()))
    const addressHexes = addresses.map((addr) => Address.toHex(addr))

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: {
        [addressHexes[0]]: 1_000_000_000_000,
        [addressHexes[1]]: 1_000_000_000_000
      },
      protocolParams: {
        ...Config.DEFAULT_SHELLEY_GENESIS.protocolParams,
        keyDeposit: 2_000_000,
        poolDeposit: 500_000_000
      }
    }

    const genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    for (let i = 0; i < addresses.length; i++) {
      const utxo = genesisUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(addresses[i]))
      if (utxo) genesisUtxosByAccount.set(i, utxo)
    }

    devnetCluster = await Cluster.make({
      clusterName: "pool-ops-test",
      ports: { node: 6006, submit: 9007 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1453, logLevel: "Info" },
      ogmios: { enabled: true, port: 1343, logLevel: "info" }
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

  it("registerPool - registers a new stake pool", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 0
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()

    const poolKeyHash =
      walletAddress.paymentCredential._tag === "KeyHash"
        ? new PoolKeyHash.PoolKeyHash({ hash: walletAddress.paymentCredential.hash })
        : PoolKeyHash.fromHex("8a219b698d3b6e034391ae84cee62f1d76b6fbc45ddfe4e31e0d4b60")
    const vrfKeyhash = VrfKeyHash.fromHex("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: walletAddress.stakingCredential!
    })

    const ownerKeyHash =
      walletAddress.paymentCredential._tag === "KeyHash"
        ? walletAddress.paymentCredential
        : KeyHash.fromHex("cccccccccccccccccccccccccccccccccccccccccccccccccccccccc")

    const poolMetadata = new PoolMetadata.PoolMetadata({
      url: new Url.Url({ href: "https://example.com/pool-metadata.json" }),
      hash: Bytes32.fromHex("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd")
    })

    const relay = new SingleHostAddr.SingleHostAddr({
      port: 3001n,
      ipv4: new IPv4.IPv4({ bytes: new Uint8Array([192, 168, 1, 100]) }),
      ipv6: undefined
    })

    const poolParams = new PoolParams.PoolParams({
      operator: poolKeyHash,
      vrfKeyhash,
      pledge: 100_000_000_000n,
      cost: 340_000_000n,
      margin: new UnitInterval.UnitInterval({
        numerator: 3n,
        denominator: 100n
      }),
      rewardAccount,
      poolOwners: [ownerKeyHash],
      relays: [relay],
      poolMetadata
    })

    const registerTxHash = await client
      .newTx()
      .registerPool({ poolParams })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)
  })

  it("retirePool - retires a stake pool", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 1
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()

    const poolKeyHash =
      walletAddress.paymentCredential._tag === "KeyHash"
        ? new PoolKeyHash.PoolKeyHash({ hash: walletAddress.paymentCredential.hash })
        : PoolKeyHash.fromHex("9a229b698d3b6e034391ae84cee62f1d76b6fbc45ddfe4e31e0d4b70")
    const vrfKeyhash = VrfKeyHash.fromHex("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")

    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: walletAddress.stakingCredential!
    })

    const ownerKeyHash =
      walletAddress.paymentCredential._tag === "KeyHash"
        ? walletAddress.paymentCredential
        : KeyHash.fromHex("cccccccccccccccccccccccccccccccccccccccccccccccccccccccc")

    const relay = new SingleHostAddr.SingleHostAddr({
      port: 3001n,
      ipv4: new IPv4.IPv4({ bytes: new Uint8Array([192, 168, 1, 101]) }),
      ipv6: undefined
    })

    const poolParams = new PoolParams.PoolParams({
      operator: poolKeyHash,
      vrfKeyhash,
      pledge: 100_000_000_000n,
      cost: 340_000_000n,
      margin: new UnitInterval.UnitInterval({
        numerator: 5n,
        denominator: 100n
      }),
      rewardAccount,
      poolOwners: [ownerKeyHash],
      relays: [relay],
      poolMetadata: undefined
    })

    // Register pool first
    const registerTxHash = await client
      .newTx()
      .registerPool({ poolParams })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    // Wait for pool registration to settle
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Query current epoch and retire in future epoch
    const currentEpoch = await Genesis.queryCurrentEpoch(devnetCluster!)
    const retirementEpoch: EpochNo.EpochNo = currentEpoch + 5n
    const retireTxHash = await client
      .newTx()
      .retirePool({ poolKeyHash, epoch: retirementEpoch })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(retireTxHash, 1000)).toBe(true)
  })
})
