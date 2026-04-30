import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Numeric from "./Numeric.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for NonnegativeInterval representing a fractional value >= 0.
 *
 * CDDL: nonnegative_interval = #6.30([uint, positive_int])
 *
 * @since 2.0.0
 * @category model
 */
export class NonnegativeInterval extends Schema.Class<NonnegativeInterval>("NonnegativeInterval")({
  numerator: Numeric.Uint64Schema,
  denominator: Numeric.Uint64Schema // positive_int (we enforce > 0 below)
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    return {
      _tag: "NonnegativeInterval",
      numerator: this.numerator,
      denominator: this.denominator
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
    return (
      that instanceof NonnegativeInterval && this.numerator === that.numerator && this.denominator === that.denominator
    )
  }

  /**
   * Hash code generation.
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.numerator))(Hash.hash(this.denominator)))
  }

  /**
   * Static filter for validation.
   *
   * @since 2.0.0
   * @category validation
   */
  static get schema() {
    return Schema.filter((interval: NonnegativeInterval) => {
      if (interval.denominator <= 0n) {
        return {
          path: ["denominator"],
          message: `denominator (${interval.denominator}) must be > 0`
        }
      }
      return true
    })(NonnegativeInterval)
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: NonnegativeInterval): void => {
  w.writeTagHeader(30)
  w.writeArrayHeader(2)
  w.writeUint(v.numerator)
  w.writeUint(v.denominator)
  w.writeArrayBreak()
}

export const read = (r: CborReader): NonnegativeInterval => {
  r.readTagHeader()
  const count = r.readArrayHeader()
  const numerator = r.readUint()
  const denominator = r.readUint()
  if (count === -1) r.isBreak()
  return new NonnegativeInterval({ numerator, denominator })
}

export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(NonnegativeInterval),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "NonnegativeInterval.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "NonnegativeInterval.FromCBORHex" })

/**
 * Convert NonnegativeInterval to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (interval: NonnegativeInterval, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, interval)
  return w.finish()
}

/**
 * Convert NonnegativeInterval to CBOR hex.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (interval: NonnegativeInterval, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(interval, profile))

/**
 * Convert CBOR bytes to NonnegativeInterval.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex string to NonnegativeInterval.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

export const arbitrary: FastCheck.Arbitrary<NonnegativeInterval> = FastCheck.bigInt({ min: 1n, max: 1000000n })
  .chain((denominator) =>
    FastCheck.bigInt({ min: 0n, max: denominator }).map((numerator) => ({ numerator, denominator }))
  )
  .map((v) => new NonnegativeInterval(v))
