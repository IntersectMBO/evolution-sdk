import "@evolution-sdk/scalus-emulator"

import { describe, expect, it } from "@effect/vitest"
import * as Anchor from "@evolution-sdk/evolution/Anchor"
import * as Assets from "@evolution-sdk/evolution/Assets"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import * as Credential from "@evolution-sdk/evolution/Credential"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as SlotConfig from "@evolution-sdk/evolution/Time/SlotConfig"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as Url from "@evolution-sdk/evolution/Url"
import * as UTxO from "@evolution-sdk/evolution/UTxO"

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

describe("TxBuilder Governance Operations (node-emulator)", () => {
  it("registerDRep - registers a DRep with anchor", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()
    const drepCredential = walletAddress.paymentCredential

    const anchor = new Anchor.Anchor({
      anchorUrl: new Url.Url({ href: "https://example.com/drep-metadata.json" }),
      anchorDataHash: Bytes32.fromHex("0000000000000000000000000000000000000000000000000000000000000000")
    })
    const registerTxHash = await client
      .newTx()
      .registerDRep({ drepCredential, anchor })
      .build({ availableUtxos: [initialUtxos[0]] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)
  })

  it("updateDRep - updates DRep metadata anchor", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()
    const drepCredential = walletAddress.paymentCredential

    const initialAnchor = new Anchor.Anchor({
      anchorUrl: new Url.Url({ href: "https://example.com/drep-v1.json" }),
      anchorDataHash: Bytes32.fromHex("1111111111111111111111111111111111111111111111111111111111111111")
    })

    const registerTxHash = await client
      .newTx()
      .registerDRep({ drepCredential, anchor: initialAnchor })
      .build({ availableUtxos: [initialUtxos[0]] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

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

  it("deregisterDRep - deregisters a DRep and reclaims deposit", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()
    const drepCredential = walletAddress.paymentCredential

    const registerTxHash = await client
      .newTx()
      .registerDRep({ drepCredential })
      .build({ availableUtxos: [initialUtxos[0]] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(registerTxHash, 1000)).toBe(true)

    const deregisterTxHash = await client
      .newTx()
      .deregisterDRep({ drepCredential })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(deregisterTxHash, 1000)).toBe(true)
  })

  it("authCommitteeHot - authorizes hot credential for committee", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()
    const coldCredential = walletAddress.paymentCredential

    const hotKeyHashBytes = KeyHash.fromHex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    const hotCredential = Credential.makeKeyHash(hotKeyHashBytes.hash)
    const authTxHash = await client
      .newTx()
      .authCommitteeHot({ coldCredential, hotCredential })
      .build({ availableUtxos: [initialUtxos[0]] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(authTxHash, 1000)).toBe(true)
  })

  it("resignCommitteeCold - resigns from constitutional committee", async () => {
    const { makeClient, initialUtxos } = await setupMultiAccountEmulator(1)
    const client = makeClient(0)
    const walletAddress = await client.address()
    const coldCredential = walletAddress.paymentCredential

    const anchor = new Anchor.Anchor({
      anchorUrl: new Url.Url({ href: "https://example.com/resignation.json" }),
      anchorDataHash: Bytes32.fromHex("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
    })
    const resignTxHash = await client
      .newTx()
      .resignCommitteeCold({ coldCredential, anchor })
      .build({ availableUtxos: [initialUtxos[0]] })
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(resignTxHash, 1000)).toBe(true)
  })
})
