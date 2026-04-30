import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for BlockHeaderHash representing a block header hash.
 * block_header_hash = Bytes32
 * Follows the Conway-era CDDL specification.
 *
 * @since 2.0.0
 * @category model
 */
export class BlockHeaderHash extends Schema.TaggedClass<BlockHeaderHash>()("BlockHeaderHash", {
  hash: Bytes32.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "BlockHeaderHash" as const,
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
    return that instanceof BlockHeaderHash && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.array(Array.from(this.hash)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: BlockHeaderHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): BlockHeaderHash => new BlockHeaderHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for transforming between Uint8Array and BlockHeaderHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(BlockHeaderHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new BlockHeaderHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (bhh) => ParseResult.succeed(bhh.hash)
  }
).annotations({
  identifier: "BlockHeaderHash.FromBytes"
})

/**
 * Schema for transforming between hex string and BlockHeaderHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "BlockHeaderHash.FromHex"
})

/**
 * Check if the given value is a valid BlockHeaderHash
 *
 * @since 2.0.0
 * @category predicates
 */
export const isBlockHeaderHash = Schema.is(BlockHeaderHash)

/**
 * FastCheck arbitrary for generating random BlockHeaderHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({ minLength: 32, maxLength: 32 }).map(
  (hash) => new BlockHeaderHash({ hash }, { disableValidation: true })
)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse BlockHeaderHash from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse BlockHeaderHash from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode BlockHeaderHash to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: BlockHeaderHash): Uint8Array => v.hash

/**
 * Encode BlockHeaderHash to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: BlockHeaderHash): string => Bytes.toHex(v.hash)
