/**
 * Devnet tests for TxBuilder stake/withdraw operations.
 *
 * Test flow (key credentials - no script witnesses required):
 * 1. Register the wallet's stake credential
 * 2. Delegate to pool AND DRep (AlwaysAbstain) - required for withdrawals in Conway
 * 3. Withdraw rewards (0 since none accumulated yet)
 * 4. Deregister the stake credential (returns deposit)
 *
 * This tests the TxBuilder's certificate and withdrawal handling
 * using simple key credentials that don't require script witnesses.
 */

import { beforeAll, describe, expect, it } from "@effect/vitest"
import * as DRep from "@evolution-sdk/evolution/DRep"
import * as PoolKeyHash from "@evolution-sdk/evolution/PoolKeyHash"
import { inject } from "vitest"

import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

// Default devnet stake pool ID from Config.ts
const DEVNET_POOL_ID = "8a219b698d3b6e034391ae84cee62f1d76b6fbc45ddfe4e31e0d4b60"

describe("TxBuilder Stake Operations", () => {
  let shared: SharedClusterResult

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [17, 18, 19, 20, 21, 22, 23, 24, 25])
  }, 180_000)

  it("registers, delegates, withdraws, and deregisters (key credential)", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 17
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()

    // Extract stake credential from wallet address
    // The wallet address should be a base address with a stake component
    const addressStruct = walletAddress

    if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
      throw new Error(`Expected BaseAddress with stakingCredential, got: ${JSON.stringify(addressStruct)}`)
    }

    const stakeCredential = addressStruct.stakingCredential

    // Step 1: Register the stake credential
    const registerSignBuilder = await client
      .newTx()
      .registerStake({ stakeCredential })
      .build({ availableUtxos: [genesisUtxo] })

    const registerSubmitBuilder = await registerSignBuilder.sign()
    const registerTxHash = await registerSubmitBuilder.submit()
    const registerConfirmed = await client.awaitTx(registerTxHash, 1000)
    expect(registerConfirmed).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Delegate to pool AND DRep (required for withdrawals in Conway)
    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const drep = new DRep.AlwaysAbstainDRep({})

    const delegateSignBuilder = await client.newTx().delegateTo({ stakeCredential, poolKeyHash, drep }).build()

    const delegateSubmitBuilder = await delegateSignBuilder.sign()
    const delegateTxHash = await delegateSubmitBuilder.submit()
    const delegateConfirmed = await client.awaitTx(delegateTxHash, 1000)
    expect(delegateConfirmed).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 3: Withdraw rewards (0 since none accumulated)
    const withdrawSignBuilder = await client.newTx().withdraw({ stakeCredential, amount: 0n }).build()

    const withdrawSubmitBuilder = await withdrawSignBuilder.sign()
    const withdrawTxHash = await withdrawSubmitBuilder.submit()
    const withdrawConfirmed = await client.awaitTx(withdrawTxHash, 1000)
    expect(withdrawConfirmed).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 4: Deregister the stake credential (returns deposit)
    const deregisterSignBuilder = await client.newTx().deregisterStake({ stakeCredential }).build()

    const deregisterSubmitBuilder = await deregisterSignBuilder.sign()
    const deregisterTxHash = await deregisterSubmitBuilder.submit()
    const deregisterConfirmed = await client.awaitTx(deregisterTxHash, 1000)
    expect(deregisterConfirmed).toBe(true)
  })

  it("delegates to pool only (StakeDelegation)", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 18
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const addressStruct = walletAddress

    if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
      throw new Error(`Expected BaseAddress with stakingCredential`)
    }

    const stakeCredential = addressStruct.stakingCredential

    // Step 1: Register
    const registerTxHash = await client
      .newTx()
      .registerStake({ stakeCredential })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Delegate to pool only (StakeDelegation certificate)
    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const delegateTxHash = await client
      .newTx()
      .delegateTo({ stakeCredential, poolKeyHash })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 3: Deregister
    const deregisterTxHash = await client
      .newTx()
      .deregisterStake({ stakeCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("delegates to DRep only (VoteDelegCert)", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 19
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const addressStruct = walletAddress

    if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
      throw new Error(`Expected BaseAddress with stakingCredential`)
    }

    const stakeCredential = addressStruct.stakingCredential

    // Step 1: Register
    const registerTxHash = await client
      .newTx()
      .registerStake({ stakeCredential })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Delegate to DRep only (VoteDelegCert certificate)
    const drep = new DRep.AlwaysNoConfidenceDRep({})
    const delegateTxHash = await client
      .newTx()
      .delegateTo({ stakeCredential, drep })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 3: Deregister
    const deregisterTxHash = await client
      .newTx()
      .deregisterStake({ stakeCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("registers and delegates to pool in one cert (StakeRegDelegCert)", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 20
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const addressStruct = walletAddress

    if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
      throw new Error(`Expected BaseAddress with stakingCredential`)
    }

    const stakeCredential = addressStruct.stakingCredential

    // Step 1: Register AND delegate to pool in single cert (StakeRegDelegCert)
    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const registerDelegateTxHash = await client
      .newTx()
      .registerAndDelegateTo({ stakeCredential, poolKeyHash })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(registerDelegateTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Deregister
    const deregisterTxHash = await client
      .newTx()
      .deregisterStake({ stakeCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("registers and delegates to DRep in one cert (VoteRegDelegCert)", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 21
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const addressStruct = walletAddress

    if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
      throw new Error(`Expected BaseAddress with stakingCredential`)
    }

    const stakeCredential = addressStruct.stakingCredential

    // Step 1: Register AND delegate to DRep in single cert (VoteRegDelegCert)
    const drep = new DRep.AlwaysNoConfidenceDRep({})
    const registerDelegateTxHash = await client
      .newTx()
      .registerAndDelegateTo({ stakeCredential, drep })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(registerDelegateTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Deregister
    const deregisterTxHash = await client
      .newTx()
      .deregisterStake({ stakeCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it(
    "registers and delegates to both pool+DRep in one cert (StakeVoteRegDelegCert)",
    { timeout: 180_000 },
    async () => {
      const ACCOUNT_INDEX = 22
      const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

      const client = shared.makeClient(ACCOUNT_INDEX)
      const walletAddress = await client.address()
      const addressStruct = walletAddress

      if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
        throw new Error(`Expected BaseAddress with stakingCredential`)
      }

      const stakeCredential = addressStruct.stakingCredential

      // Step 1: Register AND delegate to both pool+DRep in single cert (StakeVoteRegDelegCert)
      const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
      const drep = new DRep.AlwaysAbstainDRep({})
      const registerDelegateTxHash = await client
        .newTx()
        .registerAndDelegateTo({ stakeCredential, poolKeyHash, drep })
        .build({ availableUtxos: [genesisUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
      expect(await client.awaitTx(registerDelegateTxHash, 1000)).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Step 2: Deregister
      const deregisterTxHash = await client
        .newTx()
        .deregisterStake({ stakeCredential })
        .build()
        .then((b) => b.sign())
        .then((b) => b.submit())
      expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
    }
  )

  // ============================================================================
  // New Explicit Delegation API Tests
  // ============================================================================

  it("NEW API: delegateToPool - delegates stake to pool only", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 23
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const addressStruct = walletAddress

    if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
      throw new Error(`Expected BaseAddress with stakingCredential`)
    }

    const stakeCredential = addressStruct.stakingCredential

    // Step 1: Register
    const registerTxHash = await client
      .newTx()
      .registerStake({ stakeCredential })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Delegate to pool using NEW API (StakeDelegation certificate)
    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const delegateTxHash = await client
      .newTx()
      .delegateToPool({ stakeCredential, poolKeyHash })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 3: Deregister
    const deregisterTxHash = await client
      .newTx()
      .deregisterStake({ stakeCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("NEW API: delegateToDRep - delegates voting power to DRep only", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 24
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const addressStruct = walletAddress

    if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
      throw new Error(`Expected BaseAddress with stakingCredential`)
    }

    const stakeCredential = addressStruct.stakingCredential

    // Step 1: Register
    const registerTxHash = await client
      .newTx()
      .registerStake({ stakeCredential })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Delegate to DRep using NEW API (VoteDelegCert certificate)
    const drep = new DRep.AlwaysAbstainDRep({})
    const delegateTxHash = await client
      .newTx()
      .delegateToDRep({ stakeCredential, drep })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 3: Deregister
    const deregisterTxHash = await client
      .newTx()
      .deregisterStake({ stakeCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("NEW API: delegateToPoolAndDRep - delegates both stake and voting power", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 25
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
    const walletAddress = await client.address()
    const addressStruct = walletAddress

    if (!("stakingCredential" in addressStruct) || !addressStruct.stakingCredential) {
      throw new Error(`Expected BaseAddress with stakingCredential`)
    }

    const stakeCredential = addressStruct.stakingCredential

    // Step 1: Register
    const registerTxHash = await client
      .newTx()
      .registerStake({ stakeCredential })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Delegate to both pool and DRep using NEW API (StakeVoteDelegCert certificate)
    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const drep = new DRep.AlwaysNoConfidenceDRep({})
    const delegateTxHash = await client
      .newTx()
      .delegateToPoolAndDRep({ stakeCredential, poolKeyHash, drep })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 3: Deregister
    const deregisterTxHash = await client
      .newTx()
      .deregisterStake({ stakeCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })
})
