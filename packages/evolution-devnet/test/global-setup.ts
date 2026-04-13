/**
 * Global setup for devnet tests.
 *
 * Starts a single shared Docker cluster (Cardano node + Kupo + Ogmios) that
 * most test files connect to. Each test file uses dedicated account indices
 * so they don't interfere with each other's UTxOs or credentials.
 *
 * Tests that need custom genesis configs (Devnet.Genesis, Devnet.integration,
 * TxBuilder.VoteValidators) still create their own isolated clusters.
 */

import type { GlobalSetupContext } from "vitest/node"

import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"

const TEST_MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

/** Shared cluster ports — no test file should reuse these */
const SHARED_PORTS = {
  node: 5555,
  submit: 5556,
  kupo: 5557,
  ogmios: 5558
}

/** All account indices used by shared-cluster tests */
const ALL_ACCOUNT_INDICES = Array.from({ length: 37 }, (_, i) => i)

export default async function setup({ provide }: GlobalSetupContext) {
  console.log("[global-setup] Starting shared devnet cluster...")

  // Resolve all account addresses for genesis funding
  const clients = ALL_ACCOUNT_INDICES.map((accountIndex) =>
    Client.make(preprod).withSeed({ mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" })
  )
  const addresses = await Promise.all(clients.map((c) => c.address()))
  const addressHexes = addresses.map((addr) => Address.toHex(addr))

  // Build initial funds — 1T lovelace per account (must be number, not bigint, for JSON.stringify in Cluster.make)
  const initialFunds: Record<string, number> = {}
  for (const hex of addressHexes) {
    initialFunds[hex] = 1_000_000_000_000
  }

  // Superset shelley genesis
  const shelleyGenesis = {
    ...Config.DEFAULT_SHELLEY_GENESIS,
    slotLength: 0.02,
    epochLength: 50,
    activeSlotsCoeff: 1.0,
    protocolParams: {
      ...Config.DEFAULT_SHELLEY_GENESIS.protocolParams,
      keyDeposit: 2_000_000,
      poolDeposit: 500_000_000
    },
    initialFunds
  } as Config.ShelleyGenesis

  // Resolve committee member key hashes for Governance test (accounts 34-35)
  // authCommitteeHot uses account 34, resignCommitteeCold uses account 35
  const committeeKeyHash34 = Bytes.toHex(addresses[34].paymentCredential.hash)
  const committeeKeyHash35 = Bytes.toHex(addresses[35].paymentCredential.hash)

  // Superset conway genesis
  const conwayGenesis = {
    ...Config.DEFAULT_CONWAY_GENESIS,
    govActionLifetime: 30,
    committee: {
      members: {
        [`keyHash-${committeeKeyHash34}`]: 1000,
        [`keyHash-${committeeKeyHash35}`]: 1000
      },
      threshold: 0.66
    }
  }

  // Pre-calculate genesis UTxOs
  const genesisUtxos = await Genesis.calculateUtxosFromConfig(shelleyGenesis)

  // Build genesis UTxO map: accountIndex -> serialized UTxO
  const genesisUtxoMap: Record<number, string> = {}
  for (let i = 0; i < addresses.length; i++) {
    const bech32 = Address.toBech32(addresses[i])
    const utxo = genesisUtxos.find((u) => Address.toBech32(u.address) === bech32)
    if (utxo) {
      genesisUtxoMap[ALL_ACCOUNT_INDICES[i]] = JSON.stringify({
        transactionId: TransactionHash.toHex(utxo.transactionId),
        index: utxo.index.toString(),
        address: Address.toBech32(utxo.address),
        lovelace: utxo.assets.lovelace.toString()
      })
    }
  }

  // Create and start cluster
  const cluster = await Cluster.make({
    clusterName: "shared-devnet",
    ports: { node: SHARED_PORTS.node, submit: SHARED_PORTS.submit },
    shelleyGenesis,
    conwayGenesis,
    kupo: { enabled: true, port: SHARED_PORTS.kupo, logLevel: "Info" },
    ogmios: { enabled: true, port: SHARED_PORTS.ogmios, logLevel: "info" }
  })

  await Cluster.start(cluster)
  await new Promise((resolve) => setTimeout(resolve, 5_000))

  // Store cluster for teardown (globalThis persists in the main process)
  ;(globalThis as any).__sharedCluster = cluster

  // Provide serializable data to test files via vitest inject
  const chainConfig = Cluster.getChain(cluster)

  provide("sharedCluster" as any, JSON.stringify({
    ports: SHARED_PORTS,
    chain: {
      id: chainConfig.id,
      name: chainConfig.name,
      networkMagic: chainConfig.networkMagic,
      epochLength: chainConfig.epochLength,
      slotConfig: {
        zeroTime: chainConfig.slotConfig.zeroTime.toString(),
        zeroSlot: chainConfig.slotConfig.zeroSlot.toString(),
        slotLength: chainConfig.slotConfig.slotLength
      }
    },
    genesisUtxoMap
  }))

  console.log(`[global-setup] Shared cluster ready (${ALL_ACCOUNT_INDICES.length} accounts funded)`)

  // Return teardown function
  return async () => {
    const storedCluster = (globalThis as any).__sharedCluster as Cluster.Cluster | undefined
    if (storedCluster) {
      console.log("[global-teardown] Stopping shared devnet cluster...")
      await Cluster.stop(storedCluster)
      await Cluster.remove(storedCluster)
      console.log("[global-teardown] Shared cluster removed")
    }
  }
}
