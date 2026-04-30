import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Url from "./Url.js"
import { CborReader } from "./v2/CborReader.js"
import { capture, CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for PoolMetadata representing pool metadata information.
 * pool_metadata = [url, bytes]
 *
 * @since 2.0.0
 * @category model
 */
export class PoolMetadata extends Schema.TaggedClass<PoolMetadata>()("PoolMetadata", {
  url: Url.Url,
  hash: Schema.Uint8ArrayFromSelf
}) {
  /**
   * Convert to JSON-serializable object.
   *
   * @since 2.0.0
   * @category encoding
   */
  toJSON() {
    return {
      _tag: "PoolMetadata" as const,
      url: this.url.href,
      hash: Bytes.toHex(this.hash)
    }
  }

  /**
   * Convert to string representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * Custom inspect for Node.js REPL.
   *
   * @since 2.0.0
   * @category conversions
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * Structural equality check.
   *
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return that instanceof PoolMetadata && Equal.equals(this.url, that.url) && Equal.equals(this.hash, that.hash)
  }

  /**
   * Hash code generation.
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.url))(Hash.hash(this.hash)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: PoolMetadata): void => {
  w.writeArrayHeader(2)
  Url.write(w, v.url)
  w.writeBytes(v.hash)
  w.writeArrayBreak()
}

export const read = (r: CborReader): PoolMetadata => {
  const start = r.position()
  const count = r.readArrayHeader()
  const pm = new PoolMetadata({
    url: Url.read(r),
    hash: r.readBytesView()
  })
  if (count === -1) r.isBreak()
  capture(pm, r.buffer().subarray(start, r.position()))
  return pm
}

/**
 * FastCheck arbitrary for generating random PoolMetadata instances
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.record({
  url: Url.arbitrary,
  hash: FastCheck.uint8Array({ minLength: 32, maxLength: 32 })
}).map((props) => new PoolMetadata(props))

/**
 * CBOR bytes transformation schema for PoolMetadata.
 * Transforms between Uint8Array and PoolMetadata using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(PoolMetadata),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "PoolMetadata.FromCBORBytes" })

/**
 * CBOR hex transformation schema for PoolMetadata.
 * Transforms between hex string and PoolMetadata using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "PoolMetadata.FromCBORHex" })

/**
 * Convert CBOR bytes to PoolMetadata (unsafe)
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex string to PoolMetadata (unsafe)
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert PoolMetadata to CBOR bytes (unsafe)
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORBytes = (poolMetadata: PoolMetadata, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, poolMetadata)
  return w.finishView()
}

/**
 * Convert PoolMetadata to CBOR hex string (unsafe)
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORHex = (poolMetadata: PoolMetadata, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(poolMetadata, profile))
