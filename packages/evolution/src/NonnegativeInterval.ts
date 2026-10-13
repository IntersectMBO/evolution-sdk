import { Effect, Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as CBOR from "./CBOR.js"
import * as Numeric from "./Numeric.js"

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

export const CDDLSchema = CBOR.tag(30, Schema.Tuple(CBOR.Integer, CBOR.Integer))

/**
 * Transform between tag(30) tuple and NonnegativeInterval model.
 */
export const FromCDDL = Schema.transformOrFail(CDDLSchema, Schema.typeSchema(NonnegativeInterval), {
  strict: true,
  encode: (_, __, ___, interval) =>
    Effect.succeed({
      _tag: "Tag" as const,
      tag: 30 as const,
      value: [interval.numerator, interval.denominator] as const
    }),
  decode: (_, __, ___, taggedValue) =>
    Effect.gen(function* () {
      if (taggedValue.tag !== 30) {
        return yield* Effect.fail(
          new ParseResult.Type(NonnegativeInterval.ast, taggedValue, `Expected tag 30, got ${taggedValue.tag}`)
        )
      }
      const [numerator, denominator] = yield* ParseResult.decodeUnknown(Schema.Tuple(CBOR.Integer, CBOR.Integer))(
        taggedValue.value
      )
      return new NonnegativeInterval({ numerator, denominator })
    })
}).annotations({ identifier: "NonnegativeInterval.CDDL" })

export const FromCBORBytes = (options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.compose(CBOR.FromBytes(options), FromCDDL)

export const FromCBORHex = (options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes(options))

export const arbitrary: FastCheck.Arbitrary<NonnegativeInterval> = FastCheck.bigInt({ min: 1n, max: 1000000n })
  .chain((denominator) =>
    FastCheck.bigInt({ min: 0n, max: denominator }).map((numerator) => ({ numerator, denominator }))
  )
  .map((v) => new NonnegativeInterval(v))

/**
 * Greatest common divisor, for reducing a rational to lowest terms.
 */
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y > 0n) [x, y] = [y, x % y]
  return x
}

/**
 * An exact rational from a decimal, with no floating-point step in between.
 *
 * Protocol parameters that are rationals in the ledger arrive as decimals over JSON:
 * `priceMem` is `0.0577`, `treasuryCut` is `0.2`. ⚠️ **None of those is representable in
 * binary floating point**, so arithmetic that goes through a `number` is arithmetic on a
 * value the chain never specified — and a fee rounded from it can land below the minimum
 * the node computed from the exact rational, which is a rejected transaction rather than a
 * rounding curiosity.
 *
 * A `number` is read through its shortest round-tripping decimal (`String(0.0577)` is
 * `"0.0577"`), which recovers the decimal that was written rather than the binary value it
 * became: `0.0577` yields `577/10000`, not the dyadic expansion of the nearest double. Pass
 * a string when the source is text, which skips the double entirely.
 *
 * @example
 * ```typescript
 * import * as NonnegativeInterval from "@evolution-sdk/evolution/NonnegativeInterval"
 *
 * NonnegativeInterval.fromDecimal(0.0577) // 577/10000
 * NonnegativeInterval.fromDecimal("1.2")  // 6/5
 * NonnegativeInterval.fromDecimal(15)     // 15/1
 * ```
 *
 * @since 2.5.0
 * @category constructors
 */
export const fromDecimal = (value: number | string): NonnegativeInterval => {
  const raw = typeof value === "string" ? value.trim() : String(value)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new Error(`NonnegativeInterval.fromDecimal: not a finite decimal: "${raw}"`)
  if (parsed < 0) throw new Error(`NonnegativeInterval.fromDecimal: negative: "${raw}"`)

  // ⚠️ Exponent notation is expanded from the TEXT, digit by digit. Reading it back through
  // `toFixed` would re-introduce the binary value this function exists to avoid: the double
  // nearest `1e-7` is slightly below it, and `(1e-7).toFixed(20)` is "0.00000009999999999999".
  const [mantissa = "0", exponent = "0"] = raw.split(/[eE]/)
  const [whole = "0", fractional = ""] = mantissa.split(".")
  let numerator = BigInt((whole || "0") + fractional)
  let denominator = 10n ** BigInt(fractional.length)
  const shift = BigInt(exponent)
  if (shift > 0n) numerator *= 10n ** shift
  else if (shift < 0n) denominator *= 10n ** -shift

  const divisor = gcd(numerator, denominator) || 1n
  return new NonnegativeInterval({ numerator: numerator / divisor, denominator: denominator / divisor })
}

/**
 * Ceiling division for non-negative bigints — `⌈num / den⌉` with no float in the middle.
 *
 * @since 2.5.0
 * @category utils
 */
export const ceilDiv = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator - 1n) / denominator
