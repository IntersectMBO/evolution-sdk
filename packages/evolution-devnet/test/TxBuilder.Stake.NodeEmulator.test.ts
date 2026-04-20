import "@evolution-sdk/scalus-emulator"

import { describe, expect, it } from "@effect/vitest"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Assets from "@evolution-sdk/evolution/Assets"
import * as DRep from "@evolution-sdk/evolution/DRep"
import * as PoolKeyHash from "@evolution-sdk/evolution/PoolKeyHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as SlotConfig from "@evolution-sdk/evolution/Time/SlotConfig"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as UTxO from "@evolution-sdk/evolution/UTxO"

const TEST_MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

const DEVNET_POOL_ID = "8a219b698d3b6e034391ae84cee62f1d76b6fbc45ddfe4e31e0d4b60"
const slotConfig = SlotConfig.SLOT_CONFIG_NETWORK.Preprod

async function setupMultiAccountEmulator(accountCount: number) {
  const accounts = Array.from({ length: accountCount }, (_, i) =>
    createClient({
      network: 0,
      wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex: i, addressType: "Base" as const }
    })
  )
  const addresses = await Promise.all(accounts.map((c) => c.address()))

  const genesisTxId = TransactionHash.fromHex("00".repeat(32))
  const initialUtxos = addresses.map(
    (addr, i) =>
      new UTxO.UTxO({
        transactionId: genesisTxId,
        index: BigInt(i),
        address: addr,
        assets: Assets.fromLovelace(300_000_000_000n)
      })
  )

  const makeClient = (accountIndex: number) =>
    createClient({
      network: 0,
      slotConfig,
      provider: {
        type: "node-emulator",
        slotConfig,
        initialUtxos
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex,
        addressType: "Base"
      }
    })

  return { addresses, initialUtxos, makeClient }
}

describe("TxBuilder Stake Operations (node-emulator)", () => {
  it("registers, delegates, withdraws, and deregisters (key credential)", async () => {
    const { makeClient, initialUtxos, addresses } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential

    const genesisUtxo = initialUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(walletAddress))
    if (!genesisUtxo) throw new Error("Genesis UTxO not found")

    // Step 1: Register
    const registerTxHash = await client
      .newTx()
      .registerStake({ stakeCredential })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    // Step 2: Delegate to pool AND DRep
    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const drep = new DRep.AlwaysAbstainDRep({})

    const delegateTxHash = await client
      .newTx()
      .delegateTo({ stakeCredential, poolKeyHash, drep })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    // Step 3: Withdraw rewards (0)
    const withdrawTxHash = await client
      .newTx()
      .withdraw({ stakeCredential, amount: 0n })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(withdrawTxHash, 1000)).toBe(true)

    // Step 4: Deregister
    const deregisterTxHash = await client
      .newTx()
      .deregisterStake({ stakeCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("delegates to pool only (StakeDelegation)", async () => {
    const { makeClient, initialUtxos, addresses } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential
    const genesisUtxo = initialUtxos[0]

    // Register
    const registerTxHash = await client.newTx().registerStake({ stakeCredential }).build({ availableUtxos: [genesisUtxo] }).then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    // Delegate to pool
    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const delegateTxHash = await client.newTx().delegateTo({ stakeCredential, poolKeyHash }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    // Deregister
    const deregisterTxHash = await client.newTx().deregisterStake({ stakeCredential }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("delegates to DRep only (VoteDelegCert)", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential

    // Register
    const registerTxHash = await client.newTx().registerStake({ stakeCredential }).build({ availableUtxos: [initialUtxos[0]] }).then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    // Delegate to DRep
    const drep = new DRep.AlwaysNoConfidenceDRep({})
    const delegateTxHash = await client.newTx().delegateTo({ stakeCredential, drep }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    // Deregister
    const deregisterTxHash = await client.newTx().deregisterStake({ stakeCredential }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("registers and delegates to pool in one cert (StakeRegDelegCert)", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential

    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const txHash = await client.newTx().registerAndDelegateTo({ stakeCredential, poolKeyHash }).build({ availableUtxos: [initialUtxos[0]] }).then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    const deregisterTxHash = await client.newTx().deregisterStake({ stakeCredential }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("registers and delegates to DRep in one cert (VoteRegDelegCert)", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential

    const drep = new DRep.AlwaysNoConfidenceDRep({})
    const txHash = await client.newTx().registerAndDelegateTo({ stakeCredential, drep }).build({ availableUtxos: [initialUtxos[0]] }).then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    const deregisterTxHash = await client.newTx().deregisterStake({ stakeCredential }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("registers and delegates to both pool+DRep in one cert (StakeVoteRegDelegCert)", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential

    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const drep = new DRep.AlwaysAbstainDRep({})
    const txHash = await client.newTx().registerAndDelegateTo({ stakeCredential, poolKeyHash, drep }).build({ availableUtxos: [initialUtxos[0]] }).then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    const deregisterTxHash = await client.newTx().deregisterStake({ stakeCredential }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("NEW API: delegateToPool - delegates stake to pool only", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential

    const registerTxHash = await client.newTx().registerStake({ stakeCredential }).build({ availableUtxos: [initialUtxos[0]] }).then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const delegateTxHash = await client.newTx().delegateToPool({ stakeCredential, poolKeyHash }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    const deregisterTxHash = await client.newTx().deregisterStake({ stakeCredential }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("NEW API: delegateToDRep - delegates voting power to DRep only", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential

    const registerTxHash = await client.newTx().registerStake({ stakeCredential }).build({ availableUtxos: [initialUtxos[0]] }).then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    const drep = new DRep.AlwaysAbstainDRep({})
    const delegateTxHash = await client.newTx().delegateToDRep({ stakeCredential, drep }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    const deregisterTxHash = await client.newTx().deregisterStake({ stakeCredential }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("NEW API: delegateToPoolAndDRep - delegates both stake and voting power", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    if (!("stakingCredential" in walletAddress) || !walletAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }
    const stakeCredential = walletAddress.stakingCredential

    const registerTxHash = await client.newTx().registerStake({ stakeCredential }).build({ availableUtxos: [initialUtxos[0]] }).then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    const poolKeyHash = PoolKeyHash.fromHex(DEVNET_POOL_ID)
    const drep = new DRep.AlwaysNoConfidenceDRep({})
    const delegateTxHash = await client.newTx().delegateToPoolAndDRep({ stakeCredential, poolKeyHash, drep }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(delegateTxHash, 1000)).toBe(true)

    const deregisterTxHash = await client.newTx().deregisterStake({ stakeCredential }).build().then((b) => b.sign()).then((b) => b.submit())
    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })
})
