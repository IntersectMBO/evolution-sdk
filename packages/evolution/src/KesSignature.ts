import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes448 from "./Bytes448.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * KesSignature model stored as 448 raw bytes.
 * kes_signature = bytes .size 448
 *
 * @since 2.0.0
 * @category schemas
 */
export class KesSignature extends Schema.TaggedClass<KesSignature>()("KesSignature", {
  bytes: Bytes448.BytesFromHex
}) {
  toJSON() {
    return { _tag: "KesSignature" as const, bytes: Bytes.toHex(this.bytes) }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof KesSignature && Bytes.equals(this.bytes, that.bytes)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.bytes))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: KesSignature): void => w.writeBytes(v.bytes)
export const read = (r: CborReader): KesSignature => new KesSignature({ bytes: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(KesSignature),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new KesSignature({ bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.bytes)
  }
).annotations({ identifier: "KesSignature.FromBytes" })

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "KesSignature.FromHex"
})

/**
 * Predicate for KesSignature instances
 *
 * @since 2.0.0
 * @category predicates
 */
export const isKesSignature = Schema.is(KesSignature)

/**
 * FastCheck arbitrary for generating random KesSignature instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({ minLength: 448, maxLength: 448 }).map(
  (bytes) => new KesSignature({ bytes }, { disableValidation: true })
)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse KesSignature from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse KesSignature from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode KesSignature to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: KesSignature): Uint8Array => v.bytes

/**
 * Encode KesSignature to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: KesSignature): string => Bytes.toHex(v.bytes)
