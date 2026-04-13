/**
 * Devnet tests for TxBuilder governance operations (Conway era).
 * Tests DRep registration, updates, and Constitutional Committee operations.
 */

import { beforeAll, describe, expect, it } from "@effect/vitest"
import * as Anchor from "@evolution-sdk/evolution/Anchor"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import * as Credential from "@evolution-sdk/evolution/Credential"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as Url from "@evolution-sdk/evolution/Url"
import { inject } from "vitest"

import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

describe("TxBuilder Governance Operations", () => {
  let shared: SharedClusterResult

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [31, 32, 33, 34, 35])
  }, 180_000)

  it("registerDRep - registers a DRep with anchor", { timeout: 180_000 }, async () => {
    const ACCOUNT_INDEX = 31
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 32
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 33
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 34
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
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
    const ACCOUNT_INDEX = 35
    const genesisUtxo = shared.getGenesisUtxo(ACCOUNT_INDEX)

    const client = shared.makeClient(ACCOUNT_INDEX)
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
