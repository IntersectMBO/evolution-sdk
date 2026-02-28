import Docker from "dockerode"
import { Data, Effect } from "effect"
import { PassThrough } from "stream"

import * as Config from "./Config.js"
import * as Images from "./Images.js"

export class ContainerError extends Data.TaggedError("ContainerError")<{
  reason: string
  message: string
  cause?: unknown
}> {}

export interface Container {
  readonly id: string
  readonly name: string
}

/**
 * Start a specific devnet container.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const startEffect = (container: Container): Effect.Effect<void, ContainerError> =>
  Effect.tryPromise({
    try: () => new Docker().getContainer(container.id).start(),
    catch: (cause) =>
      new ContainerError({
        reason: "container_start_failed",
        message: "Check if ports are available and Docker has sufficient resources.",
        cause
      })
  })

/**
 * Start a specific devnet container, throws on error.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const start = (container: Container) => Effect.runPromise(startEffect(container))

/**
 * Stop a specific devnet container.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const stopEffect = (container: Container): Effect.Effect<void, ContainerError> =>
  Effect.gen(function* () {
    const docker = new Docker()
    const dockerContainer = docker.getContainer(container.id)

    const info = yield* Effect.tryPromise({
      try: () => dockerContainer.inspect(),
      catch: (cause) =>
        new ContainerError({
          reason: "container_inspection_failed",
          message: "The container may have been removed externally.",
          cause
        })
    })

    if (info.State.Running) {
      yield* Effect.tryPromise({
        try: () => dockerContainer.stop(),
        catch: (cause) =>
          new ContainerError({
            reason: "container_stop_failed",
            message: "Try force stopping with 'docker stop --force' or restart Docker.",
            cause
          })
      })
    }
  })

/**
 * Stop a specific devnet container, throws on error.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const stop = (container: Container) => Effect.runPromise(stopEffect(container))

/**
 * Remove a specific devnet container.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const removeEffect = (container: Container): Effect.Effect<void, ContainerError> =>
  Effect.gen(function* () {
    yield* stopEffect(container)

    yield* Effect.tryPromise({
      try: () => new Docker().getContainer(container.id).remove(),
      catch: (cause) =>
        new ContainerError({
          reason: "container_removal_failed",
          message: "Ensure the container is stopped and no volumes are in use.",
          cause
        })
    })
  })

/**
 * Remove a specific devnet container, throws on error.
 *
 * @since 2.0.0
 * @category lifecycle
 */
export const remove = (container: Container) => Effect.runPromise(removeEffect(container))

/**
 * Get container status information.
 *
 * @since 2.0.0
 * @category inspection
 */
export const getStatusEffect = (
  container: Container
): Effect.Effect<Docker.ContainerInspectInfo | undefined, ContainerError> =>
  Effect.tryPromise({
    try: () => new Docker().getContainer(container.id).inspect(),
    catch: (cause) =>
      new ContainerError({
        reason: "container_inspection_failed",
        message: "The container may be corrupted or inaccessible.",
        cause
      })
  })

/**
 * Get container status information, throws on error.
 *
 * @since 2.0.0
 * @category inspection
 */
export const getStatus = (container: Container) => Effect.runPromise(getStatusEffect(container))

/**
 * Check if a Docker image is available locally.
 *
 * @since 2.0.0
 * @category image-management
 */
export const isImageAvailableEffect = (imageName: string) => Images.isAvailableEffect(imageName)

/**
 * Check if a Docker image is available locally, throws on error.
 *
 * @since 2.0.0
 * @category image-management
 */
export const isImageAvailable = (imageName: string) => Effect.runPromise(Images.isAvailableEffect(imageName))

/**
 * Pull a Docker image.
 *
 * @since 2.0.0
 * @category image-management
 */
export const downloadImageEffect = (imageName: string) => Images.pullEffect(imageName)

/**
 * Pull a Docker image, throws on error.
 *
 * @since 2.0.0
 * @category image-management
 */
export const downloadImage = (imageName: string) => Effect.runPromise(Images.pullEffect(imageName))

/**
 * Ensure image is available, pull if necessary.
 *
 * @since 2.0.0
 * @category image-management
 */
export const ensureImageAvailableEffect = (imageName: string) => Images.ensureAvailableEffect(imageName)

/**
 * Ensure image is available, pull if necessary. Throws on error.
 *
 * @since 2.0.0
 * @category image-management
 */
export const ensureImageAvailable = (imageName: string) => Effect.runPromise(Images.ensureAvailableEffect(imageName))

/**
 * Execute a command inside a container and return the stdout output.
 * Properly handles Docker's multiplexed streams.
 *
 * @example
 * ```typescript
 * import * as Devnet from "@evolution-sdk/evolution-devnet"
 *
 * const output = await Devnet.Container.execCommand(cluster.cardanoNode, [
 *   "cardano-cli", "query", "tip",
 *   "--socket-path", "/opt/cardano/ipc/node.socket",
 *   "--testnet-magic", "42"
 * ])
 * const tipData = JSON.parse(output)
 * ```
 *
 * @since 2.0.0
 * @category execution
 */
export const execCommandEffect = (
  container: Container,
  command: Array<string>
): Effect.Effect<string, ContainerError> =>
  Effect.gen(function* () {
    const docker = new Docker()
    const dockerContainer = docker.getContainer(container.id)

    const exec = yield* Effect.tryPromise({
      try: () =>
        dockerContainer.exec({
          Cmd: command,
          AttachStdout: true,
          AttachStderr: true
        }),
      catch: (cause) =>
        new ContainerError({
          reason: "container_exec_failed",
          message: `Failed to create exec instance in container '${container.name}'.`,
          cause
        })
    })

    const stream = yield* Effect.tryPromise({
      try: () => exec.start({ Detach: false }),
      catch: (cause) =>
        new ContainerError({
          reason: "container_exec_failed",
          message: `Failed to start exec in container '${container.name}'.`,
          cause
        })
    })

    // Demux Docker stream to separate stdout/stderr and remove control characters
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    docker.modem.demuxStream(stream, stdout, stderr)

    let output = ""
    let _errorOutput = ""

    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })

    stderr.on("data", (chunk: Buffer) => {
      _errorOutput += chunk.toString()
    })

    yield* Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          stream.on("end", resolve)
        })
    )

    return output.trim()
  })

/**
 * Execute a command inside a container and return the stdout output. Throws on error.
 *
 * @since 2.0.0
 * @category execution
 */
export const execCommand = (container: Container, command: Array<string>) =>
  Effect.runPromise(execCommandEffect(container, command))

/**
 * Find a container by name.
 *
 * @since 2.0.0
 * @category utilities
 * @internal
 */
export const findContainerEffect = (
  containerName: string
): Effect.Effect<Docker.Container | undefined, ContainerError> =>
  Effect.tryPromise({
    try: () => {
      const docker = new Docker()
      return docker.listContainers({ all: true }).then((containers) => {
        const found = containers.find((c) => c.Names.includes(`/${containerName}`))
        return found ? docker.getContainer(found.Id) : undefined
      })
    },
    catch: (cause) =>
      new ContainerError({
        reason: "container_not_found",
        message: "Ensure Docker is running and accessible.",
        cause
      })
  })

/**
 * Create a cardano-node container.
 *
 * @since 2.0.0
 * @category constructors
 * @internal
 */
export const createCardanoContainerEffect = (
  config: Required<Config.DevNetConfig>,
  networkName: string,
  tempDir: string
): Effect.Effect<Docker.Container, ContainerError> =>
  Effect.tryPromise({
    try: () => {
      const docker = new Docker()
      const volumeName = `${config.clusterName}-ipc`
      return docker.createContainer({
        Image: config.image,
        name: `${config.clusterName}-cardano-node`,
        ExposedPorts: {
          [`${config.ports.node}/tcp`]: {},
          [`${config.ports.submit}/tcp`]: {}
        },
        HostConfig: {
          PortBindings: {
            [`${config.ports.node}/tcp`]: [{ HostPort: String(config.ports.node) }],
            [`${config.ports.submit}/tcp`]: [{ HostPort: String(config.ports.submit) }]
          },
          Binds: [
            `${tempDir}:/opt/cardano/config:ro`,
            `${tempDir}:/opt/cardano/keys:ro`,
            `${volumeName}:/opt/cardano/ipc`
          ]
        },
        Env: [
          `CARDANO_NODE_SOCKET_PATH=/opt/cardano/ipc/node.socket`,
          `CARDANO_BLOCK_PRODUCER=true`,
          `CARDANO_NETWORK_MAGIC=${config.networkMagic}`
        ],
        Cmd: [
          "run",
          "--topology",
          "/opt/cardano/config/topology.json",
          "--database-path",
          "/opt/cardano/data",
          "--socket-path",
          "/opt/cardano/ipc/node.socket",
          "--host-addr",
          "0.0.0.0",
          "--port",
          String(config.ports.node),
          "--config",
          "/opt/cardano/config/config.json",
          "--shelley-kes-key",
          "/opt/cardano/config/kes.skey",
          "--shelley-vrf-key",
          "/opt/cardano/config/vrf.skey",
          "--shelley-operational-certificate",
          "/opt/cardano/config/pool.cert"
        ]
      })
    },
    catch: (cause) =>
      new ContainerError({
        reason: "container_creation_failed",
        message: "Verify Docker daemon is running and the image is accessible.",
        cause
      })
  })

/**
 * Create a Kupo container.
 *
 * @since 2.0.0
 * @category constructors
 * @internal
 */
export const createKupoContainerEffect = (
  config: Required<Config.DevNetConfig>,
  networkName: string,
  tempDir: string
): Effect.Effect<Docker.Container | undefined, ContainerError> =>
  Effect.gen(function* () {
    if (!config.kupo.enabled) return undefined

    const docker = new Docker()
    const kupoName = `${config.clusterName}-kupo`
    const volumeName = `${config.clusterName}-ipc`

    const cmdArgs = [
      "--node-socket",
      "/ipc/node.socket",
      "--host",
      "0.0.0.0",
      "--port",
      String(config.kupo.port),
      "--log-level",
      config.kupo.logLevel || "Info",
      "--node-config",
      "/config/config.json",
      "--match",
      config.kupo.match || "*",
      "--since",
      config.kupo.since || "origin",
      "--workdir",
      "/db"
    ]

    if (config.kupo.deferDbIndexes) {
      cmdArgs.push("--defer-db-indexes")
    }

    return yield* Effect.tryPromise({
      try: () =>
        docker.createContainer({
          Image: config.kupo.image || Config.DEFAULT_KUPO_CONFIG.image,
          name: kupoName,
          ExposedPorts: {
            [`${config.kupo.port || Config.DEFAULT_KUPO_CONFIG.port}/tcp`]: {}
          },
          HostConfig: {
            PortBindings: {
              [`${config.kupo.port || Config.DEFAULT_KUPO_CONFIG.port}/tcp`]: [
                {
                  HostPort: String(config.kupo.port || Config.DEFAULT_KUPO_CONFIG.port)
                }
              ]
            },
            Binds: [`${tempDir}:/config:ro`, `${volumeName}:/ipc`]
          },
          Env: [`CARDANO_NETWORK=custom`, `CARDANO_NODE_SOCKET_PATH=/ipc/node.socket`],
          Cmd: cmdArgs
        }),
      catch: (cause) =>
        new ContainerError({
          reason: "kupo_container_creation_failed",
          message: "Failed to create Kupo container. Check Docker permissions and image availability.",
          cause
        })
    })
  })

/**
 * Create an Ogmios container.
 *
 * @since 2.0.0
 * @category constructors
 * @internal
 */
export const createOgmiosContainerEffect = (
  config: Required<Config.DevNetConfig>,
  networkName: string,
  tempDir: string
): Effect.Effect<Docker.Container | undefined, ContainerError> =>
  Effect.gen(function* () {
    if (!config.ogmios.enabled) return undefined

    const docker = new Docker()
    const ogmiosName = `${config.clusterName}-ogmios`
    const volumeName = `${config.clusterName}-ipc`

    return yield* Effect.tryPromise({
      try: () =>
        docker.createContainer({
          Image: config.ogmios.image || Config.DEFAULT_OGMIOS_CONFIG.image,
          name: ogmiosName,
          ExposedPorts: {
            [`${config.ogmios.port || Config.DEFAULT_OGMIOS_CONFIG.port}/tcp`]: {}
          },
          HostConfig: {
            PortBindings: {
              [`${config.ogmios.port || Config.DEFAULT_OGMIOS_CONFIG.port}/tcp`]: [
                {
                  HostPort: String(config.ogmios.port || Config.DEFAULT_OGMIOS_CONFIG.port)
                }
              ]
            },
            Binds: [`${tempDir}:/config:ro`, `${volumeName}:/ipc`]
          },
          Env: [`NETWORK=custom`, `CARDANO_NODE_SOCKET_PATH=/ipc/node.socket`],
          Cmd: [
            "--log-level",
            config.ogmios.logLevel || Config.DEFAULT_OGMIOS_CONFIG.logLevel,
            "--host",
            "0.0.0.0",
            "--port",
            String(config.ogmios.port || Config.DEFAULT_OGMIOS_CONFIG.port),
            "--node-socket",
            "/ipc/node.socket",
            "--node-config",
            "/config/config.json"
          ]
        }),
      catch: (cause) =>
        new ContainerError({
          reason: "ogmios_container_creation_failed",
          message: "Failed to create Ogmios container. Check Docker permissions and image availability.",
          cause
        })
    })
  })
