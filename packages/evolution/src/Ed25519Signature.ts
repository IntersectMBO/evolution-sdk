import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes64 from "./Bytes64.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Class-based Ed25519Signature with compile-time and runtime safety.
 * ed25519_signature = bytes .size 64
 * Follows the Conway-era CDDL specification.
 *
 * @since 2.0.0
 * @category model
 */
export class Ed25519Signature extends Schema.Class<Ed25519Signature>("Ed25519Signature")({
  bytes: Bytes64.BytesFromHex
}) {
  toJSON() {
    return { _tag: "Ed25519Signature" as const, bytes: Bytes.toHex(this.bytes) }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof Ed25519Signature && Bytes.equals(this.bytes, that.bytes)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.bytes))
  }
}

// ============================================================================
// Write / Read
// ============================================================================

export const write = (w: CborWriter, v: Ed25519Signature): void => w.writeBytes(v.bytes)
export const read = (r: CborReader): Ed25519Signature => new Ed25519Signature({ bytes: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema transformer from bytes to Ed25519Signature.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Ed25519Signature),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new Ed25519Signature({ bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (signature) => ParseResult.succeed(new Uint8Array(signature.bytes))
  }
).annotations({
  identifier: "Ed25519Signature.FromBytes"
})

/**
 * Schema transformer from hex string to Ed25519Signature.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "Ed25519Signature.FromHex"
})

// ============================================================================
// Core Functions (functional interface)
// ============================================================================

/**
 * Parse Ed25519Signature from bytes (unsafe - throws on error).
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse Ed25519Signature from hex string (unsafe - throws on error).
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Convert to hex string using optimized lookup table.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = Schema.encodeSync(FromHex)

/**
 * Get the underlying bytes (returns a copy for safety).
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = Schema.encodeSync(FromBytes)

/**
 * Check if value is an Ed25519Signature instance.
 *
 * @since 2.0.0
 * @category predicates
 */
export const is = Schema.is(Ed25519Signature)

/**
 * FastCheck arbitrary for generating random Ed25519Signature instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<Ed25519Signature> = FastCheck.uint8Array({
  minLength: 64,
  maxLength: 64
}).map((bytes) => new Ed25519Signature({ bytes }))
