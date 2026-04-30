import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for TransactionHash.
 * transaction_hash = Bytes32
 *
 * @since 2.0.0
 * @category schemas
 */
export class TransactionHash extends Schema.TaggedClass<TransactionHash>()("TransactionHash", {
  hash: Bytes32.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "TransactionHash" as const,
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
    return that instanceof TransactionHash && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.array(Array.from(this.hash)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: TransactionHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): TransactionHash => new TransactionHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for transforming between Uint8Array and TransactionHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(TransactionHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new TransactionHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (th) => ParseResult.succeed(th.hash)
  }
).annotations({ identifier: "TransactionHash.FromBytes" })

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "TransactionHash.FromHex"
})

/**
 * Check if the given value is a valid TransactionHash
 *
 * @since 2.0.0
 * @category predicates
 */
export const isTransactionHash = Schema.is(TransactionHash)

/**
 * FastCheck arbitrary for generating random TransactionHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({
  minLength: 32,
  maxLength: 32
}).map((bytes) => new TransactionHash({ hash: bytes }))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse TransactionHash from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse TransactionHash from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode TransactionHash to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: TransactionHash): Uint8Array => v.hash

/**
 * Encode TransactionHash to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: TransactionHash): string => Bytes.toHex(v.hash)
