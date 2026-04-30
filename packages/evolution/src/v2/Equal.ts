/**
 * Equal — re-exports Effect's Equal with Uint8Array content comparison.
 *
 * `Equal.equals(bytes1, bytes2)` compares contents, not references.
 * Everything else delegates to Effect's Equal.
 *
 * @since 2.0.0
 * @module
 */

import { Equal as EffectEqual } from "effect"

import * as Bytes from "../Bytes.js"

export type { Equal } from "effect/Equal"
export { equivalence,isEqual, symbol } from "effect/Equal"

/**
 * Compare two values for equality.
 * Supports Uint8Array content comparison in addition to Effect's Equal.
 */
export function equals<B>(that: B): <A>(self: A) => boolean
export function equals<A, B>(self: A, that: B): boolean
export function equals(): any {
  if (arguments.length === 1) {
    const that = arguments[0]
    return (self: unknown) => _equals(self, that)
  }
  return _equals(arguments[0], arguments[1])
}

const _equals = (self: unknown, that: unknown): boolean => {
  if (self instanceof Uint8Array && that instanceof Uint8Array)
    return Bytes.equals(self, that)
  return EffectEqual.equals(self, that)
}
