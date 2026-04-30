/**
 * CborWriter — pre-allocated buffer CBOR encoder with format preservation.
 *
 * Primary API: `CborWriter` class with optional `EncodingProfile`.
 * Format preservation via module-level WeakMap cache — decode captures
 * raw bytes + format hints, encode checks cache and emits accordingly.
 *
 * @since 2.0.0
 * @module
 */

// ============================================================================
// Encoding profiles
// ============================================================================

const textEncoder = new TextEncoder()

/**
 * Encoding profile — controls default encoding style for fresh objects.
 *
 * @since 2.0.0
 * @category model
 */
export interface EncodingProfile {
  /** Use indefinite-length arrays by default. */
  readonly indefiniteArrays: boolean
  /** Use indefinite-length maps by default. */
  readonly indefiniteMaps: boolean
  /** Use minimal integer encoding. */
  readonly minimalEncoding: boolean
  /** Sort map keys by CBOR canonical order. */
  readonly sortMapKeys: boolean
  /** Force definite encoding for empty containers even when indefinite is default. */
  readonly useDefiniteForEmpty: boolean
}

/**
 * Canonical CBOR (RFC 8949 Section 4.2.1).
 *
 * @since 2.0.0
 * @category profiles
 */
export const CANONICAL: EncodingProfile = {
  indefiniteArrays: false,
  indefiniteMaps: false,
  minimalEncoding: true,
  sortMapKeys: true,
  useDefiniteForEmpty: true,
}

/**
 * CML default — definite containers, minimal encoding, insertion-order keys.
 *
 * @since 2.0.0
 * @category profiles
 */
export const CML: EncodingProfile = {
  indefiniteArrays: false,
  indefiniteMaps: false,
  minimalEncoding: true,
  sortMapKeys: false,
  useDefiniteForEmpty: true,
}

/**
 * PlutusData — indefinite containers, minimal encoding.
 *
 * @since 2.0.0
 * @category profiles
 */
export const PLUTUS_DATA: EncodingProfile = {
  indefiniteArrays: true,
  indefiniteMaps: true,
  minimalEncoding: true,
  sortMapKeys: false,
  useDefiniteForEmpty: true,
}

/**
 * Aiken-compatible — indefinite containers, minimal encoding.
 *
 * @since 2.0.0
 * @category profiles
 */
export const AIKEN: EncodingProfile = {
  indefiniteArrays: true,
  indefiniteMaps: true,
  minimalEncoding: true,
  sortMapKeys: false,
  useDefiniteForEmpty: true,
}

/**
 * Cardano Node format — definite containers, minimal encoding.
 *
 * @since 2.0.0
 * @category profiles
 */
export const CARDANO_NODE: EncodingProfile = {
  indefiniteArrays: false,
  indefiniteMaps: false,
  minimalEncoding: true,
  sortMapKeys: false,
  useDefiniteForEmpty: true,
}

// ============================================================================
// Format preservation types
// ============================================================================

/**
 * Per-field encoding format. All fields optional — absent means minimal.
 *
 * @since 2.0.0
 * @category model
 */
export interface FieldFormat {
  /** Integer/tag argument byte width. */
  readonly byteSize?: 0 | 1 | 2 | 4 | 8
  /** Whether byte/text string or container uses indefinite encoding. */
  readonly indefinite?: boolean
  /** Chunk sizes for indefinite byte/text strings. */
  readonly chunks?: ReadonlyArray<number>
}

/**
 * Container + field encoding style. Captured during decode, used during encode.
 *
 * @since 2.0.0
 * @category model
 */
export interface FormatHint {
  /** Whether container uses indefinite-length encoding. */
  readonly indefinite: boolean
  /** Byte width of the container header (map/array count). */
  readonly headerWidth?: 0 | 1 | 2 | 4 | 8
  /** Original key order for maps. */
  readonly keyOrder?: ReadonlyArray<unknown>
  /** Per-field format metadata, keyed by field name or map key. */
  readonly fields?: ReadonlyMap<string | number | bigint, FieldFormat>
}

/**
 * Preserved encoding info for a decoded object.
 *
 * @since 2.0.0
 * @category model
 */
export interface Preserved {
  /** Exact bytes — emit verbatim if object reference unchanged. */
  readonly raw?: Uint8Array
  /** Encoding style — used when object is modified but format should be preserved. */
  readonly hint?: FormatHint
}

// ============================================================================
// Format preservation cache (module-level, shared across writer instances)
// ============================================================================

const cache = new WeakMap<object, Preserved>()

/**
 * Capture raw bytes and/or format hint for a decoded object.
 *
 * @since 2.0.0
 * @category capture
 */
export const capture = (obj: object, raw?: Uint8Array, hint?: FormatHint): void => {
  cache.set(obj, { raw, hint })
}

/**
 * Get the preserved info for an object.
 *
 * @since 2.0.0
 * @category read
 */
export const getPreserved = (obj: object): Preserved | undefined =>
  cache.get(obj)

/**
 * Get the format hint for an object.
 *
 * @since 2.0.0
 * @category read
 */
export const getFormat = (obj: object): FormatHint | undefined =>
  cache.get(obj)?.hint

/**
 * Get field format for a specific field on an object.
 *
 * @since 2.0.0
 * @category read
 */
export const getFieldFormat = (obj: object, fieldKey: string | number | bigint): FieldFormat | undefined =>
  cache.get(obj)?.hint?.fields?.get(fieldKey)

/**
 * Propagate format hint from source to target (not raw bytes).
 *
 * @since 2.0.0
 * @category propagate
 */
export const propagateHint = (source: object, target: object): void => {
  const hint = cache.get(source)?.hint
  if (hint) cache.set(target, { hint })
}

// ============================================================================
// CborWriter class
// ============================================================================

export class CborWriter {
  private buf: Uint8Array
  private pos: number
  readonly profile: EncodingProfile

  constructor(initialSize = 64, profile: EncodingProfile = CML) {
    this.buf = new Uint8Array(initialSize)
    this.pos = 0
    this.profile = profile
  }

  /** Reset buffer position for a new encode. Returns this for chaining. */
  reset(): this { this.pos = 0; return this }

  private ensure(needed: number): void {
    if (this.pos + needed > this.buf.length) {
      const newSize = Math.max(this.buf.length * 2, this.pos + needed)
      const newBuf = new Uint8Array(newSize)
      newBuf.set(this.buf.subarray(0, this.pos))
      this.buf = newBuf
    }
  }

  private writeHeader(majorType: number, length: number): void {
    const mt = majorType << 5
    if (length < 24) {
      this.ensure(1); this.buf[this.pos++] = mt | length
    } else if (length < 256) {
      this.ensure(2); this.buf[this.pos++] = mt | 24; this.buf[this.pos++] = length
    } else if (length < 65536) {
      this.ensure(3); this.buf[this.pos++] = mt | 25; this.buf[this.pos++] = length >> 8; this.buf[this.pos++] = length & 0xff
    } else if (length < 4294967296) {
      this.ensure(5); this.buf[this.pos++] = mt | 26
      this.buf[this.pos++] = (length >> 24) & 0xff; this.buf[this.pos++] = (length >> 16) & 0xff
      this.buf[this.pos++] = (length >> 8) & 0xff; this.buf[this.pos++] = length & 0xff
    }
  }

  // --------------------------------------------------------------------------
  // Primitive writers
  // --------------------------------------------------------------------------

  writeUint(value: bigint): void {
    if (value < 24n) { this.ensure(1); this.buf[this.pos++] = Number(value) }
    else if (value < 256n) { this.ensure(2); this.buf[this.pos++] = 24; this.buf[this.pos++] = Number(value) }
    else if (value < 65536n) { this.ensure(3); const n = Number(value); this.buf[this.pos++] = 25; this.buf[this.pos++] = n >> 8; this.buf[this.pos++] = n & 0xff }
    else if (value < 4294967296n) {
      this.ensure(5); const n = Number(value); this.buf[this.pos++] = 26
      this.buf[this.pos++] = (n >> 24) & 0xff; this.buf[this.pos++] = (n >> 16) & 0xff; this.buf[this.pos++] = (n >> 8) & 0xff; this.buf[this.pos++] = n & 0xff
    } else {
      this.ensure(9); const low = Number(value & 0xffffffffn); const high = Number(value >> 32n)
      this.buf[this.pos++] = 27
      this.buf[this.pos++] = (high >> 24) & 0xff; this.buf[this.pos++] = (high >> 16) & 0xff; this.buf[this.pos++] = (high >> 8) & 0xff; this.buf[this.pos++] = high & 0xff
      this.buf[this.pos++] = (low >> 24) & 0xff; this.buf[this.pos++] = (low >> 16) & 0xff; this.buf[this.pos++] = (low >> 8) & 0xff; this.buf[this.pos++] = low & 0xff
    }
  }

  /** Write unsigned integer from a JS number. Avoids BigInt comparison overhead. */
  writeSmallUint(value: number): void {
    if (value < 24) { this.ensure(1); this.buf[this.pos++] = value }
    else if (value < 256) { this.ensure(2); this.buf[this.pos++] = 24; this.buf[this.pos++] = value }
    else if (value < 65536) { this.ensure(3); this.buf[this.pos++] = 25; this.buf[this.pos++] = value >> 8; this.buf[this.pos++] = value & 0xff }
    else { this.ensure(5); this.buf[this.pos++] = 26; this.buf[this.pos++] = (value >> 24) & 0xff; this.buf[this.pos++] = (value >> 16) & 0xff; this.buf[this.pos++] = (value >> 8) & 0xff; this.buf[this.pos++] = value & 0xff }
  }

  writeNint(value: bigint): void {
    const pv = -value - 1n
    if (pv < 24n) { this.ensure(1); this.buf[this.pos++] = 0x20 + Number(pv) }
    else if (pv < 256n) { this.ensure(2); this.buf[this.pos++] = 0x38; this.buf[this.pos++] = Number(pv) }
    else if (pv < 65536n) { this.ensure(3); const n = Number(pv); this.buf[this.pos++] = 0x39; this.buf[this.pos++] = n >> 8; this.buf[this.pos++] = n & 0xff }
    else if (pv < 4294967296n) {
      this.ensure(5); const n = Number(pv); this.buf[this.pos++] = 0x3a
      this.buf[this.pos++] = (n >> 24) & 0xff; this.buf[this.pos++] = (n >> 16) & 0xff; this.buf[this.pos++] = (n >> 8) & 0xff; this.buf[this.pos++] = n & 0xff
    } else {
      this.ensure(9); const low = Number(pv & 0xffffffffn); const high = Number(pv >> 32n)
      this.buf[this.pos++] = 0x3b
      this.buf[this.pos++] = (high >> 24) & 0xff; this.buf[this.pos++] = (high >> 16) & 0xff; this.buf[this.pos++] = (high >> 8) & 0xff; this.buf[this.pos++] = high & 0xff
      this.buf[this.pos++] = (low >> 24) & 0xff; this.buf[this.pos++] = (low >> 16) & 0xff; this.buf[this.pos++] = (low >> 8) & 0xff; this.buf[this.pos++] = low & 0xff
    }
  }

  writeBytes(value: Uint8Array): void { this.writeHeader(2, value.length); this.ensure(value.length); this.buf.set(value, this.pos); this.pos += value.length }
  writeText(value: string): void { const e = textEncoder.encode(value); this.writeHeader(3, e.length); this.ensure(e.length); this.buf.set(e, this.pos); this.pos += e.length }
  writeArrayHeader(length: number): void {
    if (this.profile.indefiniteArrays && !(length === 0 && this.profile.useDefiniteForEmpty)) { this.ensure(1); this.buf[this.pos++] = 0x9f }
    else this.writeHeader(4, length)
  }
  writeMapHeader(length: number): void {
    if (this.profile.indefiniteMaps && !(length === 0 && this.profile.useDefiniteForEmpty)) { this.ensure(1); this.buf[this.pos++] = 0xbf }
    else this.writeHeader(5, length)
  }
  writeDefiniteArrayHeader(length: number): void { this.writeHeader(4, length) }
  writeDefiniteMapHeader(length: number): void { this.writeHeader(5, length) }
  writeTagHeader(tag: number): void { this.writeHeader(6, tag) }

  // --------------------------------------------------------------------------
  // Format-preserving primitive writers
  // --------------------------------------------------------------------------

  writeUintPreserving(value: bigint, width?: 0 | 1 | 2 | 4 | 8): void {
    if (width === undefined) { this.writeUint(value); return }
    const n = Number(value)
    if (width === 0) {
      if (value >= 24n) { this.writeUint(value); return }
      this.ensure(1); this.buf[this.pos++] = n
    } else if (width === 1) {
      if (value >= 256n) { this.writeUint(value); return }
      this.ensure(2); this.buf[this.pos++] = 24; this.buf[this.pos++] = n
    } else if (width === 2) {
      if (value >= 65536n) { this.writeUint(value); return }
      this.ensure(3); this.buf[this.pos++] = 25; this.buf[this.pos++] = n >> 8; this.buf[this.pos++] = n & 0xff
    } else if (width === 4) {
      if (value >= 4294967296n) { this.writeUint(value); return }
      this.ensure(5); this.buf[this.pos++] = 26
      this.buf[this.pos++] = (n >> 24) & 0xff; this.buf[this.pos++] = (n >> 16) & 0xff
      this.buf[this.pos++] = (n >> 8) & 0xff; this.buf[this.pos++] = n & 0xff
    } else {
      this.ensure(9); const low = Number(value & 0xffffffffn); const high = Number(value >> 32n)
      this.buf[this.pos++] = 27
      this.buf[this.pos++] = (high >> 24) & 0xff; this.buf[this.pos++] = (high >> 16) & 0xff; this.buf[this.pos++] = (high >> 8) & 0xff; this.buf[this.pos++] = high & 0xff
      this.buf[this.pos++] = (low >> 24) & 0xff; this.buf[this.pos++] = (low >> 16) & 0xff; this.buf[this.pos++] = (low >> 8) & 0xff; this.buf[this.pos++] = low & 0xff
    }
  }

  writeNintPreserving(value: bigint, width?: 0 | 1 | 2 | 4 | 8): void {
    if (width === undefined) { this.writeNint(value); return }
    const pv = -value - 1n; const n = Number(pv)
    if (width === 0) {
      if (pv >= 24n) { this.writeNint(value); return }
      this.ensure(1); this.buf[this.pos++] = 0x20 + n
    } else if (width === 1) {
      if (pv >= 256n) { this.writeNint(value); return }
      this.ensure(2); this.buf[this.pos++] = 0x38; this.buf[this.pos++] = n
    } else if (width === 2) {
      if (pv >= 65536n) { this.writeNint(value); return }
      this.ensure(3); this.buf[this.pos++] = 0x39; this.buf[this.pos++] = n >> 8; this.buf[this.pos++] = n & 0xff
    } else if (width === 4) {
      if (pv >= 4294967296n) { this.writeNint(value); return }
      this.ensure(5); this.buf[this.pos++] = 0x3a
      this.buf[this.pos++] = (n >> 24) & 0xff; this.buf[this.pos++] = (n >> 16) & 0xff
      this.buf[this.pos++] = (n >> 8) & 0xff; this.buf[this.pos++] = n & 0xff
    } else {
      this.ensure(9); const low = Number(pv & 0xffffffffn); const high = Number(pv >> 32n)
      this.buf[this.pos++] = 0x3b
      this.buf[this.pos++] = (high >> 24) & 0xff; this.buf[this.pos++] = (high >> 16) & 0xff; this.buf[this.pos++] = (high >> 8) & 0xff; this.buf[this.pos++] = high & 0xff
      this.buf[this.pos++] = (low >> 24) & 0xff; this.buf[this.pos++] = (low >> 16) & 0xff; this.buf[this.pos++] = (low >> 8) & 0xff; this.buf[this.pos++] = low & 0xff
    }
  }

  writeHeaderPreserving(majorType: number, length: number, width?: 0 | 1 | 2 | 4 | 8): void {
    if (width === undefined) { this.writeHeader(majorType, length); return }
    const mt = majorType << 5
    if (width === 0) {
      if (length >= 24) { this.writeHeader(majorType, length); return }
      this.ensure(1); this.buf[this.pos++] = mt | length
    } else if (width === 1) {
      if (length >= 256) { this.writeHeader(majorType, length); return }
      this.ensure(2); this.buf[this.pos++] = mt | 24; this.buf[this.pos++] = length
    } else if (width === 2) {
      if (length >= 65536) { this.writeHeader(majorType, length); return }
      this.ensure(3); this.buf[this.pos++] = mt | 25; this.buf[this.pos++] = length >> 8; this.buf[this.pos++] = length & 0xff
    } else if (width === 4) {
      if (length >= 4294967296) { this.writeHeader(majorType, length); return }
      this.ensure(5); this.buf[this.pos++] = mt | 26
      this.buf[this.pos++] = (length >> 24) & 0xff; this.buf[this.pos++] = (length >> 16) & 0xff
      this.buf[this.pos++] = (length >> 8) & 0xff; this.buf[this.pos++] = length & 0xff
    }
  }

  writeBytesPreserving(value: Uint8Array, fmt?: { indefinite?: boolean; chunks?: ReadonlyArray<number> }): void {
    if (!fmt?.indefinite) { this.writeBytes(value); return }
    this.ensure(1); this.buf[this.pos++] = 0x5f
    if (fmt.chunks && fmt.chunks.length > 0) {
      let offset = 0
      for (const chunkLen of fmt.chunks) {
        const end = Math.min(offset + chunkLen, value.length)
        if (offset >= value.length) break
        this.writeBytes(value.subarray(offset, end))
        offset = end
      }
      if (offset < value.length) this.writeBytes(value.subarray(offset))
    } else {
      this.writeBytes(value)
    }
    this.ensure(1); this.buf[this.pos++] = 0xff
  }

  writeTextPreserving(value: string, fmt?: { indefinite?: boolean; chunks?: ReadonlyArray<number> }): void {
    if (!fmt?.indefinite) { this.writeText(value); return }
    const encoded = textEncoder.encode(value)
    this.ensure(1); this.buf[this.pos++] = 0x7f
    if (fmt.chunks && fmt.chunks.length > 0) {
      let offset = 0
      for (const chunkLen of fmt.chunks) {
        const end = Math.min(offset + chunkLen, encoded.length)
        if (offset >= encoded.length) break
        const chunk = encoded.subarray(offset, end)
        this.writeHeader(3, chunk.length); this.ensure(chunk.length); this.buf.set(chunk, this.pos); this.pos += chunk.length
        offset = end
      }
      if (offset < encoded.length) {
        const rest = encoded.subarray(offset)
        this.writeHeader(3, rest.length); this.ensure(rest.length); this.buf.set(rest, this.pos); this.pos += rest.length
      }
    } else {
      this.writeHeader(3, encoded.length); this.ensure(encoded.length); this.buf.set(encoded, this.pos); this.pos += encoded.length
    }
    this.ensure(1); this.buf[this.pos++] = 0xff
  }

  // --------------------------------------------------------------------------
  // Simple values
  // --------------------------------------------------------------------------

  writeBool(value: boolean): void { this.ensure(1); this.buf[this.pos++] = value ? 0xf5 : 0xf4 }
  writeNull(): void { this.ensure(1); this.buf[this.pos++] = 0xf6 }
  writeRaw(value: Uint8Array): void { this.ensure(value.length); this.buf.set(value, this.pos); this.pos += value.length }
  writeIndefiniteArrayHeader(): void { this.ensure(1); this.buf[this.pos++] = 0x9f }
  writeIndefiniteMapHeader(): void { this.ensure(1); this.buf[this.pos++] = 0xbf }
  writeBreak(): void { this.ensure(1); this.buf[this.pos++] = 0xff }

  /** Write break marker if profile uses indefinite containers. */
  writeArrayBreak(): void { if (this.profile.indefiniteArrays) this.writeBreak() }
  writeMapBreak(): void { if (this.profile.indefiniteMaps) this.writeBreak() }

  writeCbor(value: unknown): void {
    if (typeof value === "bigint") { if (value >= 0n) this.writeUint(value); else this.writeNint(value) }
    else if (value instanceof Uint8Array) { this.writeBytes(value) }
    else if (typeof value === "string") { this.writeText(value) }
    else if (Array.isArray(value)) { this.writeArrayHeader(value.length); for (const item of value) this.writeCbor(item); this.writeArrayBreak() }
    else if (value instanceof Map) { this.writeMapHeader(value.size); for (const [k, v] of value) { this.writeCbor(k); this.writeCbor(v) }; this.writeMapBreak() }
    else if (typeof value === "object" && value !== null && "_tag" in value && (value as { _tag: string })._tag === "Tag") {
      const tagged = value as unknown as { tag: number; value: unknown }; this.writeTagHeader(tagged.tag); this.writeCbor(tagged.value)
    }
    else if (typeof value === "boolean") { this.writeBool(value) }
    else if (value === null || value === undefined) { this.writeNull() }
  }

  // --------------------------------------------------------------------------
  // Cache-aware emit methods (format preservation)
  // --------------------------------------------------------------------------

  /** Try to emit raw bytes for an object. Returns true if emitted. */
  tryWriteRaw(obj: object): boolean {
    const raw = cache.get(obj)?.raw
    if (raw) { this.writeRaw(raw); return true }
    return false
  }

  /** Write object: raw cache hit → verbatim, miss → writeFresh callback. */
  writePreserved(obj: object, writeFresh: () => void): void {
    if (!this.tryWriteRaw(obj)) writeFresh()
  }

  /** Write an array with format preservation from cache. */
  writeArray<T>(arr: ReadonlyArray<T>, writeElement: (el: T) => void): void {
    if (this.tryWriteRaw(arr as unknown as object)) return
    const hint = cache.get(arr as unknown as object)?.hint
    if (hint?.indefinite) {
      this.writeIndefiniteArrayHeader()
      for (const el of arr) writeElement(el)
      this.writeBreak()
    } else {
      this.writeHeaderPreserving(4, arr.length, hint?.headerWidth)
      for (const el of arr) writeElement(el)
    }
  }

  /** Write a map with format preservation from cache. */
  writeMap(
    entries: ReadonlyArray<{ key: unknown; writeKey: (fmt?: FieldFormat) => void; writeValue: () => void }>,
    sourceMap?: object
  ): void {
    if (sourceMap && this.tryWriteRaw(sourceMap)) return
    const hint = sourceMap ? cache.get(sourceMap)?.hint : undefined
    if (hint?.indefinite) { this.writeIndefiniteMapHeader() }
    else { this.writeHeaderPreserving(5, entries.length, hint?.headerWidth) }

    if (hint?.keyOrder) {
      const entryMap = new Map(entries.map((e) => [e.key, e]))
      for (const key of hint.keyOrder) {
        const entry = entryMap.get(key)
        if (entry) { entry.writeKey(hint.fields?.get(key as string | number | bigint)); entry.writeValue() }
      }
      const keySet = new Set(hint.keyOrder)
      for (const entry of entries) {
        if (!keySet.has(entry.key)) { entry.writeKey(); entry.writeValue() }
      }
    } else {
      for (const entry of entries) { entry.writeKey(); entry.writeValue() }
    }
    if (hint?.indefinite) this.writeBreak()
  }

  /** Write an array using profile defaults, with format hint override. */
  writeArrayWithProfile<T>(arr: ReadonlyArray<T>, writeElement: (el: T) => void, profile: EncodingProfile): void {
    if (this.tryWriteRaw(arr as unknown as object)) return
    const hint = cache.get(arr as unknown as object)?.hint
    const indefinite = hint?.indefinite ?? profile.indefiniteArrays
    if (indefinite) {
      this.writeIndefiniteArrayHeader()
      for (const el of arr) writeElement(el)
      this.writeBreak()
    } else {
      this.writeHeaderPreserving(4, arr.length, hint?.headerWidth)
      for (const el of arr) writeElement(el)
    }
  }

  /** Write a map using profile defaults, with format hint override. */
  writeMapWithProfile(
    entries: ReadonlyArray<{ key: unknown; writeKey: (fmt?: FieldFormat) => void; writeValue: () => void }>,
    profile: EncodingProfile,
    sourceMap?: object
  ): void {
    if (sourceMap && this.tryWriteRaw(sourceMap)) return
    const hint = sourceMap ? cache.get(sourceMap)?.hint : undefined
    const indefinite = hint?.indefinite ?? profile.indefiniteMaps

    if (indefinite) { this.writeIndefiniteMapHeader() }
    else { this.writeHeaderPreserving(5, entries.length, hint?.headerWidth) }

    if (hint?.keyOrder) {
      const entryMap = new Map(entries.map((e) => [e.key, e]))
      for (const key of hint.keyOrder) {
        const entry = entryMap.get(key)
        if (entry) { entry.writeKey(hint.fields?.get(key as string | number | bigint)); entry.writeValue() }
      }
      const keySet = new Set(hint.keyOrder)
      for (const entry of entries) {
        if (!keySet.has(entry.key)) { entry.writeKey(); entry.writeValue() }
      }
    } else if (profile.sortMapKeys) {
      const sorted = [...entries].sort((a, b) => compareBytes(encodeSortKey(a.key), encodeSortKey(b.key)))
      for (const entry of sorted) { entry.writeKey(); entry.writeValue() }
    } else {
      for (const entry of entries) { entry.writeKey(); entry.writeValue() }
    }
    if (indefinite) this.writeBreak()
  }

  // --------------------------------------------------------------------------
  // Finish
  // --------------------------------------------------------------------------

  /** Returns a copy of the encoded bytes. */
  finish(): Uint8Array { return this.buf.slice(0, this.pos) }

  /**
   * Returns a zero-copy view of the encoded bytes.
   * Safe when the writer is not reused (new instance per encode).
   * If the writer encodes again, the view is overwritten.
   *
   * ```ts
   * const w = new CborWriter()
   * w.writeUint(42n)
   * const bytes = w.finishView()  // [0x18, 0x2A] — no copy
   * // w is discarded, bytes stays valid — GC keeps the buffer alive
   * ```
   */
  finishView(): Uint8Array { return this.buf.subarray(0, this.pos) }
}

// ============================================================================
// Key sorting internals (must be after class definition)
// ============================================================================

const sortKeyWriter = new CborWriter(64)

const encodeSortKey = (key: unknown): Uint8Array => {
  sortKeyWriter.reset()
  if (typeof key === "bigint") { if (key >= 0n) sortKeyWriter.writeUint(key); else sortKeyWriter.writeNint(key) }
  else if (typeof key === "string") sortKeyWriter.writeText(key)
  else if (key instanceof Uint8Array) sortKeyWriter.writeBytes(key)
  return sortKeyWriter.finish()
}

const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
  if (a.length !== b.length) return a.length - b.length
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
