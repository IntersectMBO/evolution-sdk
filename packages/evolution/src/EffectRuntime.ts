import { Cause, Effect, Exit } from "effect"

/**
 * Run an Effect synchronously, extracting the original error on failure.
 *
 * Uses `Cause.squash` to unwrap the Effect failure cause, preserving the
 * original error identity (`instanceof`, `_tag`, etc.) instead of wrapping
 * it in Effect's internal `FiberFailure`.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect"
 * import { runEffect } from "@evolution-sdk/evolution/EffectRuntime"
 *
 * const myEffect = Effect.succeed(42)
 *
 * try {
 *   const result = runEffect(myEffect)
 *   console.log(result)
 * } catch (error) {
 *   // error is the original typed error — instanceof works
 *   console.error(error)
 * }
 * ```
 *
 * @since 2.0.0
 * @category utilities
 */
export function runEffect<A, E>(effect: Effect.Effect<A, E>): A {
  const exit = Effect.runSyncExit(effect)

  if (Exit.isFailure(exit)) {
    throw Cause.squash(exit.cause)
  }

  return exit.value
}

/**
 * Run an Effect asynchronously, extracting the original error on failure.
 *
 * Uses `Cause.squash` to unwrap the Effect failure cause, preserving the
 * original error identity (`instanceof`, `_tag`, etc.) instead of wrapping
 * it in Effect's internal `FiberFailure`.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect"
 * import { runEffectPromise } from "@evolution-sdk/evolution/EffectRuntime"
 *
 * const myEffect = Effect.succeed(42)
 *
 * async function example() {
 *   try {
 *     const result = await runEffectPromise(myEffect)
 *     console.log(result)
 *   } catch (error) {
 *     // error is the original typed error — instanceof works
 *     console.error(error)
 *   }
 * }
 * ```
 *
 * @since 2.0.0
 * @category utilities
 */
export async function runEffectPromise<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)

  if (Exit.isFailure(exit)) {
    throw Cause.squash(exit.cause)
  }

  return exit.value
}
