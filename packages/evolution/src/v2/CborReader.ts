/**
 * CborReader — cursor-based CBOR decoder.
 *
 * Reads CBOR bytes directly into domain values without building an
 * intermediate CBOR value tree. Instance-based, concurrency-safe.
 *
 * Two method flavors per type:
 * - `readX()` — returns just the value (fast path)
 * - `readXAnnotated()` — returns [value, format] (preserving path)
 *
 * @since 2.0.0
 * @module
 */

// ============================================================================
// Format types
// ============================================================================

/** Encoding byte width: 0 = inline (value < 24), 1/2/4/8 = explicit width. */
export type ByteWidth = 0 | 1 | 2 | 4 | 8

/** Format annotation for a container header (array/map). */
export interface ContainerFormat {
  readonly indefinite: boolean
  readonly headerWidth: ByteWidth
}

/** Format annotation for a byte/text string. */
export interface StringFormat {
  readonly indefinite: boolean
  readonly chunks?: ReadonlyArray<number>
}

// ============================================================================
// CborReader class
// ============================================================================

/**
 * Instance-based CBOR decoder with optional format annotation.
 *
 * @since 2.0.0
 * @category reader
 */
export class CborReader {
  private buf: Uint8Array
  private pos: number
  private static td = new TextDecoder()

  constructor(data: Uint8Array) {
    this.buf = data
    this.pos = 0
  }

  /** Reset reader to decode a new buffer. Avoids allocating a new CborReader per decode. */
  reset(data: Uint8Array): void {
    this.buf = data
    this.pos = 0
  }

  /** Current byte offset in the buffer. */
  get offset(): number { return this.pos }

  /** Restore the reader to a previously saved offset. */
  set offset(n: number) { this.pos = n }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new Error(`Unexpected end of CBOR input at position ${this.pos} (need ${n} bytes, have ${this.buf.length - this.pos})`)
  }

  private readLen(): number {
    this.need(1)
    const ai = this.buf[this.pos++] & 0x1f
    if (ai < 24) return ai
    if (ai === 24) { this.need(1); return this.buf[this.pos++] }
    if (ai === 25) { this.need(2); const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1]; this.pos += 2; return v }
    if (ai === 26) { this.need(4); const v = ((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) >>> 0; this.pos += 4; return v }
    throw new Error(`Unsupported additional info: ${ai}`)
  }

  private readLenOrIndefinite(): number {
    this.need(1)
    const ai = this.buf[this.pos] & 0x1f
    if (ai === 31) { this.pos++; return -1 }
    return this.readLen()
  }

  private readIndefiniteBytes(): [Uint8Array, ReadonlyArray<number>] {
    this.pos++ // consume 0x5f
    const chunks: Array<Uint8Array> = []
    const chunkSizes: Array<number> = []
    let total = 0
    while (true) {
      this.need(1)
      if (this.buf[this.pos] === 0xff) break
      const len = this.readLen()
      this.need(len)
      chunks.push(this.buf.subarray(this.pos, this.pos + len))
      chunkSizes.push(len)
      total += len
      this.pos += len
    }
    this.pos++ // consume 0xff
    const result = new Uint8Array(total); let off = 0
    for (const c of chunks) { result.set(c, off); off += c.length }
    return [result, chunkSizes]
  }

  private static aiToWidth(ai: number): ByteWidth {
    if (ai < 24) return 0
    if (ai === 24) return 1
    if (ai === 25) return 2
    if (ai === 26) return 4
    return 8
  }

  // --------------------------------------------------------------------------
  // Unsigned integer (major type 0)
  // --------------------------------------------------------------------------

  readUint(): bigint {
    this.need(1)
    const ai = this.buf[this.pos++] & 0x1f
    if (ai < 24) return BigInt(ai)
    if (ai === 24) { this.need(1); return BigInt(this.buf[this.pos++]) }
    if (ai === 25) { this.need(2); const v = BigInt((this.buf[this.pos] << 8) | this.buf[this.pos + 1]); this.pos += 2; return v }
    if (ai === 26) { this.need(4); const v = BigInt((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) & 0xffffffffn; this.pos += 4; return v }
    if (ai === 27) { this.need(8); let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.buf[this.pos++]); return v }
    throw new Error(`Unsupported uint: ${ai}`)
  }

  readUintAnnotated(): [bigint, ByteWidth] {
    this.need(1)
    const ai = this.buf[this.pos++] & 0x1f
    const w = CborReader.aiToWidth(ai)
    if (ai < 24) return [BigInt(ai), w]
    if (ai === 24) { this.need(1); return [BigInt(this.buf[this.pos++]), w] }
    if (ai === 25) { this.need(2); const v = BigInt((this.buf[this.pos] << 8) | this.buf[this.pos + 1]); this.pos += 2; return [v, w] }
    if (ai === 26) { this.need(4); const v = BigInt((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) & 0xffffffffn; this.pos += 4; return [v, w] }
    if (ai === 27) { this.need(8); let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.buf[this.pos++]); return [v, w] }
    throw new Error(`Unsupported uint: ${ai}`)
  }

  /** Read a CBOR unsigned integer as a JS number. Fast path for values < 2^32. */
  readSmallUint(): number {
    this.need(1)
    const ai = this.buf[this.pos++] & 0x1f
    if (ai < 24) return ai
    if (ai === 24) { this.need(1); return this.buf[this.pos++] }
    if (ai === 25) { this.need(2); const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1]; this.pos += 2; return v }
    if (ai === 26) { this.need(4); const v = ((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) >>> 0; this.pos += 4; return v }
    throw new Error(`Unsupported uint for readSmallUint: ${ai}`)
  }

  // --------------------------------------------------------------------------
  // Negative integer (major type 1)
  // --------------------------------------------------------------------------

  readNint(): bigint {
    this.need(1)
    const ai = this.buf[this.pos++] & 0x1f
    if (ai < 24) return -1n - BigInt(ai)
    if (ai === 24) { this.need(1); return -1n - BigInt(this.buf[this.pos++]) }
    if (ai === 25) { this.need(2); const v = -1n - BigInt((this.buf[this.pos] << 8) | this.buf[this.pos + 1]); this.pos += 2; return v }
    if (ai === 26) { this.need(4); const v = -1n - (BigInt((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) & 0xffffffffn); this.pos += 4; return v }
    if (ai === 27) { this.need(8); let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.buf[this.pos++]); return -1n - v }
    throw new Error(`Unsupported nint: ${ai}`)
  }

  readNintAnnotated(): [bigint, ByteWidth] {
    this.need(1)
    const ai = this.buf[this.pos++] & 0x1f
    const w = CborReader.aiToWidth(ai)
    if (ai < 24) return [-1n - BigInt(ai), w]
    if (ai === 24) { this.need(1); return [-1n - BigInt(this.buf[this.pos++]), w] }
    if (ai === 25) { this.need(2); const v = -1n - BigInt((this.buf[this.pos] << 8) | this.buf[this.pos + 1]); this.pos += 2; return [v, w] }
    if (ai === 26) { this.need(4); const v = -1n - (BigInt((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) & 0xffffffffn); this.pos += 4; return [v, w] }
    if (ai === 27) { this.need(8); let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.buf[this.pos++]); return [-1n - v, w] }
    throw new Error(`Unsupported nint: ${ai}`)
  }

  // --------------------------------------------------------------------------
  // Integer (major type 0 or 1)
  // --------------------------------------------------------------------------

  readInt(): bigint {
    this.need(1)
    const mt = (this.buf[this.pos] >> 5) & 0x07
    if (mt === 0) return this.readUint()
    if (mt === 1) return this.readNint()
    throw new Error(`Expected integer, got major type ${mt}`)
  }

  readIntAnnotated(): [bigint, ByteWidth] {
    this.need(1)
    const mt = (this.buf[this.pos] >> 5) & 0x07
    if (mt === 0) return this.readUintAnnotated()
    if (mt === 1) return this.readNintAnnotated()
    throw new Error(`Expected integer, got major type ${mt}`)
  }

  // --------------------------------------------------------------------------
  // Byte string (major type 2)
  // --------------------------------------------------------------------------

  readBytes(): Uint8Array {
    this.need(1)
    const ai = this.buf[this.pos] & 0x1f
    if (ai === 31) return this.readIndefiniteBytes()[0]
    const len = this.readLen()
    this.need(len)
    const result = this.buf.slice(this.pos, this.pos + len); this.pos += len
    return result
  }

  /**
   * Read a CBOR byte string as a zero-copy view into the input buffer.
   * Fast but the view shares memory with the input — if the input is
   * mutated, the view reflects the change.
   *
   * ```ts
   * const input = new Uint8Array([0x42, 0xAA, 0xBB])
   * const r = new CborReader(input)
   * const view = r.readBytesView()  // [0xAA, 0xBB] — no copy
   * input[1] = 0xFF
   * view[0] // 0xFF — same memory
   * ```
   */
  readBytesView(): Uint8Array {
    this.need(1)
    const ai = this.buf[this.pos] & 0x1f
    if (ai === 31) return this.readIndefiniteBytes()[0]
    const len = this.readLen()
    this.need(len)
    const result = this.buf.subarray(this.pos, this.pos + len); this.pos += len
    return result
  }

  readBytesAnnotated(): [Uint8Array, StringFormat] {
    this.need(1)
    const ai = this.buf[this.pos] & 0x1f
    if (ai === 31) {
      const [data, chunks] = this.readIndefiniteBytes()
      return [data, { indefinite: true, chunks }]
    }
    const len = this.readLen()
    this.need(len)
    const result = this.buf.slice(this.pos, this.pos + len); this.pos += len
    return [result, { indefinite: false }]
  }

  // --------------------------------------------------------------------------
  // Text string (major type 3)
  // --------------------------------------------------------------------------

  readText(): string {
    this.need(1)
    const ai = this.buf[this.pos] & 0x1f
    if (ai === 31) {
      this.pos++ // consume 0x7f
      let result = ""
      while (true) {
        this.need(1)
        if (this.buf[this.pos] === 0xff) break
        const len = this.readLen()
        this.need(len)
        result += CborReader.td.decode(this.buf.subarray(this.pos, this.pos + len)); this.pos += len
      }
      this.pos++
      return result
    }
    const len = this.readLen()
    this.need(len)
    const result = CborReader.td.decode(this.buf.subarray(this.pos, this.pos + len)); this.pos += len
    return result
  }

  readTextAnnotated(): [string, StringFormat] {
    this.need(1)
    const ai = this.buf[this.pos] & 0x1f
    if (ai === 31) {
      this.pos++ // consume 0x7f
      let result = ""
      const chunks: Array<number> = []
      while (true) {
        this.need(1)
        if (this.buf[this.pos] === 0xff) break
        const len = this.readLen()
        this.need(len)
        chunks.push(len)
        result += CborReader.td.decode(this.buf.subarray(this.pos, this.pos + len)); this.pos += len
      }
      this.pos++
      return [result, { indefinite: true, chunks }]
    }
    const len = this.readLen()
    this.need(len)
    const result = CborReader.td.decode(this.buf.subarray(this.pos, this.pos + len)); this.pos += len
    return [result, { indefinite: false }]
  }

  // --------------------------------------------------------------------------
  // Array header (major type 4)
  // --------------------------------------------------------------------------

  readArrayHeader(): number {
    return this.readLenOrIndefinite()
  }

  readArrayHeaderAnnotated(): [number, ContainerFormat] {
    const ai = this.buf[this.pos] & 0x1f
    if (ai === 31) { this.pos++; return [-1, { indefinite: true, headerWidth: 0 }] }
    const w = CborReader.aiToWidth(ai)
    return [this.readLen(), { indefinite: false, headerWidth: w }]
  }

  // --------------------------------------------------------------------------
  // Map header (major type 5)
  // --------------------------------------------------------------------------

  readMapHeader(): number {
    return this.readLenOrIndefinite()
  }

  readMapHeaderAnnotated(): [number, ContainerFormat] {
    const ai = this.buf[this.pos] & 0x1f
    if (ai === 31) { this.pos++; return [-1, { indefinite: true, headerWidth: 0 }] }
    const w = CborReader.aiToWidth(ai)
    return [this.readLen(), { indefinite: false, headerWidth: w }]
  }

  // --------------------------------------------------------------------------
  // Tag header (major type 6)
  // --------------------------------------------------------------------------

  readTagHeader(): number {
    this.need(1)
    const ai = this.buf[this.pos++] & 0x1f
    if (ai < 24) return ai
    if (ai === 24) { this.need(1); return this.buf[this.pos++] }
    if (ai === 25) { this.need(2); const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1]; this.pos += 2; return v }
    if (ai === 26) { this.need(4); const v = ((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) >>> 0; this.pos += 4; return v }
    throw new Error(`Unsupported tag: ${ai}`)
  }

  readTagHeaderAnnotated(): [number, ByteWidth] {
    this.need(1)
    const ai = this.buf[this.pos++] & 0x1f
    const w = CborReader.aiToWidth(ai)
    if (ai < 24) return [ai, w]
    if (ai === 24) { this.need(1); return [this.buf[this.pos++], w] }
    if (ai === 25) { this.need(2); const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1]; this.pos += 2; return [v, w] }
    if (ai === 26) { this.need(4); const v = ((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) >>> 0; this.pos += 4; return [v, w] }
    throw new Error(`Unsupported tag: ${ai}`)
  }

  readTagHeaderOrNull(expected: number): number | null {
    this.need(1)
    const mt = (this.buf[this.pos] >> 5) & 0x07
    if (mt !== 6) return null
    const tag = this.readTagHeader()
    if (tag !== expected) throw new Error(`Expected tag ${expected}, got ${tag}`)
    return tag
  }

  // --------------------------------------------------------------------------
  // Simple values (major type 7)
  // --------------------------------------------------------------------------

  readBool(): boolean {
    this.need(1)
    const b = this.buf[this.pos++]
    if (b === 0xf5) return true
    if (b === 0xf4) return false
    throw new Error(`Expected bool: 0x${b.toString(16)}`)
  }

  readNull(): null {
    this.need(1)
    const b = this.buf[this.pos++]
    if (b === 0xf6) return null
    throw new Error(`Expected null: 0x${b.toString(16)}`)
  }

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  isBreak(): boolean { this.need(1); if (this.buf[this.pos] === 0xff) { this.pos++; return true }; return false }
  peekByte(): number { this.need(1); return this.buf[this.pos] }
  peekMajorType(): number { this.need(1); return (this.buf[this.pos] >> 5) & 0x07 }
  position(): number { return this.pos }
  buffer(): Uint8Array { return this.buf }
  isComplete(): boolean { return this.pos >= this.buf.length }

  skip(): void {
    this.need(1)
    const mt = (this.buf[this.pos] >> 5) & 0x07
    switch (mt) {
      case 0: this.readUint(); break
      case 1: this.readNint(); break
      case 2: this.readBytes(); break
      case 3: this.readText(); break
      case 4: { const n = this.readArrayHeader(); if (n === -1) { while (!this.isBreak()) this.skip() } else { for (let i = 0; i < n; i++) this.skip() }; break }
      case 5: { const n = this.readMapHeader(); if (n === -1) { while (!this.isBreak()) { this.skip(); this.skip() } } else { for (let i = 0; i < n; i++) { this.skip(); this.skip() } }; break }
      case 6: this.readTagHeader(); this.skip(); break
      case 7: this.pos++; break
    }
  }
}
