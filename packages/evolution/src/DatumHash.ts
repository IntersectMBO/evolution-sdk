import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for DatumHash representing a reference to datum data stored elsewhere via its hash.
 *
 * @since 2.0.0
 * @category schemas
 */
export class DatumHash extends Schema.TaggedClass<DatumHash>()("DatumHash", {
  hash: Bytes32.BytesFromHex
}) {
  /**
   * @since 2.0.0
   * @category json
   */
  toJSON() {
    return { _tag: "DatumHash" as const, hash: Bytes.toHex(this.hash) }
  }

  /**
   * @since 2.0.0
   * @category string
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * @since 2.0.0
   * @category inspect
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return that instanceof DatumHash && Bytes.equals(this.hash, that.hash)
  }

  /**
   * @since 2.0.0
   * @category hash
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.array(Array.from(this.hash)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: DatumHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): DatumHash => new DatumHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for transforming bytes to DatumHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(DatumHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new DatumHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (dh) => ParseResult.succeed(dh.hash)
  }
).annotations({
  identifier: "DatumHash.FromBytes"
})

/**
 * Schema for transforming hex string to DatumHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "DatumHash.FromHex"
})

/**
 * FastCheck arbitrary for generating random DatumHash instances.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.uint8Array({ minLength: 32, maxLength: 32 }).map(
  (hash) => new DatumHash({ hash })
)

/**
 * Type guard to check if a value is a DatumHash.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isDatumHash = Schema.is(DatumHash)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse DatumHash from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse DatumHash from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode DatumHash to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: DatumHash): Uint8Array => v.hash

/**
 * Encode DatumHash to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: DatumHash): string => Bytes.toHex(v.hash)
