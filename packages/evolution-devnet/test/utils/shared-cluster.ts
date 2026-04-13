/**
 * Shared cluster utilities for devnet tests.
 *
 * Provides helpers to reduce boilerplate across test files and enable
 * progressive migration to shared clusters.
 *
 * Two modes:
 * 1. `setupCluster()` — creates a dedicated cluster per test file (legacy)
 * 2. `useSharedCluster()` — connects to the shared cluster from globalSetup
 */

import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano, Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as UTxO from "@evolution-sdk/evolution/UTxO"

export const TEST_MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

export const FAST_SHELLEY_GENESIS: Partial<Config.ShelleyGenesis> = {
  slotLength: 0.02,
  epochLength: 50,
  activeSlotsCoeff: 1.0
}

// ---------------------------------------------------------------------------
// Shared cluster (Phase 2+)
// ---------------------------------------------------------------------------

/** Shape of the serialized data from globalSetup's provide() */
export type SharedClusterInfo = {
  readonly ports: {
    readonly node: number
    readonly submit: number
    readonly kupo: number
    readonly ogmios: number
  }
  readonly chain: {
    readonly id: number
    readonly name: string
    readonly networkMagic: number
    readonly epochLength: number
    readonly slotConfig: {
      readonly zeroTime: string
      readonly zeroSlot: string
      readonly slotLength: number
    }
  }
  readonly genesisUtxoMap: Record<number, string>
}

export type SharedClusterResult = {
  readonly makeClient: (accountIndex: number) => ReturnType<typeof Client.make>
  readonly getGenesisUtxo: (accountIndex: number) => Cardano.UTxO.UTxO
  readonly genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO>
}

/**
 * Connects to the shared cluster started by globalSetup.
 * Call this in beforeAll with the JSON string from inject('sharedCluster').
 */
export const useSharedCluster = async (
  injectData: string,
  accountIndices: ReadonlyArray<number>
): Promise<SharedClusterResult> => {
  const info: SharedClusterInfo = JSON.parse(injectData)

  const chain = {
    id: info.chain.id,
    name: info.chain.name,
    networkMagic: info.chain.networkMagic,
    epochLength: info.chain.epochLength,
    slotConfig: {
      zeroTime: BigInt(info.chain.slotConfig.zeroTime),
      zeroSlot: BigInt(info.chain.slotConfig.zeroSlot),
      slotLength: info.chain.slotConfig.slotLength
    }
  }

  const makeClient = (accountIndex: number) =>
    Client.make(chain)
      .withKupmios({
        kupoUrl: `http://localhost:${info.ports.kupo}`,
        ogmiosUrl: `http://localhost:${info.ports.ogmios}`
      })
      .withSeed({ mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" })

  // Deserialize genesis UTxOs for requested accounts
  const utxoList: Array<Cardano.UTxO.UTxO> = []
  const utxoMap = new Map<number, Cardano.UTxO.UTxO>()

  for (const idx of accountIndices) {
    const raw = info.genesisUtxoMap[idx]
    if (!raw) throw new Error(`No genesis UTxO for account ${idx} in shared cluster`)
    const parsed = JSON.parse(raw)
    const utxo = new UTxO.UTxO({
      transactionId: TransactionHash.fromHex(parsed.transactionId),
      index: BigInt(parsed.index),
      address: Address.fromBech32(parsed.address),
      assets: Cardano.Assets.fromLovelace(BigInt(parsed.lovelace))
    })
    utxoList.push(utxo)
    utxoMap.set(idx, utxo)
  }

  const getGenesisUtxo = (accountIndex: number): Cardano.UTxO.UTxO => {
    const utxo = utxoMap.get(accountIndex)
    if (!utxo) throw new Error(`No genesis UTxO for account ${accountIndex}`)
    return utxo
  }

  return { makeClient, getGenesisUtxo, genesisUtxos: utxoList }
}

// ---------------------------------------------------------------------------
// Per-file cluster (legacy, for isolated tests)
// ---------------------------------------------------------------------------

/**
 * Resolves addresses and their hex representations for the given account indices.
 */
export const resolveAccounts = async (
  accountIndices: ReadonlyArray<number>
): Promise<{
  addresses: ReadonlyArray<Address.Address>
  addressHexes: ReadonlyArray<string>
}> => {
  const clients = accountIndices.map((accountIndex) =>
    Client.make(preprod).withSeed({ mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" })
  )
  const addresses = await Promise.all(clients.map((c) => c.address()))
  const addressHexes = addresses.map((addr) => Address.toHex(addr))
  return { addresses, addressHexes }
}

/**
 * Builds an initialFunds map from account addresses and a funding amount.
 */
export const buildInitialFunds = (
  addressHexes: ReadonlyArray<string>,
  amount: number = 1_000_000_000_000
): Record<string, number> => {
  const funds: Record<string, number> = {}
  for (const hex of addressHexes) {
    funds[hex] = amount
  }
  return funds
}

/**
 * Creates a signing client connected to a running cluster.
 */
export const createTestClient = (
  cluster: Cluster.Cluster,
  kupoPort: number,
  ogmiosPort: number,
  accountIndex: number = 0
) =>
  Client.make(Cluster.getChain(cluster))
    .withKupmios({ kupoUrl: `http://localhost:${kupoPort}`, ogmiosUrl: `http://localhost:${ogmiosPort}` })
    .withSeed({ mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" })

/**
 * Finds the genesis UTxO for a specific address.
 */
export const getGenesisUtxo = (
  genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO>,
  address: Address.Address
): Cardano.UTxO.UTxO => {
  const bech32 = Address.toBech32(address)
  const utxo = genesisUtxos.find((u) => Address.toBech32(u.address) === bech32)
  if (!utxo) throw new Error(`No genesis UTxO found for address ${bech32}`)
  return utxo
}

export type ClusterSetupOptions = {
  readonly clusterName: string
  readonly accountIndices: ReadonlyArray<number>
  readonly ports: {
    readonly node: number
    readonly submit: number
    readonly kupo: number
    readonly ogmios: number
  }
  readonly initialFundAmount?: number
  readonly shelleyGenesisOverrides?: Partial<Config.ShelleyGenesis>
  readonly conwayGenesis?: Partial<Config.ConwayGenesis>
}

export type ClusterSetupResult = {
  readonly cluster: Cluster.Cluster
  readonly genesisConfig: Config.ShelleyGenesis
  readonly genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO>
  readonly genesisUtxosByAccount: ReadonlyMap<number, Cardano.UTxO.UTxO>
  readonly makeClient: (accountIndex: number) => ReturnType<typeof Client.make>
}

/**
 * Sets up a dedicated devnet cluster for a test file.
 * Use this for tests that need custom genesis configs or full isolation.
 */
export const setupCluster = async (options: ClusterSetupOptions): Promise<ClusterSetupResult> => {
  const { addresses, addressHexes } = await resolveAccounts(options.accountIndices)
  const initialFunds = buildInitialFunds(addressHexes, options.initialFundAmount)

  const genesisConfig = {
    ...Config.DEFAULT_SHELLEY_GENESIS,
    ...FAST_SHELLEY_GENESIS,
    ...options.shelleyGenesisOverrides,
    initialFunds
  } as Config.ShelleyGenesis

  const genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

  const genesisUtxosByAccount = new Map<number, Cardano.UTxO.UTxO>()
  for (let i = 0; i < addresses.length; i++) {
    const utxo = genesisUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(addresses[i]))
    if (utxo) genesisUtxosByAccount.set(options.accountIndices[i], utxo)
  }

  const clusterConfig: Config.DevNetConfig = {
    clusterName: options.clusterName,
    ports: { node: options.ports.node, submit: options.ports.submit },
    shelleyGenesis: genesisConfig,
    kupo: { enabled: true, port: options.ports.kupo, logLevel: "Info" },
    ogmios: { enabled: true, port: options.ports.ogmios, logLevel: "info" }
  }

  if (options.conwayGenesis) {
    ;(clusterConfig as any).conwayGenesis = options.conwayGenesis
  }

  const cluster = await Cluster.make(clusterConfig)
  await Cluster.start(cluster)
  await new Promise((resolve) => setTimeout(resolve, 3_000))

  const makeClient = (accountIndex: number) =>
    createTestClient(cluster, options.ports.kupo, options.ports.ogmios, accountIndex)

  return { cluster, genesisConfig, genesisUtxos, genesisUtxosByAccount, makeClient }
}

/**
 * Tears down a cluster (stop + remove).
 */
export const teardownCluster = async (cluster: Cluster.Cluster | undefined): Promise<void> => {
  if (cluster) {
    await Cluster.stop(cluster)
    await Cluster.remove(cluster)
  }
}
