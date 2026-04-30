import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Plutus V2 script wrapper (raw bytes).
 *
 * @since 2.0.0
 * @category model
 */
export class PlutusV2 extends Schema.TaggedClass<PlutusV2>("PlutusV2")("PlutusV2", {
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
      _tag: "PlutusV2",
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
    if (!(that instanceof PlutusV2)) return false
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

export const write = (w: CborWriter, v: PlutusV2): void => w.writeBytes(v.bytes)
export const read = (r: CborReader): PlutusV2 => new PlutusV2({ bytes: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * FastCheck arbitrary for PlutusV2.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<PlutusV2> = FastCheck.uint8Array({ minLength: 1, maxLength: 512 }).map(
  (script) => new PlutusV2({ bytes: script })
)

/**
 * CBOR bytes transformation schema for PlutusV2.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(PlutusV2),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "PlutusV2.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "PlutusV2.FromCBORHex" })
