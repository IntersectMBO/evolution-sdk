import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes4 from "./Bytes4.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * IPv4 model stored as 4 raw bytes (network byte order).
 *
 * @since 2.0.0
 * @category schemas
 */
export class IPv4 extends Schema.TaggedClass<IPv4>()("IPv4", {
  bytes: Bytes4.BytesFromHex
}) {
  toJSON() {
    return { _tag: "IPv4" as const, bytes: Bytes.toHex(this.bytes) }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof IPv4 && Bytes.equals(this.bytes, that.bytes)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.bytes))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: IPv4): void => w.writeBytes(v.bytes)
export const read = (r: CborReader): IPv4 => new IPv4({ bytes: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(IPv4),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new IPv4({ bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.bytes)
  }
).annotations({ identifier: "IPv4.FromBytes" })

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "IPv4.FromHex"
})

/**
 * Predicate for IPv4 instances
 *
 * @since 2.0.0
 * @category predicates
 */
export const isIPv4 = Schema.is(IPv4)

/**
 * FastCheck arbitrary for generating random IPv4 instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({ minLength: 4, maxLength: 4 }).map(
  (bytes) => new IPv4({ bytes }, { disableValidation: true })
)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse IPv4 from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse IPv4 from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode IPv4 to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: IPv4): Uint8Array => v.bytes

/**
 * Encode IPv4 to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: IPv4): string => Bytes.toHex(v.bytes)
