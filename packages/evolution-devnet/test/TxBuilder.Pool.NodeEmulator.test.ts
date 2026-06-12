import "@evolution-sdk/scalus-emulator"

import { describe, expect, it } from "@effect/vitest"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Assets from "@evolution-sdk/evolution/Assets"
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
import * as SlotConfig from "@evolution-sdk/evolution/Time/SlotConfig"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as UnitInterval from "@evolution-sdk/evolution/UnitInterval"
import * as Url from "@evolution-sdk/evolution/Url"
import * as UTxO from "@evolution-sdk/evolution/UTxO"
import * as VrfKeyHash from "@evolution-sdk/evolution/VrfKeyHash"

const TEST_MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

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
        assets: Assets.fromLovelace(1_000_000_000_000n)
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

describe("TxBuilder Pool Operations (node-emulator)", () => {
  it("registerPool - registers a new stake pool", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()

    const genesisUtxo = initialUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(walletAddress))
    if (!genesisUtxo) throw new Error("Genesis UTxO not found")

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

  it("retirePool - retires a stake pool", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(2)
    const client = makeClient(1)
    const walletAddress = await client.address()

    const genesisUtxo = initialUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(walletAddress))
    if (!genesisUtxo) throw new Error("Genesis UTxO not found")

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

    const registerTxHash = await client
      .newTx()
      .registerPool({ poolParams })
      .build({ availableUtxos: [genesisUtxo] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    // The retirement epoch must be in (currentEpoch, currentEpoch + poolRetireMaxEpoch].
    // The node emulator is advanced to the current wall-clock slot on creation, so derive
    // the current epoch the same way the emulator does: from the slot config (epoch 0 at
    // zeroSlot, 432000 slots per epoch).
    const currentSlot = Math.floor(
      (Date.now() - Number(slotConfig.zeroTime)) / slotConfig.slotLength + Number(slotConfig.zeroSlot)
    )
    const currentEpoch = Math.floor((currentSlot - Number(slotConfig.zeroSlot)) / 432_000)
    const retirementEpoch: EpochNo.EpochNo = BigInt(currentEpoch + 1)
    const retireTxHash = await client
      .newTx()
      .retirePool({ poolKeyHash, epoch: retirementEpoch })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(retireTxHash, 1000)).toBe(true)
  })
})
