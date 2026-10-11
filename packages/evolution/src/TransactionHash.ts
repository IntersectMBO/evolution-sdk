import { Equal, FastCheck, Hash, Inspectable, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"

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

/**
 * Schema for transforming between Uint8Array and TransactionHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transform(Schema.typeSchema(Bytes32.BytesFromHex), Schema.typeSchema(TransactionHash), {
  strict: true,
  decode: (bytes) => new TransactionHash({ hash: bytes }, { disableValidation: true }), // Disable validation since we already check length in Bytes32
  encode: (txHash) => txHash.hash
}).annotations({
  identifier: "TransactionHash.FromBytes"
})

export const FromHex = Schema.compose(
  Bytes32.BytesFromHex, // string -> Bytes32
  FromBytes // Bytes32 -> TransactionHash
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
}).map((bytes) => new TransactionHash({ hash: bytes }, { disableValidation: true })) // Disable validation since we already check length in FastCheck

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
/**
 * A transaction hash as hex.
 *
 * Validated as well as branded: a 32-byte lowercase or uppercase hex string. {@link toHex}
 * returns this type, so the kind of a hex string survives leaving the typed domain — upstream of
 * this, every hash and key was an unmarked `string` once encoded.
 *
 * ⚠️ Branded apart from every other 32-byte hash hex. They are the same shape, and the type
 * system is the only thing standing between a transaction hash and a datum hash.
 *
 * @since 2.4.0
 * @category schemas
 */
export const Hex = Schema.String.pipe(Schema.pattern(/^[0-9a-fA-F]{64}$/), Schema.brand("TransactionHashHex"))

/**
 * @since 2.4.0
 * @category model
 */
export type Hex = typeof Hex.Type

export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode TransactionHash to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = Schema.encodeSync(FromBytes)

/**
 * Encode TransactionHash to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (value: Parameters<typeof encodeHex>[0]): Hex => Hex.make(encodeHex(value))

const encodeHex = Schema.encodeSync(FromHex)
