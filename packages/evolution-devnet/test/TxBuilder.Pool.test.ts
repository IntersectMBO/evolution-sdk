/**
 * Devnet tests for TxBuilder pool operations.
 * Tests stake pool registration and retirement.
 *
 * Uses a dedicated cluster (not the shared cluster) because the retirePool
 * test requires Genesis.queryCurrentEpoch which needs a Cluster object.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import type { Cardano } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import type * as EpochNo from "@evolution-sdk/evolution/EpochNo"
import * as IPv4 from "@evolution-sdk/evolution/IPv4"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as PoolKeyHash from "@evolution-sdk/evolution/PoolKeyHash"
import * as PoolMetadata from "@evolution-sdk/evolution/PoolMetadata"
import * as PoolParams from "@evolution-sdk/evolution/PoolParams"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import * as SingleHostAddr from "@evolution-sdk/evolution/SingleHostAddr"
import * as UnitInterval from "@evolution-sdk/evolution/UnitInterval"
import * as Url from "@evolution-sdk/evolution/Url"
import * as VrfKeyHash from "@evolution-sdk/evolution/VrfKeyHash"
import {
  type ClusterSetupResult,
  setupCluster,
  teardownCluster
} from "./utils/shared-cluster.js"

describe("TxBuilder Pool Operations", () => {
  let setup: ClusterSetupResult

  beforeAll(async () => {
    setup = await setupCluster({
      clusterName: "pool-ops-test",
      accountIndices: [12, 13],
      ports: { node: 6006, submit: 9007, kupo: 1453, ogmios: 1343 },
      shelleyGenesisOverrides: {
        protocolParams: {
          ...Config.DEFAULT_SHELLEY_GENESIS.protocolParams,
          keyDeposit: 2_000_000,
          poolDeposit: 500_000_000
        }
      }
    })
  }, 180_000)

  afterAll(async () => {
    await teardownCluster(setup?.cluster)
  }, 60_000)

  it("registerPool - registers a new stake pool", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 12
    const genesisUtxo = setup.genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = setup.makeClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 13
    const genesisUtxo = setup.genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = setup.makeClient(ACCOUNT_INDEX)
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
    const currentEpoch = await Genesis.queryCurrentEpoch(setup.cluster)
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
