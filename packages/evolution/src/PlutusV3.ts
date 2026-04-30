import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Plutus V3 script wrapper (raw bytes).
 *
 * @since 2.0.0
 * @category model
 */
export class PlutusV3 extends Schema.TaggedClass<PlutusV3>("PlutusV3")("PlutusV3", {
  bytes: Schema.Uint8ArrayFromHex
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    return {
      _tag: "PlutusV3",
      bytes: this.bytes
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
    if (!(that instanceof PlutusV3)) return false
    // Compare Uint8Array content byte by byte
    if (this.bytes.length !== that.bytes.length) return false
    for (let i = 0; i < this.bytes.length; i++) {
      if (this.bytes[i] !== that.bytes[i]) return false
    }
    return true
  }

  /**
   * Hash code generation.
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    // Hash Uint8Array content byte by byte
    let h = Hash.hash(this.bytes.length)
    for (const byte of this.bytes) {
      h = Hash.combine(h)(Hash.hash(byte))
    }
    return Hash.cached(this, h)
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: PlutusV3): void => w.writeBytes(v.bytes)
export const read = (r: CborReader): PlutusV3 => new PlutusV3({ bytes: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * FastCheck arbitrary for PlutusV3.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<PlutusV3> = FastCheck.uint8Array({ minLength: 1, maxLength: 512 }).map(
  (bytes) => new PlutusV3({ bytes })
)

/**
 * CBOR bytes transformation schema for PlutusV3.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(PlutusV3),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "PlutusV3.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "PlutusV3.FromCBORHex" })
