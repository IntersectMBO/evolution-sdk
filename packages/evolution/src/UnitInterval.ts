import { BigDecimal, Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Numeric from "./Numeric.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for UnitInterval representing a fractional value between 0 and 1.
 *
 * ```
 * CDDL: unit_interval = #6.30([uint, uint])
 * ```
 *
 * A unit interval is a number in the range between 0 and 1, which
 * means there are two extra constraints:
 *
 * ```
 * 1. numerator ≤ denominator
 * 2. denominator > 0
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class UnitInterval extends Schema.Class<UnitInterval>("UnitInterval")({
  numerator: Numeric.Uint64Schema,
  denominator: Numeric.Uint64Schema
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    return {
      _tag: "UnitInterval",
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
    return that instanceof UnitInterval && this.numerator === that.numerator && this.denominator === that.denominator
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
    return Schema.filter((interval: UnitInterval) => {
      if (interval.denominator <= 0n) {
        return {
          path: ["denominator"],
          message: `denominator (${interval.denominator}) must be > 0`
        }
      }
      if (interval.numerator > interval.denominator) {
        return {
          path: ["numerator"],
          message: `numerator (${interval.numerator}) must be <= denominator (${interval.denominator})`
        }
      }
      return true
    })(UnitInterval)
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: UnitInterval): void => {
  w.writeTagHeader(30)
  w.writeArrayHeader(2)
  w.writeUint(v.numerator)
  w.writeUint(v.denominator)
  w.writeArrayBreak()
}

export const read = (r: CborReader): UnitInterval => {
  r.readTagHeader()
  const count = r.readArrayHeader()
  const numerator = r.readUint()
  const denominator = r.readUint()
  if (count === -1) r.isBreak()
  return new UnitInterval({ numerator, denominator })
}

/**
 * CBOR bytes transformation schema for UnitInterval.
 * Transforms between Uint8Array and UnitInterval using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(UnitInterval),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "UnitInterval.FromCBORBytes" })

/**
 * CBOR hex transformation schema for UnitInterval.
 * Transforms between hex string and UnitInterval using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "UnitInterval.FromCBORHex" })

/**
 * Convert UnitInterval to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (interval: UnitInterval, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, interval)
  return w.finish()
}

/**
 * Convert UnitInterval to CBOR hex.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (interval: UnitInterval, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(interval, profile))

/**
 * Convert CBOR bytes to UnitInterval.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex string to UnitInterval.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert UnitInterval to BigDecimal value.
 *
 * @since 2.0.0
 * @category transformation
 */
export const toBigDecimal = (interval: UnitInterval) =>
  BigDecimal.unsafeDivide(BigDecimal.fromBigInt(interval.numerator), BigDecimal.fromBigInt(interval.denominator))

/**
 * Create UnitInterval from BigDecimal value.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromBigDecimal = (value: BigDecimal.BigDecimal): UnitInterval => {
  const normalized = BigDecimal.normalize(value)
  const denominator = BigInt(10) ** BigInt(Math.max(0, normalized.scale))
  const numerator = normalized.value

  return new UnitInterval({ numerator, denominator })
}

/**
 * FastCheck arbitrary for generating random UnitInterval instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.bigInt({ min: 1n, max: 1000000n }).chain((denominator) =>
  FastCheck.bigInt({ min: 0n, max: denominator }).map((numerator) => new UnitInterval({ numerator, denominator }))
)
