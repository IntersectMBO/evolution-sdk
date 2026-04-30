import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for BlockBodyHash representing a block body hash.
 * block_body_hash = Bytes32
 * Follows the Conway-era CDDL specification.
 *
 * @since 2.0.0
 * @category model
 */
export class BlockBodyHash extends Schema.TaggedClass<BlockBodyHash>()("BlockBodyHash", {
  hash: Bytes32.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "BlockBodyHash" as const,
      hash: Bytes.toHex(this.hash)
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof BlockBodyHash && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.array(Array.from(this.hash)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: BlockBodyHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): BlockBodyHash => new BlockBodyHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for transforming between Uint8Array and BlockBodyHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(BlockBodyHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new BlockBodyHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (bbh) => ParseResult.succeed(bbh.hash)
  }
).annotations({
  identifier: "BlockBodyHash.FromBytes"
})

/**
 * Schema for transforming between hex string and BlockBodyHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "BlockBodyHash.FromHex"
})

/**
 * Check if the given value is a valid BlockBodyHash
 *
 * @since 2.0.0
 * @category predicates
 */
export const isBlockBodyHash = Schema.is(BlockBodyHash)

/**
 * FastCheck arbitrary for generating random BlockBodyHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({ minLength: 32, maxLength: 32 }).map(
  (hash) => new BlockBodyHash({ hash })
)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse BlockBodyHash from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse BlockBodyHash from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode BlockBodyHash to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: BlockBodyHash): Uint8Array => v.hash

/**
 * Encode BlockBodyHash to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: BlockBodyHash): string => Bytes.toHex(v.hash)
