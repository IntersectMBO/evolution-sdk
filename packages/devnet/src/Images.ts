import Docker from "dockerode"
import { Data, Effect } from "effect"

export class ImageError extends Data.TaggedError("ImageError")<{
  reason: string
  message: string
  cause?: unknown
}> {}

/**
 * Check if a Docker image exists locally.
 *
 * @since 2.0.0
 * @category inspection
 */
export const isAvailableEffect = (imageName: string) =>
  Effect.tryPromise({
    try: () => {
      const docker = new Docker()
      return docker.listImages({ filters: { reference: [imageName] } }).then((images) => images.length > 0)
    },
    catch: (cause) =>
      new ImageError({
        reason: "image_inspection_failed",
        message: `Failed to check if image '${imageName}' is available.`,
        cause
      })
  })

/**
 * Check if a Docker image exists locally, throws on error.
 *
 * @since 2.0.0
 * @category inspection
 */
export const isAvailable = (imageName: string) => Effect.runPromise(isAvailableEffect(imageName))

/**
 * Pull a Docker image with progress logging.
 *
 * @since 2.0.0
 * @category management
 */
export const pullEffect = (imageName: string) =>
  Effect.gen(function* () {
    const docker = new Docker()

    // eslint-disable-next-line no-console
    console.log(`[Devnet] Pulling Docker image: ${imageName}`)
    // eslint-disable-next-line no-console
    console.log(`[Devnet] This may take a few minutes on first run...`)

    const stream = yield* Effect.tryPromise({
      try: () => docker.pull(imageName),
      catch: (cause) =>
        new ImageError({
          reason: "image_pull_failed",
          message: `Failed to pull image '${imageName}'. Check internet connection and image name.`,
          cause
        })
    })

    // Wait for pull to complete
    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          docker.modem.followProgress(
            stream,
            (err: Error | null) => {
              if (err) reject(err)
              else resolve()
            },
            (event: { status?: string; progress?: string; id?: string }) => {
              // Optional: Log progress
              if (event.status === "Downloading" || event.status === "Extracting") {
                // Silent progress - only show completion
              } else if (event.status) {
                // eslint-disable-next-line no-console
                console.log(`[Devnet] ${event.status}${event.id ? ` ${event.id}` : ""}`)
              }
            }
          )
        }),
      catch: (cause) =>
        new ImageError({
          reason: "image_pull_failed",
          message: `Failed to complete image pull for '${imageName}'.`,
          cause
        })
    })

    // eslint-disable-next-line no-console
    console.log(`[Devnet] ✓ Image ready: ${imageName}`)
  })

/**
 * Pull a Docker image, throws on error.
 *
 * @since 2.0.0
 * @category management
 */
export const pull = (imageName: string) => Effect.runPromise(pullEffect(imageName))

/**
 * Ensure image is available, pull if necessary.
 *
 * @since 2.0.0
 * @category management
 */
export const ensureAvailableEffect = (imageName: string) =>
  Effect.gen(function* () {
    const available = yield* isAvailableEffect(imageName)

    if (!available) {
      yield* pullEffect(imageName)
    }
  })

/**
 * Ensure image is available, pull if necessary. Throws on error.
 *
 * @since 2.0.0
 * @category management
 */
export const ensureAvailable = (imageName: string) => Effect.runPromise(ensureAvailableEffect(imageName))
