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

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import * as Address from "@evolution-sdk/evolution/Address"
import * as DRep from "@evolution-sdk/evolution/DRep"
import * as PoolKeyHash from "@evolution-sdk/evolution/PoolKeyHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"

// Default devnet stake pool ID from Config.ts
const DEVNET_POOL_ID = "8a219b698d3b6e034391ae84cee62f1d76b6fbc45ddfe4e31e0d4b60"

describe("TxBuilder Stake Operations", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  // Store genesis UTxOs per account index for independent tests
  const genesisUtxosByAccount: Map<number, Cardano.UTxO.UTxO> = new Map()

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  // Create client for a specific account index (each test uses different account)
  const createTestClient = (accountIndex: number = 0) =>
    createClient({
      network: 0,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1446",
        ogmiosUrl: "http://localhost:1341"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex,
        addressType: "Base" // Need Base address to have stake credential
      }
    })

  beforeAll(async () => {
    // Create clients for each account we'll use in tests
    const accounts = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((accountIndex) =>
      createClient({
        network: 0,
        wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" }
      })
    )

    const addresses = await Promise.all(accounts.map((client) => client.address()))
    const addressHexes = addresses.map((addr) => Address.toHex(addr))

    // Fund each account independently so tests don't share UTxOs
    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: {
        [addressHexes[0]]: 300_000_000_000, // Test 1: Full flow (register + delegate separately)
        [addressHexes[1]]: 300_000_000_000, // Test 2: Pool-only delegation (StakeDelegation)
        [addressHexes[2]]: 300_000_000_000, // Test 3: DRep-only delegation (VoteDelegCert)
        [addressHexes[3]]: 300_000_000_000, // Test 4: Combined register+delegate pool (StakeRegDelegCert)
        [addressHexes[4]]: 300_000_000_000, // Test 5: Combined register+delegate DRep (VoteRegDelegCert)
        [addressHexes[5]]: 300_000_000_000, // Test 6: Combined register+delegate both (StakeVoteRegDelegCert)
        [addressHexes[6]]: 300_000_000_000, // Test 7: NEW API - delegateToPool
        [addressHexes[7]]: 300_000_000_000, // Test 8: NEW API - delegateToDRep
        [addressHexes[8]]: 300_000_000_000 // Test 9: NEW API - delegateToPoolAndDRep
      }
    }

    // Pre-calculate genesis UTxOs and map by account
    const genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    for (let i = 0; i < addresses.length; i++) {
      const utxo = genesisUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(addresses[i]))
      if (utxo) genesisUtxosByAccount.set(i, utxo)
    }

    devnetCluster = await Cluster.make({
      clusterName: "stake-ops-test",
      ports: { node: 6004, submit: 9005 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1446, logLevel: "Info" },
      ogmios: { enabled: true, port: 1341, logLevel: "info" }
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

  it("registers, delegates, withdraws, and deregisters (key credential)", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 0
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 1
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 2
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 3
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 4
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
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
      const ACCOUNT_INDEX = 5
      const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
      if (!genesisUtxo) {
        throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
      }

      const client = createTestClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 6
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 7
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 8
    const genesisUtxo = genesisUtxosByAccount.get(ACCOUNT_INDEX)
    if (!genesisUtxo) {
      throw new Error(`Genesis UTxO not found for account ${ACCOUNT_INDEX}`)
    }

    const client = createTestClient(ACCOUNT_INDEX)
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
