/**
 * Auxiliary Data Hash module - provides an alias for Bytes32 specialized for auxiliary data hashing.
 *
 * In Cardano, auxiliary_data_hash = Bytes32, representing a 32-byte hash
 * used for auxiliary data (metadata) attached to transactions.
 *
 * @since 2.0.0
 */

import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for AuxiliaryDataHash representing auxiliary data hashes.
 * auxiliary_data_hash = Bytes32
 *
 * @since 2.0.0
 * @category model
 */
export class AuxiliaryDataHash extends Schema.TaggedClass<AuxiliaryDataHash>()("AuxiliaryDataHash", {
  hash: Bytes32.BytesFromHex
}) {
  toJSON() {
    return { _tag: "AuxiliaryDataHash" as const, hash: Bytes.toHex(this.hash) }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof AuxiliaryDataHash && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.array(Array.from(this.hash)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: AuxiliaryDataHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): AuxiliaryDataHash => new AuxiliaryDataHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for transforming between Uint8Array and AuxiliaryDataHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(AuxiliaryDataHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new AuxiliaryDataHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (a) => ParseResult.succeed(a.hash)
  }
).annotations({
  identifier: "AuxiliaryDataHash.FromBytes"
})

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "AuxiliaryDataHash.FromHex"
})

// Back-compat aliases used in TransactionBody and elsewhere
export const BytesSchema = FromBytes
export const HexSchema = FromHex

/**
 * Check if the given value is a valid AuxiliaryDataHash
 *
 * @since 2.0.0
 * @category predicates
 */
export const isAuxiliaryDataHash = Schema.is(AuxiliaryDataHash)

/**
 * FastCheck arbitrary for generating random AuxiliaryDataHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({ minLength: 32, maxLength: 32 }).map(
  (hash) => new AuxiliaryDataHash({ hash })
)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse AuxiliaryDataHash from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse AuxiliaryDataHash from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode AuxiliaryDataHash to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: AuxiliaryDataHash): Uint8Array => v.hash

/**
 * Encode AuxiliaryDataHash to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: AuxiliaryDataHash): string => Bytes.toHex(v.hash)
