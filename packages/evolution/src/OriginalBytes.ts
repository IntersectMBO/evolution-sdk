/**
 * Keeps the exact bytes a value was decoded from.
 *
 * The ledger hashes and signs the original bytes of a value, not a fresh
 * encoding of it. A decoder records the bytes it read against the object it
 * returns. An encoder that finds recorded bytes for the object it is given
 * writes those bytes back unchanged. A new or edited value is a new object,
 * so it has no recorded bytes and gets the default encoding.
 *
 * Entries are held in a WeakMap, so they are released with their object.
 *
 * @since 2.0.0
 */

const cache = new WeakMap<object, Uint8Array>()

/**
 * Record the bytes that `value` was decoded from. The bytes are copied, so a
 * caller that later changes its input buffer does not change the record.
 *
 * @since 2.0.0
 * @category cache
 */
export const record = <A extends object>(value: A, bytes: Uint8Array): A => {
  cache.set(value, bytes.slice())
  return value
}

/**
 * Get the bytes that `value` was decoded from, if any were recorded.
 *
 * @since 2.0.0
 * @category cache
 */
export const get = (value: object): Uint8Array | undefined => cache.get(value)
