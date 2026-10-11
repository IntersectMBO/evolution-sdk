/**
 * An incremental builder and sequential reader over {@link CBOR}.
 *
 * `CBOR.toCBORBytes` encodes a value you have already constructed. Some callers instead describe a
 * document as they walk it — a header, then a field, then a nested container — and constructing the
 * whole value tree first is awkward for them. `Serializer` gives those callers the append-as-you-go
 * shape while **the bytes are still produced by `CBOR`'s encoder**: writes accumulate a value and
 * its `CBORFormat`, and `finalize()` encodes through `toCBORBytesWithFormat`.
 *
 * ⚠️ This is deliberately **not** a second encoder. Two encoders in one library that must agree byte
 * for byte is a drift hazard, and the point of this module is to offer the API without taking it on.
 *
 * ## Not streaming
 *
 * Despite the append shape, nothing here streams: `finalize()` needs the whole document, and
 * `Deserializer` reads a buffer already wholly in memory. Callers that must emit before the value is
 * known, or consume input that does not fit in memory, need a different design.
 *
 * ## What this catches that a raw byte emitter does not
 *
 * A builder that writes header bytes straight to a buffer cannot tell that `writeArray(len(5))` was
 * followed by two items — it hands back malformed CBOR without a word. Here the declared length
 * drives the structure, so an unfinished container is a `finalize()` error rather than bytes a node
 * will reject later.
 *
 * ## Read side
 *
 * `Deserializer` parses item heads itself, because reading `array()` must report a length without
 * consuming the children, and `tag()` must report a tag and leave its content. It is lenient, as a
 * CBOR reader should be: non-minimal heads and indefinite containers are accepted. Whole-item skips
 * delegate to `CBOR.decodeItemWithOffsetAndFormat`.
 *
 * @since 2.0.0
 */

import * as CBOR from "./CBOR.js"

/**
 * Array/map length: a definite element count, or indefinite (`0x9f` / `0xbf`).
 *
 * @since 2.0.0
 * @category model
 */
export type Len = { readonly definite: number } | "indefinite"

/**
 * @since 2.0.0
 *
 * @since 2.0.0
 * @category constructors
 */
export const len = (n: number): Len => ({ definite: n })

/**
 * @since 2.0.0
 *
 * @since 2.0.0
 * @category constants
 */
export const INDEFINITE: Len = "indefinite"

/** Major-type classification reported by {@link Deserializer.cborType}. */
export enum CborType {
  UnsignedInteger = "UnsignedInteger",
  NegativeInteger = "NegativeInteger",
  Bytes = "Bytes",
  Text = "Text",
  Array = "Array",
  Map = "Map",
  Tag = "Tag",
  Special = "Special"
}

/** Major-7 simple values. */
export enum Special {
  Bool = "Bool",
  Null = "Null",
  Undefined = "Undefined",
  Break = "Break",
  Other = "Other"
}

/**
 * Raised for a misuse of the builder or a malformed read.
 *
 * @since 2.0.0
 * @category errors
 */
export class CBORBuilderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CBORBuilderError"
  }
}

const fail = (expected: string, got: string): never => {
  throw new CBORBuilderError(`cbor: expected ${expected}, got ${got}`)
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

type Pair = { value: CBOR.CBOR; format: CBOR.CBORFormat }

type Frame =
  | { kind: "array"; remaining: number | "indefinite"; items: Array<CBOR.CBOR>; formats: Array<CBOR.CBORFormat> }
  | {
      kind: "map"
      remaining: number | "indefinite"
      entries: Array<readonly [CBOR.CBOR, CBOR.CBOR]>
      formats: Array<readonly [CBOR.CBORFormat, CBOR.CBORFormat]>
      pending: Pair | undefined
    }
  | { kind: "tag"; tag: number }

/**
 * Builds a CBOR document by appending items, then encodes it through `CBOR`'s encoder.
 *
 * Writes that follow a container header are that container's children, and the container closes
 * when its declared length is satisfied — so the call sequence reads the way the bytes do.
 *
 * @since 2.0.0
 *
 * @category model
 */
export class Serializer {
  private readonly roots: Array<Pair> = []
  private readonly stack: Array<Frame> = []

  /** @since 2.0.0 */
  static newVec(): Serializer {
    return new Serializer()
  }

  /** Attach a completed item to the innermost open container, closing any it completes. */
  private push(value: CBOR.CBOR, format: CBOR.CBORFormat): this {
    let item: Pair = { value, format }
    for (;;) {
      const frame = this.stack[this.stack.length - 1]
      if (frame === undefined) {
        this.roots.push(item)
        return this
      }

      if (frame.kind === "tag") {
        this.stack.pop()
        item = {
          value: { _tag: "Tag", tag: frame.tag, value: item.value },
          format: { _tag: "tag", child: item.format }
        }
        continue
      }

      if (frame.kind === "array") {
        frame.items.push(item.value)
        frame.formats.push(item.format)
        if (frame.remaining !== "indefinite" && frame.items.length >= frame.remaining) {
          this.stack.pop()
          item = this.closeArray(frame)
          continue
        }
        return this
      }

      if (frame.pending === undefined) {
        frame.pending = item
        return this
      }
      frame.entries.push([frame.pending.value, item.value])
      frame.formats.push([frame.pending.format, item.format])
      frame.pending = undefined
      if (frame.remaining !== "indefinite" && frame.entries.length >= frame.remaining) {
        this.stack.pop()
        item = this.closeMap(frame)
        continue
      }
      return this
    }
  }

  private closeArray(frame: Extract<Frame, { kind: "array" }>): Pair {
    return {
      value: frame.items,
      format: {
        _tag: "array",
        children: frame.formats,
        ...(frame.remaining === "indefinite" ? { length: { tag: "indefinite" as const } } : {})
      }
    }
  }

  private closeMap(frame: Extract<Frame, { kind: "map" }>): Pair {
    if (frame.pending !== undefined) fail("a map value after its key", "end of map")
    return {
      value: new Map(frame.entries),
      format: {
        _tag: "map",
        entries: frame.formats,
        ...(frame.remaining === "indefinite" ? { length: { tag: "indefinite" as const } } : {})
      }
    }
  }

  /** @since 2.0.0 */
  writeUnsignedInteger(n: bigint | number): this {
    const v = BigInt(n)
    // Say which call was wrong: a negative here means a caller mixed up the sign.
    if (v < 0n) fail("unsigned integer >= 0", v.toString())
    return this.push(v, { _tag: "uint" })
  }

  /** `n` is the actual negative value (e.g. -5 → major 1, argument 4). @since 2.0.0 */
  writeNegativeInteger(n: bigint | number): this {
    const v = BigInt(n)
    if (v >= 0n) fail("negative integer < 0", v.toString())
    return this.push(v, { _tag: "nint" })
  }

  /** @since 2.0.0 */
  writeBytes(b: Uint8Array): this {
    return this.push(b, { _tag: "bytes" })
  }

  /** @since 2.0.0 */
  writeText(s: string): this {
    return this.push(s, { _tag: "text" })
  }

  /** @since 2.0.0 */
  writeArray(l: Len): this {
    if (l !== "indefinite" && l.definite === 0) {
      return this.push([], { _tag: "array", children: [] })
    }
    this.stack.push({
      kind: "array",
      remaining: l === "indefinite" ? "indefinite" : l.definite,
      items: [],
      formats: []
    })
    return this
  }

  /** @since 2.0.0 */
  writeMap(l: Len): this {
    if (l !== "indefinite" && l.definite === 0) {
      return this.push(new Map(), { _tag: "map", entries: [] })
    }
    this.stack.push({
      kind: "map",
      remaining: l === "indefinite" ? "indefinite" : l.definite,
      entries: [],
      formats: [],
      pending: undefined
    })
    return this
  }

  /** @since 2.0.0 */
  writeTag(t: bigint | number): this {
    const v = BigInt(t)
    if (v < 0n) fail("tag >= 0", v.toString())
    this.stack.push({ kind: "tag", tag: Number(v) })
    return this
  }

  /**
   * Write a major-7 simple value. `Special.Break` closes the innermost indefinite container, which
   * is what the `0xff` byte does on the wire.
   *
   * @since 2.0.0
   */
  writeSpecial(s: Special, value?: boolean): this {
    switch (s) {
      case Special.Null:
        return this.push(null, { _tag: "simple" })
      case Special.Undefined:
        return this.push(undefined, { _tag: "simple" })
      case Special.Bool:
        return this.push(value === true, { _tag: "simple" })
      case Special.Break: {
        const frame = this.stack[this.stack.length - 1]
        if (frame === undefined || frame.kind === "tag" || frame.remaining !== "indefinite") {
          throw new CBORBuilderError(
            `cbor: expected an open indefinite container to break, got ${frame === undefined ? "top level" : frame.kind}`
          )
        }
        this.stack.pop()
        const closed = frame.kind === "array" ? this.closeArray(frame) : this.closeMap(frame)
        return this.push(closed.value, closed.format)
      }
      default:
        return fail("a writable special", String(s))
    }
  }

  /**
   * Append already-encoded CBOR verbatim. The bytes are decoded with their format preserved and
   * re-encoded from it, so they survive the round trip unchanged while still being structurally
   * accounted for by any container they land in.
   *
   * @since 2.0.0
   */
  writeRaw(bytes: Uint8Array): this {
    let offset = 0
    while (offset < bytes.length) {
      const { format, item, newOffset } = CBOR.decodeItemWithOffsetAndFormat(bytes, offset)
      this.push(item, format)
      offset = newOffset
    }
    return this
  }

  /**
   * Encode everything written so far.
   *
   * @throws if a container is still open — a declared length that was never satisfied is a caller
   * bug, and emitting the truncated bytes would only move the failure to whoever reads them.
   * @since 2.0.0
   */
  finalize(): Uint8Array {
    if (this.stack.length > 0) {
      const frame = this.stack[this.stack.length - 1]!
      throw new CBORBuilderError(
        `cbor: finalize with ${this.stack.length} unclosed container(s); innermost is a ${frame.kind}`
      )
    }
    const parts = this.roots.map((r) => CBOR.toCBORBytesWithFormat(r.value, r.format))
    let total = 0
    for (const p of parts) total += p.length
    const out = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      out.set(p, off)
      off += p.length
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// Span scanning
// ---------------------------------------------------------------------------

/**
 * Read a definite-length item head at `pos`, without consuming the item.
 *
 * Returns `[headLength, argument, majorType]`. Callers that walk a structure by hand — a COSE_Sign1
 * parser stepping element by element, say — need the head's own width to advance past it, which a
 * whole-item decode does not report.
 *
 * Indefinite heads are refused: a caller asking for an argument has no use for a container whose
 * length is not stated.
 *
 * @since 2.0.0
 *
 * @category parsing
 */
export const readHead = (bytes: Uint8Array, pos: number): [number, bigint, number] => {
  const b0 = bytes[pos]
  if (b0 === undefined) throw new CBORBuilderError(`cbor: read past end of buffer at ${pos}`)
  const major = b0 >> 5
  const ai = b0 & 0x1f
  const readBe = (n: number): bigint => {
    let v = 0n
    for (let i = 0; i < n; i++) {
      const b = bytes[pos + 1 + i]
      if (b === undefined)
        throw new CBORBuilderError(`cbor: head at ${pos} claims ${n} argument bytes the buffer does not hold`)
      v = (v << 8n) | BigInt(b)
    }
    return v
  }
  if (ai <= 23) return [1, BigInt(ai), major]
  if (ai === 24) return [2, readBe(1), major]
  if (ai === 25) return [3, readBe(2), major]
  if (ai === 26) return [5, readBe(4), major]
  if (ai === 27) return [9, readBe(8), major]
  throw new CBORBuilderError(`cbor: expected a definite-length head, got additional-info ${ai}`)
}

/**
 * Byte length of the single complete item starting at `pos`.
 *
 * ⚠️ Measured by the **decoder**, not by a second scanner of its own. A span scanner that walks the
 * bytes independently is a second opinion about where an item ends, and the two disagreeing is a
 * live bug class: the span is what slices a body that then gets hashed and signed, so a scanner
 * more permissive than the decoder hands back a region the decoder would have rejected.
 *
 * @since 2.0.0
 *
 * @category parsing
 */
export const itemLen = (bytes: Uint8Array, pos: number): number => {
  const { newOffset } = CBOR.decodeItemWithOffset(bytes, pos)
  return newOffset - pos
}

// ---------------------------------------------------------------------------
// Deserializer
// ---------------------------------------------------------------------------

/**
 * Reads CBOR items in sequence from a buffer.
 *
 * Lenient on purpose: non-minimal heads and indefinite containers are accepted, matching what a
 * CBOR reader is supposed to do with input it did not produce.
 *
 * @since 2.0.0
 *
 * @category model
 */
export class Deserializer {
  private offset = 0

  constructor(private readonly buf: Uint8Array) {}

  /** @since 2.0.0 */
  static from(bytes: Uint8Array): Deserializer {
    return new Deserializer(bytes)
  }

  private byteAt(i: number): number {
    const b = this.buf[i]
    if (b === undefined) throw new CBORBuilderError(`cbor: read past end of buffer at ${i}`)
    return b
  }

  /** Read a head, returning its major type and argument, and advance past it. */
  private head(): { major: number; arg: bigint; indefinite: boolean } {
    const first = this.byteAt(this.offset)
    const major = (first >> 5) & 0x07
    const info = first & 0x1f
    this.offset += 1
    if (info < 24) return { major, arg: BigInt(info), indefinite: false }
    if (info === 31) return { major, arg: 0n, indefinite: true }
    const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0
    if (width === 0) fail("a valid cbor head", `additional info ${info}`)
    let arg = 0n
    for (let i = 0; i < width; i++) arg = (arg << 8n) | BigInt(this.byteAt(this.offset + i))
    this.offset += width
    return { major, arg, indefinite: false }
  }

  private peekMajor(): number {
    return (this.byteAt(this.offset) >> 5) & 0x07
  }

  private expect(major: number, what: string): { arg: bigint; indefinite: boolean } {
    const got = this.peekMajor()
    if (got !== major) fail(what, `major type ${got}`)
    const h = this.head()
    return { arg: h.arg, indefinite: h.indefinite }
  }

  /** @since 2.0.0 */
  cborType(): CborType {
    switch (this.peekMajor()) {
      case 0:
        return CborType.UnsignedInteger
      case 1:
        return CborType.NegativeInteger
      case 2:
        return CborType.Bytes
      case 3:
        return CborType.Text
      case 4:
        return CborType.Array
      case 5:
        return CborType.Map
      case 6:
        return CborType.Tag
      default:
        return CborType.Special
    }
  }

  /** @since 2.0.0 */
  unsignedInteger(): bigint {
    return this.expect(0, "an unsigned integer").arg
  }

  /** @since 2.0.0 */
  negativeInteger(): bigint {
    return -1n - this.expect(1, "a negative integer").arg
  }

  /** @since 2.0.0 */
  position(): number {
    return this.offset
  }

  /** @since 2.0.0 */
  skip(n: number): void {
    this.offset += n
  }

  /** Skip one complete item, however deeply nested. @since 2.0.0 */
  skipValue(): void {
    const { newOffset } = CBOR.decodeItemWithOffset(this.buf, this.offset)
    this.offset = newOffset
  }

  /** @since 2.0.0 */
  tag(): bigint {
    return this.expect(6, "a tag").arg
  }

  /** @since 2.0.0 */
  array(): Len {
    const { arg, indefinite } = this.expect(4, "an array")
    return indefinite ? "indefinite" : { definite: Number(arg) }
  }

  /** @since 2.0.0 */
  map(): Len {
    const { arg, indefinite } = this.expect(5, "a map")
    return indefinite ? "indefinite" : { definite: Number(arg) }
  }

  /** @since 2.0.0 */
  special(): Special {
    const first = this.byteAt(this.offset)
    if (((first >> 5) & 0x07) !== 7) fail("a special", `major type ${(first >> 5) & 0x07}`)
    this.offset += 1
    switch (first & 0x1f) {
      case 20:
      case 21:
        return Special.Bool
      case 22:
        return Special.Null
      case 23:
        return Special.Undefined
      case 31:
        return Special.Break
      default:
        return Special.Other
    }
  }

  /** @since 2.0.0 */
  bool(): boolean {
    const first = this.byteAt(this.offset)
    if (first !== 0xf4 && first !== 0xf5) fail("a boolean", `byte 0x${first.toString(16)}`)
    this.offset += 1
    return first === 0xf5
  }

  /** @since 2.0.0 */
  bytes(): Uint8Array {
    const { arg, indefinite } = this.expect(2, "a byte string")
    if (!indefinite) {
      const n = Number(arg)
      const out = this.buf.slice(this.offset, this.offset + n)
      if (out.length !== n) fail(`${n} bytes`, `${out.length}`)
      this.offset += n
      return out
    }
    const chunks: Array<Uint8Array> = []
    for (;;) {
      if (this.byteAt(this.offset) === 0xff) {
        this.offset += 1
        break
      }
      chunks.push(this.bytes())
    }
    let total = 0
    for (const c of chunks) total += c.length
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      out.set(c, off)
      off += c.length
    }
    return out
  }

  /** @since 2.0.0 */
  text(): string {
    const { arg, indefinite } = this.expect(3, "a text string")
    if (!indefinite) {
      const n = Number(arg)
      const slice = this.buf.slice(this.offset, this.offset + n)
      if (slice.length !== n) fail(`${n} bytes of text`, `${slice.length}`)
      this.offset += n
      return new TextDecoder().decode(slice)
    }
    let out = ""
    for (;;) {
      if (this.byteAt(this.offset) === 0xff) {
        this.offset += 1
        break
      }
      out += this.text()
    }
    return out
  }
}
