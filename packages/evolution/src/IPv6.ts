import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes16 from "./Bytes16.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * IPv6 model stored as 16 raw bytes (network byte order).
 *
 * @since 2.0.0
 * @category schemas
 */
export class IPv6 extends Schema.TaggedClass<IPv6>()("IPv6", {
  bytes: Bytes16.BytesFromHex
}) {
  toJSON() {
    return { _tag: "IPv6" as const, bytes: Bytes.toHex(this.bytes) }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof IPv6 && Bytes.equals(this.bytes, that.bytes)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.bytes))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: IPv6): void => w.writeBytes(v.bytes)
export const read = (r: CborReader): IPv6 => new IPv6({ bytes: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(IPv6),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new IPv6({ bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.bytes)
  }
).annotations({ identifier: "IPv6.FromBytes" })

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "IPv6.FromHex"
})

/**
 * Predicate for IPv6 instances
 *
 * @since 2.0.0
 * @category predicates
 */
export const isIPv6 = Schema.is(IPv6)

/**
 * FastCheck arbitrary for generating random IPv6 instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({ minLength: 16, maxLength: 16 }).map(
  (bytes) => new IPv6({ bytes }, { disableValidation: true })
)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse IPv6 from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse IPv6 from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode IPv6 to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: IPv6): Uint8Array => v.bytes

/**
 * Encode IPv6 to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: IPv6): string => Bytes.toHex(v.bytes)
