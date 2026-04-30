import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for AssetName representing a native asset identifier.
 * Asset names are limited to 32 bytes (0-64 hex characters).
 *
 * @since 2.0.0
 * @category model
 */
export class AssetName extends Schema.TaggedClass<AssetName>()("AssetName", {
  bytes: Bytes32.VariableBytesFromHex
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    return {
      _tag: "AssetName",
      bytes: Bytes.toHex(this.bytes)
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
    return that instanceof AssetName && Bytes.equals(this.bytes, that.bytes)
  }

  /**
   * Content-based hash for optimization of Equal.equals.
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.array(Array.from(this.bytes)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: AssetName): void => w.writeBytes(v.bytes)
export const read = (r: CborReader): AssetName => new AssetName({ bytes: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for encoding/decoding AssetName as bytes.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(AssetName),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new AssetName({ bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (assetName) => ParseResult.succeed(assetName.bytes)
  }
).annotations({
  identifier: "AssetName.FromBytes"
})

/**
 * Schema for encoding/decoding AssetName as hex strings.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "AssetName.FromHex"
})

/**
 * Check if the given value is a valid AssetName
 *
 * @since 2.0.0
 * @category predicates
 */
export const isAssetName = Schema.is(AssetName)

/**
 * FastCheck arbitrary for generating random AssetName instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({
  minLength: 0,
  maxLength: 32
}).map((bytes) => new AssetName({ bytes }))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse AssetName from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse AssetName from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode AssetName to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: AssetName): Uint8Array => v.bytes

/**
 * Encode AssetName to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: AssetName): string => Bytes.toHex(v.bytes)
