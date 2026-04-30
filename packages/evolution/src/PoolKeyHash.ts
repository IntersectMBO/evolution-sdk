import { bech32 } from "@scure/base"
import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Hash28 from "./Hash28.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * PoolKeyHash as a TaggedClass representing a stake pool's verification key hash.
 * pool_keyhash = hash28
 *
 * @since 2.0.0
 * @category model
 */
export class PoolKeyHash extends Schema.TaggedClass<PoolKeyHash>()("PoolKeyHash", {
  hash: Hash28.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "PoolKeyHash" as const,
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
    return that instanceof PoolKeyHash && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.array(Array.from(this.hash)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: PoolKeyHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): PoolKeyHash => new PoolKeyHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema transformer from bytes to PoolKeyHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(PoolKeyHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new PoolKeyHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.hash)
  }
).annotations({ identifier: "PoolKeyHash.FromBytes" })

/**
 * Schema transformer from hex string to PoolKeyHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(Schema.Uint8ArrayFromHex, FromBytes).annotations({
  identifier: "PoolKeyHash.FromHex"
})

/**
 * Schema transformer from bech32 string (pool1...) to PoolKeyHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBech32 = Schema.transformOrFail(Schema.String, Schema.typeSchema(PoolKeyHash), {
  strict: true,
  encode: (poolKeyHash) => {
    const words = bech32.toWords(poolKeyHash.hash)
    return ParseResult.succeed(bech32.encode("pool", words, false))
  },
  decode: (fromA, _, ast) => ParseResult.try({
    try: () => {
      // Note: `as any` needed because bech32.decode expects template literal type `${Prefix}1${string}`
      // but Schema provides plain string. Consider using decodeToBytes which accepts string.
      const decoded = bech32.decode(fromA as any, false)
      const bytes = bech32.fromWords(decoded.words)
      return new PoolKeyHash({ hash: new Uint8Array(bytes) })
    },
    catch: (e) => new ParseResult.Type(ast, fromA, e instanceof Error ? e.message : String(e))
  })
}).annotations({
  identifier: "PoolKeyHash.FromBech32",
  description: "Transforms Bech32 pool id string to PoolKeyHash"
})

/**
 * FastCheck arbitrary for generating random PoolKeyHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<PoolKeyHash> = FastCheck.uint8Array({
  minLength: Hash28.BYTES_LENGTH,
  maxLength: Hash28.BYTES_LENGTH
}).map((bytes) => new PoolKeyHash({ hash: bytes }))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse PoolKeyHash from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse PoolKeyHash from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode PoolKeyHash to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: PoolKeyHash): Uint8Array => v.hash

/**
 * Encode PoolKeyHash to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: PoolKeyHash): string => Bytes.toHex(v.hash)

/**
 * Parse PoolKeyHash from bech32 string (pool1...).
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBech32 = Schema.decodeSync(FromBech32)

/**
 * Encode PoolKeyHash to bech32 string (pool1...).
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBech32 = Schema.encodeSync(FromBech32)
