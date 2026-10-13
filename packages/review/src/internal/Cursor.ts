/**
 * The CBOR cursor the review tier reads transactions with.
 *
 * ⚠️ What is ours here is a **header reader** — twelve lines that take a major type and its
 * argument off the front of an item. Everything structural (nested containers, indefinite
 * lengths, where an item ends) comes from `CBOR.decodeItemWithOffset`, which is what
 * `Transaction.extractBodyBytes` uses. This is not a second CBOR parser.
 *
 * Why a cursor at all, when `CBOR.decodeItemWithOffset` already returns a value: a review
 * surface must show the **exact bytes** of each part of a transaction, because a span that
 * differs by one byte is a different transaction id. Decoding to a value tree and re-encoding
 * loses that, so the walk has to be positional.
 *
 * @since 0.1.0
 */

import { CBOR } from "@evolution-sdk/evolution"

export enum CborType {
  UnsignedInteger = 0,
  NegativeInteger = 1,
  Bytes = 2,
  Text = 3,
  Array = 4,
  Map = 5,
  Tag = 6,
  Special = 7
}

export enum Special {
  Bool = 0,
  Null = 1,
  Undefined = 2,
  Break = 3,
  Other = 4
}

export type Len = { readonly definite: number } | "indefinite"
export const len = (n: number): Len => ({ definite: n })

export class CborReadError extends Error {
  constructor(expected: string, got: string) {
    super(`cbor: expected ${expected}, got ${got}`)
  }
}

const byteAt = (bytes: Uint8Array, pos: number): number => {
  const b = bytes[pos]
  if (b === undefined) throw new CborReadError("a byte", `end of input at ${pos}`)
  return b
}

/**
 * `[header width, argument, major type]` for the item at `pos`.
 *
 * Definite forms only — an indefinite head throws, which is what the review rail was written
 * against: a length it cannot know up front is not something it can slice.
 */
export const readHead = (bytes: Uint8Array, pos: number): [number, bigint, number] => {
  const b0 = byteAt(bytes, pos)
  const major = b0 >> 5
  const ai = b0 & 0x1f
  const readBe = (n: number): bigint => {
    let v = 0n
    for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(byteAt(bytes, pos + 1 + i))
    return v
  }
  if (ai <= 23) return [1, BigInt(ai), major]
  if (ai === 24) return [2, readBe(1), major]
  if (ai === 25) return [3, readBe(2), major]
  if (ai === 26) return [5, readBe(4), major]
  if (ai === 27) return [9, readBe(8), major]
  throw new CborReadError("definite-length cbor head", `additional-info ${ai}`)
}

/** Length in bytes of the complete item at `pos` — Evolution's walk, not ours. */
export const itemLen = (bytes: Uint8Array, pos: number): number => CBOR.decodeItemWithOffset(bytes, pos).newOffset - pos

export const skipItem = (bytes: Uint8Array, ref: { pos: number }): void => {
  ref.pos += itemLen(bytes, ref.pos)
}

/** A definite bytestring at `ref.pos`, advancing past it. `undefined` when it is not one. */
export const readBstr = (bytes: Uint8Array, ref: { pos: number }): Uint8Array | undefined => {
  const [h, l, m] = readHead(bytes, ref.pos)
  if (m !== 2) return undefined
  const start = ref.pos + h
  const end = start + Number(l)
  if (end > bytes.length) return undefined
  ref.pos = end
  return bytes.slice(start, end)
}

/**
 * A cursor over a CBOR buffer.
 *
 * Each accessor asserts the major type it expects and advances past the item, so a reader walks
 * a structure positionally — which is what byte-exact slicing needs, and what decoding straight
 * to a value tree throws away.
 */
export class Deserializer {
  private pos = 0

  private constructor(private readonly buf: Uint8Array) {}

  static from(bytes: Uint8Array): Deserializer {
    return new Deserializer(bytes)
  }

  private head(): { major: number; ai: number; arg: bigint; width: number; indefinite: boolean } {
    const b0 = byteAt(this.buf, this.pos)
    const ai = b0 & 0x1f
    if (ai === 31) return { major: b0 >> 5, ai, arg: 0n, width: 1, indefinite: true }
    const [width, arg, major] = readHead(this.buf, this.pos)
    return { major, ai, arg, width, indefinite: false }
  }

  cborType(): CborType {
    return (byteAt(this.buf, this.pos) >> 5) as CborType
  }

  position(): number {
    return this.pos
  }

  skip(n: number): void {
    this.pos += n
  }

  skipValue(): void {
    this.pos += itemLen(this.buf, this.pos)
  }

  private expect(major: number, what: string) {
    const h = this.head()
    if (h.major !== major) throw new CborReadError(what, `major ${h.major}`)
    return h
  }

  unsignedInteger(): bigint {
    const h = this.expect(0, "unsigned integer")
    this.pos += h.width
    return h.arg
  }

  negativeInteger(): bigint {
    const h = this.expect(1, "negative integer")
    this.pos += h.width
    return -1n - h.arg
  }

  tag(): bigint {
    const h = this.expect(6, "tag")
    this.pos += h.width
    return h.arg
  }

  array(): Len {
    const h = this.expect(4, "array")
    this.pos += h.width
    return h.indefinite ? "indefinite" : len(Number(h.arg))
  }

  map(): Len {
    const h = this.expect(5, "map")
    this.pos += h.width
    return h.indefinite ? "indefinite" : len(Number(h.arg))
  }

  special(): Special {
    const h = this.expect(7, "special")
    this.pos += h.width
    if (h.indefinite) return Special.Break
    if (h.ai === 20 || h.ai === 21) return Special.Bool
    if (h.ai === 22) return Special.Null
    if (h.ai === 23) return Special.Undefined
    return Special.Other
  }

  /** A boolean including its value — `special()` reports `Bool` for both 0xf4 and 0xf5. */
  bool(): boolean {
    const b0 = byteAt(this.buf, this.pos)
    const v = this.special()
    if (v !== Special.Bool) throw new CborReadError("bool", `special ${v}`)
    return (b0 & 0x1f) === 21
  }

  /** The bytestring at the cursor. Evolution decodes it, so an indefinite one arrives joined. */
  bytes(): Uint8Array {
    this.expect(2, "bytes")
    const { item, newOffset } = CBOR.decodeItemWithOffset(this.buf, this.pos)
    if (!(item instanceof Uint8Array)) throw new CborReadError("bytes", typeof item)
    this.pos = newOffset
    return item
  }

  text(): string {
    this.expect(3, "text")
    const { item, newOffset } = CBOR.decodeItemWithOffset(this.buf, this.pos)
    if (typeof item !== "string") throw new CborReadError("text", typeof item)
    this.pos = newOffset
    return item
  }
}

/**
 * Has a container been fully consumed? For a definite length it is a count; for an indefinite
 * one it is the break byte, which this consumes when it finds it.
 */
export const collectionDone = (rd: Deserializer, l: Len, i: number): boolean => {
  if (l !== "indefinite") return i >= l.definite
  if (rd.cborType() === CborType.Special) {
    rd.special()
    return true
  }
  return false
}
