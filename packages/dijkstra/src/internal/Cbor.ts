/**
 * The positional CBOR walk the body-field decoders read with.
 *
 * ⚠️ Everything structural — where an item ends, nested containers, indefinite lengths — comes
 * from `CBOR.decodeItemWithOffset`. What is local is a **header reader**, twelve lines taking a
 * major type and its argument off the front of an item, which a positional walk needs and a
 * decode-to-value does not give you.
 *
 * The walk has to be positional because `sub_transactions` (key 23) is reported as the **raw
 * CBOR of each nested transaction**: a nested body that is re-encoded is a different transaction
 * id, so the bytes have to survive the read.
 *
 * @since 0.1.0
 */

import { CBOR } from "@evolution-sdk/evolution"

/** @since 0.1.0 */
export interface Head {
  readonly major: number
  readonly info: number
  readonly value: bigint
  readonly next: number
  readonly indefinite: boolean
}

/** @since 0.1.0 */
export const readHead = (b: Uint8Array, o: number): Head => {
  const ib = b[o]
  if (ib === undefined) throw new Error(`cbor: end of input at ${o}`)
  const major = ib >> 5
  const info = ib & 0x1f
  let next = o + 1
  let value = 0n
  let indefinite = false
  if (info < 24) value = BigInt(info)
  else if (info === 24) {
    value = BigInt(b[next]!)
    next += 1
  } else if (info === 25) {
    value = (BigInt(b[next]!) << 8n) | BigInt(b[next + 1]!)
    next += 2
  } else if (info === 26) {
    for (let i = 0; i < 4; i++) value = (value << 8n) | BigInt(b[next + i]!)
    next += 4
  } else if (info === 27) {
    for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(b[next + i]!)
    next += 8
  } else if (info === 31) indefinite = true
  else throw new Error(`cbor: bad additional-info ${info} at ${o}`)
  return { major, info, value, next, indefinite }
}

/**
 * End offset of the complete item at `o`.
 *
 * ⚠️ This is one call, where the implementation it was ported from hand-rolled a tag case and
 * an indefinite-length case around it. Both were carried over, both were then shown inert by
 * mutation across the whole corpus, and `CBOR.decodeItemWithOffset` was checked directly on an
 * indefinite array, an indefinite map, a nested pair of them and a `#6.258` set: it returns the
 * end of a complete item in every one. Dead code in a CBOR walk is the kind that looks
 * load-bearing forever, so it is gone rather than kept "just in case".
 *
 * @since 0.1.0
 */
export const skip = (b: Uint8Array, o: number): number => CBOR.decodeItemWithOffset(b, o).newOffset

/**
 * The raw span of body-map field `key`, or `undefined` when the key is absent.
 *
 * @since 0.1.0
 */
export const field = (b: Uint8Array, key: number): { readonly start: number; readonly end: number } | undefined => {
  const head = readHead(b, 0)
  if (head.major !== 5) throw new Error("transaction body is not a CBOR map")
  let p = head.next
  const n = head.indefinite ? Number.POSITIVE_INFINITY : Number(head.value)
  for (let i = 0; i < n; i++) {
    if (head.indefinite && b[p] === 0xff) break
    const k = readHead(b, p)
    const vStart = k.next
    const vEnd = skip(b, vStart)
    if (k.major === 0 && Number(k.value) === key) return { start: vStart, end: vEnd }
    p = vEnd
  }
  return undefined
}

/** A definite array header as `[count, offsetAfterHead]`; unwraps a `#6.258` set tag. @since 0.1.0 */
export const arrayHead = (b: Uint8Array, o: number): [number, number] => {
  let h = readHead(b, o)
  if (h.major === 6) {
    o = h.next
    h = readHead(b, o)
  }
  if (h.major !== 4) throw new Error(`cbor: expected array, got major ${h.major}`)
  return [Number(h.value), h.next]
}

/** @since 0.1.0 */
export const mapHead = (b: Uint8Array, o: number): [number, number] => {
  const h = readHead(b, o)
  if (h.major !== 5) throw new Error(`cbor: expected map, got major ${h.major}`)
  return [Number(h.value), h.next]
}

/** @since 0.1.0 */
export const readBytes = (b: Uint8Array, o: number): [Uint8Array, number] => {
  const h = readHead(b, o)
  if (h.major !== 2) throw new Error(`cbor: expected bytes, got major ${h.major}`)
  return [b.subarray(h.next, h.next + Number(h.value)), h.next + Number(h.value)]
}

/** @since 0.1.0 */
export const readUint = (b: Uint8Array, o: number): [bigint, number] => {
  const h = readHead(b, o)
  if (h.major !== 0) throw new Error(`cbor: expected uint, got major ${h.major}`)
  return [h.value, h.next]
}

/** @since 0.1.0 */
export const isNull = (b: Uint8Array, o: number): boolean => b[o] === 0xf6
