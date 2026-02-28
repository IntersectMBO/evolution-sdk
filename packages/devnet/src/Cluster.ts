import { NodeStream } from "@effect/platform-node"
import Docker from "dockerode"
import { Data, Effect, Stream } from "effect"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import * as Config from "./Config.js"
import * as Container from "./Container.js"
import * as Images from "./Images.js"

export class ClusterError extends Data.TaggedError("ClusterError")<{
  reason: string
  message: string
  cause?: unknown
}> {}

export interface Cluster {
  readonly cardanoNode: Container.Container
  readonly kupo?: Container.Container | undefined
  readonly ogmios?: Container.Container | undefined
  readonly networkName: string
  /** The Shelley genesis config used by this cluster (needed for slot config) */
  readonly shelleyGenesis: Config.ShelleyGenesis
}

/**
 * Internal utilities for cluster operations.
 *
 * @internal
 */
const writeConfigFiles = (config: Required<Config.DevNetConfig>) =>
  Effect.gen(function* () {
    const tempDir = yield* Effect.tryPromise({
      try: () => fs.promises.mkdtemp(path.join(os.tmpdir(), "cardano-devnet-")),
      catch: (cause) =>
        new ClusterError({
          reason: "temp_directory_creation_failed",
          message: "Check if the system temp directory is writable.",
          cause
        })
    })

    const writeFile = (filename: string, content: unknown) =>
      Effect.tryPromise({
        try: () => fs.promises.writeFile(path.join(tempDir, filename), JSON.stringify(content, null, 2)),
        catch: (cause) =>
          new ClusterError({
            reason: "config_file_write_failed",
            message: `Ensure sufficient disk space and write permissions for ${filename}.`,
            cause
          })
      })

    const setFilePermissions = (filename: string, mode: number) =>
      Effect.tryPromise({
        try: () => fs.promises.chmod(path.join(tempDir, filename), mode),
        catch: (cause) =>
          new ClusterError({
            reason: "file_permissions_failed",
            message: `Check if the filesystem supports permission changes for ${filename}.`,
            cause
          })
      })

    const topology = {
      Producers: []
    } as const

    yield* Effect.all([
      writeFile("config.json", config.nodeConfig),
      writeFile("topology.json", topology),
      writeFile("genesis-byron.json", config.byronGenesis),
      writeFile("genesis-shelley.json", config.shelleyGenesis),
      writeFile("genesis-alonzo.json", config.alonzoGenesis),
      writeFile("genesis-conway.json", config.conwayGenesis),
      writeFile("kes.skey", config.kesKey),
      setFilePermissions("kes.skey", 0o600), // Owner read/write only
      writeFile("pool.cert", config.opCert),
      setFilePermissions("pool.cert", 0o600), // Owner read/write only
      writeFile("vrf.skey", config.vrfSkey),
      setFilePermissions("vrf.skey", 0o600) // Owner read/write only
    ])

    return tempDir
  })

/**
 * Create a new cardano devnet cluster with optional Kupo and Ogmios containers.
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeEffect = (config: Config.DevNetConfig = {}): Effect.Effect<Cluster, ClusterError> =>
  Effect.gen(function* () {
    const fullConfig: Required<Config.DevNetConfig> = {
      clusterName: config.clusterName ?? Config.DEFAULT_DEVNET_CONFIG.clusterName,
      image: config.image ?? Config.DEFAULT_DEVNET_CONFIG.image,
      ports: {
        ...Config.DEFAULT_DEVNET_CONFIG.ports,
        ...config.ports
      },
      networkMagic: config.networkMagic ?? Config.DEFAULT_DEVNET_CONFIG.networkMagic,
      nodeConfig: {
        ...Config.DEFAULT_DEVNET_CONFIG.nodeConfig,
        ...config.nodeConfig
      },
      byronGenesis: {
        ...Config.DEFAULT_DEVNET_CONFIG.byronGenesis,
        ...config.byronGenesis
      },
      shelleyGenesis: {
        ...Config.DEFAULT_DEVNET_CONFIG.shelleyGenesis,
        ...config.shelleyGenesis
      },
      alonzoGenesis: {
        ...Config.DEFAULT_DEVNET_CONFIG.alonzoGenesis,
        ...config.alonzoGenesis
      },
      conwayGenesis: {
        ...Config.DEFAULT_DEVNET_CONFIG.conwayGenesis,
        ...config.conwayGenesis
      },
      kesKey: {
        ...Config.DEFAULT_DEVNET_CONFIG.kesKey,
        ...config.kesKey
      },
      opCert: {
        ...Config.DEFAULT_DEVNET_CONFIG.opCert,
        ...config.opCert
      },
      vrfSkey: {
        ...Config.DEFAULT_DEVNET_CONFIG.vrfSkey,
        ...config.vrfSkey
      },
      kupo: {
        ...Config.DEFAULT_DEVNET_CONFIG.kupo,
        ...config.kupo
      },
      ogmios: {
        ...Config.DEFAULT_DEVNET_CONFIG.ogmios,
        ...config.ogmios
      }
    }

    const networkName = `${fullConfig.clusterName}-network`

    // Write configuration files
    const tempDir = yield* writeConfigFiles(fullConfig)

    // Remove existing containers if they exist
    const containerNames = [
      `${fullConfig.clusterName}-cardano-node`,
      `${fullConfig.clusterName}-kupo`,
      `${fullConfig.clusterName}-ogmios`
    ]

    for (const containerName of containerNames) {
      const existingContainer = yield* Container.findContainerEffect(containerName).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "container_not_found",
              message: "Error checking for existing containers",
              cause: e
            })
        )
      )
      if (existingContainer) {
        const info = yield* Effect.tryPromise({
          try: () => existingContainer.inspect(),
          catch: (cause) =>
            new ClusterError({
              reason: "container_inspection_failed",
              message: "The container may be in an invalid state.",
              cause
            })
        })

        if (info.State.Running) {
          yield* Effect.tryPromise({
            try: () => existingContainer.stop(),
            catch: (cause) =>
              new ClusterError({
                reason: "container_stop_failed",
                message: "Try manually stopping the container or restarting Docker.",
                cause
              })
          })
        }

        yield* Effect.tryPromise({
          try: () => existingContainer.remove(),
          catch: (cause) =>
            new ClusterError({
              reason: "container_removal_failed",
              message: "Ensure no processes are using the container.",
              cause
            })
        })
      }
    }

    // Ensure Docker images are available (pull if necessary)
    yield* Images.ensureAvailableEffect(fullConfig.image).pipe(
      Effect.mapError(
        (e) =>
          new ClusterError({
            reason: "image_pull_failed",
            message: "Failed to ensure cardano-node image is available",
            cause: e
          })
      )
    )

    if (fullConfig.kupo.enabled) {
      const kupoImage = fullConfig.kupo.image || Config.DEFAULT_KUPO_CONFIG.image
      yield* Images.ensureAvailableEffect(kupoImage).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "image_pull_failed",
              message: "Failed to ensure Kupo image is available",
              cause: e
            })
        )
      )
    }

    if (fullConfig.ogmios.enabled) {
      const ogmiosImage = fullConfig.ogmios.image || Config.DEFAULT_OGMIOS_CONFIG.image
      yield* Images.ensureAvailableEffect(ogmiosImage).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "image_pull_failed",
              message: "Failed to ensure Ogmios image is available",
              cause: e
            })
        )
      )
    }

    // Create containers
    const cardanoContainer = yield* Container.createCardanoContainerEffect(fullConfig, networkName, tempDir).pipe(
      Effect.mapError(
        (e) =>
          new ClusterError({
            reason: "container_creation_failed",
            message: "Failed to create cardano-node container",
            cause: e
          })
      )
    )
    const kupoContainer = yield* Container.createKupoContainerEffect(fullConfig, networkName, tempDir).pipe(
      Effect.mapError(
        (e) =>
          new ClusterError({
            reason: "kupo_container_creation_failed",
            message: "Failed to create Kupo container",
            cause: e
          })
      )
    )
    const ogmiosContainer = yield* Container.createOgmiosContainerEffect(fullConfig, networkName, tempDir).pipe(
      Effect.mapError(
        (e) =>
          new ClusterError({
            reason: "ogmios_container_creation_failed",
            message: "Failed to create Ogmios container",
            cause: e
          })
      )
    )

    return {
      cardanoNode: {
        id: cardanoContainer.id,
        name: `${fullConfig.clusterName}-cardano-node`
      },
      kupo: kupoContainer
        ? {
            id: kupoContainer.id,
            name: `${fullConfig.clusterName}-kupo`
          }
        : undefined,
      ogmios: ogmiosContainer
        ? {
            id: ogmiosContainer.id,
            name: `${fullConfig.clusterName}-ogmios`
          }
        : undefined,
      networkName,
      shelleyGenesis: fullConfig.shelleyGenesis as Config.ShelleyGenesis
    }
  })

/**
 * Create a new cardano devnet cluster, throws on error.
 *
 * @since 2.0.0
 * @category constructors
 */
export const make = (config: Config.DevNetConfig = {}) => Effect.runPromise(makeEffect(config))

/**
 * Start a devnet cluster (all containers).
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const startEffect = (cluster: Cluster): Effect.Effect<void, ClusterError> =>
  Effect.gen(function* () {
    // Start Cardano node first
    yield* Container.startEffect(cluster.cardanoNode).pipe(
      Effect.mapError(
        (e) =>
          new ClusterError({
            reason: "container_start_failed",
            message: "Failed to start cardano-node container",
            cause: e
          })
      )
    )
    const docker = new Docker().getContainer(cluster.cardanoNode.id)
    const awaitForBlockProduction = Effect.promise(() =>
      docker.logs({
        stdout: true,
        stderr: true,
        follow: true
      })
    ).pipe(
      Stream.fromEffect,
      Stream.flatMap((stream) =>
        NodeStream.fromReadable(
          () => stream,
          (error) =>
            new ClusterError({
              reason: "log_stream_failed",
              message: "Failed to read container logs",
              cause: error
            })
        )
      ),
      Stream.takeUntil(
        (line) =>
          line.toString().includes("Forge.Loop.AdoptedBlock") || line.toString().includes("Forge.Loop.NodeIsLeader")
      ),
      Stream.runDrain
    )
    yield* awaitForBlockProduction

    // Start child containers
    if (cluster.kupo) {
      yield* Container.startEffect(cluster.kupo).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "container_start_failed",
              message: "Failed to start Kupo container",
              cause: e
            })
        )
      )
    }
    if (cluster.ogmios) {
      yield* Container.startEffect(cluster.ogmios).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "container_start_failed",
              message: "Failed to start Ogmios container",
              cause: e
            })
        )
      )
    }
  })

/**
 * Start a devnet cluster, throws on error.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const start = (cluster: Cluster) => Effect.runPromise(startEffect(cluster))

/**
 * Stop a devnet cluster (all containers).
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const stopEffect = (cluster: Cluster): Effect.Effect<void, ClusterError> =>
  Effect.gen(function* () {
    // Stop child containers first
    if (cluster.kupo) {
      yield* Container.stopEffect(cluster.kupo).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "container_stop_failed",
              message: "Failed to stop Kupo container",
              cause: e
            })
        )
      )
    }
    if (cluster.ogmios) {
      yield* Container.stopEffect(cluster.ogmios).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "container_stop_failed",
              message: "Failed to stop Ogmios container",
              cause: e
            })
        )
      )
    }

    // Stop Cardano node last
    yield* Container.stopEffect(cluster.cardanoNode).pipe(
      Effect.mapError(
        (e) =>
          new ClusterError({
            reason: "container_stop_failed",
            message: "Failed to stop cardano-node container",
            cause: e
          })
      )
    )
  })

/**
 * Stop a devnet cluster, throws on error.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const stop = (cluster: Cluster) => Effect.runPromise(stopEffect(cluster))

/**
 * Remove a devnet cluster (all containers and network).
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const removeEffect = (cluster: Cluster): Effect.Effect<void, ClusterError> =>
  Effect.gen(function* () {
    // Remove containers (removeContainer stops them first)
    yield* Container.removeEffect(cluster.cardanoNode).pipe(
      Effect.mapError(
        (e) =>
          new ClusterError({
            reason: "container_removal_failed",
            message: "Failed to remove cardano-node container",
            cause: e
          })
      )
    )
    if (cluster.kupo) {
      yield* Container.removeEffect(cluster.kupo).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "container_removal_failed",
              message: "Failed to remove Kupo container",
              cause: e
            })
        )
      )
    }
    if (cluster.ogmios) {
      yield* Container.removeEffect(cluster.ogmios).pipe(
        Effect.mapError(
          (e) =>
            new ClusterError({
              reason: "container_removal_failed",
              message: "Failed to remove Ogmios container",
              cause: e
            })
        )
      )
    }
  })

/**
 * Remove a devnet cluster, throws on error.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const remove = (cluster: Cluster) => Effect.runPromise(removeEffect(cluster))

/**
 * Slot configuration type for Unix time to slot conversion.
 *
 * @since 2.0.0
 * @category model
 */
export interface SlotConfig {
  readonly zeroTime: bigint
  readonly zeroSlot: bigint
  readonly slotLength: number
}

/**
 * Extract slot configuration from a devnet cluster.
 *
 * This returns the slot config needed for converting Unix timestamps to slots
 * when using setValidity() or other time-based transaction operations.
 *
 * The slot config is derived from the cluster's Shelley genesis:
 * - zeroTime: Genesis system start time (in milliseconds)
 * - zeroSlot: Always 0 for devnets
 * - slotLength: Slot duration in milliseconds
 *
 * @example
 * ```typescript
 * import * as Cluster from "@evolution-sdk/devnet/Cluster"
 * import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
 *
 * const cluster = await Cluster.make({ ... })
 * const slotConfig = Cluster.getSlotConfig(cluster)
 *
 * const client = createClient({
 *   network: 0,
 *   slotConfig,
 *   provider: { type: "kupmios", kupoUrl: "...", ogmiosUrl: "..." },
 *   wallet: { type: "seed", mnemonic: "..." }
 * })
 * ```
 *
 * @since 2.0.0
 * @category utilities
 */
export const getSlotConfig = (cluster: Cluster): SlotConfig => {
  const genesis = cluster.shelleyGenesis
  // systemStart is ISO string, convert to Unix ms
  const zeroTime = BigInt(new Date(genesis.systemStart).getTime())
  // slotLength in genesis is in seconds, convert to ms
  const slotLength = genesis.slotLength * 1000
  return {
    zeroTime,
    zeroSlot: 0n,
    slotLength
  }
}
