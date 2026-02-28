import * as Address from "@evolution-sdk/evolution/Address"
import * as AddressEras from "@evolution-sdk/evolution/AddressEras"
import * as Assets from "@evolution-sdk/evolution/Assets"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as UTxO from "@evolution-sdk/evolution/UTxO"
import { blake2b } from "@noble/hashes/blake2"
import { Data, Effect } from "effect"

import type * as Config from "./Config.js"
import type * as Container from "./Container.js"

export class GenesisError extends Data.TaggedError("GenesisError")<{
  reason: string
  message: string
  cause?: unknown
}> {}

export interface Cluster {
  readonly cardanoNode: Container.Container
  readonly kupo?: Container.Container | undefined
  readonly ogmios?: Container.Container | undefined
  readonly networkName: string
}

/**
 * Calculate genesis UTxOs deterministically from shelley genesis configuration.
 * No node interaction required - purely computational.
 *
 * Implementation follows Cardano's `initialFundsPseudoTxIn` algorithm:
 * Each address gets a unique pseudo-TxId by hashing the address itself (not the genesis JSON).
 * This matches the Haskell implementation in cardano-ledger.
 *
 * Algorithm:
 * 1. For each address in initialFunds:
 *    a. Serialize address to CBOR bytes
 *    b. Hash with blake2b-256 → this becomes the TxId
 *    c. Output index is always 0 (minBound)
 *
 * Reference: cardano-ledger/eras/shelley/impl/src/Cardano/Ledger/Shelley/Genesis.hs
 * `initialFundsPseudoTxIn addr = TxIn (pseudoTxId addr) minBound`
 * `pseudoTxId = TxId . unsafeMakeSafeHash . Hash.castHash . Hash.hashWith serialiseAddr`
 *
 * @example
 * ```typescript
 * import * as Devnet from "@evolution-sdk/evolution-devnet"
 *
 * const genesisConfig = {
 *   initialFunds: {
 *     "00813c32c92aad21...": 900_000_000_000
 *   },
 *   // ... other genesis config
 * }
 *
 * const utxos = await Devnet.Genesis.calculateUtxosFromConfig(
 *   genesisConfig
 * )
 * ```
 *
 * @since 2.0.0
 * @category genesis
 */
export const calculateUtxosFromConfigEffect = (
  genesisConfig: Config.ShelleyGenesis
): Effect.Effect<ReadonlyArray<UTxO.UTxO>, GenesisError> =>
  Effect.gen(function* () {
    const utxos: Array<UTxO.UTxO> = []
    const fundEntries = Object.entries(genesisConfig.initialFunds)

    for (const [addressHex, lovelace] of fundEntries) {
      // Convert hex address to Address
      const address = yield* Effect.try({
        try: () => Address.fromHex(addressHex),
        catch: (e) =>
          new GenesisError({
            reason: "address_conversion_failed",
            message: `Failed to convert genesis address hex: ${addressHex}`,
            cause: e
          })
      })

      // Calculate pseudo-TxId by hashing the address bytes
      // This matches Cardano's: Hash.hashWith serialiseAddr addr
      const addr = AddressEras.fromHex(addressHex)
      const addressBytes = AddressEras.toBytes(addr)
      const txHashBytes = blake2b(addressBytes, { dkLen: 32 })
      const transactionId = new TransactionHash.TransactionHash({ hash: txHashBytes })

      utxos.push(
        new UTxO.UTxO({
          transactionId,
          index: 0n, // Genesis UTxOs always use index 0 (minBound in Haskell)
          address,
          assets: Assets.fromLovelace(BigInt(lovelace))
        })
      )
    }

    return utxos
  })

/**
 * Calculate genesis UTxOs from config, throws on error.
 *
 * @since 2.0.0
 * @category genesis
 */
export const calculateUtxosFromConfig = (genesisConfig: Config.ShelleyGenesis) =>
  Effect.runPromise(calculateUtxosFromConfigEffect(genesisConfig))

/**
 * Query genesis UTxOs from the running node using cardano-cli.
 * This is the "source of truth" method that queries actual chain state.
 *
 * @since 2.0.0
 * @category genesis
 */
export const queryUtxosEffect = (cluster: Cluster): Effect.Effect<ReadonlyArray<UTxO.UTxO>, GenesisError> =>
  Effect.gen(function* () {
    // Need to import Container functions dynamically to avoid circular dependency
    const ContainerModule = yield* Effect.promise(() => import("./Container.js"))

    const output = yield* ContainerModule.execCommandEffect(cluster.cardanoNode, [
      "cardano-cli",
      "conway",
      "query",
      "utxo",
      "--whole-utxo",
      "--socket-path",
      "/opt/cardano/ipc/node.socket",
      "--testnet-magic",
      "42",
      "--out-file",
      "/dev/stdout"
    ]).pipe(
      Effect.mapError(
        (e) =>
          new GenesisError({
            reason: "utxo_query_failed",
            message: "Failed to query UTxOs from node",
            cause: e
          })
      )
    )

    const parsed = yield* Effect.try({
      try: () => JSON.parse(output) as Record<string, { address: string; value: { lovelace: number } }>,
      catch: (e) =>
        new GenesisError({
          reason: "utxo_parse_failed",
          message: "Failed to parse UTxO query output from cardano-cli",
          cause: e
        })
    })

    return Object.entries(parsed).map(([key, data]) => {
      const [txHashHex, outputIndex] = key.split("#")
      const transactionId = TransactionHash.fromHex(txHashHex)
      const address = Address.fromBech32(data.address)
      return new UTxO.UTxO({
        transactionId,
        index: BigInt(parseInt(outputIndex)),
        address,
        assets: Assets.fromLovelace(BigInt(data.value.lovelace))
      })
    })
  })

/**
 * Query genesis UTxOs from node, throws on error.
 *
 * @since 2.0.0
 * @category genesis
 */
export const queryUtxos = (cluster: Cluster) => Effect.runPromise(queryUtxosEffect(cluster))

//TODO: this function does not belong here
/**
 * Query the current epoch from the running node using cardano-cli.
 * Returns the current epoch number from the chain tip.
 *
 * @since 2.0.0
 * @category query
 */
export const queryCurrentEpochEffect = (cluster: Cluster): Effect.Effect<bigint, GenesisError> =>
  Effect.gen(function* () {
    const ContainerModule = yield* Effect.promise(() => import("./Container.js"))

    const output = yield* ContainerModule.execCommandEffect(cluster.cardanoNode, [
      "cardano-cli",
      "conway",
      "query",
      "tip",
      "--socket-path",
      "/opt/cardano/ipc/node.socket",
      "--testnet-magic",
      "42"
    ]).pipe(
      Effect.mapError(
        (e) =>
          new GenesisError({
            reason: "tip_query_failed",
            message: "Failed to query chain tip from node",
            cause: e
          })
      )
    )

    const parsed = yield* Effect.try({
      try: () => JSON.parse(output) as { epoch: number },
      catch: (e) =>
        new GenesisError({
          reason: "tip_parse_failed",
          message: "Failed to parse chain tip output from cardano-cli",
          cause: e
        })
    })

    return BigInt(parsed.epoch)
  })

/**
 * Query current epoch from node, throws on error.
 *
 * @since 2.0.0
 * @category genesis
 */
export const queryCurrentEpoch = (cluster: Cluster) => Effect.runPromise(queryCurrentEpochEffect(cluster))
