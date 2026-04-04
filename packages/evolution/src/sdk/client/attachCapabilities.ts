/**
 * Internal helper for building composable client constructors.
 *
 * Centralizes the boilerplate that every provider/wallet constructor needs:
 * - Derives Promise methods from Effect methods via `Effect.runPromise`
 * - Derives AsyncIterable methods from Stream methods via `Stream.toAsyncIterable`
 * - Merges the Effect namespace
 * - Rebinds `newTx` and `with` to the new client object
 *
 * @internal
 * @module
 */

import { Effect, Stream } from "effect"

import { type Client, newTx } from "./Client.js"

/**
 * Attach Effect-based capabilities to a client, auto-deriving Promise methods.
 *
 * Each entry in `effects` becomes:
 * - A Promise method on the client: `client.getUtxos(addr)` → `Effect.runPromise(effects.getUtxos(addr))`
 * - An entry in `client.Effect`: `client.Effect.getUtxos(addr)` → the raw Effect
 *
 * Functions returning a `Stream` are auto-detected at call time and derive an
 * `AsyncIterable` via `Stream.toAsyncIterable`. `break` in `for await` triggers
 * stream cleanup.
 *
 * Also rebinds `newTx` and `with` to the augmented client.
 *
 * @internal
 */
export const attachCapabilities = <T extends Client, Caps>(
  c: T,
  effects: Record<string, (...args: Array<never>) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>>
): T & Caps => {
  const promiseMethods: Record<string, unknown> = {}
  for (const [key, fn] of Object.entries(effects)) {
    promiseMethods[key] = (...args: Array<unknown>) => {
      const result = (fn as (...a: Array<unknown>) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>)(...args)
      if (Stream.StreamTypeId in result) {
        return Stream.toAsyncIterable(result as Stream.Stream<unknown, unknown>)
      }
      return Effect.runPromise(result as Effect.Effect<unknown, unknown>)
    }
  }

  const result: Record<string, unknown> = {
    ...(c as Record<string, unknown>),
    ...promiseMethods,
    newTx: () => newTx(result as T & Caps),
    with: <R>(fn: (c: T & Caps) => R): R => fn(result as T & Caps),
    Effect: {
      ...(c.Effect as Record<string, unknown>),
      ...effects,
    },
  }
  return result as T & Caps
}
