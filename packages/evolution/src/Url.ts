import { Equal, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Text128 from "./Text128.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for Url representing URLs as branded text.
 * url = text .size (0..128)
 *
 * @since 2.0.0
 * @category model
 */
export class Url extends Schema.TaggedClass<Url>("Url")("Url", {
  href: Text128.Text128
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    return {
      _tag: "Url",
      href: this.href
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
    return that instanceof Url && Equal.equals(this.href, that.href)
  }

  /**
   * Hash code generation.
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.href))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Url): void => w.writeText(v.href)
export const read = (r: CborReader): Url => new Url({ href: r.readText() })

// ============================================================================
// Schemas
// ============================================================================

export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Url),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => {
        const text = new TextDecoder().decode(bytes)
        return new Url({ href: text })
      },
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(new TextEncoder().encode(v.href))
  }
).annotations({ identifier: "Url.FromBytes" })

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "Url.Hex"
})

/**
 * Check if the given value is a valid Url
 *
 * @since 2.0.0
 * @category predicates
 */
export const isUrl = Schema.is(Url)

/**
 * FastCheck arbitrary for generating random Url instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = Text128.arbitrary.map((text) => Url.make({ href: text }, { disableValidation: true }))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse Url from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = (bytes: Uint8Array) => Schema.decodeSync(FromBytes)(bytes)

/**
 * Parse Url from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = (hex: string) => Schema.decodeSync(FromHex)(hex)

/**
 * Encode Url to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (url: Url): Uint8Array => new TextEncoder().encode(url.href)

/**
 * Encode Url to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (url: Url): string => Schema.encodeSync(Schema.Uint8ArrayFromHex)(toBytes(url))
