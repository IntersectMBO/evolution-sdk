import { Plan } from "@evolution-sdk/plan"
import { Data, Effect } from "effect"

/**
 * A CIP-113 byte operation refused its input.
 *
 * The encoders are total over well-formed input, so this is reached only by malformed hex or
 * an out-of-range index. It carries the operation name because the alternative — one opaque
 * failure for two dozen encoders — makes the first field that is wrong indistinguishable
 * from the last.
 *
 * @since 0.1.0
 */
export class Cip113Error extends Data.TaggedError("Cip113Error")<{
  readonly op: string
  readonly message: string
}> {}

/** Run a byte operation, turning its throw into a named `Cip113Error`. */
export const op = <A>(name: string, f: () => A): Effect.Effect<A, Cip113Error> =>
  Effect.try({
    try: f,
    catch: (e) => new Cip113Error({ op: name, message: e instanceof Error ? e.message : String(e) })
  })

/**
 * The plan builder is SYNCHRONOUS here and throws — `InsufficientError`, `TxTooLargeError`,
 * `ValueTooLargeError`. The CIP-113 builders promise a typed `BuildError`, so the throw is
 * caught at the one place it can happen rather than being allowed to escape as a defect.
 */
export const planAttempt = <A>(f: () => A): Effect.Effect<A, Plan.BuildError> =>
  Effect.try({
    try: f,
    catch: (e) => new Plan.BuildError({ reason: e instanceof Error ? e.message : String(e) })
  })
